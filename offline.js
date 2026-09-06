/* ============================================================
   Offline-Downloads (Renderer-Seite)
   Erwartet die Globals aus renderer.js ($, state, api, ...)
   ============================================================ */

/* Spiegel des Katalogs aus dem Main-Process. Wird beim Start und
   bei jeder Aenderung neu gefuellt. */
const offline = {
  items: [],
  /** Nach Album/Staffel zusammengefasst; Einzelstücke bleiben einzeln */
  groups: [],
  ready: false,
  /** true, wenn die App ohne erreichbaren Server gestartet ist */
  mode: false
};

const dl = () => window.downloads || null;

/* ------------------------- Hilfen ------------------------- */

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value < 10 && unit > 1 ? 1 : 0;
  return `${value.toFixed(digits).replace('.', ',')} ${units[unit]}`;
}

/** Fertiger Download zu einer Jellyfin-Item-Id, sonst null. */
function offlineEntry(itemId) {
  return offline.items.find((entry) => entry.itemId === itemId && entry.state === 'done') || null;
}

function offlineState(itemId) {
  const entry = offline.items.find((e) => e.itemId === itemId);
  return entry ? entry.state : null;
}

/** file://-URL aus einem Windows-Pfad. Backslashes und Sonderzeichen
    muessen kodiert werden, sonst laedt Chromium die Datei nicht. */
function fileUrl(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `file://${prefixed.split('/').map(encodeURIComponent).join('/')}`;
}

async function refreshOffline() {
  const bridge = dl();
  if (!bridge) return;
  try {
    offline.items = await bridge.list();
    // Gruppen kommen aus dem Main-Process, damit Renderer und Katalog
    // dieselbe Einteilung verwenden
    offline.groups = bridge.groups ? await bridge.groups() : [];
    offline.ready = true;
  } catch (error) {
    console.warn('Download-Liste nicht lesbar:', error);
  }
}

/* ==================== DOWNLOAD-DIALOG ==================== */

/* Qualitaetsstufen fuer den Download. Original ist ein 1:1-Abzug,
   die anderen laesst der Server nach MP4 transcodieren. */
const DL_QUALITIES = [
  { id: 'original', labelKey: 'download.original', hintKey: 'download.originalHint', bitrate: 0 },
  { id: '1080', labelKey: 'download.1080', hintKey: 'download.1080Hint', bitrate: 8000000, height: 1080 },
  { id: '720', labelKey: 'download.720', hintKey: 'download.720Hint', bitrate: 4000000, height: 720 },
  { id: '480', labelKey: 'download.480', hintKey: 'download.480Hint', bitrate: 1500000, height: 480 }
];

/* Musik kennt keine Auflösung. Zwei Stufen genügen: die Datei, wie sie
   auf dem Server liegt (FLAC bleibt FLAC), oder MP3 für alle, denen
   Platz wichtiger ist als das letzte Bit. */
const DL_AUDIO_QUALITIES = [
  { id: 'original', labelKey: 'download.audioOriginal', hintKey: 'download.audioOriginalHint', bitrate: 0 },
  { id: 'mp3', labelKey: 'download.audioMp3', hintKey: 'download.audioMp3Hint', bitrate: 320000 }
];

function isAudioItem(item) {
  return item?.Type === 'Audio';
}

let dlTarget = null;

