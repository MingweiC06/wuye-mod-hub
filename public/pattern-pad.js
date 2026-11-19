/* 3×3 unlock pattern pad (mouse, touch, pen). window.WYPattern.mount(host, { onDone(pattern) }) →
   { reset(), flash(ok) }. The pattern comes back as "0-4-8-5" (dots numbered left→right, top→bottom). */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function mount(host, opts = {}) {
    host.classList.add('wy-pattern');
    host.innerHTML = `<svg class="wy-pattern-lines" aria-hidden="true"></svg>${Array.from({ length: 9 }, (_, i) => `<span class="wy-pattern-dot" data-i="${i}"><i></i></span>`).join('')}`;
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', opts.label || '解锁图案：按住并连接至少 4 个点');
    const svg = host.querySelector('svg');
    const dots = [...host.querySelectorAll('.wy-pattern-dot')];
    let path = [];
    let drawing = false;
    let tail = null;

    const center = (i) => {
      const h = host.getBoundingClientRect();
      const r = dots[i].getBoundingClientRect();
      return { x: r.left + r.width / 2 - h.left, y: r.top + r.height / 2 - h.top };
    };

    function line(a, b, cls) {
      const l = document.createElementNS(NS, 'line');
      l.setAttribute('x1', a.x);
      l.setAttribute('y1', a.y);
      l.setAttribute('x2', b.x);
      l.setAttribute('y2', b.y);
      if (cls) l.setAttribute('class', cls);
      svg.appendChild(l);
      return l;
    }

    function hitDot(x, y) {
      for (let i = 0; i < 9; i += 1) {
        const r = dots[i].getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (Math.hypot(x - cx, y - cy) < r.width * 0.55) return i;
      }
      return -1;
    }

    function add(i) {
      if (i < 0 || path.includes(i)) return;
      // Passing straight over a middle dot picks it up too, like a phone lock screen.
      const last = path[path.length - 1];
      if (last !== undefined) {
        const mid = (last + i) / 2;
        const lr = Math.floor(last / 3), lc = last % 3, ir = Math.floor(i / 3), ic = i % 3;
        if (Number.isInteger(mid) && (lr + ir) % 2 === 0 && (lc + ic) % 2 === 0 && !path.includes(mid)) add(mid);
        line(center(path[path.length - 1]), center(i));
      }
      path.push(i);
      dots[i].classList.add('is-on');
      dots[i].animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 220, easing: 'ease-out' });
      if (navigator.vibrate) navigator.vibrate(8);
    }

    function reset() {
      path = [];
      svg.innerHTML = '';
      tail = null;
      host.classList.remove('is-ok', 'is-bad');
      dots.forEach((d) => d.classList.remove('is-on'));
    }

    host.addEventListener('pointerdown', (e) => {
      if (host.classList.contains('is-locked')) return;
      e.preventDefault();
      reset();
      drawing = true;
      host.setPointerCapture(e.pointerId);
      add(hitDot(e.clientX, e.clientY));
    });
    host.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      add(hitDot(e.clientX, e.clientY));
      if (!path.length) return;
      const h = host.getBoundingClientRect();
      if (tail) tail.remove();
      tail = line(center(path[path.length - 1]), { x: e.clientX - h.left, y: e.clientY - h.top }, 'is-tail');
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      if (tail) tail.remove();
      tail = null;
      if (!path.length) return;
      if (path.length < 4) {
        flash(false);
        if (opts.onShort) opts.onShort();
        return;
      }
      if (opts.onDone) opts.onDone(path.join('-'));
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);

    function flash(ok) {
      host.classList.remove('is-ok', 'is-bad');
      void host.offsetWidth;
      host.classList.add(ok ? 'is-ok' : 'is-bad');
      if (!ok) setTimeout(reset, 650);
    }

    return { reset, flash, get value() { return path.join('-'); } };
  }

  window.WYPattern = { mount };
})();
