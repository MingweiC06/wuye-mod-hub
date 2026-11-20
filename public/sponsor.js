/* 赞助 page: QR codes + "I paid" form + my submissions. */
(function () {
  'use strict';
  const WY = window.WY;
  const $ = (id) => document.getElementById(id);
  const STATUS = { pending: '等待乌叶确认', confirmed: '已上榜 ✦', rejected: '未通过' };
  let me = null;

  function paintMine(list) {
    list = list || [];
    WY.setEl('sp-mine-wrap', (el) => (el.hidden = !list.length));
    WY.setEl('sp-mine', (el) => (el.innerHTML = list
      .map((s) => `<li><span>${new Date(s.createdAt).toLocaleDateString()}</span><span>${s.anonymous ? '匿名' : '署名'}</span><b class="is-${s.status}">${STATUS[s.status] || s.status}</b></li>`)
      .join('')));
  }

  async function load() {
    const data = await WY.api('/api/sponsor');
    const c = data.config || {};
    const qrs = [
      ['wechat', '微信', c.wechat],
      ['alipay', '支付宝', c.alipay],
    ].filter((q) => q[2]);
    if (qrs.length) WY.setEl('sp-qrs', (el) => (el.innerHTML = qrs.map(([k, label, src]) => `<figure class="sp-qr sp-${k}"><img src="${WY.esc(src)}" alt="${label}收款码" loading="lazy"><figcaption>${label}</figcaption></figure>`).join('')));
    if (c.note) WY.setEl('sp-note', (el) => (el.textContent = c.note));
    // No QR uploaded yet → nothing to pay with, so don't offer "我已赞助". Only offer methods that have a QR.
    const form = $('sp-form');
    form.hidden = !qrs.length;
    const have = new Set(qrs.map((q) => q[0]));
    form.querySelectorAll('input[name="method"]').forEach((r) => {
      r.disabled = !have.has(r.value);
      r.closest('label').hidden = r.disabled;
    });
    if (qrs.length && !have.has(form.method.value)) form.querySelector(`input[name="method"][value="${qrs[0][0]}"]`).checked = true;
    showMethod();
    me = data.me;
    paintAnon();
    paintMine(data.mine);
  }

  // only show the QR code for the method the fan picked
  function showMethod() {
    const form = $('sp-form');
    const pick = form && form.method.value;
    document.querySelectorAll('#sp-qrs .sp-qr').forEach((q) => {
      const on = q.classList.contains(`sp-${pick}`);
      q.hidden = !on;
      if (on) {
        q.classList.remove('is-in');
        void q.offsetWidth;
        q.classList.add('is-in');
      }
    });
  }

  function paintAnon() {
    const box = $('sp-anon');
    if (!me) {
      box.checked = true;
      box.disabled = true;
      box.parentElement.title = '先在上面起个名字，才能署名上榜';
    } else {
      box.disabled = false;
      box.parentElement.title = '';
    }
  }

  // page scripts re-run on each visit: keep just one listener
  if (window.__wySponsorMe) document.removeEventListener('wy:me', window.__wySponsorMe);
  window.__wySponsorMe = (e) => {
    me = e.detail;
    if ($('sp-anon')) paintAnon();
  };
  document.addEventListener('wy:me', window.__wySponsorMe);

  $('sp-form').addEventListener('change', (e) => {
    if (e.target.name === 'method') showMethod();
  });
  $('sp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const amount = Number(f.amount.value);
    if (!(amount >= 1)) {
      WY.toast('请填写赞助金额（至少 1 元）', 'error');
      f.amount.focus();
      return;
    }
    const btn = f.querySelector('button[type="submit"]');
    if (!f.crossBorderConsent.checked) {
      WY.toast('请先勾选同意隐私政策中的个人信息出境说明', 'error');
      f.crossBorderConsent.focus();
      return;
    }
    if (!f.ageConfirm.checked) {
      WY.toast('请先确认你已年满 14 周岁', 'error');
      f.ageConfirm.focus();
      return;
    }
    btn.disabled = true;
    try {
      const r = await WY.api('/api/sponsor', {
        method: 'POST',
        body: {
          method: f.method.value,
          amount,
          note: f.note.value.trim(),
          message: f.message.value.trim(),
          anonymous: f.anonymous.checked,
          crossBorderConsent: true,
          ageConfirm: true,
        },
      });
      WY.toast(r.anonymous ? '收到！乌叶确认后会以「匿名」上榜' : '收到！乌叶确认后你就会上榜', 'success');
      if (window.WYFX) window.WYFX.burst?.(btn);
      f.amount.value = '';
      f.note.value = '';
      f.message.value = '';
      paintMine((await WY.api('/api/sponsor')).mine);
    } catch (err) {
      WY.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  load().catch((err) => WY.toast(err.message, 'error'));
})();
