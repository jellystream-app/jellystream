/* ============================================================
   Jellystream — mobile Oberfläche

   Eigene Ansichten, aber dieselbe Logik wie der Desktop: alles,
   was hier aufgerufen wird und nicht mit `m` beginnt, kommt aus
   core/ (api.js, i18n.js, playback.js).

   Eine neue Funktion entsteht damit einmal im Kern; nur ihre
   Darstellung steht zweimal — und die soll sich unterscheiden.
   ============================================================ */

/* Der Gerätename erscheint in Jellyfins Sitzungsliste. */
const CLIENT_PLATFORM = 'Mobile';

const $m = (id) => document.getElementById(id);

const ui = {
  login: $m('login-screen'),
  app: $m('app-shell'),
  view: $m('m-view'),
  title: $m('m-title'),
  back: $m('m-back'),
  tabs: $m('m-tabs'),
  toast: $m('m-toast'),
  searchBar: $m('m-search-bar'),
  searchInput: $m('m-search-input'),
  settings: $m('m-settings'),
  settingsBody: $m('m-settings-body'),
  sheet: $m('m-sheet'),
  sheetTitle: $m('m-sheet-title'),
  sheetOptions: $m('m-sheet-options')
};

/* Verlauf für die Zurück-Taste — auf dem Handy die wichtigste Geste */
const nav = { stack: [], current: null };

/* ========================== HINWEISE ========================== */

let toastTimer = null;

function toast(message, isError = false) {
  ui.toast.textContent = message;
  ui.toast.classList.toggle('error', isError);
  ui.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 3000);
}

/* ========================== NAVIGATION ========================== */

function navigate(fn, { push = true, title } = {}) {
  if (push && nav.current) nav.stack.push(nav.current);
  nav.current = fn;
  ui.back.classList.toggle('hidden', nav.stack.length === 0);
  if (title != null) ui.title.textContent = title;
  ui.view.scrollTop = 0;
  fn();
}

function goBack() {
  const previous = nav.stack.pop();
  if (previous) {
    nav.current = previous;
    ui.back.classList.toggle('hidden', nav.stack.length === 0);
    ui.view.scrollTop = 0;
    previous();
  }
}

ui.back.addEventListener('click', goBack);

/* Die Zurück-Taste des Geräts: schließt zuerst offene Ebenen,
   dann den Verlauf. Ohne das würde sie die App beenden. */
function handleDeviceBack() {
  if (!ui.sheet.classList.contains('hidden')) return closeSheet();
  if (!$m('m-player').classList.contains('hidden')) return closePlayer();
  if (!ui.settings.classList.contains('hidden')) return closeSettings();
  if (!ui.searchBar.classList.contains('hidden')) return closeSearch();
  if (nav.stack.length) return goBack();
  return false; // nichts mehr offen — die Hülle darf beenden
}

window.addEventListener('popstate', () => {
  handleDeviceBack();
  history.pushState(null, '');
});

/* ========================== BAUSTEINE ========================== */

function skeletonRow() {
  return `<div class="m-section">
    <div class="m-section-head"><div class="m-skeleton" style="width:120px;height:20px"></div></div>
    <div class="m-row">${'<div class="m-skeleton" style="width:calc((100vw - 42px)/2);aspect-ratio:16/9"></div>'.repeat(3)}</div>
  </div>`;
}

function showLoading() {
  ui.view.innerHTML = skeletonRow() + skeletonRow();
}

function showEmpty(message) {
  ui.view.innerHTML = `<div class="m-empty">${escapeHtml(message)}</div>`;
}

function showError(message, retry) {
  ui.view.innerHTML = `
    <div class="m-empty">
      <p style="margin-bottom:16px">${escapeHtml(message)}</p>
      ${retry ? `<button class="m-btn ghost" id="m-retry" style="margin:0 auto;max-width:200px"><span>${escapeHtml(t('common.retry'))}</span></button>` : ''}
    </div>`;
  if (retry) $m('m-retry').addEventListener('click', retry);
}

