/* ============================================================
   Wiedergabe-Aushandlung

   GRUNDSATZ: Die Datei geht unveraendert an den Player, solange
   nichts dagegen spricht. Genau so lief es vor 2.5.0 — zuverlaessig.

   Mein Fehler in 2.5.0 war, dem Server ein enges Profil zu schicken
   und ihn entscheiden zu lassen. Alles, was nicht exakt hineinpasste
   (etwa AC-3-Ton in einem MKV), wurde umgerechnet — und der
   Umrechnungsweg ist der unzuverlaessigere von beiden.

   Umgerechnet wird deshalb nur noch, wenn es einen konkreten Grund
   gibt: Bild-Untertitel einbrennen, eine andere Tonspur waehlen,
   Bitrate begrenzen — oder wenn die Direktwiedergabe tatsaechlich
   gescheitert ist.

   Gemessen in Electron 33 mit echten Dateien:
     ja   — MP4/WebM/MKV, H.264, VP8/VP9, AV1, AAC, MP3, FLAC, Opus
     nein — HLS, MPEG-TS (deshalb rechnet der Server nach MP4 um)

   Zur Messmethode: canPlayType() taugt fuer Codecs, nicht fuer
   Container. Fuer Matroska meldet Chromium "" und spielt es
   trotzdem. Wer sich darauf verlaesst, macht Funktionierendes kaputt.
   ============================================================ */

/* Container, die direkt geoeffnet werden — ALLE gaengigen.
   Kein Aussortieren: was der Player nicht oeffnen kann, faengt der
   Rueckfall ab. Vorsorgliches Umrechnen kostet dagegen immer. */
const CONTAINERS =
  'mp4,m4v,mkv,webm,mov,avi,ts,m2ts,mts,flv,ogv,3gp,3g2,wmv,asf,mpg,mpeg,vob,divx,xvid,f4v,mxf,rm,rmvb';

/* Videoformate, die direkt versucht werden — ALLE.

   Bewusste Entscheidung: kein Aussortieren nach Codec. Jede
   Einschränkung hier heißt, dass der Server umrechnet, und das
   kostet Zeit, Serverlast und Qualität.

   Der Preis: HEVC kann Chromium nicht dekodieren (gemessen,
   canPlayType liefert ""). Solche Dateien scheitern beim ersten
   Versuch — aber der Player fängt das ab und lädt sie sofort
   umgerechnet neu (siehe vpFallbackTried in player.js). Der Nutzer
   sieht kurz "versuche Umrechnung", dann läuft es.

   Damit ist der schnelle Weg der Normalfall und der langsame die
   Ausnahme — statt umgekehrt. */
const VIDEO_CODECS =
  'h264,hevc,h265,vp8,vp9,av1,mpeg4,mpeg2video,mpeg1video,vc1,wmv2,wmv3,theora,dvvideo,prores';

/* Tonformate — ebenfalls alle. Selbst wenn der Ton nicht ankommt,
   laeuft das Bild; und wenn beides scheitert, greift der Rueckfall. */
const AUDIO_CODECS =
  'aac,mp3,ac3,eac3,dts,dtshd,flac,alac,opus,vorbis,pcm_s16le,pcm_s24le,pcm_s32le,' +
  'mp2,mp1,truehd,wmav2,wmapro,amr_nb,amr_wb,ape,wavpack';

/**
 * Das Profil, das Jellyfin bekommt. Es beschreibt exakt die
 * gemessenen Faehigkeiten — nicht mehr, sonst kommt ein Stream
 * zurueck, der hier nicht laeuft.
 */
