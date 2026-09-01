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

/* ---------------- Anwendung auf das DOM ---------------- */

/**
 * Setzt alle mit data-i18n markierten Stellen.
 * Laeuft beim Start und bei jedem Sprachwechsel — ohne Neustart.
 */
function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-html]').forEach((node) => {
    node.innerHTML = t(node.dataset.i18nHtml);
  });

  const attributes = [
    ['data-i18n-title', 'title'],
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-placeholder', 'placeholder']
  ];

  attributes.forEach(([dataAttr, target]) => {
    root.querySelectorAll(`[${dataAttr}]`).forEach((node) => {
      node.setAttribute(target, t(node.getAttribute(dataAttr)));
    });
  });

  // Sprache am Dokument setzen: Chromium trennt sonst nach der falschen Sprache
  if (root === document) {
    document.documentElement.lang = i18n.code;
    document.documentElement.dir = i18n.rtl ? 'rtl' : 'ltr';
  }
}

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

async function loadLanguage(code) {
  const bridge = window.languages;
  if (!bridge) return false;

  const data = await bridge.get(code).catch(() => null);
  if (!data || !data.strings) return false;

  i18n.code = code;
  i18n.strings = data.strings;
  i18n.rtl = Boolean(data.meta && data.meta.rtl);
  return true;
}

/** Beim Start: Liste holen, Englisch als Rueckfallebene, Sprache setzen. */
async function initI18n() {
  const bridge = window.languages;

  if (!bridge) {
    // Ohne Bruecke (z. B. im Browser geoeffnet) bleibt es bei den Schluesseln
    i18n.ready = true;
    return;
  }

  try {
    i18n.available = await bridge.list();
  } catch (error) {
    i18n.available = [];
  }

  // Englisch immer als Rueckfallebene laden
  const english = await bridge.get('en').catch(() => null);
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
