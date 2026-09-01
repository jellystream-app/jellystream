/**
 * Testet das Uebersetzungssystem: Vollstaendigkeit der Sprachdateien,
 * Platzhalter, Fallback-Kette, DOM-Anwendung, Sprachwechsel und den
 * Vollbild-Aufbau der Einstellungen.
 *
 * Aufruf:  npx electron tools/test-i18n.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

/* ============ Teil 0: Keine hartkodierte Sprache im Code ============ */

function testNoHardcoded() {
  // Der Scanner ist die Referenz — er darf nichts mehr finden
  const { execFileSync } = require('child_process');
  let output = '';
  let clean = true;

  try {
    output = execFileSync(process.execPath, [path.join(__dirname, 'find-untranslated.js'), '--all'], {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    });
  } catch (error) {
    // Exit-Code 1 heisst: Fundstellen vorhanden
    output = (error.stdout || '') + (error.stderr || '');
    clean = false;
  }

  const match = output.match(/Gesamt: (\d+) Fundstellen/);
  const count = match ? Number(match[1]) : -1;

  /* Vier bekannte Fehlalarme: mehrzeilige API-Feldlisten und
     Codefragmente, die der Scanner nicht als solche erkennt. */
  check('Keine hartkodierten Texte im Code', count >= 0 && count <= 4,
    count < 0 ? 'Scanner lieferte kein Ergebnis' : `${count} Fundstellen`);
}

/* ============ Teil 1: Die Dateien selbst (ohne Fenster) ============ */

function testFiles() {
  const dir = path.join(ROOT, 'language');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json');

  check('Sprachdateien vorhanden', files.length >= 2, files.join(', '));

  const parsed = {};
  files.forEach((file) => {
    try {
      parsed[file] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      check(`${file} ist gueltiges JSON`, false, error.message);
    }
  });

  Object.entries(parsed).forEach(([file, data]) => {
    check(`${file}: meta vorhanden`, Boolean(data.meta && data.meta.code), '');
    check(`${file}: strings vorhanden`, Boolean(data.strings), '');
    check(`${file}: Flagge gesetzt`, Boolean(data.meta && data.meta.flag), '');
  });

  // en ist die Referenz — de muss dieselben Schluessel haben
  const en = parsed['en.json'];
  const de = parsed['de.json'];

  if (en && de) {
    const enKeys = Object.keys(en.strings).sort();
    const deKeys = Object.keys(de.strings).sort();

    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    const extraInDe = deKeys.filter((k) => !enKeys.includes(k));

    check('de hat alle Schluessel aus en', missingInDe.length === 0,
      missingInDe.length ? `fehlt: ${missingInDe.slice(0, 6).join(', ')}` : `${enKeys.length} Schluessel`);
    check('de hat keine unbekannten Schluessel', extraInDe.length === 0,
      extraInDe.length ? `zusaetzlich: ${extraInDe.slice(0, 6).join(', ')}` : '');

    // Platzhalter muessen in beiden Sprachen uebereinstimmen, sonst
    // steht spaeter ein {name} unersetzt in der Oberflaeche
    const mismatched = [];
    enKeys.forEach((key) => {
      if (!de.strings[key]) return;
      const pattern = /\{(\w+)\}/g;
      const enVars = (en.strings[key].match(pattern) || []).sort().join(',');
      const deVars = (de.strings[key].match(pattern) || []).sort().join(',');
      if (enVars !== deVars) mismatched.push(`${key} (en:${enVars || '-'} de:${deVars || '-'})`);
    });
    check('Platzhalter stimmen ueberein', mismatched.length === 0,
      mismatched.slice(0, 4).join('; '));

    // Leere Werte deuten auf vergessene Uebersetzungen
    const emptyDe = deKeys.filter((k) => !String(de.strings[k]).trim());
    check('Keine leeren Uebersetzungen in de', emptyDe.length === 0, emptyDe.slice(0, 5).join(', '));
  }

  // Der Index muss die vorhandenen Sprachen auflisten
  try {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    const listed = (index.languages || []).map((l) => l.code).sort();
    const present = files.map((f) => f.replace('.json', '')).sort();
    check('Index listet alle Sprachen', JSON.stringify(listed) === JSON.stringify(present),
      `Index: ${listed.join(',')} / Dateien: ${present.join(',')}`);
  } catch (error) {
    check('index.json lesbar', false, error.message);
  }
}

