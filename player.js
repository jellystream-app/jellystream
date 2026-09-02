/* ============================================================
   Video-Player + Musik-Player mit Lyrics
   Erwartet die Globals aus renderer.js ($, state, api, ...)
   ============================================================ */

/* ========================== VIDEO PLAYER ========================== */

const vp = {
  root: $('video-player'),
  video: $('video-el'),
  ui: $('video-ui'),
  loading: $('video-loading'),
  title: $('vp-title'),
  subtitle: $('vp-subtitle'),
  play: $('vp-play'),
  centerPlay: $('vp-center-play'),
  back10: $('vp-back10'),
  fwd10: $('vp-fwd10'),
  mute: $('vp-mute'),
  volume: $('vp-volume'),
  current: $('vp-current'),
  duration: $('vp-duration'),
  scrub: $('vp-scrub'),
  progress: $('vp-progress'),
  buffered: $('vp-buffered'),
  hoverTime: $('vp-hover-time'),
  speed: $('vp-speed'),
  speedMenu: $('vp-speed-menu'),
  quality: $('vp-quality'),
  qualityMenu: $('vp-quality-menu'),
  chapters: $('vp-chapters'),
  chaptersMenu: $('vp-chapters-menu'),
  chapterMarks: $('vp-chapter-marks'),
  nextup: $('vp-nextup'),
  nextupTitle: $('nextup-title'),
  nextupCount: $('nextup-count'),
  nextupPlay: $('nextup-play'),
  nextupCancel: $('nextup-cancel'),
  audio: $('vp-audio'),
  audioMenu: $('vp-audio-menu'),
  subs: $('vp-subs'),
  subsMenu: $('vp-subs-menu'),
  pip: $('vp-pip'),
  fullscreen: $('vp-fullscreen'),
  close: $('vp-close'),
  playMethod: $('vp-method'),
  error: $('vp-error')
};

let vpIdleTimer = null;
let vpQueue = [];
let vpIndex = -1;
let vpScrubbing = false;

// Aktueller Wiedergabe-Kontext für Spurwechsel
const vpCurrent = {
  item: null,
  mediaSourceId: null,
  audioStreams: [],
  subtitleStreams: [],
  audioIndex: null,
  subtitleIndex: null,
  transcoding: false,
  chapters: [],
  maxBitrate: 0, // 0 = Originalqualität
  local: false,  // true, wenn aus einer heruntergeladenen Datei gespielt wird

  /* Aushandlung mit dem Server */
  playMethod: null,        // DirectPlay | DirectStream | Transcode
  playSessionId: null,     // fuer Fortschritt und Abbruch des Transcodes
  transcodeReason: '',     // warum umgerechnet wird
  serverSeekOffset: 0      // beim Umrechnen liegt der Start schon im Stream
};

/* Laeuft ein Ladevorgang noch, wenn schon der naechste startet?
   Dann darf die alte Antwort nichts mehr ueberschreiben. */
let vpLoadToken = 0;

/* ---------------- Zeitachse ----------------
   Beim Umrechnen liefert der Server den Film ab der gewuenschten
   Stelle, das <video> zaehlt aber wieder bei 0. Ohne Korrektur
   zeigt die Leiste die falsche Position, Kapitel springen daneben
   und ein Sprung landet an der falschen Stelle.

   Diese drei Funktionen rechnen ueberall in Film-Zeit statt in
   Element-Zeit — der Rest des Players muss davon nichts wissen. */

function mediaPosition() {
  return (vp.video.currentTime || 0) + (vpCurrent.serverSeekOffset || 0);
}

function mediaDuration() {
  // Beim Umrechnen kennt das Element nur den Rest — die volle Laenge
  // steht in den Metadaten des Titels.
  const full = ticksToSeconds(vpCurrent.item?.RunTimeTicks || 0);
  if (vpCurrent.serverSeekOffset > 0 && full > 0) return full;
  const own = vp.video.duration;
  return Number.isFinite(own) && own > 0 ? own : full;
}

/** Springt an eine Stelle im Film — auch ueber die Grenze des Streams. */
function seekTo(seconds) {
  const target = Math.max(0, seconds);
  const offset = vpCurrent.serverSeekOffset || 0;

  if (offset > 0) {
    const withinStream = target - offset;
    const len = vp.video.duration;

    /* Liegt das Ziel ausserhalb des laufenden Streams, muss der
       Server neu ansetzen — sonst passiert schlicht nichts. */
    if (withinStream < 0 || (Number.isFinite(len) && withinStream > len)) {
      return loadVideoSource(target);
    }
    vp.video.currentTime = withinStream;
    return;
  }

  vp.video.currentTime = target;
}

/* X1: Qualitätsstufen fürs Streaming */
const QUALITIES = [
  { label: 'Original', bitrate: 0 },
  { label: '1080p · 20 Mbit', bitrate: 20000000 },
  { label: '1080p · 10 Mbit', bitrate: 10000000 },
  { label: '720p · 6 Mbit', bitrate: 6000000 },
  { label: '720p · 4 Mbit', bitrate: 4000000 },
  { label: '480p · 2 Mbit', bitrate: 2000000 },
  { label: '360p · 1 Mbit', bitrate: 1000000 }
];

const CHECK_SVG = `<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;

/* ==================== WIEDERGABE-MELDUNGEN ====================
   Ohne "Sessions/Playing/Stopped" räumt Jellyfin weder die Session
   noch laufende Transcode-Jobs ab. Die häufen sich an, bis der Server
   keine neuen Streams mehr ausliefert — der Ton bleibt dann einfach weg.
   ============================================================== */

const reporting = { video: null, audio: null };

function newPlaySessionId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `ps-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

async function reportPlayback(path, body) {
  try {
    await api(`/Sessions/Playing${path}`, { method: 'POST', body: JSON.stringify(body) });
  } catch (error) {
    // Melden ist Nebensache — Wiedergabe darf daran nie scheitern
    console.warn(`Playback-Report ${path} fehlgeschlagen:`, error.message);
  }
}

/* Beim Umrechnen faengt der Stream bei 0 an, obwohl er inhaltlich
   spaeter beginnt. Ohne diesen Versatz meldet die App eine falsche
   Position und der Fortsetzen-Punkt springt zurueck. */
function reportedPosition(kind, media) {
  const offset = kind === 'video' ? (vpCurrent.serverSeekOffset || 0) : 0;
  return Math.max(0, (media.currentTime || 0) + offset);
}

function startReporting(kind, item, { mediaSourceId, isTranscoding = false, playSessionId = null } = {}) {
  stopReporting(kind);

  const session = {
    // Die Kennung des Servers verwenden, wenn er eine geliefert hat —
    // sonst kann er Fortschritt und Transcode nicht zuordnen.
    playSessionId: playSessionId || newPlaySessionId(),
    itemId: item.Id,
    mediaSourceId: mediaSourceId || item.Id,
    isTranscoding,
    kind,
    timer: null
  };
  reporting[kind] = session;

  reportPlayback('', {
    ItemId: session.itemId,
    MediaSourceId: session.mediaSourceId,
    PlaySessionId: session.playSessionId,
    PlayMethod: isTranscoding ? 'Transcode' : 'DirectStream',
    CanSeek: true,
    IsPaused: false
  });

  // F5: Lebenszeichen, damit der Server die Sitzung bei langen Filmen
  // nicht für tot hält und den Transcode abbricht
  session.pingTimer = setInterval(() => {
    if (!reporting[kind]) return;
    api(`/Sessions/Playing/Ping?playSessionId=${encodeURIComponent(session.playSessionId)}`, { method: 'POST' })
      .catch(() => {});
  }, 30000);

  // Fortschritt melden, damit die Session nicht als tot gilt
  const media = kind === 'video' ? vp.video : mp.audio;
  session.timer = setInterval(() => {
    if (!reporting[kind] || media.paused) return;
    reportPlayback('/Progress', {
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId,
      PlaySessionId: session.playSessionId,
      PositionTicks: Math.round(reportedPosition(kind, media) * TICKS_PER_SECOND),
      IsPaused: media.paused,
      PlayMethod: session.isTranscoding ? 'Transcode' : 'DirectStream',
      CanSeek: true
    });
  }, 10000);
}

