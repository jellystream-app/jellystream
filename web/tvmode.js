/* ========================== SOFA-MODUS ==========================
   Bedienung vom Sofa: Pfeiltasten (oder Fernbedienung, die sich als
   Tastatur meldet) und Gamepad bewegen den Fokus raeumlich — zum
   naechsten Element in der gedrueckten Richtung, nicht stur in
   Tab-Reihenfolge. Enter/A waehlt, Escape/B geht zurueck.

   Mit eingeschaltetem Sofa-Modus (Einstellungen → Darstellung) kommen
   groessere Fokusrahmen und Schrift dazu. Das Gamepad funktioniert
   immer, sobald eines angeschlossen ist — wer einen Controller in die
   Hand nimmt, will ihn auch benutzen.

   Ausserhalb: Video-Player und Musik-Vollbild haben eigene Tasten
   (player.js), Eingabefelder bekommen ihre Pfeiltasten selbst.
   Wird nach settings.js geladen.
   ================================================================ */

const tv = {
  pads: new Map(),      // index → { buttons: [], axes: [], repeatAt }
  raf: 0,
  lastFocus: null
};

/* Alles, was man anwaehlen kann: Knoepfe, Links, Felder und alles
   mit tabindex=0 (Kacheln, Folgen, Titel). Ausgeblendete fallen in
   isVisible() heraus. */
const FOCUSABLE = [
  'button:not([tabindex="-1"])', 'a[href]', 'select', 'input:not([type="hidden"])', '[tabindex="0"]'
].join(',');

function isVisible(node) {
  if (!node.isConnected || node.disabled) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight * 3) return false;
  return node.closest('.hidden') === null && getComputedStyle(node).visibility !== 'hidden';
}

/** Wo gerade Bedienung stattfindet: offenes Menue, offener Dialog,
 *  sonst die ganze App. So springt der Fokus nicht aus einem Menue
 *  hinaus in die Kacheln dahinter. */
function focusScope() {
  return document.querySelector('.context-menu')
    || document.querySelector('.dropdown-menu:not(.hidden)')
    || document.querySelector('.modal:not(.hidden), .settings-overlay:not(.hidden)')
    || (el.loginScreen.classList.contains('hidden') ? el.appShell : el.loginScreen);
}

function candidates() {
  return [...focusScope().querySelectorAll(FOCUSABLE)].filter(isVisible);
}

/** Naechstes Element in einer Richtung.
 *
 *  Gewertet wird der Abstand in Laufrichtung plus der seitliche
 *  Versatz (doppelt gewichtet). So landet "rechts" in derselben Reihe
 *  statt schraeg in der naechsten, und "runter" bei der Kachel darunter
 *  statt bei der ersten der naechsten Reihe. */
function nextInDirection(from, dir) {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best = null;
  let bestScore = Infinity;

  candidates().forEach((node) => {
    if (node === from || from.contains(node) || node.contains(from)) return;
    const b = node.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;

    let along;
    let across;
    if (dir === 'right') { along = b.left - a.right + a.width / 2; across = Math.abs(dy); if (dx <= 4) return; }
    if (dir === 'left') { along = a.left - b.right + a.width / 2; across = Math.abs(dy); if (dx >= -4) return; }
    if (dir === 'down') { along = b.top - a.bottom + a.height / 2; across = Math.abs(dx); if (dy <= 4) return; }
    if (dir === 'up') { along = a.top - b.bottom + a.height / 2; across = Math.abs(dx); if (dy >= -4) return; }

    const score = Math.max(0, along) + across * 2;
    if (score < bestScore) {
      bestScore = score;
      best = node;
    }
  });
  return best;
}

function focusNode(node) {
  if (!node) return false;
  node.focus({ preventScroll: true });
  // Kacheln in Reihen: die Reihe selbst seitwaerts mitnehmen
  node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefs.reduceMotion ? 'auto' : 'smooth' });
  tv.lastFocus = node;
  return true;
}

/** Eine Richtung ausfuehren. true = behandelt. */
function moveFocus(dir) {
  const current = document.activeElement;
  const inScope = current && current !== document.body && focusScope().contains(current) && isVisible(current);
  if (!inScope) {
    // Noch nichts fokussiert: beim zuletzt benutzten oder beim ersten Element anfangen
    const start = (tv.lastFocus && isVisible(tv.lastFocus) && focusScope().contains(tv.lastFocus))
      ? tv.lastFocus
      : candidates()[0];
    return focusNode(start);
  }
  return focusNode(nextInDirection(current, dir));
}

function mediaOverlayOpen() {
  return !vp.root.classList.contains('hidden') || !$('music-full').classList.contains('hidden');
}

const KEY_DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