function buildDeviceProfile(maxBitrate = 0) {
  const profile = {
    MaxStreamingBitrate: maxBitrate || 120000000,
    MaxStaticBitrate: maxBitrate || 120000000,
    MusicStreamingTranscodingBitrate: 384000,

    DirectPlayProfiles: [
      {
        Container: CONTAINERS,
        Type: 'Video',
        VideoCodec: VIDEO_CODECS,
        AudioCodec: AUDIO_CODECS
      },
      {
        Container: 'mp3',
        Type: 'Audio'
      },
      {
        Container: 'm4a,m4b',
        AudioCodec: 'aac',
        Type: 'Audio'
      },
      {
        Container: 'flac',
        Type: 'Audio'
      },
      {
        Container: 'webm,oga,ogg',
        AudioCodec: 'opus,vorbis,flac',
        Type: 'Audio'
      },
      {
        Container: 'wav',
        AudioCodec: 'pcm_s16le,pcm_s24le',
        Type: 'Audio'
      }
    ],

    TranscodingProfiles: [
      /* Video: fragmentiertes MP4. Nicht HLS und nicht MPEG-TS —
         beides kann Chromium nachweislich nicht, auch nicht ueber
         MediaSource. Genau daran scheiterte der bisherige Weg. */
      {
        Container: 'mp4',
        Type: 'Video',
        AudioCodec: 'aac',
        VideoCodec: 'h264',
        Protocol: 'http',
        Context: 'Streaming',
        MaxAudioChannels: '2',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
        CopyTimestamps: false
      },
      /* Audio */
      {
        Container: 'mp3',
        Type: 'Audio',
        AudioCodec: 'mp3',
        Protocol: 'http',
        Context: 'Streaming',
        MaxAudioChannels: '2'
      }
    ],

    ContainerProfiles: [],

    /* Keine Bedingungen: jede Einschraenkung hier ist ein Grund, aus
       dem der Server umrechnet. Profil, Level, Kanalzahl oder
       Zeilensprung sind selten ein echtes Hindernis — scheitert die
       Wiedergabe doch, faengt der Rueckfall im Player das ab.

       Vorher standen hier Bedingungen zu VideoProfile, VideoLevel und
       AudioChannels. Sie waren der Grund, warum ganze Serien plötzlich
       umgerechnet wurden, obwohl sie zuvor direkt liefen. */
    CodecProfiles: [],

    /* Untertitel holt der Player als eigene Spur — auch ass/ssa,
       die Jellyfin nach VTT wandelt. Sie einbrennen zu lassen hiesse,
       das ganze Video umzurechnen; so bleibt es bei der
       Direktwiedergabe und nur der Text wird nachgeladen.

       Nur Bildformate (PGS, VobSub) muss der Server ins Bild rechnen —
       dafuer gibt es keinen anderen Weg. */
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' },
      { Format: 'sub', Method: 'External' },
      { Format: 'smi', Method: 'External' },
      { Format: 'mov_text', Method: 'External' },
      // Bild-Untertitel: nur die brauchen wirklich Umrechnung
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
      { Format: 'dvbsub', Method: 'Encode' },
      { Format: 'vobsub', Method: 'Encode' }
    ],

    ResponseProfiles: []
  };

  if (maxBitrate > 0) {
    profile.CodecProfiles.push({
      Type: 'Video',
      Conditions: [
        { Condition: 'LessThanEqual', Property: 'VideoBitrate', Value: String(maxBitrate), IsRequired: true }
      ]
    });
  }

  return profile;
}

/**
 * Profil fuer den Rueckfall: nichts wird direkt akzeptiert, der
 * Server MUSS nach H.264/AAC in MP4 umrechnen. Wird nur benutzt,
 * nachdem die Direktwiedergabe nachweislich gescheitert ist.
 */
function buildTranscodeOnlyProfile(maxBitrate = 0) {
  const profile = buildDeviceProfile(maxBitrate);
  profile.DirectPlayProfiles = [];   // nichts geht direkt
  return profile;
}

/**
 * Fragt den Server, wie dieser Titel abzuspielen ist.
 *
 * Antwort enthaelt pro Quelle, ob Direktwiedergabe moeglich ist,
 * und andernfalls eine fertige TranscodingUrl.
 */
