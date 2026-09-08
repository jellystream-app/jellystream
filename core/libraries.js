/* ============================================================
   Bibliothekstypen — welche Inhalte steckt Jellyfin in welchen Ordner

   Anlass: Eine Bibliothek wurde bisher immer mit
   `IncludeItemTypes=Movie,Series` abgefragt, egal was drinsteht. Wer
   in Jellyfin „Hörbücher", „Fotos" oder eine gemischte Bibliothek
   angelegt hatte, sah den Ordner in der Leiste, klickte darauf — und
   bekam eine leere Seite. Der Ordner wurde also erkannt, nur nicht
   wiedergegeben.

   Bewusst kein DOM: tools/test-core.js wacht darüber. Die mobile
   Fassung kann dieselbe Zuordnung später übernehmen.
   ============================================================ */

/* Jellyfins CollectionType ist kleingeschrieben — im Server-Quellcode
   ausdrücklich als „legacy requirement" so festgehalten. Deshalb wird
   unten auf Kleinschreibung normalisiert und nicht auf gut Glück
   verglichen. */
const LIBRARY_KINDS = {
  movies:      { types: 'Movie,BoxSet',            shape: 'poster' },
  tvshows:     { types: 'Series',                  shape: 'wide'   },
  music:       { types: 'MusicAlbum',              shape: 'square' },
  musicvideos: { types: 'MusicVideo',              shape: 'wide'   },
  books:       { types: 'Book,AudioBook',          shape: 'poster' },
  photos:      { types: 'Photo,PhotoAlbum',        shape: 'wide'   },
  homevideos:  { types: 'Video,Photo,PhotoAlbum',  shape: 'wide'   },
  boxsets:     { types: 'BoxSet',                  shape: 'poster' },
  playlists:   { types: 'Playlist',                shape: 'wide'   },

  /* Live TV hat keine abfragbaren Items — Kanäle kommen über
     /LiveTv/Channels. Der Aufrufer erkennt das an types === null und
     zeigt die eigene Kanalansicht. */
  livetv:      { types: null,                      shape: 'wide'   }
};

/* Unbekannter, leerer oder gemischter Typ: KEIN Filter.

   Das ist der wichtigste Fall und die eigentliche Lehre aus dem
   Fehler. Ohne IncludeItemTypes liefert der Server, was im Ordner
   liegt — ob das „Video", „Audio" oder etwas ist, das es zum
   Zeitpunkt dieser Zeile noch nicht gibt. Eine künftige
   Jellyfin-Fassung mit einem neuen Bibliothekstyp funktioniert damit
   ohne Änderung hier. Zu raten wäre genau die Bauart, die die leeren
   Seiten verursacht hat. */
const LIBRARY_FALLBACK = { types: null, shape: 'wide' };

/** Wie wird diese Bibliothek abgefragt und dargestellt?
 *
 *  Gibt { types, shape } zurück. `types` ist der Wert für
 *  IncludeItemTypes — ist er null, wird der Parameter weggelassen
 *  (siehe LIBRARY_FALLBACK). */
function libraryKind(library) {
  const key = String(library?.CollectionType || '').trim().toLowerCase();
  return LIBRARY_KINDS[key] || LIBRARY_FALLBACK;
}

/** Ist das eine Live-TV-Bibliothek? Die braucht eine eigene Ansicht. */
function isLiveTvLibrary(library) {
  return String(library?.CollectionType || '').trim().toLowerCase() === 'livetv';
}

/* Für die mobile Fassung und die Tests. Im Desktop laufen alle
   Skripte im selben Gültigkeitsbereich, dort genügen die Funktionen. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LIBRARY_KINDS, LIBRARY_FALLBACK, libraryKind, isLiveTvLibrary };
}
