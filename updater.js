/* ============================================================
   Automatische Updates (Main-Process)

   Holt neue Fassungen aus den GitHub-Releases von ukyyyy/jellystream.
   Ablauf: pruefen -> im Hintergrund laden -> beim Beenden einspielen.
   Der Nutzer wird informiert, aber nicht unterbrochen.

   Ohne latest.yml im Release findet der Updater nichts. Die Datei
   entsteht beim Bauen mit `npm run release` automatisch und muss dem
   Release beiliegen.
   ============================================================ */

const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let sendToWindow = () => {};
let checkTimer = null;
let state = { status: 'idle', version: null, percent: 0, error: null };

/* Alle sechs Stunden nachsehen. Haeufiger bringt nichts — Releases
   erscheinen selten, und jede Pruefung kostet einen Netzabruf. */
const CHECK_INTERVAL = 6 * 60 * 60 * 1000;
const FIRST_CHECK_DELAY = 8000; // dem Start nicht in die Quere kommen

function setState(patch) {
  state = { ...state, ...patch };
  sendToWindow({ type: 'updater', ...state });
}

function init(notifier) {
  sendToWindow = notifier || (() => {});

  // Wir laden selbst herunter, sobald etwas gefunden wurde
  autoUpdater.autoDownload = true;
  // Nicht mitten in der Sitzung neu starten — erst beim Beenden
  autoUpdater.autoInstallOnAppQuit = true;
  // Vorabversionen nur, wenn die laufende Fassung selbst eine ist
  autoUpdater.allowPrerelease = /-(alpha|beta|rc)/i.test(app.getVersion());

  autoUpdater.logger = {
    info: (m) => console.log('[updater]', m),
    warn: (m) => console.warn('[updater]', m),
    error: (m) => console.error('[updater]', m),
    debug: () => {}
  };

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking', error: null }));

  autoUpdater.on('update-available', (info) => {
    setState({ status: 'downloading', version: info.version, percent: 0 });
  });

  autoUpdater.on('update-not-available', () => setState({ status: 'current', percent: 0 }));

  autoUpdater.on('download-progress', (progress) => {
    setState({ status: 'downloading', percent: Math.round(progress.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    // Wird beim Beenden eingespielt — kein Neustart mitten im Film
    setState({ status: 'ready', version: info.version, percent: 100 });
  });

  autoUpdater.on('error', (error) => {
    const message = error?.message || String(error);
    // Kein Netz oder noch kein Release: kein Grund fuer eine Fehlermeldung
    const harmless = /net::|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|404|no published versions/i.test(message);
    setState({ status: harmless ? 'idle' : 'error', error: harmless ? null : message });
    if (!harmless) console.warn('[updater] Fehler:', message);
  });
}

/** Im Entwicklungslauf gibt es nichts zu aktualisieren. */
function canUpdate() {
  return app.isPackaged;
}

async function check({ silent = true } = {}) {
  if (!canUpdate()) {
    return { skipped: true, reason: 'nur in der installierten Fassung' };
  }

  try {
    const result = await autoUpdater.checkForUpdates();
    return {
      skipped: false,
      version: result?.updateInfo?.version || null,
      current: app.getVersion()
    };
  } catch (error) {
    // Der error-Handler oben hat den Zustand schon gesetzt
    if (!silent) console.warn('[updater] Pruefung fehlgeschlagen:', error.message);
    return { skipped: false, failed: true, error: error.message };
  }
}

function start() {
  if (!canUpdate()) {
    console.log('[updater] Entwicklungslauf — Updates sind abgeschaltet');
    return;
  }

  setTimeout(() => check(), FIRST_CHECK_DELAY);
  checkTimer = setInterval(() => check(), CHECK_INTERVAL);
}

function stop() {
  clearInterval(checkTimer);
  checkTimer = null;
}

/** Sofort einspielen und neu starten — auf ausdruecklichen Wunsch. */
function installNow() {
  if (state.status !== 'ready') return false;
  // isSilent=false zeigt den Installer, isForceRunAfter startet die App danach
  autoUpdater.quitAndInstall(false, true);
  return true;
}

module.exports = {
  init, start, stop, check, installNow,
  getState: () => ({ ...state, current: app.getVersion(), supported: canUpdate() })
};
