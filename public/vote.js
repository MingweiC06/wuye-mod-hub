/* Vote board: one overall "what's next" vote. Candidates are approved wishes
   (status planned); building ones sit on top, released ones drop to 已完成. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { sort: 'votes', game: '', data: null, admin: false };

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
      <article class="vb-mini${done ? ' is-done' : ''}${watch ? ' has-video' : ''}${state.admin && !done ? ' is-draggable' : ''}" data-id="${c.id}">
        <div class="vb-art">${art(c)}${done ? '<span class="vb-stamp">已完成</span>' : ''}</div>
        <div class="vb-body">
          <h3>${WY.esc(c.title)}</h3>
          <span class="vb-sub">${WY.esc(c.game || '')}${done && !c.votes ? '' : `${c.game ? ' · ' : ''}<b class="vb-mn">${c.votes}</b> 票`}</span>${c.mentions ? `<em class="vb-cm">评论区 ${c.mentions} 次</em>` : ''}
          ${done ? `<div class="vb-foot vb-done-foot"><span class="vb-sub vb-done-tag">✓ 已完成${c.videoDate ? ` · ${WY.esc(c.videoDate)} 发布` : ''}</span>${watch ? `<a class="vb-watch" href="${watch}" target="_blank" rel="noopener" aria-label="在抖音看《${WY.esc(c.title)}》">看视频 <span aria-hidden="true">→</span></a>` : ''}</div>` : accepted ? `<div class="vb-foot"><span class="vb-sub vb-acc">★ 已采纳</span><button class="btn ${c.voted ? 'btn-primary' : 'btn-ghost'} btn-sm vb-vote" type="button" data-vote="${c.id}" aria-pressed="${c.voted}">${c.voted ? '已投 ✦' : '投一票'}</button></div>` : `<div class="vb-meter is-build" aria-hidden="true"><i></i></div>${state.admin ? `<div class="vb-foot"><span class="vb-sub">制作中</span><button class="btn btn-primary btn-sm vb-done-btn" type="button" data-done="${c.id}">✓ 完成</button></div>` : '<span class="vb-sub">制作中</span>'}`}
        </div>
      </article>`;
  }

  function paint() {
    const d = state.data;
    paintGrid(false);
    // Admins always see both columns so a card can be dragged into an empty one.
    $('vb-building-wrap').hidden = !state.admin && !d.building.length && !d.accepted.length;
    $('vb-accepted-wrap').hidden = !state.admin && !d.accepted.length;
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
    load().then(checkAdmin);
  }

  /* ---------- admin: drag cards between 备选区 (planned) and 制作中 (building) ---------- */
  const COLS = { building: 'vb-building', planned: 'vb-accepted' };

  async function checkAdmin() {
    try {
      const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
      if (!r.ok || !(await r.json()).authed) return;
    } catch {
      return;
    }
    state.admin = true;
    document.body.classList.add('vb-admin');
    if (state.data) paint();
    const head = $('vb-building-wrap').querySelector('.vb-split');
    head.insertAdjacentHTML('beforebegin', '<p class="vb-admin-hint">站长模式：按住卡片拖到另一边，即可在「备选区」和「制作中」之间移动。</p>');
    for (const status of Object.keys(COLS)) $(COLS[status]).dataset.dropStatus = status;
    document.addEventListener('pointerdown', startDrag);
    $('vb-building').addEventListener('click', (e) => {
      const b = e.target.closest('[data-done]');
      if (b) markDone(Number(b.dataset.done), b);
    });
  }

  // 制作中 → 已完成: the card lifts out and flies down into the 已完成 row.
  async function markDone(id, btn) {
    const d = state.data;
    const i = d.building.findIndex((c) => c.id === id);
    if (i < 0 || btn.disabled) return;
    btn.disabled = true;
    const el = btn.closest('.vb-mini');
    const box = el.getBoundingClientRect();
    const clone = el.cloneNode(true);
    clone.classList.add('vb-drag-clone');
    clone.style.width = `${box.width}px`;
    clone.style.left = `${box.left}px`;
    clone.style.top = `${box.top}px`;
    document.body.appendChild(clone);
    const [item] = d.building.splice(i, 1);
    d.done.unshift(item);
    paint();
    $('vb-done-wrap').hidden = false;
    const target = document.querySelector(`#vb-done .vb-mini[data-id="${id}"]`);
    if (target) target.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
    setTimeout(() => flyInto(id, clone, '#vb-done'), calm() ? 0 : 380);
    try {
      await WY.api(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { status: 'released' } });
      WY.toast(`「${item.title}」已完成 ✓`, 'success');
    } catch (error) {
      WY.toast(error.message || '操作失败，已撤回', 'error');
      await load();
    }
  }

  function startDrag(e) {
    const el = e.target.closest('.vb-mini.is-draggable');
    if (!el || e.button !== 0 || e.target.closest('button, a')) return;
    const from = el.parentElement.dataset.dropStatus;
    if (!from) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let clone = null;
    let box = null;
    let over = null;

    // Each column counts as a drop zone over the full height of the section (plus some slack below),
    // so an empty or short column is still easy to hit.
    const zoneAt = (x, y) => {
      const split = $('vb-building-wrap').querySelector('.vb-split').getBoundingClientRect();
      if (y < split.top - 40 || y > split.bottom + 160) return null;
      for (const status of Object.keys(COLS)) {
        const r = $(COLS[status]).parentElement.getBoundingClientRect();
        if (x >= r.left - 20 && x <= r.right + 20) return status;
      }
      return null;
    };

    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!clone) {
        if (Math.hypot(dx, dy) < 6) return;
        box = el.getBoundingClientRect();
        clone = el.cloneNode(true);
        clone.classList.add('vb-drag-clone');
        clone.style.width = `${box.width}px`;
        clone.style.left = `${box.left}px`;
        clone.style.top = `${box.top}px`;
        document.body.appendChild(clone);
        el.classList.add('is-dragging');
        document.body.classList.add('vb-dragging');
      }
      ev.preventDefault();
      clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${Math.max(-4, Math.min(4, dx / 60))}deg) scale(1.03)`;
      const z = zoneAt(ev.clientX, ev.clientY);
      const target = z && z !== from ? z : null;
      if (target !== over) {
        if (over) $(COLS[over]).parentElement.classList.remove('is-drop-over');
        over = target;
        if (over) $(COLS[over]).parentElement.classList.add('is-drop-over');
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('vb-dragging');
      if (over) $(COLS[over]).parentElement.classList.remove('is-drop-over');
      if (!clone) return;
      if (over) moveCard(Number(el.dataset.id), from, over, clone);
      else settleBack(el, clone);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function settleBack(el, clone) {
    const anim = clone.animate([{ transform: clone.style.transform }, { transform: 'none' }], { duration: calm() ? 0 : 320, easing: EASE });
    anim.onfinish = () => {
      clone.remove();
      el.classList.remove('is-dragging');
    };
  }

  const LIST = { building: 'building', planned: 'accepted' };

  function flyInto(id, clone, scope = '') {
    const target = document.querySelector(`${scope} .vb-mini[data-id="${id}"]`.trim());
    const from = clone.getBoundingClientRect();
    if (!target || calm()) {
      clone.remove();
      return;
    }
    const to = target.getBoundingClientRect();
    target.classList.add('is-landing');
    clone.style.transform = 'none';
    clone.style.left = `${from.left}px`;
    clone.style.top = `${from.top}px`;
    clone.style.width = `${from.width}px`;
    const anim = clone.animate(
      [
        { transform: 'rotate(0deg) scale(1.03)', offset: 0 },
        { transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0) scale(${to.width / from.width})` },
      ],
      { duration: 520, easing: EASE, fill: 'forwards' },
    );
    anim.onfinish = () => {
      clone.remove();
      target.classList.remove('is-landing');
      target.animate([{ boxShadow: '0 0 0 2px rgba(232,196,106,.9), 0 0 28px rgba(232,196,106,.45)' }, { boxShadow: '0 0 0 0 rgba(232,196,106,0)' }], { duration: 900, easing: 'ease-out' });
    };
  }

  async function moveCard(id, from, to, clone) {
    const d = state.data;
    const src = d[LIST[from]];
    const i = src.findIndex((c) => c.id === id);
    if (i < 0) return clone.remove();
    const [item] = src.splice(i, 1);
    if (to === 'building') d.building.unshift(item);
    else {
      d.accepted.push(item);
      d.accepted.sort((a, b) => b.votes - a.votes);
    }
    paint();
    flyInto(id, clone);
    try {
      await WY.api(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { status: to } });
      WY.toast(to === 'building' ? `「${item.title}」已移到制作中` : `「${item.title}」已移回备选区`, 'success');
    } catch (error) {
      WY.toast(error.message || '移动失败，已撤回', 'error');
      await load();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
