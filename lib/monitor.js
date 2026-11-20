/*
 * monitor.js — private security monitoring (安全监控).
 *
 * What it records, per visitor ("subject" = the anonymous wy_vid cookie, or the IP when there is no cookie):
 *   - the IP address, encrypted with AES-256-GCM. The key lives in DATA_DIR/monitor.key, never in the
 *     database, so a copied database or backup alone does not reveal IPs. A keyed hash of the IP is kept
 *     next to it so the dashboard can filter by IP and notice IP changes without decrypting.
 *   - first / last seen, number of visits (a new visit starts after 30 idle minutes), browser + OS label.
 *   - a timeline of events: pages opened, actions taken (vote, wish, comment…, by route only, never the
 *     content), downloads, admin sign-in success / failure, sign-out, and informational security flags.
 * Never recorded: request bodies, form contents, passwords, codes, payment details.
 * Everything older than RETENTION_DAYS is deleted automatically.
 *
 * Who can read it: only a signed-in admin who has also unlocked the monitor with the separate 监控口令
 * (stored as a scrypt hash). Everyone else gets 404, as if it did not exist.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getSetting, setSetting } from './db.js';
import { deviceLabel } from './admin-security.js';
import { hashSecret, hmacHex, randomHex, sha256, verifySecret } from './security.js';

export const RETENTION_DAYS = 90;
const VISIT_GAP = 30 * 60_000;
const BURST_PER_MIN = 120;
export const MONITOR_TTL = 30 * 60_000;
const BOT_UA = /bot|crawl|spider|slurp|curl|wget|python|httpclient|monitor|uptime|headless|preview|facebookexternalhit/i;
const PROBE = /\.(php|asp|aspx|jsp|cgi|env|git|sql|bak|ini)(\/|$)|wp-|phpmyadmin|\/\.git|\/\.env|cgi-bin|\/vendor\/|\/actuator|\/server-status/i;

export const PAGE_NAMES = { '/': '首页', '/ideas': '许愿池', '/polls': '投票', '/leaderboard': '排行榜', '/downloads': '下载', '/sponsor': '赞助', '/rules': '规则', '/privacy': '隐私政策' };

export function migrateMonitor(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitor_subjects (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      subject      TEXT    NOT NULL UNIQUE,
      first_seen   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      visits       INTEGER NOT NULL DEFAULT 1,
      events       INTEGER NOT NULL DEFAULT 0,
      flags        INTEGER NOT NULL DEFAULT 0,
      ip_hash      TEXT    NOT NULL DEFAULT '',
      ip_enc       TEXT    NOT NULL DEFAULT '',
      ip_count     INTEGER NOT NULL DEFAULT 1,
      ua_label     TEXT    NOT NULL DEFAULT '',
      ua_raw       TEXT    NOT NULL DEFAULT '',
      voter_key    TEXT    NOT NULL DEFAULT '',
      is_admin     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_monsub_last ON monitor_subjects(last_seen DESC);
    CREATE INDEX IF NOT EXISTS idx_monsub_ip ON monitor_subjects(ip_hash);
    CREATE TABLE IF NOT EXISTS monitor_ips (
      subject_id INTEGER NOT NULL REFERENCES monitor_subjects(id) ON DELETE CASCADE,
      ip_hash    TEXT    NOT NULL,
      first_seen INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      PRIMARY KEY (subject_id, ip_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_monips_ip ON monitor_ips(ip_hash);
    CREATE TABLE IF NOT EXISTS monitor_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL REFERENCES monitor_subjects(id) ON DELETE CASCADE,
      at         INTEGER NOT NULL,
      kind       TEXT    NOT NULL,
      label      TEXT    NOT NULL,
      status     INTEGER NOT NULL DEFAULT 0,
      ip_hash    TEXT    NOT NULL DEFAULT '',
      ip_enc     TEXT    NOT NULL DEFAULT '',
      flag       TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_monev_subject ON monitor_events(subject_id, at DESC);
    CREATE INDEX IF NOT EXISTS idx_monev_at ON monitor_events(at);
    CREATE TABLE IF NOT EXISTS monitor_sessions (
      token_hash       TEXT PRIMARY KEY,
      admin_token_hash TEXT NOT NULL,
      expires_at       INTEGER NOT NULL
    );
  `);
  // Private nickname the admin gives a visitor (e.g. 「刷票号A」). Never shown to anyone else.
  const cols = db.prepare('PRAGMA table_info(monitor_subjects)').all().map((c) => c.name);
  if (!cols.includes('admin_note')) db.exec("ALTER TABLE monitor_subjects ADD COLUMN admin_note TEXT NOT NULL DEFAULT ''");
}

export function setSubjectNote(db, id, note) {
  return db.prepare('UPDATE monitor_subjects SET admin_note = ? WHERE id = ?').run(String(note || '').trim().slice(0, 40), id).changes > 0;
}

/* ---------------- encryption ---------------- */

