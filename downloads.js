/* ============================================================
   Download-Manager (Main-Process)

   Laeuft bewusst hier und nicht im Renderer: nur der Main-Process
   hat Dateisystemzugriff, und ein Reload des Fensters wuerde sonst
   alle laufenden Downloads abreissen.
   ============================================================ */

const { app, net, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_PARALLEL = 2;
const PROGRESS_INTERVAL = 250; // ms — sonst flutet der IPC-Kanal

/** Katalog + Zielordner. Liegt im userData-Ordner, damit der
 *  Main-Process ihn beim Start ohne Renderer lesen kann. */
let store = { dir: null, items: [] };
let storePath = null;

/** Laufende Downloads: id -> { request, file, cancelled } */
const active = new Map();
/** Wartende Downloads, wenn MAX_PARALLEL erreicht ist */
const waiting = [];

let notify = () => {};

/* ------------------------- Katalog ------------------------- */

function defaultDir() {
  return path.join(app.getPath('userData'), 'downloads');
}

function loadStore() {
  storePath = path.join(app.getPath('userData'), 'downloads.json');
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    store.dir = parsed.dir || defaultDir();
    store.items = Array.isArray(parsed.items) ? parsed.items : [];
  } catch (error) {
    store.dir = defaultDir();
    store.items = [];
  }

  // Beim Start gilt alles Unfertige als abgebrochen — die Verbindung
  // ist mit dem letzten Prozess gestorben.
  store.items.forEach((item) => {
    if (item.state === 'running' || item.state === 'queued') {
      item.state = 'failed';
      // Schluessel statt Text — uebersetzt wird im Renderer
      item.errorKey = 'dlError.interrupted';
    }
  });

  ensureDir();
  saveStore();
}

function saveStore() {
  try {
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  } catch (error) {
    console.warn('Download-Katalog konnte nicht gespeichert werden:', error.message);
  }
}

function ensureDir() {
  try {
    fs.mkdirSync(store.dir, { recursive: true });
  } catch (error) {
    console.warn('Download-Ordner konnte nicht angelegt werden:', error.message);
  }
}

/* --------------------- Hilfsfunktionen --------------------- */

// Windows verbietet \ / : * ? " < > | — und Punkte am Ende
function safeName(name) {
  return String(name || 'Video')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 120) || 'Video';
}

function buildFileName(entry, extension) {
  const parts = [];

  /* Musik: "Interpret - 03 - Titel". Die Nummer zweistellig, sonst
     sortiert der Dateimanager 10 vor 2. */
  if (entry.albumName) {
    const artist = entry.artist || entry.albumArtist;
    if (artist) parts.push(safeName(artist));
    if (entry.track != null) parts.push(String(entry.track).padStart(2, '0'));
    parts.push(safeName(entry.name));
    return `${parts.join(' - ')}.${extension}`;
  }

  if (entry.seriesName) {
    parts.push(safeName(entry.seriesName));
    const season = entry.season != null ? String(entry.season).padStart(2, '0') : null;
    const episode = entry.episode != null ? String(entry.episode).padStart(2, '0') : null;
    if (season && episode) parts.push(`S${season}E${episode}`);
  }
  parts.push(safeName(entry.name));
  if (entry.year && !entry.seriesName) parts.push(`(${entry.year})`);
  return `${parts.join(' - ')}.${extension}`;
}

/** Unterordner fuer Alben und Staffeln; '' fuer Einzelstuecke. */
function groupFolder(entry) {
  if (entry.albumName) {
    const artist = entry.albumArtist || entry.artist;
    return path.join('Musik', safeName(artist || 'Unbekannt'), safeName(entry.albumName));
  }

  if (entry.seriesName) {
    const season = entry.season != null
      ? `Staffel ${String(entry.season).padStart(2, '0')}`
      : 'Folgen';
    return path.join(safeName(entry.seriesName), safeName(season));
  }

  return '';
}

/* ------------------------- Gruppen -------------------------
   Ein Album oder eine Staffel gehoert in der Liste zusammen. Der
   Schluessel wird aus dem Eintrag abgeleitet und nicht gespeichert —
   so gruppieren sich auch Downloads von frueher rueckwirkend mit.

   Die Staffel gehoert in den Schluessel: sonst laegen acht Staffeln
   in einem Topf und "3/10" waere "3/62".
   ----------------------------------------------------------- */

function groupKey(entry) {
  if (entry.albumId) return `album:${entry.albumId}`;
  if (entry.albumName) return `album:name:${entry.albumName}`;
  if (entry.seriesName) return `series:${entry.seriesName}|${entry.season != null ? entry.season : '-'}`;
  return null; // Film oder Einzelvideo: bleibt fuer sich
}