function stopReporting(kind, positionSeconds = null) {
  const session = reporting[kind];
  if (!session) return;

  clearInterval(session.timer);
  clearInterval(session.pingTimer);
  reporting[kind] = null;

  const media = kind === 'video' ? vp.video : mp.audio;
  const position = positionSeconds != null ? positionSeconds : reportedPosition(kind, media);

  // Das hier beendet serverseitig auch den Transcode-Job
  reportPlayback('/Stopped', {
    ItemId: session.itemId,
    MediaSourceId: session.mediaSourceId,
    PlaySessionId: session.playSessionId,
    PositionTicks: Math.round(position * TICKS_PER_SECOND)
  });
}

/* Beim Schliessen des Fensters die Position noch sichern.
   `pagehide` allein reichte nicht: der Browser bricht laufende
   fetch-Aufrufe beim Entladen ab, die Meldung ging also oft
   verloren. sendBeacon ist genau dafuer gemacht. */
function flushPlaybackState() {
  ['video', 'audio'].forEach((kind) => {
    const session = reporting[kind];
    if (!session) return;

    const media = kind === 'video' ? vp.video : mp.audio;
    const body = JSON.stringify({
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId,
      PlaySessionId: session.playSessionId,
      PositionTicks: Math.round(reportedPosition(kind, media) * TICKS_PER_SECOND)
    });

    let sent = false;
    try {
      // sendBeacon ueberlebt das Entladen der Seite
      const blob = new Blob([body], { type: 'application/json' });
      sent = navigator.sendBeacon(
        `${state.serverUrl}/Sessions/Playing/Stopped?api_key=${encodeURIComponent(state.token)}`,
        blob
      );
    } catch (error) {
      sent = false;
    }

    // Kein Beacon moeglich? Dann wenigstens den normalen Weg versuchen
    if (!sent) stopReporting(kind);
    else {
      clearInterval(session.timer);
      clearInterval(session.pingTimer);
      reporting[kind] = null;
    }
  });
}

window.addEventListener('pagehide', flushPlaybackState);
window.addEventListener('beforeunload', flushPlaybackState);

function toggleIcons(button, playing) {
  button.querySelector('.ic-play')?.classList.toggle('hidden', playing);
  button.querySelector('.ic-pause')?.classList.toggle('hidden', !playing);
}

async function playVideo(item, siblings = [], options = {}) {
  vpQueue = siblings.length ? siblings : [item];
  vpIndex = vpQueue.findIndex((entry) => entry.Id === item.Id);
  if (vpIndex < 0) vpIndex = 0;

  music.pause();

  // Liegt der Titel lokal vor, wird er von der Platte gespielt — ohne
  // Server, ohne Reporting. Explizit uebergeben (Offline-Ansicht) oder
  // automatisch, wenn ein fertiger Download existiert.
  const local =
    options.localFile ||
    (typeof offlineEntry === 'function' ? offlineEntry(item.Id)?.file : null);

  if (local) return playLocalFile(item, local);

  vp.title.textContent = item.Name || t('player.play');
  vp.subtitle.textContent =
    item.Type === 'Episode'
      ? [item.SeriesName, item.SeasonName, item.IndexNumber != null ? t('detail.episode', { number: item.IndexNumber }) : '']
          .filter(Boolean).join(' · ')
      : item.ProductionYear || '';

  vp.root.classList.remove('hidden');
  vp.loading.classList.remove('hidden');
  resetIdleTimer();

  vp.error.classList.add('hidden');

  // Spuren ermitteln — MediaSources kennt Ton- und Untertitelspuren
  let source = null;
  let detail = null;
  try {
    detail = await api(`/Users/${state.userId}/Items/${item.Id}?Fields=MediaSources,MediaStreams,Chapters`);
    source = detail?.MediaSources?.[0] || null;
  } catch (error) {
    console.warn('Spuren konnten nicht geladen werden:', error);
  }

  // X2: Kapitelmarken übernehmen
  vpCurrent.chapters = (detail?.Chapters || []).filter((c) => typeof c.StartPositionTicks === 'number');

  const streams = source?.MediaStreams || [];

  vpCurrent.item = item;
  vpCurrent.mediaSourceId = source?.Id || item.Id;
  vpCurrent.audioStreams = streams.filter((s) => s.Type === 'Audio');
  vpCurrent.subtitleStreams = streams.filter((s) => s.Type === 'Subtitle');

  const defaultAudio = vpCurrent.audioStreams.find((s) => s.IsDefault) || vpCurrent.audioStreams[0];
  vpCurrent.audioIndex = source?.DefaultAudioStreamIndex ?? defaultAudio?.Index ?? null;

  // Forcierte Untertitel automatisch vorwählen; auf Wunsch immer welche
  const forced = vpCurrent.subtitleStreams.find((s) => s.IsForced && s.IsDefault);
  let preselected = source?.DefaultSubtitleStreamIndex ?? forced?.Index ?? null;

  if (preselected == null && prefs.preferSubtitles && vpCurrent.subtitleStreams.length) {
    // Bevorzugt eine Textspur — die braucht kein Transcoding
    const preferred =
      vpCurrent.subtitleStreams.find((s) => isTextSubtitle(s) && (s.Language || '').startsWith('ger')) ||
      vpCurrent.subtitleStreams.find((s) => isTextSubtitle(s)) ||
      vpCurrent.subtitleStreams[0];
    preselected = preferred?.Index ?? null;
  }
  vpCurrent.subtitleIndex = preselected;

  buildTrackMenus();
  buildQualityMenu();
  buildChapterUi();

  const resumeAt = prefs.resumePlayback ? ticksToSeconds(item.UserData?.PlaybackPositionTicks || 0) : 0;
  loadVideoSource(resumeAt);
}

/* ---------------------- Offline-Wiedergabe ----------------------
   Spielt eine heruntergeladene Datei. Kein Reporting (der Server ist
   womoeglich gar nicht erreichbar) und keine Spur-/Qualitaetsmenues —
   dafuer waere serverseitiges Transcoding noetig.
   ---------------------------------------------------------------- */

function playLocalFile(item, filePath) {
  stopReporting('video');

  vpCurrent.item = item;
  vpCurrent.mediaSourceId = item.Id;
  vpCurrent.audioStreams = [];
  vpCurrent.subtitleStreams = [];
  vpCurrent.audioIndex = null;
  vpCurrent.subtitleIndex = null;
  vpCurrent.transcoding = false;
  vpCurrent.chapters = [];
  vpCurrent.local = true;

  vp.title.textContent = item.Name || t('player.play');
  vp.subtitle.textContent =
    item.Type === 'Episode'
      ? [item.SeriesName, item.IndexNumber != null ? t('detail.episode', { number: item.IndexNumber }) : '']
          .filter(Boolean).join(' · ')
      : item.ProductionYear || '';

  vp.root.classList.remove('hidden');
  vp.loading.classList.remove('hidden');
  resetIdleTimer();

  // Menues verbergen, die ohne Server keine Funktion haben
  [vp.audio, vp.subs, vp.quality, vp.chapters].forEach((btn) => btn?.classList.add('hidden'));
  vp.chapterMarks.innerHTML = '';

  vp.video.querySelectorAll('track').forEach((track) => track.remove());
  vp.video.src = fileUrl(filePath);
  vp.video.play().catch((error) => console.warn('Autoplay blockiert:', error));

  setStatus(t('player.offlinePlayback', { name: item.Name || '' }));
}

