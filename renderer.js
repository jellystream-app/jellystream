/* ============================================================
   Jellystream — Renderer
   ============================================================ */

const CLIENT_NAME = 'Jellystream';
// Kommt über die Preload-Bridge aus der package.json; der feste Wert
// greift nur, wenn die Seite ohne Preload geöffnet wird (Browser).
const CLIENT_VERSION = window.appInfo?.version || '0.0.0';
const DEVICE_NAME = 'Desktop';
const TICKS_PER_SECOND = 10000000;

const $ = (id) => document.getElementById(id);

const el = {
  loginScreen: $('login-screen'),
  appShell: $('app-shell'),
  connectForm: $('connect-form'),
  loginBtn: $('login-btn'),
  authError: $('auth-error'),
  togglePassword: $('toggle-password'),
  rememberMe: $('remember-me'),
  statusText: $('status-text'),
  userName: $('user-name'),
  userAvatar: $('user-avatar'),
  userAvatarBig: $('user-avatar-big'),
  navbar: $('navbar'),
  searchBox: $('search-box'),
  searchToggle: $('search-toggle'),
  libraryToggle: $('library-toggle'),
  libraryMenu: $('library-menu'),
  profileBtn: $('profile-btn'),
  profileMenu: $('profile-menu'),
  viewRoot: $('view-root'),
  mainPanel: $('main-panel'),
  backBtn: $('back-btn'),
  searchInput: $('search-input'),
  disconnectBtn: $('disconnect-btn')
};

const state = {
  serverUrl: '',
  token: '',
  userId: '',
  username: '',
  libraries: [],
  view: null,
  history: []
};

/* ============================ UTIL ============================ */

function getDeviceId() {
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('jf-device-id') || '';
  } catch (error) {
    /* localStorage nicht verfügbar */
  }

  if (!deviceId) {
    deviceId =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `dev-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    try {
      localStorage.setItem('jf-device-id', deviceId);
    } catch (error) {
      /* ignorieren */
    }
  }

  return deviceId;
}

// Jellyfin verlangt diesen Header bei JEDER Anfrage. Fehlt er beim Login,
// antwortet der Server mit "400 Error processing request".
function buildAuthHeader(token) {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${DEVICE_NAME}"`,
    `DeviceId="${getDeviceId()}"`,
    `Version="${CLIENT_VERSION}"`
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

/* Ergänzt ein fehlendes Schema — https zuerst, siehe core/api.js:
   bei http→https-Umleitung verwirft der Browser den
   Authorization-Header, und Jellyfin meldet dann irreführend
   "400 Error processing request". */
function normalizeServerUrl(rawUrl) {
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function ticksToSeconds(ticks) {
  return typeof ticks === 'number' ? ticks / TICKS_PER_SECOND : 0;
}

function formatRuntime(ticks) {
  const seconds = ticksToSeconds(ticks);
  if (!seconds) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

function imageUrl(item, type = 'Primary', maxHeight = 480) {
  if (!item) return '';
  const tags = item.ImageTags || {};
  let itemId = item.Id;
  let tag = tags[type];

  // Für Episoden/Alben auf das Elternbild zurückfallen
  if (!tag && type === 'Primary' && item.AlbumPrimaryImageTag && item.AlbumId) {
    itemId = item.AlbumId;
    tag = item.AlbumPrimaryImageTag;
  }
  if (!tag && type === 'Primary' && item.SeriesPrimaryImageTag && item.SeriesId) {
    itemId = item.SeriesId;
    tag = item.SeriesPrimaryImageTag;
  }
  if (!tag && type === 'Backdrop') {
    const backdrops = item.BackdropImageTags || [];
    if (backdrops.length) tag = backdrops[0];
    else if ((item.ParentBackdropImageTags || []).length && item.ParentBackdropItemId) {
      itemId = item.ParentBackdropItemId;
      tag = item.ParentBackdropImageTags[0];
    }
  }
  if (!tag) return '';

  // P3: Bildschirmdichte berücksichtigen, sonst wirken Cover auf HiDPI weich
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const height = Math.round(maxHeight * dpr);
  return `${state.serverUrl}/Items/${itemId}/Images/${type}?maxHeight=${height}&quality=90&tag=${tag}`;
}

/* Bild für eine 16:9-Kachel.
   „Primary" ist bei Filmen und Serien ein Hochkant-Poster — in einer
   Querformat-Kachel wird davon nur ein Streifen sichtbar. Jellyfin hält
   dafür „Thumb" (16:9) und „Backdrop" (breiter) bereit; erst wenn beides
   fehlt, bleibt das Poster als letzte Möglichkeit. */
function wideImageUrl(item) {
  if (!item) return { src: '', cropped: false };

  const tags = item.ImageTags || {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const height = Math.round(420 * dpr);
  const build = (id, type, tag) =>
    `${state.serverUrl}/Items/${id}/Images/${type}?maxHeight=${height}&quality=90&tag=${tag}`;

  if (tags.Thumb) return { src: build(item.Id, 'Thumb', tags.Thumb), cropped: false };

  // Folgen erben das Querformat-Bild der Serie
  if (item.ParentThumbImageTag && item.ParentThumbItemId) {
    return { src: build(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag), cropped: false };
  }
  if (item.SeriesThumbImageTag && item.SeriesId) {
    return { src: build(item.SeriesId, 'Thumb', item.SeriesThumbImageTag), cropped: false };
  }

  const backdrop = imageUrl(item, 'Backdrop', 420);
  if (backdrop) return { src: backdrop, cropped: false };

  // Nur noch das Poster übrig — dann oben ausrichten, damit Titel und
  // Gesichter im Bild bleiben statt in der Mitte abgeschnitten zu werden.
  const primary = imageUrl(item, 'Primary', 420);
  return { src: primary, cropped: Boolean(primary) };
}

// Jellyfin liefert ISO-639-2 (3-stellig); Intl erwartet 2-stellige Codes
const LANG_MAP = {
  ger: 'de', deu: 'de', eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it',
  jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', rus: 'ru', por: 'pt', pol: 'pl',
  dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', tur: 'tr',
  ara: 'ar', hin: 'hi', ces: 'cs', cze: 'cs', hun: 'hu', ell: 'el', gre: 'el',
  heb: 'he', tha: 'th', ukr: 'uk', ron: 'ro', rum: 'ro', bul: 'bg', hrv: 'hr'
};

let languageNames = null;
try {
  languageNames = new Intl.DisplayNames([typeof localeTag === 'function' ? localeTag() : 'en'], { type: 'language' });
} catch (error) {
  /* ältere Umgebung -> Rohcode anzeigen */
}

function languageName(code) {
  if (!code) return '';
  const normalized = code.toLowerCase();
  // "und"/"mis"/"mul"/"zxx" sind Platzhalter ohne echte Sprache
  if (['und', 'mis', 'mul', 'zxx'].includes(normalized)) return '';

  const short = LANG_MAP[normalized] || (normalized.length === 2 ? normalized : '');
  if (short && languageNames) {
    try {
      const name = languageNames.of(short);
      if (name && name !== short) return name;
    } catch (error) {
      /* Fallback unten */
    }
  }
  return code.toUpperCase();
}

function setStatus(message) {
  el.statusText.textContent = message;
}

function setAuthError(message) {
  el.authError.textContent = message || '';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/* ============================ API ============================ */

// F3: Läuft das Token ab, landet der Nutzer sonst in einer nackten "401"-Meldung.
let sessionExpiredHandled = false;

function handleSessionExpired() {
  if (sessionExpiredHandled) return;
  sessionExpiredHandled = true;

  try {
    localStorage.removeItem('jf-session');
  } catch (error) {
    /* ignorieren */
  }

  if (typeof music !== 'undefined') music.stop();
  if (typeof closeVideo === 'function') closeVideo();

  state.token = '';
  state.userId = '';

  el.appShell.classList.add('hidden');
  el.loginScreen.classList.remove('hidden');
  setAuthError(t('auth.sessionExpiredLong'));

  const password = $('password');
  if (password) {
    password.value = '';
    setTimeout(() => password.focus(), 80);
  }
}

async function api(path, options = {}) {
  const response = await fetch(`${state.serverUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: buildAuthHeader(state.token),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });

  if (response.status === 401) {
    handleSessionExpired();
    throw new Error(t('common.sessionExpired'));
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${text || response.statusText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

/* F2: Wettlauf verhindern — eine ältere Antwort darf eine neuere nie überschreiben.
   Jede Ansicht bekommt ein Token; beim Wechsel wird das alte ungültig. */
const requestTokens = {};

function newToken(scope) {
  requestTokens[scope] = (requestTokens[scope] || 0) + 1;
  return requestTokens[scope];
}

function isCurrent(scope, token) {
  return requestTokens[scope] === token;
}

/* F4: Fehleranzeige mit Wiederholen statt Sackgasse. */
function showError(message, retryFn) {
  el.viewRoot.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'error-state';
  box.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.2M12 16v.5" stroke-linecap="round"/>
    </svg>
    <p class="error-msg">${escapeHtml(message)}</p>`;

  if (retryFn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'outline-btn';
    btn.textContent = t('common.retry');
    btn.addEventListener('click', retryFn);
    box.appendChild(btn);
  }

  el.viewRoot.appendChild(box);
}

/* Siehe core/api.js — dort steht die ausführliche Begründung.
   Kurz: ohne Umleitung prüfen, damit ein Schema-Wechsel hier
   auffällt und nicht erst beim Login den Header kostet. */
async function probeServer(serverUrl) {
  for (const path of ['/System/Info/Public', '/System/Info', '/']) {
    try {
      const response = await fetch(`${serverUrl}${path}`, {
        method: 'GET',
        redirect: 'manual'
      });

      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        const target = response.headers.get('Location');
        if (target) {
          try {
            const redirected = new URL(target, `${serverUrl}${path}`);
            return { reachable: true, url: redirected.origin };
          } catch (error) {
            /* Unbrauchbares Location-Feld */
          }
        }
        return {
          reachable: true,
          url: serverUrl.startsWith('http://')
            ? serverUrl.replace(/^http:/i, 'https:')
            : serverUrl
        };
      }

      if (response.ok || response.status === 401 || response.status === 403) {
        return { reachable: true, url: serverUrl };
      }
    } catch (error) {
      /* nächster Pfad */
    }
  }

  return { reachable: false, url: serverUrl };
}

async function resolveServerUrl(serverUrl) {
  const direct = await probeServer(serverUrl);
  if (direct.reachable) return direct;

  if (/^https:\/\//i.test(serverUrl)) {
    const plain = await probeServer(serverUrl.replace(/^https:/i, 'http:'));
    if (plain.reachable) return plain;
  }

  return { reachable: false, url: serverUrl };
}

async function checkServerReachability(serverUrl) {
  const result = await resolveServerUrl(serverUrl);
  return result.reachable;
}

async function authenticate(serverUrl, username, password) {
  const resolved = await resolveServerUrl(serverUrl);
  if (!resolved.reachable) {
    throw new Error(
      t('auth.serverUnreachable', { url: serverUrl })
    );
  }

  /* Ab hier die Adresse, die geantwortet hat — nicht die eingegebene. */
  serverUrl = resolved.url;

  const response = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: buildAuthHeader()
    },
    body: JSON.stringify({ Username: username, Pw: password })
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(t('auth.wrongCredentials'));
    }
    const text = await response.text().catch(() => '');
    throw new Error(t('auth.failedStatus', { status: `${response.status} ${text || response.statusText}` }));
  }

  const data = await response.json();
  if (!data || !data.AccessToken || !data.User) {
    throw new Error(t('auth.badResponse'));
  }

  /* serverUrl mitgeben: kann sich durch Umleitung geändert haben. */
  return { accessToken: data.AccessToken, userId: data.User.Id, userName: data.User.Name, serverUrl };
}

const itemsUrl = (params) => `/Users/${state.userId}/Items?${new URLSearchParams(params)}`;

/* ============================ CARDS ============================ */

const PLAY_CIRCLE = `<div class="card-hover"><div class="play-circle"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></div></div>`;
const FALLBACK_ICON = `<div class="fallback"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 9 6 3-6 3z" fill="currentColor" stroke="none"/></svg></div>`;

const ICON_PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>`;
const ICON_PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 11v5.5M12 7.8v.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h11M4 12h11M4 17h7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M18 10v9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="16" cy="19" r="2" fill="currentColor"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M8 10.5 12 14.5l4-4"/><path d="M5 17v1.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V17"/></svg>`;

// Prime-Video-Kachel: 16:9-Bild, Details klappen beim Hovern auf
/* Nur einzelne Videos lassen sich am Stück laden — eine Serie oder ein
   Album ist ein Container ohne eigene Datei. */
function isDownloadable(item) {
  return Boolean(window.downloads) && (item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video');
}

function buildCard(item, options = {}) {
  const { shape = 'wide', subtitle } = options;

  const card = document.createElement('article');
  card.className = `card ${shape === 'poster' ? 'poster' : shape === 'square' ? 'square' : ''}`;

  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const art = document.createElement('div');
  art.className = 'card-art';

  // Querformat-Kacheln brauchen ein Querformat-Bild, nicht das Poster
  const picture = shape === 'wide'
    ? wideImageUrl(item)
    : { src: imageUrl(item, 'Primary', 480), cropped: false };

  const src = picture.src;
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    if (picture.cropped) img.classList.add('from-poster');
    // A4: beschreibender Text statt leerem alt — sonst ist die Kachel stumm
    img.alt = t('card.image', { name: item.Name || t('card.untitled') });
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      art.insertAdjacentHTML('afterbegin', FALLBACK_ICON);
    });
    art.appendChild(img);
  } else {
    art.innerHTML = FALLBACK_ICON;
  }

  art.insertAdjacentHTML('beforeend', PLAY_CIRCLE);

  const badge = options.badge != null ? options.badge : cardBadge(item);
  if (badge) {
    art.insertAdjacentHTML('afterbegin', `<div class="card-badge">${escapeHtml(badge)}</div>`);
  }

  const played = item.UserData && item.UserData.PlayedPercentage;
  if (played > 0 && played < 100) {
    art.insertAdjacentHTML(
      'beforeend',
      `<div class="progress-bar"><div style="width:${played}%"></div></div>`
    );
  }

  const isFavorite = Boolean(item.UserData?.IsFavorite);
  const facts = [
    item.ProductionYear,
    item.OfficialRating ? `<span class="chip">${escapeHtml(item.OfficialRating)}</span>` : '',
    item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : '',
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : ''
  ].filter(Boolean);

  const body = document.createElement('div');
  body.className = 'card-body';
  body.innerHTML = `
    <div class="card-actions">
      <button class="card-play" type="button" title="${escapeHtml(t('card.play'))}" aria-label="${escapeHtml(t('card.play'))}">${ICON_PLAY}</button>
      <button class="card-icon-btn fav ${isFavorite ? 'on' : ''}" type="button"
              title="${escapeHtml(isFavorite ? t('card.removeFavorite') : t('card.addFavorite'))}"
              aria-label="${escapeHtml(t('card.favorite'))}">${isFavorite ? ICON_CHECK : ICON_PLUS}</button>
      <button class="card-icon-btn list" type="button" title="${escapeHtml(t('card.playlist'))}" aria-label="${escapeHtml(t('card.playlist'))}">${ICON_LIST}</button>
      <button class="card-icon-btn seen ${item.UserData?.Played ? 'on' : ''}" type="button"
              title="${escapeHtml(item.UserData?.Played ? t('card.markUnwatched') : t('card.markWatched'))}"
              aria-label="${escapeHtml(t('card.watched'))}">${ICON_EYE}</button>
      ${isDownloadable(item) ? `<button class="card-icon-btn dl" type="button" data-dl-item="${escapeHtml(item.Id)}"
              title="${escapeHtml(t('card.download'))}" aria-label="${escapeHtml(t('card.download'))}">${ICON_DOWNLOAD}</button>` : ''}
      ${options.onDismiss ? `<button class="card-icon-btn dismiss" type="button" title="${escapeHtml(t('card.dismiss'))}" aria-label="${escapeHtml(t('card.dismiss'))}">${ICON_X}</button>` : ''}
      <button class="card-icon-btn info" type="button" title="${escapeHtml(t('card.info'))}" aria-label="${escapeHtml(t('card.info'))}">${ICON_INFO}</button>
    </div>
    <div class="card-title">${escapeHtml(item.Name || t('card.untitled'))}</div>
    ${facts.length ? `<div class="card-facts">${facts.join('<span>·</span>')}</div>` : ''}
    <div class="card-sub">${escapeHtml(subtitle != null ? subtitle : defaultSubtitle(item))}</div>`;

  inner.append(art, body);

  const label = document.createElement('div');
  label.className = 'card-label';
  label.textContent = item.Name || t('card.untitled');

  card.append(inner, label);

  card.addEventListener('click', () => openItem(item));

  // Play startet direkt; ein Klick auf die Karte öffnet die Infoseite
  body.querySelector('.card-play').addEventListener('click', (event) => {
    event.stopPropagation();
    if (item.Type === 'Series') openItem(item);
    else playItem(item);
  });

  body.querySelector('.info').addEventListener('click', (event) => {
    event.stopPropagation();
    openItem(item);
  });

  body.querySelector('.fav').addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavorite(item, event.currentTarget);
  });

  body.querySelector('.list').addEventListener('click', (event) => {
    event.stopPropagation();
    openPlaylistModal(item);
  });

  body.querySelector('.dl')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openDownloadModal(item);
  });

  // U6: Gesehen-Status direkt auf der Karte umschalten
  const seenBtn = body.querySelector('.seen');
  seenBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const wasPlayed = seenBtn.classList.contains('on');
    seenBtn.classList.toggle('on', !wasPlayed);
    try {
      await togglePlayed(item, !wasPlayed);
      seenBtn.title = wasPlayed ? t('card.markWatched') : t('card.markUnwatched');
      const bar = art.querySelector('.progress-bar');
      if (bar && !wasPlayed) bar.remove();
      toast(wasPlayed ? t('common.markedUnwatched') : t('common.markedWatched'));
    } catch (error) {
      seenBtn.classList.toggle('on', wasPlayed);
      toast(t('common.statusChangeFailed'), true);
    }
  });

  // Download-Symbol gleich in den richtigen Zustand setzen
  if (typeof updateDownloadButtons === 'function') setTimeout(updateDownloadButtons, 0);

  // U5: Eintrag aus "Weiterschauen" entfernen
  const dismissBtn = body.querySelector('.dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await dismissFromResume(item);
        card.style.transition = 'opacity .2s, transform .2s';
        card.style.opacity = '0';
        card.style.transform = 'scale(.94)';
        setTimeout(() => card.remove(), 200);
        toast(t('common.removedFromResume'));
      } catch (error) {
        toast(t('common.removeFailed'), true);
      }
    });
  }

  return card;
}

