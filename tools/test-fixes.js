/**
 * Prueft zwei Korrekturen:
 *   1. Untertitel werden ueber fetch+Blob geladen (track erzwingt CORS,
 *      Jellyfin schickt keinen erlaubenden Header)
 *   2. Externe Links oeffnen im Standardbrowser, nicht in der App
 *
 * Aufruf:  npx electron tools/test-fixes.js
 */
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* Wartezeiten dehnen sich mit JF_TEST_SLOW — CI-Laeufer brauchen
   laenger, bis eine Seite steht. Ohne die Variable bleibt alles
   wie bisher. */
const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const settle = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));


const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  /* ---------- Testserver: liefert VTT OHNE CORS-Header,
       genau wie Jellyfin es tut ---------- */
  const server = http.createServer((req, res) => {
    if (req.url.includes('/Subtitles/')) {
      // Bewusst KEIN Access-Control-Allow-Origin
      res.writeHead(200, { 'Content-Type': 'text/vtt' });
      return res.end('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nErster Untertitel\n\n' +
        '00:00:05.000 --> 00:00:08.000\nZweiter Untertitel\n');
    }
    if (req.url.includes('/BadSubtitles/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>kein VTT</html>');
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, c) => require('../languages').get(c));
  require('../languages').init();

  /* ---------- Externe Links abfangen ---------- */
  const opened = [];
  const realOpenExternal = shell.openExternal;
  shell.openExternal = (url) => { opened.push(url); return Promise.resolve(); };

  const win = new BrowserWindow({
    width: 1200, height: 800, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  // Dieselbe Behandlung wie in main.js
  const openExternally = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
        return true;
      }
    } catch (error) { /* ungueltig */ }
    return false;
  };

  let windowsOpened = 0;
  win.webContents.setWindowOpenHandler(({ url }) => {
    windowsOpened += 1;
    openExternally(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      openExternally(url);
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await settle(1400);

  const before = BrowserWindow.getAllWindows().length;

  /* --- Klick auf die Badges --- */
  await win.webContents.executeJavaScript(`
    (() => {
      document.getElementById('link-github')?.click();
      document.getElementById('link-kofi')?.click();
      return true;
    })()
  `);
  await settle(600);

  const after = BrowserWindow.getAllWindows().length;

  check('Kein neues App-Fenster', after === before, `${before} -> ${after}`);
  check('GitHub im Browser geoeffnet',
    opened.some((u) => u.includes('github.com/jellystream-app/jellystream')),
    opened.join(', ') || 'nichts geoeffnet');
  check('Ko-fi im Browser geoeffnet',
    opened.some((u) => u.includes('ko-fi.com/jellystream')),
    opened.join(', ') || 'nichts');

  /* --- Gefaehrliche Schemata werden abgelehnt --- */
  opened.length = 0;
  const rejected = [
    openExternally('file:///C:/Windows/System32/calc.exe'),
    openExternally('javascript:alert(1)'),
    openExternally('nicht-mal-eine-url')
  ];
  check('file:// wird abgelehnt', rejected[0] === false);
  check('javascript: wird abgelehnt', rejected[1] === false);
  check('Unsinn wird abgelehnt', rejected[2] === false);
  check('Nichts davon wurde geoeffnet', opened.length === 0, opened.join(', '));

  check('https wird angenommen', openExternally('https://example.com') === true);

  /* ---------- Untertitel ---------- */
  const subResults = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      state.serverUrl = ${JSON.stringify(origin)};
      state.token = 'testtoken';
      state.userId = 'u1';

      vpCurrent.item = { Id: 'movie1', Name: 'Test' };
      vpCurrent.mediaSourceId = 'src1';

      /* Der entscheidende Fall: der Server schickt KEINEN
         CORS-Header. Mit track.src direkt schluege das fehl. */
      await applyTextSubtitle({ Index: 2, Language: 'ger', Codec: 'subrip' });
      await settle(500);

      const tracks = vp.video.querySelectorAll('track');
      check('Spur wurde angehaengt', tracks.length === 1, tracks.length + ' Spuren');
      check('Spur nutzt eine Blob-Adresse',
        tracks[0]?.src.startsWith('blob:'), tracks[0]?.src.slice(0, 30));

      const tt = vp.video.textTracks[0];
      check('Spur ist eingeschaltet', tt?.mode === 'showing', tt?.mode);
      check('Untertitel wurden gelesen', tt?.cues && tt.cues.length === 2,
        tt?.cues ? tt.cues.length + ' Eintraege' : 'keine');

      if (tt?.cues?.length) {
        check('Text stimmt', tt.cues[0].text === 'Erster Untertitel', tt.cues[0].text);
      }

      /* Umschalten: die alte Spur muss verschwinden */
      await applyTextSubtitle({ Index: 3, Language: 'eng', Codec: 'subrip' });
      await settle(400);
      check('Beim Wechsel bleibt nur eine Spur',
        vp.video.querySelectorAll('track').length === 1);

      /* Abschalten */
      await applyTextSubtitle(null);
      check('Abschalten entfernt die Spur',
        vp.video.querySelectorAll('track').length === 0);

      /* Antwort ist kein VTT — darf nicht angehaengt werden */
      const realFetch = window.fetch;
      vpCurrent.mediaSourceId = 'src1';
      window.fetch = (u, o) => realFetch(String(u).replace('/Subtitles/', '/BadSubtitles/'), o);
      await applyTextSubtitle({ Index: 4, Language: 'ger', Codec: 'subrip' });
      await settle(300);
      check('Ungueltige Antwort wird verworfen',
        vp.video.querySelectorAll('track').length === 0);
      window.fetch = realFetch;

      /* Server nicht erreichbar — darf nicht abstuerzen */
      const savedUrl = state.serverUrl;
      state.serverUrl = 'http://127.0.0.1:1';
      let threw = false;
      try {
        await applyTextSubtitle({ Index: 5, Language: 'ger', Codec: 'subrip' });
      } catch (e) { threw = true; }
      check('Fehlschlag wird abgefangen', !threw);
      check('Keine Spur nach Fehlschlag',
        vp.video.querySelectorAll('track').length === 0);
      state.serverUrl = savedUrl;

      /* ====== Bedienbarkeit: der Untertitel-Knopf ======
         Er war im Player unsichtbar, weil er bei leerer Spurliste
         ausgeblendet wurde — dann liess sich nichts einschalten. */
      vpCurrent.item = { Id: 'm', Name: 'Test' };
      vpCurrent.local = false;

      vpCurrent.subtitleStreams = [
        { Index: 1, Language: 'ger', Codec: 'subrip', DisplayTitle: 'Deutsch' },
        { Index: 2, Language: 'eng', Codec: 'subrip', DisplayTitle: 'English' }
      ];
      vpCurrent.audioStreams = [{ Index: 0, Language: 'ger', Codec: 'ac3', IsDefault: true }];
      vpCurrent.subtitleIndex = null;
      buildTrackMenus();

      check('Untertitel-Knopf ist sichtbar',
        !vp.subs.classList.contains('hidden'));

      const entries = vp.subsMenu.querySelectorAll('button');
      check('Menue listet Aus + beide Spuren', entries.length === 3,
        entries.length + ' Eintraege');
      check('Erster Eintrag ist "Aus"',
        entries[0]?.textContent.trim().length > 0, entries[0]?.textContent.trim());
      check('Aus ist zunaechst aktiv', entries[0]?.classList.contains('active'));

      // Eine Spur waehlen
      entries[1]?.click();
      await settle(250);
      check('Auswahl setzt den Index', vpCurrent.subtitleIndex === 1,
        String(vpCurrent.subtitleIndex));

      buildTrackMenus();
      const after = vp.subsMenu.querySelectorAll('button');
      check('Gewaehlte Spur ist markiert', after[1]?.classList.contains('active'));

      // Ohne Spuren bleibt der Knopf verborgen
      vpCurrent.subtitleStreams = [];
      buildTrackMenus();
      check('Ohne Spuren kein Knopf', vp.subs.classList.contains('hidden'));

      vpCurrent.item = null;
      vpCurrent.subtitleIndex = null;
      return out;
    })()
  `);

  subResults.forEach((r) => results.push(r));

  shell.openExternal = realOpenExternal;
  server.close();

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
