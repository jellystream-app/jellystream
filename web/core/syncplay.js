/**
 * SyncPlay — gemeinsam schauen ueber den Jellyfin-Server.
 *
 * So funktioniert das Protokoll (vereinfacht):
 *   - Gruppen verwaltet der Server: /SyncPlay/New, /Join, /Leave, /List
 *   - Wer Play/Pause/Seek drueckt, SCHICKT NUR EINE BITTE an den Server
 *     (/SyncPlay/Unpause, /Pause, /Seek). Ausgefuehrt wird erst, wenn der
 *     Server per WebSocket ein "SyncPlayCommand" an alle sendet — mit
 *     einem Zeitpunkt (When), zu dem es passieren soll.
 *   - Damit alle zum selben Augenblick handeln, braucht jeder Client den
 *     Versatz seiner Uhr zur Serveruhr (/GetUtcTime, NTP-artig).
 *   - Nach dem Laden oder Puffern meldet sich ein Client mit /Ready bzw.
 *     /Buffering; der Server wartet auf alle, bevor er weiterspielen laesst.
 *
 * Dieses Modul kennt kein DOM und keinen Player. Die Oberflaeche gibt
 * ihm einen "Spieler" mit play/pause/seek/position/load und bekommt
 * Ereignisse ueber onEvent. So bleibt es testbar und ist auch fuer die
 * mobile App nutzbar.
 */
