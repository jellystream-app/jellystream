/**
 * Prueft die eigenen Namen fuer Server.
 *
 * Anlass: In der Server-Liste stand nur, was der Server selbst meldet —
 * oft die nackte Adresse. Wer zwei Server hat ("daheim", "beim Bruder"),
 * unterscheidet sie an "192.168.1.40:8096" nicht.
 *
 * Der wichtigste Punkt hier ist die UMKEHRBARKEIT: customName steht
 * NEBEN serverName, nicht an dessen Stelle. Ein leeres Feld muss
 * deshalb zum Namen des Servers zurueckfuehren. Wuerde serverName
 * ueberschrieben, waere der Weg zurueck verloren — und das faellt erst
 * auf, wenn es zu spaet ist.
 *
 * Aufruf:  npx electron tools/test-servers.js
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

const SLOW = Number(process.env.JF_TEST_SLOW) || 1;
const settle = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));

const ROOT = path.join(__dirname, '..');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });

  await win.loadFile(path.join(ROOT, 'index.html'));
  await settle(1000);

  const results = await win.webContents.executeJavaScript(`
    (async () => {
      const out = [];
      const check = (name, ok, detail) => out.push({ name, ok: Boolean(ok), detail: detail || '' });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));

      state.serverUrl = 'http://heim.local';
      state.userId = 'u1';
      state.username = 'Jason';

      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      await wait(200);

      /* Zwei Server, einer davon der aktive. Der zweite meldet keinen
         Namen — genau der Fall, der die Umbenennung noetig macht. */
      const seed = () => saveServers([
        { serverUrl: 'http://heim.local', serverName: 'Heimserver',
          userId: 'u1', username: 'Jason', token: 't1' },
        { serverUrl: 'http://192.168.1.40:8096',
          userId: 'u2', username: 'Jason', token: 't2' }
      ]);
      seed();

      /* ================================================================
         1. DER NAME — eigener, sonst Server, sonst Adresse
         ================================================================ */

      check('serverLabel() vorhanden', typeof serverLabel === 'function');
      check('renameServer() vorhanden', typeof renameServer === 'function');

      check('Ohne eigenen Namen gilt der des Servers',
            serverLabel({ serverName: 'Heimserver', serverUrl: 'http://heim.local' }) === 'Heimserver');
      check('Eigener Name gewinnt',
            serverLabel({ customName: 'Daheim', serverName: 'Heimserver' }) === 'Daheim');
      check('Ohne beides bleibt die Adresse',
            serverLabel({ serverUrl: 'http://192.168.1.40:8096' }) === '192.168.1.40:8096');
      check('Kein Absturz ohne Eintrag',
            serverLabel(undefined) !== undefined || true);

      /* ================================================================
         2. SPEICHERN UND ZURUECKNEHMEN
         ================================================================ */

      renameServer('http://192.168.1.40:8096', 'u2', 'Beim Bruder');
      let stored = loadServers().find((s) => s.userId === 'u2');
      check('Eigener Name wird gespeichert', stored.customName === 'Beim Bruder', String(stored.customName));

      /* Die Kernpruefung: Der gemeldete Name des ANDEREN Servers darf
         durch das Umbenennen nicht angetastet werden. */
      const other = loadServers().find((s) => s.userId === 'u1');
      check('Der gemeldete Name bleibt erhalten', other.serverName === 'Heimserver', String(other.serverName));

      renameServer('http://192.168.1.40:8096', 'u2', '   ');
      stored = loadServers().find((s) => s.userId === 'u2');
      check('Leeres Feld nimmt den Namen zurueck', stored.customName === undefined, String(stored.customName));

      renameServer('http://heim.local', 'u1', '  Daheim  ');
      stored = loadServers().find((s) => s.userId === 'u1');
      check('Leerzeichen werden abgeschnitten', stored.customName === 'Daheim', JSON.stringify(stored.customName));
      check('Zurueck zum Servernamen ist moeglich', stored.serverName === 'Heimserver');

      renameServer('http://gibtesnicht', 'uX', 'Nichts');
      check('Unbekannter Server aendert nichts', loadServers().length === 2);

      /* ================================================================
         3. DIE ANZEIGE
         ================================================================ */

      renderSettingsServers();
      await wait(120);

      const rows = document.querySelectorAll('#settings-servers .settings-server-row');
      check('Beide Server werden gezeigt', rows.length === 2, rows.length + ' Zeilen');

      const firstName = rows[0]?.querySelector('.server-meta strong')?.textContent || '';
      check('Der eigene Name steht in der Liste', firstName === 'Daheim', firstName);

      /* Die Adresse muss sichtbar bleiben. Wer umbenennt, tut das ja,
         weil ihm die Adresse nichts sagt — unterscheiden muss er zwei
         Server trotzdem koennen. */
      const firstMeta = rows[0]?.querySelector('.server-meta small')?.textContent || '';
      check('Die Adresse bleibt sichtbar', firstMeta.includes('heim.local'), firstMeta);

      check('Jede Zeile hat einen Stift',
            document.querySelectorAll('#settings-servers .rename-server').length === 2);

      /* Das Feld ist zunaechst verborgen und traegt den gemeldeten
         Namen als Platzhalter — so ist sichtbar, wohin ein leeres Feld
         zurueckfuehrt. */
      const field = rows[1]?.querySelector('.server-rename');
      check('Das Feld ist zunaechst verborgen', field?.classList.contains('hidden'));

      const input = field?.querySelector('input');
      check('Der Platzhalter zeigt, was ohne eigenen Namen gilt',
            input?.placeholder === '192.168.1.40:8096', input?.placeholder);

      /* ================================================================
         4. BEDIENUNG — Stift, Eingabe, Enter
         ================================================================ */

      rows[1].querySelector('.rename-server').click();
      await wait(80);
      check('Der Stift oeffnet das Feld', !field.classList.contains('hidden'));
      check('Name und Adresse machen Platz',
            rows[1].querySelector('.server-meta').classList.contains('hidden'));

      input.value = 'Beim Bruder';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(120);

      stored = loadServers().find((s) => s.userId === 'u2');
      check('Enter uebernimmt den Namen', stored.customName === 'Beim Bruder', String(stored.customName));

      const after = document.querySelectorAll('#settings-servers .settings-server-row');
      const secondName = after[1]?.querySelector('.server-meta strong')?.textContent || '';
      check('Die Liste zeigt den neuen Namen sofort', secondName === 'Beim Bruder', secondName);

      /* Abbrechen darf nichts speichern. */
      after[1].querySelector('.rename-server').click();
      await wait(80);
      const liveRows = document.querySelectorAll('#settings-servers .settings-server-row');
      const liveInput = liveRows[1].querySelector('.server-rename input');
      liveInput.value = 'Verworfen';
      liveInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(120);

      stored = loadServers().find((s) => s.userId === 'u2');
      check('Escape verwirft die Eingabe', stored.customName === 'Beim Bruder', String(stored.customName));

      /* ================================================================
         5. ERNEUTES ANMELDEN VERGISST DEN NAMEN NICHT
         ================================================================ */

      /* rememberServer() bekommt beim erneuten Anmelden nur die
         frischen Zugangsdaten. Fuehrte es nicht zusammen, waere der
         eigene Name nach jeder Neuanmeldung weg. */
      const merged = rememberServer({
        serverUrl: 'http://192.168.1.40:8096',
        serverName: '192.168.1.40:8096',
        userId: 'u2', username: 'Jason', token: 'neu'
      });

      check('rememberServer() gibt den Eintrag zurueck', Boolean(merged));
      check('Erneutes Anmelden behaelt den eigenen Namen',
            merged.customName === 'Beim Bruder', String(merged?.customName));
      check('Der neue Zugang gilt', merged.token === 'neu');

      stored = loadServers().find((s) => s.userId === 'u2');
      check('Auch im Speicher bleibt der Name',
            stored.customName === 'Beim Bruder', String(stored.customName));

      /* Aufraeumen: der Test darf keine Server hinterlassen. */
      try { localStorage.removeItem('jf-servers'); } catch (e) {}

      return out;
    })()
  `);

  results.forEach((r) => {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  });

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} bestanden`);

  win.destroy();
  app.exit(failed ? 1 : 0);
});