async function openDownloadModal(item) {
  if (!dl()) return toast(t('offline.unavailable'), true);

  const existing = offline.items.find((e) => e.itemId === item.Id);
  if (existing && existing.state === 'done') {
    return toast(t('offline.alreadyDownloaded'));
  }
  if (existing && (existing.state === 'running' || existing.state === 'queued')) {
    return toast(t('offline.alreadyRunning'));
  }

  dlTarget = item;
  const audio = isAudioItem(item);
  const tiers = audio ? DL_AUDIO_QUALITIES : DL_QUALITIES;

  // Groesse der Originaldatei ermitteln — nur die kennt der Server exakt
  let sourceSize = 0;
  let container = audio ? 'mp3' : 'mkv';
  try {
    const detail = await api(`/Users/${state.userId}/Items/${item.Id}?Fields=MediaSources`);
    const source = detail?.MediaSources?.[0];
    if (source) {
      sourceSize = source.Size || 0;
      container = (source.Container || container).split(',')[0];
    }
  } catch (error) {
    /* Groesse ist nur Zusatzinfo */
  }

  /* Steht in den Einstellungen eine feste Qualitaet, wird nicht gefragt.
     Bei Musik greift die Videostufe nicht — dort gilt "Original",
     sofern nicht ausdruecklich MP3 gewaehlt wurde. */
  if (prefs.dlQuality && prefs.dlQuality !== 'ask') {
    const preset = audio
      ? (tiers.find((q) => q.id === prefs.dlQuality) || tiers[0])
      : tiers.find((q) => q.id === prefs.dlQuality);
    if (preset) return beginDownload(item, preset, container, sourceSize);
  }

  $('dl-modal-title').textContent = t('download.title', { name: item.Name || 'Video' });
  $('dl-error').textContent = '';
  $('dl-options').innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  $('dl-modal').classList.remove('hidden');

  const host = $('dl-options');
  host.innerHTML = '';

  tiers.forEach((quality) => {
    const isOriginal = quality.id === 'original';
    // Grobe Schaetzung ueber die Laufzeit; nur als Hausnummer gedacht
    const runtimeSeconds = ticksToSeconds(item.RunTimeTicks);
    const estimate = isOriginal
      ? sourceSize
      : runtimeSeconds ? (quality.bitrate / 8) * runtimeSeconds : 0;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dl-option';
    btn.innerHTML = `
      <span class="dl-opt-main">
        <strong>${escapeHtml(t(quality.labelKey))}</strong>
        <small>${escapeHtml(t(quality.hintKey))}</small>
      </span>
      <span class="dl-opt-size">${estimate ? escapeHtml(isOriginal ? formatBytes(estimate) : t('download.approx', { size: formatBytes(estimate) })) : ''}</span>`;

    btn.addEventListener('click', () => beginDownload(item, quality, container, sourceSize));
    host.appendChild(btn);
  });
}

function buildDownloadUrl(item, quality) {
  /* Musik laeuft ueber /Audio statt /Videos. "static=true" liefert die
     Datei unveraendert — bei FLAC also FLAC, nicht umgewandelt. */
  if (isAudioItem(item)) {
    if (quality.id === 'original') {
      return `${state.serverUrl}/Audio/${item.Id}/stream?static=true&api_key=${encodeURIComponent(state.token)}`;
    }

    const params = new URLSearchParams({
      api_key: state.token,
      audioCodec: 'mp3',
      audioBitRate: String(quality.bitrate),
      DeviceId: getDeviceId()
    });
    return `${state.serverUrl}/Audio/${item.Id}/stream.mp3?${params}`;
  }

  if (quality.id === 'original') {
    return `${state.serverUrl}/Videos/${item.Id}/stream?static=true&api_key=${encodeURIComponent(state.token)}`;
  }

  const params = new URLSearchParams({
    api_key: state.token,
    VideoCodec: 'h264',
    AudioCodec: 'aac',
    Container: 'mp4',
    VideoBitrate: String(quality.bitrate),
    MaxHeight: String(quality.height),
    DeviceId: getDeviceId(),
    Static: 'false'
  });
  return `${state.serverUrl}/Videos/${item.Id}/stream.mp4?${params}`;
}

/** Baut die Angaben für den Main-Process. Getrennt von beginDownload(),
 *  weil der Sammel-Download dieselben Felder braucht. */
function downloadPayload(item, quality, container, sourceSize, extra = {}) {
  const audio = isAudioItem(item);

  return {
    itemId: item.Id,
    name: item.Name || (audio ? 'Titel' : 'Video'),
    type: item.Type || 'Movie',

    seriesName: item.SeriesName || null,
    season: item.ParentIndexNumber != null ? item.ParentIndexNumber : null,
    seasonLabel: item.SeasonName || null,
    episode: item.IndexNumber != null ? item.IndexNumber : null,
    year: item.ProductionYear || null,

    /* Musik: Album und Interpret bestimmen Gruppe und Ablageort.
       AlbumId ist der verlässliche Schlüssel — zwei Alben können
       gleich heißen. */
    albumName: audio ? (item.Album || null) : null,
    albumId: audio ? (item.AlbumId || null) : null,
    albumArtist: audio ? (item.AlbumArtist || null) : null,
    artist: audio ? (item.Artists?.join(', ') || item.AlbumArtist || null) : null,
    track: audio && item.IndexNumber != null ? item.IndexNumber : null,

    url: buildDownloadUrl(item, quality),
    quality: t(quality.labelKey),
    container: quality.id === 'original' ? container : (audio ? 'mp3' : 'mp4'),
    expectedSize: quality.id === 'original' ? sourceSize : 0,
    poster: imageUrl(item, 'Primary', 480) || null,
    ...extra
  };
}