// Ecken-Badge wie bei Prime ("NEU HINZUGEFÜGT", "NEUE FOLGE", ...)
// Nur wenn wirklich neu — DateCreated ist maßgeblich, nicht der Typ.
const BADGE_MAX_AGE_DAYS = 14;

function cardBadge(item) {
  if (!item.DateCreated) return '';

  const created = new Date(item.DateCreated);
  if (Number.isNaN(created.getTime())) return '';

  const daysOld = (Date.now() - created.getTime()) / 86400000;
  if (daysOld > BADGE_MAX_AGE_DAYS || daysOld < 0) return '';

  // Bereits Gesehenes ist für den Nutzer nicht mehr "neu"
  if (item.UserData?.Played) return '';

  switch (item.Type) {
    case 'Episode': return t('badge.newEpisodeType');
    case 'Series': return t('badge.newSeries');
    case 'Movie': return t('badge.newMovie');
    case 'MusicAlbum': return t('badge.newAlbum');
    default: return t('badge.added');
  }
}

/* U5 / U6: Gesehen-Status umschalten — auf Karten und in der Folgenliste */
async function togglePlayed(item, played) {
  await api(`/Users/${state.userId}/PlayedItems/${item.Id}`, {
    method: played ? 'POST' : 'DELETE'
  });
  item.UserData = { ...(item.UserData || {}), Played: played, PlayedPercentage: played ? 100 : 0 };
}

/* U5: Eintrag aus "Weiterschauen" nehmen, ohne ihn als gesehen zu markieren */
async function dismissFromResume(item) {
  await api(`/Users/${state.userId}/Items/${item.Id}/UserData`, {
    method: 'POST',
    body: JSON.stringify({ PlaybackPositionTicks: 0 })
  });
}

async function toggleFavorite(item, button) {
  const wasFavorite = button.classList.contains('on');

  // Sofort umschalten, damit der Klick sich direkt anfühlt
  button.classList.toggle('on', !wasFavorite);
  button.innerHTML = wasFavorite ? ICON_PLUS : ICON_CHECK;

  try {
    await api(`/Users/${state.userId}/FavoriteItems/${item.Id}`, {
      method: wasFavorite ? 'DELETE' : 'POST'
    });
    item.UserData = { ...(item.UserData || {}), IsFavorite: !wasFavorite };
  } catch (error) {
    // Fehlgeschlagen -> optische Änderung zurücknehmen
    console.error('Favourite could not be set:', error);
    button.classList.toggle('on', wasFavorite);
    button.innerHTML = wasFavorite ? ICON_CHECK : ICON_PLUS;
  }
}

function defaultSubtitle(item) {
  if (item.Type === 'MusicAlbum') return item.AlbumArtist || item.ProductionYear || '';
  if (item.Type === 'Audio') return item.Artists?.join(', ') || item.AlbumArtist || '';
  if (item.Type === 'Series') {
    const years = item.ProductionYear ? `${item.ProductionYear}` : '';
    return item.Status === 'Continuing' && years ? `${years} –` : years;
  }
  return item.ProductionYear || '';
}

function buildRow(title, items, options = {}) {
  if (!items || !items.length) return null;

  const row = document.createElement('section');
  row.className = 'row';

  const head = document.createElement('div');
  head.className = 'row-head';
  head.innerHTML = `<h3>${escapeHtml(title)}</h3><span class="row-count">${items.length}</span>`;

  // U3: Blätterpfeile wie bei Prime
  const track = document.createElement('div');
  track.className = 'row-track';

  const scroll = document.createElement('div');
  scroll.className = 'row-scroll';
  items.forEach((item) => scroll.appendChild(buildCard(item, options)));

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'row-arrow prev';
  prev.setAttribute('aria-label', t('row.previous', { title }));
  prev.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'row-arrow next';
  next.setAttribute('aria-label', t('row.next', { title }));
  next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Pfeile nur zeigen, wo es etwas zu blättern gibt
  const updateArrows = () => {
    const max = scroll.scrollWidth - scroll.clientWidth - 4;
    const scrollable = max > 4;
    prev.classList.toggle('off', !scrollable || scroll.scrollLeft <= 4);
    next.classList.toggle('off', !scrollable || scroll.scrollLeft >= max);
  };

  /* Ein Container mit overflow:hidden feuert KEINE scroll-Events — die
     Pfeile müssen deshalb aktiv nachgeführt werden. Der Loop läuft, bis
     die Position zwei Bilder lang unverändert ist (Ende der Animation). */
  let followFrame = null;
  let followTimer = null;
  const followScroll = () => {
    cancelAnimationFrame(followFrame);
    clearTimeout(followTimer);

    let last = -1;
    let settled = 0;

    const step = () => {
      updateArrows();
      if (scroll.scrollLeft === last) settled += 1;
      else settled = 0;
      last = scroll.scrollLeft;
      // Zwei ruhige Bilder = die Animation steht
      if (settled < 2) followFrame = requestAnimationFrame(step);
    };
    followFrame = requestAnimationFrame(step);

    /* Sicherheitsnetz per Zeitgeber: requestAnimationFrame ruht in
       unsichtbaren oder minimierten Fenstern. Ohne diesen Nachschlag
       bliebe der Pfeil dort im alten Zustand stehen, obwohl die Reihe
       längst am Ende ist. */
    followTimer = setTimeout(updateArrows, 420);
  };

  // Um volle Kacheln blättern, damit nie eine halbe am Rand steht
  const page = (dir) => {
    const card = scroll.querySelector('.card');
    const step = card ? card.offsetWidth + 14 : 260;
    const perPage = Math.max(1, Math.floor(scroll.clientWidth / step));
    scroll.scrollBy({
      left: dir * perPage * step,
      /* "Animationen reduzieren" muss auch hier greifen. 'instant' statt
         'auto': 'auto' bedeutet laut Spec "nimm den CSS-Wert" — und der
         steht auf smooth, die Einstellung wäre also wirkungslos. */
      behavior: prefs.reduceMotion ? 'instant' : 'smooth'
    });
    followScroll();
  };
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(1));

  /* Fokus per Tabulator kann die Reihe ebenfalls verschieben (der Browser
     holt das fokussierte Element in den sichtbaren Bereich) — auch dann
     müssen die Pfeile stimmen. */
  scroll.addEventListener('focusin', followScroll);

  // Nach dem Laden der Cover ändert sich die Breite — dann neu bewerten
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(updateArrows);
    observer.observe(scroll);
  }
  window.addEventListener('resize', updateArrows, { passive: true });
  requestAnimationFrame(updateArrows);

  /* Kein wheel-Handler mehr: seitwärts wird ausschließlich über die Pfeile
     geblättert. Vorher lenkte die Reihe das Mausrad um, wodurch der
     Seitenlauf an jeder Zeile hängenblieb. Die Reihe ist per CSS auf
     overflow:hidden gesetzt — scrollBy() wirkt dort weiterhin, Wischen
     und Ziehen nicht. */

  // Mit der Maus über der Reihe blättern die Pfeiltasten seitwärts
  track.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      page(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      page(-1);
    }
  });

  track.append(scroll, prev, next);
  row.append(head, track);
  return row;
}

