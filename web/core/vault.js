/**
 * Tresor fuer Zugangsdaten in localStorage.
 *
 * Anlass: Jellyfin-Token (jf-session, jf-servers) und das Trakt-Token
 * lagen im Klartext auf der Platte. Wer das Benutzerprofil lesen kann,
 * konnte sich damit am Server anmelden.
 *
 * Im Desktop verschluesselt der Hauptprozess ueber safeStorage
 * (window.secrets, siehe preload.js). Ohne Bruecke — Browser, mobile
 * App — oder ohne verfuegbaren Schluesselbund (Linux ohne libsecret)
 * wird unveraendert gespeichert; das ist der Stand von vorher, nicht
 * schlechter.
 *
 * Gespeichert wird ein Umschlag:  {"$enc":"<base64>"}
 * Alte Klartext-Eintraege werden beim Lesen erkannt, gelesen und beim
 * naechsten Schreiben verschluesselt — es muss sich niemand neu anmelden.
 *
 * Kein DOM, kein Electron: Liegt im Kern, damit alle Oberflaechen
 * dieselben Schluessel gleich behandeln.
 */
const vault = (() => {
  const bridge = () => (typeof window !== 'undefined' ? window.secrets : null);

  let usable = null;
  function canEncrypt() {
    if (usable !== null) return usable;
    try {
      usable = Boolean(bridge()?.available());
    } catch (error) {
      usable = false;
    }
    return usable;
  }

  /** Rohtext aus dem Speicher holen und, falls verschluesselt, oeffnen.
   *  null, wenn nichts da ist oder sich nichts oeffnen laesst. */
  function getRaw(key) {
    let stored;
    try {
      stored = localStorage.getItem(key);
    } catch (error) {
      return null;
    }
    if (stored == null) return null;

    if (stored.startsWith('{"$enc":')) {
      let envelope;
      try {
        envelope = JSON.parse(stored);
      } catch (error) {
        return null;
      }
      if (!canEncrypt()) return null;
      try {
        return bridge().decrypt(envelope.$enc);
      } catch (error) {
        return null;
      }
    }
    return stored;
  }

  function setRaw(key, text) {
    let out = text;
    if (canEncrypt()) {
      try {
        const enc = bridge().encrypt(text);
        if (enc) out = JSON.stringify({ $enc: enc });
      } catch (error) {
        /* dann eben unverschluesselt — besser als gar nicht */
      }
    }
    localStorage.setItem(key, out);
  }

  return {
    /** JSON lesen; `fallback`, wenn leer oder unlesbar */
    getJSON(key, fallback = null) {
      const raw = getRaw(key);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },

    /** JSON schreiben, verschluesselt wenn moeglich. Wirft wie localStorage. */
    setJSON(key, value) {
      setRaw(key, JSON.stringify(value));
    },

    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        /* ignorieren */
      }
    },

    /** Ob gerade verschluesselt gespeichert wird — fuer Tests und die Info-Seite */
    get encrypted() {
      return canEncrypt();
    }
  };
})();

if (typeof module !== 'undefined') module.exports = vault;
