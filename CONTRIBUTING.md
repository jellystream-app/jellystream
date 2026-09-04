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

## Release veröffentlichen — ein Befehl für alle Plattformen

```bash
npm version minor && git push --follow-tags
```

Das ist alles. GitHub Actions baut daraufhin **Windows und Linux**,
testet beides und hängt alle Pakete an ein Release:

| Datei | Plattform |
|---|---|
| `Jellystream-Setup-<version>.exe` | Windows (Installer) |
| `Jellystream-<version>-x86_64.AppImage` | Linux, ohne Installation lauffähig |
| `Jellystream-<version>-amd64.deb` | Debian und Ubuntu |
| `latest.yml` / `latest-linux.yml` | für den Updater — **ohne die passiert nichts** |
| `*.blockmap` | lädt beim Update nur die geänderten Teile |

`npm version` erhöht die Version in der `package.json`, legt den Tag an
und committet beides. `--follow-tags` schiebt Commit und Tag zusammen.

### Alternative: Release im Browser anlegen

Funktioniert genauso — ein dort veröffentlichtes Release löst denselben
Ablauf aus, und die Pakete werden angehängt.

Wichtig: Ein über die Weboberfläche angelegtes Release erzeugt **kein**
`push`-Ereignis für den Tag. Der Workflow lauscht deshalb auf beides
(`release: published` **und** `push: tags`) — sonst passiert bei einem
Weg nichts.

### Nur bauen, ohne zu veröffentlichen

Im Actions-Tab **Build → Run workflow**. Ohne Tag-Angabe entstehen nur
Artefakte am Lauf, kein Release. Mit Tag-Angabe werden sie an dessen
Release gehängt — praktisch, um ein fehlgeschlagenes Ziel nachzureichen.

### Ablauf im Einzelnen

1. Beide Läufer installieren die Abhängigkeiten
2. Windows baut den NSIS-Installer, Linux AppImage und `.deb`
3. Ein zweiter Job sammelt beide Ergebnisse ein und hängt sie ans Release

Schlägt ein Ziel fehl, läuft das andere weiter (`fail-fast: false`) — so
sieht man, ob es an der Plattform liegt oder am Code. Fehlt am Ende
`latest.yml`, bricht der Release-Job ab: lieber kein Release als eines,
mit dem der Updater nichts anfangen kann.

> **Die Tests laufen nicht in der CI.** Sie fahren echte
> Electron-Fenster hoch und messen Layout und Zeitverhalten — auf
> CI-Läufern ist das zu heikel, ein roter Lauf sagte dort mehr über den
> Läufer als über den Code. Also **vor dem Tag lokal `npm test`
> ausführen**; der Workflow baut nur.

### Updates unter Linux

Nur die **AppImage**-Fassung erneuert sich selbst. Eine per `.deb`
installierte App gehört der Paketverwaltung — dort würde ein
Selbstupdate an fehlenden Rechten scheitern. Die App erkennt das und
zeigt statt der Update-Prüfung einen entsprechenden Hinweis.

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

## Mobile App (Android)

Die App teilt sich mit dem Desktop den **Kern**, hat aber eine eigene
Oberfläche — auf einem Telefon ist die Desktop-Fassung nicht bedienbar
(gemessen: 34 px hohe Knöpfe, 1,4 Karten nebeneinander).

```
core/       gemeinsam, kennt kein DOM
  api.js       Anfragen, Anmeldung, Bilder, Zeitformate
  i18n.js      Übersetzungen
  playback.js  Codec-Aushandlung
desktop     index.html + renderer.js, player.js, settings.js, offline.js
mobile/     index.html + mobile.js, player.js, settings.js, mobile.css
```

Eine neue Funktion entsteht **einmal** im Kern; nur ihre Darstellung
steht zweimal — und die soll sich unterscheiden. `npm run test:core`
wacht darüber, dass kein DOM-Zugriff in den Kern zurückwandert.

### Lokal bauen

```bash
npm run mobile:build    # stellt www/ zusammen
npm run mobile:sync     # dazu: cap sync android
```

Für die APK brauchst du **JDK 17** und das Android-SDK. Ohne beides
baut GitHub Actions sie bei jedem Tag — dort ist die Werkzeugkette
eingerichtet.

```bash
cd android && ./gradlew assembleDebug
```

### Was die APK kann

Wiedergabe, Suche, Bibliotheken, Übersetzungen und die
Codec-Aushandlung laufen wie auf dem Desktop — es ist derselbe Kern.

**Offline-Downloads fehlen noch**: sie brauchen `@capacitor/filesystem`
statt des Electron-Main-Process. Die Oberfläche zeigt dort vorerst
einen Hinweis.

Die APK ist **unsigniert** — zum Selbstinstallieren genügt das
(„Unbekannte Quellen" erlauben). Für den Play Store wäre ein
Signaturschlüssel als Repository-Geheimnis nötig.

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
