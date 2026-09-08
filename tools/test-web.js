/**
 * Lädt web/ so, wie ein Browser es tut: über einen Webserver,
 * ohne Electron-Brücken. Das ist der Zustand beim Hosten.
 *
 * Aufruf:  npx electron tools/test-web.js
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const requested = [];
  const missing = [];

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
    const file = path.join(WEB, rel);
    requested.push(rel);

    if (!file.startsWith(WEB) || !fs.existsSync(file)) {
      missing.push(rel);
      res.writeHead(404);
      return res.end('not found');
    }

    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  /* KEIN Preload: im Browser gibt es keine Electron-Brücken.
     Genau das muss die Seite aushalten. */
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { contextIsolation: true, sandbox: false }
  });

  const errors = [];
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) errors.push(message.slice(0, 160));
  });

  await win.loadURL(base);

  /* Auf Bereitschaft warten, nicht auf die Uhr: die Sprachdateien
     kommen per fetch: eine feste Wartezeit besteht auf einem schnellen
     Rechner und faellt auf einem langsamen durch — ein Test, der mal
     so und mal so ausgeht, ist wertlos. */
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    ready = await win.webContents.executeJavaScript(
      `Boolean(typeof i18n === 'object' && i18n.ready)`
    ).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  check('Seite lädt', true);
  check('Wird startbereit', ready, ready ? '' : 'i18n.ready blieb aus (15s)');
  check('Keine fehlenden Dateien', missing.length === 0, missing.join(', '));
  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 2).join(' | '));

  const state = await win.webContents.executeJavaScript(`
    (() => {
      const tb = document.getElementById('titlebar');
      return {
        // Die Seite muss ohne die Electron-Brücken auskommen
        hasElectronBridges: Boolean(window.downloads || window.updater ||
                                    window.windowControls || window.languages || window.discord),
        // appInfo dagegen MUSS es geben: renderer.js liest es beim Laden
        hasAppInfo: Boolean(window.appInfo && window.appInfo.version),
        platform: window.appInfo ? window.appInfo.platform : '',
        loginVisible: !document.getElementById('login-screen').classList.contains('hidden'),
        coreLoaded: typeof api === 'function' && typeof t === 'function' &&
                    typeof buildDeviceProfile === 'function',
        uiLoaded: typeof playVideo === 'function' && typeof buildCard === 'function',
        i18nReady: typeof i18n === 'object' && i18n.ready === true,
        stringsLoaded: typeof i18n === 'object' ? Object.keys(i18n.strings || {}).length : 0,
        loginText: document.querySelector('[data-i18n="login.welcome"]')?.textContent || '',
        // Die Titelleiste hat im Browser nichts zu steuern
        titlebarHidden: !tb || getComputedStyle(tb).display === 'none',
        // Ohne sie darf oben kein leerer Streifen bleiben
        tbHeight: getComputedStyle(document.documentElement)
                    .getPropertyValue('--tb-height').trim(),
        versionShown: document.getElementById('login-version')?.textContent || '',
        // Das Logo muss wirklich ankommen, nicht nur im HTML stehen
        logoOk: (() => {
          const img = document.querySelector('.login-logo');
          return Boolean(img && img.complete && img.naturalWidth > 0);
        })()
      };
    })()
  `);

  check('Läuft ohne Electron-Brücken', !state.hasElectronBridges);
  check('appInfo vorhanden', state.hasAppInfo, state.platform);
  check('Plattform ist "web"', state.platform === 'web', state.platform);
  check('Anmeldung wird gezeigt', state.loginVisible);
  check('Kern geladen', state.coreLoaded);
  check('Oberfläche geladen', state.uiLoaded);
  check('Titelleiste ausgeblendet', state.titlebarHidden);
  check('Kein Leerstreifen oben', state.tbHeight === '0px', state.tbHeight);
  check('Logo geladen', state.logoOk);
  check('Version wird angezeigt', /^v\d/.test(state.versionShown), state.versionShown);

  check('Übersetzungen geladen', state.stringsLoaded > 100,
    state.stringsLoaded + ' Schlüssel');
  check('Oberfläche zeigt Text, nicht Schlüssel',
    state.loginText && !state.loginText.includes('login.'),
    state.loginText);

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  if (requested.length) console.log(`Angefragt: ${requested.length} Dateien`);

  server.close();
  win.destroy();
  app.exit(failed ? 1 : 0);
});
