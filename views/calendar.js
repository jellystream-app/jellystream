/* Kalender und Reihe "Demnaechst".
   Aus renderer.js herausgeloest; teilt sich mit ihm den globalen
   Bereich (state, el, api, t, buildCard, …) und wird nach ihm geladen. */

/** Reihe "Demnaechst" aus /Shows/Upcoming — oder null, wenn nichts ansteht.
 *
 *  Die Kachel nennt das Datum statt des Jahres: "Fr., 9. Okt." sagt
 *  mehr als "2026". Was heute erscheint, heisst "Heute". */
async function loadUpcomingRow(libraryId) {
  let data;
  try {
    data = await api(`/Shows/Upcoming?userId=${state.userId}&Limit=20&Fields=PremiereDate,SeriesId,DateCreated&EnableImageTypes=Primary,Backdrop,Thumb`);
  } catch (error) {
    return null;
  }
  // Der Server sortiert nicht zuverlaessig nach Datum — das Naechste zuerst
  const items = (data?.Items || [])
    .filter((i) => i.PremiereDate)
    .sort((a, b) => Date.parse(a.PremiereDate) - Date.parse(b.PremiereDate));
  if (!items.length) return null;

  const today = new Date();
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const fmt = new Intl.DateTimeFormat(i18n.code || undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  const withDates = items.map((item) => {
    const date = new Date(item.PremiereDate);
    const when = sameDay(date, today) ? t('upcoming.today') : fmt.format(date);
    const episode = item.IndexNumber != null
      ? t('upcoming.episode', { season: item.ParentIndexNumber ?? '?', episode: item.IndexNumber })
      : '';
    return { item, subtitle: [when, item.SeriesName, episode].filter(Boolean).join(' · ') };
  });

  const row = buildRow(t('upcoming.title'), withDates.map((w) => w.item), {
    libraryId,
    subtitleFor: (item) => withDates.find((w) => w.item === item)?.subtitle,
    badge: ''
  });
  if (row) row.dataset.rowKey = 'upcoming';
  return row;
}

/** Kalender: kommende Folgen nach Tagen gruppiert.
 *  Gleiche Quelle wie die Reihe, aber mehr Titel und nach Datum
 *  gegliedert — fuer den Blick "was kommt diese Woche?". */
async function showCalendar() {
  setActiveNav('calendar');
  setTopGap(true);
  const token = newToken('calendar');
  el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('upcoming.calendar'))}</h2>${skeletonEpisodes(4)}`;

  let items = [];
  try {
    const data = await api(`/Shows/Upcoming?userId=${state.userId}&Limit=100&Fields=PremiereDate,SeriesId,Overview&EnableImageTypes=Primary,Backdrop,Thumb`);
    items = (data?.Items || []).filter((i) => i.PremiereDate);
  } catch (error) {
    if (!isCurrent('calendar', token)) return;
    showError(t('common.error', { error: error.message }), showCalendar);
    return;
  }
  if (!isCurrent('calendar', token)) return;

  el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('upcoming.calendar'))}</h2>`;
  if (!items.length) {
    el.viewRoot.appendChild(emptyState(t('upcoming.none'), goHomeAction()));
    return;
  }

  const lang = i18n.code || undefined;
  const dayFmt = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' });
  const timeFmt = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();

  const days = new Map();
  items
    .sort((a, b) => Date.parse(a.PremiereDate) - Date.parse(b.PremiereDate))
    .forEach((item) => {
      const key = new Date(item.PremiereDate).toDateString();
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(item);
    });

  days.forEach((list, key) => {
    const date = new Date(list[0].PremiereDate);
    const section = document.createElement('section');
    section.className = 'calendar-day';
    const heading = document.createElement('h3');
    heading.className = 'calendar-date';
    heading.textContent = key === today ? t('upcoming.today')
      : key === tomorrow ? t('upcoming.tomorrow')
        : dayFmt.format(date);
    section.appendChild(heading);

    list.forEach((item) => {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'calendar-entry';
      // Folgen ohne eigenes Bild bekommen das der Serie (imageUrl faellt selbst zurueck)
      const thumb = imageUrl(item, 'Primary', 120);
      entry.innerHTML = `
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : '<span class="calendar-thumb"></span>'}
        <span class="calendar-text"><strong></strong><small></small></span>
        <time></time>`;
      entry.querySelector('strong').textContent = item.SeriesName || item.Name;
      entry.querySelector('small').textContent = [
        item.IndexNumber != null ? t('upcoming.episode', { season: item.ParentIndexNumber ?? '?', episode: item.IndexNumber }) : '',
        item.Name
      ].filter(Boolean).join(' · ');
      const hasTime = /T(?!00:00:00)/.test(item.PremiereDate);
      entry.querySelector('time').textContent = hasTime ? timeFmt.format(date) : '';
      entry.addEventListener('click', () =>
        openItem(item.SeriesId ? { Id: item.SeriesId, Name: item.SeriesName, Type: 'Series' } : item));
      section.appendChild(entry);
    });

    el.viewRoot.appendChild(section);
  });
}
