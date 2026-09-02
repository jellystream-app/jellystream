/* ============================================================
   Wiedergabe-Aushandlung

   Bisher ging jede Datei als Direktstream raus und der Player
   entschied nur bei Untertiteln oder Tonspurwechsel anders. Das
   scheiterte still bei allem, was Chromium nicht kann — und das
   ist viel: MKV, HEVC, AC-3, DTS, HLS.

   Jetzt sagt die App dem Server per DeviceProfile ehrlich, was sie
   abspielen kann. Jellyfin entscheidet dann selbst zwischen
   Direktwiedergabe, Umpacken und Umrechnen.

   Gemessen in Electron 33 (tools/probe-mkv.js, mit echten Dateien):
     ja   — MP4/WebM/MKV, H.264 (bis High10), VP8/VP9, AV1,
            AAC, MP3, FLAC, Opus, Vorbis, PCM
     nein — HEVC, AC-3, E-AC-3, DTS, TrueHD, HLS, MPEG-TS

   Wichtig zur Messmethode: canPlayType() taugt nur fuer Codecs, nicht
   fuer Container. Fuer Matroska meldet Chromium "" — spielt die Datei
   aber ab, solange der Inhalt passt. Wer sich hier auf canPlayType
   verlaesst, schickt funktionierende Dateien unnoetig durch den
   Transcoder und belastet den Server ohne Grund.
   ============================================================ */

/* Container, die der Player direkt öffnen kann.

   mkv gehoert dazu — auch wenn canPlayType('video/x-matroska') ""
   liefert. Chromium meldet den Container konservativ als nicht
   unterstuetzt, dekodiert ihn aber, solange der INHALT passt
   (H.264/VP9/AV1 mit AAC/MP3/FLAC/Opus). Mit einer echten Datei
   nachgewiesen: tools/probe-mkv.js liest Metadaten und Masse.

   Das war mein Fehler in 2.5.0: Ich habe canPlayType geglaubt statt
   zu messen und dadurch funktionierende Direktwiedergabe auf
   unnoetiges Umrechnen umgestellt. */
const CONTAINERS = 'mp4,m4v,mkv,webm';

/* Was in diesen Containern liegen darf */
const VIDEO_CODECS = 'h264,vp8,vp9,av1';
const AUDIO_CODECS = 'aac,mp3,flac,opus,vorbis,pcm_s16le,pcm_s24le';

/* Tonformate, die der Server beim Umpacken beibehalten darf.
   AC-3 und DTS fehlen hier bewusst — Chromium kann sie nicht. */
const STREAM_AUDIO = 'aac,mp3,flac,opus';

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

    CodecProfiles: [
      {
        Type: 'Video',
        Codec: 'h264',
        Conditions: [
          // High10 laeuft, alles darueber nicht mehr zuverlaessig
          { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
          { Condition: 'EqualsAny', Property: 'VideoProfile',
            Value: 'baseline|constrained baseline|main|high|high 10', IsRequired: false },
          { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
          { Condition: 'NotEquals', Property: 'IsInterlaced', Value: 'true', IsRequired: false }
        ]
      },
      {
        Type: 'Video',
        Codec: 'vp9',
        Conditions: [
          { Condition: 'NotEquals', Property: 'IsInterlaced', Value: 'true', IsRequired: false }
        ]
      },
      {
        Type: 'VideoAudio',
        Conditions: [
          /* Keine Kanalgrenze: die Ausgabe ist zwar Stereo, aber
             Chromium mischt 5.1 selbst herunter. Eine Bedingung hier
             wuerde jeden Mehrkanalton durch den Transcoder schicken,
             obwohl die Datei direkt liefe. */
          { Condition: 'NotEquals', Property: 'IsSecondaryAudio', Value: 'true', IsRequired: false }
        ]
      }
    ],

    SubtitleProfiles: [
      // Textspuren holt der Player selbst als VTT
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
      { Format: 'ass', Method: 'Encode' },
      { Format: 'ssa', Method: 'Encode' },
      // Bild-Untertitel muss der Server ins Bild rechnen
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

  const body = {
    DeviceProfile: buildDeviceProfile(maxBitrate),
    UserId: state.userId,
    MaxStreamingBitrate: maxBitrate || 120000000,
    StartTimeTicks: startPositionTicks,
    AutoOpenLiveStream: true,
    // Wir erlauben beides und lassen den Server waehlen
    EnableDirectPlay: true,
    EnableDirectStream: true,
    EnableTranscoding: true,
    AllowVideoStreamCopy: true,
    AllowAudioStreamCopy: true
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
