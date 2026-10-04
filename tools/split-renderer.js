/**
 * Einmaliges Werkzeug: zieht in sich geschlossene Ansichten aus
 * renderer.js in eigene Dateien unter views/.
 *
 * Alle Oberflaechen-Skripte teilen sich den globalen Gueltigkeitsbereich
 * (klassische <script>-Tags, kein Bundler). Eine Funktion in einer
 * anderen Datei ist deshalb genauso erreichbar wie vorher — solange die
 * Datei geladen ist, bevor jemand sie AUFRUFT. Die Ansichten werden erst
 * bei Navigation aufgerufen, also nach dem Laden aller Skripte.
 *
 * Verschoben werden nur Bereiche, die beim Laden nichts ausfuehren
 * (nur Funktionen und Konstanten). Das prueft das Werkzeug selbst.
 *
 * Aufruf:  node tools/split-renderer.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'renderer.js');
const EOL = '\r\n';

/* Von Marke bis (ausschliesslich) zur naechsten Marke */
const SPLITS = [
  {
    file: 'views/livetv.js',
    title: 'Live-TV: Kanaele mit laufender Sendung',
    from: '/* ========================= LIVE TV =========================',
    to: '/* ======================= SERIES / SEASONS ======================= */'
  },
  {
    file: 'views/music.js',
    title: 'Musik: Alben, Interpreten, Titelzeilen',
    from: '/* ======================= ALBUM / TRACKS ======================= */',
    to: '/* ============================ ROUTING ============================ */'
  },
  {
    file: 'views/stats.js',
    title: 'Statistik',
    from: '/* ============================ STATISTIKEN ============================ */',
    to: '/* --------------------------- NAVBAR --------------------------- */'
  },
  {
    file: 'views/calendar.js',
    title: 'Kalender und Reihe "Demnaechst"',
    from: '/** Reihe "Demnaechst" aus /Shows/Upcoming',
    to: 'function buildHeroSlider(items) {'
  },
  {
    file: 'views/cardmenu.js',
    title: 'Kontextmenue der Kacheln',
    from: '/* ======================== KONTEXTMENUE ========================',
    to: '// Ecken-Badge wie bei Prime'
  }
];

let src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
fs.mkdirSync(path.join(ROOT, 'views'), { recursive: true });

/* Fuehrt ein Stueck Code beim Laden etwas aus? Grob, aber fuer diesen
   Code ausreichend: Auf oberster Ebene duerfen nur Deklarationen,
   Kommentare und Leerzeilen stehen. */
function topLevelStatements(code) {
  const out = [];
  let depth = 0;
  let inBlockComment = false;
  let inString = null;
  let line = '';
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    const n = code[i + 1];
    if (inBlockComment) { if (c === '*' && n === '/') { inBlockComment = false; i += 1; } continue; }
    if (inString) {
      if (c === '\\') { i += 1; continue; }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '/' && n === '*') { inBlockComment = true; i += 1; continue; }
    if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i += 1; if (depth === 0) { out.push(line); line = ''; } continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; if (depth === 0) line += c; continue; }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    if (c === '}' || c === ')' || c === ']') depth -= 1;
    if (depth === 0 && c === '\n') { out.push(line); line = ''; continue; }
    if (depth === 0) line += c;
  }
  out.push(line);
  return out.map((l) => l.trim()).filter(Boolean);
}

const OK_START = /^(async\s+)?function\s|^(const|let)\s+\w+\s*=|^}\s*;?$|^\)\s*;?$|^\];?$|^;$/;

SPLITS.forEach((part) => {
  const a = src.indexOf(part.from);
  const b = src.indexOf(part.to, a + 1);
  if (a < 0 || b < 0) throw new Error(`Marke fehlt fuer ${part.file}`);
  const chunk = src.slice(a, b).replace(/\s+$/, '\n');

  const bad = topLevelStatements(chunk).filter((s) => !OK_START.test(s));
  if (bad.length) {
    throw new Error(`${part.file}: fuehrt beim Laden etwas aus — nicht verschiebbar:\n  ${bad.slice(0, 5).join('\n  ')}`);
  }

  const header = `/* ${part.title}.\n` +
    `   Aus renderer.js herausgeloest; teilt sich mit ihm den globalen\n` +
    `   Bereich (state, el, api, t, buildCard, …) und wird nach ihm geladen. */\n\n`;
  fs.writeFileSync(path.join(ROOT, part.file), (header + chunk).replace(/\n/g, EOL));
  src = src.slice(0, a) + src.slice(b);
  console.log(`${part.file}: ${chunk.split('\n').length} Zeilen`);
});

fs.writeFileSync(SRC, src.replace(/\n/g, EOL));
console.log(`renderer.js: ${src.split('\n').length} Zeilen`);
