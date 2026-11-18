/* Arena page: full Aeon bracket + supporter board. */
(function () {
  'use strict';
  const ROUND_NAMES = { 1: '首轮', 2: '次轮', 3: '半决赛', 4: '决赛' };

  function roundName(round, total) {
    if (round === total) return 'FINAL · 决赛';
    if (round === total - 1) return 'SEMI · 半决赛';
    return `ROUND ${round} · ${ROUND_NAMES[round] || `第 ${round} 轮`}`;
  }

  async function load() {
    const root = document.getElementById('bracket');
    try {
      const { bracket } = await WY.api('/api/bracket');
      if (!bracket) {
        root.innerHTML = '<div class="empty">擂台休赛中，下一季很快开始。</div>';
        return;
      }
      document.querySelector('[data-mark="AEON ARENA"]').textContent = bracket.title;
      const columns = [];
      for (let r = 1; r <= bracket.totalRounds; r += 1) {
        const matches = bracket.matches.filter((m) => m.round === r);
        const expected = 2 ** (bracket.totalRounds - r);
        const body = matches.length
          ? matches.map((m) => WY.duelHtml(m)).join('')
          : Array.from({ length: expected }, () => '<div class="cx-duel"><span class="cx-side"><strong>待定</strong></span><span class="cx-vs">VS</span><span class="cx-side"><strong>待定</strong></span></div>').join('');
        columns.push(`<div class="cx-round${matches.length ? '' : ' is-future'}"><h3>${roundName(r, bracket.totalRounds)}</h3><div class="cx-round-body">${body}</div></div>`);
      }
      const champ = bracket.status === 'finished'
        ? `<div class="cx-round"><h3>CHAMPION</h3><div class="cx-champion cx-frame"><strong>${WY.esc(bracket.champion)}</strong>下期复刻主角</div></div>`
        : '';
      root.innerHTML = `<div class="cx-bracket">${columns.join('')}${champ}</div>`;
      root.querySelectorAll('.cx-duel').forEach((duel) => WY.paintDuel(duel));
    } catch (error) {
      root.innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  function boot() {
    const root = document.getElementById('bracket');
    root.addEventListener('click', async (event) => {
      const side = event.target.closest('[data-pick]');
      if (!side || side.disabled) return;
      try {
        await WY.api(`/api/bracket/matches/${side.dataset.match}/vote`, { method: 'POST', body: { pick: side.dataset.pick } });
        load();
      } catch (error) {
        WY.toast(error.message, 'error');
      }
    });
    load();
    WY.mountBoard(document.getElementById('board'), document.getElementById('nick-form'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
