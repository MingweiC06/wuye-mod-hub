# 乌叶MC · 模组许愿池 — 开发契约（CONTRACT）

所有接手页面的人先通读本文件，再动代码。**共享文件不要改**：`public/index.html`、`public/styles.css`、`public/app.js`、`public/home.js`、`lib/*`、`app.js`、`server.js`、`tests/*`。只写分配给你的文件；需要共享样式/脚本改动时先找 Lead。

---

## 1. 产品背景

- 抖音创作者「乌叶MC」（Minecraft 模组作者，1.8 万粉）的主页：https://www.douyin.com/user/MS4wLjABAAAADIlgVrgWvO3O5qS-WyI6QsyeNgt5k9V6OB8n3bMzNfxxDvQAH4icm1ZxptcTuA43
- 最近在更「技能独特 我来复刻！」系列：用 Minecraft 复刻《崩坏：星穹铁道》星神技能（天弓 / 药王 / 帝弓 / 琥珀王）。
- 本站给粉丝：提交模组许愿 → 大家投票 → 站长（乌叶）在后台审核、采纳、发起投票。
- 站点定位：`乌叶MC · 模组许愿池`，tagline `你提灵感，我搓模组`。
- 用户群在中国大陆：**不能依赖任何境外 CDN、外部字体、Google 服务、社交登录**；所有资源本地化。

## 2. 技术约束（硬性）

1. 零依赖：Node.js ≥ 22.5 + `node:sqlite`；前端原生 HTML/CSS/JS，无构建步骤、无 npm 前端包。
2. **CSP 很严**：`default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'`。
   - 禁止 `<style>`、`style="..."`、`<script>` 内联代码。
   - 需要页面专属样式 → 自己的 `.css` 文件；需要行为 → 自己的 `.js` 文件。
   - 动态样式（进度条宽度、显示隐藏）只能用 JS 设置 `el.style.xxx`（CSSOM，允许）。
3. 所有文案简体中文；时间显示统一 `UTC+8`，用 `WY.formatDateTime` / `WY.timeAgo`。
4. 不允许把用户输入直接 `innerHTML`；必须走 `WY.esc()` 或 `textContent`。链接 `target="_blank"` 一律加 `rel="noopener"`。
5. 移动端优先适配，至少 360 / 768 / 1024 / 1440 四档不破版。
6. 不改后端 API 契约。确需新字段，先发消息给 Lead，不要自己改 `lib/`。
7. 不要启动/重启/杀掉 8090 端口的开发服务器（Lead 在用）。要独立测试可另起 8091 等端口 + 独立 `DATA_DIR`。

## 3. 开发环境

- 项目根：`C:\Users\Chenm\Downloads\乌叶网站`
- 开发服务器：http://127.0.0.1:8090 （已在跑；`npm start` 可复现）
- 开发管理码：`wuye-dev-admin-2026`（登录 `/admin`）
- 数据目录：`./data`（SQLite `wuye.db`）；重置：停服后删 `data/wuye.db*` 再启动
- 测试：`npm test`（11 项 API 测试，必须保持全绿）

## 4. 页面骨架（逐字复用）

每个新页面必须是下面的结构。`?v=` 查询串用于破缓存，自己页面文件用 `?v=1` 即可。

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>页面标题 | 乌叶MC · 模组许愿池</title>
  <meta name="description" content="...">
  <meta name="theme-color" content="#05070d">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="/favicon.ico?v=20261119a" sizes="any">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png?v=20261119a">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16.png?v=20261119a">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png?v=20261119a">
  <link rel="stylesheet" href="/styles.css?v=20261117c">
  <link rel="stylesheet" href="/YOURPAGE.css?v=1">
  <script src="/app.js?v=20261117c" defer></script>
  <script src="/YOURPAGE.js?v=1" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>

  <!-- header 从 index.html 原样复制，data-nav 用你的页面 key -->
  <!-- ticker 从 index.html 原样复制 -->

  <main id="main">
    <!-- 页面内容 -->
  </main>

  <!-- footer 从 index.html 原样复制 -->

