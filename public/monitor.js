/* 安全监控 (/admin/monitor): unlock with the 监控口令, then the visitor list with a 展开 timeline per visitor. */
(function () {
  'use strict';
  const WY = window.WY;
  const $ = (id) => document.getElementById(id);
  if (!WY || !$('mon-view')) return;

  const KIND = { page: '页面', action: '操作', download: '下载', login: '登录', admin: '后台', security: '安全' };
  const FLAG = {
    login_failed: '登录失败',
    denied: '未授权访问',
    rate_limited: '被限流',
    burst: '请求过于频繁',
    probe: '可疑路径探测',
    ip_change: 'IP 变化',
  };
  const state = { filter: {}, page: 1, until: 0, timer: 0 };

  const fmt = (ms, withDate = true) =>
    new Date(ms).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour12: false,
      ...(withDate ? { year: 'numeric', month: '2-digit', day: '2-digit' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      second: withDate ? undefined : '2-digit',
    });
  const dayOf = (ms) => new Date(ms).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

  function show(which) {
    $('mon-boot').hidden = true;
    $('mon-lock').hidden = which !== 'lock';
    $('mon-view').hidden = which !== 'view';
  }

  async function api(url, opts) {
    try {
      return await WY.api(url, opts);
    } catch (e) {
      if (e.status === 401 || e.code === 'monitor_locked') {
        lockedView(true);
        throw e;
      }
      throw e;
    }
  }

  /* ---------------- lock / unlock ---------------- */

  function lockedView(configured) {
    clearInterval(state.timer);
    show('lock');
    $('mon-unlock').hidden = !configured;
    $('mon-unset').hidden = configured;
    if (configured) $('mon-code').focus();
  }

  $('mon-unlock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('mon-code');
    const btn = e.target.querySelector('button');
    $('mon-error').textContent = '';
    btn.disabled = true;
    try {
      const r = await WY.api('/api/monitor/unlock', { method: 'POST', body: { code: input.value } });
      input.value = '';
      state.until = r.expiresAt;
      openView();
    } catch (err) {
      $('mon-error').textContent = err.message || '解锁失败';
      input.select();
    } finally {
      btn.disabled = false;
    }
  });

  $('mon-lock-btn').addEventListener('click', async () => {
    try {
      await WY.api('/api/monitor/lock', { method: 'POST' });
    } catch {}
    lockedView(true);
  });

  function tick() {
    const left = state.until - Date.now();
    if (left <= 0) {
      lockedView(true);
      return;
    }
    $('mon-left').textContent = `${Math.floor(left / 60000)} 分 ${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} 秒后`;
  }

  /* ---------------- dashboard ---------------- */

  async function openView() {
    show('view');
    if (!state.until) state.until = Date.now() + 30 * 60000;
    clearInterval(state.timer);
    state.timer = setInterval(tick, 1000);
    tick();
    loadSummary();
    loadList();
  }

  async function loadSummary() {
    try {
      const s = await api('/api/monitor/summary');
      $('mon-keep').textContent = s.retentionDays;
      const m = [
        [s.subjects24h, '近 24 小时访客'],
        [s.loginFailed, '登录失败'],
        [s.denied, '未授权访问'],
        [s.rateLimited + s.bursts, '高频 / 限流'],
        [s.probes, '可疑路径探测'],
        [s.ipChanges, 'IP 变化'],
      ];
      $('mon-metrics').innerHTML = m
        .map(([n, label], i) => `<div class="metric${i && n ? ' is-warn' : ''}"><b>${n}</b><span>${label}</span></div>`)
        .join('');
    } catch {}
  }

  function rowHtml(u) {
    const who = u.isAdmin ? '<span class="badge badge-gold">站长</span>' : u.name ? `<span class="badge badge-green">${WY.esc(u.name)}</span>` : u.anonymous ? '<span class="badge badge-muted">无 Cookie</span>' : '<span class="badge badge-muted">匿名访客</span>';
    const warn = u.flags ? `<span class="badge badge-rose" title="只是线索，不代表一定有恶意">⚠ ${u.flags} 条提示</span>` : '';
    return `<li class="mon-row" data-id="${u.id}">
      <div class="mon-row-main">
        <div class="mon-who"><b class="mono">#${u.id}</b><span class="mon-note${u.note ? '' : ' is-empty'}">${u.note ? WY.esc(u.note) : '未命名'}</span><button class="vb-pen mon-note-edit" type="button" data-note="${u.id}" aria-label="给这个访客起昵称" title="起个昵称（只有你能看到）">✎</button>${who}${warn}<span class="muted small">${WY.esc(u.device)}</span></div>
        <dl class="mon-facts">
          <div><dt>IP</dt><dd class="mono">${WY.esc(u.ip)}${u.ipCount > 1 ? ` <span class="muted small">（共 ${u.ipCount} 个）</span>` : ''}</dd></div>
          <div><dt>首次</dt><dd>${fmt(u.firstSeen)}</dd></div>
          <div><dt>最近</dt><dd>${fmt(u.lastSeen)}</dd></div>
          <div><dt>访问</dt><dd>${u.visits} 次 · ${u.events} 条记录</dd></div>
        </dl>
        <button class="btn btn-ghost btn-sm mon-toggle" type="button" aria-expanded="false" aria-controls="mon-tl-${u.id}">▼ 展开活动记录</button>
      </div>
      <div class="mon-timeline" id="mon-tl-${u.id}" hidden></div>
    </li>`;
  }

  async function loadList() {
    const params = new URLSearchParams({ page: String(state.page) });
    for (const [k, v] of Object.entries(state.filter)) if (v) params.set(k, v);
    const list = $('mon-list');
    list.innerHTML = '<li class="skeleton skeleton-row"></li><li class="skeleton skeleton-row"></li>';
    let data;
    try {
      data = await api(`/api/monitor/subjects?${params}`);
    } catch (e) {
      list.innerHTML = `<li class="empty">${WY.esc(e.message || '加载失败')}</li>`;
      return;
    }
    $('mon-total').textContent = `${data.total} 位`;
    list.innerHTML = data.items.length ? data.items.map(rowHtml).join('') : '<li class="empty">没有符合条件的记录。</li>';
    const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
    $('mon-pager').innerHTML =
      pages > 1
        ? `<button class="btn btn-ghost btn-sm" type="button" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>上一页</button><span class="muted small">${state.page} / ${pages}</span><button class="btn btn-ghost btn-sm" type="button" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>下一页</button>`
        : '';
  }

  function timelineHtml(d, id) {
    const ips = d.ips
      .map((x) => `<li><span class="badge badge-cyan">${x.tag}</span><b class="mono">${WY.esc(x.ip)}</b><span class="muted small">${fmt(x.firstSeen)} → ${fmt(x.lastSeen)}</span></li>`)
      .join('');
    let lastDay = '';
    const items = d.events
      .map((e) => {
        const day = dayOf(e.at);
        const head = day !== lastDay ? `<li class="mon-day">${day}</li>` : '';
        lastDay = day;
        const flag = e.flag ? `<span class="badge badge-rose">⚠ ${FLAG[e.flag] || e.flag}</span>` : '';
        return `${head}<li class="mon-ev mon-ev-${e.kind}${e.flag ? ' is-flag' : ''}"><time>${fmt(e.at, false)}</time><span class="mon-kind">${KIND[e.kind] || e.kind}</span><span class="mon-label">${WY.esc(e.label)}</span>${flag}${d.ips.length > 1 && e.ipTag ? `<span class="muted small">${e.ipTag}</span>` : ''}</li>`;
      })
      .join('');
    return `<div class="mon-tl-ips"><h3>用过的 IP</h3><ul>${ips}</ul></div>
      <p class="muted small mon-ua">浏览器标识：<span class="mono">${WY.esc(d.userAgent || '—')}</span></p>
      <ol class="mon-events">${items || '<li class="empty">没有活动记录。</li>'}</ol>
      <div class="mon-tl-foot"><span class="muted small">只显示网站实际记录的事件（最近 300 条）。不记录任何表单内容。</span><button class="btn btn-danger btn-sm" type="button" data-delete="${id}">删除此访客的全部记录</button></div>`;
  }

  async function toggle(row, btn) {
    const box = row.querySelector('.mon-timeline');
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    btn.textContent = open ? '▼ 展开活动记录' : '▲ 收起';
    row.classList.toggle('is-open', !open);
    box.hidden = open;
    if (open || box.dataset.loaded) return;
    box.innerHTML = '<div class="skeleton skeleton-row"></div>';
    try {
      box.innerHTML = timelineHtml(await api(`/api/monitor/subjects/${row.dataset.id}`), row.dataset.id);
      box.dataset.loaded = '1';
    } catch (e) {
      box.innerHTML = `<p class="empty">${WY.esc(e.message || '加载失败')}</p>`;
    }
  }

  $('mon-list').addEventListener('click', async (e) => {
    const t = e.target.closest('.mon-toggle');
    if (t) {
      toggle(t.closest('.mon-row'), t);
      return;
    }
    const n = e.target.closest('[data-note]');
    if (n) {
      editNote(n.closest('.mon-row'));
      return;
    }
    const d = e.target.closest('[data-delete]');
    if (d) {
      const ok = await WY.confirm({ title: `删除访客 #${d.dataset.delete} 的记录？`, message: '这个访客的 IP、活动记录会全部删除，无法恢复。用于处理本人的删除请求。', okText: '删除', danger: true });
      if (!ok) return;
      try {
        await api(`/api/monitor/subjects/${d.dataset.delete}`, { method: 'DELETE' });
        WY.toast('已删除', 'success');
        loadList();
        loadSummary();
      } catch (err) {
        WY.toast(err.message, 'error');
      }
    }
  });

  async function editNote(row) {
    const span = row.querySelector('.mon-note');
    const current = span.classList.contains('is-empty') ? '' : span.textContent;
    const dlg = WY.dialog({
      title: `给访客 #${row.dataset.id} 起昵称`,
      body: `<div class="field"><label for="mon-note-in">昵称（只有你在这里能看到，可留空）</label><input class="input" id="mon-note-in" maxlength="40" placeholder="例如：刷票号A、我的手机"></div>`,
      footer: '<button class="btn btn-ghost" type="button" data-cancel>取消</button><button class="btn btn-primary" type="button" data-ok>保存</button>',
    });
    const input = dlg.body.querySelector('input');
    input.value = current;
    input.focus();
    const save = async () => {
      try {
        const r = await api(`/api/monitor/subjects/${row.dataset.id}`, { method: 'PATCH', body: { note: input.value } });
        span.textContent = r.note || '未命名';
        span.classList.toggle('is-empty', !r.note);
        dlg.close();
        WY.toast('已保存', 'success');
      } catch (err) {
        WY.toast(err.message, 'error');
      }
    };
    dlg.footer.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
    dlg.footer.querySelector('[data-ok]').addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
    });
  }

  $('mon-pager').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    loadList();
  });

  $('mon-filter').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.filter = { q: f.get('q').trim(), ip: f.get('ip').trim(), from: f.get('from'), to: f.get('to'), flagged: f.get('flagged') ? '1' : '' };
    state.page = 1;
    loadList();
  });
  $('mon-filter').addEventListener('reset', () => {
    state.filter = {};
    state.page = 1;
    setTimeout(loadList);
  });

  (async function boot() {
    try {
      const s = await WY.api('/api/monitor/status');
      if (s.unlocked) openView();
      else lockedView(s.configured);
    } catch {
      location.href = '/admin';
    }
  })();
})();