/** Kachel — dieselbe Bildwahl wie der Desktop, aber fingergerecht. */
function buildCard(item) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'm-card';

  const picture = wideImageUrl(item);
  const played = item.UserData?.PlayedPercentage;
  const badge = cardBadge(item);

  card.innerHTML = `
    <span class="m-card-art">
      ${picture.src
        ? `<img src="${escapeHtml(picture.src)}" alt="" loading="lazy" decoding="async"${picture.cropped ? ' class="from-poster"' : ''}>`
        : ''}
      ${badge ? `<span class="m-badge">${escapeHtml(badge)}</span>` : ''}
      ${played > 0 && played < 100 ? `<span class="m-progress"><i style="width:${played}%"></i></span>` : ''}
    </span>
    <span class="m-card-title">${escapeHtml(item.Name || t('card.untitled'))}</span>
    <span class="m-card-sub">${escapeHtml(cardSubtitle(item))}</span>`;

  card.addEventListener('click', () => openItem(item));
  return card;
}

function cardBadge(item) {
  if (!item.DateCreated) return '';
  const age = (Date.now() - new Date(item.DateCreated).getTime()) / 86400000;
  if (age > 14 || Number.isNaN(age)) return '';
  return t('badge.new');
}

function cardSubtitle(item) {
  if (item.Type === 'Episode') {
    const parts = [];
    if (item.ParentIndexNumber != null) parts.push('S' + item.ParentIndexNumber);
    if (item.IndexNumber != null) parts.push('E' + item.IndexNumber);
    return parts.join(' · ') || item.SeriesName || '';
  }
  if (item.Type === 'MusicAlbum') return item.AlbumArtist || String(item.ProductionYear || '');
  return String(item.ProductionYear || '');
}

function buildRow(title, items, onMore) {
  if (!items || !items.length) return null;

  const section = document.createElement('section');
  section.className = 'm-section';
  section.innerHTML = `
    <div class="m-section-head">
      <h2>${escapeHtml(title)}</h2>
      <span class="count">${items.length}</span>
    </div>
    <div class="m-row"></div>`;

  const row = section.querySelector('.m-row');
  items.forEach((item) => row.appendChild(buildCard(item)));
  return section;
}

function buildGrid(items) {
  const grid = document.createElement('div');
  grid.className = 'm-grid';
  items.forEach((item) => grid.appendChild(buildCard(item)));
  return grid;
}

/* ========================== ANSICHTEN ========================== */

function setActiveTab(view) {
  ui.tabs.querySelectorAll('.m-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
}

async function showHome() {
  setActiveTab('home');
  ui.title.textContent = t('nav.home');
  showLoading();

  try {
    const fields = 'ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated';
    const [resume, nextUp, movies, series] = await Promise.all([
      api(`/Users/${state.userId}/Items/Resume?Limit=12&MediaTypes=Video&Fields=${fields}`).catch(() => null),
      api(`/Shows/NextUp?userId=${state.userId}&Limit=12&Fields=${fields}`).catch(() => null),
      api(itemsUrl({ SortBy: 'DateCreated', SortOrder: 'Descending', IncludeItemTypes: 'Movie',
        Recursive: 'true', Limit: '16', Fields: fields })).catch(() => null),
      api(itemsUrl({ SortBy: 'DateCreated', SortOrder: 'Descending', IncludeItemTypes: 'Series',
        Recursive: 'true', Limit: '16', Fields: fields })).catch(() => null)
    ]);

    ui.view.innerHTML = '';

    const rows = [
      buildRow(t('home.resume'), resume?.Items || []),
      buildRow(t('home.nextUp'), nextUp?.Items || []),
      buildRow(t('home.newMovies'), movies?.Items || []),
      buildRow(t('home.newSeries'), series?.Items || [])
    ].filter(Boolean);

    if (!rows.length) return showEmpty(t('home.noMedia'));
    rows.forEach((row) => ui.view.appendChild(row));
  } catch (error) {
    showError(t('common.loadFailed', { error: error.message }), () => showHome());
  }
}

/* Katalog mit Nachladen beim Scrollen — auf dem Handy natürlicher
   als eine Schaltfläche. */
const catalog = { types: '', title: '', items: [], loading: false, done: false, observer: null };

async function showCatalog(view, types, title) {
  setActiveTab(view);
  ui.title.textContent = title;
  showLoading();

  Object.assign(catalog, { types, title, items: [], loading: false, done: false });
  if (catalog.observer) catalog.observer.disconnect();

  ui.view.innerHTML = '<div class="m-grid" id="m-catalog"></div><div id="m-more" style="height:60px"></div>';

  await loadCatalogPage();

  // Nachladen, sobald der Fuß in Sicht kommt
  catalog.observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !catalog.loading && !catalog.done) loadCatalogPage();
  }, { root: ui.view, rootMargin: '300px' });

  const more = $m('m-more');
  if (more) catalog.observer.observe(more);
}

