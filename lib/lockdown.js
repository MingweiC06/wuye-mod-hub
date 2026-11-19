/**
 * lockdown.js — emergency modes the owner can switch on from the admin panel.
 *
 *   off          normal
 *   readonly     只读: fans can browse, but every fan write (vote, wish, comment, upload…) is refused
 *   maintenance  维护: fans only see the 维护中 page; the admin can still sign in and use everything
 *
 * These protect the site's data during spam or abuse. A big flood has to be stopped before it
 * reaches the server: that is Cloudflare's "Under Attack" mode (see shield.js).
 */
import { getSetting, setSetting } from './db.js';

export const LOCKDOWN_MODES = ['off', 'readonly', 'maintenance'];

const caches = new WeakMap(); // db -> { mode, message, since, at }

export function getLockdown(db) {
  const hit = caches.get(db);
  if (hit && Date.now() - hit.at < 2000) return hit;
  const mode = getSetting(db, 'lockdown_mode', 'off');
  const cache = {
    mode: LOCKDOWN_MODES.includes(mode) ? mode : 'off',
    message: getSetting(db, 'lockdown_message', ''),
    since: Number(getSetting(db, 'lockdown_since', '0')) || 0,
    at: Date.now(),
  };
  caches.set(db, cache);
  return cache;
}

export function setLockdown(db, mode, message = '') {
  if (!LOCKDOWN_MODES.includes(mode)) throw new Error('bad mode');
  setSetting(db, 'lockdown_mode', mode);
  setSetting(db, 'lockdown_message', String(message || '').slice(0, 200));
  setSetting(db, 'lockdown_since', mode === 'off' ? '0' : String(Date.now()));
  caches.delete(db);
  return getLockdown(db);
}

/** API paths that keep working for everyone in any mode (sign-in, status, health). */
function alwaysOpen(pathname) {
  return pathname === '/api/site' || pathname === '/api/health' || pathname === '/api/lockdown' || pathname.startsWith('/api/admin');
}

/**
 * Returns a {status, code, message} refusal for this API request, or null to let it through.
 * Admin routes are always let through here; they check the admin session themselves.
 */
export function lockdownRefusal(db, { pathname, method, isAdmin }) {
  const { mode, message } = getLockdown(db);
  if (mode === 'off' || alwaysOpen(pathname)) return null;
  if (mode === 'readonly' && (method === 'GET' || method === 'HEAD')) return null;
  if (isAdmin()) return null;
  const text =
    message ||
    (mode === 'maintenance' ? '网站正在维护，请稍后再来。' : '网站暂时只能浏览，投票、许愿和评论已暂停，请稍后再试。');
  return { status: 503, code: 'lockdown', message: text };
}
