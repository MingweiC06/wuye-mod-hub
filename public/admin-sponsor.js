/* Admin → 赞助: QR codes, confirm sponsorships (amounts are admin-only), reset keys. */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;
  const $ = (id) => document.getElementById(id);
  const METHOD = { wechat: '微信', alipay: '支付宝' };
  const STATUS = { pending: '待确认', confirmed: '已确认', rejected: '已拒绝' };
  let booted = false;

  const yuan = (cents) => `¥${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        resolve(cv.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = URL.createObjectURL(file);
    });
  }

  function paintConfig(c) {
    for (const k of ['wechat', 'alipay']) {
      const img = $(`sp-admin-${k}`);
      img.hidden = !c[k];
      if (c[k]) img.src = c[k];
    }
    $('sp-admin-note').note.value = c.note || '';
  }

  async function loadConfig() {
    paintConfig((await WY.api('/api/admin/sponsor-config')).config);
  }

  async function saveConfig(body, msg) {
    try {
      paintConfig((await WY.api('/api/admin/sponsor-config', { method: 'PATCH', body })).config);
      WY.toast(msg, 'success');
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  async function loadList() {
    const { items } = await WY.api('/api/admin/sponsorships');
    const total = items.filter((s) => s.status === 'confirmed').reduce((n, s) => n + s.amountCents, 0);
    const pending = items.filter((s) => s.status === 'pending').length;
    $('sp-admin-total').textContent = `已确认合计 ${yuan(total)} · 待确认 ${pending} 条`;
    $('sp-admin-list').innerHTML = items.length
      ? items
          .map(
            (s) => `<div class="sp-admin-row is-${s.status}" data-sp="${s.id}">
              <div>
                <b>${yuan(s.amountCents)}</b> · ${METHOD[s.method] || s.method} · ${s.anonymous ? '匿名' : WY.esc(s.name || '匿名')}${s.anonymous && s.name ? `（实际：${WY.esc(s.name)}）` : ''}
                <div class="meta">${new Date(s.createdAt).toLocaleString()} · ${STATUS[s.status]}${s.note ? ` · 备注：${WY.esc(s.note)}` : ''}${s.message ? ` · 留言：${WY.esc(s.message)}` : ''}</div>
              </div>
              <div class="acts">
                ${s.status !== 'confirmed' ? '<button class="btn btn-primary btn-sm" type="button" data-set="confirmed">确认</button>' : ''}
                ${s.status !== 'rejected' ? '<button class="btn btn-ghost btn-sm" type="button" data-set="rejected">拒绝</button>' : ''}
                ${s.status !== 'pending' ? '<button class="btn btn-ghost btn-sm" type="button" data-set="pending">改回待确认</button>' : ''}
                <button class="btn btn-danger btn-sm" type="button" data-sp-del>删除</button>
              </div>
            </div>`,
          )
          .join('')
      : '<div class="empty">还没有赞助记录。</div>';
  }

  async function loadProfiles() {
    const { items } = await WY.api('/api/admin/profiles');
    $('profiles-admin').innerHTML = items.length
      ? items
          .map(
            (p) => `<div class="sp-admin-row" data-profile="${p.id}">
              <div><b>${WY.esc(p.name)}</b><div class="meta">${new Date(p.createdAt).toLocaleDateString()} 创建 · ${p.devices} 台设备</div><div class="sp-admin-key" data-key></div></div>
              <div class="acts"><button class="btn btn-ghost btn-sm" type="button" data-reset>重置钥匙</button><button class="btn btn-danger btn-sm" type="button" data-del>删除</button></div>
            </div>`,
          )
          .join('')
      : '<div class="empty">还没有人起名字。</div>';
  }

  async function open() {
    if (!booted) {
      booted = true;
      $('sp-admin-qr').addEventListener('change', async (e) => {
        const input = e.target.closest('[data-qr]');
        if (!input || !input.files[0]) return;
        try {
          await saveConfig({ [input.dataset.qr]: await shrink(input.files[0]) }, '收款码已更新');
        } catch (err) {
          WY.toast(err.message, 'error');
        }
        input.value = '';
      });
      $('sp-admin-qr').addEventListener('click', (e) => {
        const b = e.target.closest('[data-qr-clear]');
        if (!b) return;
        e.preventDefault();
        saveConfig({ [b.dataset.qrClear]: '' }, '收款码已去掉');
      });
      $('sp-admin-note').addEventListener('submit', (e) => {
        e.preventDefault();
        saveConfig({ note: e.target.note.value.trim() }, '说明已保存');
      });
      $('sp-admin-list').addEventListener('click', async (e) => {
        const del = e.target.closest('[data-sp-del]');
        if (del) {
          const id = del.closest('[data-sp]').dataset.sp;
          const ok = await WY.confirm({ title: '删除这条赞助记录？', message: '删除后无法恢复，赞助榜也会随之更新。', okText: '删除', danger: true });
          if (!ok) return;
          try {
            await WY.api(`/api/admin/sponsorships/${id}`, { method: 'DELETE' });
            WY.toast('已删除', 'success');
            loadList();
          } catch (err) {
            WY.toast(err.message, 'error');
          }
          return;
        }
        const b = e.target.closest('[data-set]');
        if (!b) return;
        const id = b.closest('[data-sp]').dataset.sp;
        try {
          await WY.api(`/api/admin/sponsorships/${id}`, { method: 'PATCH', body: { status: b.dataset.set } });
          WY.toast(`已${STATUS[b.dataset.set]}`, 'success');
          loadList();
        } catch (err) {
          WY.toast(err.message, 'error');
        }
      });
      $('profiles-admin').addEventListener('click', async (e) => {
        const del = e.target.closest('[data-del]');
        if (del) {
          const row = del.closest('[data-profile]');
          const name = row.querySelector('b').textContent;
          const ok = await WY.confirm({ title: `删除「${name}」？`, message: '名字和钥匙会被删除，已登录的设备会退出。TA 的赞助记录会保留，但不再显示这个名字。删除后无法恢复。', okText: '删除', danger: true });
          if (!ok) return;
          try {
            await WY.api(`/api/admin/profiles/${row.dataset.profile}`, { method: 'DELETE' });
            WY.toast(`已删除「${name}」`, 'success');
            loadProfiles();
            loadList();
          } catch (err) {
            WY.toast(err.message, 'error');
          }
          return;
        }
        const b = e.target.closest('[data-reset]');
        if (!b) return;
        const row = b.closest('[data-profile]');
        const ok = await WY.confirm({ title: '重置钥匙？', message: '重置后旧钥匙立刻失效，需要把新钥匙私信给 TA。', okText: '重置', danger: true });
        if (!ok) return;
        try {
          const r = await WY.api(`/api/admin/profiles/${row.dataset.profile}/reset-key`, { method: 'POST' });
          row.querySelector('[data-key]').textContent = `新钥匙：${r.key}（只显示这一次，请私信给 ${r.name}）`;
        } catch (err) {
          WY.toast(err.message, 'error');
        }
      });
    }
    loadConfig().catch((e) => WY.toast(e.message, 'error'));
    loadList().catch((e) => WY.toast(e.message, 'error'));
    loadProfiles().catch((e) => WY.toast(e.message, 'error'));
  }

  document.addEventListener('wy:sponsor', open);
})();
