# web/ — Jellystream als Website

Die Desktop-Oberfläche, 1:1 als statische Website. Gleiches HTML,
gleiches CSS, gleiche Skripte wie die Electron-App.

**Erzeugt, nicht von Hand gepflegt.** Änderungen gehören ins Original
(`index.html`, `styles.css`, `renderer.js`, …), danach:

```
npm run web:build
```

Ohne diesen Schritt läuft die Kopie beim ersten Bugfix am Original
auseinander, ohne dass es jemand merkt.

## Hosten

Ein beliebiger statischer Webserver genügt — es gibt keinen Build-Schritt
und keine Server-Logik:

```
npx serve web
```

Genauso: GitHub Pages, Netlify, Vercel, Caddy, nginx.

## Wichtig: der Browser spricht direkt mit deinem Jellyfin-Server

Anders als die Desktop-App unterliegt die Website der Same-Origin-Policy.
Läuft die Seite unter einer anderen Adresse als Jellyfin, blockiert der
Browser die Anfragen — die Anmeldung schlägt dann fehl, obwohl Adresse
und Passwort stimmen.

Zwei Wege:

1. **Gleiche Herkunft** (empfohlen): die Seite hinter demselben
   Reverse-Proxy ausliefern wie Jellyfin, z. B. unter `/app`.
   Dann entfällt CORS vollständig.
2. **CORS am Proxy erlauben**: `Access-Control-Allow-Origin` auf die
   Adresse der Website setzen. Jellyfin selbst bietet dafür keine
   Einstellung — das gehört vor den Server (nginx, Caddy, Traefik).

Ist die Seite über **HTTPS** erreichbar, muss es auch der Jellyfin-Server
sein: eine HTTPS-Seite darf keine HTTP-Adressen abrufen.

## Was der Browser nicht kann

Diese Bereiche blendet die Oberfläche selbst aus — die Knöpfe fehlen,
statt ins Leere zu greifen:

| Funktion | Grund |
|---|---|
| Offline-Downloads | kein Dateisystemzugriff |
| Discord-Präsenz | braucht einen lokalen Socket |
| Automatische Updates | der Webserver liefert die neue Fassung |
| Sprachordner öffnen | kein Dateisystemzugriff |
| Titelleiste | kein eigenes Fenster; ausgeblendet |

Alles andere — Anmeldung, Bibliotheken, Suche, Wiedergabe, Untertitel,
Musik, Favoriten, Einstellungen, Sprachen — arbeitet wie im Desktop.

## Prüfen

```
npm run test:web
```

Lädt die Seite über einen Webserver ohne Electron-Brücken — der Zustand
beim Hosten — und prüft, dass sie startet, übersetzt ist und keine
Konsolenfehler wirft.
