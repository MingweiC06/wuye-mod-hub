/* ==========================================================================
   乌叶MC · fx.js — intro terminal, page shutters, text glyphs, button
   ripple/magnet/burst, star cursor, count-ups and synthesized sound.
   Loaded (non-deferred) in <head> so the intro can cover the first paint.
   No audio files: every sound is generated with WebAudio.
   ========================================================================== */
(function () {
  'use strict';

  const html = document.documentElement;
  const RM = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* private mode */
      }
    },
    sget(k) {
      try {
        return sessionStorage.getItem(k);
      } catch {
        return '1';
      }
    },
    sset(k, v) {
      try {
        sessionStorage.setItem(k, v);
      } catch {
        /* ignore */
      }
    },
  };
  const isAdmin = location.pathname.startsWith('/admin');
  const lang = () => (window.WYI18N ? window.WYI18N.lang : 'zh');

  /* Cover the first paint until the intro is mounted (once per browser session). */
  const wantBoot = !isAdmin && !store.sget('wy:booted') && !/[?&]noboot/.test(location.search);
  if (wantBoot) html.classList.add('wy-boot-pending');

  /* ======================================================================
     Sound — tiny WebAudio synth. Starts after the first user gesture.
     ====================================================================== */
  const SFX = (window.WYSFX = {
    muted: store.get('wy:mute') === '1',
    ctx: null,
    master: null,
    lastHover: 0,
  });

  function audio() {
    if (SFX.ctx) return SFX.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    SFX.ctx = new AC();
    SFX.master = SFX.ctx.createGain();
    SFX.master.gain.value = 0.32;
    // a short feedback delay gives every sound a little "space"
    const delay = SFX.ctx.createDelay();
    delay.delayTime.value = 0.13;
    const fb = SFX.ctx.createGain();
    fb.gain.value = 0.22;
    const wet = SFX.ctx.createGain();
    wet.gain.value = 0.35;
    SFX.master.connect(SFX.ctx.destination);
    SFX.master.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(SFX.ctx.destination);
    return SFX.ctx;
  }

  function tone(freq, { type = 'sine', dur = 0.12, vol = 0.5, at = 0, slide = 0, attack = 0.004 } = {}) {
    const ac = SFX.ctx;
    const t = ac.currentTime + at;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(SFX.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise({ dur = 0.5, vol = 0.3, from = 400, to = 4000, at = 0, q = 1.2 } = {}) {
    const ac = SFX.ctx;
    const t = ac.currentTime + at;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(SFX.master);
    src.start(t);
  }

  const SOUNDS = {
    hover: () => tone(1900 + Math.random() * 300, { type: 'sine', dur: 0.05, vol: 0.06 }),
    tick: () => tone(2600, { type: 'square', dur: 0.018, vol: 0.025 }),
    click: () => {
      tone(880, { type: 'triangle', dur: 0.09, vol: 0.28 });
      tone(1320, { type: 'sine', dur: 0.12, vol: 0.14, at: 0.03 });
    },
    toggle: () => {
      tone(660, { type: 'triangle', dur: 0.08, vol: 0.2 });
      tone(990, { type: 'triangle', dur: 0.1, vol: 0.2, at: 0.06 });
    },
    chime: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, { type: 'triangle', dur: 0.5, vol: 0.2, at: i * 0.06 })),
    unvote: () => [783.99, 523.25].forEach((f, i) => tone(f, { type: 'sine', dur: 0.25, vol: 0.16, at: i * 0.07 })),
    error: () => {
      tone(220, { type: 'sawtooth', dur: 0.18, vol: 0.12, slide: 0.6 });
      tone(180, { type: 'sawtooth', dur: 0.22, vol: 0.1, at: 0.1, slide: 0.6 });
    },
    whoosh: () => noise({ dur: 0.55, vol: 0.28, from: 300, to: 5200 }),
    shut: () => {
      noise({ dur: 0.35, vol: 0.22, from: 3000, to: 300 });
      tone(90, { type: 'sine', dur: 0.35, vol: 0.4, at: 0.28, slide: 0.5 });
    },
    boom: () => {
      tone(70, { type: 'sine', dur: 1.2, vol: 0.6, slide: 0.45, attack: 0.01 });
      noise({ dur: 1.2, vol: 0.18, from: 2400, to: 120, q: 0.7 });
    },
    open: () => {
      SOUNDS.boom();
      SOUNDS.whoosh();
      [392, 587.33, 783.99, 1174.66].forEach((f, i) => tone(f, { type: 'triangle', dur: 1.1, vol: 0.13, at: 0.25 + i * 0.09 }));
    },
    forge: () => {
      tone(150, { type: 'square', dur: 0.08, vol: 0.18, slide: 0.7 });
      noise({ dur: 0.2, vol: 0.16, from: 5000, to: 1500, q: 3 });
    },
    success: () => [523.25, 783.99, 1046.5, 1567.98, 2093].forEach((f, i) => tone(f, { type: 'sine', dur: 0.9, vol: 0.16, at: i * 0.08 })),
  };

  SFX.play = function play(name) {
    if (SFX.muted || !SOUNDS[name]) return;
    const ac = audio();
    if (!ac) return;
    if (ac.state === 'suspended') ac.resume();
    if (ac.state !== 'running' && name === 'hover') return;
    try {
      SOUNDS[name]();
    } catch {
      /* ignore */
    }
  };

  SFX.setMuted = function setMuted(m) {
    SFX.muted = m;
    store.set('wy:mute', m ? '1' : '0');
    document.querySelectorAll('[data-wy-mute]').forEach((b) => b.setAttribute('aria-pressed', String(m)));
  };

  // Unlock audio on the first gesture anywhere.
  const unlock = () => {
    const ac = audio();
    if (ac && ac.state === 'suspended') ac.resume();
  };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });

  /* ======================================================================
     Intro terminal (Star Rail × Minecraft)
     ====================================================================== */
  const BOOT_TEXT = {
    zh: {
      head: ['星穹终端 // ASTRAL TERMINAL', '节点 · 乌叶MC', 'status'],
      log: [
        ['t', '接入星穹列车广域网'],
        ['', '同步抖音频道 27276177171'],
        ['w', '载入模组索引 · 许愿池 · 擂台'],
        ['', '校准星神坐标 · 巡猎 / 丰饶 / 存护'],
        ['', '编译方块着色器'],
        ['v', '粉丝凭证 → 核验中'],
        ['', '拉取最新复刻'],
        ['v', '列车即将出发'],
      ],
      kv: ['设备', '开拓者', '频道', '航线'],
      unverified: '未验证',
      status: ['建立星轨连接', '同步星图', '准备就绪'],
      enter: '点击进入',
      skip: '跳过 ›',
      sub: 'MOD WISH POOL',
      en: '模组许愿池 · 技能独特 我来复刻',
    },
    en: {
      head: ['ASTRAL TERMINAL // 星穹终端', 'NODE · WUYE MC', 'status'],
      log: [
        ['t', 'Joining the Astral Express network'],
        ['', 'Syncing Douyin channel 27276177171'],
        ['w', 'Loading mod index · wishes · arena'],
        ['', 'Calibrating Aeon paths · Hunt / Abundance / Preservation'],
        ['', 'Compiling block shaders'],
        ['v', 'Follower credential → checking'],
        ['', 'Pulling the latest builds'],
        ['v', 'The Express is departing'],
      ],
      kv: ['DEVICE', 'TRAILBLAZER', 'CHANNEL', 'ROUTE'],
      unverified: 'unverified',
      status: ['ESTABLISHING STAR-RAIL LINK', 'SYNCING STAR CHART', 'READY'],
      enter: 'ENTER',
      skip: 'SKIP ›',
      sub: 'MOD WISH POOL',
      en: 'UNIQUE SKILLS · REBUILT IN MINECRAFT',
    },
  };

  function boot() {
    const L = BOOT_TEXT[lang()] || BOOT_TEXT.zh;
    const el = document.createElement('div');
    el.id = 'wy-boot';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', L.status[0]);
    el.innerHTML = `
      <div class="sh top"></div><div class="sh bot"></div><div class="seam"></div>
      <div class="wyb">
        <header class="wyb-head"><span class="r">${L.head[0]}</span><span>${L.head[1]}</span><span id="wyb-clock">--:--:--.---</span></header>
        <aside class="wyb-left"><div class="wyb-lbl">SESSION LOG</div><pre id="wyb-log"></pre></aside>
        <div class="wyb-center">
          <canvas id="wyb-sky" aria-hidden="true"></canvas>
          <div class="wyb-name"><div class="zh" id="wyb-zh"></div><div class="sub">${L.sub}</div><div class="rule"></div><div class="en" id="wyb-en"></div>
            <button class="wyb-enter" id="wyb-enter" type="button">${L.enter}</button></div>
        </div>
        <aside class="wyb-right">
          <div class="wyb-lbl">SIGNAL</div><canvas id="wyb-wave" aria-hidden="true"></canvas>
          <dl class="wyb-kv"><dt>${L.kv[0]}</dt><dd id="wyb-k1">—</dd><dt>${L.kv[1]}</dt><dd id="wyb-k2">—</dd><dt>${L.kv[2]}</dt><dd id="wyb-k3">—</dd><dt>${L.kv[3]}</dt><dd id="wyb-k4">—</dd></dl>
        </aside>
        <footer class="wyb-foot"><div class="row"><span id="wyb-stat">${L.status[0]}</span><span id="wyb-pct">00%</span></div><div class="wyb-segs" id="wyb-segs"></div></footer>
      </div>
      <button class="wyb-skip" id="wyb-skip" type="button">${L.skip}</button>`;
    document.body.appendChild(el);
    html.classList.remove('wy-boot-pending');
    html.style.overflow = 'hidden';

    const $ = (id) => document.getElementById(id);
    const timers = [];
    const T = (ms, f) => timers.push(setTimeout(f, ms));
    let opened = false;
    let raf = 0;
    const t0 = performance.now();

    const open = () => {
      if (opened) return;
      opened = true;
      timers.forEach(clearTimeout);
      store.sset('wy:booted', '1');
      SFX.play('open');
      el.classList.add('open');
      html.style.overflow = '';
      document.dispatchEvent(new CustomEvent('wy:booted'));
      setTimeout(() => {
        cancelAnimationFrame(raf);
        el.remove();
      }, 1200);
    };
    $('wyb-skip').addEventListener('click', open);
    $('wyb-enter').addEventListener('click', open);
    document.addEventListener('keydown', function key(e) {
      if (!opened && (e.key === 'Escape' || e.key === 'Enter')) {
        open();
        document.removeEventListener('keydown', key);
      }
    });

    const name = '乌叶MC';
    const zh = $('wyb-zh');
    zh.innerHTML = [...name].map((c) => `<span>${c}</span>`).join('');
    if (RM) {
      el.classList.add('wyb-reveal', 'ready');
      zh.querySelectorAll('span').forEach((s) => s.classList.add('on'));
      $('wyb-en').textContent = L.en;
      return;
    }

    /* segments */
    const segs = $('wyb-segs');
    segs.innerHTML = '<i></i>'.repeat(32);
    const segEls = [...segs.children];

    /* log lines */
    const log = $('wyb-log');
    L.log.forEach(([cls, text], i) => {
      T(1300 + i * 260, () => {
        const ms = (performance.now() - t0) / 1000;
        const line = document.createElement('span');
        line.className = 'ln';
        line.innerHTML = `<span class="t">[${ms.toFixed(3).padStart(7, '0')}]</span> <span class="${cls}">${text}</span>`;
        log.appendChild(line);
        SFX.play('tick');
      });
    });

    /* readouts */
    const dev = (window.WY && window.WY.deviceId) || store.get('wy:device') || 'd-…';
    T(1500, () => {
      $('wyb-k1').textContent = dev.slice(0, 12);
    });
    T(1900, () => {
      $('wyb-k3').textContent = 'DOUYIN · 乌叶MC';
      $('wyb-k3').className = 'p';
    });
    T(2300, () => {
      $('wyb-k4').textContent = location.pathname === '/' ? '/home' : location.pathname;
    });
    fetch('/api/fan', { headers: { 'x-device-id': dev } })
      .then((r) => r.json())
      .then((d) => {
        T(2700, () => {
          $('wyb-k2').textContent = d.fan ? d.fan.nickname : L.unverified;
          $('wyb-k2').className = d.fan ? 'v' : '';
        });
      })
      .catch(() => {});

    /* title glyphs */
    T(2600, () => {
      el.classList.add('wyb-reveal');
      zh.querySelectorAll('span').forEach((s, i) => setTimeout(() => s.classList.add('on'), i * 120));
      let i = 0;
      const en = $('wyb-en');
      const typer = setInterval(() => {
        i += 1;
        en.textContent = L.en.slice(0, i);
        if (i % 2) SFX.play('tick');
        if (i >= L.en.length) clearInterval(typer);
      }, 28);
      timers.push(typer);
    });

    /* canvases */
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const sky = $('wyb-sky');
    const g = sky.getContext('2d');
    const wave = $('wyb-wave');
    const w = wave.getContext('2d');
    let S = 400;
    const size = () => {
      S = sky.clientWidth || 400;
      sky.width = S * DPR;
      sky.height = S * DPR;
      wave.width = (wave.clientWidth || 240) * DPR;
      wave.height = 64 * DPR;
    };
    size();
    window.addEventListener('resize', size);
    const stars = Array.from({ length: 420 }, () => {
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      return [r * Math.cos(th), u, r * Math.sin(th), Math.random()];
    });
    const cube = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    let pct = 0;
    const stat = $('wyb-stat');
    const pctEl = $('wyb-pct');
    const clock = $('wyb-clock');

    function frame(now) {
      const t = now - t0;
      clock.textContent = new Date().toISOString().slice(11, 23) + 'Z';
      const R = S * DPR * 0.42;
      const cx = (S * DPR) / 2;
      const cy = cx;
      g.clearRect(0, 0, sky.width, sky.height);
      const appear = Math.min(1, Math.max(0, (t - 1300) / 900));
      if (appear > 0) {
        g.globalAlpha = appear;
        const rot = t * 0.00022;
        const tilt = -0.42;
        const ct = Math.cos(tilt);
        const st = Math.sin(tilt);
        // orbit rings
        [1, 1.12, 1.26].forEach((k, i) => {
          g.strokeStyle = `rgba(216,181,106,${0.28 - i * 0.07})`;
          g.lineWidth = DPR;
          g.beginPath();
          g.ellipse(cx, cy, R * k, R * k * 0.32, -0.35 + i * 0.25, 0, Math.PI * 2);
          g.stroke();
        });
        // star sphere
        for (const [x0, y0, z0, b] of stars) {
          const x = x0 * Math.cos(rot) - z0 * Math.sin(rot);
          const z1 = x0 * Math.sin(rot) + z0 * Math.cos(rot);
          const y = y0 * ct - z1 * st;
          const z = y0 * st + z1 * ct;
          if (z < -0.2) continue;
          const a = (0.15 + (z + 0.2) * 0.7) * (0.5 + b * 0.5);
          g.fillStyle = b > 0.85 ? `rgba(164,138,216,${a})` : b > 0.6 ? `rgba(216,181,106,${a})` : `rgba(240,232,210,${a})`;
          const d = (1 + b * 1.4) * DPR;
          g.fillRect(cx + x * R - d / 2, cy - y * R - d / 2, d, d);
        }
        // spinning block (Minecraft)
        const cr = t * 0.0009;
        const proj = cube.map(([x, y, z]) => {
          const x1 = x * Math.cos(cr) - z * Math.sin(cr);
          const z1 = x * Math.sin(cr) + z * Math.cos(cr);
          const y1 = y * Math.cos(cr * 0.7) - z1 * Math.sin(cr * 0.7);
          const z2 = y * Math.sin(cr * 0.7) + z1 * Math.cos(cr * 0.7);
          const k = (R * 0.2) / (2.6 - z2 * 0.4);
          return [cx + x1 * k, cy + y1 * k];
        });
        g.strokeStyle = `rgba(243,217,150,${0.75 * appear})`;
        g.lineWidth = 1.2 * DPR;
        g.shadowColor = 'rgba(216,181,106,.8)';
        g.shadowBlur = 12 * DPR;
        g.beginPath();
        edges.forEach(([a, b]) => {
          g.moveTo(proj[a][0], proj[a][1]);
          g.lineTo(proj[b][0], proj[b][1]);
        });
        g.stroke();
        g.shadowBlur = 0;
        g.globalAlpha = 1;
      }
      // waveform
      w.clearRect(0, 0, wave.width, wave.height);
      w.strokeStyle = 'rgba(216,181,106,.8)';
      w.lineWidth = DPR;
      w.beginPath();
      for (let x = 0; x < wave.width; x += 2) {
        const p = x / wave.width;
        const y = wave.height / 2 + Math.sin(p * 22 + t * 0.008) * Math.sin(p * 3 + t * 0.002) * wave.height * 0.32 * Math.min(1, t / 2000);
        if (x) w.lineTo(x, y);
        else w.moveTo(x, y);
      }
      w.stroke();
      // progress
      const target = Math.min(100, Math.max(0, ((t - 900) / 3600) * 100));
      if (target > pct) {
        pct = target;
        const on = Math.round((pct / 100) * segEls.length);
        segEls.forEach((s, i) => s.classList.toggle('on', i < on));
        pctEl.textContent = `${String(Math.floor(pct)).padStart(2, '0')}%`;
        stat.textContent = pct < 45 ? L.status[0] : pct < 100 ? L.status[1] : L.status[2];
        if (pct >= 100 && !el.classList.contains('ready')) {
          el.classList.add('ready');
          $('wyb-enter').focus({ preventScroll: true });
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  /* ======================================================================
     Page shutters between internal pages
     ====================================================================== */
  function setupTransitions() {
    const tr = document.createElement('div');
    tr.className = 'wy-trans';
    tr.innerHTML = '<i></i><i></i>';
    document.body.appendChild(tr);
    if (store.sget('wy:trans') === '1' && !RM) {
      store.sset('wy:trans', '');
      tr.classList.add('shut');
      requestAnimationFrame(() => requestAnimationFrame(() => tr.classList.remove('shut')));
    }
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
      if (url.pathname === location.pathname && url.hash) return;
      if (RM) return;
      e.preventDefault();
      SFX.play('shut');
      tr.classList.add('shut');
      store.sset('wy:trans', '1');
      setTimeout(() => {
        location.href = url.href;
      }, 520);
    });
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) tr.classList.remove('shut');
    });
  }

  /* ======================================================================
     Text: glyph-split headings, rise-in blocks, count-ups
     ====================================================================== */
  function splitChars(node) {
    if (node.dataset.fxSplit) return;
    node.dataset.fxSplit = '1';
    let i = 0;
    const walk = (el) => {
      [...el.childNodes].forEach((child) => {
        if (child.nodeType === 3) {
          const text = child.textContent;
          if (!text.trim()) return;
          const frag = document.createDocumentFragment();
          for (const ch of text) {
            const span = document.createElement('span');
            span.className = 'fx-c';
            span.style.setProperty('--i', String(i));
            span.textContent = ch;
            i += 1;
            frag.appendChild(span);
          }
          child.replaceWith(frag);
        } else if (child.nodeType === 1 && !child.matches('img,svg,button,input')) {
          walk(child);
        }
      });
    };
    node.setAttribute('aria-label', node.textContent.trim());
    walk(node);
    node.classList.add('fx-chars');
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            el.classList.add('fx-on');
            if (el.dataset.fxCount) countUp(el);
            io.unobserve(el);
          })
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
      )
    : null;

  function watch(el) {
    if (!io || RM) {
      el.classList.add('fx-on');
      return;
    }
    io.observe(el);
  }

  function countUp(el) {
    const raw = el.textContent.trim();
    const m = raw.match(/^([\d,.]+)(.*)$/);
    if (!m || RM) return;
    const target = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(target)) return;
    const decimals = (m[1].split('.')[1] || '').length;
    const suffix = m[2];
    const start = performance.now();
    const dur = 1400;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      const v = target * e;
      el.textContent = (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(step);
      else el.textContent = raw;
    };
    requestAnimationFrame(step);
  }

  const HEADINGS = '.cx-hero h1, .section-head h2, .page-head h1, .page-head h2, .cx-close h2, .auth-card h1, .nf-main h1';
  const BLOCKS = '.eyebrow, .section-head .sub, .cx-hero-lead, .cx-hero-cta, .cx-stats, .page-head p, .head-aside, .cx-close p, .cx-close .btn, .cx-poster, .footer-grid > *, .cx-note, .cx-nick, .cx-rule, .dl-card, .dl-gate, .cx-road, .rail, .panel, .poll, .steps > *';

  function scan(root) {
    if (RM) return;
    root.querySelectorAll(HEADINGS).forEach((h) => {
      if (!h.dataset.fxSplit) {
        splitChars(h);
        watch(h);
      }
    });
    root.querySelectorAll(BLOCKS).forEach((b, i) => {
      if (b.classList.contains('fx-rise') || b.closest('#wy-boot')) return;
      b.classList.add('fx-rise');
      b.style.setProperty('--d', String(i % 6));
      watch(b);
    });
    root.querySelectorAll('.cx-stats b, .page-stat b, .polls-stat b, [data-fx-count]').forEach((n) => {
      if (n.dataset.fxCount || !/^\d/.test(n.textContent.trim())) return;
      n.dataset.fxCount = '1';
      watch(n);
    });
    root.querySelectorAll('.idea-row, .cx-work, .cx-node, .poll-option, .dl-row').forEach((n, i) => {
      if (n.dataset.fxIn) return;
      n.dataset.fxIn = '1';
      if (!n.animate) return;
      n.animate(
        [
          { opacity: 0, transform: 'translateY(16px)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: 700, delay: Math.min(i, 10) * 60, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' },
      );
    });
  }

  /* ======================================================================
     Pointer: ripple, bursts, magnet, tilt, hover sounds, star trail
     ====================================================================== */
  const INTERACTIVE = '.btn, .idea-vote, .cx-like, .cx-side, .chip, .tab, .page-btn, .wy-tool, .nav a, .link-arrow, .cx-work-cover, .poll-option, .rail-card, .dl-row, button';

  function ripple(target, e) {
    const r = target.getBoundingClientRect();
    const s = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement('span');
    dot.className = 'fx-ripple';
    dot.style.width = dot.style.height = `${s}px`;
    dot.style.left = `${e.clientX - r.left}px`;
    dot.style.top = `${e.clientY - r.top}px`;
    target.appendChild(dot);
    setTimeout(() => dot.remove(), 720);
  }

  function burst(x, y, n = 14) {
    if (RM) return;
    const glyphs = ['✦', '✧', '◆', '★', '·'];
    for (let i = 0; i < n; i += 1) {
      const p = document.createElement('span');
      p.className = 'fx-burst';
      p.textContent = glyphs[i % glyphs.length];
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const dist = 40 + Math.random() * 60;
      p.style.left = `${x}px`;
      p.style.top = `${y}px`;
      p.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
      p.style.setProperty('--y', `${Math.sin(ang) * dist - 20}px`);
      p.style.setProperty('--r', `${(Math.random() - 0.5) * 360}deg`);
      p.style.fontSize = `${10 + Math.random() * 10}px`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 950);
    }
  }
  window.WYFX = { burst, play: (n) => SFX.play(n), scan: () => scan(document) };

  function setupPointer() {
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest(INTERACTIVE);
      if (!t || t.contains(e.relatedTarget)) return;
      const now = performance.now();
      if (now - SFX.lastHover < 70) return;
      SFX.lastHover = now;
      SFX.play('hover');
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target.closest(INTERACTIVE);
      if (!t || t.disabled) return;
      if (!RM && getComputedStyle(t).position !== 'static') ripple(t, e);
    });
    document.addEventListener('click', (e) => {
      const t = e.target.closest(INTERACTIVE);
      if (!t) return;
      const isVote = t.matches('.idea-vote, .cx-like, .cx-side, [data-pick]');
      if (isVote) {
        const turningOn = !t.classList.contains('is-voted') && !t.classList.contains('is-on');
        SFX.play(turningOn ? 'chime' : 'unvote');
        if (turningOn) burst(e.clientX, e.clientY, 16);
      } else if (t.matches('.tab, .chip, .wy-tool')) {
        SFX.play('toggle');
      } else {
        SFX.play('click');
      }
    });
    // magnetic pull on primary buttons
    if (!RM && window.matchMedia('(pointer: fine)').matches) {
      document.addEventListener('pointermove', (e) => {
        const t = e.target.closest('.btn-primary, .btn-gold, .btn-lg, .wyb-enter');
        document.querySelectorAll('[data-fx-mag]').forEach((m) => {
          if (m !== t) {
            m.style.transform = '';
            delete m.dataset.fxMag;
          }
        });
        if (!t) return;
        const r = t.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        t.dataset.fxMag = '1';
        t.style.transform = `translate(${dx * 8}px, ${dy * 6}px)`;
      });
      // 3D tilt on posters/covers
      document.addEventListener('pointermove', (e) => {
        const card = e.target.closest('.cx-poster, .cx-work-cover, .rail-card');
        document.querySelectorAll('.fx-tilt').forEach((c) => {
          if (c !== card) {
            c.style.transform = '';
            c.classList.remove('fx-tilt');
          }
        });
        if (!card) return;
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        card.classList.add('fx-tilt');
        card.style.transform = `perspective(800px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
      });
      starTrail();
    }
  }

  function starTrail() {
    const c = document.createElement('canvas');
    c.className = 'wy-stars';
    document.body.appendChild(c);
    const g = c.getContext('2d');
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const size = () => {
      c.width = innerWidth * DPR;
      c.height = innerHeight * DPR;
    };
    size();
    window.addEventListener('resize', size);
    const parts = [];
    let lx = 0;
    let ly = 0;
    window.addEventListener('pointermove', (e) => {
      const d = Math.hypot(e.clientX - lx, e.clientY - ly);
      if (d < 6) return;
      lx = e.clientX;
      ly = e.clientY;
      parts.push({ x: e.clientX, y: e.clientY, vx: (Math.random() - 0.5) * 0.6, vy: Math.random() * 0.6 + 0.2, life: 1, s: Math.random() * 2 + 1, gold: Math.random() > 0.3 });
      if (parts.length > 70) parts.shift();
    });
    let running = false;
    const tick = () => {
      g.clearRect(0, 0, c.width, c.height);
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.022;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        g.globalAlpha = p.life;
        g.fillStyle = p.gold ? '#f3d996' : '#c9b8f0';
        const s = p.s * DPR * p.life;
        g.save();
        g.translate(p.x * DPR, p.y * DPR);
        g.rotate(Math.PI / 4);
        g.fillRect(-s / 2, -s / 2, s, s);
        g.restore();
      }
      g.globalAlpha = 1;
      if (parts.length) requestAnimationFrame(tick);
      else running = false;
    };
    window.addEventListener('pointermove', () => {
      if (!running) {
        running = true;
        requestAnimationFrame(tick);
      }
    });
  }

  function setupProgress() {
    const bar = document.createElement('div');
    bar.className = 'wy-progress';
    document.body.appendChild(bar);
    const update = () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* header tools: language + sound */
  function setupTools() {
    const host = document.querySelector('.header-actions');
    if (!host || host.querySelector('.wy-tools')) return;
    const box = document.createElement('div');
    box.className = 'wy-tools';
    const next = lang() === 'zh' ? 'EN' : '中';
    box.innerHTML = `${window.WYI18N ? '' : '<!--'}<button class="wy-tool" type="button" data-wy-lang aria-label="${lang() === 'zh' ? 'Switch to English' : '切换到中文'}">${next}</button>${window.WYI18N ? '' : '-->'}
      <button class="wy-tool" type="button" data-wy-mute aria-pressed="${SFX.muted}" aria-label="${lang() === 'zh' ? '音效开关' : 'Sound on/off'}"><span class="wy-eq"><i></i><i></i><i></i></span></button>`;
    host.prepend(box);
    box.querySelector('[data-wy-mute]').addEventListener('click', () => {
      SFX.setMuted(!SFX.muted);
      if (!SFX.muted) SFX.play('toggle');
    });
    box.querySelector('[data-wy-lang]')?.addEventListener('click', () => {
      if (window.WYI18N) window.WYI18N.set(lang() === 'zh' ? 'en' : 'zh');
    });
  }

  // Toasts get a sound too.
  function watchToasts() {
    const mo = new MutationObserver((muts) => {
      muts.forEach((m) =>
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('.toast')) SFX.play(/error/.test(n.className) ? 'error' : 'toggle');
          if (n.querySelectorAll) scanSoon();
        }),
      );
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  let scanTimer = 0;
  function scanSoon() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(document), 60);
  }

  function start() {
    if (wantBoot) boot();
    setupTools();
    setupTransitions();
    setupProgress();
    setupPointer();
    watchToasts();
    scan(document);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
