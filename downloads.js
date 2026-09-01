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
    itemId, name, type, seriesName, season, episode, year,
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
    episode: episode != null ? episode : null,
    year: year || null,
    quality: quality || 'Original',
    url,
    state: 'queued',
    addedAt: Date.now(),
    received: 0,
    total: expectedSize || 0,
    size: 0,
    error: null
  };

  entry.file = path.join(store.dir, buildFileName(entry, container || 'mp4'));

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
  const target = path.join(store.dir, `${path.parse(entry.file).name}.jpg`);
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
  start, cancel, remove, retry,
  usage, chooseDir, openDir, revealFile,
  getDir: () => store.dir
};
