/* ============================================================
   Themes, Einstellungen, Server-Verwaltung, Playlists
   Erwartet die Globals aus renderer.js ($, state, api, ...)
   ============================================================ */

/* ============================== THEMES ============================== */

const THEMES = [
  { id: 'midnight',  name: 'Mitternacht', colors: ['#0a0e14', '#141c28', '#1ecad3'] },
  { id: 'onyx',      name: 'Onyx',        colors: ['#08080a', '#141417', '#1ecad3'] },
  { id: 'graphite',  name: 'Graphit',     colors: ['#16181d', '#22252c', '#1ecad3'] },
  { id: 'plum',      name: 'Pflaume',     colors: ['#120b18', '#1f1429', '#c86bd8'] },
  { id: 'forest',    name: 'Wald',        colors: ['#08130f', '#11241c', '#3ddc97'] },
  { id: 'nord',      name: 'Nord',        colors: ['#2e3440', '#3b4252', '#88c0d0'] },
  { id: 'light',     name: 'Hell',        colors: ['#f4f6fa', '#ffffff', '#0e9bb0'] }
];

const ACCENTS = ['#1ecad3', '#00a4dc', '#aa5cc3', '#e5a00d', '#e0303f', '#3ddc97', '#ff7ac6', '#7c8cff'];

const prefs = {
  theme: 'midnight',
  accent: '#1ecad3',
  autoplayNext: true,
  preferSubtitles: false,
  resumePlayback: true,
  subSize: 1,
  subBg: 0.76,
  subColor: '#ffffff',
  lyricsOffset: 0,

  /* --- Wiedergabe --- */
  startVolume: 1,
  seekStep: 10,
  nextupSeconds: 12,
  showNextup: true,

  /* --- Untertitel --- */
  subFont: 'system',
  subOutline: false,
  subPosition: 0,

  /* --- Oberfläche --- */
  uiScale: 1,
  cardSize: 'normal',
  reduceMotion: false,

  /* --- Downloads --- */
  dlQuality: 'ask',
  dlDeleteWatched: false,

  /* --- Eigenes CSS --- */
  customCss: '',
  customCssOn: true
};

/* X5: Untertitel-Darstellung auf ::cue übertragen */
let subStyleTag = null;

const SUB_FONTS = {
  system: 'system-ui, "Segoe UI", sans-serif',
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Cascadia Code", Consolas, monospace',
  rounded: '"Segoe UI Variable", "Nunito", system-ui, sans-serif'
};

function applySubtitleStyle() {
  if (!subStyleTag) {
    subStyleTag = document.createElement('style');
    document.head.appendChild(subStyleTag);
  }

  // Umrandung statt Kasten: vier Schatten zeichnen die Kontur nach
  const outline = prefs.subOutline
    ? `-1.6px -1.6px 0 #000, 1.6px -1.6px 0 #000, -1.6px 1.6px 0 #000, 1.6px 1.6px 0 #000`
    : '0 1px 3px rgba(0,0,0,0.9)';

  subStyleTag.textContent = `
    video::cue {
      background: rgba(0, 0, 0, ${prefs.subOutline ? 0 : prefs.subBg});
      color: ${prefs.subColor};
      font-family: ${SUB_FONTS[prefs.subFont] || SUB_FONTS.system};
      font-size: ${(1.02 * prefs.subSize).toFixed(2)}em;
      line-height: 1.4;
      text-shadow: ${outline};
    }`;

  // Position: Chromium erlaubt kein ::cue-Offset, also wird der
  // Textspur-Container selbst nach oben geschoben.
  document.documentElement.style.setProperty('--sub-lift', `${prefs.subPosition}px`);

  const preview = $('sub-preview');
  if (preview) {
    preview.style.setProperty('--sub-scale', prefs.subSize);
    preview.style.setProperty('--sub-bg', prefs.subBg);
    preview.style.setProperty('--sub-color', prefs.subColor);
  }
}

/* ==================== EIGENES CSS ====================
   Das Tag haengt am Ende des <head> — spaeter als styles.css und
   damit gewinnt es bei gleicher Spezifitaet. Kein !important noetig.
   ====================================================== */

let customStyleTag = null;

function applyCustomCss() {
  if (!customStyleTag) {
    customStyleTag = document.createElement('style');
    customStyleTag.id = 'jf-custom-css';
  }

  // Immer als letztes Element im head — nur so gewinnt es bei gleicher
  // Spezifitaet gegen styles.css und den Akzent-Block.
  if (document.head.lastElementChild !== customStyleTag) {
    document.head.appendChild(customStyleTag);
  }

  customStyleTag.textContent = prefs.customCssOn ? (prefs.customCss || '') : '';
}

/* Oberflaechen-Optionen, die nur CSS-Variablen setzen */
function applyInterface() {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', prefs.uiScale);
  root.style.fontSize = `${(16 * prefs.uiScale).toFixed(1)}px`;
  root.setAttribute('data-cards', prefs.cardSize);
  root.classList.toggle('reduce-motion', Boolean(prefs.reduceMotion));
}

function loadPrefs() {
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem('jf-prefs') || '{}'));
  } catch (error) {
    /* Standardwerte behalten */
  }
  applyTheme(prefs.theme);
  applyAccent(prefs.accent);
  applySubtitleStyle();
  applyInterface();
  applyCustomCss();
}

function savePrefs() {
  try {
    localStorage.setItem('jf-prefs', JSON.stringify(prefs));
  } catch (error) {
    console.warn('Einstellungen konnten nicht gespeichert werden');
  }
}

function applyTheme(id) {
  prefs.theme = id;

  // Ein eigenes Theme setzt sein CSS ein und nutzt Mitternacht als Basis
  const custom = loadCustomThemes().find((theme) => theme.id === id);
  if (custom) {
    document.documentElement.removeAttribute('data-theme');
    prefs.customCss = custom.css;
    applyCustomCss();
    return;
  }

  if (id === 'midnight') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', id);
}

/* ---------------- Eigene, benannte Themes ---------------- */