const syncplay = (() => {
  const TICKS = 10000000;

  const s = {
    conn: null,           // { serverUrl, token, deviceId, authHeader }
    ws: null,
    wsTimer: null,
    keepAlive: null,
    group: null,          // { GroupId, GroupName, State, Participants }
    offsetMs: 0,          // Serverzeit = lokale Zeit + offsetMs
    rttMs: 0,
    player: null,
    listeners: new Set(),
    queue: null,          // letzter PlayQueue-Stand
    pendingTimers: new Set(),
    closing: false
  };

  const emit = (type, data) => s.listeners.forEach((fn) => {
    try { fn(type, data); } catch (error) { console.warn('SyncPlay-Listener:', error); }
  });

  const serverNow = () => Date.now() + s.offsetMs;
  const toLocal = (iso) => Date.parse(iso) - s.offsetMs;

  async function request(path, body) {
    const { serverUrl, authHeader } = s.conn;
    const resp = await fetch(`${serverUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authHeader },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (resp.status === 403) throw new Error('forbidden');
    if (!resp.ok) throw new Error(`SyncPlay ${resp.status}`);
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  /* --- Uhrabgleich ---
     Mehrere Messungen, die mit der kuerzesten Laufzeit gewinnt: deren
     Versatz ist am wenigsten von Netzschwankungen verfaelscht. */
  async function syncClock(samples = 5) {
    let best = null;
    for (let i = 0; i < samples; i += 1) {
      const t0 = Date.now();
      let r;
      try {
        r = await request('/GetUtcTime');
      } catch (error) {
        continue;
      }
      const t3 = Date.now();
      const t1 = Date.parse(r.RequestReceptionTime);
      const t2 = Date.parse(r.ResponseTransmissionTime);
      if (!t1 || !t2) continue;
      const rtt = (t3 - t0) - (t2 - t1);
      const offset = ((t1 - t0) + (t2 - t3)) / 2;
      if (!best || rtt < best.rtt) best = { rtt, offset };
    }
    if (best) {
      s.offsetMs = best.offset;
      s.rttMs = best.rtt;
    }
    return best;
  }

  /* --- WebSocket ---
     Jellyfin schickt SyncPlay-Nachrichten ueber denselben Socket wie
     alle Sitzungsnachrichten. Nur die beiden SyncPlay-Typen werden
     ausgewertet; KeepAlive haelt die Verbindung offen. */
  function socketUrl() {
    const { serverUrl, token, deviceId } = s.conn;
    const base = serverUrl.replace(/^http/i, 'ws');
    return `${base}/socket?api_key=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(deviceId)}`;
  }

  function openSocket() {
    if (s.ws || !s.conn || typeof WebSocket === 'undefined') return;
    const ws = new WebSocket(socketUrl());
    s.ws = ws;

    ws.onopen = () => {
      emit('socket', { open: true });
      clearInterval(s.keepAlive);
      s.keepAlive = setInterval(() => {
        if (ws.readyState === 1) ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
      }, 30000);
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (error) { return; }
      if (msg.MessageType === 'SyncPlayCommand') handleCommand(msg.Data);
      else if (msg.MessageType === 'SyncPlayGroupUpdate') handleGroupUpdate(msg.Data);
      else if (msg.MessageType === 'ForceKeepAlive') ws.send(JSON.stringify({ MessageType: 'KeepAlive' }));
    };

    ws.onclose = () => {
      clearInterval(s.keepAlive);
      s.ws = null;
      emit('socket', { open: false });
      // Wiederverbinden, solange wir in einer Gruppe sind
      if (!s.closing && s.group) {
        clearTimeout(s.wsTimer);
        s.wsTimer = setTimeout(openSocket, 3000);
      }
    };
  }

  function closeSocket() {
    clearTimeout(s.wsTimer);
    clearInterval(s.keepAlive);
    if (s.ws) {
      s.closing = true;
      try { s.ws.close(); } catch (error) { /* egal */ }
      s.ws = null;
      s.closing = false;
    }
  }

  /* --- Befehle des Servers ausfuehren --- */
  function schedule(atLocalMs, fn) {
    const delay = Math.max(0, atLocalMs - Date.now());
    const id = setTimeout(() => {
      s.pendingTimers.delete(id);
      fn();
    }, delay);
    s.pendingTimers.add(id);
  }

  function clearScheduled() {
    s.pendingTimers.forEach(clearTimeout);
    s.pendingTimers.clear();
  }

  function handleCommand(cmd) {
    if (!cmd || !s.player || !s.group || cmd.GroupId !== s.group.GroupId) return;
    const when = toLocal(cmd.When);
    const position = (cmd.PositionTicks || 0) / TICKS;
    clearScheduled();
    emit('command', cmd);

    switch (cmd.Command) {
      case 'Unpause':
        // Wer zu spaet ist, springt um die verpasste Zeit vor
        schedule(when, () => {
          const late = Math.max(0, (Date.now() - when) / 1000);
          const target = position + late;
          if (Math.abs(s.player.position() - target) > 0.5) s.player.seek(target);
          s.player.play();
        });
        break;
      case 'Pause':
        schedule(when, () => {
          s.player.pause();
          if (Math.abs(s.player.position() - position) > 0.5) s.player.seek(position);
        });
        break;
      case 'Seek':
        schedule(when, () => {
          s.player.pause();
          s.player.seek(position);
          // Bereit melden, sobald der Spieler an der Stelle ist
          s.player.whenReady(() => ready(false));
        });
        break;
      case 'Stop':
        schedule(when, () => s.player.stop());
        break;
      default:
        break;
    }
  }

  function handleGroupUpdate(update) {
    if (!update) return;
    const { Type, Data } = update;
    switch (Type) {
      case 'GroupJoined':
        s.group = Data;
        emit('joined', Data);
        break;
      case 'GroupLeft':
      case 'NotInGroup':
        leftGroup(Type);
        break;
      case 'GroupDoesNotExist':
      case 'LibraryAccessDenied':
        emit('error', Type);
        leftGroup(Type);
        break;
      case 'UserJoined':
      case 'UserLeft':
        if (s.group) {
          const list = new Set(s.group.Participants || []);
          if (Type === 'UserJoined') list.add(Data);
          else list.delete(Data);
          s.group = { ...s.group, Participants: [...list] };
        }
        emit(Type === 'UserJoined' ? 'userJoined' : 'userLeft', Data);
        break;
      case 'StateUpdate':
        if (s.group) s.group = { ...s.group, State: Data?.State };
        emit('state', Data);
        break;
      case 'PlayQueue':
        handlePlayQueue(Data);
        break;
      default:
        break;
    }
  }

  /* Die Warteschlange der Gruppe: welcher Titel laeuft, ab wo. Wechselt
     der Titel, laedt der Spieler ihn und meldet sich danach bereit. */
  function handlePlayQueue(queue) {
    const before = s.queue;
    s.queue = queue;
    const current = queue?.Playlist?.[queue.PlayingItemIndex];
    emit('queue', queue);
    if (!current || !s.player) return;

    const changed = !before
      || before.Playlist?.[before.PlayingItemIndex]?.PlaylistItemId !== current.PlaylistItemId;
    if (!changed) return;

    const start = (queue.StartPositionTicks || 0) / TICKS;
    clearScheduled();
    Promise.resolve(s.player.load(current.ItemId, start))
      .then(() => s.player.whenReady(() => ready(queue.IsPlaying)))
      .catch((error) => emit('error', error.message));
  }

  function leftGroup(reason) {
    clearScheduled();
    const was = s.group;
    s.group = null;
    s.queue = null;
    closeSocket();
    if (was) emit('left', reason);
  }

  function currentPlaylistItemId() {
    return s.queue?.Playlist?.[s.queue.PlayingItemIndex]?.PlaylistItemId || '';
  }

  function stateBody(isPlaying) {
    return {
      When: new Date(serverNow()).toISOString(),
      PositionTicks: Math.round((s.player?.position() || 0) * TICKS),
      IsPlaying: Boolean(isPlaying),
      PlaylistItemId: currentPlaylistItemId()
    };
  }

  function ready(isPlaying) {
    if (!s.group) return Promise.resolve();
    return request('/SyncPlay/Ready', stateBody(isPlaying)).catch(() => {});
  }

  return {
    /** Verbindung setzen — vor allem anderen. authHeader wie bei jeder API-Anfrage. */
    configure(conn) {
      s.conn = conn;
    },

    /** Spieler anbinden: { play, pause, seek(sec), stop, position(), load(itemId, startSec), whenReady(fn) } */
    attach(player) {
      s.player = player;
    },

    on(fn) {
      s.listeners.add(fn);
      return () => s.listeners.delete(fn);
    },

    get group() { return s.group; },
    get active() { return Boolean(s.group); },
    get offsetMs() { return s.offsetMs; },

    list: () => request('/SyncPlay/List'),

    async create(name) {
      await syncClock();
      openSocket();
      await request('/SyncPlay/New', { GroupName: name });
    },

    async join(groupId) {
      await syncClock();
      openSocket();
      await request('/SyncPlay/Join', { GroupId: groupId });
    },

    async leave() {
      try {
        await request('/SyncPlay/Leave', {});
      } finally {
        leftGroup('Leave');
      }
    },

    /** Titel fuer die Gruppe starten (ersetzt die Warteschlange) */
    playQueue(itemIds, index = 0, startSeconds = 0) {
      return request('/SyncPlay/SetNewQueue', {
        PlayingQueue: itemIds,
        PlayingItemPosition: index,
        StartPositionTicks: Math.round(startSeconds * TICKS)
      });
    },

    /* Bitten an den Server — ausgefuehrt wird ueber handleCommand */
    requestPlay: () => request('/SyncPlay/Unpause', {}),
    requestPause: () => request('/SyncPlay/Pause', {}),
    requestSeek: (seconds) => request('/SyncPlay/Seek', { PositionTicks: Math.round(seconds * TICKS) }),

    /** Der Spieler puffert / ist wieder bereit — damit die Gruppe wartet */
    buffering: () => (s.group ? request('/SyncPlay/Buffering', stateBody(false)).catch(() => {}) : Promise.resolve()),
    ready,

    /** Alles schliessen, z. B. beim Abmelden */
    reset() {
      leftGroup('Reset');
    },

    // Fuer Tests
    _handleMessage(msg) {
      if (msg.MessageType === 'SyncPlayCommand') handleCommand(msg.Data);
      else if (msg.MessageType === 'SyncPlayGroupUpdate') handleGroupUpdate(msg.Data);
    },
    _setOffset(ms) { s.offsetMs = ms; },
    _syncClock: syncClock
  };
})();

if (typeof module !== 'undefined') module.exports = syncplay;
