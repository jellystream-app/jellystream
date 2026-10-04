/**
 * Prueft den Tresor fuer Zugangsdaten (core/vault.js) und Trakt.
 *
 * Wichtig sind drei Dinge:
 *   1. Mit Bruecke landet kein Token im Klartext in localStorage.
 *   2. Alte Klartext-Eintraege bleiben lesbar — niemand muss sich nach
 *      dem Update neu anmelden.
 *   3. Ohne Bruecke (Tests, Web, mobile) haengt nichts: sendSync ohne
 *      Empfaenger kaeme nie zurueck. Genau das hat beim Bauen eine
 *      Testsuite minutenlang blockiert.
 *
 * Aufruf:  npx electron tools/test-vault.js
 */
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail: detail || '' });

// Dieselben Handler wie in main.js
ipcMain.on('secrets:available', (e) => { e.returnValue = safeStorage.isEncryptionAvailable(); });
ipcMain.on('secrets:encrypt', (e, text) => {
  e.returnValue = safeStorage.encryptString(String(text)).toString('base64');
});
ipcMain.on('secrets:decrypt', (e, b64) => {
  try { e.returnValue = safeStorage.decryptString(Buffer.from(String(b64), 'base64')); }
  catch (error) { e.returnValue = null; }
});

app.disableHardwareAcceleration();

async function open(args) {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      additionalArguments: args
    }
  });
  // Laden scheitert gelegentlich mit ERR_FAILED, waehrend ein anderes
  // Fenster noch Dienste hochfaehrt — einmal nachladen genuegt.
  try {
    await win.loadFile(path.join(ROOT, 'index.html'));
  } catch (error) {
    await win.loadFile(path.join(ROOT, 'index.html'));
  }
  return win;
}

app.whenReady().then(async () => {
  const watchdog = setTimeout(() => {
    console.log('FAIL  Test haengt — sendSync ohne Empfaenger?');
    app.exit(1);
  }, 60000);

  /* --- Ohne Bruecke --- */
  const plain = await open([]);
  const p = await plain.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    vault.setJSON('jf-session', { token: 'abc' });
    return { bridge: Boolean(window.secrets), raw: localStorage.getItem('jf-session'),
             back: vault.getJSON('jf-session')?.token };
  })()`);
  check('Ohne Ankuendigung keine Bruecke', !p.bridge);
  check('Ohne Bruecke wird weiter gespeichert', p.back === 'abc', p.raw);
  plain.hide();

  /* --- Mit Bruecke --- */
  const win = await open(['--jf-secrets']);
  const available = safeStorage.isEncryptionAvailable();
  const r = await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    // Stand vor dem Update: Klartext
    localStorage.setItem('jf-session', JSON.stringify({ serverUrl: 'http://x', token: 'alt-token' }));
    const legacy = vault.getJSON('jf-session');

    vault.setJSON('jf-session', { serverUrl: 'http://x', token: 'neu-token' });
    saveServers([{ serverUrl: 'http://x', userId: 'u', token: 'server-token' }]);

    const out = {
      bridge: Boolean(window.secrets),
      legacy: legacy?.token,
      sessionRaw: localStorage.getItem('jf-session'),
      serversRaw: localStorage.getItem('jf-servers'),
      session: vault.getJSON('jf-session')?.token,
      servers: loadServers()[0]?.token,
      broken: (localStorage.setItem('kaputt', '{"$enc":"bm9wZQ=="}'), vault.getJSON('kaputt', 'leer'))
    };

    /* Trakt: Konfiguration liegt im Tresor, Zuordnung der Kennungen */
    trakt.setConfig(' id ', ' secret ');
    out.traktCfg = trakt.config();
    out.traktRaw = localStorage.getItem('jf-trakt');
    out.traktConfigured = trakt.configured();
    out.traktConnected = trakt.connected();
    out.mapMovie = trakt._toTrakt({ Type: 'Movie', Name: 'M', ProductionYear: 2001, ProviderIds: { Imdb: 'tt1', Tmdb: '5' } });
    out.mapEpisode = trakt._toTrakt({ Type: 'Episode', ProviderIds: { Tvdb: '77' } });
    out.mapNone = trakt._toTrakt({ Type: 'Movie', ProviderIds: {} });
    localStorage.clear();
    return out;
  })()`);

  check('Bruecke vorhanden, wenn angekuendigt', r.bridge);
  check('Alte Klartext-Sitzung bleibt lesbar', r.legacy === 'alt-token');
  check('Sitzung kommt unveraendert zurueck', r.session === 'neu-token');
  check('Serverliste kommt unveraendert zurueck', r.servers === 'server-token');

  if (available) {
    check('Sitzungs-Token nicht im Klartext', !r.sessionRaw.includes('neu-token'), r.sessionRaw.slice(0, 30));
    check('Server-Token nicht im Klartext', !r.serversRaw.includes('server-token'), r.serversRaw.slice(0, 30));
    check('Trakt-Secret nicht im Klartext', !r.traktRaw.includes('secret'), r.traktRaw.slice(0, 30));
  } else {
    check('System ohne Schluesselbund: Klartext als Rueckfall', r.session === 'neu-token', 'safeStorage nicht verfuegbar');
  }

  check('Unlesbarer Umschlag liefert den Rueckfallwert', r.broken === 'leer', JSON.stringify(r.broken));
  check('Trakt-Konfiguration wird getrimmt', r.traktCfg.clientId === 'id' && r.traktCfg.clientSecret === 'secret');
  check('Trakt ist konfiguriert, aber nicht verbunden', r.traktConfigured && !r.traktConnected);
  check('Film wird mit IMDb/TMDb gemeldet',
    r.mapMovie?.kind === 'movies' && r.mapMovie.entry.ids.imdb === 'tt1' && r.mapMovie.entry.ids.tmdb === 5);
  check('Folge wird ueber eigene Kennung gemeldet',
    r.mapEpisode?.kind === 'episodes' && r.mapEpisode.entry.ids.tvdb === 77);
  check('Ohne Kennung wird nichts gemeldet', r.mapNone === null);

  clearTimeout(watchdog);
  results.forEach((x) => console.log(`${x.ok ? 'OK  ' : 'FAIL'}  ${x.name}${x.detail ? '  — ' + x.detail : ''}`));
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  app.exit(failed ? 1 : 0);
});