async function beginDownload(item, quality, container, sourceSize) {
  const bridge = dl();
  if (!bridge) return;

  try {
    const result = await bridge.start(downloadPayload(item, quality, container, sourceSize));

    $('dl-modal').classList.add('hidden');
    toast(result.duplicate ? t('download.duplicate') : t('download.started', { name: item.Name }));
    await refreshOffline();
    if (state.view === showOffline) showOffline();
  } catch (error) {
    $('dl-error').textContent = t('download.startFailed', { error: error.message });
  }
}

/* ==================== SAMMEL-DOWNLOAD ====================
   Ein Album oder eine Staffel am Stück. Die Titel werden einzeln
   eingereiht — der Manager lädt weiterhin höchstens zwei gleichzeitig,
   der Rest wartet. Ohne diese Beschränkung würden zwanzig gleichzeitige
   Übertragungen einander die Bandbreite wegnehmen.
   ========================================================== */

async function downloadMany(items, { groupName }) {
  const bridge = dl();
  if (!bridge) return toast(t('offline.unavailable'), true);
  if (!items.length) return toast(t('download.groupEmpty'), true);

  // Was schon vorliegt oder läuft, wird übersprungen
  const pending = items.filter((item) => {
    const existing = offline.items.find((e) => e.itemId === item.Id);
    return !existing || existing.state === 'failed';
  });

  if (!pending.length) return toast(t('download.groupAlready', { name: groupName }));

  toast(t('download.groupStarted', { count: pending.length, name: groupName }));

  let started = 0;
  for (const item of pending) {
    const audio = isAudioItem(item);
    const quality = audio ? DL_AUDIO_QUALITIES[0] : DL_QUALITIES[0];

    /* Größe und Container je Titel erfragen. Nacheinander statt
       gleichzeitig: zwanzig parallele Abfragen wären ein Sturm auf
       den Server, und Eile ist hier nicht nötig. */
    let container = audio ? 'mp3' : 'mkv';
    let sourceSize = 0;
    try {
      const detail = await api(`/Users/${state.userId}/Items/${item.Id}?Fields=MediaSources`);
      const source = detail?.MediaSources?.[0];
      if (source) {
        sourceSize = source.Size || 0;
        container = (source.Container || container).split(',')[0];
      }
    } catch (error) {
      /* Größe ist nur Zusatzinfo */
    }

    try {
      // groupTotal: damit "3/12" auch stimmt, solange erst drei drin sind
      await bridge.start(downloadPayload(item, quality, container, sourceSize, {
        groupTotal: items.length
      }));
      started += 1;
    } catch (error) {
      console.warn('Download nicht gestartet:', item.Name, error.message);
    }
  }

  await refreshOffline();
  if (state.view === showOffline) showOffline();
  if (!started) toast(t('download.groupFailed'), true);
}

/** Ganzes Album. Die Titel kommen von der Albumseite, damit die
 *  Reihenfolge und die Nummern stimmen. */
async function downloadAlbum(album, tracks) {
  return downloadMany(tracks, { groupName: album.Name || t('download.album') });
}

/** Ganze Staffel. */
async function downloadSeason(episodes, label) {
  return downloadMany(episodes, { groupName: label });
}

/* ==================== OFFLINE-ANSICHT ==================== */

const DL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4 17.5v1A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-1"/></svg>`;

function downloadStateLabel(entry) {
  switch (entry.state) {
    case 'done': return formatBytes(entry.size);
    case 'running': return t('offline.loading');
    case 'queued': return t('offline.queued');
    // errorKey kommt uebersetzbar aus dem Main-Process; error ist eine
    // technische Meldung (HTTP-Status o. ae.) und bleibt, wie sie ist.
    default: return entry.errorKey ? t(entry.errorKey) : (entry.error || t('offline.failed'));
  }
}

