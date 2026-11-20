/* Vote board: one overall "what's next" vote. Candidates are approved wishes
   (status planned); building ones sit on top, released ones drop to 已完成. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { sort: 'votes', game: '', data: null, admin: false, cuts: {} };

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
        <div class="vb-art">${art(c)}${c.game ? `<span class="vb-game">${WY.esc(c.game)}</span>` : ''}${tagBadge(c)}</div>
        <div class="vb-body">
          <h3>${WY.esc(c.title)}</h3>
          ${c.description ? `<p data-raw>${WY.esc(c.description)}</p>` : ''}
          ${c.note ? `<p class="vb-note"><span>站长</span>${WY.esc(c.note)}</p>` : ''}
          <div class="vb-meter" aria-hidden="true"><i></i></div>
          <div class="vb-foot">
            <span class="vb-n"><b>${c.votes}</b> 票<button class="vb-pen" type="button" data-pen="${c.id}" aria-label="改票数" title="改票数">✎</button><button class="vb-pen vb-del" type="button" data-del="${c.id}" aria-label="删除" title="删除这张卡片">🗑</button>${c.mentions ? `<em class="vb-cm">评论区 ${c.mentions} 次</em>` : ''}</span>
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
      new: (a, b) => b.statusAt - a.statusAt || b.createdAt - a.createdAt,
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
      el.classList.toggle('is-draggable', state.admin);
      setRank(el, i);
    });
    const empty = grid.querySelector('.empty');
    if (!list.length && !empty) grid.insertAdjacentHTML('afterbegin', '<div class="empty">这个游戏下暂时没有候选。</div>');
    if (list.length && empty) empty.remove();
    meters();
    markCuts();
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
        <div class="vb-art">${art(c)}${done ? '<span class="vb-stamp">已完成</span>' : ''}${tagBadge(c)}</div>
        <div class="vb-body">
          <h3>${WY.esc(c.title)}</h3>
          <span class="vb-sub">${WY.esc(c.game || '')}${done && !c.votes ? '' : `${c.game ? ' · ' : ''}<b class="vb-mn">${c.votes}</b> 票${done ? '' : `<button class="vb-pen" type="button" data-pen="${c.id}" aria-label="改票数" title="改票数">✎</button>`}`}<button class="vb-pen vb-del" type="button" data-del="${c.id}" aria-label="删除" title="删除这张卡片">🗑</button></span>${c.mentions ? `<em class="vb-cm">评论区 ${c.mentions} 次</em>` : ''}
          ${c.note ? `<p class="vb-note"><span>站长</span>${WY.esc(c.note)}</p>` : ''}
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
    markCuts();
  }

  // Admin only: vote counts whose real votes were lowered show in red.
  function markCuts() {
    if (!state.admin) return;
    document.querySelectorAll('.vb-card[data-id], .vb-mini[data-id]').forEach((el) => {
      const n = el.querySelector('.vb-n b, .vb-mn');
      if (!n) return;
      const cut = state.cuts[el.dataset.id];
      n.classList.toggle('vb-cut', Boolean(cut));
      n.title = cut ? `真实票已减 ${cut}` : '';
    });
  }

  async function loadCuts() {
    try {
      state.cuts = (await WY.api('/api/admin/vote-cuts')).cuts || {};
      markCuts();
    } catch {
      /* not critical */
    }
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
  // Card label: the 站长's pick wins; otherwise 新加入 shows for 7 days.
  const tagBadge = (c) => (c.tag === 'none' ? '' : c.tag ? `<span class="new-badge on-art tag-${c.tag === '新加入' ? 'new' : 'pick'}">${WY.esc(c.tag)}</span>` : WY.newBadge(c.statusAt, 'on-art'));
  const TAGS = ['', '新加入', '热门', '推荐', '即将完成', '限时', 'none'];
  const TAG_LABEL = (t) => (t === '' ? '自动（7天内显示新加入）' : t === 'none' ? '不显示' : t);
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
    loadCuts();
    if (state.data) paint();
    const head = $('vb-building-wrap').querySelector('.vb-split');
    head.insertAdjacentHTML('beforebegin', '<p class="vb-admin-hint">站长模式：按住卡片拖动 —— 投票区 → 备选区 ⇄ 制作中，备选区也能拖回投票区。拖动时能放的地方会亮起金色虚线框，卡片下方会提示「松手放到…」。</p>');
    head.insertAdjacentHTML('beforebegin', '<div class="vb-add-wrap"><button class="vb-add" type="button" data-add-card><span aria-hidden="true">＋</span> 添加卡片</button></div>');
    document.querySelector('[data-add-card]').addEventListener('click', () => addCard());
    for (const status of Object.keys(COLS)) $(COLS[status]).dataset.dropStatus = status;
    $('vb-grid').dataset.dropStatus = 'open';
    // Soft page navigation re-runs this script, so drop the previous visit's document listeners first.
    if (window.__vbPage) window.__vbPage.abort();
    window.__vbPage = new AbortController();
    const signal = window.__vbPage.signal;
    document.addEventListener('pointerdown', startDrag, { signal });
    $('vb-building').addEventListener('click', (e) => {
      const b = e.target.closest('[data-done]');
      if (b) markDone(Number(b.dataset.done), b);
    });
    document.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pen]');
      if (p) editVotes(Number(p.dataset.pen));
      const d = e.target.closest('[data-del]');
      if (d) deleteCard(Number(d.dataset.del));
    }, { signal });
  }

  // Shrink a picked image to <=1200px JPEG so uploads stay small.
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1200 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('图片读取失败，换一张试试'));
      // Read as a data: URL — the site's CSP allows data: images but not blob: ones.
      const fr = new FileReader();
      fr.onload = () => {
        img.src = fr.result;
      };
      fr.onerror = () => reject(new Error('图片读取失败，换一张试试'));
      fr.readAsDataURL(file);
    });
  }

  // ＋ 添加卡片: image, name, game, subtitle, and which section it goes to.
  function addCard() {
    const d = state.data || {};
    const games = [...new Set([...(d.games || []).map((g) => g.name), ...['voting', 'accepted', 'building'].flatMap((k) => (d[k] || []).map((c) => c.game))].filter(Boolean))];
    const dlg = WY.dialog({
      title: '添加卡片',
      subtitle: '直接加到投票页，不用审核',
      body: `<form class="vb-add-form" novalidate>
          <label class="vb-add-pic" tabindex="0"><input type="file" accept="image/png,image/jpeg,image/webp" hidden data-pic><img alt="" hidden data-preview><span data-pic-hint>点这里选图片<br><small>可不选，之后再加</small></span></label>
          <div class="vb-add-fields">
            <label><span>名字 *</span><input class="input" name="title" maxlength="40" required placeholder="例如：钟离 · 天动万象"></label>
            <label><span>游戏</span><input class="input" name="game" maxlength="40" list="vb-add-games" placeholder="例如：原神"><datalist id="vb-add-games">${games.map((g) => `<option value="${WY.esc(g)}">`).join('')}</datalist></label>
            <label><span>副标题</span><input class="input" name="description" maxlength="200" placeholder="一句话介绍（可不填）"></label>
            <label><span>站长备注</span><input class="input" name="note" maxlength="300" placeholder="金色显示在副标题下面（可不填）"></label>
            <label><span>放到</span><select class="input" name="status"><option value="open">投票区</option><option value="planned">备选区</option><option value="building">制作中</option></select></label>
          </div>
        </form>
        <p class="vb-add-err" data-err></p>`,
      footer: '<button class="btn btn-ghost" type="button" data-cancel>取消</button><button class="btn btn-primary" type="button" data-ok>添加</button>',
    });
    const form = dlg.body.querySelector('form');
    const pic = dlg.body.querySelector('[data-pic]');
    const preview = dlg.body.querySelector('[data-preview]');
    const hint = dlg.body.querySelector('[data-pic-hint]');
    const err = dlg.body.querySelector('[data-err]');
    let image = '';
    dlg.body.querySelector('.vb-add-pic').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pic.click();
      }
    });
    pic.addEventListener('change', async () => {
      if (!pic.files[0]) return;
      try {
        image = await shrinkImage(pic.files[0]);
        preview.src = image;
        preview.hidden = false;
        hint.hidden = true;
      } catch (e) {
        err.textContent = e.message;
      }
    });
    form.elements.title.focus();
    dlg.footer.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    const ok = dlg.footer.querySelector('[data-ok]');
    const submit = async () => {
      const f = form.elements;
      const title = f.title.value.trim();
      if (!title) {
        err.textContent = '请填名字';
        f.title.focus();
        return;
      }
      err.textContent = '';
      ok.disabled = true;
      ok.textContent = '添加中…';
      try {
        const r = await WY.api('/api/admin/cards', {
          method: 'POST',
          body: { title, game: f.game.value.trim(), description: f.description.value.trim(), note: f.note.value.trim(), status: f.status.value, image },
        });
        dlg.close();
        WY.toast(`「${title}」已添加`, 'success');
        await load();
        const el = document.querySelector(`.vb-card[data-id="${r.id}"], .vb-mini[data-id="${r.id}"]`);
        if (el) {
          el.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'center' });
          el.animate([{ boxShadow: '0 0 0 2px rgba(232,196,106,.95), 0 0 32px rgba(232,196,106,.5)' }, { boxShadow: '0 0 0 0 rgba(232,196,106,0)' }], { duration: 1600, easing: 'ease-out' });
        }
      } catch (e) {
        err.textContent = e.message || '添加失败';
        ok.disabled = false;
        ok.textContent = '添加';
      }
    };
    ok.addEventListener('click', submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
  }

  // ✎ on a card: see real vs bot votes and set the bot votes.
  // Admin: delete a card (and its votes) for good.
  async function deleteCard(id) {
    const h = document.querySelector(`[data-id="${id}"] h3, [data-id="${id}"] h4`);
    const title = h ? h.textContent.trim() : '#' + id;
    const ok = await WY.confirm({ title: '删除这张卡片？', message: `「${title}」和它的票数会一起删除，无法恢复。只想从投票页移走的话，用 ✎ 里的「退回许愿池」。`, okText: '删除', danger: true });
    if (!ok) return;
    try {
      await WY.api(`/api/admin/ideas/${id}`, { method: 'DELETE' });
      WY.toast('已删除', 'success');
      cards.delete(id);
      await load();
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  async function editVotes(id) {
    let info;
    try {
      info = await WY.api(`/api/admin/ideas/${id}/votes`);
    } catch (e) {
      WY.toast(e.message, 'error');
      return;
    }
    const dlg = WY.dialog({
      title: '编辑',
      subtitle: info.title,
      body: `<div class="vb-votes-edit">
          <label><span>真实票 <em data-orig>（原 ${info.original}）</em></span><input class="input" type="number" step="1" min="0" max="${info.original}" value="${info.real}" data-real></label>
          <label><span>机器人票</span><input class="input" type="number" step="1" value="${info.bot}" data-bot></label>
          <div><span>显示总票数</span><b data-total>${info.total}</b></div>
        </div>
        <div class="vb-tag-edit"><span>卡片标签</span><div class="vb-tag-opts" role="radiogroup">${TAGS.map((t) => `<button type="button" class="vb-tag-opt${t === info.tag ? ' is-on' : ''}" data-tag="${t}" role="radio" aria-checked="${t === info.tag}">${TAG_LABEL(t)}</button>`).join('')}</div></div>
        <label class="vb-note-edit"><span>站长备注 <small>（金色显示在副标题下面，所有人可见；留空就不显示）</small></span><textarea class="input" rows="2" maxlength="300" data-note placeholder="例如：下个月开做！">${WY.esc(info.note)}</textarea></label>
        <p class="muted dialog-text">真实票是粉丝投的（含评论区），只能往下改，不能超过原来的 ${info.original}；改低后会显示成红色，只有你能看到。机器人票可加可减，总票数不会低于 0。</p>`,
      footer: '<button class="btn btn-ghost vb-back-wish" type="button" data-back>↩ 退回许愿池</button><button class="btn btn-ghost" type="button" data-cancel>取消</button><button class="btn btn-primary" type="button" data-ok>保存</button>',
    });
    dlg.footer.querySelector('[data-back]').addEventListener('click', async () => {
      dlg.close();
      const ok = await WY.confirm({ title: '退回许愿池？', message: `「${info.title}」会从投票页移走，回到许愿池（票数保留）。`, okText: '退回' });
      if (!ok) return;
      try {
        await WY.api(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { status: 'wish' } });
        WY.toast('已退回许愿池', 'success');
        cards.delete(id);
        await load();
      } catch (e) {
        WY.toast(e.message, 'error');
      }
    });
    const input = dlg.body.querySelector('[data-bot]');
    const noteIn = dlg.body.querySelector('[data-note]');
    let tag = info.tag;
    dlg.body.querySelector('.vb-tag-opts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tag]');
      if (!b) return;
      tag = b.dataset.tag;
      for (const o of dlg.body.querySelectorAll('.vb-tag-opt')) {
        o.classList.toggle('is-on', o === b);
        o.setAttribute('aria-checked', String(o === b));
      }
    });
    const realIn = dlg.body.querySelector('[data-real]');
    const total = dlg.body.querySelector('[data-total]');
    const refresh = () => {
      const r = Number(realIn.value);
      const n = Number(input.value);
      if (Number.isInteger(r) && r > info.original) realIn.value = info.original;
      const real = Math.min(Number(realIn.value), info.original);
      realIn.classList.toggle('is-cut', real < info.original);
      dlg.body.querySelector('[data-orig]').hidden = !(real < info.original);
      total.textContent = Number.isInteger(real) && Number.isInteger(n) ? Math.max(0, real + n) : '—';
    };
    realIn.addEventListener('input', refresh);
    realIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
    input.addEventListener('input', refresh);
    refresh();
    input.focus();
    input.select();
    dlg.footer.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    const save = async () => {
      const n = Number(input.value);
      const real = Number(realIn.value);
      if (!Number.isInteger(n) || !Number.isInteger(real)) return WY.toast('请填整数', 'error');
      if (real < 0 || real > info.original) return WY.toast(`真实票只能在 0 到 ${info.original} 之间`, 'error');
      if (real + n < 0) return WY.toast('总票数不能低于 0', 'error');
      const note = noteIn.value.trim();
      dlg.close();
      const votesChanged = n !== info.bot || real !== info.real;
      const noteChanged = note !== info.note;
      const tagChanged = tag !== info.tag;
      if (!votesChanged && !noteChanged && !tagChanged) return;
      try {
        if (votesChanged) await WY.api(`/api/admin/ideas/${id}/votes`, { method: 'PUT', body: { real, bot: n } });
        if (noteChanged || tagChanged) await WY.api(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { ...(noteChanged && { officialReply: note }), ...(tagChanged && { tag }) } });
        WY.toast(`「${info.title}」已更新`, 'success');
        cards.delete(id);
        await load();
        await loadCuts();
      } catch (e) {
        WY.toast(e.message, 'error');
      }
    };
    dlg.footer.querySelector('[data-ok]').addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
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
    const el = e.target.closest('.vb-mini.is-draggable, .vb-card.is-draggable');
    if (!el || e.button !== 0 || e.target.closest('button, a')) return;
    const from = el.parentElement.dataset.dropStatus;
    if (!from) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let clone = null;
    let box = null;
    let over = null;
    let lastX = sx;
    let lastY = sy;
    let dx = 0;
    let dy = 0;
    let scrollRaf = 0;
    let tip = null;
    // Voting cards can only go to 备选区, and only 备选区 cards can go back to voting.
    const canDrop = (z) => z !== from && (from !== 'open' || z === 'planned') && (z !== 'open' || from === 'planned');

    // Holding the card near the top or bottom edge scrolls the page, so far-apart sections are reachable.
    const autoScroll = () => {
      scrollRaf = 0;
      if (!clone) return;
      const edge = 80;
      const v = lastY < edge ? -Math.ceil((edge - lastY) / 6) : lastY > innerHeight - edge ? Math.ceil((lastY - innerHeight + edge) / 6) : 0;
      if (!v) return;
      window.scrollBy({ top: v, behavior: 'instant' });
      track();
      scrollRaf = requestAnimationFrame(autoScroll);
    };

    // Each column counts as a drop zone over the full height of the section (plus some slack below),
    // so an empty or short column is still easy to hit.
    const zoneAt = (x, y) => {
      const g = $('vb-grid').getBoundingClientRect();
      if (x >= g.left && x <= g.right && y >= g.top - 60 && y <= g.bottom) return 'open';
      const split = $('vb-building-wrap').querySelector('.vb-split').getBoundingClientRect();
      if (y < split.top - 40 || y > split.bottom + 160) return null;
      for (const status of Object.keys(COLS)) {
        const r = $(COLS[status]).parentElement.getBoundingClientRect();
        if (x >= r.left - 20 && x <= r.right + 20) return status;
      }
      return null;
    };

    const onMove = (ev) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      dx = ev.clientX - sx;
      dy = ev.clientY - sy;
      if (!clone) {
        if (Math.hypot(dx, dy) < 6) return;
        box = el.getBoundingClientRect();
        clone = el.cloneNode(true);
        clone.classList.add('vb-drag-clone');
        clone.style.width = `${box.width}px`;
        clone.style.left = `${box.left}px`;
        clone.style.top = `${box.top}px`;
        tip = document.createElement('span');
        tip.className = 'vb-drop-tip';
        clone.appendChild(tip);
        document.body.appendChild(clone);
        el.classList.add('is-dragging');
        document.body.classList.add('vb-dragging');
        // Light up every place this card may land, dim the rest.
        for (const z of ['open', ...Object.keys(COLS)]) {
          const ze = zoneEl(z);
          ze.dataset.dropLabel = z === from ? '原位置' : canDrop(z) ? `可以放到：${ZONE_NAME[z]}` : '不能放这里';
          ze.classList.add(z === from ? 'is-drop-home' : canDrop(z) ? 'is-drop-ok' : 'is-drop-no');
        }
      }
      ev.preventDefault();
      track();
      if (!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
    };

    // The clone is position: fixed, so it follows the pointer; drop zones are re-checked after scrolling.
    const track = () => {
      clone.style.transform = `translate3d(${dx}px, ${dy}px, 0) rotate(${Math.max(-4, Math.min(4, dx / 60))}deg) scale(1.03)`;
      const z = zoneAt(lastX, lastY);
      const target = z && canDrop(z) ? z : null;
      tip.textContent = target ? `✓ 松手放到「${ZONE_NAME[target]}」` : '✕ 松手取消，卡片回原位';
      tip.classList.toggle('is-ok', !!target);
      if (target !== over) {
        if (over) zoneEl(over).classList.remove('is-drop-over');
        over = target;
        if (over) zoneEl(over).classList.add('is-drop-over');
      }
    };

    const onUp = () => {
      cancelAnimationFrame(scrollRaf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('vb-dragging');
      for (const z of ['open', ...Object.keys(COLS)]) zoneEl(z).classList.remove('is-drop-over', 'is-drop-ok', 'is-drop-no', 'is-drop-home');
      if (tip) tip.remove();
      if (!clone) return;
      if (over) moveCard(Number(el.dataset.id), from, over, clone);
      else settleBack(el, clone);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  const ZONE_NAME = { open: '投票区', planned: '备选区', building: '制作中' };
  const zoneEl = (status) => (status === 'open' ? $('vb-grid') : $(COLS[status]).parentElement);

  function settleBack(el, clone) {
    const anim = clone.animate([{ transform: clone.style.transform }, { transform: 'none' }], { duration: calm() ? 0 : 320, easing: EASE });
    anim.onfinish = () => {
      clone.remove();
      el.classList.remove('is-dragging');
    };
  }

  const LIST = { building: 'building', planned: 'accepted', open: 'voting' };

  function flyInto(id, clone, scope = '') {
    const target = document.querySelector(`${scope} .vb-mini[data-id="${id}"]`.trim()) || document.querySelector(`#vb-grid .vb-card[data-id="${id}"]`);
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
    if (from === 'open') {
      cards.get(id)?.classList.remove('is-dragging');
      cards.delete(id);
    }
    if (to === 'building') d.building.unshift(item);
    else if (to === 'open') {
      cards.delete(id);
      d.voting.push(item);
    } else {
      d.accepted.push(item);
      d.accepted.sort((a, b) => b.votes - a.votes);
    }
    paint();
    flyInto(id, clone);
    try {
      await WY.api(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { status: to } });
      WY.toast(to === 'open' ? `「${item.title}」已放回投票区` : to === 'building' ? `「${item.title}」已移到制作中` : from === 'open' ? `「${item.title}」已移到备选区` : `「${item.title}」已移回备选区`, 'success');
    } catch (error) {
      WY.toast(error.message || '移动失败，已撤回', 'error');
      await load();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
