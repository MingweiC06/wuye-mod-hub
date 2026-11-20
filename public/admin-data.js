/* Admin → 数据删除: list and hard-delete personal records (fans / supporters / profiles / sponsorships). */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;

  const TYPES = ['fan', 'supporter', 'profile', 'sponsorship'];
  const NOTE = {
    fan: '删除「下载昵称」会同时清理审计日志里完全相同的昵称记录。',
    supporter: '删除「昵称与钥匙」只移除榜单昵称，不影响许愿、投票与评论内容。',
    profile: '删除「昵称档案」会解绑该档案关联的设备，并把赞助记录解除关联（金额与状态保留，身份关联去掉）。',
    sponsorship: '删除「赞助记录」会移除这一条金额、备注与留言，赞助榜上的统计会相应减少。',
  };
  let booted = false;
  let type = 'fan';
  let selected = null;
  let items = [];

  const el = (id) => document.getElementById(id);

  function fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function money(cents) {
    return ((Number(cents) || 0) / 100).toFixed(2);
  }

  function rowHtml(item, t) {
    let head = '';
    let meta = '';
    if (t === 'fan' || t === 'supporter') {
      head = `<b>${WY.esc(item.nickname || '（空昵称）')}</b>`;
    } else if (t === 'profile') {
      head = `<b>${WY.esc(item.name || '（空昵称）')}</b>`;
      meta = `解绑 ${item.devices || 0} 台设备 · ${item.sponsorships || 0} 条赞助解除关联 · `;
    } else {
      head = `<b>¥${money(item.amountCents)}</b> <span class="meta">${item.anonymous ? '匿名' : '具名'} · ${WY.esc(item.method || '')} · ${WY.esc(item.status || '')}</span>`;
      const extra = [item.note ? `备注：${WY.esc(item.note)}` : '', item.message ? `留言：${WY.esc(item.message)}` : ''].filter(Boolean).join(' · ');
      if (extra) meta = `${extra} · `;
    }
    return `<div class="board-row" data-id="${WY.esc(String(item.id))}">
      <div class="board-name">${head}<span class="meta">${meta}${WY.esc(String(item.id))} · ${WY.esc(fmt(item.createdAt))}</span></div>
      <div class="board-acts"><button class="btn btn-ghost btn-sm" type="button" data-pick>选择</button></div>
    </div>`;
  }

  function paint() {
    const list = el('erase-list');
    if (!items.length) {
      list.innerHTML = '<div class="empty">这一类里没有可删除的记录。</div>';
      return;
    }
    list.innerHTML = items.map((item) => rowHtml(item, type)).join('');
  }

  function markSelected() {
    el('erase-list').querySelectorAll('.board-row').forEach((row) => {
      const on = selected !== null && row.dataset.id === String(selected);
      row.classList.toggle('is-selected', on);
      const btn = row.querySelector('[data-pick]');
      if (btn) btn.textContent = on ? '已选择' : '选择';
    });
    const submit = el('erase-submit');
    if (submit) submit.disabled = selected === null;
    el('erase-status').textContent = selected === null ? '先在上面选择一条记录。' : `已选择：${selected}`;
  }

  async function load() {
    try {
      const data = await WY.api('/api/admin/erasure?type=' + encodeURIComponent(type));
      items = data.items || [];
      selected = null;
      paint();
      markSelected();
    } catch (error) {
      WY.toast(error.message, 'error');
      el('erase-list').innerHTML = '<div class="empty">加载失败。</div>';
    }
  }

  function setType(next) {
    if (!TYPES.includes(next)) return;
    type = next;
    document.querySelectorAll('#erase-types [data-erase-type]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.eraseType === next);
    });
    el('erase-type-note').textContent = NOTE[next] || '';
    el('erase-status').textContent = '';
    load();
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (selected === null) return;
    const form = event.target;
    const code = String(form.code.value || '').trim();
    const confirm = String(form.confirm.value || '').trim();
    if (!code) {
      WY.toast('请重新输入管理码', 'error');
      return;
    }
    if (confirm !== 'DELETE') {
      WY.toast('请输入 DELETE 确认删除', 'error');
      form.confirm.focus();
      return;
    }
    const btn = el('erase-submit');
    btn.disabled = true;
    try {
      const result = await WY.api('/api/admin/erasure/delete', {
        method: 'POST',
        body: { type, id: selected, code, confirm },
      });
      WY.toast('已删除', 'success');
      const bits = [];
      if (result.related && typeof result.related === 'object') {
        Object.keys(result.related).forEach((key) => {
          if (result.related[key]) bits.push(`${key} ${result.related[key]}`);
        });
      }
      el('erase-status').textContent = `已删除 ${type} ${result.id}${bits.length ? `（关联：${bits.join('，')}）` : ''}。`;
      form.code.value = '';
      form.confirm.value = '';
      selected = null;
      await load();
    } catch (error) {
      WY.toast(error.message, 'error');
      el('erase-status').textContent = error.message || '删除失败';
    } finally {
      btn.disabled = selected === null;
    }
  }

  function boot() {
    if (booted) return;
    booted = true;
    document.getElementById('erase-types').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-erase-type]');
      if (btn) setType(btn.dataset.eraseType);
    });
    document.getElementById('erase-list').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-pick]');
      if (!btn) return;
      const row = btn.closest('.board-row');
      if (!row) return;
      selected = row.dataset.id;
      markSelected();
    });
    document.getElementById('erase-form').addEventListener('submit', onSubmit);
    setType('fan');
  }

  document.addEventListener('wy:privacy', boot);
})();
