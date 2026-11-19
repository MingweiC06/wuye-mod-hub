/**
 * sponsor.js — fan names with a key (no passwords), sponsorships and the
 * two leaderboards. A name is claimed once; the key lets the same fan take
 * the name onto another device. Sponsorship amounts are admin-only.
 */
import crypto from 'node:crypto';
import { getSetting, setSetting } from './db.js';
import { hashSecret, verifySecret } from './security.js';

export function migrateSponsor(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS board_edits (
    board TEXT NOT NULL, name TEXT NOT NULL, adjust INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (board, name))`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      name_norm  TEXT    NOT NULL UNIQUE,
      key_hash   TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_devices (
      voter_key  TEXT    PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      linked_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sponsorships (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id   INTEGER REFERENCES profiles(id) ON DELETE SET NULL,
      voter_key    TEXT    NOT NULL,
      anonymous    INTEGER NOT NULL DEFAULT 0,
      method       TEXT    NOT NULL,
      amount_cents INTEGER NOT NULL,
      note         TEXT    NOT NULL DEFAULT '',
      message      TEXT    NOT NULL DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'pending',
      created_at   INTEGER NOT NULL,
      reviewed_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sponsor_status ON sponsorships(status, created_at);
  `);
}

/* ---------------- names + keys ---------------- */

const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
export function newKey() {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i += 1) s += KEY_ALPHABET[bytes[i] % KEY_ALPHABET.length];
  return `WY-${s.slice(0, 4)}-${s.slice(4)}`;
}
const normName = (name) => String(name).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const normKey = (key) => String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^WY/, '');

export function getMe(db, voterKey) {
  const row = db
    .prepare('SELECT p.id, p.name FROM profile_devices d JOIN profiles p ON p.id = d.profile_id WHERE d.voter_key = ?')
    .get(voterKey);
  return row ? { id: Number(row.id), name: row.name } : null;
}

function link(db, voterKey, profileId) {
  db.prepare(
    `INSERT INTO profile_devices (voter_key, profile_id, linked_at) VALUES (?, ?, ?)
     ON CONFLICT(voter_key) DO UPDATE SET profile_id = excluded.profile_id, linked_at = excluded.linked_at`,
  ).run(voterKey, profileId, Date.now());
}

