# 数据备份与恢复

> 2026-11-19 上线前审计发现的最严重问题：生产服务器上**没有任何备份**，
> 部署脚本也不做备份。本文档描述现行的备份/恢复方案。
>
> **当前状态（务必先读）**：每日本地备份 + 部署前备份已实现；**加密异地备份还没有配置**。
> 服务器上的本地快照不能算异地备份——机器或磁盘损坏时它会一起消失。
> 在异地备份配置并验证通过之前，**P0-1 不算解决**。

---

## 1. 备份包含什么

每次备份生成一个快照目录 `snapshot-YYYYMMDD-HHmmss/`（服务器本地时间）：

| 内容 | 说明 |
| --- | --- |
| `wuye.db` | SQLite 在线快照（`VACUUM INTO`，WAL 模式下不需要停服，不改源库） |
| `files/` | 模组/资源包上传文件（`data/files/`，可能很大） |
| `media/` | 后台图片、赞助说明等（`data/media/`） |
| `secrets/` | `admin-code.txt`、`relay-secret.txt`、`cf-token.txt`（存在才备份） |
| `manifest.json` | 时间、大小、每张表行数、每个文件 SHA-256、警告 |
| `SHA256SUMS` | 快照内所有文件的校验和 |

安全措施：

- 快照目录 `0700`、文件 `0600`（只允许 `wuye` 用户读取）；
- 写盘前预估磁盘余量，不够直接失败，不会写出半个快照；
- 写完立刻完整校验（SHA256SUMS → 数据库 `integrity_check` → 逐表行数）；
  任何一项不通过就**删除这份快照**并报错，备份目录里不会留下坏副本；
- 保留最近 `KEEP` 份（默认 14），更早的 `snapshot-*` 自动清理；
- 旧版本留下的扁平 `wuye-YYYYMMDD-HHmmss.db` 不会被动，确认无用后手动删。

---

## 2. 安装每日自动备份（在服务器上）

unit 文件随代码一起部署，首次部署后执行一次：

```bash
ssh -i ~/.ssh/wuye_azure_ed25519 ubuntu@141.148.35.139

# 复制 unit 到 systemd（仓库里已有，路径 /opt/wuye/deploy/）
sudo install -m 0644 /opt/wuye/deploy/wuye-backup.service /etc/systemd/system/wuye-backup.service
sudo install -m 0644 /opt/wuye/deploy/wuye-backup.timer   /etc/systemd/system/wuye-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now wuye-backup.timer

# 确认
systemctl list-timers wuye-backup.timer --no-pager
```

说明：

- timer 在**服务器时区 18:47**（当前服务器为 UTC，即北京时间约 02:47）触发，
  `Persistent=true` 表示错过时间点（例如服务器关机）后开机补跑；
- service 以 `wuye` 用户运行，只对 `/opt/wuye/data` 和 `/opt/wuye/backups` 有写权限
  （`ProtectSystem=strict` + `ReadWritePaths`）；
- 日志：`sudo journalctl -u wuye-backup -n 50 --no-pager`

**部署脚本会自动做这一步**（`scripts/deploy-oracle.ps1` 检测到 unit 文件时安装并启用），
并且**每次部署前都会先在服务器上跑一次备份**，备份失败就中止部署、不动线上代码。

---

## 3. 手动备份 / 查看

```bash
# 立即备份一次（服务器上）
sudo -u wuye env DATA_DIR=/opt/wuye/data BACKUP_DIR=/opt/wuye/backups KEEP=14 \
  /usr/bin/node /opt/wuye/scripts/backup.js

# 本地开发同理（相对路径按项目根解析）
npm run backup

# 列出快照
npm run backup:list
sudo -u wuye /usr/bin/node /opt/wuye/scripts/restore-backup.js --list
```

参数：`--keep=N`、`--dir=<备份目录>`、`--offsite`、`--quiet`、`--help`。

---

