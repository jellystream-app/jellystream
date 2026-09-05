/* ============================================================
   Discord Rich Presence (Main-Process)

   Zeigt in Discord, was gerade laeuft — aber nur, wenn der Nutzer
   es in den Einstellungen einschaltet. Ist der Schalter aus, wird
   nie eine Verbindung geoeffnet.

   Discord lauscht lokal auf einer Named Pipe (Windows) bzw. einem
   Unix-Socket. Das Protokoll ist schlicht genug, um es direkt zu
   sprechen — `net` aus dem Node-Kern genuegt. Eine Bibliothek waere
   hier eine Abhaengigkeit fuer 40 Zeilen Rahmenlogik.

   Rahmen:  [4 Byte LE opcode][4 Byte LE Laenge][JSON]
              op 0 = HANDSHAKE  {v:1, client_id}
              op 1 = FRAME      {cmd:'SET_ACTIVITY', args, nonce}
              op 2 = CLOSE

   Grundsatz: Praesenz ist Nebensache. Kein Pfad hier darf die
   Wiedergabe stoeren — laeuft Discord nicht, passiert schlicht nichts.
   ============================================================ */

const net = require('net');
const path = require('path');
const os = require('os');

/* Rich Presence braucht eine Application ID aus dem Discord Developer
   Portal (https://discord.com/developers/applications).

   Die ID gehoert dem Nutzer: Name und Symbol der dort angelegten
   Anwendung bestimmen, was Discord ueber dem Text anzeigt. Sie wird
   deshalb in den Einstellungen eingetragen und von dort gesetzt —
   nicht hier fest verdrahtet.

   Die Umgebungsvariable bleibt als Ausweichweg fuer Entwicklung und
   Tests bestehen. */
let clientId = process.env.JELLYSTREAM_DISCORD_ID || '';

/** Discord-IDs sind Snowflakes: 17 bis 20 Ziffern, sonst nichts.
 *  Alles andere lehnt Discord ohnehin ab — dann lieber gleich hier
 *  merken und dem Nutzer sagen, dass die Eingabe nicht stimmt. */
function isValidId(value) {
  return /^\d{17,20}$/.test(String(value || '').trim());
}

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

/* Discord verwirft Aktualisierungen, die dichter als etwa 15 Sekunden
   aufeinander folgen. Haeufiger zu senden bringt nichts und riskiert
   nur, dass die Verbindung gedrosselt wird. */
const UPDATE_INTERVAL = 15000;
const RECONNECT_INTERVAL = 30000;

let socket = null;
let connected = false;      // Handshake bestaetigt
let enabled = false;        // Schalter in den Einstellungen
let reconnectTimer = null;
let throttleTimer = null;
let pendingActivity = null; // zuletzt gewuenschter Zustand
let lastSentAt = 0;
let warnedMissingId = false;

/** Die moeglichen Orte der Discord-Pipe.
 *
 *  Unter Windows sind es Named Pipes, sonst Unix-Sockets. Discord
 *  zaehlt bis 9 hoch, wenn mehrere Clients laufen (Stable, PTB,
 *  Canary parallel).
 *
 *  Die Flatpak- und Snap-Pfade sind noetig, weil eine so installierte
 *  Discord-Fassung ihren Socket in einem eigenen Unterordner ablegt —
 *  ohne diese Pfade findet die App sie nie. */
function socketPaths() {
  const paths = [];

  if (process.platform === 'win32') {
    for (let i = 0; i < 10; i += 1) {
      paths.push(path.join('\\\\?\\pipe', `discord-ipc-${i}`));
    }
    return paths;
  }

  const base = process.env.XDG_RUNTIME_DIR
    || process.env.TMPDIR
    || process.env.TMP
    || process.env.TEMP
    || os.tmpdir();

  // Reihenfolge: nackt, dann die ueblichen Sandkasten-Unterordner
  const prefixes = ['', 'app/com.discordapp.Discord/', 'snap.discord/'];

  prefixes.forEach((prefix) => {
    for (let i = 0; i < 10; i += 1) {
      paths.push(path.join(base, `${prefix}discord-ipc-${i}`));
    }
  });

  return paths;
}

