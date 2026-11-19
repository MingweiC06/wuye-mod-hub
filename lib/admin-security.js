/*
 * Admin sign-in hardening: an optional unlock pattern (3×3 grid, like a phone) on top of the admin code,
 * and device recognition so the dashboard can list which devices are signed in and sign them out.
 *
 * - The pattern is stored only as a salted hash (same scheme as the admin code).
 * - A device is identified by the browser's anonymous device id (x-device-id), hashed with the site
 *   secret. Its label ("Chrome · Windows") comes from the User-Agent at sign-in. No IP is stored.
 */
import { getSetting, setSetting } from './db.js';
import { hashSecret, hmacHex, verifySecret } from './security.js';

export function migrateAdminSecurity(db) {
  const cols = db.prepare('PRAGMA table_info(admin_sessions)').all().map((c) => c.name);
  if (!cols.includes('device_key')) db.exec("ALTER TABLE admin_sessions ADD COLUMN device_key TEXT NOT NULL DEFAULT ''");
  if (!cols.includes('last_seen')) db.exec('ALTER TABLE admin_sessions ADD COLUMN last_seen INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_devices (
      device_key TEXT PRIMARY KEY,
      label      TEXT    NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      logins     INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/* ---------------- pattern ---------------- */

/** "0-4-8-5" style: 4–9 distinct dots out of 0..8. Returns the normalized string or null. */
export function normalizePattern(value) {
  if (Array.isArray(value)) value = value.join('-');
  const s = String(value || '').trim();
  if (!/^[0-8](-[0-8]){3,8}$/.test(s)) return null;
  const dots = s.split('-');
  return new Set(dots).size === dots.length ? s : null;
}

export function patternEnabled(db) {
  return Boolean(getSetting(db, 'admin_pattern_hash'));
}

export function verifyPattern(db, value) {
  const hash = getSetting(db, 'admin_pattern_hash');
  if (!hash) return true;
  const p = normalizePattern(value);
  return Boolean(p) && verifySecret(p, hash);
}

export function setPattern(db, value) {
  if (value === '' || value === null) {
    setSetting(db, 'admin_pattern_hash', '');
    return;
  }
  const p = normalizePattern(value);
  if (!p) throw new Error('bad pattern');
  setSetting(db, 'admin_pattern_hash', hashSecret(p));
}

/* ---------------- devices ---------------- */

export function deviceKeyFor(secret, req, fallback) {
  const raw = String(req.headers['x-device-id'] || '');
  const id = /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : fallback;
  return hmacHex(secret, `admin-device:${id}`).slice(0, 24);
}

/** Short, human label from a User-Agent: "Edge · Windows", "Safari · iPhone"… */
export function deviceLabel(ua) {
  const s = String(ua || '');
  const os = /iPhone/.test(s) ? 'iPhone' : /iPad/.test(s) ? 'iPad' : /Android/.test(s) ? 'Android'
    : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : '未知系统';
  const browser = /MicroMessenger/.test(s) ? '微信' : /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera'
    : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '浏览器';
  return `${browser} · ${os}`;
}

/** Records the sign-in; returns true when this device has never signed in before. */
export function recordDeviceLogin(db, deviceKey, ua) {
  const now = Date.now();
  const known = db.prepare('SELECT 1 FROM admin_devices WHERE device_key = ?').get(deviceKey);
  if (known) {
    db.prepare('UPDATE admin_devices SET label = ?, last_seen = ?, logins = logins + 1 WHERE device_key = ?').run(deviceLabel(ua), now, deviceKey);
  } else {
    db.prepare('INSERT INTO admin_devices (device_key, label, first_seen, last_seen, logins) VALUES (?, ?, ?, ?, 1)').run(deviceKey, deviceLabel(ua), now, now);
  }
  return !known;
}

export function attachSessionDevice(db, tokenHash, deviceKey) {
  db.prepare('UPDATE admin_sessions SET device_key = ?, last_seen = ? WHERE token_hash = ?').run(deviceKey, Date.now(), tokenHash);
}

/** Marks activity at most once a minute per session, and on the device. */
export function touchSession(db, tokenHash) {
  const now = Date.now();
  const row = db.prepare('SELECT device_key, last_seen FROM admin_sessions WHERE token_hash = ?').get(tokenHash);
  if (!row || now - Number(row.last_seen) < 60_000) return;
  db.prepare('UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?').run(now, tokenHash);
  if (row.device_key) db.prepare('UPDATE admin_devices SET last_seen = ? WHERE device_key = ?').run(now, row.device_key);
}

export function listDevices(db, currentKey) {
  const now = Date.now();
  const active = new Map(
    db.prepare('SELECT device_key, COUNT(*) AS n, MAX(expires_at) AS until FROM admin_sessions WHERE expires_at > ? GROUP BY device_key').all(now)
      .map((r) => [r.device_key, { n: Number(r.n), until: Number(r.until) }]),
  );
  const rows = db.prepare('SELECT device_key, label, first_seen, last_seen, logins FROM admin_devices ORDER BY last_seen DESC').all();
  const list = rows.map((r) => ({
    id: r.device_key,
    label: r.label,
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
    logins: Number(r.logins),
    signedIn: active.has(r.device_key),
    sessionUntil: active.get(r.device_key)?.until || null,
    current: r.device_key === currentKey,
  }));
  // Sessions from before device tracking existed.
  const legacy = active.get('');
  if (legacy) list.push({ id: '', label: '旧会话（升级前登录，设备未知）', firstSeen: null, lastSeen: null, logins: 0, signedIn: true, sessionUntil: legacy.until, current: false });
  return list;
}

/** Signs a device out (all its sessions). `forget` also removes it from the known list. */
export function revokeDevice(db, deviceKey, { forget = false } = {}) {
  const n = db.prepare('DELETE FROM admin_sessions WHERE device_key = ?').run(deviceKey).changes;
  if (forget && deviceKey) db.prepare('DELETE FROM admin_devices WHERE device_key = ?').run(deviceKey);
  return Number(n);
}
