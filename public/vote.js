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

  function card(c, i, top) {
    const pct = top ? Math.round((c.votes / top) * 100) : 0;
    const rank = state.sort === 'votes' && !state.game && i < 3 ? `<span class="vb-rank r${i + 1}">${['I', 'II', 'III'][i]}</span>` : '';
    return `
      <article class="vb-card${c.voted ? ' is-voted' : ''}" data-id="${c.id}" data-pct="${pct}">
        <div class="vb-art">${art(c)}${rank}${c.game ? `<span class="vb-game">${WY.esc(c.game)}</span>` : ''}</div>
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

  function mini(c, done) {
    return `
      <article class="vb-mini${done ? ' is-done' : ''}">
        <div class="vb-art">${art(c)}${done ? '<span class="vb-stamp">已完成</span>' : ''}</div>
        <div class="vb-body">
          <h3>${WY.esc(c.title)}</h3>
          <span class="vb-sub">${WY.esc(c.game || '')}${c.game ? ' · ' : ''}${c.votes} 票</span>
          ${done ? '' : '<div class="vb-meter is-build" aria-hidden="true"><i></i></div><span class="vb-sub">制作中</span>'}
        </div>
      </article>`;
  }

  function paint() {
    const d = state.data;
    const top = Math.max(1, ...d.voting.map((c) => c.votes));
    $('vb-grid').innerHTML = d.voting.length
      ? d.voting.map((c, i) => card(c, i, top)).join('')
      : '<div class="empty">这个游戏下暂时没有候选。</div>';
    $('vb-grid').querySelectorAll('.vb-card').forEach((el) => {
      el.style.viewTransitionName = `vb-${el.dataset.id}`;
      el.querySelector('.vb-meter i').style.transform = `scaleX(${Number(el.dataset.pct) / 100})`;
    });
    $('vb-building-wrap').hidden = !d.building.length;
    $('vb-building').innerHTML = d.building.map((c) => mini(c, false)).join('');
    $('vb-done-wrap').hidden = !d.done.length;
    $('vb-done').innerHTML = d.done.map((c) => mini(c, true)).join('');
    $('vb-games').innerHTML = [{ name: '', count: 0 }, ...d.games]
      .map((g) => `<button class="chip${state.game === g.name ? ' is-active' : ''}" type="button" data-game="${WY.esc(g.name)}">${g.name ? `${WY.esc(g.name)} <small>${g.count}</small>` : '全部游戏'}</button>`)
      .join('');
    $('vb-count').textContent = d.voting.length;
    $('vb-votes').textContent = d.voting.reduce((n, c) => n + c.votes, 0);
    $('vb-voters').textContent = d.voters;
  }

  async function load(animate) {
    const qs = new URLSearchParams({ sort: state.sort });
    if (state.game) qs.set('game', state.game);
    try {
      const data = await WY.api(`/api/board?${qs}`);
      state.data = data;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (animate && document.startViewTransition && !reduce) document.startViewTransition(paint);
      else paint();
    } catch (error) {
      $('vb-grid').innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  async function vote(btn) {
    const id = Number(btn.dataset.vote);
    const c = state.data.voting.find((x) => x.id === id);
    if (!c || btn.disabled) return;
    btn.disabled = true;
    try {
      const r = await WY.api(`/api/ideas/${id}/vote`, { method: c.voted ? 'DELETE' : 'POST' });
      c.voted = r.voted;
      c.votes = r.votes;
      const el = btn.closest('.vb-card');
      el.classList.toggle('is-voted', c.voted);
      btn.className = `btn ${c.voted ? 'btn-primary' : 'btn-ghost'} btn-sm vb-vote`;
      btn.textContent = c.voted ? '已投 ✦' : '投一票';
      btn.setAttribute('aria-pressed', String(c.voted));
      const n = el.querySelector('.vb-n b');
      n.textContent = c.votes;
      n.classList.remove('bump');
      void n.offsetWidth;
      n.classList.add('bump');
      const top = Math.max(1, ...state.data.voting.map((x) => x.votes));
      document.querySelectorAll('.vb-card').forEach((cardEl) => {
        const it = state.data.voting.find((x) => x.id === Number(cardEl.dataset.id));
        if (it) cardEl.querySelector('.vb-meter i').style.transform = `scaleX(${it.votes / top})`;
      });
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
      load(true);
    });
    $('vb-games').addEventListener('click', (e) => {
      const b = e.target.closest('[data-game]');
      if (!b || b.dataset.game === state.game) return;
      state.game = b.dataset.game;
      load(true);
    });
    $('vb-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-vote]');
      if (b) vote(b);
    });
    load(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