function loadCustomThemes() {
  try {
    const raw = JSON.parse(localStorage.getItem('jf-custom-themes') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    return [];
  }
}

function saveCustomThemes(themes) {
  try {
    localStorage.setItem('jf-custom-themes', JSON.stringify(themes));
  } catch (error) {
    toast(t('common.error'), true);
  }
}

/* Vorlage fuer den CSS-Editor — kommentiert, damit man sofort sieht,
   an welchen Stellschrauben man drehen kann. */
const CSS_TEMPLATE = `/* ========================================
   Eigenes Design für Jellystream
   Alles hier überschreibt das gewählte Theme.
   ======================================== */

:root {
  /* --- Flächen (von dunkel nach hell) --- */
  --bg:        #0a0e14;   /* Seitenhintergrund */
  --bg-2:      #0f1620;   /* Dialoge */
  --surface:   #141c28;   /* Karten, Kacheln */
  --surface-2: #1a2432;   /* Eingabefelder */
  --surface-3: #222e40;   /* Schalter, Regler */
  --sidebar:   #0c1219;   /* Navigationsleiste */

  /* --- Akzent --- */
  --accent:      #1ecad3; /* Knöpfe, Hervorhebungen */
  --accent-2:    #16a6b8; /* Akzent beim Hovern */
  --accent-soft: rgba(30, 202, 211, 0.14);
  --on-accent:   #06222a; /* Text auf Akzentfläche */

  /* --- Text --- */
  --text:    #f2f6fb;     /* Haupttext */
  --muted:   #9fb0c5;     /* Nebentext */
  --muted-2: #6b7d94;     /* Hinweise */

  /* --- Linien & Form --- */
  --border:   rgba(255, 255, 255, 0.07);
  --border-2: rgba(255, 255, 255, 0.12);
  --danger:   #ff6b6b;
  --radius:   14px;       /* Eckenrundung */
  --shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.55);
}

/* --- Beispiel 1: rundere Karten mit farbigem Rand beim Hovern --- */
.card-inner {
  border-radius: 18px;
}
.card:hover .card-inner {
  border-color: var(--accent);
}

/* --- Beispiel 2: stärker abgesetzte Navigationsleiste --- */
.navbar.solid {
  backdrop-filter: blur(18px) saturate(140%);
}

/* --- Beispiel 3: eigene Schrift für Titel --- */
/*
.section-title,
.card-title {
  font-family: Georgia, serif;
  letter-spacing: 0;
}
*/
`;

// Kontrastfarbe bestimmen, damit Text auf dem Akzent lesbar bleibt
function contrastOn(hex) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Wahrgenommene Helligkeit (ITU-R BT.601)
  const luminance = (r * 299 + g * 587 + b * 114) / 1000;
  return luminance > 150 ? '#0a0e14' : '#ffffff';
}

function shade(hex, amount) {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const nums = [0, 2, 4].map((i) => {
    const value = Math.round(parseInt(full.slice(i, i + 2), 16) * (1 + amount));
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
  });
  return `#${nums.join('')}`;
}

/* Die Akzentfarbe kommt aus einem eigenen <style>-Tag statt als
   Inline-Style auf <html>. Inline-Styles schlagen jedes Stylesheet —
   eigenes CSS koennte den Akzent sonst gar nicht ueberschreiben. */
let accentStyleTag = null;

function applyAccent(hex) {
  prefs.accent = hex;

  if (!accentStyleTag) {
    accentStyleTag = document.createElement('style');
    accentStyleTag.id = 'jf-accent';
    // Vor dem Custom-CSS einhaengen, damit eigenes CSS gewinnt
    if (customStyleTag && customStyleTag.parentElement === document.head) {
      document.head.insertBefore(accentStyleTag, customStyleTag);
    } else {
      document.head.appendChild(accentStyleTag);
    }
  }

  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));

  accentStyleTag.textContent = `:root {
    --accent: ${hex};
    --accent-2: ${shade(hex, -0.18)};
    --on-accent: ${contrastOn(hex)};
    --accent-soft: rgba(${r}, ${g}, ${b}, 0.14);
  }`;
}

/* ============================ TOAST ============================ */

let toastTimer = null;

function toast(message, isError = false) {
  const node = $('toast');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 3200);
}

/* ======================= SERVER-VERWALTUNG ======================= */

function loadServers() {
  try {
    return JSON.parse(localStorage.getItem('jf-servers') || '[]');
  } catch (error) {
    return [];
  }
}

function saveServers(servers) {
  try {
    localStorage.setItem('jf-servers', JSON.stringify(servers));
  } catch (error) {
    console.warn('Server konnten nicht gespeichert werden');
  }
}

// Ein Eintrag pro Server+Benutzer — derselbe Server mit zwei Konten ist erlaubt
function rememberServer(entry) {
  const servers = loadServers();
  const index = servers.findIndex(
    (s) => s.serverUrl === entry.serverUrl && s.userId === entry.userId
  );
  if (index >= 0) servers[index] = { ...servers[index], ...entry };
  else servers.push(entry);
  saveServers(servers);
  renderServerList();
}

function forgetServer(serverUrl, userId) {
  saveServers(loadServers().filter((s) => !(s.serverUrl === serverUrl && s.userId === userId)));
  renderServerList();
  renderSettingsServers();
}

function renderServerList() {
  const host = $('server-list');
  if (!host) return;

  const servers = loadServers();
  host.innerHTML = '';

  // Bei nur einem Konto ist die Liste überflüssig
  if (servers.length < 2) return;

  servers.forEach((entry) => {
    const isActive = entry.serverUrl === state.serverUrl && entry.userId === state.userId;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `server-entry ${isActive ? 'active' : ''}`;
    btn.innerHTML = `
      <span class="server-dot"></span>
      <span class="server-meta">
        <strong>${escapeHtml(entry.username || t('profile.user'))}</strong>
        <small>${escapeHtml(entry.serverName || entry.serverUrl)}</small>
      </span>`;
    btn.addEventListener('click', () => {
      if (isActive) return closeMenus();
      switchToServer(entry);
    });
    host.appendChild(btn);
  });
}

async function switchToServer(entry) {
  closeMenus();

  if (!entry.token) {
    toast(t('server.needsLogin'), true);
    return openServerModal(entry.serverUrl, entry.username);
  }

  const previous = { serverUrl: state.serverUrl, token: state.token, userId: state.userId, username: state.username };

  state.serverUrl = entry.serverUrl;
  state.token = entry.token;
  state.userId = entry.userId;
  state.username = entry.username;

  try {
    // Token prüfen — er kann serverseitig widerrufen sein
    await api(`/Users/${state.userId}`);
  } catch (error) {
    Object.assign(state, previous);
    toast(t('server.sessionExpired'), true);
    return openServerModal(entry.serverUrl, entry.username);
  }

  music.stop();
  closeVideo();

  try {
    localStorage.setItem('jf-session', JSON.stringify({
      serverUrl: state.serverUrl, token: state.token,
      userId: state.userId, username: state.username
    }));
  } catch (error) {
    /* ignorieren */
  }

  await enterApp();
  toast(t('server.switched', { name: entry.username }));
}

/* --- Dialog "Server hinzufügen" --- */

