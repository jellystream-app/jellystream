/* ============================================================
   Sprachverwaltung (Main-Process)

   Drei Quellen, klare Rangfolge:
     1. mitgeliefert  — language/ neben der App (de, en)
     2. Cache         — von GitHub geladen, in userData/languages
     3. lokal         — userData/language, vom Nutzer befuellt

   Lokal schlaegt Cache schlaegt mitgeliefert. So kann ein Uebersetzer
   seine Datei testen, bevor er den Pull Request stellt.
   ============================================================ */

const { app, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

/* Repo-Adresse fuer den Sprach-Abgleich. */
const REPO_RAW = 'https://raw.githubusercontent.com/jellystream-app/jellystream/main/language';
const INDEX_URL = `${REPO_RAW}/index.json`;

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // hoechstens einmal taeglich

let builtinDir = null;   // language/ neben der App
let userDir = null;      // vom Nutzer befuellbar
let cacheDir = null;     // von GitHub geladen
let metaPath = null;     // Zeitstempel des letzten Abgleichs

function init() {
  builtinDir = app.isPackaged
    ? path.join(process.resourcesPath, 'language')
    : path.join(__dirname, 'language');

  userDir = path.join(app.getPath('userData'), 'language');
  cacheDir = path.join(app.getPath('userData'), 'languages-cache');
  metaPath = path.join(app.getPath('userData'), 'languages-meta.json');

  [userDir, cacheDir].forEach((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      console.warn('Sprachordner nicht anlegbar:', dir, error.message);
    }
  });

  // Eine Liesmich in den Nutzerordner, damit klar ist, was da hineingehoert
  const readme = path.join(userDir, 'README.txt');
  if (!fs.existsSync(readme)) {
    try {
      fs.writeFileSync(readme, [
        'Eigene Uebersetzungen',
        '=====================',
        '',
        'Lege hier .json-Dateien ab, zum Beispiel en-gb.json oder fr.json.',
        'Sie erscheinen sofort in den Einstellungen unter "Sprache".',
        '',
        'Als Vorlage dient die en.json aus dem Programmordner. Eine Datei',
        'aus diesem Ordner hat Vorrang vor der mitgelieferten Fassung —',
        'so laesst sich eine Uebersetzung testen, bevor sie eingereicht wird.',
        '',
        'Aufbau:',
        '{',
        '  "meta": {',
        '    "code": "en-gb",',
        '    "name": "English (UK)",',
        '    "nativeName": "English (UK)",',
        '    "flag": "\\uD83C\\uDDEC\\uD83C\\uDDE7",',
        '    "author": "Dein Name",',
        '    "authorUrl": "https://github.com/deinname",',
        '    "version": 1',
        '  },',
        '  "strings": { "app.name": "Jellystream" }',
        '}',
        ''
      ].join('\n'));
    } catch (error) {
      /* Die Liesmich ist Beiwerk */
    }
  }
}

/* ------------------------- Lesen ------------------------- */

function readLanguageFile(file, source) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);

    // Ohne Code und Strings ist die Datei unbrauchbar
    if (!data || typeof data !== 'object') return null;
    const meta = data.meta || {};
    const code = String(meta.code || path.basename(file, '.json')).toLowerCase();
    if (!code || !data.strings || typeof data.strings !== 'object') return null;

    return {
      code,
      name: meta.name || code,
      nativeName: meta.nativeName || meta.name || code,
      flag: meta.flag || '',
      author: meta.author || '',
      authorUrl: meta.authorUrl || '',
      /* Nicht `meta.version || 1`: die 0 ist falsy und wuerde zur 1
         hochgestuft — eine veraltete Datei gaelte dann als aktuell und
         wuerde nie ersetzt. Nur eine fehlende Angabe wird zur 1. */
      version: Number.isFinite(meta.version) ? meta.version : 1,
      rtl: Boolean(meta.rtl),
      strings: data.strings,
      source,
      file
    };
  } catch (error) {
    console.warn('Sprachdatei fehlerhaft:', file, error.message);
    return null;
  }
}

function readDir(dir, source, into) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch (error) {
    return;
  }

  entries.forEach((name) => {
    // Der Index ist eine Liste, keine Sprache
    if (name.toLowerCase() === 'index.json') return;
    const lang = readLanguageFile(path.join(dir, name), source);
    if (!lang) return;

    const existing = into.get(lang.code);

    /* Der Nutzerordner gewinnt immer — dort testet jemand seine eigene
       Uebersetzung. Ein Cache-Eintrag darf die mitgelieferte Fassung
       dagegen nur verdraengen, wenn er nicht aelter ist: sonst wuerde
       nach einem App-Update eine veraltete heruntergeladene Datei die
       neuere mitgelieferte ueberdecken. */
    if (existing && source === 'cache' && existing.source === 'builtin') {
      if (lang.version < existing.version) return;
    }

    into.set(lang.code, lang);
  });
}

