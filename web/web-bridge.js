/* ============================================================
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
    name: "Jellystream",
    version: "2.14.0",
    platform: 'web'
  };

  /* Die selbstgezeichnete Titelleiste steuert ein Electron-Fenster.
     Im Browser-Tab gibt es keins — styles.css blendet sie ueber
     diese Klasse aus und setzt --tb-height auf 0. */
  document.documentElement.classList.add('is-web');
})();