function openServerModal(prefillUrl = '', prefillUser = '') {
  $('new-server-url').value = prefillUrl || '';
  $('new-username').value = prefillUser || '';
  $('new-password').value = '';
  $('server-error').textContent = '';
  $('server-modal').classList.remove('hidden');
  setTimeout(() => (prefillUrl ? $('new-password') : $('new-server-url')).focus(), 60);
}

$('add-server-btn').addEventListener('click', () => {
  closeMenus();
  openServerModal();
});

$('server-close').addEventListener('click', () => $('server-modal').classList.add('hidden'));

$('server-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const submit = $('server-submit');
  const errorBox = $('server-error');
  errorBox.textContent = '';

  const url = normalizeServerUrl($('new-server-url').value.trim());
  const username = $('new-username').value.trim();
  const password = $('new-password').value;

  if (!url || !username) {
    errorBox.textContent = t('login.enterCredentials');
    return;
  }

  submit.disabled = true;
  submit.classList.add('loading');

  try {
    const auth = await authenticate(url, username, password);

    let serverName = url;
    try {
      const info = await fetch(`${url}/System/Info/Public`).then((r) => r.json());
      if (info?.ServerName) serverName = info.ServerName;
    } catch (error) {
      /* Name ist optional */
    }

    rememberServer({
      serverUrl: url,
      serverName,
      userId: auth.userId,
      username: auth.userName,
      token: auth.accessToken
    });

    $('server-modal').classList.add('hidden');
    await switchToServer({
      serverUrl: url, serverName, userId: auth.userId,
      username: auth.userName, token: auth.accessToken
    });
  } catch (error) {
    errorBox.textContent = error.message || t('login.failed');
  } finally {
    submit.disabled = false;
    submit.classList.remove('loading');
  }
});

/* ========================== EINSTELLUNGEN ========================== */

