/**
 * Stellt web/ zusammen — die Desktop-Oberfläche als hostbare Website.
 *
 * web/ ist eine Kopie von index.html, styles.css und den Skripten.
 * Ohne dieses Werkzeug würde die Kopie beim ersten Bugfix am Original
 * auseinanderlaufen, ohne dass es jemand merkt. Deshalb wird sie
 * erzeugt, nicht von Hand gepflegt.
 *
 * Anders als www/ (Capacitor, .gitignore) gehört web/ ins Repo:
 * es soll sich direkt hosten lassen.
 *
 * Aufruf:  node tools/build-web.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function copyDir(from, to, filter) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from).forEach((name) => {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dest, filter);
    else if (!filter || filter(name)) fs.copyFileSync(src, dest);
  });
}

// Sauber neu aufbauen: alte Reste würden sonst mitwandern
fs.rmSync(WEB, { recursive: true, force: true });
fs.mkdirSync(WEB, { recursive: true });

/* --- Oberfläche und Logik, unverändert --- */
['index.html', 'styles.css', 'renderer.js', 'settings.js', 'player.js',
 'offline.js', 'i18n-dom.js'].forEach((f) => {
  fs.copyFileSync(path.join(ROOT, f), path.join(WEB, f));
});

/* --- Der geteilte Kern --- */
copyDir(path.join(ROOT, 'core'), path.join(WEB, 'core'));

/* --- Sprachen: core/i18n.js holt sie ohne Brücke per fetch --- */
copyDir(path.join(ROOT, 'language'), path.join(WEB, 'language'), (n) => n.endsWith('.json'));

/* --- Symbole --- */
copyDir(path.join(ROOT, 'build', 'icons'), path.join(WEB, 'icons'), (n) => n.endsWith('.png'));

/* ==================================================================
   Die Web-Brücke

   preload.js reicht im Desktop sechs Objekte in den Renderer. Im
   Browser gibt es die nicht. Der Renderer ist darauf vorbereitet —
   überall `?.` und `if (!bridge) return` — mit einer Ausnahme:
   renderer.js liest window.appInfo?.version direkt beim Laden.

   Bereitgestellt wird deshalb nur appInfo. Die übrigen Brücken
   bleiben bewusst undefiniert: der Renderer prüft auf ihre Existenz,
   um genau die Bedienelemente auszublenden, die im Browser nicht
   funktionieren (Downloads, Discord, Updater, Sprachordner). Eine
   Attrappe würde Knöpfe zeigen, die ins Leere greifen.
   ================================================================== */
const bridge = `/* ============================================================
   Web-Bruecke — ERZEUGT von tools/build-web.js, nicht bearbeiten.

   Ersetzt im Browser das, was im Desktop preload.js liefert.
   Bereitgestellt wird nur appInfo: renderer.js liest es beim Laden.

   Absichtlich NICHT gesetzt werden windowControls, downloads,
   languages, discord und updater. Der Renderer prueft auf sie, um
   die Bedienelemente auszublenden, die ein Browser nicht erfuellen
   kann — kein Fenster zu steuern, kein Dateisystem, kein lokaler
   Socket, keine selbst eingespielten Updates. Attrappen wuerden
   Knoepfe zeigen, die ins Leere greifen.
   ============================================================ */

(() => {
  'use strict';

  window.appInfo = {
    name: ${JSON.stringify(pkg.build?.productName || 'Jellystream')},
    version: ${JSON.stringify(pkg.version)},
    platform: 'web'
  };

  /* Die selbstgezeichnete Titelleiste steuert ein Electron-Fenster.
     Im Browser-Tab gibt es keins — styles.css blendet sie ueber
     diese Klasse aus und setzt --tb-height auf 0. */
  document.documentElement.classList.add('is-web');
})();
`;
fs.writeFileSync(path.join(WEB, 'web-bridge.js'), bridge);

