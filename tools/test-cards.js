/**
 * Prueft die drei Aenderungen an Hero-Verlauf, Poster-Kacheln und
 * der Trennung von Play und Info:
 *
 *   1. Der Vorschau-Banner blendet weich aus statt hart abzuschneiden
 *   2. Auf Hochkant-Kacheln bleibt der Info-Knopf erreichbar
 *   3. Play spielt ab, Info oeffnet die Infoseite — auch bei Folgen
 *
 * Aufruf:  npx electron tools/test-cards.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const settle = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));

const ROOT = path.join(__dirname, '..');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await settle(1000);

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      /* ================================================================
         1. HERO-VERLAUF — weicher Uebergang statt harter Kante
         ================================================================ */

      const THEMES = ['', 'onyx', 'graphite', 'plum', 'forest', 'nord', 'light'];

      /* --bg und --bg-rgb muessen denselben Ton beschreiben. Weichen sie
         ab, blendet der Banner in eine andere Farbe aus als die Seite
         darunter hat — genau die Kante, die verschwinden sollte. */
      let mismatch = [];
      for (const theme of THEMES) {
        if (theme) document.documentElement.setAttribute('data-theme', theme);
        else document.documentElement.removeAttribute('data-theme');
        await wait(20);

        const cs = getComputedStyle(document.documentElement);
        const hex = cs.getPropertyValue('--bg').trim();
        const rgb = cs.getPropertyValue('--bg-rgb').trim();

        if (!rgb) { mismatch.push((theme || 'standard') + ': --bg-rgb fehlt'); continue; }

        const fromHex = hex.replace('#', '').match(/.{2}/g).map((h) => parseInt(h, 16));
        const fromRgb = rgb.split(',').map((n) => parseInt(n.trim(), 10));
        if (fromHex.join() !== fromRgb.join()) {
          mismatch.push((theme || 'standard') + ': ' + hex + ' != ' + rgb);
        }
      }
      document.documentElement.removeAttribute('data-theme');
      await wait(20);

      check('--bg-rgb passt in jedem Theme zu --bg', mismatch.length === 0, mismatch.join(' | '));

      /* Der Verlauf braucht Zwischenstufen. Mit nur zwei Farbstopps legt
         der Browser eine gerade Rampe — die sieht man als Band, und am
         Ende als Kante. */
      const slider = buildHeroSlider([{
        Id: 'h1', Type: 'Movie', Name: 'Test', Overview: 'x',
        ImageTags: { Primary: 'p' }, ProductionYear: 2020
      }]);
      document.getElementById('view-root').appendChild(slider);
      await wait(60);

      const slide = slider.querySelector('.hero-slide');
      const layer = getComputedStyle(slide, '::after').backgroundImage;

      // Der senkrechte Verlauf ist der zweite im Stapel
      const stops = (layer.match(/rgba?\\([^)]*\\)/g) || []).length;
      check('Hero-Verlauf hat Zwischenstufen', stops >= 8, stops + ' Farbstopps');

      /* Am unteren Rand muss er voll decken: sonst endet das Bild
         sichtbar, statt in den Hintergrund zu laufen. */
      const bottomOpaque = /rgb\\(\\s*10\\s*,\\s*14\\s*,\\s*20\\s*\\)|rgba\\(\\s*10\\s*,\\s*14\\s*,\\s*20\\s*,\\s*1\\s*\\)/.test(layer);
      check('Verlauf deckt unten voll', bottomOpaque, layer.slice(0, 90));

      slider.remove();

      /* ================================================================
         2. HOCHKANT-KACHELN — Info-Knopf bleibt erreichbar
         ================================================================ */

      const EPISODE = {
        Id: 'e1', Type: 'Episode', Name: 'Der sicherste Ort der Welt',
        SeriesId: 's1', SeriesName: 'The Big Bang Theory', SeasonId: 'se1',
        ParentIndexNumber: 3, IndexNumber: 7,
        ProductionYear: 2010, RunTimeTicks: 12600000000,
        ImageTags: { Primary: 'p' }, UserData: {}
      };

      const host = document.getElementById('view-root');

      for (const [shape, expectWrap] of [['poster', true], ['wide', false]]) {
        const card = buildCard(EPISODE, { shape });
        host.appendChild(card);
        // Der Knopfblock zeigt sich erst beim Hovern
        card.querySelector('.card-body').style.maxHeight = '400px';
        card.querySelector('.card-body').style.opacity = '1';
        await wait(40);

        const actions = card.querySelector('.card-actions');
        const info = card.querySelector('.card-icon-btn.info');
        const infoBox = info.getBoundingClientRect();
        const cardBox = card.getBoundingClientRect();

        check(shape + ': Info-Knopf vorhanden', Boolean(info));
        check(shape + ': Info-Knopf behaelt seine Breite', infoBox.width >= 29,
          Math.round(infoBox.width) + 'px statt 30px');

        /* JEDEN Knopf pruefen, nicht nur "Info": dank flex-shrink: 0
           behalten sie ihre Breite und laufen stattdessen rechts aus
           der Karte heraus, wo card-body sie abschneidet. Wer nur den
           Info-Knopf misst, uebersieht das, sobald der weiter vorne
           steht — abgeschnitten wird dann eben der naechste. */
        const escaped = [...actions.querySelectorAll('button')]
          .filter((b) => b.getBoundingClientRect().right > cardBox.right + 1)
          .map((b) => (b.className.match(/(?:card-play|info|fav|list|seen|dl|dismiss)/) || ['?'])[0]);

        check(shape + ': kein Knopf ragt aus der Karte', escaped.length === 0,
          escaped.length ? escaped.join(', ') + ' abgeschnitten' : '');

        const wraps = getComputedStyle(actions).flexWrap === 'wrap';
        check(shape + ': Umbruch ' + (expectWrap ? 'an' : 'aus'), wraps === expectWrap);

        card.remove();
      }

      /* Auch in der kleinsten Einstellung muss er sichtbar bleiben —
         dort ist die Kachel nur 134px breit. */
      document.documentElement.setAttribute('data-cards', 'compact');
      await wait(30);
      const tight = buildCard(EPISODE, { shape: 'poster' });
      host.appendChild(tight);
      tight.querySelector('.card-body').style.maxHeight = '400px';
      await wait(40);
      const tightInfo = tight.querySelector('.card-icon-btn.info').getBoundingClientRect();
      check('kompakt: Info-Knopf behaelt seine Breite', tightInfo.width >= 29,
        Math.round(tightInfo.width) + 'px statt 30px');
      tight.remove();
      document.documentElement.removeAttribute('data-cards');
      await wait(20);

      /* ================================================================
         3. PLAY SPIELT, INFO OEFFNET — auch bei Folgen
         ================================================================ */

      // Aufzeichnen statt wirklich abspielen oder navigieren
      const calls = [];
      const realPlay = window.playVideo;
      const realNavigate = window.navigate;
      const realShowDetail = window.showDetail;

      window.playVideo = (item) => { calls.push('play:' + item.Id); };
      window.navigate = (fn) => { calls.push('navigate'); };

      for (const [type, item] of [
        ['Episode', EPISODE],
        ['Movie', { Id: 'm1', Type: 'Movie', Name: 'Film', ImageTags: {}, UserData: {} }]
      ]) {
        const card = buildCard(item, { shape: 'poster' });
        host.appendChild(card);

        calls.length = 0;
        card.querySelector('.card-play').click();
        await wait(30);
        check(type + ': Play spielt ab', calls.some((c) => c.startsWith('play:')), calls.join(','));

        calls.length = 0;
        card.querySelector('.card-icon-btn.info').click();
        await wait(30);
        check(type + ': Info oeffnet die Infoseite',
          calls.includes('navigate') && !calls.some((c) => c.startsWith('play:')),
          calls.join(','));

        card.remove();
      }

      /* openItem ist der gemeinsame Weg: ein Klick auf die Kachel und
         der Info-Knopf laufen beide darueber. Bei einer Folge darf er
         nicht mehr in die Wiedergabe springen. */
      calls.length = 0;
      openItem(EPISODE);
      await wait(30);
      check('openItem(Folge) oeffnet, spielt nicht',
        calls.includes('navigate') && !calls.some((c) => c.startsWith('play:')),
        calls.join(','));

      calls.length = 0;
      openItem({ Id: 'a1', Type: 'Audio', Name: 'Lied' });
      await wait(30);
      check('openItem(Audio) spielt weiterhin sofort',
        !calls.includes('navigate'), calls.join(','));

      window.playVideo = realPlay;
      window.navigate = realNavigate;
      window.showDetail = realShowDetail;

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
