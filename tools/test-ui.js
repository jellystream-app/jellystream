/**
 * Testet die Renderer-Logik im echten DOM: Custom CSS, Themes,
 * Oberflaechen-Optionen, Byte-Formatierung, file://-Pfade.
 *
 * Aufruf:  npx electron tools/test-ui.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

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
  await new Promise((r) => setTimeout(r, 1200));

  const results = await win.webContents.executeJavaScript(`
    (() => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      /* --- Byte-Formatierung --- */
      check('formatBytes 0', formatBytes(0) === '0 MB', formatBytes(0));
      check('formatBytes KB', formatBytes(2048) === '2 KB', formatBytes(2048));
      check('formatBytes GB', formatBytes(3.5 * 1024 ** 3) === '3,5 GB', formatBytes(3.5 * 1024 ** 3));

      /* --- file://-URL: Windows-Pfade und Sonderzeichen --- */
      const u = fileUrl('C:\\\\Users\\\\Test\\\\Mein Film (2024).mkv');
      check('fileUrl beginnt korrekt', u.startsWith('file:///C%3A/'), u);
      check('fileUrl kodiert Leerzeichen', u.includes('%20'), u);
      check('fileUrl behaelt Trenner', (u.match(/\\//g) || []).length >= 5, u);

      /* --- Custom CSS wird angewandt --- */
      prefs.customCss = ':root { --accent: #ff00ff; }';
      prefs.customCssOn = true;
      applyCustomCss();
      const tag = document.getElementById('jf-custom-css');
      check('CSS-Tag existiert', Boolean(tag));
      check('CSS-Tag steht im head', tag && tag.parentElement === document.head);
      check('CSS-Tag ist das letzte Element', tag && document.head.lastElementChild === tag);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      check('Custom CSS ueberschreibt Akzent', accent === '#ff00ff', accent);

      // Der Akzent muss sich weiterhin normal setzen lassen, solange
      // kein eigenes CSS ihn beansprucht
      prefs.customCss = '';
      applyCustomCss();
      applyAccent('#00ff88');
      const plain = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      check('Akzentwahl wirkt ohne Custom CSS', plain === '#00ff88', plain);

      // Untertitel-Stil darf das Custom-CSS nicht ueberholen
      prefs.customCss = ':root { --accent: #ff00ff; }';
      applyCustomCss();
      applySubtitleStyle();
      const afterSub = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      check('Custom CSS bleibt nach Untertitel-Update aktiv', afterSub === '#ff00ff', afterSub);

      /* --- Abschalten nimmt es zurueck --- */
      prefs.customCssOn = false;
      applyCustomCss();
      check('Abschalten leert das Tag', tag.textContent === '');
      prefs.customCssOn = true;
      prefs.customCss = '';
      applyCustomCss();

      /* --- Vorlage --- */
      check('Vorlage ist nicht leer', CSS_TEMPLATE.length > 500, String(CSS_TEMPLATE.length));
      check('Vorlage enthaelt :root', CSS_TEMPLATE.includes(':root'));
      check('Vorlage nennt --accent', CSS_TEMPLATE.includes('--accent'));
      check('Vorlage nennt --radius', CSS_TEMPLATE.includes('--radius'));
      // Die Vorlage muss gueltiges CSS sein, sonst hilft sie niemandem
      const probe = document.createElement('style');
      probe.textContent = CSS_TEMPLATE;
      document.head.appendChild(probe);
      const ruleCount = probe.sheet ? probe.sheet.cssRules.length : 0;
      check('Vorlage ist gueltiges CSS', ruleCount >= 3, ruleCount + ' Regeln');
      probe.remove();

      /* --- Oberflaechen-Optionen --- */
      prefs.uiScale = 1.2;
      prefs.cardSize = 'large';
      prefs.reduceMotion = true;
      applyInterface();
      check('Schriftgroesse wirkt', document.documentElement.style.fontSize === '19.2px',
            document.documentElement.style.fontSize);
      check('Kartengroesse gesetzt', document.documentElement.getAttribute('data-cards') === 'large');
      check('reduce-motion gesetzt', document.documentElement.classList.contains('reduce-motion'));

      prefs.uiScale = 1; prefs.cardSize = 'normal'; prefs.reduceMotion = false;
      applyInterface();

      /* --- Untertitel-Stil --- */
      prefs.subOutline = true;
      applySubtitleStyle();
      check('Umrandung erzeugt Textschatten', subStyleTag.textContent.includes('1.6px'));
      check('Umrandung schaltet Hintergrund ab', subStyleTag.textContent.includes('rgba(0, 0, 0, 0)'));
      prefs.subOutline = false;
      prefs.subFont = 'serif';
      applySubtitleStyle();
      check('Schriftart wird gesetzt', subStyleTag.textContent.includes('Georgia'));
      prefs.subFont = 'system';
      applySubtitleStyle();

      /* --- Eigene Themes speichern/laden --- */
      localStorage.removeItem('jf-custom-themes');
      saveCustomThemes([{ id: 'custom-x', name: 'Testtheme', css: ':root{--bg:#123456;}', swatch: '#123456' }]);
      const loaded = loadCustomThemes();
      check('Theme gespeichert', loaded.length === 1 && loaded[0].name === 'Testtheme');

      buildThemeGrid();
      const cards = document.querySelectorAll('#theme-grid .theme-card');
      check('Theme erscheint in der Auswahl', cards.length === THEMES.length + 1,
            cards.length + ' Karten');
      check('Eigenes Theme hat Loeschknopf',
            Boolean(document.querySelector('#theme-grid .theme-card.custom .theme-del')));

      /* --- applyTheme setzt Custom-CSS ein --- */
      applyTheme('custom-x');
      check('Custom-Theme setzt CSS', prefs.customCss === ':root{--bg:#123456;}', prefs.customCss);
      check('Custom-Theme entfernt data-theme',
            !document.documentElement.hasAttribute('data-theme'));

      applyTheme('nord');
      check('Eingebautes Theme setzt data-theme',
            document.documentElement.getAttribute('data-theme') === 'nord');

      localStorage.removeItem('jf-custom-themes');
      applyTheme('midnight');
      prefs.customCss = '';
      applyCustomCss();

      /* --- Download-Hilfsfunktionen --- */
      check('Film ist herunterladbar', isDownloadable({ Type: 'Movie', Id: 'a' }));
      check('Folge ist herunterladbar', isDownloadable({ Type: 'Episode', Id: 'b' }));
      check('Serie ist NICHT herunterladbar', !isDownloadable({ Type: 'Series', Id: 'c' }));
      check('Album ist NICHT herunterladbar', !isDownloadable({ Type: 'MusicAlbum', Id: 'd' }));

      /* --- Qualitaetsstufen --- */
      check('Vier Download-Stufen', DL_QUALITIES.length === 4, String(DL_QUALITIES.length));
      check('Original hat keine Bitrate', DL_QUALITIES[0].bitrate === 0);

      /* --- Kontrastfarbe --- */
      check('Heller Akzent -> dunkler Text', contrastOn('#ffffff') === '#0a0e14');
      check('Dunkler Akzent -> heller Text', contrastOn('#101010') === '#ffffff');

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