/* --------------------- Quelle & Spurwechsel --------------------- */

// Bild-Untertitel (PGS/VobSub) kann <track> nicht darstellen — die brauchen
// serverseitiges Einbrennen, also Transcoding statt Direktstream.
function isTextSubtitle(stream) {
  if (!stream) return true;
  const codec = (stream.Codec || '').toLowerCase();
  if (!codec) return Boolean(stream.IsExternal);
  if (codec.includes('microdvd')) return true;
  // Achtung: "sup"/"sub" nur bei exakter Gleichheit ausschließen — sonst
  // würde "subrip" (reines Textformat) fälschlich als Bild gelten.
  if (codec === 'sup' || codec === 'sub') return false;
  return !['pgs', 'dvdsub', 'vobsub', 'dvbsub'].some((c) => codec.includes(c));
}

/**
 * Laedt die Quelle — und fragt dafuer zuerst den Server, WIE.
 *
 * Frueher entschied der Client selbst und schickte alles als
 * Direktstream los. Das scheiterte still bei MKV, HEVC, AC-3 und
 * DTS, weil Chromium die nicht kann. Jetzt bekommt Jellyfin ein
 * ehrliches Geraeteprofil und waehlt selbst zwischen unveraendert
 * ausliefern, umpacken und umrechnen.
 */
async function loadVideoSource(startAt = 0) {
  const item = vpCurrent.item;
  if (!item) return;

  const token = ++vpLoadToken;

  // Vorherige Session abmelden, sonst haeufen sich Transcodes an
  stopReporting('video');
  await stopTranscoding(vpCurrent.playSessionId);
  vpCurrent.playSessionId = null;

  vp.loading.classList.remove('hidden');
  vp.error.classList.add('hidden');

  const selectedSub = vpCurrent.subtitleStreams.find((s) => s.Index === vpCurrent.subtitleIndex);
  const burnIn = selectedSub && !isTextSubtitle(selectedSub);

  let plan = null;
  try {
    const info = await fetchPlaybackInfo(item, {
      audioIndex: vpCurrent.audioIndex,
      // Nur Bild-Untertitel muss der Server einbrennen; Text holen
      // wir als eigene Spur, das spart ihm die Rechenarbeit.
      subtitleIndex: burnIn ? vpCurrent.subtitleIndex : null,
      maxBitrate: vpCurrent.maxBitrate,
      startPositionTicks: Math.round(startAt * TICKS_PER_SECOND),
      mediaSourceId: vpCurrent.mediaSourceId
    });

    plan = resolveStream(info, item, {
      audioIndex: vpCurrent.audioIndex,
      maxBitrate: vpCurrent.maxBitrate
    });
  } catch (error) {
    console.warn('PlaybackInfo failed:', error.message);
  }

  // Zwischenzeitlich etwas anderes gestartet? Dann diesen Lauf verwerfen.
  if (token !== vpLoadToken) return;

  if (!plan) {
    vp.loading.classList.add('hidden');
    showPlayerError(t('player.failed'));
    return;
  }

  vpCurrent.transcoding = plan.method === 'Transcode';
  vpCurrent.playMethod = plan.method;
  vpCurrent.playSessionId = plan.playSessionId;
  vpCurrent.mediaSourceId = plan.source?.Id || vpCurrent.mediaSourceId;
  vpCurrent.transcodeReason = transcodeReason(plan.source);

  updatePlaybackBadge();

  vp.video.src = plan.url;

  startReporting('video', item, {
    mediaSourceId: vpCurrent.mediaSourceId,
    isTranscoding: vpCurrent.transcoding,
    playSessionId: plan.playSessionId
  });

  // Textspur selbst anhaengen — nur Bildspuren brennt der Server ein
  applyTextSubtitle(selectedSub && isTextSubtitle(selectedSub) ? selectedSub : null);

  /* Beim Umrechnen beginnt der Stream bereits an der gewuenschten
     Stelle — ein zusaetzlicher Sprung wuerde doppelt springen. */
  if (startAt > 0 && !plan.seekHandledByServer) {
    vp.video.addEventListener('loadedmetadata', function seekOnce() {
      vp.video.removeEventListener('loadedmetadata', seekOnce);
      vp.video.currentTime = startAt;
    });
  }

  if (plan.seekHandledByServer) vpCurrent.serverSeekOffset = startAt;
  else vpCurrent.serverSeekOffset = 0;

  vp.video.play().catch((error) => console.warn('Autoplay blockiert:', error));
}

/* Zeigt an, wie gerade abgespielt wird — hilft beim Einschaetzen,
   warum der Server ausgelastet ist. */
function updatePlaybackBadge() {
  if (!vp.playMethod) return;

  const labels = {
    DirectPlay: t('player.directPlay'),
    DirectStream: t('player.directStream'),
    Transcode: t('player.transcoding')
  };

  vp.playMethod.textContent = labels[vpCurrent.playMethod] || '';
  vp.playMethod.className = `vp-method ${vpCurrent.transcoding ? 'transcoding' : 'direct'}`;
  vp.playMethod.title = vpCurrent.transcodeReason
    ? t('player.transcodeReason', { reason: vpCurrent.transcodeReason })
    : '';
}

function showPlayerError(message) {
  vp.error.textContent = message;
  vp.error.classList.remove('hidden');
}

function applyTextSubtitle(stream) {
  // Alte Spuren entfernen
  vp.video.querySelectorAll('track').forEach((track) => track.remove());
  Array.from(vp.video.textTracks).forEach((track) => { track.mode = 'disabled'; });

  if (!stream) return;

  const url =
    `${state.serverUrl}/Videos/${vpCurrent.item.Id}/${vpCurrent.mediaSourceId}` +
    `/Subtitles/${stream.Index}/Stream.vtt?api_key=${encodeURIComponent(state.token)}`;

  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = subtitleLabel(stream);
  track.srclang = (stream.Language || 'und').slice(0, 2);
  track.src = url;
  track.default = true;
  vp.video.appendChild(track);

  // Erst nach dem Laden aktivierbar
  track.addEventListener('load', () => {
    if (vp.video.textTracks.length) {
      vp.video.textTracks[vp.video.textTracks.length - 1].mode = 'showing';
    }
  });
  track.addEventListener('error', () => {
    console.warn('Untertitel konnten nicht geladen werden:', url);
  });
}

function trackLabel(stream) {
  if (stream.DisplayTitle) return stream.DisplayTitle;
  const parts = [languageName(stream.Language) || t('detail.unknown')];
  if (stream.Codec) parts.push(stream.Codec.toUpperCase());
  if (stream.ChannelLayout) parts.push(stream.ChannelLayout);
  return parts.join(' · ');
}

function subtitleLabel(stream) {
  if (stream.DisplayTitle) return stream.DisplayTitle;
  const parts = [languageName(stream.Language) || t('detail.unknown')];
  if (stream.IsForced) parts.push(t('detail.forced'));
  return parts.join(' · ');
}

