/**
 * Prueft Bedienung ohne Maus und die leeren Zustaende:
 *
 *   1. Kacheln sind per Tab erreichbar, Enter oeffnet, Leertaste spielt,
 *      die Knoepfe darin stehen nicht in der Tab-Reihenfolge
 *   2. Rechtsklick und Menue-Taste oeffnen ein Kontextmenue, das sich
 *      mit Pfeiltasten bedienen und mit Escape schliessen laesst —
 *      und der Fokus kehrt zur Kachel zurueck
 *   3. Leere Ansichten bieten einen Ausweg statt nur Text
 *   4. Die Statistik rechnet richtig und zeigt ohne Daten einen Hinweis
 *
 * Aufruf:  npx electron tools/test-ux.js
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
      const key = (target, k, extra = {}) =>
        target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      /* Aufrufe mitschreiben statt wirklich abzuspielen */
      const calls = [];
      const realOpen = window.openItem, realPlay = window.playItem;
      openItem = (item) => calls.push('open:' + item.Id);
      playItem = (item) => calls.push('play:' + item.Id);

      /* ===================== 1. KACHEL UND TASTATUR ===================== */
      const episode = { Id: 'e1', Name: 'Pilot', Type: 'Episode', SeriesId: 's1', SeriesName: 'Serie',
                        UserData: { Played: false, IsFavorite: false } };
      const card = buildCard(episode);
      el.viewRoot.innerHTML = '';
      el.viewRoot.appendChild(card);

      check('Kachel ist per Tab erreichbar', card.tabIndex === 0);
      check('Kachel hat eine Rolle und einen Namen',
        card.getAttribute('role') === 'button' && card.getAttribute('aria-label').includes('Pilot'),
        card.getAttribute('aria-label'));
      const tabbable = [...card.querySelectorAll('button')].filter((b) => b.tabIndex >= 0);
      check('Knoepfe in der Kachel kosten keine Tabs', tabbable.length === 0, tabbable.length + ' erreichbar');

      card.focus();
      key(card, 'Enter');
      key(card, ' ');
      check('Enter oeffnet, Leertaste spielt', calls.join() === 'open:e1,play:e1', calls.join());

      const series = buildCard({ Id: 's9', Name: 'Serie', Type: 'Series', UserData: {} });
      el.viewRoot.appendChild(series);
      calls.length = 0;
      key(series, ' ');
      check('Leertaste auf einer Serie oeffnet sie (nichts direkt abspielbar)', calls.join() === 'open:s9', calls.join());

      /* ===================== 2. KONTEXTMENUE ===================== */
      card.focus();
      key(card, 'ContextMenu');
      await wait(30);
      let menu = document.querySelector('.context-menu');
      check('Menue-Taste oeffnet das Kontextmenue', Boolean(menu));
      const labels = menu ? [...menu.querySelectorAll('.context-item')].map((b) => b.textContent.trim()) : [];
      check('Folge bietet "Zur Serie"', labels.includes(t('menu.goToSeries')), labels.join(' | '));
      check('Erster Eintrag hat den Fokus', document.activeElement === menu?.querySelector('.context-item'));

      key(menu, 'ArrowDown');
      check('Pfeil runter wandert weiter', document.activeElement === menu.querySelectorAll('.context-item')[1]);
      key(menu, 'ArrowUp'); key(menu, 'ArrowUp');
      const all = menu.querySelectorAll('.context-item');
      check('Pfeil hoch springt vom Anfang ans Ende', document.activeElement === all[all.length - 1]);

      key(menu, 'Escape');
      await wait(20);
      check('Escape schliesst das Menue', !document.querySelector('.context-menu'));
      check('Fokus kehrt zur Kachel zurueck', document.activeElement === card);

      // Rechtsklick, dann Eintrag waehlen
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
      await wait(20);
      menu = document.querySelector('.context-menu');
      calls.length = 0;
      [...menu.querySelectorAll('.context-item')]
        .find((b) => b.textContent.trim() === t('menu.goToSeries')).click();
      check('"Zur Serie" oeffnet die Serie', calls.join() === 'open:s1', calls.join());
      check('Auswahl schliesst das Menue', !document.querySelector('.context-menu'));

      // Ausserhalb klicken schliesst
      card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5000, clientY: 5000 }));
      await wait(20);
      menu = document.querySelector('.context-menu');
      const box = menu.getBoundingClientRect();
      check('Menue bleibt im Fenster', box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        Math.round(box.right) + 'x' + Math.round(box.bottom));
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      check('Klick daneben schliesst', !document.querySelector('.context-menu'));

      /* ===================== 3. LEERE ZUSTAENDE ===================== */
      let ran = false;
      showEmpty('Leer', { label: 'Weiter', run: () => { ran = true; } });
      const action = el.viewRoot.querySelector('.empty-state .empty-action');
      check('Leerer Zustand bietet eine Aktion', action?.textContent === 'Weiter');
      action?.click();
      check('Die Aktion wird ausgefuehrt', ran);
      showEmpty('Nur Text');
      check('Ohne Aktion kein Knopf', !el.viewRoot.querySelector('.empty-action'));
      check('Text wird nicht als HTML gelesen',
        (showEmpty('<b>x</b>'), !el.viewRoot.querySelector('.empty-state b')));

      /* ===================== 4. STATISTIK ===================== */
      const H = 36000000000; // eine Stunde in Ticks
      const now = new Date().toISOString();
      const old = new Date(Date.now() - 90 * 86400000).toISOString();
      const realApi = window.api;
      api = async (url) => {
        if (url.includes('IncludeItemTypes=Movie')) {
          return { Items: [
            { Name: 'A', RunTimeTicks: 2 * H, Genres: ['Drama'], ProductionYear: 1994, UserData: { LastPlayedDate: now } },
            { Name: 'B', RunTimeTicks: 1 * H, Genres: ['Drama', 'Krimi'], ProductionYear: 2003, UserData: { LastPlayedDate: old } }
          ] };
        }
        return { Items: [
          { Name: 'E1', RunTimeTicks: 1 * H, SeriesName: 'Serie X', UserData: { LastPlayedDate: now } },
          { Name: 'E2', RunTimeTicks: 1 * H, SeriesName: 'Serie X', UserData: { LastPlayedDate: old } }
        ] };
      };
      await showStats();
      const nums = [...document.querySelectorAll('.stat-card .stat-num')].map((n) => n.textContent);
      check('Stunden gesamt / Filme / Folgen / Woche', nums.slice(0, 4).join() === '5,2,2,3', nums.join());
      const titles = [...document.querySelectorAll('.stats-section-title')].map((n) => n.textContent);
      check('Abschnitte fuer Serien, Genres und Jahrzehnte', titles.length === 3, titles.join(' | '));
      check('Jahrzehnte werden gebildet',
        document.body.textContent.includes('1990s') && document.body.textContent.includes('2000s'));
      check('Keine deutschen Reste in der Statistik',
        !/Stunden gesehen gesamt|Meistgesehene Jahrzehnte/.test(el.viewRoot.textContent));

      api = async () => ({ Items: [] });
      await showStats();
      check('Ohne Gesehenes ein Hinweis mit Ausweg',
        Boolean(el.viewRoot.querySelector('.empty-state .empty-action')));

      api = realApi;
      openItem = realOpen;
      playItem = realPlay;
      return out;
    })()
  `);

  results.forEach((r) => console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  app.exit(failed ? 1 : 0);
});
