/**
 * Lädt www/ so, wie die Android-App es tut: über einen Webserver,
 * ohne Electron-Brücken. Das ist der Zustand auf dem Gerät.
 *
 * Aufruf:  npx electron tools/test-www.js
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  /* Ein Server, der www/ ausliefert — und meldet, was angefragt
     wurde. So fällt auf, wenn eine Datei fehlt. */
  const requested = [];
  const missing = [];

  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
    const file = path.join(WWW, rel);
    requested.push(rel);

    if (!file.startsWith(WWW) || !fs.existsSync(file)) {
      missing.push(rel);
      res.writeHead(404);
      return res.end('not found');
    }

    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  /* KEIN Preload: auf dem Gerät gibt es keine Electron-Brücken.
     Genau das muss die App aushalten. */
  const win = new BrowserWindow({
    width: 390, height: 844, show: false,
    webPreferences: { contextIsolation: true, sandbox: false }
  });

  const errors = [];
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) errors.push(message.slice(0, 120));
  });

  await win.loadURL(base);
  await new Promise((r) => setTimeout(r, 2000));

  check('Seite lädt', true);
  check('Keine fehlenden Dateien', missing.length === 0, missing.join(', '));
  check('Keine Konsolenfehler', errors.length === 0, errors.slice(0, 2).join(' | '));

  const state = await win.webContents.executeJavaScript(`
    (() => ({
      // Läuft die App ohne Electron-Brücken?
      hasElectronBridges: Boolean(window.downloads || window.updater || window.windowControls),
      loginVisible: !document.getElementById('login-screen').classList.contains('hidden'),
      coreLoaded: typeof api === 'function' && typeof t === 'function' &&
                  typeof buildDeviceProfile === 'function',
      uiLoaded: typeof playVideo === 'function' && typeof buildCard === 'function',
      // Sprachen ohne Brücke: der Fallback muss greifen
      i18nReady: typeof i18n === 'object' && i18n.ready === true,
      stringsLoaded: typeof i18n === 'object' ? Object.keys(i18n.strings || {}).length : 0,
      // Die Oberfläche darf nicht bei den Schlüsseln stehen bleiben
      loginText: document.querySelector('[data-i18n="login.welcome"]')?.textContent || '',
      tabCount: document.querySelectorAll('.m-tab').length
    }))()
  `);

  check('Läuft ohne Electron-Brücken', !state.hasElectronBridges);
  check('Anmeldung wird gezeigt', state.loginVisible);
  check('Kern geladen', state.coreLoaded);
  check('Oberfläche geladen', state.uiLoaded);
  check('Navigation vollständig', state.tabCount === 5, state.tabCount + ' Reiter');

  /* Ohne die languages-Brücke kann die App die Sprachen nicht über
     IPC holen — sie muss sie per fetch laden. Sonst stünden auf dem
     Gerät nur die Schlüssel statt der Texte. */
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
  if (requested.length) console.log(`\nAngefragt: ${requested.length} Dateien`);

  server.close();
  win.destroy();
  app.exit(failed ? 1 : 0);
});