function buildTrackMenus() {
  /* --- Tonspuren --- */
  const audioTracks = vpCurrent.audioStreams;
  vp.audio.classList.toggle('hidden', audioTracks.length < 2);
  vp.audioMenu.innerHTML = `<div class="menu-head">${escapeHtml(t('player.audioTrack'))}</div>`;

  audioTracks.forEach((stream) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = stream.Index === vpCurrent.audioIndex ? 'active' : '';
    btn.innerHTML = `${CHECK_SVG}<span class="label">${escapeHtml(trackLabel(stream))}</span>${
      stream.IsDefault ? `<span class="tag">${escapeHtml(t('detail.default'))}</span>` : ''
    }`;
    btn.addEventListener('click', () => {
      if (stream.Index === vpCurrent.audioIndex) return vp.audioMenu.classList.add('hidden');
      vpCurrent.audioIndex = stream.Index;
      vp.audioMenu.classList.add('hidden');
      buildTrackMenus();
      loadVideoSource(mediaPosition());
    });
    vp.audioMenu.appendChild(btn);
  });

  /* --- Untertitel --- */
  const subTracks = vpCurrent.subtitleStreams;
  vp.subs.classList.toggle('hidden', subTracks.length === 0);
  vp.subsMenu.innerHTML = `<div class="menu-head">${escapeHtml(t('player.subtitleTrack'))}</div>`;

  const offBtn = document.createElement('button');
  offBtn.type = 'button';
  offBtn.className = vpCurrent.subtitleIndex == null ? 'active' : '';
  offBtn.innerHTML = `${CHECK_SVG}<span class="label">${escapeHtml(t('player.subtitlesOff'))}</span>`;
  offBtn.addEventListener('click', () => {
    vp.subsMenu.classList.add('hidden');
    if (vpCurrent.subtitleIndex == null) return;
    const wasTranscoding = vpCurrent.transcoding;
    vpCurrent.subtitleIndex = null;
    buildTrackMenus();
    // Nur neu laden, wenn eingebrannt war — sonst reicht das Abschalten der Spur
    if (wasTranscoding) loadVideoSource(mediaPosition());
    else applyTextSubtitle(null);
  });
  vp.subsMenu.appendChild(offBtn);

  subTracks.forEach((stream) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = stream.Index === vpCurrent.subtitleIndex ? 'active' : '';
    const burned = !isTextSubtitle(stream);
    btn.innerHTML = `${CHECK_SVG}<span class="label">${escapeHtml(subtitleLabel(stream))}</span>${
      burned ? `<span class="tag">${escapeHtml(t('player.imageSubtitle'))}</span>` : ''
    }`;
    btn.addEventListener('click', () => {
      vp.subsMenu.classList.add('hidden');
      if (stream.Index === vpCurrent.subtitleIndex) return;
      const wasTranscoding = vpCurrent.transcoding;
      vpCurrent.subtitleIndex = stream.Index;
      buildTrackMenus();
      // Bild-Untertitel und der Weg zurück brauchen einen neuen Stream
      if (burned || wasTranscoding) loadVideoSource(mediaPosition());
      else applyTextSubtitle(stream);
    });
    vp.subsMenu.appendChild(btn);
  });
}

/* X1: Qualitätsmenü */
function buildQualityMenu() {
  vp.qualityMenu.innerHTML = `<div class="menu-head">${escapeHtml(t('player.quality'))}</div>`;

  QUALITIES.forEach((quality) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = quality.bitrate === vpCurrent.maxBitrate ? 'active' : '';
    btn.innerHTML = `${CHECK_SVG}<span class="label">${quality.label}</span>`;
    btn.addEventListener('click', () => {
      vp.qualityMenu.classList.add('hidden');
      if (quality.bitrate === vpCurrent.maxBitrate) return;
      vpCurrent.maxBitrate = quality.bitrate;
      vp.quality.textContent = quality.bitrate ? quality.label.split(' · ')[0] : t('player.qualityAuto');
      buildQualityMenu();
      loadVideoSource(mediaPosition());
    });
    vp.qualityMenu.appendChild(btn);
  });
}

/* X2: Kapitelmenü und Marken in der Leiste */
function buildChapterUi() {
  const chapters = vpCurrent.chapters;
  vp.chapters.classList.toggle('hidden', chapters.length < 2);
  vp.chapterMarks.innerHTML = '';
  vp.chaptersMenu.innerHTML = `<div class="menu-head">${escapeHtml(t('player.chapters'))}</div>`;

  if (chapters.length < 2) return;

  chapters.forEach((chapter, index) => {
    const start = ticksToSeconds(chapter.StartPositionTicks);
    const name = chapter.Name || t('player.chapter', { number: index + 1 });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `${CHECK_SVG}<span class="label">${escapeHtml(name)}</span><span class="tag">${formatTime(start)}</span>`;
    btn.addEventListener('click', () => {
      seekTo(start);
      vp.chaptersMenu.classList.add('hidden');
    });
    vp.chaptersMenu.appendChild(btn);
  });

  // Marken erst zeichnen, wenn die Länge bekannt ist
  const drawMarks = () => {
    const total = mediaDuration();
    if (!total) return;
    vp.chapterMarks.innerHTML = chapters
      .filter((c) => ticksToSeconds(c.StartPositionTicks) > 0)
      .map((c) => {
        const pct = (ticksToSeconds(c.StartPositionTicks) / total) * 100;
        return `<span class="chapter-mark" style="left:${pct}%"></span>`;
      }).join('');
  };
  if (mediaDuration()) drawMarks();
  else vp.video.addEventListener('loadedmetadata', drawMarks, { once: true });
}

function currentChapterIndex() {
  const now = mediaPosition();
  let index = -1;
  vpCurrent.chapters.forEach((chapter, i) => {
    if (ticksToSeconds(chapter.StartPositionTicks) <= now + 0.4) index = i;
  });
  return index;
}

function jumpChapter(direction) {
  const chapters = vpCurrent.chapters;
  if (chapters.length < 2) return;
  const target = currentChapterIndex() + direction;
  if (target < 0 || target >= chapters.length) return;
  seekTo(ticksToSeconds(chapters[target].StartPositionTicks));
}

// Name bewusst spezifisch: "toggleMenu" gehört bereits settings.js
function togglePlayerMenu(menu) {
  [vp.audioMenu, vp.subsMenu, vp.speedMenu, vp.qualityMenu, vp.chaptersMenu].forEach((m) => {
    if (m !== menu) m.classList.add('hidden');
  });
  menu.classList.toggle('hidden');
}

vp.audio.addEventListener('click', (event) => { event.stopPropagation(); togglePlayerMenu(vp.audioMenu); });
vp.subs.addEventListener('click', (event) => { event.stopPropagation(); togglePlayerMenu(vp.subsMenu); });
vp.quality.addEventListener('click', (event) => { event.stopPropagation(); togglePlayerMenu(vp.qualityMenu); });
vp.chapters.addEventListener('click', (event) => { event.stopPropagation(); togglePlayerMenu(vp.chaptersMenu); });

function closeVideo() {
  stopReporting('video');

  // Laufenden Transcode beim Server abbestellen, sonst rechnet er weiter
  if (vpCurrent.playSessionId) {
    stopTranscoding(vpCurrent.playSessionId);
    vpCurrent.playSessionId = null;
  }
  vpCurrent.serverSeekOffset = 0;
  vpCurrent.playMethod = null;
  vpLoadToken += 1; // laufende Aushandlung verwerfen
  vp.error.classList.add('hidden');

  vp.video.pause();
  vp.video.querySelectorAll('track').forEach((track) => track.remove());
  vp.video.removeAttribute('src');
  vp.video.load();
  vp.root.classList.add('hidden');
  vp.speedMenu.classList.add('hidden');
  vp.audioMenu.classList.add('hidden');
  vp.subsMenu.classList.add('hidden');

  // Nach einer Offline-Wiedergabe die ausgeblendeten Knoepfe zurueckholen
  if (vpCurrent.local) {
    [vp.audio, vp.subs, vp.quality].forEach((btn) => btn?.classList.remove('hidden'));
    vpCurrent.local = false;
  }

  vpCurrent.item = null;
  clearTimeout(vpIdleTimer);

  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
}