function buildThemeGrid() {
  const host = $('theme-grid');
  host.innerHTML = '';

  THEMES.forEach((theme) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-card ${prefs.theme === theme.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="theme-preview" style="background:${theme.colors[0]}">
        <i style="background:${theme.colors[1]}"></i>
        <i style="background:${theme.colors[2]}"></i>
        <i style="background:${theme.colors[1]}"></i>
      </div>
      <span class="theme-name">${escapeHtml(theme.name)}</span>`;
    card.addEventListener('click', () => {
      // Beim Wechsel auf ein eingebautes Theme das Theme-CSS zurücknehmen,
      // sonst überlagert ein zuvor geladenes Custom-Theme die Farben weiter.
      const wasCustom = loadCustomThemes().some((t) => t.id === prefs.theme);
      if (wasCustom) {
        prefs.customCss = '';
        applyCustomCss();
        const editor = $('css-editor');
        if (editor) editor.value = '';
      }
      applyTheme(theme.id);
      savePrefs();
      buildThemeGrid();
    });
    host.appendChild(card);
  });

  // Eigene Themes hinten anhängen
  loadCustomThemes().forEach((theme) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `theme-card custom ${prefs.theme === theme.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="theme-preview" style="background:${escapeHtml(theme.swatch || '#141c28')}">
        <i style="background:var(--surface-2)"></i>
        <i style="background:var(--accent)"></i>
        <i style="background:var(--surface-2)"></i>
      </div>
      <span class="theme-name">${escapeHtml(theme.name)}</span>
      <span class="theme-del" role="button" tabindex="0" title="${escapeHtml(t('settings.themeDelete'))}" aria-label="${escapeHtml(t('settings.themeDelete'))}">✕</span>`;

    card.addEventListener('click', (event) => {
      if (event.target.classList.contains('theme-del')) {
        event.stopPropagation();
        saveCustomThemes(loadCustomThemes().filter((t) => t.id !== theme.id));
        if (prefs.theme === theme.id) {
          prefs.theme = 'midnight';
          prefs.customCss = '';
          applyTheme('midnight');
          applyCustomCss();
          const editor = $('css-editor');
          if (editor) editor.value = '';
        }
        savePrefs();
        buildThemeGrid();
        toast(t('settings.themeDelete'));
        return;
      }

      applyTheme(theme.id);
      savePrefs();
      const editor = $('css-editor');
      if (editor) editor.value = theme.css;
      buildThemeGrid();
    });

    host.appendChild(card);
  });
}

function buildAccentSwatches() {
  const host = $('accent-swatches');
  host.innerHTML = '';

  ACCENTS.forEach((color) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `accent-dot ${prefs.accent.toLowerCase() === color.toLowerCase() ? 'active' : ''}`;
    dot.style.background = color;
    dot.setAttribute('aria-label', `Akzentfarbe ${color}`);
    dot.addEventListener('click', () => {
      applyAccent(color);
      savePrefs();
      host.querySelectorAll('.accent-dot').forEach((d) => d.classList.remove('active'));
      dot.classList.add('active');
      $('accent-picker').value = color;
    });
    host.appendChild(dot);
  });
}

function renderSettingsServers() {
  const host = $('settings-servers');
  const servers = loadServers();

  if (!servers.length) {
    host.innerHTML = `<p class="settings-hint">${escapeHtml(t('server.none'))}</p>`;
    return;
  }

  host.innerHTML = '';
  servers.forEach((entry) => {
    const isActive = entry.serverUrl === state.serverUrl && entry.userId === state.userId;
    const row = document.createElement('div');
    row.className = 'settings-server-row';
    row.innerHTML = `
      <span class="server-dot" style="${isActive ? '' : 'opacity:.4'}"></span>
      <span class="server-meta">
        <strong>${escapeHtml(entry.serverName || entry.serverUrl)}</strong>
        <small>${escapeHtml(entry.username)} · ${escapeHtml(entry.serverUrl)}${isActive ? ` · ${escapeHtml(t('server.active'))}` : ''}</small>
      </span>
      <button class="remove-server" type="button" title="${escapeHtml(t('common.remove'))}" aria-label="${escapeHtml(t('server.removeAria'))}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>`;

    row.querySelector('.remove-server').addEventListener('click', () => {
      if (isActive) return toast(t('server.cannotRemoveActive'), true);
      forgetServer(entry.serverUrl, entry.userId);
      toast(t('server.removed'));
    });

    host.appendChild(row);
  });
}

async function openSettings() {
  closeMenus();
  buildThemeGrid();
  buildAccentSwatches();
  renderSettingsServers();
  buildSeekStepOptions();
  renderLanguageList();

  $('accent-picker').value = prefs.accent;
  $('set-autoplay').checked = prefs.autoplayNext;
  $('set-subs').checked = prefs.preferSubtitles;
  $('set-resume').checked = prefs.resumePlayback;

  $('sub-size').value = prefs.subSize;
  $('sub-size-val').textContent = `${Math.round(prefs.subSize * 100)} %`;
  $('sub-bg').value = prefs.subBg;
  $('sub-bg-val').textContent = `${Math.round(prefs.subBg * 100)} %`;
  $('sub-color').value = prefs.subColor;
  $('lyrics-offset').value = prefs.lyricsOffset;
  $('lyrics-offset-val').textContent = `${prefs.lyricsOffset.toFixed(1).replace('.', ',')} s`;

  /* --- Wiedergabe --- */
  $('set-nextup').checked = prefs.showNextup;
  $('start-volume').value = prefs.startVolume;
  $('start-volume-val').textContent = `${Math.round(prefs.startVolume * 100)} %`;
  $('seek-step').value = String(prefs.seekStep);
  $('nextup-seconds').value = prefs.nextupSeconds;
  $('nextup-seconds-val').textContent = `${prefs.nextupSeconds} s`;

  /* --- Untertitel --- */
  $('sub-font').value = prefs.subFont;
  $('sub-outline').checked = prefs.subOutline;
  $('sub-position').value = prefs.subPosition;
  $('sub-position-val').textContent = prefs.subPosition
    ? `${prefs.subPosition} px`
    : t('settings.subPositionDefault');

  /* --- Oberfläche --- */
  $('ui-scale').value = prefs.uiScale;
  $('ui-scale-val').textContent = `${Math.round(prefs.uiScale * 100)} %`;
  $('card-size').value = prefs.cardSize;
  $('set-reduce-motion').checked = prefs.reduceMotion;

  /* --- Eigenes CSS --- */
  $('css-editor').value = prefs.customCss || '';
  $('css-enabled').checked = prefs.customCssOn;
  $('css-status').textContent = '';
  $('css-theme-name').value = '';

  /* --- Downloads --- */
  refreshDownloadSettings();

  /* --- Updates --- */
  refreshUpdateState();

  $('dl-quality').value = prefs.dlQuality;
  $('dl-delete-watched').checked = prefs.dlDeleteWatched;

  applySubtitleStyle();

  $('about-app').textContent = window.appInfo?.name || 'Jellystream';
  $('about-user').textContent = state.username || '—';
  $('about-server').textContent = state.serverUrl || '—';

  // Zuletzt gewählte Kategorie wiederherstellen
  let lastCat = 'design';
  try {
    lastCat = localStorage.getItem('jf-settings-cat') || 'design';
  } catch (error) {
    /* Standard behalten */
  }
  showSettingsCategory(document.querySelector(`.settings-cat[data-cat="${lastCat}"]`) ? lastCat : 'design');

  $('settings-modal').classList.remove('hidden');
  document.body.classList.add('settings-open');

  try {
    const info = await api('/System/Info');
    $('about-server').textContent = info?.ServerName || state.serverUrl;
    $('about-version').textContent = info?.Version ? `Jellyfin ${info.Version}` : '—';
  } catch (error) {
    $('about-version').textContent = window.appInfo?.version || '—';
  }
}

$('settings-btn').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', () => closeSettings());

$('accent-picker').addEventListener('input', (event) => {
  applyAccent(event.target.value);
  document.querySelectorAll('.accent-dot').forEach((d) => d.classList.remove('active'));
});
$('accent-picker').addEventListener('change', savePrefs);

$('set-autoplay').addEventListener('change', (e) => { prefs.autoplayNext = e.target.checked; savePrefs(); });
$('set-subs').addEventListener('change', (e) => { prefs.preferSubtitles = e.target.checked; savePrefs(); });
$('set-resume').addEventListener('change', (e) => { prefs.resumePlayback = e.target.checked; savePrefs(); });

/* X5: Untertitel-Regler */
$('sub-size').addEventListener('input', (e) => {
  prefs.subSize = Number(e.target.value);
  $('sub-size-val').textContent = `${Math.round(prefs.subSize * 100)} %`;
  applySubtitleStyle();
});
$('sub-bg').addEventListener('input', (e) => {
  prefs.subBg = Number(e.target.value);
  $('sub-bg-val').textContent = `${Math.round(prefs.subBg * 100)} %`;
  applySubtitleStyle();
});
$('sub-color').addEventListener('input', (e) => {
  prefs.subColor = e.target.value;
  applySubtitleStyle();
});
['sub-size', 'sub-bg', 'sub-color'].forEach((id) => {
  $(id).addEventListener('change', savePrefs);
});

/* ------------------- Wiedergabe (erweitert) ------------------- */

$('set-nextup').addEventListener('change', (e) => { prefs.showNextup = e.target.checked; savePrefs(); });

$('start-volume').addEventListener('input', (e) => {
  prefs.startVolume = Number(e.target.value);
  $('start-volume-val').textContent = `${Math.round(prefs.startVolume * 100)} %`;
});
$('start-volume').addEventListener('change', savePrefs);

$('seek-step').addEventListener('change', (e) => {
  prefs.seekStep = Number(e.target.value);
  savePrefs();
});

$('nextup-seconds').addEventListener('input', (e) => {
  prefs.nextupSeconds = Number(e.target.value);
  $('nextup-seconds-val').textContent = `${prefs.nextupSeconds} s`;
});
$('nextup-seconds').addEventListener('change', savePrefs);

/* ------------------- Untertitel (erweitert) ------------------- */

$('sub-font').addEventListener('change', (e) => {
  prefs.subFont = e.target.value;
  applySubtitleStyle();
  savePrefs();
});

$('sub-outline').addEventListener('change', (e) => {
  prefs.subOutline = e.target.checked;
  applySubtitleStyle();
  savePrefs();
});

$('sub-position').addEventListener('input', (e) => {
  prefs.subPosition = Number(e.target.value);
  $('sub-position-val').textContent = prefs.subPosition ? `${prefs.subPosition} px` : 'Standard';
  applySubtitleStyle();
});
$('sub-position').addEventListener('change', savePrefs);

/* ------------------------ Oberfläche ------------------------ */

$('ui-scale').addEventListener('input', (e) => {
  prefs.uiScale = Number(e.target.value);
  $('ui-scale-val').textContent = `${Math.round(prefs.uiScale * 100)} %`;
  applyInterface();
});
$('ui-scale').addEventListener('change', savePrefs);

$('card-size').addEventListener('change', (e) => {
  prefs.cardSize = e.target.value;
  applyInterface();
  savePrefs();
});

$('set-reduce-motion').addEventListener('change', (e) => {
  prefs.reduceMotion = e.target.checked;
  applyInterface();
  savePrefs();
});

/* ===================== EIGENES CSS ===================== */

let cssPreviewTimer = null;

/* Live-Vorschau beim Tippen, damit man das Ergebnis sofort sieht.
   Entprellt, sonst wird bei jedem Tastendruck neu geparst. */
$('css-editor').addEventListener('input', (event) => {
  clearTimeout(cssPreviewTimer);
  cssPreviewTimer = setTimeout(() => {
    prefs.customCss = event.target.value;
    applyCustomCss();
    $('css-status').textContent = t('settings.cssPreview');
    $('css-status').className = 'css-status pending';
  }, 350);
});

$('css-enabled').addEventListener('change', (e) => {
  prefs.customCssOn = e.target.checked;
  applyCustomCss();
  savePrefs();
});

$('css-save').addEventListener('click', () => {
  prefs.customCss = $('css-editor').value;
  applyCustomCss();
  savePrefs();
  $('css-status').textContent = t('settings.cssSaved');
  $('css-status').className = 'css-status ok';
  toast(t('settings.cssSaved'));
});

$('css-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(CSS_TEMPLATE);
    $('css-status').textContent = t('settings.cssCopied');
    $('css-status').className = 'css-status ok';
    toast(t('settings.cssCopied'));
  } catch (error) {
    // Fallback für den Fall, dass die Zwischenablage gesperrt ist
    const editor = $('css-editor');
    editor.value = CSS_TEMPLATE;
    editor.select();
    toast(t('settings.cssInserted'), true);
  }
});