async function loadCatalogPage() {
  if (catalog.loading || catalog.done) return;
  catalog.loading = true;

  try {
    const data = await api(itemsUrl({
      IncludeItemTypes: catalog.types,
      Recursive: 'true',
      SortBy: 'SortName',
      StartIndex: String(catalog.items.length),
      Limit: '40',
      Fields: 'ProductionYear,Overview,RunTimeTicks,OfficialRating,CommunityRating,DateCreated'
    }));

    const items = data.Items || [];
    catalog.items.push(...items);

    const grid = $m('m-catalog');
    if (grid) items.forEach((item) => grid.appendChild(buildCard(item)));

    if (!items.length || catalog.items.length >= (data.TotalRecordCount || 0)) {
      catalog.done = true;
      const more = $m('m-more');
      if (more) more.remove();
    }

    if (!catalog.items.length) showEmpty(t('catalog.noResults'));
  } catch (error) {
    catalog.done = true;
    if (!catalog.items.length) {
      showError(t('common.loadFailed', { error: error.message }), () => showCatalog('', catalog.types, catalog.title));
    }
  } finally {
    catalog.loading = false;
  }
}

async function showMusic() {
  setActiveTab('music');
  ui.title.textContent = t('music.title');
  showLoading();

  try {
    const [albums, artists] = await Promise.all([
      api(itemsUrl({ IncludeItemTypes: 'MusicAlbum', Recursive: 'true', SortBy: 'DateCreated',
        SortOrder: 'Descending', Limit: '20', Fields: 'AlbumArtist,ProductionYear,DateCreated' })).catch(() => null),
      api(itemsUrl({ IncludeItemTypes: 'MusicArtist', Recursive: 'true', SortBy: 'SortName',
        Limit: '20' })).catch(() => null)
    ]);

    ui.view.innerHTML = '';
    const rows = [
      buildRow(t('music.recentAlbums'), albums?.Items || []),
      buildRow(t('music.artists'), artists?.Items || [])
    ].filter(Boolean);

    if (!rows.length) return showEmpty(t('music.noMusic'));
    rows.forEach((row) => ui.view.appendChild(row));
  } catch (error) {
    showError(t('common.loadFailed', { error: error.message }), () => showMusic());
  }
}

async function showDetail(base) {
  showLoading();

  try {
    const isSeries = base.Type === 'Series';
    const fields = 'Overview,Genres,People,ProductionYear,OfficialRating,CommunityRating,' +
      'RunTimeTicks,MediaSources,MediaStreams';

    const [detail, seasons] = await Promise.all([
      api(`/Users/${state.userId}/Items/${base.Id}?Fields=${fields}`).catch(() => base),
      isSeries
        ? api(`/Shows/${base.Id}/Seasons?userId=${state.userId}`).catch(() => null)
        : Promise.resolve(null)
    ]);

    const item = detail || base;
    ui.title.textContent = item.Name || '';

    const picture = wideImageUrl(item);
    const resumeTicks = item.UserData?.PlaybackPositionTicks || 0;
    const isFavorite = Boolean(item.UserData?.IsFavorite);

    const facts = [
      item.ProductionYear,
      item.OfficialRating ? `<span class="chip">${escapeHtml(item.OfficialRating)}</span>` : '',
      item.RunTimeTicks ? formatRuntime(item.RunTimeTicks) : '',
      item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : ''
    ].filter(Boolean);

    ui.view.innerHTML = `
      <div class="m-detail-hero">
        ${picture.src ? `<img src="${escapeHtml(picture.src)}" alt="">` : ''}
      </div>
      <div class="m-detail-body">
        <h2>${escapeHtml(item.Name || '')}</h2>
        <div class="m-facts">${facts.join('<span>·</span>')}</div>
        ${item.Overview ? `<p class="m-overview">${escapeHtml(item.Overview)}</p>` : ''}
        <div class="m-actions">
          <button class="m-btn primary" id="m-play-btn">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
            <span>${escapeHtml(resumeTicks > 0 ? t('detail.resume') : isSeries ? t('detail.firstEpisode') : t('detail.play'))}</span>
          </button>
          <div class="m-actions two">
            <button class="m-btn ghost" id="m-fav-btn" data-on="${isFavorite ? '1' : '0'}">
              <span>${escapeHtml(isFavorite ? t('detail.remembered') : t('detail.remember'))}</span>
            </button>
            <button class="m-btn ghost" id="m-dl-btn">
              <span>${escapeHtml(t('card.download'))}</span>
            </button>
          </div>
        </div>
      </div>
      <div id="m-episodes"></div>`;

    $m('m-play-btn').addEventListener('click', async () => {
      if (!isSeries) return playVideo(item);
      try {
        const next = await api(`/Shows/NextUp?userId=${state.userId}&seriesId=${item.Id}&Limit=1`);
        if (next?.Items?.[0]) return playVideo(next.Items[0]);
      } catch (error) { /* Rückfall unten */ }
      if (seasons?.Items?.length) {
        const eps = await api(`/Shows/${item.Id}/Episodes?seasonId=${seasons.Items[0].Id}&userId=${state.userId}`)
          .catch(() => null);
        if (eps?.Items?.length) playVideo(eps.Items[0], eps.Items);
      }
    });

    const favBtn = $m('m-fav-btn');
    favBtn.addEventListener('click', async () => {
      const on = favBtn.dataset.on === '1';
      try {
        await api(`/Users/${state.userId}/FavoriteItems/${item.Id}`, { method: on ? 'DELETE' : 'POST' });
        favBtn.dataset.on = on ? '0' : '1';
        favBtn.querySelector('span').textContent = on ? t('detail.remember') : t('detail.remembered');
      } catch (error) {
        toast(t('detail.favoriteFailed'), true);
      }
    });

    $m('m-dl-btn').addEventListener('click', () => toast(t('offline.unavailable')));

    if (isSeries && seasons?.Items?.length) {
      loadEpisodes(item.Id, seasons.Items[0].Id);
    }
  } catch (error) {
    showError(t('common.loadFailed', { error: error.message }));
  }
}