document.addEventListener('keydown', (event) => {
  const dir = KEY_DIRS[event.key];
  if (!dir || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target;
  if (target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  if (mediaOverlayOpen()) return;
  // Das Kontextmenue regelt Hoch/Runter selbst
  if (target.closest?.('.context-menu')) return;

  /* Ohne Sofa-Modus nur, wenn schon etwas Bedienbares den Fokus hat —
     sonst wuerden die Pfeiltasten das gewohnte Scrollen der Seite
     ersetzen, auch fuer Mausnutzer. */
  if (!prefs.tvMode && (target === document.body || !target.matches?.(FOCUSABLE))) return;

  if (moveFocus(dir)) event.preventDefault();
}, true);

/* ------------------------- Gamepad -------------------------
   Standard-Belegung (Xbox/PlayStation ueber den Browser):
   0 A/Kreuz = waehlen, 1 B/Kreis = zurueck, 9 Start = Play/Pause,
   12–15 Steuerkreuz, Achsen 0/1 linker Stick. */

const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const REPEAT_FIRST = 380;
const REPEAT_NEXT = 120;

function key(name) {
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
}

function padDirection(pad) {
  const b = (i) => pad.buttons[i]?.pressed;
  const [x = 0, y = 0] = pad.axes;
  if (b(PAD.UP) || y < -0.6) return 'up';
  if (b(PAD.DOWN) || y > 0.6) return 'down';
  if (b(PAD.LEFT) || x < -0.6) return 'left';
  if (b(PAD.RIGHT) || x > 0.6) return 'right';
  return null;
}

function pressed(prev, pad, index) {
  return pad.buttons[index]?.pressed && !prev.buttons[index];
}

function handleDirection(dir) {
  if (mediaOverlayOpen()) {
    // Im Player: links/rechts spulen, hoch/runter Lautstaerke — wie die Tastatur
    key({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[dir]);
    return;
  }
  if (document.activeElement?.closest?.('.context-menu') && (dir === 'up' || dir === 'down')) {
    key(dir === 'up' ? 'ArrowUp' : 'ArrowDown');
    return;
  }
  moveFocus(dir);
}

function goBack() {
  // Von innen nach aussen: Menue, Dialog, Player, dann eine Ansicht zurueck
  if (document.querySelector('.context-menu')) return key('Escape');
  if (document.querySelector('.dropdown-menu:not(.hidden)')) return closeMenus();
  if (document.querySelector('.modal:not(.hidden), .settings-overlay:not(.hidden)')) return key('Escape');
  if (mediaOverlayOpen()) return key('Escape');
  if (!el.backBtn.classList.contains('hidden')) el.backBtn.click();
}

function pollPads() {
  tv.raf = 0;
  const now = performance.now();
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  if (!pads.length) return;

  pads.forEach((pad) => {
    const prev = tv.pads.get(pad.index) || { buttons: [], dir: null, repeatAt: 0 };
    const dir = padDirection(pad);

    if (dir && (dir !== prev.dir || now >= prev.repeatAt)) {
      handleDirection(dir);
      prev.repeatAt = now + (dir !== prev.dir ? REPEAT_FIRST : REPEAT_NEXT);
    }
    prev.dir = dir;

    if (pressed(prev, pad, PAD.A)) {
      const target = document.activeElement;
      if (mediaOverlayOpen() && (!target || target === document.body)) key(' ');
      else if (target && target !== document.body) target.click();
      else moveFocus('down');
    }
    if (pressed(prev, pad, PAD.B)) goBack();
    if (pressed(prev, pad, PAD.START)) {
      if (mediaOverlayOpen()) key(' ');
      else if (typeof mediaControl !== 'undefined') mediaControl.playPause();
    }
    if (pressed(prev, pad, PAD.Y) && document.activeElement?.classList.contains('card')) {
      // Y = Kontextmenue der Kachel, wie die Menue-Taste
      key('ContextMenu');
    }
    if (pressed(prev, pad, PAD.LB) && mediaOverlayOpen()) key('p');
    if (pressed(prev, pad, PAD.RB) && mediaOverlayOpen()) key('n');

    prev.buttons = pad.buttons.map((b) => b.pressed);
    tv.pads.set(pad.index, prev);
  });

  tv.raf = requestAnimationFrame(pollPads);
}

window.addEventListener('gamepadconnected', () => {
  document.documentElement.classList.add('has-gamepad');
  if (!tv.raf) tv.raf = requestAnimationFrame(pollPads);
});

window.addEventListener('gamepaddisconnected', (event) => {
  tv.pads.delete(event.gamepad.index);
  const any = navigator.getGamepads && [...navigator.getGamepads()].some(Boolean);
  if (!any) {
    document.documentElement.classList.remove('has-gamepad');
    cancelAnimationFrame(tv.raf);
    tv.raf = 0;
  }
});

function applyTvMode() {
  document.documentElement.classList.toggle('tv-mode', Boolean(prefs.tvMode));
}
applyTvMode();
