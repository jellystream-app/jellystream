/* Statistik.
   Aus renderer.js herausgeloest; teilt sich mit ihm den globalen
   Bereich (state, el, api, t, buildCard, …) und wird nach ihm geladen. */

/* ============================ STATISTIKEN ============================ */

async function showStats() {
  setActiveNav('stats');
  setTopGap(true);
  const token = newToken('stats');
  el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('nav.stats'))}</h2><div class="stats-loading"><div class="spinner"></div></div>`;

  try {
    /* Jellyfin hat keine fertige Auswertung fuer Nutzer. Also alle
       gesehenen Titel holen und hier zaehlen. LastPlayedDate steckt in
       UserData und erlaubt den Blick auf die letzten Tage. */
    const fields = 'RunTimeTicks,Genres,ProductionYear,SeriesName,SeriesId';
    const [moviesData, episodesData] = await Promise.all([
      api(itemsUrl({ IncludeItemTypes: 'Movie', Recursive: 'true', Filters: 'IsPlayed', Fields: fields, Limit: '10000' })),
      api(itemsUrl({ IncludeItemTypes: 'Episode', Recursive: 'true', Filters: 'IsPlayed', Fields: fields, Limit: '10000' }))
    ]);
    if (!isCurrent('stats', token)) return;

    const movies = moviesData?.Items || [];
    const episodes = episodesData?.Items || [];
    const all = [...movies, ...episodes];

    const hoursOf = (items) =>
      Math.round(items.reduce((sum, it) => sum + ticksToSeconds(it.RunTimeTicks), 0) / 3600);

    const playedWithin = (days) => {
      const since = Date.now() - days * 86400000;
      return all.filter((it) => {
        const when = Date.parse(it.UserData?.LastPlayedDate || '');
        return when && when >= since;
      });
    };
    const week = playedWithin(7);
    const month = playedWithin(30);

    const countBy = (items, keyFn) => {
      const counts = new Map();
      items.forEach((it) => {
        [].concat(keyFn(it) || []).forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    };

    // Folgen tragen selten eigene Genres — dann zaehlen nur die Filme
    const topGenres = countBy(all, (it) => it.Genres).slice(0, 8);
    const topSeries = countBy(episodes, (it) => it.SeriesName).slice(0, 6);
    const decades = countBy(movies, (it) => (it.ProductionYear ? `${Math.floor(it.ProductionYear / 10) * 10}s` : null))
      .slice(0, 6);

    const bars = (rows) => {
      const max = rows[0]?.[1] || 1;
      return `<div class="stat-bars">${rows.map(([label, count]) => `
        <div class="stat-bar-row">
          <span class="stat-bar-label">${escapeHtml(label)}</span>
          <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${Math.round((count / max) * 100)}%"></div></div>
          <span class="stat-bar-val">${count}</span>
        </div>`).join('')}</div>`;
    };

    const card = (num, label, sub = '') => `
      <div class="stat-card">
        <div class="stat-num">${escapeHtml(String(num))}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
        ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
      </div>`;

    const section = (title, rows) => (rows.length
      ? `<h3 class="stats-section-title">${escapeHtml(title)}</h3>${bars(rows)}`
      : '');

    if (!all.length) {
      el.viewRoot.innerHTML = `<h2 class="section-title">${escapeHtml(t('nav.stats'))}</h2>`;
      showEmpty(t('stats.empty'), { label: t('empty.discover'), run: () => navigate(showHome) });
      return;
    }

    el.viewRoot.innerHTML = `
      <h2 class="section-title">${escapeHtml(t('nav.stats'))}</h2>

      <div class="stats-grid">
        ${card(hoursOf(all), t('stats.hoursTotal'))}
        ${card(movies.length, t('stats.movies'), t('stats.hours', { n: hoursOf(movies) }))}
        ${card(episodes.length, t('stats.episodes'), t('stats.hours', { n: hoursOf(episodes) }))}
        ${card(hoursOf(week), t('stats.hoursWeek'), t('stats.titles', { n: week.length }))}
        ${card(hoursOf(month), t('stats.hoursMonth'), t('stats.titles', { n: month.length }))}
      </div>

      ${section(t('stats.topSeries'), topSeries)}
      ${section(t('stats.topGenres'), topGenres)}
      ${section(t('stats.decades'), decades)}`;
  } catch (error) {
    if (!isCurrent('stats', token)) return;
    console.error(error);
    showError(t('common.error', { error: error.message }), showStats);
  }
}