async function loadEpisodes(seriesId, seasonId) {
  const host = $m('m-episodes');
  if (!host) return;

  host.innerHTML = `<div class="m-section-head" style="padding-top:18px"><h2>${escapeHtml(t('detail.episodes'))}</h2></div>`;

  try {
    const data = await api(`/Shows/${seriesId}/Episodes?seasonId=${seasonId}&userId=${state.userId}&Fields=Overview,RunTimeTicks`);
    const episodes = data.Items || [];

    if (!episodes.length) {
      host.insertAdjacentHTML('beforeend', `<div class="m-empty">${escapeHtml(t('detail.noEpisodesInSeason'))}</div>`);
      return;
    }

    episodes.forEach((episode) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'm-episode';
      const thumb = wideImageUrl(episode);
      const played = episode.UserData?.PlayedPercentage;

      row.innerHTML = `
        <span class="m-ep-thumb">
          ${thumb.src ? `<img src="${escapeHtml(thumb.src)}" alt="" loading="lazy">` : ''}
          ${played > 0 && played < 100 ? `<span class="m-progress"><i style="width:${played}%"></i></span>` : ''}
        </span>
        <span class="m-ep-body">
          <span class="m-ep-title">${episode.IndexNumber != null ? episode.IndexNumber + '. ' : ''}${escapeHtml(episode.Name || '')}</span>
          <span class="m-ep-meta">${escapeHtml(formatRuntime(episode.RunTimeTicks) || '')}</span>
        </span>`;

      row.addEventListener('click', () => playVideo(episode, episodes));
      host.appendChild(row);
    });
  } catch (error) {
    host.insertAdjacentHTML('beforeend', `<div class="m-empty">${escapeHtml(t('episode.loadFailed'))}</div>`);
  }
}

function openItem(item) {
  switch (item.Type) {
    case 'Series':
    case 'Movie':
    case 'BoxSet':
      navigate(() => showDetail(item));
      break;
    case 'Season':
      navigate(() => showDetail({ Id: item.SeriesId, Name: item.SeriesName, Type: 'Series' }));
      break;
    case 'Episode':
      playVideo(item);
      break;
    case 'MusicAlbum':
    case 'MusicArtist':
      navigate(() => showDetail(item));
      break;
    default:
      navigate(() => showDetail(item));
  }
}

/* ========================== SUCHE ========================== */

let searchTimer = null;

function openSearch() {
  ui.searchBar.classList.remove('hidden');
  ui.searchInput.focus();
}

function closeSearch() {
  ui.searchBar.classList.add('hidden');
  ui.searchInput.value = '';
  return true;
}

$m('m-search-btn').addEventListener('click', openSearch);
$m('m-search-close').addEventListener('click', () => {
  closeSearch();
  navigate(showHome, { push: false });
});