function showLoader() {
  el.viewRoot.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
}

/* U4: Platzhalter in Kartenform statt springendem Kreisel */
function skeletonCards(count = 12, shape = 'wide') {
  const cards = Array.from({ length: count }, () =>
    `<div class="sk-card ${shape}"><div class="sk-art"></div><div class="sk-line"></div></div>`
  ).join('');
  return `<div class="sk-grid">${cards}</div>`;
}

function skeletonRows(rows = 3) {
  return Array.from({ length: rows }, () => `
    <div class="sk-row">
      <div class="sk-heading"></div>
      <div class="sk-strip">${Array.from({ length: 7 }, () =>
        '<div class="sk-card wide"><div class="sk-art"></div><div class="sk-line"></div></div>').join('')}</div>
    </div>`).join('');
}

function skeletonEpisodes(count = 4) {
  return Array.from({ length: count }, () =>
    '<div class="sk-episode"><div class="sk-thumb"></div><div class="sk-ep-body"><div class="sk-line w60"></div><div class="sk-line w90"></div><div class="sk-line w40"></div></div></div>'
  ).join('');
}

function showEmpty(message) {
  el.viewRoot.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

/* ============================ VIEWS ============================ */

function setActiveNav(view) {
  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view) {
    document.querySelectorAll('.library-btn').forEach((btn) => btn.classList.remove('active'));
  }
}

// Views ohne Hero brauchen Luft unter der fixierten Navbar
function setTopGap(enabled) {
  el.viewRoot.classList.toggle('with-top-gap', enabled);
}

function navigate(fn, { push = true } = {}) {
  if (push && state.view) state.history.push(state.view);
  state.view = fn;
  el.backBtn.classList.toggle('hidden', state.history.length === 0);
  el.mainPanel.scrollTop = 0;
  el.navbar.classList.remove('solid');
  // Slider der vorigen Ansicht stoppen — sonst tickt er unsichtbar weiter
  clearInterval(slideTimer);
  closeMenus();
  fn();
}

el.backBtn.addEventListener('click', () => {
  const previous = state.history.pop();
  if (previous) navigate(previous, { push: false });
});

async function showHome() {
  setActiveNav('home');
  setTopGap(false);
  el.viewRoot.innerHTML = `<div class="sk-hero"></div>${skeletonRows(3)}`;

  try {
    const [resume, nextUp, latestMovies, latestSeries, favorites] = await Promise.all([
      api(`/Users/${state.userId}/Items/Resume?Limit=14&MediaTypes=Video&Fields=ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated`).catch(() => null),
      api(`/Shows/NextUp?userId=${state.userId}&Limit=14&Fields=ProductionYear,Overview,RunTimeTicks,DateCreated`).catch(() => null),
      api(itemsUrl({
        SortBy: 'DateCreated', SortOrder: 'Descending',
        IncludeItemTypes: 'Movie', Recursive: 'true', Limit: '24',
        Fields: 'ProductionYear,Overview,Genres,RunTimeTicks,OfficialRating,CommunityRating,DateCreated'
      })).catch(() => null),
      api(itemsUrl({
        SortBy: 'DateCreated', SortOrder: 'Descending',
        IncludeItemTypes: 'Series', Recursive: 'true', Limit: '24',
        Fields: 'ProductionYear,Overview,Genres,OfficialRating,CommunityRating,DateCreated'
      })).catch(() => null),
      api(itemsUrl({
        SortBy: 'SortName', Filters: 'IsFavorite',
        IncludeItemTypes: 'Movie,Series', Recursive: 'true', Limit: '24',
        Fields: 'ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated'
      })).catch(() => null)
    ]);

    const movies = latestMovies?.Items || [];
    const series = latestSeries?.Items || [];

    // Für den Slider die Titel mit Backdrop bevorzugen — sonst wirkt er leer
    const spotlight = [...movies, ...series]
      .filter((item) => (item.BackdropImageTags || []).length)
      .sort(() => Math.random() - 0.5)
      .slice(0, 6);

    const pool = spotlight.length ? spotlight : [...movies, ...series].slice(0, 5);

    el.viewRoot.innerHTML = '';

    if (pool.length) el.viewRoot.appendChild(buildHeroSlider(pool));
    else setTopGap(true);

    const rows = [
      buildRow(t('home.resume'), resume?.Items || [], { onDismiss: true }),
      buildRow(t('home.nextUp'), nextUp?.Items || []),
      buildRow(t('home.newMovies'), movies),
      buildRow(t('home.newSeries'), series),
      buildRow(t('home.favoritesRow'), favorites?.Items || [])
    ].filter(Boolean);

    if (!rows.length && !pool.length) {
      showEmpty(t('home.noMedia'));
      return;
    }

    rows.forEach((row) => el.viewRoot.appendChild(row));
    setStatus(t('common.connected'));
  } catch (error) {
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

/* ========================= HERO SLIDER ========================= */

const SLIDE_DURATION = 8000;
let slideTimer = null;

function buildHeroSlider(items) {
  clearInterval(slideTimer);

  const slider = document.createElement('section');
  slider.className = 'hero-slider';
  slider.style.setProperty('--slide-duration', `${SLIDE_DURATION}ms`);

  items.forEach((item, index) => {
    const backdrop = imageUrl(item, 'Backdrop', 1440) || imageUrl(item, 'Primary', 1440);

    const slide = document.createElement('div');
    slide.className = `hero-slide ${index === 0 ? 'active' : ''}`;
    slide.innerHTML = `
      <div class="hero-bg" style="background-image:url('${backdrop}')"></div>
      <div class="hero-content">
        <div class="hero-badge">${item.Type === 'Series' ? 'Serie' : 'Film'}</div>
        <h2>${escapeHtml(item.Name || '')}</h2>
        <div class="hero-facts">
          ${item.ProductionYear ? `<span>${item.ProductionYear}</span>` : ''}
          ${item.OfficialRating ? `<span class="sep"></span><span class="rating">${escapeHtml(item.OfficialRating)}</span>` : ''}
          ${item.RunTimeTicks ? `<span class="sep"></span><span>${formatRuntime(item.RunTimeTicks)}</span>` : ''}
          ${item.CommunityRating ? `<span class="sep"></span><span>★ ${item.CommunityRating.toFixed(1)}</span>` : ''}
          ${item.Genres?.length ? `<span class="sep"></span><span>${escapeHtml(item.Genres.slice(0, 3).join(', '))}</span>` : ''}
        </div>
        <p class="hero-overview">${escapeHtml(item.Overview || '')}</p>
        <div class="hero-actions">
          <button class="play-btn" type="button">
            <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
            ${escapeHtml(item.Type === 'Series' ? t('hero.watch') : t('hero.play'))}
          </button>
          <button class="outline-btn" type="button">${escapeHtml(t('hero.moreInfo'))}</button>
        </div>
      </div>`;

    slide.querySelector('.play-btn').addEventListener('click', () => {
      if (item.Type === 'Series') openItem(item);
      else playItem(item);
    });
    slide.querySelector('.outline-btn').addEventListener('click', () => openItem(item));
    slider.appendChild(slide);
  });

  const dots = document.createElement('div');
  dots.className = 'hero-dots';

  const arrows = `
    <button class="hero-arrow prev" type="button" aria-label="${escapeHtml(t('hero.previous'))}">
      <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="hero-arrow next" type="button" aria-label="${escapeHtml(t('hero.next'))}">
      <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`;
  slider.insertAdjacentHTML('beforeend', arrows);

  let index = 0;

  function goTo(next) {
    const slides = slider.querySelectorAll('.hero-slide');
    const bullets = dots.querySelectorAll('.hero-dot');
    index = (next + slides.length) % slides.length;

    slides.forEach((slide, i) => slide.classList.toggle('active', i === index));
    bullets.forEach((dot, i) => {
      dot.classList.remove('active');
      // Reflow erzwingen, damit die Fortschritts-Animation neu startet
      void dot.offsetWidth;
      dot.classList.toggle('active', i === index);
    });
  }

  function restart() {
    clearInterval(slideTimer);
    slideTimer = setInterval(() => goTo(index + 1), SLIDE_DURATION);
  }

  items.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `hero-dot ${i === 0 ? 'active' : ''}`;
    dot.setAttribute('aria-label', `Titel ${i + 1}`);
    dot.addEventListener('click', () => { goTo(i); restart(); });
    dots.appendChild(dot);
  });

  slider.appendChild(dots);
  slider.querySelector('.hero-arrow.prev').addEventListener('click', () => { goTo(index - 1); restart(); });
  slider.querySelector('.hero-arrow.next').addEventListener('click', () => { goTo(index + 1); restart(); });

  // Beim Hovern anhalten, damit man in Ruhe lesen kann
  slider.addEventListener('mouseenter', () => {
    clearInterval(slideTimer);
    slider.classList.add('paused');
  });
  slider.addEventListener('mouseleave', () => {
    slider.classList.remove('paused');
    restart();
  });

  restart();
  return slider;
}
/* ==================== KATALOG (U1 + P1 + P2) ====================
   Eine Ansicht für Filme, Serien und Bibliotheken: mit Sortierung,
   Filtern und Nachladen beim Scrollen statt hartem Limit bei 400.
   ================================================================ */

const PAGE_SIZE = 100;

const SORTS = [
  { id: 'SortName-Ascending',         labelKey: 'sort.nameAsc' },
  { id: 'SortName-Descending',        labelKey: 'sort.nameDesc' },
  { id: 'DateCreated-Descending',     labelKey: 'sort.added' },
  { id: 'PremiereDate-Descending',    labelKey: 'sort.newest' },
  { id: 'PremiereDate-Ascending',     labelKey: 'sort.oldest' },
  { id: 'CommunityRating-Descending', labelKey: 'sort.bestRated' },
  { id: 'Runtime-Descending',         labelKey: 'sort.longest' },
  { id: 'Random-Ascending',           labelKey: 'sort.random' }
];

const catalog = {
  title: '', types: 'Movie,Series', parentId: null, shape: 'wide',
  sort: 'SortName-Ascending', filter: '', genre: '',
  items: [], total: 0, loading: false, done: false, observer: null
};

let catalogOutsideClick = null;

