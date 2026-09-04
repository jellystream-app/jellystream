/**
 * Prueft den Build-Workflow: Ausloeser, Bedingungen, Schritte — und
 * ob die Namen der Artefakte zu dem passen, was der Build erzeugt.
 *
 * Aufruf:  node tools/test-workflow.js
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const results = [];

function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
}

const file = path.join(ROOT, '.github', 'workflows', 'build.yml');
let doc;

try {
  doc = yaml.load(fs.readFileSync(file, 'utf8'));
  check('Workflow ist gueltiges YAML', true);
} catch (error) {
  check('Workflow ist gueltiges YAML', false, error.message);
  console.log('FAIL  Workflow ist gueltiges YAML —', error.message);
  process.exit(1);
}

/* ---------- Ausloeser ---------- */

// js-yaml liest das Schluesselwort "on" als true (YAML 1.1)
const on = doc.on || doc[true];

check('Reagiert auf veroeffentlichte Releases',
  Boolean(on?.release?.types?.includes('published')),
  JSON.stringify(on?.release || 'fehlt'));

check('Reagiert auf Tag-Pushes', Boolean(on?.push?.tags?.length),
  (on?.push?.tags || []).join(', '));

/* Beide Schreibweisen: die bisherigen Tags im Repo sind gross (V2.7.2),
   `npm version` erzeugt kleine (v2.8.0). Fehlt eine, laeuft nichts. */
const tags = on?.push?.tags || [];
check('Grossgeschriebene Tags erfasst (V*)', tags.includes('V*'), tags.join(', '));
check('Kleingeschriebene Tags erfasst (v*)', tags.includes('v*'), tags.join(', '));

check('Manuell ausloesbar', on && Object.prototype.hasOwnProperty.call(on, 'workflow_dispatch'));

/* ---------- Build-Job ---------- */

const build = doc.jobs?.build;
check('Build-Job vorhanden', Boolean(build));

const targets = build?.strategy?.matrix?.include || [];
check('Baut fuer zwei Plattformen', targets.length === 2, targets.length + ' Ziele');
check('Windows dabei', targets.some((t) => t.os?.includes('windows')));
check('Linux dabei', targets.some((t) => t.os?.includes('ubuntu')));

const linux = targets.find((t) => t.os?.includes('ubuntu'));
const windows = targets.find((t) => t.os?.includes('windows'));

check('Linux baut AppImage und deb',
  /AppImage/.test(linux?.build_cmd || '') && /deb/.test(linux?.build_cmd || ''),
  linux?.build_cmd);
check('Windows baut NSIS', /nsis/.test(windows?.build_cmd || ''), windows?.build_cmd);

check('Ein Fehlschlag stoppt das andere Ziel nicht',
  build?.strategy?.['fail-fast'] === false);

/* Die Befehle muessen es im Projekt wirklich geben */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('npm run build existiert', Boolean(pkg.scripts?.build), pkg.scripts?.build || 'fehlt');
check('Linux-Ziele sind konfiguriert', Boolean(pkg.build?.linux?.target),
  JSON.stringify(pkg.build?.linux?.target?.map((t) => t.target) || 'fehlt'));

/* latest*.yml entsteht nur mit publish-Konfiguration */
check('publish-Konfiguration vorhanden (fuer latest.yml)',
  Boolean(pkg.build?.publish?.length),
  JSON.stringify(pkg.build?.publish?.[0] || 'fehlt'));

/* ---------- Der Workflow baut nur, er testet nicht ----------

   Die Testsuite faehrt echte Electron-Fenster hoch und misst Layout
   und Zeitverhalten. Auf CI-Laeufern ist das zu heikel: ein roter
   Lauf sagte dort mehr ueber den Laeufer als ueber den Code.
   Getestet wird lokal vor dem Tag. */

const steps = build?.steps || [];
const names = steps.map((s) => s.name || s.uses || '');

check('Workflow enthaelt keine Testschritte',
  !names.some((n) => /^Tests/i.test(n)),
  names.filter((n) => /^Tests/i.test(n)).join(', ') || 'keine');

check('Kein xvfb noetig',
  !steps.some((s) => /xvfb/.test(JSON.stringify(s))),
  'nur Tests brauchten einen Bildschirm');

