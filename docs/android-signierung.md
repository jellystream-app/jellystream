# Android-Signierung

Die APK aus der CI muss mit einem festen Schlüssel signiert sein.
Ohne ihn baut Gradle `app-release-unsigned.apk`, und Android lehnt die
Installation ab — mit „App nicht installiert", ohne Angabe eines
Grundes.

Der Workflow bricht in dem Fall bewusst im Schritt **Signatur prüfen**
ab, statt eine unbrauchbare Datei ins Release zu hängen.

## Die vier Secrets

Zu setzen unter **Settings → Secrets and variables → Actions → New
repository secret**:

| Name | Inhalt |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | der Keystore als base64, eine Zeile ohne Umbrüche |
| `ANDROID_KEYSTORE_PASSWORD` | Passwort des Keystores |
| `ANDROID_KEY_ALIAS` | `jellystream` |
| `ANDROID_KEY_PASSWORD` | dasselbe wie das Keystore-Passwort |

Die Werte liegen außerhalb des Repos unter `~/jellystream-signing/`:

- `jellystream-release.jks` — der Schlüssel selbst
- `keystore-base64.txt` — genau der Text für `ANDROID_KEYSTORE_BASE64`
- `password.txt` — das Passwort für beide Passwort-Secrets

Beim Kopieren aus `password.txt`: **die Datei beginnt mit einem BOM**
(ein unsichtbares Zeichen am Anfang). Kommt es ins Secret, meldet
keytool „keystore password was incorrect". Sicher ist der Weg über

```bash
node -e "let s=require('fs').readFileSync('password.txt','utf8'); \
         process.stdout.write(s.replace(/^﻿/,'').trim())"
```

## Der Schlüssel ist unersetzlich

Android bindet die Identität einer App an ihr Signaturzertifikat. Ein
neuer Schlüssel bedeutet: Bestehende Installationen lassen sich nicht
mehr aktualisieren — Nutzer müssten deinstallieren und Daten verlieren.

Deshalb: `~/jellystream-signing/` sichern, und nie neu erzeugen, solange
dieser hier existiert. Gültig bis 2054.

Fingerabdruck des richtigen Schlüssels (SHA-256):

```
31:AD:9F:1A:94:7E:03:B9:C4:1B:D5:98:F1:AE:4E:3C:0B:6B:43:4A:CE:04:16:E8:CA:18:63:D9:B4:1F:F0:55
```

Prüfen lässt er sich mit:

```bash
keytool -list -keystore jellystream-release.jks -alias jellystream
```

## Neu erzeugen — nur wenn keiner mehr da ist

```bash
keytool -genkeypair -v \
  -keystore release.jks \
  -alias jellystream \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -dname "CN=Jellystream, OU=Jellystream, O=Jellystream, C=DE"

# base64 für das Secret, eine Zeile:
base64 -w0 release.jks > keystore-base64.txt
```

Danach alle vier Secrets neu setzen.

## Ohne Secrets

Ein Fork ohne diese Secrets soll nicht scheitern. Der Workflow warnt
dann und baut unsigniert weiter — bis **Signatur prüfen** abbricht.
Für einen Fork, der keine installierbare APK braucht, ist das der
richtige Zeitpunkt zum Abbrechen; die Windows- und Linux-Pakete
entstehen davon unabhängig.

Lokal zum Ausprobieren genügt `./gradlew assembleDebug`: Gradle nimmt
dafür einen Wegwerf-Schlüssel, und die APK lässt sich per `adb install`
aufspielen — aber nicht über ein bestehendes Release aktualisieren.
