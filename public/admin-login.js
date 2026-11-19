/* Admin sign-in. The real dashboard (admin.html) is only served after this succeeds.
   When an unlock pattern is set, the pad shows under the code; finishing the pattern signs in. */
(function () {
  'use strict';
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-code');
  const error = document.getElementById('login-error');
  const submit = document.getElementById('login-submit');
  const padWrap = document.getElementById('login-pattern-wrap');
  const hint = document.getElementById('login-pattern-hint');
  let needPattern = false;
  let pattern = '';
  let pad = null;

  async function signIn() {
    const code = input.value.trim();
    if (code.length < 4 || code.length > 128) {
      error.textContent = '管理码长度不正确。';
      input.focus();
      if (pad) pad.reset();
      return;
    }
    if (needPattern && !pattern) {
      error.textContent = '请画出解锁图案。';
      return;
    }
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = '验证中…';
    try {
      const body = needPattern ? { code, pattern } : { code };
      const r = await window.WY.api('/api/admin/login', { method: 'POST', body });
      if (pad) pad.flash(true);
      input.value = '';
      if (r && r.newDevice) sessionStorage.setItem('wy-admin-new-device', '1');
      location.replace('/admin');
    } catch (err) {
      const msg = err && err.status === 401
        ? needPattern ? '管理码或解锁图案不正确，请再试一次。' : '管理码不正确，请再试一次。'
        : (err && err.message) || '登录失败，请稍后重试。';
      error.textContent = msg;
      if (pad) pad.flash(false);
      pattern = '';
      submit.disabled = false;
      submit.textContent = '进入后台';
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    signIn();
  });

  fetch('/api/admin/login-options', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((opts) => {
      if (!opts || !opts.pattern || !window.WYPattern) return;
      needPattern = true;
      padWrap.hidden = false;
      pad = window.WYPattern.mount(document.getElementById('login-pattern'), {
        onDone(p) {
          pattern = p;
          hint.textContent = '图案已记录';
          if (input.value.trim().length >= 4) signIn();
          else input.focus();
        },
        onShort() {
          hint.textContent = '至少连接 4 个点';
        },
      });
    })
    .catch(() => {});
  input.focus();
})();
