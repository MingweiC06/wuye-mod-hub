/* Home page: latest videos, comment picks, hot wishes, poll preview. */
(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  /* ---------------- hero poster ---------------- */

  function setupShowcase(videos) {
    const video = videos[0];
    if (!video) return;
    const cover = $('#showcase-cover');
    if (cover) {
      cover.src = video.cover;
      cover.alt = `${video.title} 封面`;
    }
    const bg = $('#hero-bg');
    if (bg) bg.src = video.cover;
    const card = $('#showcase');
    if (card) card.href = WY.videoUrl(video.id);
    const title = $('#showcase-title');
    if (title) title.textContent = video.title;
    const meta = $('#showcase-meta');
    if (meta) meta.textContent = [video.series, video.plays && `${video.plays} 播放`, video.date].filter(Boolean).join(' · ');
  }

  /* ---------------- latest video cards ---------------- */

  function renderVideos(videos) {
    const grid = $('#video-grid');
    if (!grid) return;
    if (!videos.length) {
      grid.innerHTML = '<div class="empty"><strong>还没有作品</strong>去抖音主页看看吧。</div>';
      return;
    }
    grid.innerHTML = videos
      .map((video, index) => {
        const url = WY.esc(WY.videoUrl(video.id));
        return `
        <article class="cx-work reveal">
          <a class="cx-work-cover" href="${url}" target="_blank" rel="noopener" aria-label="${WY.esc(`${video.title}，在抖音观看`)}">
            <img src="${WY.esc(video.cover)}" alt="" loading="${index < 2 ? 'eager' : 'lazy'}" width="323" height="430">
            <span class="cx-work-num">${ROMAN[index] || index + 1}</span>
            ${video.plays ? `<span class="cx-work-plays">${WY.esc(video.plays)} 播放</span>` : ''}
          </a>
          ${video.tag ? `<span class="tag">${WY.esc(video.tag)}</span>` : ''}
          <h3><a href="${url}" target="_blank" rel="noopener">${WY.esc(video.title)}</a></h3>
          <div class="cx-work-foot">
            <span>${WY.esc(video.date || '')}</span>
            <button class="cx-like${video.liked ? ' is-on' : ''}" type="button" data-like="${video.key}" aria-pressed="${video.liked ? 'true' : 'false'}" aria-label="给这期点星">✦ <b>${WY.fmtNumber(video.fanLikes || 0)}</b></button>
          </div>
        </article>`;
      })
      .join('');
    grid.addEventListener('click', onLikeClick);
  }

  async function onLikeClick(event) {
    const button = event.target.closest('[data-like]');
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      const data = await WY.api(`/api/videos/${button.dataset.like}/like`, { method: 'POST' });
      button.classList.toggle('is-on', data.liked);
      button.setAttribute('aria-pressed', String(data.liked));
      button.querySelector('b').textContent = WY.fmtNumber(data.fanLikes);
    } catch (error) {
      WY.toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function renderCommentPicks(picks) {
    const row = $('#comment-picks');
    if (!row || !picks || !picks.length) return;
    const html = picks.map((pick) => `<a href="/ideas?q=${encodeURIComponent(pick.q)}">${WY.esc(pick.label)}</a>`).join('');
    row.innerHTML = html + html.replace(/<a /g, '<a aria-hidden="true" tabindex="-1" ');
  }

  /* ---------------- roadmap ---------------- */

  const STAGE = { planned: 'PLANNED · 已采纳', building: 'BUILDING · 制作中', released: 'RELEASED · 已发布' };

  async function loadRoadmap() {
    const track = $('#roadmap-track');
    if (!track) return;
    try {
      const { items } = await WY.api('/api/roadmap');
      if (!items.length) {
        track.innerHTML = '<div class="empty">站长还没有公布制作进度，先去许愿池投票吧。</div>';
        return;
      }
      track.innerHTML = items
        .map(
          (item) => `
          <div class="cx-node" data-status="${WY.esc(item.status)}">
            <small>${STAGE[item.status] || ''}</small>
            <h3>${WY.esc(item.title)}</h3>
            <div class="cx-node-bar"><i data-w="${item.progress}"></i></div>
            <p>${item.note ? WY.esc(item.note) + ' · ' : ''}${item.progress}%</p>
          </div>`,
        )
        .join('');
      track.querySelectorAll('[data-w]').forEach((bar) => {
        bar.style.width = `${bar.dataset.w}%`;
      });
    } catch (error) {
      track.innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  function renderPast(videos) {
    const rail = $('#past-rail');
    if (!rail) return;
    if (!videos.length) {
      rail.innerHTML = '<div class="empty">暂时没有往期内容。</div>';
      return;
    }
    rail.innerHTML = videos
      .map(
        (video) => `
        <a class="rail-card" href="${WY.esc(WY.videoUrl(video.id))}" target="_blank" rel="noopener">
          <img src="${WY.esc(video.cover)}" alt="${WY.esc(video.title)} 封面" loading="lazy" width="323" height="430">
          <span class="rail-cap"><strong>${WY.esc(video.title)}</strong><small>${WY.esc(video.tag)} · ${WY.esc(
            video.plays,
          )} 播放</small></span>
        </a>`,
      )
      .join('');
  }

  /* ---------------- hot wishes ---------------- */

  function ideaRow(idea, rank) {
    const category = WY.categoryMeta(idea.category);
    const status = WY.statusMeta(idea.status);
    const showStatus = idea.status && idea.status !== 'pending';
    return `
      <article class="idea-row">
        <span class="idea-rank">${String(rank).padStart(2, '0')}</span>
        <div class="idea-main">
          <h3><a href="/ideas#idea-${idea.id}">${WY.esc(idea.title)}</a></h3>
          <div class="idea-meta">
            <span class="badge badge-cyan">${WY.esc(category.icon)} ${WY.esc(category.label)}</span>
            ${showStatus ? `<span class="badge ${WY.statusBadgeClass(idea.status)}">${WY.esc(status.label)}</span>` : ''}
            <span>by ${WY.esc(idea.author)}</span>
            <span>${WY.timeAgo(idea.createdAt)}</span>
          </div>
        </div>
        <button class="idea-vote${idea.voted ? ' is-voted' : ''}" type="button" data-idea-id="${idea.id}" aria-pressed="${
          idea.voted ? 'true' : 'false'
        }" aria-label="${idea.voted ? '取消投票' : '投票'}：${WY.esc(idea.title)}">
          <span aria-hidden="true">♥</span><b>${WY.fmtNumber(idea.votes)}</b>
        </button>
      </article>`;
  }

  async function loadHotIdeas() {
    const list = $('#hot-idea-list');
    if (!list) return;
    try {
      const data = await WY.api('/api/ideas?sort=hot&pageSize=5');
      if (!data.items.length) {
        list.innerHTML = '<div class="empty"><span class="empty-icon">✦</span><strong>还没有人许愿</strong>成为第一个写下灵感的人吧。</div>';
        return;
      }
      list.innerHTML = data.items.map((idea, index) => ideaRow(idea, index + 1)).join('');
      list.addEventListener('click', onVoteClick);
    } catch (error) {
      list.innerHTML = `<div class="empty"><strong>许愿池加载失败</strong>${WY.esc(error.message)}</div>`;
    }
  }

  async function onVoteClick(event) {
    const button = event.target.closest('[data-idea-id]');
    if (!button || button.disabled) return;
    const id = button.dataset.ideaId;
    const voted = button.classList.contains('is-voted');
    const countNode = button.querySelector('b');
    button.disabled = true;
    try {
      const data = await WY.api(`/api/ideas/${id}/vote`, { method: voted ? 'DELETE' : 'POST' });
      button.classList.toggle('is-voted', Boolean(data.voted));
      button.setAttribute('aria-pressed', String(Boolean(data.voted)));
      button.setAttribute('aria-label', `${data.voted ? '取消投票' : '投票'}：${button.closest('.idea-row').querySelector('h3').textContent.trim()}`);
      if (countNode) countNode.textContent = WY.fmtNumber(data.votes);
    } catch (error) {
      WY.toast(error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  /* ---------------- poll preview ---------------- */

  function renderPollPreview(poll) {
    const slot = $('#poll-preview-slot');
    if (!slot) return;
    if (!poll) {
      slot.innerHTML = '<div class="empty"><span class="empty-icon">◷</span><strong>暂时没有进行中的投票</strong>等站长发起下一次票选吧。</div>';
      return;
    }
    const open = poll.status === 'open';
    const options = poll.options
      .slice()
      .sort((a, b) => b.votes - a.votes)
      .map((option) => {
        const percent = WY.pollPercent(poll, option);
        return `
          <div class="poll-option is-disabled" aria-label="${WY.esc(option.label)}：${percent}%">
            <span class="bar" data-percent="${percent}"></span>
            <span class="poll-check" aria-hidden="true"></span>
            <span class="poll-label">${WY.esc(option.label)}${option.description ? `<small>${WY.esc(option.description)}</small>` : ''}</span>
            <span class="poll-pct">${percent}%</span>
          </div>`;
      })
      .join('');
    slot.innerHTML = `
      <article class="poll">
        <div class="poll-head">
          <div>
            <h3>${WY.esc(poll.title)}</h3>
            ${poll.description ? `<p class="poll-desc">${WY.esc(poll.description)}</p>` : ''}
          </div>
          <span class="badge ${open ? 'badge-cyan' : 'badge-muted'}">${open ? '进行中' : '已结束'}</span>
        </div>
        <div class="poll-meta">
          <span>共 <b>${WY.fmtNumber(poll.totalBallots)}</b> 人投票</span>
          <span>${poll.allowMultiple ? '最多选 3 项' : '单选'}</span>
          ${open ? '<span class="countdown" data-countdown></span>' : '<span>已封箱</span>'}
        </div>
        <div class="poll-options">${options}</div>
        <div class="poll-foot">
          <span class="poll-note">${open ? '一人一票，投了就不能改哦。' : '这次已经结束，去投票页看往期结果。'}</span>
          <a class="btn btn-primary btn-sm" href="/polls">${open ? '去投票' : '看全部投票'}</a>
        </div>
      </article>`;
    slot.querySelectorAll('.bar[data-percent]').forEach((bar) => {
      bar.style.width = `${bar.dataset.percent}%`;
    });
    const countdown = slot.querySelector('[data-countdown]');
    if (countdown && open) WY.countdown(countdown, poll.endsAt);
  }

  async function loadPollPreview() {
    try {
      const data = await WY.api('/api/polls');
      const openPoll = data.items.find((poll) => poll.status === 'open');
      renderPollPreview(openPoll || data.items[0] || null);
    } catch (error) {
      const slot = $('#poll-preview-slot');
      if (slot) slot.innerHTML = `<div class="empty"><strong>投票加载失败</strong>${WY.esc(error.message)}</div>`;
    }
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    try {
      const data = await WY.site();
      renderVideos(data.videos || []);
      const fans = document.querySelector('[data-fans]');
      if (fans && data.site && data.site.fans) fans.textContent = data.site.fans;
      renderCommentPicks(data.commentPicks || []);
      renderPast(data.pastVideos || []);
      setupShowcase(data.videos || []);
      if (WY.observeReveal) WY.observeReveal();
    } catch {
      const grid = $('#video-grid');
      if (grid) grid.innerHTML = '<div class="empty"><strong>最新作品加载失败</strong>请刷新重试，或直接去抖音主页观看。</div>';
    }
    loadHotIdeas();
    loadPollPreview();
    loadRoadmap();
    if (WY.mountBoard) WY.mountBoard($('#board'), $('#nick-form'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
