/* 许愿池 page, admin only: paste the collector result (导入) next to the wish form, and the 评论收件箱
   under the wish list — the same tools as 后台 → 频道与互动, so comments can be turned into wishes right here. */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;

  const CATS = [
    ['aeon', '游戏复刻'], ['anime', '动漫联动'], ['mob', '生物 / Boss'], ['horror', '恐怖惊悚'],
    ['gameplay', '机制玩法'], ['music', '音乐音效'], ['other', '其他灵感'],
  ];
  const catOptions = () => CATS.map(([k, l]) => `<option value="${k}"${k === 'aeon' ? ' selected' : ''}>${l}</option>`).join('');
  const changed = () => document.dispatchEvent(new CustomEvent('wy:wishes-changed'));

  function importPanel() {
    const side = document.querySelector('.submit-side');
    if (!side) return;
    side.insertAdjacentHTML(
      'beforeend',
      `<div class="card card-pad side-card wa-card">
        <h3><span class="wa-tag">站长</span> 导入抖音评论</h3>
        <p class="small muted">用「评论收集器」书签复制的内容，或手动粘贴评论（一行一条，可写「昵称：内容」）。导入后在页面最下面的「评论收件箱」里挑选。</p>
        <form id="wa-import" novalidate>
          <textarea class="input" id="wa-raw" rows="5" placeholder='{"wuye":1,"video":{…},"comments":[…]}'></textarea>
          <input class="input" id="wa-url" placeholder="视频链接（手动粘贴时可选）https://www.douyin.com/video/7xxxx">
          <div class="wa-row"><button class="btn btn-primary btn-sm" type="submit">导入</button><span class="small muted" id="wa-result" role="status"></span></div>
        </form>
      </div>`,
    );
    document.getElementById('wa-import').addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = document.getElementById('wa-raw').value.trim();
      const out = document.getElementById('wa-result');
      if (!raw) {
        out.textContent = '先粘贴内容';
        return;
      }
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        const r = await WY.api('/api/admin/comments/import', { method: 'POST', body: { raw, videoUrl: document.getElementById('wa-url').value.trim() } });
        out.textContent = `${r.videoAdded ? '已添加视频；' : ''}新增 ${r.added} 条评论（共识别 ${r.total} 条）`;
        document.getElementById('wa-raw').value = '';
        loadInbox();
        document.getElementById('wa-inbox').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        out.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  function inboxSection() {
    const main = document.querySelector('main');
    if (!main) return;
    main.insertAdjacentHTML(
      'beforeend',
      `<section class="section" id="wa-inbox">
        <div class="container">
          <div class="card card-pad wa-inbox">
            <div class="wa-head">
              <h2><span class="wa-tag">站长</span> 评论收件箱</h2>
              <select class="select" id="wa-status" aria-label="筛选"><option value="new">待处理</option><option value="promoted">已转为许愿</option><option value="dismissed">已忽略</option></select>
            </div>
            <p class="small muted">「转为许愿」会把这条评论放进上面的许愿池（署名为评论昵称）；也可以填许愿编号把它并入已有的。只有你能看到这一块。</p>
            <div id="wa-list"></div>
          </div>
        </div>
      </section>`,
    );
    document.getElementById('wa-status').addEventListener('change', loadInbox);
    document.getElementById('wa-list').addEventListener('click', onInboxClick);
  }

  async function loadInbox() {
    const list = document.getElementById('wa-list');
    const status = document.getElementById('wa-status').value;
    try {
      const { items } = await WY.api(`/api/admin/comments?status=${status}`);
      if (!items.length) {
        list.innerHTML = '<div class="empty">这里空空的。用上面的「导入抖音评论」导入一批吧。</div>';
        return;
      }
      list.innerHTML = items
        .map(
          (c) => `
          <article class="wa-item" data-comment="${c.id}">
            <span class="wa-likes" title="评论点赞">${c.likes}</span>
            <div class="wa-main">
              <h3>${WY.esc(c.body)}</h3>
              <div class="wa-meta"><span>@${WY.esc(c.author || '匿名')}</span>${c.videoTitle ? `<span>${WY.esc(c.videoTitle)}</span>` : ''}${
                c.ideaId ? `<a href="#idea-${c.ideaId}">→ 许愿 #${c.ideaId}</a>` : ''
              }</div>
              ${
                status === 'new'
                  ? `<div class="wa-inline">
                <input class="input" data-f="title" maxlength="40" placeholder="许愿标题" value="${WY.esc(c.body.slice(0, 24))}">
                <select class="select" data-f="category">${catOptions()}</select>
                <input class="input" data-f="ideaId" inputmode="numeric" placeholder="或并入许愿编号">
                <button class="btn btn-primary btn-sm" data-act="promote" type="button">转为许愿</button>
                <button class="btn btn-ghost btn-sm" data-act="dismiss" type="button">忽略</button>
              </div>`
                  : ''
              }
            </div>
          </article>`,
        )
        .join('');
    } catch (err) {
      list.innerHTML = `<div class="empty">${WY.esc(err.message)}</div>`;
    }
  }

  async function onInboxClick(e) {
    const button = e.target.closest('[data-act]');
    if (!button) return;
    const row = button.closest('[data-comment]');
    const id = row.dataset.comment;
    const field = (name) => row.querySelector(`[data-f="${name}"]`).value.trim();
    button.disabled = true;
    try {
      if (button.dataset.act === 'dismiss') {
        await WY.api(`/api/admin/comments/${id}/dismiss`, { method: 'POST' });
      } else {
        const ideaId = field('ideaId');
        const body = ideaId ? { ideaId: Number(ideaId) } : { title: field('title'), category: field('category') };
        const r = await WY.api(`/api/admin/comments/${id}/promote`, { method: 'POST', body });
        WY.toast(`已转为许愿 #${r.ideaId}，已放进许愿池`, 'success');
        changed();
      }
      row.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(12px)' }], { duration: 220, easing: 'ease-in' }).onfinish = () => {
        row.remove();
        if (!document.querySelector('#wa-list [data-comment]')) loadInbox();
      };
    } catch (err) {
      WY.toast(err.message, 'error');
      button.disabled = false;
    }
  }

  async function boot() {
    try {
      const r = await fetch('/api/admin/me', { credentials: 'same-origin' });
      if (!r.ok || !(await r.json()).authed) return;
    } catch {
      return;
    }
    importPanel();
    inboxSection();
    loadInbox();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