const buildIndex = names.findIndex((n) => /App bauen/i.test(n));
check('Bauen kommt nach dem Installieren',
  buildIndex > names.findIndex((n) => /installieren/i.test(n)),
  'Schritt ' + buildIndex);

/* ---------- Hochgeladene Dateien ---------- */

const upload = steps.find((s) => (s.uses || '').includes('upload-artifact'));
const paths = String(upload?.with?.path || '');

['*.exe', '*.AppImage', '*.deb', 'latest*.yml'].forEach((p) => {
  check('Artefakt erfasst: ' + p, paths.includes(p), paths.replace(/\n/g, ' '));
});

check('Entpackter Ordner wird NICHT hochgeladen',
  !paths.includes('win-unpacked') && !paths.includes('linux-unpacked'),
  'waere mehrere hundert MB');

check('Fehlende Dateien fallen auf',
  upload?.with?.['if-no-files-found'] === 'error');

/* ---------- Alles, was die CI braucht, muss im Repo liegen ----------

   Ein Eintrag "tools/" in der .gitignore hat einmal alle neuen
   Werkzeuge verschluckt — lokal lief alles, in der CI fehlte
   build-mobile.js. Der Fehler war lautlos: git add meldet nichts,
   wenn eine Datei ignoriert wird. */

const { execSync } = require('child_process');

let trackedFiles = [];
try {
  trackedFiles = execSync('git ls-files', { encoding: 'utf8', cwd: ROOT }).split('\n');
  // Auch schon vorgemerkte Dateien zaehlen als vorhanden
  const staged = execSync('git diff --cached --name-only', { encoding: 'utf8', cwd: ROOT }).split('\n');
  trackedFiles.push(...staged);
} catch (error) {
  check('git-Dateiliste lesbar', false, error.message);
}

const tracked = new Set(trackedFiles.filter(Boolean));

/* Jede Datei, die ein npm-Skript aufruft, muss im Repo sein */
const scriptFiles = new Set();
Object.values(pkg.scripts || {}).forEach((cmd) => {
  (cmd.match(/tools\/[\w.-]+\.js/g) || []).forEach((f) => scriptFiles.add(f));
});

const untracked = [...scriptFiles].filter(
  (f) => fs.existsSync(path.join(ROOT, f)) && !tracked.has(f)
);

check('Alle Skript-Dateien sind im Repo', untracked.length === 0,
  untracked.length ? 'FEHLT: ' + untracked.join(', ') : `${scriptFiles.size} geprüft`);

/* Die vom Workflow aufgerufenen Skripte müssen existieren */
const workflowScripts = ['mobile:build', 'build'];
workflowScripts.forEach((name) => {
  check(`npm-Skript "${name}" vorhanden`, Boolean(pkg.scripts?.[name]),
    pkg.scripts?.[name] || 'fehlt');
});

/* Und die .gitignore darf tools/ nicht ausschließen */
const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
check('.gitignore schließt tools/ nicht aus',
  !/^tools\/?\s*$/m.test(gitignore),
  'sonst fehlen Testwerkzeuge und Build-Skripte in der CI');

/* ---------- Android-Job ---------- */

const android = doc.jobs?.android;
check('Android-Job vorhanden', Boolean(android));

const aSteps = android?.steps || [];
const aNames = aSteps.map((s) => s.name || s.uses || '');

/* Android baut mit dem mitgelieferten JDK 8 nicht. Wie neu es genau
   sein muss, steht nicht hier, sondern wird weiter unten aus den
   Gradle-Dateien hergeleitet — eine feste Zahl an dieser Stelle war
   schon einmal still veraltet, als Capacitor auf Java 21 zog. */
const java = aSteps.find((s) => (s.uses || '').includes('setup-java'));
check('JDK wird eingerichtet', Boolean(java));

check('Android-SDK wird eingerichtet',
  aSteps.some((s) => (s.uses || '').includes('setup-android')));

/* Reihenfolge: erst www/ bauen, dann synchronisieren, dann Gradle */
const prepIdx = aNames.findIndex((n) => /Web-Dateien/i.test(n));
const syncIdx = aNames.findIndex((n) => /Android-Projekt/i.test(n));
const apkIdx = aNames.findIndex((n) => /APK bauen/i.test(n));

