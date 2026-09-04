/* ============================================================
   Uebersetzungen (Renderer)

   t('key', { name: 'X' })  loest einen Schluessel auf.
   Fehlt er in der aktiven Sprache, greift Englisch; fehlt er auch
   dort, erscheint der Schluessel selbst — sichtbar, aber nicht kaputt.
   ============================================================ */

const i18n = {
  code: 'de',
  strings: {},
  fallback: {},
  available: [],
  ready: false,
  rtl: false
};

/**
 * Uebersetzt einen Schluessel.
 * Platzhalter stehen als {name} im Text, damit Uebersetzer keine
 * JS-Syntax schreiben muessen.
 */
function t(key, vars) {
  let text = i18n.strings[key];
  if (text === undefined) text = i18n.fallback[key];

  if (text === undefined) {
    // Sichtbar machen statt still leer lassen — so faellt es beim Testen auf
    console.warn('[i18n] fehlender Schluessel:', key);
    return key;
  }

  if (!vars) return text;

  return text.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] !== undefined ? String(vars[name]) : match
  );
}

/** Plural: nutzt "key" oder "key_plural" je nach Anzahl. */
function tn(key, count, vars) {
  const chosen = count === 1 ? key : `${key}_plural`;
  const merged = { ...(vars || {}), count };
  // Faellt auf die Einzahl zurueck, wenn keine Mehrzahlform hinterlegt ist
  if (count !== 1 && i18n.strings[chosen] === undefined && i18n.fallback[chosen] === undefined) {
    return t(key, merged);
  }
  return t(chosen, merged);
}

/* Das Übertragen auf die Oberfläche steht bewusst NICHT hier:
   der Kern kennt kein DOM, damit ihn Desktop und mobile App
   gleichermaßen nutzen können. Siehe i18n-dom.js. */

/* ---------------- Laden und Wechseln ---------------- */

function savedLanguage() {
  try {
    return localStorage.getItem('jf-language') || '';
  } catch (error) {
    return '';
  }
}

function rememberLanguage(code) {
  try {
    localStorage.setItem('jf-language', code);
  } catch (error) {
    /* ignorieren */
  }
}

/** Beste Sprache fuer diesen Rechner, wenn noch keine gewaehlt wurde. */
function detectLanguage(available) {
  const codes = available.map((l) => l.code);
  const wanted = (navigator.language || 'en').toLowerCase();

  if (codes.includes(wanted)) return wanted;

  // "de-at" -> "de"
  const short = wanted.split('-')[0];
  if (codes.includes(short)) return short;

  // Umgekehrt: nur "de-ch" vorhanden, System sagt "de"
  const relative = codes.find((c) => c.split('-')[0] === short);
  if (relative) return relative;

  return codes.includes('en') ? 'en' : (codes[0] || 'en');
}

/* Ohne die Electron-Bruecke (mobile App, Browser) liegen die
   Sprachdateien einfach neben der Seite. Dann per fetch holen. */
async function fetchLanguageFile(code) {
  try {
    const response = await fetch(`language/${encodeURIComponent(code)}.json`);
    if (!response.ok) return null;
    const data = await response.json();
    return data && data.strings ? data : null;
  } catch (error) {
    return null;
  }
}

async function fetchLanguageIndex() {
  try {
    const response = await fetch('language/index.json');
    if (!response.ok) return [];
    const data = await response.json();
    const list = Array.isArray(data) ? data : (data.languages || []);
    // Dieselbe Form wie die Bruecke sie liefert
    return list.map((entry) => ({
      code: String(entry.code || '').toLowerCase(),
      name: entry.name || entry.code,
      nativeName: entry.nativeName || entry.name || entry.code,
      flag: entry.flag || '',
      author: entry.author || '',
      authorUrl: entry.authorUrl || '',
      version: entry.version || 1,
      rtl: Boolean(entry.rtl),
      source: 'builtin',
      translated: 0,
      total: 0
    }));
  } catch (error) {
    return [];
  }
}

async function loadLanguage(code) {
  const bridge = window.languages;

  const data = bridge
    ? await bridge.get(code).catch(() => null)
    : await fetchLanguageFile(code);

  if (!data || !data.strings) return false;

  i18n.code = code;
  i18n.strings = data.strings;
  i18n.rtl = Boolean(data.meta && data.meta.rtl);
  return true;
}

/** Beim Start: Liste holen, Englisch als Rueckfallebene, Sprache setzen. */
async function initI18n() {
  const bridge = window.languages;

  /* Zwei Wege zur selben Sache: der Desktop fragt den Main-Process,
     die mobile App liest die Dateien neben sich. Ohne diesen zweiten
     Weg stuenden auf dem Geraet nur die Schluessel statt der Texte. */
  try {
    i18n.available = bridge ? await bridge.list() : await fetchLanguageIndex();
  } catch (error) {
    i18n.available = [];
  }

  // Englisch immer als Rueckfallebene laden
  const english = bridge
    ? await bridge.get('en').catch(() => null)
    : await fetchLanguageFile('en');
  if (english && english.strings) i18n.fallback = english.strings;

  const wanted = savedLanguage() || detectLanguage(i18n.available);
  const ok = await loadLanguage(wanted);

  if (!ok && wanted !== 'en') await loadLanguage('en');

  i18n.ready = true;
  applyTranslations();
}

/** Sprachwechsel zur Laufzeit — ohne Neustart. */
async function setLanguage(code) {
  const ok = await loadLanguage(code);
  if (!ok) return false;

  rememberLanguage(code);
  applyTranslations();

  // Teile, die nicht im statischen HTML stehen, neu aufbauen
  if (typeof onLanguageChanged === 'function') onLanguageChanged();
  return true;
}

/** Sprachcode fuer Intl — Datums- und Sprachnamen richten sich danach. */
function localeTag() {
  return i18n.code || 'en';
}
