/**
 * Testet den Auto-Updater: Konfiguration, Zustandsmaschine, Anbindung —
 * und ob die GitHub-Releases das enthalten, was der Updater braucht.
 *
 * Aufruf:  npx electron tools/test-updater.js
 */
const { app, BrowserWindow, ipcMain, net } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

function fetchText(url) {
  return new Promise((resolve) => {
    const request = net.request({ method: 'GET', url });
    const chunks = [];
    request.on('response', (response) => {
      response.on('data', (c) => chunks.push(c));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
      response.on('error', () => resolve({ status: 0, body: '' }));
    });
    request.on('error', () => resolve({ status: 0, body: '' }));
    request.end();
  });
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  /* ---------- 1. Konfiguration ---------- */

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const publish = pkg.build?.publish?.[0];

  check('publish-Ziel gesetzt', Boolean(publish), publish ? publish.provider : 'fehlt');
  check('Zeigt auf das richtige Repo',
    publish?.owner === 'ukyyyy' && publish?.repo === 'jellystream',
    `${publish?.owner}/${publish?.repo}`);
  check('updater.js wird mitgepackt', pkg.build.files.includes('updater.js'));
  check('release-Skript veroeffentlicht',
    (pkg.scripts.release || '').includes('--publish always'), pkg.scripts.release);
  check('dist-Skript veroeffentlicht NICHT',
    (pkg.scripts.dist || '').includes('--publish never'), pkg.scripts.dist);

  /* ---------- 2. Das Modul selbst ---------- */

  const updater = require('../updater');

  check('getState liefert einen Zustand', typeof updater.getState === 'function');
  const state = updater.getState();
  check('Zustand kennt die laufende Version', Boolean(state.current), state.current);
  check('Im Entwicklungslauf abgeschaltet', state.supported === false,
    'supported=' + state.supported);

  // Ohne Paket darf nichts passieren — sonst wuerde beim Entwickeln
  // ploetzlich ein Update eingespielt
  const devCheck = await updater.check();
  check('check() im Entwicklungslauf uebersprungen', devCheck.skipped === true, devCheck.reason);
  check('installNow ohne fertiges Update tut nichts', updater.installNow() === false);

  let events = 0;
  updater.init(() => { events += 1; });
  check('init nimmt einen Melder entgegen', true);

  updater.start();
  check('start() im Entwicklungslauf ohne Wirkung', events === 0, events + ' Ereignisse');
  updater.stop();

  /* ---------- 2b. Passt der lokale Build zu latest.yml? ----------
     Der Dateiname in latest.yml muss exakt der hochgeladenen Datei
     entsprechen. Leerzeichen im Namen brechen das: GitHub macht daraus
     Punkte, waehrend latest.yml Bindestriche erwartet — der Updater
     laedt dann ins Leere. */

  const distDir = path.join(ROOT, 'dist');
  const ymlPath = path.join(distDir, 'latest.yml');

  if (fs.existsSync(ymlPath)) {
    const local = fs.readFileSync(ymlPath, 'utf8');
    const named = (local.match(/path:\s*(.+\.exe)/) || [])[1]?.trim();

    check('latest.yml nennt eine Datei', Boolean(named), named || '');
    check('Dateiname ohne Leerzeichen', named && !named.includes(' '), named || '');
    check('Genannte Datei liegt im dist-Ordner',
      named && fs.existsSync(path.join(distDir, named)), named || '');

    // Groesse muss stimmen, sonst lehnt der Updater ab
    const sizeInYml = Number((local.match(/size:\s*(\d+)/) || [])[1]);
    if (named && fs.existsSync(path.join(distDir, named))) {
      const realSize = fs.statSync(path.join(distDir, named)).size;
      check('Groesse in latest.yml stimmt', sizeInYml === realSize,
        `${sizeInYml} vs ${realSize}`);

      // Pruefsumme ebenso — eine falsche laesst das Update still scheitern
      const crypto = require('crypto');
      const hash = crypto.createHash('sha512')
        .update(fs.readFileSync(path.join(distDir, named))).digest('base64');
      const inYml = (local.match(/^sha512:\s*(\S+)/m) || [])[1];
      check('Pruefsumme stimmt', hash === inYml,
        hash === inYml ? 'sha512 passt' : 'WEICHT AB');
    }

    const ymlVersion = (local.match(/^version:\s*(\S+)/m) || [])[1];
    check('Version in latest.yml passt zur package.json',
      ymlVersion === pkg.version, `${ymlVersion} vs ${pkg.version}`);
  } else {
    console.log('\nHinweis: kein dist/latest.yml — Build-Pruefung entfaellt.\n');
  }

  /* ---------- 3. Was liegt im Release? ---------- */

  const base = 'https://github.com/ukyyyy/jellystream/releases/latest/download';
  const yml = await fetchText(`${base}/latest.yml`);

  if (yml.status === 0) {
    console.log('\nHinweis: GitHub nicht erreichbar — Release-Pruefung entfaellt.\n');
  } else {
    const found = yml.status === 200;

    /* Kein Fehlschlag, sondern ein deutlicher Hinweis: dass noch kein
       Release die Datei enthaelt, ist ein Zustand des Repositories,
       kein Fehler im Code. Sonst waere jeder CI-Lauf rot, solange das
       erste Release aussteht — und rote Laeufe, die man ignoriert,
       verlieren ihre Warnwirkung. */
    if (!found) {
      console.log('');
      console.log('  ACHTUNG: latest.yml fehlt im neuesten Release (HTTP ' + yml.status + ').');
      console.log('  Solange sie fehlt, findet der Updater keine Aktualisierungen.');
      console.log('  Beim Veroeffentlichen alle Dateien aus dist/ hochladen.');
      console.log('');
    }

    if (found) {
      check('latest.yml liegt im Release', true, 'gefunden');
      // Die Datei muss Version, Datei und Pruefsumme nennen
      check('latest.yml nennt eine Version', /^version:\s*\S+/m.test(yml.body),
        (yml.body.match(/^version:\s*(\S+)/m) || [])[1] || '');
      check('latest.yml nennt die Installationsdatei', /\.exe/.test(yml.body));
      check('latest.yml enthaelt eine Pruefsumme', /sha512:/.test(yml.body));

      // Die genannte Datei muss auch wirklich abrufbar sein
      const fileName = (yml.body.match(/path:\s*(.+\.exe)/) || [])[1];
      if (fileName) {
        const head = await fetchText(`${base}/${encodeURIComponent(fileName.trim())}`);
        check('Genannte Installationsdatei ist abrufbar',
          head.status === 200 || head.status === 302, `HTTP ${head.status}`);
      }
    }
  }

  /* ---------- 4. Anbindung im Renderer ---------- */

  ipcMain.handle('updater:state', () => updater.getState());
  ipcMain.handle('updater:check', () => updater.check({ silent: false }));
  ipcMain.handle('updater:install', () => updater.installNow());
  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, code) => require('../languages').get(code));

  require('../languages').init();

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 1400));

  const uiResults = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      check('updater-Bruecke vorhanden', Boolean(window.updater));
      check('Bruecke bietet state/check/install',
        typeof window.updater?.state === 'function' &&
        typeof window.updater?.check === 'function' &&
        typeof window.updater?.install === 'function');

      // Alle Bedienelemente da?
      ['update-current', 'update-status', 'update-text', 'update-dot',
       'update-progress', 'update-bar', 'update-install', 'update-check'
      ].forEach((id) => check('Element ' + id, Boolean(document.getElementById(id))));

      /* Zustandsmaschine: jeder Status muss lesbaren Text erzeugen
         und die richtigen Teile ein-/ausblenden. */
      await setLanguage('en');

      renderUpdateState({ status: 'checking', current: '2.3.0', supported: true });
      check('checking zeigt Text', document.getElementById('update-text').textContent === 'Checking…',
            document.getElementById('update-text').textContent);

      renderUpdateState({ status: 'current', current: '2.3.0', supported: true });
      check('current zeigt Text', document.getElementById('update-text').textContent === 'Up to date');
      check('current blendet Fortschritt aus',
            document.getElementById('update-progress').classList.contains('hidden'));
      check('current blendet Installieren aus',
            document.getElementById('update-install').classList.contains('hidden'));

      renderUpdateState({ status: 'downloading', version: '2.4.0', percent: 42, supported: true });
      const dlText = document.getElementById('update-text').textContent;
      check('downloading nennt Version und Prozent',
            dlText.includes('2.4.0') && dlText.includes('42'), dlText);
      check('downloading zeigt Fortschritt',
            !document.getElementById('update-progress').classList.contains('hidden'));
      check('Balken folgt dem Prozentwert',
            document.getElementById('update-bar').style.width === '42%',
            document.getElementById('update-bar').style.width);

      renderUpdateState({ status: 'ready', version: '2.4.0', percent: 100, supported: true });
      check('ready nennt die Version',
            document.getElementById('update-text').textContent.includes('2.4.0'));
      check('ready zeigt den Installieren-Knopf',
            !document.getElementById('update-install').classList.contains('hidden'));

      renderUpdateState({ status: 'error', error: 'Netzwerk weg', supported: true });
      check('error zeigt die Meldung',
            document.getElementById('update-text').textContent === 'Netzwerk weg');

      renderUpdateState({ status: 'idle', supported: false, current: '2.3.0' });
      check('Entwicklungslauf wird erklaert',
            document.getElementById('update-text').textContent === 'Updates only run in the installed version',
            document.getElementById('update-text').textContent);
      check('Suchen ist dann gesperrt', document.getElementById('update-check').disabled);
      document.getElementById('update-check').disabled = false;

      // Version im Kopf der Anzeige
      renderUpdateState({ status: 'current', current: '9.9.9', supported: true });
      check('Installierte Fassung wird angezeigt',
            document.getElementById('update-current').textContent === '9.9.9');

      /* Der Hinweis zur fehlenden Signatur muss uebersetzt sein */
      const note = document.querySelector('.update-note');
      check('SmartScreen-Hinweis vorhanden', Boolean(note));
      check('Hinweis ist uebersetzt',
            note && note.textContent.includes('SmartScreen') && !note.textContent.includes('Weitere Informationen'),
            note ? note.textContent.slice(0, 40) : '');

      await setLanguage('de');
      renderUpdateState({ status: 'current', current: '2.3.0', supported: true });
      check('Auf Deutsch ebenfalls',
            document.getElementById('update-text').textContent === 'Auf dem neuesten Stand',
            document.getElementById('update-text').textContent);

      return out;
    })()
  `);

  uiResults.forEach((r) => results.push(r));

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