function resetIdleTimer() {
  vp.ui.classList.remove('idle');
  vp.root.classList.remove('cursor-hidden');
  clearTimeout(vpIdleTimer);

  vpIdleTimer = setTimeout(() => {
    if (!vp.video.paused) {
      vp.ui.classList.add('idle');
      vp.root.classList.add('cursor-hidden');
      vp.speedMenu.classList.add('hidden');
      vp.audioMenu.classList.add('hidden');
      vp.subsMenu.classList.add('hidden');
    }
  }, 2800);
}

vp.root.addEventListener('mousemove', resetIdleTimer);

vp.video.addEventListener('click', togglePlayVideo);
vp.play.addEventListener('click', togglePlayVideo);
vp.centerPlay.addEventListener('click', togglePlayVideo);

function togglePlayVideo() {
  if (vp.video.paused) vp.video.play();
  else vp.video.pause();
}

vp.video.addEventListener('play', () => {
  toggleIcons(vp.play, true);
  vp.centerPlay.classList.remove('show');
  resetIdleTimer();
});

vp.video.addEventListener('pause', () => {
  toggleIcons(vp.play, false);
  vp.centerPlay.classList.add('show');
  vp.ui.classList.remove('idle');
  vp.root.classList.remove('cursor-hidden');
});

vp.video.addEventListener('waiting', () => vp.loading.classList.remove('hidden'));
vp.video.addEventListener('playing', () => vp.loading.classList.add('hidden'));
vp.video.addEventListener('canplay', () => vp.loading.classList.add('hidden'));

vp.video.addEventListener('loadedmetadata', () => {
  vp.duration.textContent = formatTime(mediaDuration());
});

vp.video.addEventListener('timeupdate', () => {
  if (vpScrubbing) return;
  const position = mediaPosition();
  const total = mediaDuration();
  vp.current.textContent = formatTime(position);
  if (total) vp.progress.style.width = `${(position / total) * 100}%`;
});

vp.video.addEventListener('progress', () => {
  const { buffered } = vp.video;
  const total = mediaDuration();
  if (buffered.length && total) {
    // Puffer liegt hinter dem Versatz — sonst zeigt der Balken bei 0 an
    const end = buffered.end(buffered.length - 1) + (vpCurrent.serverSeekOffset || 0);
    vp.buffered.style.width = `${Math.min(100, (end / total) * 100)}%`;
  }
});

/* U8: Nächste Folge mit Countdown statt hartem Sprung */
let nextupTimer = null;

function cancelNextUp() {
  clearInterval(nextupTimer);
  nextupTimer = null;
  vp.nextup.classList.add('hidden');
}

function offerNextUp(nextItem) {
  vp.nextupTitle.textContent =
    nextItem.IndexNumber != null
      ? `F${nextItem.IndexNumber} · ${nextItem.Name || ''}`
      : nextItem.Name || '';

  let remaining = prefs.nextupSeconds || 10;
  vp.nextupCount.textContent = remaining;
  vp.nextup.classList.remove('hidden');

  clearInterval(nextupTimer);
  nextupTimer = setInterval(() => {
    remaining -= 1;
    vp.nextupCount.textContent = Math.max(remaining, 0);
    if (remaining <= 0) {
      cancelNextUp();
      playVideo(nextItem, vpQueue);
    }
  }, 1000);
}

vp.nextupPlay.addEventListener('click', () => {
  const nextItem = vpQueue[vpIndex + 1];
  cancelNextUp();
  if (nextItem) playVideo(nextItem, vpQueue);
});

vp.nextupCancel.addEventListener('click', () => {
  cancelNextUp();
  closeVideo();
});

vp.video.addEventListener('ended', () => {
  stopReporting('video', mediaDuration() || null);

  // Auf Wunsch den Download nach dem Ansehen wegräumen
  if (prefs.dlDeleteWatched && vpCurrent.item && typeof offlineEntry === 'function') {
    const entry = offlineEntry(vpCurrent.item.Id);
    if (entry) {
      window.downloads?.remove(entry.id)
        .then(() => refreshOffline())
        .catch(() => {});
    }
  }

  const nextItem = vpQueue[vpIndex + 1];
  if (prefs.autoplayNext && prefs.showNextup !== false && vpIndex >= 0 && nextItem) {
    offerNextUp(nextItem);
  } else if (prefs.autoplayNext && vpIndex >= 0 && nextItem) {
    // Einblendung abgeschaltet — direkt weiterspielen
    playVideo(nextItem, vpQueue);
  } else {
    closeVideo();
  }
});

/* Scheitert die Wiedergabe trotz Aushandlung, liegt es meist daran,
   dass der Server die Datei fuer direkt abspielbar hielt. Dann einmal
   Umrechnen erzwingen, statt den Nutzer vor einem schwarzen Bild
   sitzen zu lassen. */
let vpFallbackTried = false;

vp.video.addEventListener('error', async () => {
  vp.loading.classList.add('hidden');

  if (!vpCurrent.item || vpCurrent.local) {
    return showPlayerError(t('player.failed'));
  }

  if (!vpFallbackTried && !vpCurrent.transcoding) {
    vpFallbackTried = true;
    console.warn('Direktwiedergabe fehlgeschlagen — erzwinge Umrechnung');
    showPlayerError(t('player.retrying'));

    // Bitrate begrenzen erzwingt beim Server den Transcoding-Weg
    const previous = vpCurrent.maxBitrate;
    vpCurrent.maxBitrate = previous || 20000000;
    await loadVideoSource(mediaPosition());
    vpCurrent.maxBitrate = previous;
    return;
  }

  showPlayerError(t('player.failed'));
});

// Bei jedem neuen Titel den Rueckfall wieder erlauben
vp.video.addEventListener('loadstart', () => { vpFallbackTried = false; });

const seekStep = () => prefs.seekStep || 10;

vp.back10.addEventListener('click', () => seekTo(mediaPosition() - seekStep()));
vp.fwd10.addEventListener('click', () => seekTo(mediaPosition() + seekStep()));
vp.close.addEventListener('click', closeVideo);

/* --- Scrubbing --- */

function seekFromEvent(event) {
  const rect = vp.scrub.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  const total = mediaDuration();
  if (total) {
    seekTo(ratio * total);
    vp.progress.style.width = `${ratio * 100}%`;
  }
}

vp.scrub.addEventListener('mousedown', (event) => {
  vpScrubbing = true;
  seekFromEvent(event);
});

vp.scrub.addEventListener('mousemove', (event) => {
  const rect = vp.scrub.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  vp.hoverTime.textContent = formatTime(ratio * (mediaDuration() || 0));
  vp.hoverTime.style.left = `${ratio * 100}%`;
  if (vpScrubbing) seekFromEvent(event);
});

window.addEventListener('mouseup', () => { vpScrubbing = false; });

/* --- Lautstärke --- */

/* U2: Lautstärke und Stummschaltung überdauern den Neustart */
function saveVolume(volume, muted) {
  try {
    localStorage.setItem('jf-volume', JSON.stringify({ volume, muted }));
  } catch (error) {
    /* ignorieren */
  }
}

function loadVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem('jf-volume') || 'null');

    // Noch nie etwas gespeichert? Dann gilt die Startlautstärke aus den Einstellungen.
    if (!saved) {
      const start = Math.min(Math.max(Number(prefs.startVolume), 0), 1);
      if (Number.isFinite(start)) {
        vp.video.volume = start;
        mp.audio.volume = start;
        vp.volume.value = start;
        mp.volume.value = start;
        updateMuteIcon();
      }
      return;
    }

    const volume = Math.min(Math.max(Number(saved.volume), 0), 1);
    if (Number.isFinite(volume)) {
      vp.video.volume = volume;
      mp.audio.volume = volume;
      vp.volume.value = volume;
      mp.volume.value = volume;
    }
    vp.video.muted = Boolean(saved.muted);
    updateMuteIcon();
  } catch (error) {
    /* Standardlautstärke behalten */
  }
}

vp.volume.addEventListener('input', () => {
  vp.video.volume = Number(vp.volume.value);
  vp.video.muted = vp.video.volume === 0;
  updateMuteIcon();
  saveVolume(vp.video.volume, vp.video.muted);
});

vp.mute.addEventListener('click', () => {
  vp.video.muted = !vp.video.muted;
  updateMuteIcon();
  saveVolume(vp.video.volume, vp.video.muted);
});

function updateMuteIcon() {
  const muted = vp.video.muted || vp.video.volume === 0;
  vp.mute.querySelector('.ic-vol').classList.toggle('hidden', muted);
  vp.mute.querySelector('.ic-muted').classList.toggle('hidden', !muted);
}

/* --- Geschwindigkeit --- */

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

SPEEDS.forEach((speed) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = `${speed}x`;
  btn.className = speed === 1 ? 'active' : '';
  btn.addEventListener('click', () => {
    vp.video.playbackRate = speed;
    vp.speed.textContent = `${speed}x`;
    vp.speedMenu.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    vp.speedMenu.classList.add('hidden');
  });
  vp.speedMenu.appendChild(btn);
});

vp.speed.addEventListener('click', (event) => {
  event.stopPropagation();
  vp.speedMenu.classList.toggle('hidden');
});

document.addEventListener('click', (event) => {
  if (event.target.closest('.vp-menu-wrap')) return;
  vp.speedMenu.classList.add('hidden');
  vp.audioMenu.classList.add('hidden');
  vp.subsMenu.classList.add('hidden');
});

/* --- PiP / Vollbild --- */

vp.pip.addEventListener('click', async () => {
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await vp.video.requestPictureInPicture();
  } catch (error) {
    console.warn('PiP nicht verfügbar:', error);
  }
});

vp.fullscreen.addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else vp.root.requestFullscreen().catch((error) => console.warn('Vollbild fehlgeschlagen:', error));
}

document.addEventListener('fullscreenchange', () => {
  const isFull = Boolean(document.fullscreenElement);
  vp.fullscreen.querySelector('.ic-fs').classList.toggle('hidden', isFull);
  vp.fullscreen.querySelector('.ic-fs-exit').classList.toggle('hidden', !isFull);
});

/* --- Tastatur --- */

document.addEventListener('keydown', (event) => {
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  const videoOpen = !vp.root.classList.contains('hidden');
  const musicOpen = !$('music-full').classList.contains('hidden');

  if (videoOpen) {
    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        togglePlayVideo();
        break;
      case 'ArrowLeft':  seekTo(mediaPosition() - seekStep()); break;
      case 'ArrowRight': seekTo(mediaPosition() + seekStep()); break;
      case 'ArrowUp':
        event.preventDefault();
        vp.video.volume = Math.min(vp.video.volume + 0.1, 1);
        vp.volume.value = vp.video.volume;
        updateMuteIcon();
        break;
      case 'ArrowDown':
        event.preventDefault();
        vp.video.volume = Math.max(vp.video.volume - 0.1, 0);
        vp.volume.value = vp.video.volume;
        updateMuteIcon();
        break;
      case 'j': seekTo(mediaPosition() - 10); break;
      case 'l': seekTo(mediaPosition() + 10); break;
      case 'f': toggleFullscreen(); break;
      case 'm':
        vp.video.muted = !vp.video.muted;
        updateMuteIcon();
        saveVolume(vp.video.volume, vp.video.muted);
        break;
      case 'c': {
        // Untertitel schnell an/aus
        const buttons = vp.subsMenu.querySelectorAll('button');
        if (buttons.length < 2) break;
        if (vpCurrent.subtitleIndex == null) buttons[1].click();
        else buttons[0].click();
        break;
      }
      case 'n':
        if (vpQueue[vpIndex + 1]) playVideo(vpQueue[vpIndex + 1], vpQueue);
        break;
      case 'p': jumpChapter(-1); break;
      case 'Escape':
        if (!document.fullscreenElement) closeVideo();
        break;
      default: break;
    }

    if (event.key === 'PageDown') jumpChapter(1);
    if (event.key === 'PageUp') jumpChapter(-1);
    return;
  }

  if (musicOpen && event.key === 'Escape') {
    music.collapse();
    return;
  }

  // Musik per Strg + Pfeil wechseln
  if (music.current && event.ctrlKey) {
    if (event.key === 'ArrowRight') { event.preventDefault(); music.next(); return; }
    if (event.key === 'ArrowLeft')  { event.preventDefault(); music.prev(); return; }
  }

  if (event.key === ' ' && music.current) {
    event.preventDefault();
    music.toggle();
  }

  // U7: Kürzel-Übersicht
  if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
    event.preventDefault();
    $('shortcuts-modal').classList.remove('hidden');
    return;
  }

  // Schnell zur Suche
  if (event.key === '/' && !event.shiftKey) {
    event.preventDefault();
    el.searchBox.classList.remove('collapsed');
    el.searchInput.focus();
    return;
  }

  // Zurück wie im Browser
  if (event.altKey && event.key === 'ArrowLeft') {
    event.preventDefault();
    el.backBtn.click();
  }
});

$('shortcuts-close').addEventListener('click', () => $('shortcuts-modal').classList.add('hidden'));

/* =========================== MUSIC PLAYER =========================== */

const mp = {
  audio: $('audio-el'),
  mini: $('mini-player'),
  miniArt: $('mini-art'),
  miniTitle: $('mini-title'),
  miniArtist: $('mini-artist'),
  miniPlay: $('mini-play'),
  miniPrev: $('mini-prev'),
  miniNext: $('mini-next'),
  miniTime: $('mini-time'),
  miniClose: $('mini-close'),
  miniExpand: $('mini-expand'),
  miniProgress: $('mini-progress-fill'),
  full: $('music-full'),
  backdrop: $('mf-backdrop'),
  collapse: $('mf-collapse'),
  art: $('mf-art'),
  title: $('mf-title'),
  artist: $('mf-artist'),
  scrub: $('mf-scrub'),
  fill: $('mf-fill'),
  current: $('mf-current'),
  duration: $('mf-duration'),
  play: $('mf-play'),
  prev: $('mf-prev'),
  next: $('mf-next'),
  shuffle: $('mf-shuffle'),
  repeat: $('mf-repeat'),
  volume: $('mf-volume'),
  lyrics: $('mf-lyrics'),
  queue: $('mf-queue')
};

