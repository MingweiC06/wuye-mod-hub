/* Admin sign-in. The real dashboard (admin.html) is only served after this succeeds. */
(function () {
  'use strict';
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-code');
  const error = document.getElementById('login-error');
  const submit = document.getElementById('login-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (code.length < 4 || code.length > 128) {
      error.textContent = '管理码长度不正确。';
      input.focus();
      return;
    }
    error.textContent = '';
    submit.disabled = true;
    submit.textContent = '验证中…';
    try {
      await window.WY.api('/api/admin/login', { method: 'POST', body: { code } });
      input.value = '';
      location.replace('/admin');
    } catch (err) {
      error.textContent = err && err.status === 401 ? '管理码不正确，请再试一次。' : (err && err.message) || '登录失败，请稍后重试。';
      input.select();
      submit.disabled = false;
      submit.textContent = '进入后台';
    }
  });
  input.focus();
})();