export function loadMonitorKey(dataDir) {
  const file = path.join(dataDir, 'monitor.key');
  try {
    const key = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
    if (key.length === 32) return key;
  } catch {
    /* create below */
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
  return key;
}

export function encryptIp(key, ip) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(ip), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function decryptIp(key, blob) {
  if (!blob) return '';
  try {
    const b = Buffer.from(blob, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '（无法解密）';
  }
}

export const ipHashOf = (secret, ip) => hmacHex(secret, `monitor-ip:${ip}`).slice(0, 20);

/** Staging: replace a real IP with a stable fake one from the reserved 198.18.0.0/15 test range. */
export function syntheticIp(secret, ip) {
  const h = hmacHex(secret, `synthetic:${ip}`);
  return `198.18.${parseInt(h.slice(0, 2), 16)}.${parseInt(h.slice(2, 4), 16)}`;
}

/* ---------------- what to record ---------------- */

const ACTIONS = [
  [/^\/api\/ideas$/, 'POST', '提交许愿'],
  [/^\/api\/ideas\/(\d+)\/vote$/, 'POST', '给卡片 #$1 投票'],
  [/^\/api\/ideas\/(\d+)\/vote$/, 'DELETE', '取消卡片 #$1 的投票'],
  [/^\/api\/ideas\/(\d+)\/comments$/, 'POST', '在卡片 #$1 下评论'],
  [/^\/api\/polls\/(\d+)\/vote$/, 'POST', '参与投票 #$1'],
  [/^\/api\/bracket\/matches\/(\d+)\/vote$/, 'POST', '对战投票 #$1'],
  [/^\/api\/videos\/(\d+)\/like$/, 'POST', '点赞视频 #$1'],
  [/^\/api\/videos\/(\d+)\/like$/, 'DELETE', '取消点赞视频 #$1'],
  [/^\/api\/fan\/verify$/, 'POST', '粉丝验证'],
  [/^\/api\/me\/claim$/, 'POST', '创建 / 认领昵称'],
  [/^\/api\/me\/restore$/, 'POST', '在新设备恢复昵称'],
  [/^\/api\/me\/forget$/, 'POST', '在本设备退出昵称'],
  [/^\/api\/me\/nickname$/, 'POST', '修改昵称'],
  [/^\/api\/sponsor$/, 'POST', '提交赞助'],
];

function actionLabel(method, pathname) {
  for (const [re, m, label] of ACTIONS) {
    const hit = m === method && pathname.match(re);
    if (hit) return label.replace('$1', hit[1] || '');
  }
  return `${method} ${pathname.replace(/\d+/g, ':id')}`;
}

/**
 * Decides whether a finished request is worth a timeline entry.
 * Returns { kind, label, flag } or null. Never looks at request bodies.
 */
export function classify({ method, pathname, status, ua, isApi }) {
  const bot = !ua || BOT_UA.test(ua);
  if (pathname.startsWith('/api/monitor')) return null; // the monitor does not log itself here (audit_log does)
  if (status === 429) return { kind: 'security', label: `请求过于频繁被限流：${method} ${pathname.replace(/\d+/g, ':id')}`, flag: 'rate_limited' };
  if (!isApi) {
    if (status === 404 && PROBE.test(pathname)) return { kind: 'security', label: `探测可疑路径：${pathname.slice(0, 120)}`, flag: 'probe' };
    if (method === 'GET' && status === 200 && PAGE_NAMES[pathname] && !bot) return { kind: 'page', label: `打开「${PAGE_NAMES[pathname]}」`, flag: '' };
    if (pathname === '/admin' && method === 'GET' && status === 200) return { kind: 'admin', label: '打开后台页面', flag: '' };
    return null;
  }
  if (pathname === '/api/admin/login' && method === 'POST') {
    if (status === 200) return { kind: 'login', label: '站长登录成功', flag: '' };
    return { kind: 'security', label: '站长登录失败', flag: 'login_failed' };
  }
  if (pathname === '/api/admin/logout' && method === 'POST') return { kind: 'login', label: '站长退出登录', flag: '' };
  if (pathname.startsWith('/api/admin/') && (status === 401 || status === 403) && pathname !== '/api/admin/me') {
    return { kind: 'security', label: `未授权访问后台接口：${method} ${pathname.replace(/\d+/g, ':id').slice(0, 80)}`, flag: 'denied' };
  }
  const dl = pathname.match(/^\/api\/mods\/(\d+)\/download$/);
  if (dl && method === 'GET') return { kind: 'download', label: status === 200 ? `下载模组文件 #${dl[1]}` : `下载失败 #${dl[1]}（${status}）`, flag: '' };
  if (method === 'GET' || method === 'HEAD') return null;
  if (pathname.startsWith('/api/admin/')) return null; // admin changes are already in the audit log
  const label = actionLabel(method, pathname);
  return { kind: 'action', label: status >= 400 ? `${label}（失败 ${status}）` : label, flag: '' };
}

/* ---------------- recorder ---------------- */

export function createMonitor(db, { secret, key, synthetic = false }) {
  const bursts = new Map(); // subject -> { minute, n, flaggedAt }
  let lastPrune = 0;

  function prune(now) {
    if (now - lastPrune < 3600_000) return;
    lastPrune = now;
    const cutoff = now - RETENTION_DAYS * 86400_000;
    db.prepare('DELETE FROM monitor_events WHERE at < ?').run(cutoff);
    db.prepare('DELETE FROM monitor_ips WHERE last_seen < ?').run(cutoff);
    db.prepare('DELETE FROM monitor_subjects WHERE last_seen < ?').run(cutoff);
    db.prepare('DELETE FROM monitor_sessions WHERE expires_at < ?').run(now);
  }

  /** Counts a request for burst detection. Returns true the first time a subject goes over the limit (then at most every 10 min). */
  function burst(subject, now) {
    const minute = Math.floor(now / 60_000);
    let b = bursts.get(subject);
    if (!b || b.minute !== minute) {
      if (bursts.size > 20000) bursts.clear();
      b = { minute, n: 0, flaggedAt: b ? b.flaggedAt : 0 };
      bursts.set(subject, b);
    }
    b.n += 1;
    if (b.n > BURST_PER_MIN && now - b.flaggedAt > 10 * 60_000) {
      b.flaggedAt = now;
      return true;
    }
    return false;
  }

  function subjectRow(subject, now, ipHash, ipEnc, ua, voterKey, isAdmin) {
    let row = db.prepare('SELECT id, last_seen, ip_hash FROM monitor_subjects WHERE subject = ?').get(subject);
    const label = ua ? deviceLabel(ua) : '未知';
    if (!row) {
      const r = db
        .prepare('INSERT INTO monitor_subjects (subject, first_seen, last_seen, ip_hash, ip_enc, ua_label, ua_raw, voter_key, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(subject, now, now, ipHash, ipEnc, label, String(ua || '').slice(0, 300), voterKey || '', isAdmin ? 1 : 0);
      db.prepare('INSERT OR IGNORE INTO monitor_ips (subject_id, ip_hash, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(r.lastInsertRowid, ipHash, now, now);
      return { id: Number(r.lastInsertRowid), ipChanged: false, isNew: true };
    }
    const newVisit = now - Number(row.last_seen) > VISIT_GAP;
    const ipChanged = row.ip_hash !== ipHash;
    db.prepare(
      `UPDATE monitor_subjects SET last_seen = ?, visits = visits + ?, ip_hash = ?, ip_enc = ?, ua_label = ?, ua_raw = ?,
         voter_key = CASE WHEN ? <> '' THEN ? ELSE voter_key END, is_admin = MAX(is_admin, ?) WHERE id = ?`,
    ).run(now, newVisit ? 1 : 0, ipHash, ipEnc, label, String(ua || '').slice(0, 300), voterKey || '', voterKey || '', isAdmin ? 1 : 0, row.id);
    if (ipChanged) {
      db.prepare(
        'INSERT INTO monitor_ips (subject_id, ip_hash, first_seen, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT(subject_id, ip_hash) DO UPDATE SET last_seen = excluded.last_seen',
      ).run(row.id, ipHash, now, now);
      db.prepare('UPDATE monitor_subjects SET ip_count = (SELECT COUNT(*) FROM monitor_ips WHERE subject_id = ?) WHERE id = ?').run(row.id, row.id);
    } else {
      db.prepare('UPDATE monitor_ips SET last_seen = ? WHERE subject_id = ? AND ip_hash = ?').run(now, row.id, ipHash);
    }
    return { id: Number(row.id), ipChanged, newVisit };
  }

  function addEvent(id, now, kind, label, status, ipHash, ipEnc, flag) {
    db.prepare('INSERT INTO monitor_events (subject_id, at, kind, label, status, ip_hash, ip_enc, flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, now, kind, label, status, ipHash, ipEnc, flag);
    db.prepare('UPDATE monitor_subjects SET events = events + 1, flags = flags + ? WHERE id = ?').run(flag ? 1 : 0, id);
  }

  /** Called once per finished request. Must never throw. */
  function record({ vid, ip, ua, method, pathname, status, isApi, voterKey = '', isAdmin = false }) {
    try {
      const now = Date.now();
      prune(now);
      const event = classify({ method, pathname, status, ua, isApi });
      const realIp = synthetic ? syntheticIp(secret, ip) : String(ip || '').slice(0, 64);
      const ipHash = ipHashOf(secret, realIp);
      const subject = vid ? `v:${sha256(`${secret}:monitor-vid:${vid}`).slice(0, 24)}` : `ip:${ipHash}`;
      const isBurst = (isApi || event) && burst(subject, now);
      if (!event && !isBurst) return;
      const ipEnc = encryptIp(key, realIp);
      const admin = typeof isAdmin === 'function' ? isAdmin() : isAdmin;
      const s = subjectRow(subject, now, ipHash, ipEnc, ua, voterKey, admin);
      if (s.ipChanged) addEvent(s.id, now, 'security', 'IP 地址变化', 0, ipHash, ipEnc, 'ip_change');
      if (isBurst) addEvent(s.id, now, 'security', `一分钟内请求超过 ${BURST_PER_MIN} 次`, 0, ipHash, ipEnc, 'burst');
      if (event) addEvent(s.id, now, event.kind, event.label, status, ipHash, ipEnc, event.flag);
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') console.error('[monitor]', error);
    }
  }

  return { record, key };
}

/* ---------------- 监控口令 + monitor session ---------------- */

export function monitorConfigured(db) {
  return Boolean(getSetting(db, 'monitor_code_hash'));
}

export function setMonitorCode(db, code) {
  const s = String(code || '');
  if (s.length < 10 || s.length > 128) throw new Error('监控口令至少 10 位');
  setSetting(db, 'monitor_code_hash', hashSecret(s));
  db.prepare('DELETE FROM monitor_sessions').run();
}

export function verifyMonitorCode(db, code) {
  const hash = getSetting(db, 'monitor_code_hash');
  return Boolean(hash) && verifySecret(String(code || ''), hash);
}

export function createMonitorSession(db, adminToken) {
  const token = randomHex(32);
  db.prepare('INSERT INTO monitor_sessions (token_hash, admin_token_hash, expires_at) VALUES (?, ?, ?)').run(sha256(token), sha256(adminToken), Date.now() + MONITOR_TTL);
  return token;
}

/** Valid only together with the same admin session it was opened from. */
export function checkMonitorSession(db, token, adminToken) {
  if (!token || !adminToken) return false;
  const row = db.prepare('SELECT admin_token_hash, expires_at FROM monitor_sessions WHERE token_hash = ?').get(sha256(token));
  return Boolean(row) && Number(row.expires_at) > Date.now() && row.admin_token_hash === sha256(adminToken);
}

export function revokeMonitorSession(db, token) {
  if (token) db.prepare('DELETE FROM monitor_sessions WHERE token_hash = ?').run(sha256(token));
}

/* ---------------- queries for the dashboard ---------------- */

function nameFor(db, voterKey) {
  if (!voterKey) return '';
  try {
    const p = db.prepare('SELECT p.name FROM profile_devices d JOIN profiles p ON p.id = d.profile_id WHERE d.voter_key = ?').get(voterKey);
    if (p) return p.name;
    const f = db.prepare('SELECT nickname FROM fans WHERE voter_key = ?').get(voterKey);
    return f ? f.nickname : '';
  } catch {
    return '';
  }
}

export function listSubjects(db, key, secret, { q = '', ip = '', from = 0, to = 0, flagged = false, page = 1, pageSize = 30 } = {}) {
  const where = [];
  const args = [];
  if (ip) {
    where.push('s.id IN (SELECT subject_id FROM monitor_ips WHERE ip_hash = ?)');
    args.push(ipHashOf(secret, ip.trim()));
  }
  if (q) {
    const id = Number(String(q).replace(/^#/, ''));
    const keys = db
      .prepare("SELECT d.voter_key AS k FROM profile_devices d JOIN profiles p ON p.id = d.profile_id WHERE p.name LIKE ? UNION SELECT voter_key FROM fans WHERE nickname LIKE ?")
      .all(`%${q}%`, `%${q}%`)
      .map((r) => r.k);
    const parts = ['s.admin_note LIKE ?'];
    args.push(`%${q}%`);
    if (Number.isInteger(id) && id > 0) {
      parts.push('s.id = ?');
      args.push(id);
    }
    if (keys.length) {
      parts.push(`s.voter_key IN (${keys.map(() => '?').join(',')})`);
      args.push(...keys);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (from) {
    where.push('s.last_seen >= ?');
    args.push(from);
  }
  if (to) {
    where.push('s.first_seen <= ?');
    args.push(to);
  }
  if (flagged) where.push('s.flags > 0');
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM monitor_subjects s ${sql}`).get(...args).n);
  const rows = db
    .prepare(`SELECT s.* FROM monitor_subjects s ${sql} ORDER BY s.last_seen DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize);
  return {
    total,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: Number(r.id),
      anonymous: r.subject.startsWith('ip:'),
      name: nameFor(db, r.voter_key),
      note: r.admin_note || '',
      isAdmin: Boolean(r.is_admin),
      ip: decryptIp(key, r.ip_enc),
      ipCount: Number(r.ip_count),
      firstSeen: Number(r.first_seen),
      lastSeen: Number(r.last_seen),
      visits: Number(r.visits),
      events: Number(r.events),
      flags: Number(r.flags),
      device: r.ua_label,
    })),
  };
}

export function subjectEvents(db, key, id, { limit = 300 } = {}) {
  const s = db.prepare('SELECT id, ua_raw FROM monitor_subjects WHERE id = ?').get(id);
  if (!s) return null;
  const ips = db.prepare('SELECT ip_hash, first_seen, last_seen FROM monitor_ips WHERE subject_id = ? ORDER BY first_seen').all(id);
  const encFor = new Map(db.prepare('SELECT ip_hash, ip_enc FROM monitor_events WHERE subject_id = ? GROUP BY ip_hash').all(id).map((r) => [r.ip_hash, r.ip_enc]));
  const labels = new Map(ips.map((r, i) => [r.ip_hash, `IP ${i + 1}`]));
  const events = db.prepare('SELECT at, kind, label, status, ip_hash, flag FROM monitor_events WHERE subject_id = ? ORDER BY at DESC, id DESC LIMIT ?').all(id, limit);
  return {
    userAgent: s.ua_raw,
    ips: ips.map((r) => ({ tag: labels.get(r.ip_hash), ip: decryptIp(key, encFor.get(r.ip_hash) || ''), firstSeen: Number(r.first_seen), lastSeen: Number(r.last_seen) })),
    events: events.map((e) => ({ at: Number(e.at), kind: e.kind, label: e.label, status: Number(e.status), ipTag: labels.get(e.ip_hash) || '', flag: e.flag })),
  };
}

export function monitorSummary(db) {
  const since = Date.now() - 86400_000;
  const flag = (f) => Number(db.prepare('SELECT COUNT(*) AS n FROM monitor_events WHERE flag = ? AND at >= ?').get(f, since).n);
  return {
    subjects24h: Number(db.prepare('SELECT COUNT(*) AS n FROM monitor_subjects WHERE last_seen >= ?').get(since).n),
    subjectsTotal: Number(db.prepare('SELECT COUNT(*) AS n FROM monitor_subjects').get().n),
    loginFailed: flag('login_failed'),
    denied: flag('denied'),
    rateLimited: flag('rate_limited'),
    bursts: flag('burst'),
    probes: flag('probe'),
    ipChanges: flag('ip_change'),
    retentionDays: RETENTION_DAYS,
  };
}

export function deleteSubject(db, id) {
  db.prepare('DELETE FROM monitor_events WHERE subject_id = ?').run(id);
  db.prepare('DELETE FROM monitor_ips WHERE subject_id = ?').run(id);
  return db.prepare('DELETE FROM monitor_subjects WHERE id = ?').run(id).changes > 0;
}
