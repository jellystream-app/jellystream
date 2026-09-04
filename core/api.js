/* ============================================================
   Server-Anbindung — gemeinsam für Desktop und mobile App

   Enthält nur, was ohne Oberfläche auskommt: Sitzungszustand,
   Anfragen an Jellyfin, Bild-Adressen, Zeitformate.

   Bewusst kein DOM: tools/test-core.js wacht darüber. Beide
   Fassungen bauen ihre eigene Oberfläche auf diesen Funktionen auf,
   damit eine neue Funktion nur einmal entsteht.
   ============================================================ */

const CLIENT_NAME = 'Jellystream';
const TICKS_PER_SECOND = 10000000;

/* Der Gerätename erscheint in Jellyfins Sitzungsliste. Er sagt,
   von wo aus jemand schaut — deshalb pro Fassung ein anderer. */
const DEVICE_NAME =
  typeof CLIENT_PLATFORM === 'string' ? CLIENT_PLATFORM : 'Desktop';

const CLIENT_VERSION =
  (typeof window !== 'undefined' && window.appInfo?.version) || '0.0.0';

/* Sitzungszustand. Beide Fassungen halten hier dasselbe — nur was
   sie daraus zeichnen, unterscheidet sich. */
const state = {
  serverUrl: '',
  token: '',
  userId: '',
  username: '',
  libraries: [],
  view: null,
  history: []
};

/* ============================ GERÄT ============================ */

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

/* Ergänzt ein fehlendes Schema.

   Warum https:// und nicht http://: Steht ein Reverse Proxy davor,
   leitet er http auf https um. Browser und WebView entfernen bei
   einem Schema-Wechsel aber den Authorization-Header — Jellyfin
   sieht den Login-POST dann ohne Client-Kennung und antwortet mit
   "400 Error processing request". Der Fehler zeigt auf die
   Zugangsdaten, obwohl nur das Schema falsch war.

   Ein reiner Heimserver ohne TLS beantwortet https nicht; für den
   fällt checkServerReachability() unten auf http zurück. Andersherum
   ginge es nicht: Der Rückfall von http auf https käme zu spät,
   der Header wäre beim Umleiten schon verloren. */
function normalizeServerUrl(rawUrl) {
  let url = rawUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/* Prüft, ob unter dieser Adresse ein Jellyfin antwortet — ohne
   Umleitung, damit ein Schema-Wechsel hier auffällt und nicht erst
   beim Login den Authorization-Header kostet. */
async function probeServer(serverUrl) {
  for (const path of ['/System/Info/Public', '/System/Info', '/']) {
    try {
      const response = await fetch(`${serverUrl}${path}`, {
        method: 'GET',
        redirect: 'manual'
      });

      /* Umleitung: Die Adresse stimmt, das Schema nicht. Das Ziel
         gilt ab jetzt — sonst verlöre der Login-POST seinen Header. */
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        const target = response.headers.get('Location');
        if (target) {
          try {
            const redirected = new URL(target, `${serverUrl}${path}`);
            return { reachable: true, url: redirected.origin };
          } catch (error) {
            /* Unbrauchbares Location-Feld: als erreichbar werten */
          }
        }
        /* Bei 'opaqueredirect' verbirgt der Browser das Ziel. Dann
           bleibt nur der Schema-Wechsel als Vermutung. */
        return {
          reachable: true,
          url: serverUrl.startsWith('http://')
            ? serverUrl.replace(/^http:/i, 'https:')
            : serverUrl
        };
      }

      /* 401/403 heißt: Da ist ein Server, er will nur Anmeldung. */
      if (response.ok || response.status === 401 || response.status === 403) {
        return { reachable: true, url: serverUrl };
      }
    } catch (error) {
      /* nächster Pfad */
    }
  }

  return { reachable: false, url: serverUrl };
}

/* ============================ ANFRAGEN ============================ */

/* Wird bei einer abgelaufenen Sitzung aufgerufen. Beide Fassungen
   hängen hier ihre eigene Reaktion ein — der Kern kennt nur den
   Anlass, nicht die Darstellung. */
let onSessionExpired = () => {};

function setSessionExpiredHandler(fn) {
  if (typeof fn === 'function') onSessionExpired = fn;
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
    onSessionExpired();
    throw new Error(typeof t === 'function' ? t('common.sessionExpired') : 'Session expired');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${text || response.statusText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

const itemsUrl = (params) => `/Users/${state.userId}/Items?${new URLSearchParams(params)}`;

/* Sucht die Adresse, unter der der Server wirklich antwortet.

   Zuerst wie angegeben. Schlägt das bei https fehl, noch einmal über
   http: ein Heimserver ohne TLS ist der häufigste Fall, und
   normalizeServerUrl() rät bei fehlendem Schema bewusst zu https. */
async function resolveServerUrl(serverUrl) {
  const direct = await probeServer(serverUrl);
  if (direct.reachable) return direct;

  if (/^https:\/\//i.test(serverUrl)) {
    const plain = await probeServer(serverUrl.replace(/^https:/i, 'http:'));
    if (plain.reachable) return plain;
  }

  return { reachable: false, url: serverUrl };
}

/* Bleibt für Aufrufer erhalten, die nur ja/nein wissen wollen. */
async function checkServerReachability(serverUrl) {
  const result = await resolveServerUrl(serverUrl);
  return result.reachable;
}

/* Gibt die tatsächlich gültige Adresse mit zurück: Wurde umgeleitet,
   muss der Aufrufer ab jetzt diese verwenden — sonst läuft jede
   weitere Anfrage wieder in dieselbe Umleitung. */
async function authenticate(serverUrl, username, password) {
  const resolved = await resolveServerUrl(serverUrl);
  if (!resolved.reachable) {
    throw new Error(
      typeof t === 'function'
        ? t('auth.serverUnreachable', { url: serverUrl })
        : `Server unreachable: ${serverUrl}`
    );
  }

  serverUrl = resolved.url;

  const response = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: buildAuthHeader()
    },
    body: JSON.stringify({ Username: username, Pw: password })
  });

  if (response.status === 401) {
    throw new Error(
      typeof t === 'function' ? t('auth.wrongCredentials') : 'Wrong username or password'
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      typeof t === 'function'
        ? t('auth.failedStatus', { status: `${response.status} ${text || response.statusText}` })
        : `${response.status} ${text}`
    );
  }

  const data = await response.json();
  if (!data?.AccessToken || !data?.User?.Id) {
    throw new Error(typeof t === 'function' ? t('auth.badResponse') : 'Invalid server response');
  }

  return {
    accessToken: data.AccessToken,
    userId: data.User.Id,
    userName: data.User.Name,
    /* Die Adresse, die wirklich geantwortet hat — kann sich von der
       eingegebenen unterscheiden (Schema ergänzt oder umgeleitet). */
    serverUrl
  };
}

/* ============================ BILDER ============================ */

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

  // Bildschirmdichte berücksichtigen, sonst wirken Cover auf HiDPI weich
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
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
  const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
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

/* ============================ ZEIT ============================ */

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
  if (minutes < 60) {
    return typeof t === 'function' ? t('common.minutes', { count: minutes }) : `${minutes} min`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (typeof t !== 'function') return m ? `${h} h ${m} min` : `${h} h`;
  return m ? t('common.hoursMinutes', { hours: h, minutes: m }) : t('common.hours', { count: h });
}

/* ============================ TEXT ============================ */

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
