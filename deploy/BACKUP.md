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

- `--with-secrets` 才会恢复管理码/中继密钥/CF token；恢复脚本会把快照 `secrets/` 里的文件
  还原到**数据目录根**（`admin-code.txt`、`relay-secret.txt`、`cf-token.txt`），因为服务器
  就是从 `DATA_DIR` 根目录读取它们；不带 `--with-secrets` 时这些文件保持现状；
- 恢复脚本会删掉目标目录里旧的 `wuye.db-wal` / `wuye.db-shm`（否则 SQLite 会用旧日志
  回放，把恢复后的库又改乱）；
- `files/` 里**新增**的文件不会被删除（脚本只补缺失/覆盖已有），恢复后需要人工确认
  多出来的上传文件是否要留。

---

## 5. 加密异地备份（方案：Backblaze B2 EU Central + rclone）

### 5.1 已批准的方案

- 存储：**Backblaze B2，EU Central（Amsterdam）**，桶 `wuye-prod-backups-2026`（Private）；
  与生产（Oracle 美国弗吉尼亚北部）不同厂商、不同大洲；
- 上传方式：**rclone** 同步，不在本项目里自研 S3 签名代码；
  凭据使用**桶级受限 Application Key**（只授权这一个桶、Read/Write、不勾 List All Bucket Names）；
- 加密：沿用 `backup.js` 的 **AES-256-GCM + scrypt** 客户端加密，B2 只拿到密文；
- 口令：由站长用密码管理器保管，并另存一份离线副本（纸质或离线设备）。**丢失口令 = 异地备份不可恢复**；
- 保留期：`OFFSITE_KEEP_DAYS=30`——本地 `OFFSITE_DIR` 与远端 `snapshots/` 都按 30 天清理，
  再叠加 B2 生命周期规则（见 5.4），实际最长保留约 31–32 天；
- 脚本：`scripts/offsite-sync.sh push` 按固定顺序执行「生成并加密本地快照 → rclone 同步上传 →
  `rclone check` 校验远端副本齐全 → 才清理本地过期加密快照 → 再同步远端删除」，
  上传或校验失败时**不会**清理本地旧快照；`scripts/offsite-sync.sh verify` 负责「下载最新远端快照 →
  解密 → SHA-256 → 恢复到临时目录 → 打开数据库确认可读」。
- 失败语义：生产 unit 里显式设置了 `OFFSITE_DIR`，此时若缺 `RCLONE_DEST` 或 `BACKUP_PASSPHRASE`，
  push 会**直接报错退出（exit 1）**，不会打印「跳过」假装异地备份正常；只有三个变量全都没配
  （本地开发场景）才跳过并 exit 0。

加密细节（由 `scripts/backup.js` 实现，不需要额外工具）：

- 每个文件独立加密：`MAGIC "WUYEBAK1" | salt(16) | iv(12) | ciphertext | tag(16)`；
- scrypt（N=2^15, r=8, p=1）从口令派生密钥，每条备份随机 salt；GCM 认证标签保证密文未被篡改；
- 写完立刻解密回读，逐文件比对 SHA-256；
- 目录 `0700`、文件 `0600`；缺 `BACKUP_PASSPHRASE` 时拒绝写出明文异地备份。

### 5.2 在服务器上配置（需要你本人操作云账号）

**我没有、也不应该替你开通账号或使用凭据。** 以下命令都在服务器上执行。

#### 5.2.1 先确认账号区域

Backblaze 控制台 → **Account → My Settings → Data Region**，必须显示 **EU Central**。

Backblaze 的区域在账号创建后**不可更改**，所以不要用「建个桶试试」来试探区域：
建错了桶只会留下一个废桶。如果这里显示的不是 EU Central，先停下来换账号。

#### 5.2.2 建私有桶

Buckets → **Create a Bucket**：

| 字段 | 值 |
| --- | --- |
| Bucket Unique Name | `wuye-prod-backups-2026` |
| Files in Bucket are | **Private** |
| Default Encryption | Disabled（加密在客户端做） |
| Object Lock | Disabled |
| Region | **EU Central (Amsterdam)** |

