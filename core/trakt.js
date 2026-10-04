/**
 * Trakt.tv — Anmeldung, Scrobbeln und Verlauf abgleichen.
 *
 * Warum der Nutzer eine eigene Trakt-App eintraegt:
 * Trakt verlangt fuer den Device-Flow Client-ID UND Client-Secret
 * (beim Abholen des Tokens). Ein Secret, das im Quelltext einer
 * Open-Source-App steht, ist keins mehr. Deshalb wie bei der
 * Discord-ID: unter https://trakt.tv/oauth/applications eine eigene
 * App anlegen (Redirect-URI: urn:ietf:wg:oauth:2.0:oob) und beide
 * Werte in den Einstellungen eintragen. Sie liegen verschluesselt
 * im Tresor (core/vault.js), zusammen mit dem Token.
 *
 * Eine Stelle fuer alles, was mit Trakt spricht: Vorher stand die
 * Client-ID zweimal im Code (Player und Einstellungen) und lief
 * auseinander.
 *
 * Kein DOM: Die Oberflaeche ruft nur die Funktionen hier auf.
 */
const trakt = (() => {
  const API = 'https://api.trakt.tv';
  const KEY = 'jf-trakt';
  const BATCH = 500; // Trakt nimmt grosse Listen, aber nicht beliebig grosse

  function load() {
    return (typeof vault !== 'undefined' ? vault.getJSON(KEY) : null) || {};
  }

  function save(data) {
    vault.setJSON(KEY, data);
  }

  function config() {
    const data = load();
    return { clientId: data.clientId || '', clientSecret: data.clientSecret || '' };
  }

  function setConfig(clientId, clientSecret) {
    const data = load();
    const id = String(clientId || '').trim();
    const secret = String(clientSecret || '').trim();
    // Andere App = alte Anmeldung gilt nicht mehr
    const changed = id !== data.clientId || secret !== data.clientSecret;
    save(changed
      ? { clientId: id, clientSecret: secret }
      : { ...data, clientId: id, clientSecret: secret });
  }

  const configured = () => {
    const c = config();
    return Boolean(c.clientId && c.clientSecret);
  };

  const connected = () => Boolean(load().access_token);

  function headers(withAuth = true) {
    const data = load();
    return {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': data.clientId || '',
      ...(withAuth && data.access_token ? { Authorization: `Bearer ${data.access_token}` } : {})
    };
  }

  /* Token rechtzeitig erneuern. Trakt-Tokens laufen ab; ohne
     Erneuerung haette der automatische Sync nach einiger Zeit
     stillschweigend aufgehoert. */
  async function refreshIfNeeded() {
    const data = load();
    if (!data.access_token || !data.refresh_token) return;
    const expiresAt = (data.created_at + data.expires_in) * 1000;
    if (!expiresAt || Date.now() < expiresAt - 24 * 3600 * 1000) return;

    const resp = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: data.refresh_token,
        client_id: data.clientId,
        client_secret: data.clientSecret,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        grant_type: 'refresh_token'
      })
    });
    if (resp.ok) {
      save({ ...data, ...(await resp.json()) });
    } else if (resp.status === 400 || resp.status === 401) {
      // Widerrufen: Anmeldung verwerfen, Konfiguration behalten
      disconnect();
    }
  }

  async function request(path, options = {}) {
    await refreshIfNeeded();
    const resp = await fetch(`${API}${path}`, { ...options, headers: headers() });
    if (resp.status === 401) {
      disconnect();
      throw new Error('Trakt 401');
    }
    if (!resp.ok) throw new Error(`Trakt ${resp.status}`);
    if (resp.status === 204) return null;
    return resp.json();
  }

  /** Schritt 1 der Anmeldung: Code holen, den der Nutzer auf trakt.tv eingibt */
  async function startDeviceAuth() {
    if (!configured()) throw new Error('not-configured');
    const resp = await fetch(`${API}/oauth/device/code`, {
      method: 'POST',
      headers: headers(false),
      body: JSON.stringify({ client_id: config().clientId })
    });
    if (!resp.ok) throw new Error(`Trakt ${resp.status}`);
    return resp.json(); // { device_code, user_code, verification_url, expires_in, interval }
  }

  /** Schritt 2: warten, bis der Nutzer bestaetigt hat.
   *  `isCancelled` erlaubt der Oberflaeche abzubrechen. */
  async function pollDeviceAuth(device, isCancelled = () => false) {
    const { clientId, clientSecret } = config();
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = (device.interval || 5) * 1000;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (isCancelled()) throw new Error('cancelled');

      const resp = await fetch(`${API}/oauth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: device.device_code, client_id: clientId, client_secret: clientSecret })
      });

      if (resp.status === 200) {
        const token = await resp.json();
        save({ ...load(), ...token });
        let username = '';
        try {
          const me = await request('/users/settings');
          username = me?.user?.username || '';
        } catch (error) {
          /* Name ist nur Anzeige */
        }
        save({ ...load(), username });
        return username;
      }
      // 400 = noch nicht bestaetigt, 429 = zu schnell gefragt
      if (resp.status === 429) interval += 1000;
      else if (resp.status === 418) throw new Error('denied');
      else if (resp.status === 410) throw new Error('expired');
      else if (resp.status === 409) throw new Error('used');
      else if (resp.status !== 400) throw new Error(`Trakt ${resp.status}`);
    }
    throw new Error('expired');
  }

  function disconnect() {
    const { clientId, clientSecret } = config();
    save({ clientId, clientSecret });
  }

  function ids(item) {
    const p = item?.ProviderIds || {};
    const out = {};
    if (p.Imdb) out.imdb = p.Imdb;
    if (p.Tmdb && Number(p.Tmdb)) out.tmdb = Number(p.Tmdb);
    if (p.Tvdb && Number(p.Tvdb)) out.tvdb = Number(p.Tvdb);
    return out;
  }

  /** Eintrag im Trakt-Format. Ohne Kennungen kann Trakt den Titel nicht
   *  zuordnen — dann lieber nichts senden als etwas Falsches. */
  function toTrakt(item) {
    const idSet = ids(item);
    if (!Object.keys(idSet).length) return null;
    if (item.Type === 'Episode') return { kind: 'episodes', entry: { ids: idSet } };
    if (item.Type === 'Movie') {
      return { kind: 'movies', entry: { title: item.Name, year: item.ProductionYear || undefined, ids: idSet } };
    }
    return null;
  }

  /** Nach der Wiedergabe melden. Trakt traegt ab 80 % selbst als
   *  gesehen ein — gesendet wird deshalb der echte Fortschritt, nicht
   *  pauschal 100. */
  async function scrobble(item, progressPercent) {
    if (!connected()) return false;
    const mapped = toTrakt(item);
    if (!mapped) return false;
    const key = mapped.kind === 'movies' ? 'movie' : 'episode';
    const progress = Math.max(0, Math.min(100, Math.round(progressPercent * 10) / 10));
    await request('/scrobble/stop', {
      method: 'POST',
      body: JSON.stringify({ [key]: mapped.entry, progress })
    });
    return true;
  }

  /** Gesehene Titel aus Jellyfin an Trakt senden, in Paketen.
   *  Gibt zurueck, wie viele gesendet und wie viele mangels Kennung
   *  uebersprungen wurden. */
  async function pushHistory(items) {
    const movies = [];
    const episodes = [];
    let skipped = 0;

    items.forEach((item) => {
      const mapped = toTrakt(item);
      if (!mapped) {
        skipped += 1;
        return;
      }
      const watchedAt = item.UserData?.LastPlayedDate;
      const entry = watchedAt ? { ...mapped.entry, watched_at: watchedAt } : mapped.entry;
      (mapped.kind === 'movies' ? movies : episodes).push(entry);
    });

    for (let i = 0; i < Math.max(movies.length, episodes.length); i += BATCH) {
      await request('/sync/history', {
        method: 'POST',
        body: JSON.stringify({
          movies: movies.slice(i, i + BATCH),
          episodes: episodes.slice(i, i + BATCH)
        })
      });
    }

    return { movies: movies.length, episodes: episodes.length, skipped };
  }

  return {
    config, setConfig, configured, connected,
    username: () => load().username || '',
    startDeviceAuth, pollDeviceAuth, disconnect,
    scrobble, pushHistory,
    _toTrakt: toTrakt // fuer Tests
  };
})();

if (typeof module !== 'undefined') module.exports = trakt;
