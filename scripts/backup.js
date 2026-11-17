#!/usr/bin/env node
/**
 * scripts/backup.js — 乌叶MC · 模组许愿池的数据备份脚本（零依赖）。
 *
 * 用法：
 *   node scripts/backup.js          # 或 npm run backup
 *
 * 做了什么：
 *   1. 用 node:sqlite 打开 <DATA_DIR>/wuye.db（默认 ./data/wuye.db）；
 *   2. 执行 `VACUUM INTO`，把一份【事务一致的快照】写到
 *      <BACKUP_DIR>/wuye-YYYYMMDD-HHmmss.db（默认 ./backups）；
 *      VACUUM INTO 不改动源库，数据库开着 WAL 也可以在线备份，不需要停服；
 *   3. 校验备份文件大小 > 0；
 *   4. 只保留最近 KEEP 份（默认 14），更早的 wuye-*.db 会被删除；
 *   5. 打印备份路径、大小与清理结果。
 *
 * 环境变量：
 *   DATA_DIR    数据目录，默认 <项目根>/data
 *   BACKUP_DIR  备份目录，默认 <项目根>/backups
 *   KEEP        保留份数，默认 14（>= 1 的整数）
 *
 * 说明：相对路径以【项目根目录】为基准解析，而不是当前工作目录，
 * 这样在 cron 里不 cd 也能得到相同结果（部署示例里仍建议先 cd 再执行）。
 *
 * 退出码：0 成功；1 失败（数据库不存在、VACUUM INTO 报错、文件校验失败等）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 读取路径类环境变量；相对路径统一按项目根解析。 */
function resolveFromRoot(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  return path.resolve(ROOT, raw);
}

const DATA_DIR = resolveFromRoot('DATA_DIR', path.join(ROOT, 'data'));
const BACKUP_DIR = resolveFromRoot('BACKUP_DIR', path.join(ROOT, 'backups'));
const DB_FILE = path.join(DATA_DIR, 'wuye.db');

/** 保留份数：默认 14；非法值回退到默认并提示。 */
function parseKeep() {
  const raw = String(process.env.KEEP ?? '').trim();
  if (!raw) return 14;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1) {
    console.warn(`[警告] KEEP="${raw}" 不是 >= 1 的整数，已按默认值 14 处理。`);
    return 14;
  }
  return Math.min(value, 3650);
}

/** 本地时间戳：YYYYMMDD-HHmmss（服务器建议设置 Asia/Shanghai 时区）。 */
function timestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 同一秒内多次备份时用 -2、-3 后缀避免覆盖。 */
function uniqueTarget(baseName) {
  let candidate = path.join(BACKUP_DIR, `${baseName}.db`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    if (suffix > 100) throw new Error('同一秒内的备份次数过多，请稍后再试');
    candidate = path.join(BACKUP_DIR, `${baseName}-${suffix}.db`);
    suffix += 1;
  }
  return candidate;
}

/** 历史备份按修改时间从新到旧排序（文件名时间戳相同的情况下也能正确排序）。 */
function listBackups() {
  const pattern = /^wuye-\d{8}-\d{6}(?:-\d+)?\.db$/;
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const file = path.join(BACKUP_DIR, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
      } catch {
        /* 读不到时间戳的排到最后即可 */
      }
      return { file, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function main() {
  console.log('乌叶MC · 模组许愿池 — 数据备份');
  console.log(`  数据库    ${DB_FILE}`);
  console.log(`  备份目录  ${BACKUP_DIR}`);

  if (!fs.existsSync(DB_FILE) || !fs.statSync(DB_FILE).isFile()) {
    throw new Error(
      `找不到数据库文件：${DB_FILE}\n` +
        '  请先启动一次服务让程序创建数据库，或用 DATA_DIR 指定正确的数据目录。',
    );
  }

  const keep = parseKeep();
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });

  const target = uniqueTarget(`wuye-${timestamp()}`);
  const sqlPath = target.replaceAll("'", "''"); // SQLite 字符串字面量转义

  const db = new DatabaseSync(DB_FILE);
  try {
    // 服务端可能正在写入，等一会儿再取读锁；只读快照不会改源库。
    db.exec('PRAGMA busy_timeout = 10000');
    db.exec(`VACUUM INTO '${sqlPath}'`);
  } finally {
    db.close();
  }

  const stats = fs.statSync(target);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`备份文件校验失败（大小 ${stats.size} 字节）：${target}`);
  }

  const backups = listBackups();
  const stale = backups.slice(keep);
  let removed = 0;
  for (const item of stale) {
    try {
      fs.unlinkSync(item.file);
      removed += 1;
      console.log(`  已清理旧备份  ${path.basename(item.file)}`);
    } catch (error) {
      console.warn(`  [警告] 删除旧备份失败：${item.file}（${error.message}）`);
    }
  }

  console.log('');
  console.log(`  备份文件  ${target}`);
  console.log(`  文件大小  ${formatSize(stats.size)}`);
  console.log(
    `  保留策略  最近 ${keep} 份（现有 ${backups.length - removed} 份，本次清理 ${removed} 份）`,
  );
  console.log('');
  console.log('备份完成。');
  console.log('提示：源库使用 WAL 模式，VACUUM INTO 生成的是包含已提交事务的一致快照，无需停服。');
}

try {
  main();
} catch (error) {
  console.error('');
  console.error(`备份失败：${error.message}`);
  process.exitCode = 1;
}
