# Jellyfin Electron Client

Ein einfacher Electron-Client zum Verbinden mit einem Jellyfin-Server und zum Streamen von:

- Filmen
- Serien
- Musik/Audio
- Bibliotheken aus dem Jellyfin-Server

## Starten

```bash
npm install
npm start
```

## Verbindung

1. Server-URL eingeben, z. B. `http://localhost:8096`
2. Jellyfin-Benutzername und Passwort eingeben
3. Bibliotheken werden automatisch geladen
4. Ein Film, eine Serie oder ein Album anklicken, um den Player zu öffnen

## Hinweise

- Die App verwendet die Jellyfin-API mit dem Zugriffstoken des Benutzers.
- Für echte Nutzung muss ein laufender Jellyfin-Server erreichbar sein.
- Der Player öffnet einen eingebetteten Video-/Audio-Stream direkt aus dem Server.
- Wir sammeln KEINE daten. Es werden keine Informationen über eure server gesammelt oder gespeichert

## Release veröffentlichen

Die App aktualisiert sich selbst aus den GitHub-Releases. Damit das
funktioniert, muss **`latest.yml` im Release liegen** — ohne diese Datei
findet der Updater nichts, ganz gleich wie viele `.exe` dort liegen.

### Mit Token (empfohlen)

```bash
# Einmalig: Token mit "repo"-Rechten erzeugen und setzen
export GH_TOKEN=ghp_...

npm version minor      # hebt die Version in package.json
npm test               # muss grün sein
npm run release        # baut und lädt alles hoch
```

`npm run release` legt das Release an und lädt `.exe`, `.blockmap` und
`latest.yml` gemeinsam hoch.

### Ohne Token (von Hand)

```bash
npm run dist
```

Danach **alle drei Dateien** aus `dist/` ins GitHub-Release hochladen:

| Datei | wofür |
|---|---|
| `Jellystream-Setup-<version>.exe` | der Installer |
| `latest.yml` | **Pflicht** — hierüber erkennt der Updater neue Versionen |
| `Jellystream-Setup-<version>.exe.blockmap` | lädt nur die geänderten Teile |

Der Tag muss zur Version passen (`v2.4.0` zu `"version": "2.4.0"`).

Prüfen, ob alles stimmt:

```bash
npm run test:updater
```

Der Test vergleicht Dateiname, Größe und Prüfsumme in `latest.yml` mit
dem gebauten Installer und sieht nach, ob das Release die Datei enthält.

### Wie das Update beim Nutzer abläuft

1. Acht Sekunden nach dem Start, danach alle sechs Stunden: Prüfung
2. Gibt es etwas Neues, lädt die App es im Hintergrund
3. Ein Hinweis meldet, dass die Fassung bereit ist
4. Eingespielt wird beim **Schließen** der App — nie mitten im Film

Im Entwicklungslauf (`npm start`) sind Updates abgeschaltet.

## Übersetzen

Die App ist quelloffen und soll jede Sprache sprechen können. Eine Übersetzung
ist eine einzelne JSON-Datei — mehr braucht es nicht.

### Schnellstart

1. In der App: **Einstellungen → Sprache → Sprachordner öffnen**
2. Die Datei `en.json` aus dem Programmordner dorthin kopieren und nach dem
   Sprachcode benennen, z. B. `en-gb.json`, `fr.json`, `pt-br.json`
3. `meta` ausfüllen und die Texte in `strings` übersetzen
4. In der App **Nach Sprachen suchen** ist nicht nötig — Dateien aus diesem
   Ordner erscheinen sofort in der Auswahl

Eine Datei im eigenen Sprachordner hat Vorrang vor der mitgelieferten Fassung.
So lässt sich eine Übersetzung in Ruhe testen, bevor sie eingereicht wird.

### Aufbau einer Sprachdatei

```json
{
  "meta": {
    "code": "en-gb",
    "name": "English (UK)",
    "nativeName": "English (UK)",
    "flag": "🇬🇧",
    "author": "Dein Name",
    "authorUrl": "https://github.com/deinname",
    "version": 1
  },
  "strings": {
    "nav.home": "Home",
    "server.switched": "Switched to {name}"
  }
}
```

| Feld | Bedeutung |
|---|---|
| `code` | Sprachcode, muss zum Dateinamen passen |
| `name` | Name auf Englisch |
| `nativeName` | Name in der eigenen Sprache — der wird angezeigt |
| `flag` | Ein Emoji, erscheint auf der Sprachkarte |
| `author` | Dein Name, wird in den Einstellungen genannt |
| `authorUrl` | Optionaler Link (nur `http://` oder `https://`) |
| `version` | Bei jeder Änderung um 1 erhöhen |
| `rtl` | Auf `true` setzen bei Arabisch, Hebräisch usw. |

### Was zu beachten ist

- **Platzhalter in `{...}` müssen erhalten bleiben.** Aus
  `"Switched to {name}"` darf `"Gewechselt zu {name}"` werden, aber nicht
  `"Gewechselt zu {Name}"` — sonst steht der Platzhalter unersetzt da.
  Ihre Reihenfolge im Satz ist frei.
- **Schlüssel nie umbenennen**, nur die Werte übersetzen.
- **Fehlende Schlüssel sind erlaubt.** Was fehlt, zeigt die App auf Englisch;
  die Sprachauswahl weist den Fortschritt in Prozent aus.
- `en.json` ist die Referenz — sie enthält immer alle Schlüssel.

### Einreichen

Pull Request mit der neuen Datei in `language/` und einem Eintrag in
`language/index.json`. Danach laden alle Nutzer die Sprache automatisch —
die App gleicht einmal täglich mit dem Repository ab.

### Testen

```bash
npm run test:i18n
```

Prüft, ob alle Dateien vollständig sind, die Platzhalter zusammenpassen und
keine Übersetzung leer ist.
