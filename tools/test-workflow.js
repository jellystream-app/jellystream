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