## 4. 恢复（演练是必做项）

**先演练，别等出事才第一次用。** 恢复脚本本身会校验：SHA256SUMS → 每个文件大小/哈希 →
数据库 `integrity_check` → 逐表行数与清单一致，任何不一致都会中止。

### 4.1 演练（不碰生产数据）

```bash
# 找一个临时目录当目标
DRILL=$(mktemp -d /tmp/wuye-drill-XXXXXX)

sudo -u wuye /usr/bin/node /opt/wuye/scripts/restore-backup.js \
  --snapshot /opt/wuye/backups/snapshot-YYYYMMDD-HHmmss \
  --target "$DRILL/restored"

# 用恢复出来的数据起一个临时实例，看健康检查
cd /opt/wuye
sudo -u wuye env DATA_DIR="$DRILL/restored" PORT=8091 HOST=127.0.0.1 \
  /usr/bin/node server.js &
curl -fsS http://127.0.0.1:8091/api/health
curl -fsS http://127.0.0.1:8091/api/site | head -c 300
kill %1
```

演练后清理：`sudo rm -rf "$DRILL"`。

### 4.2 生产恢复（真的丢了数据时）

```bash
# 1) 停站，避免边恢复边写入
sudo systemctl stop wuye

# 2) 把当前现场另存一份（恢复错了还能回去）
sudo -u wuye cp /opt/wuye/data/wuye.db /opt/wuye/data/wuye.db.before-restore-$(date +%s)

# 3) 恢复（覆盖生产目录必须加 --force）
sudo -u wuye /usr/bin/node /opt/wuye/scripts/restore-backup.js \
  --snapshot /opt/wuye/backups/snapshot-YYYYMMDD-HHmmss \
  --target /opt/wuye/data --force --with-secrets

# 4) 启动并检查
sudo systemctl start wuye
sudo systemctl is-active wuye
sudo -u wuye curl -fsS http://127.0.0.1:8080/api/health
```

注意：

- `--with-secrets` 才会恢复管理码/中继密钥/CF token；不带它时这些文件保持现状；
- 恢复脚本会删掉目标目录里旧的 `wuye.db-wal` / `wuye.db-shm`（否则 SQLite 会用旧日志
  回放，把恢复后的库又改乱）；
- `files/` 里**新增**的文件不会被删除（脚本只补缺失/覆盖已有），恢复后需要人工确认
  多出来的上传文件是否要留。

---

## 5. 加密异地备份（方案：Backblaze B2 EU Central + rclone）

### 5.1 已批准的方案

- 存储：**Backblaze B2，EU Central（欧洲中部）**，与生产（Oracle 美国弗吉尼亚北部）不同厂商、不同大洲；
- 上传方式：**rclone** 同步，不在本项目里自研 S3 签名代码；
- 加密：沿用 `backup.js` 的 **AES-256-GCM + scrypt** 客户端加密，B2 只拿到密文；
- 口令：由站长用密码管理器保管，并另存一份离线副本（纸质或离线设备）。**丢失口令 = 异地备份不可恢复**；
- 脚本：`scripts/offsite-sync.sh push` 负责「本地快照 → 加密到 `OFFSITE_DIR` → rclone 同步 → 清理远端旧快照」，
  `scripts/offsite-sync.sh verify` 负责「下载最新远端快照 → 解密 → SHA-256 → 恢复到临时目录 → 打开数据库确认可读」。

加密细节（由 `scripts/backup.js` 实现，不需要额外工具）：

- 每个文件独立加密：`MAGIC "WUYEBAK1" | salt(16) | iv(12) | ciphertext | tag(16)`；
- scrypt（N=2^15, r=8, p=1）从口令派生密钥，每条备份随机 salt；GCM 认证标签保证密文未被篡改；
- 写完立刻解密回读，逐文件比对 SHA-256；
- 目录 `0700`、文件 `0600`；缺 `BACKUP_PASSPHRASE` 时拒绝写出明文异地备份。

