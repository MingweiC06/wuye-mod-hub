/* 安全监控 (/admin/monitor): unlock with the 监控口令, then the visitor list with a 展开 timeline per visitor. */
(function () {
  'use strict';
  const WY = window.WY;
  const $ = (id) => document.getElementById(id);
  if (!WY || !$('mon-view')) return;

  const KIND = { click: '点击', page: '页面', action: '操作', download: '下载', login: '登录', admin: '后台', security: '安全' };
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

  /* ---------------- map ---------------- */
  let world = null;
  const W = 960;
  const H = 480;
  const px = (lon, lat) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

  function worldPaths(topo) {
    const [sx, sy] = topo.transform.scale;
    const [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map((arc) => {
      let x = 0;
      let y = 0;
      return arc.map(([dx, dy]) => {
        x += dx;
        y += dy;
        return px(x * sx + tx, y * sy + ty);
      });
    });
    const ring = (ids) => {
      const pts = [];
      for (const i of ids) {
        const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
        pts.push(...(pts.length ? a.slice(1) : a));
      }
      let d = '';
      let prev = null;
      for (const [x, y] of pts) {
        d += `${!prev || Math.abs(x - prev[0]) > W / 2 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        prev = [x, y];
      }
      return d + 'Z';
    };
    return topo.objects.countries.geometries
      .map((g) => (g.type === 'Polygon' ? g.arcs.map(ring).join('') : g.type === 'MultiPolygon' ? g.arcs.map((p) => p.map(ring).join('')).join('') : ''))
      .filter(Boolean)
      .map((d) => `<path d="${d}"/>`)
      .join('');
  }

  async function loadMap() {
    const box = $('mon-map');
    box.innerHTML = '<div class="skeleton skeleton-poll"></div>';
    try {
      if (!world) world = worldPaths(await (await fetch('/assets/world-110m.json', { credentials: 'same-origin' })).json());
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(state.filter)) if (v) params.set(k, v);
      const data = await api(`/api/monitor/map?${params}`);
      const max = Math.max(1, ...data.points.map((p) => p.count));
      const dots = data.points
        .map((p, i) => {
          const [x, y] = px(p.lon, p.lat);
          const r = (3 + Math.sqrt(p.count / max) * 9).toFixed(1);
          return `<circle class="mon-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" data-pt="${i}" tabindex="0"><title>${WY.esc(p.label)} · ${p.count} 位访客</title></circle>`;
        })
        .join('');
      box.innerHTML = `<svg class="mon-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="访客大致位置地图"><g class="mon-land">${world}</g>${dots}</svg>
        <p class="muted small">点是城市级估算位置（约 10 公里精度），同一地点合并为一个点，越大人越多。无法定位的 IP：${data.unknown} 个。地图由本站自己绘制，不向任何地图服务发送数据。</p>
        <div class="mon-map-info" id="mon-map-info">${data.points.length ? '点一个点查看那里的访客。' : '筛选范围内没有可定位的访客。'}</div>`;
      box._points = data.points;
    } catch (e) {
      box.innerHTML = `<p class="empty">${WY.esc(e.message || '地图加载失败')}</p>`;
    }
  }

  function showPoint(i) {
    const p = ($('mon-map')._points || [])[i];
    if (!p) return;
    $('mon-map').querySelectorAll('.mon-dot').forEach((d) => d.classList.toggle('is-active', d.dataset.pt === String(i)));
    $('mon-map-info').innerHTML = `<b>${p.flag || '📍'} ${WY.esc(p.label)}</b> <span class="muted small">${p.count} 位访客 · ${p.events} 条记录</span><div class="mon-map-ids">${p.visitors.map((id) => `<button class="mon-goto" type="button" data-goto="${id}">#${id}</button>`).join('')}</div>`;
  }

  $('mon-map-btn').addEventListener('click', () => {
    const box = $('mon-map');
    const open = box.hidden;
    box.hidden = !open;
    $('mon-map-btn').textContent = open ? '收起地图' : '显示地图';
    if (open) loadMap();
  });
  $('mon-map').addEventListener('click', (e) => {
    const d = e.target.closest('[data-pt]');
    if (d) showPoint(Number(d.dataset.pt));
    const g = e.target.closest('[data-goto]');
    if (g) setFilter({ q: `#${g.dataset.goto}` });
  });
  $('mon-map').addEventListener('keydown', (e) => {
    const d = e.target.closest('[data-pt]');
    if (d && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      showPoint(Number(d.dataset.pt));
    }
  });

  async function loadSummary() {
    try {
      const s = await api('/api/monitor/summary');
      $('mon-keep').textContent = s.retentionDays;
      const g = s.geo;
      $('mon-geo-status').textContent = g && g.city ? `位置数据：DB-IP Lite ${g.cityBuilt} 版（本地数据库，不外传 IP）` : '位置数据：服务器上还没有安装数据库';
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

  const NA = '<span class="mon-na">数据源不提供</span>';
  function placeHtml(p) {
    if (!p || !p.label) return '';
    return `<span class="mon-place${p.found ? '' : ' is-none'}" title="根据 IP 估算的大致位置，不是住址">${p.found ? `<span class="mon-flag" aria-hidden="true">${p.flag || '📍'}</span>` : ''}${WY.esc(p.label)}</span>`;
  }

  function geoDetails(g) {
    if (!g) return '';
    const v = (x) => (x == null || x === '' ? NA : WY.esc(String(x)));
    if (!g.found) return `<p class="muted small">${WY.esc(g.note || '没有位置数据')}</p>`;
    const rows = [
      ['国家 / 地区', `${g.flag ? g.flag + ' ' : ''}${v(g.country)}${g.countryCode ? ` <span class="muted small">${g.countryCode}</span>` : ''}`],
      ['省 / 州', v(g.region)],
      ['城市', v(g.city)],
      ['区县', NA],
      ['邮编', NA],
      ['大致坐标', g.lat != null ? `${g.lat}, ${g.lon} <span class="muted small">（城市中心附近，约 10 公里精度，不是住址）</span>` : NA],
      ['网络运营者 / ASN', g.org || g.asn ? `${v(g.org)}${g.asn ? ` <span class="mono">${g.asn}</span>` : ''}` : NA],
      ['ISP', `${NA} <span class="muted small">（以网络运营者为准）</span>`],
      ['连接类型', '<span class="mon-na">未知（数据源不提供）</span>'],
      ['VPN / 代理', '<span class="mon-na">未知（数据源不提供）</span>'],
      ['准确度', v(g.accuracy)],
      ['数据来源', `${v(g.provider)} · IP Geolocation by <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a>`],
      ['最近查询', fmt(g.updatedAt)],
    ];
    return `<dl class="mon-geo">${rows.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>`;
  }

  function geoPlace(g) {
    if (!g) return null;
    return { flag: g.flag, found: g.found, label: g.found ? [g.city, g.region !== g.city ? g.region : null, g.country].filter(Boolean).join(', ') : g.note };
  }

  function rowHtml(u) {
    const who = u.isAdmin ? '<span class="badge badge-gold">站长</span>' : u.name ? `<span class="badge badge-green">${WY.esc(u.name)}</span>` : u.anonymous ? '<span class="badge badge-muted">无 Cookie</span>' : '<span class="badge badge-muted">匿名访客</span>';
    const warn = u.flags ? `<span class="badge badge-rose" title="只是线索，不代表一定有恶意">⚠ ${u.flags} 条提示</span>` : '';
    return `<li class="mon-row" data-id="${u.id}">
      <div class="mon-row-main">
        <div class="mon-who"><b class="mono">#${u.id}</b><span class="mon-note${u.note ? '' : ' is-empty'}">${u.note ? WY.esc(u.note) : '未命名'}</span><button class="vb-pen mon-note-edit" type="button" data-note="${u.id}" aria-label="给这个访客起昵称" title="起个昵称（只有你能看到）">✎</button>${who}${warn}<span class="muted small">${WY.esc(u.device)}</span></div>
        <dl class="mon-facts">
          <div><dt>IP</dt><dd class="mono">${WY.esc(u.ip)}${u.ipCount > 1 ? ` <span class="muted small">（共 ${u.ipCount} 个）</span>` : ''}${u.sharedIp ? `<button class="mon-shared" type="button" data-ip="${WY.esc(u.ip)}" title="同一个 IP 可能是学校、公司或同一个手机网络">同 IP 还有 ${u.sharedIp} 位</button>` : ''}${placeHtml(u.place)}</dd></div>
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
      .map(
        (x) => `<li class="mon-iph"><details><summary><span class="badge badge-cyan">${x.tag}</span><b class="mono">${WY.esc(x.ip)}</b>${placeHtml(geoPlace(x.geo))}${x.geo && x.geo.org ? `<span class="muted small">${WY.esc(x.geo.org)}</span>` : ''}<span class="muted small">${x.sessions} 次访问 · ${fmt(x.firstSeen)} → ${fmt(x.lastSeen)}</span><span class="mon-more">详细位置 ▾</span></summary>${geoDetails(x.geo)}</details></li>`,
      )
      .join('');
    const obs = (d.observations || []).length
      ? `<div class="mon-obs"><h3>位置观察</h3><ul>${d.observations.map((o) => `<li>${WY.esc(o)}</li>`).join('')}</ul><p class="muted small">这是观察，不是可疑行为的证据：换手机网络、出差、开关 VPN 都会这样。</p></div>`
      : '';
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
    const rel = (d.related || [])
      .map((o) => `<li><button class="mon-goto" type="button" data-goto="${o.id}">#${o.id}${o.note ? ` ${WY.esc(o.note)}` : ''}</button>${o.likelySame ? '<span class="badge badge-gold">可能是同一人</span>' : '<span class="badge badge-muted">同 IP</span>'}${o.name ? `<span class="badge badge-green">${WY.esc(o.name)}</span>` : ''}<span class="muted small">${WY.esc(o.device)} · 最近 ${fmt(o.lastSeen)}</span></li>`)
      .join('');
    const relBox = rel ? `<div class="mon-tl-ips"><h3>相关访客</h3><p class="muted small">「可能是同一人」= 同 IP 且浏览器完全相同，或同一个昵称（例如清了 Cookie 又回来）。只是推测。</p><ul>${rel}</ul></div>` : '';
    return `<div class="mon-tl-ips"><h3>IP 与位置记录</h3><p class="muted small">位置是根据 IP 估算的大致城市，不是真实住址；点一条 IP 看详细信息。</p><ul>${ips}</ul></div>${obs}${relBox}
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
    const sh = e.target.closest('[data-ip]');
    if (sh) {
      setFilter({ ip: sh.dataset.ip });
      return;
    }
    const g = e.target.closest('[data-goto]');
    if (g) {
      setFilter({ q: `#${g.dataset.goto}` });
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

  function setFilter(f) {
    const form = $('mon-filter');
    form.reset();
    for (const [k, v] of Object.entries(f)) form.elements[k].value = v;
    state.filter = f;
    state.page = 1;
    loadList();
    if (!$('mon-map').hidden) loadMap();
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('mon-filter').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    state.filter = { q: f.get('q').trim(), ip: f.get('ip').trim(), from: f.get('from'), to: f.get('to'), flagged: f.get('flagged') ? '1' : '' };
    state.page = 1;
    loadList();
    if (!$('mon-map').hidden) loadMap();
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
