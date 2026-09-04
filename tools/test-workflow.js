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

/* JDK 17: Android baut mit dem mitgelieferten JDK 8 nicht. */
const java = aSteps.find((s) => (s.uses || '').includes('setup-java'));
check('JDK wird eingerichtet', Boolean(java));
check('JDK 17 oder neuer', Number(java?.with?.['java-version']) >= 17,
  String(java?.with?.['java-version']));

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

results.forEach((r) => {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} bestanden`);
process.exit(failed ? 1 : 0);
