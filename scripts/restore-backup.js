#!/usr/bin/env node
/**
 * 乌叶MC · 模组许愿池 — 从备份快照恢复
 *
 * 做了什么：校验快照（SHA256SUMS → 数据库完整性 → 逐表行数 → 文件哈希），
 * 然后把数据库、上传文件、媒体文件恢复到目标目录，并再校验一遍恢复结果。
 * 默认不会覆盖已有数据库；只有显式 --force 才允许覆盖。生产目录（DATA_DIR）
 * 必须 --force 才动，恢复前请先停服务并另存现有 data/。
 *
 * 用法：
 *   node scripts/restore-backup.js --list
 *   node scripts/restore-backup.js --snapshot <快照目录> --target <目标目录> [--force] [--with-secrets]
 *   node scripts/restore-backup.js --from-offsite <异地目录> --target <目标目录> [--force] [--with-secrets]
 *
 * 环境变量：BACKUP_DIR（默认 ./backups）、DATA_DIR（默认 ./data）、BACKUP_PASSPHRASE（异地解密用）
 * 退出码：0 成功，1 失败
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { decryptOffsiteSnapshot, listSnapshots, resolveFromRoot, sha256File, verifySnapshot, walkFiles, formatBytes } from './backup.js';

function parseArgs(argv) {
  const options = { force: false, withSecrets: false };
  const valueOf = (arg, name, index) => {
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    if (arg === name) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${name} 缺少参数值`);
      return next;
    }
    return null;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg === '--list') options.list = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--with-secrets') options.withSecrets = true;
    else {
      const snapshot = valueOf(arg, '--snapshot', index);
      if (snapshot !== null) {
        options.snapshot = snapshot;
        if (arg === '--snapshot') index += 1;
        continue;
      }
      const target = valueOf(arg, '--target', index);
      if (target !== null) {
        options.target = target;
        if (arg === '--target') index += 1;
        continue;
      }
      const offsite = valueOf(arg, '--from-offsite', index);
      if (offsite !== null) {
        options.fromOffsite = offsite;
        if (arg === '--from-offsite') index += 1;
        continue;
      }
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

/**
 * 恢复一个快照到目标目录，并在结束前逐项复核。
 * @param {object} options
 * @param {string} options.snapshot 快照目录
 * @param {string} options.target   目标数据目录
 * @param {boolean} [options.force] 允许覆盖已有数据库
 * @param {boolean} [options.withSecrets] 同时恢复 secrets/（管理码、中继密钥等）
 * @param {(line: string) => void} [options.log]
 */
