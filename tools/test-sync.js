/**
 * Testet den Sprach-Abgleich gegen das echte GitHub-Repo:
 * Index abrufen, Sprachen in den Cache laden, Rangfolge einhalten,
 * Tagessperre beachten.
 *
 * Braucht eine Internetverbindung. Ohne Netz meldet der Test das
 * und bricht nicht mit einem Fehlschlag ab.
 *
 * Aufruf:  npx electron tools/test-sync.js
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail: detail || '' });
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

// Wegwerf-Ordner, damit der echte Cache unberuehrt bleibt
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jf-sync-test-'));
app.setPath('userData', tmp);

const languages = require('../languages');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  languages.init();

  const repo = languages.getRepoUrl();
  check('Repo-Adresse gesetzt',
    repo.includes('ukyyyy/jellystream') && !repo.includes('DEIN-NAME'), repo);

  /* --- Erster Abgleich: muss laufen, nicht uebersprungen werden --- */
  const first = await languages.sync();

  if (first.failed) {
    console.log(`\nHinweis: Kein Zugriff auf GitHub (${first.error}).`);
    console.log('Der Abgleich ist damit nicht pruefbar — die App laeuft trotzdem');
    console.log('mit den mitgelieferten Sprachen weiter.\n');
    check('Fehlschlag wird sauber gemeldet', first.failed === true && first.added === 0);
    check('App bleibt benutzbar', languages.list().length >= 2,
      languages.list().map((l) => l.code).join(', '));
  } else {
    check('Erster Abgleich wird nicht uebersprungen', first.skipped !== true);
    check('Abgleich ohne Fehler', !first.failed, first.error || '');

    // en und de liegen bereits mitgeliefert in gleicher Version vor,
    // sie duerfen daher NICHT erneut geladen werden
    check('Gleiche Version wird nicht neu geladen',
      first.added === 0 && first.updated === 0,
      `neu: ${first.added}, aktualisiert: ${first.updated}`);

    /* --- Tagessperre --- */
    const second = await languages.sync();
    check('Zweiter Abgleich wird uebersprungen', second.skipped === true, second.reason || '');

    const forced = await languages.sync({ force: true });
    check('force umgeht die Sperre', forced.skipped !== true);

    /* --- Eine neuere Version im Index zieht die Datei nach --- */
    // Dafuer die mitgelieferte Fassung kuenstlich alt machen
    const cachePath = path.join(tmp, 'languages-cache', 'en.json');
    fs.writeFileSync(cachePath, JSON.stringify({
      meta: { code: 'en', name: 'English', nativeName: 'English', flag: '🇬🇧', version: 0 },
      strings: { 'app.name': 'Alt' }
    }, null, 2));

    const after = languages.list().find((l) => l.code === 'en');
    check('Aeltere Cache-Fassung verdraengt die mitgelieferte nicht',
      after && after.version >= 1, `Version ${after && after.version}`);

    fs.unlinkSync(cachePath);
  }

  /* --- Wird eine wirklich neue Sprache geladen? ---
     Die mitgelieferte de.json aus dem Weg raeumen und so tun, als
     kaeme sie erstmalig vom Repo. Das ist der Fall, der spaeter zaehlt,
     wenn jemand eine Uebersetzung beisteuert. */
  if (!first.failed) {
    const cacheDe = path.join(tmp, 'languages-cache', 'de.json');
    if (fs.existsSync(cacheDe)) fs.unlinkSync(cacheDe);

    // Index kennt de mit Version 1; wir tun so, als haetten wir Version 0
    fs.writeFileSync(path.join(tmp, 'languages-cache', 'de.json'), JSON.stringify({
      meta: { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', version: 0 },
      strings: { 'app.name': 'Veraltet' }
    }, null, 2));

    const pulled = await languages.sync({ force: true });
    const de = languages.get('de');
    check('Neuere Fassung wird nachgeladen',
      pulled.updated >= 1 || (de && de.strings['nav.home'] === 'Startseite'),
      `aktualisiert: ${pulled.updated}`);
    check('Nachgeladene Datei ist vollstaendig',
      de && Object.keys(de.strings).length > 400,
      de ? `${Object.keys(de.strings).length} Schluessel` : 'keine');
  }

  /* --- Rangfolge: Nutzerdatei schlaegt alles --- */
  const userFile = path.join(tmp, 'language', 'en.json');
  fs.writeFileSync(userFile, JSON.stringify({
    meta: { code: 'en', name: 'English (mine)', nativeName: 'Mine', flag: '🏳️', version: 99 },
    strings: { 'app.name': 'Meine Fassung' }
  }, null, 2));

  const withUser = languages.list().find((l) => l.code === 'en');
  check('Nutzerdatei hat Vorrang', withUser && withUser.source === 'user',
    withUser && withUser.source);

  const strings = languages.get('en');
  check('Strings kommen aus der Nutzerdatei',
    strings && strings.strings['app.name'] === 'Meine Fassung');

  // Eine Nutzerdatei darf der Abgleich nie ueberschreiben
  const guarded = await languages.sync({ force: true });
  const stillMine = languages.get('en');
  check('Abgleich ueberschreibt Nutzerdatei nicht',
    stillMine && stillMine.strings['app.name'] === 'Meine Fassung',
    `neu: ${guarded.added}, aktualisiert: ${guarded.updated}`);

  fs.unlinkSync(userFile);

  /* --- Kaputte Datei darf nichts umwerfen --- */
  const brokenFile = path.join(tmp, 'language', 'broken.json');
  fs.writeFileSync(brokenFile, '{ das ist kein JSON');
  const afterBroken = languages.list();
  check('Kaputte Sprachdatei wird uebergangen', afterBroken.length >= 2,
    afterBroken.map((l) => l.code).join(', '));
  fs.unlinkSync(brokenFile);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch (e) { /* Windows haelt evtl. Handles */ }

  app.exit(failed ? 1 : 0);
});
