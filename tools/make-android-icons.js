/**
 * Erzeugt die Android-Startsymbole aus logo.svg.
 *
 * Aufruf:  npx electron tools/make-android-icons.js
 *
 * Android braucht zwei Fassungen desselben Symbols:
 *
 * 1. Ab Android 8 (API 26) ein "adaptives" Symbol aus zwei Ebenen.
 *    Der Launcher schneidet daraus rund, eckig oder als Squircle zu —
 *    welche Form, entscheidet das Gerät. Deshalb liegt das Motiv nur
 *    in der inneren Sicherheitszone (66 von 108 dp); alles außerhalb
 *    kann abgeschnitten werden. Beide Ebenen entstehen als Vektor,
 *    damit sie in jeder Auflösung scharf bleiben.
 *
 * 2. Für Android 7 (API 24-25) — minSdk ist 24 — versteht der Launcher
 *    noch keine adaptiven Symbole. Die brauchen fertige PNG in fünf
 *    Auflösungen, einmal quadratisch und einmal rund.
 *
 * Gerendert wird mit Chromium (über Electron), genau wie beim
 * Desktop-Symbol in tools/make-icon.js: dieselbe Vorlage, dasselbe
 * Ergebnis, keine zusätzliche Abhängigkeit.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'logo.svg');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const TMP = path.join(ROOT, 'build', '.tmp-android');

/* Die fünf Auflösungsstufen. Der Launcher greift die passende heraus. */
const DENSITIES = [
  { dir: 'mipmap-mdpi', square: 48, round: 48 },
  { dir: 'mipmap-hdpi', square: 72, round: 72 },
  { dir: 'mipmap-xhdpi', square: 96, round: 96 },
  { dir: 'mipmap-xxhdpi', square: 144, round: 144 },
  { dir: 'mipmap-xxxhdpi', square: 192, round: 192 }
];

/* ==================== DAS MOTIV ====================

   Aus logo.svg: das Kamerazeichen im 24er-Raster. Die Vorlage setzt
   es aus zwei Teilen zusammen — dem Gehäuse (dort ein <rect>, das
   Android nicht kennt und das deshalb unten als Pfad steht) und dem
   ausgestellten Objektiv.

   Im Logo liegt hinter dem weißen Zeichen ein Stapel schwarzer
   Kopien, der einen weichen Schatten ergibt. Für das Startsymbol
   bleibt der weg: Bei 48 px verschmiert er zu einem grauen Rand,
   und Android legt ohnehin einen eigenen Schatten unter das Symbol. */

const LENS = 'M16,13 L21.223,16.482 A0.5,0.5 0 0 0 22,16.066 V7.87 ' +
             'A0.5,0.5 0 0 0 21.248,7.438 L16,10.5';

/* Das <rect width=14 height=12 x=2 y=6 rx=2> als Pfad. */
const BODY = 'M4,6 H14 A2,2 0 0 1 16,8 V16 A2,2 0 0 1 14,18 H4 ' +
             'A2,2 0 0 1 2,16 V8 A2,2 0 0 1 4,6 Z';

/* Maßstab im 108er-Raster des adaptiven Symbols.

   Entscheidend ist nicht die Breite, sondern der Abstand der
   entferntesten Ecke von der Mitte: Bei runder Maske bleibt nur ein
   Kreis von 33 dp Radius sicher sichtbar.

   Das Zeichen misst im 24er-Raster 20 x 12 Einheiten (x 2..22,
   y 6..18); mit der halben Strichbreite von 1 werden daraus 22 x 14,
   also 11 x 7 ab Mitte. Die Halbdiagonale beträgt damit 13.04
   Einheiten — mehr als 2.53 verträgt der Maßstab nicht.

   2.4 lässt etwas Luft für Launcher, die enger beschneiden als
   vorgesehen: Ecke bei 31.3 dp, Motivbreite 52.8 dp. */
const SCALE = 2.4;
const OFFSET = 54 - 12 * SCALE; // Motivmitte (12,12) auf 54,54 legen

/* Farben aus logo.svg */
const GRAD_FROM = '#2F0C4F';
const GRAD_TO = '#0D1833';

/* ==================== VEKTOREN ==================== */

function foregroundVector() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  Vordergrund des adaptiven Startsymbols: das Kamerazeichen aus
  logo.svg. Erzeugt von tools/make-android-icons.js — Änderungen
  gehören in logo.svg, nicht hierher.

  Das Motiv sitzt in der inneren Sicherheitszone (66 von 108 dp),
  weil der Launcher die Ränder je nach Gerät wegschneidet.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <group
        android:scaleX="${SCALE}"
        android:scaleY="${SCALE}"
        android:translateX="${OFFSET.toFixed(2)}"
        android:translateY="${OFFSET.toFixed(2)}">
        <path
            android:pathData="${BODY}"
            android:strokeColor="#FFFFFF"
            android:strokeWidth="2"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
        <path
            android:pathData="${LENS}"
            android:strokeColor="#FFFFFF"
            android:strokeWidth="2"
            android:strokeLineCap="round"
            android:strokeLineJoin="round" />
    </group>
</vector>
`;
}

function backgroundVector() {
  /* Der Verlauf aus logo.svg, von unten rechts nach oben links.
     Dort in Prozent angegeben, hier auf das 108er-Raster gerechnet. */
  const from = (85.355 / 100) * 108;
  const to = (14.645 / 100) * 108;

  return `<?xml version="1.0" encoding="utf-8"?>
