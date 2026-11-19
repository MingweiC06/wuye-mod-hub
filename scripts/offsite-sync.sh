#!/bin/sh
# offsite-sync.sh — 把加密后的备份快照同步到异地对象存储，并提供「上传 → 下载 → 解密 → SHA-256 → 恢复」全链路验证。
#
# 用法：
#   scripts/offsite-sync.sh push      # 快照+加密 → 上传 → 校验远端副本 → 清理本地过期快照 → 同步远端删除
#   scripts/offsite-sync.sh verify    # 取远端最新一份，下载、解密、校验 SHA-256、恢复到临时目录并打开数据库
#
# 环境变量：
#   DATA_DIR            数据目录（默认 ./data）
#   BACKUP_DIR          本地快照目录（默认 ./backups）
#   KEEP                本地保留份数（默认 14）
#   OFFSITE_DIR         加密快照的本地暂存目录（默认 <BACKUP_DIR>/offsite）
#   RCLONE_DEST         rclone 远端路径，例如 b2:wuye-prod-backups-2026/snapshots
#   RCLONE_CONFIG       rclone 配置路径（生产：/etc/wuye/rclone.conf）
#   BACKUP_PASSPHRASE   备份加密口令（必须与恢复时一致；由密码管理器保管，另存一份离线副本）
#   OFFSITE_KEEP_DAYS   保留天数（默认 90；生产批准值 30）：本地 OFFSITE_DIR 与远端的旧快照超过这个天数就删
#
# 配置缺失时的行为（刻意区分，避免「以为在备份其实没有」）：
#   - 完全没配置（OFFSITE_DIR / RCLONE_DEST / BACKUP_PASSPHRASE 都没给）：打印跳过，exit 0（本地开发场景）；
#   - 已启用但缺少其中某些（例如生产 unit 设了 OFFSITE_DIR，但 /etc/wuye/backup.env 没配全）：
#     **明确报错 exit 1**，让 systemd 任务标红，不再静默成功；
#   - verify 模式始终要求 RCLONE_DEST + BACKUP_PASSPHRASE。
#
# push 的安全顺序（上传没验证通过之前，绝不清理任何本地旧快照）：
#   1) backup.js 生成新快照并加密到 OFFSITE_DIR；
#   2) rclone sync 上传到 RCLONE_DEST；
#   3) rclone check 校验「本次快照」在远端存在且完整（大小/哈希），失败即中止；
#   4) 清理本地 OFFSITE_DIR 中超过 OFFSITE_KEEP_DAYS 的 snapshot-* 目录（规则见下）；
#   5) 再 sync 一次，把远端对应目录镜像删除（只隐藏版本，不 --b2-hard-delete；
#      生命周期规则负责在隐藏 1 天后真正删除）。
#
# 本地清理规则（push 第 4 步）：
#   只删除 OFFSITE_DIR 的「直接子目录」，且目录名必须严格匹配 snapshot-YYYYMMDD-HHmmss、
#   时间能解析且回读一致、年龄超过 OFFSITE_KEEP_DAYS。
#   符号链接、文件、名字不合规的目录、以及 OFFSITE_DIR 之外的任何路径都不会被触碰；
#   OFFSITE_DIR 与 BACKUP_DIR 相同时自动跳过（那里的明文快照由 backup.js 的 KEEP 管理）。
#
# 退出码：0 成功（含「完全未配置，跳过」）；1 任何失败（含生产环境配置不完整）。

set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

DATA_DIR=${DATA_DIR:-$ROOT/data}
BACKUP_DIR=${BACKUP_DIR:-$ROOT/backups}
KEEP=${KEEP:-14}
OFFSITE_DIR_EXPLICIT=${OFFSITE_DIR:-}
OFFSITE_DIR=${OFFSITE_DIR:-$BACKUP_DIR/offsite}
OFFSITE_KEEP_DAYS=${OFFSITE_KEEP_DAYS:-90}
NODE=${NODE:-node}
RCLONE=${RCLONE:-rclone}
MODE=${1:-push}

log() { printf '%s\n' "$*"; }
die() { printf '错误：%s\n' "$*" >&2; exit 1; }

RCLONE_ARGS="--fast-list --transfers 4 --checkers 8 --contimeout 30s --timeout 10m --retries 3"

missing=
[ -n "${RCLONE_DEST:-}" ] || missing="$missing RCLONE_DEST"
[ -n "${BACKUP_PASSPHRASE:-}" ] || missing="$missing BACKUP_PASSPHRASE"
if [ -n "$missing" ]; then
  if [ "$MODE" = verify ]; then
    die "异地备份未配置（缺少${missing}），无法验证远端副本。"
  fi
  if [ -n "$OFFSITE_DIR_EXPLICIT" ] || [ -n "${RCLONE_DEST:-}" ] || [ -n "${BACKUP_PASSPHRASE:-}" ]; then
    die "异地备份已启用但配置不完整：缺少${missing}。请检查 /etc/wuye/backup.env；本次任务失败，不会假装异地备份正常。"
  fi
  log "异地备份未配置（未设置 OFFSITE_DIR / RCLONE_DEST / BACKUP_PASSPHRASE），本次跳过。"
  log '本地备份仍然有效，但本地备份不能作为唯一副本。配置方法见 deploy/BACKUP.md。'
  exit 0
fi

export DATA_DIR BACKUP_DIR KEEP OFFSITE_DIR BACKUP_PASSPHRASE