function catalogQuery(startIndex) {
  const [sortBy, sortOrder] = catalog.sort.split('-');
  const params = {
    IncludeItemTypes: catalog.types,
    Recursive: 'true',
    SortBy: sortBy,
    SortOrder: sortOrder,
    Fields: 'ProductionYear,Overview,Genres,RunTimeTicks,OfficialRating,CommunityRating,DateCreated,AlbumArtist',
    StartIndex: String(startIndex),
    Limit: String(PAGE_SIZE)
  };
  if (catalog.parentId) params.ParentId = catalog.parentId;
  if (catalog.filter) params.Filters = catalog.filter;
  if (catalog.genre) params.Genres = catalog.genre;
  return itemsUrl(params);
}

async function loadCatalogPage() {
  if (catalog.loading || catalog.done) return;
  catalog.loading = true;

  const token = requestTokens.catalog;
  const grid = $('catalog-grid');
  const sentinel = $('catalog-more');

  try {
    const data = await api(catalogQuery(catalog.items.length));
    if (!isCurrent('catalog', token)) return;

    const batch = data.Items || [];
    catalog.total = data.TotalRecordCount ?? batch.length;
    catalog.items = catalog.items.concat(batch);

    if (grid) {
      grid.querySelectorAll('.sk-card').forEach((node) => node.remove());
      const fragment = document.createDocumentFragment();
      batch.forEach((item) => fragment.appendChild(buildCard(item, { shape: catalog.shape })));
      grid.appendChild(fragment);
    }

    if (batch.length < PAGE_SIZE || catalog.items.length >= catalog.total) {
      catalog.done = true;
      if (catalog.observer) catalog.observer.disconnect();
      if (sentinel) sentinel.remove();
    }

    const counter = $('catalog-count');
    if (counter) {
      counter.textContent = catalog.done
        ? `${catalog.items.length} Titel`
        : `${catalog.items.length} von ${catalog.total}`;
    }

    if (!catalog.items.length && grid) {
      grid.innerHTML = `<div class="empty-state">${escapeHtml(t('catalog.noneForFilter'))}</div>`;
    }
  } catch (error) {
    if (!isCurrent('catalog', token)) return;
    console.error(error);
    if (sentinel) {
      sentinel.innerHTML = '<button type="button" class="outline-btn" id="more-retry">Weitere laden</button>';
      const retry = $('more-retry');
      if (retry) {
        retry.addEventListener('click', () => {
          sentinel.innerHTML = '<div class="spinner small"></div>';
          catalog.loading = false;
          loadCatalogPage();
        });
      }
    }
  } finally {
    catalog.loading = false;
  }
}

function renderCatalogShell(genres) {
  const sortOptions = SORTS.map((s) =>
    `<button type="button" class="drop-option ${s.id === catalog.sort ? 'active' : ''}" data-sort="${s.id}">${escapeHtml(t(s.labelKey))}</button>`
  ).join('');

  const genreOptions = [`<button type="button" class="drop-option active" data-genre="">${escapeHtml(t('catalog.allGenres'))}</button>`]
    .concat(genres.map((g) =>
      `<button type="button" class="drop-option" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`))
    .join('');

  el.viewRoot.innerHTML = `
    <div class="catalog-head">
      <h2 class="section-title">${escapeHtml(catalog.title)}</h2>
      <span class="catalog-count" id="catalog-count"></span>
    </div>

    <div class="filter-bar">
      <div class="drop">
        <button type="button" class="drop-trigger" id="sort-trigger" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span id="sort-label">${escapeHtml(t(SORTS.find((s) => s.id === catalog.sort)?.labelKey || 'sort.label'))}</span>
        </button>
        <div class="drop-menu hidden" id="sort-menu">${sortOptions}</div>
      </div>

      ${genres.length ? `
      <div class="drop">
        <button type="button" class="drop-trigger" id="genre-trigger" aria-haspopup="true" aria-expanded="false">
          <span id="genre-label">${escapeHtml(t('catalog.allGenres'))}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="drop-menu hidden" id="genre-menu">${genreOptions}</div>
      </div>` : ''}

      <div class="seg" role="group" aria-label="${escapeHtml(t('filter.group'))}">
        <button type="button" class="seg-btn active" data-filter="">${escapeHtml(t('filter.all'))}</button>
        <button type="button" class="seg-btn" data-filter="IsUnplayed">${escapeHtml(t('filter.unwatched'))}</button>
        <button type="button" class="seg-btn" data-filter="IsPlayed">${escapeHtml(t('filter.watched'))}</button>
        <button type="button" class="seg-btn" data-filter="IsFavorite">${escapeHtml(t('filter.favorites'))}</button>
      </div>
    </div>

    <div class="grid ${catalog.shape === 'square' ? 'squares' : ''}" id="catalog-grid"></div>
    <div class="load-more" id="catalog-more"><div class="spinner small"></div></div>`;
}

function wireCatalogControls() {
  const closeDrops = () => {
    document.querySelectorAll('.drop-menu').forEach((m) => m.classList.add('hidden'));
    document.querySelectorAll('.drop-trigger').forEach((t) => {
      t.classList.remove('open');
      t.setAttribute('aria-expanded', 'false');
    });
  };

  const wireDrop = (triggerId, menuId, labelId, attr, onPick) => {
    const trigger = $(triggerId);
    const menu = $(menuId);
    if (!trigger || !menu) return;

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const willOpen = menu.classList.contains('hidden');
      closeDrops();
      if (willOpen) {
        menu.classList.remove('hidden');
        trigger.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });

    menu.querySelectorAll('.drop-option').forEach((option) => {
      option.addEventListener('click', () => {
        menu.querySelectorAll('.drop-option').forEach((o) => o.classList.remove('active'));
        option.classList.add('active');
        $(labelId).textContent = option.textContent;
        closeDrops();
        onPick(option.dataset[attr]);
      });
    });
  };

  wireDrop('sort-trigger', 'sort-menu', 'sort-label', 'sort', (value) => {
    catalog.sort = value;
    restartCatalog();
  });

  wireDrop('genre-trigger', 'genre-menu', 'genre-label', 'genre', (value) => {
    catalog.genre = value;
    restartCatalog();
  });

  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      catalog.filter = btn.dataset.filter;
      restartCatalog();
    });
  });

  // F1: genau ein Listener, der sich selbst abmeldet, sobald die Ansicht weg ist
  if (catalogOutsideClick) document.removeEventListener('click', catalogOutsideClick);
  catalogOutsideClick = (event) => {
    if (!document.getElementById('sort-menu')) {
      document.removeEventListener('click', catalogOutsideClick);
      catalogOutsideClick = null;
      return;
    }
    if (!event.target.closest('.drop')) closeDrops();
  };
  document.addEventListener('click', catalogOutsideClick);

  // P1: nachladen, sobald das Ende in Sichtweite kommt
  const sentinel = $('catalog-more');
  if (sentinel && 'IntersectionObserver' in window) {
    catalog.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadCatalogPage();
    }, { rootMargin: '600px' });
    catalog.observer.observe(sentinel);
  }
}

function restartCatalog() {
  newToken('catalog');
  catalog.items = [];
  catalog.done = false;
  catalog.loading = false;

  const grid = $('catalog-grid');
  if (grid) {
    grid.innerHTML = Array.from({ length: 10 }, () =>
      `<div class="sk-card ${catalog.shape}"><div class="sk-art"></div><div class="sk-line"></div></div>`).join('');
  }

  let sentinel = $('catalog-more');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.className = 'load-more';
    sentinel.id = 'catalog-more';
    el.viewRoot.appendChild(sentinel);
    if (catalog.observer) catalog.observer.observe(sentinel);
  }
  sentinel.innerHTML = '<div class="spinner small"></div>';

  loadCatalogPage();
}

async function openCatalog({ title, types, parentId = null, shape = 'wide', filter = '', genre = '' }) {
  setTopGap(true);
  newToken('catalog');

  Object.assign(catalog, {
    title, types, parentId, shape,
    sort: 'SortName-Ascending', filter, genre,
    items: [], total: 0, loading: false, done: false
  });

  if (catalog.observer) catalog.observer.disconnect();

  el.viewRoot.innerHTML = skeletonCards(12, shape);

  // Genres für den Filter — schlägt das fehl, läuft die Ansicht ohne weiter
  let genres = [];
  try {
    const params = new URLSearchParams({ userId: state.userId, SortBy: 'SortName' });
    if (parentId) params.set('ParentId', parentId);
    const data = await api(`/Genres?${params}`);
    genres = (data.Items || []).map((g) => g.Name).slice(0, 40);
  } catch (error) {
    /* optional */
  }

  renderCatalogShell(genres);

  if (filter) {
    document.querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === filter);
    });
  }

  wireCatalogControls();
  await loadCatalogPage();
  setStatus(title);
}

function showCatalog(kind) {
  setActiveNav(kind);
  const isMovies = kind === 'movies';
  return openCatalog({
    title: isMovies ? t('nav.movies') : t('nav.series'),
    types: isMovies ? 'Movie,BoxSet' : 'Series'
  });
}

function showLibrary(library) {
  setActiveNav(null);
  document.querySelectorAll('.library-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.id === library.Id);
  });

  const isMusic = library.CollectionType === 'music';
  return openCatalog({
    title: library.Name,
    types: isMusic ? 'MusicAlbum' : 'Movie,Series',
    parentId: library.Id,
    shape: isMusic ? 'square' : 'wide'
  });
}

/* X4: eigene Ansicht für Gemerktes */
function showFavorites() {
  setActiveNav('favorites');
  return openCatalog({
    title: t('nav.favorites'),
    types: 'Movie,Series,MusicAlbum',
    filter: 'IsFavorite'
  });
}

