/* Admin → 站点设置: 登录设备 (which devices are signed in, sign them out) and 解锁图案 (set / turn off). */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;
  const $ = (id) => document.getElementById(id);
  let booted = false;
  let devices = [];

  const when = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—');
  const ago = (ms) => {
    if (!ms) return '—';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 2) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} 小时前`;
    return `${Math.round(h / 24)} 天前`;
  };

  function paintDevices() {
    const hasPrimary = devices.some((d) => d.locked);
    const iAmPrimary = devices.some((d) => d.locked && d.current);
    const ask = devices.find((d) => d.primaryRequest && !d.current);
    $('devices-primary').hidden = !(iAmPrimary && ask);
    if (iAmPrimary && ask) $('devices-primary').textContent = `「${ask.label}」（IP ${ask.lastIp || '未知'}）申请成为主设备。批准后，主设备会换成它，本机会变成普通设备。不认识就点拒绝。`;
    const on = devices.filter((d) => d.signedIn).length;
    $('devices-count').textContent = `${on} 台在线`;
    $('devices-list').innerHTML = devices.length
      ? devices
          .map((d) => {
            const fresh = d.firstSeen && Date.now() - d.firstSeen < 24 * 3600_000;
            const tags = [
              d.locked ? '<span class="tag tag-primary">★ 主设备</span>' : '',
              d.primaryRequest ? '<span class="tag tag-ask">申请成为主设备</span>' : '',
              d.current ? '<span class="tag tag-me">本机</span>' : '',
              d.signedIn ? '<span class="tag tag-on">已登录</span>' : '<span class="tag tag-off">已退出</span>',
              fresh && !d.current ? '<span class="tag tag-new">24 小时内新设备</span>' : '',
            ].join('');
            const meta = d.firstSeen
              ? `首次登录 ${when(d.firstSeen)} · 最近活动 ${ago(d.lastSeen)} · 共登录 ${d.logins} 次${d.signedIn ? ` · 会话到 ${when(d.sessionUntil)}` : ''}`
              : `会话到 ${when(d.sessionUntil)}`;
            const ip = d.lastIp
              ? `<span class="admin-device-ip">IP <code>${WY.esc(d.lastIp)}</code>${d.firstIp && d.firstIp !== d.lastIp ? ` <span class="admin-device-ipchg">（首次登录 IP <code>${WY.esc(d.firstIp)}</code>，已变化）</span>` : ''}</span>`
              : d.id ? '<span class="admin-device-ip">IP 未记录（升级前登录）</span>' : '';
            const key = d.id || 'legacy';
            // The primary can't be signed out or removed from another device.
            const shielded = d.locked && !d.current;
            const acts = [
              iAmPrimary && d.primaryRequest && !d.current ? `<button class="btn btn-primary btn-sm" type="button" data-approve="${key}">批准</button><button class="btn btn-ghost btn-sm" type="button" data-reject="${key}">拒绝</button>` : '',
              d.current && !d.locked && !hasPrimary ? '<button class="btn btn-primary btn-sm" type="button" data-make-primary>设为主设备</button>' : '',
              d.current && !d.locked && hasPrimary && !d.primaryRequest ? '<button class="btn btn-ghost btn-sm" type="button" data-ask-primary>申请成为主设备</button>' : '',
              d.current && d.primaryRequest ? '<span class="small muted">等待主设备批准…</span>' : '',
              d.current && d.locked ? '<button class="btn btn-ghost btn-sm" type="button" data-drop-primary>取消主设备</button>' : '',
              d.signedIn && !shielded ? `<button class="btn btn-ghost btn-sm" type="button" data-signout="${key}">${d.current ? '退出本机' : '让它退出'}</button>` : '',
              d.id && !d.current && !shielded ? `<button class="btn btn-danger btn-sm" type="button" data-forget="${key}">移除</button>` : '',
              shielded ? '<span class="small muted">🔒 只能在它自己上面退出</span>' : '',
            ].join('');
            return `<li class="admin-device${d.current ? ' is-current' : ''}${d.locked ? ' is-primary' : ''}"><div><b>${WY.esc(d.label)}</b>${tags}${ip}<span class="meta">${meta}</span></div><div class="admin-device-acts">${acts}</div></li>`;
          })
          .join('')
      : '<li class="empty">还没有登录记录。</li>';
  }

  async function loadDevices() {
    try {
      const data = await WY.api('/api/admin/devices');
      devices = data.devices || [];
      paintDevices();
      paintPatternState(Boolean(data.pattern));
    } catch (e) {
      $('devices-list').innerHTML = `<li class="empty">${WY.esc(e.message || '加载失败')}</li>`;
    }
  }

  async function revoke(key, forget, btn) {
    const d = devices.find((x) => (x.id || 'legacy') === key);
    const label = d ? d.label : '这台设备';
    const q = forget ? `移除「${label}」？它会立即退出，并从列表中删除。` : d && d.current ? '退出本机的登录？' : `让「${label}」立即退出登录？`;
    if (!(await WY.confirm({ title: forget ? '移除设备' : '退出登录', message: q, okText: forget ? '移除' : '退出', danger: true }))) return;
    btn.disabled = true;
    try {
      const r = await WY.api(`/api/admin/devices/${key}${forget ? '?forget=1' : ''}`, { method: 'DELETE' });
      if (r.self) {
        location.replace('/admin');
        return;
      }
      WY.toast(forget ? '已移除该设备' : '该设备已退出', 'success');
      loadDevices();
    } catch (e) {
      WY.toast(e.message, 'error');
      btn.disabled = false;
    }
  }

  /* ---------- 主设备 ---------- */
  // Ask for the admin code in a site dialog; resolves to the code or '' if cancelled.
  function askCode(title, message) {
    return new Promise((resolve) => {
      let done = false;
      const dlg = WY.dialog({
        title,
        body: `<p class="muted dialog-text">${WY.esc(message)}</p><input class="input" type="password" autocomplete="current-password" placeholder="输入管理码" data-code>`,
        footer: '<button class="btn btn-ghost" type="button" data-cancel>取消</button><button class="btn btn-primary" type="button" data-ok>确定</button>',
        onClose: () => { if (!done) { done = true; resolve(''); } },
      });
      const input = dlg.body.querySelector('[data-code]');
      const ok = () => { done = true; const v = input.value.trim(); dlg.close(); resolve(v); };
      dlg.footer.querySelector('[data-ok]').addEventListener('click', ok);
      dlg.footer.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      input.focus();
    });
  }

  async function makePrimary() {
    const code = await askCode('设为主设备', '主设备不会被别的设备踢出，改管理码也不会退出，只要在用就一直保持登录。换主设备需要它批准。输入管理码确认：');
    if (!code) return;
    try {
      await WY.api('/api/admin/devices/lock', { method: 'PUT', body: { lock: true, code } });
      WY.toast('本机已设为主设备', 'success');
      loadDevices();
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  async function askPrimary() {
    const code = await askCode('申请成为主设备', '申请会发到现在的主设备，等它批准后本机才会变成主设备。输入管理码确认：');
    if (!code) return;
    try {
      await WY.api('/api/admin/devices/primary-request', { method: 'POST', body: { code } });
      WY.toast('已发出申请，请在主设备上批准', 'success');
      loadDevices();
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  async function dropPrimary() {
    const ok = await WY.confirm({ title: '取消主设备？', message: '取消后就没有主设备了：任何登录的设备都能设自己为主设备、改管理码和解锁图案。', okText: '取消主设备', danger: true });
    if (!ok) return;
    try {
      await WY.api('/api/admin/devices/lock', { method: 'PUT', body: { lock: false } });
      WY.toast('已取消主设备', 'success');
      loadDevices();
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  async function answer(key, approve) {
    const d = devices.find((x) => x.id === key);
    if (approve && !(await WY.confirm({ title: '批准换主设备？', message: `主设备会换成「${d ? d.label : '这台设备'}」（IP ${d && d.lastIp ? d.lastIp : '未知'}）。本机会变成普通设备，之后可能被它踢出。`, okText: '批准' }))) return;
    try {
      await WY.api(`/api/admin/devices/${key}/primary`, { method: 'POST', body: { approve } });
      WY.toast(approve ? '已批准，主设备已更换' : '已拒绝', 'success');
      loadDevices();
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  /* ---------- pattern ---------- */
  let pad = null;
  let first = '';
  let confirmed = '';

  function paintPatternState(on) {
    $('pattern-state').textContent = on ? '已开启' : '未开启';
    $('pattern-off').hidden = !on;
    $('pattern-save').textContent = on ? '更换图案' : '保存图案';
  }

  function resetPattern(msg) {
    first = '';
    confirmed = '';
    if (pad) pad.reset();
    $('pattern-save').disabled = true;
    $('pattern-hint').textContent = msg || '画一个新图案（至少 4 个点）';
  }

  async function savePattern(off) {
    const code = $('pattern-code').value.trim();
    if (code.length < 4) {
      $('pattern-error').textContent = '请输入当前管理码。';
      $('pattern-code').focus();
      return;
    }
    if (!off && !confirmed) return;
    if (off && !(await WY.confirm({ title: '关闭解锁图案？', message: '之后登录只需要管理码。', okText: '关闭', danger: true }))) return;
    $('pattern-error').textContent = '';
    try {
      const r = await WY.api('/api/admin/pattern', { method: 'PUT', body: { code, pattern: off ? '' : confirmed } });
      $('pattern-code').value = '';
      paintPatternState(r.pattern);
      resetPattern(r.pattern ? '图案已保存。下次登录时需要画出它。' : '图案已关闭。');
      WY.toast(r.pattern ? '解锁图案已开启' : '解锁图案已关闭', 'success');
    } catch (e) {
      $('pattern-error').textContent = e.message || '保存失败';
    }
  }

  function boot() {
    $('devices-list').addEventListener('click', (e) => {
      if (e.target.closest('[data-make-primary]')) makePrimary();
      if (e.target.closest('[data-ask-primary]')) askPrimary();
      if (e.target.closest('[data-drop-primary]')) dropPrimary();
      const ap = e.target.closest('[data-approve], [data-reject]');
      if (ap) answer(ap.dataset.approve || ap.dataset.reject, Boolean(ap.dataset.approve));
      const so = e.target.closest('[data-signout]');
      const fo = e.target.closest('[data-forget]');
      if (so) revoke(so.dataset.signout, false, so);
      if (fo) revoke(fo.dataset.forget, true, fo);
    });
    if (window.WYPattern) {
      pad = window.WYPattern.mount($('pattern-pad'), {
        onDone(p) {
          if (!first) {
            first = p;
            pad.flash(true);
            setTimeout(() => pad.reset(), 450);
            $('pattern-hint').textContent = '再画一次确认';
          } else if (p === first) {
            confirmed = p;
            pad.flash(true);
            $('pattern-hint').textContent = '两次一致 ✓ 输入管理码后保存';
            $('pattern-save').disabled = false;
          } else {
            pad.flash(false);
            first = '';
            $('pattern-hint').textContent = '两次不一致，请重新画';
          }
        },
        onShort() {
          $('pattern-hint').textContent = '至少连接 4 个点';
        },
      });
    }
    $('pattern-save').addEventListener('click', () => savePattern(false));
    $('pattern-off').addEventListener('click', () => savePattern(true));
    $('pattern-redo').addEventListener('click', () => resetPattern());
  }

  document.addEventListener('wy:settings', () => {
    if (!booted) {
      booted = true;
      boot();
    }
    loadDevices();
  });

  // First visit after signing in from a device we haven't seen before.
  try {
    if (sessionStorage.getItem('wy-admin-new-device')) {
      sessionStorage.removeItem('wy-admin-new-device');
      setTimeout(() => WY.toast('这是一台新设备，已记录到「站点设置 → 登录设备」', 'success'), 1200);
    }
  } catch {
    /* storage blocked */
  }
})();
