/* 维护中 page: show the owner's message, and reload once the site is open again. */
(function () {
  'use strict';
  async function check() {
    try {
      const r = await fetch('/api/lockdown', { cache: 'no-store' });
      const d = await r.json();
      if (d.mode !== 'maintenance') {
        location.reload();
        return;
      }
      if (d.message) document.getElementById('mt-text').textContent = d.message;
    } catch {}
  }
  check();
  setInterval(check, 60000);
})();
