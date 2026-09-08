/**
 * Prueft Live TV / IPTV: Kanaele holen, anzeigen, abspielen.
 *
 * Der Punkt, auf den es ankommt: Ein Kanal wird ueber denselben Weg
 * abgespielt wie ein Film -- /Items/{id}/PlaybackInfo, dann die
 * Adresse, die der SERVER zurueckgibt. Keine selbstgebaute
 * m3u8-Adresse: Der Server haengt bei einem Live-Stream Dinge an
 * (LiveStreamId), die ein Client nicht erraten kann.
 *
 * Und: Was es bei Live nicht gibt, darf nicht angeboten werden. Eine
 * Zeitleiste ohne Dauer, ein Suchlauf, der den Stream neu anfordert
 * und wieder bei jetzt anfaengt -- das sieht wie ein Fehler aus.
 *
 * Aufruf:  npx electron tools/test-livetv.js
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
      state.token = 'tok';

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      const realApi = api;

      /* ================================================================
         1. IST FERNSEHEN EINGERICHTET?
         ================================================================ */

      check('fetchLiveTvInfo() vorhanden', typeof fetchLiveTvInfo === 'function');
      check('fetchLiveTvChannels() vorhanden', typeof fetchLiveTvChannels === 'function');

      api = () => Promise.resolve({ IsEnabled: true, Services: [{ Name: 'M3U Tuner' }] });
      let info = await fetchLiveTvInfo();
      check('Eingerichtet wird erkannt', info.available === true);

      /* Eingeschaltet, aber ohne Tuner oder Senderliste: Das waere
         eine leere Ansicht. Die zu zeigen ist schlechter, als den
         Eintrag weglassen. */
      api = () => Promise.resolve({ IsEnabled: true, Services: [] });
      info = await fetchLiveTvInfo();
      check('Eingeschaltet ohne Dienst gilt als nicht vorhanden', info.available === false);

      api = () => Promise.resolve({ IsEnabled: false, Services: [{ Name: 'x' }] });
      info = await fetchLiveTvInfo();
      check('Abgeschaltet gilt als nicht vorhanden', info.available === false);

      /* 403 heisst: Der Nutzer darf kein Live TV. Das ist kein
         Fehler, sondern eine Antwort. */
      api = () => Promise.reject(new Error('403 Forbidden'));
      info = await fetchLiveTvInfo();
      check('Fehlendes Recht (403) stuerzt nicht ab', info.available === false);

      api = () => Promise.reject(new Error('404 Not Found'));
      info = await fetchLiveTvInfo();
      check('Alter Server (404) stuerzt nicht ab', info.available === false);

      /* ================================================================
         2. DIE KANALLISTE
         ================================================================ */

      let askedPath = '';
      const CHANNELS = [
        { Id: 'ch1', Name: 'ARD HD', Type: 'TvChannel', ChannelNumber: '1',
          ImageTags: { Primary: 'a' },
          CurrentProgram: { Name: 'Tagesschau',
            StartDate: new Date(Date.now() - 300000).toISOString(),
            EndDate: new Date(Date.now() + 300000).toISOString() } },
        { Id: 'ch2', Name: 'ZDF HD', Type: 'TvChannel', ChannelNumber: '2',
          ImageTags: { Primary: 'b' } },
        { Id: 'ch3', Name: 'Regional 10.1', Type: 'TvChannel', ChannelNumber: '10.1' }
      ];

      api = (p) => {
        askedPath = p;
        return Promise.resolve({ Items: CHANNELS, TotalRecordCount: 3 });
      };

      const list = await fetchLiveTvChannels();
      check('Fragt /LiveTv/Channels', /^\\/LiveTv\\/Channels\\?/.test(askedPath), askedPath);

      /* Ein Aufruf statt einer Abfrage pro Kanal: Bei 200 Sendern
         waere der andere Weg 201 Anfragen. */
      check('Holt die laufende Sendung mit',
            /addCurrentProgram=true/.test(askedPath), askedPath);
      check('Fragt fuer den richtigen Nutzer', /userId=u1/.test(askedPath));
      check('Drei Kanaele', list.channels.length === 3);

      /* ================================================================
         3. DER FORTSCHRITTSBALKEN
         ================================================================ */

      check('programProgress() vorhanden', typeof programProgress === 'function');

      const now = Date.parse('2026-01-01T20:30:00Z');
      const prog = {
        StartDate: '2026-01-01T20:00:00Z',
        EndDate: '2026-01-01T21:00:00Z'
      };
      const half = programProgress(prog, now);
      check('Halbzeit ergibt 0,5', Math.abs(half - 0.5) < 0.01, String(half));

      /* Ohne Programmdaten -- bei einer M3U-Liste der Normalfall --
         gibt es nichts anzuzeigen. null ist die ehrliche Antwort. */
      check('Ohne Sendung: null', programProgress(null) === null);
      check('Ohne Zeiten: null', programProgress({ Name: 'x' }) === null);
      check('Unbrauchbare Zeiten: null',
            programProgress({ StartDate: 'kaputt', EndDate: 'auch' }) === null);
      check('Ende vor Anfang: null',
            programProgress({ StartDate: '2026-01-01T21:00:00Z', EndDate: '2026-01-01T20:00:00Z' }) === null);
      check('Laengst vorbei: null', programProgress(prog, Date.parse('2026-01-02T00:00:00Z')) === null);
      check('Noch nicht angefangen: null', programProgress(prog, Date.parse('2026-01-01T19:00:00Z')) === null);

      /* Die Nummer ist eine Zeichenkette: "10.1" darf nicht zu 10
         werden. */
      check('channelLabel() haelt die Nummer als Text',
            channelLabel(CHANNELS[2]).number === '10.1', channelLabel(CHANNELS[2]).number);

      /* ================================================================
         4. DIE ANSICHT
         ================================================================ */

      await showLiveTv({ Id: 'lib-tv', Name: 'Live TV', CollectionType: 'livetv' });
      await wait(250);

      const cards = document.querySelectorAll('.channel-card');
      check('Je Kanal eine Kachel', cards.length === 3, cards.length + ' Kacheln');

      const firstText = cards[0]?.textContent || '';
      check('Kanalname steht da', firstText.includes('ARD HD'), firstText.trim().slice(0, 40));
      check('Kanalnummer steht da', firstText.includes('1'));
      check('Laufende Sendung steht da', firstText.includes('Tagesschau'));
      check('Balken bei laufender Sendung', Boolean(cards[0].querySelector('.channel-bar')));

      /* Ohne Programm kein Balken -- aber ein Hinweis statt einer
         leeren Zeile. */
      check('Ohne Sendung kein Balken', !cards[1].querySelector('.channel-bar'));
      check('Ohne Sendung ein Hinweis', Boolean(cards[1].querySelector('.channel-quiet')));

      check('Kachel ist mit der Tastatur erreichbar', cards[0].tabIndex === 0);
      check('Kachel sagt, was sie ist', cards[0].getAttribute('role') === 'button');

      /* Ein Server ohne Kanaele: kein leeres Raster, sondern ein Satz. */
      api = () => Promise.resolve({ Items: [], TotalRecordCount: 0 });
      await showLiveTv({ Id: 'lib-tv', Name: 'Live TV', CollectionType: 'livetv' });
      await wait(200);
      check('Ohne Kanaele ein Hinweis',
            Boolean(document.querySelector('#view-root .empty-state')));

      /* ================================================================
         5. DIE BIBLIOTHEK FUEHRT IN DIE KANALANSICHT
         ================================================================ */

      /* Ueber /Items gefragt bliebe Live TV leer -- Kanaele sind dort
         nicht abfragbar. showLibrary() muss das abfangen. */
      api = (p) => {
        askedPath = p;
        return Promise.resolve({ Items: CHANNELS, TotalRecordCount: 3 });
      };
      askedPath = '';
      await showLibrary({ Id: 'lib-tv', Name: 'Live TV', CollectionType: 'livetv' });
      await wait(250);

      check('Live-TV-Bibliothek fragt Kanaele, nicht Titel',
            /^\\/LiveTv\\/Channels/.test(askedPath), askedPath);
      check('Und zeigt Kanalkacheln',
            document.querySelectorAll('.channel-card').length === 3);

      /* ================================================================
         6. IM PLAYER: WAS ES NICHT GIBT, WIRD NICHT ANGEBOTEN
         ================================================================ */

      /* Der Kanal wird ueber PlaybackInfo abgespielt wie ein Film.
         Hier wird nur geprueft, was der Player daraus macht -- die
         Aushandlung selbst deckt test-playback.js ab. */
      vpCurrent.live = true;
      vp.root.classList.add('is-live');

      const before = vp.video.currentTime;
      seekTo(120);
      check('Suchlauf ist im Fernsehen gesperrt', vp.video.currentTime === before,
            String(vp.video.currentTime));

      vp.video.dispatchEvent(new Event('loadedmetadata'));
      await wait(60);
      check('Keine Dauer, sondern ein Strich',
            document.getElementById('vp-duration').textContent === '—',
            document.getElementById('vp-duration').textContent);

      vp.video.dispatchEvent(new Event('timeupdate'));
      await wait(60);
      const cur = document.getElementById('vp-current').textContent;
      check('Statt der Position steht "Live"', cur === t('liveTv.live') || cur === 'liveTv.live', cur);

      check('Der Player ist als Live gekennzeichnet',
            vp.root.classList.contains('is-live'));

      /* Nach dem Schliessen muss der naechste Film seine Zeitleiste
         zurueckbekommen. */
      closeVideo();
      await wait(80);
      check('Schliessen nimmt die Live-Kennzeichnung weg',
            !vp.root.classList.contains('is-live') && vpCurrent.live === false);

      vp.video.dispatchEvent(new Event('timeupdate'));
      await wait(60);
      check('Danach zeigt die Leiste wieder eine Zeit',
            document.getElementById('vp-current').textContent !== t('liveTv.live'),
            document.getElementById('vp-current').textContent);

      api = realApi;
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