<!--
  Hintergrund des adaptiven Startsymbols: der Verlauf aus logo.svg.
  Erzeugt von tools/make-android-icons.js.

  Füllt die volle Fläche von 108 dp, damit bei jeder Maskenform Farbe
  bis an den Rand steht — der Launcher schneidet daraus zu.
-->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path android:pathData="M0,0 H108 V108 H0 Z">
        <aapt:attr name="android:fillColor">
            <gradient
                android:type="linear"
                android:startX="${from.toFixed(2)}"
                android:startY="${from.toFixed(2)}"
                android:endX="${to.toFixed(2)}"
                android:endY="${to.toFixed(2)}">
                <item android:offset="0.16" android:color="${GRAD_FROM}" />
                <item android:offset="1.0" android:color="${GRAD_TO}" />
            </gradient>
        </aapt:attr>
    </path>
</vector>
`;
}

function adaptiveIcon() {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Erzeugt von tools/make-android-icons.js -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`;
}

/* ==================== PNG FÜR ÄLTERE GERÄTE ==================== */

/* Für Android 7: das vollständige Logo als Bild. Rund wird über eine
   kreisförmige Maske erzeugt — das Logo selbst hat abgerundete Ecken,
   die bei runder Maske sonst als Kanten stehen blieben. */
function pageHtml(size, round) {
  const clip = round
    ? `clip-path: circle(50% at 50% 50%);`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden;
              width:${size}px;height:${size}px}
    img{display:block;width:${size}px;height:${size}px;${clip}}
  </style></head><body><img id="logo" src="./logo.svg"></body></html>`;
}

async function renderPng(win, size, round) {
  const file = path.join(TMP, `r-${size}-${round ? 'r' : 's'}.html`);
  fs.writeFileSync(file, pageHtml(size, round));
  win.setContentSize(size, size);
  await win.loadFile(file);
  /* Chromium Zeit zum Rastern geben — wie in make-icon.js */
  await new Promise((r) => setTimeout(r, 250));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const png = image.toPNG();
  if (!png || png.length === 0) throw new Error(`Rendern fehlgeschlagen bei ${size}px`);
  return png;
}

/* ==================== ABLAUF ==================== */

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(SVG)) throw new Error('logo.svg nicht gefunden: ' + SVG);
    if (!fs.existsSync(RES)) throw new Error('android/app/src/main/res fehlt — läuft cap add?');

    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
    fs.copyFileSync(SVG, path.join(TMP, 'logo.svg'));

    /* --- Vektoren --- */
    const drawable = path.join(RES, 'drawable');
    fs.mkdirSync(drawable, { recursive: true });
    fs.writeFileSync(path.join(drawable, 'ic_launcher_foreground.xml'), foregroundVector());
    fs.writeFileSync(path.join(drawable, 'ic_launcher_background.xml'), backgroundVector());
    console.log('  drawable/ic_launcher_foreground.xml');
    console.log('  drawable/ic_launcher_background.xml');

    const anydpi = path.join(RES, 'mipmap-anydpi-v26');
    fs.mkdirSync(anydpi, { recursive: true });
    fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptiveIcon());
    fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptiveIcon());
    console.log('  mipmap-anydpi-v26/ic_launcher.xml');
    console.log('  mipmap-anydpi-v26/ic_launcher_round.xml');

    /* Die alte Vektor-Fassung lag unter drawable-v24 und würde die
       neue in drawable/ auf Android 7+ verdecken. */
    const stale = path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml');
    if (fs.existsSync(stale)) {
      fs.rmSync(stale);
      console.log('  drawable-v24/ic_launcher_foreground.xml entfernt (verdeckte die neue)');
      const dir = path.join(RES, 'drawable-v24');
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    }

    /* Die Farbe wird nicht mehr gebraucht: der Hintergrund ist jetzt
       ein Verlauf. Der Eintrag bliebe sonst als weiße Fläche liegen. */
    const colorFile = path.join(RES, 'values', 'ic_launcher_background.xml');
    if (fs.existsSync(colorFile)) {
      fs.rmSync(colorFile);
      console.log('  values/ic_launcher_background.xml entfernt (Farbe durch Verlauf ersetzt)');
    }

    /* --- PNG --- */
    const win = new BrowserWindow({
      width: 512, height: 512, show: false, frame: false,
      transparent: true, backgroundColor: '#00000000', useContentSize: true,
      webPreferences: { offscreen: true, contextIsolation: true }
    });

    for (const d of DENSITIES) {
      const dir = path.join(RES, d.dir);
      fs.mkdirSync(dir, { recursive: true });

      const square = await renderPng(win, d.square, false);
      fs.writeFileSync(path.join(dir, 'ic_launcher.png'), square);

      const round = await renderPng(win, d.round, true);
      fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), round);

      /* Das alte Vordergrund-PNG zeigt noch den Android-Roboter und
         wird von keiner Fassung mehr angefragt. */
      const fg = path.join(dir, 'ic_launcher_foreground.png');
      if (fs.existsSync(fg)) fs.rmSync(fg);

      console.log(`  ${d.dir}: ic_launcher.png + ic_launcher_round.png (${d.square}px)`);
    }

    win.destroy();
    fs.rmSync(TMP, { recursive: true, force: true });

    console.log('\nOK: Android-Startsymbole aus logo.svg erzeugt.');
    app.exit(0);
  } catch (err) {
    console.error('FEHLER:', err && err.message ? err.message : err);
    app.exit(1);
  }
});