check('www wird vor dem Synchronisieren gebaut',
  prepIdx >= 0 && prepIdx < syncIdx, `${prepIdx} < ${syncIdx}`);
check('Gradle läuft zuletzt', apkIdx > syncIdx, `${apkIdx} > ${syncIdx}`);

const apkUpload = aSteps.find((s) => (s.uses || '').includes('upload-artifact'));
check('APK wird hochgeladen', /\.apk/.test(String(apkUpload?.with?.path || '')),
  String(apkUpload?.with?.path || ''));

/* Die nötigen npm-Skripte müssen es geben */
check('npm run mobile:build existiert', Boolean(pkg.scripts?.['mobile:build']),
  pkg.scripts?.['mobile:build'] || 'fehlt');

/* Capacitor-Konfiguration */
const capConfig = path.join(ROOT, 'capacitor.config.json');
check('capacitor.config.json vorhanden', fs.existsSync(capConfig));

if (fs.existsSync(capConfig)) {
  const cap = JSON.parse(fs.readFileSync(capConfig, 'utf8'));
  check('webDir zeigt auf www', cap.webDir === 'www', cap.webDir);
  check('appId gesetzt', /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(cap.appId || ''), cap.appId);
  /* Jellyfin läuft im Heimnetz meist über http — ohne diese
     Erlaubnis blockiert Android die Verbindung stillschweigend. */
  check('http-Verbindungen erlaubt', cap.android?.allowMixedContent === true,
    'sonst scheitert der Zugriff auf http://-Server');
}

/* ---------- Release-Job ---------- */

const release = doc.jobs?.release;
check('Release-Job vorhanden', Boolean(release));
check('Release wartet auf den Build', release?.needs === 'build' ||
  (Array.isArray(release?.needs) && release.needs.includes('build')));
check('Release darf schreiben', release?.permissions?.contents === 'write');

const cond = String(release?.if || '');
check('Laeuft bei veroeffentlichtem Release',
  cond.includes("github.event_name == 'release'"), cond);
check('Laeuft auch bei Tag-Push',
  cond.includes("startsWith(github.ref, 'refs/tags/')"), cond);

const relSteps = release?.steps || [];
check('Sammelt die Artefakte ein',
  relSteps.some((s) => (s.uses || '').includes('download-artifact')));

/* Die Dateien liegen je Plattform in Unterordnern — ohne
   Zusammenlegen landen Pfade statt Namen im Release. */
const flatten = relSteps.find((s) => /zusammenlegen/i.test(s.name || ''));
check('Legt die Dateien flach zusammen', Boolean(flatten));
check('Bricht ab, wenn latest.yml fehlt',
  /latest\.yml/.test(flatten?.run || '') && /exit 1/.test(flatten?.run || ''),
  'sonst waere das Release fuer den Updater unbrauchbar');

const publish = relSteps.find((s) => (s.uses || '').includes('action-gh-release'));
check('Haengt die Dateien an das Release', Boolean(publish));
check('Nutzt den richtigen Tag',
  /github.event.release.tag_name/.test(String(publish?.with?.tag_name || '')),
  String(publish?.with?.tag_name || ''));

/* ---------- Node-Fassung gegen die Forderungen der Pakete ----------

   @capacitor/cli fordert engines.node >=22 und bricht hart ab, wenn
   der Laeufer aelter ist. Ohne engine-strict warnt `npm ci` dabei
   nur — der Lauf scheitert also erst Minuten spaeter beim `cap add`.
   Dieser Test zieht den Abbruch nach vorn: er liest die Forderungen
   aus node_modules und vergleicht sie mit dem Workflow.            */

const nodeVersions = [];
Object.values(doc.jobs || {}).forEach((job) => {
  (job.steps || []).forEach((step) => {
    if (String(step.uses || '').startsWith('actions/setup-node')) {
      nodeVersions.push({ job, version: Number(step.with?.['node-version']) });
    }
  });
});

check('Jeder Job legt eine Node-Fassung fest',
  nodeVersions.length >= 2 && nodeVersions.every((n) => Number.isFinite(n.version)),
  nodeVersions.map((n) => n.version).join(', '));