### 5.2 在服务器上配置（需要你本人操作云账号）

前提：你已在 Backblaze 建好 bucket（建议私有、开启 Object Lock 可选）并创建 application key。
**我没有、也不应该替你开通账号或使用凭据。** 以下命令都在服务器上执行。

```bash
# 1) 安装 rclone（Ubuntu）
sudo apt-get install -y rclone

# 2) 配置 B2 远端（按提示输入 keyID / applicationKey）
#    区域选 EU Central（endpoint 形如 https://s3.eu-central-003.backblazeb2.com）
sudo -u wuye rclone config
#    建议把配置放到 /etc/wuye/rclone.conf，权限 0640 root:wuye

# 3) 备份环境变量（不要写进仓库）
sudo install -d -m 0750 -o root -g wuye /etc/wuye
sudo tee /etc/wuye/backup.env >/dev/null <<'EOF'
BACKUP_PASSPHRASE=请换成你自己的长口令（同时存进密码管理器）
RCLONE_DEST=b2:wuye-backups/snapshots
RCLONE_CONFIG=/etc/wuye/rclone.conf
OFFSITE_KEEP_DAYS=90
EOF
sudo chown root:wuye /etc/wuye/backup.env
sudo chmod 0640 /etc/wuye/backup.env

# 4) 手动跑一次 push（本地快照 + 加密 + 上传）
sudo systemctl start wuye-backup.service
journalctl -u wuye-backup -n 40 --no-pager

# 5) 全链路验证：下载 → 解密 → SHA-256 → 恢复 → 打开数据库
sudo -u wuye env $(sudo cat /etc/wuye/backup.env | xargs) \
  sh /opt/wuye/scripts/offsite-sync.sh verify
```

`deploy/wuye-backup.service` 已内置 `ExecStartPost=/bin/sh /opt/wuye/scripts/offsite-sync.sh push`：
异地变量没配置时脚本打印「跳过」并以 0 退出，本地备份不受影响；配置后每次定时备份都会自动上传。

### 5.3 验收标准（做完才算 P0-1 解决）

1. 连续两次定时任务成功，B2 bucket 里出现新的 `snapshot-*` 目录，且文件都是 `.enc`；
2. `offsite-sync.sh verify` 通过：下载、解密、SHA-256、恢复到临时目录、恢复库可查询；
3. 从异地副本实际恢复到临时目录，用 `DATA_DIR=<临时目录> PORT=8091 node server.js` 起实例，`/api/health` 返回 ok；
4. 确认异地副本与服务器不在同一台机器、同一块磁盘；
5. 口令的离线副本已单独保存，并实际用离线副本解密成功一次。

**在这 5 条完成前，异地备份视为「未配置」，本地备份不能作为唯一副本。**


---

## 6. 部署前备份

`scripts/deploy-oracle.ps1` 会在上传代码**之前**执行服务器上的备份：

```powershell
powershell -File scripts\deploy-oracle.ps1
# 紧急回滚时可以跳过（不建议）
powershell -File scripts\deploy-oracle.ps1 -SkipBackup
```

备份失败 → 脚本抛错退出，**不会**上传新代码、不会重启服务。

---

## 7. 排错

| 现象 | 处理 |
| --- | --- |
| `找不到数据库` | 检查 `DATA_DIR` 是否指向 `/opt/wuye/data` |
| `磁盘余量不足` | 清理旧快照或扩盘；脚本不会写出不完整的备份 |
| `快照自检失败，已删除` | 通常是磁盘写入问题或源库损坏，先看 `journalctl -u wuye-backup` |
| timer 没跑 | `systemctl list-timers`、`systemctl status wuye-backup.timer`；确认 `Persistent=true` |
| 异地解密报「口令不正确」 | 口令错或文件损坏；口令只看 `/etc/wuye/backup.env`，别用旧口令 |
