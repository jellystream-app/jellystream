/**
 * Testet Kachel-Bilder, Hover-Verhalten und das Blättern in Reihen.
 *
 * Aufruf:  npx electron tools/test-rows.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

/* Wartezeiten dehnen sich mit JF_TEST_SLOW — CI-Laeufer brauchen
   laenger, bis eine Seite steht. Ohne die Variable bleibt alles
   wie bisher. */
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

      // Ohne Login ist die App-Shell versteckt — dann hat nichts eine
      // Groesse und die Layout-Pruefungen waeren wertlos.
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      /* ============ 1. BILDAUSWAHL ============ */

      // Film mit Thumb: muss Thumb nehmen, nicht Primary
      const withThumb = wideImageUrl({
        Id: 'm1', Type: 'Movie',
        ImageTags: { Primary: 'ptag', Thumb: 'ttag' }
      });
      check('Thumb wird bevorzugt', withThumb.src.includes('/Images/Thumb?'), withThumb.src);
      check('Thumb gilt nicht als beschnitten', withThumb.cropped === false);

      // Nur Primary + Backdrop: Backdrop ist quer, also besser
      const withBackdrop = wideImageUrl({
        Id: 'm2', Type: 'Movie',
        ImageTags: { Primary: 'ptag' },
        BackdropImageTags: ['btag']
      });
      check('Backdrop schlaegt Poster', withBackdrop.src.includes('/Images/Backdrop?'), withBackdrop.src);

      // Reihenfolge: Thumb vor Backdrop
      const both = wideImageUrl({
        Id: 'm3', Type: 'Movie',
        ImageTags: { Thumb: 'ttag' },
        BackdropImageTags: ['btag']
      });
      check('Thumb schlaegt Backdrop', both.src.includes('/Images/Thumb?'), both.src);

      // Folge erbt das Querformat der Serie
      const episode = wideImageUrl({
        Id: 'e1', Type: 'Episode',
        ImageTags: {},
        ParentThumbImageTag: 'ptt', ParentThumbItemId: 'series-9'
      });
      check('Folge nutzt Serien-Thumb', episode.src.includes('/Items/series-9/Images/Thumb?'), episode.src);

      // Nur ein Poster da: wird genommen, aber als beschnitten markiert
      const onlyPoster = wideImageUrl({
        Id: 'm4', Type: 'Movie', ImageTags: { Primary: 'ptag' }
      });
      check('Poster als Notnagel', onlyPoster.src.includes('/Images/Primary?'), onlyPoster.src);
      check('Poster wird als beschnitten markiert', onlyPoster.cropped === true);

      // Gar kein Bild
      const nothing = wideImageUrl({ Id: 'm5', Type: 'Movie', ImageTags: {} });
      check('Ohne Bild leeres Ergebnis', nothing.src === '' && nothing.cropped === false);

      /* ============ 2. KARTE BAUT DAS RICHTIGE BILD ============ */

      const posterCard = buildCard(
        { Id: 'c1', Name: 'Nur Poster', Type: 'Movie', ImageTags: { Primary: 'p' } },
        { shape: 'wide' }
      );
      const posterImg = posterCard.querySelector('.card-art img');
      check('Poster-Karte bekommt from-poster',
            posterImg && posterImg.classList.contains('from-poster'));

      const thumbCard = buildCard(
        { Id: 'c2', Name: 'Mit Thumb', Type: 'Movie', ImageTags: { Primary: 'p', Thumb: 't' } },
        { shape: 'wide' }
      );
      const thumbImg = thumbCard.querySelector('.card-art img');
      check('Thumb-Karte ohne from-poster',
            thumbImg && !thumbImg.classList.contains('from-poster'));

      // Quadratische Kacheln (Musik) sollen weiter Primary nehmen
      const squareCard = buildCard(
        { Id: 'c3', Name: 'Album', Type: 'MusicAlbum', ImageTags: { Primary: 'p' } },
        { shape: 'square' }
      );
      const squareImg = squareCard.querySelector('.card-art img');
      check('Quadrat nutzt weiter Primary',
            squareImg && squareImg.src.includes('/Images/Primary?'), squareImg && squareImg.src);
      check('Quadrat ohne from-poster',
            squareImg && !squareImg.classList.contains('from-poster'));

      /* ============ 3. REIHE: BLAETTERN ============ */

      const items = Array.from({ length: 24 }, (_, i) => ({
        Id: 'x' + i, Name: 'Titel ' + i, Type: 'Movie',
        ImageTags: { Thumb: 't' + i }, ProductionYear: 2020
      }));

      const row = buildRow('Testreihe', items, { shape: 'wide' });
      document.getElementById('view-root').innerHTML = '';
      document.getElementById('view-root').appendChild(row);
      await wait(300);

      const scroll = row.querySelector('.row-scroll');
      const nextBtn = row.querySelector('.row-arrow.next');
      const prevBtn = row.querySelector('.row-arrow.prev');

      check('Reihe hat Inhalt zum Blaettern',
            scroll.scrollWidth > scroll.clientWidth,
            scroll.scrollWidth + ' > ' + scroll.clientWidth);

      // Das Entscheidende: overflow ist hidden, scrollBy muss trotzdem wirken
      const overflowX = getComputedStyle(scroll).overflowX;
      check('Reihe ist auf hidden gesetzt', overflowX === 'hidden', overflowX);

      /* Ohne Animation messen: im unsichtbaren Testfenster laufen keine
         Smooth-Scroll-Animationen, der Wert bliebe sonst bei 0 stehen.
         Genau dieser Pfad wird auch bei "Animationen reduzieren" benutzt. */
      const motionBefore = prefs.reduceMotion;
      prefs.reduceMotion = true;
      document.documentElement.classList.add('reduce-motion');

      const before = scroll.scrollLeft;
      nextBtn.click();
      await wait(250);
      const after = scroll.scrollLeft;
      check('Pfeil blaettert trotz overflow:hidden', after > before, before + ' -> ' + after);

      // Um ganze Kacheln, nie um eine halbe
      const cardWidth = row.querySelector('.card').offsetWidth + 14;
      check('Blaettert um ganze Kacheln', after % cardWidth < 2 || Math.abs(after % cardWidth - cardWidth) < 2,
            'Versatz ' + after + ', Kachel ' + cardWidth);

      prevBtn.click();
      await wait(250);
      check('Zurueck-Pfeil blaettert zurueck', scroll.scrollLeft < after,
            after + ' -> ' + scroll.scrollLeft);

      prefs.reduceMotion = motionBefore;
      document.documentElement.classList.remove('reduce-motion');

      /* --- Pfeil-Zustaende ---
         scrollTo mit 'instant' statt scrollLeft=: das CSS der Reihe steht
         auf scroll-behavior:smooth, eine direkte Zuweisung wuerde animiert
         und im unsichtbaren Fenster nie ankommen. */
      /* Bis ans Ende blaettern und pruefen, ob die Pfeile mitkommen.
         Wichtig: ein overflow:hidden-Container feuert keine scroll-Events,
         die Zustaende muessen also aktiv nachgefuehrt werden. */
      prefs.reduceMotion = true;
      document.documentElement.classList.add('reduce-motion');

      // Erst wegblaettern, dann zurueck — sonst passiert beim prev-Klick
      // nichts, weil die Reihe schon am Anfang steht.
      nextBtn.click();
      await wait(150);
      prevBtn.click();
      // 600 statt 200: der Nachschlag der App kommt erst nach 420 ms,
      // weil requestAnimationFrame in unsichtbaren Fenstern ruht.
      await wait(600);
      check('Am Anfang ist prev aus', prevBtn.classList.contains('off'),
            'scrollLeft ' + scroll.scrollLeft);
      check('Am Anfang ist next an', !nextBtn.classList.contains('off'));

      /* So lange klicken, bis das Ende erreicht ist.

         Die Zahl der noetigen Klicks haengt von der Fensterbreite ab:
         je schmaler, desto weniger Kacheln pro Seite und desto mehr
         Klicks. Eine feste Obergrenze (frueher 12) reichte auf
         schmaleren Fenstern nicht — der Test scheiterte dann, obwohl
         die Pfeile korrekt arbeiteten.

         Abbruch jetzt daran, dass sich nichts mehr bewegt: das ist
         das eigentliche Kriterium und gilt bei jeder Breite. */
      let lastLeft = -1;
      let stuck = 0;

      // Obergrenze aus der tatsaechlichen Geometrie statt fester Zahl:
      // so viele Klicks, wie hoechstens noetig sind, plus Reserve.
      const perClick = Math.max(1, scroll.clientWidth - 60);
      const maxClicks = Math.ceil(scroll.scrollWidth / perClick) + 5;

      for (let i = 0; i < maxClicks && !nextBtn.classList.contains('off') && stuck < 3; i++) {
        nextBtn.click();
        await wait(120);
        if (scroll.scrollLeft === lastLeft) stuck += 1;
        else stuck = 0;
        lastLeft = scroll.scrollLeft;
      }

      /* Dem Nachschlag Zeit lassen: die App führt die Pfeil-Zustände
         über requestAnimationFrame nach, das in unsichtbaren Fenstern
         ruht — dort greift erst der Zeitgeber nach 420 ms. Ohne dieses
         Warten prüft der Test, bevor die App fertig ist. */
      await wait(600);

      // Verkettung statt Template-Literal: der gesamte Testcode steckt
      // selbst in einem Literal, eine Interpolation wuerde dort greifen.
      const maxScroll = scroll.scrollWidth - scroll.clientWidth;
      check('Am Ende ist next aus', nextBtn.classList.contains('off'),
            'scrollLeft ' + scroll.scrollLeft + ' von max ' + maxScroll);
      check('Am Ende ist prev an', !prevBtn.classList.contains('off'));

      prefs.reduceMotion = motionBefore;
      document.documentElement.classList.remove('reduce-motion');

      /* --- Pfeile muessen ueber der Karte liegen --- */
      const arrowZ = Number(getComputedStyle(nextBtn).zIndex);
      const card = row.querySelector('.card');
      card.classList.add('force-hover');
      const cardZ = 10; // .card:hover
      check('Pfeil liegt ueber gehoverter Karte', arrowZ > cardZ, 'Pfeil ' + arrowZ + ' vs Karte ' + cardZ);
      card.classList.remove('force-hover');

      /* --- Treffergroesse des Pfeils --- */
      const arrowBox = nextBtn.getBoundingClientRect();
      check('Pfeil ist breit genug', arrowBox.width >= 50, arrowBox.width + 'px');
      check('Pfeil ist hoch genug', arrowBox.height > 60, arrowBox.height + 'px');

      /* ============ 4. MAUSRAD BLEIBT BEI DER SEITE ============ */

      // Ein wheel-Event auf der Reihe darf nicht abgefangen werden
      let defaultPrevented = false;
      const ev = new WheelEvent('wheel', {
        deltaY: 120, bubbles: true, cancelable: true
      });
      scroll.dispatchEvent(ev);
      defaultPrevented = ev.defaultPrevented;
      check('Mausrad wird nicht abgefangen', !defaultPrevented);

      const leftAfterWheel = scroll.scrollLeft;
      await wait(100);
      check('Mausrad verschiebt die Reihe nicht',
            Math.abs(scroll.scrollLeft - leftAfterWheel) < 2);

      /* ============ 5. HOVER-SKALIERUNG ============ */

      const inner = card.querySelector('.card-inner');
      const styles = getComputedStyle(inner);
      check('Karte hat Uebergang', styles.transitionDuration !== '0s', styles.transitionDuration);

      // Skalierung aus dem Stylesheet lesen statt echtes Hovern zu simulieren
      let scaleRule = null;
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        for (const rule of rules) {
          if (rule.selectorText === '.card:hover .card-inner') {
            scaleRule = rule.style.transform;
          }
        }
      }
      const scaleValue = scaleRule ? parseFloat(scaleRule.match(/[\\d.]+/)[0]) : 0;
      check('Hover-Skalierung ist moderat', scaleValue > 1 && scaleValue <= 1.08,
            'scale(' + scaleValue + ')');

      document.getElementById('view-root').innerHTML = '';
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