async function fetchPlaybackInfo(item, options = {}) {
  const {
    audioIndex = null,
    subtitleIndex = null,
    maxBitrate = 0,
    startPositionTicks = 0,
    mediaSourceId = null
  } = options;

  const params = new URLSearchParams({ userId: state.userId });
  if (mediaSourceId) params.set('mediaSourceId', mediaSourceId);
  if (audioIndex != null) params.set('audioStreamIndex', String(audioIndex));
  if (subtitleIndex != null) params.set('subtitleStreamIndex', String(subtitleIndex));
  if (startPositionTicks) params.set('startTimeTicks', String(startPositionTicks));
  if (maxBitrate > 0) params.set('maxStreamingBitrate', String(maxBitrate));

  /* forceTranscode wird gesetzt, nachdem die Direktwiedergabe
     gescheitert ist. Dann muss der Server umrechnen — sonst bekaeme
     die App dieselbe nicht abspielbare Quelle noch einmal. */
  const force = Boolean(options.forceTranscode);

  const body = {
    DeviceProfile: force ? buildTranscodeOnlyProfile(maxBitrate) : buildDeviceProfile(maxBitrate),
    UserId: state.userId,
    MaxStreamingBitrate: maxBitrate || 120000000,
    StartTimeTicks: startPositionTicks,
    AutoOpenLiveStream: true,
    EnableDirectPlay: !force,
    EnableDirectStream: !force,
    EnableTranscoding: true,
    AllowVideoStreamCopy: !force,
    AllowAudioStreamCopy: !force
  };

  if (audioIndex != null) body.AudioStreamIndex = audioIndex;
  if (subtitleIndex != null) body.SubtitleStreamIndex = subtitleIndex;
  if (mediaSourceId) body.MediaSourceId = mediaSourceId;

  return api(`/Items/${item.Id}/PlaybackInfo?${params}`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

/**
 * Baut aus der Server-Antwort die konkrete Abspiel-Adresse.
 *
 * Rueckgabe:
 *   url          — was der Player laden soll
 *   method       — DirectPlay | DirectStream | Transcode
 *   source       — die gewaehlte MediaSource
 *   playSession  — fuer die Fortschrittsmeldungen
 */
function resolveStream(playbackInfo, item, options = {}) {
  const source = playbackInfo?.MediaSources?.[0];
  if (!source) return null;

  const playSessionId = playbackInfo.PlaySessionId || null;

  /* Der Server hat eine fertige Adresse mitgeschickt: dann ist
     Umrechnen noetig und er weiss am besten, wie. */
  if (source.TranscodingUrl) {
    return {
      url: `${state.serverUrl}${source.TranscodingUrl}`,
      method: 'Transcode',
      source,
      playSessionId,
      // Beim Umrechnen liegt der Startpunkt schon im Stream
      seekHandledByServer: true
    };
  }

  /* Direktwiedergabe: Datei unveraendert. Das ist der schonendste
     Weg — kein Rechenaufwand auf dem Server. */
  const canDirect = source.SupportsDirectPlay || source.SupportsDirectStream;

  if (canDirect) {
    const params = new URLSearchParams({
      api_key: state.token,
      Static: 'true',
      MediaSourceId: source.Id,
      DeviceId: getDeviceId()
    });
    if (playSessionId) params.set('PlaySessionId', playSessionId);

    const container = (source.Container || 'mp4').split(',')[0];

    return {
      url: `${state.serverUrl}/Videos/${item.Id}/stream.${container}?${params}`,
      method: source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream',
      source,
      playSessionId,
      seekHandledByServer: false
    };
  }

  /* Weder noch: als letzten Ausweg selbst eine Umrechnung anfordern.
     Kommt praktisch nur vor, wenn der Server nichts vorgeschlagen hat. */
  const params = new URLSearchParams({
    api_key: state.token,
    MediaSourceId: source.Id,
    DeviceId: getDeviceId(),
    VideoCodec: 'h264',
    AudioCodec: 'aac',
    TranscodingContainer: 'mp4',
    TranscodingProtocol: 'http',
    Context: 'Streaming',
    MaxAudioChannels: '2'
  });
  if (playSessionId) params.set('PlaySessionId', playSessionId);
  if (options.audioIndex != null) params.set('AudioStreamIndex', String(options.audioIndex));
  if (options.maxBitrate > 0) params.set('VideoBitrate', String(options.maxBitrate));

  return {
    url: `${state.serverUrl}/Videos/${item.Id}/stream.mp4?${params}`,
    method: 'Transcode',
    source,
    playSessionId,
    seekHandledByServer: false
  };
}

/** Meldet dem Server, dass ein Transcode nicht mehr gebraucht wird. */
async function stopTranscoding(playSessionId) {
  if (!playSessionId) return;
  try {
    await api(`/Videos/ActiveEncodings?deviceId=${encodeURIComponent(getDeviceId())}` +
      `&playSessionId=${encodeURIComponent(playSessionId)}`, { method: 'DELETE' });
  } catch (error) {
    // Nebensache — der Server raeumt spaeter selbst auf
  }
}

/** Lesbare Begruendung, warum umgerechnet wird — fuer die Anzeige. */
function transcodeReason(source) {
  if (!source) return '';
  const reasons = source.TranscodeReasons;
  if (!reasons) return '';
  return Array.isArray(reasons) ? reasons.join(', ') : String(reasons);
}