async function showMusic() {
  setActiveNav('music');
  setTopGap(true);
  showLoader();

  try {
    const albumFields = 'AlbumArtist,ProductionYear,DateCreated,ChildCount';

    const [albums, artists, recent, favorites] = await Promise.all([
      api(itemsUrl({
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        SortBy: 'DateCreated',
        SortOrder: 'Descending',
        Fields: albumFields,
        Limit: '40'
      })).catch(() => null),
      api(itemsUrl({
        IncludeItemTypes: 'MusicArtist',
        Recursive: 'true',
        SortBy: 'SortName',
        Limit: '30'
      })).catch(() => null),
      // Zuletzt Gehörtes: der häufigste Einstieg in die eigene Sammlung
      api(itemsUrl({
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        SortBy: 'DatePlayed',
        SortOrder: 'Descending',
        Filters: 'IsPlayed',
        Fields: albumFields,
        Limit: '20'
      })).catch(() => null),
      api(itemsUrl({
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        SortBy: 'SortName',
        Filters: 'IsFavorite',
        Fields: albumFields,
        Limit: '20'
      })).catch(() => null)
    ]);

    el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('music.title'))}</h2>`;

    const rows = [
      buildRow(t('music.recentlyPlayed'), recent?.Items || [], { shape: 'square' }),
      buildRow(t('music.favoriteAlbums'), favorites?.Items || [], { shape: 'square' }),
      buildRow(t('music.recentAlbums'), albums?.Items || [], { shape: 'square' }),
      buildRow(t('music.artists'), artists?.Items || [], { shape: 'square' })
    ].filter(Boolean);

    if (!rows.length) {
      el.viewRoot.insertAdjacentHTML('beforeend', `<div class="empty-state">${escapeHtml(t('music.noMusic'))}</div>`);
      return;
    }

    rows.forEach((row) => el.viewRoot.appendChild(row));
    setStatus(t('music.title'));
  } catch (error) {
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

/* ======================= SERIES / SEASONS ======================= */

const DETAIL_FIELDS =
  'Overview,Genres,Studios,People,ProductionYear,OfficialRating,CommunityRating,CriticRating,' +
  'RunTimeTicks,MediaSources,MediaStreams,Taglines,ProviderIds,PremiereDate,EndDate,Status,' +
  'ChildCount,RecursiveItemCount,ExternalUrls,Path,Container';

// Echte Infoseite — für Serien und Filme
async function showDetail(base) {
  setTopGap(false);
  showLoader();

  const isSeries = base.Type === 'Series';

  try {
    const [detail, seasonsData, similarData] = await Promise.all([
      api(`/Users/${state.userId}/Items/${base.Id}?Fields=${DETAIL_FIELDS}`).catch(() => base),
      isSeries
        ? api(`/Shows/${base.Id}/Seasons?userId=${state.userId}&Fields=ProductionYear,ChildCount`).catch(() => null)
        : Promise.resolve(null),
      api(`/Items/${base.Id}/Similar?userId=${state.userId}&Limit=14&Fields=ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated`).catch(() => null)
    ]);

    const item = detail || base;
    const seasons = seasonsData?.Items || [];
    const similar = similarData?.Items || [];

    const backdrop = imageUrl(item, 'Backdrop', 1440) || imageUrl(item, 'Primary', 1440);
    const poster = imageUrl(item, 'Primary', 600);
    const isFavorite = Boolean(item.UserData?.IsFavorite);
    const resumeTicks = item.UserData?.PlaybackPositionTicks || 0;

    const facts = [
      item.ProductionYear,
      item.OfficialRating ? `<span class="rating">${escapeHtml(item.OfficialRating)}</span>` : '',
      isSeries
        ? (seasons.length ? `${seasons.length} Staffel${seasons.length === 1 ? '' : 'n'}` : '')
        : formatRuntime(item.RunTimeTicks),
      item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : '',
      item.CriticRating ? `${Math.round(item.CriticRating)} % Kritiker` : ''
    ].filter(Boolean);

    el.viewRoot.innerHTML = `
      <section class="detail-hero">
        <div class="detail-bg" style="background-image:url('${backdrop}')"></div>
        <div class="detail-inner">
          <div class="detail-poster">${poster ? `<img src="${poster}" alt="">` : ''}</div>
          <div class="detail-info">
            <h2>${escapeHtml(item.Name || '')}</h2>
            ${item.Taglines?.length ? `<p class="hero-overview" style="margin-bottom:10px">${escapeHtml(item.Taglines[0])}</p>` : ''}
            <div class="hero-facts">${facts.join('<span class="sep"></span>')}</div>

            <div class="detail-actions">
              <button class="play-btn" id="detail-play" type="button">
                <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
                ${escapeHtml(resumeTicks > 0 ? t('detail.resume') : isSeries ? t('detail.firstEpisode') : t('detail.play'))}
              </button>
              <button class="outline-btn" id="detail-fav" type="button" data-on="${isFavorite ? '1' : '0'}">
                ${isFavorite ? ICON_CHECK : ICON_PLUS}
                ${escapeHtml(isFavorite ? t('detail.remembered') : t('detail.remember'))}
              </button>
              <button class="outline-btn" id="detail-watched" type="button" data-played="${item.UserData?.Played ? '1' : '0'}">
                ${ICON_CHECK} ${escapeHtml(item.UserData?.Played ? t('detail.markUnwatched') : t('detail.markWatched'))}
              </button>
              ${isDownloadable(item) ? `<button class="outline-btn" id="detail-download" type="button"
                  data-dl-item="${escapeHtml(item.Id)}">${ICON_DOWNLOAD} ${escapeHtml(t('detail.download'))}</button>` : ''}
            </div>

            ${item.Genres?.length ? `<div class="detail-tags">${item.Genres.map((g) =>
              `<button type="button" class="genre-chip" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`
            ).join('')}</div>` : ''}
          </div>
        </div>
      </section>

      <div class="detail-tabs" id="detail-tabs">
        ${isSeries ? `<button class="detail-tab active" data-tab="episodes" type="button">${escapeHtml(t('detail.tabEpisodes'))}</button>` : ''}
        <button class="detail-tab ${isSeries ? '' : 'active'}" data-tab="about" type="button">${escapeHtml(t('detail.tabAbout'))}</button>
        <button class="detail-tab" data-tab="cast" type="button">${escapeHtml(t('detail.tabCast'))}</button>
        <button class="detail-tab" data-tab="tech" type="button">${escapeHtml(t('detail.tabTech'))}</button>
        ${similar.length ? `<button class="detail-tab" data-tab="similar" type="button">${escapeHtml(t('detail.tabSimilar'))}</button>` : ''}
      </div>

      <div id="tab-content"></div>`;

    const panels = {
      episodes: () => renderEpisodesPanel(item, seasons),
      about: () => renderAboutPanel(item),
      cast: () => renderCastPanel(item),
      tech: () => renderTechPanel(item),
      similar: () => renderSimilarPanel(similar)
    };

    const tabs = $('detail-tabs');
    tabs.querySelectorAll('.detail-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.querySelectorAll('.detail-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        panels[tab.dataset.tab]();
      });
    });

    panels[isSeries ? 'episodes' : 'about']();

    /* --- Aktionen --- */
    $('detail-play').addEventListener('click', async () => {
      if (!isSeries) return playVideo(item);
      // Bei Serien die nächste offene Folge starten
      try {
        const next = await api(`/Shows/NextUp?userId=${state.userId}&seriesId=${item.Id}&Limit=1`);
        const episode = next?.Items?.[0];
        if (episode) return playVideo(episode);
      } catch (error) {
        /* Fallback unten */
      }
      if (seasons.length) {
        const eps = await api(`/Shows/${item.Id}/Episodes?seasonId=${seasons[0].Id}&userId=${state.userId}`).catch(() => null);
        if (eps?.Items?.length) playVideo(eps.Items[0], eps.Items);
      }
    });

    const favBtn = $('detail-fav');
    favBtn.addEventListener('click', async () => {
      const on = favBtn.dataset.on === '1';
      try {
        await api(`/Users/${state.userId}/FavoriteItems/${item.Id}`, { method: on ? 'DELETE' : 'POST' });
        // Zustand am Element statt am Text — der Text ist übersetzt
        favBtn.dataset.on = on ? '0' : '1';
        favBtn.innerHTML = `${on ? ICON_PLUS : ICON_CHECK} ${escapeHtml(on ? t('detail.remember') : t('detail.remembered'))}`;
      } catch (error) {
        toast(t('detail.favoriteFailed'), true);
      }
    });

    $('detail-download')?.addEventListener('click', () => openDownloadModal(item));
    if (typeof updateDownloadButtons === 'function') updateDownloadButtons();

    // Genre-Chips führen in den gefilterten Katalog
    el.viewRoot.querySelectorAll('.genre-chip[data-genre]').forEach((chip) => {
      chip.addEventListener('click', () => navigate(() => showGenre(chip.dataset.genre)));
    });

    const watchedBtn = $('detail-watched');
    watchedBtn.addEventListener('click', async () => {
      const wasPlayed = watchedBtn.dataset.played === '1';
      try {
        await api(`/Users/${state.userId}/PlayedItems/${item.Id}`, { method: wasPlayed ? 'DELETE' : 'POST' });
        watchedBtn.dataset.played = wasPlayed ? '0' : '1';
        watchedBtn.innerHTML = `${ICON_CHECK} ${escapeHtml(wasPlayed ? t('detail.markWatched') : t('detail.markUnwatched'))}`;
      } catch (error) {
        toast(t('detail.statusFailed'), true);
      }
    });

    setStatus(item.Name || '');
  } catch (error) {
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

/* ---------------------- PANELS DER INFOSEITE ---------------------- */

function renderEpisodesPanel(item, seasons) {
  const host = $('tab-content');

  if (!seasons.length) {
    host.innerHTML = `<div class="tab-panel"><div class="empty-state">${escapeHtml(t('detail.noSeasons'))}</div></div>`;
    return;
  }

  host.innerHTML = `
    <div class="tab-panel">
      <div class="season-bar">
        <h3>${escapeHtml(t('detail.episodes'))}</h3>
        <div class="season-select">
          <button class="season-trigger" id="season-trigger" type="button" aria-haspopup="true" aria-expanded="false">
            <span id="season-label">Staffel</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="season-menu hidden" id="season-menu"></div>
        </div>
      </div>
      <div class="episode-list" id="episode-list"></div>
    </div>`;

  const trigger = $('season-trigger');
  const menu = $('season-menu');
  const label = $('season-label');

  const seasonName = (season, index) => season.Name || `Staffel ${season.IndexNumber ?? index + 1}`;

  function closeSeasonMenu() {
    menu.classList.add('hidden');
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  function selectSeason(index) {
    const season = seasons[index];
    label.textContent = seasonName(season, index);
    menu.querySelectorAll('.season-option').forEach((option, i) => {
      option.classList.toggle('active', i === index);
    });
    closeSeasonMenu();
    loadEpisodes(item.Id, season.Id);
  }

  seasons.forEach((season, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `season-option ${index === 0 ? 'active' : ''}`;
    const count = season.ChildCount ? `<small>${season.ChildCount} Folgen</small>` : '';
    option.innerHTML = `<span>${escapeHtml(seasonName(season, index))}</span>${count}`;
    option.addEventListener('click', () => selectSeason(index));
    menu.appendChild(option);
  });

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = menu.classList.contains('hidden');
    closeSeasonMenu();
    if (willOpen) {
      menu.classList.remove('hidden');
      trigger.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  });

  // F1: Früher hing hier ein document-Listener, der beim Verlassen der Seite
  // nie entfernt wurde und sich über die Sitzung stapelte. Jetzt wird der
  // vorherige zuerst abgemeldet.
  if (seasonOutsideClick) {
    document.removeEventListener('click', seasonOutsideClick);
  }
  seasonOutsideClick = (event) => {
    if (!document.getElementById('season-menu')) {
      // Ansicht ist weg -> Listener selbst abmelden
      document.removeEventListener('click', seasonOutsideClick);
      seasonOutsideClick = null;
      return;
    }
    if (!event.target.closest('.season-select')) closeSeasonMenu();
  };
  document.addEventListener('click', seasonOutsideClick);

  selectSeason(0);
}

let seasonOutsideClick = null;

function renderAboutPanel(item) {
  const dateText = (value) => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(typeof localeTag === 'function' ? localeTag() : 'en', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  const directors = (item.People || []).filter((p) => p.Type === 'Director').map((p) => p.Name);
  const writers = (item.People || []).filter((p) => p.Type === 'Writer').map((p) => p.Name);

  const rows = [
    [t('detail.premiere'), dateText(item.PremiereDate)],
    [t('detail.status'), item.Status === 'Continuing' ? t('detail.statusRunning') : item.Status === 'Ended' ? t('detail.statusEnded') : item.Status],
    [t('detail.director'), directors.slice(0, 3).join(', ')],
    [t('detail.writer'), writers.slice(0, 3).join(', ')],
    [t('detail.studio'), (item.Studios || []).map((s) => s.Name).slice(0, 3).join(', ')],
    [t('detail.ageRating'), item.OfficialRating],
    [t('detail.runtime'), formatRuntime(item.RunTimeTicks)],
    [t('detail.episodeCount'), item.RecursiveItemCount || ''],
    [t('detail.genres'), (item.Genres || []).join(', ')]
  ].filter(([, value]) => value);

  $('tab-content').innerHTML = `
    <div class="tab-panel">
      ${item.Overview ? `<p class="detail-overview">${escapeHtml(item.Overview)}</p>` : ''}
      ${rows.length ? `
        <dl class="detail-facts-grid">
          ${rows.map(([key, value]) => `
            <div class="fact-row"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join('')}
        </dl>` : ''}
      ${!item.Overview && !rows.length ? `<div class="empty-state">${escapeHtml(t('detail.noDetails'))}</div>` : ''}
    </div>`;
}

