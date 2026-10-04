/**
 * Prueft die raeumliche Fokusbewegung und das Gamepad.
 *
 *   - Rechts bleibt in derselben Reihe, Runter landet in der Reihe darunter
 *   - Ohne Sofa-Modus uebernehmen die Pfeiltasten nur, wenn schon etwas
 *     fokussiert ist — Mausnutzer behalten das normale Scrollen
 *   - Ein offenes Menue haelt den Fokus fest
 *   - Gamepad: Steuerkreuz bewegt, A waehlt, B geht zurueck
 *   - Folgen sind per Tastatur erreichbar und startbar
 *
 * Das Gamepad wird ueber navigator.getGamepads nachgestellt.
 *
 * Aufruf:  npx electron tools/test-tvmode.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const ROOT = path.join(__dirname, '..');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  await win.loadFile(path.join(ROOT, 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const press = (k) => (document.activeElement || document.body)
        .dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

      state.serverUrl = 'http://test.local';
      state.userId = 'u1';
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');

      const calls = [];
      const realOpen = openItem;
      openItem = (item) => calls.push('open:' + item.Id);

      /* Zwei Reihen mit je vier Kacheln */
      el.viewRoot.innerHTML = '';
      const mk = (p) => Array.from({ length: 4 }, (_, i) => ({ Id: p + i, Name: p + i, Type: 'Movie', UserData: {} }));
      el.viewRoot.appendChild(buildRow('Oben', mk('a')));
      el.viewRoot.appendChild(buildRow('Unten', mk('b')));
      await wait(100);
      const card = (id) => [...document.querySelectorAll('.card')].find((c) => c.getAttribute('aria-label')?.startsWith(id));

      /* ---------- Ohne Sofa-Modus ---------- */
      prefs.tvMode = false;
      applyTvMode();
      document.activeElement?.blur();
      const before = document.activeElement;
      press('ArrowDown');
      check('Ohne Sofa-Modus und ohne Fokus: Pfeil scrollt normal', document.activeElement === before);

      card('a0').focus();
      press('ArrowRight');
      check('Mit Fokus auf einer Kachel wandert er trotzdem', document.activeElement === card('a1'),
        document.activeElement?.getAttribute('aria-label'));

      /* ---------- Sofa-Modus ---------- */
      prefs.tvMode = true;
      applyTvMode();
      check('Sofa-Modus setzt die Klasse', document.documentElement.classList.contains('tv-mode'));

      card('a1').focus();
      press('ArrowDown');
      check('Runter: Kachel darunter, nicht die erste der Reihe', document.activeElement === card('b1'),
        document.activeElement?.getAttribute('aria-label'));
      press('ArrowRight');
      check('Rechts: in derselben Reihe', document.activeElement === card('b2'),
        document.activeElement?.getAttribute('aria-label'));
      press('ArrowUp');
      check('Hoch: zurueck in die obere Reihe', document.activeElement === card('a2'),
        document.activeElement?.getAttribute('aria-label'));

      /* Eingabefelder behalten ihre Pfeiltasten */
      el.searchInput.focus();
      press('ArrowDown');
      check('Im Suchfeld bleibt der Fokus', document.activeElement === el.searchInput);

      /* Menue haelt den Fokus fest */
      card('a0').focus();
      press('ContextMenu');
      await wait(30);
      const menu = document.querySelector('.context-menu');
      press('ArrowRight');
      check('Im Kontextmenue verlaesst Rechts das Menue nicht', menu.contains(document.activeElement));
      press('Escape');

      /* ---------- Gamepad ---------- */
      const pad = { index: 0, buttons: Array.from({ length: 17 }, () => ({ pressed: false })), axes: [0, 0, 0, 0] };
      navigator.getGamepads = () => [pad];
      window.dispatchEvent(new Event('gamepadconnected'));
      /* Ein Fenster ohne Anzeige liefert nur etwa ein Bild pro Sekunde —
         jedes gehaltene Bild zaehlte dann als Tastenwiederholung. Deshalb
         wird pollPads direkt aufgerufen: ein Aufruf = ein Bild. */
      const frame = async () => { cancelAnimationFrame(tv.raf); pollPads(); await wait(5); };
      const tap = async (i) => { pad.buttons[i].pressed = true; await frame(); pad.buttons[i].pressed = false; await frame(); };

      check('Gamepad wird erkannt', document.documentElement.classList.contains('has-gamepad'));

      card('a0').focus();
      await tap(15); // rechts
      check('Steuerkreuz bewegt den Fokus', document.activeElement === card('a1'),
        document.activeElement?.getAttribute('aria-label'));

      // Gehalten: erst nach der Verzoegerung wiederholen
      card('a0').focus();
      pad.buttons[15].pressed = true;
      await frame();
      await frame();
      check('Gehalten: nicht sofort wiederholen', document.activeElement === card('a1'),
        document.activeElement?.getAttribute('aria-label'));
      await wait(420);
      await frame();
      check('Gehalten: nach der Verzoegerung weiter', document.activeElement === card('a2'),
        document.activeElement?.getAttribute('aria-label'));
      pad.buttons[15].pressed = false;
      await frame();

      card('a1').focus();
      pad.axes[1] = 1; await frame(); pad.axes[1] = 0; await frame();
      check('Linker Stick bewegt ebenso', document.activeElement === card('b1'),
        document.activeElement?.getAttribute('aria-label'));

      calls.length = 0;
      await tap(0); // A
      check('A waehlt die Kachel', calls.join() === 'open:b1', calls.join());

      el.backBtn.classList.remove('hidden');
      let back = 0;
      const realBack = el.backBtn.onclick;
      el.backBtn.addEventListener('click', () => { back += 1; }, { once: true });
      await tap(1); // B
      check('B geht zurueck', back === 1);

      /* ---------- Folgen per Tastatur ---------- */
      const played = [];
      const realPlayVideo = playVideo;
      playVideo = (ep) => played.push(ep.Id);
      const row = buildEpisodeRow({ Id: 'ep1', Name: 'Folge', RunTimeTicks: 0, UserData: {} }, []);
      el.viewRoot.appendChild(row);
      check('Folge ist fokussierbar', row.tabIndex === 0 && row.getAttribute('role') === 'button');
      row.focus();
      press('Enter');
      check('Enter startet die Folge', played.join() === 'ep1', played.join());

      playVideo = realPlayVideo;
      openItem = realOpen;
      prefs.tvMode = false;
      applyTvMode();
      return out;
    })()
  `);

  results.forEach((r) => console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);
  app.exit(failed ? 1 : 0);
});
