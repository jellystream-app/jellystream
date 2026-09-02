/**
 * Testet die Wiedergabe-Aushandlung: DeviceProfile, Stream-Auswahl,
 * Zeitachse beim Umrechnen, und dass die gemessenen Codec-Grenzen
 * im Profil auch wirklich abgebildet sind.
 *
 * Aufruf:  npx electron tools/test-playback.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
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
  await new Promise((r) => setTimeout(r, 1400));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';
      state.token = 'tok';

      /* ============ 1. Das Profil deckt sich mit der Realität ============ */

      const profile = buildDeviceProfile(0);
      const video = document.createElement('video');
      const audio = document.createElement('audio');

      const direct = profile.DirectPlayProfiles.find((p) => p.Type === 'Video');
      check('Direktwiedergabe-Profil vorhanden', Boolean(direct));

      // Jeder angebotene Container muss wirklich abspielbar sein
      const badContainers = (direct.Container || '').split(',').filter((c) => {
        const type = c === 'webm' ? 'video/webm' : 'video/mp4';
        return !video.canPlayType(type);
      });
      check('Nur abspielbare Container im Profil', badContainers.length === 0,
            badContainers.join(', '));

      // MKV darf NICHT drinstehen — Chromium kann es nicht
      check('MKV wird nicht als direkt angeboten',
            !(direct.Container || '').includes('mkv'), direct.Container);

      // HEVC ebenso wenig
      check('HEVC wird nicht als direkt angeboten',
            !/hevc|h265|hvc1/i.test(direct.VideoCodec || ''), direct.VideoCodec);

      // AC-3 und DTS fehlen zu Recht
      check('AC-3 nicht im Tonprofil', !/ac3|ac-3/i.test(direct.AudioCodec || ''), direct.AudioCodec);
      check('DTS nicht im Tonprofil', !/dts/i.test(direct.AudioCodec || ''), direct.AudioCodec);

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

  win.destroy();
  app.exit(failed ? 1 : 0);
});