$('css-insert').addEventListener('click', () => {
  const editor = $('css-editor');

  if (editor.value.trim() && !confirm(t('settings.cssOverwriteConfirm'))) {
    return;
  }

  editor.value = CSS_TEMPLATE;
  prefs.customCss = CSS_TEMPLATE;
  applyCustomCss();
  $('css-status').textContent = t('settings.cssInserted');
  $('css-status').className = 'css-status pending';
  editor.focus();
});

$('css-reset').addEventListener('click', () => {
  $('css-editor').value = '';
  prefs.customCss = '';
  applyCustomCss();
  savePrefs();
  $('css-status').textContent = t('settings.cssResetDone');
  $('css-status').className = 'css-status ok';
  toast(t('settings.cssResetDone'));
});

/* Aktuelles CSS unter einem Namen als Theme ablegen */
$('css-theme-save').addEventListener('click', () => {
  const name = $('css-theme-name').value.trim();
  const css = $('css-editor').value.trim();

  if (!name) return toast(t('common.error'), true);
  if (!css) return toast(t('common.error'), true);

  const themes = loadCustomThemes();
  if (themes.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    return toast(t('common.error'), true);
  }

  // Erste --bg-Farbe als Vorschaufarbe der Kachel herausziehen
  const match = css.match(/--bg\s*:\s*([^;]+);/);

  const theme = {
    id: `custom-${Date.now().toString(36)}`,
    name,
    css,
    swatch: match ? match[1].trim() : '#141c28'
  };

  themes.push(theme);
  saveCustomThemes(themes);

  prefs.theme = theme.id;
  prefs.customCss = css;
  applyCustomCss();
  savePrefs();

  $('css-theme-name').value = '';
  buildThemeGrid();
  toast(t('settings.cssSaved'));
});

/* ====================== DOWNLOADS ====================== */

async function refreshDownloadSettings() {
  const bridge = window.downloads;
  const pathNode = $('dl-dir-path');
  const usageNode = $('dl-usage');

  if (!bridge) {
    pathNode.textContent = t('settings.desktopOnly');
    usageNode.textContent = '—';
    $('dl-choose-dir').disabled = true;
    $('dl-open-dir').disabled = true;
    return;
  }

  try {
    const usage = await bridge.usage();
    pathNode.textContent = usage.dir || '—';
    usageNode.textContent = `${formatBytes(usage.bytes)} in ${usage.count} ${usage.count === 1 ? 'Titel' : 'Titeln'}`;
  } catch (error) {
    pathNode.textContent = '—';
    usageNode.textContent = '—';
  }
}

$('dl-choose-dir').addEventListener('click', async () => {
  if (!window.downloads) return;
  const result = await window.downloads.chooseDir();
  if (result.changed) {
    await refreshDownloadSettings();
    toast(t('settings.storageChanged'));
  }
});

$('dl-open-dir').addEventListener('click', () => window.downloads?.openDir());

$('dl-quality').addEventListener('change', (e) => {
  prefs.dlQuality = e.target.value;
  savePrefs();
});

$('dl-delete-watched').addEventListener('change', (e) => {
  prefs.dlDeleteWatched = e.target.checked;
  savePrefs();
});

/* X6: Songtext-Versatz */
$('lyrics-offset').addEventListener('input', (e) => {
  prefs.lyricsOffset = Number(e.target.value);
  $('lyrics-offset-val').textContent = `${prefs.lyricsOffset.toFixed(1).replace('.', ',')} s`;
  // Sofort neu einsortieren
  if (typeof music !== 'undefined') music.activeLyric = -1;
});
$('lyrics-offset').addEventListener('change', savePrefs);

/* ============ A2: FOKUS IN DIALOGEN HALTEN ============ */
let lastFocused = null;

function trapFocus(modal) {
  const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  const onKey = (event) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll(selector)).filter((n) => n.offsetParent !== null);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  modal.addEventListener('keydown', onKey);
  return () => modal.removeEventListener('keydown', onKey);
}

// Öffnen/Schließen der Dialoge beobachten und Fokus richtig setzen
document.querySelectorAll('.modal').forEach((modal) => {
  let releaseTrap = null;

  const observer = new MutationObserver(() => {
    const isOpen = !modal.classList.contains('hidden');

    if (isOpen && !releaseTrap) {
      lastFocused = document.activeElement;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      releaseTrap = trapFocus(modal);

      const first = modal.querySelector('input:not([type="hidden"]), button');
      if (first) setTimeout(() => first.focus(), 60);
    } else if (!isOpen && releaseTrap) {
      releaseTrap();
      releaseTrap = null;
      modal.removeAttribute('aria-modal');
      // Zurück zum auslösenden Element
      if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
      lastFocused = null;
    }
  });

  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
});

/* ==================== X8: QUICK CONNECT ==================== */
let qcTimer = null;