/* Hoechste Forderung aller Abhaengigkeiten ermitteln */
let required = 0;
let demandedBy = '';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

  deps.forEach((dep) => {
    try {
      const meta = JSON.parse(fs.readFileSync(
        path.join(ROOT, 'node_modules', dep, 'package.json'), 'utf8'));
      const want = meta.engines?.node;
      if (!want) return;

      // ">=22.0.0" / ">= 12.20.55" -> 22 bzw. 12
      const major = Number((want.match(/(\d+)/) || [])[1]);
      if (Number.isFinite(major) && major > required) {
        required = major;
        demandedBy = `${dep} (${want})`;
      }
    } catch { /* Paket nicht installiert — nicht pruefbar */ }
  });
} catch { /* package.json unlesbar: der Test unten faellt dann auf */ }

if (required > 0) {
  const tooOld = nodeVersions.filter((n) => n.version < required);
  check('Node im Workflow erfuellt alle engines-Forderungen',
    tooOld.length === 0,
    tooOld.length
      ? `${demandedBy} braucht >=${required}, Workflow nutzt ${tooOld.map((n) => n.version).join('/')}`
      : `>=${required} gefordert von ${demandedBy}`);
} else {
  check('Node im Workflow erfuellt alle engines-Forderungen', true,
    'keine Forderung gefunden (node_modules fehlt?)');
}

/* Beide Jobs auf derselben Fassung: sonst baut der eine gegen eine
   andere Grundlage als der andere. */
const distinct = [...new Set(nodeVersions.map((n) => n.version))];
check('Alle Jobs nutzen dieselbe Node-Fassung', distinct.length === 1,
  distinct.join(' vs. '));

/* ---------- JDK gegen das, worauf Capacitor uebersetzt ----------

   Capacitor 8 schreibt JavaVersion.VERSION_21 in die erzeugte
   app/capacitor.build.gradle und fuehrt dieselbe Fassung fest im
   Modul :capacitor-android unter node_modules. Beides ist nicht
   einstellbar. Ist das JDK des Laeufers aelter, bricht Gradle mit
   "invalid source release" ab — erst nach SDK-Einrichtung und
   Installation, also spaet.                                        */

let jdk = null;
Object.values(doc.jobs || {}).forEach((job) => {
  (job.steps || []).forEach((step) => {
    if (String(step.uses || '').startsWith('actions/setup-java')) {
      jdk = Number(step.with?.['java-version']);
    }
  });
});

check('Android-Job legt ein JDK fest', Number.isFinite(jdk), String(jdk));

/* Hoechste JavaVersion aus allen Gradle-Dateien lesen, die den Build
   wirklich beeinflussen — auch der aus node_modules. */
const gradleFiles = [
  path.join(ROOT, 'android', 'app', 'capacitor.build.gradle'),
  path.join(ROOT, 'android', 'capacitor-cordova-android-plugins', 'build.gradle'),
  path.join(ROOT, 'node_modules', '@capacitor', 'android', 'capacitor', 'build.gradle'),
];

let javaNeeded = 0;
let javaFrom = '';
gradleFiles.forEach((f) => {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { return; }

  const found = text.match(/JavaVersion\.VERSION_(\d+)/g) || [];
  found.forEach((m) => {
    const major = Number(m.replace('JavaVersion.VERSION_', ''));
    if (major > javaNeeded) {
      javaNeeded = major;
      javaFrom = path.relative(ROOT, f).replace(/\\/g, '/');
    }
  });
});

if (javaNeeded > 0 && Number.isFinite(jdk)) {
  check('JDK im Workflow passt zu Capacitors Java-Fassung',
    jdk >= javaNeeded,
    jdk >= javaNeeded
      ? `JDK ${jdk} deckt VERSION_${javaNeeded} (${javaFrom})`
      : `${javaFrom} uebersetzt auf ${javaNeeded}, Workflow nutzt JDK ${jdk}`);
} else {
  check('JDK im Workflow passt zu Capacitors Java-Fassung', true,
    'keine JavaVersion gefunden (android/ oder node_modules fehlt?)');
}

/* ---------- Android: Installierbarkeit ----------

   Eine Debug-APK sieht fertig aus, laesst sich aber nicht
   installieren: sie traegt android:debuggable und ein
   Wegwerf-Zertifikat. Android meldet dann nur "App nicht
   installiert", ohne Grund zu nennen — der Fehler faellt erst auf
   dem Telefon auf. Deshalb hier. */