function encode(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(opcode, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function send(opcode, payload) {
  if (!socket || socket.destroyed) return false;
  try {
    socket.write(encode(opcode, payload));
    return true;
  } catch (error) {
    // Pipe unter uns weggebrochen — der close-Handler raeumt auf
    return false;
  }
}

/** Verbindet mit dem ersten Socket, der antwortet.
 *
 *  Reihum durchprobiert: schlaegt einer fehl, kommt der naechste dran.
 *  Ist die Liste durch, laeuft Discord nicht — dann wird still ein
 *  neuer Versuch eingeplant, ohne Fehlermeldung. */
function connect(index = 0) {
  if (!enabled || connected || socket) return;

  if (!isValidId(clientId)) {
    if (!warnedMissingId) {
      console.log('[discord] Keine gueltige Application ID — Praesenz bleibt leer');
      warnedMissingId = true;
    }
    return;
  }

  const candidates = socketPaths();
  if (index >= candidates.length) {
    scheduleReconnect();
    return;
  }

  const attempt = net.createConnection(candidates[index]);
  attempt.setNoDelay(true);

  // Vor dem Handshake zaehlt nur: klappt es oder nicht
  const tryNext = () => {
    attempt.removeAllListeners();
    attempt.destroy();
    if (socket === attempt) socket = null;
    connect(index + 1);
  };

  attempt.once('error', tryNext);

  attempt.once('connect', () => {
    socket = attempt;
    attempt.removeListener('error', tryNext);
    attachHandlers(attempt);
    send(OP_HANDSHAKE, { v: 1, client_id: String(clientId).trim() });
  });
}

function attachHandlers(active) {
  let buffer = Buffer.alloc(0);

  active.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Es koennen mehrere Rahmen in einem Paket stecken
    while (buffer.length >= 8) {
      const length = buffer.readInt32LE(4);
      if (buffer.length < 8 + length) break;

      const opcode = buffer.readInt32LE(0);
      const body = buffer.slice(8, 8 + length).toString('utf8');
      buffer = buffer.slice(8 + length);

      handleFrame(opcode, body);
    }
  });

  active.on('error', () => cleanup(true));
  active.on('close', () => cleanup(true));
}

function handleFrame(opcode, body) {
  if (opcode === OP_CLOSE) {
    cleanup(true);
    return;
  }

  let message = null;
  try {
    message = JSON.parse(body);
  } catch (error) {
    return; // unverstaendlicher Rahmen — ignorieren
  }

  /* DISPATCH/READY bestaetigt den Handshake. Erst danach nimmt
     Discord eine Aktivitaet an. */
  if (message.evt === 'READY') {
    connected = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (pendingActivity !== null) flush();
  }
}

function scheduleReconnect() {
  if (reconnectTimer || !enabled) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_INTERVAL);
}

/** Verbindung aufloesen. `retry` steuert, ob ein neuer Versuch folgt —
 *  beim Ausschalten durch den Nutzer ausdruecklich nicht. */
function cleanup(retry) {
  connected = false;

  if (socket) {
    socket.removeAllListeners();
    try {
      socket.destroy();
    } catch (error) {
      /* schon zu */
    }
    socket = null;
  }

  if (retry && enabled) scheduleReconnect();
}