async function startQuickConnect() {
  const url = normalizeServerUrl($('server-url').value.trim());
  if (!url) {
    setAuthError(t('login.enterServer'));
    return;
  }

  const box = $('quick-connect-box');
  const codeEl = $('qc-code');
  const statusEl = $('qc-status');

  box.classList.remove('hidden');
  $('quick-connect-btn').classList.add('hidden');
  codeEl.textContent = '– – – – – –';
  statusEl.textContent = t('common.loading');

  try {
    const enabled = await fetch(`${url}/QuickConnect/Enabled`).then((r) => r.json()).catch(() => false);
    if (!enabled) {
      statusEl.textContent = t('common.error');
      return;
    }

    const init = await fetch(`${url}/QuickConnect/Initiate`, {
      headers: { Authorization: buildAuthHeader() }
    }).then((r) => r.json());

    codeEl.textContent = init.Code || '?';
    statusEl.textContent = t('common.loading');

    clearInterval(qcTimer);
    qcTimer = setInterval(async () => {
      try {
        const check = await fetch(
          `${url}/QuickConnect/Connect?secret=${encodeURIComponent(init.Secret)}`,
          { headers: { Authorization: buildAuthHeader() } }
        ).then((r) => r.json());

        if (!check.Authenticated) return;

        clearInterval(qcTimer);
        statusEl.textContent = t('login.connecting');

        const auth = await fetch(`${url}/Users/AuthenticateWithQuickConnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: buildAuthHeader() },
          body: JSON.stringify({ Secret: init.Secret })
        }).then((r) => r.json());

        if (!auth?.AccessToken) throw new Error('Antwort ohne Zugangsschlüssel');

        state.serverUrl = url;
        state.token = auth.AccessToken;
        state.userId = auth.User.Id;
        state.username = auth.User.Name;

        try {
          localStorage.setItem('jf-session', JSON.stringify({
            serverUrl: url, token: auth.AccessToken,
            userId: auth.User.Id, username: auth.User.Name
          }));
        } catch (error) {
          /* ignorieren */
        }

        cancelQuickConnect();
        await enterApp();
      } catch (error) {
        // Weiterversuchen — der Code läuft serverseitig ohnehin ab
      }
    }, 3000);
  } catch (error) {
    statusEl.textContent = t('common.loadFailed', { error: error.message });
  }
}

function cancelQuickConnect() {
  clearInterval(qcTimer);
  qcTimer = null;
  $('quick-connect-box').classList.add('hidden');
  $('quick-connect-btn').classList.remove('hidden');
}

$('quick-connect-btn').addEventListener('click', startQuickConnect);
$('qc-cancel').addEventListener('click', cancelQuickConnect);

/* ============================ PLAYLISTS ============================ */

let playlistTarget = null;

async function fetchPlaylists() {
  const data = await api(itemsUrl({
    IncludeItemTypes: 'Playlist',
    Recursive: 'true',
    SortBy: 'SortName',
    Fields: 'ChildCount'
  }));
  return data.Items || [];
}

async function openPlaylistModal(item) {
  playlistTarget = item;
  $('playlist-modal-title').textContent = t('playlist.add', { name: item.Name });
  $('playlist-error').textContent = '';
  $('new-playlist-name').value = '';
  $('playlist-modal').classList.remove('hidden');

  const picker = $('playlist-picker');
  picker.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  try {
    const playlists = await fetchPlaylists();

    if (!playlists.length) {
      picker.innerHTML = `<p class="settings-hint">${escapeHtml(t('playlist.none'))}</p>`;
      return;
    }

    picker.innerHTML = '';
    playlists.forEach((playlist) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'playlist-option';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h11M4 12h11M4 17h7"/><path d="M18 11v8"/><circle cx="16" cy="19" r="2" fill="currentColor" stroke="none"/></svg>
        <span>${escapeHtml(playlist.Name)}</span>
        <span class="count">${playlist.ChildCount || 0}</span>`;
      btn.addEventListener('click', () => addToPlaylist(playlist.Id, playlist.Name));
      picker.appendChild(btn);
    });
  } catch (error) {
    picker.innerHTML = `<p class="settings-hint">${escapeHtml(t('playlist.loadFailed', { error: error.message }))}</p>`;
  }
}

async function addToPlaylist(playlistId, playlistName) {
  if (!playlistTarget) return;

  try {
    await api(`/Playlists/${playlistId}/Items?ids=${playlistTarget.Id}&userId=${state.userId}`, {
      method: 'POST'
    });
    $('playlist-modal').classList.add('hidden');
    toast(t('playlist.addFailed', { error: playlistName }));
  } catch (error) {
    $('playlist-error').textContent = t('playlist.addFailed', { error: error.message });
  }
}

$('playlist-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = $('new-playlist-name').value.trim();
  if (!name || !playlistTarget) return;

  try {
    const params = new URLSearchParams({
      Name: name,
      userId: state.userId,
      ids: playlistTarget.Id
    });
    // MediaType passend zum Element, sonst legt Jellyfin eine gemischte Liste an
    const mediaType = playlistTarget.Type === 'Audio' || playlistTarget.Type === 'MusicAlbum' ? 'Audio' : 'Video';
    params.set('mediaType', mediaType);

    await api(`/Playlists?${params}`, { method: 'POST' });
    $('playlist-modal').classList.add('hidden');
    toast(t('playlist.create'));
  } catch (error) {
    $('playlist-error').textContent = t('playlist.createFailed', { error: error.message });
  }
});

$('playlist-close').addEventListener('click', () => $('playlist-modal').classList.add('hidden'));
$('dl-close').addEventListener('click', () => $('dl-modal').classList.add('hidden'));

/* --- Playlist-Ansicht --- */

async function showPlaylists() {
  setActiveNav('playlists');
  setTopGap(true);
  showLoader();

  try {
    const playlists = await fetchPlaylists();
    el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('nav.playlists'))}</h2>`;

    if (!playlists.length) {
      el.viewRoot.insertAdjacentHTML(
        'beforeend',
        `<div class="empty-state">${escapeHtml(t('playlist.noPlaylists'))}</div>`
      );
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid squares';
    playlists.forEach((playlist) => {
      const card = buildCard(playlist, {
        shape: 'square',
        subtitle: t('playlist.titleCount', { count: playlist.ChildCount || 0 }),
        badge: ''
      });
      grid.appendChild(card);
    });
    el.viewRoot.appendChild(grid);
    setStatus(t('nav.playlists'));
  } catch (error) {
    console.error(error);
    showEmpty(t('playlist.loadFailed', { error: error.message }));
  }
}

async function showPlaylist(playlist) {
  setTopGap(true);
  showLoader();

  try {
    const data = await api(`/Playlists/${playlist.Id}/Items?userId=${state.userId}&Fields=Artists,AlbumArtist,RunTimeTicks,ProductionYear,MediaType`);
    const items = data.Items || [];

    el.viewRoot.innerHTML = `
      <h2 class="section-title">${escapeHtml(playlist.Name)}</h2>
      <div class="detail-actions" style="margin-top:0">
        <button class="play-btn" id="pl-play" type="button">
          <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
          ${escapeHtml(t('playlist.play'))}
        </button>
        <button class="outline-btn" id="pl-shuffle" type="button">${escapeHtml(t('playlist.shuffle'))}</button>
      </div>
      <div class="mf-queue" id="pl-items" style="overflow:visible"></div>`;

    const host = $('pl-items');

    if (!items.length) {
      host.innerHTML = `<div class="empty-state">${escapeHtml(t('playlist.empty'))}</div>`;
      return;
    }

    const audioItems = items.filter((entry) => entry.Type === 'Audio');

    items.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'queue-item';
      const art = imageUrl(entry, 'Primary', 120);
      row.innerHTML = `
        <span class="queue-num">${index + 1}</span>
        ${art ? `<img class="queue-art" src="${art}" alt="" loading="lazy">` : '<div class="queue-art"></div>'}
        <div class="queue-body">
          <div class="queue-title">${escapeHtml(entry.Name || '')}</div>
          <div class="queue-artist">${escapeHtml(entry.Artists?.join(', ') || entry.AlbumArtist || entry.ProductionYear || '')}</div>
        </div>
        <span class="queue-dur">${formatTime(ticksToSeconds(entry.RunTimeTicks))}</span>`;
      row.addEventListener('click', () => {
        if (entry.Type === 'Audio') music.play(audioItems, audioItems.indexOf(entry));
        else playItem(entry);
      });
      host.appendChild(row);
    });

    const startAll = (shuffle) => {
      if (audioItems.length) {
        music.shuffle = shuffle;
        music.play(audioItems, shuffle ? Math.floor(Math.random() * audioItems.length) : 0);
      } else if (items.length) {
        playItem(items[shuffle ? Math.floor(Math.random() * items.length) : 0]);
      }
    };

    $('pl-play').addEventListener('click', () => startAll(false));
    $('pl-shuffle').addEventListener('click', () => startAll(true));

    setStatus(playlist.Name);
  } catch (error) {
    console.error(error);
    showEmpty(t('common.loadFailed', { error: error.message }));
  }
}

/* --- Modals per Escape / Klick daneben schließen --- */

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (event) => {
    if (event.target === modal) modal.classList.add('hidden');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;

  // Das Einstellungs-Overlay ist kein .modal mehr — zuerst prüfen
  const settings = $('settings-modal');
  if (settings && !settings.classList.contains('hidden')) {
    event.stopPropagation();
    return closeSettings();
  }

  const open = document.querySelector('.modal:not(.hidden)');
  if (open) {
    event.stopPropagation();
    open.classList.add('hidden');
  }
});

/* ============ KATEGORIEN IM EINSTELLUNGSFENSTER ============ */

function showSettingsCategory(name) {
  document.querySelectorAll('.settings-cat').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.cat === name);
  });

  document.querySelectorAll('.settings-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === name);
  });

  // Beim Wechsel nach oben — sonst startet die neue Kategorie mittendrin
  const host = $('settings-panels');
  if (host) host.scrollTop = 0;

  try {
    localStorage.setItem('jf-settings-cat', name);
  } catch (error) {
    /* ignorieren */
  }
}

document.querySelectorAll('.settings-cat').forEach((btn) => {
  btn.addEventListener('click', () => showSettingsCategory(btn.dataset.cat));
});

function closeSettings() {
  $('settings-modal').classList.add('hidden');
  document.body.classList.remove('settings-open');
}

/* ==================== SPRACHAUSWAHL ==================== */

const LANG_SOURCE_KEYS = {
  user: 'settings.languageSourceUser',
  cache: 'settings.languageSourceCache',
  builtin: 'settings.languageSourceBuiltin'
};

function renderLanguageList() {
  const host = $('language-list');
  if (!host) return;

  const list = (typeof i18n !== 'undefined' && i18n.available) ? i18n.available : [];

  if (!list.length) {
    host.innerHTML = `<p class="settings-hint">${escapeHtml(t('settings.desktopOnly'))}</p>`;
    return;
  }

  host.innerHTML = '';

  list.forEach((lang) => {
    const isActive = lang.code === i18n.code;
    const complete = lang.total > 0 && lang.translated >= lang.total;
    const percent = lang.total > 0 ? Math.round((lang.translated / lang.total) * 100) : 100;

    const card = document.createElement('div');
    card.className = `language-card ${isActive ? 'active' : ''}`;
    card.dataset.code = lang.code;

    // Autor nur verlinken, wenn eine http(s)-Adresse hinterlegt ist —
    // sonst könnte hier ein javascript:-Link aus einer fremden Datei landen.
    const safeUrl = /^https?:\/\//i.test(lang.authorUrl || '') ? lang.authorUrl : '';
    const authorHtml = lang.author
      ? (safeUrl
        ? `<a class="lang-author" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('settings.languageBy', { author: lang.author }))}</a>`
        : `<span class="lang-author">${escapeHtml(t('settings.languageBy', { author: lang.author }))}</span>`)
      : '';

    card.innerHTML = `
      <span class="lang-flag">${escapeHtml(lang.flag || '🌐')}</span>
      <span class="lang-body">
        <span class="lang-name">
          ${escapeHtml(lang.nativeName || lang.name)}
          ${lang.nativeName && lang.name && lang.nativeName !== lang.name
            ? `<small>${escapeHtml(lang.name)}</small>` : ''}
        </span>
        <span class="lang-meta">
          ${authorHtml}
          <span class="lang-source">${escapeHtml(t(LANG_SOURCE_KEYS[lang.source] || 'settings.languageSourceBuiltin'))}</span>
        </span>
        ${complete ? '' : `
          <span class="lang-progress" title="${escapeHtml(t('settings.languageProgress', { translated: lang.translated, total: lang.total }))}">
            <span class="lang-bar"><i style="width:${percent}%"></i></span>
            <small>${percent} %</small>
          </span>`}
      </span>
      <span class="lang-action">${
        isActive
          ? `<span class="lang-active">${escapeHtml(t('settings.languageActive'))}</span>`
          : `<button class="outline-btn small" type="button">${escapeHtml(t('settings.languageApply'))}</button>`
      }</span>`;

    if (!isActive) {
      const apply = () => applyLanguage(lang);
      card.querySelector('button')?.addEventListener('click', apply);
      card.addEventListener('click', (event) => {
        // Ein Klick auf den Autorenlink soll nicht die Sprache wechseln
        if (event.target.closest('a')) return;
        apply();
      });
    }

    host.appendChild(card);
  });
}

async function applyLanguage(lang) {
  const ok = await setLanguage(lang.code);
  if (!ok) return toast(t('common.error'), true);

  renderLanguageList();
  toast(t('settings.languageApplied', { name: lang.nativeName || lang.name }));
}

/** Wird nach jedem Sprachwechsel aufgerufen (aus i18n.js). */
function onLanguageChanged() {
  // Alles neu aufbauen, was Text enthält und nicht rein statisch ist
  buildSeekStepOptions();
  if (typeof buildThemeGrid === 'function' && $('theme-grid')) buildThemeGrid();
  if (typeof renderSettingsServers === 'function' && $('settings-servers')) renderSettingsServers();
  refreshDownloadSettings();

  // Werte mit Einheiten neu formatieren
  const subPos = $('sub-position-val');
  if (subPos) {
    subPos.textContent = prefs.subPosition ? `${prefs.subPosition} px` : t('settings.subPositionDefault');
  }

  // Die aktuelle Ansicht neu zeichnen, damit auch Karten und Reihen
  // in der neuen Sprache erscheinen
  if (typeof state !== 'undefined' && state.view && typeof navigate === 'function') {
    navigate(state.view, { push: false });
  }
}

/* Sprungweite: die Einheit steckt im übersetzten Text, deshalb
   werden die Optionen zur Laufzeit gebaut. */
function buildSeekStepOptions() {
  const select = $('seek-step');
  if (!select) return;

  const current = String(prefs.seekStep || 10);
  select.innerHTML = '';

  [5, 10, 15, 30].forEach((seconds) => {
    const option = document.createElement('option');
    option.value = String(seconds);
    option.textContent = t('settings.seconds', { count: seconds });
    select.appendChild(option);
  });

  select.value = current;
}

$('lang-folder').addEventListener('click', () => window.languages?.openFolder());

$('lang-check').addEventListener('click', async () => {
  const button = $('lang-check');
  const status = $('lang-status');

  if (!window.languages) return;

  button.disabled = true;
  status.textContent = t('settings.languageChecking');
  status.className = 'lang-status';

  try {
    const result = await window.languages.sync({ force: true });

    if (result.failed) {
      status.textContent = t('settings.languageCheckFailed');
      status.className = 'lang-status error';
    } else if (result.added || result.updated) {
      status.textContent = t('settings.languageFound', {
        added: result.added, updated: result.updated
      });
      status.className = 'lang-status ok';
      i18n.available = await window.languages.list();
      renderLanguageList();
    } else {
      status.textContent = t('settings.languageUpToDate');
      status.className = 'lang-status ok';
    }
  } catch (error) {
    status.textContent = t('settings.languageCheckFailed');
    status.className = 'lang-status error';
  } finally {
    button.disabled = false;
  }
});

// Neue Sprachen, die im Hintergrund eintrudeln, sofort anbieten
window.languages?.onUpdated(async () => {
  try {
    i18n.available = await window.languages.list();
    if ($('language-list')) renderLanguageList();
  } catch (error) {
    /* ignorieren */
  }
});

/* ====================== UPDATES ======================
   Die App laedt Updates selbst und spielt sie beim Beenden ein.
   Hier wird nur angezeigt, was gerade passiert. */

function renderUpdateState(info) {
  const text = $('update-text');
  const dot = $('update-dot');
  const bar = $('update-progress');
  const install = $('update-install');
  const current = $('update-current');
  if (!text) return;

  if (current) current.textContent = info.current || window.appInfo?.version || '—';

  // Im Entwicklungslauf gibt es nichts zu aktualisieren
  if (info.supported === false) {
    text.textContent = t('update.devMode');
    dot.className = 'update-dot';
    bar.classList.add('hidden');
    install.classList.add('hidden');
    $('update-check').disabled = true;
    return;
  }

  const messages = {
    checking: () => t('update.checking'),
    current: () => t('update.current'),
    downloading: () => t('update.downloading', { version: info.version || '', percent: info.percent || 0 }),
    ready: () => t('update.ready', { version: info.version || '' }),
    error: () => info.error || t('update.failed'),
    idle: () => t('update.idle')
  };

  text.textContent = (messages[info.status] || messages.idle)();
  dot.className = `update-dot ${info.status}`;

  const loading = info.status === 'downloading';
  bar.classList.toggle('hidden', !loading);
  if (loading) $('update-bar').style.width = `${info.percent || 0}%`;

  install.classList.toggle('hidden', info.status !== 'ready');
}

async function refreshUpdateState() {
  if (!window.updater) {
    const text = $('update-text');
    if (text) text.textContent = t('update.devMode');
    return;
  }
  try {
    renderUpdateState(await window.updater.state());
  } catch (error) {
    /* nicht schlimm */
  }
}

$('update-check')?.addEventListener('click', async () => {
  const button = $('update-check');
  if (!window.updater) return;

  button.disabled = true;
  $('update-text').textContent = t('update.checking');

  try {
    const result = await window.updater.check();
    if (result.skipped) $('update-text').textContent = t('update.devMode');
    else if (result.failed) $('update-text').textContent = t('update.failed');
  } catch (error) {
    $('update-text').textContent = t('update.failed');
  } finally {
    button.disabled = false;
    // Der Zustand kommt ueber das Ereignis, hier nur nachziehen
    setTimeout(refreshUpdateState, 400);
  }
});

$('update-install')?.addEventListener('click', () => window.updater?.install());

/* Meldungen aus dem Main-Process. Ist ein Update fertig, erfaehrt der
   Nutzer das einmal per Hinweis — der Rest passiert beim Beenden. */
let updateReadyAnnounced = false;

window.updater?.onEvent((info) => {
  if ($('update-text')) renderUpdateState({ ...info, supported: true });

  if (info.status === 'ready' && !updateReadyAnnounced) {
    updateReadyAnnounced = true;
    toast(t('update.readyToast', { version: info.version || '' }));
  }
});

/* ==================== FOOTER-LINKS ====================
   TODO: Hier die echten Adressen eintragen. Solange sie leer sind,
   bleiben die Badges sichtbar, aber nicht anklickbar. */
const PROJECT_LINKS = {
  github: 'https://github.com/ukyyyy/jellystream',
  kofi: 'https://ko-fi.com/jellystream'
};

function wireFooterLinks() {
  const entries = [
    ['link-github', PROJECT_LINKS.github],
    ['link-kofi', PROJECT_LINKS.kofi]
  ];

  entries.forEach(([id, url]) => {
    const node = $(id);
    if (!node) return;

    if (url) {
      node.href = url;
      node.classList.remove('disabled');
    } else {
      node.href = '#';
      node.classList.add('disabled');
      node.addEventListener('click', (event) => event.preventDefault());
    }
  });
}

wireFooterLinks();

loadPrefs();