</body>
</html>
```

`public/index.html` 里的 header / ticker / footer 是唯一真源：直接复制，只改 `data-nav` 的激活项（`home` / `ideas` / `polls` / `rules` / `admin`）。header 结构如下（勿改 class 与 id）：

```html
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="/" aria-label="乌叶MC 模组许愿池首页">
      <span class="brand-avatar"><img src="/assets/avatar.jpg" alt="" width="42" height="42"></span>
      <span class="brand-text"><strong>乌叶MC</strong><small>MOD WISH POOL</small></span>
    </a>
    <nav class="nav" id="site-nav" aria-label="主导航">
      <a href="/" data-nav="home">首页</a>
      <a href="/ideas" data-nav="ideas">许愿池</a>
      <a href="/polls" data-nav="polls">投票</a>
      <a href="/rules" data-nav="rules">规则</a>
    </nav>
    <div class="header-actions">
      <a class="btn btn-ghost btn-sm" href="https://www.douyin.com/user/MS4wLjABAAAADIlgVrgWvO3O5qS-WyI6QsyeNgt5k9V6OB8n3bMzNfxxDvQAH4icm1ZxptcTuA43" target="_blank" rel="noopener" data-douyin-link>抖音主页</a>
      <a class="btn btn-primary btn-sm" href="/ideas#submit">我要许愿</a>
    </div>
    <button class="nav-toggle" id="nav-toggle" type="button" aria-label="展开导航" aria-expanded="false" aria-controls="site-nav"><span></span></button>
  </div>
</header>
<div class="ticker" aria-label="站点公告">
  <div class="container ticker-inner">
    <span class="ticker-label"><span class="dot"></span>公告</span>
    <div class="ticker-track"><span data-announcement>本站是乌叶MC 的粉丝许愿池：写下你想看的模组，投票让它成真。</span></div>
  </div>
</div>
```

footer 同样照 `index.html` 复制（含 `/admin`「站长入口」链接、`data-year`、`data-douyin-link`）。

## 5. 现有 CSS 组件（直接复用，不要重写）

先读 `public/styles.css` 确认细节。常用：

- 布局：`.container`、`.section`、`.section-tight`、`.section-head`、`.page-head`、`.page-head-copy`、`.page-head-aside`
- 标题：`.eyebrow`（青色小标题，含 `.dot`）、`h1/h2/h3`、`.sub`、`.muted`、`.muted-2`、`.small`、`.mono`
- 按钮：`.btn` + `.btn-primary` / `.btn-ghost` / `.btn-soft` / `.btn-danger` / `.btn-sm` / `.btn-lg`；`.link-arrow`
- 卡片：`.panel`、`.card`、`.auth-card`、`.stat-card`、`.cta-band`
- 徽标：`.badge` + `.badge-cyan` / `.badge-gold` / `.badge-pink` / `.badge-green` / `.badge-red` / `.badge-muted`；`.tag`、`.ep`、`.chip`、`.chips`
- 表单：`.field`、`.field label`、`.input`、`.textarea`、`.select`、`.check`、`.field-row`、`.form-hint`、`.form-error`、`.form-message`、`.honeypot`（蜜罐 input 的隐藏类）
- 列表：`.idea-list`、`.idea-row`、`.idea-rank`、`.idea-main`、`.idea-meta`、`.idea-vote`（含 `.is-voted`）、`.idea-card`、`.idea-desc`、`.idea-foot`
- 投票：`.poll`、`.poll-head`、`.poll-desc`、`.poll-meta`、`.poll-options`、`.poll-option`（`.is-selected` / `.is-disabled`）、`.bar`、`.poll-check`、`.poll-label`、`.poll-pct`、`.poll-foot`、`.poll-note`、`.countdown`
- 表格：`.table-wrap`、`.table`
- 弹层/提示：`.modal` + `.modal-card`、`.toast`、`.toast.error` / `.toast.success`
- 状态：`.empty`（含 `.empty-icon`）、`.skeleton`、`.skeleton-tall`、`.skeleton-row`、`.skeleton-poll`
- 分页：`.pagination`、`.pagination button`
- 工具：`.reveal`（滚动入场，JS 自动处理）、`.row`、`.between`、`.grow`
- 页面专属样式放自己的 css，优先级用页面根类，如 `body.page-ideas .foo`，避免污染全站。

设计令牌（CSS 变量）：`--bg #05070d`、`--cyan #58e6e6`、`--gold #ffd166`、`--text #e9f4f7`、`--muted #8fa6b6`、`--line`、`--panel`、`--radius 14px`、`--maxw 1180px`。视觉母题：深空星空、青色斜切标题条、像素切角（`clip-path: var(--pixel)`）、细网格 / 星点。不要引入图片以外的外部资源。

