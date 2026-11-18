/* Admin → 模组文件: fan code, jar/modpack upload with the full-screen forge loader. */
(function () {
  'use strict';
  const WY = window.WY;
  if (!WY) return;
  const $ = (id) => document.getElementById(id);
  const play = (n) => window.WYSFX && window.WYSFX.play(n);
  let booted = false;

  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  /* ---------------- forge overlay ---------------- */

  function forge(fileName) {
    const el = document.createElement('div');
    el.className = 'forge';
    el.innerHTML = `
      <div class="sh top"></div><div class="sh bot"></div>
      <div class="forge-body">
        <p class="forge-tag">FORGE · 星核锻造</p>
        <canvas class="forge-canvas" aria-hidden="true"></canvas>
        <div class="forge-name"></div>
        <div class="forge-log"></div>
        <div class="forge-bar"><i></i></div>
        <div class="forge-row"><span class="forge-stage">点燃星核熔炉</span><span class="forge-pct">00%</span></div>
      </div>`;
    el.querySelector('.forge-name').textContent = fileName;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    play('boom');

    const cv = el.querySelector('canvas');
    const g = cv.getContext('2d');
    const DPR = Math.min(2, devicePixelRatio || 1);
    const size = () => {
      cv.width = cv.clientWidth * DPR;
      cv.height = cv.clientHeight * DPR;
    };
    size();
    const sparks = [];
    let pct = 0;
    let shown = 0;
    let done = false;
    let raf = 0;
    let lastStrike = 0;
    const t0 = performance.now();
    const stages = ['点燃星核熔炉', '熔铸方块数据', '刻印附魔符文', '淬火校验 SHA-256', '封装完成'];
    const logEl = el.querySelector('.forge-log');
    let stageIdx = -1;

    function frame(now) {
      const t = now - t0;
      shown += (pct - shown) * 0.08;
      const W = cv.width;
      const H = cv.height;
      g.clearRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H * 0.58;
      // anvil block
      const s = Math.min(W, H) * 0.18;
      g.save();
      g.translate(cx, cy);
      g.strokeStyle = 'rgba(216,181,106,.8)';
      g.lineWidth = 1.2 * DPR;
      g.beginPath();
      g.moveTo(-s, 0); g.lineTo(0, -s * 0.5); g.lineTo(s, 0); g.lineTo(0, s * 0.5); g.closePath();
      g.moveTo(-s, 0); g.lineTo(-s, s * 0.7); g.lineTo(0, s * 1.2); g.lineTo(s, s * 0.7); g.lineTo(s, 0);
      g.moveTo(0, s * 0.5); g.lineTo(0, s * 1.2);
      g.stroke();
      // molten fill rising with progress
      const fill = shown / 100;
      const grad = g.createLinearGradient(0, s * 1.2, 0, -s * 0.5);
      grad.addColorStop(0, 'rgba(243,217,150,.9)');
      grad.addColorStop(1, 'rgba(164,138,216,.4)');
      g.fillStyle = grad;
      g.globalAlpha = 0.35 + 0.25 * Math.sin(t * 0.006);
      g.beginPath();
      const top = s * 1.2 - fill * s * 1.7;
      g.moveTo(-s, Math.max(top, 0)); g.lineTo(0, Math.max(top + s * 0.5, s * 0.5)); g.lineTo(s, Math.max(top, 0));
      g.lineTo(s, s * 0.7); g.lineTo(0, s * 1.2); g.lineTo(-s, s * 0.7); g.closePath();
      g.fill();
      g.globalAlpha = 1;
      g.restore();
      // hammer strikes
      if (!done && now - lastStrike > 520) {
        lastStrike = now;
        play('forge');
        el.classList.remove('strike');
        void el.offsetWidth;
        el.classList.add('strike');
        for (let i = 0; i < 26; i += 1) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
          const v = (2 + Math.random() * 6) * DPR;
          sparks.push({ x: cx, y: cy - s * 0.5, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: Math.random() > 0.3 ? '#f3d996' : '#c9b8f0' });
        }
      }
      // orbit runes
      for (let i = 0; i < 12; i += 1) {
        const a = t * 0.0007 + (i / 12) * Math.PI * 2;
        const r = s * 2.1;
        g.fillStyle = `rgba(216,181,106,${0.25 + 0.5 * (i / 12 < fill ? 1 : 0)})`;
        g.font = `${12 * DPR}px serif`;
        g.fillText('ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃ'[i], cx + Math.cos(a) * r, cy - s * 0.3 + Math.sin(a) * r * 0.4);
      }
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const p = sparks[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25 * DPR;
        p.life -= 0.02;
        if (p.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        g.globalAlpha = p.life;
        g.fillStyle = p.c;
        g.fillRect(p.x, p.y, 2.5 * DPR, 2.5 * DPR);
      }
      g.globalAlpha = 1;
      el.querySelector('.forge-bar i').style.transform = `scaleX(${shown / 100})`;
      el.querySelector('.forge-pct').textContent = `${String(Math.floor(shown)).padStart(2, '0')}%`;
      const si = Math.min(stages.length - 1, Math.floor((shown / 100) * (stages.length - 1) + (done ? 1 : 0)));
      if (si !== stageIdx) {
        stageIdx = si;
        el.querySelector('.forge-stage').textContent = stages[si];
        const line = document.createElement('div');
        line.textContent = `[${(t / 1000).toFixed(2).padStart(5, '0')}] ${stages[si]}`;
        logEl.appendChild(line);
        if (logEl.children.length > 4) logEl.firstChild.remove();
        play('tick');
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      progress(p) {
        pct = Math.max(pct, Math.min(99, p));
      },
      finish(ok, message) {
        const wait = Math.max(0, 4200 - (performance.now() - t0));
        if (wait > 0 && ok) {
          // fast uploads still get the full ceremony
          const ramp = setInterval(() => (pct = Math.min(99, pct + 6)), 220);
          setTimeout(() => {
            clearInterval(ramp);
            this.finish(ok, message);
          }, wait);
          return;
        }
        done = true;
        pct = ok ? 100 : pct;
        el.classList.add(ok ? 'win' : 'fail');
        el.querySelector('.forge-stage').textContent = message;
        play(ok ? 'success' : 'error');
        if (ok && window.WYFX) window.WYFX.burst(innerWidth / 2, innerHeight * 0.5, 40);
        setTimeout(() => {
          el.classList.remove('on');
          el.classList.add('off');
          setTimeout(() => {
            cancelAnimationFrame(raf);
            el.remove();
          }, 1100);
        }, ok ? 1500 : 2200);
      },
    };
  }

  /* ---------------- upload ---------------- */

  function upload(file, meta, onProgress) {
    return new Promise((resolve, reject) => {
      const qs = new URLSearchParams({ ...meta, file: file.name }).toString();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/admin/mods/upload?${qs}`);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('X-Device-Id', WY.deviceId);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
      xhr.onload = () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* ignore */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error((data && data.error && data.error.message) || `上传失败（${xhr.status}）`));
      };
      xhr.onerror = () => reject(new Error('网络中断，上传失败'));
      xhr.send(file);
    });
  }

  function pickFile(file) {
    if (!file) return;
    $('mod-file-name').textContent = `${file.name} · ${fmtSize(file.size)}`;
    $('mod-drop').classList.add('has-file');
    if (/\.(zip|mrpack)$/i.test(file.name)) $('mod-kind').value = 'modpack';
    if (/\.jar$/i.test(file.name)) $('mod-kind').value = 'mod';
    if (!$('mod-name').value) $('mod-name').value = file.name.replace(/\.(jar|zip|mrpack)$/i, '').replace(/[-_]+/g, ' ');
    play('toggle');
  }

  async function onSubmit(event) {
    event.preventDefault();
    const file = $('mod-file').files[0] || $('mod-drop')._file;
    if (!file) {
      WY.toast('先选择一个 .jar 或 .zip 文件', 'error');
      return;
    }
    const meta = {
      kind: $('mod-kind').value,
      name: $('mod-name').value.trim(),
      version: $('mod-version').value.trim(),
      mc: $('mod-mc').value.trim(),
      loader: $('mod-loader').value.trim(),
      desc: $('mod-desc').value.trim(),
    };
    if (!meta.name) {
      WY.toast('写一个名称', 'error');
      return;
    }
    const fx = forge(file.name);
    try {
      await upload(file, meta, (p) => fx.progress(p));
      fx.finish(true, '锻造完成 · 已上架下载页');
      event.target.reset();
      $('mod-drop')._file = null;
      $('mod-drop').classList.remove('has-file');
      $('mod-file-name').textContent = '拖入 .jar / .zip，或点击选择';
      loadList();
    } catch (error) {
      fx.finish(false, error.message);
    }
  }

  /* ---------------- list + fan code ---------------- */

  async function loadList() {
    const box = $('mod-admin-list');
    try {
      const { items } = await WY.api('/api/admin/mods');
      box.innerHTML = items.length
        ? items
            .map(
              (m) => `
          <div class="idea-row" data-mod="${m.id}">
            <label class="mod-cover" title="点击上传封面图">
              ${m.image ? `<img src="${WY.esc(m.image)}" alt="">` : `<span>${m.kind === 'mod' ? 'JAR' : 'PACK'}<small>+封面</small></span>`}
              <input type="file" accept="image/png,image/jpeg,image/webp" data-cover hidden>
            </label>
            <div class="idea-main">
              <h3>${WY.esc(m.name)} ${m.hidden ? '<span class="badge badge-muted">已隐藏</span>' : ''}</h3>
              <div class="idea-meta"><span>${WY.esc(m.fileName)}</span><span>${fmtSize(m.size)}</span><span>${m.downloads} 次下载</span><span>${WY.esc([m.version, m.mcVersion, m.loader].filter(Boolean).join(' · '))}</span></div>
            </div>
            <button class="btn btn-ghost btn-sm" data-hide="${m.hidden ? 0 : 1}" type="button">${m.hidden ? '重新上架' : '下架'}</button>
            ${m.image ? '<button class="btn btn-ghost btn-sm" data-cover-clear type="button">去掉封面</button>' : ''}
            <button class="btn btn-danger btn-sm" data-del type="button">删除</button>
          </div>`,
            )
            .join('')
        : '<div class="empty">还没有上传文件。</div>';
    } catch (error) {
      box.innerHTML = `<div class="empty">${WY.esc(error.message)}</div>`;
    }
  }

  async function onListClick(event) {
    const row = event.target.closest('[data-mod]');
    if (!row) return;
    const id = row.dataset.mod;
    try {
      if (event.target.closest('[data-cover-clear]')) {
        await WY.api(`/api/admin/mods/${id}`, { method: 'PATCH', body: { image: '' } });
        WY.toast('封面已去掉', 'success');
      } else if (event.target.closest('[data-hide]')) {
        await WY.api(`/api/admin/mods/${id}`, { method: 'PATCH', body: { hidden: event.target.closest('[data-hide]').dataset.hide === '1' } });
      } else if (event.target.closest('[data-del]')) {
        if (!window.confirm('永久删除这个文件？')) return;
        await WY.api(`/api/admin/mods/${id}`, { method: 'DELETE' });
      } else return;
      loadList();
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  function shrinkCover(file) {
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

  async function onCoverChange(event) {
    const input = event.target.closest('[data-cover]');
    if (!input || !input.files[0]) return;
    const id = input.closest('[data-mod]').dataset.mod;
    try {
      await WY.api(`/api/admin/mods/${id}`, { method: 'PATCH', body: { image: await shrinkCover(input.files[0]) } });
      WY.toast('封面已更新', 'success');
      loadList();
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  async function loadFan() {
    const data = await WY.api('/api/admin/fan');
    $('fan-code').value = data.code;
    $('fan-count').textContent = `${data.fans} 位已验证粉丝`;
  }

  async function onFan(event) {
    event.preventDefault();
    try {
      await WY.api('/api/admin/fan', { method: 'PATCH', body: { code: $('fan-code').value.trim() } });
      WY.toast('粉丝口令已更新', 'success');
      loadFan();
    } catch (error) {
      WY.toast(error.message, 'error');
    }
  }

  function open() {
    if (!booted) {
      booted = true;
      $('mod-form').addEventListener('submit', onSubmit);
      $('mod-file').addEventListener('change', (e) => pickFile(e.target.files[0]));
      const drop = $('mod-drop');
      ['dragenter', 'dragover'].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add('is-over');
        }),
      );
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        drop._file = file;
        pickFile(file);
      });
      $('mod-admin-list').addEventListener('click', onListClick);
      $('mod-admin-list').addEventListener('change', onCoverChange);
      $('fan-form').addEventListener('submit', onFan);
    }
    loadList();
    loadFan().catch((e) => WY.toast(e.message, 'error'));
  }

  document.addEventListener('wy:files', open);
})();
