/* 赞助 page: QR codes + "I paid" form + my submissions. */
(function () {
  'use strict';
  const WY = window.WY;
  const $ = (id) => document.getElementById(id);
  const STATUS = { pending: '等待乌叶确认', confirmed: '已上榜 ✦', rejected: '未通过' };
  let me = null;

  function paintMine(list) {
    $('sp-mine-wrap').hidden = !list.length;
    $('sp-mine').innerHTML = list
      .map((s) => `<li><span>${new Date(s.createdAt).toLocaleDateString()}</span><span>${s.anonymous ? '匿名' : '署名'}</span><b class="is-${s.status}">${STATUS[s.status] || s.status}</b></li>`)
      .join('');
  }

  async function load() {
    const data = await WY.api('/api/sponsor');
    const c = data.config;
    const qrs = [
      ['wechat', '微信', c.wechat],
      ['alipay', '支付宝', c.alipay],
    ].filter((q) => q[2]);
    if (qrs.length) $('sp-qrs').innerHTML = qrs.map(([k, label, src]) => `<figure class="sp-qr sp-${k}"><img src="${WY.esc(src)}" alt="${label}收款码" loading="lazy"><figcaption>${label}</figcaption></figure>`).join('');
    if (c.note) $('sp-note').textContent = c.note;
    me = data.me;
    paintAnon();
    paintMine(data.mine);
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
    btn.disabled = true;
    try {
      const r = await WY.api('/api/sponsor', {
        method: 'POST',
        body: { method: f.method.value, amount, note: f.note.value.trim(), message: f.message.value.trim(), anonymous: f.anonymous.checked },
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
