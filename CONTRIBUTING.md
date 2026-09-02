# Mitwirken an Jellystream

Alles, was zum Entwickeln, Bauen, Testen und Übersetzen nötig ist.

## Starten

```bash
npm install
npm start
```

Zum Verbinden: Server-URL (z. B. `http://localhost:8096`), Benutzername
und Passwort. Die Bibliotheken werden anschließend automatisch geladen.

## Tests

```bash
npm test
```

Die Suite fährt echte Electron-Fenster hoch und prüft unter anderem
Downloads, Wiedergabe-Aushandlung, Übersetzungen, Login-Layout und den
Updater. Einzelne Bereiche lassen sich gezielt laufen lassen:

| Befehl | prüft |
|---|---|
| `npm run test:syntax` | alle Dateien auf Syntaxfehler |
| `npm run test:playback` | Codec-Profil und Stream-Auswahl |
| `npm run test:downloads` | Download-Manager gegen einen lokalen Server |
| `npm run test:i18n` | Vollständigkeit der Übersetzungen |
| `npm run test:login` | Login-Layout bei verschiedenen Fenstergrößen |
| `npm run test:updater` | Updater-Konfiguration und Release-Inhalt |

## Automatisch bauen (GitHub Actions)

`.github/workflows/build.yml` baut für **Windows und Linux**, sobald ein
Versions-Tag geschoben wird — oder auf Knopfdruck im Actions-Tab.

```bash
npm version minor          # hebt die Version und legt den Tag an
git push --follow-tags     # löst den Build aus
```

Was passiert:

1. Beide Läufer installieren die Abhängigkeiten und führen `npm test` aus
   (unter Linux mit `xvfb`, weil die Tests echte Fenster öffnen)
2. Windows baut den NSIS-Installer, Linux AppImage und `.deb`
3. Die Pakete landen als Artefakte im Lauf
4. Bei einem `v*`-Tag hängt ein zweiter Job sie an ein GitHub-Release —
   **inklusive `latest.yml`**, ohne die der Updater nichts findet

Schlägt ein Ziel fehl, läuft das andere weiter (`fail-fast: false`) — so
sieht man, ob es an der Plattform liegt oder am Code.

## Von Hand bauen

```bash
npm run dist                              # Windows (NSIS)
npm run build -- --linux AppImage deb     # Linux, auf einem Linux-Rechner
```

Die Pakete landen in `dist/`. **Alle** Dateien daraus gehören ins
Release — besonders `latest.yml`, sonst findet der Updater nichts:

| Datei | wofür |
|---|---|
| `Jellystream-Setup-<version>.exe` | Installer für Windows |
| `Jellystream-<version>-x86_64.AppImage` | Linux, ohne Installation lauffähig |
| `Jellystream-<version>-amd64.deb` | Debian und Ubuntu |
| `latest.yml` | **Pflicht** — hierüber erkennt der Updater neue Versionen |
| `*.blockmap` | lädt beim Update nur die geänderten Teile |

Prüfen, ob alles zusammenpasst:

```bash
npm run test:updater
```

## Wie das Update beim Nutzer abläuft

1. Acht Sekunden nach dem Start, danach alle sechs Stunden: Prüfung
2. Gibt es etwas Neues, lädt die App es im Hintergrund
3. Ein Hinweis meldet, dass die Fassung bereit ist
4. Eingespielt wird beim **Schließen** der App — nie mitten im Film

Im Entwicklungslauf (`npm start`) sind Updates abgeschaltet.

## Übersetzen

Eine Übersetzung ist eine einzelne JSON-Datei — mehr braucht es nicht.

1. In der App: **Einstellungen → Sprache → Sprachordner öffnen**
2. Die `en.json` aus dem Programmordner dorthin kopieren und nach dem
   Sprachcode benennen, z. B. `fr.json` oder `pt-br.json`
3. `meta` ausfüllen, die Texte in `strings` übersetzen
4. Die Datei erscheint sofort in der Sprachauswahl

Eine Datei im eigenen Ordner hat Vorrang vor der mitgelieferten — so
lässt sich eine Übersetzung testen, bevor sie eingereicht wird.

### Aufbau

```json
{
  "meta": {
    "code": "fr",
    "name": "French",
    "nativeName": "Français",
    "flag": "🇫🇷",
    "author": "Dein Name",
    "authorUrl": "https://github.com/deinname",
    "version": 1
  },
  "strings": {
    "nav.home": "Accueil",
    "server.switched": "Basculé vers {name}"
  }
}
```

| Feld | Bedeutung |
|---|---|
| `code` | Sprachcode, muss zum Dateinamen passen |
| `nativeName` | Name in der eigenen Sprache — der wird angezeigt |
| `flag` | Emoji für die Sprachkarte |
| `author` / `authorUrl` | wird in den Einstellungen genannt (nur `https://`) |
| `version` | bei jeder Änderung um 1 erhöhen |
| `rtl` | `true` bei Arabisch, Hebräisch usw. |

### Was zu beachten ist

- **Platzhalter in `{...}` müssen erhalten bleiben.** Aus
  `"Switched to {name}"` darf `"Basculé vers {name}"` werden, aber nicht
  `"Basculé vers {nom}"` — sonst steht der Platzhalter unersetzt da.
  Ihre Reihenfolge im Satz ist frei.
- **Schlüssel nie umbenennen**, nur die Werte übersetzen.
- **Fehlende Schlüssel sind erlaubt.** Was fehlt, zeigt die App auf
  Englisch; die Auswahl weist den Fortschritt in Prozent aus.
- `en.json` ist die Referenz und enthält immer alle Schlüssel.

### Einreichen

Pull Request mit der neuen Datei in `language/` und einem Eintrag in
`language/index.json`. Danach laden alle Nutzer die Sprache automatisch —
die App gleicht einmal täglich mit dem Repository ab.

```bash
npm run test:i18n    # prüft Vollständigkeit und Platzhalter
```

## Aufbau des Projekts

| Datei | Aufgabe |
|---|---|
| `main.js` | Hauptprozess, Fenster, IPC |
| `preload.js` | Brücke zwischen Haupt- und Renderer-Prozess |
| `renderer.js` | Oberfläche, Ansichten, Navigation |
| `playback.js` | Aushandlung mit dem Server (Direkt / Umpacken / Umrechnen) |
| `player.js` | Video- und Musikwiedergabe |
| `downloads.js` | Offline-Downloads (Hauptprozess) |
| `offline.js` | Offline-Ansicht (Renderer) |
| `languages.js` / `i18n.js` | Übersetzungen |
| `updater.js` | automatische Updates |
| `settings.js` | Einstellungen, Themes, Playlists |
