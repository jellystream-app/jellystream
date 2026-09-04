/**
 * Prüft die mobile Oberfläche bei echten Handygrößen — und dass sie
 * den Desktop nicht berührt.
 *
 * Aufruf:  npx electron tools/test-mobile.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, c) => require('../languages').get(c));
  require('../languages').init();

  /* ---------- Trennung: teilt sich nur der Kern ---------- */

  const mobileFiles = ['index.html', 'mobile.css', 'mobile.js', 'player.js', 'settings.js'];
  mobileFiles.forEach((f) => {
    check('mobile/' + f + ' vorhanden', fs.existsSync(path.join(ROOT, 'mobile', f)));
  });

  const mobileHtml = fs.readFileSync(path.join(ROOT, 'mobile', 'index.html'), 'utf8');

  // Die mobile Fassung darf keine Desktop-Dateien laden
  ['renderer.js', 'settings.js"', 'player.js"', 'offline.js', 'styles.css'].forEach((f) => {
    const bad = new RegExp(`src="\\.\\./${f.replace('"', '')}"|href="\\.\\./${f.replace('"', '')}"`);
    check('mobile lädt nicht ../' + f.replace('"', ''), !bad.test(mobileHtml));
  });

  check('mobile nutzt den Kern',
    /core\/api\.js/.test(mobileHtml) && /core\/i18n\.js/.test(mobileHtml) &&
    /core\/playback\.js/.test(mobileHtml));

  // Und der Desktop darf nichts Mobiles laden
  const desktopHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  check('Desktop lädt nichts aus mobile/', !/mobile\//.test(desktopHtml));

  /* ---------- Die Oberfläche bei Handygrößen ---------- */

  const win = new BrowserWindow({
    width: 390, height: 844, show: false,
    minWidth: 200, minHeight: 200,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, sandbox: false
    }
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (e, level, message) => {
    if (level >= 3) consoleErrors.push(message.slice(0, 100));
  });

  await win.loadFile(path.join(ROOT, 'mobile', 'index.html'));
  await new Promise((r) => setTimeout(r, 1600));

  check('Lädt ohne Fehler in der Konsole', consoleErrors.length === 0,
    consoleErrors.slice(0, 2).join(' | '));

  const sizes = [
    { w: 360, h: 800, name: 'Android klein' },
    { w: 390, h: 844, name: 'iPhone' },
    { w: 430, h: 932, name: 'iPhone groß' }
  ];

  for (const size of sizes) {
    win.setMinimumSize(200, 200);
    win.setContentSize(size.w, size.h);

    for (let i = 0; i < 30; i++) {
      const seen = await win.webContents.executeJavaScript('({w:innerWidth,h:innerHeight})');
      if (Math.abs(seen.w - size.w) <= 2) break;
      win.setContentSize(size.w, size.h);
      await new Promise((r) => setTimeout(r, 70));
    }
    await new Promise((r) => setTimeout(r, 250));

    const info = await win.webContents.executeJavaScript(`
      (() => {
        state.serverUrl='http://t.local'; state.userId='u'; state.token='x';
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app-shell').classList.remove('hidden');

        const items = Array.from({length:6},(_,i)=>({
          Id:'x'+i, Name:'Ein etwas längerer Titel '+i, Type:'Movie',
          ImageTags:{Thumb:'t'}, ProductionYear:2024
        }));
        const view = document.getElementById('m-view');
        view.innerHTML = '';
        const row = buildRow('Reihe', items);
        if (row) view.appendChild(row);

        const card = document.querySelector('.m-card');
        const tab = document.querySelector('.m-tab');
        // Ein SICHTBARER Knopf: verborgene liefern 0 und sagen nichts
        // über die tatsächliche Fingerfläche aus.
        const iconBtn = Array.from(document.querySelectorAll('.m-icon-btn'))
          .find((b) => b.offsetParent !== null);
        const h = (el) => el ? Math.round(el.getBoundingClientRect().height) : 0;
        const w = (el) => el ? Math.round(el.getBoundingClientRect().width) : 0;

        return {
          vw: innerWidth,
          cardW: w(card),
          cardsPerScreen: card ? +(innerWidth / (w(card) + 10)).toFixed(1) : 0,
          tabH: h(tab),
          iconBtnH: h(iconBtn),
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
          tabsCount: document.querySelectorAll('.m-tab').length
        };
      })()
    `);

    check(size.name + ': zwei Karten nebeneinander',
      info.cardsPerScreen >= 1.8 && info.cardsPerScreen <= 2.4,
      info.cardsPerScreen + ' Karten (' + info.cardW + 'px)');

    check(size.name + ': Navigation groß genug', info.tabH >= 48,
      info.tabH + 'px');

    check(size.name + ': Knöpfe groß genug', info.iconBtnH >= 44,
      info.iconBtnH + 'px');

    check(size.name + ': kein waagerechtes Scrollen', !info.overflow);
  }

  /* ---------- Funktionen aus dem Kern sind erreichbar ---------- */

  const shared = await win.webContents.executeJavaScript(`
    (() => {
      const out = {};
      ['t','api','imageUrl','wideImageUrl','formatTime','formatRuntime',
       'ticksToSeconds','escapeHtml','buildDeviceProfile','fetchPlaybackInfo',
       'resolveStream','authenticate','normalizeServerUrl','setLanguage'
      ].forEach((name) => { out[name] = typeof window[name] === 'function' ||
        typeof eval('typeof ' + name) === 'function'; });
      return out;
    })()
  `);

  Object.entries(shared).forEach(([name, ok]) => {
    check('Kernfunktion ' + name + '() erreichbar', ok);
  });

  /* ---------- Übersetzung greift ---------- */

  const lang = await win.webContents.executeJavaScript(`
    (async () => {
      await setLanguage('en');
      const home = document.querySelector('[data-i18n="nav.home"]');
      const en = home ? home.textContent : '';
      await setLanguage('de');
      const de = home ? home.textContent : '';
      return { en, de };
    })()
  `);

  check('Übersetzung auf Englisch', lang.en === 'Home', lang.en);
  check('Übersetzung auf Deutsch', lang.de === 'Startseite', lang.de);

  /* ---------- Der Player ---------- */

  const player = await win.webContents.executeJavaScript(`
    (() => ({
      elements: ['m-player','m-video','m-play','m-seek','m-back10','m-fwd10',
                 'm-player-close','m-subs','m-audio']
        .filter((id) => !document.getElementById(id)),
      hasPlayVideo: typeof playVideo === 'function',
      hasSeekTo: typeof seekTo === 'function',
      /* Der Player ist verborgen — dort liefert getBoundingClientRect
         null. Die zugesagte Groesse steht im Stylesheet, also dort
         nachsehen. */
      playBtnSize: (() => {
        const probe = document.createElement('div');
        probe.className = 'm-round-btn big';
        probe.style.position = 'absolute';
        document.body.appendChild(probe);
        const size = Math.round(probe.getBoundingClientRect().height);
        probe.remove();
        return size;
      })()
    }))()
  `);

  check('Alle Player-Elemente vorhanden', player.elements.length === 0,
    player.elements.join(', '));
  check('playVideo() vorhanden', player.hasPlayVideo);
  check('Zeitachse wird umgerechnet (seekTo)', player.hasSeekTo);
  check('Abspielknopf groß genug', player.playBtnSize >= 60, player.playBtnSize + 'px');

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
