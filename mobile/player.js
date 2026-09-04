/* ============================================================
   Mobiler Player

   Nutzt dieselbe Aushandlung wie der Desktop (core/playback.js):
   die App fragt den Server, WIE abgespielt wird, statt es zu raten.
   Nur die Bedienung ist eine andere — Vollbild, große Flächen,
   Tippen blendet die Bedienung ein und aus.
   ============================================================ */

const mp = {
  root: () => $m('m-player'),
  video: () => $m('m-video'),
  ui: () => $m('m-player-ui'),
  title: () => $m('m-player-title'),
  sub: () => $m('m-player-sub'),
  method: () => $m('m-player-method'),
  play: () => $m('m-play'),
  seek: () => $m('m-seek'),
  current: () => $m('m-current'),
  duration: () => $m('m-duration'),
  loading: () => $m('m-player-loading'),
  error: () => $m('m-player-error'),
  subs: () => $m('m-subs'),
  audio: () => $m('m-audio')
};

/* Zustand der laufenden Wiedergabe — wie beim Desktop, damit die
   gemeinsame Aushandlung dieselben Angaben bekommt. */
const current = {
  item: null,
  queue: [],
  index: -1,
  mediaSourceId: null,
  audioStreams: [],
  subtitleStreams: [],
  audioIndex: null,
  subtitleIndex: null,
  playMethod: null,
  playSessionId: null,
  transcoding: false,
  transcodeReason: '',
  serverSeekOffset: 0
};

let loadToken = 0;
let idleTimer = null;
let seeking = false;

/* ---------------- Zeitachse ----------------
   Beim Umrechnen liefert der Server ab der gewünschten Stelle, das
   <video> zählt aber wieder bei 0. Ohne Korrektur zeigt die Leiste
   die falsche Position und der Fortsetzen-Punkt wandert zurück. */

function mediaPosition() {
  return (mp.video().currentTime || 0) + (current.serverSeekOffset || 0);
}

function mediaDuration() {
  const full = ticksToSeconds(current.item?.RunTimeTicks || 0);
  if (current.serverSeekOffset > 0 && full > 0) return full;
  const own = mp.video().duration;
  return Number.isFinite(own) && own > 0 ? own : full;
}

function seekTo(seconds) {
  const target = Math.max(0, seconds);
  const offset = current.serverSeekOffset || 0;

  if (offset > 0) {
    const withinStream = target - offset;
    const len = mp.video().duration;
    // Ausserhalb des laufenden Streams: der Server muss neu ansetzen
    if (withinStream < 0 || (Number.isFinite(len) && withinStream > len)) {
      return loadSource(target);
    }
    mp.video().currentTime = withinStream;
    return;
  }

  mp.video().currentTime = target;
}

/* ---------------- Fortschritt melden ----------------
   Ohne diese Meldungen räumt Jellyfin weder die Sitzung noch
   laufende Transcode-Jobs ab. */

let reportTimer = null;

function startReporting() {
  stopReporting();

  const report = (path, extra = {}) => {
    api(`/Sessions/Playing${path}`, {
      method: 'POST',
      body: JSON.stringify({
        ItemId: current.item.Id,
        MediaSourceId: current.mediaSourceId,
        PlaySessionId: current.playSessionId,
        PositionTicks: Math.round(mediaPosition() * 10000000),
        PlayMethod: current.transcoding ? 'Transcode' : 'DirectStream',
        CanSeek: true,
        ...extra
      })
    }).catch(() => {});
  };

  report('', { IsPaused: false });
  reportTimer = setInterval(() => {
    if (!current.item || mp.video().paused) return;
    report('/Progress', { IsPaused: false });
  }, 10000);
}

function stopReporting() {
  clearInterval(reportTimer);
  reportTimer = null;

  if (!current.item || !current.playSessionId) return;

  const body = JSON.stringify({
    ItemId: current.item.Id,
    MediaSourceId: current.mediaSourceId,
    PlaySessionId: current.playSessionId,
    PositionTicks: Math.round(mediaPosition() * 10000000)
  });

  api('/Sessions/Playing/Stopped', { method: 'POST', body }).catch(() => {});
}

