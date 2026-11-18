/* 乌叶MC · side widget for partner sites (Talent Map).
   Embed:  <script src="https://HUB/widget.js" data-hub="https://HUB" defer></script>
   Renders inside a Shadow DOM so the host page's styles never collide.
   Read-only: shows the latest video, hot wishes, current duel and poll, and
   links into the hub for voting. Requires WIDGET_ORIGINS on the hub. */
(function () {
  'use strict';
  if (window.__wuyeWidget) return;
  window.__wuyeWidget = true;

  const me = document.currentScript;
  const HUB = ((me && me.dataset.hub) || (me && new URL(me.src).origin) || '').replace(/\/$/, '');
  const zh = !/^en/i.test(document.documentElement.lang || 'zh');
  const T = zh
    ? { tab: '乌叶MC 许愿池', latest: '最新复刻', wishes: '正在被点名', duel: '星神擂台', poll: '下期投票', go: '进入许愿池', wish: '我要许愿', votes: '票', watch: '去抖音看', close: '关闭', err: '暂时连不上许愿池' }
    : { tab: 'Wuye MC Wishes', latest: 'Latest build', wishes: 'Most wanted', duel: 'Aeon Arena', poll: 'Next episode poll', go: 'Open wish pool', wish: 'Make a wish', votes: 'votes', watch: 'Watch on Douyin', close: 'Close', err: 'Wish pool is offline right now' };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const abs = (p) => (/^https?:/.test(p) ? p : `${HUB}${p}?w=1`);

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
  .scrim{position:fixed;inset:0;z-index:2147483001;background:rgba(5,4,9,.45);opacity:0;pointer-events:none;transition:opacity .3s}
  .panel{position:fixed;top:0;right:0;bottom:0;z-index:2147483002;width:min(380px,92vw);overflow-y:auto;
    transform:translateX(105%);transition:transform .38s cubic-bezier(.2,.8,.2,1);
    color:#ece4d2;font:14px/1.6 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    background:radial-gradient(420px 300px at 100% 0,rgba(164,138,216,.18),transparent 70%),
      radial-gradient(1px 1px at 20% 30%,#fff 50%,transparent 51%) 0 0/120px 120px,
      radial-gradient(1px 1px at 70% 80%,#d8b56a 50%,transparent 51%) 0 0/160px 160px,#07060b;
    border-left:1px solid rgba(216,181,106,.4);box-shadow:-30px 0 80px rgba(0,0,0,.5)}
  :host([data-open]) .panel{transform:none}
  :host([data-open]) .scrim{opacity:1;pointer-events:auto}
  .head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid rgba(216,181,106,.2)}
  .brand{font:700 18px/1.2 "Noto Serif SC","Songti SC",serif}
  .brand small{display:block;font:700 9px/1 "Cinzel",serif;letter-spacing:.35em;color:#d8b56a;margin-top:4px}
  .x{background:none;border:0;color:#a49c8b;font-size:22px;cursor:pointer;line-height:1}
  .x:hover{color:#f3d996}
  section{padding:16px 20px;border-bottom:1px solid rgba(216,181,106,.12)}
  h3{margin:0 0 10px;font:700 10px/1 "Cinzel",serif;letter-spacing:.3em;color:#d8b56a;text-transform:uppercase}
  h3 span{font-family:"Noto Serif SC",serif;letter-spacing:.1em;margin-left:6px;color:#ece4d2}
  a{color:inherit;text-decoration:none}
  .poster{display:grid;grid-template-columns:96px 1fr;gap:14px;align-items:end}
  .poster img{width:96px;height:128px;object-fit:cover;clip-path:polygon(0 0,calc(100% - 14px) 0,100% 14px,100% 100%,14px 100%,0 calc(100% - 14px))}
  .poster strong{display:block;font:700 16px/1.35 "Noto Serif SC","Songti SC",serif}
  .poster em{font-style:normal;color:#a49c8b;font-size:12px}
  .poster .lnk{display:inline-block;margin-top:8px;color:#d8b56a;border-bottom:1px solid rgba(216,181,106,.4);font-size:12px}
  ol{list-style:none;margin:0;padding:0}
  li a{display:grid;grid-template-columns:24px 1fr auto;gap:10px;align-items:baseline;padding:8px 0;border-bottom:1px solid rgba(216,181,106,.1)}
  li a:hover b,li a:hover .t{color:#f3d996}
  li i{font:700 12px "Cinzel",serif;font-style:normal;color:#6f685b}
  li:first-child i{color:#f3d996}
  .t{font-family:"Noto Serif SC",serif;font-size:14px;transition:color .2s}
  li b{color:#d8b56a;font-size:12px;font-weight:600}
  .duel{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;font-family:"Noto Serif SC",serif;font-size:14px}
  .duel span:last-child{text-align:right}
  .vs{font:700 12px "Cinzel",serif;color:#d8b56a}
  .bar{height:2px;background:rgba(216,181,106,.15);margin:6px 0 2px}
  .bar i{display:block;height:100%;background:linear-gradient(90deg,#d8b56a,#f3d996)}
  .opt{display:flex;justify-content:space-between;font-size:13px;margin-top:8px}
  .opt b{color:#f3d996;font-family:"Cinzel",serif}
  .cta{display:flex;gap:10px;padding:18px 20px 26px}
  .btn{flex:1;text-align:center;padding:11px 10px;font:700 14px/1 "Noto Serif SC",serif;letter-spacing:.08em;
    clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
  .gold{background:linear-gradient(180deg,#f3d996,#d8b56a);color:#1a1408}
  .ghost{border:1px solid rgba(216,181,106,.45);color:#f3d996}
  .muted{color:#a49c8b;padding:30px 20px}
  @media (prefers-reduced-motion:reduce){.panel,.tab{transition:none}.tab .star{animation:none}}
  @media (max-width:560px){.tab{top:auto;bottom:96px;transform:none;padding:12px 7px;font-size:12px}}
  `;

  function render(data) {
    const v = data.latest;
    const latest = v
      ? `<section><h3>LATEST<span>${T.latest}</span></h3><div class="poster">
          <img src="${esc(abs(v.cover))}" alt="" loading="lazy">
          <div><strong>${esc(v.title)}</strong><em>${esc([v.series, v.date].filter(Boolean).join(' · '))}</em><br>
          <a class="lnk" href="https://www.douyin.com/video/${esc(v.id)}" target="_blank" rel="noopener">${T.watch} →</a></div></div></section>`
      : '';
    const wishes = (data.ideas || []).length
      ? `<section><h3>WISHES<span>${T.wishes}</span></h3><ol>${data.ideas
          .map((w, i) => `<li><a href="${HUB}/ideas#idea-${w.id}" target="_blank" rel="noopener"><i>${['I', 'II', 'III', 'IV', 'V'][i]}</i><span class="t">${esc(w.title)}</span><b>${w.votes} ${T.votes}</b></a></li>`)
          .join('')}</ol></section>`
      : '';
    const m = data.bracket && data.bracket.matches && data.bracket.matches[0];
    const duel = data.bracket
      ? data.bracket.champion
        ? `<section><h3>ARENA<span>${T.duel}</span></h3><div class="duel"><span>✦ ${esc(data.bracket.champion)}</span></div></section>`
        : m
          ? `<section><a href="${HUB}/arena" target="_blank" rel="noopener"><h3>ARENA<span>${T.duel}</span></h3>
            <div class="duel"><span>${esc(m.a)}</span><span class="vs">VS</span><span>${esc(m.b)}</span></div>
            <div class="bar"><i style="width:${m.votesA + m.votesB ? Math.round((m.votesA / (m.votesA + m.votesB)) * 100) : 50}%"></i></div></a></section>`
          : ''
      : '';
    const p = data.poll;
    const poll = p
      ? `<section><a href="${HUB}/polls" target="_blank" rel="noopener"><h3>POLL<span>${T.poll}</span></h3><div class="t">${esc(p.title)}</div>${p.options
          .map((o) => {
            const pct = p.totalVotes ? Math.round((o.votes / p.totalVotes) * 100) : 0;
            return `<div class="opt"><span>${esc(o.label)}</span><b>${pct}%</b></div><div class="bar"><i style="width:${pct}%"></i></div>`;
          })
          .join('')}</a></section>`
      : '';
    return latest + wishes + duel + poll;
  }

  function mount() {
    const host = document.createElement('div');
    host.id = 'wuye-widget';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <button class="tab" type="button" aria-expanded="false" aria-controls="wy-panel"><span class="star">✦</span>${T.tab}</button>
      <div class="scrim"></div>
      <aside class="panel" id="wy-panel" role="dialog" aria-label="${T.tab}">
        <div class="head"><div class="brand">乌叶MC<small>MOD WISH POOL</small></div><button class="x" type="button" aria-label="${T.close}">×</button></div>
        <div class="body"><p class="muted">…</p></div>
        <div class="cta"><a class="btn ghost" href="${HUB}/" target="_blank" rel="noopener">${T.go}</a><a class="btn gold" href="${HUB}/ideas#submit" target="_blank" rel="noopener">${T.wish}</a></div>
      </aside>`;
    document.body.appendChild(host);

    const tab = root.querySelector('.tab');
    let loaded = false;
    const setOpen = (open) => {
      if (open) host.setAttribute('data-open', '');
      else host.removeAttribute('data-open');
      tab.setAttribute('aria-expanded', String(open));
      if (open && !loaded) {
        loaded = true;
        fetch(`${HUB}/api/widget`, { credentials: 'omit' })
          .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
          .then((data) => {
            root.querySelector('.body').innerHTML = render(data);
          })
          .catch(() => {
            loaded = false;
            root.querySelector('.body').innerHTML = `<p class="muted">${T.err}</p>`;
          });
      }
      if (open) root.querySelector('.x').focus();
    };
    tab.addEventListener('click', () => setOpen(!host.hasAttribute('data-open')));
    root.querySelector('.x').addEventListener('click', () => {
      setOpen(false);
      tab.focus();
    });
    root.querySelector('.scrim').addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && host.hasAttribute('data-open')) setOpen(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