const music = {
  queue: [],
  index: -1,
  current: null,
  shuffle: false,
  repeat: 'off', // off | all | one
  lyricLines: [],
  activeLyric: -1,

  play(tracks, index) {
    this.queue = tracks;
    this.index = index;
    this.current = tracks[index];
    if (!this.current) return;

    // Video anhalten, damit nicht beides gleichzeitig läuft
    if (!vp.root.classList.contains('hidden')) closeVideo();

    // Vorherigen Titel beim Server abmelden, sonst sammeln sich Sessions an
    stopReporting('audio');

    const url = `${state.serverUrl}/Audio/${this.current.Id}/stream?static=true&api_key=${encodeURIComponent(state.token)}`;
    mp.audio.src = url;
    mp.audio.play().catch((error) => console.warn('Autoplay blockiert:', error));

    startReporting('audio', this.current);

    this.renderMeta();
    this.renderQueue();
    this.loadLyrics(this.current.Id);
    mp.mini.classList.remove('hidden');
  },

  renderMeta() {
    const item = this.current;
    if (!item) return;

    const art = imageUrl(item, 'Primary', 640);
    const artist = item.Artists?.join(', ') || item.AlbumArtist || '';

    mp.miniTitle.textContent = item.Name || '';
    mp.miniArtist.textContent = artist;
    mp.title.textContent = item.Name || '';
    mp.artist.textContent = artist;

    if (art) {
      mp.miniArt.src = art;
      mp.art.src = art;
      mp.backdrop.style.backgroundImage = `url('${art}')`;
    } else {
      mp.miniArt.removeAttribute('src');
      mp.art.removeAttribute('src');
      mp.backdrop.style.backgroundImage = '';
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: item.Name || '',
        artist,
        album: item.Album || '',
        artwork: art ? [{ src: art, sizes: '512x512', type: 'image/jpeg' }] : []
      });
    }
  },

  /* X3: Warteschlange umsortieren, einreihen und entfernen */
  renderQueue() {
    mp.queue.innerHTML = '';

    this.queue.forEach((track, index) => {
      const row = document.createElement('div');
      row.className = `queue-item ${index === this.index ? 'active' : ''}`;
      row.draggable = true;
      row.dataset.index = index;

      const art = imageUrl(track, 'Primary', 120);
      row.innerHTML = `
        <span class="queue-grip" title="Verschieben" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
        </span>
        <span class="queue-num">${index + 1}</span>
        ${art ? `<img class="queue-art" src="${art}" alt="Cover: ${escapeHtml(track.Name || '')}" loading="lazy">` : '<div class="queue-art"></div>'}
        <div class="queue-body">
          <div class="queue-title">${escapeHtml(track.Name || '')}</div>
          <div class="queue-artist">${escapeHtml(track.Artists?.join(', ') || track.AlbumArtist || '')}</div>
        </div>
        <span class="queue-dur">${formatTime(ticksToSeconds(track.RunTimeTicks))}</span>
        <button class="queue-remove" type="button" title="${escapeHtml(t('queue.removeFromQueue'))}" aria-label="${escapeHtml(t('common.remove'))}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>`;

      row.addEventListener('click', (event) => {
        if (event.target.closest('.queue-remove')) return;
        this.play(this.queue, index);
      });

      row.querySelector('.queue-remove').addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeAt(index);
      });

      row.addEventListener('dragstart', (event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('drop-target');
        const from = Number(event.dataTransfer.getData('text/plain'));
        const to = Number(row.dataset.index);
        if (Number.isInteger(from) && Number.isInteger(to) && from !== to) this.move(from, to);
      });

      mp.queue.appendChild(row);
    });
  },

  // Verschieben, ohne den laufenden Titel zu verlieren
  move(from, to) {
    const current = this.queue[this.index];
    const [moved] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, moved);
    this.index = this.queue.indexOf(current);
    this.renderQueue();
    this.saveSession();
  },

  removeAt(index) {
    if (index === this.index) return toast(t('queue.cannotRemoveCurrent'), true);
    const current = this.queue[this.index];
    this.queue.splice(index, 1);
    this.index = this.queue.indexOf(current);
    this.renderQueue();
    this.saveSession();
  },

  // "Als Nächstes spielen"
  playNext(track) {
    if (!this.queue.length) return this.play([track], 0);
    this.queue.splice(this.index + 1, 0, track);
    this.renderQueue();
    this.saveSession();
    toast(t('queue.playsNext', { name: track.Name }));
  },

  addToQueue(track) {
    if (!this.queue.length) return this.play([track], 0);
    this.queue.push(track);
    this.renderQueue();
    this.saveSession();
    toast(t('queue.added', { name: track.Name }));
  },

  /* X7: Warteschlange und Position überstehen einen Neustart */
  saveSession() {
    try {
      if (!this.current) return localStorage.removeItem('jf-queue');
      localStorage.setItem('jf-queue', JSON.stringify({
        queue: this.queue.slice(0, 200),
        index: this.index,
        position: mp.audio.currentTime || 0,
        shuffle: this.shuffle,
        repeat: this.repeat
      }));
    } catch (error) {
      /* ignorieren */
    }
  },

  restoreSession() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('jf-queue') || 'null');
    } catch (error) {
      return;
    }
    if (!saved?.queue?.length || !saved.queue[saved.index]) return;

    this.queue = saved.queue;
    this.index = saved.index;
    this.current = saved.queue[saved.index];
    this.shuffle = Boolean(saved.shuffle);
    this.repeat = saved.repeat || 'off';

    const url = `${state.serverUrl}/Audio/${this.current.Id}/stream?static=true&api_key=${encodeURIComponent(state.token)}`;
    mp.audio.src = url;
    // Nicht automatisch abspielen — nur bereitstellen
    mp.audio.addEventListener('loadedmetadata', function seekOnce() {
      mp.audio.removeEventListener('loadedmetadata', seekOnce);
      if (saved.position > 0) mp.audio.currentTime = saved.position;
    });

    this.renderMeta();
    this.renderQueue();
    this.loadLyrics(this.current.Id);
    mp.shuffleBtnSync?.();
    mp.mini.classList.remove('hidden');
  },

  /* ---------------------- LYRICS ---------------------- */

  async loadLyrics(itemId) {
    this.lyricLines = [];
    this.activeLyric = -1;
    mp.lyrics.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

    let data = null;
    try {
      data = await api(`/Audio/${itemId}/Lyrics`);
    } catch (error) {
      // 404 = keine Lyrics hinterlegt; alles andere ebenfalls unkritisch
      data = null;
    }

    // Nur anzeigen, wenn inzwischen kein anderer Titel gestartet wurde
    if (!this.current || this.current.Id !== itemId) return;

    const lines = data?.Lyrics || [];
    if (!lines.length) {
      mp.lyrics.innerHTML = `
        <div class="lyrics-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="7" cy="17.5" r="2.8"/><circle cx="18" cy="15.5" r="2.5"/>
            <path d="M9.8 17.5V7.2l10.7-2.4v10.7" stroke-linejoin="round"/>
          </svg>
          <p>${escapeHtml(t('music.noLyricsAvailable'))}</p>
        </div>`;
      return;
    }

    // Start ist long? in Ticks — bei unsynchronisierten Lyrics null.
    const isSynced = lines.some((line) => typeof line.Start === 'number');

    mp.lyrics.className = `mf-lyrics ${isSynced ? '' : 'lyrics-plain'}`;
    mp.lyrics.innerHTML = '';

    this.lyricLines = lines.map((line, index) => {
      const div = document.createElement('div');
      div.className = `lyric-line ${isSynced ? 'synced' : ''}`;
      div.textContent = line.Text || '♪';

      const startSeconds = typeof line.Start === 'number' ? ticksToSeconds(line.Start) : null;

      if (isSynced && startSeconds != null) {
        div.addEventListener('click', () => { mp.audio.currentTime = startSeconds; });
      }

      mp.lyrics.appendChild(div);
      return { el: div, start: startSeconds, index };
    });
  },

  syncLyrics(currentTime) {
    if (!this.lyricLines.length) return;

    // X6: Zeitversatz berücksichtigen
    const shifted = currentTime + (prefs.lyricsOffset || 0);

    let active = -1;
    for (let i = 0; i < this.lyricLines.length; i += 1) {
      const { start } = this.lyricLines[i];
      if (start != null && start <= shifted + 0.15) active = i;
      else if (start != null) break;
    }

    if (active === this.activeLyric) return;
    this.activeLyric = active;

    this.lyricLines.forEach((line, index) => {
      line.el.classList.toggle('active', index === active);
      line.el.classList.toggle('passed', index < active);
    });

    // X6: Scrollt der Nutzer selbst, nicht dazwischenfunken
    const activeEl = this.lyricLines[active]?.el;
    if (activeEl && !mp.full.classList.contains('hidden') && !this.userScrolling) {
      const container = mp.lyrics;
      const target = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      container.scrollTo({ top: Math.max(target, 0), behavior: 'smooth' });
    }
  },

  userScrolling: false,
  scrollIdleTimer: null,

  /* ---------------------- STEUERUNG ---------------------- */

  toggle() {
    if (mp.audio.paused) mp.audio.play();
    else mp.audio.pause();
  },

  pause() {
    if (!mp.audio.paused) mp.audio.pause();
  },

  next(auto = false) {
    if (!this.queue.length) return;

    if (this.repeat === 'one' && auto) {
      mp.audio.currentTime = 0;
      mp.audio.play();
      return;
    }

    let nextIndex;
    if (this.shuffle) {
      nextIndex = Math.floor(Math.random() * this.queue.length);
    } else {
      nextIndex = this.index + 1;
      if (nextIndex >= this.queue.length) {
        if (this.repeat === 'all') nextIndex = 0;
        else return;
      }
    }

    this.play(this.queue, nextIndex);
  },

  prev() {
    if (!this.queue.length) return;

    // Wie bei Spotify/Apple Music: erst zurückspulen, dann Titel wechseln
    if (mp.audio.currentTime > 3) {
      mp.audio.currentTime = 0;
      return;
    }

    const prevIndex = this.index - 1;
    this.play(this.queue, prevIndex < 0 ? this.queue.length - 1 : prevIndex);
  },

  expand() {
    mp.full.classList.remove('hidden');
    // Nach dem Einblenden zur aktiven Zeile springen
    requestAnimationFrame(() => {
      const activeEl = this.lyricLines[this.activeLyric]?.el;
      if (activeEl) {
        mp.lyrics.scrollTop = Math.max(
          activeEl.offsetTop - mp.lyrics.clientHeight / 2 + activeEl.clientHeight / 2,
          0
        );
      }
    });
  },

  collapse() {
    mp.full.classList.add('hidden');
  },

  stop() {
    stopReporting('audio');
    mp.audio.pause();
    mp.audio.removeAttribute('src');
    mp.audio.load();
    this.queue = [];
    this.index = -1;
    this.current = null;
    this.lyricLines = [];
    mp.mini.classList.add('hidden');
    mp.full.classList.add('hidden');
  }
};