/** Schickt den gemerkten Zustand wirklich hinaus. */
function flush() {
  if (!connected) return;

  lastSentAt = Date.now();
  const activity = pendingActivity;

  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: {
      pid: process.pid,
      // null loescht die Praesenz — genau dafuer ist der Wert gedacht
      activity: activity || null
    },
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`
  });
}

/** Merkt den Zustand und sendet ihn gedrosselt.
 *
 *  Wichtig ist das Nachreichen: Wer im Film spult, loest viele
 *  Aktualisierungen kurz hintereinander aus. Ohne den Nachschlag
 *  bliebe die zuletzt *verworfene* Position stehen, und Discord
 *  zeigte dauerhaft etwas Falsches. */
function queue(activity) {
  pendingActivity = activity;

  if (!enabled || !connected) return;

  const since = Date.now() - lastSentAt;
  if (since >= UPDATE_INTERVAL) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
    flush();
    return;
  }

  if (throttleTimer) return; // ein Nachschlag genuegt
  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    flush();
  }, UPDATE_INTERVAL - since);
}

/* ======================= Oeffentliche Schnittstelle ======================= */

/** Die Application ID aus den Einstellungen uebernehmen.
 *
 *  Die ID steckt im Handshake — eine laufende Verbindung gehoert
 *  also noch der alten. Beim Wechsel wird deshalb neu verbunden,
 *  sonst zeigte Discord weiter die vorige Anwendung an. */
function setClientId(value) {
  const next = String(value || '').trim();
  if (next === clientId) return getState();

  clientId = next;
  warnedMissingId = false;

  if (enabled) {
    cleanup(false);
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    connect();
  }

  return getState();
}

/** Einschalten — erst hier wird ueberhaupt eine Verbindung versucht. */
function enable() {
  if (enabled) return getState();
  enabled = true;
  connect();
  return getState();
}

/** Ausschalten: Praesenz loeschen, Verbindung zu, kein Wiederversuch. */
function disable() {
  if (!enabled) return getState();

  // Noch im Stehen abmelden, sonst bleibt die Anzeige in Discord haengen
  if (connected) {
    pendingActivity = null;
    flush();
  }

  enabled = false;
  clearTimeout(throttleTimer);
  clearTimeout(reconnectTimer);
  throttleTimer = null;
  reconnectTimer = null;
  pendingActivity = null;
  cleanup(false);
  return getState();
}

/** Was gerade laeuft.
 *
 *  Der Renderer liefert bereits fertige, uebersetzte Texte — die
 *  Sprachdateien liegen dort, nicht hier. Diese Datei formt daraus
 *  nur den Rahmen, den Discord erwartet. */
function setActivity(payload) {
  if (!enabled) return false;
  if (!payload || typeof payload !== 'object') return false;

  const details = String(payload.details || '').slice(0, 128);
  const stateLine = String(payload.state || '').slice(0, 128);

  const activity = {
    type: 3, // Watching
    details: details || undefined,
    state: stateLine || undefined,
    instance: false
  };

  // Musik meldet sich als "Listening", Video als "Watching"
  if (payload.kind === 'audio') activity.type = 2;

  /* Der Fortschrittsbalken entsteht aus zwei Zeitstempeln. Discord
     rechnet die Restzeit selbst — laeuft also mit, ohne dass wir
     sekuendlich senden muessten.

     Beim Pausieren duerfen sie nicht mit: ein laufender Balken bei
     stehendem Bild waere schlicht gelogen. */
  const position = Number(payload.position);
  const duration = Number(payload.duration);

  if (!payload.paused && Number.isFinite(position) && position >= 0) {
    const now = Date.now();
    activity.timestamps = { start: Math.round(now - position * 1000) };

    if (Number.isFinite(duration) && duration > 0 && duration > position) {
      activity.timestamps.end = Math.round(now + (duration - position) * 1000);
    }
  }

  if (payload.largeText) {
    activity.assets = {
      large_image: 'logo', // im Developer Portal hinterlegtes Bild
      large_text: String(payload.largeText).slice(0, 128)
    };
  }

  queue(activity);
  return true;
}

/** Praesenz loeschen, Verbindung aber offen lassen (z. B. beim Stoppen). */
function clear() {
  if (!enabled) return false;
  queue(null);
  return true;
}

function getState() {
  return {
    enabled,
    connected,
    configured: isValidId(clientId)
  };
}

/** Beim Beenden sauber abmelden.
 *
 *  Ohne das bleibt die Praesenz in Discord noch Minuten stehen,
 *  obwohl die App laengst zu ist. Hier wird ausnahmsweise ohne
 *  Drosselung direkt geschrieben — danach ist kein Prozess mehr da,
 *  der einen Nachschlag senden koennte. */
function shutdown() {
  if (connected) {
    pendingActivity = null;
    flush();
  }
  enabled = false;
  clearTimeout(throttleTimer);
  clearTimeout(reconnectTimer);
  throttleTimer = null;
  reconnectTimer = null;
  cleanup(false);
}

module.exports = {
  enable,
  disable,
  setClientId,
  setActivity,
  clear,
  getState,
  shutdown,
  isValidId
};
