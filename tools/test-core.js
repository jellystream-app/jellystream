/**
 * Wacht über die Trennung von Kern und Oberfläche.
 *
 * Der Kern (core/) muss ohne DOM auskommen — nur so können Desktop
 * und mobile App dieselbe Logik nutzen, ohne dass eine Funktion
 * zweimal gebaut werden muss. Schleicht sich ein DOM-Zugriff ein,
 * schlägt dieser Test fehl, bevor die Trennung still zerfällt.
 *
 * Aufruf:  node tools/test-core.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'core');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

/* Was im Kern nichts zu suchen hat */
const FORBIDDEN = [
  { pattern: /\bdocument\s*\./, name: 'document' },
  { pattern: /\bwindow\s*\.\s*(location|history|alert|confirm)/, name: 'Browser-Fenster' },
  { pattern: /querySelector|getElementById/, name: 'DOM-Suche' },
  { pattern: /\.innerHTML|\.textContent\s*=/, name: 'DOM-Änderung' },
  { pattern: /addEventListener\s*\(\s*['"]click/, name: 'Klick-Handler' },
  { pattern: /\bclassList\b/, name: 'CSS-Klassen' },
  { pattern: /\brequire\s*\(\s*['"]electron/, name: 'Electron' }
];

/* Erlaubt: die Brücken sind bewusst optional abgefragt und
   funktionieren auf beiden Plattformen (bzw. fehlen sauber). */
const ALLOWED_GLOBALS = ['window.languages', 'window.downloads', 'window.appInfo'];

let files = [];
try {
  files = fs.readdirSync(CORE).filter((f) => f.endsWith('.js'));
} catch (error) {
  check('core/ existiert', false, error.message);
}

check('core/ enthält Dateien', files.length > 0, files.join(', '));

files.forEach((name) => {
  const file = path.join(CORE, name);
  let text = fs.readFileSync(file, 'utf8');

  // Kommentare entfernen: dort darf DOM erwähnt werden
  text = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Erlaubte Brücken ausblenden
  ALLOWED_GLOBALS.forEach((g) => {
    text = text.split(g).join('BRIDGE');
  });

  FORBIDDEN.forEach(({ pattern, name: what }) => {
    const match = text.match(pattern);
    check(`${name}: kein ${what}`, !match, match ? `gefunden: ${match[0]}` : '');
  });
});

/* Die Oberflächen dürfen den Kern nutzen — aber der Kern nicht sie. */
const uiFiles = ['renderer.js', 'player.js', 'settings.js', 'offline.js', 'i18n-dom.js'];
const coreNames = files.map((f) => f.replace('.js', ''));

files.forEach((name) => {
  const text = fs.readFileSync(path.join(CORE, name), 'utf8');
  const badImport = uiFiles.find((ui) =>
    new RegExp(`require\\(['"].*${ui.replace('.js', '')}`).test(text));
  check(`${name}: hängt nicht an der Oberfläche`, !badImport, badImport || '');
});

/* Gegenprobe: die Kernfunktionen müssen überhaupt aufrufbar sein.
   Ein Kern, den niemand nutzt, wäre eine hübsche, aber nutzlose Datei. */
const rendererText = fs.readFileSync(path.join(ROOT, 'renderer.js'), 'utf8');
const playerText = fs.readFileSync(path.join(ROOT, 'player.js'), 'utf8');
const allUi = rendererText + playerText +
  fs.readFileSync(path.join(ROOT, 'i18n-dom.js'), 'utf8');

check('Desktop nutzt t() aus dem Kern', /\bt\(/.test(allUi));
check('Desktop nutzt die Wiedergabe-Aushandlung',
  /fetchPlaybackInfo|resolveStream/.test(playerText));

/* index.html muss den Kern VOR der Oberfläche laden */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const coreIdx = html.indexOf('core/i18n.js');
const uiIdx = html.indexOf('renderer.js');
check('Kern wird vor der Oberfläche geladen',
  coreIdx >= 0 && coreIdx < uiIdx, `core bei ${coreIdx}, renderer bei ${uiIdx}`);

results.forEach((r) => {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
