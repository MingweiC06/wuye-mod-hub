/* Downloads page: fan-code gate, mods list, modpacks (empty for now). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const t = (s) => (window.WYI18N ? window.WYI18N.t(s) : s);
  let isFan = false;

  function fmtSize(bytes) {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  function row(mod) {
    const meta = [mod.version && `v${mod.version}`, mod.mcVersion && `MC ${mod.mcVersion}`, mod.loader].filter(Boolean);
    return `
      <article class="dl-row" data-mod="${mod.id}">
        <div class="dl-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="dl-main">
          <h3 data-raw>${WY.esc(mod.name)}</h3>
          <div class="dl-meta">${meta.map((m) => `<span>${WY.esc(m)}</span>`).join('')}<span>${fmtSize(mod.size)}</span><span>${mod.downloads} 次下载</span></div>
          ${mod.description ? `<p data-raw>${WY.esc(mod.description)}</p>` : ''}
          <code class="dl-hash" title="SHA-256">${WY.esc(mod.sha256.slice(0, 16))}…</code>
        </div>
        <button class="btn ${isFan ? 'btn-primary' : 'btn-ghost'} dl-btn" type="button" data-dl="${mod.id}">
          <span class="dl-arrow" aria-hidden="true">↓</span><span>${isFan ? '下载' : '解锁后下载'}</span>
        </button>
      </article>`;
  }

  function empty(kind) {
    return kind === 'modpack'
      ? '<div class="dl-empty"><span class="dl-empty-cube" aria-hidden="true"></span><strong>整合包还在打包中</strong><p>第一个整合包很快上线，先去许愿池告诉我你想要哪些模组组合。</p><a class="btn btn-ghost btn-sm" href="/ideas#submit">去许愿</a></div>'
      : '<div class="dl-empty"><span class="dl-empty-cube" aria-hidden="true"></span><strong>模组还在锻造中</strong><p>第一个模组很快上线。</p></div>';
  }

  function render(data) {
    isFan = Boolean(data.fan);
    $('gate').hidden = isFan;
    $('welcome').hidden = !isFan;
    if (isFan) $('welcome-name').textContent = data.fan.nickname;
    $('mods').innerHTML = data.mods.length ? data.mods.map(row).join('') : empty('mod');
    $('modpacks').innerHTML = data.modpacks.length ? data.modpacks.map(row).join('') : empty('modpack');
  }

  async function load() {
    try {
      render(await WY.api('/api/mods'));
    } catch (error) {
      $('mods').innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
      $('modpacks').innerHTML = '';
    }
  }

  async function onDownload(event) {
    const btn = event.target.closest('[data-dl]');
    if (!btn) return;
    if (!isFan) {
      const gate = $('gate');
      gate.scrollIntoView({ behavior: 'smooth', block: 'center' });
      gate.classList.remove('dl-shake');
      void gate.offsetWidth;
      gate.classList.add('dl-shake');
      window.WYFX?.play('error');
      setTimeout(() => $('gate-code').focus(), 400);
      return;
    }
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const { url } = await WY.api(`/api/mods/${btn.dataset.dl}/token`, { method: 'POST' });
      const r = btn.getBoundingClientRect();
      window.WYFX?.burst(r.left + r.width / 2, r.top + r.height / 2, 22);
      window.WYFX?.play('success');
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(load, 1200);
    } catch (error) {
      WY.toast(t(error.message), 'error');
    } finally {
      setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }, 900);
    }
  }

  async function onVerify(event) {
    event.preventDefault();
    const form = event.target;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await WY.api('/api/fan/verify', { method: 'POST', body: { nickname: form.nickname.value.trim(), code: form.code.value } });
      const r = btn.getBoundingClientRect();
      window.WYFX?.burst(r.left + r.width / 2, r.top + r.height / 2, 30);
      window.WYFX?.play('success');
      WY.toast(t('验证成功，欢迎你，开拓者！'), 'success');
      $('gate').classList.add('dl-unlock');
      setTimeout(load, 700);
    } catch (error) {
      $('gate').classList.remove('dl-shake');
      void $('gate').offsetWidth;
      $('gate').classList.add('dl-shake');
      WY.toast(t(error.message), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function boot() {
    $('gate-form').addEventListener('submit', onVerify);
    document.querySelector('main').addEventListener('click', onDownload);
    load();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
