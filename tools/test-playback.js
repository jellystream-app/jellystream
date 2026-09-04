/**
 * Testet die Wiedergabe-Aushandlung: DeviceProfile, Stream-Auswahl,
 * Zeitachse beim Umrechnen, und dass die gemessenen Codec-Grenzen
 * im Profil auch wirklich abgebildet sind.
 *
 * Aufruf:  npx electron tools/test-playback.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

/* Wartezeiten dehnen sich mit JF_TEST_SLOW — CI-Laeufer brauchen
   laenger, bis eine Seite steht. Ohne die Variable bleibt alles
   wie bisher. */
const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const settle = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));


const ROOT = path.join(__dirname, '..');

/* ---- Eine winzige, echte Matroska-Datei bauen ----
   Nur so laesst sich pruefen, ob Chromium MKV wirklich oeffnet.
   canPlayType() reicht dafuer nicht: es meldet fuer Container
   konservativ "nein", auch wenn die Wiedergabe funktioniert. */

function vint(v) {
  if (v < 0x7f) return Buffer.from([0x80 | v]);
  if (v < 0x3fff) return Buffer.from([0x40 | (v >> 8), v & 0xff]);
  return Buffer.from([0x20 | (v >> 16), (v >> 8) & 0xff, v & 0xff]);
}
const el = (id, p) => Buffer.concat([Buffer.from(id), vint(p.length), p]);
const uint = (n) => (n < 256 ? Buffer.from([n]) : Buffer.from([(n >> 8) & 0xff, n & 0xff]));

