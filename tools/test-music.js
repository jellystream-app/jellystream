/**
 * Prüft die Musikbereiche: Interpretenseite, Albumübersicht und die
 * Verbindung zwischen beiden.
 *
 * Der Server wird nachgebildet, damit der Test ohne echte Bibliothek
 * läuft und immer dasselbe liefert.
 *
 * Aufruf:  npx electron tools/test-music.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  /* ---------- Ein Jellyfin, das immer dasselbe antwortet ---------- */

  const ARTIST = {
    Id: 'artist1', Name: 'Testinterpret', Type: 'MusicArtist',
    Overview: 'Eine Biografie, die lang genug ist, um abgeschnitten zu werden.',
    Genres: ['Rock', 'Indie'],
    ImageTags: { Primary: 'p1' }
  };

  const ALBUMS = [
    { Id: 'alb1', Name: 'Erstes Album', Type: 'MusicAlbum', AlbumArtist: 'Testinterpret',
      ProductionYear: 2020, ImageTags: { Primary: 'a1' }, Genres: ['Rock'] },
    { Id: 'alb2', Name: 'Zweites Album', Type: 'MusicAlbum', AlbumArtist: 'Testinterpret',
      ProductionYear: 2023, ImageTags: { Primary: 'a2' } }
  ];

  const TRACKS = [
    { Id: 't1', Name: 'Erster Titel', Type: 'Audio', Artists: ['Testinterpret'],
      Album: 'Erstes Album', RunTimeTicks: 2100000000, IndexNumber: 1 },
    { Id: 't2', Name: 'Zweiter Titel', Type: 'Audio', Artists: ['Testinterpret'],
      Album: 'Erstes Album', RunTimeTicks: 1800000000, IndexNumber: 2 },
    { Id: 't3', Name: 'Dritter Titel', Type: 'Audio', Artists: ['Testinterpret'],
      Album: 'Erstes Album', RunTimeTicks: 2400000000, IndexNumber: 3 }
  ];

  const server = http.createServer((req, res) => {
    const url = req.url;
    const send = (data) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (url.includes('/Items/artist1')) return send(ARTIST);
    if (url.includes('MusicArtist')) return send({ Items: [ARTIST], TotalRecordCount: 1 });
    if (url.includes('IncludeItemTypes=Audio')) return send({ Items: TRACKS, TotalRecordCount: 3 });
    if (url.includes('MusicAlbum')) return send({ Items: ALBUMS, TotalRecordCount: 2 });
    if (url.includes('ParentId=alb1')) return send({ Items: TRACKS, TotalRecordCount: 3 });
    if (url.includes('/Items?')) return send({ Items: TRACKS, TotalRecordCount: 3 });
    send({ Items: [], TotalRecordCount: 0 });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;

  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, c) => require('../languages').get(c));
  ipcMain.handle('downloads:list', () => []);
  ipcMain.handle('downloads:usage', () => ({ bytes: 0, count: 0, dir: '' }));
  require('../languages').init();

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const out = await win.webContents.executeJavaScript(`
    (async () => {
      const o = [];
      const check = (n, ok, d) => o.push({ name: n, ok: Boolean(ok), detail: d || '' });
      const wait = (ms) => new Promise(r => setTimeout(r, ms));

      state.serverUrl = ${JSON.stringify(origin)};
      state.userId = 'u1';
      state.token = 'tok';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(150);

      /* ============ Interpretenseite ============ */

      await showArtist({ Id: 'artist1', Name: 'Testinterpret' });
      await wait(400);

      const root = document.getElementById('view-root');

      check('Interpret: Portrait vorhanden',
        Boolean(root.querySelector('.artist-portrait img')));
      check('Interpret: Name als Überschrift',
        root.querySelector('h2')?.textContent === 'Testinterpret',
        root.querySelector('h2')?.textContent);
      check('Interpret: Biografie wird gezeigt',
        Boolean(root.querySelector('.artist-bio')),
        root.querySelector('.artist-bio')?.textContent.slice(0, 30));
      check('Interpret: Genres in den Fakten',
        (root.querySelector('.hero-facts')?.textContent || '').includes('Rock'),
        root.querySelector('.hero-facts')?.textContent);

      check('Interpret: Abspielen vorhanden', Boolean(document.getElementById('artist-play')));
      check('Interpret: Zufall vorhanden', Boolean(document.getElementById('artist-shuffle')));

      const trackRows = root.querySelectorAll('#artist-tracks .queue-item');
      check('Interpret: beliebte Titel gelistet', trackRows.length === 3,
        trackRows.length + ' Titel');

      // Die Biografie darf die Seite nicht sprengen
      const bio = root.querySelector('.artist-bio');
      if (bio) {
        const clamp = getComputedStyle(bio).webkitLineClamp;
        check('Interpret: Biografie wird begrenzt', clamp && clamp !== 'none', clamp);
      }

      const albumCards = root.querySelectorAll('.grid.squares .card');
      check('Interpret: Alben gelistet', albumCards.length === 2, albumCards.length + ' Alben');

      /* ============ Albumseite ============ */

      await showAlbum(ALBUM_FIXTURE);
      await wait(400);

      check('Album: Cover vorhanden', Boolean(root.querySelector('.detail-poster img')));
      check('Album: Titel als Überschrift',
        root.querySelector('h2')?.textContent === 'Erstes Album',
        root.querySelector('h2')?.textContent);

      const artistLink = document.getElementById('album-artist');
      check('Album: Interpret ist verlinkt', Boolean(artistLink), artistLink?.textContent);

      const facts = root.querySelector('.hero-facts')?.textContent || '';
      check('Album: Jahr in den Fakten', facts.includes('2020'), facts);
      check('Album: Titelzahl in den Fakten', /3/.test(facts), facts);
      // Gesamtlaufzeit: 210+180+240 Sekunden = 10,5 Minuten
      check('Album: Gesamtlaufzeit berechnet', /1[01]/.test(facts), facts);

      const albumTracks = root.querySelectorAll('#track-list .queue-item');
      check('Album: Titel gelistet', albumTracks.length === 3, albumTracks.length + ' Titel');

      check('Album: Nummern werden gezeigt',
        root.querySelector('.queue-num')?.textContent === '1',
        root.querySelector('.queue-num')?.textContent);

      /* ============ Übersetzung ============ */

      await setLanguage('en');
      await showArtist({ Id: 'artist1', Name: 'Testinterpret' });
      await wait(400);
      const headEn = document.querySelector('#artist-body .row-head h3')?.textContent;
      check('Interpret: Überschrift auf Englisch', headEn === 'Popular tracks', headEn);

      await setLanguage('de');
      await showArtist({ Id: 'artist1', Name: 'Testinterpret' });
      await wait(400);
      const headDe = document.querySelector('#artist-body .row-head h3')?.textContent;
      check('Interpret: Überschrift auf Deutsch', headDe === 'Beliebte Titel', headDe);

      return o;
    })()
  `.replace('ALBUM_FIXTURE', JSON.stringify({
    Id: 'alb1', Name: 'Erstes Album', Type: 'MusicAlbum',
    AlbumArtist: 'Testinterpret', ProductionYear: 2020,
    ImageTags: { Primary: 'a1' }, Genres: ['Rock']
  })));

  out.forEach((r) => results.push(r));

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  server.close();
  win.destroy();
  app.exit(failed ? 1 : 0);
});
