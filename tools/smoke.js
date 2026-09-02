/**
 * Startet die App headless, laedt index.html und meldet jeden
 * Konsolenfehler sowie fehlende DOM-Elemente.
 *
 * Aufruf:  npx electron tools/smoke.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

/* Wartezeiten dehnen sich mit JF_TEST_SLOW — CI-Laeufer brauchen
   laenger, bis eine Seite steht. Ohne die Variable bleibt alles
   wie bisher. */
const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const settle = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));


const ROOT = path.join(__dirname, '..');
const errors = [];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // level 2 = warning, 3 = error
    if (level >= 2) {
      errors.push(`[${level === 3 ? 'FEHLER' : 'WARNUNG'}] ${message} (${path.basename(sourceId)}:${line})`);
    }
  });

  win.webContents.on('did-fail-load', (e, code, desc) => {
    errors.push(`Laden fehlgeschlagen: ${desc} (${code})`);
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await settle(1500);

  // Pruefen, ob alle IDs existieren, die der Code anspricht
  const missing = await win.webContents.executeJavaScript(`
    (() => {
      const ids = ${JSON.stringify([
        'dl-modal', 'dl-modal-title', 'dl-options', 'dl-error', 'dl-close',
        'css-editor', 'css-enabled', 'css-save', 'css-copy', 'css-insert',
        'css-reset', 'css-status', 'css-theme-name', 'css-theme-save',
        'ui-scale', 'ui-scale-val', 'card-size', 'set-reduce-motion',
        'dl-dir-path', 'dl-usage', 'dl-choose-dir', 'dl-open-dir',
        'dl-quality', 'dl-delete-watched',
        'set-nextup', 'start-volume', 'start-volume-val',
        'seek-step', 'nextup-seconds', 'nextup-seconds-val',
        'sub-font', 'sub-outline', 'sub-position', 'sub-position-val',
        'theme-grid', 'accent-swatches', 'settings-servers'
      ])};
      return ids.filter((id) => !document.getElementById(id));
    })()
  `);

  // Pruefen, ob die zentralen Funktionen definiert sind
  const undefinedFns = await win.webContents.executeJavaScript(`
    (() => {
      const names = ${JSON.stringify([
        'showOffline', 'openDownloadModal', 'refreshOffline', 'offlineEntry',
        'fileUrl', 'formatBytes', 'updateDownloadButtons', 'isDownloadable',
        'playLocalFile', 'applyCustomCss', 'applyInterface', 'loadCustomThemes',
        'buildThemeGrid', 'enterOfflineMode', 'hasOfflineContent'
      ])};
      return names.filter((n) => typeof window[n] !== 'function' && typeof eval('typeof ' + n) !== 'function');
    })()
  `);

  // Sicht der Bridge pruefen
  const bridge = await win.webContents.executeJavaScript(
    `Boolean(window.downloads && typeof window.downloads.list === 'function')`
  );

  console.log('\n=== SMOKE TEST ===');
  console.log('downloads-Bridge vorhanden:', bridge ? 'ja' : 'NEIN');
  console.log('Fehlende DOM-Elemente:', missing.length ? missing.join(', ') : 'keine');
  console.log('Fehlende Funktionen:', undefinedFns.length ? undefinedFns.join(', ') : 'keine');

  if (errors.length) {
    console.log('\nKonsolenmeldungen:');
    errors.forEach((e) => console.log('  ' + e));
  } else {
    console.log('Konsole: sauber');
  }

  const failed = missing.length || undefinedFns.length || !bridge ||
    errors.some((e) => e.startsWith('[FEHLER]'));

  console.log('\nErgebnis:', failed ? 'FEHLGESCHLAGEN' : 'OK');
  win.destroy();
  app.exit(failed ? 1 : 0);
});
