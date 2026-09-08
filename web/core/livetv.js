/* ============================================================
   Live TV / IPTV

   Jellyfin bindet Fernsehen über einen Tuner oder eine M3U-Liste ein.
   Für den Client sind Kanäle ganz normale Titel: Sie haben eine Id,
   ein Bild und werden über denselben Weg abgespielt wie ein Film —
   /Items/{id}/PlaybackInfo, dann die Adresse, die der Server
   zurückgibt.

   Das ist der wichtigste Punkt: KEINE selbstgebaute m3u8-Adresse.
   Der Server weiß, ob er den Kanal durchreichen oder umrechnen muss,
   und hängt bei einem Live-Stream Dinge an die Adresse, die ein
   Client nicht erraten kann (LiveStreamId). Wer die Adresse selbst
   zusammensetzt, bekommt sie beim nächsten Serverwechsel um die Ohren.

   Bewusst kein DOM: tools/test-core.js wacht darüber.
   ============================================================ */

/* Was eine Kanalliste mitbringen soll. `AddCurrentProgram` ist beim
   Server standardmäßig an — mitgeschickt wird es trotzdem, damit die
   Absicht im Code steht und nicht in einer Vorgabe, die sich ändern
   kann. */
const LIVETV_CHANNEL_FIELDS = 'PrimaryImageAspectRatio,CurrentProgram,ChannelInfo';

/** Ist auf diesem Server überhaupt Fernsehen eingerichtet?
 *
 *  Beides muss stimmen: eingeschaltet UND mindestens ein Dienst. Ein
 *  eingeschaltetes Live TV ohne Tuner oder Senderliste ist eine leere
 *  Ansicht — die zu zeigen wäre schlechter, als den Eintrag
 *  weglassen.
 *
 *  Braucht keine Administratorrechte: Der Endpunkt verlangt nur das
 *  Nutzerrecht „Live TV sehen". Fehlt es, antwortet der Server mit
 *  403, und das heißt für uns dasselbe wie „nicht vorhanden". */
async function fetchLiveTvInfo() {
  try {
    const info = await api('/LiveTv/Info');
    const services = info?.Services || [];
    return {
      available: Boolean(info?.IsEnabled) && services.length > 0,
      services
    };
  } catch (error) {
    /* 403 (kein Recht), 404 (zu alt) oder Netzfehler — in jedem Fall
       gibt es hier kein Fernsehen zu zeigen. */
    return { available: false, services: [] };
  }
}

/** Holt die Kanäle mit der laufenden Sendung.
 *
 *  `addCurrentProgram` liefert das aktuelle Programm je Kanal gleich
 *  mit — ein Aufruf statt einer Abfrage pro Kanal. Bei 200 Sendern
 *  wäre der andere Weg 201 Anfragen. */
async function fetchLiveTvChannels({ startIndex = 0, limit = 300 } = {}) {
  const params = new URLSearchParams({
    userId: state.userId,
    startIndex: String(startIndex),
    limit: String(limit),
    addCurrentProgram: 'true',
    enableImages: 'true',
    enableUserData: 'true',
    fields: LIVETV_CHANNEL_FIELDS,
    sortBy: 'SortName',
    sortOrder: 'Ascending'
  });

  const data = await api(`/LiveTv/Channels?${params}`);
  return {
    channels: data?.Items || [],
    total: data?.TotalRecordCount ?? (data?.Items || []).length
  };
}

/** Wie weit ist die laufende Sendung? 0 bis 1, oder null.
 *
 *  Für den Balken auf der Kachel. Ohne Anfang und Ende — bei einer
 *  M3U-Liste ohne Programmdaten der Normalfall — gibt es nichts
 *  anzuzeigen, und dann ist null die ehrliche Antwort. */
function programProgress(program, now = Date.now()) {
  if (!program?.StartDate || !program?.EndDate) return null;

  const start = Date.parse(program.StartDate);
  const end = Date.parse(program.EndDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const ratio = (now - start) / (end - start);
  if (ratio < 0 || ratio > 1) return null;

  return ratio;
}

/** Kanalnummer und Name, wie sie auf die Kachel gehören.
 *
 *  Die Nummer steht in `ChannelNumber` und ist eine Zeichenkette —
 *  „10.1" ist bei DVB üblich und darf nicht zu 10 werden. */
function channelLabel(channel) {
  const number = String(channel?.ChannelNumber || '').trim();
  const name = channel?.Name || '';
  return { number, name };
}

/* Für die mobile Fassung und die Tests. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LIVETV_CHANNEL_FIELDS,
    fetchLiveTvInfo,
    fetchLiveTvChannels,
    programProgress,
    channelLabel
  };
}
