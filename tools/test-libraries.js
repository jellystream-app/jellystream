/**
 * Prueft, dass jede Bibliothek ihre Inhalte auch wiedergibt.
 *
 * Der Anlass: showLibrary() fragte jede Bibliothek mit
 * `IncludeItemTypes=Movie,Series` ab — die einzige Unterscheidung war
 * Musik. Wer in Jellyfin "Hoerbuecher", "Fotos", "Heimvideos" oder eine
 * gemischte Bibliothek angelegt hatte, sah den Ordner in der Leiste,
 * klickte darauf und bekam eine leere Seite. Der Ordner wurde erkannt,
 * nur nicht wiedergegeben.
 *
 * Der Kern des Tests ist der UNBEKANNTE Typ: dort darf kein Filter
 * gesetzt werden. Wuerde hier wieder geraten, waere genau der Fehler
 * zurueck — nur mit einer anderen Liste von Typen.
 *
 * Aufruf:  npx electron tools/test-libraries.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const settle = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));

const ROOT = path.join(__dirname, '..');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await settle(1000);

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      /* ================================================================
         1. DIE ZUORDNUNG — welcher Ordner liefert welche Typen
         ================================================================ */

      check('libraryKind() vorhanden', typeof libraryKind === 'function');
      check('isLiveTvLibrary() vorhanden', typeof isLiveTvLibrary === 'function');

      /* Die bekannten Typen muessen ihre Inhalte treffen. Ein Ordner
         vom Typ "books" mit IncludeItemTypes=Movie,Series ist leer,
         obwohl er voll ist — das war der Fehler. */
      const expected = {
        movies: 'Movie,BoxSet',
        tvshows: 'Series',
        music: 'MusicAlbum',
        musicvideos: 'MusicVideo',
        books: 'Book,AudioBook',
        photos: 'Photo,PhotoAlbum',
        homevideos: 'Video,Photo,PhotoAlbum',
        boxsets: 'BoxSet',
        playlists: 'Playlist'
      };

      for (const [type, types] of Object.entries(expected)) {
        const kind = libraryKind({ CollectionType: type });
        check('Typ ' + type + ' fragt ' + types + ' ab', kind.types === types,
              'ist: ' + kind.types);
      }

      /* Der wichtigste Fall. Unbekannt, leer, gemischt oder etwas, das
         es heute noch nicht gibt: KEIN Filter. Dann liefert der Server,
         was im Ordner liegt. */
      const openCases = ['', 'mixed', 'irgendwasneues', 'folders', undefined, null];
      let allOpen = true;
      let openDetail = '';
      for (const type of openCases) {
        const kind = libraryKind({ CollectionType: type });
        if (kind.types !== null) {
          allOpen = false;
          openDetail += String(type) + ' -> ' + kind.types + ' ';
        }
      }
      check('Unbekannter Typ setzt KEINEN Filter', allOpen, openDetail);

      /* Gross-/Kleinschreibung: Jellyfins CollectionType ist klein,
         aber darauf zu bauen waere unnoetig sproede. */
      check('Grossschreibung wird erkannt',
            libraryKind({ CollectionType: 'TVSHOWS' }).types === 'Series');
      check('Leerzeichen werden erkannt',
            libraryKind({ CollectionType: ' music ' }).types === 'MusicAlbum');

      /* Fehlendes Objekt darf nicht werfen — loadLibraries() bekommt,
         was der Server schickt. */
      let threw = false;
      try { libraryKind(undefined); libraryKind({}); } catch (e) { threw = true; }
      check('Kein Absturz ohne Bibliothek', !threw);

      /* Live TV hat keine abfragbaren Items — Kanaele kommen ueber
         /LiveTv/Channels, nicht ueber /Items. */
      check('Live TV wird als solches erkannt',
            isLiveTvLibrary({ CollectionType: 'livetv' }) === true);
      check('Filme sind kein Live TV',
            isLiveTvLibrary({ CollectionType: 'movies' }) === false);

      /* ================================================================
         2. DIE ABFRAGE — kommt der Filter wirklich nicht mit?
         ================================================================ */

      /* catalogQuery() baut die Adresse. Ein leerer String oder ein
         "null" im Parameter wuerde ALLES herausfiltern — dann waere die
         Seite wieder leer, nur aus einem anderen Grund. */
      catalog.types = null;
      catalog.parentId = 'lib-1';
      catalog.sort = 'SortName-Ascending';
      catalog.filter = '';
      catalog.genre = '';
      const openQuery = catalogQuery(0);

      check('Ohne Typ: kein IncludeItemTypes in der Adresse',
            !/IncludeItemTypes/.test(openQuery), openQuery.slice(0, 150));
      check('Ohne Typ: kein "null" in der Adresse',
            !/null/.test(openQuery), openQuery.slice(0, 150));
      check('Ohne Typ: ParentId bleibt erhalten',
            /ParentId=lib-1/.test(openQuery));

      catalog.types = 'Book,AudioBook';
      const bookQuery = catalogQuery(0);
      check('Mit Typ: IncludeItemTypes steht in der Adresse',
            /IncludeItemTypes=Book%2CAudioBook/.test(bookQuery),
            bookQuery.slice(0, 150));

      /* ================================================================
         3. DIE BIBLIOTHEKEN HOLEN — auf dem gueltigen Pfad
         ================================================================ */

      /* /Users/{id}/Views ist in Jellyfin 10.10 als veraltet markiert
         und aus der API-Beschreibung ausgeblendet. Es antwortet noch,
         aber darauf zu bauen verschiebt das Problem nur. */
      let askedPath = '';
      const realApi = window.api || api;
      const spy = (path) => { askedPath = path; return Promise.resolve({ Items: [] }); };

      /* api ist eine Funktion im gemeinsamen Gueltigkeitsbereich —
         ueber eine Zuweisung laesst sie sich fuer den Test ersetzen. */
      try {
        // eslint-disable-next-line no-global-assign
        api = spy;
        await loadLibraries();
      } finally {
        api = realApi;
      }

      check('Bibliotheken kommen von /UserViews',
            /^\\/UserViews\\?userId=/.test(askedPath), askedPath || '(nichts gefragt)');
      check('Nicht der veraltete /Views-Pfad',
            !/\\/Views/.test(askedPath), askedPath);

      /* ================================================================
         4. KEIN RUECKSCHRITT — die Einstellung des Nutzers gilt weiter
         ================================================================ */

      /* Ob Filme hochkant oder quer erscheinen, entscheidet die
         Einstellung. showLibrary() darf das nicht vorwegnehmen —
         sonst waere prefs.cardShape stillschweigend uebergangen. */
      const before = prefs.cardShape;
      prefs.cardShape = 'poster';
      check('Poster-Einstellung wirkt auf Querformat-Reihen',
            resolveShape({}, 'wide') === 'poster');
      prefs.cardShape = 'wide';
      check('Quer-Einstellung wirkt',
            resolveShape({}, 'wide') === 'wide');
      check('Quadratisch bleibt unangetastet',
            resolveShape({}, 'square') === 'square');
      prefs.cardShape = before;

      return out;
    })()
  `);

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
