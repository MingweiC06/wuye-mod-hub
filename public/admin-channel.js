/* Admin → 频道与互动: collector bookmarklet, comment inbox, videos, roadmap. */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;
  const $ = (id) => document.getElementById(id);
  let categories = [];
  let booted = false;

  const STATUS_LABEL = { open: '投票中', planned: '已采纳', building: '制作中', released: '已发布' };

  async function setupCollector() {
    const link = $('collector-link');
    try {
      const code = await (await fetch('/collector.js?v=3')).text();
      const href = `javascript:${encodeURIComponent(code.replace(/^\/\*[\s\S]*?\*\/\s*/, ''))}`;
      link.href = href;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        WY.toast('请把这个按钮拖到书签栏，再到抖音视频页点击', 'info');
      });
      $('collector-copy').addEventListener('click', () => WY.copy(href));
    } catch {
      link.textContent = '收集器加载失败';
    }
  }

  /* ---------------- import + inbox ---------------- */

  async function onImport(event) {
    event.preventDefault();
    const raw = $('import-raw').value.trim();
    if (!raw) return;
    const out = $('import-result');
    try {
      const r = await WY.api('/api/admin/comments/import', { method: 'POST', body: { raw, videoUrl: $('import-url').value.trim() } });
      out.textContent = `${r.videoAdded ? '已添加视频；' : ''}新增 ${r.added} 条评论（共识别 ${r.total} 条，重复的已合并）`;
      $('import-raw').value = '';
      loadInbox();
      if (r.videoAdded) loadVideos();
    } catch (error) {
      out.textContent = error.message;
    }
  }

  function categoryOptions() {
    return categories.map((c) => `<option value="${WY.esc(c.key)}"${c.key === 'aeon' ? ' selected' : ''}>${WY.esc(c.label)}</option>`).join('');
  }

  async function loadInbox() {
    const list = $('inbox-list');
    const status = $('inbox-status').value;
    try {
      const { items } = await WY.api(`/api/admin/comments?status=${status}`);
      if (!items.length) {
        list.innerHTML = '<div class="empty">这里空空的。去抖音视频页用收集器抓一批评论吧。</div>';
        return;
      }
      list.innerHTML = items
        .map(
          (c) => `
          <article class="idea-row" data-comment="${c.id}">
            <span class="idea-rank">${c.likes}</span>
            <div class="idea-main">
              <h3>${WY.esc(c.body)}</h3>
              <div class="idea-meta"><span>@${WY.esc(c.author || '匿名')}</span>${c.videoTitle ? `<span>${WY.esc(c.videoTitle)}</span>` : ''}${
                c.ideaId ? `<a href="/ideas#idea-${c.ideaId}">→ 许愿 #${c.ideaId}</a>` : ''
              }</div>
              ${
                status === 'new'
                  ? `<div class="admin-inline">
                <input class="input" data-f="title" maxlength="40" placeholder="许愿标题，如 繁育 · 虫群天灾" value="${WY.esc(c.body.slice(0, 24))}">
                <select class="select" data-f="category">${categoryOptions()}</select>
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
    } catch (error) {
      list.innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  async function onInboxClick(event) {
    const button = event.target.closest('[data-act]');
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
        WY.toast(`已转为许愿 #${r.ideaId}`, 'success');
      }
      row.remove();
    } catch (error) {
      WY.toast(error.message, 'error');
      button.disabled = false;
    }
  }

  /* ---------------- videos ---------------- */

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadVideos() {
    const list = $('video-list');
    try {
      const { items } = await WY.api('/api/admin/videos');
      list.innerHTML = items
        .map(
          (v) => `
          <div class="idea-row" data-video="${v.key}">
            <img class="admin-thumb" src="${WY.esc(v.cover)}" alt="" width="48" height="64">
            <div class="idea-main">
              <h3><a href="${WY.esc(WY.videoUrl(v.id))}" target="_blank" rel="noopener">${WY.esc(v.title)}</a></h3>
              <div class="idea-meta"><span>${v.featured ? '首页展示' : '往期'}</span><span>${WY.esc(v.date)}</span><span>✦ ${v.fanLikes}</span></div>
            </div>
            <label class="btn btn-ghost btn-sm">换封面<input type="file" data-cover accept="image/jpeg,image/png,image/webp" hidden></label>
            <button class="btn btn-ghost btn-sm" data-feature="${v.featured ? 0 : 1}" type="button">${v.featured ? '移到往期' : '放回首页'}</button>
            <button class="btn btn-danger btn-sm" data-del type="button">删除</button>
          </div>`,
        )
        .join('');
    } catch (error) {
      list.innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  async function onVideoList(event) {
    const row = event.target.closest('[data-video]');
    if (!row) return;
    const key = row.dataset.video;
    try {
      if (event.type === 'change' && event.target.matches('[data-cover]')) {
        const file = event.target.files[0];
        if (!file) return;
        await WY.api(`/api/admin/videos/${key}`, { method: 'PATCH', body: { coverData: await readFile(file) } });
      } else if (event.target.closest('[data-feature]')) {
        await WY.api(`/api/admin/videos/${key}`, { method: 'PATCH', body: { featured: event.target.closest('[data-feature]').dataset.feature === '1' } });
      } else if (event.target.closest('[data-del]')) {
        if (!(await WY.confirm({ title: '删除这条视频？', message: '粉丝点星也会一起删除。', okText: '删除', danger: true }))) return;
        await WY.api(`/api/admin/videos/${key}`, { method: 'DELETE' });
      } else return;
      loadVideos();
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  async function onVideoAdd(event) {
    event.preventDefault();
    const form = event.target;
    const body = { url: form.url.value, title: form.title.value, tag: form.tag.value, plays: form.plays.value, published: form.published.value };
    try {
      if (form.cover.files[0]) body.coverData = await readFile(form.cover.files[0]);
      await WY.api('/api/admin/videos', { method: 'POST', body });
      form.reset();
      WY.toast('已添加，首页已更新', 'success');
      loadVideos();
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  /* ---------------- roadmap ---------------- */

  async function loadRoadmap() {
    const box = $('roadmap-admin');
    const { items } = await WY.api('/api/admin/roadmap');
    box.innerHTML = items.length
      ? items
          .map(
            (i) => `
        <div class="admin-inline" data-road="${i.id}">
          <span class="badge badge-gold">${STATUS_LABEL[i.status] || i.status}</span>
          <strong>${WY.esc(i.title)}</strong>
          <input class="input" data-f="progress" type="number" min="0" max="100" value="${i.progress}" aria-label="进度">
          <input class="input" data-f="note" maxlength="60" value="${WY.esc(i.note)}" placeholder="进度说明，如 技能特效完成">
          <button class="btn btn-ghost btn-sm" type="button" data-save>保存</button>
        </div>`,
          )
          .join('')
      : '<div class="empty">先在「灵感审核」把许愿设为已采纳 / 制作中。</div>';
  }

  async function onRoadmapSave(event) {
    const button = event.target.closest('[data-save]');
    if (!button) return;
    const row = button.closest('[data-road]');
    try {
      await WY.api(`/api/admin/roadmap/${row.dataset.road}`, {
        method: 'PATCH',
        body: { progress: Number(row.querySelector('[data-f="progress"]').value), note: row.querySelector('[data-f="note"]').value },
      });
      WY.toast('进度已更新', 'success');
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  /* ---------------- vote cards ---------------- */

  const STATE_LABEL = { planned: '投票中', building: '制作中', released: '已完成', shelved: '暂搁置' };

  async function loadCards() {
    const box = $('cards-admin');
    const { items } = await WY.api('/api/admin/cards');
    box.innerHTML = items
      .map(
        (c) => `
      <div class="card-row" data-card="${c.id}">
        <label class="card-img" title="点击换图">
          ${c.image ? `<img src="${WY.esc(c.image)}" alt="">` : '<span>+ 图片</span>'}
          <input type="file" accept="image/jpeg,image/png,image/webp" data-card-file>
        </label>
        <div class="card-main">
          <strong>${WY.esc(c.title)}</strong>
          <span class="hint">${STATE_LABEL[c.status] || c.status} · ${c.votes} 票</span>
          <div class="card-edit">
            <input class="input" list="game-list" value="${WY.esc(c.game)}" placeholder="游戏，如 崩坏：星穹铁道" maxlength="40" data-card-game>
            <input class="input" value="${c.video ? `https://www.douyin.com/video/${WY.esc(c.video)}` : ''}" placeholder="做好后的抖音视频链接（已完成卡片会显示「看视频 →」）" data-card-video>
            <button class="btn btn-ghost btn-sm" type="button" data-card-save>保存</button>
            ${c.image ? '<button class="btn btn-ghost btn-sm" type="button" data-card-clear>去掉图片</button>' : ''}
          </div>
        </div>
      </div>`,
      )
      .join('') +
      `<datalist id="game-list">${[...new Set(items.map((c) => c.game).filter(Boolean))].map((g) => `<option value="${WY.esc(g)}">`).join('')}</datalist>`;
  }

  // shrink to <=1200px JPEG in the browser so uploads stay small
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1200 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k);
        cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(img.src);
        resolve(cv.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function saveCard(id, body, msg) {
    try {
      await WY.api(`/api/admin/cards/${id}`, { method: 'PATCH', body });
      WY.toast(msg, 'success');
      loadCards();
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  function onCardClick(event) {
    const row = event.target.closest('[data-card]');
    if (!row) return;
    if (event.target.closest('[data-card-save]')) saveCard(row.dataset.card, { game: row.querySelector('[data-card-game]').value.trim(), video: row.querySelector('[data-card-video]').value.trim() }, '已保存');
    if (event.target.closest('[data-card-clear]')) saveCard(row.dataset.card, { image: '' }, '图片已去掉');
  }

  async function onCardFile(event) {
    const input = event.target.closest('[data-card-file]');
    if (!input || !input.files[0]) return;
    const row = input.closest('[data-card]');
    try {
      saveCard(row.dataset.card, { image: await shrink(input.files[0]) }, '图片已更新');
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  /* ---------------- boot ---------------- */

  async function open() {
    if (!booted) {
      booted = true;
      try {
        categories = (await WY.site()).categories || [];
      } catch {
        categories = [];
      }
      setupCollector();
      $('import-form').addEventListener('submit', onImport);
      $('inbox-status').addEventListener('change', loadInbox);
      $('inbox-list').addEventListener('click', onInboxClick);
      $('video-form').addEventListener('submit', onVideoAdd);
      $('video-list').addEventListener('click', onVideoList);
      $('video-list').addEventListener('change', onVideoList);
      $('roadmap-admin').addEventListener('click', onRoadmapSave);
      $('cards-admin').addEventListener('click', onCardClick);
      $('cards-admin').addEventListener('change', onCardFile);
    }
    loadInbox();
    loadVideos();
    loadCards().catch((e) => WY.toast(e.message, 'error'));
    loadRoadmap().catch((e) => WY.toast(e.message, 'error'));
  }

  document.addEventListener('wy:channel', open);
})();
