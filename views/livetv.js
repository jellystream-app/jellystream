/* Live-TV: Kanaele mit laufender Sendung.
   Aus renderer.js herausgeloest; teilt sich mit ihm den globalen
   Bereich (state, el, api, t, buildCard, …) und wird nach ihm geladen. */

/* ========================= LIVE TV =========================
   Kanäle mit Logo und laufender Sendung. Keine
   Programmzeitschrift — die wäre ein eigenes Zeitraster-Layout.

   Kanäle sind für Jellyfin normale Titel: Der Klick spielt sie über
   denselben Weg ab wie einen Film (siehe openItem und playVideo).
   ============================================================ */

async function showLiveTv(library = null) {
  setActiveNav(null);
  setTopGap(true);

  if (library) {
    document.querySelectorAll('.library-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.id === library.Id);
    });
    document.querySelectorAll('.nav-btn[data-library]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.library === library.Id);
    });
  }

  const token = newToken('livetv');
  el.viewRoot.innerHTML = skeletonCards(12, 'wide');

  try {
    const { channels } = await fetchLiveTvChannels();
    if (!isCurrent('livetv', token)) return;

    const title = library?.Name || t('nav.liveTv');
    el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(title)}</h2>`;

    if (!channels.length) {
      el.viewRoot.insertAdjacentHTML('beforeend',
        `<div class="empty-state">${escapeHtml(t('liveTv.noChannels'))}</div>`);
      setStatus(title);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'channel-grid';
    channels.forEach((channel) => grid.appendChild(buildChannelCard(channel)));
    el.viewRoot.appendChild(grid);

    setStatus(title);
  } catch (error) {
    if (!isCurrent('livetv', token)) return;
    console.error(error);
    showError(t('common.loadFailed', { error: error.message }),
      () => navigate(state.view, { push: false }));
  }
}

/** Eine Kanalkachel: Logo, Nummer, Name, laufende Sendung.
 *
 *  Bewusst keine normale Karte: Ein Senderlogo ist meist ein
 *  freistehendes Bild mit Rand, kein formatfüllendes Plakat. In einer
 *  16:9-Kachel würde es beschnitten oder verzerrt — deshalb `contain`
 *  und eine eigene Form. */
function buildChannelCard(channel) {
  const { number, name } = channelLabel(channel);
  const program = channel.CurrentProgram;
  const progress = programProgress(program);

  const card = document.createElement('article');
  card.className = 'channel-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', t('liveTv.watchAria', { name }));

  const logo = imageUrl(channel, 'Primary', 220);

  card.innerHTML = `
    <div class="channel-logo">${
      logo
        ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.remove()">`
        : `<span class="channel-initial">${escapeHtml((name || '?').charAt(0).toUpperCase())}</span>`
    }</div>
    <div class="channel-body">
      <strong>${number ? `<span class="channel-number">${escapeHtml(number)}</span>` : ''}${escapeHtml(name)}</strong>
      ${program
        ? `<small>${escapeHtml(program.Name || '')}</small>`
        : `<small class="channel-quiet">${escapeHtml(t('liveTv.noProgram'))}</small>`}
      ${progress != null
        ? `<span class="channel-bar"><i style="width:${Math.round(progress * 100)}%"></i></span>`
        : ''}
    </div>`;

  const start = () => playVideo(channel);
  card.addEventListener('click', start);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      start();
    }
  });

  return card;
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
