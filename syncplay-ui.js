/* ======================= GEMEINSAM SCHAUEN =======================
   Bedienung fuer SyncPlay. Das Protokoll steckt in core/syncplay.js;
   hier: Menue in der Navigationsleiste, Anschluss an den Video-Player,
   Hinweise, wenn jemand beitritt oder geht.

   Wie der Player eingebunden ist:
   - togglePlayVideo() und seekTo() fragen syncPlayIntercept(). Solange
     eine Gruppe besteht, wird daraus eine Bitte an den Server; erst sein
     Befehl laesst alle gleichzeitig starten, anhalten oder springen.
   - Ein Titel, der in einer Gruppe gestartet wird, geht als neue
     Warteschlange an den Server (playItem in renderer.js prueft das).

   Wird nach player.js geladen.
   ================================================================= */

const syncUi = {
  busy: false,
  // Laeuft gerade ein vom Server befohlener Schritt? Dann nicht erneut fragen.
  applying: false
};

/** Aus player.js aufgerufen. true = SyncPlay uebernimmt, der Player tut nichts. */
function syncPlayIntercept(action, value) {
  if (!syncplay.active || syncUi.applying || !vpCurrent.item || vpCurrent.local) return false;
  const req = action === 'play' ? syncplay.requestPlay()
    : action === 'pause' ? syncplay.requestPause()
      : syncplay.requestSeek(value);
  req.catch((error) => toast(t('common.error', { error: error.message }), true));
  return true;
}

/* Der Spieler, wie core/syncplay.js ihn sieht */
syncplay.attach({
  play() {
    syncUi.applying = true;
    vp.video.play().catch(() => {}).finally(() => { syncUi.applying = false; });
  },
  pause() {
    syncUi.applying = true;
    vp.video.pause();
    syncUi.applying = false;
  },
  seek(seconds) {
    syncUi.applying = true;
    seekToDirect(seconds);
    syncUi.applying = false;
  },
  stop() {
    closeVideo();
  },
  position: () => mediaPosition(),

  /* Neuer Titel aus der Warteschlange der Gruppe */
  async load(itemId, startSeconds) {
    if (vpCurrent.item?.Id === itemId && !vp.root.classList.contains('hidden')) {
      syncUi.applying = true;
      seekToDirect(startSeconds);
      vp.video.pause();
      syncUi.applying = false;
      return;
    }
    const item = await api(`/Users/${state.userId}/Items/${itemId}`);
    await playVideo(item, [item], { syncStart: startSeconds });
    vp.video.pause();
  },

  /* Bereit, sobald genug geladen ist, um ohne Stocken zu starten */
  whenReady(fn) {
    if (vp.video.readyState >= 3) return fn();
    const done = () => {
      vp.video.removeEventListener('canplay', done);
      fn();
    };
    vp.video.addEventListener('canplay', done);
  }
});

/* Puffern melden, damit die anderen warten statt davonzulaufen */
vp.video.addEventListener('waiting', () => {
  if (syncplay.active && !vp.video.paused) syncplay.buffering();
});

/* ---------------------- Menue ---------------------- */

function syncplayConfigure() {
  syncplay.configure({
    serverUrl: state.serverUrl,
    token: state.token,
    deviceId: getDeviceId(),
    authHeader: buildAuthHeader(state.token)
  });
}

function participantsText(group) {
  const people = group?.Participants || [];
  return people.length ? people.join(', ') : '—';
}

