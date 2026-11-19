/* Vote board: one overall "what's next" vote. Candidates are approved wishes
   (status planned); building ones sit on top, released ones drop to 已完成. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { sort: 'votes', game: '', data: null };

  const art = (c) =>
    c.image
      ? `<img src="${WY.esc(c.image)}" alt="" loading="lazy">`
      : `<span class="vb-ph" aria-hidden="true"><i>${WY.esc((c.game || c.title).slice(0, 1))}</i></span>`;

  const RANK = ['I', 'II', 'III'];
  const cards = new Map();
  const EASE = 'cubic-bezier(.16, 1, .3, 1)';
  const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function card(c) {
    return `
      <article class="vb-card${c.voted ? ' is-voted' : ''}" data-id="${c.id}">
        <div class="vb-art">${art(c)}${c.game ? `<span class="vb-game">${WY.esc(c.game)}</span>` : ''}</div>
        <div class="vb-body">
          <h3>${WY.esc(c.title)}</h3>
          ${c.description ? `<p data-raw>${WY.esc(c.description)}</p>` : ''}
          <div class="vb-meter" aria-hidden="true"><i></i></div>
          <div class="vb-foot">
            <span class="vb-n"><b>${c.votes}</b> 票${c.mentions ? `<em class="vb-cm">评论区 ${c.mentions} 次</em>` : ''}</span>
            <button class="btn ${c.voted ? 'btn-primary' : 'btn-ghost'} btn-sm vb-vote" type="button" data-vote="${c.id}" aria-pressed="${c.voted}">${c.voted ? '已投 ✦' : '投一票'}</button>
          </div>
        </div>
      </article>`;
  }

  function cardEl(c) {
    let el = cards.get(c.id);
    if (!el) {
      const t = document.createElement('template');
      t.innerHTML = card(c).trim();
      el = t.content.firstElementChild;
      cards.set(c.id, el);
    }
    return el;
  }

  function view() {
    const list = state.data.voting.filter((c) => !state.game || c.game === state.game);
    const by = {
      votes: (a, b) => b.votes - a.votes || b.mentions - a.mentions || b.createdAt - a.createdAt,
      mentions: (a, b) => b.mentions - a.mentions || b.votes - a.votes,
      new: (a, b) => b.createdAt - a.createdAt,
      game: (a, b) => (a.game === '') - (b.game === '') || a.game.localeCompare(b.game, 'zh') || b.votes - a.votes,
    }[state.sort];
    return list.sort(by);
  }

  function setRank(el, i) {
    const box = el.querySelector('.vb-art');
    const want = state.sort === 'votes' && !state.game && i < 3 ? i : -1;
    let r = box.querySelector('.vb-rank');
    if (want < 0) {
      if (r) r.remove();
      return;
    }
    if (!r) {
      r = document.createElement('span');
      box.appendChild(r);
    }
    r.className = `vb-rank r${want + 1}`;
    r.textContent = RANK[want];
  }

  function meters() {
    const list = state.data.voting;
    const top = Math.max(1, ...list.map((c) => c.votes));
    for (const c of list) {
      const el = cards.get(c.id);
      if (el) el.querySelector('.vb-meter i').style.transform = `scaleX(${c.votes / top})`;
    }
  }

  /* FLIP: keep the same card nodes (no image reloads), move them to their new
     slots, then animate from where they were. Leaving cards fade as ghosts. */
  function paintGrid(animate) {
    const grid = $('vb-grid');
    const list = view();
    const move = animate && !calm();
    const gridBox = grid.getBoundingClientRect();
    const before = new Map();
    if (move) for (const el of grid.querySelectorAll('.vb-card:not(.vb-ghost)')) before.set(el, el.getBoundingClientRect());
    grid.querySelectorAll('.vb-ghost').forEach((g) => g.remove());
    const keep = new Set(list.map(cardEl));
    for (const el of [...grid.children]) {
      if (keep.has(el)) continue;
      const box = before.get(el);
      if (box) {
        const ghost = el.cloneNode(true);
        ghost.classList.add('vb-ghost');
        ghost.style.width = `${box.width}px`;
        ghost.style.height = `${box.height}px`;
        ghost.style.left = `${box.left - gridBox.left}px`;
        ghost.style.top = `${box.top - gridBox.top}px`;
        grid.appendChild(ghost);
        ghost.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.92)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }).onfinish = () => ghost.remove();
      }
      if (!el.classList.contains('vb-ghost')) el.remove();
    }
    const anchor = grid.querySelector('.vb-ghost');
    list.forEach((c, i) => {
      const el = cardEl(c);
      grid.insertBefore(el, anchor);
      setRank(el, i);
    });
    const empty = grid.querySelector('.empty');
    if (!list.length && !empty) grid.insertAdjacentHTML('afterbegin', '<div class="empty">这个游戏下暂时没有候选。</div>');
    if (list.length && empty) empty.remove();
    meters();
    if (!move) return;
    let fresh = 0;
    list.forEach((c) => {
      const el = cards.get(c.id);
      const a = before.get(el);
      const b = el.getBoundingClientRect();
      if (a) {
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (dx || dy) el.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'none' }], { duration: 620, easing: EASE });
      } else {
        el.animate(
          [{ opacity: 0, transform: 'translate3d(0, 18px, 0) scale(.94)' }, { opacity: 1, transform: 'none' }],
          { duration: 520, delay: 120 + fresh++ * 35, easing: EASE, fill: 'backwards' },
        );
      }
    });
  }

  function mini(c, done, accepted) {
    const watch = done && c.video ? `https://www.douyin.com/video/${encodeURIComponent(c.video)}` : '';
    return `
      <article class="vb-mini${done ? ' is-done' : ''}${watch ? ' has-video' : ''}">
        <div class="vb-art">${art(c)}${done ? '<span class="vb-stamp">已完成</span>' : ''}</div>
        <div class="vb-body">
          <h3>${WY.esc(c.title)}</h3>
          <span class="vb-sub">${WY.esc(c.game || '')}${c.game ? ' · ' : ''}<b class="vb-mn">${c.votes}</b> 票</span>${c.mentions ? `<em class="vb-cm">评论区 ${c.mentions} 次</em>` : ''}
          ${done ? `<div class="vb-foot vb-done-foot"><span class="vb-sub vb-done-tag">✓ 已完成${c.videoDate ? ` · ${WY.esc(c.videoDate)} 发布` : ''}</span>${watch ? `<a class="vb-watch" href="${watch}" target="_blank" rel="noopener" aria-label="在抖音看《${WY.esc(c.title)}》">看视频 <span aria-hidden="true">→</span></a>` : ''}</div>` : accepted ? `<div class="vb-foot"><span class="vb-sub vb-acc">★ 已采纳</span><button class="btn ${c.voted ? 'btn-primary' : 'btn-ghost'} btn-sm vb-vote" type="button" data-vote="${c.id}" aria-pressed="${c.voted}">${c.voted ? '已投 ✦' : '投一票'}</button></div>` : '<div class="vb-meter is-build" aria-hidden="true"><i></i></div><span class="vb-sub">制作中</span>'}
        </div>
      </article>`;
  }

  function paint() {
    const d = state.data;
    paintGrid(false);
    $('vb-building-wrap').hidden = !d.building.length && !d.accepted.length;
    $('vb-accepted-wrap').hidden = !d.accepted.length;
    $('vb-accepted').innerHTML = d.accepted.map((c) => mini(c, false, true)).join('');
    $('vb-building').innerHTML = d.building.map((c) => mini(c, false)).join('');
    $('vb-done-wrap').hidden = !d.done.length;
    $('vb-done').innerHTML = d.done.map((c) => mini(c, true)).join('');
    paintGames();
    $('vb-count').textContent = d.voting.length;
    $('vb-votes').textContent = d.voting.reduce((n, c) => n + c.votes, 0);
    $('vb-voters').textContent = d.voters;
  }

  function paintGames() {
    const d = state.data;
    $('vb-games').innerHTML = [{ name: '', count: 0 }, ...d.games]
      .map((g) => `<button class="chip${state.game === g.name ? ' is-active' : ''}" type="button" data-game="${WY.esc(g.name)}">${g.name ? `${WY.esc(g.name)} <small>${g.count}</small>` : '全部游戏'}</button>`)
      .join('');
  }

  async function load() {
    try {
      state.data = await WY.api('/api/board');
      paint();
    } catch (error) {
      $('vb-grid').innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  async function vote(btn) {
    const id = Number(btn.dataset.vote);
    const c = [...state.data.voting, ...state.data.accepted].find((x) => x.id === id);
    if (!c || btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await WY.api(`/api/ideas/${id}/vote`, { method: c.voted ? 'DELETE' : 'POST' });
      c.voted = r.voted;
      c.votes = r.votes;
      const el = btn.closest('.vb-card, .vb-mini');
      el.classList.toggle('is-voted', c.voted);
      btn.className = `btn ${c.voted ? 'btn-primary' : 'btn-ghost'} btn-sm vb-vote`;
      btn.textContent = c.voted ? '已投 ✦' : '投一票';
      btn.setAttribute('aria-pressed', String(c.voted));
      const n = el.querySelector('.vb-n b, .vb-mn');
      n.textContent = c.votes;
      n.classList.remove('bump');
      void n.offsetWidth;
      n.classList.add('bump');
      meters();
      $('vb-votes').textContent = state.data.voting.reduce((s, x) => s + x.votes, 0);
    } catch (error) {
      WY.toast(error.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function boot() {
    document.querySelector('.vb-sort').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b || b.dataset.sort === state.sort) return;
      state.sort = b.dataset.sort;
      document.querySelectorAll('.vb-sort .chip').forEach((x) => x.classList.toggle('is-active', x === b));
      paintGrid(true);
    });
    $('vb-games').addEventListener('click', (e) => {
      const b = e.target.closest('[data-game]');
      if (!b || b.dataset.game === state.game) return;
      state.game = b.dataset.game;
      $('vb-games').querySelectorAll('.chip').forEach((x) => x.classList.toggle('is-active', x === b));
      paintGrid(true);
    });
    for (const id of ['vb-grid', 'vb-accepted']) {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('[data-vote]');
        if (b) vote(b);
      });
    }
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
