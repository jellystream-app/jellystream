/* ============================================================
   Mobile Einstellungen

   Als Liste statt Seitenleiste — auf schmalen Bildschirmen die
   übliche und bedienbare Form. Die Werte sind dieselben wie beim
   Desktop und liegen im selben localStorage-Schlüssel, damit sich
   die Fassungen nicht widersprechen.
   ============================================================ */

const prefs = {
  autoplayNext: true,
  preferSubtitles: false,
  resumePlayback: true,
  startVolume: 1,
  seekStep: 10
};

function loadPrefs() {
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem('jf-prefs') || '{}'));
  } catch (error) {
    /* Standardwerte behalten */
  }
}

function savePrefs() {
  try {
    // Nur die eigenen Schlüssel überschreiben: der Desktop legt hier
    // weitere ab (Themes, eigenes CSS), die sollen erhalten bleiben.
    const existing = JSON.parse(localStorage.getItem('jf-prefs') || '{}');
    localStorage.setItem('jf-prefs', JSON.stringify({ ...existing, ...prefs }));
  } catch (error) {
    console.warn('Einstellungen nicht speicherbar');
  }
}

function openSettings() {
  buildSettings();
  ui.settings.classList.remove('hidden');
}

function closeSettings() {
  ui.settings.classList.add('hidden');
  return true;
}

$m('m-settings-btn').addEventListener('click', openSettings);
$m('m-settings-close').addEventListener('click', closeSettings);

/* ---------------- Aufbau ---------------- */

function settingRow({ label, hint, control }) {
  const row = document.createElement('label');
  row.className = 'm-set-row';
  row.innerHTML = `
    <span class="m-set-label">
      <strong>${escapeHtml(label)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </span>`;
  if (control) row.appendChild(control);
  return row;
}

function toggle(checked, onChange) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'm-switch';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return input;
}

function actionRow(label, hint, onClick) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'm-set-row';
  row.style.width = '100%';
  row.style.textAlign = 'left';
  row.innerHTML = `
    <span class="m-set-label">
      <strong>${escapeHtml(label)}</strong>
      ${hint ? `<small>${escapeHtml(hint)}</small>` : ''}
    </span>
    <span class="m-set-value">›</span>`;
  row.addEventListener('click', onClick);
  return row;
}

function group(title) {
  const section = document.createElement('div');
  section.className = 'm-set-group';
  section.innerHTML = `<h3>${escapeHtml(title)}</h3>`;
  return section;
}

function buildSettings() {
  const body = ui.settingsBody;
  body.innerHTML = '';

  /* --- Wiedergabe --- */
  const playback = group(t('settings.playback'));

  playback.appendChild(settingRow({
    label: t('settings.autoplay'),
    hint: t('settings.autoplayHint'),
    control: toggle(prefs.autoplayNext, (on) => { prefs.autoplayNext = on; savePrefs(); })
  }));

  playback.appendChild(settingRow({
    label: t('settings.preferSubs'),
    hint: t('settings.preferSubsHint'),
    control: toggle(prefs.preferSubtitles, (on) => { prefs.preferSubtitles = on; savePrefs(); })
  }));

  playback.appendChild(settingRow({
    label: t('settings.resume'),
    hint: t('settings.resumeHint'),
    control: toggle(prefs.resumePlayback, (on) => { prefs.resumePlayback = on; savePrefs(); })
  }));

  body.appendChild(playback);

  /* --- Sprache --- */
  const language = group(t('settings.language'));

  (i18n.available || []).forEach((lang) => {
    const isActive = lang.code === i18n.code;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'm-set-row';
    row.style.width = '100%';
    row.innerHTML = `
      <span style="font-size:1.5rem;width:34px;flex-shrink:0">${escapeHtml(lang.flag || '🌐')}</span>
      <span class="m-set-label">
        <strong>${escapeHtml(lang.nativeName || lang.name)}</strong>
        ${lang.author ? `<small>${escapeHtml(t('settings.languageBy', { author: lang.author }))}</small>` : ''}
      </span>
      <span class="m-set-value">${isActive ? '✓' : ''}</span>`;

    if (!isActive) {
      row.addEventListener('click', async () => {
        const ok = await setLanguage(lang.code);
        if (!ok) return toast(t('common.error'), true);
        buildSettings();
        toast(t('settings.languageApplied', { name: lang.nativeName || lang.name }));
      });
    }

    language.appendChild(row);
  });

  body.appendChild(language);

  /* --- Server --- */
  const server = group(t('settings.servers'));
  server.appendChild(settingRow({
    label: t('settings.signedInAs'),
    hint: `${state.username || '—'} · ${state.serverUrl || '—'}`
  }));

  server.appendChild(actionRow(t('profile.signOut'), null, () => {
    try { localStorage.removeItem('jf-session'); } catch (e) { /* ignorieren */ }
    state.token = '';
    state.serverUrl = '';
    closeSettings();
    ui.app.classList.add('hidden');
    ui.login.classList.remove('hidden');
  }));

  body.appendChild(server);

  /* --- Über --- */
  const about = group(t('settings.about'));
  about.appendChild(settingRow({
    label: t('settings.application'),
    hint: 'Jellystream'
  }));
  about.appendChild(settingRow({
    label: t('settings.version'),
    hint: window.appInfo?.version || CLIENT_VERSION
  }));
  body.appendChild(about);
}

loadPrefs();

/* Wird nach einem Sprachwechsel aufgerufen (aus core/i18n.js). */
function onLanguageChanged() {
  if (!ui.settings.classList.contains('hidden')) buildSettings();
  if (nav.current) nav.current();
}
