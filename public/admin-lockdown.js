/* 站点设置 → 紧急模式: 正常 / 只读 / 维护, plus the Cloudflare Under Attack switch when it is connected. */
(function () {
  'use strict';
  const WY = window.WY;
  const box = document.getElementById('lockdown-modes');
  if (!WY || !box) return;
  const badge = document.getElementById('lockdown-badge');
  const msg = document.getElementById('lockdown-message');
  const cfBtn = document.getElementById('lockdown-cf-btn');
  const cfText = document.getElementById('lockdown-cf-text');
  const LABEL = { off: '正常', readonly: '🔒 只读中', maintenance: '⛔ 维护中' };
  let state = null;

  function render(s) {
    state = s;
    box.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === s.mode)));
    badge.textContent = LABEL[s.mode] || s.mode;
    if (document.activeElement !== msg) msg.value = s.message || '';
    const sh = s.shield || {};
    cfBtn.hidden = !sh.enabled;
    if (sh.enabled) {
      cfBtn.textContent = sh.attackOn ? '关闭 Under Attack' : '开启 Under Attack';
      cfBtn.classList.toggle('is-on', Boolean(sh.attackOn));
      cfText.textContent = sh.attackOn
        ? 'Cloudflare Under Attack 已开启' + (sh.manual ? '（手动）' : '（流量异常自动开启，平静 30 分钟后自动关闭）') + '：每个访客先过几秒浏览器检查。'
        : '已连接 Cloudflare：流量异常时会自动开启。也可以手动开。';
    }
  }

  async function load() {
    try {
      render(await WY.api('/api/admin/lockdown'));
    } catch {}
  }

  async function save(body, okText) {
    const buttons = box.querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      render(await WY.api('/api/admin/lockdown', { method: 'PUT', body }));
      WY.toast(okText, 'success');
    } catch (e) {
      WY.toast(e.message || '保存失败', 'error');
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  box.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b || !state || b.dataset.mode === state.mode) return;
    const mode = b.dataset.mode;
    if (mode !== 'off') {
      const ok = await WY.confirm({
        title: mode === 'maintenance' ? '切换到维护模式？' : '切换到只读模式？',
        message:
          mode === 'maintenance'
            ? '所有粉丝只能看到「维护中」页面，直到你切回正常。你自己不受影响。'
            : '粉丝能继续浏览，但投票、许愿、评论和上传都会暂停。',
        okText: '切换',
        danger: mode === 'maintenance',
      });
      if (!ok) return;
    }
    save({ mode, message: msg.value.trim() }, mode === 'off' ? '已恢复正常' : '已切换：' + LABEL[mode]);
  });

  msg.addEventListener('change', () => {
    if (state && state.mode !== 'off') save({ mode: state.mode, message: msg.value.trim() }, '提示已更新');
  });

  cfBtn.addEventListener('click', async () => {
    const on = !(state && state.shield && state.shield.attackOn);
    if (on) {
      const ok = await WY.confirm({ title: '开启 Cloudflare Under Attack？', message: '所有访客进站前会先等几秒浏览器检查，直到你手动关闭。', okText: '开启', danger: true });
      if (!ok) return;
    }
    cfBtn.disabled = true;
    await save({ underAttack: on }, on ? 'Under Attack 已开启' : 'Under Attack 已关闭');
    cfBtn.disabled = false;
  });

  load();
  setInterval(load, 60000);
})();
