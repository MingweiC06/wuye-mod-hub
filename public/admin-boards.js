/* Admin → 排行榜: adjust, hide or add names on 星光榜 and 赞助榜. Real data is never changed. */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;
  const UNIT = { stars: '分', sponsors: '元' };
  let booted = false;
  let data = null;

  const sign = (n) => (n > 0 ? '+' : '') + n;

  function rowHtml(board, r) {
    const total = r.real + r.adjust;
    return `<div class="board-row${r.hidden ? ' is-hidden' : ''}" data-name="${WY.esc(r.name)}">
      <div class="board-name"><b>${WY.esc(r.name)}</b>
        <span class="meta">真实 ${r.real}${UNIT[board]}${r.adjust ? ` · 调整 ${sign(r.adjust)}` : ''} · 榜上 ${total}${UNIT[board]}${r.hidden ? ' · 已隐藏' : ''}</span></div>
      <div class="board-acts">
        <input class="input" type="number" step="1" value="${r.adjust}" aria-label="${WY.esc(r.name)} 的调整值" data-adjust>
        <button class="btn btn-primary btn-sm" type="button" data-save>保存</button>
        <button class="btn btn-ghost btn-sm" type="button" data-hide>${r.hidden ? '恢复' : '隐藏'}</button>
        ${r.adjust || r.hidden ? '<button class="btn btn-ghost btn-sm" type="button" data-reset>清除调整</button>' : ''}
        <button class="btn btn-danger btn-sm" type="button" data-del>删除</button>
      </div>
    </div>`;
  }

  function paint(board) {
    const box = data[board];
    const list = box.list.slice().sort((a, b) => b.real + b.adjust - (a.real + a.adjust));
    document.getElementById(`board-${board}`).innerHTML =
      (list.length ? list.map((r) => rowHtml(board, r)).join('') : '<div class="empty">还没有人上榜。</div>') +
      (box.anon ? `<div class="hint">另有 ${box.anon} 条匿名赞助（不能按名字调整）。</div>` : '');
  }

  async function load() {
    try {
      data = await WY.api('/api/admin/boards');
      paint('stars');
      paint('sponsors');
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  async function save(board, name, adjust, hidden, msg) {
    try {
      await WY.api('/api/admin/boards', { method: 'PUT', body: { board, name, adjust, hidden } });
      WY.toast(msg, 'success');
      load();
    } catch (e) {
      WY.toast(e.message, 'error');
    }
  }

  function find(board, name) {
    return data[board].list.find((r) => r.name === name) || { name, real: 0, adjust: 0, hidden: false };
  }

  function boot() {
    for (const board of ['stars', 'sponsors']) {
      document.getElementById(`board-${board}`).addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        const row = e.target.closest('[data-name]');
        if (!btn || !row) return;
        const r = find(board, row.dataset.name);
        if (btn.hasAttribute('data-save')) {
          const v = Number(row.querySelector('[data-adjust]').value);
          if (!Number.isInteger(v)) return WY.toast('请填整数', 'error');
          save(board, r.name, v, r.hidden, '已保存');
        } else if (btn.hasAttribute('data-hide')) {
          save(board, r.name, r.adjust, !r.hidden, r.hidden ? '已恢复' : '已隐藏');
        } else if (btn.hasAttribute('data-del')) {
          const ok = await WY.confirm({
            title: `从${board === 'stars' ? '星光榜' : '赞助榜'}删除「${r.name}」？`,
            message: board === 'stars'
              ? '会删除这个名字（粉丝名字和钥匙、昵称），TA 的投票保留。删除后无法恢复。'
              : '会删除这个名字的赞助记录。删除后无法恢复。',
            okText: '删除',
            danger: true,
          });
          if (!ok) return;
          try {
            await WY.api('/api/admin/boards', { method: 'DELETE', body: { board, name: r.name } });
            WY.toast(`已删除「${r.name}」`, 'success');
            load();
          } catch (err) {
            WY.toast(err.message, 'error');
          }
        } else if (btn.hasAttribute('data-reset')) {
          save(board, r.name, 0, false, '已清除调整');
        }
      });
    }
    document.querySelectorAll('[data-board-add]').forEach((form) => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const board = form.dataset.boardAdd;
        const name = form.elements.name.value.trim();
        const add = Number(form.elements.adjust.value);
        if (!name || !Number.isInteger(add)) return WY.toast('请填名字和整数', 'error');
        const r = find(board, name);
        save(board, name, r.adjust + add, r.hidden, `${name} ${sign(add)}${UNIT[board]}`);
        form.reset();
      });
    });
  }

  document.addEventListener('wy:boards', () => {
    if (!booted) {
      booted = true;
      boot();
    }
    load();
  });
})();
