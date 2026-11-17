/**
 * security.js — password hashing, cookies, rate limiting, validation.
 *
 * Zero dependencies: only node:crypto / node:buffer.
 */
import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ------------------------------------------------------------------ */
/* hashing                                                             */
/* ------------------------------------------------------------------ */

export function randomHex(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hmacHex(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

/** scrypt hash, self-describing string: scrypt$N$r$p$salt$hash */
export function hashSecret(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${hash.toString('hex')}`;
}

export function verifySecret(plain, stored) {
  try {
    const parts = String(stored).split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, n, r, p, salt, expectedHex] = parts;
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = crypto.scryptSync(String(plain), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Human friendly admin code, e.g. WY-7K4M-9Q2X-P6HD (no 0/O/1/I). */
export function generateAdminCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const pick = () => {
    const bytes = crypto.randomBytes(4);
    let out = '';
    for (let i = 0; i < 4; i += 1) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };
  return `WY-${pick()}-${pick()}-${pick()}`;
}

/* ------------------------------------------------------------------ */
/* cookies                                                             */
/* ------------------------------------------------------------------ */

export function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const pair of String(header).split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) parts.push('Secure');
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join('; ');
}

/* ------------------------------------------------------------------ */
/* rate limiting (in-memory sliding window)                            */
/* ------------------------------------------------------------------ */

export class RateLimiter {
  constructor({ maxKeys = 20000 } = {}) {
    this.buckets = new Map();
    this.maxKeys = maxKeys;
    this.lastSweep = Date.now();
  }

  /** @returns {{ok:boolean, remaining:number, retryAfter:number}} */
  hit(key, limit, windowMs) {
    const now = Date.now();
    this.maybeSweep(now);
    let hits = this.buckets.get(key);
    if (!hits) {
      if (this.buckets.size >= this.maxKeys) this.evictOldest();
      hits = [];
      this.buckets.set(key, hits);
    }
    while (hits.length && hits[0] <= now - windowMs) hits.shift();
    if (hits.length >= limit) {
      return { ok: false, remaining: 0, retryAfter: Math.ceil((hits[0] + windowMs - now) / 1000) };
    }
    hits.push(now);
    return { ok: true, remaining: limit - hits.length, retryAfter: 0 };
  }

  maybeSweep(now) {
    if (now - this.lastSweep < 5 * 60 * 1000) return;
    this.lastSweep = now;
    for (const [key, hits] of this.buckets) {
      if (!hits.length || hits[hits.length - 1] < now - 60 * 60 * 1000) this.buckets.delete(key);
    }
  }

  evictOldest() {
    let first = this.buckets.keys().next();
    for (let i = 0; i < 50 && !first.done; i += 1) {
      this.buckets.delete(first.value);
      first = this.buckets.keys().next();
    }
  }
}

/* ------------------------------------------------------------------ */
/* errors + validation                                                 */
/* ------------------------------------------------------------------ */

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

export const bad = (message, code = 'validation_failed') => new HttpError(400, code, message);
export const conflict = (message, code = 'conflict') => new HttpError(409, code, message);
export const notFound = (message = '内容不存在', code = 'not_found') => new HttpError(404, code, message);
export const unauthorized = (message = '请先登录管理后台', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = '没有权限', code = 'forbidden') => new HttpError(403, code, message);
export const tooMany = (message = '操作太频繁啦，休息一下再来～', code = 'rate_limited') =>
  new HttpError(429, code, message);

export function cleanText(value) {
  return String(value)
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function requireString(value, name, { min = 1, max = 200, trim = true } = {}) {
  if (typeof value !== 'string') throw bad(`${name}格式不正确`);
  let out = cleanText(value);
  if (trim) out = out.trim();
  if (out.length < min) throw bad(`${name}至少 ${min} 个字`);
  if (out.length > max) throw bad(`${name}最多 ${max} 个字`);
  return out;
}

export function optionalString(value, name, options = {}) {
  if (value == null || value === '') return '';
  return requireString(value, name, { min: 0, ...options });
}

export function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw bad(`${name}不在允许范围内`);
  return value;
}

export function toInt(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name}格式不正确`);
  return n;
}

export function toBool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

const BANNED = ['加微信', '加qq', '加QQ', '代练', '博彩', '赌博', '裸聊', '约炮', '卖号', '刷赞', '刷粉'];

export function findBanned(text) {
  const lower = String(text).toLowerCase();
  return BANNED.find((word) => lower.includes(word.toLowerCase())) || null;
}

/** Prevent CSV formula injection when exporting user content. */
export function csvCell(value) {
  let out = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return `"${out.replace(/"/g, '""')}"`;
}

export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '0.0.0.0';
}
