/* ============================================================
   Offline-Downloads (Renderer-Seite)
   Erwartet die Globals aus renderer.js ($, state, api, ...)
   ============================================================ */

/* Spiegel des Katalogs aus dem Main-Process. Wird beim Start und
   bei jeder Aenderung neu gefuellt. */
const offline = {
  items: [],
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

  // Groesse der Originaldatei ermitteln — nur die kennt der Server exakt
  let sourceSize = 0;
  let container = 'mkv';
  try {
    const detail = await api(`/Users/${state.userId}/Items/${item.Id}?Fields=MediaSources`);
    const source = detail?.MediaSources?.[0];
    if (source) {
      sourceSize = source.Size || 0;
      container = (source.Container || 'mkv').split(',')[0];
    }
  } catch (error) {
    /* Groesse ist nur Zusatzinfo */
  }

  // Steht in den Einstellungen eine feste Qualitaet, wird nicht gefragt
  if (prefs.dlQuality && prefs.dlQuality !== 'ask') {
    const preset = DL_QUALITIES.find((q) => q.id === prefs.dlQuality);
    if (preset) return beginDownload(item, preset, container, sourceSize);
  }

  $('dl-modal-title').textContent = t('download.title', { name: item.Name || 'Video' });
  $('dl-error').textContent = '';
  $('dl-options').innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  $('dl-modal').classList.remove('hidden');

  const host = $('dl-options');
  host.innerHTML = '';

  DL_QUALITIES.forEach((quality) => {
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

async function beginDownload(item, quality, container, sourceSize) {
  const bridge = dl();
  if (!bridge) return;

  try {
    const result = await bridge.start({
      itemId: item.Id,
      name: item.Name || 'Video',
      type: item.Type || 'Movie',
      seriesName: item.SeriesName || null,
      season: item.ParentIndexNumber != null ? item.ParentIndexNumber : null,
      episode: item.IndexNumber != null ? item.IndexNumber : null,
      year: item.ProductionYear || null,
      url: buildDownloadUrl(item, quality),
      quality: t(quality.labelKey),
      container: quality.id === 'original' ? container : 'mp4',
      expectedSize: quality.id === 'original' ? sourceSize : 0,
      poster: imageUrl(item, 'Primary', 480) || null
    });

    $('dl-modal').classList.add('hidden');
    toast(result.duplicate ? t('download.duplicate') : t('download.started', { name: item.Name }));
    await refreshOffline();
    if (state.view === showOffline) showOffline();
  } catch (error) {
    $('dl-error').textContent = t('download.startFailed', { error: error.message });
  }
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

function renderOfflineList() {
  const host = $('offline-list');
  if (!host) return;

  if (!offline.items.length) {
    host.innerHTML =
      `<div class="empty-state">${escapeHtml(t('offline.empty'))}</div>`;
    return;
  }

  host.innerHTML = '';

  offline.items.forEach((entry) => {
    const row = document.createElement('div');
    row.className = `offline-row ${entry.state}`;
    row.dataset.id = entry.id;

    const sub = [
      entry.seriesName
        ? `${entry.seriesName}${entry.season != null && entry.episode != null ? ` · S${entry.season} E${entry.episode}` : ''}`
        : entry.year || '',
      entry.quality
    ].filter(Boolean).join(' · ');

    const pct = entry.total ? Math.min(100, (entry.received / entry.total) * 100) : 0;

    row.innerHTML = `
      <div class="offline-art">${entry.poster ? `<img src="${fileUrl(entry.poster)}" alt="">` : DL_ICON}</div>
      <div class="offline-body">
        <div class="offline-title">${escapeHtml(entry.name)}</div>
        <div class="offline-sub">${escapeHtml(sub)}</div>
        ${entry.state === 'running' || entry.state === 'queued' ? `
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
        ${entry.state === 'running' || entry.state === 'queued'
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
        renderOfflineList();
      });
    }

    const cancelBtn = row.querySelector('.cancel');
    if (cancelBtn) {
      cancelBtn.innerHTML = ICON_X;
      cancelBtn.addEventListener('click', async () => {
        await dl().cancel(entry.id);
        await refreshOffline();
        renderOfflineList();
      });
    }

    const delBtn = row.querySelector('.del');
    if (delBtn) {
      delBtn.innerHTML = ICON_X;
      delBtn.addEventListener('click', async () => {
        await dl().remove(entry.id);
        await refreshOffline();
        showOffline();
        toast(t('offline.removed'));
      });
    }

    if (entry.state === 'done') {
      row.addEventListener('dblclick', () => playOffline(entry));
    }

    host.appendChild(row);
  });
}

/* Ein heruntergeladener Titel wird lokal abgespielt — ohne Server. */
function playOffline(entry) {
  playVideo(
    {
      Id: entry.itemId,
      Name: entry.name,
      Type: entry.type,
      SeriesName: entry.seriesName,
      IndexNumber: entry.episode,
      ProductionYear: entry.year
    },
    [],
    { localFile: entry.file }
  );
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
