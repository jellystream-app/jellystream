/**
 * Traegt neue Uebersetzungen in die Sprachdateien ein, ohne vorhandene
 * zu ueberschreiben, und haelt die Reihenfolge stabil (neue Schluessel
 * hinter verwandten, sonst am Ende).
 *
 * Aufruf:  node tools/add-strings.js <datei.json>
 * Datei:   { "de": { "key": "Text" }, "en": { "key": "Text" } }
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

Object.entries(input).forEach(([code, additions]) => {
  const file = path.join(ROOT, 'language', `${code}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const data = JSON.parse(raw);
  const entries = Object.entries(data.strings);
  let added = 0;

  Object.entries(additions).forEach(([key, value]) => {
    if (key in data.strings) return;
    // Hinter dem letzten Schluessel mit demselben Praefix einordnen
    const prefix = key.split('.')[0] + '.';
    let at = -1;
    entries.forEach(([k], i) => { if (k.startsWith(prefix)) at = i; });
    entries.splice(at >= 0 ? at + 1 : entries.length, 0, [key, value]);
    data.strings[key] = value;
    added += 1;
  });

  data.strings = Object.fromEntries(entries);
  fs.writeFileSync(file, JSON.stringify(data, null, 2).replace(/\n/g, eol) + eol);
  console.log(`${code}: ${added} neu`);
});
