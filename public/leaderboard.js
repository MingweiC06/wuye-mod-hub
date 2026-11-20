/* 排行榜: 赞助榜 (rank only, no amounts) + 星光榜 (public points). */
(function () {
  'use strict';
  const WY = window.WY;
  const $ = (id) => document.getElementById(id);
  const MEDAL = ['I', 'II', 'III'];
  let me = null;

  const rank = (r) => `<span class="lb-rank${r.rank <= 3 ? ` r${r.rank}` : ''}">${r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>`;
  const mine = (name) => (me && name === me.name ? ' is-me' : '');

  const TIER = ['gold', 'silver', 'bronze'];
  const TITLE = ['CHAMPION', 'SECOND', 'THIRD'];
  // One emblem per place: 1 = 太阳 (sun), 2 = 月 (crescent moon), 3 = 星 (four-point star). Pure SVG, colours via CSS.
  const RAYS = Array.from({ length: 12 }, (_, i) => `<path class="em-ray" d="M50 4 L54 20 L46 20 Z" transform="rotate(${i * 30} 50 50)"/>`).join('');
  const EMBLEM = [
    `<svg class="lb-emblem em-sun" viewBox="0 0 100 100" aria-hidden="true">${RAYS}<circle class="em-disc" cx="50" cy="50" r="24"/><circle class="em-core" cx="50" cy="50" r="15"/><path class="em-glyph" d="M38 56 L40 44 L45 50 L50 41 L55 50 L60 44 L62 56 Z"/></svg>`,
    `<svg class="lb-emblem em-moon" viewBox="0 0 100 100" aria-hidden="true"><circle class="em-halo" cx="50" cy="50" r="40"/><path class="em-disc" d="M62 16 A36 36 0 1 0 62 84 A28 28 0 1 1 62 16 Z"/><path class="em-star" d="M70 34 L72 40 L78 42 L72 44 L70 50 L68 44 L62 42 L68 40 Z"/><circle class="em-dot" cx="78" cy="60" r="2.5"/></svg>`,
    `<svg class="lb-emblem em-star4" viewBox="0 0 100 100" aria-hidden="true"><circle class="em-halo" cx="50" cy="50" r="40"/><path class="em-disc" d="M50 8 L58 42 L92 50 L58 58 L50 92 L42 58 L8 50 L42 42 Z"/><path class="em-core" d="M50 30 L54 46 L70 50 L54 54 L50 70 L46 54 L30 50 L46 46 Z"/></svg>`,
  ];
  const SPARKS = Array.from({ length: 10 }, (_, i) => `<i class="lb-spark k${i + 1}" aria-hidden="true"></i>`).join('');
  function podium(rows, sub) {
    const top = rows.filter((r) => r.rank <= 3).slice(0, 3);
    if (!top.length) return '';
    const order = [top.find((r) => r.rank === 2), top.find((r) => r.rank === 1), top.find((r) => r.rank === 3)].filter(Boolean);
    const card = (r) => `<div class="lb-pod lb-${TIER[r.rank - 1]}${mine(r.name)}">
        ${r.rank === 1 ? `<span class="lb-beam" aria-hidden="true"></span><span class="lb-crown" aria-hidden="true">♛</span>${SPARKS}` : ''}
        <span class="lb-aura" aria-hidden="true"></span>
        <span class="lb-medal-wrap"><span class="lb-orbit" aria-hidden="true"></span><span class="lb-medal" role="img" aria-label="第 ${r.rank} 名">${EMBLEM[r.rank - 1]}</span></span>
        <span class="lb-pod-name"${r.anonymous ? '' : ' data-raw'}>${r.anonymous ? '匿名' : WY.esc(r.name)}</span>
        <span class="lb-pod-sub">${sub(r)}</span>
        <span class="lb-plinth" aria-hidden="true"><span class="lb-plinth-n">${r.rank}</span><span class="lb-plinth-t">${TITLE[r.rank - 1]}</span></span>
      </div>`;
    return `<li class="lb-podium"><span class="lb-rays" aria-hidden="true"></span>${order.map(card).join('')}</li>`;
  }
  const rest = (rows, tail) => rows.filter((r) => r.rank > 3).map((r) => `<li class="lb-row${mine(r.name)}">${rank(r)}<span class="lb-name"${r.anonymous ? '' : ' data-raw'}>${r.anonymous ? '匿名' : WY.esc(r.name)}</span>${tail(r)}</li>`).join('');

  function paint(raw) {
    const data = { ...raw, sponsors: (raw && raw.sponsors) || [], stars: (raw && raw.stars) || [] };
    WY.setEl('lb-n-sponsors', (el) => (el.textContent = String(data.sponsors.length)));
    WY.setEl('lb-n-stars', (el) => (el.textContent = String(data.stars.length)));
    WY.setEl('lb-n-points', (el) => (el.textContent = data.stars.reduce((n, r) => n + (Number(r.points) || 0), 0).toLocaleString()));
    const sTail = (r) => (r.times > 1 ? `<small class="lb-sub">赞助 ${r.times} 次</small>` : '');
    WY.setEl('lb-sponsor-list', (el) => (el.innerHTML = data.sponsors.length
      ? podium(data.sponsors, (r) => (r.times > 1 ? `赞助 ${r.times} 次` : '感谢支持')) + rest(data.sponsors, sTail)
      : '<li class="empty">还没有赞助记录，成为第一个吧。</li>'));
    const pTail = (r) => `<b class="lb-pts">${r.points} ✦</b>`;
    WY.setEl('lb-star-list', (el) => (el.innerHTML = data.stars.length
      ? podium(data.stars, (r) => `${r.points} ✦`) + rest(data.stars, pTail)
      : '<li class="empty">还没有人上榜，起个名字去投票吧。</li>'));
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
