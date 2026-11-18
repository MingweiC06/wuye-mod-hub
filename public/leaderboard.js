/* 排行榜: 赞助榜 (rank only, no amounts) + 星光榜 (public points). */
(function () {
  'use strict';
  const WY = window.WY;
  const $ = (id) => document.getElementById(id);
  const MEDAL = ['I', 'II', 'III'];
  let me = null;

  const rank = (r) => `<span class="lb-rank${r.rank <= 3 ? ` r${r.rank}` : ''}">${r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>`;
  const mine = (name) => (me && name === me.name ? ' is-me' : '');

  function paint(data) {
    $('lb-sponsor-list').innerHTML = data.sponsors.length
      ? data.sponsors
          .map((r) => `<li class="lb-row${mine(r.name)}">${rank(r)}<span class="lb-name"${r.anonymous ? '' : ' data-raw'}>${r.anonymous ? '匿名' : WY.esc(r.name)}</span>${r.times > 1 ? `<small class="lb-sub">赞助 ${r.times} 次</small>` : ''}</li>`)
          .join('')
      : '<li class="empty">还没有赞助记录，成为第一个吧。</li>';
    $('lb-star-list').innerHTML = data.stars.length
      ? data.stars.map((r) => `<li class="lb-row${mine(r.name)}">${rank(r)}<span class="lb-name" data-raw>${WY.esc(r.name)}</span><b class="lb-pts">${r.points} ✦</b></li>`).join('')
      : '<li class="empty">还没有人上榜，起个名字去投票吧。</li>';
  }

  async function load() {
    const data = await WY.api('/api/leaderboard');
    me = data.me;
    paint(data);
  }

  document.querySelector('.lb-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    document.querySelectorAll('.lb-tabs [data-tab]').forEach((x) => {
      x.classList.toggle('is-active', x === b);
      x.setAttribute('aria-selected', String(x === b));
    });
    $('lb-sponsors').hidden = b.dataset.tab !== 'sponsors';
    $('lb-stars').hidden = b.dataset.tab !== 'stars';
  });
  if (window.__wyBoardMe) document.removeEventListener('wy:me', window.__wyBoardMe);
  window.__wyBoardMe = () => load().catch(() => {});
  document.addEventListener('wy:me', window.__wyBoardMe);

  load().catch((err) => WY.toast(err.message, 'error'));
})();