# snapshot-YYYYMMDD-HHmmss → epoch 秒。只接受严格格式，且要求 date 回读一致
# （防止 2026-13-45 这类值被 date 归一化成别的日期而误删）。
snapshot_epoch() {
  name=$1
  case "$name" in
    snapshot-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) return 1 ;;
  esac
  stamp=${name#snapshot-}
  day=${stamp%%-*}
  clock=${stamp#*-}
  ymd=$(printf '%s' "$day" | cut -c1-4)-$(printf '%s' "$day" | cut -c5-6)-$(printf '%s' "$day" | cut -c7-8)
  hms=$(printf '%s' "$clock" | cut -c1-2):$(printf '%s' "$clock" | cut -c3-4):$(printf '%s' "$clock" | cut -c5-6)
  epoch=$(date -d "$ymd $hms" +%s 2>/dev/null) || return 1
  back=$(date -d "@$epoch" '+%Y%m%d-%H%M%S' 2>/dev/null) || return 1
  [ "$back" = "$stamp" ] || return 1
  printf '%s\n' "$epoch"
}

latest_snapshot() {
  for dir in "$OFFSITE_DIR"/snapshot-*; do
    [ -d "$dir" ] || continue
    [ -L "$dir" ] && continue
    printf '%s\n' "${dir##*/}"
  done | sort | tail -n 1
}

prune_offsite() {
  case "${OFFSITE_KEEP_DAYS:-}" in
    '' | *[!0-9]*) die "OFFSITE_KEEP_DAYS 必须是正整数（当前：${OFFSITE_KEEP_DAYS:-空}）" ;;
  esac
  [ "$OFFSITE_KEEP_DAYS" -ge 1 ] || die "OFFSITE_KEEP_DAYS 必须 >= 1（当前：$OFFSITE_KEEP_DAYS）"

  if [ ! -d "$OFFSITE_DIR" ]; then
    log "    异地目录尚不存在，跳过清理：$OFFSITE_DIR"
    return 0
  fi

  base=$(cd "$OFFSITE_DIR" 2>/dev/null && pwd -P) || die "无法进入异地目录：$OFFSITE_DIR"
  case "$base" in / | '') die "拒绝在根目录执行清理：$base" ;; esac

  if [ -d "$BACKUP_DIR" ]; then
    backup_real=$(cd "$BACKUP_DIR" 2>/dev/null && pwd -P) || backup_real=
    if [ -n "$backup_real" ] && [ "$base" = "$backup_real" ]; then
      log "    OFFSITE_DIR 与 BACKUP_DIR 相同，跳过清理（明文快照由 backup.js 的 KEEP 管理）：$base"
      return 0
    fi
  fi

  now=$(date +%s)
  cutoff=$((now - OFFSITE_KEEP_DAYS * 86400))
  removed=0
  kept=0
  skipped=0

  for path in "$base"/snapshot-*; do
    [ -e "$path" ] || continue
    if [ -L "$path" ]; then
      skipped=$((skipped + 1))
      continue
    fi
    [ -d "$path" ] || continue
    case "$path" in
      "$base"/*) ;;
      *) continue ;;
    esac
    name=${path##*/}
    epoch=$(snapshot_epoch "$name") || {
      skipped=$((skipped + 1))
      log "    跳过无法解析时间的目录：$name"
      continue
    }
    if [ "$epoch" -lt "$cutoff" ]; then
      age_days=$(((now - epoch) / 86400))
      log "    删除超过 ${OFFSITE_KEEP_DAYS} 天的本地加密快照（约 ${age_days} 天前）：$name"
      rm -rf -- "$path"
      removed=$((removed + 1))
    else
      kept=$((kept + 1))
    fi
  done

  log "    本地清理完成：删除 ${removed} 个，保留 ${kept} 个，跳过 ${skipped} 个（阈值 ${OFFSITE_KEEP_DAYS} 天）。"
}

case "$MODE" in
  push)
    log "1/5 生成本地快照并做客户端加密 → $OFFSITE_DIR"
    "$NODE" scripts/backup.js --offsite --quiet

    SNAP=$(latest_snapshot)
    [ -n "$SNAP" ] || die "加密目录里没有可用快照：$OFFSITE_DIR"
    log "    本次快照：$SNAP"

    log "2/5 上传到远端 → $RCLONE_DEST"
    # shellcheck disable=SC2086
    "$RCLONE" sync "$OFFSITE_DIR" "$RCLONE_DEST" $RCLONE_ARGS \
      || die "上传失败（rclone sync）。本地旧快照未清理，远端未删除任何对象。"

    log "3/5 校验远端副本存在且完整：$SNAP"
    # shellcheck disable=SC2086
    "$RCLONE" check "$OFFSITE_DIR/$SNAP" "$RCLONE_DEST/$SNAP" $RCLONE_ARGS \
      || die "远端副本校验失败（$SNAP）。本地旧快照未清理，远端未删除任何对象。"
    log "    远端副本校验通过（大小/哈希一致）"

    log "4/5 清理本地超过 ${OFFSITE_KEEP_DAYS} 天的加密快照（只动 snapshot-* 目录）"
    prune_offsite

    log "5/5 同步远端删除（镜像本地；只隐藏版本，不 hard delete）"
    # shellcheck disable=SC2086
    "$RCLONE" sync "$OFFSITE_DIR" "$RCLONE_DEST" $RCLONE_ARGS \
      || die "远端删除同步失败。本地已按保留期清理，远端旧副本暂未删除；下次成功后会自动对齐。"
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
    # shellcheck disable=SC2086
    "$RCLONE" copy "$RCLONE_DEST/$LATEST" "$TMP/offsite/$LATEST" $RCLONE_ARGS

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
