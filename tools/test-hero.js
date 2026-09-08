/**
 * Prueft den Uebergang zwischen zwei Hero-Folien — zeitlich gemessen,
 * nicht am Quelltext abgelesen.
 *
 * Das Fenster MUSS sichtbar sein: in einem unsichtbaren haelt Chromium
 * Uebergaenge an, und jede Messung ergaebe faelschlich "keine Bewegung".
 *
 * Aufruf:  npx electron tools/test-hero.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const ROOT = path.join(__dirname, '..');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: true,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, Math.round(1200 * SLOW)));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      const folie = (name, aktiv) =>
        '<div class="hero-slide' + (aktiv ? ' active' : '') + '">' +
        '<div class="hero-bg"></div><div class="hero-content">' +
        '<div class="hero-badge">Serie</div><h2>' + name + '</h2>' +
        '<div class="hero-facts"><span>2007</span></div>' +
        '<p class="hero-overview">Text</p>' +
        '<div class="hero-actions"><button>Ansehen</button></div>' +
        '</div></div>';

      const slider = document.createElement('section');
      slider.className = 'hero-slider';
      slider.innerHTML = folie('A', true) + folie('B', false);
      document.body.appendChild(slider);
      await sleep(300);

      const slides = [...slider.querySelectorAll('.hero-slide')];
      const [a, b] = slides;

      /* --- Es gibt ueberhaupt einen Uebergang --- */
      const dauer = parseFloat(getComputedStyle(a).transitionDuration) || 0;
      check('Folien blenden, sie schneiden nicht', dauer >= 0.6,
            dauer + 's');

      /* Eine Ausklingkurve legt den Grossteil in die ersten Millisekunden
         und wirkt dadurch wie ein Schnitt. Gleichmaessig muss sie sein. */
      check('Blende laeuft gleichmaessig, nicht ausklingend',
            /linear/.test(getComputedStyle(a).transitionTimingFunction),
            getComputedStyle(a).transitionTimingFunction);

      /* --- Der eigentliche Wechsel --- */
      function goTo(ziel) {
        slides.forEach((slide, i) => {
          const wirdAktiv = i === ziel;
          if (wirdAktiv && !slide.classList.contains('active')) {
            const inhalt = slide.querySelector('.hero-content');
            if (inhalt) {
              inhalt.style.animation = 'none';
              void inhalt.offsetWidth;
              inhalt.style.animation = '';
            }
          }
          slide.classList.toggle('active', wirdAktiv);
        });
      }

      const sichtbar = (slide) => {
        const h2 = slide.querySelector('h2');
        const inhalt = slide.querySelector('.hero-content');
        return Number(getComputedStyle(slide).opacity) *
               Number(getComputedStyle(inhalt).opacity) *
               Number(getComputedStyle(h2).opacity);
      };

      goTo(1);

      let ueberlappung = 0;
      let proben = 0;
      let bildSprung = 0;
      let vorher = Number(getComputedStyle(b).opacity);

      for (let i = 0; i < 14; i++) {
        await sleep(90);
        const va = sichtbar(a);
        const vb = sichtbar(b);
        if (va > 0.06 && vb > 0.06) ueberlappung++;
        proben++;

        const jetzt = Number(getComputedStyle(b).opacity);
        bildSprung = Math.max(bildSprung, jetzt - vorher);
        vorher = jetzt;
      }

      /* Der Kern: nie zwei Titel gleichzeitig auf dem Bild. */
      check('Nie zwei Titel gleichzeitig sichtbar', ueberlappung === 0,
            ueberlappung + ' von ' + proben + ' Proben');

      /* Kein Schritt darf einen grossen Teil auf einmal springen —
         genau das macht eine Ausklingkurve und liest sich als Schnitt. */
      check('Kein Sprung im Bildverlauf', bildSprung < 0.16,
            'groesster Schritt ' + bildSprung.toFixed(2));

      await sleep(700);
      check('Am Ende steht die neue Folie', sichtbar(b) > 0.9,
            sichtbar(b).toFixed(2));
      check('Die alte ist verschwunden', sichtbar(a) < 0.02,
            sichtbar(a).toFixed(2));

      /* --- Der Wiederholungsfall --- */
      async function tiefpunkt(ziel) {
        goTo(ziel);
        let min = 1;
        for (let i = 0; i < 8; i++) {
          await sleep(60);
          min = Math.min(min, sichtbar(slides[ziel]));
        }
        await sleep(900);
        return min;
      }

      await tiefpunkt(0);
      const zweitesMal = await tiefpunkt(1);

      /* Eine CSS-Animation startet nur bei einem Klassenwechsel neu.
         Ohne erzwungenen Reflow bliebe der Text beim zweiten Durchlauf
         einfach stehen — und der Wechsel saehe wieder aus wie ein Cut. */
      check('Text laeuft auch beim zweiten Durchlauf neu ein',
            zweitesMal < 0.1, 'Tiefpunkt ' + zweitesMal.toFixed(3));

      /* --- Ken Burns --- */
      const bgA = a.querySelector('.hero-bg');
      const bgB = b.querySelector('.hero-bg');
      check('Die Fahrt laeuft nur in der sichtbaren Folie',
            getComputedStyle(bgA).animationPlayState === 'paused' &&
            getComputedStyle(bgB).animationPlayState === 'running',
            'inaktiv ' + getComputedStyle(bgA).animationPlayState +
            ', aktiv ' + getComputedStyle(bgB).animationPlayState);

      /* --- Der Container darf den Zeilenversatz nicht ueberschreiben --- */
      const inhaltB = b.querySelector('.hero-content');
      check('Container traegt keine eigene Animation',
            getComputedStyle(inhaltB).animationName === 'none',
            getComputedStyle(inhaltB).animationName);

      const ersteZeile = getComputedStyle(inhaltB.children[0]);
      check('Zeilen laufen versetzt ein',
            parseFloat(ersteZeile.animationDelay) > 0.2,
            'Verzug ' + ersteZeile.animationDelay);

      slider.remove();
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
