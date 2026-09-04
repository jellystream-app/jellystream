/**
 * Stellt www/ für Capacitor zusammen.
 *
 * Capacitor erwartet ein Verzeichnis mit index.html an der Wurzel.
 * Unsere mobile Fassung liegt in mobile/ und lädt den Kern über
 * ../core/ — beim Kopieren werden diese Pfade begradigt, damit
 * nichts außerhalb von www/ liegt.
 *
 * Aufruf:  node tools/build-mobile.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'www');

function copyDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((name) => {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    const stat = fs.statSync(src);

    if (stat.isDirectory()) {
      copyDir(src, dest, filter);
    } else if (!filter || filter(name)) {
      fs.copyFileSync(src, dest);
    }
  });
}

// Sauber neu aufbauen: alte Reste würden sonst mitwandern
fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(WWW, { recursive: true });

/* --- Die mobile Oberfläche an die Wurzel --- */
copyDir(path.join(ROOT, 'mobile'), WWW);

/* --- Der geteilte Kern --- */
copyDir(path.join(ROOT, 'core'), path.join(WWW, 'core'));
fs.copyFileSync(path.join(ROOT, 'i18n-dom.js'), path.join(WWW, 'i18n-dom.js'));

/* --- Sprachen: die App liest sie beim Start --- */
copyDir(path.join(ROOT, 'language'), path.join(WWW, 'language'), (n) => n.endsWith('.json'));

/* --- Symbole --- */
copyDir(path.join(ROOT, 'build', 'icons'), path.join(WWW, 'icons'), (n) => n.endsWith('.png'));

/* --- Pfade begradigen ---
   In mobile/index.html zeigen sie mit ../ nach oben; in www/ liegt
   alles nebeneinander. Ohne diesen Schritt lädt die App nichts. */
const indexPath = path.join(WWW, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const before = html;
html = html
  .replace(/src="\.\.\/core\//g, 'src="core/')
  .replace(/src="\.\.\/i18n-dom\.js"/g, 'src="i18n-dom.js"')
  .replace(/src="\.\.\/build\/icons\//g, 'src="icons/');

if (html === before) {
  console.warn('Warnung: keine Pfade angepasst — stimmt die Struktur noch?');
}

// Gegenprobe: kein ../ darf übrig bleiben
const leftover = html.match(/(?:src|href)="\.\.\//g);
if (leftover) {
  console.error('FEHLER: Pfade zeigen aus www/ heraus:', leftover.join(', '));
  process.exit(1);
}

fs.writeFileSync(indexPath, html);

/* --- Prüfen, dass alles Nötige da ist --- */
const required = [
  'index.html', 'mobile.css', 'mobile.js', 'player.js', 'settings.js',
  'core/api.js', 'core/i18n.js', 'core/playback.js', 'i18n-dom.js',
  'language/en.json', 'language/de.json'
];

const missing = required.filter((f) => !fs.existsSync(path.join(WWW, f)));
if (missing.length) {
  console.error('FEHLER: fehlt in www/:', missing.join(', '));
  process.exit(1);
}

/* Jede im HTML angeforderte Datei muss existieren — sonst merkt man
   es erst, wenn die App auf dem Gerät weiß bleibt. */
const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => !/^(https?:|data:)/.test(p));

const broken = referenced.filter((p) => !fs.existsSync(path.join(WWW, p)));
if (broken.length) {
  console.error('FEHLER: verweist auf fehlende Dateien:', broken.join(', '));
  process.exit(1);
}

/* --- Versionsnummer nach Android durchreichen ---
   Sonst stünde dort für immer 1.0, während die App bei 2.8 ist.
   versionCode muss eine steigende Ganzzahl sein: 2.8.0 -> 20800. */
const gradleFile = path.join(ROOT, 'android', 'app', 'build.gradle');

if (fs.existsSync(gradleFile)) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const [major, minor, patch] = pkg.version.split('.').map((n) => parseInt(n, 10) || 0);
  const versionCode = major * 10000 + minor * 100 + patch;

  let gradle = fs.readFileSync(gradleFile, 'utf8');
  gradle = gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${pkg.version}"`);
  fs.writeFileSync(gradleFile, gradle);

  console.log(`Android-Version: ${pkg.version} (Code ${versionCode})`);
}

const count = (dir) => fs.readdirSync(dir, { recursive: true })
  .filter((f) => fs.statSync(path.join(dir, f)).isFile()).length;

console.log(`www/ erstellt — ${count(WWW)} Dateien`);
console.log('  Oberfläche:', fs.readdirSync(WWW).filter((f) => f.endsWith('.js') || f.endsWith('.css')).join(', '));
console.log('  Kern:', fs.readdirSync(path.join(WWW, 'core')).join(', '));
console.log('  Sprachen:', fs.readdirSync(path.join(WWW, 'language')).join(', '));