ui.searchInput.addEventListener('input', (event) => {
  const term = event.target.value.trim();
  clearTimeout(searchTimer);
  if (term.length < 2) return;
  searchTimer = setTimeout(() => runSearch(term), 350);
});

async function runSearch(term) {
  showLoading();
  ui.title.textContent = t('search.heading', { term });

  try {
    const data = await api(itemsUrl({
      SearchTerm: term,
      IncludeItemTypes: 'Movie,Series,MusicAlbum,Episode,BoxSet',
      Recursive: 'true',
      Limit: '60',
      Fields: 'ProductionYear,RunTimeTicks,DateCreated'
    }));

    const items = data.Items || [];
    ui.view.innerHTML = '';

    if (!items.length) return showEmpty(t('search.noResults', { term }));
    ui.view.appendChild(buildGrid(items));
  } catch (error) {
    showError(t('search.failed', { error: error.message }));
  }
}

/* ========================== TABS ========================== */

const VIEWS = {
  home: showHome,
  movies: () => showCatalog('movies', 'Movie,BoxSet', t('nav.movies')),
  series: () => showCatalog('series', 'Series', t('nav.series')),
  music: showMusic,
  offline: () => {
    setActiveTab('offline');
    ui.title.textContent = t('offline.title');
    showEmpty(t('offline.unavailable'));
  }
};

ui.tabs.querySelectorAll('.m-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    nav.stack = [];
    ui.back.classList.add('hidden');
    closeSearch();
    navigate(VIEWS[tab.dataset.view] || showHome, { push: false });
  });
});

/* ========================== ANMELDUNG ========================== */

$m('connect-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  const button = $m('login-btn');
  const error = $m('auth-error');
  error.textContent = '';

  const url = normalizeServerUrl($m('server-url').value.trim());
  const username = $m('username').value.trim();
  const password = $m('password').value;

  if (!url || !username) {
    error.textContent = t('auth.missingFields');
    return;
  }

  button.disabled = true;

  try {
    const auth = await authenticate(url, username, password);
    /* Nicht die eingegebene Adresse merken, sondern die, die
       geantwortet hat: Wurde umgeleitet, verlöre sonst jede weitere
       Anfrage ihren Authorization-Header. */
    const activeUrl = auth.serverUrl || url;
    state.serverUrl = activeUrl;
    state.token = auth.accessToken;
    state.userId = auth.userId;
    state.username = auth.userName;

    try {
      localStorage.setItem('jf-session', JSON.stringify({
        serverUrl: activeUrl, token: auth.accessToken,
        userId: auth.userId, username: auth.userName
      }));
    } catch (e) { /* ignorieren */ }

    enterApp();
  } catch (err) {
    error.textContent = err.message || t('login.failed');
  } finally {
    button.disabled = false;
  }
});

function enterApp() {
  ui.login.classList.add('hidden');
  ui.app.classList.remove('hidden');
  nav.stack = [];
  navigate(showHome, { push: false });
}

async function restoreSession() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('jf-session') || 'null');
  } catch (error) { return; }

  if (!saved?.token || !saved?.serverUrl) return;

  state.serverUrl = saved.serverUrl;
  state.token = saved.token;
  state.userId = saved.userId;
  state.username = saved.username;

  try {
    await api(`/Users/${state.userId}`);
    enterApp();
  } catch (error) {
    // Abgelehnt: zurück zur Anmeldung. Bei reinem Netzfehler bleibt
    // die Sitzung erhalten, damit ein kurzer Ausfall nicht abmeldet.
    if (/Sitzung|expired|^40[13]/.test(error.message || '')) {
      try { localStorage.removeItem('jf-session'); } catch (e) { /* ignorieren */ }
      state.token = '';
    } else {
      enterApp();
    }
  }
}

setSessionExpiredHandler(() => {
  try { localStorage.removeItem('jf-session'); } catch (e) { /* ignorieren */ }
  ui.app.classList.add('hidden');
  ui.login.classList.remove('hidden');
  toast(t('server.sessionExpired'), true);
});

/* ========================== START ========================== */

window.addEventListener('DOMContentLoaded', async () => {
  await initI18n();

  const version = $m('login-version');
  if (version) version.textContent = `v${window.appInfo?.version || ''}`;

  // Einen Eintrag anlegen, damit die Zurück-Taste abgefangen wird
  history.pushState(null, '');

  restoreSession();
});
