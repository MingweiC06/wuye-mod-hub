/**
 * guard.js — 后台登录防爆破 + 投票防刷.
 *
 * Login: failed attempts are stored in the database, so a restart or deploy does not reset them.
 *   - one network (IP) gets 5 wrong tries per hour, then waits an hour;
 *   - if 20 wrong tries pile up across the whole site within an hour (someone rotating IPs),
 *     only devices that have signed in before may try at all until it calms down.
 *
 * Votes: on top of "one vote per device and per IP per card":
 *   - at most NET_CAP votes per card from the same network block (/24 IPv4, /48 IPv6) per day,
 *     so rotating through one provider's addresses does not help;
 *   - votes from data-centre / cloud / proxy networks are refused (real fans vote from home or mobile).
 */
import { sha256 } from './security.js';
import { HttpError } from './security.js';

export const LOGIN_IP_MAX = 5;
export const LOGIN_GLOBAL_MAX = 20;
const HOUR = 3600_000;
export const NET_CAP = 5;

export function migrateGuard(db) {
  migrateVoteClaims(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_login_fails (
      at       INTEGER NOT NULL,
      ip_hash  TEXT    NOT NULL,
      device   TEXT    NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_login_fails_at ON admin_login_fails(at);
  `);
  const cols = db.prepare('PRAGMA table_info(idea_votes)').all().map((c) => c.name);
  if (cols.length && !cols.includes('net_hash')) db.exec("ALTER TABLE idea_votes ADD COLUMN net_hash TEXT NOT NULL DEFAULT ''");
}

/* ---------------- network block ---------------- */

function expandV6(ip) {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...fill, ...t].map((x) => x.toLowerCase().padStart(4, '0'));
}

/** The /24 (IPv4) or /48 (IPv6) block an address belongs to. */
export function netBlock(ip) {
  let s = String(ip || '').trim();
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) s = mapped[1];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return s.split('.').slice(0, 3).join('.') + '.0/24';
  if (s.includes(':')) return expandV6(s).slice(0, 3).join(':') + '::/48';
  return s;
}

export const netHash = (secret, ip) => sha256(`${secret}:net:${netBlock(ip)}`).slice(0, 16);

/* ---------------- login ---------------- */

/** '' = may try; otherwise an HttpError to throw. */
export function loginBlocked(db, ipHash, deviceKey, now = Date.now()) {
  db.prepare('DELETE FROM admin_login_fails WHERE at < ?').run(now - 24 * HOUR);
  const since = now - HOUR;
  const mine = db.prepare('SELECT COUNT(*) AS n, MIN(at) AS first FROM admin_login_fails WHERE ip_hash = ? AND at > ?').get(ipHash, since);
  if (Number(mine.n) >= LOGIN_IP_MAX) {
    const mins = Math.max(1, Math.ceil((Number(mine.first) + HOUR - now) / 60_000));
    return new HttpError(429, 'login_locked', `输错太多次，这个网络已被锁定，${mins} 分钟后再试`);
  }
  const all = Number(db.prepare('SELECT COUNT(*) AS n FROM admin_login_fails WHERE at > ?').get(since).n);
  if (all >= LOGIN_GLOBAL_MAX) {
    const known = deviceKey && db.prepare('SELECT 1 FROM admin_devices WHERE device_key = ?').get(deviceKey);
    if (!known) return new HttpError(429, 'login_shielded', '后台正在防护模式：最近有人反复尝试登录，暂时只允许以前登录过的设备登录');
  }
  return null;
}

export function recordLoginFail(db, ipHash, deviceKey, now = Date.now()) {
  db.prepare('INSERT INTO admin_login_fails (at, ip_hash, device) VALUES (?, ?, ?)').run(now, ipHash, deviceKey || '');
}

export function clearLoginFails(db, ipHash) {
  db.prepare('DELETE FROM admin_login_fails WHERE ip_hash = ?').run(ipHash);
}

export function loginShieldStatus(db, now = Date.now()) {
  const n = Number(db.prepare('SELECT COUNT(*) AS n FROM admin_login_fails WHERE at > ?').get(now - HOUR).n);
  return { failsLastHour: n, shielded: n >= LOGIN_GLOBAL_MAX };
}

/* ---------------- votes ---------------- */

// Cloud / hosting / proxy networks (matched on the ASN owner name from the local DB-IP file).
const HOSTING = new RegExp(
  [
    'amazon', 'aws', 'google cloud', 'google llc', 'microsoft', 'azure', 'oracle', 'digitalocean', 'linode', 'akamai', 'vultr', 'choopa',
    'hetzner', 'ovh', 'alibaba', 'aliyun', 'tencent cloud', 'tencent computer', 'huawei cloud', 'huawei clouds', 'contabo', 'leaseweb',
    'm247', 'datacamp', 'cdn77', 'scaleway', 'hostinger', 'cloudflare', 'g-core', 'gcore', 'psychz', 'quadranet', 'hostwinds', 'ionos',
    'colocrossing', 'frantech', 'buyvm', 'zenlayer', 'ucloud', 'kingsoft cloud', 'baidu netcom', 'hostroyale', 'hosting', 'data ?center',
    'datacentre', 'server', 'vps', 'cogent', 'ipxo', 'packethub', 'tzulo', 'clouvider', 'servers', 'host europe', 'netcup', 'kamatera',
    'upcloud', 'fastly', 'stark industries', 'aeza', 'pq hosting', 'bl networks', 'tiktok', 'bytedance', 'proton', 'nordvpn', 'expressvpn',
    'mullvad', 'private internet access', 'surfshark', 'ipvanish', 'hide.me', 'windscribe',
  ].join('|'),
  'i',
);

export const isHostingOrg = (org) => Boolean(org) && HOSTING.test(String(org));

/** Throws when this request should not be allowed to vote. */
export function voteGuard(ctx) {
  const geo = ctx.geo;
  if (!geo) return;
  let g = null;
  try {
    g = geo.cached(ctx.db, ctx.ipHash, ctx.ip);
  } catch {
    return;
  }
  if (g && isHostingOrg(g.org)) {
    throw new HttpError(403, 'proxy_vote', '检测到你在用机房/代理/VPN 网络，为防刷票这种网络不能投票。关掉代理或换手机流量再试试～');
  }
}

/** How many votes this card already got from this network block in the last day. */
export function netVotes(db, ideaId, nh, now = Date.now()) {
  if (!nh) return 0;
  return Number(db.prepare('SELECT COUNT(*) AS n FROM idea_votes WHERE idea_id = ? AND net_hash = ? AND created_at > ?').get(ideaId, nh, now - 24 * HOUR).n);
}

/* ---------------- one vote per network for polls / 对决 ---------------- */

export function migrateVoteClaims(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vote_ip_claims (
      kind      TEXT    NOT NULL,
      target_id INTEGER NOT NULL,
      ip_hash   TEXT    NOT NULL,
      voter_key TEXT    NOT NULL,
      at        INTEGER NOT NULL,
      PRIMARY KEY (kind, target_id, ip_hash)
    );
  `);
}

/** Claims (kind, id) for this IP. Returns false when another device on the same IP already voted. */
export function claimIpVote(db, kind, targetId, ipHash, voterKey) {
  if (!ipHash) return true;
  const row = db.prepare('SELECT voter_key FROM vote_ip_claims WHERE kind = ? AND target_id = ? AND ip_hash = ?').get(kind, targetId, ipHash);
  if (row) return row.voter_key === voterKey;
  db.prepare('INSERT OR IGNORE INTO vote_ip_claims (kind, target_id, ip_hash, voter_key, at) VALUES (?, ?, ?, ?, ?)').run(kind, targetId, ipHash, voterKey, Date.now());
  return true;
}