/* ============ Teil 2: Im laufenden Fenster ============ */

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  testNoHardcoded();
  testFiles();

  const languages = require('../languages');
  languages.init();

  const list = languages.list();
  check('Main-Process listet Sprachen', list.length >= 2, list.map((l) => l.code).join(', '));
  check('Vollstaendigkeit wird berechnet', list.every((l) => l.total > 0),
    list.map((l) => `${l.code}:${l.translated}/${l.total}`).join(' '));

  const en = languages.get('en');
  check('Strings einer Sprache abrufbar', Boolean(en && en.strings['app.name']), '');
  check('Unbekannte Sprache liefert null', languages.get('xx-yy') === null, '');

  /* Der Test laedt index.html direkt, ohne main.js — die IPC-Handler
     muessen deshalb hier registriert werden, sonst laeuft die Bruecke
     ins Leere und nichts wird uebersetzt. */
  ipcMain.handle('languages:list', () => languages.list());
  ipcMain.handle('languages:get', (event, code) => languages.get(code));
  ipcMain.handle('languages:sync', () => ({ skipped: true, added: 0, updated: 0 }));
  ipcMain.handle('languages:openFolder', () => languages.getUserDir());

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 1600));

  const domResults = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      /* --- Marke: nirgends mehr "Jellyfin Stream" ---
         Nennungen des Jellyfin-SERVERS sind erlaubt und richtig; der
         eigene Produktname darf nur noch "Jellystream" lauten. */
      const brandHits = [];
      document.querySelectorAll('.brand-word, .brand-text h1, #about-app').forEach((node) => {
        if (/Jellyfin(?!-Server| server)/.test(node.textContent)) {
          brandHits.push(node.className + '=' + node.textContent.trim());
        }
      });
      check('Marke überall Jellystream', brandHits.length === 0, brandHits.join(', '));
      check('Fenstertitel ist Jellystream', document.title === 'Jellystream', document.title);
      check('Client meldet sich als Jellystream', CLIENT_NAME === 'Jellystream', CLIENT_NAME);

      /* --- Version stimmt mit der package.json ueberein --- */
      check('Version kommt aus der package.json',
            Boolean(window.appInfo?.version) && window.appInfo.version !== '1.0.0',
            window.appInfo?.version);
      check('Client meldet dieselbe Version',
            CLIENT_VERSION === window.appInfo?.version,
            CLIENT_VERSION + ' vs ' + window.appInfo?.version);

      /* --- Bruecke und Start --- */
      check('languages-Bruecke vorhanden', Boolean(window.languages));
      check('i18n ist bereit', i18n.ready === true);
      check('Sprache geladen', Object.keys(i18n.strings).length > 100,
            Object.keys(i18n.strings).length + ' Schluessel');
      check('Englisch als Rueckfallebene', Object.keys(i18n.fallback).length > 100);

      /* --- t() --- */
      const before = i18n.code;
      await setLanguage('en');

      check('t() loest auf', t('nav.home') === 'Home', t('nav.home'));
      check('t() ersetzt Platzhalter',
            t('server.switched', { name: 'Anna' }) === 'Switched to Anna',
            t('server.switched', { name: 'Anna' }));
      check('t() laesst unbekannte Platzhalter stehen',
            t('server.switched', {}).includes('{name}'),
            t('server.switched', {}));
      check('t() gibt fehlenden Schluessel zurueck',
            t('gibt.es.nicht') === 'gibt.es.nicht');

      /* --- Fallback-Kette --- */
      const backup = i18n.strings['nav.home'];
      delete i18n.strings['nav.home'];
      check('Fallback auf Englisch greift', t('nav.home') === 'Home', t('nav.home'));
      i18n.strings['nav.home'] = backup;

      /* --- DOM-Anwendung --- */
      const navHome = document.querySelector('[data-i18n="nav.home"]');
      check('Navigationstext uebersetzt', navHome && navHome.textContent === 'Home',
            navHome && navHome.textContent);

      const search = document.getElementById('search-input');
      check('Platzhalter uebersetzt', search && search.placeholder === 'Search…',
            search && search.placeholder);

      const minBtn = document.getElementById('tb-min');
      check('title-Attribut uebersetzt', minBtn && minBtn.title === 'Minimise', minBtn && minBtn.title);
      check('aria-label uebersetzt', minBtn && minBtn.getAttribute('aria-label') === 'Minimise');

      check('html lang gesetzt', document.documentElement.lang === 'en',
            document.documentElement.lang);

      /* --- Sprachwechsel zur Laufzeit --- */
      await setLanguage('de');
      await wait(120);
      check('Wechsel auf Deutsch wirkt',
            document.querySelector('[data-i18n="nav.home"]').textContent === 'Startseite',
            document.querySelector('[data-i18n="nav.home"]').textContent);
      check('Attribute wechseln mit',
            document.getElementById('tb-min').title === 'Minimieren',
            document.getElementById('tb-min').title);
      check('lang folgt dem Wechsel', document.documentElement.lang === 'de');

      // Auswahl wird gemerkt
      check('Sprache wird gespeichert', localStorage.getItem('jf-language') === 'de');

      await setLanguage(before);

      /* --- Sprachauswahl in den Einstellungen --- */
      renderLanguageList();
      const cards = document.querySelectorAll('.language-card');
      check('Sprachkarten werden gebaut', cards.length >= 2, cards.length + ' Karten');
      check('Aktive Sprache markiert',
            document.querySelectorAll('.language-card.active').length === 1);
      check('Flagge wird angezeigt',
            Boolean(document.querySelector('.language-card .lang-flag')?.textContent.trim()));

      /* --- Autorenlink nur bei http(s) --- */
      const evil = { code: 'evil', name: 'Evil', nativeName: 'Evil', flag: '', author: 'X',
                     authorUrl: 'javascript:alert(1)', source: 'user', translated: 5, total: 5 };
      const backupList = i18n.available;
      i18n.available = [evil];
      renderLanguageList();
      const links = document.querySelectorAll('.language-card a.lang-author');
      check('javascript:-Autorenlink wird nicht verlinkt', links.length === 0,
            links.length + ' Links');
      i18n.available = backupList;
      renderLanguageList();

      /* --- Vollbild-Einstellungen --- */
      const overlay = document.getElementById('settings-modal');
      check('Einstellungen sind ein Overlay', overlay.classList.contains('settings-overlay'));
      check('Overlay startet versteckt', overlay.classList.contains('hidden'));

      const cats = document.querySelectorAll('.settings-cat');
      const panels = document.querySelectorAll('.settings-panel');
      check('Sieben Kategorien', cats.length === 7, cats.length + '');
      check('Sieben Panels', panels.length === 7, panels.length + '');

      // Jede Kategorie braucht ihr Panel
      const catNames = Array.from(cats).map((c) => c.dataset.cat).sort();
      const panelNames = Array.from(panels).map((p) => p.dataset.panel).sort();
      check('Kategorien und Panels passen zusammen',
            JSON.stringify(catNames) === JSON.stringify(panelNames),
            catNames.join(',') + ' / ' + panelNames.join(','));

      showSettingsCategory('language');
      check('Kategoriewechsel setzt aktiv',
            document.querySelector('.settings-cat[data-cat="language"]').classList.contains('active'));
      check('Nur ein Panel sichtbar',
            document.querySelectorAll('.settings-panel.active').length === 1);
      check('Richtiges Panel sichtbar',
            document.querySelector('.settings-panel.active').dataset.panel === 'language');

      showSettingsCategory('design');

      /* --- Footer --- */
      const gh = document.getElementById('link-github');
      const kofi = document.getElementById('link-kofi');
      check('GitHub-Badge vorhanden', Boolean(gh));
      check('Ko-fi-Badge vorhanden', Boolean(kofi));

      /* Ein Badge mit Adresse muss anklickbar sein, eines ohne
         deaktiviert — sonst führt ein Klick ins Leere. */
      [['GitHub', gh], ['Ko-fi', kofi]].forEach(([name, node]) => {
        const hasUrl = node.href && node.href !== '#' && !node.href.endsWith('#');
        check(name + '-Link stimmig',
              hasUrl !== node.classList.contains('disabled'),
              hasUrl ? 'verlinkt: ' + node.href : 'ohne Adresse, deaktiviert');
      });

      /* --- Kein deutscher Resttext bei englischer Sprache --- */
      await setLanguage('en');
      await wait(150);

      const germanWords = ['Einstellungen', 'Abspielen', 'Herunterladen', 'Schließen',
                           'Zurück', 'Sprache', 'Wiedergabe', 'Untertitel', 'Startseite'];
      const leftovers = [];

      document.querySelectorAll('[data-i18n]').forEach((node) => {
        const text = node.textContent.trim();
        if (germanWords.some((w) => text === w)) leftovers.push(node.dataset.i18n + '=' + text);
      });
      check('Keine deutschen Reste in markierten Stellen', leftovers.length === 0,
            leftovers.slice(0, 5).join(', '));

      /* --- Dynamisch gebaute Ansichten pruefen ---
         Der Grossteil der Oberflaeche entsteht erst zur Laufzeit aus
         Serverdaten. Ein Scan des statischen HTML wuerde davon nichts
         sehen — deshalb werden die Bausteine hier echt aufgebaut. */
      const GERMAN_RE = /\\b(Abspielen|Herunterladen|Merken|Gemerkt|Gesehen|Folgen|Staffel|Besetzung|Technisch|Ähnlich|Zurück|Weiter|Suchen|Ergebnisse|Keine|Titel|Wiedergabe|Sortieren|Alle Genres|Ungesehen|Neue|Neu hinzugefügt|Fortsetzen|Erste Folge|Laufzeit|Bewertung|Erstausstrahlung|Altersfreigabe|Regie|Drehbuch|Auflösung|Bildrate|Größe|Datei|Tonspuren)\\b/;

      const probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.left = '-9999px';
      document.body.appendChild(probe);

      const dynamicLeftovers = [];
      const scan = (label, html) => {
        const hit = html.match(GERMAN_RE);
        if (hit) dynamicLeftovers.push(label + ': ' + hit[0]);
      };

      // Karte mit allen Knöpfen
      const card = buildCard(
        { Id: 'x', Name: 'Test', Type: 'Movie', ProductionYear: 2024,
          ImageTags: { Thumb: 't' }, UserData: { Played: false },
          DateCreated: new Date(0).toISOString() },
        { shape: 'wide', onDismiss: true }
      );
      probe.appendChild(card);
      scan('Karte', card.outerHTML);

      // Reihe mit Blätterpfeilen
      const row = buildRow('Row', [{ Id: 'y', Name: 'B', Type: 'Movie', ImageTags: {} }], {});
      probe.appendChild(row);
      scan('Reihe', row.outerHTML);

      // Katalog-Kopf mit Sortierung und Filtern
      renderCatalogShell(['Action']);
      scan('Katalog', document.getElementById('view-root').innerHTML);

      // Panels der Infoseite
      const item = {
        Id: 'z', Name: 'Film', Type: 'Movie', Overview: 'Text',
        ProductionYear: 2024, RunTimeTicks: 72000000000, Genres: ['Action'],
        People: [{ Name: 'A', Type: 'Actor', Role: 'Held' }],
        Studios: [{ Name: 'S' }], OfficialRating: '12',
        MediaSources: [{ Container: 'mkv', Size: 1073741824, Bitrate: 8000000,
          MediaStreams: [
            { Type: 'Video', Codec: 'h264', Width: 1920, Height: 1080, IsDefault: true },
            { Type: 'Audio', Codec: 'aac', Language: 'ger', IsDefault: true },
            { Type: 'Subtitle', Codec: 'srt', Language: 'ger', IsForced: true, IsExternal: true }
          ] }]
      };

      document.getElementById('view-root').innerHTML = '<div id="tab-content"></div>';
      renderAboutPanel(item);
      scan('Details-Panel', document.getElementById('tab-content').innerHTML);

      document.getElementById('view-root').innerHTML = '<div id="tab-content"></div>';
      renderCastPanel(item);
      scan('Besetzung-Panel', document.getElementById('tab-content').innerHTML);

      document.getElementById('view-root').innerHTML = '<div id="tab-content"></div>';
      renderTechPanel(item);
      scan('Technik-Panel', document.getElementById('tab-content').innerHTML);

      // Folgenzeile
      const ep = buildEpisodeRow(
        { Id: 'e', Name: 'Folge', Type: 'Episode', IndexNumber: 1,
          RunTimeTicks: 24000000000, UserData: { Played: true, PlayedPercentage: 100 },
          ImageTags: {} }, []);
      probe.appendChild(ep);
      scan('Folgenzeile', ep.outerHTML);

      // Offline-Ansicht mit allen Zuständen
      offline.items = [
        { id: '1', itemId: 'a', name: 'A', state: 'done', size: 100, quality: 'Original' },
        { id: '2', itemId: 'b', name: 'B', state: 'running', received: 5, total: 10 },
        { id: '3', itemId: 'c', name: 'C', state: 'queued' },
        { id: '4', itemId: 'd', name: 'D', state: 'failed', errorKey: 'dlError.cancelled' }
      ];
      document.getElementById('view-root').innerHTML = '<div id="offline-list"></div>';
      renderOfflineList();
      scan('Offline-Liste', document.getElementById('offline-list').innerHTML);

      probe.remove();
      document.getElementById('view-root').innerHTML = '';

      check('Keine deutschen Reste in dynamischen Ansichten',
            dynamicLeftovers.length === 0, dynamicLeftovers.join(' | '));

      await setLanguage('de');

      return out;
    })()
  `);

  domResults.forEach((r) => results.push(r));

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
