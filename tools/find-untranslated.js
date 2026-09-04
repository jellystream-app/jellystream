/**
 * Findet Oberflaechentext, der nicht durch t() laeuft.
 *
 * Arbeitet NICHT mit einer Wortliste — die uebersieht zwangslaeufig
 * Stellen. Stattdessen gilt: jeder Text, der wie ein Satz oder Label
 * aussieht und nicht in t(...) steckt, ist verdaechtig. Lieber ein
 * paar Fehlalarme als eine uebersehene Zeile.
 *
 * Aufruf:  node tools/find-untranslated.js [--all]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHOW_ALL = process.argv.includes('--all');

/* Was NICHT als Oberflaechentext zaehlt */
const IGNORE = [
  /^[a-z][a-zA-Z0-9]*$/,                  // Bezeichner: itemId, maxHeight
  /^[A-Z][a-zA-Z0-9]*$/,                  // Typnamen: Movie, Series, Primary
  /^[\w.-]+$/,                            // Pfade, Codes, Schluessel
  /^[\d\s.,:%+-]*$/,                      // reine Zahlen/Zeichen
  /^#[0-9a-fA-F]{3,8}$/,                  // Farben
  /^(https?|file|data):/,                 // URLs
  /^[<>\/\s]*$/,                          // HTML-Fragmente ohne Text
  /^[.#][\w-]+$/,                         // CSS-Selektoren
  /^\s*$/,
  /* Jellyfin-Feldlisten für die API — englische Bezeichner, kein
     UI-Text. Auch mit Zeilenumbrüchen und führendem "?Fields=", wie
     sie in mehrzeiligen Abfragen vorkommen. */
  /^\??(Fields=)?[A-Za-z]+(,\s*[A-Za-z]+)+$/,
  /^\/?[A-Za-z]+\?$/,                     // Endpunktfragmente wie "/Genres?"
  /* Codefragmente aus zerschnittenen Template-Literalen: sie
     beginnen mit einem Rest wie ": ''}" und sind kein Text. */
  /^:\s*''\}/
];

/* Endungen und Muster, die auf deutschen Text hindeuten. Absichtlich
   breit: auch Einzelwoerter wie "Ansehen" oder "Bibliotheken". */
const LOOKS_GERMAN = (s) => {
  if (/[äöüßÄÖÜ]/.test(s)) return true;                       // Umlaute
  if (/\b(der|die|das|und|oder|nicht|mit|von|zum|zur|für|auf|aus|bei|ist|sind|wird|kann|muss|soll|eine|einen|einem|kein|keine|alle|noch|schon|nur|wie|was|wenn|dann|als|bis|vor|nach|über|unter|dieser|diese|dieses)\b/i.test(s)) return true;
  // Typisch deutsche Wortendungen in grossgeschriebenen Woertern
  if (/\b[A-ZÄÖÜ][a-zäöü]+(ung|heit|keit|schaft|lich|isch|chen|lein|nis|tum)\b/.test(s)) return true;
  // Bekannte deutsche Oberflaechenwoerter ohne Umlaut
  if (/\b(Ansehen|Abspielen|Anmelden|Abmelden|Herunterladen|Speichern|Entfernen|Erstellen|Suchen|Laden|Zeigen|Schliessen|Bibliotheken|Einstellungen|Wiedergabe|Titel|Folge|Folgen|Staffel|Serie|Serien|Film|Filme|Musik|Alben|Sprache|Server|Benutzer|Passwort|Ordner|Datei|Dateien|Fehler|Neu|Neue|Neuer|Neues|Alle|Keine|Mehr|Infos|Details|Besetzung|Regie|Drehbuch|Studio|Genres|Bewertung|Laufzeit|Handlung|Gesehen|Ungesehen|Gemerkt|Merken|Zurück|Weiter|Standard|Kapitel|Untertitel|Lautstärke|Vollbild|Stumm|Warteschlange|Songtext)\b/.test(s)) return true;
  return false;
};

const results = [];

/* ---------------- JavaScript ---------------- */