function renderCastPanel(item) {
  const people = (item.People || []).filter((p) => p.Type === 'Actor' || p.Type === 'Director' || p.Type === 'Writer');

  if (!people.length) {
    $('tab-content').innerHTML = `<div class="tab-panel"><div class="empty-state">${escapeHtml(t('detail.noCast'))}</div></div>`;
    return;
  }

  const cards = people.slice(0, 40).map((person) => {
    const photo = person.PrimaryImageTag
      ? `${state.serverUrl}/Items/${person.Id}/Images/Primary?maxHeight=240&quality=90&tag=${person.PrimaryImageTag}`
      : '';
    const role = person.Role || (person.Type === 'Director' ? t('detail.director') : person.Type === 'Writer' ? t('detail.writer') : '');
    return `
      <button class="cast-card" type="button" data-person="${escapeHtml(person.Id || '')}"
              data-person-name="${escapeHtml(person.Name || '')}">
        ${photo
          ? `<img class="cast-photo" src="${photo}" alt="" loading="lazy">`
          : `<div class="cast-photo placeholder">${escapeHtml((person.Name || '?').charAt(0))}</div>`}
        <div class="cast-name">${escapeHtml(person.Name || '')}</div>
        ${role ? `<div class="cast-role">${escapeHtml(role)}</div>` : ''}
      </button>`;
  }).join('');

  $('tab-content').innerHTML = `<div class="tab-panel"><div class="cast-row">${cards}</div></div>`;

  // Klick auf eine Person zeigt, worin sie sonst noch mitspielt
  $('tab-content').querySelectorAll('.cast-card[data-person]').forEach((card) => {
    if (!card.dataset.person) return;
    card.addEventListener('click', () => {
      navigate(() => showPerson({ Id: card.dataset.person, Name: card.dataset.personName }));
    });
  });
}

/* ---------------- Personen ---------------- */