/* ---------------- Wiedergabe ---------------- */

async function playVideo(item, siblings = []) {
  current.queue = siblings.length ? siblings : [item];
  current.index = current.queue.findIndex((entry) => entry.Id === item.Id);
  if (current.index < 0) current.index = 0;

  current.item = item;
  mp.title().textContent = item.Name || '';
  mp.sub().textContent = item.Type === 'Episode'
    ? [item.SeriesName, item.IndexNumber != null ? t('detail.episode', { number: item.IndexNumber }) : '']
        .filter(Boolean).join(' · ')
    : String(item.ProductionYear || '');

  mp.root().classList.remove('hidden');
  mp.loading().classList.remove('hidden');
  mp.error().classList.add('hidden');
  resetIdle();

  // Spuren ermitteln
  let source = null;
  try {
    const detail = await api(`/Users/${state.userId}/Items/${item.Id}?Fields=MediaSources,MediaStreams`);
    source = detail?.MediaSources?.[0] || null;
  } catch (error) { /* die Aushandlung liefert sie sonst */ }

  const streams = source?.MediaStreams || [];
  current.mediaSourceId = source?.Id || item.Id;
  current.audioStreams = streams.filter((s) => s.Type === 'Audio');
  current.subtitleStreams = streams.filter((s) => s.Type === 'Subtitle');
  current.audioIndex = source?.DefaultAudioStreamIndex ?? current.audioStreams[0]?.Index ?? null;
  current.subtitleIndex = source?.DefaultSubtitleStreamIndex ?? null;

  updateTrackButtons();

  const resumeAt = ticksToSeconds(item.UserData?.PlaybackPositionTicks || 0);
  await loadSource(resumeAt);
}

async function loadSource(startAt = 0) {
  const item = current.item;
  if (!item) return;

  const token = ++loadToken;

  stopReporting();
  await stopTranscoding(current.playSessionId);
  current.playSessionId = null;

  mp.loading().classList.remove('hidden');
  mp.error().classList.add('hidden');

  const selectedSub = current.subtitleStreams.find((s) => s.Index === current.subtitleIndex);
  const burnIn = selectedSub && !isTextSubtitle(selectedSub);

  let plan = null;
  try {
    const info = await fetchPlaybackInfo(item, {
      audioIndex: current.audioIndex,
      subtitleIndex: burnIn ? current.subtitleIndex : null,
      startPositionTicks: Math.round(startAt * 10000000),
      mediaSourceId: current.mediaSourceId
    });
    plan = resolveStream(info, item, { audioIndex: current.audioIndex });
  } catch (error) {
    console.warn('PlaybackInfo failed:', error.message);
  }

  if (token !== loadToken) return;

  if (!plan) {
    mp.loading().classList.add('hidden');
    showPlayerError(t('player.failed'));
    return;
  }

  current.transcoding = plan.method === 'Transcode';
  current.playMethod = plan.method;
  current.playSessionId = plan.playSessionId;
  current.mediaSourceId = plan.source?.Id || current.mediaSourceId;
  current.transcodeReason = transcodeReason(plan.source);
  current.serverSeekOffset = plan.seekHandledByServer ? startAt : 0;

  updateMethodBadge();

  mp.video().src = plan.url;
  applySubtitle(selectedSub && isTextSubtitle(selectedSub) ? selectedSub : null);

  if (startAt > 0 && !plan.seekHandledByServer) {
    mp.video().addEventListener('loadedmetadata', function once() {
      mp.video().removeEventListener('loadedmetadata', once);
      mp.video().currentTime = startAt;
    });
  }

  startReporting();
  mp.video().play().catch((error) => console.warn('Autoplay blockiert:', error));
}

/* Bild-Untertitel kann <track> nicht darstellen — die muss der
   Server ins Bild rechnen. */