## 6. 共享 JS：`window.WY`

`app.js` 自动 `WY.mount()`：高亮导航、移动端菜单、reveal、填充 `data-announcement` / `data-year` / `data-fans` / `data-likes` / `data-idea-count` / `data-vote-count` / `data-open-polls` / `data-douyin-link`。

可用方法：

| 方法 | 说明 |
| --- | --- |
| `WY.api(path, {method, body, headers})` | `fetch` 封装；自动 `X-Requested-With: XMLHttpRequest`、`X-Device-Id`；`body` 自动 JSON；非 2xx 抛 `Error(message)`（message 为后端中文提示，带 `status` 属性和 `data`） |
| `WY.esc(s)` | HTML 转义 |
| `WY.fmtNumber(n)` | 10000+ 显示「1.2万」 |
| `WY.formatDateTime(ts)` | `2026-11-17 22:30`（UTC+8） |
| `WY.timeAgo(ts)` | 「3 分钟前」 |
| `WY.remaining(ts)` | 「还剩 6 天 23 小时」 |
| `WY.countdown(el, ts)` | 把倒计时写进元素并自动刷新，结束后文案「已结束」 |
| `WY.debounce(fn, ms)` | 防抖 |
| `WY.site()` | 缓存 `/api/site` 的 Promise |
| `WY.categoryMeta(key)` | `{key,label,icon}` |
| `WY.statusMeta(key)` | `{key,label,icon}` |
| `WY.statusBadgeClass(key)` | 返回 badge class |
| `WY.videoUrl(id)` | 抖音视频 URL |
| `WY.pollPercent(poll, option)` | 选项百分比（0-100 整数） |
| `WY.toast(message, type)` | `type`: `success` / `error` / `info` |
| `WY.dialog({title,subtitle,body,footer,wide,onClose})` | 返回 `{el, body, footer, close}`；`body`/`footer` 为可写 DOM 容器 |
| `WY.confirm({title,message,okText,danger})` | Promise\<bool\> |
| `WY.copy(text)` | 复制并 toast |

站点数据也可监听：`document.addEventListener('wy:site', e => e.detail)`。

## 7. API 契约

统一错误：`HTTP 4xx/5xx` + `{"error":{"code":"...","message":"中文提示"}}`。`WY.api` 已把 message 抛成 Error。

### 公开

- `GET /api/site`
  ```json
  {
    "site": {"name":"乌叶MC","tagline":"模组许愿池","description":"...","douyinId":"27276177171","douyinUrl":"https://...","fans":"1.8万","likes":"33.6万","works":44,"avatar":"/assets/avatar.jpg","announcement":"..."},
    "stats": {"ideas":18,"votes":680,"polls":3,"openPolls":2,"pollVotes":1328,"todayIdeas":0},
    "videos": [{"id":"770...","title":"...","series":"《... x 我的世界》","cover":"/assets/cover-amber.jpg","plays":"7.0万","likes":"5680","date":"11-16","tag":"存护 · 琥珀王"}],
    "pastVideos": [...],
    "commentPicks": [{"label":"繁育 · 虫群天灾","q":"繁育"}],
    "categories": [{"key":"aeon","label":"星神复刻","icon":"✦"}],
    "statuses": [{"key":"pending","label":"待审核","icon":"◷"}],
    "serverTime": 1763400000000
  }
  ```
