/* ========================= WER SCHAUT? =========================
   Profilauswahl auf dem Anmeldebildschirm.

   Zwei Quellen, eine Liste:
   - Gespeicherte Konten (jf-servers): Ein Klick meldet sofort an, das
     Token liegt verschluesselt im Tresor.
   - Oeffentliche Benutzer des eingetragenen Servers (/Users/Public):
     Ein Klick traegt den Namen ein und springt ins Passwortfeld — oder
     meldet direkt an, wenn das Konto kein Passwort hat.

   Familien wechseln so ohne Tippen. Ohne Konten und ohne oeffentliche
   Benutzer bleibt die Auswahl unsichtbar; das Formular ist wie bisher.

   Braucht: renderer.js (state, el, t, escapeHtml, enterApp, setAuthError,
   normalizeServerUrl, resolveServerUrl, buildAuthHeader) und settings.js
   (loadServers, avatarMarkup, serverLabel, serverHost, switchToServer).
   Wird nach settings.js geladen.
   =============================================================== */

const profiles = {
  publicUsers: [],
  loadedFor: '',
  token: 0
};

/** Bild eines oeffentlichen Benutzers — ohne Anmeldung abrufbar */
function publicUserImage(serverUrl, user, size = 160) {
  if (!user.PrimaryImageTag) return '';
  return `${serverUrl}/Users/${user.Id}/Images/Primary?maxHeight=${size}&quality=90&tag=${encodeURIComponent(user.PrimaryImageTag)}`;
}

/** Oeffentliche Benutzer des Servers im Formular nachladen.
 *  Leise: ein Server, der sie nicht zeigt (Standard bei vielen
 *  Installationen), ist kein Fehler. */
async function loadPublicUsers() {
  const raw = $('server-url')?.value.trim();
  if (!raw) return;
  const url = normalizeServerUrl(raw);
  if (url === profiles.loadedFor) return;

  const token = ++profiles.token;
  profiles.loadedFor = url;
  profiles.publicUsers = [];
  renderProfilePicker();

  try {
    const resolved = await resolveServerUrl(url);
    if (!resolved.reachable || token !== profiles.token) return;
    const response = await fetch(`${resolved.url}/Users/Public`, {
      headers: { Accept: 'application/json', Authorization: buildAuthHeader() }
    });
    if (!response.ok || token !== profiles.token) return;
    const users = await response.json();
    profiles.publicUsers = (Array.isArray(users) ? users : []).map((u) => ({ ...u, serverUrl: resolved.url }));
  } catch (error) {
    /* Server nicht erreichbar — das Formular meldet es beim Anmelden */
  }
  if (token === profiles.token) renderProfilePicker();
}

function profileTile({ face, name, place, onClick, ariaLabel }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'profile-tile';
  btn.setAttribute('role', 'listitem');
  btn.setAttribute('aria-label', ariaLabel);
  btn.innerHTML = `${face}<strong></strong>${place ? '<small></small>' : ''}`;
  btn.querySelector('strong').textContent = name;
  if (place) btn.querySelector('small').textContent = place;
  btn.addEventListener('click', onClick);
  return btn;
}

function renderProfilePicker() {
  const host = $('profile-list');
  const picker = $('profile-picker');
  if (!host || !picker) return;

  const saved = loadServers().filter((s) => s.token);
  const savedKeys = new Set(saved.map((s) => `${s.serverUrl}|${s.userId}`));
  // Wer schon gespeichert ist, erscheint nur einmal — mit Sofort-Anmeldung
  const others = profiles.publicUsers.filter((u) => !savedKeys.has(`${u.serverUrl}|${u.Id}`));

  host.innerHTML = '';
  const multipleServers = new Set(saved.map((s) => s.serverUrl)).size > 1;

  saved.forEach((entry) => {
    host.appendChild(profileTile({
      face: avatarMarkup(entry, 72, 'profile-face'),
      name: entry.username || t('profile.user'),
      place: multipleServers ? serverLabel(entry) : '',
      ariaLabel: t('profiles.signInAs', { name: entry.username || '' }),
      onClick: () => signInSaved(entry)
    }));
  });

  others.forEach((user) => {
    const src = publicUserImage(user.serverUrl, user);
    const initial = escapeHtml((user.Name || '?').charAt(0).toUpperCase());
    host.appendChild(profileTile({
      face: `<span class="user-avatar profile-face">${initial}${src ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`,
      name: user.Name,
      place: '',
      ariaLabel: t('profiles.signInAs', { name: user.Name }),
      onClick: () => pickPublicUser(user)
    }));
  });

  picker.classList.toggle('hidden', host.children.length === 0);
}

/** Gespeichertes Konto: Token pruefen und hinein. Ist es abgelaufen,
 *  steht das Formular mit Server und Namen bereit. */
async function signInSaved(entry) {
  setAuthError('');
  const tile = [...document.querySelectorAll('.profile-tile')]
    .find((b) => b.getAttribute('aria-label') === t('profiles.signInAs', { name: entry.username || '' }));
  tile?.classList.add('loading');

  const previous = { serverUrl: state.serverUrl, token: state.token, userId: state.userId, username: state.username };
  Object.assign(state, {
    serverUrl: entry.serverUrl, token: entry.token, userId: entry.userId, username: entry.username
  });

  try {
    await api(`/Users/${entry.userId}`);
    try {
      vault.setJSON('jf-session', {
        serverUrl: entry.serverUrl, token: entry.token, userId: entry.userId, username: entry.username
      });
    } catch (error) {
      /* Merken ist optional */
    }
    await enterApp();
  } catch (error) {
    Object.assign(state, previous);
    $('server-url').value = entry.serverUrl;
    $('username').value = entry.username || '';
    $('password').value = '';
    setAuthError(t('server.sessionExpired'));
    $('password').focus();
  } finally {
    tile?.classList.remove('loading');
  }
}

/** Oeffentlicher Benutzer: Namen eintragen. Ohne Passwort gleich
 *  anmelden, sonst ins Passwortfeld. */
function pickPublicUser(user) {
  setAuthError('');
  $('server-url').value = user.serverUrl;
  $('username').value = user.Name;
  $('password').value = '';

  if (user.HasPassword === false) {
    // Das Formular verlangt sonst eines; der Submit-Handler kennt die Ausnahme
    $('password').removeAttribute('required');
    el.connectForm.requestSubmit();
    $('password').setAttribute('required', '');
    return;
  }
  $('password').focus();
}

$('server-url')?.addEventListener('change', loadPublicUsers);
$('server-url')?.addEventListener('blur', loadPublicUsers);

/** Vom Anmeldebildschirm aufgerufen, wann immer er erscheint */
function showProfilePicker() {
  renderProfilePicker();
  loadPublicUsers();
}
