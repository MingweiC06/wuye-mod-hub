/* Polls page: open / closed poll lists, single & multiple choice voting. */
(function () {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const MAX_CHOICES = 3;

  const state = {
    polls: [],
    siteStats: null,
    // 累计投票人次：初始取 /api/site 的 stats.pollVotes，之后按本场投票增量更新；
    // 取不到 site 统计时回退为列表内 totalBallots 求和。
    cumulative: null,
    submitting: new Set(),
  };

  const els = {};

  /* ---------------- small helpers ---------------- */

  function num(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatCount(value) {
    return WY.fmtNumber(num(value));
  }

  function sumBallots(polls) {
    return polls.reduce((total, poll) => total + num(poll.totalBallots), 0);
  }

  function isOpen(poll) {
    return Boolean(poll) && poll.status === 'open';
  }

  function isMultiple(poll) {
    return Boolean(poll.allowMultiple);
  }

  function optionsOf(poll) {
    return Array.isArray(poll.options) ? poll.options : [];
  }

  function myVotes(poll) {
    return Array.isArray(poll.myVote) ? poll.myVote.map(String) : [];
  }

  function getPoll(id) {
    return state.polls.find((poll) => String(poll.id) === String(id)) || null;
  }

  function optionAriaLabel(option) {
    const parts = [option.label];
    if (option.description) parts.push(option.description);
    return parts.join('，');
  }

  function pollName(poll) {
    return `poll-${poll.id}`;
  }

  function pollTitleId(poll) {
    return `poll-title-${poll.id}`;
  }

  function cardFor(id) {
    return document.querySelector(`.poll[data-poll-id="${String(id)}"]`);
  }

  function optionPercent(poll, option) {
    return WY.pollPercent(poll, option);
  }

  function resultsVisible(poll) {
    return !isOpen(poll) || myVotes(poll).length > 0;
  }

  /* ---------------- markup ---------------- */

  function optionInput(poll, option) {
    return `
      <label class="poll-option${isMultiple(poll) ? ' is-multi' : ''}">
        <input class="poll-input sr-only" type="${isMultiple(poll) ? 'checkbox' : 'radio'}"
          name="${WY.esc(pollName(poll))}" value="${num(option.id)}"
          aria-label="${WY.esc(optionAriaLabel(option))}" data-poll-option>
        <span class="poll-check" aria-hidden="true"></span>
        <span class="poll-label">${WY.esc(option.label)}${
          option.description ? `<small>${WY.esc(option.description)}</small>` : ''
        }</span>
      </label>`;
  }

  function optionResult(poll, option) {
    const selected = myVotes(poll).includes(String(option.id));
    const percent = optionPercent(poll, option);
    const details = [];
    if (option.description) details.push(option.description);
    details.push(`${formatCount(option.votes)} 票`);
    return `
      <div class="poll-option is-disabled${selected ? ' is-selected' : ''}${isMultiple(poll) ? ' is-multi' : ''}">
        <span class="bar" data-percent="${percent}" aria-hidden="true"></span>
        <span class="poll-check" aria-hidden="true"></span>
        <span class="poll-label">${WY.esc(option.label)}<small>${WY.esc(details.join(' · '))}</small></span>
        <span class="poll-pct">${percent}%</span>
      </div>`;
  }

  function formPanel(poll) {
    const multiple = isMultiple(poll);
    return `
      <form class="poll-form" data-poll-id="${poll.id}" novalidate>
        <div class="poll-options" role="${multiple ? 'group' : 'radiogroup'}" aria-labelledby="${pollTitleId(poll)}">
          ${optionsOf(poll).map((option) => optionInput(poll, option)).join('')}
        </div>
        <div class="poll-foot">
          <span class="poll-note" data-poll-note>${
            multiple ? '最多选 3 项，投出后不可修改。' : '一人一票，投出后不可修改。'
          }</span>
          <button class="btn btn-primary" type="submit" data-submit disabled>确认投票</button>
        </div>
      </form>`;
  }

  function resultPanel(poll) {
    const voted = myVotes(poll).length > 0;
    const chosen = optionsOf(poll)
      .filter((option) => myVotes(poll).includes(String(option.id)))
      .map((option) => WY.esc(option.label));
    let note = '';
    if (chosen.length) {
      note = `你投给了：${chosen.join('、')}`;
    } else if (isOpen(poll)) {
      note = '结果已锁定。';
    } else {
      note = '这次投票已经结束。';
    }
    return `
      <div class="poll-options" aria-label="投票结果">
        ${optionsOf(poll).map((option) => optionResult(poll, option)).join('')}
      </div>
      <p class="poll-result-total">
        共 <b>${formatCount(poll.totalBallots)}</b> 人参与，合计 <b>${formatCount(poll.totalVotes)}</b> 张选票${
          isMultiple(poll) ? '；多选百分比按参与人数计算' : ''
        }。
      </p>
      <div class="poll-foot">
        <span class="poll-note">${note}${voted && isOpen(poll) ? ' 每个设备只能投一次。' : ''}</span>
      </div>`;
  }

  function openPollCard(poll) {
    const voted = myVotes(poll).length > 0;
    const showResults = resultsVisible(poll);
    return `
      <article class="poll${showResults ? ' is-result' : ''}${voted ? ' is-voted' : ''}" data-poll-id="${poll.id}">
        <div class="poll-head">
          <div>
            <h3 id="${pollTitleId(poll)}">${WY.esc(poll.title)}${WY.newBadge(poll.createdAt, 'in-title')}</h3>
            ${poll.description ? `<p class="poll-desc">${WY.esc(poll.description)}</p>` : ''}
          </div>
          <span class="badge badge-cyan">进行中</span>
        </div>
        <div class="poll-meta">
          <span class="badge badge-muted">${isMultiple(poll) ? '多选 · 最多 3 项' : '单选'}</span>
          <span>共 <b>${formatCount(poll.totalBallots)}</b> 人投票</span>
          <span class="countdown" data-countdown="${poll.id}"></span>
          ${voted ? '<span class="badge badge-green">已投票</span>' : ''}
          <span>发起于 ${WY.esc(WY.timeAgo(poll.createdAt))}</span>
        </div>
        ${showResults ? resultPanel(poll) : formPanel(poll)}
      </article>`;
  }

  function closedPollCard(poll) {
    return `
      <article class="poll is-closed is-result" data-poll-id="${poll.id}">
        <div class="poll-head">
          <div>
            <h3 id="${pollTitleId(poll)}">${WY.esc(poll.title)}</h3>
            ${poll.description ? `<p class="poll-desc">${WY.esc(poll.description)}</p>` : ''}
          </div>
          <span class="badge badge-muted">已结束</span>
        </div>
        <div class="poll-meta">
          <span class="badge badge-muted">${isMultiple(poll) ? '多选 · 最多 3 项' : '单选'}</span>
          <span>共 <b>${formatCount(poll.totalBallots)}</b> 人投票</span>
          ${poll.endsAt ? `<span>结束于 ${WY.esc(WY.formatDateTime(poll.endsAt))}</span>` : '<span>已结束</span>'}
          <span>发起于 ${WY.esc(WY.timeAgo(poll.createdAt))}</span>
        </div>
        ${resultPanel(poll)}
      </article>`;
  }

  function emptyState(icon, title, text, link) {
    return `
      <div class="empty">
        <span class="empty-icon" aria-hidden="true">${icon}</span>
        <strong>${title}</strong>
        ${text}${link ? ` <a class="link-arrow" href="${WY.esc(link.href)}">${WY.esc(link.label)}</a>` : ''}
      </div>`;
  }

  /* ---------------- painting ---------------- */

  function paintBars(root) {
    $$('.bar[data-percent]', root).forEach((bar) => {
      const percent = Math.min(100, Math.max(0, num(bar.dataset.percent)));
      bar.style.width = `${percent}%`;
    });
  }

  function wireOpenPoll(poll) {
    const card = cardFor(poll.id);
    if (!card) return;
    paintBars(card);
    const countdown = $('[data-countdown]', card);
    if (countdown) WY.countdown(countdown, poll.endsAt, { endedText: '已结束' });
  }

  function renderOpenList() {
    const polls = state.polls.filter(isOpen);
    if (!polls.length) {
      els.openList.innerHTML = emptyState(
        '◷',
        '暂时没有进行中的投票',
        '等站长发起下一场票选吧，先去许愿池留下你的灵感。',
        { href: '/ideas', label: '去许愿池' },
      );
      return;
    }
    els.openList.innerHTML = polls.map((poll) => openPollCard(poll)).join('');
    polls.forEach((poll) => wireOpenPoll(poll));
  }

  function renderClosedList() {
    const polls = state.polls.filter((poll) => !isOpen(poll));
    if (!polls.length) {
      els.closedList.innerHTML = emptyState(
        '◷',
        '还没有已结束的投票',
        '等第一场投票封箱后，结果会显示在这里。',
      );
      return;
    }
    els.closedList.innerHTML = polls.map((poll) => closedPollCard(poll)).join('');
    paintBars(els.closedList);
  }

  function renderLists() {
    renderOpenList();
    renderClosedList();
  }

  function renderStats() {
    const openCount = state.polls.filter(isOpen).length;
    const ballots = Number.isFinite(state.cumulative) ? state.cumulative : sumBallots(state.polls);
    els.statsOpen.textContent = formatCount(openCount);
    els.statsBallots.textContent = formatCount(Math.max(0, ballots));
  }

  /* ---------------- state / chrome ---------------- */

  function showLoading() {
    hideError();
    els.openSection.hidden = false;
    els.closedSection.hidden = false;
    const skeleton = '<div class="poll skeleton skeleton-poll" aria-hidden="true"></div>';
    els.openList.innerHTML = skeleton + skeleton;
    els.closedList.innerHTML = skeleton;
  }

  function hideError() {
    els.error.hidden = true;
  }

  function showError(error) {
    els.openSection.hidden = true;
    els.closedSection.hidden = true;
    els.error.hidden = false;
    els.errorMessage.textContent = (error && error.message) || '请检查网络后重试。';
  }

  async function load(options = {}) {
    if (!options.silent) showLoading();
    try {
      const [pollData, siteData] = await Promise.all([
        WY.api('/api/polls'),
        WY.site().catch(() => null),
      ]);
      const items = pollData && Array.isArray(pollData.items) ? pollData.items : [];
      state.polls = items;
      state.siteStats = siteData && siteData.stats ? siteData.stats : null;
      const siteBallots = state.siteStats ? Number(state.siteStats.pollVotes) : NaN;
      state.cumulative = Number.isFinite(siteBallots) ? siteBallots : null;
      renderLists();
      renderStats();
      els.openSection.hidden = false;
      els.closedSection.hidden = false;
      hideError();
    } catch (error) {
      showError(error);
    }
  }

  /* ---------------- voting ---------------- */

  function syncOptionState(card) {
    $$('.poll-option', card).forEach((label) => {
      const input = $('input[data-poll-option]', label);
      if (input) label.classList.toggle('is-selected', input.checked);
    });
  }

  function updateSubmitState(card, poll) {
    const button = $('[data-submit]', card);
    const checked = $$('input[data-poll-option]:checked', card).length;
    if (button) {
      button.disabled = checked === 0 || state.submitting.has(String(poll.id));
    }
  }

  function updateNote(card, poll) {
    const note = $('[data-poll-note]', card);
    if (!note) return;
    note.classList.remove('is-warn');
    if (!isMultiple(poll)) {
      const checked = $$('input[data-poll-option]:checked', card).length;
      note.textContent = checked ? '已选择 1 项，提交后不可修改。' : '一人一票，投出后不可修改。';
      return;
    }
    const checked = $$('input[data-poll-option]:checked', card).length;
    if (checked === 0) {
      note.textContent = `最多选 ${MAX_CHOICES} 项，投出后不可修改。`;
    } else if (checked >= MAX_CHOICES) {
      note.textContent = `已选满 ${MAX_CHOICES} 项，不能再多选啦。`;
      note.classList.add('is-warn');
    } else {
      note.textContent = `已选 ${checked} 项，还可以再选 ${MAX_CHOICES - checked} 项。`;
    }
  }

  function onOptionChange(event) {
    const input = event.target.closest('input[data-poll-option]');
    if (!input) return;
    const card = input.closest('.poll');
    if (!card) return;
    const poll = getPoll(card.dataset.pollId);
    if (!poll || !isOpen(poll)) return;

    if (isMultiple(poll)) {
      const checked = $$('input[data-poll-option]:checked', card);
      if (checked.length > MAX_CHOICES) {
        input.checked = false;
        syncOptionState(card);
        updateSubmitState(card, poll);
        const note = $('[data-poll-note]', card);
        if (note) {
          note.textContent = `最多只能选 ${MAX_CHOICES} 项，请先取消一项再选。`;
          note.classList.add('is-warn');
        }
        WY.toast(`最多只能选择 ${MAX_CHOICES} 个选项`, 'error');
        return;
      }
    }

    syncOptionState(card);
    updateNote(card, poll);
    updateSubmitState(card, poll);
  }

  async function refreshPoll(id) {
    try {
      const data = await WY.api('/api/polls');
      const items = data && Array.isArray(data.items) ? data.items : [];
      state.polls = items;
      state.cumulative = null;
      renderLists();
      renderStats();
      const card = cardFor(id);
      if (card) {
        const heading = $('h3', card);
        if (heading) {
          heading.tabIndex = -1;
          heading.focus({ preventScroll: true });
        }
      }
    } catch (error) {
      WY.toast(error.message || '刷新投票失败，请稍后重试', 'error');
    }
  }

  function replacePollAfterVote(updated) {
    const index = state.polls.findIndex((poll) => String(poll.id) === String(updated.id));
    const previous = index >= 0 ? state.polls[index] : null;
    if (index >= 0) state.polls[index] = updated;
    if (!previous) {
      renderLists();
      return;
    }
    if (isOpen(previous) && isOpen(updated)) {
      const card = cardFor(updated.id);
      if (!card) {
        renderLists();
        return;
      }
      card.outerHTML = openPollCard(updated);
      wireOpenPoll(updated);
      return;
    }
    renderLists();
  }

  async function onSubmit(event) {
    const form = event.target.closest('form[data-poll-id]');
    if (!form) return;
    event.preventDefault();
    const poll = getPoll(form.dataset.pollId);
    if (!poll || !isOpen(poll)) return;
    const pollId = String(poll.id);
    if (state.submitting.has(pollId)) return;

    const optionIds = $$('input[data-poll-option]:checked', form).map((input) => Number(input.value));
    if (!optionIds.length) {
      WY.toast('请选择要投的选项', 'error');
      return;
    }
    if (!isMultiple(poll) && optionIds.length !== 1) {
      WY.toast('这次投票只能选一个选项', 'error');
      return;
    }
    if (isMultiple(poll) && optionIds.length > MAX_CHOICES) {
      WY.toast(`最多选择 ${MAX_CHOICES} 个选项`, 'error');
      return;
    }

    state.submitting.add(pollId);
    const button = $('[data-submit]', form);
    if (button) {
      button.disabled = true;
      button.textContent = '提交中…';
    }
    form.setAttribute('aria-busy', 'true');

    try {
      const data = await WY.api(`/api/polls/${poll.id}/vote`, {
        method: 'POST',
        body: { optionIds },
      });
      if (!data || !data.poll) {
        await load({ silent: true });
        return;
      }
      const updated = data.poll;
      const before = getPoll(pollId);
      const delta = num(updated.totalBallots) - num(before ? before.totalBallots : poll.totalBallots);
      if (Number.isFinite(state.cumulative)) {
        state.cumulative = Math.max(0, state.cumulative + delta);
      }
      replacePollAfterVote(updated);
      renderStats();
      WY.toast('投票成功，感谢参与！', 'success');
      const heading = document.getElementById(pollTitleId(updated));
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    } catch (error) {
      if (error.status === 409) {
        WY.toast(error.message, 'error');
        await refreshPoll(poll.id);
      } else {
        WY.toast(error.message || '投票失败，请稍后重试', 'error');
      }
    } finally {
      state.submitting.delete(pollId);
      const currentForm = document.querySelector(`form[data-poll-id="${pollId}"]`);
      if (currentForm) {
        currentForm.removeAttribute('aria-busy');
        const currentButton = $('[data-submit]', currentForm);
        if (currentButton) currentButton.textContent = '确认投票';
        const card = currentForm.closest('.poll');
        const currentPoll = getPoll(pollId);
        if (card && currentPoll) {
          updateSubmitState(card, currentPoll);
          updateNote(card, currentPoll);
        }
      }
    }
  }

  /* ---------------- boot ---------------- */

  function bindEvents() {
    els.openList.addEventListener('change', onOptionChange);
    els.openList.addEventListener('submit', onSubmit);
    els.retry.addEventListener('click', () => load());
  }

  function cacheElements() {
    els.openList = $('#open-list');
    els.closedList = $('#closed-list');
    els.openSection = $('#open-section');
    els.closedSection = $('#closed-section');
    els.error = $('#polls-error');
    els.errorMessage = $('#polls-error-message');
    els.retry = $('#polls-retry');
    els.statsOpen = $('#stats-open');
    els.statsBallots = $('#stats-ballots');
  }

  function init() {
    cacheElements();
    if (!els.openList || !els.closedList) return;
    bindEvents();
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
