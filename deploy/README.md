# 乌叶MC · 模组许愿池 — 生产部署与运维手册（Ubuntu 24.04）

本文把一台全新的 **Ubuntu 24.04 LTS** 云服务器，一步步变成可以对外访问的
「乌叶MC · 模组许愿池」站点。命令默认用 `sudo` 执行；示例域名统一写成
`wuye.example.com`，部署时请全部替换成你自己的、**已完成 ICP 备案**的域名。

> 适用范围：单机、单进程、SQLite。项目零运行时依赖，**不需要 `npm install`**，
> 也没有构建步骤。Node 进程只监听 `127.0.0.1:8080`，由 Nginx 终结 TLS 并反代。

---

## 目录

1. [架构与前提](#1-架构与前提)
2. [中国大陆合规与网络](#2-中国大陆合规与网络)
3. [准备服务器](#3-准备服务器)
4. [安装 Node.js 24](#4-安装-nodejs-24)
5. [创建运行用户与目录](#5-创建运行用户与目录)
6. [上传代码](#6-上传代码)
7. [配置环境变量](#7-配置环境变量)
8. [安装 systemd 服务](#8-安装-systemd-服务)
9. [配置 Nginx 与 HTTPS 证书](#9-配置-nginx-与-https-证书)
10. [防火墙与云安全组](#10-防火墙与云安全组)
11. [备份](#11-备份)
12. [升级与回滚](#12-升级与回滚)
13. [日志与监控](#13-日志与监控)
14. [安全检查清单](#14-安全检查清单)
15. [故障排查](#15-故障排查)
16. [常用命令速查](#16-常用命令速查)

---

## 1. 架构与前提

```
                 ┌────────────────────────────────────────────┐
  访客 ──443──▶  │ Nginx（TLS 终结、HSTS、gzip、静态缓存）      │
                 │        │                                   │
                 │        └── proxy_pass ──▶ 127.0.0.1:8080   │
                 │                              Node.js 进程   │
                 │                              ├─ public/    │
                 │                              └─ data/      │
                 │                                  └─ wuye.db │
                 └────────────────────────────────────────────┘
```

- **运行方式**：`systemd` 管理单个 Node 进程，`User=wuye`，工作目录 `/srv/wuye-mod-hub`。
- **数据**：SQLite 单文件 `/srv/wuye-mod-hub/data/wuye.db`（WAL 模式，运行时旁边会有
  `wuye.db-wal`、`wuye.db-shm`）。**数据库里就有全部站点内容，备份它等于备份一切。**
- **管理后台**：`https://你的域名/admin`。首次启动会自动生成管理码，只打印在日志里、
  并写入 `data/admin-code.txt`；登录后请立即改码。
- **端口**：对外只开 80/443；8080 只给本机 Nginx，云安全组和 ufw 都不要放行 8080。
- **时区**：站点页面固定按 **UTC+8** 显示时间，不随服务器时区漂移；但**备份文件名、
  日志时间戳用服务器本地时间**，所以仍建议把系统时区设为 `Asia/Shanghai`。
- **规模**：单实例。SQLite 不适合多进程/多机同时写，不要用 PM2 cluster、不要起两个副本。

**你需要准备：**

- 一台 Ubuntu 24.04 LTS 云服务器（1 核 1G 起步即可；建议 ≥20GB 磁盘）；
- 一个已备案、已解析到该服务器公网 IP 的域名（A 记录，IPv6 可选 AAAA）；
- 服务器 root 或可 sudo 的账号；本地有 `ssh`、`scp`/`rsync`。

---

## 2. 中国大陆合规与网络

这一节不是法律意见，但都是大陆部署会真实卡住的地方：

1. **ICP 备案**：域名解析到中国大陆境内服务器、通过 80/443 对外提供网站服务，
   必须先完成 **ICP 备案**（在服务器所属云厂商的备案系统提交，通常 7–20 个工作日）。
   未备案时，云厂商会拦截 80/443 访问，甚至要求关站；备案期间不要对外宣传域名。
2. **公安联网备案**：网站上线后 30 日内，在「全国互联网安全管理服务平台」完成
   公安备案，并按要求在页脚展示备案号（如需展示，自行在 `public/` 页面添加）。
3. **必须 HTTPS**：本站的登录 Cookie 在生产环境设置了 `Secure`，纯 HTTP 无法保持登录；
   浏览器也会把登录表单标成不安全。证书用 Let's Encrypt 即可，免费。
4. **不要依赖境外资源**：项目已经把 CSS/JS/图片/字体全部放在 `public/assets/` 本地，
   部署时**不要**再引入 Google Fonts、jsDelivr、unpkg、境外统计脚本或境外 CDN。
   一来大陆访问慢/不稳定，二来会被严格的 CSP（`default-src 'self'`）直接拦掉。
5. **云厂商安全组**：除了系统内的 ufw，云控制台的**安全组**也要放行 22/80/443，
   并封掉 8080、8090 等调试端口——两层防火墙都要配，缺一层都可能连不上或裸奔。
6. **日志留存**：按《网络安全法》常见要求，网络日志留存不少于 6 个月。Nginx 默认
   logrotate 只保留 14 天，如有合规需要请调大（见 §13）。
7. **内容审核**：这是用户投稿站，后台有审核/隐藏/删除和敏感词过滤；请安排人定期看
   后台「待审核」和举报内容，别让站点无人值守。

---

## 3. 准备服务器

SSH 登录后：

```bash
# 1) 更新系统
sudo apt update && sudo apt upgrade -y

# 2) 时区设为北京时间（影响备份文件名和日志时间）
sudo timedatectl set-timezone Asia/Shanghai
timedatectl

# 3) 基础工具（curl 下载、xz 解压 Node 包、ca-certificates 校验 TLS）
sudo apt install -y curl ca-certificates tar xz-utils ufw nginx certbot

# 4) 确认时间同步正常（证书校验、TOTP/日志都依赖）
timedatectl show -p NTPSynchronized --value   # 期望 yes
```

> 不建议用 `apt install nodejs`：Ubuntu 24.04 仓库里的 Node 是 18.x，低于项目要求的
> Node ≥22.5，`node:sqlite` 不可用。请按下一节安装 Node 24。

---

## 4. 安装 Node.js 24

项目要求 **Node.js ≥ 22.5**（`node:sqlite`）；生产直接用 **Node 24 LTS** 最稳。
22.x 也能跑，但需要给进程加 `--experimental-sqlite`，systemd 与备份 cron 都要改，不推荐。

### 4.1 国内镜像安装（推荐，快且可校验）

```bash
cd /tmp
# 从 npmmirror 的 latest-v24.x 目录取实际文件名，避免写死小版本号
FILE=$(curl -fsSL https://npmmirror.com/mirrors/node/latest-v24.x/ \
  | grep -oE 'node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | head -n1)
echo "将安装：$FILE"

curl -fsSLO "https://npmmirror.com/mirrors/node/latest-v24.x/$FILE"
curl -fsSLO https://npmmirror.com/mirrors/node/latest-v24.x/SHASUMS256.txt

# 校验下载包（只校验存在的文件）
sha256sum --check --ignore-missing SHASUMS256.txt

# 解压到 /usr/local（node/npm/npx 落到 /usr/local/bin）
sudo tar -xJf "$FILE" -C /usr/local --strip-components=1

# systemd unit 里写的是 /usr/bin/node，做一个软链
sudo ln -sf /usr/local/bin/node /usr/bin/node

node -v    # 期望 v24.x.y
npm -v
```

> 如果云服务器是 ARM（如部分倚天/鲲鹏机型），把上面的 `linux-x64` 换成 `linux-arm64`。

### 4.2 备选：NodeSource 官方源（境外，可能较慢）

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

> 境外源在大陆可能超时；失败就回 4.1。**不要**用 nvm 给 systemd 装 Node——
> nvm 的路径在用户家目录，`ProtectHome=true` 之后服务读不到。

---

## 5. 创建运行用户与目录

```bash
# 专用系统用户，不能登录、没有家目录 shell
sudo useradd --system --user-group \
  --home-dir /srv/wuye-mod-hub --shell /usr/sbin/nologin wuye

# 站点目录与数据目录
sudo install -d -o wuye -g wuye -m 750 /srv/wuye-mod-hub
sudo install -d -o wuye -g wuye -m 700 /srv/wuye-mod-hub/data

# 环境变量目录（root 专属）
sudo install -d -o root -g root -m 700 /etc/wuye-mod-hub

# certbot webroot 验证目录
sudo install -d -o root -g root -m 755 /var/www/certbot
```

权限约定：

| 路径 | 属主 | 权限 | 说明 |
| --- | --- | --- | --- |
| `/srv/wuye-mod-hub` | `wuye:wuye` | 750 | 代码，Node 只读 |
| `/srv/wuye-mod-hub/data` | `wuye:wuye` | 700 | 数据库 + 管理码文件，**最敏感** |
| `/srv/wuye-mod-hub/backups` | `wuye:wuye` | 700 | 备份脚本自动创建 |
| `/etc/wuye-mod-hub/wuye.env` | `root:root` | 600 | 含管理码，任何其他用户不可读 |

---

## 6. 上传代码

项目零依赖，**不用 `npm install`，不要上传 `node_modules/`**。

### 方式 A：本地打包上传（Windows / Linux 通用）

在**项目根目录**执行（Windows PowerShell 用 `tar` + `scp`，Win10+ 自带）：

```bash
tar --exclude='./data' --exclude='./backups' --exclude='./node_modules' \
    --exclude='./.env' --exclude='./.env.local' \
    -czf wuye-mod-hub.tar.gz .

scp wuye-mod-hub.tar.gz root@服务器IP:/tmp/
```

服务器上：

```bash
sudo tar -xzf /tmp/wuye-mod-hub.tar.gz -C /srv/wuye-mod-hub
sudo chown -R wuye:wuye /srv/wuye-mod-hub
sudo find /srv/wuye-mod-hub -type d -exec chmod 750 {} \;
sudo find /srv/wuye-mod-hub -type f -exec chmod 640 {} \;
sudo chmod 750 /srv/wuye-mod-hub
sudo chmod 700 /srv/wuye-mod-hub/data /srv/wuye-mod-hub/backups 2>/dev/null || true
```

### 方式 B：rsync（后续升级更省事）

以 root 上传（`wuye` 是不允许登录的系统用户，不能直接用它 SSH），上传完再归位属主：

```bash
rsync -avz --delete \
  --exclude 'data/' --exclude 'backups/' --exclude 'node_modules/' \
  --exclude '.env' --exclude '.env.local' \
  ./ root@服务器IP:/srv/wuye-mod-hub/

ssh root@服务器IP 'chown -R wuye:wuye /srv/wuye-mod-hub'
```

> 别把本地 `_smoke.mjs`、`tools/` 调试脚本带上生产也行，但不影响运行；
> `data/` 与 `backups/` **必须排除**，否则会覆盖线上数据。

上传后确认关键文件在：

```bash
ls -l /srv/wuye-mod-hub/server.js /srv/wuye-mod-hub/app.js \
      /srv/wuye-mod-hub/deploy/wuye-mod-hub.service \
      /srv/wuye-mod-hub/scripts/backup.js
```

---

## 7. 配置环境变量

```bash
sudo tee /etc/wuye-mod-hub/wuye.env >/dev/null <<'EOF'
# 乌叶MC · 模组许愿池 — 生产环境变量
PORT=8080
HOST=127.0.0.1
DATA_DIR=/srv/wuye-mod-hub/data

# 反代后必须为 1：限流按真实访客 IP 计算，后台审计日志也依赖它
TRUST_PROXY=1
# 生产 HTTPS 必须为 1；纯 HTTP 调试时才设 0
COOKIE_SECURE=1

# 当前版本没有基于 NODE_ENV 的行为分支，保留以对齐部署约定
NODE_ENV=production

# 可选：首次初始化站长管理码，>=10 位，建议 16 位以上随机串。
# 只在数据库还没有管理码时生效；设置后不会生成 data/admin-code.txt。
# ADMIN_CODE=请替换成你自己的强随机管理码

# 可选：备份脚本参数（相对路径按项目根解析）
# BACKUP_DIR=/srv/wuye-mod-hub/backups
# KEEP=14
EOF

sudo chown root:root /etc/wuye-mod-hub/wuye.env
sudo chmod 600 /etc/wuye-mod-hub/wuye.env
```

说明：

- `HOST=127.0.0.1` 让 Node 只监听回环地址，公网无法直连 8080。
- 不设 `ADMIN_CODE` 时，首次启动生成 `WY-XXXX-XXXX-XXXX` 并写
  `data/admin-code.txt`；**拿到码后建议删掉这个文件**（数据库里只存 scrypt 哈希）。
- 改码请登录后台 →「站点设置」；改码会吊销所有登录会话。

---

## 8. 安装 systemd 服务

```bash
sudo cp /srv/wuye-mod-hub/deploy/wuye-mod-hub.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now wuye-mod-hub

# 看状态与首次启动日志
systemctl status wuye-mod-hub --no-pager
sudo journalctl -u wuye-mod-hub -n 60 --no-pager
```

首次启动的日志里会出现管理码（类似）：

```
  乌叶MC · 模组许愿池
  站点地址   http://127.0.0.1:8080
  管理后台   http://127.0.0.1:8080/admin
  数据目录   /srv/wuye-mod-hub/data

  ┌──────────────────────────────────────────────┐
  │  首次启动，管理员登录码（请立即保存）：      │
  │    WY-XXXX-XXXX-XXXX                        │
  │  也保存在 data/admin-code.txt                │
  └──────────────────────────────────────────────┘
```

把它抄到密码管理器，然后：

```bash
# 本机健康检查
curl -fsS http://127.0.0.1:8080/api/health
# {"ok":true,"uptime":...}

# 可选：记下管理码后删除明文文件
sudo -u wuye rm -f /srv/wuye-mod-hub/data/admin-code.txt
```

> `deploy/wuye-mod-hub.service` 已经做了 systemd 沙箱加固：
> `ProtectSystem=strict` + 仅 `ReadWritePaths=/srv/wuye-mod-hub/data` 可写、
> `ProtectHome=true`、`PrivateTmp=true`、`NoNewPrivileges=true` 等。
> **不要**给 Node 加 `MemoryDenyWriteExecute=true`——V8 JIT 需要可执行内存，
> 开了会直接启动失败。如果以后把代码挪到别的路径，记得同步改
> `WorkingDirectory`、`ReadWritePaths` 和 `EnvironmentFile`。

---

## 9. 配置 Nginx 与 HTTPS 证书

### 9.1 先确认 DNS 与备案

```bash
getent hosts wuye.example.com      # 应返回服务器公网 IP
```

域名必须已解析、已备案，且云安全组放行 80；否则下面 certbot 验证会失败。

### 9.2 用引导配置让站点先跑起来（纯 HTTP）

```bash
sudo rm -f /etc/nginx/sites-enabled/default

# 把示例域名替换成真实域名后再复制
sudo cp /srv/wuye-mod-hub/deploy/nginx-bootstrap.conf /etc/nginx/sites-available/wuye-mod-hub
sudo ln -sf /etc/nginx/sites-available/wuye-mod-hub /etc/nginx/sites-enabled/wuye-mod-hub

sudo nginx -t
sudo systemctl reload nginx

# 本机验证反代（绕过 DNS，直接看 Host 路由）
curl -I -H 'Host: wuye.example.com' http://127.0.0.1/
curl -fsS -H 'Host: wuye.example.com' http://127.0.0.1/api/health
```

### 9.3 申请 Let's Encrypt 证书（webroot 模式）

```bash
sudo certbot certonly --webroot -w /var/www/certbot \
  -d wuye.example.com \
  --email you@example.com --agree-tos --no-eff-email
```

成功后证书在 `/etc/letsencrypt/live/wuye.example.com/`：

- `fullchain.pem`、`privkey.pem`、`chain.pem` —— 与 `deploy/nginx.conf` 中的路径一致。

> 验证失败常见原因：域名解析未生效、80 被安全组/备案拦截、`/var/www/certbot` 权限不对。
> 大陆网络下 Let's Encrypt 的 ACME 服务一般可达；若实在不通，可改用
> **DNS-01 验证**（`certbot certonly --manual --preferred-challenges dns`，按提示到域名商
> 加 TXT 记录），或直接使用云厂商的免费 DV 证书，把证书文件放到上述路径即可。
> 不要把私钥提交到代码仓库。

### 9.4 切换到正式 HTTPS 配置

先替换文件里的域名占位符，再覆盖：

```bash
sudo cp /srv/wuye-mod-hub/deploy/nginx.conf /etc/nginx/sites-available/wuye-mod-hub
sudo nginx -t
sudo systemctl reload nginx

# 验证
curl -I http://wuye.example.com            # 期望 301 → https
curl -I https://wuye.example.com           # 期望 200
curl -fsS https://wuye.example.com/api/health
```

`deploy/nginx.conf` 已包含：

- 80 → 443 跳转，并保留 `/.well-known/acme-challenge/` 供续期；
- TLS 1.2/1.3、HSTS（`max-age=31536000; includeSubDomains`）；
- 反代 `127.0.0.1:8080`，传递 `Host` / `X-Real-IP` / `X-Forwarded-For` /
  `X-Forwarded-Proto` / `X-Forwarded-Host`；
- `client_max_body_size 1m`、gzip、静态图片/字体 7 天缓存；
- 隐藏 Node 自己发的 HSTS，避免重复头；其余 CSP 等安全头仍由 Node 统一发。

> Ubuntu 24.04 的 Nginx 是 1.24，`http2` 只能写在 `listen ... ssl http2;` 里；
> 配置注释中已给出 Nginx ≥1.25.1 的新写法。

### 9.5 证书自动续期

```bash
# 查看续期定时器
systemctl list-timers | grep certbot

# 演练（验证 DNS/80 端口/续期流程是否走通；演练不会执行 deploy hook）
sudo certbot renew --dry-run
```

续期成功后需要让 Nginx 重新加载证书。推荐在**首次签发**时就把钩子写进
`/etc/letsencrypt/renewal/wuye.example.com.conf`，或签发后编辑该文件，在
`[renewalparams]` 里加一行：

```ini
renew_hook = systemctl reload nginx
```

也可以重新签发一次并带上 `--deploy-hook "systemctl reload nginx"`。证书约 90 天
有效，certbot 定时器会在到期前 30 天自动续期；如手动签的 DNS 证书，记得在到期前更新。

---

## 10. 防火墙与云安全组

### 10.1 系统内 ufw

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'     # 80 + 443
sudo ufw enable
sudo ufw status verbose
```

**不要** `ufw allow 8080`，否则 Node 的裸 HTTP 会绕过 Nginx 直接暴露公网。

### 10.2 云厂商安全组

在云控制台给实例绑定的安全组添加入方向规则：

| 方向 | 端口 | 来源 | 说明 |
| --- | --- | --- | --- |
| 入 | 22/TCP | 你的固定 IP（尽量） | SSH，别对 `0.0.0.0/0` 全开 |
| 入 | 80/TCP | `0.0.0.0/0` | HTTP 跳转 + ACME |
| 入 | 443/TCP | `0.0.0.0/0` | HTTPS |
| 入 | 8080/8090 | 不添加 | 禁止公网直连 Node |

出方向一般默认全放行；若做了严格出站限制，至少放行 80/443（certbot、系统更新）
和 123/UDP（NTP）。

---

## 11. 备份

数据库就是全部内容，**备份是运维里最重要的一件事**。

### 11.1 手动备份

```bash
sudo -u wuye /usr/bin/node /srv/wuye-mod-hub/scripts/backup.js
```

输出示例（真实结果，约 200KB）：

```
乌叶MC · 模组许愿池 — 数据备份
  数据库    /srv/wuye-mod-hub/data/wuye.db
  备份目录  /srv/wuye-mod-hub/backups

  备份文件  /srv/wuye-mod-hub/backups/wuye-20261117-142953.db
  文件大小  208.0 KB
  保留策略  最近 14 份（现有 1 份，本次清理 0 份）

备份完成。
```

脚本行为：

- 用 Node 内置 `node:sqlite` 打开数据库，执行 `VACUUM INTO` 生成**事务一致快照**；
  数据库开着（WAL 模式）也能在线备份，**不需要停服**，也不改源库；
- 文件名校验为 `wuye-YYYYMMDD-HHmmss.db`（服务器本地时间），同一秒重复执行会加
  `-2`、`-3` 后缀；
- 校验备份文件 > 0 字节；
- 只保留最近 `KEEP` 份（默认 14），更早的自动删除；`BACKUP_DIR`、`KEEP` 可用环境
  变量覆盖，相对路径按项目根解析；
- 任何一步失败以退出码 1 结束并打印中文原因（如数据库不存在、目录不可写）。

### 11.2 定时备份（cron）

Ubuntu 上 cron 默认已安装。给 `wuye` 用户加任务：

```bash
sudo -u wuye crontab -e
```

加入（每天 03:17，日志进 syslog，标签 `wuye-backup`）：

```cron
17 3 * * * cd /srv/wuye-mod-hub && /usr/bin/node scripts/backup.js 2>&1 | logger -t wuye-backup
```

验证：

```bash
sudo ls -lh /srv/wuye-mod-hub/backups
sudo journalctl -t wuye-backup -n 30 --no-pager
```

建议再加一条**每周异地备份**：把 `backups/` 同步到另一台机器或对象存储（例如
云厂商 OSS/COS，选符合你合规要求的区域），并在传输/存储时加密——备份里含全部
访客记录、IP 哈希、管理码哈希，泄露等于站点被看光：

```bash
# 示例：rsync 到另一台服务器（需要先配好 wuye 用户的 SSH 密钥）
rsync -az --delete /srv/wuye-mod-hub/backups/ backup@10.0.0.2:/data/wuye-backups/
```

保留策略在异地端也要有，别无限增长。

### 11.3 恢复

```bash
# 1) 停服（避免边恢复边写入）
sudo systemctl stop wuye-mod-hub

# 2) 先备份现场（万一恢复错了还能回去）
sudo -u wuye cp /srv/wuye-mod-hub/data/wuye.db /tmp/wuye-before-restore.db

# 3) 覆盖数据库，并删掉旧的 WAL/SHM，否则 SQLite 会用旧日志覆盖你的恢复
sudo -u wuye cp /srv/wuye-mod-hub/backups/wuye-YYYYMMDD-HHmmss.db \
  /srv/wuye-mod-hub/data/wuye.db
sudo rm -f /srv/wuye-mod-hub/data/wuye.db-wal /srv/wuye-mod-hub/data/wuye.db-shm

# 4) 权限归位并启动
sudo chown wuye:wuye /srv/wuye-mod-hub/data/wuye.db
sudo chmod 600 /srv/wuye-mod-hub/data/wuye.db
sudo systemctl start wuye-mod-hub
curl -fsS http://127.0.0.1:8080/api/health
```

恢复后管理码仍是备份时的那个；`data/admin-code.txt` 不在数据库里，不重要。

> 直接 `cp data/wuye.db` 热拷贝**不可靠**（可能漏掉 WAL 里已提交的事务）；
> 请用 `scripts/backup.js` 或先停服。

---

## 12. 升级与回滚

### 12.1 升级

```bash
# 1) 先备份数据库
sudo -u wuye /usr/bin/node /srv/wuye-mod-hub/scripts/backup.js

# 2) 旧代码留档（排除 data/backups，避免把大文件打进包）
sudo tar -czf /root/wuye-mod-hub-$(date +%F-%H%M).tar.gz \
  -C /srv --exclude='wuye-mod-hub/data' --exclude='wuye-mod-hub/backups' wuye-mod-hub

# 3) 上传新代码（见 §6，务必排除 data/、backups/、.env*）

# 4) 重启并验证
sudo systemctl restart wuye-mod-hub
systemctl status wuye-mod-hub --no-pager
curl -fsS http://127.0.0.1:8080/api/health
sudo journalctl -u wuye-mod-hub -n 30 --no-pager
```

零依赖项目没有 `npm install`、没有迁移命令；新版本若改了数据库结构，代码会在启动时
自动处理。升级窗口通常 1–2 秒，可忽略。

### 12.2 回滚代码

```bash
sudo systemctl stop wuye-mod-hub
sudo tar -xzf /root/wuye-mod-hub-日期.tar.gz -C /srv
sudo chown -R wuye:wuye /srv/wuye-mod-hub
sudo systemctl start wuye-mod-hub
curl -fsS http://127.0.0.1:8080/api/health
```

### 12.3 回滚数据

按 §11.3 恢复备份。**注意**：升级后如果用户已经产生新数据，回滚数据库会丢这部分，
先评估再操作。

---

## 13. 日志与监控

```bash
# 应用日志（含启动信息、错误）
sudo journalctl -u wuye-mod-hub -f
sudo journalctl -u wuye-mod-hub --since "1 hour ago" --no-pager

# Nginx 访问/错误日志
sudo tail -f /var/log/nginx/wuye-mod-hub.access.log
sudo tail -f /var/log/nginx/wuye-mod-hub.error.log

# 备份日志
sudo journalctl -t wuye-backup -n 50 --no-pager

# 证书状态
sudo certbot certificates
```

- journald 默认会占磁盘；可限制：编辑 `/etc/systemd/journald.conf` 设
  `SystemMaxUse=500M`，然后 `sudo systemctl restart systemd-journald`。
  **但**如果日志用于合规留存，不要清得太狠。
- Nginx 日志由 logrotate 管理（`/etc/logrotate.d/nginx`，默认保留 14 天）。
  合规需要 6 个月时，把 `rotate 14` 改大、并确认磁盘容量。

**建议监控项：**

1. `https://你的域名/api/health` 返回 200 且 `ok:true`（云监控/外部拨测，1 分钟一次）；
2. 磁盘使用率（数据库+备份+日志），<80%；
3. 证书到期时间（certbot 自动续期是否成功）；
4. `systemctl is-active wuye-mod-hub`；
5. 后台是否有大量待审核投稿（人工）。

---

## 14. 安全检查清单

部署完成后逐项确认：

- [ ] `https://域名` 可访问，HTTP 自动 301 到 HTTPS，证书链正常；
- [ ] 响应头有 HSTS、CSP、`X-Content-Type-Options`、`X-Frame-Options`（浏览器开发者工具查看）；
- [ ] `/etc/wuye-mod-hub/wuye.env` 为 `root:root 600`，`data/` 为 `wuye 700`；
- [ ] 8080 未在 ufw 和云安全组放行，公网 `http://IP:8080` 不可达；
- [ ] 环境变量 `TRUST_PROXY=1`、`COOKIE_SECURE=1`；
- [ ] 管理码已改成自己的强密码（≥10 位，建议 16 位以上），`data/admin-code.txt` 已删除；
- [ ] 已配置每日备份并演练过一次恢复；
- [ ] SSH 禁止密码登录、禁用 root 直登（可选但强烈建议）：
  `/etc/ssh/sshd_config` 设 `PasswordAuthentication no`、`PermitRootLogin no`；
- [ ] 系统自动安全更新：`sudo apt install -y unattended-upgrades`；
- [ ] 已删除 `sites-enabled/default`；
- [ ] 没有引入任何境外字体/CDN/统计脚本。

---

## 15. 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 502 Bad Gateway | Node 没起来 / 端口不对 | `systemctl status wuye-mod-hub`；`curl 127.0.0.1:8080/api/health`；看 `journalctl -u wuye-mod-hub` |
| 504 Gateway Timeout | 请求卡住、磁盘满 | 看磁盘 `df -h`、Node 日志；`proxy_read_timeout` 30s 属正常 |
| 启动报 `EADDRINUSE` | 8080 被占用 | `sudo ss -ltnp \| grep 8080`，停掉冲突进程或改 `PORT` |
| 启动报 SQLite `EACCES` / `SQLITE_CANTOPEN` | data 目录属主/权限错 | `chown -R wuye:wuye data && chmod 700 data`；确认 `ReadWritePaths` 包含 data |
| 日志里没有管理码 | 已初始化过 / 设了 `ADMIN_CODE` | 用原管理码登录后台改码；忘了见下方「忘记管理码」 |
| 登录后立刻变未登录 | `COOKIE_SECURE=1` 但用 HTTP；或服务器时间偏差大 | 生产用 HTTPS；或临时设 `COOKIE_SECURE=0` 调试；`timedatectl` 校时 |
| 提交/投票 403「请求校验失败」 | 页面过期、被代理剥了 `X-Requested-With` | 刷新页面重试；检查反代是否透传自定义头；不要用 curl 裸调写接口 |
| 提交/投票 403「请求来源校验失败」 | 反代改了 Host，Origin 对不上 | 确认 Nginx `proxy_set_header Host $host;`；不要用 `$http_host` 带端口 |
| 429「操作太频繁啦」 | 触发限流（登录 8 次/15 分钟 等） | 等待窗口过去；确认 `TRUST_PROXY=1`，否则全站共享一个 IP 更容易误伤 |
| 后台看不到真实 IP | 没开 `TRUST_PROXY` | 环境变量设 `TRUST_PROXY=1` 并重启 |
| certbot 验证 404 | webroot 路径不对/80 未放行 | 确认 `/var/www/certbot/.well-known/acme-challenge/`、安全组、备案 |
| 证书续期失败 | 80 被拦、DNS 变更、webroot 被删 | `certbot renew --dry-run` 看报错；恢复 80 的 ACME location |
| 图片替换后浏览器仍是旧的 | 图片缓存 7 天 | 换文件名，或加 `?v=2`；别依赖同名覆盖 |
| 时间显示不对 | 页面固定 UTC+8，不看服务器时区 | 这是预期行为；服务器时区只影响日志/备份名 |
| 磁盘满导致写入失败 | 备份/日志堆积 | `df -h`、清理旧备份、调 journald 上限、logrotate |
| `npm test` 有失败 | 测试基线可能与种子数据不同步 | 见根 README「测试」；测试用临时目录，不影响线上 |

### 忘记管理码怎么办

没有后门，也不要把 hash 改回去。步骤：

```bash
sudo systemctl stop wuye-mod-hub

# 先做一份现场备份
sudo -u wuye /usr/bin/node /srv/wuye-mod-hub/scripts/backup.js

# 用 Node 清掉管理码哈希和所有会话，下次启动会重新生成
sudo -u wuye /usr/bin/node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/srv/wuye-mod-hub/data/wuye.db');
db.exec(\"DELETE FROM settings WHERE key = 'admin_code_hash'\");
db.exec('DELETE FROM admin_sessions');
db.close();
console.log('已清除管理码，重启后查看日志获取新码');
"

sudo systemctl start wuye-mod-hub
sudo journalctl -u wuye-mod-hub -n 40 --no-pager | grep -A3 '首次启动'
```

重启后会生成新的 `WY-XXXX-XXXX-XXXX`，并写入 `data/admin-code.txt`；登录后马上改码，
再删掉该文件。如果 `wuye.env` 里仍然设置着 `ADMIN_CODE`，初始化会优先使用它，
而不是随机生成——请同时确认该值。

---

## 16. 常用命令速查

```bash
# 服务
sudo systemctl start|stop|restart|status wuye-mod-hub
sudo journalctl -u wuye-mod-hub -f

# Nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail -f /var/log/nginx/wuye-mod-hub.error.log

# 健康检查
curl -fsS http://127.0.0.1:8080/api/health
curl -I https://wuye.example.com

# 备份
sudo -u wuye /usr/bin/node /srv/wuye-mod-hub/scripts/backup.js
sudo ls -lh /srv/wuye-mod-hub/backups

# 证书
sudo certbot certificates
sudo certbot renew --dry-run

# 防火墙
sudo ufw status verbose

# 磁盘
df -h; du -sh /srv/wuye-mod-hub/* | sort -h
```