export async function restoreBackup(options) {
  const log = options.log || (() => {});
  const snapshotDir = path.resolve(options.snapshot);
  const targetDir = path.resolve(options.target);
  const force = Boolean(options.force);

  const verified = await verifySnapshot(snapshotDir);
  if (!verified.ok) {
    throw new Error(`快照校验未通过，已中止恢复：\n- ${verified.problems.join('\n- ')}`);
  }
  const manifest = verified.manifest;
  log(`快照校验通过：${verified.files} 个文件、${Object.keys(manifest.database?.tables || {}).length} 张表`);

  const dataDirFromEnv = resolveFromRoot(process.env.DATA_DIR, 'data');
  if (targetDir === dataDirFromEnv && !force) {
    throw new Error(`目标是生产数据目录（${targetDir}）：请先停服务、另存现有 data/，再加 --force`);
  }
  if (fs.existsSync(path.join(targetDir, 'wuye.db')) && !force) {
    throw new Error(`目标目录已有 wuye.db（${targetDir}）：确认要覆盖请加 --force`);
  }

  fs.mkdirSync(targetDir, { recursive: true });

  // 覆盖数据库前先删掉旧的 WAL/SHM，否则 SQLite 会把旧日志回放到恢复后的库上。
  for (const suffix of ['-wal', '-shm']) {
    const stale = path.join(targetDir, `wuye.db${suffix}`);
    if (fs.existsSync(stale)) {
      fs.rmSync(stale, { force: true });
      log(`删除旧日志：${path.basename(stale)}`);
    }
  }

  const dbSource = path.join(snapshotDir, 'wuye.db');
  const dbTarget = path.join(targetDir, 'wuye.db');
  fs.copyFileSync(dbSource, dbTarget);
  fs.chmodSync(dbTarget, 0o600);

  const copied = [];
  for (const entry of manifest.assets || []) {
    const source = path.join(snapshotDir, entry.path);
    const target = path.join(targetDir, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.copyFileSync(source, target);
    fs.chmodSync(target, 0o600);
    copied.push(entry);
  }
  if (copied.length) log(`恢复文件：${copied.length} 个（${formatBytes(copied.reduce((sum, item) => sum + item.bytes, 0))}）`);

  if (options.withSecrets) {
    for (const entry of manifest.secrets || []) {
      const source = path.join(snapshotDir, entry.path);
      const target = path.join(targetDir, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.copyFileSync(source, target);
      fs.chmodSync(target, 0o600);
    }
    if ((manifest.secrets || []).length) log(`恢复密钥文件：${manifest.secrets.length} 个`);
  } else if ((manifest.secrets || []).length) {
    log(`跳过密钥文件 ${manifest.secrets.length} 个（需要时加 --with-secrets；现有文件不会被覆盖）`);
  }

  // 复核恢复结果：文件哈希 + 数据库完整性 + 逐表行数
  const problems = [];
  for (const entry of [...(manifest.assets || []), ...(options.withSecrets ? manifest.secrets || [] : [])]) {
    const file = path.join(targetDir, entry.path);
    if (!fs.existsSync(file)) {
      problems.push(`缺少文件：${entry.path}`);
      continue;
    }
    if (fs.statSync(file).size !== entry.bytes) problems.push(`大小不一致：${entry.path}`);
    if ((await sha256File(file)) !== entry.sha256) problems.push(`哈希不一致：${entry.path}`);
  }

  const db = new DatabaseSync(dbTarget, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (!(integrity.length === 1 && String(integrity[0].integrity_check || '').toLowerCase() === 'ok')) {
      problems.push('恢复后的数据库 integrity_check 未通过');
    }
    const expected = manifest.database?.tables || {};
    for (const name of Object.keys(expected)) {
      const quoted = `"${String(name).replaceAll('"', '""')}"`;
      const actual = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${quoted}`).get().c);
      if (actual !== expected[name]) problems.push(`表行数不一致：${name} 期望 ${expected[name]}，实际 ${actual}`);
    }
  } finally {
    db.close();
  }

  if (problems.length) {
    throw new Error(`恢复后校验未通过：\n- ${problems.join('\n- ')}`);
  }

  const files = walkFiles(path.join(targetDir, 'files')).length;
  log(`恢复完成：${targetDir}`);
  log(`数据库 ${formatBytes(fs.statSync(dbTarget).size)}，integrity_check ok，${Object.keys(manifest.database?.tables || {}).length} 张表行数一致`);
  log(`files/ 现有 ${files} 个文件；如目标目录原本还有旧文件，它们不会被删除（请自行确认是否保留）`);
  log(`启动预览：DATA_DIR="${targetDir}" PORT=8081 node server.js`);
  return { target: targetDir, files: verified.files, tables: manifest.database?.tables || {} };
}

function printList(backupDir) {
  const snapshots = listSnapshots(backupDir);
  if (!snapshots.length) {
    console.log(`[restore] 备份目录里没有快照：${backupDir}`);
    return;
  }
  console.log(`[restore] 备份目录：${backupDir}（${snapshots.length} 份，新的在前）`);
  for (const snapshot of snapshots) {
    const when = snapshot.mtime.toISOString().replace('T', ' ').slice(0, 19);
    console.log(`  ${snapshot.name}  ${formatBytes(snapshot.bytes).padStart(9)}  ${snapshot.tables} 张表 / ${snapshot.assets} 个文件  mtime ${when}Z`);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[restore] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(`用法：
  node scripts/restore-backup.js --list
  node scripts/restore-backup.js --snapshot <快照目录> --target <目标目录> [--force] [--with-secrets]
  node scripts/restore-backup.js --from-offsite <异地目录> --target <目标目录> [--force] [--with-secrets]`);
    return;
  }

  const backupDir = resolveFromRoot(process.env.BACKUP_DIR, 'backups');
  if (args.list) {
    printList(backupDir);
    return;
  }

  if (!args.target) {
    console.error('[restore] 缺少 --target <目标目录>');
    process.exitCode = 1;
    return;
  }

  const log = (line) => console.log(`[restore] ${line}`);
  let stagingDir = null;
  try {
    let snapshot = args.snapshot;
    if (args.fromOffsite) {
      const passphrase = process.env.BACKUP_PASSPHRASE || '';
      stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-offsite-'));
      const decrypted = await decryptOffsiteSnapshot(path.resolve(args.fromOffsite), stagingDir, passphrase);
      log(`异地快照已解密并校验：${decrypted.files} 个文件 → ${stagingDir}`);
      snapshot = decrypted.target;
    }
    if (!snapshot) {
      console.error('[restore] 缺少 --snapshot <快照目录>（或用 --from-offsite 指定异地目录）');
      process.exitCode = 1;
      return;
    }
    await restoreBackup({ snapshot, target: args.target, force: args.force, withSecrets: args.withSecrets, log });
  } catch (error) {
    console.error(`[restore] 失败：${error.message}`);
    process.exitCode = 1;
  } finally {
    if (stagingDir) fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();
