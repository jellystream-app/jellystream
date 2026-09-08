/* ============================================================
   Abgleich mit dem Server

   Zwei Dinge, die in den Notizen zusammenstehen, aber verschieden
   funktionieren:

   1. „Sync your Library" — neue Filme und Folgen bekommen.
   2. „Sync your Library Structure" — Reihenfolge und Abschnitte so
      zeigen, wie sie im Jellyfin eingestellt sind.

   Zur Ehrlichkeit beim ersten Punkt: Jellystream hält KEINEN
   Zwischenspeicher — jede Ansicht lädt live. Es gibt also nichts zu
   verwerfen. Wer neue Dateien nicht sieht, hat sie meist nicht in
   Jellyfin: Der Server muss sie erst finden. Genau das stößt der
   Knopf an, und das verlangt Administratorrechte. Für normale Konten
   bleibt das erneute Laden — was in fast allen Fällen genügt, weil
   Jellyfin selbst regelmäßig sucht.

   Bewusst kein DOM: tools/test-core.js wacht darüber.
   ============================================================ */

/** Stößt eine Suche nach neuen Dateien auf dem Server an.
 *
 *  Rückgabe: 'started' | 'forbidden' | 'failed'
 *
 *  'forbidden' ist kein Fehler, sondern der Normalfall für ein
 *  gewöhnliches Konto — /Library/Refresh verlangt Administratorrechte.
 *  Der Aufrufer soll das sagen können, ohne eine Fehlermeldung zu
 *  zeigen, die niemand beheben kann. */
async function refreshServerLibrary() {
  try {
    await api('/Library/Refresh', { method: 'POST' });
    return 'started';
  } catch (error) {
    const message = String(error?.message || '');
    if (/\b401\b|\b403\b/.test(message)) return 'forbidden';
    return 'failed';
  }
}

/** Liest die Anzeige-Einstellungen des Nutzers aus Jellyfin.
 *
 *  Reihenfolge der Bibliotheken und welche ausgeblendet sind stehen
 *  in der UserConfiguration, nicht in den DisplayPreferences.
 *
 *  Rückgabe: { ordered: string[], hidden: string[] } */
async function fetchViewOrder() {
  try {
    const me = await api(`/Users/${state.userId}`);
    const config = me?.Configuration || {};
    return {
      ordered: config.OrderedViews || [],
      hidden: config.MyMediaExcludes || []
    };
  } catch (error) {
    return { ordered: [], hidden: [] };
  }
}

/* Die Abschnitte, die Jellyfin für die Startseite kennt. Kleingeschrieben,
   so wie der Server sie speichert.

   Ohne Entsprechung bei uns: `librarybuttons` (Kacheln der
   Bibliotheken — dafür gibt es die Navigationsleiste), `resumebook`
   (keine Bücher) und `smalllibrarytiles`. Sie werden übersprungen,
   nicht geraten. */
const HOME_SECTIONS = [
  'smalllibrarytiles', 'librarybuttons', 'activerecordings',
  'resume', 'resumeaudio', 'resumebook', 'latestmedia', 'nextup', 'livetv', 'none'
];

/* Was Jellyfin einstellt, wenn nichts eingestellt ist. Aus dem
   Server-Quellcode; ohne diese Liste stünde bei einem Nutzer, der die
   Startseite nie angefasst hat, gar nichts. */
const HOME_SECTION_DEFAULTS = [
  'smalllibrarytiles', 'resume', 'resumeaudio', 'resumebook',
  'livetv', 'nextup', 'latestmedia', 'none'
];

/** Liest die Abschnitte der Startseite, wie sie in Jellyfin stehen.
 *
 *  Sie liegen in den DisplayPreferences unter `usersettings` als
 *  homesection0…9. `client=emby` ist kein Versehen: Unter diesem
 *  Namen legt die offizielle Weboberfläche sie ab, und wir wollen
 *  genau deren Einstellung lesen — nicht eine eigene daneben.
 *
 *  Es wird NUR gelesen. Ein Schreiben würde serverseitig alle
 *  Abschnitte löschen und aus dem Gesendeten neu aufbauen; ein Fehler
 *  unsererseits beschädigte die Startseite im offiziellen Client. Das
 *  Risiko gehen wir für einen Anzeige-Wunsch nicht ein. */
async function fetchHomeSections() {
  let prefsData = null;
  try {
    const params = new URLSearchParams({ userId: state.userId, client: 'emby' });
    prefsData = await api(`/DisplayPreferences/usersettings?${params}`);
  } catch (error) {
    return { sections: [], fromServer: false };
  }

  const custom = prefsData?.CustomPrefs || {};

  const sections = [];
  for (let index = 0; index < 10; index += 1) {
    const value = String(custom[`homesection${index}`] || '').trim().toLowerCase();
    if (!value) continue;
    /* Unbekannte Abschnitte überspringen statt raten: Eine künftige
       Jellyfin-Fassung darf neue erfinden, ohne dass hier etwas
       Falsches erscheint. */
    if (!HOME_SECTIONS.includes(value)) continue;
    sections.push(value);
  }

  /* Hat der Nutzer die Startseite nie angefasst, steht dort nichts —
     dann gelten die Vorgaben des Servers, nicht eine leere Seite. */
  if (!sections.length) {
    return { sections: HOME_SECTION_DEFAULTS.slice(), fromServer: false };
  }

  return { sections, fromServer: true };
}

/** Sortiert Bibliotheken nach der Reihenfolge aus Jellyfin.
 *
 *  Was in `ordered` steht, kommt in dieser Folge; alles Weitere
 *  dahinter in der Reihenfolge des Servers. Ausgeblendete fallen weg.
 *
 *  Steht in `ordered` nichts, bleibt es bei der Reihenfolge, die der
 *  Server ohnehin geliefert hat — die ist bereits seine Antwort auf
 *  die Frage. */
function applyViewOrder(libraries, { ordered = [], hidden = [] } = {}) {
  const visible = (libraries || []).filter((library) => !hidden.includes(library.Id));
  if (!ordered.length) return visible;

  const rank = new Map(ordered.map((id, index) => [id, index]));

  return visible.slice().sort((a, b) => {
    const ra = rank.has(a.Id) ? rank.get(a.Id) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.Id) ? rank.get(b.Id) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HOME_SECTIONS,
    HOME_SECTION_DEFAULTS,
    refreshServerLibrary,
    fetchViewOrder,
    fetchHomeSections,
    applyViewOrder
  };
}