async function showPerson(person) {
  setActiveNav(null);
  setTopGap(true);
  showLoader();

  try {
    const [detail, items] = await Promise.all([
      api(`/Users/${state.userId}/Items/${person.Id}`).catch(() => person),
      api(itemsUrl({
        PersonIds: person.Id,
        Recursive: 'true',
        IncludeItemTypes: 'Movie,Series',
        SortBy: 'PremiereDate,SortName',
        SortOrder: 'Descending',
        Fields: 'ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated',
        Limit: '60'
      })).catch(() => null)
    ]);

    const photo = detail?.ImageTags?.Primary
      ? `${state.serverUrl}/Items/${detail.Id}/Images/Primary?maxHeight=400&quality=90&tag=${detail.ImageTags.Primary}`
      : '';

    el.viewRoot.innerHTML = `
      <div class="person-head">
        ${photo ? `<img class="person-photo" src="${photo}" alt="">` : ''}
        <div class="person-meta">
          <h2>${escapeHtml(detail?.Name || person.Name || '')}</h2>
          ${detail?.Overview ? `<p class="person-bio">${escapeHtml(detail.Overview)}</p>` : ''}
        </div>
      </div>
      <div id="person-items"></div>`;

    const host = $('person-items');
    const list = items?.Items || [];

    if (!list.length) {
      host.innerHTML = `<div class="empty-state">${escapeHtml(t('person.noItems'))}</div>`;
    } else {
      const row = document.createElement('div');
      row.className = 'grid';
      list.forEach((entry) => row.appendChild(buildCard(entry)));
      host.innerHTML = `<h3 class="section-title">${escapeHtml(t('person.filmography'))}</h3>`;
      host.appendChild(row);
    }

    setStatus(detail?.Name || person.Name || '');
  } catch (error) {
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

/* ---------------- Sammlungen ---------------- */

/* Eine Sammlung ("Harry Potter") gruppiert mehrere Titel. Ohne diese
   Ansicht landete ein Klick darauf in der Detailseite und zeigte
   nichts Sinnvolles. */
async function showCollection(collection) {
  setActiveNav(null);
  setTopGap(true);
  showLoader();

  try {
    const data = await api(itemsUrl({
      ParentId: collection.Id,
      SortBy: 'PremiereDate,SortName',
      Fields: 'ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated'
    }));

    const items = data.Items || [];

    el.viewRoot.innerHTML = `
      <h2 class="section-title">${escapeHtml(collection.Name || '')}</h2>
      <p class="settings-hint">${escapeHtml(t('collection.items', { count: items.length }))}</p>
      <div class="grid" id="collection-grid"></div>`;

    const grid = $('collection-grid');
    if (!items.length) {
      grid.outerHTML = `<div class="empty-state">${escapeHtml(t('home.empty'))}</div>`;
    } else {
      items.forEach((entry) => grid.appendChild(buildCard(entry)));
    }

    setStatus(collection.Name || '');
  } catch (error) {
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

/* ---------------- Genre ---------------- */

function showGenre(name) {
  setActiveNav(null);
  return openCatalog({
    title: t('genre.title', { name }),
    types: 'Movie,Series,BoxSet',
    genre: name
  });
}

function renderTechPanel(item) {
  const sources = item.MediaSources || [];

  if (!sources.length) {
    $('tab-content').innerHTML = `<div class="tab-panel"><div class="empty-state">${escapeHtml(t('detail.noTechInfo'))}</div></div>`;
    return;
  }

  const source = sources[0];
  const streams = source.MediaStreams || [];
  const video = streams.filter((s) => s.Type === 'Video');
  const audio = streams.filter((s) => s.Type === 'Audio');
  const subs = streams.filter((s) => s.Type === 'Subtitle');

  const line = (k, v) => (v ? `<div class="tech-line"><span class="k">${k}</span><span class="v">${escapeHtml(String(v))}</span></div>` : '');

  const blocks = [];

  blocks.push(`
    <div class="tech-block">
      <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9.5 5 2.5-5 2.5z" fill="currentColor" stroke="none"/></svg> ${escapeHtml(t('detail.file'))}</h4>
      ${line(t('detail.container'), source.Container?.toUpperCase())}
      ${line(t('detail.size'), source.Size ? `${(source.Size / 1073741824).toFixed(2)} GB` : '')}
      ${line(t('detail.bitrate'), source.Bitrate ? `${Math.round(source.Bitrate / 1000)} kbps` : '')}
      ${line(t('detail.runtime'), formatRuntime(source.RunTimeTicks || item.RunTimeTicks))}
    </div>`);

  video.forEach((stream) => blocks.push(`
    <div class="tech-block">
      <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2.5" y="6" width="14" height="12" rx="2"/><path d="m17 11 4.5-2.6v7.2L17 13z"/></svg> ${escapeHtml(t('detail.video'))}</h4>
      ${line(t('detail.codec'), stream.Codec?.toUpperCase())}
      ${line(t('detail.resolution'), stream.Width && stream.Height ? `${stream.Width} × ${stream.Height}` : '')}
      ${line(t('detail.framerate'), stream.RealFrameRate ? `${stream.RealFrameRate.toFixed(2)} fps` : '')}
      ${line(t('detail.bitrate'), stream.BitRate ? `${Math.round(stream.BitRate / 1000)} kbps` : '')}
      ${line('HDR', stream.VideoRange && stream.VideoRange !== 'SDR' ? stream.VideoRange : '')}
      ${line(t('detail.profile'), stream.Profile)}
    </div>`));

  if (audio.length) blocks.push(`
    <div class="tech-block">
      <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 9.5h3.5L13 5.5v13L8.5 14.5H5z" fill="currentColor" stroke="none"/><path d="M16.5 9a4 4 0 0 1 0 6" stroke-linecap="round"/></svg> ${escapeHtml(t('detail.audioTracks', { count: audio.length }))}</h4>
      ${audio.map((stream) => `
        <div class="tech-line">
          <span class="k">${escapeHtml(languageName(stream.Language) || '—')}</span>
          <span class="v">
            ${stream.Codec ? `<span class="tech-badge">${escapeHtml(stream.Codec.toUpperCase())}</span>` : ''}
            ${stream.ChannelLayout ? `<span class="tech-badge">${escapeHtml(stream.ChannelLayout)}</span>` : ''}
            ${stream.IsDefault ? `<span class="tech-badge">${escapeHtml(t('detail.default'))}</span>` : ''}
          </span>
        </div>`).join('')}
    </div>`);

  if (subs.length) blocks.push(`
    <div class="tech-block">
      <h4><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6.8 14.2h4M13.2 14.2h4" stroke-linecap="round"/></svg> ${escapeHtml(t('detail.subtitleTracks', { count: subs.length }))}</h4>
      ${subs.map((stream) => `
        <div class="tech-line">
          <span class="k">${escapeHtml(languageName(stream.Language) || '—')}</span>
          <span class="v">
            ${stream.Codec ? `<span class="tech-badge">${escapeHtml(stream.Codec.toUpperCase())}</span>` : ''}
            ${stream.IsForced ? `<span class="tech-badge">${escapeHtml(t('detail.forced'))}</span>` : ''}
            ${stream.IsExternal ? `<span class="tech-badge">${escapeHtml(t('detail.external'))}</span>` : ''}
          </span>
        </div>`).join('')}
    </div>`);

  $('tab-content').innerHTML = `<div class="tab-panel"><div class="tech-grid">${blocks.join('')}</div></div>`;
}

function renderSimilarPanel(items) {
  const host = $('tab-content');
  host.innerHTML = '<div class="tab-panel"><div class="grid" id="similar-grid"></div></div>';
  const grid = $('similar-grid');
  items.forEach((entry) => grid.appendChild(buildCard(entry)));
}

async function loadEpisodes(seriesId, seasonId) {
  const list = $('episode-list');
  if (!list) return;

  // F2: Schneller Staffelwechsel darf keine veraltete Antwort einblenden
  const token = newToken('episodes');
  list.innerHTML = skeletonEpisodes(4);

  try {
    const data = await api(
      `/Shows/${seriesId}/Episodes?seasonId=${seasonId}&userId=${state.userId}&Fields=Overview,RunTimeTicks,MediaSources`
    );
    if (!isCurrent('episodes', token)) return;

    const episodes = data.Items || [];

    if (!episodes.length) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(t('detail.noEpisodesInSeason'))}</div>`;
      return;
    }

    list.innerHTML = '';
    episodes.forEach((episode) => list.appendChild(buildEpisodeRow(episode, episodes)));
  } catch (error) {
    if (!isCurrent('episodes', token)) return;
    console.error(error);
    list.innerHTML = `
      <div class="error-state compact">
        <p class="error-msg">${escapeHtml(t('detail.episodesFailed'))}</p>
        <button type="button" class="outline-btn" id="ep-retry">${escapeHtml(t('common.retry'))}</button>
      </div>`;
    const retry = $('ep-retry');
    if (retry) retry.addEventListener('click', () => loadEpisodes(seriesId, seasonId));
  }
}

function buildEpisodeRow(episode, siblings) {
  const row = document.createElement('article');
  row.className = 'episode';

  const thumb = imageUrl(episode, 'Primary', 420);
  const userData = episode.UserData || {};
  const played = userData.PlayedPercentage;
  const isWatched = Boolean(userData.Played);
  const inProgress = played > 0 && played < 100;

  const remaining = inProgress
    ? formatRuntime(episode.RunTimeTicks * (1 - played / 100))
    : '';

  row.innerHTML = `
    <div class="ep-index">${episode.IndexNumber ?? '–'}</div>
    <div class="ep-thumb">
      ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : FALLBACK_ICON}
      ${PLAY_CIRCLE}
      ${inProgress ? `<div class="progress-bar"><div style="width:${played}%"></div></div>` : ''}
    </div>
    <div class="ep-body">
      <div class="ep-head">
        <span class="ep-title">${escapeHtml(episode.Name || t('card.untitled'))}</span>
        <span class="ep-runtime">${formatRuntime(episode.RunTimeTicks)}</span>
        <button class="ep-seen ${isWatched ? 'on' : ''}" type="button"
                title="${escapeHtml(isWatched ? t('card.markUnwatched') : t('card.markWatched'))}"
                aria-label="${escapeHtml(t('card.watched'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
        </button>
        ${isDownloadable(episode) ? `<button class="ep-seen ep-dl" type="button"
                data-dl-item="${escapeHtml(episode.Id)}"
                title="${escapeHtml(t('card.download'))}" aria-label="${escapeHtml(t('card.download'))}">${ICON_DOWNLOAD}</button>` : ''}
      </div>
      <p class="ep-overview">${escapeHtml(episode.Overview || '')}</p>
      ${inProgress || isWatched ? `
        <div class="ep-meta">
          ${inProgress ? `
            <div class="ep-resume"><div style="width:${played}%"></div></div>
            <span>${escapeHtml(t('episode.remaining', { time: remaining }))}</span>` : ''}
          ${isWatched && !inProgress ? `
            <span class="ep-watched">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
              ${escapeHtml(t('episode.watched'))}
            </span>` : ''}
        </div>` : ''}
    </div>`;

  row.addEventListener('click', () => playVideo(episode, siblings));

  row.querySelector('.ep-dl')?.addEventListener('click', (event) => {
    event.stopPropagation();
    openDownloadModal(episode);
  });
  if (typeof updateDownloadButtons === 'function') setTimeout(updateDownloadButtons, 0);

  // U6: Haken pro Folge — Klick darf die Wiedergabe nicht auslösen
  const seenBtn = row.querySelector('.ep-seen');
  seenBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const wasPlayed = seenBtn.classList.contains('on');
    seenBtn.classList.toggle('on', !wasPlayed);
    try {
      await togglePlayed(episode, !wasPlayed);
      seenBtn.title = wasPlayed ? t('card.markWatched') : t('card.markUnwatched');
    } catch (error) {
      seenBtn.classList.toggle('on', wasPlayed);
      toast(t('common.statusChangeFailed'), true);
    }
  });

  return row;
}

/* ======================= ALBUM / TRACKS ======================= */

async function showAlbum(album) {
  setTopGap(false);
  showLoader();

  try {
    const data = await api(itemsUrl({
      ParentId: album.Id,
      SortBy: 'ParentIndexNumber,IndexNumber,SortName',
      Fields: 'Artists,AlbumArtist,RunTimeTicks'
    }));

    const tracks = data.Items || [];
    const art = imageUrl(album, 'Primary', 600);

    /* Gesamtlaufzeit aus den Titeln — Jellyfin liefert sie fürs
       Album nicht mit. */
    const totalTicks = tracks.reduce((sum, track) => sum + (track.RunTimeTicks || 0), 0);

    const facts = [
      album.ProductionYear ? String(album.ProductionYear) : '',
      t('album.trackCount', { count: tracks.length }),
      totalTicks ? formatRuntime(totalTicks) : '',
      (album.Genres || []).slice(0, 2).join(', ')
    ].filter(Boolean);

    el.viewRoot.innerHTML = `
      <section class="detail-hero">
        <div class="detail-bg" style="background-image:url('${escapeHtml(art)}')"></div>
        <div class="detail-inner">
          <div class="detail-poster" style="aspect-ratio:1/1">${art ? `<img src="${escapeHtml(art)}" alt="">` : ''}</div>
          <div class="detail-info">
            <h2>${escapeHtml(album.Name || '')}</h2>
            ${album.AlbumArtist ? `<button class="album-artist-link" id="album-artist" type="button">${escapeHtml(album.AlbumArtist)}</button>` : ''}
            <div class="hero-facts">${facts.map(escapeHtml).join('<span class="sep"></span>')}</div>
            <div class="hero-actions">
              <button class="play-btn" id="album-play" type="button">
                <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
                ${escapeHtml(t('music.play'))}
              </button>
              <button class="outline-btn" id="album-shuffle" type="button">${escapeHtml(t('music.shuffle'))}</button>
            </div>
          </div>
        </div>
      </section>
      <div class="mf-queue" id="track-list" style="overflow:visible"></div>`;

    /* Klick auf den Interpreten führt zu dessen Seite — vorher war
       der Name nur Text und die Musikbereiche nicht verbunden. */
    const artistLink = $('album-artist');
    if (artistLink) {
      artistLink.addEventListener('click', async () => {
        const found = await api(itemsUrl({
          IncludeItemTypes: 'MusicArtist',
          Recursive: 'true',
          SearchTerm: album.AlbumArtist,
          Limit: '1'
        })).catch(() => null);

        const artist = found?.Items?.[0];
        if (artist) navigate(() => showArtist(artist));
        else toast(t('artist.noAlbums'), true);
      });
    }

    const list = $('track-list');

    if (!tracks.length) {
      list.innerHTML = `<div class="empty-state">${escapeHtml(t('album.noTracks'))}</div>`;
      return;
    }

    tracks.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.innerHTML = `
        <span class="queue-num">${track.IndexNumber ?? index + 1}</span>
        <div class="queue-body">
          <div class="queue-title">${escapeHtml(track.Name || '')}</div>
          <div class="queue-artist">${escapeHtml(track.Artists?.join(', ') || track.AlbumArtist || '')}</div>
        </div>
        <span class="queue-dur">${formatTime(ticksToSeconds(track.RunTimeTicks))}</span>`;
      item.addEventListener('click', () => music.play(tracks, index));
      list.appendChild(item);
    });

    $('album-play').addEventListener('click', () => music.play(tracks, 0));
    $('album-shuffle').addEventListener('click', () => {
      music.shuffle = true;
      music.play(tracks, Math.floor(Math.random() * tracks.length));
      $('mf-shuffle').classList.add('active');
    });

    setStatus(album.Name || 'Album');
  } catch (error) {
    console.error(error);
    showError(t('album.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

async function showArtist(artist) {
  setTopGap(false);
  showLoader();

  try {
    /* Alles parallel holen — die Seite soll nicht dreimal
       nacheinander warten. */
    const [detail, albumData, topTracks] = await Promise.all([
      api(`/Users/${state.userId}/Items/${artist.Id}?Fields=Overview,Genres`).catch(() => artist),
      api(itemsUrl({
        AlbumArtistIds: artist.Id,
        IncludeItemTypes: 'MusicAlbum',
        Recursive: 'true',
        SortBy: 'ProductionYear,SortName',
        SortOrder: 'Descending',
        Fields: 'AlbumArtist,ProductionYear,DateCreated,ChildCount'
      })).catch(() => null),
      api(itemsUrl({
        ArtistIds: artist.Id,
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        SortBy: 'PlayCount,SortName',
        SortOrder: 'Descending',
        Limit: '10',
        Fields: 'Artists,AlbumArtist,RunTimeTicks,Album,AlbumId'
      })).catch(() => null)
    ]);

    const item = detail || artist;
    const albums = albumData?.Items || [];
    const tracks = topTracks?.Items || [];
    const backdrop = imageUrl(item, 'Backdrop', 900);
    const portrait = imageUrl(item, 'Primary', 500);

    const facts = [
      albums.length ? t('artist.albumCount', { count: albums.length }) : '',
      (item.Genres || []).slice(0, 3).join(', ')
    ].filter(Boolean);

    el.viewRoot.innerHTML = `
      <section class="detail-hero artist-hero">
        <div class="detail-bg" style="background-image:url('${escapeHtml(backdrop || portrait)}')"></div>
        <div class="detail-inner">
          <div class="artist-portrait">${portrait ? `<img src="${escapeHtml(portrait)}" alt="">` : ''}</div>
          <div class="detail-info">
            <h2>${escapeHtml(item.Name || '')}</h2>
            ${facts.length ? `<div class="hero-facts">${facts.map(escapeHtml).join('<span class="sep"></span>')}</div>` : ''}
            ${item.Overview ? `<p class="hero-overview artist-bio">${escapeHtml(item.Overview)}</p>` : ''}
            <div class="hero-actions">
              <button class="play-btn" id="artist-play" type="button">
                <svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
                ${escapeHtml(t('music.play'))}
              </button>
              <button class="outline-btn" id="artist-shuffle" type="button">${escapeHtml(t('music.shuffle'))}</button>
            </div>
          </div>
        </div>
      </section>
      <div id="artist-body"></div>`;

    const body = $('artist-body');

    /* Beliebte Titel: der schnellste Weg, etwas von diesem
       Interpreten zu hören. */
    if (tracks.length) {
      const section = document.createElement('section');
      section.className = 'row';
      section.innerHTML = `<div class="row-head"><h3>${escapeHtml(t('artist.topTracks'))}</h3></div>
        <div class="mf-queue" id="artist-tracks" style="overflow:visible"></div>`;
      body.appendChild(section);

      const host = $('artist-tracks');
      tracks.forEach((track, index) => {
        host.appendChild(buildTrackRow(track, index, tracks, { showAlbum: true }));
      });
    }

    if (albums.length) {
      const section = document.createElement('section');
      section.className = 'row';
      section.innerHTML = `<div class="row-head"><h3>${escapeHtml(t('music.albums'))}</h3>
        <span class="row-count">${albums.length}</span></div>`;
      const grid = document.createElement('div');
      grid.className = 'grid squares';
      albums.forEach((album) => grid.appendChild(buildCard(album, { shape: 'square' })));
      section.appendChild(grid);
      body.appendChild(section);
    }

    if (!albums.length && !tracks.length) {
      body.innerHTML = `<div class="empty-state">${escapeHtml(t('artist.noAlbums'))}</div>`;
    }

    const startAll = async (shuffle) => {
      // Alle Titel des Interpreten, nicht nur die zehn beliebtesten
      const all = await api(itemsUrl({
        ArtistIds: artist.Id, IncludeItemTypes: 'Audio', Recursive: 'true',
        SortBy: shuffle ? 'Random' : 'Album,ParentIndexNumber,IndexNumber',
        Fields: 'Artists,AlbumArtist,RunTimeTicks,Album,AlbumId', Limit: '300'
      })).catch(() => null);

      const list = all?.Items || tracks;
      if (!list.length) return toast(t('album.noTracks'), true);
      music.shuffle = shuffle;
      music.play(list, 0);
    };

    $('artist-play').addEventListener('click', () => startAll(false));
    $('artist-shuffle').addEventListener('click', () => startAll(true));

    setStatus(item.Name || '');
  } catch (error) {
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }), () => navigate(state.view, { push: false }));
  }
}

/* Eine Titelzeile — von Album und Interpretenseite gemeinsam genutzt,
   damit beide gleich aussehen und sich gleich verhalten. */
function buildTrackRow(track, index, queue, { showAlbum = false } = {}) {
  const row = document.createElement('div');
  row.className = 'queue-item';

  const art = showAlbum ? imageUrl(track, 'Primary', 120) : '';
  const subtitle = showAlbum
    ? (track.Album || track.Artists?.join(', ') || '')
    : (track.Artists?.join(', ') || track.AlbumArtist || '');

  row.innerHTML = `
    <span class="queue-num">${index + 1}</span>
    ${art ? `<img class="queue-art" src="${escapeHtml(art)}" alt="" loading="lazy">` : ''}
    <div class="queue-body">
      <div class="queue-title">${escapeHtml(track.Name || '')}</div>
      ${subtitle ? `<div class="queue-artist">${escapeHtml(subtitle)}</div>` : ''}
    </div>
    <span class="queue-dur">${formatTime(ticksToSeconds(track.RunTimeTicks))}</span>`;

  row.addEventListener('click', () => music.play(queue, index));
  return row;
}

/* ============================ ROUTING ============================ */

function openItem(item) {
  switch (item.Type) {
    case 'Series':
      navigate(() => showDetail(item));
      break;
    case 'Season':
      navigate(() => showDetail({ Id: item.SeriesId, Name: item.SeriesName, Type: 'Series' }));
      break;
    case 'MusicAlbum':
      navigate(() => showAlbum(item));
      break;
    case 'MusicArtist':
      navigate(() => showArtist(item));
      break;
    case 'Playlist':
      navigate(() => showPlaylist(item));
      break;
    case 'BoxSet':
      navigate(() => showCollection(item));
      break;
    case 'Person':
      navigate(() => showPerson(item));
      break;
    case 'Audio':
      music.play([item], 0);
      break;
    case 'Episode':
      playVideo(item);
      break;
    case 'Movie':
    default:
      navigate(() => showDetail(item));
      break;
  }
}

// Direkt abspielen, ohne den Umweg über die Infoseite
function playItem(item) {
  if (item.Type === 'Audio') return music.play([item], 0);
  playVideo(item);
}

/* ============================ SEARCH ============================ */

let searchTimer = null;

el.searchToggle.addEventListener('click', () => {
  const wasCollapsed = el.searchBox.classList.contains('collapsed');
  el.searchBox.classList.remove('collapsed');
  if (wasCollapsed) {
    el.searchInput.focus();
  } else if (!el.searchInput.value.trim()) {
    el.searchBox.classList.add('collapsed');
  }
});

// Leeres Feld beim Verlassen wieder einklappen
el.searchInput.addEventListener('blur', () => {
  if (!el.searchInput.value.trim()) el.searchBox.classList.add('collapsed');
});

el.searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    el.searchInput.value = '';
    el.searchInput.blur();
    el.searchBox.classList.add('collapsed');
    state.history = [];
    el.backBtn.classList.add('hidden');
    navigate(showHome, { push: false });
  }
});

el.searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const term = el.searchInput.value.trim();

  if (!term) {
    navigate(showHome, { push: false });
    state.history = [];
    el.backBtn.classList.add('hidden');
    return;
  }

  searchTimer = setTimeout(() => runSearch(term), 320);
});

async function runSearch(term) {
  setTopGap(true);
  // F2: veraltete Antworten dürfen neuere Treffer nicht überschreiben
  const token = newToken('search');
  el.viewRoot.innerHTML = skeletonCards(10);

  try {
    const data = await api(itemsUrl({
      SearchTerm: term,
      IncludeItemTypes: 'Movie,Series,MusicAlbum,Audio,Episode,BoxSet,Person',
      Recursive: 'true',
      Limit: '120',
      Fields: 'ProductionYear,Overview,AlbumArtist,Artists,RunTimeTicks,DateCreated,OfficialRating,CommunityRating'
    }));
    if (!isCurrent('search', token)) return;

    const items = data.Items || [];
    el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('search.heading', { term }))}</h2>`;

    if (!items.length) {
      el.viewRoot.insertAdjacentHTML('beforeend', '<div class="empty-state">Nichts gefunden.</div>');
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'grid';
    items.forEach((item) => {
      const shape = item.Type === 'MusicAlbum' || item.Type === 'Audio' ? 'square' : 'wide';
      grid.appendChild(buildCard(item, { shape }));
    });
    el.viewRoot.appendChild(grid);
  } catch (error) {
    if (!isCurrent('search', token)) return;
    console.error(error);
    showError(t('search.failed', { error: error.message }), () => runSearch(el.searchInput.value.trim()));
  }
}

/* ============================ AUTH FLOW ============================ */

el.togglePassword.addEventListener('click', () => {
  const input = $('password');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  el.togglePassword.setAttribute('aria-label', isPassword ? t('auth.hidePassword') : t('login.showPassword'));
});

el.connectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAuthError('');

  const rawServerUrl = $('server-url').value.trim();
  const username = $('username').value.trim();
  const password = $('password').value;

  if (!rawServerUrl || !username || !password) {
    setAuthError(t('auth.missingFields'));
    return;
  }

  const serverUrl = normalizeServerUrl(rawServerUrl);

  el.loginBtn.disabled = true;
  el.loginBtn.classList.add('loading');

  try {
    const auth = await authenticate(serverUrl, username, password);

    /* Die Adresse, die geantwortet hat — bei Umleitung nicht die
       eingegebene, sonst verliert jede Anfrage ihren Header. */
    const activeUrl = auth.serverUrl || serverUrl;
    state.serverUrl = activeUrl;
    state.token = auth.accessToken;
    state.userId = auth.userId;
    state.username = auth.userName;

    if (el.rememberMe.checked) {
      try {
        localStorage.setItem('jf-session', JSON.stringify({
          serverUrl: activeUrl,
          token: auth.accessToken,
          userId: auth.userId,
          username: auth.userName
        }));
      } catch (error) {
        /* ignorieren */
      }
    }

    await enterApp();
  } catch (error) {
    console.error(error);
    setAuthError(error.message || t('login.failed'));
  } finally {
    el.loginBtn.disabled = false;
    el.loginBtn.classList.remove('loading');
  }
});

async function enterApp() {
  // Falls die App offline gestartet war, den vollen Betrieb wiederherstellen
  leaveOfflineMode();

  const initial = (state.username || '?').charAt(0).toUpperCase();
  el.userName.textContent = state.username;
  el.userAvatar.textContent = initial;
  el.userAvatarBig.textContent = initial;
  el.loginScreen.classList.add('hidden');

  // Zugang für den Schnellwechsel merken
  try {
    let serverName = state.serverUrl;
    const info = await fetch(`${state.serverUrl}/System/Info/Public`).then((r) => r.json()).catch(() => null);
    if (info?.ServerName) serverName = info.ServerName;
    rememberServer({
      serverUrl: state.serverUrl,
      serverName,
      userId: state.userId,
      username: state.username,
      token: state.token
    });
  } catch (error) {
    /* Merken ist optional */
  }
  el.appShell.classList.remove('hidden');
  setStatus(t('common.connected'));

  await loadLibraries();
  state.history = [];
  navigate(showHome, { push: false });
}

async function loadLibraries() {
  try {
    const data = await api(`/Users/${state.userId}/Views`);
    state.libraries = data.Items || [];

    el.libraryMenu.innerHTML = '';

    if (!state.libraries.length) {
      el.libraryMenu.innerHTML = `<div class="menu-item">${escapeHtml(t('nav.noLibraries'))}</div>`;
      return;
    }

    state.libraries.forEach((library) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'library-btn';
      btn.dataset.id = library.Id;
      btn.innerHTML = `<span>${escapeHtml(library.Name)}</span>`;
      btn.addEventListener('click', () => {
        closeMenus();
        state.history = [];
        el.backBtn.classList.add('hidden');
        navigate(() => showLibrary(library), { push: false });
      });
      el.libraryMenu.appendChild(btn);
    });
  } catch (error) {
    console.error('Libraries could not be loaded:', error);
  }
}

