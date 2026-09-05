const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const downloads = require('./downloads');
const languages = require('./languages');
const updater = require('./updater');
const discord = require('./discord');

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#0a0e14',
    title: 'Jellystream',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    // Rahmenlos: die Titelleiste wird in der App selbst gezeichnet
    frame: false,
    titleBarStyle: 'hidden',
    // Auf macOS die Ampel-Buttons behalten, aber tiefer einrücken
    trafficLightPosition: { x: 14, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'index.html'));

  /* Externe Adressen gehoeren in den Standardbrowser, nicht in ein
     Fenster der App: dort gaebe es weder Adressleiste noch Zurueck,
     und der Nutzer sitzt in einer Sackgasse.

     Nur http und https werden geoeffnet — bei file:// oder anderen
     Schemata koennte ein praeparierter Link sonst Programme starten. */
  const openExternally = (url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
        return true;
      }
    } catch (error) {
      /* keine gueltige Adresse */
    }
    console.warn('Externe Adresse abgelehnt:', url);
    return false;
  };

  // target="_blank" und window.open()
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  // Ein Klick, der das Fenster selbst wegnavigieren wuerde
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    if (url !== current) {
      event.preventDefault();
      openExternally(url);
    }
  });

  // Die Leiste muss wissen, ob das Fenster maximiert ist (Icon-Wechsel)
  const sendState = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('window:state', {
        maximized: win.isMaximized(),
        fullscreen: win.isFullScreen()
      });
    }
  };

  win.on('maximize', sendState);
  win.on('unmaximize', sendState);
  win.on('enter-full-screen', sendState);
  win.on('leave-full-screen', sendState);
  win.webContents.on('did-finish-load', sendState);

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  return win;
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.on('window:minimize', (event) => windowFromEvent(event)?.minimize());

ipcMain.on('window:maximize', (event) => {
  const win = windowFromEvent(event);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on('window:close', (event) => windowFromEvent(event)?.close());

ipcMain.handle('window:isMaximized', (event) => Boolean(windowFromEvent(event)?.isMaximized()));

/* ======================= DOWNLOADS ======================= */

ipcMain.handle('downloads:list', () => downloads.verify());
ipcMain.handle('downloads:start', (event, payload) => downloads.start(payload));
ipcMain.handle('downloads:cancel', (event, id) => downloads.cancel(id));
ipcMain.handle('downloads:remove', (event, id) => downloads.remove(id));
ipcMain.handle('downloads:retry', (event, id) => downloads.retry(id));
ipcMain.handle('downloads:usage', () => downloads.usage());
ipcMain.handle('downloads:getDir', () => downloads.getDir());
ipcMain.handle('downloads:chooseDir', (event) => downloads.chooseDir(windowFromEvent(event)));
ipcMain.handle('downloads:openDir', () => downloads.openDir());
ipcMain.handle('downloads:reveal', (event, id) => downloads.revealFile(id));

/* ======================= SPRACHEN ======================= */

ipcMain.handle('languages:list', () => languages.list());
ipcMain.handle('languages:get', (event, code) => languages.get(code));
ipcMain.handle('languages:sync', (event, options) => languages.sync(options || {}));
ipcMain.handle('languages:openFolder', () => languages.openFolder());

/* ======================= DISCORD ======================= */

ipcMain.handle('discord:enable', () => discord.enable());
ipcMain.handle('discord:setClientId', (event, id) => discord.setClientId(id));
ipcMain.handle('discord:disable', () => discord.disable());
ipcMain.handle('discord:setActivity', (event, payload) => discord.setActivity(payload));
ipcMain.handle('discord:clear', () => discord.clear());
ipcMain.handle('discord:state', () => discord.getState());

/* ======================= UPDATES ======================= */

ipcMain.handle('updater:state', () => updater.getState());
ipcMain.handle('updater:check', () => updater.check({ silent: false }));
ipcMain.handle('updater:install', () => updater.installNow());

app.whenReady().then(() => {
  languages.init();

  const win = createWindow();

  // Der Manager meldet Fortschritt und Listenaenderungen an genau dieses Fenster
  downloads.init((message) => {
    if (!win.isDestroyed()) win.webContents.send('downloads:event', message);
  });

  // Der Updater meldet Fortschritt an dasselbe Fenster
  updater.init((message) => {
    if (!win.isDestroyed()) win.webContents.send('updater:event', message);
  });

  /* Im Hintergrund nach neuen Uebersetzungen sehen — hoechstens einmal
     taeglich. Scheitert es (offline), passiert nichts Sichtbares. */
  win.webContents.once('did-finish-load', () => {
    languages.sync().then((result) => {
      if (!win.isDestroyed() && (result.added || result.updated)) {
        win.webContents.send('languages:updated', result);
      }
    }).catch(() => {});

    // Erst nach dem Laden nach Updates sehen, damit der Start flott bleibt
    updater.start();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Laufende Uebertragungen abbrechen, bevor der Prozess endet
app.on('before-quit', () => {
  downloads.shutdown();
  updater.stop();
  // Sonst bleibt die Praesenz in Discord stehen, obwohl die App zu ist
  discord.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