/* --- Das Manifest: macht die Seite installierbar --- */
fs.writeFileSync(path.join(WEB, 'manifest.webmanifest'), JSON.stringify({
  name: 'Jellystream',
  short_name: 'Jellystream',
  description: 'Schlanker Client für deinen Jellyfin-Medienserver.',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#101317',
  theme_color: '#101317',
  icons: [
    { src: 'icons/128x128.png', sizes: '128x128', type: 'image/png' },
    { src: 'icons/256x256.png', sizes: '256x256', type: 'image/png' },
    { src: 'icons/512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
}, null, 2) + '\n');

/* GitHub Pages laesst sonst Ordner mit Unterstrich aus. Kostet nichts,
   erspart aber eine schwer zu findende Fehlersuche. */
fs.writeFileSync(path.join(WEB, '.nojekyll'), '');

/* Die Anleitung liegt als Vorlage bei, weil dieses Werkzeug web/
   jedes Mal neu anlegt — sonst waere sie nach dem ersten Lauf weg. */
fs.copyFileSync(path.join(__dirname, 'web-readme.md'), path.join(WEB, 'README.md'));

/* ==================================================================
   index.html anpassen
   ================================================================== */
const indexPath = path.join(WEB, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const before = html;

/* Symbole liegen in web/ flach nebeneinander, nicht unter build/ */
html = html.replace(/src="build\/icons\//g, 'src="icons/');

/* Kopf: Favicon, Manifest — und die Bruecke VOR allen anderen
   Skripten, weil renderer.js window.appInfo beim Laden liest. */
html = html.replace(
  '    <link rel="stylesheet" href="styles.css" />',
  `    <meta name="description" content="Jellystream — schlanker Client für deinen Jellyfin-Medienserver." />
    <meta name="theme-color" content="#101317" />
    <link rel="icon" href="icons/128x128.png" />
    <link rel="apple-touch-icon" href="icons/256x256.png" />
    <link rel="manifest" href="manifest.webmanifest" />
    <link rel="stylesheet" href="styles.css" />
    <!-- Ersetzt die Electron-Bruecken. Muss vor allen anderen Skripten
         laufen: renderer.js liest window.appInfo beim Laden. -->
    <script src="web-bridge.js"></script>`
);

if (html === before) {
  console.error('FEHLER: keine Anpassung gegriffen — hat sich index.html geaendert?');
  process.exit(1);
}

/* Gegenprobe: die Bruecke muss vor renderer.js stehen, sonst startet
   die App mit Version 0.0.0 statt der echten. Verglichen werden die
   Script-Tags selbst — blosse Erwaehnungen im Kommentar zaehlen nicht. */
const tagPos = (file) => html.indexOf(`<script src="${file}">`);
if (tagPos('web-bridge.js') === -1 || tagPos('web-bridge.js') > tagPos('renderer.js')) {
  console.error('FEHLER: web-bridge.js laedt nicht vor renderer.js');
  process.exit(1);
}

fs.writeFileSync(indexPath, html);

/* ==================================================================
   styles.css ergaenzen
   ================================================================== */
const cssPath = path.join(WEB, 'styles.css');
fs.appendFileSync(cssPath, `
/* ==================================================================
   WEB-FASSUNG — angehaengt von tools/build-web.js

   Im Browser gibt es kein eigenes Fenster: die selbstgezeichnete
   Titelleiste haette nichts zu steuern. Sie wird ausgeblendet, und
   --tb-height faellt auf 0 — das gesamte Layout rechnet mit dieser
   Variablen (inset, margin-top, calc(100vh - ...)), deshalb genuegt
   dieser eine Wert, statt jede Regel einzeln anzufassen.
   ================================================================== */
html.is-web { --tb-height: 0px; }
html.is-web .titlebar { display: none; }
`);

/* ==================================================================
   Pruefen, dass alles Noetige da ist
   ================================================================== */
const required = [
  'index.html', 'styles.css', 'renderer.js', 'settings.js', 'player.js',
  'offline.js', 'i18n-dom.js', 'web-bridge.js', 'manifest.webmanifest',
  'core/api.js', 'core/i18n.js', 'core/playback.js',
  'language/en.json', 'language/de.json', 'language/index.json'
];

const missing = required.filter((f) => !fs.existsSync(path.join(WEB, f)));
if (missing.length) {
  console.error('FEHLER: fehlt in web/:', missing.join(', '));
  process.exit(1);
}

/* Jede im HTML angeforderte Datei muss existieren — sonst merkt man
   es erst, wenn die Seite im Browser weiss bleibt. */
const broken = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => !/^(https?:|data:|#)/.test(p))
  .filter((p) => !fs.existsSync(path.join(WEB, p)));

if (broken.length) {
  console.error('FEHLER: verweist auf fehlende Dateien:', broken.join(', '));
  process.exit(1);
}

/* Kein Pfad darf aus web/ herauszeigen */
const leftover = html.match(/(?:src|href)="\.\.\//g);
if (leftover) {
  console.error('FEHLER: Pfade zeigen aus web/ heraus:', leftover.join(', '));
  process.exit(1);
}

const count = fs.readdirSync(WEB, { recursive: true })
  .filter((f) => fs.statSync(path.join(WEB, f)).isFile()).length;

console.log(`web/ erstellt — ${count} Dateien, Version ${pkg.version}`);
console.log('  Hosten:  npx serve web');
