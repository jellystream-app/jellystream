/**
 * Prueft Kalender/"Demnaechst", Jugendschutz und die Untertitel-Vorschau.
 *
 *   - Demnaechst-Reihe steht hinter "Als Naechstes" und nennt das Datum
 *   - Kalender gruppiert nach Tagen, "Heute"/"Morgen" statt Datum
 *   - Jugendschutz: Admin sieht alle Konten und setzt die Richtlinie des
 *     Servers — mit der vollstaendigen Richtlinie, nicht nur dem einen Feld
 *     (sonst setzt der Server alles andere zurueck)
 *   - Kein Admin: nur die eigene Grenze, keine Auswahl
 *   - Untertitel-Vorschau zeigt Schrift und Umrandung
 *
 * Aufruf:  npx electron tools/test-upcoming.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, c) => require('../languages').get(c));
  require('../languages').init();

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await setLanguage('de');

      state.serverUrl = 'http://test.local';
      state.userId = 'admin';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');

      const day = (offset, h = 20) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 15, 0, 0); return d.toISOString(); };
      const upcoming = [
        { Id: 'e3', Name: 'Spaeter', SeriesName: 'Serie B', SeriesId: 'sb', IndexNumber: 1, ParentIndexNumber: 2, PremiereDate: day(4), Type: 'Episode' },
        { Id: 'e1', Name: 'Pilot', SeriesName: 'Serie A', SeriesId: 'sa', IndexNumber: 5, ParentIndexNumber: 1, PremiereDate: day(0), Type: 'Episode' },
        { Id: 'e2', Name: 'Weiter', SeriesName: 'Serie A', SeriesId: 'sa', IndexNumber: 6, ParentIndexNumber: 1, PremiereDate: day(1), Type: 'Episode' }
      ];

      const policies = {
        admin: { IsAdministrator: true, MaxParentalRating: null, EnableAllFolders: true, AuthenticationProviderId: 'x', PasswordResetProviderId: 'y' },
        kind: { IsAdministrator: false, MaxParentalRating: null, EnableAllFolders: true, BlockedTags: ['horror'], AuthenticationProviderId: 'x', PasswordResetProviderId: 'y' }
      };
      const posted = [];
      const realApi = api;
      api = async (url, options = {}) => {
        if (url.startsWith('/Shows/Upcoming')) return { Items: upcoming };
        if (url.startsWith('/Shows/NextUp')) return { Items: [{ Id: 'n1', Name: 'Naechste', Type: 'Episode' }] };
        if (url.includes('/Items/Resume')) return { Items: [] };
        if (url === '/Localization/ParentalRatings') return [
          { Name: 'FSK-0', Value: 0 }, { Name: 'G', Value: 0 },
          { Name: 'FSK-12', Value: 12 }, { Name: 'PG-13', Value: 13 }, { Name: 'FSK-16', Value: 16 }
        ];
        if (url === '/Users') return [
          { Id: 'admin', Name: 'Admin', Policy: policies.admin },
          { Id: 'kind', Name: 'Kind', Policy: policies.kind }
        ];
        const policyMatch = url.match(/^\\/Users\\/(\\w+)\\/Policy$/);
        if (policyMatch) { posted.push({ id: policyMatch[1], body: JSON.parse(options.body) }); return null; }
        const userMatch = url.match(/^\\/Users\\/(\\w+)$/);
        if (userMatch) return { Id: userMatch[1], Name: userMatch[1], Policy: policies[userMatch[1]] };
        return { Items: [], TotalRecordCount: 0 };
      };

      /* ---------- Demnaechst auf der Startseite ---------- */
      await showHome();
      await wait(300);
      const keys = [...el.viewRoot.querySelectorAll('section.row')].map((r) => r.dataset.rowKey);
      check('Demnaechst steht hinter Als Naechstes',
        keys.indexOf('upcoming') === keys.indexOf('nextup') + 1 && keys.includes('upcoming'), keys.join(','));
      const upRow = el.viewRoot.querySelector('section.row[data-row-key="upcoming"]');
      const subs = [...(upRow?.querySelectorAll('.card-sub') || [])].map((n) => n.textContent);
      check('Kachel nennt Datum und Folge', subs.some((s) => s.startsWith('Heute') && s.includes('S1 F5')), subs.join(' | '));
      check('Naechste Folge zuerst', subs[0]?.startsWith('Heute'), subs[0]);

      /* ---------- Kalender ---------- */
      await showCalendar();
      const dates = [...el.viewRoot.querySelectorAll('.calendar-date')].map((n) => n.textContent);
      check('Kalender nach Tagen, sortiert', dates.length === 3 && dates[0] === 'Heute' && dates[1] === 'Morgen', dates.join(' | '));
      const first = el.viewRoot.querySelector('.calendar-entry');
      check('Eintrag nennt Serie, Folge und Uhrzeit',
        first.querySelector('strong').textContent === 'Serie A' &&
        first.querySelector('small').textContent.includes('S1 F5') &&
        /20:15/.test(first.querySelector('time').textContent),
        first.textContent.replace(/\\s+/g, ' ').trim());
      const opened = [];
      const realOpen = openItem;
      openItem = (item) => opened.push(item.Id + ':' + item.Type);
      first.click();
      openItem = realOpen;
      check('Klick oeffnet die Serie', opened[0] === 'sa:Series', opened.join());

      upcoming.length = 0;
      await showCalendar();
      check('Leerer Kalender mit Hinweis und Ausweg', Boolean(el.viewRoot.querySelector('.empty-state .empty-action')));

      /* ---------- Jugendschutz als Admin ---------- */
      await renderParentalControls();
      const selects = [...document.querySelectorAll('#parental-list select')];
      check('Admin sieht alle Konten', selects.length === 2);
      check('Eigenes Admin-Konto nicht einschraenkbar', selects[0].disabled && !selects[1].disabled);
      const opts = [...selects[1].options].map((o) => o.textContent);
      check('Stufen zusammengefasst', opts.includes('FSK-0 / G') && opts[0] === 'Keine Grenze', opts.join(' | '));

      selects[1].value = '12';
      selects[1].dispatchEvent(new Event('change'));
      await wait(100);
      const sent = posted[0];
      check('Richtlinie des Servers wird gesetzt', sent?.id === 'kind' && sent.body.MaxParentalRating === 12, JSON.stringify(sent?.body));
      check('Rest der Richtlinie bleibt erhalten',
        sent?.body.BlockedTags?.[0] === 'horror' && sent.body.AuthenticationProviderId === 'x' && sent.body.EnableAllFolders === true);

      /* ---------- Jugendschutz ohne Admin ---------- */
      state.userId = 'kind';
      policies.kind.MaxParentalRating = 12;
      await renderParentalControls();
      check('Ohne Admin keine Auswahl', !document.querySelector('#parental-list select'));
      check('Eigene Grenze wird genannt', document.getElementById('parental-list').textContent.includes('FSK-12'),
        document.getElementById('parental-list').textContent);

      /* ---------- Untertitel-Vorschau ---------- */
      prefs.subFont = 'serif';
      prefs.subOutline = true;
      applySubtitleStyle();
      const pv = document.getElementById('sub-preview');
      check('Vorschau uebernimmt die Schrift', /Georgia/.test(pv.style.getPropertyValue('--sub-font')));
      check('Vorschau uebernimmt die Umrandung', /-1.6px/.test(pv.style.getPropertyValue('--sub-shadow')));
      check('Mit Umrandung kein Kasten', pv.style.getPropertyValue('--sub-bg').trim() === '0');

      api = realApi;
      return out;
    })()
  `);

  results.forEach((r) => console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  app.exit(failed ? 1 : 0);
});