建完在桶详情里核对区域 ID（形如 `eu-central-003`；以控制台实际显示为准）。

#### 5.2.3 建桶级受限 Application Key

Account → Application Keys → **Add a New Application Key**：

- Name：`wuye-rclone-prod`
- **Allow access to Bucket(s)**：只选 `wuye-prod-backups-2026`
- Type of Access：**Read and Write**
- **Allow List All Bucket Names：不勾**
- File name prefix / duration：留空

`keyID`（`005…`）和 `applicationKey`（`K005…`）**只显示一次**，直接存进密码管理器；
不要贴到聊天、不要写进仓库或服务器上的项目目录。

#### 5.2.4 安装 rclone 并写配置（先由 wuye 创建，再交给 root 收紧）

```bash
sudo apt-get update && sudo apt-get install -y rclone ca-certificates
rclone version            # 受限 key 需要 >= 1.43

# a) 先给 wuye 一个「自己能创建文件」的目录：0770 + root:wuye
#    如果目录是 root:wuye 0755，wuye 写不进去，rclone config 会直接失败
sudo install -d -m 0770 -o root -g wuye /etc/wuye

# b) 让 wuye 自己创建并写入配置，umask 077 保证文件是 0600
sudo -u wuye sh -c 'umask 077; rclone config --config /etc/wuye/rclone.conf'

#   交互答案：n → name: b2 → Storage: b2 → account: <keyID> → key: <applicationKey>
#            → endpoint 留空 → y → q

# c) 配置写完后收紧：文件 root:wuye 0640，目录改回 0750（wuye 之后不能再自己改配置）
sudo chown root:wuye /etc/wuye/rclone.conf
sudo chmod 0640 /etc/wuye/rclone.conf
sudo chmod 0750 /etc/wuye
sudo ls -ld /etc/wuye /etc/wuye/rclone.conf      # 期望 drwxr-x--- root:wuye / -rw-r----- root:wuye

# d) 只验证「认证 + 这一个桶的访问」，不要用 `rclone lsd b2:` 列所有桶
sudo -u wuye rclone --config /etc/wuye/rclone.conf ls b2:wuye-prod-backups-2026
```

期望：`ls` 无输出（空桶）且退出码 0。

- 报 `401 unauthorized`：`account` 填成了主账号 ID，要填 **Application Key ID**；
- 报 `403 cap exceeded`：key 没有这个桶的 Read/Write 权限，或 `bucketId` 没绑定；
- `ls` 能列出别的桶 = 受限 key 建错了（检查是否勾了 List All Bucket Names、是否选了 All Buckets）。

#### 5.2.5 备份环境变量

```bash
sudo install -o root -g wuye -m 0640 /dev/null /etc/wuye/backup.env
sudo -e /etc/wuye/backup.env     # 用编辑器写入，别用 tee/echo 把口令留在 shell 历史里
```

```ini
DATA_DIR=/opt/wuye/data
BACKUP_DIR=/opt/wuye/backups
KEEP=14
OFFSITE_DIR=/opt/wuye/offsite
OFFSITE_KEEP_DAYS=30
RCLONE_CONFIG=/etc/wuye/rclone.conf
RCLONE_DEST=b2:wuye-prod-backups-2026/snapshots
BACKUP_PASSPHRASE=<沿用现有口令>
```

#### 5.2.6 本地加密快照会自动清理（顺序：先证明远端有，再删本地）

`offsite-sync.sh push` 现在是五步，**顺序是安全保证的一部分**：

1. `backup.js --offsite`：生成新快照并加密写入 `OFFSITE_DIR`；
2. `rclone sync` 上传到 `RCLONE_DEST`；
3. **`rclone check` 校验远端副本存在且完整**（大小/哈希逐个比对）；
4. 走到这里才**清理本地 `OFFSITE_DIR`**：只删除「直接子目录 + 名字严格匹配 `snapshot-YYYYMMDD-HHmmss` +
   时间能解析且回读一致 + 年龄超过 `OFFSITE_KEEP_DAYS`」的目录；
   符号链接、普通文件、名字不合规的目录、`OFFSITE_DIR` 之外的任何路径都不碰；
   `OFFSITE_DIR` 与 `BACKUP_DIR` 相同时整步跳过（那里的明文快照由 `KEEP` 管）；
