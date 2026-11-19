/* ==========================================================================
   乌叶MC · 模组许愿池 — 管理后台 /admin
   依赖 /app.js 暴露的 window.WY（API 封装、toast、dialog、时间格式化）。
   管理码只通过登录表单提交，不写入 localStorage / URL / console。
   ========================================================================== */

(function () {
  'use strict';

  const WY = window.WY;
  if (!WY) return;

  const STATUSES = [
    { key: 'pending', label: '待审核' },
    { key: 'open', label: '投票中' },
    { key: 'planned', label: '已采纳' },
    { key: 'building', label: '制作中' },
    { key: 'released', label: '已发布' },
    { key: 'shelved', label: '暂搁置' },
  ];

  const STATUS_LABELS = {
    pending: '待审核',
    open: '投票中',
    planned: '已采纳',
    building: '制作中',
    released: '已发布',
    shelved: '暂搁置',
    hidden: '已隐藏',
  };

  const CATEGORY_LABELS = {
    aeon: '游戏复刻',
    anime: '动漫联动',
    mob: '生物 / Boss',
    horror: '恐怖惊悚',
    gameplay: '机制玩法',
    music: '音乐音效',
    other: '其他灵感',
  };

  const AUDIT_LABELS = {
    'idea.create': '新灵感提交',
    'idea.update': '更新灵感',
    'idea.delete': '删除灵感',
    'poll.create': '新建投票',
    'poll.update': '编辑投票',
    'poll.delete': '删除投票',
    'poll.options': '修改投票选项',
    'settings.update': '更新站点公告',
    'admin.code.change': '修改管理码',
    'admin.login': '登录后台',
    'admin.login.failed': '登录失败',
    'admin.export': '导出 CSV',
  };

  const TAB_NAMES = ['overview', 'ideas', 'polls', 'settings', 'channel', 'files', 'sponsor', 'boards', 'privacy'];
  const PAGE_SIZE = 50;
  const DEFAULT_ANNOUNCEMENT = '暂无公告，先去看看大家的许愿吧。';

  const state = {
    me: null,
    activeTab: 'overview',
    overview: null,
    overviewLoading: false,
    overviewStale: false,
    settingsDirty: false,
    expiryNotified: false,
    dialogs: new Set(),
    ideas: blankIdeas(),
    polls: blankPolls(),
  };

  let els = {};

  /* ---------------- tiny helpers ---------------- */

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function $$(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function blankIdeas() {
    return {
      loaded: false,
      loading: false,
      q: '',
      status: '',
      page: 1,
      items: [],
      total: 0,
      pageSize: PAGE_SIZE,
      hasMore: false,
      token: 0,
      error: '',
      highlightId: 0,
    };
  }

  function blankPolls() {
    return {
      loaded: false,
      loading: false,
      items: [],
      error: '',
    };
  }

  function statusLabel(key) {
    return STATUS_LABELS[key] || key || '未知状态';
  }

  function categoryLabel(key) {
    return CATEGORY_LABELS[key] || '其他灵感';
  }

  function safeDateTime(value) {
    const ts = Number(value);
    return Number.isFinite(ts) ? WY.formatDateTime(ts) : '—';
  }

  function toDateTimeLocal(value) {
    const ts = Number(value);
    if (!Number.isFinite(ts)) return '';
    return WY.formatDateTime(ts).replace(' ', 'T');
  }

  function parseLocalDateTime(value) {
    if (!value) return null;
    const raw = value.length === 16 ? value + ':00' : value;
    const ts = Date.parse(raw + '+08:00');
    return Number.isFinite(ts) ? ts : NaN;
  }

  function todayStamp() {
    return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  }

  function emptyHtml(title, hint, icon) {
    return (
      '<div class="empty">' +
      '<span class="empty-icon" aria-hidden="true">' +
      WY.esc(icon || '✧') +
      '</span>' +
      '<strong>' +
      WY.esc(title) +
      '</strong>' +
      (hint ? '<span class="small">' + WY.esc(hint) + '</span>' : '') +
      '</div>'
    );
  }

  function setButtonBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
      button.disabled = true;
      if (label) button.textContent = label;
      return;
    }
    button.disabled = false;
    if (button.dataset.idleText) {
      button.textContent = button.dataset.idleText;
      delete button.dataset.idleText;
    } else if (label) {
      button.textContent = label;
    }
  }

  function setLoginError(message, tone) {
    if (!els.loginError) return;
    els.loginError.textContent = message || '';
    els.loginError.classList.toggle('is-info', Boolean(message) && tone === 'info');
  }

  /* ---------------- API wrapper / session ---------------- */

  async function adminApi(path, options) {
    try {
      return await WY.api(path, options);
    } catch (error) {
      if (error && error.status === 401) {
        expireSession();
        error.handled = true;
      }
      throw error;
    }
  }

  function expireSession() {
    if (state.expiryNotified) return;
    showAuth('登录已过期，请重新输入管理码。');
    state.expiryNotified = true;
    WY.toast('登录已过期，请重新登录', 'error');
  }

  function showAuth(message, tone) {
    closeDialogs();
    state.me = null;
    state.overview = null;
    state.overviewStale = false;
    state.settingsDirty = false;
    state.expiryNotified = false;
    state.ideas = blankIdeas();
    state.polls = blankPolls();
    state.activeTab = 'overview';
    clearAdminDom();
    if (els.adminView) els.adminView.hidden = true;
    if (els.adminBoot) els.adminBoot.hidden = true;
    if (els.authView) els.authView.hidden = false;
    if (els.loginCode) els.loginCode.value = '';
    switchTab('overview', { load: false });
    setLoginError(message || '', tone || 'error');
  }

  async function enterAdmin(me) {
    state.me = { authed: true, expiresAt: Number(me && me.expiresAt) || null };
    state.expiryNotified = false;
    if (els.authView) els.authView.hidden = true;
    if (els.adminBoot) els.adminBoot.hidden = true;
    if (els.adminView) els.adminView.hidden = false;
    setLoginError('');
    setSession(state.me.expiresAt, Boolean(me && me.mustChange));
    switchTab('overview', { load: false });
    await loadOverview();
  }

  function setSession(expiresAt, mustChange) {
    if (expiresAt) {
      els.sessionExpires.textContent = safeDateTime(expiresAt) + '（UTC+8）';
      const remaining = WY.remaining(expiresAt);
      els.sessionLeft.textContent = remaining.ended ? ' · 已过期' : ' · ' + remaining.text;
    } else {
      els.sessionExpires.textContent = '—';
      els.sessionLeft.textContent = '';
    }
    els.mustChange.hidden = !mustChange;
  }

  /* ---------------- login ---------------- */

  async function onLoginSubmit(event) {
    event.preventDefault();
    if (state.me) return;

    const code = els.loginCode.value;
    if (!code) {
      setLoginError('请输入管理码。');
      els.loginCode.focus();
      return;
    }
    if (code.length < 4 || code.length > 128) {
      setLoginError('管理码长度不正确。');
      els.loginCode.focus();
      return;
    }

    setLoginError('');
    setButtonBusy(els.loginSubmit, true, '验证中…');
    try {
      const data = await WY.api('/api/admin/login', { method: 'POST', body: { code } });
      els.loginCode.value = '';
      await enterAdmin({ authed: true, expiresAt: data && data.expiresAt, mustChange: false });
      if (state.me) WY.toast('登录成功', 'success');
    } catch (error) {
      if (error && error.code === 'pattern_required') {
        location.replace('/admin'); // the full sign-in page has the pattern pad
        return;
      }
      if (error && error.status === 401) {
        setLoginError('管理码不正确，请再试一次。');
      } else {
        setLoginError((error && error.message) || '登录失败，请稍后重试。');
      }
      els.loginCode.select();
    } finally {
      setButtonBusy(els.loginSubmit, false);
    }
  }

  async function logout() {
    if (!state.me || els.logoutBtn.disabled) return;
    setButtonBusy(els.logoutBtn, true, '退出中…');
    try {
      await adminApi('/api/admin/logout', { method: 'POST' });
      location.replace('/admin'); // back to the sign-in page; the dashboard is no longer served
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '退出失败，请稍后重试', 'error');
    } finally {
      setButtonBusy(els.logoutBtn, false);
    }
  }

  /* ---------------- tabs ---------------- */

  function switchTab(name, options) {
    if (!TAB_NAMES.includes(name)) return;
    const opts = options || {};
    state.activeTab = name;

    $$('.tab[data-tab]').forEach(function (tab) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });

    $$('.admin-panel[data-panel]').forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name;
    });

    if (opts.load === false || !state.me) return;

    if (name === 'overview') {
      if (!state.overview || state.overviewStale) loadOverview();
      return;
    }
    if (name === 'ideas') {
      if (!state.ideas.loaded || opts.force) loadIdeas();
      return;
    }
    if (name === 'polls') {
      if (!state.polls.loaded || opts.force) loadPolls();
      return;
    }
    if (name === 'channel' || name === 'files' || name === 'sponsor' || name === 'boards' || name === 'privacy') {
      document.dispatchEvent(new CustomEvent('wy:' + name));
      return;
    }
    renderSettings();
    document.dispatchEvent(new CustomEvent('wy:settings'));
  }

  function onTabKeydown(event) {
    const current = event.target.closest('.tab[data-tab]');
    if (!current) return;
    const tabs = $$('.tab[data-tab]');
    const index = tabs.indexOf(current);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    target.focus();
    switchTab(target.dataset.tab);
  }

  /* ---------------- overview ---------------- */

  async function loadOverview(options) {
    if (!state.me || state.overviewLoading) return;
    const opts = options || {};
    state.overviewLoading = true;
    if (opts.manual) setButtonBusy(els.refreshOverview, true, '刷新中…');
    try {
      const data = await adminApi('/api/admin/overview');
      if (!state.me) return;
      state.overview = data || {};
      state.overviewStale = false;
      renderOverview(state.overview);
      renderBackup(data.backup);
      document.dispatchEvent(new CustomEvent('wy:overview'));
      setSession(data.sessionExpiresAt || state.me.expiresAt, Boolean(data.mustChange));
    } catch (error) {
      if (error && error.handled) return;
      WY.toast((error && error.message) || '概览加载失败', 'error');
      renderOverviewError((error && error.message) || '请稍后重试。');
    } finally {
      state.overviewLoading = false;
      if (opts.manual) setButtonBusy(els.refreshOverview, false);
    }
  }

  function renderOverview(data) {
    const stats = (data && data.stats) || {};
    els.statIdeas.textContent = WY.fmtNumber(Number(stats.ideas) || 0);
    els.statVotes.textContent = WY.fmtNumber(Number(stats.votes) || 0);
    els.statOpenPolls.textContent = String(Number(stats.openPolls) || 0);
    els.statToday.textContent = String(Number(stats.todayIdeas) || 0);
    renderPending(Array.isArray(data.pending) ? data.pending : []);
    renderAudit(Array.isArray(data.audit) ? data.audit : []);
  }

  // Daily backup runs ~02:47 Beijing time; warn if the last good one is older than 36 h (or never happened).
  function renderBackup(backup) {
    const el = document.getElementById('backup-warn');
    if (!el) return;
    const lastOk = backup && backup.lastOk;
    const stale = backup && (!lastOk || Date.now() - lastOk > 36 * 3600_000);
    el.hidden = !stale;
    if (stale) {
      el.textContent = lastOk
        ? `⚠ 异地备份已超过 36 小时没有成功（上次成功：${new Date(lastOk).toLocaleString()}）。请检查服务器备份任务。`
        : '⚠ 还没有成功的异地备份记录。请检查服务器备份任务。';
    }
  }

  function renderOverviewError(message) {
    if (state.overview) return;
    els.statIdeas.textContent = '—';
    els.statVotes.textContent = '—';
    els.statOpenPolls.textContent = '—';
    els.statToday.textContent = '—';
    els.pendingTotal.textContent = '—';
    els.pendingList.innerHTML = emptyHtml('概览加载失败', message, '⚠');
    els.auditList.innerHTML = '<li>' + emptyHtml('概览加载失败', message, '⚠') + '</li>';
  }

  function renderPending(pending) {
    els.pendingTotal.textContent = '共 ' + pending.length + ' 条';
    if (!pending.length) {
      els.pendingList.innerHTML = emptyHtml('没有待审核的灵感', '新提交的灵感会出现在这里。', '◷');
      return;
    }
    els.pendingList.innerHTML = pending
      .map(function (idea) {
        return (
          '<article class="admin-pending">' +
          '<div class="admin-pending-main">' +
          '<span class="admin-pending-id mono">#' +
          Number(idea.id) +
          '</span>' +
          '<div>' +
          '<h3 title="' +
          WY.esc(idea.title) +
          '">' +
          WY.esc(idea.title) +
          '</h3>' +
          '<p class="muted small">' +
          WY.esc(idea.author || '匿名玩家') +
          ' · ' +
          WY.fmtNumber(Number(idea.votes) || 0) +
          ' 票 · ' +
          WY.esc(categoryLabel(idea.category)) +
          ' · ' +
          WY.esc(WY.timeAgo(idea.createdAt)) +
          '</p>' +
          '</div>' +
          '</div>' +
          '<div class="admin-pending-acts">' +
          '<button class="btn btn-sm btn-primary" type="button" data-approve="' + Number(idea.id) + '">通过，开放投票</button>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-reject="' + Number(idea.id) + '">不通过</button>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-review="' + Number(idea.id) + '">编辑</button>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  function renderAudit(audit) {
    if (!audit.length) {
      els.auditList.innerHTML = '<li>' + emptyHtml('暂无操作记录', '后台操作会记录在这里。', '✎') + '</li>';
      return;
    }
    els.auditList.innerHTML = audit
      .map(function (entry) {
        const action = AUDIT_LABELS[entry.action] || entry.action || '操作';
        const detail = entry.detail ? String(entry.detail) : '';
        return (
          '<li>' +
          '<div class="admin-audit-top">' +
          '<span class="admin-audit-action">' +
          WY.esc(action) +
          '</span>' +
          '<span class="admin-audit-time">' +
          WY.esc(safeDateTime(entry.createdAt)) +
          '</span>' +
          '</div>' +
          (detail
            ? '<span class="admin-audit-detail" title="' + WY.esc(detail) + '">' + WY.esc(detail) + '</span>'
            : '') +
          '</li>'
        );
      })
      .join('');
  }

  /* ---------------- ideas list ---------------- */

  async function loadIdeas(options) {
    if (!state.me) return;
    const opts = options || {};
    const box = state.ideas;
    const token = ++box.token;
    box.loading = true;
    box.error = '';
    if (opts.highlightId) box.highlightId = Number(opts.highlightId) || 0;
    renderIdeas();

    const params = new URLSearchParams();
    if (box.q) params.set('q', box.q);
    if (box.status) params.set('status', box.status);
    params.set('page', String(box.page));

    try {
      const data = await adminApi('/api/admin/ideas?' + params.toString());
      if (token !== box.token || !state.me) return;
      box.items = Array.isArray(data.items) ? data.items : [];
      box.total = Number(data.total) || 0;
      box.page = Number(data.page) || box.page;
      box.pageSize = Number(data.pageSize) || PAGE_SIZE;
      box.hasMore = Boolean(data.hasMore);
      box.loaded = true;
      box.loading = false;
      renderIdeas();
      highlightIdeaRow(box.highlightId);
      box.highlightId = 0;
    } catch (error) {
      if (token !== box.token) return;
      box.loading = false;
      if (error && error.handled) return;
      box.error = (error && error.message) || '灵感列表加载失败';
      renderIdeas();
      WY.toast(box.error, 'error');
    }
  }

  function highlightIdeaRow(id) {
    if (!id) return;
    const row = $$('tr[data-idea-id]', els.ideaTbody).find(function (node) {
      return Number(node.dataset.ideaId) === Number(id);
    });
    if (!row) return;
    row.classList.add('admin-row-highlight');
    if (typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    setTimeout(function () {
      row.classList.remove('admin-row-highlight');
    }, 2000);
  }

  function ideaRowHtml(idea) {
    const id = Number(idea.id);
    const hidden = Boolean(idea.hidden);
    const pinned = Boolean(idea.pinned);
    const currentStatus = STATUS_LABELS[idea.status] ? idea.status : 'pending';
    const options = STATUSES.map(function (status) {
      return (
        '<option value="' +
        status.key +
        '"' +
        (status.key === currentStatus ? ' selected' : '') +
        '>' +
        status.label +
        '</option>'
      );
    }).join('');

    return (
      '<tr data-idea-id="' +
      id +
      '" class="' +
      (hidden ? 'is-hidden-row' : '') +
      '">' +
      '<td class="mono">#' +
      id +
      '</td>' +
      '<td class="cell-title">' +
      '<div class="admin-idea-title"><span>' +
      WY.esc(idea.title) +
      '</span></div>' +
      '<span class="admin-idea-desc" title="' +
      WY.esc(idea.description) +
      '">' +
      WY.esc(idea.description) +
      '</span>' +
      '</td>' +
      '<td>' +
      WY.esc(idea.author || '匿名玩家') +
      '</td>' +
      '<td><div class="admin-votes"><b class="mono">' +
      WY.fmtNumber(Number(idea.votes) || 0) +
      '</b>' +
      (Number(idea.voteAdjust)
        ? '<span class="admin-votes-bot">含机器票 ' + (idea.voteAdjust > 0 ? '+' : '') + WY.fmtNumber(Number(idea.voteAdjust)) + '</span>'
        : '') +
      '<button class="btn btn-sm btn-ghost" type="button" data-idea-action="votes" title="加票填正数，减票填负数">调票</button>' +
      '</div></td>' +
      '<td>' +
      '<select class="select admin-status-select" data-idea-action="status" aria-label="修改灵感 #' +
      id +
      ' 的状态">' +
      options +
      '</select>' +
      '</td>' +
      '<td>' +
      '<div class="admin-marks">' +
      (pinned ? '<span class="badge badge-gold">置顶</span>' : '') +
      (hidden ? '<span class="badge badge-rose">已隐藏</span>' : '') +
      '<span class="tag">' +
      WY.esc(categoryLabel(idea.category)) +
      '</span>' +
      (idea.officialReply ? '<span class="badge badge-cyan">已回复</span>' : '') +
      '</div>' +
      '</td>' +
      '<td class="cell-nowrap" title="' +
      WY.esc(safeDateTime(idea.createdAt)) +
      '">' +
      WY.esc(safeDateTime(idea.createdAt)) +
      '<span class="admin-time-ago">' +
      WY.esc(WY.timeAgo(idea.createdAt)) +
      '</span>' +
      '</td>' +
      '<td>' +
      '<div class="cell-actions admin-actions">' +
      '<button class="btn btn-sm btn-ghost" type="button" data-idea-action="pin">' +
      (pinned ? '取消置顶' : '置顶') +
      '</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-idea-action="hide">' +
      (hidden ? '恢复' : '隐藏') +
      '</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-idea-action="reply">回复</button>' +
      '<button class="btn btn-sm btn-danger" type="button" data-idea-action="delete">删除</button>' +
      '</div>' +
      '</td>' +
      '</tr>'
    );
  }

  function renderIdeas() {
    const box = state.ideas;
    const pages = Math.max(1, Math.ceil(box.total / box.pageSize));
    const filtersActive = Boolean(box.q || box.status);

    if (box.loading) {
      els.ideaTbody.innerHTML = Array.from({ length: 4 }, function () {
        return (
          '<tr class="admin-skeleton-row"><td colspan="8"><div class="skeleton"></div></td></tr>'
        );
      }).join('');
      els.ideaMeta.textContent = '加载中…';
      els.ideaPagination.innerHTML = '';
      return;
    }

    if (box.error) {
      els.ideaTbody.innerHTML =
        '<tr><td colspan="8" class="admin-empty-cell">' +
        emptyHtml('列表加载失败', box.error, '⚠') +
        '<div class="admin-empty-cell-actions"><button class="btn btn-sm btn-ghost" type="button" data-retry-ideas>重新加载</button></div>' +
        '</td></tr>';
      els.ideaMeta.textContent = '加载失败';
      els.ideaPagination.innerHTML = '';
      return;
    }

    if (!box.items.length) {
      els.ideaTbody.innerHTML =
        '<tr><td colspan="8" class="admin-empty-cell">' +
        emptyHtml(
          filtersActive ? '没有符合筛选的灵感' : '许愿池还没有灵感',
          filtersActive ? '换个关键词或状态再试试。' : '玩家提交后会出现在这里。',
          '✧',
        ) +
        '</td></tr>';
      els.ideaMeta.textContent = '共 0 条';
      els.ideaPagination.innerHTML = '';
      return;
    }

    els.ideaTbody.innerHTML = box.items.map(ideaRowHtml).join('');
    els.ideaMeta.textContent =
      '共 ' +
      WY.fmtNumber(box.total) +
      ' 条 · 第 ' +
      box.page +
      ' / ' +
      pages +
      ' 页' +
      (box.q ? ' · 搜索「' + box.q + '」' : '');
    renderPagination(box, pages);
  }

  function renderPagination(box, pages) {
    if (pages <= 1) {
      els.ideaPagination.innerHTML = '<span class="page-info">第 1 / 1 页</span>';
      return;
    }

    const wanted = [1, pages, box.page - 1, box.page, box.page + 1];
    const numbers = Array.from(new Set(wanted))
      .filter(function (page) {
        return page >= 1 && page <= pages;
      })
      .sort(function (a, b) {
        return a - b;
      });

    let html =
      '<button class="page-btn" type="button" data-page="' +
      (box.page - 1) +
      '"' +
      (box.page <= 1 ? ' disabled' : '') +
      ' aria-label="上一页">上一页</button>';

    let previous = 0;
    numbers.forEach(function (page) {
      if (previous && page - previous > 1) html += '<span class="page-info">…</span>';
      html +=
        '<button class="page-btn' +
        (page === box.page ? ' is-active' : '') +
        '" type="button" data-page="' +
        page +
        '"' +
        (page === box.page ? ' aria-current="page"' : '') +
        '>' +
        page +
        '</button>';
      previous = page;
    });

    html +=
      '<button class="page-btn" type="button" data-page="' +
      (box.page + 1) +
      '"' +
      (box.page >= pages ? ' disabled' : '') +
      ' aria-label="下一页">下一页</button>' +
      '<span class="page-info">共 ' +
      pages +
      ' 页</span>';

    els.ideaPagination.innerHTML = html;
  }

  function findIdeaFromNode(node) {
    const row = node.closest('tr[data-idea-id]');
    if (!row) return null;
    const id = Number(row.dataset.ideaId);
    return (
      state.ideas.items.find(function (item) {
        return Number(item.id) === id;
      }) || null
    );
  }

  function ideaMatchesFilter(item) {
    const box = state.ideas;
    if (box.status === 'hidden') {
      if (!item.hidden) return false;
    } else if (box.status) {
      if (item.hidden || item.status !== box.status) return false;
    }
    if (box.q) {
      const needle = box.q.toLowerCase();
      const haystack = [item.title || '', item.description || '', item.author || '']
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  }

  function applyIdeaResult(item, patch, updated) {
    if (updated && typeof updated === 'object' && typeof updated.title === 'string') {
      Object.assign(item, updated);
      item.hidden = Boolean(updated.hidden);
      return;
    }
    Object.assign(item, patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'hidden')) item.hidden = Boolean(patch.hidden);
    if (Object.prototype.hasOwnProperty.call(patch, 'pinned')) item.pinned = Boolean(patch.pinned);
  }

  async function patchIdea(item, patch, successMessage) {
    const data = await adminApi('/api/admin/ideas/' + Number(item.id), {
      method: 'PATCH',
      body: patch,
    });
    if (!state.me) return;

    applyIdeaResult(item, patch, data && data.idea);
    state.overviewStale = true;
    if (successMessage) WY.toast(successMessage, 'success');

    if (!ideaMatchesFilter(item)) {
      state.ideas.items = state.ideas.items.filter(function (entry) {
        return Number(entry.id) !== Number(item.id);
      });
      state.ideas.total = Math.max(0, state.ideas.total - 1);
      if (!state.ideas.items.length && state.ideas.page > 1) {
        state.ideas.page -= 1;
        await loadIdeas();
        return;
      }
    }
    renderIdeas();
  }

  async function togglePin(item, button) {
    if (button.disabled) return;
    const next = !item.pinned;
    setButtonBusy(button, true);
    try {
      await patchIdea(item, { pinned: next }, next ? '已置顶' : '已取消置顶');
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '操作失败，请稍后重试', 'error');
    } finally {
      if (button.isConnected) setButtonBusy(button, false);
    }
  }

  async function toggleHide(item, button) {
    if (button.disabled) return;
    const next = !item.hidden;
    setButtonBusy(button, true);
    try {
      await patchIdea(item, { hidden: next }, next ? '已隐藏，公开页不再显示' : '已恢复显示');
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '操作失败，请稍后重试', 'error');
    } finally {
      if (button.isConnected) setButtonBusy(button, false);
    }
  }

  async function changeIdeaStatus(select) {
    const item = findIdeaFromNode(select);
    if (!item) return;
    const previous = item.status;
    const next = select.value;
    if (!STATUS_LABELS[next] || next === previous) {
      select.value = previous;
      return;
    }

    select.disabled = true;
    try {
      await patchIdea(item, { status: next }, '已改为「' + statusLabel(next) + '」');
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '状态更新失败', 'error');
      if (select.isConnected) {
        select.value = previous;
        select.disabled = false;
      }
    }
  }

  async function adjustVotes(item, button) {
    if (button.disabled) return;
    const raw = window.prompt(
      '「' + item.title + '」现在 ' + (Number(item.votes) || 0) + ' 票（其中机器票 ' + (Number(item.voteAdjust) || 0) +
        '）。\n加几票？填正数加票，负数减票（例如 50 或 -20）：',
      '',
    );
    if (raw === null || !raw.trim()) return;
    const delta = Number(raw.trim());
    if (!Number.isInteger(delta) || !delta) {
      WY.toast('请填整数，例如 50 或 -20', 'error');
      return;
    }
    setButtonBusy(button, true);
    try {
      await patchIdea(item, { addVotes: delta }, delta > 0 ? '已加 ' + delta + ' 票' : '已减 ' + -delta + ' 票');
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '调票失败', 'error');
    } finally {
      if (button.isConnected) setButtonBusy(button, false);
    }
  }

  async function deleteIdea(item, button) {
    if (button.disabled) return;
    const ok = await confirmDialog({
      title: '删除这条灵感？',
      message:
        '将永久删除灵感 #' +
        Number(item.id) +
        '「' +
        item.title +
        '」及其 ' +
        (Number(item.votes) || 0) +
        ' 票，无法恢复。',
      okText: '永久删除',
      danger: true,
    });
    if (!ok || !state.me) return;

    setButtonBusy(button, true);
    try {
      await adminApi('/api/admin/ideas/' + Number(item.id), { method: 'DELETE' });
      if (!state.me) return;
      state.ideas.items = state.ideas.items.filter(function (entry) {
        return Number(entry.id) !== Number(item.id);
      });
      state.ideas.total = Math.max(0, state.ideas.total - 1);
      state.overviewStale = true;
      WY.toast('灵感已删除', 'success');
      if (!state.ideas.items.length && state.ideas.page > 1) {
        state.ideas.page -= 1;
        await loadIdeas();
        return;
      }
      renderIdeas();
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '删除失败，请稍后重试', 'error');
    } finally {
      if (button.isConnected) setButtonBusy(button, false);
    }
  }

  function openReplyDialog(item) {
    const dialog = openDialog({
      title: '回复灵感 #' + Number(item.id),
      subtitle: item.title,
      body:
        '<form id="reply-form" novalidate>' +
        '<div class="field">' +
        '<label for="reply-text">官方回复 <span class="admin-char-count" id="reply-count">0 / 300</span></label>' +
        '<textarea class="textarea" id="reply-text" maxlength="300" rows="5" placeholder="写给这位玩家的回复，会展示在公开许愿池。">' +
        WY.esc(item.officialReply || '') +
        '</textarea>' +
        '</div>' +
        '<p class="hint">留空保存会清除官方回复；最多 300 字。</p>' +
        '<p class="admin-form-error" data-form-error role="alert"></p>' +
        '</form>',
      footer:
        '<div class="admin-dialog-actions">' +
        '<button class="btn btn-ghost" type="button" data-cancel>取消</button>' +
        '<button class="btn btn-primary" type="submit" form="reply-form" data-save>保存回复</button>' +
        '</div>',
    });

    const form = dialog.body.querySelector('#reply-form');
    const textarea = form.querySelector('#reply-text');
    const count = form.querySelector('#reply-count');
    const errorBox = form.querySelector('[data-form-error]');
    const saveButton = dialog.footer.querySelector('[data-save]');
    const initial = item.officialReply || '';

    function updateCount() {
      count.textContent = textarea.value.length + ' / 300';
    }
    updateCount();
    textarea.addEventListener('input', updateCount);
    dialog.footer.querySelector('[data-cancel]').addEventListener('click', function () {
      dialog.close();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const value = textarea.value.trim();
      errorBox.textContent = '';
      if (value.length > 300) {
        errorBox.textContent = '回复不能超过 300 字。';
        return;
      }
      if (value === initial.trim()) {
        errorBox.textContent = '回复没有变化。';
        return;
      }
      setButtonBusy(saveButton, true, '保存中…');
      try {
        await patchIdea(item, { officialReply: value }, value ? '官方回复已保存' : '官方回复已清除');
        dialog.close();
      } catch (error) {
        if (error && error.handled) return;
        errorBox.textContent = (error && error.message) || '保存失败，请稍后重试。';
      } finally {
        if (saveButton.isConnected) setButtonBusy(saveButton, false);
      }
    });
  }

  function onIdeaTableClick(event) {
    const retry = event.target.closest('[data-retry-ideas]');
    if (retry) {
      loadIdeas();
      return;
    }
    const button = event.target.closest('button[data-idea-action]');
    if (!button) return;
    const item = findIdeaFromNode(button);
    if (!item) return;
    const action = button.dataset.ideaAction;
    if (action === 'pin') togglePin(item, button);
    else if (action === 'hide') toggleHide(item, button);
    else if (action === 'reply') openReplyDialog(item);
    else if (action === 'votes') adjustVotes(item, button);
    else if (action === 'delete') deleteIdea(item, button);
  }

  function onIdeaFiltersChange() {
    if (!state.me) return;
    state.ideas.page = 1;
    state.ideas.loaded = false;
    loadIdeas();
  }

  function resetIdeaFilters() {
    els.ideaSearch.value = '';
    els.ideaStatus.value = '';
    state.ideas.q = '';
    state.ideas.status = '';
    state.ideas.page = 1;
    state.ideas.loaded = false;
    if (state.me) loadIdeas();
  }

  /* ---------------- poll management ---------------- */

  function isPollEnded(poll) {
    if (!poll) return true;
    if (poll.status === 'closed' || poll.ended === true) return true;
    return poll.endsAt != null && Number(poll.endsAt) <= Date.now();
  }

  function pollCardHtml(poll) {
    const ended = isPollEnded(poll);
    const ballots = Number(poll.totalBallots) || 0;
    const options = Array.isArray(poll.options) ? poll.options : [];
    const maxVotes = options.reduce(function (max, option) {
      return Math.max(max, Number(option.votes) || 0);
    }, 0);

    const meta = [
      '<span>' +
        WY.fmtNumber(ballots) +
        ' 人投票 · ' +
        WY.fmtNumber(Number(poll.totalVotes) || 0) +
        ' 票</span>',
      '<span>' + (poll.allowMultiple ? '多选' : '单选') + '</span>',
      poll.endsAt
        ? '<span>结束：' + WY.esc(safeDateTime(poll.endsAt)) + '（UTC+8）</span>'
        : '<span>长期开放</span>',
      poll.endsAt && !ended ? '<span class="countdown" data-countdown></span>' : '',
    ].join('');

    const optionsHtml = options
      .map(function (option) {
        const leading = maxVotes > 0 && (Number(option.votes) || 0) === maxVotes;
        return (
          '<div class="poll-option is-disabled' +
          (leading ? ' is-leading' : '') +
          '">' +
          '<span class="bar" aria-hidden="true"></span>' +
          '<span class="poll-check" aria-hidden="true"></span>' +
          '<span class="poll-label">' +
          WY.esc(option.label) +
          (option.description ? '<small>' + WY.esc(option.description) + '</small>' : '') +
          '</span>' +
          '<span class="poll-pct">' +
          WY.pollPercent(poll, option) +
          '% · ' +
          WY.fmtNumber(Number(option.votes) || 0) +
          ' 票</span>' +
          '</div>'
        );
      })
      .join('');

    return (
      '<article class="poll admin-poll" data-poll-id="' +
      Number(poll.id) +
      '">' +
      '<div class="poll-head">' +
      '<h3>' +
      WY.esc(poll.title) +
      '</h3>' +
      '<span class="badge ' +
      (ended ? 'badge-muted' : 'badge-green') +
      '">' +
      (ended ? '已结束' : '进行中') +
      '</span>' +
      '</div>' +
      (poll.description ? '<p class="poll-desc">' + WY.esc(poll.description) + '</p>' : '') +
      '<p class="poll-meta">' +
      meta +
      '</p>' +
      '<div class="poll-options">' +
      (optionsHtml || emptyHtml('这个投票还没有选项', '', '✧')) +
      '</div>' +
      '<div class="admin-poll-actions">' +
      '<button class="btn btn-sm btn-ghost" type="button" data-poll-action="edit">编辑</button>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-poll-action="options"' +
      (ballots > 0 ? ' disabled' : '') +
      '>修改选项</button>' +
      '<button class="btn btn-sm btn-danger" type="button" data-poll-action="delete">删除</button>' +
      '</div>' +
      (ballots > 0
        ? '<p class="admin-poll-note"><span class="dot"></span>已有投票，不能修改选项</p>'
        : '') +
      '</article>'
    );
  }

  async function loadPolls() {
    if (!state.me || state.polls.loading) return;
    state.polls.loading = true;
    state.polls.error = '';
    els.pollList.innerHTML =
      '<div class="skeleton skeleton-poll"></div><div class="skeleton skeleton-poll"></div>';

    try {
      const data = await adminApi('/api/admin/polls');
      if (!state.me) return;
      state.polls.items = Array.isArray(data.items) ? data.items : [];
      state.polls.loaded = true;
      state.polls.loading = false;
      renderPolls();
    } catch (error) {
      state.polls.loading = false;
      if (error && error.handled) return;
      state.polls.error = (error && error.message) || '投票列表加载失败';
      renderPollsError(state.polls.error);
      WY.toast(state.polls.error, 'error');
    }
  }

  function renderPollsError(message) {
    els.pollList.innerHTML =
      '<div class="empty">' +
      '<span class="empty-icon" aria-hidden="true">⚠</span>' +
      '<strong>投票列表加载失败</strong>' +
      '<span class="small">' +
      WY.esc(message) +
      '</span>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-retry-polls>重新加载</button>' +
      '</div>';
  }

  function renderPolls() {
    const items = state.polls.items;
    if (!items.length) {
      els.pollList.innerHTML = emptyHtml(
        '还没有投票',
        '点击右上角「新建投票」创建第一场投票。',
        '◷',
      );
      return;
    }

    els.pollList.innerHTML = items.map(pollCardHtml).join('');
    const cards = $$('.admin-poll', els.pollList);
    cards.forEach(function (card, index) {
      const poll = items[index];
      if (!poll) return;
      const countdown = $('[data-countdown]', card);
      if (countdown && poll.endsAt) {
        WY.countdown(countdown, Number(poll.endsAt), { endedText: '已结束' });
      }
      $$('.poll-option', card).forEach(function (optionEl, optionIndex) {
        const option = (poll.options || [])[optionIndex];
        const bar = $('.bar', optionEl);
        if (!bar || !option) return;
        const percent = Math.max(0, Math.min(100, WY.pollPercent(poll, option)));
        bar.style.width = percent + '%';
      });
    });
  }

  function findPollFromNode(node) {
    const card = node.closest('[data-poll-id]');
    if (!card) return null;
    const id = Number(card.dataset.pollId);
    return (
      state.polls.items.find(function (poll) {
        return Number(poll.id) === id;
      }) || null
    );
  }

  function optionRowHtml(option) {
    const value = option || {};
    return (
      '<div class="admin-option-row">' +
      '<span class="admin-option-index" aria-hidden="true"></span>' +
      '<input class="input" type="text" maxlength="30" data-option-label placeholder="选项文字（≤30）" value="' +
      WY.esc(value.label || '') +
      '" aria-label="选项文字">' +
      '<input class="input" type="text" maxlength="80" data-option-desc placeholder="补充说明（可选，≤80）" value="' +
      WY.esc(value.description || '') +
      '" aria-label="选项说明">' +
      '<button class="btn btn-ghost" type="button" data-option-remove aria-label="删除这个选项">×</button>' +
      '</div>'
    );
  }

  function optionEditorHtml(options) {
    const rows = (options && options.length ? options : [{ label: '', description: '' }, { label: '', description: '' }])
      .map(optionRowHtml)
      .join('');
    return (
      '<div class="admin-option-editor">' +
      '<div class="admin-option-editor-head"><strong>选项</strong><span class="muted-2 small">2 - 8 个，选项文字不超过 30 字</span></div>' +
      '<div class="admin-option-rows" data-option-rows>' +
      rows +
      '</div>' +
      '<button class="btn btn-sm btn-ghost" type="button" data-add-option>+ 添加选项</button>' +
      '</div>'
    );
  }

  function wireOptionEditor(editor) {
    const rows = editor.querySelector('[data-option-rows]');
    const addButton = editor.querySelector('[data-add-option]');

    function refresh() {
      const rowNodes = Array.from(rows.children);
      rowNodes.forEach(function (row, index) {
        const indexEl = row.querySelector('.admin-option-index');
        if (indexEl) indexEl.textContent = String(index + 1).padStart(2, '0');
        const remove = row.querySelector('[data-option-remove]');
        if (remove) remove.disabled = rowNodes.length <= 2;
      });
      if (addButton) addButton.disabled = rowNodes.length >= 8;
    }

    if (addButton) {
      addButton.addEventListener('click', function () {
        if (rows.children.length >= 8) return;
        rows.insertAdjacentHTML('beforeend', optionRowHtml(null));
        refresh();
        const added = rows.lastElementChild;
        if (added) {
          const input = added.querySelector('[data-option-label]');
          if (input) input.focus();
        }
      });
    }

    rows.addEventListener('click', function (event) {
      const remove = event.target.closest('[data-option-remove]');
      if (!remove) return;
      if (rows.children.length <= 2) return;
      const row = remove.closest('.admin-option-row');
      if (row) row.remove();
      refresh();
    });

    refresh();
    return { rows: rows, refresh: refresh };
  }

  function readOptionRows(rowsEl) {
    return $$('.admin-option-row', rowsEl).map(function (row) {
      return {
        label: row.querySelector('[data-option-label]').value.trim(),
        description: row.querySelector('[data-option-desc]').value.trim(),
      };
    });
  }

  function validateOptions(options) {
    if (options.length < 2 || options.length > 8) return '选项数量需要在 2 - 8 个之间。';
    const labels = new Set();
    for (const option of options) {
      if (!option.label) return '每个选项都需要填写文字。';
      if (option.label.length > 30) return '选项文字不能超过 30 个字。';
      if (option.description.length > 80) return '选项说明不能超过 80 个字。';
      if (labels.has(option.label)) return '选项文字不能重复。';
      labels.add(option.label);
    }
    return '';
  }

  function parseEndsInput(input) {
    if (!input.value) return { ts: null, error: '' };
    const ts = parseLocalDateTime(input.value);
    if (!Number.isFinite(ts)) return { ts: null, error: '结束时间格式不正确。' };
    return { ts: ts, error: '' };
  }

  function validateEndsRange(ts) {
    if (ts == null) return '';
    const now = Date.now();
    if (ts <= now + 5 * 60 * 1000) return '结束时间至少要设置在 5 分钟之后。';
    if (ts > now + 366 * 86400 * 1000) return '结束时间不能超过 366 天。';
    return '';
  }

  function openPollDialog(poll) {
    const isEdit = Boolean(poll && poll.id);
    const ballots = Number(poll && poll.totalBallots) || 0;
    const initialOptions = isEdit
      ? []
      : [{ label: '', description: '' }, { label: '', description: '' }];
    const endsValue = isEdit && poll.endsAt ? toDateTimeLocal(poll.endsAt) : '';

    const body =
      '<form id="poll-form" class="admin-poll-form" novalidate>' +
      '<div class="field">' +
      '<label for="poll-title">投票标题 <span class="admin-char-count" id="poll-title-count">0 / 60</span></label>' +
      '<input class="input" id="poll-title" maxlength="60" required value="' +
      WY.esc(isEdit ? poll.title : '') +
      '" placeholder="例如：下一位复刻的星神，你选谁？">' +
      '</div>' +
      '<div class="field">' +
      '<label for="poll-desc">投票说明 <span class="admin-char-count" id="poll-desc-count">0 / 300</span></label>' +
      '<textarea class="textarea" id="poll-desc" maxlength="300" rows="3" placeholder="说明这次投票的背景、范围和规则。">' +
      WY.esc(isEdit ? poll.description || '' : '') +
      '</textarea>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field">' +
      '<label for="poll-ends">结束时间（UTC+8）</label>' +
      '<input class="input" id="poll-ends" type="datetime-local" step="60" value="' +
      WY.esc(endsValue) +
      '">' +
      '<p class="hint">留空表示长期开放；需在 5 分钟之后、366 天以内。</p>' +
      '</div>' +
      '<div class="field">' +
      '<label>投票方式</label>' +
      '<label class="check"><input type="checkbox" id="poll-multiple"' +
      (isEdit && poll.allowMultiple ? ' checked' : '') +
      '> 允许多选</label>' +
      (isEdit && ballots > 0 ? '<p class="hint">已有投票，不能修改投票方式。</p>' : '') +
      '</div>' +
      '</div>' +
      (isEdit
        ? '<div class="field">' +
          '<label for="poll-status">状态</label>' +
          '<select class="select" id="poll-status">' +
          '<option value="open"' +
          (poll.status === 'open' ? ' selected' : '') +
          '>进行中</option>' +
          '<option value="closed"' +
          (poll.status === 'closed' ? ' selected' : '') +
          '>已结束</option>' +
          '</select>' +
          '</div>' +
          '<p class="admin-form-note">选项请在列表的「修改选项」中调整' +
          (ballots > 0 ? '；已有投票，不能修改选项' : '') +
          '。</p>'
        : optionEditorHtml(initialOptions)) +
      '<p class="admin-form-error" data-form-error role="alert"></p>' +
      '</form>';

    const dialog = openDialog({
      title: isEdit ? '编辑投票' : '新建投票',
      subtitle: isEdit ? poll.title : '选项 2 - 8 个，创建后仍可在 0 票时修改',
      wide: true,
      body: body,
      footer:
        '<div class="admin-dialog-actions">' +
        '<button class="btn btn-ghost" type="button" data-cancel>取消</button>' +
        '<button class="btn btn-primary" type="submit" form="poll-form" data-save>' +
        (isEdit ? '保存修改' : '创建投票') +
        '</button>' +
        '</div>',
    });

    const form = dialog.body.querySelector('#poll-form');
    const titleInput = form.querySelector('#poll-title');
    const descInput = form.querySelector('#poll-desc');
    const endsInput = form.querySelector('#poll-ends');
    const multipleInput = form.querySelector('#poll-multiple');
    const statusSelect = form.querySelector('#poll-status');
    const errorBox = form.querySelector('[data-form-error]');
    const saveButton = dialog.footer.querySelector('[data-save]');
    const titleCount = form.querySelector('#poll-title-count');
    const descCount = form.querySelector('#poll-desc-count');

    if (isEdit && ballots > 0) multipleInput.disabled = true;

    function syncCounts() {
      titleCount.textContent = titleInput.value.length + ' / 60';
      descCount.textContent = descInput.value.length + ' / 300';
    }
    titleInput.addEventListener('input', syncCounts);
    descInput.addEventListener('input', syncCounts);
    syncCounts();

    let editor = null;
    if (!isEdit) {
      editor = wireOptionEditor(form.querySelector('.admin-option-editor'));
    }

    dialog.footer.querySelector('[data-cancel]').addEventListener('click', function () {
      dialog.close();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      errorBox.textContent = '';

      const title = titleInput.value.trim();
      const description = descInput.value.trim();
      if (title.length < 4 || title.length > 60) {
        errorBox.textContent = '标题需要 4 - 60 个字。';
        titleInput.focus();
        return;
      }
      if (description.length > 300) {
        errorBox.textContent = '投票说明不能超过 300 字。';
        descInput.focus();
        return;
      }

      const parsedEnds = parseEndsInput(endsInput);
      if (parsedEnds.error) {
        errorBox.textContent = parsedEnds.error;
        endsInput.focus();
        return;
      }
      const originalEnds = isEdit && poll.endsAt != null ? Number(poll.endsAt) : null;
      if (!isEdit || parsedEnds.ts !== originalEnds) {
        const rangeError = validateEndsRange(parsedEnds.ts);
        if (rangeError) {
          errorBox.textContent = rangeError;
          endsInput.focus();
          return;
        }
      }

      let options = [];
      if (!isEdit) {
        options = readOptionRows(editor.rows);
        const optionError = validateOptions(options);
        if (optionError) {
          errorBox.textContent = optionError;
          return;
        }
      }

      setButtonBusy(saveButton, true, '保存中…');
      try {
        if (isEdit) {
          const patch = {};
          if (title !== (poll.title || '')) patch.title = title;
          if (description !== (poll.description || '')) patch.description = description;
          if (statusSelect && statusSelect.value !== poll.status) patch.status = statusSelect.value;
          if (!(ballots > 0) && multipleInput.checked !== Boolean(poll.allowMultiple)) {
            patch.allowMultiple = multipleInput.checked;
          }
          const endsTs = parsedEnds.ts;
          if (endsTs !== originalEnds) patch.endsAt = endsTs;
          if (!Object.keys(patch).length) {
            errorBox.textContent = '没有要修改的内容。';
            return;
          }
          await adminApi('/api/admin/polls/' + Number(poll.id), { method: 'PATCH', body: patch });
          WY.toast('投票已更新', 'success');
        } else {
          await adminApi('/api/admin/polls', {
            method: 'POST',
            body: {
              title: title,
              description: description,
              endsAt: parsedEnds.ts,
              allowMultiple: multipleInput.checked,
              options: options,
            },
          });
          WY.toast('投票已创建', 'success');
        }
        dialog.close();
        state.overviewStale = true;
        state.polls.loaded = false;
        await loadPolls();
      } catch (error) {
        if (error && error.handled) return;
        errorBox.textContent = (error && error.message) || '保存失败，请稍后重试。';
      } finally {
        if (saveButton.isConnected) setButtonBusy(saveButton, false);
      }
    });
  }

  function openOptionsDialog(poll) {
    const ballots = Number(poll.totalBallots) || 0;
    if (ballots > 0) {
      WY.toast('已有投票，不能修改选项', 'error');
      return;
    }

    const dialog = openDialog({
      title: '修改投票选项',
      subtitle: poll.title,
      wide: true,
      body:
        '<form id="options-form" novalidate>' +
        optionEditorHtml(poll.options || []) +
        '<p class="admin-form-note">只有在还没有人投票时才能调整选项。修改不会影响投票结果。</p>' +
        '<p class="admin-form-error" data-form-error role="alert"></p>' +
        '</form>',
      footer:
        '<div class="admin-dialog-actions">' +
        '<button class="btn btn-ghost" type="button" data-cancel>取消</button>' +
        '<button class="btn btn-primary" type="submit" form="options-form" data-save>保存选项</button>' +
        '</div>',
    });

    const form = dialog.body.querySelector('#options-form');
    const editor = wireOptionEditor(form.querySelector('.admin-option-editor'));
    const errorBox = form.querySelector('[data-form-error]');
    const saveButton = dialog.footer.querySelector('[data-save]');

    dialog.footer.querySelector('[data-cancel]').addEventListener('click', function () {
      dialog.close();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      errorBox.textContent = '';
      const options = readOptionRows(editor.rows);
      const optionError = validateOptions(options);
      if (optionError) {
        errorBox.textContent = optionError;
        return;
      }

      setButtonBusy(saveButton, true, '保存中…');
      try {
        await adminApi('/api/admin/polls/' + Number(poll.id) + '/options', {
          method: 'PUT',
          body: { options: options },
        });
        WY.toast('投票选项已更新', 'success');
        dialog.close();
        state.overviewStale = true;
        state.polls.loaded = false;
        await loadPolls();
      } catch (error) {
        if (error && error.handled) return;
        errorBox.textContent = (error && error.message) || '保存失败，请稍后重试。';
      } finally {
        if (saveButton.isConnected) setButtonBusy(saveButton, false);
      }
    });
  }

  async function deletePoll(poll, button) {
    if (button.disabled) return;
    const ballots = Number(poll.totalBallots) || 0;
    const ok = await confirmDialog({
      title: '删除这场投票？',
      message:
        '将永久删除投票「' +
        poll.title +
        '」' +
        (ballots ? '及其 ' + ballots + ' 人的投票记录' : '') +
        '，无法恢复。',
      okText: '永久删除',
      danger: true,
    });
    if (!ok || !state.me) return;

    setButtonBusy(button, true);
    try {
      await adminApi('/api/admin/polls/' + Number(poll.id), { method: 'DELETE' });
      if (!state.me) return;
      state.polls.items = state.polls.items.filter(function (entry) {
        return Number(entry.id) !== Number(poll.id);
      });
      state.overviewStale = true;
      WY.toast('投票已删除', 'success');
      renderPolls();
    } catch (error) {
      if (!error.handled) WY.toast((error && error.message) || '删除失败，请稍后重试', 'error');
    } finally {
      if (button.isConnected) setButtonBusy(button, false);
    }
  }

  function onPollListClick(event) {
    if (event.target.closest('[data-retry-polls]')) {
      loadPolls();
      return;
    }
    const button = event.target.closest('button[data-poll-action]');
    if (!button || button.disabled) return;
    const poll = findPollFromNode(button);
    if (!poll) return;
    const action = button.dataset.pollAction;
    if (action === 'edit') openPollDialog(poll);
    else if (action === 'options') openOptionsDialog(poll);
    else if (action === 'delete') deletePoll(poll, button);
  }

  /* ---------------- settings ---------------- */

  function updateAnnouncementCount() {
    els.announcementCount.textContent = els.announcement.value.length + ' / 300';
  }

  function renderSettings() {
    if (!state.settingsDirty) {
      els.announcement.value =
        state.overview && typeof state.overview.announcement === 'string'
          ? state.overview.announcement
          : '';
      updateAnnouncementCount();
    }
  }

  async function saveAnnouncement(event) {
    event.preventDefault();
    if (!state.me) return;
    const value = els.announcement.value.trim();
    if (value.length > 300) {
      els.announcementError.textContent = '公告不能超过 300 字。';
      return;
    }

    els.announcementError.textContent = '';
    setButtonBusy(els.announcementSave, true, '保存中…');
    try {
      const data = await adminApi('/api/admin/settings', {
        method: 'PATCH',
        body: { announcement: value },
      });
      const announcement = data && typeof data.announcement === 'string' ? data.announcement : value;
      if (state.overview) state.overview.announcement = announcement;
      els.announcement.value = announcement;
      state.settingsDirty = false;
      updateAnnouncementCount();
      $$('[data-announcement]').forEach(function (node) {
        node.textContent = announcement || DEFAULT_ANNOUNCEMENT;
      });
      WY.toast('公告已更新', 'success');
    } catch (error) {
      if (!error.handled) {
        els.announcementError.textContent = (error && error.message) || '保存失败，请稍后重试。';
      }
    } finally {
      setButtonBusy(els.announcementSave, false);
    }
  }

  async function saveAdminCode(event) {
    event.preventDefault();
    if (!state.me) return;

    const current = els.codeCurrent.value;
    const next = els.codeNext.value;
    const next2 = els.codeNext2.value;
    els.codeError.textContent = '';

    if (!current) {
      els.codeError.textContent = '请输入当前管理码。';
      els.codeCurrent.focus();
      return;
    }
    if (next.length < 10 || next.length > 64) {
      els.codeError.textContent = '新管理码需要 10 - 64 个字符。';
      els.codeNext.focus();
      return;
    }
    if (next !== next2) {
      els.codeError.textContent = '两次输入的新管理码不一致。';
      els.codeNext2.focus();
      return;
    }
    if (next === current) {
      els.codeError.textContent = '新管理码不能和当前管理码相同。';
      els.codeNext.focus();
      return;
    }

    const ok = await confirmDialog({
      title: '确认修改管理码？',
      message:
        '修改后所有已登录会话（包括当前设备）都会立即失效，需要用新管理码重新登录。请确认新管理码已经妥善保存。',
      okText: '确认修改',
      danger: true,
    });
    if (!ok || !state.me) return;

    setButtonBusy(els.codeSave, true, '修改中…');
    try {
      const r = await WY.api('/api/admin/code', {
        method: 'POST',
        body: { current: current, next: next },
      });
      els.codeForm.reset();
      if (r && r.relogin === false) {
        // 主设备 stays signed in; every other device was signed out.
        WY.toast('管理码已修改。其他设备都已退出，主设备保持登录。', 'success');
      } else {
        showAuth('管理码已修改，请用新管理码重新登录。', 'info');
        WY.toast('管理码已修改，请重新登录', 'success');
      }
    } catch (error) {
      if (error && error.status === 401 && error.code === 'invalid_code') {
        els.codeError.textContent = '当前管理码不正确。';
      } else if (error && error.status === 401) {
        expireSession();
      } else {
        els.codeError.textContent = (error && error.message) || '修改失败，请稍后重试。';
      }
    } finally {
      setButtonBusy(els.codeSave, false);
    }
  }

  /* ---------------- dialogs ---------------- */

  function openDialog(options) {
    const opts = options || {};
    const originalOnClose = opts.onClose;
    let dialog = null;
    dialog = WY.dialog({
      title: opts.title,
      subtitle: opts.subtitle,
      body: opts.body,
      footer: opts.footer,
      wide: opts.wide,
      onClose: function (result) {
        if (dialog) state.dialogs.delete(dialog);
        if (typeof originalOnClose === 'function') originalOnClose(result);
      },
    });
    state.dialogs.add(dialog);
    return dialog;
  }

  function closeDialogs() {
    Array.from(state.dialogs).forEach(function (dialog) {
      try {
        dialog.close();
      } catch (error) {
        /* 关闭失败时下面统一清理残留遮罩 */
      }
    });
    state.dialogs.clear();
    $$('.modal-backdrop').forEach(function (node) {
      node.remove();
    });
  }

  function confirmDialog(options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      let settled = false;
      const dialog = openDialog({
        title: opts.title || '确认操作',
        body: '<p class="muted dialog-text">' + WY.esc(opts.message || '') + '</p>',
        footer:
          '<div class="admin-dialog-actions">' +
          '<button class="btn btn-ghost" type="button" data-cancel>' +
          WY.esc(opts.cancelText || '取消') +
          '</button>' +
          '<button class="btn ' +
          (opts.danger ? 'btn-danger' : 'btn-primary') +
          '" type="button" data-ok>' +
          WY.esc(opts.okText || '确定') +
          '</button>' +
          '</div>',
        onClose: function () {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      });

      function settle(value) {
        if (settled) return;
        settled = true;
        resolve(value);
        dialog.close();
      }

      dialog.footer.querySelector('[data-cancel]').addEventListener('click', function () {
        settle(false);
      });
      dialog.footer.querySelector('[data-ok]').addEventListener('click', function () {
        settle(true);
      });
    });
  }

  /* ---------------- CSV export ---------------- */

  async function exportCsv() {
    if (!state.me || els.exportBtn.disabled) return;
    setButtonBusy(els.exportBtn, true, '导出中…');
    try {
      const response = await fetch('/api/admin/export.csv', { credentials: 'same-origin' });
      if (response.status === 401) {
        expireSession();
        return;
      }
      if (!response.ok) {
        let message = '导出失败（' + response.status + '）';
        try {
          const data = await response.json();
          if (data && data.error && data.error.message) message = data.error.message;
        } catch (error) {
          /* 非 JSON 错误响应，使用默认文案 */
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const matched = /filename="?([^";]+)"?/i.exec(disposition);
      const filename = matched ? matched[1] : 'wuye-ideas-' + todayStamp() + '.csv';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);
      WY.toast('CSV 已开始下载', 'success');
    } catch (error) {
      if (!state.me) return;
      WY.toast((error && error.message) || '导出失败，请稍后重试', 'error');
    } finally {
      setButtonBusy(els.exportBtn, false);
    }
  }

  /* ---------------- DOM cache / clear ---------------- */

  function cacheEls() {
    els = {
      authView: $('#auth-view'),
      adminBoot: $('#admin-boot'),
      adminView: $('#admin-view'),
      loginForm: $('#login-form'),
      loginCode: $('#login-code'),
      loginError: $('#login-error'),
      loginSubmit: $('#login-submit'),
      sessionExpires: $('#session-expires'),
      sessionLeft: $('#session-left'),
      mustChange: $('#must-change'),
      gotoSettings: $('#goto-settings'),
      exportBtn: $('#export-btn'),
      logoutBtn: $('#logout-btn'),
      tabs: $('.admin-tabs'),
      statIdeas: $('#stat-ideas'),
      statVotes: $('#stat-votes'),
      statOpenPolls: $('#stat-open-polls'),
      statToday: $('#stat-today'),
      pendingTotal: $('#pending-total'),
      pendingList: $('#pending-list'),
      refreshOverview: $('#refresh-overview'),
      auditList: $('#audit-list'),
      ideaSearch: $('#idea-search'),
      ideaStatus: $('#idea-status'),
      ideaReset: $('#idea-reset'),
      ideaMeta: $('#idea-meta'),
      ideaTbody: $('#idea-tbody'),
      ideaPagination: $('#idea-pagination'),
      ideaTableWrap: $('#idea-table-wrap'),
      pollCreate: $('#poll-create'),
      pollList: $('#poll-list'),
      announcementForm: $('#announcement-form'),
      announcement: $('#announcement'),
      announcementCount: $('#announcement-count'),
      announcementError: $('#announcement-error'),
      announcementSave: $('#announcement-save'),
      codeForm: $('#code-form'),
      codeCurrent: $('#code-current'),
      codeNext: $('#code-next'),
      codeNext2: $('#code-next2'),
      codeError: $('#code-error'),
      codeSave: $('#code-save'),
    };
  }

  function clearAdminDom() {
    els.statIdeas.textContent = '—';
    els.statVotes.textContent = '—';
    els.statOpenPolls.textContent = '—';
    els.statToday.textContent = '—';
    els.pendingTotal.textContent = '—';
    els.pendingList.innerHTML = '';
    els.auditList.innerHTML = '';
    els.ideaSearch.value = '';
    els.ideaStatus.value = '';
    els.ideaMeta.textContent = '—';
    els.ideaTbody.innerHTML = '';
    els.ideaPagination.innerHTML = '';
    els.pollList.innerHTML = '';
    els.announcement.value = '';
    els.announcementCount.textContent = '0 / 300';
    els.announcementError.textContent = '';
    els.codeForm.reset();
    els.codeError.textContent = '';
    els.mustChange.hidden = true;
    els.sessionExpires.textContent = '—';
    els.sessionLeft.textContent = '';
    setButtonBusy(els.exportBtn, false);
    setButtonBusy(els.logoutBtn, false);
    setButtonBusy(els.announcementSave, false);
    setButtonBusy(els.codeSave, false);
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    els.loginForm.addEventListener('submit', onLoginSubmit);
    els.logoutBtn.addEventListener('click', logout);
    els.exportBtn.addEventListener('click', exportCsv);
    els.gotoSettings.addEventListener('click', function () {
      switchTab('settings');
    });
    els.refreshOverview.addEventListener('click', function () {
      loadOverview({ manual: true });
    });

    els.tabs.addEventListener('click', function (event) {
      const tab = event.target.closest('.tab[data-tab]');
      if (tab) switchTab(tab.dataset.tab);
    });
    els.tabs.addEventListener('keydown', onTabKeydown);

    els.pendingList.addEventListener('click', async function (event) {
      const quick = event.target.closest('[data-approve],[data-reject]');
      if (quick) {
        const approve = quick.hasAttribute('data-approve');
        const qid = Number(approve ? quick.dataset.approve : quick.dataset.reject);
        quick.disabled = true;
        try {
          await adminApi('/api/admin/ideas/' + qid, { method: 'PATCH', body: approve ? { status: 'open' } : { hidden: true } });
          WY.toast(approve ? '已通过，大家现在可以投票了' : '已拒绝（已隐藏）', 'success');
          state.ideas.loaded = false;
          loadOverview();
        } catch (err) {
          quick.disabled = false;
          WY.toast(err.message, 'error');
        }
        return;
      }
      const button = event.target.closest('[data-review]');
      if (!button) return;
      const id = Number(button.dataset.review);
      state.ideas.q = '';
      state.ideas.status = 'pending';
      state.ideas.page = 1;
      state.ideas.loaded = false;
      els.ideaSearch.value = '';
      els.ideaStatus.value = 'pending';
      switchTab('ideas', { load: false });
      loadIdeas({ highlightId: id });
    });

    els.ideaTbody.addEventListener('click', onIdeaTableClick);
    els.ideaTbody.addEventListener('change', function (event) {
      const select = event.target.closest('select[data-idea-action="status"]');
      if (select) changeIdeaStatus(select);
    });

    const debouncedSearch = WY.debounce(function () {
      if (!state.me) return;
      const q = els.ideaSearch.value.trim().slice(0, 30);
      if (q === state.ideas.q && state.ideas.loaded) return;
      state.ideas.q = q;
      onIdeaFiltersChange();
    }, 320);
    els.ideaSearch.addEventListener('input', debouncedSearch);
    els.ideaSearch.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const q = els.ideaSearch.value.trim().slice(0, 30);
      if (q === state.ideas.q && state.ideas.loaded) return;
      state.ideas.q = q;
      onIdeaFiltersChange();
    });
    els.ideaStatus.addEventListener('change', function () {
      state.ideas.status = els.ideaStatus.value;
      onIdeaFiltersChange();
    });
    els.ideaReset.addEventListener('click', resetIdeaFilters);

    els.ideaPagination.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-page]');
      if (!button || button.disabled) return;
      const page = Number(button.dataset.page);
      if (!Number.isInteger(page) || page < 1 || page === state.ideas.page) return;
      state.ideas.page = page;
      loadIdeas();
      if (els.ideaTableWrap && typeof els.ideaTableWrap.scrollIntoView === 'function') {
        els.ideaTableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    els.pollCreate.addEventListener('click', function () {
      if (state.me) openPollDialog(null);
    });
    els.pollList.addEventListener('click', onPollListClick);

    els.announcement.addEventListener('input', function () {
      state.settingsDirty = true;
      updateAnnouncementCount();
      els.announcementError.textContent = '';
    });
    els.announcementForm.addEventListener('submit', saveAnnouncement);
    els.codeForm.addEventListener('submit', saveAdminCode);
  }

  /* ---------------- boot ---------------- */

  async function init() {
    cacheEls();
    bindEvents();
    try {
      const me = await WY.api('/api/admin/me');
      els.adminBoot.hidden = true;
      if (me && me.authed) {
        await enterAdmin(me);
      } else {
        showAuth();
      }
    } catch (error) {
      els.adminBoot.hidden = true;
      showAuth();
      setLoginError('无法连接服务器，请检查网络后重试。');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