async function showOffline() {
  setActiveNav('offline');
  setTopGap(true);

  const bridge = dl();
  if (!bridge) {
    return showEmpty(t('offline.unavailable'));
  }

  await refreshOffline();
  const usage = await bridge.usage().catch(() => ({ bytes: 0, count: 0, dir: '' }));

  el.viewRoot.innerHTML = `
    <div class="offline-head">
      <h2 class="section-title" style="margin:0">${escapeHtml(t('offline.title'))}</h2>
      <div class="offline-meta">
        <span>${escapeHtml(t('offline.usage', { size: formatBytes(usage.bytes), count: usage.count }))}</span>
        <button class="outline-btn small" id="off-open" type="button">${escapeHtml(t('offline.openFolder'))}</button>
        <button class="outline-btn small" id="off-clear" type="button">${escapeHtml(t('offline.clearAll'))}</button>
      </div>
    </div>
    <div class="offline-list" id="offline-list"></div>`;

  $('off-open').addEventListener('click', () => bridge.openDir());
  $('off-clear').addEventListener('click', async () => {
    const done = offline.items.filter((e) => e.state === 'done');
    if (!done.length) return toast(t('offline.nothingToRemove'));
    for (const entry of done) await bridge.remove(entry.id);
    await refreshOffline();
    showOffline();
    toast(t('offline.removedCount', { count: done.length }));
  });

  renderOfflineList();
  setStatus(t('offline.title'));
}

/** Eine einzelne Download-Zeile. `onChange` wird nach Aktionen
 *  gerufen, damit Liste und Gruppenseite sich gleich verhalten. */
function buildOfflineRow(entry, onChange) {
  const row = document.createElement('div');
  row.className = `offline-row ${entry.state}`;
  row.dataset.id = entry.id;

  /* In der Gruppenansicht ist der Kontext schon durch die Überschrift
     gesetzt — dort wäre "Album · Interpret" in jeder Zeile nur Lärm. */
  const sub = [
    entry.albumName
      ? (entry.artist || entry.albumArtist || '')
      : entry.seriesName
        ? `${entry.seriesName}${entry.season != null && entry.episode != null ? ` · S${entry.season} E${entry.episode}` : ''}`
        : entry.year || '',
    entry.quality
  ].filter(Boolean).join(' · ');

  const pct = entry.total ? Math.min(100, (entry.received / entry.total) * 100) : 0;
  const busy = entry.state === 'running' || entry.state === 'queued';

  row.innerHTML = `
    <div class="offline-art">${entry.poster ? `<img src="${fileUrl(entry.poster)}" alt="">` : DL_ICON}</div>
    <div class="offline-body">
      <div class="offline-title">${escapeHtml(entry.name)}</div>
      <div class="offline-sub">${escapeHtml(sub)}</div>
      ${busy ? `
        <div class="offline-progress"><div class="bar" style="width:${pct}%"></div></div>
        <div class="offline-bytes">${escapeHtml(
          entry.total
            ? `${formatBytes(entry.received)} / ${formatBytes(entry.total)}`
            : formatBytes(entry.received)
        )}</div>` : ''}
    </div>
    <div class="offline-state">${escapeHtml(downloadStateLabel(entry))}</div>
    <div class="offline-actions">
      ${entry.state === 'done' ? `<button class="card-icon-btn play-local" type="button" title="${escapeHtml(t('offline.play'))}" aria-label="${escapeHtml(t('offline.play'))}"></button>` : ''}
      ${entry.state === 'failed' ? `<button class="card-icon-btn retry" type="button" title="${escapeHtml(t('offline.retry'))}" aria-label="${escapeHtml(t('offline.retry'))}"></button>` : ''}
      ${busy
        ? `<button class="card-icon-btn cancel" type="button" title="${escapeHtml(t('offline.cancel'))}" aria-label="${escapeHtml(t('offline.cancel'))}"></button>`
        : `<button class="card-icon-btn del" type="button" title="${escapeHtml(t('offline.remove'))}" aria-label="${escapeHtml(t('offline.remove'))}"></button>`}
    </div>`;

  row.querySelector('.play-local')?.addEventListener('click', () => playOffline(entry));
  row.querySelector('.play-local')?.insertAdjacentHTML('afterbegin', ICON_PLAY);

  const retryBtn = row.querySelector('.retry');
  if (retryBtn) {
    retryBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></svg>';
    retryBtn.addEventListener('click', async () => {
      await dl().retry(entry.id);
      await refreshOffline();
      onChange();
    });
  }

  const cancelBtn = row.querySelector('.cancel');
  if (cancelBtn) {
    cancelBtn.innerHTML = ICON_X;
    cancelBtn.addEventListener('click', async () => {
      await dl().cancel(entry.id);
      await refreshOffline();
      onChange();
    });
  }

  const delBtn = row.querySelector('.del');
  if (delBtn) {
    delBtn.innerHTML = ICON_X;
    delBtn.addEventListener('click', async () => {
      await dl().remove(entry.id);
      await refreshOffline();
      onChange();
      toast(t('offline.removed'));
    });
  }

  if (entry.state === 'done') {
    row.addEventListener('dblclick', () => playOffline(entry));
  }

  return row;
}

