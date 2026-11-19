/* 乌叶MC 评论收集器 — run on a douyin.com video page (bookmarklet).
   Scrolls the comment list a few times, reads visible comments, and shows
   them as JSON to copy into 管理后台 → 评论收件箱. Sends nothing anywhere. */
(async () => {
  const id = (location.href.match(/(?:video\/|modal_id=)(\d{15,22})/) || [])[1] || '';
  const seen = new Map();
  const grab = () => {
    document.querySelectorAll('[data-e2e="comment-item"]').forEach((el) => {
      const info = el.querySelector('.comment-item-info-wrap');
      const author = (info && info.querySelector('a') ? info.querySelector('a').innerText : '').trim();
      const bodyEl = info && info.nextElementSibling;
      const text = (bodyEl ? bodyEl.innerText : '').trim();
      const stats = el.querySelector('.comment-item-stats-container');
      const raw = stats ? (stats.innerText.match(/[\d.]+万?/) || ['0'])[0] : '0';
      const likes = raw.endsWith('万') ? Math.round(parseFloat(raw) * 10000) : parseInt(raw, 10) || 0;
      if (text) seen.set(author + '|' + text, { author, text, likes });
    });
  };
  for (let i = 0; i < 8; i += 1) {
    grab();
    const list = document.querySelector('[data-e2e="comment-list"]');
    const last = list && list.querySelector('[data-e2e="comment-item"]:last-of-type');
    if (last) last.scrollIntoView({ block: 'end' });
    else window.scrollBy(0, 1500);
    await new Promise((r) => setTimeout(r, 900));
  }
  grab();
  const items = [...seen.values()].sort((a, b) => b.likes - a.likes);
  const q = (sel) => document.querySelector(sel);
  const txt = (sel) => (q(sel) ? q(sel).innerText.trim() : '');
  const h1 = q('[data-e2e="detail-video-info"] h1');
  const rawTitle = (h1 ? h1.innerText : document.title.replace(/\s*-\s*抖音\s*$/, '')).replace(/#\S+/g, '').trim();
  const video = id
    ? {
        id,
        title: rawTitle.replace(/^第\d+集\s*\|\s*/, '').split(/\s*《/)[0].slice(0, 60),
        series: ((rawTitle.match(/《[^》]+》/) || [''])[0]).slice(0, 40),
        likes: txt('[data-e2e="video-player-digg"]').split('\n')[0],
        published: (txt('[data-e2e="detail-video-publish-time"]').match(/(\d{4}-)?(\d{2}-\d{2})/) || [])[2] || '',
        cover: (q('video') && q('video').poster) || (q('meta[property="og:image"]') || {}).content || '',
      }
    : null;
  const json = JSON.stringify({ wuye: 1, video, comments: items });
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:auto 16px 16px auto;z-index:2147483647;width:min(420px,90vw);background:#0b0a12;color:#f3e9c8;border:1px solid #c9a24a;padding:14px;font:14px/1.5 sans-serif;box-shadow:0 20px 60px #000';
  box.innerHTML = '<b>乌叶MC 评论收集器</b><div>收集到 ' + items.length + ' 条评论' + (id ? '（视频 ' + id + '）' : '') + '</div>';
  const ta = document.createElement('textarea');
  ta.value = json;
  ta.style.cssText = 'width:100%;height:120px;margin:8px 0;background:#000;color:#ddd;border:1px solid #444';
  const btn = document.createElement('button');
  btn.textContent = '复制并关闭';
  btn.style.cssText = 'background:#c9a24a;color:#000;border:0;padding:6px 14px;cursor:pointer';
  btn.onclick = async () => {
    ta.select();
    try { await navigator.clipboard.writeText(json); } catch { document.execCommand('copy'); }
    box.remove();
  };
  box.append(ta, btn);
  document.body.append(box);
  window.__wyCollected = items;
})();
