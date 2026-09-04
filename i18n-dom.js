/* ============================================================
   Übersetzungen auf die Oberfläche übertragen

   Getrennt von core/i18n.js: der Kern soll kein DOM kennen, damit
   ihn Desktop und mobile App gleichermaßen nutzen können. Diese
   Datei ist der Teil, der beide Fassungen unterschiedlich
   verwenden könnten — die Auflösung der Schlüssel bleibt gemeinsam.
   ============================================================ */

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
