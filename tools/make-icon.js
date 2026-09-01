/**
 * Rendert logo.svg mit Chromium (Electron) in mehrere PNG-Groessen
 * und packt sie zu build/icon.ico.
 *
 * Aufruf:  npx electron tools/make-icon.js
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'logo.svg');
const BUILD_DIR = path.join(ROOT, 'build');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Baut eine ICO-Datei aus einer Liste von PNG-Buffern. */
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  entries.forEach((entry, i) => {
    const at = i * 16;
    // 256 wird als 0 kodiert
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0); // width
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1); // height
    dir.writeUInt8(0, at + 2);  // Farbpalette
    dir.writeUInt8(0, at + 3);  // reserved
    dir.writeUInt16LE(1, at + 4);  // color planes
    dir.writeUInt16LE(32, at + 6); // bits per pixel
    dir.writeUInt32LE(entry.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

const TMP_DIR = path.join(BUILD_DIR, '.tmp');
const MAX = Math.max(...SIZES);

/**
 * Ein einziges Fenster wird geoeffnet und fuer jede Groesse neu skaliert.
 * Wiederholtes loadFile() in frischen Fenstern schlaegt hier mit ERR_FAILED
 * fehl, und die SVG-Quelle muss per file:// kommen (Data-URL zu lang).
 */
async function createWindow() {
  const win = new BrowserWindow({
    width: MAX,
    height: MAX,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true, contextIsolation: true }
  });

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    img{display:block;image-rendering:auto}
  </style></head><body><img id="logo" src="./logo.svg" width="${MAX}" height="${MAX}"></body></html>`;

  const htmlPath = path.join(TMP_DIR, 'render.html');
  fs.writeFileSync(htmlPath, html);
  await win.loadFile(htmlPath);
  await new Promise((r) => setTimeout(r, 400));
  return win;
}

async function renderSize(win, size) {
  win.setContentSize(size, size);
  await win.webContents.executeJavaScript(`
    (() => {
      const el = document.getElementById('logo');
      el.width = ${size};
      el.height = ${size};
      document.documentElement.style.width = '${size}px';
      document.documentElement.style.height = '${size}px';
      document.body.style.width = '${size}px';
      document.body.style.height = '${size}px';
      return true;
    })()
  `);
  // Chromium Zeit fuer das Rastern der Vektoren geben
  await new Promise((r) => setTimeout(r, 300));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  const png = image.toPNG();

  if (!png || png.length === 0) throw new Error(`Rendern fehlgeschlagen bei ${size}px`);
  return png;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(SVG)) throw new Error('logo.svg nicht gefunden: ' + SVG);
    fs.mkdirSync(BUILD_DIR, { recursive: true });
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    fs.mkdirSync(TMP_DIR, { recursive: true });
    fs.copyFileSync(SVG, path.join(TMP_DIR, 'logo.svg'));

    const win = await createWindow();

    const entries = [];
    for (const size of SIZES) {
      const data = await renderSize(win, size);
      const check = nativeImage.createFromBuffer(data);
      const dim = check.getSize();
      console.log(`  ${size}px -> ${dim.width}x${dim.height}, ${data.length} bytes`);
      entries.push({ size, data });
      if (size === 256) fs.writeFileSync(path.join(BUILD_DIR, 'icon.png'), data);
    }

    win.destroy();

    const ico = buildIco(entries);
    fs.writeFileSync(path.join(BUILD_DIR, 'icon.ico'), ico);
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    console.log(`\nOK: build/icon.ico (${ico.length} bytes, ${entries.length} Groessen)`);
    console.log('OK: build/icon.png (256x256)');
    app.exit(0);
  } catch (err) {
    console.error('FEHLER:', err && err.message ? err.message : err);
    app.exit(1);
  }
});
