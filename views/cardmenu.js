/* Kontextmenue der Kacheln.
   Aus renderer.js herausgeloest; teilt sich mit ihm den globalen
   Bereich (state, el, api, t, buildCard, …) und wird nach ihm geladen. */

/* ======================== KONTEXTMENUE ========================
   Rechtsklick (oder Menue-Taste) auf einer Kachel: alles, was sonst
   erst beim Ueberfahren erscheint, plus "Zur Serie"/"Zum Album".
   Die Eintraege rufen dieselben Funktionen wie die Kachel-Knoepfe —
   und die Knoepfe auf der Kachel werden danach gleich mitgezogen. */

let cardMenu = null;

function closeCardMenu({ restoreFocus = false } = {}) {
  if (!cardMenu) return;
  const { node, origin } = cardMenu;
  cardMenu = null;
  node.remove();
  document.removeEventListener('mousedown', onCardMenuOutside, true);
  window.removeEventListener('blur', closeCardMenu);
  window.removeEventListener('resize', closeCardMenu);
  el.mainPanel?.removeEventListener('scroll', closeCardMenu, true);
  if (restoreFocus && origin?.isConnected) origin.focus();
}

function onCardMenuOutside(event) {
  if (cardMenu && !cardMenu.node.contains(event.target)) closeCardMenu();
}

function openCardMenu(item, card, x, y) {
  closeCardMenu();

  const played = Boolean(item.UserData?.Played);
  const favorite = Boolean(item.UserData?.IsFavorite);
  const entries = [];

  if (item.Type !== 'Series' && item.Type !== 'MusicArtist') {
    entries.push({ label: t('card.play'), icon: ICON_PLAY, run: () => playItem(item) });
  }
  entries.push({ label: t('card.info'), icon: ICON_INFO, run: () => openItem(item) });
  if (item.Type === 'Episode' && item.SeriesId) {
    entries.push({
      label: t('menu.goToSeries'), icon: ICON_LIST,
      run: () => openItem({ Id: item.SeriesId, Name: item.SeriesName, Type: 'Series' })
    });
  }
  if (item.Type === 'Audio' && item.AlbumId) {
    entries.push({
      label: t('menu.goToAlbum'), icon: ICON_LIST,
      run: () => openItem({ Id: item.AlbumId, Name: item.Album, Type: 'MusicAlbum' })
    });
  }
  entries.push('-');
  entries.push({
    label: favorite ? t('card.removeFavorite') : t('card.addFavorite'),
    icon: favorite ? ICON_CHECK : ICON_PLUS,
    run: () => {
      const btn = card.querySelector('.card-icon-btn.fav');
      if (btn) toggleFavorite(item, btn);
    }
  });
  if (item.Type !== 'MusicArtist') {
    entries.push({
      label: played ? t('card.markUnwatched') : t('card.markWatched'),
      icon: ICON_EYE,
      run: () => card.querySelector('.card-icon-btn.seen')?.click()
    });
  }
  entries.push({ label: t('card.playlist'), icon: ICON_LIST, run: () => openPlaylistModal(item) });
  if (isDownloadable(item)) {
    entries.push({ label: t('card.download'), icon: ICON_DOWNLOAD, run: () => openDownloadModal(item) });
  }
  if (card.querySelector('.card-icon-btn.dismiss')) {
    entries.push({ label: t('card.dismiss'), icon: ICON_X, run: () => card.querySelector('.card-icon-btn.dismiss').click() });
  }

  const node = document.createElement('div');
  node.className = 'context-menu';
  node.setAttribute('role', 'menu');
  node.setAttribute('aria-label', item.Name || t('card.untitled'));

  entries.forEach((entry) => {
    if (entry === '-') {
      node.insertAdjacentHTML('beforeend', '<div class="context-sep" role="separator"></div>');
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-item';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1;
    btn.innerHTML = `${entry.icon}<span></span>`;
    btn.querySelector('span').textContent = entry.label;
    btn.addEventListener('click', () => {
      closeCardMenu();
      entry.run();
    });
    node.appendChild(btn);
  });

  // Pfeiltasten wandern, Escape schliesst und gibt den Fokus zurueck
  node.addEventListener('keydown', (event) => {
    const items = [...node.querySelectorAll('.context-item')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length].focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      closeCardMenu({ restoreFocus: true });
    }
  });

  document.body.appendChild(node);

  // Im Fenster halten
  const rect = node.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  node.style.left = `${Math.max(8, left)}px`;
  node.style.top = `${Math.max(8, top)}px`;

  cardMenu = { node, origin: card };
  node.querySelector('.context-item')?.focus();

  document.addEventListener('mousedown', onCardMenuOutside, true);
  window.addEventListener('blur', closeCardMenu);
  window.addEventListener('resize', closeCardMenu);
  el.mainPanel?.addEventListener('scroll', closeCardMenu, true);
}
