/* Admin → 概览 → 访问统计: page views and daily unique visitors (no IPs stored). */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;
  const NAMES = { '/': '首页', '/ideas': '许愿池', '/polls': '投票', '/leaderboard': '排行榜', '/downloads': '下载', '/sponsor': '赞助', '/rules': '规则', '/privacy': '隐私政策' };
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function bar(el, value, max) {
    el.style.width = `${max && value ? Math.max(2, Math.round((value / max) * 100)) : 0}%`;
  }

  async function load() {
    let data;
    try {
      data = await WY.api('/api/admin/visits');
    } catch {
      return; // overview already reports errors
    }
    const days = data.days || [];
    const today = days[days.length - 1] || { views: 0, visitors: 0 };
    document.getElementById('visits-today').textContent = `今天 ${today.visitors} 人 · ${today.views} 次`;

    const maxViews = Math.max(0, ...days.map((d) => d.views));
    const box = document.getElementById('visits-days');
    box.innerHTML = days
      .map((d) => {
        const label = `${d.day.slice(5).replace('-', '/')} 周${WEEK[new Date(`${d.day}T00:00:00Z`).getUTCDay()]}`;
        return `<div class="visits-row"><span class="visits-day">${label}</span><span class="visits-track"><i class="visits-bar"></i></span><span class="visits-num"><b>${d.visitors}</b> 人 · ${d.views} 次</span></div>`;
      })
      .join('');
    box.querySelectorAll('.visits-bar').forEach((el, i) => bar(el, days[i].views, maxViews));

    const pages = data.pages || [];
    const list = document.getElementById('visits-pages');
    list.innerHTML = pages.length
      ? pages.map((p) => `<li><span>${WY.esc(NAMES[p.path] || p.path)}</span><b class="mono">${p.views}</b></li>`).join('')
      : '<li class="empty">还没有访问记录。</li>';
  }

  document.addEventListener('wy:overview', load);
})();