function groupTitle(entry) {
  if (entry.albumName) return entry.albumName;
  if (entry.seriesName) {
    return entry.season != null
      ? `${entry.seriesName} · ${entry.seasonLabel || `S${String(entry.season).padStart(2, '0')}`}`
      : entry.seriesName;
  }
  return entry.name;
}

/** Fasst den Katalog zu Gruppen zusammen; Einzelstuecke bleiben einzeln.
 *
 *  Die Reihenfolge folgt dem juengsten Eintrag einer Gruppe — sonst
 *  wanderte eine Serie nach oben, sobald eine alte Folge nachlaedt. */
function groups() {
  const map = new Map();
  const singles = [];

  store.items.forEach((item) => {
    const key = groupKey(item);
    if (!key) {
      singles.push({ kind: 'single', entry: { ...item } });
      return;
    }

    if (!map.has(key)) {
      map.set(key, {
        kind: 'group',
        key,
        title: groupTitle(item),
        type: item.albumName ? 'MusicAlbum' : 'Season',
        artist: item.artist || item.albumArtist || null,
        seriesName: item.seriesName || null,
        season: item.season != null ? item.season : null,
        poster: null,
        items: [],
        addedAt: 0,
        expected: 0
      });
    }

    const group = map.get(key);
    group.items.push({ ...item });
    group.addedAt = Math.max(group.addedAt, item.addedAt || 0);
    if (!group.poster && item.poster) group.poster = item.poster;
    // Die groesste bekannte Gesamtzahl gewinnt (s. Kommentar bei start())
    if (item.groupTotal) group.expected = Math.max(group.expected, item.groupTotal);
  });

  const list = [...map.values(), ...singles];

  list.forEach((node) => {
    if (node.kind !== 'group') return;
    node.done = node.items.filter((i) => i.state === 'done').length;
    node.failed = node.items.filter((i) => i.state === 'failed').length;
    node.busy = node.items.filter((i) => i.state === 'running' || i.state === 'queued').length;
    // Ohne gemeldete Gesamtzahl zaehlt, was tatsaechlich da ist
    node.total = Math.max(node.expected, node.items.length);
    node.size = node.items.reduce((sum, i) => sum + (i.state === 'done' ? (i.size || 0) : 0), 0);
    node.items.sort((a, b) => {
      const at = a.track != null ? a.track : a.episode != null ? a.episode : 0;
      const bt = b.track != null ? b.track : b.episode != null ? b.episode : 0;
      return at - bt;
    });
  });

  return list.sort((a, b) => {
    const at = a.kind === 'group' ? a.addedAt : (a.entry.addedAt || 0);
    const bt = b.kind === 'group' ? b.addedAt : (b.entry.addedAt || 0);
    return bt - at;
  });
}

function findItem(id) {
  return store.items.find((item) => item.id === id) || null;
}

function publicList() {
  return store.items.map((item) => ({ ...item }));
}

function emitChange() {
  notify({ type: 'list', items: publicList() });
}

/* ---------------------- Download-Lauf ---------------------- */

function startNext() {
  while (active.size < MAX_PARALLEL && waiting.length) {
    const id = waiting.shift();
    const entry = findItem(id);
    // Zwischenzeitlich abgebrochen oder entfernt
    if (entry && entry.state === 'queued') runDownload(entry);
  }
}

function runDownload(entry) {
  entry.state = 'running';
  entry.error = null;
  saveStore();
  emitChange();

  const partPath = `${entry.file}.part`;
  let fileStream;

  try {
    fs.mkdirSync(path.dirname(entry.file), { recursive: true });
    fileStream = fs.createWriteStream(partPath);
  } catch (error) {
    return finish(entry, false, `Datei konnte nicht angelegt werden: ${error.message}`);
  }

  const request = net.request({ method: 'GET', url: entry.url });
  const record = { request, stream: fileStream, cancelled: false, part: partPath };
  active.set(entry.id, record);

  let received = 0;
  let lastEmit = 0;

  request.on('response', (response) => {
    if (response.statusCode >= 400) {
      cleanupStream(record);
      return finish(entry, false, `Server antwortete mit ${response.statusCode}`);
    }

    // Beim Transcoding fehlt Content-Length haeufig — dann bleibt total 0
    // und die Oberflaeche zeigt nur die geladene Menge.
    const lengthHeader = response.headers['content-length'];
    const total = Number(Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader) || 0;
    entry.total = total;

    response.on('data', (chunk) => {
      if (record.cancelled) return;
      received += chunk.length;
      fileStream.write(chunk);

      const now = Date.now();
      if (now - lastEmit >= PROGRESS_INTERVAL) {
        lastEmit = now;
        entry.received = received;
        notify({ type: 'progress', id: entry.id, received, total });
      }
    });

    response.on('end', () => {
      if (record.cancelled) return;
      fileStream.end(() => {
        try {
          fs.renameSync(partPath, entry.file);
          entry.size = received;
          entry.received = received;
          finish(entry, true);
        } catch (error) {
          finish(entry, false, `Datei konnte nicht abgelegt werden: ${error.message}`);
        }
      });
    });

    response.on('error', (error) => {
      cleanupStream(record);
      finish(entry, false, error.message || 'Uebertragung abgebrochen');
    });
  });

  request.on('error', (error) => {
    cleanupStream(record);
    if (!record.cancelled) finish(entry, false, error.message || 'Verbindung fehlgeschlagen');
  });

  request.end();
}

