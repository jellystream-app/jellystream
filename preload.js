const { contextBridge, ipcRenderer } = require('electron');

// Version aus der package.json statt fest verdrahtet — sonst meldet sich
// die App beim Server mit einer veralteten Nummer.
const pkg = require('./package.json');

contextBridge.exposeInMainWorld('appInfo', {
  name: pkg.build?.productName || 'Jellystream',
  version: pkg.version,
  platform: process.platform
});

// Fenstersteuerung für die selbstgezeichnete Titelleiste.
// Nur diese vier Aktionen sind freigegeben — kein genereller IPC-Zugang.
contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onStateChange: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('window:state', handler);
    return () => ipcRenderer.removeListener('window:state', handler);
  }
});

// Offline-Downloads. Ebenfalls eine feste Liste an Aktionen —
// der Renderer bekommt keinen allgemeinen Dateisystemzugriff.
contextBridge.exposeInMainWorld('downloads', {
  list: () => ipcRenderer.invoke('downloads:list'),
  start: (payload) => ipcRenderer.invoke('downloads:start', payload),
  cancel: (id) => ipcRenderer.invoke('downloads:cancel', id),
  remove: (id) => ipcRenderer.invoke('downloads:remove', id),
  retry: (id) => ipcRenderer.invoke('downloads:retry', id),
  usage: () => ipcRenderer.invoke('downloads:usage'),
  getDir: () => ipcRenderer.invoke('downloads:getDir'),
  chooseDir: () => ipcRenderer.invoke('downloads:chooseDir'),
  openDir: () => ipcRenderer.invoke('downloads:openDir'),
  reveal: (id) => ipcRenderer.invoke('downloads:reveal', id),
  onEvent: (callback) => {
    const handler = (_event, message) => callback(message);
    ipcRenderer.on('downloads:event', handler);
    return () => ipcRenderer.removeListener('downloads:event', handler);
  }
});

// Uebersetzungen: Liste, Strings, Abgleich mit dem Repo, Ordner oeffnen
contextBridge.exposeInMainWorld('languages', {
  list: () => ipcRenderer.invoke('languages:list'),
  get: (code) => ipcRenderer.invoke('languages:get', code),
  sync: (options) => ipcRenderer.invoke('languages:sync', options),
  openFolder: () => ipcRenderer.invoke('languages:openFolder'),
  onUpdated: (callback) => {
    const handler = (_event, result) => callback(result);
    ipcRenderer.on('languages:updated', handler);
    return () => ipcRenderer.removeListener('languages:updated', handler);
  }
});