function buildTinyMkv() {
  const header = el([0x1a, 0x45, 0xdf, 0xa3], Buffer.concat([
    el([0x42, 0x86], uint(1)), el([0x42, 0xf7], uint(1)),
    el([0x42, 0xf2], uint(4)), el([0x42, 0xf3], uint(8)),
    el([0x42, 0x82], Buffer.from('matroska')),
    el([0x42, 0x87], uint(4)), el([0x42, 0x85], uint(2))
  ]));
  const info = el([0x15, 0x49, 0xa9, 0x66], Buffer.concat([
    el([0x2a, 0xd7, 0xb1], Buffer.from([0x0f, 0x42, 0x40])),
    el([0x44, 0x89], Buffer.from(new Float64Array([1000]).buffer).reverse())
  ]));
  const avcc = Buffer.from([
    0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x0d,
    0x67, 0x42, 0xc0, 0x1e, 0xd9, 0x00, 0xa0, 0xfd,
    0x80, 0x88, 0x00, 0x00, 0x03, 0x00, 0x01,
    0x01, 0x00, 0x04, 0x68, 0xce, 0x3c, 0x80
  ]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], Buffer.concat([
    el([0xd7], uint(1)), el([0x73, 0xc5], uint(1)), el([0x83], uint(1)),
    el([0x86], Buffer.from('V_MPEG4/ISO/AVC')), el([0x63, 0xa2], avcc),
    el([0xe0], Buffer.concat([el([0xb0], uint(320)), el([0xba], uint(240))]))
  ])));
  const frame = Buffer.concat([vint(1), Buffer.from([0, 0]), Buffer.from([0x80]), Buffer.alloc(64)]);
  const cluster = el([0x1f, 0x43, 0xb6, 0x75], Buffer.concat([
    el([0xe7], uint(0)), el([0xa3], frame)
  ]));
  return Buffer.concat([header, el([0x18, 0x53, 0x80, 0x67],
    Buffer.concat([info, tracks, cluster]))]);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  /* Testserver, der eine echte MKV-Datei ausliefert */
  const mkvData = buildTinyMkv();
  const mediaServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'video/x-matroska',
      'Content-Length': mkvData.length
    });
    res.end(mkvData);
  });
  await new Promise((r) => mediaServer.listen(0, '127.0.0.1', r));
  const mkvUrl = `http://127.0.0.1:${mediaServer.address().port}/film.mkv`;
  ipcMain.handle('languages:list', () => require('../languages').list());
  ipcMain.handle('languages:get', (e, code) => require('../languages').get(code));
  require('../languages').init();

  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await settle(1400);

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      /* ====== Der Nachweis: spielt Chromium MKV wirklich? ======
         Diese Pruefung ist der Grund, warum mkv im Profil steht.
         Schlaegt sie fehl, war die Annahme falsch — dann gehoert
         mkv wieder heraus. */
      const mkvVerdict = await new Promise((resolve) => {
        const el = document.createElement('video');
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        el.addEventListener('loadedmetadata', () => finish('ok:' + el.videoWidth + 'x' + el.videoHeight));
        el.addEventListener('error', () => finish('fehler'));
        setTimeout(() => finish('zeitueberschreitung'), 4000);
        el.src = ${JSON.stringify(mkvUrl)};
        el.load();
      });

      check('Echte MKV-Datei wird geoeffnet', mkvVerdict.startsWith('ok:'), mkvVerdict);
      check('canPlayType meldet MKV faelschlich als nicht abspielbar',
            document.createElement('video').canPlayType('video/x-matroska') === '',
            'genau deshalb darf man sich nicht darauf verlassen');

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';
      state.token = 'tok';

      /* ============ 1. Das Profil deckt sich mit der Realität ============ */

      const profile = buildDeviceProfile(0);
      const video = document.createElement('video');
      const audio = document.createElement('audio');

      const direct = profile.DirectPlayProfiles.find((p) => p.Type === 'Video');
      check('Direktwiedergabe-Profil vorhanden', Boolean(direct));

      /* MKV MUSS direkt angeboten werden. canPlayType meldet dafuer ""
         — Chromium spielt Matroska aber ab, solange der Inhalt passt
         (mit echter Datei nachgewiesen, siehe tools/probe-mkv.js).
         Ohne mkv im Profil landen genau die haeufigsten Dateien
         unnoetig im Transcoder. */
      check('MKV wird direkt angeboten',
            (direct.Container || '').split(',').includes('mkv'), direct.Container);
      check('MP4 wird direkt angeboten',
            (direct.Container || '').split(',').includes('mp4'), direct.Container);

      // Auf Listeneintraege pruefen, nicht per Regex: "ac3" steckt
      // als Teilkette auch in "eac3" und ergaebe falsche Treffer.
      const vList = (direct.VideoCodec || '').split(',');
      const aList = (direct.AudioCodec || '').split(',');

      /* Alles wird direkt versucht — auch HEVC, das Chromium nicht
         dekodiert. Das ist Absicht: der Rueckfall im Player faengt
         den Fehlschlag ab und laedt umgerechnet neu. So ist der
         schnelle Weg der Normalfall und der langsame die Ausnahme.

         Die Absicherung dafuer wird weiter unten geprueft — ohne
         sie waere dieses Profil fahrlaessig. */
      check('HEVC wird direkt versucht', vList.includes('hevc'), direct.VideoCodec);
      check('AV1 wird direkt versucht', vList.includes('av1'), direct.VideoCodec);
      check('VC-1 wird direkt versucht', vList.includes('vc1'), direct.VideoCodec);
      check('AC-3 wird direkt versucht', aList.includes('ac3'), direct.AudioCodec);
      check('DTS wird direkt versucht', aList.includes('dts'), direct.AudioCodec);
      check('TrueHD wird direkt versucht', aList.includes('truehd'), direct.AudioCodec);

      /* Textuntertitel duerfen kein Umrechnen ausloesen: sonst wuerde
         jede Datei mit ass/ssa-Spur durch den Transcoder laufen. */
      const encoded = profile.SubtitleProfiles
        .filter((s) => s.Method === 'Encode').map((s) => s.Format);
      check('ass/ssa werden nicht eingebrannt',
            !encoded.includes('ass') && !encoded.includes('ssa'), encoded.join(', '));
      check('Nur Bilduntertitel werden eingebrannt',
            encoded.every((f) => /pgs|dvd|dvb|vob/.test(f)), encoded.join(', '));

      // Umgekehrt: was drinsteht, muss laufen
      check('H.264 ist im Profil', /h264/.test(direct.VideoCodec));
      check('AAC ist im Profil', /aac/.test(direct.AudioCodec));

      /* --- Der Umrechnungsweg darf NICHT HLS sein --- */
      const trans = profile.TranscodingProfiles.find((p) => p.Type === 'Video');
      check('Umrechnung liefert MP4', trans.Container === 'mp4', trans.Container);
      check('Umrechnung nutzt kein HLS', trans.Protocol !== 'hls', trans.Protocol);
      check('Umrechnung nutzt H.264', trans.VideoCodec === 'h264');

      // Gegenprobe: HLS und TS kann dieser Player wirklich nicht
      check('HLS ist tatsächlich nicht abspielbar',
            !video.canPlayType('application/vnd.apple.mpegurl'),
            'canPlayType: "' + video.canPlayType('application/vnd.apple.mpegurl') + '"');
      check('MPEG-TS ist tatsächlich nicht abspielbar',
            !video.canPlayType('video/mp2t'));

      /* ====== Typische Bibliotheksdateien muessen direkt laufen ======
         Das ist die Pruefung, die den Fehler aus 2.5.0 gefunden
         haette: dort fiel MKV+AC-3 durch und ganze Serien wurden
         umgerechnet, obwohl sie vorher direkt liefen. */
      const containers = (direct.Container || '').split(',');
      const vcodecs = (direct.VideoCodec || '').split(',');
      const acodecs = (direct.AudioCodec || '').split(',');

      const typical = [
        { n: 'MKV + H.264 + AC-3', c: 'mkv', v: 'h264', a: 'ac3' },
        { n: 'MKV + H.264 + AAC',  c: 'mkv', v: 'h264', a: 'aac' },
        { n: 'MKV + H.264 + DTS',  c: 'mkv', v: 'h264', a: 'dts' },
        
        { n: 'MP4 + H.264 + AAC',  c: 'mp4', v: 'h264', a: 'aac' },
        { n: 'AVI + MPEG-4 + MP3', c: 'avi', v: 'mpeg4', a: 'mp3' }
      ];

      typical.forEach((f) => {
        const ok = containers.includes(f.c) && vcodecs.includes(f.v) && acodecs.includes(f.a);
        const why = [];
        if (!containers.includes(f.c)) why.push('Container');
        if (!vcodecs.includes(f.v)) why.push('Video');
        if (!acodecs.includes(f.a)) why.push('Audio');
        check('Laeuft direkt: ' + f.n, ok, why.join('+') + ' fehlt im Profil');
      });

      /* Keine CodecProfile-Bedingung: jede davon ist ein Grund, aus
         dem der Server umrechnet. Genau daran lag es zuletzt. */
      check('Keine Bedingungen erzwingen Umrechnen',
            profile.CodecProfiles.length === 0,
            profile.CodecProfiles.length + ' Bedingungen');

      /* --- Kein unnoetiges Umrechnen bei Mehrkanalton ---
         Die Ausgabe ist Stereo, aber Chromium mischt selbst herunter.
         Eine Kanalbedingung wuerde jede 5.1-Tonspur durch den
         Transcoder schicken, obwohl die Datei direkt liefe. */
      const audioCond = profile.CodecProfiles.find((p) => p.Type === 'VideoAudio');
      const hasChannelLimit = audioCond?.Conditions?.some((c) => c.Property === 'AudioChannels');
      check('Keine Kanalgrenze erzwingt Umrechnen', !hasChannelLimit,
            hasChannelLimit ? 'AudioChannels-Bedingung vorhanden' : 'keine');

      /* --- Bitratenlimit landet im Profil --- */
      const capped = buildDeviceProfile(4000000);
      check('Bitratenlimit wird übernommen', capped.MaxStreamingBitrate === 4000000);
      const cond = capped.CodecProfiles.find((p) =>
        p.Conditions?.some((c) => c.Property === 'VideoBitrate'));
      check('Bitrate als Bedingung gesetzt', Boolean(cond));

      /* --- Untertitel: Text extern, Bild eingebrannt --- */
      const subs = profile.SubtitleProfiles;
      const srt = subs.find((s) => s.Format === 'srt');
      const pgs = subs.find((s) => s.Format === 'pgssub');
      check('SRT wird extern geholt', srt?.Method === 'External', srt?.Method);
      check('PGS wird eingebrannt', pgs?.Method === 'Encode', pgs?.Method);

      /* ============ 2. Stream-Auswahl ============ */

      const item = { Id: 'movie1', Name: 'Test', RunTimeTicks: 72000000000 };

      // Fall A: Server bietet Direktwiedergabe an
      const directPlan = resolveStream({
        PlaySessionId: 'sess-1',
        MediaSources: [{ Id: 'src1', Container: 'mp4', SupportsDirectPlay: true, SupportsDirectStream: true }]
      }, item, {});

      check('Direktwiedergabe wird erkannt', directPlan.method === 'DirectPlay', directPlan.method);
      check('Direkt-URL nutzt den Container', directPlan.url.includes('/stream.mp4'), directPlan.url.slice(0, 60));
      check('Direkt-URL trägt Static=true', directPlan.url.includes('Static=true'));
      check('PlaySessionId wird übernommen', directPlan.playSessionId === 'sess-1');
      check('Kein Server-Sprung bei Direkt', directPlan.seekHandledByServer === false);

      /* Fall A2: MKV, das der Server als direkt abspielbar meldet.
         Genau dieser Fall ging in 2.5.0 kaputt — mkv fehlte im
         Profil, also bot der Server nur noch Umrechnen an. */
      const mkvPlan = resolveStream({
        PlaySessionId: 'sess-mkv',
        MediaSources: [{ Id: 'srcmkv', Container: 'mkv', SupportsDirectPlay: true, SupportsDirectStream: true }]
      }, item, {});

      check('MKV wird direkt gespielt', mkvPlan.method === 'DirectPlay', mkvPlan.method);
      check('MKV-URL behaelt den Container',
            mkvPlan.url.includes('/stream.mkv'), mkvPlan.url.slice(0, 62));
      check('MKV wird nicht umgerechnet', !mkvPlan.url.includes('VideoCodec='));

      // Fall B: Server schickt eine Umrechnungs-Adresse
      const transPlan = resolveStream({
        PlaySessionId: 'sess-2',
        MediaSources: [{
          Id: 'src2', Container: 'mkv',
          SupportsDirectPlay: false, SupportsDirectStream: false,
          TranscodingUrl: '/videos/movie1/stream.mp4?PlaySessionId=sess-2&VideoCodec=h264',
          TranscodeReasons: 'VideoCodecNotSupported'
        }]
      }, item, {});

      check('Umrechnung wird erkannt', transPlan.method === 'Transcode', transPlan.method);
      check('Server-Adresse wird verwendet',
            transPlan.url === 'http://test.local/videos/movie1/stream.mp4?PlaySessionId=sess-2&VideoCodec=h264',
            transPlan.url);
      check('Server übernimmt den Startpunkt', transPlan.seekHandledByServer === true);
      check('Grund wird durchgereicht',
            transcodeReason(transPlan.source) === 'VideoCodecNotSupported',
            transcodeReason(transPlan.source));

      // Fall C: Weder noch — eigene Umrechnung anfordern
      const fallback = resolveStream({
        MediaSources: [{ Id: 'src3', Container: 'mkv', SupportsDirectPlay: false, SupportsDirectStream: false }]
      }, item, { maxBitrate: 4000000 });

      check('Rückfall fordert Umrechnung an', fallback.method === 'Transcode');
      check('Rückfall nutzt MP4', fallback.url.includes('stream.mp4'));
      check('Rückfall nutzt kein HLS', !fallback.url.includes('m3u8'));
      check('Rückfall übernimmt die Bitrate', fallback.url.includes('VideoBitrate=4000000'));

      // Fall D: keine Quelle
      check('Ohne Quelle kein Plan', resolveStream({ MediaSources: [] }, item, {}) === null);

      /* --- Der Rueckfall: nach gescheiterter Direktwiedergabe MUSS
         der Server umrechnen, sonst kaeme dieselbe kaputte Quelle
         noch einmal zurueck. --- */
      const forced = buildTranscodeOnlyProfile(0);
      check('Rueckfall-Profil erlaubt nichts direkt',
            forced.DirectPlayProfiles.length === 0,
            forced.DirectPlayProfiles.length + ' Eintraege');
      check('Rueckfall-Profil kann noch umrechnen',
            forced.TranscodingProfiles.length > 0);

      /* Das grosszuegige Profil traegt nur, wenn der Player den
         Fehlschlag auch wirklich abfaengt. Ohne diese Absicherung
         bliebe der Nutzer vor schwarzem Bild sitzen — deshalb hier
         am echten Verhalten geprueft, nicht am Quelltext.

         Ablauf: forceTranscode setzen -> das Profil darf dann nichts
         mehr direkt erlauben -> der Server MUSS umrechnen. */
      vpCurrent.forceTranscode = true;
      const forcedProfile = vpCurrent.forceTranscode
        ? buildTranscodeOnlyProfile(0)
        : buildDeviceProfile(0);

      check('Nach dem Rueckfall ist Direktwiedergabe ausgeschlossen',
            forcedProfile.DirectPlayProfiles.length === 0,
            forcedProfile.DirectPlayProfiles.length + ' Eintraege');

      vpCurrent.forceTranscode = false;
      check('Ohne Rueckfall gilt wieder das offene Profil',
            buildDeviceProfile(0).DirectPlayProfiles.length > 0);

      /* Und der Rueckfall darf nicht haengenbleiben: beim naechsten
         Titel muss wieder direkt versucht werden. Am Verhalten
         geprueft — playVideo laeuft bis zur ersten Server-Anfrage
         und hat den Schalter bis dahin zurueckgesetzt. */
      vpCurrent.forceTranscode = true;
      playVideo({ Id: 'neu', Name: 'Anderer Titel', Type: 'Movie' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 120));

      check('Ein neuer Titel setzt den Rueckfall zurueck',
            vpCurrent.forceTranscode === false,
            'sonst bliebe die App im Umrechnen-Modus');

      closeVideo();

      /* ============ 3. Zeitachse beim Umrechnen ============ */

      vpCurrent.item = item;                       // 2 Stunden
      vpCurrent.serverSeekOffset = 0;
      Object.defineProperty(vp.video, 'duration', { value: 7200, configurable: true });
      Object.defineProperty(vp.video, 'currentTime', { value: 100, writable: true, configurable: true });

      check('Ohne Versatz zählt die Elementzeit', mediaPosition() === 100, String(mediaPosition()));
      check('Ohne Versatz gilt die Elementlänge', mediaDuration() === 7200, String(mediaDuration()));

      // Jetzt so, als hätte der Server ab Minute 30 angesetzt
      vpCurrent.serverSeekOffset = 1800;
      Object.defineProperty(vp.video, 'duration', { value: 5400, configurable: true });

      check('Mit Versatz zählt die Filmzeit', mediaPosition() === 1900, String(mediaPosition()));
      check('Mit Versatz gilt die volle Länge', mediaDuration() === 7200, String(mediaDuration()));

      // Ein Sprung innerhalb des Streams bleibt im Element
      vp.video.currentTime = 0;
      seekTo(2000);
      check('Sprung im Stream rechnet um', vp.video.currentTime === 200,
            'currentTime=' + vp.video.currentTime);

      vpCurrent.serverSeekOffset = 0;
      vpCurrent.item = null;

      /* ============ 4. Anzeige der Wiedergabeart ============ */

      await setLanguage('en');

      vpCurrent.playMethod = 'DirectPlay';
      vpCurrent.transcoding = false;
      vpCurrent.transcodeReason = '';
      updatePlaybackBadge();
      check('Direkt wird angezeigt', vp.playMethod.textContent === 'Direct', vp.playMethod.textContent);
      check('Direkt trägt die richtige Klasse', vp.playMethod.className.includes('direct'));

      vpCurrent.playMethod = 'Transcode';
      vpCurrent.transcoding = true;
      vpCurrent.transcodeReason = 'VideoCodecNotSupported';
      updatePlaybackBadge();
      check('Umrechnen wird angezeigt', vp.playMethod.textContent === 'Transcoding');
      check('Umrechnen trägt die richtige Klasse', vp.playMethod.className.includes('transcoding'));
      check('Grund steht im Tooltip',
            vp.playMethod.title.includes('VideoCodecNotSupported'), vp.playMethod.title);

      /* ============ 5. Neue Ansichten ============ */

      check('showPerson vorhanden', typeof showPerson === 'function');
      check('showCollection vorhanden', typeof showCollection === 'function');
      check('showGenre vorhanden', typeof showGenre === 'function');

      // Sammlungen und Personen dürfen nicht in der Detailseite landen
      const routed = [];
      const realNavigate = window.navigate;
      check('BoxSet wird eigens behandelt',
            /case 'BoxSet'/.test(openItem.toString()));
      check('Person wird eigens behandelt',
            /case 'Person'/.test(openItem.toString()));

      // Genre-Chips sind Knöpfe
      check('Genre-Chip ist ein Knopf',
            /button[^>]*class="genre-chip"/.test(showDetail.toString()) ||
            /genre-chip[^>]*data-genre/.test(showDetail.toString()));

      await setLanguage('de');
      vp.playMethod.textContent = '';

      return out;
    })()
  `);

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  mediaServer.close();
  win.destroy();
  app.exit(failed ? 1 : 0);
});
