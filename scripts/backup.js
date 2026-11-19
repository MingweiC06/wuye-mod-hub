#!/usr/bin/env node
/**
 * 乌叶MC · 模组许愿池 — 数据备份
 *
 * 做了什么：把 <DATA_DIR> 下的 SQLite 数据库、上传文件（files/）、媒体文件（media/）
 * 以及服务器密钥文件（admin-code.txt / relay-secret.txt / cf-token.txt）打成一个
 * 快照目录，并写入两份可校验的清单：
 *   - manifest.json   表结构与逐表行数、每个文件的字节数与 SHA-256、数据库完整性结果
 *   - SHA256SUMS      sha256sum 兼容的校验和清单（覆盖快照内所有文件）
 * 快照目录权限 0700、文件 0600；默认保留最近 KEEP 份（默认 14）。
 *
 * 可选异地：设置 OFFSITE_DIR 时，把快照逐文件用 AES-256-GCM 加密写入该目录
 * （口令来自 BACKUP_PASSPHRASE），并在本地解密校验一遍。OFFSITE_DIR 可以是任意
 * 已挂载/已同步到异地的目录——本项目零依赖，不直接调用云厂商 API。
 *
 * 环境变量：DATA_DIR（默认 ./data）、BACKUP_DIR（默认 ./backups）、KEEP（默认 14）、
 *          OFFSITE_DIR（默认不启用）、BACKUP_PASSPHRASE（启用异地时必填）
 * 命令行：  node scripts/backup.js [--keep=N] [--offsite] [--dir=<BACKUP_DIR>] [--quiet]
 * 退出码：  0 成功（含"异地未配置"），1 失败
 *
 * 只读：脚本以只读方式打开源数据库快照写入新文件，不修改生产库、不删除 data/。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const SNAPSHOT_PREFIX = 'snapshot-';
const SNAPSHOT_RE = /^snapshot-\d{8}-\d{6}(?:-\d+)?$/;
const DEFAULT_KEEP = 14;
const MAX_KEEP = 3650;

/** 上传目录 + 媒体目录（相对 DATA_DIR）。 */
const ASSET_DIRS = ['files', 'media'];
/** 只存在于服务器、丢了会改变行为的配置文件（相对 DATA_DIR）。 */
const SECRET_FILES = ['admin-code.txt', 'relay-secret.txt', 'cf-token.txt'];

const ENC_MAGIC = Buffer.from('WUYEBAK1', 'utf8');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT_OPTS = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function resolveFromRoot(value, fallback) {
  const raw = value && String(value).trim() ? String(value).trim() : fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

/** 解析可选路径：空值返回 ''，相对路径基于项目根。 */
function resolveOptionalFromRoot(value) {
  const raw = value && String(value).trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT, raw);
}