function isTextSubtitle(stream) {
  if (!stream) return true;
  const codec = (stream.Codec || '').toLowerCase();
  if (!codec) return Boolean(stream.IsExternal);
  if (codec.includes('microdvd')) return true;
  if (codec === 'sup' || codec === 'sub') return false;
  return !['pgs', 'dvdsub', 'vobsub', 'dvbsub'].some((c) => codec.includes(c));
}

/* Untertitel über fetch + Blob: <track> erzwingt CORS, und Jellyfin
   schickt dafür keinen erlaubenden Header. Ohne diesen Umweg bleibt
   die Spur lautlos leer — derselbe Fehler wie in der Desktop-Fassung. */
let subtitleUrl = null;

async function applySubtitle(stream) {
  mp.video().querySelectorAll('track').forEach((track) => track.remove());
  if (subtitleUrl) {
    URL.revokeObjectURL(subtitleUrl);
    subtitleUrl = null;
  }
  if (!stream || !current.item) return;

  const url = `${state.serverUrl}/Videos/${current.item.Id}/${current.mediaSourceId}` +
    `/Subtitles/${stream.Index}/Stream.vtt?api_key=${encodeURIComponent(state.token)}`;

  try {
    const response = await fetch(url, { headers: { Authorization: buildAuthHeader(state.token) } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const vtt = await response.text();
    if (!/^\s*WEBVTT/.test(vtt)) throw new Error('kein WebVTT');

    subtitleUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.src = subtitleUrl;
    track.default = true;
    mp.video().appendChild(track);

    setTimeout(() => {
      const tracks = mp.video().textTracks;
      if (tracks.length) tracks[tracks.length - 1].mode = 'showing';
    }, 250);
  } catch (error) {
    console.warn('Untertitel nicht ladbar:', error.message);
  }
}

function updateMethodBadge() {
  const labels = {
    DirectPlay: t('player.directPlay'),
    DirectStream: t('player.directStream'),
    Transcode: t('player.transcoding')
  };
  mp.method().textContent = labels[current.playMethod] || '';
  mp.method().className = `m-method ${current.transcoding ? 'transcoding' : 'direct'}`;
}

function showPlayerError(message) {
  mp.error().textContent = message;
  mp.error().classList.remove('hidden');
}

function updateTrackButtons() {
  mp.subs().classList.toggle('hidden', current.subtitleStreams.length === 0);
  mp.audio().classList.toggle('hidden', current.audioStreams.length < 2);
}

/* ---------------- Bedienung ---------------- */

function resetIdle() {
  mp.ui().classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!mp.video().paused) mp.ui().classList.add('idle');
  }, 3200);
}

function closePlayer() {
  stopReporting();
  if (current.playSessionId) {
    stopTranscoding(current.playSessionId);
    current.playSessionId = null;
  }
  loadToken += 1;

  mp.video().pause();
  mp.video().removeAttribute('src');
  mp.video().load();
  mp.root().classList.add('hidden');
  current.item = null;
  current.serverSeekOffset = 0;
  clearTimeout(idleTimer);
  return true;
}

