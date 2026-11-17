# 乌叶MC · 模组许愿池

> 你提灵感，我搓模组。一个属于乌叶MC玩家社区的模组许愿与投票站。

粉丝在这里投稿想要的模组、给别人的灵感投票；站长在后台审核、回复、置顶、
管理投票和公告。全站简体中文、移动端优先、所有资源本地托管，不依赖任何境外
CDN 或第三方统计。

---

## 目录

- [功能](#功能)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [本地运行](#本地运行)
- [环境变量](#环境变量)
- [首次启动与管理码](#首次启动与管理码)
- [测试](#测试)
- [备份与恢复](#备份与恢复)
- [部署到生产](#部署到生产)
- [安全说明](#安全说明)
- [常见问题（FAQ）](#常见问题faq)

---

## 功能

**面向访客**

- 灵感广场：浏览、按分类/状态筛选、搜索、分页，给喜欢的灵感投票；
- 灵感投稿：填写标题、说明、分类、昵称，提交后进入待审核队列；
- 投票中心：参与单选/多选投票，查看实时结果与截止时间；
- 站点首页：公告、精选评论、往期视频、分类导航；
- 规则页与 404 页；响应式布局，手机/桌面都可用；
- 访客身份用匿名 Cookie 记录，同一浏览器重复投票会被识别。

**面向站长（`/admin`）**

- 管理码登录（scrypt 哈希存储，12 小时会话）；
- 灵感审核：调整状态、填写官方回复、置顶/取消置顶、隐藏/恢复、删除；
- 投票管理：创建单选/多选投票、设置截止时间、开放/关闭、修改尚无人投票的选项、删除；
- 公告管理（含敏感词校验）；
- 导出 CSV（带 UTF-8 BOM，Excel 可直接打开）；
- 审计日志：记录管理操作及操作者 IP 哈希；
- 修改管理码（改码后所有已登录会话立即失效）。

**工程特性**

- 零运行时依赖，无构建步骤，`node server.js` 即跑；
- SQLite 单文件存储（WAL 模式），备份就是复制一个快照；
- 严格的 CSP、CSRF 校验、接口限流、HttpOnly Cookie；
- 内置 `node:test` API 集成测试；
- 所有 CSS/JS/图片/字体本地托管，大陆网络访问稳定。

---

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 22.5（推荐 24 LTS） | 使用内置 `node:sqlite`，无第三方依赖 |
| 存储 | SQLite（`node:sqlite`，WAL） | 单文件 `data/wuye.db`，自动建表与种子数据 |
| 服务端 | Node 内置 `http` 模块 | 无 Express/Koa，自行处理路由、静态文件、安全头 |
| 前端 | 原生 HTML / CSS / JavaScript | 无框架、无打包、无构建 |
| 测试 | `node:test` | 覆盖主要 API 流程，使用临时数据目录 |
| 部署 | systemd + Nginx + Let's Encrypt | 见 [deploy/README.md](deploy/README.md) |

产品与验收细则见 [CONTRACT.md](CONTRACT.md)。部署与运维见
[deploy/README.md](deploy/README.md)。

---

## 目录结构

```
wuye-mod-hub/
├── server.js                 # 入口：读取环境变量、启动 HTTP 服务
├── app.js                    # 路由、静态文件、CSRF 校验
├── package.json              # 无 dependencies；scripts: start/dev/test/backup
├── CONTRACT.md               # 产品契约（功能、接口、视觉、验收）
├── .env.example              # 环境变量示例（不会自动加载）
├── lib/
│   ├── db.js                 # SQLite 建表、种子数据、业务查询、管理码
│   ├── api.js                # /api/* 处理、登录会话、限流
│   ├── http.js               # 响应封装、安全头、静态文件缓存
│   └── security.js           # 哈希、Cookie、限流器、输入清洗、敏感词
├── public/                   # 前端页面与静态资源（无构建）
│   ├── index.html            # 首页
│   ├── ideas.html            # 灵感广场
│   ├── polls.html            # 投票中心
│   ├── admin.html            # 管理后台
│   ├── rules.html            # 站点规则
│   ├── 404.html              # 404 页
│   ├── *.css / *.js          # 页面脚本与样式
│   └── assets/               # 本地图片、字体等
├── scripts/
│   └── backup.js             # 零依赖 SQLite 在线备份脚本
├── deploy/
│   ├── README.md             # Ubuntu 24.04 部署与运维手册
│   ├── wuye-mod-hub.service  # systemd unit（含沙箱加固）
│   ├── nginx.conf            # 正式 HTTPS 站点配置
│   └── nginx-bootstrap.conf  # 首次签发证书用的纯 HTTP 配置
├── tests/
│   └── api.test.js           # node:test API 集成测试
└── data/                     # 运行时生成（不入库）：数据库、管理码
```

`data/`、`backups/`、`.env`、`node_modules/` 已在 `.gitignore` 中排除；
数据库与备份含访客信息，**不要提交到代码仓库**。

---

## 本地运行

### 前置条件

- Node.js **≥ 22.5**，推荐 **Node 24 LTS**（`node -v` 查看）；
- Node 22.x 的 `node:sqlite` 仍标记为实验特性，需要加 `--experimental-sqlite`；
  用 Node 24 则无需任何标志；
- 不需要数据库服务、不需要 `npm install`（项目没有依赖）。

### Windows（PowerShell）

```powershell
cd wuye-mod-hub
node -v            # 确认 >= 22.5，建议 v24.x

npm start          # 等价于 node server.js
# 或开发模式（改文件自动重启）：
npm run dev
```

打开 <http://127.0.0.1:8080>。首次启动会自动创建 `data/wuye.db`、写入种子数据，
并在控制台打印**首次管理码**。

想换端口或加载 `.env`：

```powershell
$env:PORT = 8090; npm start
# 或者：
Copy-Item .env.example .env   # 按需修改
node --env-file=.env server.js
```

### Linux / macOS

```bash
cd wuye-mod-hub
node -v

npm start
# 或
PORT=8090 npm start
# 或使用 .env（Node 22.5+ 支持 --env-file）
cp .env.example .env
node --env-file=.env server.js
```

后台运行（仅本地调试用；生产请用 systemd）：

```bash
npm start > wuye.log 2>&1 &
```

### 说明

- `npm start` **不会**自动读取 `.env`：项目没有 dotenv 依赖。要用 `.env` 必须
  显式 `node --env-file=.env server.js`，或先导出环境变量；
- 数据库默认在 `data/wuye.db`；想用别的位置设置 `DATA_DIR`；
- 首次启动会写入 18 条示例灵感、3 个示例投票和默认公告，方便直接看效果；
- 站点时间固定按 **UTC+8** 显示，与运行机器的时区无关。

---

## 环境变量

在启动前通过环境变量或 `.env`（需 `--env-file`）配置。生产环境由 systemd 的
`EnvironmentFile` 注入，详见 [deploy/README.md](deploy/README.md)。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；生产放在 Nginx 后建议 `127.0.0.1` |
| `DATA_DIR` | `<项目根>/data` | 数据目录（SQLite 文件、管理码文本）；相对路径按进程工作目录解析 |
| `ADMIN_CODE` | 未设置 | 仅首次初始化管理码时使用；长度 ≥ 10；设置后不会生成 `admin-code.txt` |
| `TRUST_PROXY` | `0` | 设为 `1` 时信任 `X-Forwarded-For` / `X-Forwarded-Proto`；在 Nginx/负载均衡后必须开启，否则限流与日志 IP 全部变成 127.0.0.1 |
| `COOKIE_SECURE` | `0` | 设为 `1` 时 Cookie 带 `Secure`，只经 HTTPS 发送；**生产 HTTPS 必须为 1**，纯 HTTP 调试时为 0 |
| `NODE_ENV` | 未设置 | 建议生产设为 `production`。注意：当前版本没有基于它的行为分支，API 错误始终只返回中文提示、详细堆栈只写服务端日志；保留该变量用于部署约定与后续版本 |
| `BACKUP_DIR` | `<项目根>/backups` | 仅备份脚本使用；相对路径按项目根解析 |
| `KEEP` | `14` | 仅备份脚本使用；保留最近多少份备份（≥1） |

布尔变量只认字符串 `"1"`：`TRUST_PROXY=1`、`COOKIE_SECURE=1`，写 `true` 不生效。

---

## 首次启动与管理码

第一次启动时，如果数据库里还没有管理码：

1. 若设置了 `ADMIN_CODE` 且长度 ≥ 10，用它初始化；
2. 否则自动生成 `WY-XXXX-XXXX-XXXX` 形式的随机码（去掉了易混淆的 `0/O/1/I`），
   打印到启动日志，并写入 `data/admin-code.txt`（含生成时间）；
3. 该码只以 scrypt 哈希形式存入数据库，**明文不会再次出现**。

登录：<http://127.0.0.1:8080/admin>（生产为 `https://你的域名/admin`）。
自动生成的管理码首次登录后会提示修改；改码在后台「站点设置」里完成，要求
10–64 位且不能与旧码相同，改码会立即吊销所有登录会话。

**忘记管理码**（没有后门，只能重置）：

```bash
# 先停服并备份
node scripts/backup.js
# 清掉管理码哈希和会话；下次启动会重新生成
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/wuye.db');
db.exec(\"DELETE FROM settings WHERE key = 'admin_code_hash'\");
db.exec('DELETE FROM admin_sessions');
db.close();
"
npm start   # 新管理码会打印在日志里，并写入 data/admin-code.txt
```

> 注意路径：Linux 生产环境把 `data/wuye.db` 换成绝对路径
> `/srv/wuye-mod-hub/data/wuye.db`，并用 `sudo systemctl stop wuye-mod-hub` 停服。

拿到管理码并修改后，建议删除 `data/admin-code.txt`，避免明文长期留在磁盘上。

---

## 测试

```bash
npm test
```

- 使用 Node 内置 `node:test`，共 **11 项** API 集成测试（健康检查、站点数据、
  灵感列表/详情/筛选/分页、投稿、投票、管理登录、后台操作等）；
- 测试会在系统临时目录创建独立的数据目录并随机端口，**不会读写项目里的
  `data/`**，可放心在本地或 CI 里跑；
- 如果改动过种子数据，测试中硬编码的初始数量断言（如 `ideas=12`）需要同步更新，
  否则会出现数量不匹配的失败——以实际输出为准，不要直接忽略失败。

---

## 备份与恢复

数据库是站点全部内容，请定期备份。

```bash
npm run backup
# 等价于 node scripts/backup.js
```

- 使用 `VACUUM INTO` 生成**事务一致快照**，服务运行中（WAL 模式）也可在线备份；
- 输出到 `backups/wuye-YYYYMMDD-HHmmss.db`（服务器本地时间），校验文件 > 0 字节；
- 默认只保留最近 **14** 份，更早的自动删除；可用 `BACKUP_DIR`、`KEEP` 调整；
- 备份文件与数据库一样敏感（含访客记录、IP 哈希、管理码哈希），目录权限 700，
  异地备份请加密。

恢复步骤（先停服、覆盖数据库、删除旧的 `-wal`/`-shm`、再启动）见
[deploy/README.md 的备份章节](deploy/README.md#11-备份)。生产环境的每日 cron
示例也在同一份文档里。

---

## 部署到生产

完整的 Ubuntu 24.04 部署手册（Node 24 安装、用户与权限、systemd 加固、Nginx +
Let's Encrypt、ufw 与云安全组、备份 cron、升级回滚、日志与排障）见
**[deploy/README.md](deploy/README.md)**。

最短路径：

1. 服务器安装 Node 24，创建低权限用户 `wuye`，代码放 `/srv/wuye-mod-hub`；
2. 配置 `/etc/wuye-mod-hub/wuye.env`：`HOST=127.0.0.1`、`TRUST_PROXY=1`、
   `COOKIE_SECURE=1`、`NODE_ENV=production`；
3. 安装 `deploy/wuye-mod-hub.service` 并用 systemd 启动，从日志取首次管理码；
4. 用 Nginx 反代 `127.0.0.1:8080`，certbot 签发证书，启用 `deploy/nginx.conf`；
5. 只开放 22/80/443，配置每日备份。

> 中国大陆部署前请先完成 **ICP 备案**；未备案的域名走 80/443 会被拦截。
> 不要把 8080 直接暴露公网，也不要引入境外 CDN、外部字体或统计脚本
> （CSP 只允许同源资源）。

---

## 安全说明

- **管理码**：数据库只存 scrypt 哈希（N=16384, r=8, p=1）；自动生成时明文仅写入
  `data/admin-code.txt`，取走后请删除。登录失败有固定延迟，登录接口限流
  8 次/15 分钟/IP；改码即吊销全部会话；没有默认密码。
- **会话**：`wy_admin` Cookie 为 HttpOnly、SameSite=Lax、生产环境 Secure，
  有效期 12 小时；访客标识 `wy_vid` 为随机 32 位十六进制、400 天。
- **CSRF**：所有写接口要求 `X-Requested-With: XMLHttpRequest`，且 `Origin`
  与 Host 一致，否则 403。
- **限流**：投稿 8 次/小时/IP；灵感投票 120 次/10 分钟/IP + 40 次/10 分钟/访客；
  投票中心 60 次/10 分钟/IP + 20 次/10 分钟/访客；超限返回中文提示。
  反代后务必 `TRUST_PROXY=1`，否则所有访客共用一个 IP，限流会误伤。
- **响应头**：CSP `default-src 'self'`（禁内联脚本/样式、禁外链）、
  `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy`、`Permissions-Policy`、COOP/CORP；HTTPS 下由 Nginx 统一发 HSTS。
- **输入**：标题/说明/昵称等统一清洗并限制长度，含联系方式、代练、赌博等敏感词
  的投稿会被拒绝；无文件上传功能，请求体上限 1MB。
- **数据**：`data/` 与 `backups/` 含访客 IP 哈希与全部内容，权限分别建议 700；
  备份异地存储时加密；不要把 `data/`、`.env` 提交到仓库。
- **未包含**：双因素认证、IP 白名单、WAF。管理码请用 16 位以上随机串，并保持
  系统和 Node 更新。

---

## 常见问题（FAQ）

**Q：启动报 `EADDRINUSE`（端口被占用）怎么办？**
A：换端口，例如 `PORT=8090 npm start`（Windows：`$env:PORT=8090; npm start`），
或找出占用进程停止它。生产环境 8080 应只被 Nginx 反代使用。

**Q：管理码去哪看？**
A：首次启动的控制台日志，以及 `data/admin-code.txt`。设置过 `ADMIN_CODE` 时不会
生成该文件；之后改过的码只存哈希，忘了只能按上文重置。

**Q：登录成功但马上又变成未登录？**
A：多半是 `COOKIE_SECURE=1` 却在用纯 HTTP 访问，浏览器拒绝保存 Cookie。生产环境
请配 HTTPS；本地调试临时设 `COOKIE_SECURE=0`。也可能是服务器时间偏差过大。

**Q：提交/投票提示「请求校验失败，请刷新页面后重试」？**
A：页面缓存过旧或代理丢头。刷新页面重试；确认 Nginx 透传了 `Host` 和自定义请求头；
直接用 curl 调写接口时需手动加 `X-Requested-With: XMLHttpRequest`。

**Q：提示「操作太频繁啦，休息一下再来～」？**
A：触发了限流（数值见[安全说明](#安全说明)）。等窗口过去；反向代理后没开
`TRUST_PROXY=1` 时，所有访客会被当成同一个 IP，更容易误伤。

**Q：数据存在哪里？可以直接复制 `data/` 吗？**
A：`data/wuye.db`（WAL 模式，运行时伴随 `wuye.db-wal`、`wuye.db-shm`）。
服务运行时**不要**直接 `cp` 单个 `.db` 文件，可能漏掉已提交事务；请用
`npm run backup`（在线一致快照），或停服后再整体复制/删除。

**Q：怎么清空所有数据、重新开始？**
A：停服 → 备份或删除 `data/` 目录 → 启动。程序会重新建库并写入种子数据和新的
管理码（旧的登录全部失效）。生产环境操作前先确认备份可用。

**Q：换了同名图片，浏览器还是旧的？**
A：图片响应带 7 天缓存（`max-age=604800`）。请改文件名，或在引用处加 `?v=2`
之类的版本参数。

**Q：`npm install` 报错 / 需要装依赖吗？**
A：不需要。项目零依赖，没有 `node_modules`；直接 `npm start` 或 `node server.js`。
请不要为了「补依赖」引入新的包。

**Q：Node 22 启动报 `node:sqlite` 相关错误？**
A：Node 22.x 的 SQLite 仍属实验特性，需要 `node --experimental-sqlite server.js`
（备份脚本也要加）。建议直接升级到 Node 24 LTS，无需任何标志。

**Q：页面时间为什么和服务器时区不一致？**
A：站点统一按 UTC+8 显示（面向国内玩家），这是预期行为；服务器时区只影响日志和
备份文件名的时间戳。

**Q：`NODE_ENV=production` 有什么效果？**
A：当前版本没有针对它的行为分支，设置它主要是与部署约定/监控对齐；API 错误响应
始终只返回中文提示，详细错误只写服务端日志。

**Q：可以用 PM2 / 多进程 / 多台机器吗？**
A：不要。SQLite 单文件不适合多进程并发写，本项目按**单实例**设计。需要更高并发时
先做架构评估，而不是简单 `cluster`。

**Q：支持 MySQL / PostgreSQL 吗？**
A：不支持，存储层固定为 `node:sqlite`。

**Q：为什么后台路径是 `/admin`，需要隐藏吗？**
A：路径本身不是秘密，安全性依赖强管理码 + HTTPS + 限流。不要试图用「隐藏路径」
代替强密码；如需额外保护，可在 Nginx 加 IP 白名单或 Basic Auth（自行评估）。

---

## 许可

本仓库目前未附带开源许可证文件（未声明 License）。如需转载、二次分发或商用，
请先与作者联系取得授权。
