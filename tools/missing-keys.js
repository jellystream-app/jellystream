/**
 * Listet Uebersetzungsschluessel, die im Code benutzt werden, aber in
 * einer Sprachdatei fehlen.
 *
 * Gefunden werden t('...'), data-i18n="...", data-i18n-title/-placeholder
 * und labelKey: '...'. Dynamisch zusammengesetzte Schluessel
 * (t(`x.${y}`)) kann das nicht sehen — die prueft test-i18n zur Laufzeit.
 *
 * Aufruf:  node tools/missing-keys.js [de|en|...]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['index.html', 'renderer.js', 'player.js', 'settings.js', 'offline.js', 'profiles.js', 'syncplay-ui.js',
  'i18n-dom.js', ...fs.readdirSync(path.join(ROOT, 'core')).map((f) => `core/${f}`)];

const used = new Set();
const patterns = [
  // Mindestens ein Punkt: so faellt das Beispiel t('key', …) in Kommentaren raus
  /\bt\(\s*'([a-zA-Z0-9_]+\.[a-zA-Z0-9_.]+)'/g,
  /data-i18n(?:-[a-z]+)?="([a-zA-Z0-9_.]+)"/g,
  /labelKey:\s*'([a-zA-Z0-9_.]+)'/g
];

FILES.forEach((file) => {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  patterns.forEach((re) => {
    let m;
    while ((m = re.exec(text))) used.add(m[1]);
  });
});

const codes = process.argv.slice(2).length ? process.argv.slice(2) : ['de', 'en'];
let missing = 0;

codes.forEach((code) => {
  const strings = JSON.parse(fs.readFileSync(path.join(ROOT, 'language', `${code}.json`), 'utf8')).strings;
  const absent = [...used].filter((k) => !(k in strings)).sort();
  missing += absent.length;
  console.log(`=== ${code}: ${absent.length} fehlen`);
  absent.forEach((k) => console.log('  ' + k));
});

process.exit(missing ? 1 : 0);