5. 再 `rclone sync` 一次，把远端已删目录镜像删除（B2 只标记为 hidden，后面交给生命周期）。

失败时不会「删了再报错」：

- 第 2 步上传失败 → 直接退出，本地旧快照一条都不删，远端也不删任何对象；
- 第 3 步校验失败 → 同上，本地旧快照保持原样；
- 第 5 步失败 → 本地已按保留期清理，远端旧副本暂时保留，下次成功后自动对齐（会打明显错误日志）。

配置问题不静默：生产 unit 里 `OFFSITE_DIR` 是显式设置的，所以缺 `RCLONE_DEST`/`BACKUP_PASSPHRASE`
会直接报「异地备份已启用但配置不完整」并 exit 1；只有本地开发完全没配异地时才跳过并 exit 0。

#### 5.2.7 首次手动跑一次 + 全链路验证

```bash
# 本地快照 + 加密 + 上传（走 systemd 时同样会带上 /etc/wuye/backup.env）
sudo systemctl start wuye-backup.service
journalctl -u wuye-backup -n 60 --no-pager

# 全链路：下载 → 解密 → SHA-256 → 恢复 → 打开数据库
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
5. 口令的离线副本已单独保存，并实际用离线副本解密成功一次；
6. 远端保留期符合预期：`snapshots/` 下对象在上传约 30–32 天后被隐藏并删除（按 5.4 的生命周期规则抽查一次）。

**在这些条目完成前，异地备份视为「未配置」，本地备份不能作为唯一副本。**

### 5.4 B2 生命周期规则（方案已于 2026-11-19 批准，控制台仍需你手动设置）

先澄清两个容易混淆的点：

- `rclone sync` 删除远端对象时，B2 只把它标记为 **hidden（隐藏版本）**，不会立刻释放空间；
- **「Keep prior versions 30 days」≠「备份保留 30 天」**：它表示对象被隐藏之后再保留 30 天，
  实际会变成 60 天。两者不能混为一谈。

目标：`snapshots/` 下的备份 **上传约 30 天后隐藏，隐藏 1 天后删除**。

| 规则 | 建议值 | 由谁负责 |
| --- | --- | --- |
| Keep prior versions（隐藏后再保留） | **1 day** | B2 生命周期，每天执行一次 |
| Files hidden after（按上传时间自动隐藏） | **不设置** | 由 push 的 `rclone sync` 负责隐藏 |
| 本地上限 | `OFFSITE_KEEP_DAYS=30` + `KEEP=14` 份 | `offsite-sync.sh` / `backup.js` |

实际节奏（timer 每天 18:47 UTC 跑一次）：

1. 第 30 天：push 时本地 `OFFSITE_DIR` 裁掉这个快照目录 → `rclone sync` 把远端同目录删除 → 对象变成 hidden；
2. 第 31 天：B2 的生命周期任务（每天执行一次）删除该隐藏版本；
3. 因此实际最长保留约 **31–32 天**（30 天 + 同步延迟最多 1 天 + 生命周期执行最多 1 天），不是 60 天。

补充：

- 生命周期按**上传时间**决定的是「隐藏」这一步；我们不让 B2 自动隐藏，避免它和 sync 互相打架；
- 生命周期规则作用于整个桶。以后如果同一个桶还要放别的东西，要么拆桶，要么用 prefix 规则；
- **已批准、不要改的设置**：Keep prior versions = **1 day**、Files hidden after = **不设置**、
  `OFFSITE_KEEP_DAYS=30`、本地 `KEEP=14`；脚本**不使用** `--b2-hard-delete`，删除一律走
  「隐藏 → 生命周期回收」，避免一次误删就永久消失；
- 设置位置：Bucket → Lifecycle Settings → *Keep prior versions for* **1 day**。
  **这一条还没有替你设置**，需要你在控制台确认后手动保存；
- 保留期与《隐私政策》第 04 节「备份最多 14 天」的表述目前不一致，隐私政策定稿时需要统一口径。


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
