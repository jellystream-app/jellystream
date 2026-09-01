/**
 * Testet den Download-Manager gegen einen lokalen HTTP-Server:
 * echter Download, Fortschritt, Abbruch, Loeschen, Namensgebung.
 *
 * Aufruf:  npx electron tools/test-downloads.js
 */
const { app } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// Der Manager schreibt in userData — dafuer einen Wegwerf-Ordner setzen
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-dl-test-'));
app.setPath('userData', tmp);

const downloads = require('../downloads');

// Testserver: liefert 5 MB in Haeppchen, plus eine 404-Route
const PAYLOAD = 5 * 1024 * 1024;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/missing')) {
    res.writeHead(404);
    return res.end('nope');
  }
  if (req.url.startsWith('/slow')) {
    // Langsam, damit der Abbruch mitten im Transfer greift
    res.writeHead(200, { 'Content-Length': String(PAYLOAD) });
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= PAYLOAD) { clearInterval(timer); return res.end(); }
      res.write(Buffer.alloc(64 * 1024));
      sent += 64 * 1024;
    }, 40);
    req.on('close', () => clearInterval(timer));
    return;
  }
  res.writeHead(200, { 'Content-Length': String(PAYLOAD) });
  res.end(Buffer.alloc(PAYLOAD, 7));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForState(id, wanted, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const entry = downloads.list().find((e) => e.id === id);
    if (entry && entry.state === wanted) return entry;
    await wait(120);
  }
  return downloads.list().find((e) => e.id === id) || null;
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  let progressSeen = 0;
  downloads.init((msg) => {
    if (msg.type === 'progress') progressSeen += 1;
  });

  /* --- 1. Normaler Download eines Films --- */
  const movie = downloads.start({
    itemId: 'movie-1',
    name: 'Der Test: Film / mit "Zeichen"',
    type: 'Movie',
    year: 2024,
    url: `${base}/video.mkv`,
    quality: 'Original',
    container: 'mkv',
    expectedSize: PAYLOAD
  });

  const done = await waitForState(movie.entry.id, 'done');
  check('Film wird heruntergeladen', done && done.state === 'done', done && done.state);
  check('Groesse stimmt', done && done.size === PAYLOAD, done && `${done.size} statt ${PAYLOAD}`);
  check('Datei liegt auf der Platte', done && fs.existsSync(done.file));
  check('Fortschritt wurde gemeldet', progressSeen > 0, `${progressSeen} Meldungen`);

  // Verbotene Zeichen duerfen nicht im Dateinamen landen
  const baseName = done ? path.basename(done.file) : '';
  check('Dateiname ist windowstauglich', !/[\\/:*?"<>|]/.test(baseName), baseName);
  check('Keine .part-Leiche', done && !fs.existsSync(`${done.file}.part`));

  /* --- 2. Serienfolge: Benennung mit S/E --- */
  const episode = downloads.start({
    itemId: 'ep-1',
    name: 'Die erste Folge',
    type: 'Episode',
    seriesName: 'Testserie',
    season: 2,
    episode: 5,
    url: `${base}/ep.mp4`,
    container: 'mp4'
  });

  const epDone = await waitForState(episode.entry.id, 'done');
  const epName = epDone ? path.basename(epDone.file) : '';
  check('Folge nach Schema benannt', epName.includes('S02E05'), epName);

  /* --- 3. Doppelter Download wird erkannt --- */
  const dup = downloads.start({
    itemId: 'movie-1',
    name: 'Der Test',
    url: `${base}/video.mkv`,
    container: 'mkv'
  });
  check('Doppelter Download wird abgefangen', dup.duplicate === true);

  /* --- 4. Fehlerfall 404 --- */
  const bad = downloads.start({
    itemId: 'movie-404',
    name: 'Gibt es nicht',
    url: `${base}/missing.mkv`,
    container: 'mkv'
  });
  const failed = await waitForState(bad.entry.id, 'failed');
  check('404 fuehrt zu Fehlerstatus', failed && failed.state === 'failed', failed && failed.error);
  check('Keine Datei nach Fehler', failed && !fs.existsSync(failed.file));

  /* --- 5. Abbruch mitten im Transfer --- */
  const slow = downloads.start({
    itemId: 'movie-slow',
    name: 'Langsamer Film',
    url: `${base}/slow.mkv`,
    container: 'mkv'
  });
  await waitForState(slow.entry.id, 'running', 5000);
  await wait(300);
  downloads.cancel(slow.entry.id);
  await wait(400);

  const cancelled = downloads.list().find((e) => e.id === slow.entry.id);
  check('Abbruch setzt Status', cancelled && cancelled.state === 'failed', cancelled && cancelled.error);
  check('Abbruch raeumt .part weg', cancelled && !fs.existsSync(`${cancelled.file}.part`));

  /* --- 6. Speicherverbrauch --- */
  const usage = downloads.usage();
  check('Belegter Speicher wird gezaehlt', usage.bytes === PAYLOAD * 2, `${usage.bytes}`);
  check('Anzahl stimmt', usage.count === 2, `${usage.count}`);

  /* --- 7. Loeschen entfernt Datei und Eintrag --- */
  const fileBefore = done.file;
  downloads.remove(done.id);
  await wait(200);
  check('Loeschen entfernt die Datei', !fs.existsSync(fileBefore));
  check('Loeschen entfernt den Eintrag', !downloads.list().some((e) => e.id === done.id));

  /* --- 8. verify() erkennt von aussen geloeschte Dateien --- */
  fs.unlinkSync(epDone.file);
  const verified = downloads.verify();
  const epAfter = verified.find((e) => e.id === epDone.id);
  check('verify() merkt fehlende Datei', epAfter && epAfter.state === 'failed', epAfter && epAfter.error);

  /* --- 9. Katalog ueberlebt einen Neustart --- */
  const catalogPath = path.join(tmp, 'downloads.json');
  const saved = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  check('Katalog wurde geschrieben', Array.isArray(saved.items) && saved.items.length > 0);

  server.close();

  const failedCount = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failedCount}/${results.length} bestanden`);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) { /* Windows haelt evtl. noch Handles */ }

  app.exit(failedCount ? 1 : 0);
});
