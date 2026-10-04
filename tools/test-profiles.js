/**
 * Prueft die Profilauswahl ("Wer schaut?") auf dem Anmeldebildschirm.
 *
 *   - Ohne Konten und ohne oeffentliche Benutzer bleibt sie unsichtbar
 *   - Oeffentliche Benutzer des Servers erscheinen mit Bild
 *   - Ein gespeichertes Konto erscheint nur einmal, nicht doppelt
 *   - Klick auf ein Konto mit gueltigem Token meldet sofort an
 *   - Abgelaufenes Token: Formular steht mit Server und Namen bereit
 *   - Konto ohne Passwort meldet ohne Passwortfeld an
 *
 * Aufruf:  npx electron tools/test-profiles.js
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push(`${req.method} ${req.url}`);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
      'Content-Type': 'application/json'
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const auth = req.headers.authorization || req.headers['x-emby-authorization'] || '';

    if (req.url.startsWith('/System/Info/Public')) {
      res.writeHead(200, cors); return res.end(JSON.stringify({ ServerName: 'Testserver' }));
    }
    if (req.url === '/Users/Public') {
      res.writeHead(200, cors);
      return res.end(JSON.stringify([
        { Id: 'u-anna', Name: 'Anna', HasPassword: true, PrimaryImageTag: 'tag1' },
        { Id: 'u-kind', Name: 'Kind', HasPassword: false },
        { Id: 'u-jason', Name: 'Jason', HasPassword: true }
      ]));
    }
    if (req.url === '/Users/AuthenticateByName' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const { Username, Pw } = JSON.parse(body || '{}');
        if (Username === 'Kind' && Pw === '') {
          res.writeHead(200, cors);
          return res.end(JSON.stringify({ AccessToken: 'tok-kind', User: { Id: 'u-kind', Name: 'Kind' } }));
        }
        res.writeHead(401, cors); res.end();
      });
      return;
    }
    if (req.url.startsWith('/Users/u-jason')) {
      // Gueltig nur mit dem gespeicherten Token
      if (auth.includes('tok-jason')) { res.writeHead(200, cors); return res.end(JSON.stringify({ Id: 'u-jason', Name: 'Jason' })); }
      res.writeHead(401, cors); return res.end();
    }
    if (req.url.startsWith('/Users/u-kind')) {
      res.writeHead(200, cors); return res.end(JSON.stringify({ Id: 'u-kind', Name: 'Kind' }));
    }
    res.writeHead(200, cors);
    res.end(JSON.stringify({ Items: [], TotalRecordCount: 0 }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const win = new BrowserWindow({
    width: 1200, height: 860, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 800));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(30); } return false; };
      const ORIGIN = ${JSON.stringify(origin)};

      // Die App selbst nicht hochfahren — nur pruefen, dass sie es wuerde
      let entered = 0;
      enterApp = async () => { entered += 1; };

      localStorage.clear();
      profiles.loadedFor = '';
      $('server-url').value = 'http://127.0.0.1:1';  // nichts da
      showProfilePicker();
      await wait(400);
      check('Ohne Konten und Server unsichtbar', $('profile-picker').classList.contains('hidden'));

      /* Gespeichert: Jason (gueltiges Token) — auf dem Server ebenfalls oeffentlich */
      saveServers([{ serverUrl: ORIGIN, serverName: 'Testserver', userId: 'u-jason', username: 'Jason', token: 'tok-jason' }]);
      $('server-url').value = ORIGIN;
      showProfilePicker();
      await until(() => document.querySelectorAll('.profile-tile').length >= 3);

      const names = [...document.querySelectorAll('.profile-tile strong')].map((n) => n.textContent);
      check('Sichtbar mit Konten', !$('profile-picker').classList.contains('hidden'));
      check('Gespeichertes Konto steht vorn', names[0] === 'Jason', names.join(', '));
      check('Kein Konto doppelt', names.filter((n) => n === 'Jason').length === 1, names.join(', '));
      check('Oeffentliche Benutzer erscheinen', names.includes('Anna') && names.includes('Kind'), names.join(', '));
      const annaImg = [...document.querySelectorAll('.profile-tile')].find((b) => b.textContent.includes('Anna'))?.querySelector('img');
      check('Profilbild vom Server', annaImg?.src.includes('/Users/u-anna/Images/Primary'), annaImg?.src);
      check('Kacheln sind beschriftet', document.querySelector('.profile-tile').getAttribute('aria-label') === t('profiles.signInAs', { name: 'Jason' }));

      /* Gespeichertes Konto: sofort hinein */
      document.querySelector('.profile-tile').click();
      await until(() => entered === 1);
      check('Gespeichertes Konto meldet sofort an', entered === 1 && state.token === 'tok-jason');
      check('Sitzung wird gemerkt', vault.getJSON('jf-session')?.userId === 'u-jason');

      /* Abgelaufen */
      state.token = '';
      saveServers([{ serverUrl: ORIGIN, userId: 'u-jason', username: 'Jason', token: 'abgelaufen' }]);
      renderProfilePicker();
      document.querySelector('.profile-tile').click();
      await until(() => $('auth-error').textContent.length > 0);
      check('Abgelaufenes Token: kein Eintritt', entered === 1);
      check('Formular ist vorbereitet', $('username').value === 'Jason' && $('server-url').value === ORIGIN);
      check('Passwortfeld hat den Fokus', document.activeElement === $('password'));

      /* Oeffentlicher Benutzer mit Passwort */
      [...document.querySelectorAll('.profile-tile')].find((b) => b.textContent.includes('Anna')).click();
      check('Mit Passwort: Name eingetragen, Fokus im Passwort',
        $('username').value === 'Anna' && document.activeElement === $('password'));
      check('Mit Passwort: noch nicht angemeldet', entered === 1);

      /* Ohne Passwort */
      [...document.querySelectorAll('.profile-tile')].find((b) => b.textContent.includes('Kind')).click();
      await until(() => entered === 2, 4000);
      check('Ohne Passwort: direkt angemeldet', entered === 2 && state.userId === 'u-kind', $('auth-error').textContent);
      check('Passwortfeld bleibt danach Pflicht', $('password').hasAttribute('required'));

      localStorage.clear();
      return out;
    })()
  `);

  results.forEach((r) => console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  server.close();
  app.exit(failed ? 1 : 0);
});