- `GET /api/ideas?sort=hot|new&category=aeon&status=planned&q=关键词&page=1&pageSize=12`
  → `{items:[Idea], total, page, pageSize, hasMore}`，`Idea`：
  `{id,title,description,category,author,status,officialReply,pinned,votes,voted,createdAt,updatedAt}`
  - 公开接口**永不返回 `status=pending`**（`hidden=1` 同理）；`total` 只统计公开条目
- `POST /api/ideas`
  body：`{title:"4-40字", description:"10-600字", category:"aeon", author:"≤16字（可空）", website:""}`
  - `website` 是蜜罐，必须为空字符串
  - 成功 `201 {ok:true, idea}`（该 idea 的 `status` 为 `pending`，仅提交者在本页临时可见，刷新后从公开列表消失）
  - 常见错误：400 校验 / 409「这个灵感已经有人提过啦」/ 429 限流（8 次/小时/IP）
- `GET /api/ideas/:id` → `{idea}`；`pending` / `hidden` 一律 404
- `POST /api/ideas/:id/vote` → `{ok:true, votes, voted:true, duplicated}`（幂等；重复投票 `duplicated:true` 但不算错；`pending` / `hidden` 404）
- `DELETE /api/ideas/:id/vote` → `{ok:true, votes, voted:false}`
- `GET /api/polls` → `{items:[Poll]}`，`Poll`：
  ```json
  {"id":1,"title":"...","description":"...","allowMultiple":false,"status":"open","endsAt":1763900000000,"createdAt":1763300000000,
   "ended":false,"totalBallots":689,"totalVotes":689,
   "options":[{"id":1,"label":"纳努克 · 毁灭","description":"...","votes":198}],
   "myVote":[1]}
  ```
  `status` 只有 `open` / `closed`；`endsAt` 可能为 `null`。`myVote` 为空数组表示没投过。
- `POST /api/polls/:id/vote` body `{optionIds:[1,2]}`（单选只能 1 个；多选最多 3 个）
  - 成功 `{ok:true, poll}`（返回更新后的 Poll）
  - 409：已投过 / 已结束；400：选项不合法

### 管理（需 `wy_admin` Cookie，12 小时）

- `GET /api/admin/me` → `{authed, expiresAt, mustChange}`（`mustChange=true` 表示还在用自动生成的管理码，提示去改）
- `POST /api/admin/login` body `{code}` → `{ok:true, expiresAt}`；错误 401
- `POST /api/admin/logout` → `{ok:true}`
- `GET /api/admin/overview` → `{stats, pending:[Idea], recent:[Idea], audit:[{id,action,detail,createdAt}], polls:[Poll], announcement, mustChange, sessionExpiresAt}`
- `GET /api/admin/ideas?q=&status=&page=` → `{items:[Idea+hidden], total, page, pageSize:50, hasMore}`
  - `status` 可选：空 / `hidden` / `pending` / `planned` / `building` / `released` / `shelved`
- `PATCH /api/admin/ideas/:id` body 任选 `{status, officialReply, pinned, hidden}` → `{ok:true, idea}`
- `DELETE /api/admin/ideas/:id` → `{ok:true}`（硬删除）
- `GET /api/admin/polls` → `{items:[Poll]}`
- `POST /api/admin/polls` body `{title:"4-60", description:"≤300", endsAt:"ISO 或毫秒时间戳（≥5 分钟后）", allowMultiple:false, options:[{label:"≤30", description:"≤80"}]}`（2-8 个）→ `201 {ok:true, poll}`
- `PATCH /api/admin/polls/:id` body 任选 `{title, description, status:"open"|"closed", endsAt, allowMultiple}` → `{ok:true, poll}`
- `DELETE /api/admin/polls/:id`
- `PUT /api/admin/polls/:id/options` body `{options:[...]}` — 只有 0 票时能改，否则 409
- `PATCH /api/admin/settings` body `{announcement:"≤300"}` → `{ok:true, announcement}`
- `POST /api/admin/code` body `{current, next:"≥10 字符"}` → `{ok:true, relogin:true}`；会吊销当前会话，前端要回登录页
- `GET /api/admin/export.csv` → CSV 下载（`text/csv`；需 `credentials`，`WY.api` 已带）

