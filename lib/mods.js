/**
 * mods.js — fan gate (fan code) and downloadable mods / modpacks.
 * Files live in DATA_DIR/files; the DB keeps metadata and download counts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting } from './db.js';
import { hmacHex, randomHex } from './security.js';

export const MOD_KINDS = ['mod', 'modpack'];
export const MAX_UPLOAD = 300 * 1024 * 1024;

export function migrateMods(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fans (
      voter_key   TEXT    PRIMARY KEY,
      nickname    TEXT    NOT NULL,
      verified_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mods (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      kind        TEXT    NOT NULL DEFAULT 'mod',
      name        TEXT    NOT NULL,
      version     TEXT    NOT NULL DEFAULT '',
      mc_version  TEXT    NOT NULL DEFAULT '',
      loader      TEXT    NOT NULL DEFAULT '',
      description TEXT    NOT NULL DEFAULT '',
      file_name   TEXT    NOT NULL,
      stored_name TEXT    NOT NULL,
      size        INTEGER NOT NULL,
      sha256      TEXT    NOT NULL,
      downloads   INTEGER NOT NULL DEFAULT 0,
      hidden      INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
  `);
  const cols = db.prepare('PRAGMA table_info(mods)').all().map((c) => c.name);
  if (!cols.includes('image')) db.exec("ALTER TABLE mods ADD COLUMN image TEXT NOT NULL DEFAULT ''");
}

/* ---------------- fan gate ---------------- */

const normCode = (code) => String(code || '').trim().toLowerCase().replace(/\s+/g, '');

export function getFanCode(db) {
  return getSetting(db, 'fan_code', '');
}

export function setFanCode(db, code) {
  setSetting(db, 'fan_code', String(code || '').trim());
}

export function checkFanCode(db, code) {
  const expected = normCode(getFanCode(db));
  const given = normCode(code);
  if (!expected || !given || expected.length !== given.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export function verifyFan(db, voterKey, nickname) {
  db.prepare(
    `INSERT INTO fans (voter_key, nickname, verified_at) VALUES (?, ?, ?)
     ON CONFLICT(voter_key) DO UPDATE SET nickname = excluded.nickname`,
  ).run(voterKey, nickname, Date.now());
}

export function getFan(db, voterKey) {
  const row = db.prepare('SELECT nickname, verified_at AS verifiedAt FROM fans WHERE voter_key = ?').get(voterKey);
  return row ? { nickname: row.nickname, verifiedAt: Number(row.verifiedAt) } : null;
}

export function countFans(db) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM fans').get().n);
}

/* ---------------- mods ---------------- */

function mapMod(row) {
  return {
    id: Number(row.id),
    kind: row.kind,
    name: row.name,
    version: row.version,
    mcVersion: row.mc_version,
    loader: row.loader,
    description: row.description,
    fileName: row.file_name,
    size: Number(row.size),
    sha256: row.sha256,
    downloads: Number(row.downloads),
    hidden: Boolean(row.hidden),
    createdAt: Number(row.created_at),
    image: row.image || '',
  };
}

export function listMods(db, { includeHidden = false } = {}) {
  const rows = db.prepare(`SELECT * FROM mods ${includeHidden ? '' : 'WHERE hidden = 0'} ORDER BY created_at DESC`).all();
  return rows.map(mapMod);
}

export function getMod(db, id) {
  const row = db.prepare('SELECT * FROM mods WHERE id = ?').get(id);
  return row ? { ...mapMod(row), storedName: row.stored_name } : null;
}

/** Streams the request body to disk, enforcing a size cap and checking the ZIP/JAR magic bytes. */
export function receiveUpload(req, dir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dir, { recursive: true });
    const stored = `${Date.now().toString(36)}-${randomHex(6)}.bin`;
    const file = path.join(dir, stored);
    const out = fs.createWriteStream(file);
    const hash = crypto.createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(file, { force: true }, () => reject(error));
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) {
        req.destroy();
        fail(Object.assign(new Error('too_large'), { code: 'too_large' }));
        return;
      }
      if (head.length < 4) head = Buffer.concat([head, chunk]).subarray(0, 4);
      hash.update(chunk);
      out.write(chunk);
    });
    req.on('error', fail);
    req.on('end', () => {
      if (failed) return;
      out.end(() => {
        if (size === 0) return fail(Object.assign(new Error('empty'), { code: 'empty' }));
        if (head.toString('hex') !== '504b0304') return fail(Object.assign(new Error('not_zip'), { code: 'not_zip' }));
        resolve({ stored, size, sha256: hash.digest('hex') });
      });
    });
  });
}

export function createMod(db, meta, upload) {
  const info = db
    .prepare(
      `INSERT INTO mods (kind, name, version, mc_version, loader, description, file_name, stored_name, size, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(meta.kind, meta.name, meta.version, meta.mcVersion, meta.loader, meta.description, meta.fileName, upload.stored, upload.size, upload.sha256, Date.now());
  return Number(info.lastInsertRowid);
}

export function updateMod(db, id, patch) {
  const cols = { name: 'name', version: 'version', mcVersion: 'mc_version', loader: 'loader', description: 'description', hidden: 'hidden', image: 'image' };
  for (const [k, col] of Object.entries(cols)) {
    if (patch[k] !== undefined) db.prepare(`UPDATE mods SET ${col} = ? WHERE id = ?`).run(patch[k], id);
  }
}

export function deleteMod(db, id, dir) {
  const mod = getMod(db, id);
  if (!mod) return false;
  db.prepare('DELETE FROM mods WHERE id = ?').run(id);
  fs.rm(path.join(dir, mod.storedName), { force: true }, () => {});
  return true;
}

/* Signed, short-lived download links so a plain <a href> works without headers. */
export function downloadToken(secret, modId, ttlMs = 10 * 60_000) {
  const exp = Date.now() + ttlMs;
  return `${exp}.${hmacHex(secret, `dl:${modId}:${exp}`).slice(0, 32)}`;
}

export function checkDownloadToken(secret, modId, token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = hmacHex(secret, `dl:${modId}:${exp}`).slice(0, 32);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function countDownload(db, id) {
  db.prepare('UPDATE mods SET downloads = downloads + 1 WHERE id = ?').run(id);
}