/** Alle Sprachen, nach Rangfolge zusammengefuehrt. */
function loadAll() {
  const map = new Map();
  readDir(builtinDir, 'builtin', map);
  readDir(cacheDir, 'cache', map);
  readDir(userDir, 'user', map);
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Liste ohne die Strings — fuer die Auswahl in den Einstellungen. */
function list() {
  const all = loadAll();
  const reference = all.find((l) => l.code === 'en');
  const total = reference ? Object.keys(reference.strings).length : 0;

  return all.map((lang) => ({
    code: lang.code,
    name: lang.name,
    nativeName: lang.nativeName,
    flag: lang.flag,
    author: lang.author,
    authorUrl: lang.authorUrl,
    version: lang.version,
    rtl: lang.rtl,
    source: lang.source,
    // Wie vollstaendig gemessen an der englischen Referenz
    translated: Object.keys(lang.strings).length,
    total
  }));
}

/** Strings einer Sprache. */
function get(code) {
  const wanted = String(code || '').toLowerCase();
  const lang = loadAll().find((l) => l.code === wanted);
  return lang ? { meta: { ...lang, strings: undefined }, strings: lang.strings } : null;
}

/* ---------------------- GitHub-Abgleich ---------------------- */

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url });
    const chunks = [];

    request.on('response', (response) => {
      if (response.statusCode >= 400) {
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.on('data', (c) => chunks.push(c));
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error('Antwort ist kein gueltiges JSON'));
        }
      });
      response.on('error', reject);
    });

    request.on('error', reject);
    request.end();
  });
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (error) {
    return { lastCheck: 0 };
  }
}

function writeMeta(meta) {
  try {
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (error) {
    /* nicht schlimm */
  }
}

/**
 * Holt den Index und laedt neue oder neuere Sprachen in den Cache.
 * Scheitert das (offline, Repo umgezogen), bleibt alles beim Alten —
 * die App laeuft mit dem, was schon da ist.
 */
async function sync({ force = false } = {}) {
  const meta = readMeta();
  const age = Date.now() - (meta.lastCheck || 0);

  if (!force && age < CHECK_INTERVAL) {
    return { skipped: true, reason: 'kuerzlich geprueft', added: 0, updated: 0 };
  }

  try {
    const index = await fetchJson(INDEX_URL);
    const entries = Array.isArray(index) ? index : (index.languages || []);

    /* Zwei getrennte Sichten:
       - `active` ist, was die App gerade benutzt (fuer den Nutzer-Vorrang)
       - `cached` ist der Stand der heruntergeladenen Datei

       Beides zu vermischen war ein Fehler: liegt eine veraltete Datei im
       Cache, waehrend eine neuere mitgeliefert ist, meldet `active` die
       hoehere Version — der Abgleich haelt den Cache faelschlich fuer
       aktuell und die veraltete Datei bleibt fuer immer liegen. */
    const active = new Map(loadAll().map((l) => [l.code, l]));
    const cached = new Map();
    readDir(cacheDir, 'cache', cached);

    let added = 0;
    let updated = 0;

    for (const entry of entries) {
      const code = String(entry.code || '').toLowerCase();
      if (!code) continue;

      // Eine eigene Fassung des Nutzers nie ueberschreiben
      if (active.get(code)?.source === 'user') continue;

      const have = cached.get(code);
      const wanted = Number.isFinite(entry.version) ? entry.version : 1;

      // Schon in dieser Version (oder neuer) im Cache? Dann nichts tun.
      if (have && have.version >= wanted) continue;

      // Sonst: nur laden, wenn das Repo wirklich etwas Neueres hat als
      // das, was die App gerade benutzt.
      const inUse = active.get(code);
      if (!have && inUse && inUse.version >= wanted) continue;

      try {
        const data = await fetchJson(`${REPO_RAW}/${encodeURIComponent(code)}.json`);
        if (!data || !data.strings) continue;
        fs.writeFileSync(path.join(cacheDir, `${code}.json`), JSON.stringify(data, null, 2));
        if (have || inUse) updated += 1;
        else added += 1;
      } catch (error) {
        console.warn(`Sprache ${code} nicht ladbar:`, error.message);
      }
    }

    writeMeta({ lastCheck: Date.now() });
    return { skipped: false, added, updated };
  } catch (error) {
    // Kein Netz oder Repo nicht erreichbar — kein Grund fuer eine Fehlermeldung
    writeMeta({ lastCheck: Date.now(), lastError: error.message });
    return { skipped: false, failed: true, error: error.message, added: 0, updated: 0 };
  }
}

function openFolder() {
  try {
    fs.mkdirSync(userDir, { recursive: true });
  } catch (error) {
    /* egal */
  }
  shell.openPath(userDir);
  return userDir;
}

module.exports = {
  init, list, get, sync, openFolder,
  getUserDir: () => userDir,
  getRepoUrl: () => REPO_RAW
};
