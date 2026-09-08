/**
 * Prueft die beiden Abgleich-Knoepfe und die Plugin-Liste.
 *
 * Zur Ehrlichkeit beim ersten Knopf: Jellystream haelt KEINEN
 * Zwischenspeicher -- jede Ansicht laedt live. Es gibt also nichts zu
 * verwerfen. Wer neue Dateien nicht sieht, hat sie meist nicht in
 * Jellyfin; der Server muss sie erst finden, und DAS verlangt
 * Administratorrechte. Fuer ein gewoehnliches Konto muss der Knopf
 * deshalb sagen, was passiert IST, statt einen Fehler zu zeigen, den
 * niemand beheben kann.
 *
 * Beim zweiten Knopf ist der wichtigste Punkt, dass NUR GELESEN wird.
 * Ein Schreiben auf DisplayPreferences loescht serverseitig alle
 * Abschnitte und baut sie aus dem Gesendeten neu auf -- ein Fehler
 * unsererseits beschaedigte die Startseite im offiziellen Client.
 *
 * Aufruf:  npx electron tools/test-libsync.js
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
      const savedStructure = prefs.structureFrom;

      /* ================================================================
         1. BIBLIOTHEK ABGLEICHEN
         ================================================================ */

      check('refreshServerLibrary() vorhanden', typeof refreshServerLibrary === 'function');

      let calls = [];
      api = (p, o) => { calls.push([p, o?.method || 'GET']); return Promise.resolve({}); };
      let result = await refreshServerLibrary();

      check('Stoesst /Library/Refresh an',
            calls.some(([p, m]) => p === '/Library/Refresh' && m === 'POST'),
            JSON.stringify(calls));
      check('Erfolg wird gemeldet', result === 'started', result);

      /* Kein Adminkonto: Normalfall, kein Fehler. */
      api = () => Promise.reject(new Error('403 Forbidden'));
      result = await refreshServerLibrary();
      check('403 heisst "nicht erlaubt", nicht "kaputt"', result === 'forbidden', result);

      api = () => Promise.reject(new Error('401 Unauthorized'));
      result = await refreshServerLibrary();
      check('401 ebenso', result === 'forbidden', result);

      api = () => Promise.reject(new Error('500 Server Error'));
      result = await refreshServerLibrary();
      check('Echter Fehler wird unterschieden', result === 'failed', result);

      /* ================================================================
         2. REIHENFOLGE DER BIBLIOTHEKEN
         ================================================================ */

      check('fetchViewOrder() vorhanden', typeof fetchViewOrder === 'function');
      check('applyViewOrder() vorhanden', typeof applyViewOrder === 'function');

      api = () => Promise.resolve({
        Configuration: {
          OrderedViews: ['lib-c', 'lib-a'],
          MyMediaExcludes: ['lib-d']
        }
      });
      const order = await fetchViewOrder();
      check('Liest die Reihenfolge', order.ordered.join(',') === 'lib-c,lib-a', order.ordered.join(','));
      check('Liest die Ausgeblendeten', order.hidden.join(',') === 'lib-d');

      const libs = [
        { Id: 'lib-a', Name: 'A' }, { Id: 'lib-b', Name: 'B' },
        { Id: 'lib-c', Name: 'C' }, { Id: 'lib-d', Name: 'D' }
      ];
      const sorted = applyViewOrder(libs, order);
      check('Reihenfolge des Servers gilt',
            sorted.map((l) => l.Id).join(',') === 'lib-c,lib-a,lib-b',
            sorted.map((l) => l.Id).join(','));
      check('Ausgeblendete fallen weg', !sorted.some((l) => l.Id === 'lib-d'));

      /* Ohne Reihenfolge bleibt die des Servers -- die ist bereits
         seine Antwort auf die Frage. */
      const untouched = applyViewOrder(libs, { ordered: [], hidden: [] });
      check('Ohne Reihenfolge bleibt alles wie geliefert',
            untouched.map((l) => l.Id).join(',') === 'lib-a,lib-b,lib-c,lib-d');
      check('Kein Absturz ohne Angaben', applyViewOrder(libs).length === 4);
      check('Kein Absturz ohne Bibliotheken', applyViewOrder(null).length === 0);

      /* Netzfehler darf die Navigation nicht leeren. */
      api = () => Promise.reject(new Error('nope'));
      const failed = await fetchViewOrder();
      check('Fehler ergibt leere Angaben, keinen Absturz',
            failed.ordered.length === 0 && failed.hidden.length === 0);

      /* ================================================================
         3. ABSCHNITTE DER STARTSEITE -- nur lesen
         ================================================================ */

      check('fetchHomeSections() vorhanden', typeof fetchHomeSections === 'function');

      calls = [];
      api = (p, o) => {
        calls.push([p, o?.method || 'GET']);
        return Promise.resolve({ CustomPrefs: {
          homesection0: 'nextup',
          homesection1: 'latestmedia',
          homesection2: 'resume',
          homesection3: 'none'
        } });
      };
      let home = await fetchHomeSections();

      check('Fragt die Anzeige-Einstellungen',
            calls.some(([p]) => /^\\/DisplayPreferences\\/usersettings\\?/.test(p)),
            JSON.stringify(calls));
      check('Fragt als "emby" -- so legt die Weboberflaeche sie ab',
            calls.some(([p]) => /client=emby/.test(p)));

      /* Der wichtigste Punkt: NICHTS wird geschrieben. */
      check('Es wird ausschliesslich gelesen',
            calls.every(([, m]) => m === 'GET'), JSON.stringify(calls));

      check('Abschnitte in der Reihenfolge des Servers',
            home.sections.join(',') === 'nextup,latestmedia,resume,none',
            home.sections.join(','));
      check('Als vom Server erkannt', home.fromServer === true);

      /* Unbekannte Abschnitte ueberspringen statt raten. */
      api = () => Promise.resolve({ CustomPrefs: {
        homesection0: 'resume', homesection1: 'etwasneues', homesection2: 'nextup'
      } });
      home = await fetchHomeSections();
      check('Unbekannter Abschnitt wird uebersprungen',
            home.sections.join(',') === 'resume,nextup', home.sections.join(','));

      /* Nie angefasst: dann gelten die Vorgaben des Servers, nicht
         eine leere Seite. */
      api = () => Promise.resolve({ CustomPrefs: {} });
      home = await fetchHomeSections();
      check('Ohne Einstellung gelten die Vorgaben', home.sections.length > 3);
      check('Und das wird als "nicht vom Server" gemeldet', home.fromServer === false);

      api = () => Promise.reject(new Error('403'));
      home = await fetchHomeSections();
      check('Fehler ergibt keine Abschnitte', home.sections.length === 0);

      /* ================================================================
         4. DIE REIHENFOLGE DER STARTSEITE
         ================================================================ */

      check('homeRowOrder() vorhanden', typeof homeRowOrder === 'function');

      prefs.structureFrom = 'jellystream';
      check('Standard ist die eigene Reihenfolge',
            homeRowOrder().join(',') === 'resume,nextup,latestmovies,latestseries,favorites',
            homeRowOrder().join(','));

      prefs.structureFrom = 'jellyfin';
      state.homeSections = ['nextup', 'latestmedia', 'resume'];
      let rows = homeRowOrder();

      /* latestmedia ist bei Jellyfin EIN Abschnitt; bei uns sind Filme
         und Serien getrennt. Ein Abschnitt wird zu zwei. */
      check('Reihenfolge des Servers gilt',
            rows.join(',') === 'nextup,latestmovies,latestseries,resume,favorites',
            rows.join(','));
      check('"Meine Liste" faellt nicht weg', rows.includes('favorites'));

      /* Ergaebe die Zuordnung nichts, waere die Startseite leer --
         dann ist die eigene Reihenfolge das kleinere Uebel. */
      state.homeSections = ['librarybuttons', 'smalllibrarytiles', 'resumebook'];
      check('Nur Unbekanntes faellt auf die eigene Reihenfolge zurueck',
            homeRowOrder().join(',') === 'resume,nextup,latestmovies,latestseries,favorites',
            homeRowOrder().join(','));

      state.homeSections = [];
      check('Ohne Abschnitte gilt die eigene Reihenfolge',
            homeRowOrder().join(',') === 'resume,nextup,latestmovies,latestseries,favorites');

      /* Doppelte Abschnitte duerfen keine doppelten Reihen ergeben. */
      state.homeSections = ['resume', 'resume', 'nextup'];
      rows = homeRowOrder();
      check('Doppelte Abschnitte ergeben keine doppelten Reihen',
            rows.filter((r) => r === 'resume').length === 1, rows.join(','));

      /* ================================================================
         5. PLUGIN-LISTE
         ================================================================ */

      check('renderPluginList() vorhanden', typeof renderPluginList === 'function');

      api = () => Promise.resolve([
        { Name: 'Intro Skipper', Version: '1.10.0', Status: 'Active' },
        { Name: 'Trakt', Version: '4.2.1', Status: 'Active' }
      ]);
      await renderPluginList();
      await wait(150);

      const pluginRows = document.querySelectorAll('#settings-plugins .plugin-row');
      check('Je Plugin eine Zeile', pluginRows.length === 2, pluginRows.length + ' Zeilen');

      const introRow = pluginRows[0]?.textContent || '';
      check('Name und Fassung stehen da',
            introRow.includes('Intro Skipper') && introRow.includes('1.10.0'), introRow.trim());
      check('Genutztes Plugin ist als solches erkannt',
            Boolean(pluginRows[0].querySelector('.plugin-use.used')));
      check('Nicht genutztes ist nicht hervorgehoben',
            !pluginRows[1].querySelector('.plugin-use.used'));

      /* Kein Adminkonto: ein Satz, keine Fehlermeldung. Und der
         Hinweis, dass die Intro-Funktion davon unabhaengig laeuft. */
      api = () => Promise.reject(new Error('403 Forbidden'));
      await renderPluginList();
      await wait(150);
      const hint = document.querySelector('#settings-plugins .settings-hint')?.textContent || '';
      check('Ohne Adminrechte ein Satz statt einer Fehlermeldung',
            hint.length > 0 && !document.querySelector('#settings-plugins .plugin-row'),
            hint.slice(0, 60));

      api = () => Promise.resolve([]);
      await renderPluginList();
      await wait(150);
      check('Ohne Plugins ein Hinweis',
            Boolean(document.querySelector('#settings-plugins .settings-hint')));

      /* ================================================================
         6. DIE BEDIENELEMENTE
         ================================================================ */

      check('Knopf zum Abgleichen vorhanden', Boolean(document.getElementById('sync-library')));
      check('Auswahl fuer den Aufbau vorhanden', Boolean(document.getElementById('sync-structure')));
      check('Zwei Moeglichkeiten',
            document.getElementById('sync-structure').options.length === 2);

      prefs.structureFrom = savedStructure;
      state.homeSections = [];
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
