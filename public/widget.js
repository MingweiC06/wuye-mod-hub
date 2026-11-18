/* 乌叶MC · side tab for partner sites (Talent Map).
   Embed:  <script src="https://HUB/widget.js" data-hub="https://HUB" defer></script>
   The tab opens the whole hub full screen in an iframe, inside a Shadow DOM so
   the host page's styles never collide. Requires WIDGET_ORIGINS on the hub
   (it controls frame-ancestors). */
(function () {
  'use strict';
  if (window.__wuyeWidget) return;
  window.__wuyeWidget = true;

  const me = document.currentScript;
  const HUB = ((me && me.dataset.hub) || (me && new URL(me.src).origin) || '').replace(/\/$/, '');
  const zh = !/^en/i.test(document.documentElement.lang || 'zh');
  const T = zh
    ? { tab: '乌叶MC 许愿池', close: '关闭', open: '新窗口打开', loading: '正在跃迁至许愿池' }
    : { tab: 'Wuye MC Wishes', close: 'Close', open: 'Open in new tab', loading: 'Warping to the wish pool' };

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box}
  .tab{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:2147483000;display:flex;flex-direction:column;align-items:center;gap:8px;
    padding:16px 9px;border:0;cursor:pointer;color:#1a1408;writing-mode:vertical-rl;letter-spacing:.18em;
    font:700 13px/1 "Noto Serif SC","Songti SC","STSong",serif;
    background:linear-gradient(180deg,#f3d996,#d8b56a);clip-path:polygon(10px 0,100% 0,100% 100%,10px 100%,0 calc(100% - 10px),0 10px);
    box-shadow:-6px 0 24px rgba(0,0,0,.25);transition:padding .25s ease}
  .tab:hover{padding-right:14px}
  .tab .star{writing-mode:horizontal-tb;font-size:14px;animation:tw 2.6s ease-in-out infinite}
  @keyframes tw{50%{opacity:.35;transform:rotate(45deg)}}
  .stage{position:fixed;inset:0;z-index:2147483002;background:#07060b;clip-path:inset(50% 0 50% 0);
    transition:clip-path .7s cubic-bezier(.7,0,.2,1);pointer-events:none}
  :host([data-open]) .stage{clip-path:inset(0 0 0 0);pointer-events:auto}
  .seam{position:absolute;left:0;right:0;top:50%;height:1px;background:#f3d996;box-shadow:0 0 18px #f3d996;opacity:0}
  :host([data-open]) .seam{animation:seam .9s ease-out}
  @keyframes seam{0%{opacity:1;transform:scaleX(0)}40%{opacity:1;transform:scaleX(1)}100%{opacity:0}}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#07060b;opacity:0;transition:opacity .5s .2s}
  iframe.ready{opacity:1}
  .wait{position:absolute;inset:0;display:grid;place-items:center;color:#d8b56a;font:700 12px/1 "Cinzel",serif;letter-spacing:.4em}
  .bar{position:absolute;bottom:16px;right:16px;display:flex;gap:8px;z-index:2}
  .bar a,.bar button{display:grid;place-items:center;height:38px;min-width:38px;padding:0 12px;border:1px solid rgba(216,181,106,.5);
    background:rgba(7,6,11,.75);color:#f3d996;font:600 13px/1 system-ui,sans-serif;cursor:pointer;text-decoration:none;
    backdrop-filter:blur(6px);transition:background .2s,transform .2s}
  .bar a:hover,.bar button:hover{background:rgba(216,181,106,.2);transform:translateY(-1px)}
  .bar button{font-size:20px;padding:0}
  @media (prefers-reduced-motion:reduce){.stage,.tab,iframe{transition:none}.tab .star,.seam{animation:none}}
  @media (max-width:560px){.tab{top:auto;bottom:96px;transform:none;padding:12px 7px;font-size:12px}.bar a{display:none}}
  `;

  function mount() {
    const host = document.createElement('div');
    host.id = 'wuye-widget';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <button class="tab" type="button" aria-expanded="false" aria-controls="wy-stage"><span class="star">✦</span>${T.tab}</button>
      <div class="stage" id="wy-stage" role="dialog" aria-label="${T.tab}">
        <div class="seam"></div>
        <div class="wait">${T.loading}…</div>
        <div class="bar"><a href="${HUB}/" target="_blank" rel="noopener">${T.open} ↗</a><button class="x" type="button" aria-label="${T.close}">×</button></div>
      </div>`;
    document.body.appendChild(host);

    const tab = root.querySelector('.tab');
    const stage = root.querySelector('.stage');
    let frame = null;
    let prevOverflow = '';
    const setOpen = (open) => {
      if (open === host.hasAttribute('data-open')) return;
      if (open) {
        host.setAttribute('data-open', '');
        prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        // the host page can switch language live, so read it on every open
        const lang = /^en/i.test(document.documentElement.lang || 'zh') ? 'en' : 'zh';
        const want = `${HUB}/?lang=${lang}&embed=1`;
        if (frame && frame.dataset.lang !== lang) {
          frame.remove();
          frame = null;
        }
        if (!frame) {
          frame = document.createElement('iframe');
          frame.title = T.tab;
          frame.allow = 'autoplay; clipboard-write';
          frame.dataset.lang = lang;
          frame.src = want;
          frame.addEventListener('load', () => frame.classList.add('ready'), { once: true });
          stage.appendChild(frame);
        }
        root.querySelector('.x').focus();
      } else {
        host.removeAttribute('data-open');
        document.documentElement.style.overflow = prevOverflow;
        tab.focus();
      }
      tab.setAttribute('aria-expanded', String(open));
    };
    tab.addEventListener('click', () => setOpen(true));
    root.querySelector('.x').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