const androidJob = doc.jobs?.android;
const androidSteps = androidJob?.steps || [];
const stepText = JSON.stringify(androidSteps);

check('Android baut assembleRelease, nicht assembleDebug',
  stepText.includes('assembleRelease') && !stepText.includes('assembleDebug'),
  stepText.includes('assembleDebug')
    ? 'assembleDebug erzeugt eine nicht installierbare APK'
    : 'assembleRelease');

check('Signaturschluessel kommt aus den Secrets',
  stepText.includes('ANDROID_KEYSTORE_BASE64'),
  'secrets.ANDROID_KEYSTORE_BASE64');

check('Die Signatur wird vor dem Hochladen geprueft',
  stepText.includes('apksigner') && stepText.includes('CN=Android Debug'),
  'Schritt "Signatur pruefen"');

/* Der Schluessel darf nie im Repo landen. */
const keystoreInRepo = ['jks', 'keystore', 'p12'].some((ext) => {
  try {
    return fs.readdirSync(ROOT).some((f) => f.toLowerCase().endsWith('.' + ext));
  } catch { return false; }
});
check('Kein Signaturschluessel im Repo', !keystoreInRepo,
  keystoreInRepo ? 'Schluesseldatei im Projektordner gefunden' : 'sauber');

/* ---------- Android: Startsymbol ----------

   Das Symbol kam von `cap add` und zeigte Capacitors Standard —
   den gruenen Roboter. Wer es aus Versehen wieder erzeugen laesst,
   soll das hier merken, nicht auf dem Startbildschirm. */

const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

function readIf(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

const fgVector = readIf(path.join(RES, 'drawable', 'ic_launcher_foreground.xml'));

check('Startsymbol stammt aus logo.svg',
  fgVector.includes('make-android-icons.js'),
  fgVector ? 'eigener Vektor' : 'drawable/ic_launcher_foreground.xml fehlt');

/* Capacitors Vorlage bringt eine Datei unter drawable-v24 mit. Sie
   wuerde die eigene in drawable/ auf Android 7+ verdecken. */
check('Keine alte Vektorfassung unter drawable-v24',
  !fs.existsSync(path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml')),
  'drawable-v24 verdeckt drawable/');

/* Bei runder Maske bleibt nur ein Kreis von 33dp Radius sichtbar.
   Das Motiv misst ab Mitte 11 x 7 Einheiten (inkl. halber
   Strichbreite), die Halbdiagonale also 13.04 — mehr als Faktor
   2.53 schneidet der Launcher an. */
const scaleMatch = fgVector.match(/android:scaleX="([\d.]+)"/);
if (scaleMatch) {
  const scale = Number(scaleMatch[1]);
  const corner = Math.hypot(11 * scale, 7 * scale);
  check('Motiv bleibt in der Sicherheitszone',
    corner <= 33,
    `Ecke bei ${corner.toFixed(1)}dp (Grenze 33dp, Maßstab ${scale})`);
} else {
  check('Motiv bleibt in der Sicherheitszone', false, 'kein scaleX im Vektor gefunden');
}

/* Die PNG sind fuer Android 7 noetig: dort versteht der Launcher
   noch keine adaptiven Symbole. */
const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const missing = densities.filter((d) =>
  !fs.existsSync(path.join(RES, `mipmap-${d}`, 'ic_launcher.png')) ||
  !fs.existsSync(path.join(RES, `mipmap-${d}`, 'ic_launcher_round.png')));
check('PNG-Symbole fuer Android 7 vollstaendig', missing.length === 0,
  missing.length ? 'fehlt in: ' + missing.join(', ') : densities.length + ' Aufloesungen');

/* Der Hintergrund war eine weisse Farbflaeche; jetzt ist es der
   Verlauf aus logo.svg. Bliebe die Farbe liegen, gewaenne sie. */
check('Hintergrund ist der Verlauf, keine Farbflaeche',
  !fs.existsSync(path.join(RES, 'values', 'ic_launcher_background.xml')) &&
  readIf(path.join(RES, 'drawable', 'ic_launcher_background.xml')).includes('gradient'),
  'drawable/ic_launcher_background.xml');

results.forEach((r) => {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
