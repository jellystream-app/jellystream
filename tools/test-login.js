/**
 * Prueft den Login-Bildschirm: kein Kasten mehr, Logo laedt,
 * Formular passt bei verschiedenen Fenstergroessen, Uebersetzung
 * und Bedienbarkeit bleiben erhalten.
 *
 * Aufruf:  npx electron tools/test-login.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, code) => require('../languages').get(code));
  require('../languages').init();

  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    // Ohne Mindestmasse lassen sich auch flache Fenster pruefen;
    // die App selbst begrenzt auf 1000x680.
    minWidth: 200, minHeight: 200,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 1500));

  const base = await win.webContents.executeJavaScript(`
    (() => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      /* --- Der Kasten ist weg --- */
      check('Keine Login-Karte mehr', !document.querySelector('.login-card'));
      check('Kein Brand-Orb mehr', !document.querySelector('.brand-orb'));

      const stage = document.querySelector('.login-stage');
      check('Formularbereich vorhanden', Boolean(stage));

      const cs = getComputedStyle(stage);
      check('Kein Rahmen', cs.borderTopWidth === '0px', cs.borderTopWidth);
      check('Kein Kartenhintergrund',
        cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent',
        cs.backgroundColor);
      check('Kein Schlagschatten', cs.boxShadow === 'none', cs.boxShadow);

      /* --- Logo statt SVG-Platzhalter --- */
      const logo = document.querySelector('.login-logo');
      check('Logo vorhanden', Boolean(logo));
      check('Logo zeigt auf icon.png', logo?.getAttribute('src') === 'build/icon.png',
        logo?.getAttribute('src'));
      check('Logo ist geladen', logo?.complete && logo?.naturalWidth > 0,
        logo ? logo.naturalWidth + 'x' + logo.naturalHeight : 'fehlt');
      check('Logo hat einen Alternativtext', Boolean(logo?.alt), logo?.alt);

      /* --- Keine Effektebenen mehr --- */
      check('Kein Lichtschleier', !document.querySelector('.login-aurora'));
      check('Kein Raster', !document.querySelector('.login-grid'));
      check('Keine Vignette', !document.querySelector('.login-vignette'));
      check('Kein Rauschen', !document.querySelector('.login-noise'));

      /* --- Flach: keine Verlaeufe, kein Leuchten, kein Weichzeichner --- */
      const screenBg = getComputedStyle(document.getElementById('login-screen'));
      check('Hintergrund ohne Verlauf',
        screenBg.backgroundImage === 'none', screenBg.backgroundImage.slice(0, 50));

      const logoStyle = getComputedStyle(logo);
      check('Logo ohne Schatten', logoStyle.boxShadow === 'none', logoStyle.boxShadow);
      check('Logo mit 8px Radius', logoStyle.borderRadius === '8px', logoStyle.borderRadius);

      const btn = document.getElementById('login-btn');
      const btnStyle = getComputedStyle(btn);
      check('Knopf ohne Verlauf', btnStyle.backgroundImage === 'none', btnStyle.backgroundImage);
      check('Knopf ohne Leuchten', btnStyle.boxShadow === 'none', btnStyle.boxShadow);
      check('Knopf mit 8px Radius', btnStyle.borderRadius === '8px', btnStyle.borderRadius);

      const input = document.querySelector('.login-stage .field-input');
      const inputStyle = getComputedStyle(input);
      check('Feld mit 8px Radius', inputStyle.borderRadius === '8px', inputStyle.borderRadius);
      check('Feld ohne Weichzeichner',
        inputStyle.backdropFilter === 'none' || !inputStyle.backdropFilter,
        inputStyle.backdropFilter);

      // Kein Element im Login darf noch einen Verlauf oder Glow tragen
      const offenders = [];
      document.querySelectorAll('#login-screen *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage)) {
          offenders.push(el.className + ' (Verlauf)');
        }
        if (cs.boxShadow !== 'none') offenders.push(el.className + ' (Schatten)');
        if (cs.filter && cs.filter !== 'none') offenders.push(el.className + ' (Filter)');
      });
      check('Nirgends Verlauf, Schatten oder Filter', offenders.length === 0,
        offenders.slice(0, 4).join(', '));

      /* --- Keine dekorativen Feld-Icons mehr --- */
      check('Keine Icons in den Eingabefeldern',
        document.querySelectorAll('#login-screen .field-icon').length === 0);

      /* --- Keine Einblend-Animationen --- */
      const stageAnim = getComputedStyle(stage).animationName;
      const headerAnim = getComputedStyle(document.querySelector('.login-header')).animationName;
      check('Formular ohne Einblendung', stageAnim === 'none', stageAnim);
      check('Kopfzeile ohne Einblendung', headerAnim === 'none', headerAnim);

      /* --- Alle Bedienelemente noch da --- */
      ['server-url', 'username', 'password', 'toggle-password', 'remember-me',
       'login-btn', 'quick-connect-btn', 'auth-error', 'connect-form'
      ].forEach((id) => check('Element ' + id, Boolean(document.getElementById(id))));

      /* --- Ein Klick auf die Mitte trifft den Knopf --- */
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      check('Anmelde-Knopf ist anklickbar', btn.contains(hit) || hit === btn,
        hit ? hit.tagName + '.' + hit.className : 'nichts');

      /* --- Marke --- */
      const word = document.querySelector('.login-wordmark');
      check('Wortmarke sagt Jellystream', word?.textContent.trim() === 'Jellystream', word?.textContent);

      /* --- Dasselbe Logo in der Navigationsleiste --- */
      const navLogo = document.querySelector('.brand-logo');
      check('Navbar-Logo ist ein Bild', navLogo?.tagName === 'IMG', navLogo?.tagName);
      check('Navbar-Logo nutzt icon.png',
        navLogo?.getAttribute('src') === 'build/icon.png', navLogo?.getAttribute('src'));
      check('Navbar-Logo ist geladen',
        navLogo?.complete && navLogo?.naturalWidth > 0,
        navLogo ? navLogo.naturalWidth + 'x' + navLogo.naturalHeight : 'fehlt');
      check('Kein Verlaufs-SVG mehr in der Navbar', !document.getElementById('jf-grad'));

      /* --- Version im Fuss --- */
      const version = document.getElementById('login-version');
      check('Version wird angezeigt', /^v\\d/.test(version?.textContent || ''), version?.textContent);

      return out;
    })()
  `);

  base.forEach((r) => results.push(r));

  /* --- Verschiedene Fenstergroessen: nichts darf abgeschnitten werden --- */
  const sizes = [
    { w: 1600, h: 1000, label: 'gross' },
    { w: 1000, h: 680, label: 'klein (Mindestmass)' },
    { w: 1280, h: 620, label: 'flach' }
  ];

  // Mindestmasse vor jedem Durchlauf loesen — sonst klemmt das
  // Fenster bei 1000x680 fest und flache Fenster werden nie geprueft.
  win.setMinimumSize(200, 200);

  for (const size of sizes) {
    /* Warten, bis die Groesse WIRKLICH anliegt. Weder ein fester
       Timeout noch das resize-Ereignis reichten: beim Verkleinern
       feuert das Ereignis, bevor der Inhalt neu umgebrochen ist —
       der Durchlauf prueft dann die vorherige Groesse. */
    win.setMinimumSize(200, 200);
    win.setContentSize(size.w, size.h);
    await new Promise((r) => setTimeout(r, 120));

    /* Nachfassen, bis die Seite die Groesse auch sieht. getContentSize
       meldet den Zielwert mitunter, bevor der Renderer umgebrochen hat. */
    for (let tries = 0; tries < 30; tries++) {
      const seen = await win.webContents.executeJavaScript(
        '({ w: window.innerWidth, h: window.innerHeight })');
      if (Math.abs(seen.w - size.w) <= 2 && Math.abs(seen.h - size.h) <= 2) break;
      win.setContentSize(size.w, size.h);
      await new Promise((r) => setTimeout(r, 70));
    }
    await new Promise((r) => setTimeout(r, 200));

    // Nachpruefen, dass die Groesse wirklich angekommen ist
    const actual = await win.webContents.executeJavaScript(
      '({ w: window.innerWidth, h: window.innerHeight })');
    check(`${size.label}: Fenstergroesse uebernommen`,
      Math.abs(actual.w - size.w) <= 2 && Math.abs(actual.h - size.h) <= 2,
      `${actual.w}x${actual.h} statt ${size.w}x${size.h}`);

    const fit = await win.webContents.executeJavaScript(`
      (() => {
        const form = document.getElementById('connect-form');
        const header = document.querySelector('.login-header');
        const stage = document.querySelector('.login-stage');
        const fr = form.getBoundingClientRect();
        const hr = header.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        return {
          formTop: Math.round(fr.top),
          formBottom: Math.round(fr.bottom),
          headerBottom: Math.round(hr.bottom),
          stageLeft: Math.round(sr.left),
          stageRight: Math.round(sr.right),
          vh: window.innerHeight,
          vw: window.innerWidth,
          scrollable: document.documentElement.scrollHeight > window.innerHeight + 2
        };
      })()
    `);

    check(`${size.label}: Formular beginnt unter der Marke`,
      fit.formTop >= fit.headerBottom - 4, `${fit.formTop} vs ${fit.headerBottom}`);
    check(`${size.label}: Formular passt in die Hoehe`,
      fit.formBottom <= fit.vh + 2, `${fit.formBottom} / ${fit.vh}`);
    check(`${size.label}: Formular passt in die Breite`,
      fit.stageLeft >= 0 && fit.stageRight <= fit.vw,
      `${fit.stageLeft}–${fit.stageRight} / ${fit.vw}`);
  }

  win.setContentSize(1280, 860);
  await new Promise((r) => setTimeout(r, 300));

  /* --- Uebersetzung wirkt weiterhin --- */
  const lang = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      await setLanguage('en');
      check('Ueberschrift auf Englisch',
        document.querySelector('[data-i18n="login.welcome"]').textContent === 'Welcome back',
        document.querySelector('[data-i18n="login.welcome"]').textContent);
      check('Knopf auf Englisch',
        document.querySelector('[data-i18n="login.submit"]').textContent === 'Sign in');

      await setLanguage('de');
      check('Ueberschrift auf Deutsch',
        document.querySelector('[data-i18n="login.welcome"]').textContent === 'Willkommen zurück');

      return out;
    })()
  `);

  lang.forEach((r) => results.push(r));

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
