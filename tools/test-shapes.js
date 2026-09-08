/**
 * Prueft die Kachelform je Bibliothek.
 *
 * Bisher galt eine Form fuer alles (prefs.cardShape). Jetzt darf jede
 * Bibliothek ihre eigene haben -- Filme hochkant als Poster, Dokus
 * quer mit Szenenbild.
 *
 * Zwei Dinge sind wichtiger als die Wahl selbst:
 *
 *   1. WER NICHTS EINSTELLT, MERKT NICHTS. Der alte, globale Wert
 *      bleibt der Standard. Gespeicherte Einstellungen muessen
 *      unveraendert weitergelten, ohne Umstellung alter Daten.
 *   2. Die PLATZHALTER muessen dieselbe Form haben wie die Kacheln,
 *      die sie ersetzen -- sonst springt das Layout genau dann, wenn
 *      die Daten eintreffen.
 *
 * Aufruf:  npx electron tools/test-shapes.js
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

      /* Vier Bibliotheken, wie sie ein Server liefert. */
      state.libraries = [
        { Id: 'lib-film', Name: 'Filme', CollectionType: 'movies' },
        { Id: 'lib-serie', Name: 'Serien', CollectionType: 'tvshows' },
        { Id: 'lib-doku', Name: 'Dokus', CollectionType: 'tvshows' },
        { Id: 'lib-musik', Name: 'Musik', CollectionType: 'music' },
        { Id: 'lib-tv', Name: 'Live TV', CollectionType: 'livetv' }
      ];

      const savedShape = prefs.cardShape;
      const savedShapes = prefs.cardShapes;

      /* ================================================================
         1. RUECKWAERTSKOMPATIBILITAET -- der wichtigste Punkt
         ================================================================ */

      check('shapeFor() vorhanden', typeof shapeFor === 'function');
      check('libraryIdByType() vorhanden', typeof libraryIdByType === 'function');

      prefs.cardShape = 'wide';
      prefs.cardShapes = {};
      check('Ohne eigene Wahl gilt der allgemeine Wert (quer)',
            shapeFor('lib-film') === 'wide');

      prefs.cardShape = 'poster';
      check('Ohne eigene Wahl gilt der allgemeine Wert (hochkant)',
            shapeFor('lib-film') === 'poster');

      /* Alte gespeicherte Einstellungen haben kein cardShapes-Feld.
         Fehlt es oder ist es null, darf nichts abstuerzen. */
      prefs.cardShapes = undefined;
      check('Fehlendes cardShapes stuerzt nicht ab', shapeFor('lib-film') === 'poster');
      prefs.cardShapes = null;
      check('cardShapes = null stuerzt nicht ab', shapeFor('lib-film') === 'poster');

      check('Ohne Bibliothek gilt der allgemeine Wert', shapeFor(null) === 'poster');
      check('Ohne Bibliothek und ohne Wahl: quer',
            (prefs.cardShape = 'wide', shapeFor(undefined) === 'wide'));

      /* ================================================================
         2. DIE EIGENE WAHL
         ================================================================ */

      prefs.cardShape = 'wide';
      prefs.cardShapes = { 'lib-film': 'poster' };

      check('Eigene Wahl gewinnt', shapeFor('lib-film') === 'poster');
      check('Andere Bibliothek bleibt beim allgemeinen Wert',
            shapeFor('lib-serie') === 'wide');

      prefs.cardShape = 'poster';
      prefs.cardShapes = { 'lib-doku': 'wide' };
      check('Eigene Wahl gewinnt auch umgekehrt', shapeFor('lib-doku') === 'wide');
      check('Der Rest folgt weiter dem allgemeinen Wert',
            shapeFor('lib-film') === 'poster');

      /* Unsinnige Werte duerfen nicht durchschlagen. */
      prefs.cardShapes = { 'lib-film': 'quadratisch-lila' };
      check('Unbekannte Form faellt auf quer zurueck', shapeFor('lib-film') === 'wide');

      /* ================================================================
         3. resolveShape -- was der Aufrufer verlangt, bleibt
         ================================================================ */

      prefs.cardShape = 'wide';
      prefs.cardShapes = { 'lib-film': 'poster' };

      check('Querformat folgt der Bibliothek',
            resolveShape({}, 'wide', 'lib-film') === 'poster');
      check('Quadratisch bleibt quadratisch',
            resolveShape({}, 'square', 'lib-film') === 'square');
      check('Ausdrueckliches Hochkant bleibt',
            resolveShape({}, 'poster', 'lib-doku') === 'poster');

      /* Ohne Bibliothek muss der alte Aufruf weiter stimmen -- es gibt
         Aufrufer mit zwei Argumenten. */
      prefs.cardShape = 'poster';
      check('Aufruf ohne Bibliothek wirkt wie bisher',
            resolveShape({}, 'wide') === 'poster');

      /* ================================================================
         4. REIHEN DER STARTSEITE
         ================================================================ */

      check('Filmbibliothek wird gefunden', libraryIdByType('movies') === 'lib-film');
      check('Erste Serienbibliothek gilt', libraryIdByType('tvshows') === 'lib-serie');
      check('Unbekannter Typ ergibt nichts', libraryIdByType('buecher') === null);

      /* Eine Reihe traegt die Form ihrer Bibliothek. */
      prefs.cardShape = 'wide';
      prefs.cardShapes = { 'lib-film': 'poster' };

      const items = [{ Id: 'i1', Name: 'Ein Film', Type: 'Movie', ImageTags: { Primary: 'x' } }];

      const filmRow = buildRow('Neue Filme', items, { libraryId: 'lib-film' });
      check('Reihe der Filmbibliothek wird hochkant',
            Boolean(filmRow?.querySelector('.card.poster')));

      const serieRow = buildRow('Neue Serien', items, { libraryId: 'lib-serie' });
      check('Reihe der Serienbibliothek bleibt quer',
            !serieRow?.querySelector('.card.poster'));

      /* Gemischte Reihen ("Weiterschauen") gehoeren keiner Bibliothek
         und folgen dem allgemeinen Wert. */
      const mixedRow = buildRow('Weiterschauen', items, {});
      check('Gemischte Reihe folgt dem allgemeinen Wert',
            !mixedRow?.querySelector('.card.poster'));

      prefs.cardShape = 'poster';
      const mixedPoster = buildRow('Weiterschauen', items, {});
      check('Gemischte Reihe folgt ihm auch hochkant',
            Boolean(mixedPoster?.querySelector('.card.poster')));

      /* ================================================================
         5. PLATZHALTER -- kein Layout-Sprung
         ================================================================ */

      prefs.cardShape = 'wide';
      prefs.cardShapes = { 'lib-film': 'poster' };

      const skFilm = skeletonRows(2, 'lib-film');
      check('Platzhalter der Filmbibliothek sind hochkant',
            /sk-card poster/.test(skFilm), skFilm.slice(0, 60));

      const skSerie = skeletonRows(2, 'lib-serie');
      check('Platzhalter der Serienbibliothek sind quer',
            /sk-card wide/.test(skSerie) && !/sk-card poster/.test(skSerie));

      const skPlain = skeletonRows(2);
      check('Platzhalter ohne Bibliothek folgen dem allgemeinen Wert',
            /sk-card wide/.test(skPlain));

      /* Das Raster des Katalogs muss ebenso mitziehen, sonst bleiben
         Luecken zwischen den Kacheln. */
      catalog.shape = 'wide';
      catalog.parentId = 'lib-film';
      check('Rasterbreite folgt der Bibliothek', catalogGridClass() === 'posters');

      catalog.parentId = 'lib-serie';
      check('Rasterbreite bleibt sonst normal', catalogGridClass() === '');

      catalog.shape = 'square';
      check('Quadratisches Raster bleibt', catalogGridClass() === 'squares');
      catalog.shape = 'wide';
      catalog.parentId = null;

      /* ================================================================
         6. DIE EINSTELLUNGSLISTE
         ================================================================ */

      prefs.cardShapes = {};
      renderCardShapeLibraries();
      await wait(120);

      const host = document.getElementById('card-shape-libraries');
      const rows = host.querySelectorAll('.setting-row');
      check('Je Bibliothek eine Zeile', rows.length === 3, rows.length + ' Zeilen');

      const names = Array.from(rows).map((r) => r.querySelector('strong')?.textContent);
      check('Musik fehlt in der Liste', !names.includes('Musik'), names.join(', '));
      check('Live TV fehlt in der Liste', !names.includes('Live TV'), names.join(', '));
      check('Die Bibliotheken stehen da',
            names.includes('Filme') && names.includes('Dokus'), names.join(', '));

      const firstSelect = rows[0].querySelector('select');
      check('Voreinstellung ist "wie oben"', firstSelect.value === '', firstSelect.value);
      check('Drei Moeglichkeiten zur Wahl', firstSelect.options.length === 3);

      /* Eine Wahl treffen: sie muss gespeichert werden. */
      firstSelect.value = 'poster';
      firstSelect.dispatchEvent(new Event('change'));
      await wait(120);
      check('Die Wahl wird gespeichert', prefs.cardShapes['lib-film'] === 'poster',
            JSON.stringify(prefs.cardShapes));

      /* Zurueck auf "wie oben" darf den Wert nicht festschreiben --
         sonst ginge eine spaetere Aenderung der allgemeinen Wahl an
         dieser Bibliothek vorbei. */
      const again = document.getElementById('card-shape-libraries').querySelectorAll('.setting-row')[0].querySelector('select');
      again.value = '';
      again.dispatchEvent(new Event('change'));
      await wait(120);
      check('"Wie oben" loescht den Eintrag',
            prefs.cardShapes['lib-film'] === undefined, JSON.stringify(prefs.cardShapes));

      /* Ohne Bibliotheken keine leere Behauptung. */
      const keep = state.libraries;
      state.libraries = [];
      renderCardShapeLibraries();
      await wait(80);
      check('Ohne Bibliotheken bleibt die Liste leer',
            document.getElementById('card-shape-libraries').children.length === 0);
      state.libraries = keep;

      prefs.cardShape = savedShape;
      prefs.cardShapes = savedShapes || {};

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
