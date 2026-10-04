/* Musik: Alben, Interpreten, Titelzeilen.
   Aus renderer.js herausgeloest; teilt sich mit ihm den globalen
   Bereich (state, el, api, t, buildCard, …) und wird nach ihm geladen. */

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
              ${window.downloads ? `<button class="outline-btn" id="album-download" type="button">${escapeHtml(t('download.albumAll'))}</button>` : ''}
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
        <span class="queue-dur">${formatTime(ticksToSeconds(track.RunTimeTicks))}</span>
        ${isDownloadable(track) ? `<button class="queue-dl" type="button"
                data-dl-item="${escapeHtml(track.Id)}"
                title="${escapeHtml(t('card.download'))}"
                aria-label="${escapeHtml(t('card.download'))}">${ICON_DOWNLOAD}</button>` : ''}`;

      // Klick auf das Symbol darf nicht zugleich den Titel starten
      item.querySelector('.queue-dl')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const entry = offlineEntry(track.Id);
        if (entry) return toast(t('offline.alreadyDownloaded'));
        openDownloadModal({ ...track, Album: track.Album || album.Name, AlbumId: track.AlbumId || album.Id });
      });

      item.addEventListener('click', () => music.play(tracks, index));
      list.appendChild(item);
    });

    updateDownloadButtons();

    $('album-download')?.addEventListener('click', () => {
      /* Album- und Interpretennamen ergänzen: In der Titelliste fehlen
         sie mitunter, und ohne sie fände die Gruppierung nicht statt. */
      const enriched = tracks.map((track) => ({
        ...track,
        Album: track.Album || album.Name,
        AlbumId: track.AlbumId || album.Id,
        AlbumArtist: track.AlbumArtist || album.AlbumArtist
      }));
      downloadAlbum(album, enriched);
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
  makeActivatable(row, track.Name || '');
  return row;
}
