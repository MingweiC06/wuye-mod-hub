/* ==========================================================================
   乌叶MC · 模组许愿池 — shared front-end helpers (window.WY)
   No frameworks, no external requests. All DOM text is escaped before render.
   ========================================================================== */
(function () {
  'use strict';

  const WY = (window.WY = {});
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /* ---------------- storage ---------------- */

  const memoryStore = new Map();
  const storage = {
    get(key) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memoryStore.get(key) ?? null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memoryStore.set(key, value);
      }
    },
  };

  function randomHex(bytes) {
    const buffer = new Uint8Array(bytes);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buffer);
    } else {
      for (let i = 0; i < bytes; i += 1) buffer[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /* One device = one vote bucket. Short random id, 180 天滑动有效期（见 device-id.js）。 */
  const deviceInfo = window.WYDeviceId ? window.WYDeviceId.current() : null;
  let deviceId = deviceInfo ? deviceInfo.id : storage.get('wy:device');
  if (!/^[a-z0-9-]{10,64}$/.test(deviceId || '')) {
    deviceId = `d-${randomHex(12)}`;
    storage.set('wy:device', deviceId);
  }
  WY.deviceId = deviceId;
  WY.deviceRotated = Boolean(deviceInfo && deviceInfo.rotated);

  /* ---------------- text / number helpers ---------------- */

  WY.esc = function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
  };

  WY.fmtNumber = function fmtNumber(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) < 10000) return number.toLocaleString('zh-CN');
    const tenThousands = number / 10000;
    return `${tenThousands >= 100 ? Math.round(tenThousands) : tenThousands.toFixed(1).replace(/\.0$/, '')}万`;
  };

  WY.formatDateTime = function formatDateTime(timestamp) {
    const date = new Date(Number(timestamp) + 8 * 3600_000);
    return date.toISOString().slice(0, 16).replace('T', ' ');
  };

  /** 新加入 badge for anything that appeared in the last 7 days. */
  WY.NEW_DAYS = 7;
  WY.isNew = (ms) => Number(ms) > 0 && Date.now() - Number(ms) < WY.NEW_DAYS * 86400000;
  WY.newBadge = (ms, extra) => (WY.isNew(ms) ? '<span class="new-badge' + (extra ? ' ' + extra : '') + '">新加入</span>' : '');

  WY.timeAgo = function timeAgo(timestamp) {
    const seconds = Math.max(0, (Date.now() - Number(timestamp)) / 1000);
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
    return WY.formatDateTime(timestamp).slice(0, 10);
  };

  WY.remaining = function remaining(endTimestamp) {
    if (!endTimestamp) return { ended: false, text: '长期开放' };
    const diff = Number(endTimestamp) - Date.now();
    if (diff <= 0) return { ended: true, text: '已结束' };
    const days = Math.floor(diff / 86400_000);
    const hours = Math.floor((diff % 86400_000) / 3600_000);
    const minutes = Math.floor((diff % 3600_000) / 60_000);
    if (days > 0) return { ended: false, text: `还剩 ${days} 天 ${hours} 小时` };
    if (hours > 0) return { ended: false, text: `还剩 ${hours} 小时 ${minutes} 分` };
    return { ended: false, text: `还剩 ${minutes} 分钟` };
  };

  const countdownTimers = new Map();
  WY.countdown = function countdown(element, endTimestamp, options = {}) {
    if (!element) return;
    const previous = countdownTimers.get(element);
    if (previous) clearInterval(previous);
    const stop = () => {
      clearInterval(countdownTimers.get(element));
      countdownTimers.delete(element);
    };
    function tick() {
      // Removed from the page, or finished: stop ticking for good.
      if (!element.isConnected) return stop();
      const info = WY.remaining(endTimestamp);
      element.textContent = info.ended ? options.endedText || '已结束' : info.text;
      if (info.ended) stop();
    }
    // Register the timer first, so tick() can always find and clear it.
    countdownTimers.set(element, setInterval(tick, 30_000));
    tick();
  };

  WY.debounce = function debounce(fn, wait = 250) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  /* ---------------- API ---------------- */

  WY.api = async function api(pathname, options = {}) {
    const method = options.method || 'GET';
    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'X-Device-Id': WY.deviceId,
      ...(options.headers || {}),
    };
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    let response;
    try {
      response = await fetch(pathname, {
        method,
        headers,
        body,
        credentials: 'same-origin',
        signal: options.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      const networkError = new Error('网络好像开小差了，请检查网络后重试');
      networkError.cause = error;
      throw networkError;
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = new Error(data?.error?.message || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = data?.error?.code || 'http_error';
      throw error;
    }
    // 提交成功后滑动续期设备标识（与服务器 wy_vid 的续期时机一致）。
    if (method !== 'GET' && window.WYDeviceId) window.WYDeviceId.touch();
    return data;
  };

  let sitePromise = null;
  WY.site = function site() {
    if (!sitePromise) {
      sitePromise = WY.api('/api/site').catch((error) => {
        sitePromise = null;
        throw error;
      });
    }
    return sitePromise;
  };

  WY.categoryMeta = function categoryMeta(key) {
    const categories = (WY._site && WY._site.categories) || [];
    return categories.find((category) => category.key === key) || { key, label: key, icon: '✧' };
  };

  WY.statusMeta = function statusMeta(key) {
    const statuses = (WY._site && WY._site.statuses) || [];
    return statuses.find((status) => status.key === key) || { key, label: key, icon: '•' };
  };

  WY.statusBadgeClass = function statusBadgeClass(key) {
    switch (key) {
      case 'building':
        return 'badge-cyan';
      case 'planned':
        return 'badge-green';
      case 'released':
        return 'badge-gold';
      case 'shelved':
        return 'badge-muted';
      default:
        return 'badge-muted';
    }
  };

  WY.videoUrl = function videoUrl(id) {
    return `https://www.douyin.com/video/${encodeURIComponent(String(id).replace(/\D/g, ''))}`;
  };

  WY.pollPercent = function pollPercent(poll, option) {
    const total = Number(poll?.totalBallots) || 0;
    if (!total) return 0;
    return Math.round((Number(option.votes) / total) * 100);
  };

  /* ---------------- toast ---------------- */

  let toastStack = null;
  WY.toast = function toast(message, type = '', timeout = 3400) {
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.className = 'toast-stack';
      toastStack.setAttribute('role', 'status');
      toastStack.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastStack);
    }
    const node = document.createElement('div');
    node.className = `toast${type ? ` is-${type}` : ''}`;
    node.textContent = message;
    toastStack.appendChild(node);
    const remove = () => {
      node.classList.add('leaving');
      setTimeout(() => node.remove(), 240);
    };
    const timer = setTimeout(remove, timeout);
    node.addEventListener('click', () => {
      clearTimeout(timer);
      remove();
    });
  };

  /* ---------------- modal ---------------- */

  WY.dialog = function dialog(options = {}) {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = `modal${options.wide ? ' modal-wide' : ''}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', options.title || '对话框');
    modal.innerHTML = `
      <div class="modal-head">
        <div>
          <h3>${WY.esc(options.title || '')}</h3>
          ${options.subtitle ? `<p class="sub">${WY.esc(options.subtitle)}</p>` : ''}
        </div>
        <button class="modal-close" type="button" aria-label="关闭">×</button>
      </div>
      <div class="modal-body">${options.body || ''}</div>
      ${options.footer ? `<div class="modal-foot">${options.footer}</div>` : ''}
    `;
    backdrop.appendChild(modal);
    const previousFocus = document.activeElement;

    function close(result) {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
      if (typeof options.onClose === 'function') options.onClose(result);
    }

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(undefined);
      }
    }

    modal.querySelector('.modal-close').addEventListener('click', () => close(undefined));
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close(undefined);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    const focusTarget = modal.querySelector('input, textarea, select, button:not(.modal-close), [tabindex]');
    if (focusTarget) setTimeout(() => focusTarget.focus(), 40);

    return {
      el: modal,
      backdrop,
      body: modal.querySelector('.modal-body'),
      footer: modal.querySelector('.modal-foot'),
      close,
    };
  };

  WY.confirm = function confirm(options = {}) {
    return new Promise((resolve) => {
      let settled = false;
      const dialog = WY.dialog({
        title: options.title || '确认操作',
        subtitle: options.subtitle || '',
        body: `<p class="muted dialog-text">${WY.esc(options.message || '')}</p>`,
        footer: `<button class="btn btn-ghost" type="button" data-cancel>${WY.esc(
          options.cancelText || '取消',
        )}</button><button class="btn ${options.danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok>${WY.esc(
          options.okText || '确定',
        )}</button>`,
        onClose: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      });
      dialog.footer.querySelector('[data-cancel]').addEventListener('click', () => {
        settled = true;
        dialog.close();
        resolve(false);
      });
      dialog.footer.querySelector('[data-ok]').addEventListener('click', () => {
        settled = true;
        dialog.close();
        resolve(true);
      });
    });
  };

  /* ---------------- copy ---------------- */

  WY.copy = async function copy(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      WY.toast('已复制到剪贴板', 'success');
      return true;
    } catch {
      WY.toast('复制失败，请手动选中复制', 'error');
      return false;
    }
  };

  /* ---------------- page chrome ---------------- */

  function markActiveNav() {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
    let active = 'home';
    if (pathname.startsWith('/ideas')) active = 'ideas';
    else if (pathname.startsWith('/polls')) active = 'polls';
    else if (pathname.startsWith('/rules')) active = 'rules';
    else if (pathname.startsWith('/downloads')) active = 'downloads';
    else if (pathname.startsWith('/sponsor')) active = 'sponsor';
    else if (pathname.startsWith('/leaderboard')) active = 'leaderboard';
    else if (pathname.startsWith('/admin')) active = 'admin';
    document.querySelectorAll('[data-nav]').forEach((link) => {
      const isActive = link.dataset.nav === active;
      link.classList.toggle('is-active', isActive);
      if (isActive) link.setAttribute('aria-current', 'page');
    });
  }

  function initNavToggle() {
    const toggle = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    toggle.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function initReveal() {
    const nodes = document.querySelectorAll('.reveal');
    if (!nodes.length) return;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('in'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px' },
    );
    nodes.forEach((node) => observer.observe(node));
    // Safety net: never leave content invisible (screenshots, odd viewports).
    setTimeout(() => nodes.forEach((node) => node.classList.add('in')), 1600);
  }

  async function fillSiteChrome() {
    const yearNodes = document.querySelectorAll('[data-year]');
    yearNodes.forEach((node) => {
      node.textContent = String(new Date().getFullYear());
    });
    try {
      const data = await WY.site();
      WY._site = data;
      if (data.lockdown && data.lockdown.mode === 'readonly' && !document.querySelector('.lockdown-bar')) {
        const bar = document.createElement('div');
        bar.className = 'lockdown-bar';
        bar.setAttribute('role', 'status');
        bar.textContent = '🔒 ' + (data.lockdown.message || '网站暂时只能浏览：投票、许愿和评论已暂停，请稍后再来。');
        document.body.prepend(bar);
      }
      document.querySelectorAll('[data-site-name]').forEach((node) => {
        node.textContent = data.site.name;
      });
      document.querySelectorAll('[data-announcement]').forEach((node) => {
        node.textContent = data.site.announcement || '暂无公告，先去看看大家的许愿吧。';
      });
      document.querySelectorAll('[data-fans]').forEach((node) => {
        node.textContent = data.site.fans;
      });
      document.querySelectorAll('[data-likes]').forEach((node) => {
        node.textContent = data.site.likes;
      });
      document.querySelectorAll('[data-works]').forEach((node) => {
        node.textContent = String(data.site.works);
      });
      document.querySelectorAll('[data-idea-count]').forEach((node) => {
        node.textContent = WY.fmtNumber(data.stats.ideas);
      });
      document.querySelectorAll('[data-vote-count]').forEach((node) => {
        node.textContent = WY.fmtNumber(data.stats.votes);
      });
      document.querySelectorAll('[data-open-polls]').forEach((node) => {
        node.textContent = String(data.stats.openPolls);
      });
      document.querySelectorAll('[data-douyin-link]').forEach((node) => {
        node.href = data.site.douyinUrl;
      });
      document.dispatchEvent(new CustomEvent('wy:site', { detail: data }));
    } catch (error) {
      // Only developers (and the admin tunnel) see this; fans' consoles stay clean.
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        console.warn('[WY] site payload failed:', error.message);
      }
    }
  }

  WY.mount = function mount() {
    markActiveNav();
    initNavToggle();
    initReveal();
    fillSiteChrome();
  };

  WY.observeReveal = initReveal;

  /* ---------------- supporter board (home) ---------------- */

  WY.mountBoard = async function mountBoard(list, form) {
    if (!list) return;
    const paint = (data) => {
      list.innerHTML = data.items.length
        ? data.items.map((row) => `<li><span>${WY.esc(row.nickname)}</span><b>${row.points} ✦</b></li>`).join('')
        : '<li class="is-empty"><span>还没有人上榜，留下昵称做第一个开拓者</span><b></b></li>';
      if (form && data.me) form.nickname.value = data.me;
    };
    try {
      paint(await WY.api('/api/supporters'));
    } catch {
      list.innerHTML = '';
    }
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const nickname = form.nickname.value.trim();
        if (!nickname) return;
        const consent = form.elements.crossBorderConsent;
        if (consent && !consent.checked) {
          WY.toast('请先勾选同意隐私政策中的个人信息出境说明', 'error');
          return;
        }
        const age = form.elements.ageConfirm;
        if (age && !age.checked) {
          WY.toast('请先确认你已年满 14 周岁', 'error');
          return;
        }
        try {
          await WY.api('/api/me/nickname', {
            method: 'POST',
            body: {
              nickname,
              crossBorderConsent: Boolean(consent && consent.checked),
              ageConfirm: Boolean(age && age.checked),
            },
          });
          WY.toast('已登记，继续投票攒星光吧', 'success');
          paint(await WY.api('/api/supporters'));
        } catch (error) {
          WY.toast(error.message, 'error');
        }
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', WY.mount, { once: true });
  } else {
    WY.mount();
  }
})();

/* In-page click tracker for the site's private security log (see /privacy, 安全记录).
   Sends only the clicked button / link label (≤30 chars), the card number and the page — never anything typed.
   Runs once per tab (app.js is shared across soft page navigation). Admin pages are not tracked. */
(function () {
  'use strict';
  if (window.__wyClicks) return;
  window.__wyClicks = true;
  const PAGES = ['/', '/ideas', '/polls', '/leaderboard', '/downloads', '/sponsor', '/rules', '/privacy'];
  let buf = [];
  let timer = 0;

  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (!buf.length) return;
    const events = buf;
    buf = [];
    try {
      fetch('/api/t', {
        method: 'POST',
        keepalive: true,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify({ events }),
      }).catch(() => {});
    } catch {}
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!PAGES.includes(location.pathname)) return;
      const el = e.target.closest && e.target.closest('button, a, [role="tab"], [role="button"], .chip');
      if (!el || el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      if (!label) return;
      const holder = el.closest('[data-id]');
      const raw = holder ? holder.dataset.id : el.dataset.vote || el.dataset.pen || el.dataset.del || '';
      const card = /^\d{1,7}$/.test(raw || '') ? Number(raw) : undefined;
      let host;
      if (el.tagName === 'A' && el.href) {
        try {
          const u = new URL(el.href, location.href);
          if (u.host !== location.host) host = u.hostname;
        } catch {}
      }
      buf.push({ label, page: location.pathname, card, host, at: Date.now() });
      if (buf.length >= 8 || host) flush();
      else if (!timer) timer = setTimeout(flush, 15000);
    },
    true,
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
})();