function stampOf(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** 递归列出目录下的普通文件（跳过符号链接），按路径排序。 */
function walkFiles(dir) {
  const out = [];
  const visit = (current) => {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(dir)) visit(dir);
  return out;
}

function relativeTo(base, file) {
  return path.relative(base, file).split(path.sep).join('/');
}

/** 数据库里所有用户表的行数。 */
function readTableCounts(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  const counts = {};
  for (const name of tables) {
    const quoted = `"${String(name).replaceAll('"', '""')}"`;
    counts[name] = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${quoted}`).get().c);
  }
  return counts;
}

function integrityOk(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  return rows.length === 1 && String(rows[0].integrity_check || '').toLowerCase() === 'ok';
}

function chmodTree(target, dirMode, fileMode) {
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    fs.chmodSync(target, dirMode);
    for (const entry of fs.readdirSync(target)) chmodTree(path.join(target, entry), dirMode, fileMode);
  } else if (stat.isFile()) {
    fs.chmodSync(target, fileMode);
  }
}

function availableBytes(dir) {
  try {
    const stats = fs.statfsSync(dir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function checkFreeSpace(label, dir, requiredBytes) {
  const free = availableBytes(dir);
  if (free === Number.POSITIVE_INFINITY) return;
  if (free < requiredBytes) {
    throw new Error(`${label} 空间不足：需要约 ${formatBytes(requiredBytes)}，可用 ${formatBytes(free)}（目录：${dir}）`);
  }
}

/** 生成一个不冲突的快照目录名。 */
function allocateSnapshotDir(backupDir, stamp) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = attempt === 0 ? `${SNAPSHOT_PREFIX}${stamp}` : `${SNAPSHOT_PREFIX}${stamp}-${attempt + 1}`;
    const full = path.join(backupDir, name);
    if (!fs.existsSync(full)) return full;
  }
  throw new Error(`无法为 ${stamp} 分配快照目录（同名文件过多）`);
}

function parseChecksums(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trim());
    if (!match) throw new Error(`SHA256SUMS 行格式不正确: ${line.slice(0, 80)}`);
    entries.set(match[2], match[1].toLowerCase());
  }
  return entries;
}

/**
 * 校验一个快照目录：校验和、清单一致性、数据库完整性与逐表行数。
 * @returns {Promise<{ok: boolean, problems: string[], manifest: object|null, files: number}>}
 */
export async function verifySnapshot(snapshotDir) {
  const problems = [];
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  const sumsPath = path.join(snapshotDir, 'SHA256SUMS');
  let manifest = null;

  for (const file of [manifestPath, sumsPath, path.join(snapshotDir, 'wuye.db')]) {
    if (!fs.existsSync(file)) problems.push(`缺少文件：${path.basename(file)}`);
  }
  if (problems.length) return { ok: false, problems, manifest, files: 0 };

  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    problems.push(`manifest.json 无法解析：${error.message}`);
    return { ok: false, problems, manifest: null, files: 0 };
  }

  let sums = new Map();
  try {
    sums = parseChecksums(fs.readFileSync(sumsPath, 'utf8'));
  } catch (error) {
    problems.push(`SHA256SUMS 无法解析：${error.message}`);
    return { ok: false, problems, manifest, files: 0 };
  }

  for (const [rel, expected] of sums) {
    const file = path.join(snapshotDir, rel);
    if (!fs.existsSync(file)) {
      problems.push(`清单里的文件不存在：${rel}`);
      continue;
    }
    const actual = await sha256File(file);
    if (actual !== expected) problems.push(`校验和不匹配：${rel}`);
  }

  for (const file of walkFiles(snapshotDir)) {
    const rel = relativeTo(snapshotDir, file);
    if (rel === 'SHA256SUMS') continue;
    if (!sums.has(rel)) problems.push(`存在未登记的文件：${rel}`);
  }

  for (const asset of manifest.assets || []) {
    const file = path.join(snapshotDir, asset.path);
    if (fs.existsSync(file) && fs.statSync(file).size !== asset.bytes) {
      problems.push(`文件大小不一致：${asset.path}`);
    }
  }

  if (manifest.database?.integrity !== 'ok') problems.push('清单记录的数据库完整性不是 ok');

  const dbFile = path.join(snapshotDir, 'wuye.db');
  if (manifest.source?.db_sha256 && sums.get('wuye.db') !== manifest.source.db_sha256) {
    problems.push('wuye.db 的校验和与清单不一致');
  }

  try {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      if (!integrityOk(db)) problems.push('快照数据库 integrity_check 未通过');
      const counts = readTableCounts(db);
      const expected = manifest.database?.tables || {};
      for (const name of Object.keys(expected)) {
        if (counts[name] !== expected[name]) {
          problems.push(`表行数不一致：${name} 期望 ${expected[name]}，实际 ${counts[name] ?? '缺失'}`);
        }
      }
      for (const name of Object.keys(counts)) {
        if (!(name in expected)) problems.push(`清单缺少表 ${name} 的行数记录`);
      }
      if (manifest.database?.db_bytes && fs.statSync(dbFile).size !== manifest.database.db_bytes) {
        problems.push('wuye.db 的字节数与清单不一致');
      }
    } finally {
      db.close();
    }
  } catch (error) {
    problems.push(`无法打开快照数据库：${error.message}`);
  }

  return { ok: problems.length === 0, problems, manifest, files: sums.size };
}

/** 列出备份目录里的快照，新的在前。 */
export function listSnapshots(backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && SNAPSHOT_RE.test(entry.name))
    .map((entry) => {
      const full = path.join(backupDir, entry.name);
      const stat = fs.statSync(full);
      let tables = 0;
      let assets = 0;
      let bytes = 0;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(full, 'manifest.json'), 'utf8'));
        tables = Object.keys(manifest.database?.tables || {}).length;
        assets = (manifest.assets || []).length + (manifest.secrets || []).length;
        bytes = Number(manifest.totals?.bytes || 0);
      } catch {
        /* 损坏的快照仍列出来，方便人工处理 */
      }
      return { name: entry.name, dir: full, mtime: stat.mtime, tables, assets, bytes };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function pruneSnapshots(backupDir, keep) {
  const snapshots = listSnapshots(backupDir);
  const removed = [];
  for (const snapshot of snapshots.slice(keep)) {
    fs.rmSync(snapshot.dir, { recursive: true, force: true });
    removed.push(snapshot.name);
  }
  return removed;
}

/* ----------------------------- 加密异地 ----------------------------- */

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase), salt, 32, SCRYPT_OPTS);
}

/** 逐文件 AES-256-GCM 加密：MAGIC | salt | iv | ciphertext | tag。 */
async function encryptFile(source, target, passphrase) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const out = fs.createWriteStream(target, { mode: 0o600, flags: 'wx' });
  out.write(Buffer.concat([ENC_MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(source), cipher, out);
  fs.appendFileSync(target, cipher.getAuthTag());
  fs.chmodSync(target, 0o600);
}

function readEncryptedHeader(file, passphrase) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(ENC_MAGIC.length + SALT_BYTES + IV_BYTES);
    fs.readSync(fd, header, 0, header.length, 0);
    if (!header.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
      throw new Error(`${path.basename(file)} 不是有效的加密备份文件`);
    }
    const salt = header.subarray(ENC_MAGIC.length, ENC_MAGIC.length + SALT_BYTES);
    const iv = header.subarray(ENC_MAGIC.length + SALT_BYTES);
    const size = fs.fstatSync(fd).size;
    const cipherLen = size - header.length - TAG_BYTES;
    if (cipherLen < 0) throw new Error(`${path.basename(file)} 文件长度异常`);
    const tag = Buffer.alloc(TAG_BYTES);
    fs.readSync(fd, tag, 0, TAG_BYTES, header.length + cipherLen);
    return { headerLen: header.length, cipherLen, salt, iv, tag };
  } finally {
    fs.closeSync(fd);
  }
}

function createDecipher(file, passphrase) {
  const meta = readEncryptedHeader(file, passphrase);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, meta.salt), meta.iv);
  decipher.setAuthTag(meta.tag);
  const stream = meta.cipherLen > 0
    ? fs.createReadStream(file, { start: meta.headerLen, end: meta.headerLen + meta.cipherLen - 1 })
    : Readable.from([]);
  return { decipher, stream };
}

function friendlyDecryptError(error, file) {
  const text = String(error && error.message ? error.message : error);
  if (/unable to authenticate|bad decrypt|ERR_OSSL|Unsupported state/i.test(text)) {
    return new Error(`解密失败：口令不正确，或文件已损坏（${path.basename(file)}）`);
  }
  return error;
}

/** 解密并计算明文 SHA-256（不落盘）。 */
async function hashDecrypted(file, passphrase) {
  try {
    const { decipher, stream } = createDecipher(file, passphrase);
    const hash = crypto.createHash('sha256');
    await pipeline(
      stream,
      decipher,
      new Writable({
        write(chunk, _encoding, callback) {
          hash.update(chunk);
          callback();
        },
      }),
    );
    return hash.digest('hex');
  } catch (error) {
    throw friendlyDecryptError(error, file);
  }
}

async function decryptFile(source, target, passphrase) {
  try {
    const { decipher, stream } = createDecipher(source, passphrase);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    await pipeline(stream, decipher, fs.createWriteStream(target, { mode: 0o600 }));
    fs.chmodSync(target, 0o600);
  } catch (error) {
    throw friendlyDecryptError(error, source);
  }
}

/** 异地目录 → 最新快照目录（只做命名解析）。 */
export function latestOffsiteSnapshot(offsiteDir) {
  const snapshots = listSnapshots(offsiteDir);
  if (!snapshots.length) throw new Error(`异地目录里没有快照：${offsiteDir}`);
  return snapshots[0].dir;
}

/**
 * 从加密的异地快照解密到本地目录，然后校验。
 * @returns {Promise<{target: string, files: number}>}
 */
export async function decryptOffsiteSnapshot(offsiteDir, targetDir, passphrase) {
  if (!passphrase) throw new Error('缺少解密口令：请设置 BACKUP_PASSPHRASE');
  const source = latestOffsiteSnapshot(offsiteDir);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const files = walkFiles(source);
  for (const file of files) {
    const rel = relativeTo(source, file);
    if (!rel.endsWith('.enc')) continue;
    const dest = path.join(targetDir, rel.slice(0, -'.enc'.length));
    await decryptFile(file, dest, passphrase);
  }
  chmodTree(targetDir, 0o700, 0o600);
  const verified = await verifySnapshot(targetDir);
  if (!verified.ok) {
    throw new Error(`异地快照解密后校验失败：\n- ${verified.problems.join('\n- ')}`);
  }
  return { target: targetDir, files: verified.files };
}

async function writeOffsite(snapshotDir, offsiteDir, passphrase, log) {
  if (!passphrase) {
    throw new Error('已设置 OFFSITE_DIR，但缺少 BACKUP_PASSPHRASE：拒绝写出未加密的异地备份');
  }
  const name = path.basename(snapshotDir);
  const target = path.join(offsiteDir, name);
  fs.mkdirSync(offsiteDir, { recursive: true, mode: 0o700 });
  if (fs.existsSync(target)) throw new Error(`异地快照目录已存在：${target}`);

  const files = walkFiles(snapshotDir);
  const expected = new Map(files.map((file) => [relativeTo(snapshotDir, file), file]));
  for (const file of files) {
    const rel = relativeTo(snapshotDir, file);
    await encryptFile(file, path.join(target, `${rel}.enc`), passphrase);
  }
  const note = [
    '乌叶MC · 模组许愿池 — 加密异地备份',
    '',
    `快照：${name}`,
    '恢复方式：',
    `  BACKUP_PASSPHRASE=<口令> node scripts/restore-backup.js --from-offsite "${offsiteDir}" --target <临时目录>`,
    '  随后按 deploy/BACKUP.md 的「恢复」一节操作。',
    '',
    '本目录由 scripts/backup.js 生成：所有文件均为 AES-256-GCM 加密，口令仅保存在你的密码管理器里。',
  ].join('\n');
  fs.writeFileSync(path.join(target, 'RESTORE.txt'), note + '\n', { mode: 0o600 });

  // 立刻解密回来比对一遍，确认异地副本可用。
  let checked = 0;
  for (const [rel, file] of expected) {
    const enc = path.join(target, `${rel}.enc`);
    const actual = await hashDecrypted(enc, passphrase);
    const expectedHash = await sha256File(file);
    if (actual !== expectedHash) throw new Error(`异地加密校验失败：${rel}`);
    checked += 1;
  }
  chmodTree(target, 0o700, 0o600);
  log(`异地加密：${checked} 个文件已写入 ${target} 并解密校验通过`);
  return { dir: target, files: checked };
}

/* ------------------------------- 主流程 ------------------------------- */

/**
 * 建立一份快照。
 * @param {object} [options]
 * @param {string} [options.dataDir]  数据目录（默认 <项目根>/data）
 * @param {string} [options.backupDir] 备份目录（默认 <项目根>/backups）
 * @param {number} [options.keep]     保留快照份数（默认 14）
 * @param {string} [options.offsiteDir] 加密异地目录（默认不启用）
 * @param {string} [options.passphrase] 加密口令（默认 BACKUP_PASSPHRASE）
 * @param {(line: string) => void} [options.log]
 */
export async function createBackup(options = {}) {
  const started = Date.now();
  const log = options.log || (() => {});
  const dataDir = path.resolve(options.dataDir || resolveFromRoot(process.env.DATA_DIR, 'data'));
  const backupDir = path.resolve(options.backupDir || resolveFromRoot(process.env.BACKUP_DIR, 'backups'));
  const keep = Math.min(MAX_KEEP, Math.max(1, Number(options.keep || process.env.KEEP || DEFAULT_KEEP) || DEFAULT_KEEP));
  const offsiteDir = options.offsiteDir ? path.resolve(options.offsiteDir) : resolveOptionalFromRoot(process.env.OFFSITE_DIR);
  const passphrase = options.passphrase || process.env.BACKUP_PASSPHRASE || '';

  const dbFile = path.join(dataDir, 'wuye.db');
  if (!fs.existsSync(dbFile)) throw new Error(`找不到数据库：${dbFile}（DATA_DIR=${dataDir}）`);

  const dbBytes = fs.statSync(dbFile).size;
  let assetsBytes = 0;
  const assetSources = [];
  for (const dir of ASSET_DIRS) {
    const full = path.join(dataDir, dir);
    const files = walkFiles(full);
    for (const file of files) {
      assetsBytes += fs.statSync(file).size;
      assetSources.push({ dir, file });
    }
  }
  const secretSources = SECRET_FILES.map((name) => path.join(dataDir, name)).filter((file) => fs.existsSync(file));

  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
  const required = dbBytes * 2 + assetsBytes + 8 * 1024 * 1024;
  checkFreeSpace('备份目录', backupDir, required);
  if (offsiteDir) checkFreeSpace('异地目录', path.dirname(offsiteDir), assetsBytes + dbBytes + 8 * 1024 * 1024);

  const stamp = stampOf();
  const snapshotDir = allocateSnapshotDir(backupDir, stamp);
  fs.mkdirSync(snapshotDir, { mode: 0o700 });
  log(`数据目录：${dataDir}`);
  log(`快照目录：${snapshotDir}`);

  const warnings = [];

  // 1) 数据库在线快照 + 源库行数
  let sourceCounts = {};
  let sourceIntegrity = true;
  const source = new DatabaseSync(dbFile);
  try {
    source.exec('PRAGMA busy_timeout = 10000');
    sourceCounts = readTableCounts(source);
    sourceIntegrity = integrityOk(source);
    if (!sourceIntegrity) warnings.push('源数据库 integrity_check 未通过（快照仍会生成，请尽快人工检查）');
    const target = path.join(snapshotDir, 'wuye.db');
    source.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    source.close();
  }
  fs.chmodSync(path.join(snapshotDir, 'wuye.db'), 0o600);

  // 2) 快照数据库校验：完整性 + 逐表行数
  const snapshotDbFile = path.join(snapshotDir, 'wuye.db');
  let tables = {};
  const snapshotDb = new DatabaseSync(snapshotDbFile, { readOnly: true });
  try {
    if (!integrityOk(snapshotDb)) throw new Error('快照数据库 integrity_check 未通过，已中止（未写入清单）');
    tables = readTableCounts(snapshotDb);
  } finally {
    snapshotDb.close();
  }
  for (const name of Object.keys(sourceCounts)) {
    if (tables[name] !== sourceCounts[name]) {
      warnings.push(`备份期间 ${name} 行数变化：${sourceCounts[name]} → ${tables[name]}（快照记录的是 ${tables[name]}）`);
    }
  }

  // 3) 上传文件 + 媒体文件
  const assets = [];
  for (const { dir, file } of assetSources) {
    const rel = path.join(dir, path.relative(path.join(dataDir, dir), file));
    const dest = path.join(snapshotDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.copyFileSync(file, dest);
    fs.chmodSync(dest, 0o600);
    const bytes = fs.statSync(dest).size;
    const sourceBytes = fs.statSync(file).size;
    if (bytes !== sourceBytes) warnings.push(`复制后大小不一致：${rel}`);
    assets.push({ path: rel.split(path.sep).join('/'), bytes, sha256: await sha256File(dest) });
  }

  // 4) 服务器密钥文件（丢了会改变签名/管理码行为）
  const secrets = [];
  for (const file of secretSources) {
    const name = path.basename(file);
    const dest = path.join(snapshotDir, 'secrets', name);
    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
    fs.copyFileSync(file, dest);
    fs.chmodSync(dest, 0o600);
    secrets.push({ path: `secrets/${name}`, bytes: fs.statSync(dest).size, sha256: await sha256File(dest) });
  }

  // 5) 清单
  const dbSha = await sha256File(snapshotDbFile);
  const dbStat = fs.statSync(snapshotDbFile);
  const manifest = {
    format: 'wuye-backup',
    version: 1,
    created_at: new Date().toISOString(),
    created_at_local: stamp,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    source: { data_dir: dataDir, db_file: 'wuye.db', db_bytes: dbStat.size, db_sha256: dbSha },
    database: {
      integrity: 'ok',
      source_integrity: sourceIntegrity ? 'ok' : 'failed',
      db_bytes: dbStat.size,
      tables,
      source_tables: sourceCounts,
    },
    assets,
    secrets,
    totals: {
      files: 1 + assets.length + secrets.length,
      bytes: dbStat.size + assets.reduce((sum, item) => sum + item.bytes, 0) + secrets.reduce((sum, item) => sum + item.bytes, 0),
      assets: assets.length,
      secrets: secrets.length,
    },
    warnings,
  };
  const manifestPath = path.join(snapshotDir, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(manifestPath, 0o600);

  // 6) 校验和清单（覆盖除自身外的所有文件）
  const lines = [];
  for (const file of walkFiles(snapshotDir)) {
    const rel = relativeTo(snapshotDir, file);
    lines.push(`${await sha256File(file)}  ${rel}`);
  }
  lines.sort();
  fs.writeFileSync(path.join(snapshotDir, 'SHA256SUMS'), `${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(path.join(snapshotDir, 'SHA256SUMS'), 0o600);
  chmodTree(snapshotDir, 0o700, 0o600);

  // 7) 自检：读回来验一遍，坏快照不留在备份目录里
  const verified = await verifySnapshot(snapshotDir);
  if (!verified.ok) {
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    throw new Error(`快照自检失败，已删除：\n- ${verified.problems.join('\n- ')}`);
  }

  log(`数据库：${formatBytes(dbStat.size)}，integrity_check ok，${Object.keys(tables).length} 张表`);
  log(`文件：${assets.length} 个资产（${formatBytes(assets.reduce((sum, item) => sum + item.bytes, 0))}），${secrets.length} 个密钥文件`);
  log(`校验：SHA256SUMS 全部通过（${verified.files} 个文件）`);
  for (const warning of warnings) log(`提醒：${warning}`);

  // 8) 保留策略
  const removed = pruneSnapshots(backupDir, keep);
  if (removed.length) log(`清理旧快照：${removed.join('、')}（保留最近 ${keep} 份）`);
  const remaining = listSnapshots(backupDir).length;
  log(`当前快照：${remaining} 份（保留上限 ${keep} 份）`);

  // 9) 加密异地（可选）
  let offsite = null;
  if (offsiteDir) {
    offsite = await writeOffsite(snapshotDir, offsiteDir, passphrase, log);
  } else {
    log('异地备份：未配置（设置 OFFSITE_DIR + BACKUP_PASSPHRASE 后启用）。本地备份不能作为唯一副本。');
  }

  return {
    snapshotDir,
    kept: remaining,
    pruned: removed,
    manifest,
    verified: verified.files,
    offsite,
    warnings,
    durationMs: Date.now() - started,
  };
}

function parseArgs(argv) {
  const options = { quiet: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg === '--offsite') options.offsite = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('--keep=')) {
      const value = Number(arg.slice('--keep='.length));
      if (!Number.isInteger(value) || value < 1) throw new Error(`--keep 需要一个正整数，收到：${arg.slice('--keep='.length)}`);
      options.keep = value;
    } else if (arg.startsWith('--dir=')) {
      const value = arg.slice('--dir='.length).trim();
      if (!value) throw new Error('--dir 需要一个目录');
      options.backupDir = value;
    } else throw new Error(`未知参数：${arg}（支持 --keep=N / --dir=<备份目录> / --offsite / --quiet / --help）`);
  }
  return options;
}

async function main() {
  const argv = process.argv.slice(2);
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    console.error(`[backup] ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (args.help) {
    console.log(`用法：node scripts/backup.js [--keep=N] [--dir=<备份目录>] [--offsite] [--quiet]

环境变量：DATA_DIR / BACKUP_DIR / KEEP / OFFSITE_DIR / BACKUP_PASSPHRASE
退出码：0 成功，1 失败`);
    return;
  }
  let offsiteDir;
  if (args.offsite) {
    offsiteDir = resolveOptionalFromRoot(process.env.OFFSITE_DIR);
    if (!offsiteDir) {
      console.error('[backup] 已指定 --offsite，但没有设置 OFFSITE_DIR（加密异地目录）');
      process.exitCode = 1;
      return;
    }
  }
  try {
    const report = await createBackup({
      backupDir: args.backupDir,
      keep: args.keep,
      offsiteDir,
      log: args.quiet ? () => {} : (line) => console.log(`[backup] ${line}`),
    });
    console.log(`[backup] 完成：${report.snapshotDir}（${formatBytes(report.manifest.totals.bytes)}，用时 ${report.durationMs} ms）`);
  } catch (error) {
    console.error(`[backup] 失败：${error.message}`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) main();

export { ROOT, formatBytes, sha256File, walkFiles, resolveFromRoot };