/* --- Audio-Events --- */

mp.audio.addEventListener('play', () => {
  toggleIcons(mp.miniPlay, true);
  toggleIcons(mp.play, true);
  mp.full.classList.add('playing');
  mp.full.classList.remove('paused');
});

mp.audio.addEventListener('pause', () => {
  toggleIcons(mp.miniPlay, false);
  toggleIcons(mp.play, false);
  mp.full.classList.remove('playing');
  mp.full.classList.add('paused');
});

mp.audio.addEventListener('loadedmetadata', () => {
  mp.duration.textContent = formatTime(mp.audio.duration);
});

mp.audio.addEventListener('timeupdate', () => {
  const { currentTime, duration } = mp.audio;
  const ratio = duration ? (currentTime / duration) * 100 : 0;

  mp.miniProgress.style.width = `${ratio}%`;
  mp.fill.style.width = `${ratio}%`;
  mp.miniTime.textContent = formatTime(currentTime);
  mp.current.textContent = formatTime(currentTime);

  music.syncLyrics(currentTime);
});

mp.audio.addEventListener('ended', () => music.next(true));

/* X6: Eigenes Scrollen im Songtext hält die Automatik kurz an */
mp.lyrics.addEventListener('wheel', () => {
  music.userScrolling = true;
  clearTimeout(music.scrollIdleTimer);
  music.scrollIdleTimer = setTimeout(() => { music.userScrolling = false; }, 4000);
}, { passive: true });

/* X7: Stand regelmäßig sichern, damit ein Neustart dort weitermacht */
setInterval(() => {
  if (music.current && !mp.audio.paused) music.saveSession();
}, 5000);

window.addEventListener('pagehide', () => music.saveSession());

/* --- Bedienelemente --- */

mp.miniPlay.addEventListener('click', () => music.toggle());
mp.play.addEventListener('click', () => music.toggle());
mp.miniNext.addEventListener('click', () => music.next());
mp.next.addEventListener('click', () => music.next());
mp.miniPrev.addEventListener('click', () => music.prev());
mp.prev.addEventListener('click', () => music.prev());
mp.miniClose.addEventListener('click', () => music.stop());
mp.miniExpand.addEventListener('click', () => music.expand());
mp.collapse.addEventListener('click', () => music.collapse());

mp.shuffle.addEventListener('click', () => {
  music.shuffle = !music.shuffle;
  mp.shuffle.classList.toggle('active', music.shuffle);
});

mp.repeat.addEventListener('click', () => {
  music.repeat = music.repeat === 'off' ? 'all' : music.repeat === 'all' ? 'one' : 'off';
  mp.repeat.classList.toggle('active', music.repeat !== 'off');
  mp.repeat.title = music.repeat === 'one' ? t('music.repeatTrack')
    : music.repeat === 'all' ? t('music.repeatAll') : t('music.repeatOff');
});

mp.volume.addEventListener('input', () => {
  mp.audio.volume = Number(mp.volume.value);
  vp.volume.value = mp.volume.value;
  saveVolume(mp.audio.volume, false);
});

// U2 + X7: gespeicherte Lautstärke und Warteschlange beim Start übernehmen
window.addEventListener('DOMContentLoaded', () => {
  loadVolume();
});

/* --- Musik-Scrubbing --- */

let mfScrubbing = false;

function seekAudio(event) {
  const rect = mp.scrub.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  if (mp.audio.duration) {
    mp.audio.currentTime = ratio * mp.audio.duration;
    mp.fill.style.width = `${ratio * 100}%`;
  }
}

mp.scrub.addEventListener('mousedown', (event) => { mfScrubbing = true; seekAudio(event); });
mp.scrub.addEventListener('mousemove', (event) => { if (mfScrubbing) seekAudio(event); });
window.addEventListener('mouseup', () => { mfScrubbing = false; });

/* --- Tabs: Songtext / Warteschlange --- */

document.querySelectorAll('.mf-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.mf-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const showLyrics = tab.dataset.tab === 'lyrics';
    mp.lyrics.classList.toggle('hidden', !showLyrics);
    mp.queue.classList.toggle('hidden', showLyrics);
  });
});

/* --- Systemsteuerung (Medientasten) --- */

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => mp.audio.play());
  navigator.mediaSession.setActionHandler('pause', () => mp.audio.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => music.prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => music.next());
}