/** Claim a new name on this device. Returns the key (shown once) or { error: 'taken' }. */
export function claimName(db, voterKey, name) {
  const norm = normName(name);
  if (db.prepare('SELECT 1 FROM profiles WHERE name_norm = ?').get(norm)) return { error: 'taken' };
  const key = newKey();
  const info = db
    .prepare('INSERT INTO profiles (name, name_norm, key_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(name.trim(), norm, hashSecret(normKey(key)), Date.now());
  link(db, voterKey, Number(info.lastInsertRowid));
  return { key, profile: { id: Number(info.lastInsertRowid), name: name.trim() } };
}

/** Use name + key on this device. */
export function restoreName(db, voterKey, name, key) {
  const row = db.prepare('SELECT id, name, key_hash FROM profiles WHERE name_norm = ?').get(normName(name));
  if (!row || !verifySecret(normKey(key), row.key_hash)) return { error: 'wrong' };
  link(db, voterKey, Number(row.id));
  return { profile: { id: Number(row.id), name: row.name } };
}

export function forgetDevice(db, voterKey) {
  db.prepare('DELETE FROM profile_devices WHERE voter_key = ?').run(voterKey);
}

/** Admin: give a fan a fresh key (old one stops working). */
export function resetKey(db, profileId) {
  const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(profileId);
  if (!row) return null;
  const key = newKey();
  db.prepare('UPDATE profiles SET key_hash = ? WHERE id = ?').run(hashSecret(normKey(key)), profileId);
  return { key, name: row.name };
}

export function listProfiles(db) {
  return db
    .prepare(
      `SELECT p.id, p.name, p.created_at AS createdAt, (SELECT COUNT(*) FROM profile_devices d WHERE d.profile_id = p.id) AS devices
       FROM profiles p ORDER BY p.created_at DESC LIMIT 500`,
    )
    .all()
    .map((r) => ({ id: Number(r.id), name: r.name, createdAt: Number(r.createdAt), devices: Number(r.devices) }));
}

/* ---------------- sponsor settings ---------------- */

export function sponsorConfig(db) {
  return {
    wechat: getSetting(db, 'sponsor_wechat', ''),
    alipay: getSetting(db, 'sponsor_alipay', ''),
    note: getSetting(db, 'sponsor_note', ''),
  };
}
export function setSponsorConfig(db, patch) {
  for (const k of ['wechat', 'alipay', 'note']) if (patch[k] !== undefined) setSetting(db, `sponsor_${k}`, patch[k]);
}

/* ---------------- sponsorships ---------------- */

export const METHODS = ['wechat', 'alipay'];

export function addSponsorship(db, voterKey, { anonymous, method, amountCents, note, message }) {
  const me = getMe(db, voterKey);
  const info = db
    .prepare(
      `INSERT INTO sponsorships (profile_id, voter_key, anonymous, method, amount_cents, note, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(me ? me.id : null, voterKey, anonymous || !me ? 1 : 0, method, amountCents, note, message, Date.now());
  return Number(info.lastInsertRowid);
}

export function mySponsorships(db, voterKey) {
  return db
    .prepare('SELECT id, status, anonymous, created_at AS createdAt FROM sponsorships WHERE voter_key = ? ORDER BY created_at DESC LIMIT 20')
    .all(voterKey)
    .map((r) => ({ id: Number(r.id), status: r.status, anonymous: Boolean(r.anonymous), createdAt: Number(r.createdAt) }));
}

export function listSponsorships(db, status = '') {
  const where = status ? 'WHERE s.status = ?' : '';
  return db
    .prepare(
      `SELECT s.id, s.anonymous, s.method, s.amount_cents AS amountCents, s.note, s.message, s.status,
              s.created_at AS createdAt, p.name
       FROM sponsorships s LEFT JOIN profiles p ON p.id = s.profile_id ${where}
       ORDER BY s.status = 'pending' DESC, s.created_at DESC LIMIT 300`,
    )
    .all(...(status ? [status] : []))
    .map((r) => ({
      id: Number(r.id),
      name: r.name || '',
      anonymous: Boolean(r.anonymous),
      method: r.method,
      amountCents: Number(r.amountCents),
      note: r.note,
      message: r.message,
      status: r.status,
      createdAt: Number(r.createdAt),
    }));
}

/** Deletes a fan name: its devices are unlinked, its sponsorships stay but become nameless. */
export function deleteProfile(db, profileId) {
  const row = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(profileId);
  if (!row) return null;
  db.prepare('DELETE FROM profile_devices WHERE profile_id = ?').run(profileId);
  db.prepare('UPDATE sponsorships SET profile_id = NULL WHERE profile_id = ?').run(profileId);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
  return { name: row.name };
}

export function deleteSponsorship(db, id) {
  return db.prepare('DELETE FROM sponsorships WHERE id = ?').run(id).changes > 0;
}

export function reviewSponsorship(db, id, status) {
  const r = db.prepare('UPDATE sponsorships SET status = ?, reviewed_at = ? WHERE id = ?').run(status, Date.now(), id);
  return r.changes > 0;
}

/* ---------------- boards ---------------- */

/** 赞助榜: confirmed only, ranked by total — amounts never leave the server. Admin edits (in yuan) adjust, hide or add names. */
export function sponsorBoardRaw(db) {
  return db
    .prepare(
      `SELECT CASE WHEN s.anonymous = 1 OR s.profile_id IS NULL THEN 'a:' || s.id ELSE 'p:' || s.profile_id END AS who,
              MAX(CASE WHEN s.anonymous = 1 OR s.profile_id IS NULL THEN '' ELSE p.name END) AS name,
              SUM(s.amount_cents) AS total, COUNT(*) AS times, MIN(s.reviewed_at) AS first
       FROM sponsorships s LEFT JOIN profiles p ON p.id = s.profile_id
       WHERE s.status = 'confirmed'
       GROUP BY who ORDER BY total DESC, first ASC`,
    )
    .all()
    .map((r) => ({ name: r.name || '', total: Number(r.total), times: Number(r.times), first: Number(r.first) || 0 }));
}

export function sponsorBoard(db, limit = 50) {
  const rows = applyEdits(db, 'sponsors', sponsorBoardRaw(db), 'total', 100);
  return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, name: r.name, anonymous: !r.name, times: r.times || 1 }));
}

export function boardEdits(db, board) {
  return db.prepare('SELECT name, adjust, hidden FROM board_edits WHERE board = ?').all(board)
    .map((e) => ({ name: e.name, adjust: Number(e.adjust), hidden: Boolean(e.hidden) }));
}

/** Merge admin edits into a board: adjust (× unit) by name, hide names, add names that have no real entry. */
function applyEdits(db, board, rows, key, unit = 1) {
  const edits = new Map(boardEdits(db, board).map((e) => [e.name, e]));
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    const e = r.name ? edits.get(r.name) : null;
    if (r.name) seen.add(r.name);
    if (e?.hidden) continue;
    out.push({ ...r, [key]: r[key] + (e ? e.adjust * unit : 0) });
  }
  for (const e of edits.values()) {
    if (!seen.has(e.name) && !e.hidden && e.adjust > 0) out.push({ name: e.name, [key]: e.adjust * unit, times: 1, first: 0 });
  }
  return out.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || (a.first || 0) - (b.first || 0) || a.name.localeCompare(b.name));
}

export function setBoardEdit(db, board, name, { adjust = 0, hidden = false }) {
  if (!adjust && !hidden) {
    db.prepare('DELETE FROM board_edits WHERE board = ? AND name = ?').run(board, name);
    return;
  }
  db.prepare(
    `INSERT INTO board_edits (board, name, adjust, hidden, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(board, name) DO UPDATE SET adjust = excluded.adjust, hidden = excluded.hidden, updated_at = excluded.updated_at`,
  ).run(board, name, adjust, hidden ? 1 : 0, Date.now());
}

/**
 * Removes a name from a board for good. 星光榜: the name itself goes (fan name + nickname); votes stay, so
 * vote counts don't change. 赞助榜: that name's sponsorship records are deleted. Admin edits go too.
 */
export function deleteBoardName(db, board, name) {
  db.prepare('DELETE FROM board_edits WHERE board = ? AND name = ?').run(board, name);
  const profile = db.prepare('SELECT id FROM profiles WHERE name = ?').get(name);
  if (board === 'sponsors') {
    if (profile) db.prepare('DELETE FROM sponsorships WHERE profile_id = ?').run(profile.id);
    return;
  }
  if (profile) {
    db.prepare("DELETE FROM supporters WHERE voter_key IN (SELECT voter_key FROM profile_devices WHERE profile_id = ?)").run(profile.id);
    deleteProfile(db, profile.id);
  }
  db.prepare('DELETE FROM supporters WHERE nickname = ?').run(name);
}

/** 星光榜: activity points with public numbers; a named fan's devices count together. */
export function starBoardRaw(db) {
  return db
    .prepare(
      `WITH pts AS (
         SELECT v.voter_key,
           (SELECT COUNT(*) FROM idea_votes x WHERE x.voter_key = v.voter_key)
           + 3 * (SELECT COUNT(*) FROM poll_votes x WHERE x.voter_key = v.voter_key)
           + (SELECT COUNT(*) FROM bracket_votes x WHERE x.voter_key = v.voter_key)
           + (SELECT COUNT(*) FROM video_likes x WHERE x.voter_key = v.voter_key) AS points
         FROM (SELECT voter_key FROM supporters UNION SELECT voter_key FROM profile_devices) v
       )
       SELECT COALESCE(p.name, s.nickname) AS name, SUM(pts.points) AS points
       FROM pts
       LEFT JOIN profile_devices d ON d.voter_key = pts.voter_key
       LEFT JOIN profiles p ON p.id = d.profile_id
       LEFT JOIN supporters s ON s.voter_key = pts.voter_key
       WHERE COALESCE(p.name, s.nickname) IS NOT NULL
       GROUP BY COALESCE('p' || p.id, 's' || pts.voter_key)
       HAVING SUM(pts.points) > 0
       ORDER BY points DESC, name`,
    )
    .all()
    .map((r) => ({ name: r.name, points: Number(r.points) }));
}

export function starBoard(db, limit = 50) {
  return applyEdits(db, 'stars', starBoardRaw(db), 'points')
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, name: r.name, points: r.points }));
}