const GROUP_ARROW = `<svg class="group-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`;

/** Kopfzeile einer Gruppe: Titel, Zählstand, Pfeil zur Unterseite. */
function buildGroupRow(group) {
  const row = document.createElement('div');
  row.className = 'offline-row offline-group';
  row.dataset.group = group.key;

  const counter = `${group.done}/${group.total}`;
  const running = group.busy > 0;

  const sub = [
    group.type === 'MusicAlbum' ? (group.artist || t('offline.album')) : t('offline.series'),
    group.done ? formatBytes(group.size) : ''
  ].filter(Boolean).join(' · ');

  // Fortschritt über die ganze Gruppe, nicht über einzelne Dateien
  const pct = group.total ? (group.done / group.total) * 100 : 0;

  row.innerHTML = `
    <div class="offline-art">${group.poster ? `<img src="${fileUrl(group.poster)}" alt="">` : DL_ICON}</div>
    <div class="offline-body">
      <div class="offline-title">${escapeHtml(group.title)}</div>
      <div class="offline-sub">${escapeHtml(sub)}</div>
      ${running ? `<div class="offline-progress"><div class="bar" style="width:${pct}%"></div></div>` : ''}
    </div>
    <div class="offline-state">
      <span class="group-count">${escapeHtml(counter)}</span>
      ${group.failed ? `<span class="group-failed">${escapeHtml(t('offline.groupFailed', { count: group.failed }))}</span>` : ''}
    </div>
    <div class="offline-actions">${GROUP_ARROW}</div>`;

  row.addEventListener('click', () => navigate(() => showDownloadGroup(group.key)));
  return row;
}

function renderOfflineList() {
  const host = $('offline-list');
  if (!host) return;

  if (!offline.items.length) {
    host.innerHTML =
      `<div class="empty-state">${escapeHtml(t('offline.empty'))}</div>`;
    return;
  }

  host.innerHTML = '';

  /* Ohne Gruppen aus dem Main-Process (ältere Brücke) bleibt es bei
     der flachen Liste — dann fehlt die Gruppierung, aber nichts geht
     kaputt. */
  const nodes = offline.groups?.length
    ? offline.groups
    : offline.items.map((entry) => ({ kind: 'single', entry }));

  nodes.forEach((node) => {
    host.appendChild(
      node.kind === 'group'
        ? buildGroupRow(node)
        : buildOfflineRow(node.entry, () => showOffline())
    );
  });
}

/* ==================== EINE GRUPPE ====================
   Eigene Seite über navigate(), damit der Zurück-Knopf der App
   von selbst funktioniert.
   ====================================================== */

async function showDownloadGroup(key) {
  setActiveNav('offline');
  setTopGap(true);

  await refreshOffline();
  const group = offline.groups.find((node) => node.kind === 'group' && node.key === key);

  // Alles gelöscht, während die Seite offen war
  if (!group) return showOffline();

  el.viewRoot.innerHTML = `
    <div class="offline-head">
      <div class="group-head">
        <div class="group-head-art">${group.poster ? `<img src="${fileUrl(group.poster)}" alt="">` : DL_ICON}</div>
        <div>
          <h2 class="section-title" style="margin:0">${escapeHtml(group.title)}</h2>
          <div class="group-head-sub">${escapeHtml([
            group.type === 'MusicAlbum' ? (group.artist || t('offline.album')) : t('offline.series'),
            t('offline.groupCount', { done: group.done, total: group.total }),
            group.size ? formatBytes(group.size) : ''
          ].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
      <div class="offline-meta">
        ${group.done ? `<button class="outline-btn small" id="grp-play" type="button">${escapeHtml(t('offline.playAll'))}</button>` : ''}
        <button class="outline-btn small" id="grp-remove" type="button">${escapeHtml(t('offline.removeGroup'))}</button>
      </div>
    </div>
    <div class="offline-list" id="offline-list"></div>`;

  const host = $('offline-list');
  group.items.forEach((entry) => {
    host.appendChild(buildOfflineRow(entry, () => showDownloadGroup(key)));
  });

  /* Alles abspielen: bei Musik als Warteschlange, bei Folgen der
     Reihe nach — beides erwartet man von einem Album bzw. einer
     Staffel. */
  $('grp-play')?.addEventListener('click', () => {
    const done = group.items.filter((entry) => entry.state === 'done');
    if (!done.length) return;
    if (group.type === 'MusicAlbum') playOfflineQueue(done);
    else playOffline(done[0]);
  });

  $('grp-remove').addEventListener('click', async () => {
    await dl().removeGroup(key);
    await refreshOffline();
    toast(t('offline.removedCount', { count: group.items.length }));
    navigate(showOffline, { push: false });
  });

  setStatus(group.title);
}