注意：所有非 GET 请求必须带 `X-Requested-With`（`WY.api` 自动带），否则 403 CSRF。`credentials` 已默认 `same-origin`。

分类 key：`aeon` 星神复刻 / `anime` 动漫联动 / `mob` 生物Boss / `horror` 恐怖惊悚 / `gameplay` 机制玩法 / `music` 音乐音效 / `other` 其他灵感。
状态 key：`pending` 待审核 / `planned` 已采纳 / `building` 制作中 / `released` 已发布 / `shelved` 暂搁置。

## 8. 各页面规格与验收

### A. 许愿池 `/ideas` — 负责人：ideas-dev
文件：`public/ideas.html`、`public/ideas.css`、`public/ideas.js`

- 页头：`.page-head`，标题「许愿池」+ 一句说明 + 右侧统计（`stats.ideas` / `stats.votes`，可用 `data-idea-count`）。
- 提交表单（`<section id="submit">`）：
  - 标题、分类（7 个 chip 或 select）、描述（textarea，显示 0/600 计数）、昵称（可选，placeholder「匿名玩家」）
  - 隐藏蜜罐 `<input name="website" class="honeypot" tabindex="-1" autocomplete="off">`
  - 提交按钮 loading 态、成功 toast + 表单重置 + 列表顶部插入新卡片（`status: pending`），失败把中文错误显示在 `.form-error`
  - 前端预校验与 API 一致；不要用 alert
- 筛选栏：排序（最热 / 最新）、分类 chips（全部 + 7 类）、状态 select、搜索框（debounce 350ms，读 URL `?q=` 初始化并同步历史记录）、重置
- 列表：每页 12，卡片或 row 均可；必须显示票数、分类、作者、时间、状态徽标、官方回复（若有）、置顶标记；投票按钮调 API，乐观更新 + 防连点，429 弹 toast
- 分页：`hasMore` 时「加载更多」；或数字分页。切换筛选回到第 1 页并滚到列表顶
- 深链：支持 `/ideas?q=繁育`；支持 `#idea-123` 定位高亮（`scrollIntoView` + 临时 class）
- 空状态、加载骨架、错误重试
- 移动端筛选栏可横向滚动或折叠

### B. 投票中心 `/polls` — 负责人：polls-dev
文件：`public/polls.html`、`public/polls.css`、`public/polls.js`

- 页头「投票中心」+ 说明；统计（进行中数量、累计投票人数）
- 进行中投票列表（`status === 'open'`）：
  - 标题、说明、徽标、`共 N 人投票`、模式（单选 / 最多选 3 项）、倒计时（`WY.countdown`，`endsAt` 为 null 显示「长期开放」）
  - 选项：可点击选择（单选 radio 语义 / 多选 checkbox 语义），多选超过 3 个时禁止并提示；提交按钮「确认投票」
  - 提交后显示结果条（`WY.pollPercent` + `.bar` 宽度），禁止再次投票；409 时 toast + 刷新该投票
  - 未投票时也可先看「已有 N 人投票」，但结果条是否展示由你定：建议投票前只显示人数，投票后显示百分比（也可都显示，但不要误导）
- 已结束投票：置灰 + 结果条 + 「已结束」
- 空状态、骨架、错误重试；全部中文

### C. 管理后台 `/admin` — 负责人：admin-dev
文件：`public/admin.html`、`public/admin.css`、`public/admin.js`