function cleanupStream(record) {
  try {
    record.stream.destroy();
  } catch (error) {
    /* egal */
  }
  try {
    if (fs.existsSync(record.part)) fs.unlinkSync(record.part);
  } catch (error) {
    /* egal */
  }
}

function finish(entry, ok, errorMessage) {
  active.delete(entry.id);
  entry.state = ok ? 'done' : 'failed';
  if (!ok) {
    // Technische Meldungen (HTTP-Status, Dateisystem) bleiben im Klartext —
    // sie sind Diagnose, keine Oberflaeche.
    entry.error = errorMessage || null;
    if (!errorMessage) entry.errorKey = 'dlError.failed';
  }
  else entry.completedAt = Date.now();
  saveStore();
  emitChange();
  startNext();
}

/* ------------------------- API ------------------------- */

function start(payload) {
  const {
    itemId, name, type, seriesName, season, seasonLabel, episode, year,
    albumName, albumId, albumArtist, artist, track, groupTotal,
    url, quality, container, poster, expectedSize
  } = payload;

  if (!itemId || !url) throw new Error('Unvollstaendige Download-Angaben');

  // Bereits vorhanden? Dann nichts doppelt holen.
  const existing = store.items.find(
    (item) => item.itemId === itemId && (item.state === 'done' || item.state === 'running' || item.state === 'queued')
  );
  if (existing) return { duplicate: true, entry: { ...existing } };

  ensureDir();

  const entry = {
    id: `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    itemId,
    name: name || 'Video',
    type: type || 'Movie',
    seriesName: seriesName || null,
    season: season != null ? season : null,
    seasonLabel: seasonLabel || null,
    episode: episode != null ? episode : null,
    year: year || null,

    /* Musik. albumId ist der verlaessliche Schluessel; der Name dient
       nur der Anzeige und als Rueckfall, wenn die Id fehlt. */
    albumName: albumName || null,
    albumId: albumId || null,
    albumArtist: albumArtist || null,
    artist: artist || null,
    track: track != null ? track : null,

    /* Wie viele Titel die Gruppe insgesamt hat. Wird beim
       Sammel-Download mitgegeben, damit "3/10" auch dann stimmt,
       wenn erst drei Eintraege im Katalog stehen. */
    groupTotal: groupTotal || null,

    quality: quality || 'Original',
    url,
    state: 'queued',
    addedAt: Date.now(),
    received: 0,
    total: expectedSize || 0,
    size: 0,
    error: null
  };

  /* Alben und Staffeln bekommen einen eigenen Unterordner — sonst
     liegen zweihundert Titel flach nebeneinander im Download-Ordner.
     Einzelne Filme bleiben oben liegen, wo sie schnell zu finden sind. */
  entry.file = path.join(store.dir, groupFolder(entry), buildFileName(entry, container || 'mp4'));

  // Gleicher Dateiname aus einem frueheren Download? Zaehler anhaengen.
  if (fs.existsSync(entry.file)) {
    const parsed = path.parse(entry.file);
    let n = 2;
    while (fs.existsSync(path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`))) n += 1;
    entry.file = path.join(parsed.dir, `${parsed.name} (${n})${parsed.ext}`);
  }

  store.items.unshift(entry);
  saveStore();

  if (poster) savePoster(entry, poster);

  waiting.push(entry.id);
  emitChange();
  startNext();

  return { duplicate: false, entry: { ...entry } };
}

// Cover getrennt laden, damit die Offline-Ansicht ohne Server Bilder zeigt
function savePoster(entry, posterUrl) {
  // Neben die Mediendatei, nicht in den Wurzelordner — sonst laege das
  // Cover eines Albumtitels getrennt von seinem Titel.
  const parsed = path.parse(entry.file);
  const target = path.join(parsed.dir, `${parsed.name}.jpg`);
  const request = net.request({ method: 'GET', url: posterUrl });

  request.on('response', (response) => {
    if (response.statusCode >= 400) return;
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => {
      try {
        fs.writeFileSync(target, Buffer.concat(chunks));
        const current = findItem(entry.id);
        if (current) {
          current.poster = target;
          saveStore();
          emitChange();
        }
      } catch (error) {
        /* Cover ist Beiwerk */
      }
    });
  });

  request.on('error', () => {});
  request.end();
}

