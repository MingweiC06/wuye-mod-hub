#!/bin/sh
# offsite-sync.sh — 把加密后的备份快照同步到异地对象存储，并提供「上传 → 下载 → 解密 → SHA-256 → 恢复」全链路验证。
#
# 用法：
#   scripts/offsite-sync.sh push      # 生成新快照 + 客户端加密到 OFFSITE_DIR + rclone 同步到 RCLONE_DEST
#   scripts/offsite-sync.sh verify    # 取远端最新一份，下载、解密、校验 SHA-256、恢复到临时目录并打开数据库
#
# 环境变量：
#   DATA_DIR            数据目录（默认 ./data）
#   BACKUP_DIR          本地快照目录（默认 ./backups）
#   KEEP                本地保留份数（默认 14）
#   OFFSITE_DIR         加密快照的本地暂存目录（默认 <BACKUP_DIR>/offsite）
#   RCLONE_DEST         rclone 远端路径，例如 b2:wuye-backups/snapshots
#   BACKUP_PASSPHRASE   备份加密口令（必须与恢复时一致；由密码管理器保管，另存一份离线副本）
#   OFFSITE_KEEP_DAYS   远端保留天数（默认 90）
#
# 退出码：0 成功（含「异地未配置，跳过」）；1 失败。
# 注意：本地备份先生成；异地同步失败不会删除本地快照，但会让 systemd 任务报失败以便发现。

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

DATA_DIR=${DATA_DIR:-$ROOT/data}
BACKUP_DIR=${BACKUP_DIR:-$ROOT/backups}
KEEP=${KEEP:-14}
OFFSITE_DIR=${OFFSITE_DIR:-$BACKUP_DIR/offsite}
OFFSITE_KEEP_DAYS=${OFFSITE_KEEP_DAYS:-90}
NODE=${NODE:-node}
RCLONE=${RCLONE:-rclone}
MODE=${1:-push}

log() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

if [ -z "${RCLONE_DEST:-}" ] || [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  log '异地备份未配置（缺少 RCLONE_DEST 或 BACKUP_PASSPHRASE），本次跳过。'
  log '本地备份仍然有效，但本地备份不能作为唯一副本。配置方法见 deploy/BACKUP.md。'
  exit 0
fi

export DATA_DIR BACKUP_DIR KEEP OFFSITE_DIR BACKUP_PASSPHRASE

case "$MODE" in
  push)
    log "1/3 生成本地快照并做客户端加密 → $OFFSITE_DIR"
    "$NODE" scripts/backup.js --offsite --quiet

    log "2/3 同步到远端 → $RCLONE_DEST"
    "$RCLONE" sync "$OFFSITE_DIR" "$RCLONE_DEST" \
      --fast-list --transfers 4 --checkers 8 --contimeout 30s --timeout 10m --retries 3

    log "3/3 清理远端超过 ${OFFSITE_KEEP_DAYS} 天的快照目录"
    "$RCLONE" delete "$RCLONE_DEST" --min-age "${OFFSITE_KEEP_DAYS}d" --rmdirs || true
    log '完成：远端已保存加密快照。本地备份不能作为唯一副本，请同时保留离线口令副本。'
    ;;

  verify)
    command -v "$RCLONE" >/dev/null 2>&1 || die "找不到 rclone（$RCLONE）"
    TMP=$(mktemp -d "${TMPDIR:-/tmp}/wuye-offsite-verify.XXXXXX")
    trap 'rm -rf "$TMP"' EXIT HUP INT TERM

    log '1/5 找出远端最新快照'
    LATEST=$("$RCLONE" lsf "$RCLONE_DEST" --dirs-only 2>/dev/null | sed '/^$/d' | sort | tail -n 1)
    [ -n "${LATEST:-}" ] || die "远端 $RCLONE_DEST 下没有任何快照目录"
    log "    最新快照：$LATEST"

    log '2/5 下载到临时目录'
    "$RCLONE" copy "$RCLONE_DEST/$LATEST" "$TMP/offsite/$LATEST" \
      --fast-list --transfers 4 --checkers 8 --contimeout 30s --timeout 10m --retries 3

    log '3/5 解密 + 校验 SHA-256 + 恢复到临时目录'
    "$NODE" scripts/restore-backup.js --from-offsite "$TMP/offsite" --target "$TMP/restored"

    log '4/5 打开恢复出来的数据库，确认可以查询'
    "$NODE" --input-type=module -e '
      import { openDatabase } from "./lib/db.js";
      const db = openDatabase(process.argv[1]);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name").all("table", "sqlite_%");
      let rows = 0;
      for (const t of tables) rows += Number(db.prepare("SELECT COUNT(*) AS n FROM \"" + t.name + "\"").get().n);
      console.log("恢复库可读：" + tables.length + " 张表，合计 " + rows + " 行。");
      db.close();
    ' "$TMP/restored/wuye.db"

    log '5/5 完成'
    log '验证通过：上传 → 下载 → 解密 → SHA-256 → 恢复 全链路成功。'
    ;;

  *)
    die "未知参数：$MODE（可用 push | verify）"
    ;;
esac