function initPlayer() {
  const video = mp.video();

  // Tippen blendet die Bedienung ein und aus
  mp.ui().addEventListener('click', (event) => {
    if (event.target.closest('button, input')) return;
    if (mp.ui().classList.contains('idle')) resetIdle();
    else mp.ui().classList.add('idle');
  });

  mp.play().addEventListener('click', () => {
    if (video.paused) video.play(); else video.pause();
    resetIdle();
  });

  $m('m-back10').addEventListener('click', () => { seekTo(mediaPosition() - 10); resetIdle(); });
  $m('m-fwd10').addEventListener('click', () => { seekTo(mediaPosition() + 30); resetIdle(); });
  $m('m-player-close').addEventListener('click', closePlayer);

  video.addEventListener('play', () => {
    mp.play().querySelector('.ic-play').classList.add('hidden');
    mp.play().querySelector('.ic-pause').classList.remove('hidden');
    resetIdle();
  });
  video.addEventListener('pause', () => {
    mp.play().querySelector('.ic-play').classList.remove('hidden');
    mp.play().querySelector('.ic-pause').classList.add('hidden');
    mp.ui().classList.remove('idle');
  });

  video.addEventListener('waiting', () => mp.loading().classList.remove('hidden'));
  video.addEventListener('playing', () => mp.loading().classList.add('hidden'));
  video.addEventListener('canplay', () => mp.loading().classList.add('hidden'));

  video.addEventListener('loadedmetadata', () => {
    mp.duration().textContent = formatTime(mediaDuration());
  });

  video.addEventListener('timeupdate', () => {
    if (seeking) return;
    const position = mediaPosition();
    const total = mediaDuration();
    mp.current().textContent = formatTime(position);
    if (total) mp.seek().value = String(Math.round((position / total) * 1000));
  });

  mp.seek().addEventListener('input', () => {
    seeking = true;
    const total = mediaDuration();
    mp.current().textContent = formatTime((mp.seek().value / 1000) * total);
  });
  mp.seek().addEventListener('change', () => {
    seekTo((mp.seek().value / 1000) * mediaDuration());
    seeking = false;
    resetIdle();
  });

  /* Scheitert die Wiedergabe trotz Aushandlung, einmal Umrechnen
     erzwingen statt den Nutzer vor Schwarz sitzen zu lassen. */
  let fallbackTried = false;
  video.addEventListener('loadstart', () => { fallbackTried = false; });
  video.addEventListener('error', async () => {
    mp.loading().classList.add('hidden');
    if (!current.item) return;

    if (!fallbackTried && !current.transcoding) {
      fallbackTried = true;
      showPlayerError(t('player.retrying'));
      await loadSource(mediaPosition());
      return;
    }
    showPlayerError(t('player.failed'));
  });

  video.addEventListener('ended', () => {
    stopReporting();
    const next = current.queue[current.index + 1];
    if (next) {
      current.index += 1;
      playVideo(next, current.queue);
    } else {
      closePlayer();
    }
  });

  // Spurauswahl
  mp.subs().addEventListener('click', () => openTrackSheet('subtitle'));
  mp.audio().addEventListener('click', () => openTrackSheet('audio'));
}

/* ---------------- Auswahlblatt für Spuren ---------------- */

function openTrackSheet(kind) {
  const isSub = kind === 'subtitle';
  ui.sheetTitle.textContent = isSub ? t('player.subtitleTrack') : t('player.audioTrack');
  ui.sheetOptions.innerHTML = '';

  const options = isSub
    ? [{ Index: null, label: t('player.subtitlesOff') }, ...current.subtitleStreams.map((s) => ({
        Index: s.Index, label: s.DisplayTitle || s.Language || t('detail.unknown') }))]
    : current.audioStreams.map((s) => ({
        Index: s.Index, label: s.DisplayTitle || s.Language || t('detail.unknown') }));

  const activeIndex = isSub ? current.subtitleIndex : current.audioIndex;

  options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `m-sheet-option ${option.Index === activeIndex ? 'active' : ''}`;
    button.innerHTML = `<span class="tick">${option.Index === activeIndex ? '✓' : ''}</span>
      <span>${escapeHtml(option.label)}</span>`;

    button.addEventListener('click', async () => {
      closeSheet();
      if (option.Index === activeIndex) return;

      if (isSub) {
        current.subtitleIndex = option.Index;
        const stream = current.subtitleStreams.find((s) => s.Index === option.Index);
        // Bild-Untertitel brauchen einen neuen Stream, Text nicht
        if (stream && !isTextSubtitle(stream)) await loadSource(mediaPosition());
        else applySubtitle(stream || null);
      } else {
        current.audioIndex = option.Index;
        await loadSource(mediaPosition());
      }
    });

    ui.sheetOptions.appendChild(button);
  });

  ui.sheet.classList.remove('hidden');
}

function closeSheet() {
  ui.sheet.classList.add('hidden');
  return true;
}

ui.sheet.addEventListener('click', (event) => {
  if (event.target === ui.sheet) closeSheet();
});

// Beim Verlassen der Seite die Position sichern
window.addEventListener('pagehide', stopReporting);

initPlayer();