function scanJs(file) {
  const full = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lineOf = (offset) => full.slice(0, offset).split('\n').length;

  /* Erst am ganzen Text arbeiten, nicht Zeile fuer Zeile: Template-
     Literale erstrecken sich oft ueber viele Zeilen, und genau dort
     steckt der meiste Oberflaechentext (Hero, Panels, Karten). */
  let text = full
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))   // Blockkommentare
    .replace(/^[ \t]*\/\/.*$/gm, (m) => ' '.repeat(m.length))    // Zeilenkommentare
    .replace(/console\.(log|warn|error|info|debug)\([^;]*?\);/gs, (m) => ' '.repeat(m.length))
    .replace(/\bt\(\s*(['"`])[^'"`]*\1(\s*,\s*\{[^}]*\})?\s*\)/g, (m) => ' '.repeat(m.length))
    .replace(/data-i18n[a-z-]*="[^"]*"/g, (m) => ' '.repeat(m.length));

  const collect = (pattern) => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const value = raw.slice(1, -1);

      /* Bei Template-Literalen jeden Textabschnitt einzeln pruefen:
         zwischen den ${...} stehen die eigentlichen Beschriftungen. */
      const segments = raw[0] === '`'
        ? value.split(/\$\{[^}]*\}/)
        : [value];

      segments.forEach((segment) => {
        const clean = segment.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!clean || IGNORE.some((re) => re.test(clean))) return;
        if (!LOOKS_GERMAN(clean)) return;
        results.push({ file, line: lineOf(match.index), text: clean.slice(0, 88) });
      });
    }
  };

  collect(/'(?:[^'\\\n]|\\.)*'/g);
  collect(/"(?:[^"\\\n]|\\.)*"/g);
  collect(/`(?:[^`\\]|\\.)*`/g);
}

/* ---------------- HTML ---------------- */

function scanHtml(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const lineOf = (offset) => text.slice(0, offset).split('\n').length;

  // Attribute tag-weise pruefen (koennen ueber Zeilen verteilt stehen)
  const tagPattern = /<([a-z][a-z0-9]*)\b([^>]*)>/gis;
  let match;

  while ((match = tagPattern.exec(text)) !== null) {
    const attrs = match[2];
    [['title', 'data-i18n-title'],
     ['aria-label', 'data-i18n-aria'],
     ['placeholder', 'data-i18n-placeholder']].forEach(([attr, marker]) => {
      const found = attrs.match(new RegExp(`(?<![-\\w])${attr}="([^"]{2,})"`));
      if (!found || attrs.includes(marker)) return;
      if (!LOOKS_GERMAN(found[1])) return;
      results.push({ file, line: lineOf(match.index), text: `[${attr}] ${found[1]}`.slice(0, 88) });
    });
  }

  // Textknoten: das umschliessende Tag muss data-i18n tragen
  const textPattern = />([^<>{}]{2,})</g;
  while ((match = textPattern.exec(text)) !== null) {
    const value = match[1].trim();
    if (!value || IGNORE.some((re) => re.test(value))) continue;
    if (!LOOKS_GERMAN(value)) continue;

    const before = text.lastIndexOf('<', match.index);
    const tag = text.slice(before, match.index + 1);
    if (/data-i18n(?!-)/.test(tag)) continue;

    results.push({ file, line: lineOf(match.index), text: value.slice(0, 88) });
  }
}

[
  'renderer.js', 'player.js', 'offline.js', 'settings.js', 'i18n-dom.js',
  'core/i18n.js', 'core/playback.js'
].forEach(scanJs);
scanHtml('index.html');

const byFile = {};
results.forEach((r) => {
  byFile[r.file] = byFile[r.file] || [];
  byFile[r.file].push(r);
});

Object.entries(byFile).forEach(([file, entries]) => {
  console.log(`\n=== ${file}  (${entries.length}) ===`);
  const show = SHOW_ALL ? entries : entries.slice(0, 40);
  show.forEach((e) => console.log(`  ${e.line}: ${e.text}`));
  if (entries.length > show.length) console.log(`  … und ${entries.length - show.length} weitere (--all)`);
});

console.log(`\nGesamt: ${results.length} Fundstellen`);
process.exit(results.length ? 1 : 0);