async function renderSyncplayMenu() {
  const body = $('syncplay-body');
  if (!body) return;

  if (syncplay.active) {
    const g = syncplay.group;
    body.innerHTML = `
      <p class="syncplay-current"><strong></strong><small></small></p>
      <p class="settings-hint">${escapeHtml(t('syncplay.howTo'))}</p>
      <button class="outline-btn small danger" id="syncplay-leave" type="button">${escapeHtml(t('syncplay.leave'))}</button>`;
    body.querySelector('strong').textContent = g.GroupName || t('syncplay.group');
    body.querySelector('small').textContent = t('syncplay.members', { names: participantsText(g) });
    $('syncplay-leave').addEventListener('click', async () => {
      await syncplay.leave().catch(() => {});
      renderSyncplayMenu();
    });
    return;
  }

  body.innerHTML = `<div class="syncplay-loading"><div class="spinner small"></div></div>`;
  syncplayConfigure();

  let groups = [];
  try {
    groups = (await syncplay.list()) || [];
  } catch (error) {
    body.innerHTML = '';
    body.appendChild(emptyState(error.message === 'forbidden' ? t('syncplay.forbidden') : t('syncplay.unavailable')));
    return;
  }

  body.innerHTML = `
    <div class="syncplay-groups" role="list"></div>
    <button class="primary-btn small" id="syncplay-create" type="button">${escapeHtml(t('syncplay.create'))}</button>`;

  const list = body.querySelector('.syncplay-groups');
  if (!groups.length) {
    list.innerHTML = `<p class="settings-hint">${escapeHtml(t('syncplay.noGroups'))}</p>`;
  }
  groups.forEach((g) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item syncplay-group';
    btn.setAttribute('role', 'listitem');
    btn.innerHTML = '<span><strong></strong><small></small></span>';
    btn.querySelector('strong').textContent = g.GroupName;
    btn.querySelector('small').textContent = t('syncplay.members', { names: participantsText(g) });
    btn.addEventListener('click', () => runSyncAction(() => syncplay.join(g.GroupId)));
    list.appendChild(btn);
  });

  $('syncplay-create').addEventListener('click', () =>
    runSyncAction(() => syncplay.create(t('syncplay.defaultName', { name: state.username }))));
}

async function runSyncAction(fn) {
  if (syncUi.busy) return;
  syncUi.busy = true;
  try {
    await fn();
  } catch (error) {
    toast(error.message === 'forbidden' ? t('syncplay.forbidden') : t('common.error', { error: error.message }), true);
  } finally {
    syncUi.busy = false;
    renderSyncplayMenu();
  }
}

$('syncplay-btn')?.addEventListener('click', (event) => {
  event.stopPropagation();
  const menu = $('syncplay-menu');
  const opening = menu.classList.contains('hidden');
  toggleMenu(menu, $('syncplay-btn'));
  if (opening) renderSyncplayMenu();
});

/* ---------------------- Anzeige ---------------------- */

function updateSyncplayIndicators() {
  const active = syncplay.active;
  $('syncplay-btn')?.classList.toggle('active', active);
  const badge = $('vp-syncplay');
  if (badge) {
    badge.classList.toggle('hidden', !active);
    badge.textContent = active ? t('syncplay.badge', { count: (syncplay.group?.Participants || []).length }) : '';
  }
}

syncplay.on((type, data) => {
  switch (type) {
    case 'joined':
      toast(t('syncplay.joined', { name: data?.GroupName || '' }));
      break;
    case 'left':
      if (data !== 'Reset') toast(t('syncplay.left'));
      break;
    case 'userJoined':
      toast(t('syncplay.userJoined', { name: data }));
      break;
    case 'userLeft':
      toast(t('syncplay.userLeft', { name: data }));
      break;
    case 'error':
      if (data === 'LibraryAccessDenied') toast(t('syncplay.accessDenied'), true);
      else if (data === 'GroupDoesNotExist') toast(t('syncplay.gone'), true);
      break;
    default:
      break;
  }
  updateSyncplayIndicators();
  if (!$('syncplay-menu')?.classList.contains('hidden')) renderSyncplayMenu();
});

/** Aus renderer.js: Titel in der Gruppe starten statt allein.
 *  true = uebernommen. */
function syncPlayStart(item, siblings = []) {
  if (!syncplay.active) return false;
  const queue = siblings.length ? siblings : [item];
  const index = Math.max(0, queue.findIndex((q) => q.Id === item.Id));
  const start = prefs.resumePlayback ? ticksToSeconds(item.UserData?.PlaybackPositionTicks || 0) : 0;
  syncplay.playQueue(queue.map((q) => q.Id), index, start)
    .catch((error) => toast(t('common.error', { error: error.message }), true));
  return true;
}