/** Katalogeintrag -> Jellyfin-ähnliches Objekt für die Spieler. */
function offlineItemFrom(entry) {
  return {
    Id: entry.itemId,
    Name: entry.name,
    Type: entry.type,
    SeriesName: entry.seriesName,
    IndexNumber: entry.albumName ? entry.track : entry.episode,
    ProductionYear: entry.year,
    Album: entry.albumName || undefined,
    AlbumId: entry.albumId || undefined,
    AlbumArtist: entry.albumArtist || undefined,
    Artists: entry.artist ? [entry.artist] : undefined
  };
}

/* Ein heruntergeladener Titel wird lokal abgespielt — ohne Server. */
function playOffline(entry) {
  // Musik gehört in den Musikspieler, nicht in den Videospieler
  if (entry.type === 'Audio') return playOfflineQueue([entry]);

  playVideo(offlineItemFrom(entry), [], { localFile: entry.file });
}

/** Mehrere heruntergeladene Titel als Warteschlange — für „Alles
 *  abspielen" auf der Albumseite. */
function playOfflineQueue(entries) {
  const tracks = entries.map((entry) => ({
    ...offlineItemFrom(entry),
    // Der Spieler erkennt daran, dass er von der Platte lesen soll
    localFile: entry.file,
    /* Das Cover liegt als Datei daneben. Ohne diesen Weg bliebe die
       Spieleroberfläche offline bildlos, weil imageUrl() Bildmarken
       vom Server braucht. */
    localPoster: entry.poster ? fileUrl(entry.poster) : null
  }));
  music.play(tracks, 0);
}

/* ================== EREIGNISSE AUS DEM MAIN ================== */

if (dl()) {
  dl().onEvent((message) => {
    if (message.type === 'list') {
      offline.items = message.items;
      // Nur neu zeichnen, wenn die Ansicht gerade sichtbar ist
      if ($('offline-list')) renderOfflineList();
      updateDownloadButtons();
      return;
    }

    if (message.type === 'progress') {
      const entry = offline.items.find((e) => e.id === message.id);
      if (entry) {
        entry.received = message.received;
        entry.total = message.total;
      }

      // Gezielt nur die eine Zeile anfassen — ein voller Neuaufbau
      // bei jedem Fortschritt waere sichtbares Flackern.
      const row = document.querySelector(`.offline-row[data-id="${message.id}"]`);
      if (row) {
        const bar = row.querySelector('.offline-progress .bar');
        const bytes = row.querySelector('.offline-bytes');
        if (bar && message.total) bar.style.width = `${Math.min(100, (message.received / message.total) * 100)}%`;
        if (bytes) {
          bytes.textContent = message.total
            ? `${formatBytes(message.received)} / ${formatBytes(message.total)}`
            : formatBytes(message.received);
        }
      }
    }
  });
}

/** Download-Symbole auf Karten/Infoseiten an den Status anpassen. */
function updateDownloadButtons() {
  document.querySelectorAll('[data-dl-item]').forEach((btn) => {
    const stateName = offlineState(btn.dataset.dlItem);
    btn.classList.toggle('on', stateName === 'done');
    btn.classList.toggle('busy', stateName === 'running' || stateName === 'queued');
    btn.title =
      stateName === 'done' ? t('offline.play')
        : stateName === 'running' || stateName === 'queued' ? t('offline.loading')
        : t('card.download');
  });
}
