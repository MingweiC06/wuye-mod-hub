/* ==========================================================================
   乌叶MC · 许愿池 /ideas — page script
   Depends on the shared window.WY helpers from /app.js (api / esc / toast...).
   All dynamic text is escaped with WY.esc before it reaches innerHTML.
   ========================================================================== */
(function () {
  'use strict';

  const PAGE_SIZE = 12;
  const SEARCH_DEBOUNCE = 350;
  const HIGHLIGHT_MS = 2600;

  /* Local metadata mirrors lib/db.js, so first paint never waits on /api/site. */
  const CATEGORIES = [
    { key: 'aeon', label: '游戏复刻', icon: '✦' },
    { key: 'anime', label: '动漫联动', icon: '⚡' },
    { key: 'mob', label: '生物 / Boss', icon: '☠' },
    { key: 'horror', label: '恐怖惊悚', icon: '◐' },
    { key: 'gameplay', label: '机制玩法', icon: '⚙' },
    { key: 'music', label: '音乐音效', icon: '♫' },
    { key: 'other', label: '其他灵感', icon: '✧' },
  ];
  const STATUSES = [
    { key: 'pending', label: '待审核', icon: '◷' },
    { key: 'open', label: '投票中', icon: '☆' },
    { key: 'planned', label: '已采纳', icon: '★' },
    { key: 'building', label: '制作中', icon: '⚒' },
    { key: 'released', label: '已发布', icon: '✓' },
    { key: 'shelved', label: '暂搁置', icon: '—' },
  ];
  const CATEGORY_MAP = new Map(CATEGORIES.map((category) => [category.key, category]));
  const STATUS_MAP = new Map(STATUSES.map((status) => [status.key, status]));
  /* pending stays in STATUS_MAP for freshly submitted cards, but public lists never expose it. */
  const FILTER_STATUSES = new Set(['open', 'planned', 'building', 'released', 'shelved']);

  const SKELETON_CARD = [
    '<div class="idea-card idea-skeleton" aria-hidden="true">',
    '  <div class="skeleton sk-line sk-w40"></div>',
    '  <div class="skeleton sk-line sk-w80"></div>',
    '  <div class="skeleton sk-line sk-w100"></div>',
    '  <div class="skeleton sk-line sk-w60"></div>',
    '  <div class="skeleton sk-line sk-foot"></div>',
    '</div>',
  ].join('');

  const els = {};
  const state = {
    sort: 'hot',
    category: '',
    status: '',
    q: '',
    page: 1,
    items: [],
    total: 0,
    hasMore: false,
    loading: false,
    seq: 0,
    formCategory: 'aeon',
    submitting: false,
    newId: 0,
    deepId: 0,
    highlightId: 0,
    highlightUntil: 0,
    highlightTimer: 0,
  };
  const voting = new Set();
  let statsTimer = 0;

  const WY = window.WY;

  /* ---------------- tiny helpers ---------------- */

  function byId(id) {
    return document.getElementById(id);
  }

  function each(selector, root, fn) {
    Array.prototype.forEach.call((root || document).querySelectorAll(selector), fn);
  }

  function categoryOf(key) {
    return CATEGORY_MAP.get(key) || WY.categoryMeta(key) || { key, label: key, icon: '✧' };
  }

  function statusOf(key) {
    return STATUS_MAP.get(key) || WY.statusMeta(key) || { key, label: key, icon: '•' };
  }

  function reduceMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function scrollToNode(node, block) {
    if (!node) return;
    node.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: block || 'start' });
  }

  /* ---------------- boot ---------------- */

  function boot() {
    cacheEls();
    if (!els.list) return;
    readUrlState();
    paintFilterState();
    paintCategoryPicker();
    updateDescCount();
    bindEvents();
    syncUrl();
    loadIdeas({ reset: true, page: 1 }).then(function () {
      if (/^#idea-\d+$/.test(window.location.hash)) focusHash();
    });
  }

  function cacheEls() {
    els.form = byId('idea-form');
    els.title = byId('idea-title');
    els.desc = byId('idea-desc');
    els.author = byId('idea-author');
    els.website = byId('idea-website');
    els.consent = byId('idea-consent');
    els.age = byId('idea-age');
    els.categoryPicker = byId('category-picker');
    els.titleError = byId('title-error');
    els.descError = byId('desc-error');
    els.descCount = byId('desc-count');
    els.submit = byId('idea-submit');
    els.formError = byId('idea-form-error');
    els.formSuccess = byId('idea-form-success');
    els.sortGroup = byId('sort-group');
    els.categoryFilter = byId('category-filter');
    els.q = byId('filter-q');
    els.status = byId('filter-status');
    els.reset = byId('filter-reset');
    els.list = byId('idea-list');
    els.ideasTotal = byId('ideas-total');
    els.ideasShown = byId('ideas-shown');
    els.foot = byId('list-foot');
    els.loadMore = byId('load-more');
    els.listEnd = byId('list-end');
    els.listEndTotal = byId('list-end-total');
  }

  function bindEvents() {
    if (els.form) els.form.addEventListener('submit', onSubmit);

    els.sortGroup.addEventListener('click', function (event) {
      const button = event.target.closest('[data-sort]');
      if (!button || state.sort === button.dataset.sort) return;
      state.sort = button.dataset.sort === 'new' ? 'new' : 'hot';
      paintFilterState();
      syncUrl();
      applyFilters();
    });

    els.categoryFilter.addEventListener('click', function (event) {
      const button = event.target.closest('[data-filter-category]');
      if (!button) return;
      const next = button.dataset.filterCategory || '';
      if (state.category === next) return;
      state.category = next;
      paintFilterState();
      syncUrl();
      applyFilters();
    });

    els.status.addEventListener('change', function () {
      state.status = FILTER_STATUSES.has(els.status.value) ? els.status.value : '';
      syncUrl();
      applyFilters();
    });

    const debouncedSearch = WY.debounce(applySearch, SEARCH_DEBOUNCE);
    els.q.addEventListener('input', debouncedSearch);
    els.q.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        applySearch();
      }
    });

    els.reset.addEventListener('click', function () {
      if (!state.q && !state.category && !state.status && state.sort === 'hot') return;
      resetFilters();
    });

    els.loadMore.addEventListener('click', function () {
      if (state.loading || !state.hasMore) return;
      loadIdeas({ page: state.page + 1 });
    });

    els.list.addEventListener('click', onListClick);
    checkAdmin();

    if (els.categoryPicker) {
      els.categoryPicker.addEventListener('click', function (event) {
        const button = event.target.closest('[data-category]');
        if (!button) return;
        state.formCategory = button.dataset.category;
        paintCategoryPicker();
        clearFormError();
      });
    }

    if (els.title) {
      els.title.addEventListener('input', function () {
        clearFieldError('title');
        clearFormError();
      });
    }
    if (els.desc) {
      els.desc.addEventListener('input', function () {
        updateDescCount();
        clearFieldError('description');
        clearFormError();
      });
    }
    if (els.author) els.author.addEventListener('input', clearFormError);

    if (window.__wyIdeasHash) window.removeEventListener('hashchange', window.__wyIdeasHash);
    window.__wyIdeasHash = focusHash;
    window.addEventListener('hashchange', focusHash);
  }

  /* ---------------- URL <-> filter state ---------------- */

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    state.sort = params.get('sort') === 'new' ? 'new' : 'hot';
    const category = params.get('category') || '';
    state.category = CATEGORY_MAP.has(category) ? category : '';
    const status = params.get('status') || '';
    state.status = FILTER_STATUSES.has(status) ? status : '';
    state.q = String(params.get('q') || '').trim().slice(0, 30);
  }

  function syncUrl() {
    const params = new URLSearchParams(window.location.search);
    const setParam = function (key, value) {
      if (value) params.set(key, value);
      else params.delete(key);
    };
    setParam('sort', state.sort === 'new' ? 'new' : '');
    setParam('category', state.category);
    setParam('status', state.status);
    setParam('q', state.q);
    const search = params.toString();
    const next = window.location.pathname + (search ? '?' + search : '') + window.location.hash;
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (next !== current) window.history.replaceState(null, '', next);
  }

  function paintFilterState() {
    each('[data-sort]', els.sortGroup, function (button) {
      const active = button.dataset.sort === state.sort;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    each('[data-filter-category]', els.categoryFilter, function (button) {
      const active = (button.dataset.filterCategory || '') === state.category;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (els.status.value !== state.status) els.status.value = state.status;
    if (els.q.value !== state.q) els.q.value = state.q;
  }

  function paintCategoryPicker() {
    if (!els.categoryPicker) return;
    each('[data-category]', els.categoryPicker, function (button) {
      const active = button.dataset.category === state.formCategory;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
    });
  }

  function applySearch() {
    const next = els.q.value.trim().slice(0, 30);
    if (next === state.q) return;
    state.q = next;
    syncUrl();
    applyFilters();
  }

  function resetFilters() {
    state.sort = 'hot';
    state.category = '';
    state.status = '';
    state.q = '';
    paintFilterState();
    syncUrl();
    applyFilters();
  }

  function applyFilters() {
    loadIdeas({ reset: true, page: 1 });
    scrollToNode(byId('wishlist'), 'start');
  }

  /* ---------------- list loading ---------------- */

  function setBusy(busy) {
    if (!els.list) return;
    els.list.setAttribute('aria-busy', String(Boolean(busy)));
  }

  function loadIdeas(options) {
    const reset = Boolean(options && options.reset);
    const page = Math.max(1, Number(options && options.page) || 1);
    const seq = ++state.seq;
    state.loading = true;
    setBusy(true);

    if (reset) {
      state.items = [];
      state.total = 0;
      state.hasMore = false;
      state.page = 1;
      state.newId = 0;
      renderSkeleton();
    }
    renderFoot();

    const params = new URLSearchParams();
    params.set('sort', state.sort);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (state.category) params.set('category', state.category);
    if (state.status) params.set('status', state.status);
    if (state.q) params.set('q', state.q);

    return WY.api('/api/ideas?' + params.toString())
      .then(function (data) {
        if (seq !== state.seq) return;
        const items = Array.isArray(data.items) ? data.items : [];
        if (reset) {
          state.items = items;
        } else {
          const seen = new Set(state.items.map(function (item) { return item.id; }));
          state.items = state.items.concat(items.filter(function (item) { return !seen.has(item.id); }));
        }
        state.page = Number(data.page) || page;
        state.total = Number(data.total) || 0;
        state.hasMore = Boolean(data.hasMore);
        renderList();
        renderCounts();
      })
      .catch(function (error) {
        if (seq !== state.seq) return;
        state.hasMore = false;
        if (!state.items.length) renderError(error);
        else {
          renderList();
          WY.toast(error.message || '加载失败，请稍后再试', 'error');
        }
      })
      .then(function () {
        if (seq !== state.seq) return;
        state.loading = false;
        setBusy(false);
        renderFoot();
      });
  }

  /* ---------------- rendering ---------------- */

  function renderSkeleton() {
    els.list.innerHTML = SKELETON_CARD + SKELETON_CARD + SKELETON_CARD + SKELETON_CARD;
    setBusy(true);
  }

  function ideaCardHtml(idea) {
    const category = categoryOf(idea.category);
    const status = statusOf(idea.status);
    const classes = ['idea-card'];
    if (idea.id === state.newId) classes.push('is-new');
    if (idea.id === state.deepId) classes.push('is-deeplink');
    if (idea.id === state.highlightId && Date.now() < state.highlightUntil) classes.push('is-highlight');

    const author = idea.author || '匿名玩家';
    const createdAt = Number(idea.createdAt) || Date.now();
    const badgeClass = WY.statusBadgeClass(idea.status);

    return [
      '<article class="' + classes.join(' ') + '" id="idea-' + Number(idea.id) + '" data-idea-id="' + Number(idea.id) + '">',
      '  <div class="idea-card-head">',
      '    <div class="badges">',
      '      <span class="badge badge-cyan">' + WY.esc(category.icon) + ' ' + WY.esc(category.label) + '</span>',
      '      <span class="badge ' + badgeClass + '">' + WY.esc(status.icon) + ' ' + WY.esc(status.label) + '</span>',
      idea.pinned ? '      <span class="badge badge-gold">置顶</span>' : '',
      idea.id === state.newId ? '      <span class="badge badge-gold">刚刚提交</span>' : '',
      '    </div>',
      state.admin ? '    <button class="idea-pen" type="button" data-note-id="' + Number(idea.id) + '" title="写乌叶回复" aria-label="写乌叶回复：' + WY.esc(idea.title) + '">✎ ' + (idea.officialReply ? '改回复' : '写回复') + '</button>' : '',
      '  </div>',
      '  <h3><a href="#idea-' + Number(idea.id) + '" data-idea-link="' + Number(idea.id) + '">' + WY.esc(idea.title) + '</a></h3>',
      '  <p class="desc">' + WY.esc(idea.description) + '</p>',
      idea.officialReply
        ? '  <p class="official-reply"><b>乌叶回复：</b>' + WY.esc(idea.officialReply) + '</p>'
        : '',
      '  <div class="idea-card-foot">',
      '    <span class="idea-author"><b>' + WY.esc(author) + '</b> · <time datetime="' + new Date(createdAt).toISOString() + '" title="' + WY.esc(WY.formatDateTime(createdAt)) + '">' + WY.esc(WY.timeAgo(createdAt)) + '</time></span>',
      '    <button class="idea-vote' + (idea.voted ? ' is-voted' : '') + '" type="button" data-vote-id="' + Number(idea.id) + '" aria-pressed="' + (idea.voted ? 'true' : 'false') + '" aria-label="' + (idea.voted ? '取消投票' : '给这个灵感投票') + '：' + WY.esc(idea.title) + '">',
      '      <span aria-hidden="true">♥</span><b>' + WY.esc(WY.fmtNumber(idea.votes)) + '</b>',
      '    </button>',
      '  </div>',
      '</article>',
    ].join('\n');
  }

  function renderList() {
    if (!state.items.length) {
      els.list.innerHTML = emptyStateHtml();
    } else {
      els.list.innerHTML = state.items.map(ideaCardHtml).join('');
    }
    setBusy(state.loading);
  }

  function emptyStateHtml() {
    const filtered = Boolean(state.q || state.category || state.status);
    if (filtered) {
      return [
        '<div class="empty list-state">',
        '  <span class="empty-icon" aria-hidden="true">◌</span>',
        '  <strong>没有找到匹配的灵感</strong>',
        '  <p>换个关键词，或者清空筛选，看看大家的全部许愿。</p>',
        '  <div class="empty-actions"><button class="btn btn-ghost btn-sm" type="button" data-empty-reset>清空筛选</button></div>',
        '</div>',
      ].join('\n');
    }
    return [
      '<div class="empty list-state">',
      '  <span class="empty-icon" aria-hidden="true">✦</span>',
      '  <strong>还没有人许愿</strong>',
      '  <p>成为第一个写下灵感的人吧，回到上面的许愿表单，一句话也行。</p>',
      '  <div class="empty-actions"><a class="btn btn-primary btn-sm" href="#submit">去许愿</a></div>',
      '</div>',
    ].join('\n');
  }

  function renderError(error) {
    els.list.innerHTML = [
      '<div class="empty list-state">',
      '  <span class="empty-icon" aria-hidden="true">!</span>',
      '  <strong>灵感没能加载出来</strong>',
      '  <p>' + WY.esc((error && error.message) || '网络好像开小差了，请稍后重试。') + '</p>',
      '  <div class="empty-actions"><button class="btn btn-ghost btn-sm" type="button" data-retry>重新加载</button></div>',
      '</div>',
    ].join('\n');
    if (els.ideasTotal) els.ideasTotal.textContent = '—';
    if (els.ideasShown) els.ideasShown.textContent = '';
    if (els.listEnd) els.listEnd.hidden = true;
    if (els.foot) els.foot.hidden = true;
  }

  function renderCounts() {
    if (els.ideasTotal) els.ideasTotal.textContent = WY.fmtNumber(state.total);
    if (els.ideasShown) {
      els.ideasShown.textContent = state.items.length
        ? '已显示 ' + WY.fmtNumber(state.items.length) + ' / ' + WY.fmtNumber(state.total) + ' 条'
        : '';
    }
  }

  function renderFoot() {
    if (!els.foot) return;
    if (state.loading) {
      if (state.items.length) {
        els.foot.hidden = false;
        els.loadMore.disabled = true;
        els.loadMore.textContent = '加载中…';
        els.listEnd.hidden = true;
        return;
      }
      els.foot.hidden = true;
      return;
    }
    els.loadMore.disabled = false;
    const remaining = Math.max(0, state.total - state.items.length);
    els.loadMore.textContent = state.hasMore ? '加载更多（还有 ' + remaining + ' 条）' : '加载更多';
    els.foot.hidden = !state.hasMore;
    els.listEnd.hidden = state.hasMore || !state.items.length;
    if (els.listEndTotal) els.listEndTotal.textContent = WY.fmtNumber(state.total);
  }

  /* ---------------- list interactions ---------------- */

  function onListClick(event) {
    const pen = event.target.closest('[data-note-id]');
    if (pen) {
      event.preventDefault();
      editNote(Number(pen.dataset.noteId));
      return;
    }
    const voteButton = event.target.closest('[data-vote-id]');
    if (voteButton) {
      event.preventDefault();
      handleVote(voteButton);
      return;
    }
    const retry = event.target.closest('[data-retry]');
    if (retry) {
      loadIdeas({ reset: true, page: 1 });
      return;
    }
    const emptyReset = event.target.closest('[data-empty-reset]');
    if (emptyReset) {
      resetFilters();
      return;
    }
    const link = event.target.closest('[data-idea-link]');
    if (link) {
      event.preventDefault();
      const id = Number(link.dataset.ideaLink);
      if (!id) return;
      window.history.replaceState(null, '', '#idea-' + id);
      revealIdea(id, true);
    }
  }

  // Admin: write or change the 乌叶回复 shown on a card.
  function editNote(id) {
    const idea = state.items.find(function (item) { return item.id === id; });
    if (!idea) return;
    const dlg = WY.dialog({
      title: '乌叶回复',
      subtitle: idea.title,
      body: '<p class="muted dialog-text">金色显示在卡片上，所有人可见；留空就不显示。投票页上的「站长备注」也是这一条。</p>' +
        '<textarea class="input" rows="3" maxlength="300" data-note placeholder="例如：制作中，敬请期待。">' + WY.esc(idea.officialReply || '') + '</textarea>',
      footer: '<button class="btn btn-ghost" type="button" data-cancel>取消</button><button class="btn btn-primary" type="button" data-ok>保存</button>',
    });
    const input = dlg.body.querySelector('[data-note]');
    input.focus();
    dlg.footer.querySelector('[data-cancel]').addEventListener('click', function () { dlg.close(); });
    dlg.footer.querySelector('[data-ok]').addEventListener('click', async function () {
      const value = input.value.trim();
      dlg.close();
      if (value === (idea.officialReply || '')) return;
      try {
        await WY.api('/api/admin/ideas/' + id, { method: 'PATCH', body: { officialReply: value } });
        idea.officialReply = value;
        renderList();
        WY.toast(value ? '回复已保存' : '回复已清除', 'success');
      } catch (error) {
        WY.toast(error.message || '保存失败', 'error');
      }
    });
  }

  async function checkAdmin() {
    try {
      const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
      if (!r.ok || !(await r.json()).authed) return;
    } catch (error) {
      return;
    }
    state.admin = true;
    if (state.items.length) renderList();
  }

  function highlightCard(card) {
    if (!card) return;
    state.highlightId = Number(card.dataset.ideaId);
    state.highlightUntil = Date.now() + HIGHLIGHT_MS;
    card.classList.add('is-highlight');
    clearTimeout(state.highlightTimer);
    state.highlightTimer = setTimeout(function () {
      const node = byId('idea-' + state.highlightId);
      if (node) node.classList.remove('is-highlight');
    }, HIGHLIGHT_MS);
  }

  function revealIdea(id, scroll) {
    let card = byId('idea-' + id);
    if (card) {
      highlightCard(card);
      if (scroll) scrollToNode(card, 'center');
      return Promise.resolve();
    }
    return WY.api('/api/ideas/' + id)
      .then(function (data) {
        const idea = data && data.idea;
        if (!idea) return;
        state.deepId = idea.id;
        if (!state.items.some(function (item) { return item.id === idea.id; })) {
          state.items = [idea].concat(state.items);
        }
        renderList();
        renderCounts();
        card = byId('idea-' + id);
        if (!card) return;
        highlightCard(card);
        if (scroll) scrollToNode(card, 'center');
      })
      .catch(function (error) {
        WY.toast(
          error && error.status === 404 ? '这条灵感不存在或已被隐藏' : (error && error.message) || '加载失败，请稍后再试',
          'error',
        );
      });
  }

  function focusHash() {
    const match = /^#idea-(\d+)$/.exec(window.location.hash);
    if (!match) return;
    const id = Number(match[1]);
    if (id > 0) revealIdea(id, true);
  }

  /* ---------------- voting ---------------- */

  function paintVote(id) {
    const idea = state.items.find(function (item) { return item.id === id; });
    const button = els.list.querySelector('[data-vote-id="' + id + '"]');
    if (!idea || !button) return;
    button.classList.toggle('is-voted', Boolean(idea.voted));
    button.setAttribute('aria-pressed', String(Boolean(idea.voted)));
    const count = button.querySelector('b');
    if (count) count.textContent = WY.fmtNumber(idea.votes);
    button.setAttribute('aria-label', (idea.voted ? '取消投票' : '给这个灵感投票') + '：' + idea.title);
  }

  function handleVote(button) {
    const id = Number(button.dataset.voteId);
    if (!id || voting.has(id)) return;
    const idea = state.items.find(function (item) { return item.id === id; });
    if (!idea) return;

    voting.add(id);
    button.disabled = true;
    const wasVoted = Boolean(idea.voted);
    const previousVotes = Number(idea.votes) || 0;

    /* optimistic update: flip immediately, reconcile with the server reply */
    idea.voted = !wasVoted;
    idea.votes = Math.max(0, previousVotes + (wasVoted ? -1 : 1));
    paintVote(id);

    WY.api('/api/ideas/' + id + '/vote', { method: wasVoted ? 'DELETE' : 'POST' })
      .then(function (data) {
        idea.voted = Boolean(data.voted);
        idea.votes = Number(data.votes) || 0;
        paintVote(id);
        if (wasVoted) WY.toast('已取消投票', 'info');
        else if (data.duplicated) WY.toast('你已经投过这一票啦，已为你记上', 'info');
        else WY.toast('投票成功，谢谢你的支持！', 'success');
        scheduleStatsRefresh();
      })
      .catch(function (error) {
        idea.voted = wasVoted;
        idea.votes = previousVotes;
        paintVote(id);
        if (error.status === 429) WY.toast('投票太频繁啦，休息一下再来～', 'error');
        else if (error.status === 404) WY.toast('这条灵感不存在或已被隐藏', 'error');
        else WY.toast(error.message || '投票失败，请稍后再试', 'error');
      })
      .then(function () {
        voting.delete(id);
        const current = els.list.querySelector('[data-vote-id="' + id + '"]');
        if (current) current.disabled = false;
      });
  }

  function scheduleStatsRefresh() {
    clearTimeout(statsTimer);
    statsTimer = setTimeout(refreshStats, 900);
  }

  function refreshStats() {
    WY.api('/api/site')
      .then(function (data) {
        const stats = data && data.stats;
        if (!stats) return;
        each('[data-idea-count]', document, function (node) {
          node.textContent = WY.fmtNumber(stats.ideas);
        });
        each('[data-vote-count]', document, function (node) {
          node.textContent = WY.fmtNumber(stats.votes);
        });
      })
      .catch(function () {
        /* the shared chrome already shows cached numbers; nothing to do */
      });
  }

  /* ---------------- submit form ---------------- */

  function updateDescCount() {
    if (!els.desc || !els.descCount) return;
    const length = els.desc.value.length;
    const text = length + ' / 600';
    if (els.descCount.textContent !== text) els.descCount.textContent = text;
    els.descCount.classList.toggle('is-warn', length > 540);
  }

  function readForm() {
    return {
      title: els.title.value.trim(),
      description: els.desc.value.trim(),
      category: state.formCategory,
      author: els.author.value.trim(),
      website: els.website ? els.website.value : '',
      crossBorderConsent: Boolean(els.consent && els.consent.checked),
      ageConfirm: Boolean(els.age && els.age.checked),
    };
  }

  function validateForm(values) {
    if (values.website) return { field: 'form', message: '提交失败，请稍后再试' };
    if (!values.crossBorderConsent) return { field: 'form', message: '请先勾选同意隐私政策中的个人信息出境说明' };
    if (!values.ageConfirm) return { field: 'form', message: '请先确认你已年满 14 周岁' };
    if (!values.title) return { field: 'title', message: '请先写一个标题（4-40 字）' };
    if (values.title.length < 4) return { field: 'title', message: '灵感标题至少 4 个字' };
    if (values.title.length > 40) return { field: 'title', message: '灵感标题最多 40 个字' };
    if (!values.description) return { field: 'description', message: '请写点描述（10-600 字）' };
    if (values.description.length < 10) return { field: 'description', message: '灵感描述至少 10 个字' };
    if (values.description.length > 600) return { field: 'description', message: '灵感描述最多 600 个字' };
    if (!CATEGORY_MAP.has(values.category)) return { field: 'form', message: '请选一个分类' };
    if (values.author.length > 16) return { field: 'form', message: '昵称最多 16 个字' };
    return null;
  }

  function onSubmit(event) {
    event.preventDefault();
    if (state.submitting) return;
    clearFormError();
    clearFormSuccess();
    const values = readForm();
    const problem = validateForm(values);
    if (problem) {
      if (problem.field === 'title' || problem.field === 'description') {
        showFieldError(problem.field, problem.message);
        const input = problem.field === 'title' ? els.title : els.desc;
        if (input) input.focus();
      } else {
        showFormError(problem.message);
      }
      return;
    }
    submitIdea(values);
  }

  function submitIdea(values) {
    state.submitting = true;
    setSubmitBusy(true);
    WY.api('/api/ideas', { method: 'POST', body: values })
      .then(function (data) {
        const idea = data && data.idea;
        WY.toast('许愿成功！审核通过后大家就能投票啦', 'success');
        resetForm();
        if (!idea) {
          showFormSuccess('已提交成功！审核通过后就会出现在列表里。');
          return;
        }
        state.newId = idea.id;
        if (matchesCurrentFilters(idea)) {
          state.items = [idea].concat(state.items.filter(function (item) { return item.id !== idea.id; }));
          state.total += 1;
          renderList();
          renderCounts();
          renderFoot();
        } else {
          showFormSuccess('已提交成功！当前筛选条件下列表里暂时看不到它，点上面的「重置」就能找到。');
        }
        scheduleStatsRefresh();
      })
      .catch(handleSubmitError)
      .then(function () {
        state.submitting = false;
        setSubmitBusy(false);
      });
  }

  function matchesCurrentFilters(idea) {
    if (state.category && idea.category !== state.category) return false;
    if (state.status && idea.status !== state.status) return false;
    if (state.q) {
      const haystack = (idea.title + ' ' + idea.description + ' ' + idea.author).toLowerCase();
      if (!haystack.includes(state.q.toLowerCase())) return false;
    }
    return true;
  }

  function handleSubmitError(error) {
    const status = error && error.status;
    let message = (error && error.message) || '提交失败，请稍后再试';
    if (status === 429) message = '提交太频繁啦，休息一会儿再试～';
    else if (status === 400 || status === 409) message = (error && error.message) || message;
    else if (status === 403) message = '提交被拒绝了，请稍后再试';
    showFormError(message);
    WY.toast(message, 'error');
  }

  function setSubmitBusy(busy) {
    if (!els.submit) return;
    els.submit.disabled = busy;
    els.submit.classList.toggle('is-loading', busy);
    els.submit.setAttribute('aria-busy', String(Boolean(busy)));
    const label = els.submit.querySelector('[data-submit-label]');
    if (label) label.textContent = busy ? '提交中…' : '提交灵感';
  }

  function resetForm() {
    if (els.form) els.form.reset();
    state.formCategory = 'aeon';
    paintCategoryPicker();
    clearFieldError('title');
    clearFieldError('description');
    clearFormError();
    clearFormSuccess();
    updateDescCount();
  }

  function showFieldError(field, message) {
    if (field === 'title' && els.title && els.titleError) {
      els.titleError.textContent = message;
      els.title.setAttribute('aria-invalid', 'true');
      const wrapper = els.title.closest('.field');
      if (wrapper) wrapper.classList.add('has-error');
    } else if (field === 'description' && els.desc && els.descError) {
      els.descError.textContent = message;
      els.desc.setAttribute('aria-invalid', 'true');
      const wrapper = els.desc.closest('.field');
      if (wrapper) wrapper.classList.add('has-error');
    }
  }

  function clearFieldError(field) {
    const input = field === 'title' ? els.title : els.desc;
    const errorNode = field === 'title' ? els.titleError : els.descError;
    if (!input || !errorNode) return;
    errorNode.textContent = '';
    input.removeAttribute('aria-invalid');
    const wrapper = input.closest('.field');
    if (wrapper) wrapper.classList.remove('has-error');
  }

  function showFormError(message) {
    if (!els.formError) return;
    els.formError.textContent = message;
    els.formError.hidden = false;
  }

  function clearFormError() {
    if (!els.formError) return;
    els.formError.hidden = true;
    els.formError.textContent = '';
  }

  function showFormSuccess(message) {
    if (!els.formSuccess) return;
    els.formSuccess.textContent = message;
    els.formSuccess.hidden = false;
  }

  function clearFormSuccess() {
    if (!els.formSuccess) return;
    els.formSuccess.hidden = true;
    els.formSuccess.textContent = '';
  }

  /* ---------------- go ---------------- */

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