- 未登录：`.auth-card` 居中，管理码输入框 + 登录按钮 + 返回首页链接 + 安全提示（不要用浏览器记住密码）；`?next=` 可选
- 登录后：顶部欢迎条（会话到期时间、`mustChange` 提醒「仍在使用自动生成的管理码，建议立即修改」）；右上角「退出登录」+「导出 CSV」
- Tabs：概览 / 灵感审核 / 投票管理 / 站点设置
  - 概览：4 个统计卡（许愿数、总票数、进行中投票、今日新增）+ 待审核列表（前 20）+ 最近操作日志
  - 灵感审核：搜索 + 状态筛选 + 分页（50/页）；每行显示标题/作者/票数/状态/置顶/隐藏；操作：改状态（select）、置顶切换、隐藏/恢复、回复（`WY.dialog` 内 textarea ≤300）、删除（`WY.confirm` danger）；操作后局部刷新
  - 投票管理：列表 + 新建（标题、说明、是否多选、结束时间 datetime-local、2-8 个选项可增删）、编辑标题/说明/状态/结束时间、删除、0 票时改选项；已有人投票时选项只读并提示「已有投票，不能修改选项」
  - 站点设置：公告 textarea（≤300）+ 保存；修改管理码（当前 + 新码 ≥10，二次确认；成功后提示重新登录并跳登录）
- 所有 `WY.api` 401 统一处理：toast「登录已过期」+ 显示登录卡
- 不要暴露管理码到 localStorage / URL / console；登录成功只依赖 Cookie
- 移动端：表格转卡片或横向滚动均可，但按钮可点

### D. 部署与文档 — 负责人：docs-deploy
文件：`README.md`、`deploy/**`、`scripts/backup.js`、`scripts/**.sh`（需要时）、`.env.example`

交付内容：
1. `README.md`：项目简介、功能、技术栈、目录、本地运行（Windows/Linux）、环境变量表（PORT/HOST/DATA_DIR/ADMIN_CODE/TRUST_PROXY/COOKIE_SECURE/NODE_ENV）、首次启动管理码说明、测试、备份、安全说明、常见问题。
2. `scripts/backup.js`：Node 脚本（无依赖），用 `node:sqlite` 打开 `data/wuye.db`，`VACUUM INTO` 到 `backups/wuye-YYYYMMDD-HHmmss.db`，校验文件大小 > 0，保留最近 14 份；支持 `BACKUP_DIR` / `KEEP` 环境变量；打印结果。`npm run backup` 必须能直接跑通。
3. `deploy/wuye-mod-hub.service`：systemd 单元（`User=www-data` 或 `wuye`、`WorkingDirectory`、`EnvironmentFile`、`ExecStart=/usr/bin/node server.js`、Restart、 hardening：NoNewPrivileges/PrivateTmp/ProtectSystem=strict + ReadWritePaths 数据目录）。
4. `deploy/nginx.conf`：80→443、TLS、反代 127.0.0.1:8080、`proxy_set_header X-Forwarded-For/Proto/Host`、client_max_body_size 1m、静态资源缓存、安全头（HSTS 等）、gzip。
5. `deploy/README.md`：Ubuntu 24.04 从零部署步骤（Node 24 安装、用户与目录权限、systemd、Nginx、certbot、防火墙/安全组、备份 cron、升级流程、日志查看、回滚）；**面向中国大陆**：域名与 ICP 备案提示、不要用境外 CDN、可选阿里云/腾讯云安全组端口说明、HTTPS 必须、`TRUST_PROXY=1` `COOKIE_SECURE=1` 的生产配置。
6. `.env.example`：带注释的示例（不含真实管理码）。
7. 不要写死真实域名/密码；用 `wuye.example.com` 占位。

### E. 规则页 `/rules` + 404 — Lead 负责，不用碰。

## 9. 协作规则

- 用 `team_task_*` 认领任务；完成后把结果写回任务并给 Lead 发消息（`send_message`）。
- 只在分配的写作用域内改文件；共享文件冲突由 Lead 统一处理。
- 测试自己的页面：`node --check public/xxx.js`；用 `fetch('http://127.0.0.1:8090/api/...')` 验证数据；浏览器打开 http://127.0.0.1:8090/ideas 等实际点一遍（含移动端宽度）。
- 不要修改 `tests/`；`npm test` 必须仍然 11/11。
- 不要提交 Git、不要部署；GitHub 由 Lead 处理。
- 遇到 API 缺字段/错误不符合契约：先停下发消息给 Lead，不要改后端。