function cancel(id) {
  const record = active.get(id);
  const entry = findItem(id);

  if (record) {
    record.cancelled = true;
    try {
      record.request.abort();
    } catch (error) {
      /* egal */
    }
    cleanupStream(record);
    active.delete(id);
  }

  const queuedAt = waiting.indexOf(id);
  if (queuedAt >= 0) waiting.splice(queuedAt, 1);

  if (entry) {
    entry.state = 'failed';
    entry.errorKey = 'dlError.cancelled';
    entry.error = null;
    saveStore();
  }

  emitChange();
  startNext();
  return true;
}

function remove(id) {
  const entry = findItem(id);
  if (!entry) return false;

  if (active.has(id) || waiting.includes(id)) cancel(id);

  [entry.file, `${entry.file}.part`, entry.poster].filter(Boolean).forEach((file) => {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
      console.warn('Datei konnte nicht geloescht werden:', file);
    }
  });

  store.items = store.items.filter((item) => item.id !== id);
  saveStore();
  emitChange();
  return true;
}

/** Entfernt eine ganze Gruppe. Ohne das muesste der Nutzer bei einem
 *  Album mit zwanzig Titeln zwanzigmal klicken. */
function removeGroup(key) {
  const members = store.items.filter((item) => groupKey(item) === key);
  // Ordner vorher merken: nach dem Loeschen sind die Eintraege weg
  const folders = [...new Set(members.map((item) => path.dirname(item.file)))];

  members.map((item) => item.id).forEach((id) => remove(id));

  /* Leere Unterordner abraeumen — sonst bleibt nach dem Loeschen eines
     Albums dessen Ordnergeruest zurueck. rmdir entfernt nur leere
     Ordner, liegt dort noch etwas, bleibt es unangetastet. */
  folders.forEach((folder) => {
    if (!folder || path.resolve(folder) === path.resolve(store.dir)) return;
    try {
      fs.rmdirSync(folder);
      const parent = path.dirname(folder);
      if (path.resolve(parent) !== path.resolve(store.dir)) fs.rmdirSync(parent);
    } catch (error) {
      /* nicht leer oder nicht vorhanden — beides in Ordnung */
    }
  });

  return { removed: members.length };
}

function retry(id) {
  const entry = findItem(id);
  if (!entry || entry.state === 'running' || entry.state === 'done') return false;

  entry.state = 'queued';
  entry.received = 0;
  entry.error = null;
  saveStore();

  waiting.push(id);
  emitChange();
  startNext();
  return true;
}

function usage() {
  let bytes = 0;
  store.items.forEach((item) => {
    if (item.state === 'done') bytes += item.size || 0;
  });
  return { bytes, count: store.items.filter((i) => i.state === 'done').length, dir: store.dir };
}

async function chooseDir(win) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Ordner fuer Downloads waehlen',
    defaultPath: store.dir,
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths.length) return { changed: false, dir: store.dir };

  store.dir = result.filePaths[0];
  ensureDir();
  saveStore();
  // Bestehende Dateien bleiben liegen, wo sie sind — ihre Pfade sind absolut
  // gespeichert und funktionieren weiter.
  return { changed: true, dir: store.dir };
}

function openDir() {
  ensureDir();
  shell.openPath(store.dir);
}

function revealFile(id) {
  const entry = findItem(id);
  if (entry && entry.state === 'done' && fs.existsSync(entry.file)) {
    shell.showItemInFolder(entry.file);
    return true;
  }
  return false;
}

/** Prueft die Dateien und raeumt Eintraege ab, deren Datei verschwunden ist. */
function verify() {
  let changed = false;
  store.items.forEach((item) => {
    if (item.state !== 'done') return;
    if (!fs.existsSync(item.file)) {
      item.state = 'failed';
      item.errorKey = 'dlError.fileMissing';
      item.error = null;
      changed = true;
    }
  });
  if (changed) {
    saveStore();
    emitChange();
  }
  return publicList();
}

function init(notifier) {
  notify = notifier || (() => {});
  loadStore();
}

// Beim Beenden laufende Anfragen sauber abbrechen, damit keine
// .part-Leichen mit offenen Handles zurueckbleiben.
function shutdown() {
  active.forEach((record, id) => {
    record.cancelled = true;
    try {
      record.request.abort();
    } catch (error) {
      /* egal */
    }
    cleanupStream(record);
    const entry = findItem(id);
    if (entry) {
      entry.state = 'failed';
      entry.errorKey = 'dlError.interrupted';
      entry.error = null;
    }
  });
  active.clear();
  saveStore();
}

module.exports = {
  init, shutdown, verify,
  list: () => publicList(),
  groups,
  start, cancel, remove, removeGroup, retry,
  usage, chooseDir, openDir, revealFile,
  getDir: () => store.dir
};
