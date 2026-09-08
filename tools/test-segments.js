/**
 * Prueft "Intro ueberspringen" und den frueheren Abspann-Hinweis.
 *
 * Die Marken liefert das Jellyfin-Plugin "Intro Skipper"; seit 10.10
 * gibt der Server sie ueber /MediaSegments heraus, sodass jeder Client
 * sie nutzen kann.
 *
 * Zwei Punkte sind wichtiger als der Knopf selbst:
 *
 *   1. OHNE Plugin (404, leere Antwort, alter Server) darf nichts
 *      passieren -- kein Knopf, keine Fehlermeldung. Der Aufruf ist
 *      gleichzeitig die Erkennung, ob es die Funktion gibt.
 *   2. Die Marken der VORIGEN Folge duerfen nicht stehen bleiben,
 *      sonst zeigt der Knopf beim naechsten Titel an falscher Stelle.
 *
 * Aufruf:  npx electron tools/test-segments.js
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

      const TICKS = 10000000;

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';
      state.token = 'tok';

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      const realApi = api;

      /* ================================================================
         1. DIE ABFRAGE
         ================================================================ */

      check('fetchMediaSegments() vorhanden', typeof fetchMediaSegments === 'function');
      check('Knopf im Markup', Boolean(document.getElementById('vp-skip')));

      let askedPath = '';
      api = (p) => {
        askedPath = p;
        return Promise.resolve({ Items: [
          { Type: 'Intro', StartTicks: 30 * TICKS, EndTicks: 60 * TICKS },
          { Type: 'Outro', StartTicks: 1200 * TICKS, EndTicks: 1260 * TICKS }
        ] });
      };

      let seg = await fetchMediaSegments('item-1');

      check('Fragt /MediaSegments', /^\\/MediaSegments\\/item-1/.test(askedPath), askedPath);
      check('Fragt nach Intro und Outro',
            /includeSegmentTypes=Intro,Outro/.test(askedPath), askedPath);

      /* Sekunden, nicht Ticks: Der Player rechnet in Sekunden. */
      check('Intro kommt in Sekunden', seg.intro?.start === 30 && seg.intro?.end === 60,
            JSON.stringify(seg.intro));
      check('Outro kommt in Sekunden', seg.outro?.start === 1200 && seg.outro?.end === 1260,
            JSON.stringify(seg.outro));

      /* ================================================================
         2. OHNE PLUGIN — der wichtigste Fall
         ================================================================ */

      api = () => Promise.reject(new Error('404 Not Found'));
      seg = await fetchMediaSegments('item-1');
      check('404 ergibt kein Intro', seg.intro === null && seg.outro === null, JSON.stringify(seg));

      api = () => Promise.resolve({ Items: [] });
      seg = await fetchMediaSegments('item-1');
      check('Leere Antwort ergibt kein Intro', seg.intro === null && seg.outro === null);

      api = () => Promise.resolve(null);
      seg = await fetchMediaSegments('item-1');
      check('Antwort ohne Items stuerzt nicht ab', seg.intro === null);

      /* Ein Abschnitt ohne Laenge waere ein Knopf, der nichts tut. */
      api = () => Promise.resolve({ Items: [
        { Type: 'Intro', StartTicks: 60 * TICKS, EndTicks: 60 * TICKS }
      ] });
      seg = await fetchMediaSegments('item-1');
      check('Abschnitt ohne Laenge wird verworfen', seg.intro === null, JSON.stringify(seg.intro));

      api = () => Promise.resolve({ Items: [
        { Type: 'Intro', StartTicks: 90 * TICKS, EndTicks: 30 * TICKS }
      ] });
      seg = await fetchMediaSegments('item-1');
      check('Rueckwaerts laufender Abschnitt wird verworfen', seg.intro === null);

      seg = await fetchMediaSegments('');
      check('Ohne Titel wird nicht gefragt', seg.intro === null && seg.outro === null);

      api = realApi;

      /* ================================================================
         3. WANN DER KNOPF SICHTBAR IST
         ================================================================ */

      const skip = document.getElementById('vp-skip');
      const shown = () => !skip.classList.contains('hidden');

      vpCurrent.segments = { intro: { start: 30, end: 60 }, outro: null };
      resetSkip();

      updateSkip(5);
      check('Vor dem Intro: kein Knopf', !shown());

      updateSkip(29.5);
      check('Kurz davor: schon sichtbar', shown());

      updateSkip(45);
      check('Im Intro: sichtbar', shown());

      updateSkip(61);
      check('Nach dem Intro: weg', !shown());

      /* Zurueckspulen ins Intro zeigt ihn wieder — solange nicht
         weggeklickt wurde. */
      updateSkip(40);
      check('Zurueck im Intro: wieder da', shown());

      /* ================================================================
         4. DER SPRUNG
         ================================================================ */

      /* Ein echtes <video> hat hier keine Quelle; seekTo() schreibt
         currentTime, das laesst sich pruefen. */
      vpCurrent.serverSeekOffset = 0;
      vpCurrent.item = { Id: 'item-1', RunTimeTicks: 1500 * TICKS };

      skip.click();
      await wait(60);

      check('Der Sprung landet hinter dem Intro',
            vp.video.currentTime >= 60 && vp.video.currentTime < 61,
            String(vp.video.currentTime));
      check('Nach dem Klick ist der Knopf weg', !shown());

      /* Weggeklickt heisst weggeklickt: auch mitten im Intro nicht
         wieder aufdraengen. */
      updateSkip(45);
      check('Weggeklickt bleibt weg', !shown());

      resetSkip();
      updateSkip(45);
      check('Neuer Titel zeigt ihn wieder', shown());

      /* Ohne Marken nie ein Knopf. */
      vpCurrent.segments = { intro: null, outro: null };
      resetSkip();
      updateSkip(45);
      check('Ohne Marken kein Knopf', !shown());

      /* ================================================================
         5. DER ABSPANN
         ================================================================ */

      check('outroReached() vorhanden', typeof outroReached === 'function');

      vpCurrent.segments = { intro: null, outro: { start: 1200, end: 1260 } };
      check('Vor dem Abspann: nein', outroReached(1100) === false);
      check('Im Abspann: ja', outroReached(1210) === true);

      vpCurrent.segments = { intro: null, outro: null };
      check('Ohne Marke bleibt es beim Ende des Titels', outroReached(9999) === false);

      /* Die Einblendung im Abspann darf NICHT von selbst
         weiterschalten — wer den Abspann sehen will, soll ihn sehen. */
      vpQueue = [{ Id: 'a' }, { Id: 'b', Name: 'Zweite', IndexNumber: 2 }];
      vpIndex = 0;
      prefs.autoplayNext = true;
      prefs.showNextup = true;

      offerNextUp(vpQueue[1], { countdown: false });
      await wait(1300);

      check('Abspann-Einblendung steht',
            !document.getElementById('vp-nextup').classList.contains('hidden'));
      check('Ohne Zaehler keine Zahl',
            document.getElementById('nextup-count').textContent === '',
            JSON.stringify(document.getElementById('nextup-count').textContent));

      /* Am Titelende gilt weiter der Zaehler. */
      offerNextUp(vpQueue[1], { countdown: true });
      const first = document.getElementById('nextup-count').textContent;
      await wait(1200);
      const second = document.getElementById('nextup-count').textContent;
      check('Am Ende laeuft der Zaehler', Number(second) < Number(first),
            first + ' -> ' + second);

      cancelNextUp();
      check('Abbrechen schliesst die Einblendung',
            document.getElementById('vp-nextup').classList.contains('hidden'));

      vpCurrent.item = null;
      vpQueue = [];
      vpIndex = -1;

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