/* --------------------------- NAVBAR --------------------------- */

const VIEWS = {
  home: showHome,
  movies: () => showCatalog('movies'),
  series: () => showCatalog('series'),
  music: showMusic,
  favorites: () => showFavorites(),
  playlists: () => showPlaylists(),
  offline: () => showOffline()
};

// Logo führt zur Startseite
$('nav-brand').addEventListener('click', () => {
  el.searchInput.value = '';
  state.history = [];
  el.backBtn.classList.add('hidden');
  navigate(showHome, { push: false });
});

document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    el.searchInput.value = '';
    state.history = [];
    el.backBtn.classList.add('hidden');
    navigate(VIEWS[btn.dataset.view] || showHome, { push: false });
  });
});

function closeMenus() {
  el.libraryMenu.classList.add('hidden');
  el.profileMenu.classList.add('hidden');
  el.libraryToggle.classList.remove('open');
  el.libraryToggle.setAttribute('aria-expanded', 'false');
  el.profileBtn.classList.remove('open');
  el.profileBtn.setAttribute('aria-expanded', 'false');
}

function toggleMenu(menu, trigger) {
  const willOpen = menu.classList.contains('hidden');
  closeMenus();
  if (!willOpen) return;
  menu.classList.remove('hidden');
  trigger.classList.add('open');
  trigger.setAttribute('aria-expanded', 'true');
}

el.libraryToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleMenu(el.libraryMenu, el.libraryToggle);
});

el.profileBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleMenu(el.profileMenu, el.profileBtn);
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.nav-dropdown')) closeMenus();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMenus();
});

// Navbar wird erst undurchsichtig, sobald man den Hero verlässt
el.mainPanel.addEventListener('scroll', () => {
  el.navbar.classList.toggle('solid', el.mainPanel.scrollTop > 40);
});

el.disconnectBtn.addEventListener('click', () => {
  try {
    localStorage.removeItem('jf-session');
  } catch (error) {
    /* ignorieren */
  }

  music.stop();
  closeVideo();
  closeMenus();
  clearInterval(slideTimer);
  leaveOfflineMode();

  state.serverUrl = '';
  state.token = '';
  state.userId = '';
  state.username = '';
  state.libraries = [];
  state.history = [];
  state.view = null;

  el.libraryMenu.innerHTML = '';
  el.viewRoot.innerHTML = '';
  el.searchInput.value = '';
  el.navbar.classList.remove('solid');
  el.appShell.classList.add('hidden');
  el.loginScreen.classList.remove('hidden');
  setAuthError('');
});

async function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('jf-session') || 'null');
  } catch (error) {
    return;
  }

  if (!saved || !saved.token || !saved.serverUrl) return;

  state.serverUrl = saved.serverUrl;
  state.token = saved.token;
  state.userId = saved.userId;
  state.username = saved.username;

  try {
    // Token gegen den Server prüfen — er kann serverseitig widerrufen worden sein
    await api(`/Users/${state.userId}`);
    await enterApp();
  } catch (error) {
    // Unterscheiden: abgelehnte Sitzung vs. Server nicht erreichbar.
    // Bei letzterem darf der Offline-Bestand nicht unerreichbar werden.
    const rejected = /Sitzung abgelaufen|^40[13]/.test(error.message || '');

    if (!rejected && (await hasOfflineContent())) {
      return enterOfflineMode();
    }

    state.serverUrl = '';
    state.token = '';
    state.userId = '';
    try {
      localStorage.removeItem('jf-session');
    } catch (e) {
      /* ignorieren */
    }
  }
}

async function hasOfflineContent() {
  if (!window.downloads) return false;
  try {
    const items = await window.downloads.list();
    return items.some((entry) => entry.state === 'done');
  } catch (error) {
    return false;
  }
}

/* Start ohne erreichbaren Server: nur die Offline-Ansicht ist nutzbar. */
async function enterOfflineMode() {
  offline.mode = true;

  const initial = (state.username || '?').charAt(0).toUpperCase();
  el.userName.textContent = state.username;
  el.userAvatar.textContent = initial;
  el.userAvatarBig.textContent = initial;

  el.loginScreen.classList.add('hidden');
  el.appShell.classList.remove('hidden');
  document.body.classList.add('offline-mode');

  // Alles, was den Server braucht, wird ausgeblendet
  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => {
    btn.classList.toggle('hidden', btn.dataset.view !== 'offline');
  });
  el.libraryToggle.classList.add('hidden');
  el.searchToggle.classList.add('hidden');

  setStatus(t('offline.modeStatus'));
  toast(t('offline.serverUnreachable'));

  state.history = [];
  navigate(showOffline, { push: false });
}

/* Zurueck in den Normalbetrieb — die ausgeblendeten Bedienelemente holen */
function leaveOfflineMode() {
  if (!offline.mode) return;
  offline.mode = false;
  document.body.classList.remove('offline-mode');
  document.querySelectorAll('.nav-btn[data-view]').forEach((btn) => btn.classList.remove('hidden'));
  el.libraryToggle.classList.remove('hidden');
  el.searchToggle.classList.remove('hidden');
}

/* ========================== TITLE BAR ========================== */

function initTitleBar() {
  const controls = window.windowControls;
  const maxBtn = $('tb-max');

  // macOS zeichnet seine eigenen Fensterknöpfe — unsere blenden wir dort aus
  if (window.appInfo?.platform === 'darwin') {
    document.body.classList.add('is-mac');
  }

  // Ohne Preload (z. B. im Browser geöffnet) bleibt die Leiste passiv
  if (!controls) return;

  $('tb-min').addEventListener('click', () => controls.minimize());
  maxBtn.addEventListener('click', () => controls.maximize());
  $('tb-close').addEventListener('click', () => controls.close());

  // Doppelklick auf die Leiste maximiert/verkleinert — wie bei nativen Fenstern
  document.querySelector('.tb-drag').addEventListener('dblclick', () => controls.maximize());

  const applyState = ({ maximized }) => {
    maxBtn.querySelector('.ic-max').classList.toggle('hidden', maximized);
    maxBtn.querySelector('.ic-restore').classList.toggle('hidden', !maximized);
    maxBtn.title = maximized ? 'Wiederherstellen' : 'Maximieren';
  };

  controls.onStateChange(applyState);
  controls.isMaximized().then((maximized) => applyState({ maximized })).catch(() => {});
}

// Erst starten, wenn player.js geladen ist (liefert `music` und `playVideo`)
window.addEventListener('DOMContentLoaded', async () => {
  initTitleBar();
  // Uebersetzungen vor allem anderen — sonst blitzt die Standardsprache auf
  await initI18n();

  const version = $('login-version');
  if (version) version.textContent = `v${window.appInfo?.version || ''}`;

  restoreSession();
});
