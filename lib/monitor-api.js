/*
 * monitor-api.js — /api/monitor/* for the private 安全监控 page.
 *
 * Two locks: a signed-in admin session AND the separate 监控口令, which opens a 30-minute monitor
 * session tied to that admin session. Anyone without an admin session gets a plain 404, so the
 * feature is invisible to fans. Every unlock, failed unlock, timeline view and deletion is written
 * to the audit log.
 */
import { checkAdminSession, getSetting, logAudit, setSetting } from './db.js';
import '../public/tz.js'; // defines globalThis.WYTZ (Intl-based zone conversion, shared with the dashboard)
import { readJsonBody, sendJson } from './http.js';
import { HttpError, notFound, serializeCookie, toBool, tooMany } from './security.js';
import {
  MONITOR_TTL,
  checkMonitorSession,
  createMonitorSession,
  deleteSubject,
  setSubjectNote,
  adminLog,
  listSubjects,
  mapPoints,
  monitorConfigured,
  monitorSummary,
  revokeMonitorSession,
  subjectEvents,
  verifyMonitorCode,
} from './monitor.js';

export const COOKIE_MONITOR = 'wy_mon';

export const TZ_MODES = ['dual', 'bj', 'et'];
const KINDS = ['page', 'click', 'action', 'download', 'login', 'admin', 'security'];

/**
 * The admin picks dates / times in 北京时间 or 美国东部时间 (`zone` = bj | et); they are converted to UTC
 * instants here, through the IANA zone database (Intl). The database is then compared in UTC milliseconds.
 * An end time is inclusive to the end of that minute; an end date without a time covers the whole day.
 */
export function rangeFrom(query) {
  const T = globalThis.WYTZ;
  const zone = query.get('zone') === 'et' ? 'et' : 'bj';
  const time = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '');
  let from = 0;
  let to = 0;
  const fd = String(query.get('from') || '');
  const td = String(query.get('to') || '');
  if (fd) {
    from = T.zonedToUtc(fd, time(query.get('fromTime')) || '00:00', zone);
    if (!Number.isFinite(from)) throw new HttpError(400, 'bad_date', '开始日期不正确');
  }
  if (td) {
    const tt = time(query.get('toTime'));
    to = T.zonedToUtc(td, tt ? `${tt}:59` : '23:59:59', zone);
    if (!Number.isFinite(to)) throw new HttpError(400, 'bad_date', '结束日期不正确');
    to += 999;
  }
  if (from && to && from > to) throw new HttpError(400, 'bad_range', '开始时间晚于结束时间');
  return { from, to, zone };
}

function filterFrom(query, ip) {
  const kind = String(query.get('kind') || '');
  return {
    q: String(query.get('q') || '').trim().slice(0, 40),
    ip,
    ...rangeFrom(query),
    kind: KINDS.includes(kind) ? kind : '',
    flagged: toBool(query.get('flagged')),
  };
}

// API responses carry instants as ISO 8601 UTC strings ("2026-11-20T02:16:35.000Z"); the dashboard converts them.
const TIME_KEYS = new Set(['at', 'firstSeen', 'lastSeen', 'updatedAt', 'expiresAt', 'sessionUntil']);
function isoTimes(value) {
  if (Array.isArray(value)) return value.map(isoTimes);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = TIME_KEYS.has(k) && typeof v === 'number' && v > 0 ? new Date(v).toISOString() : isoTimes(v);
    return out;
  }
  return value;
}
const sendIso = (res, status, payload, headers) => sendJson(res, status, isoTimes(payload), headers);

export async function handleMonitor(ctx, monitor) {
  const { db, res, req, method, pathname, query, cookies } = ctx;
  if (!pathname.startsWith('/api/monitor/')) return false;
  const adminToken = cookies.wy_admin;
  if (!monitor || !checkAdminSession(db, adminToken)) throw notFound('接口不存在');
  const audit = (action, detail = '') => logAudit(db, { action, detail, ipHash: ctx.ipHash });
  const noStore = { 'Cache-Control': 'no-store' };

  if (pathname === '/api/monitor/status' && method === 'GET') {
    sendJson(res, 200, { configured: monitorConfigured(db), unlocked: checkMonitorSession(db, cookies[COOKIE_MONITOR], adminToken) }, noStore);
    return true;
  }

  if (pathname === '/api/monitor/unlock' && method === 'POST') {
    for (const k of [`mon:${ctx.ip}`, 'mon:all']) {
      const r = ctx.limiter.hit(k, k === 'mon:all' ? 20 : 5, 15 * 60_000);
      if (!r.ok) {
        const e = tooMany();
        e.retryAfter = r.retryAfter;
        throw e;
      }
    }
    if (!monitorConfigured(db)) throw new HttpError(409, 'not_configured', '还没有设置监控口令');
    const body = await readJsonBody(req);
    if (!verifyMonitorCode(db, body.code)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      audit('monitor.unlock.failed');
      throw new HttpError(401, 'invalid_code', '监控口令不正确');
    }
    const token = createMonitorSession(db, adminToken);
    ctx.setCookie(serializeCookie(COOKIE_MONITOR, token, { maxAge: MONITOR_TTL / 1000, secure: ctx.secureCookies, sameSite: 'Strict' }));
    audit('monitor.unlock');
    sendIso(res, 200, { ok: true, expiresAt: Date.now() + MONITOR_TTL }, noStore);
    return true;
  }

  if (pathname === '/api/monitor/lock' && method === 'POST') {
    revokeMonitorSession(db, cookies[COOKIE_MONITOR]);
    ctx.setCookie(serializeCookie(COOKIE_MONITOR, '', { maxAge: 0, secure: ctx.secureCookies, sameSite: 'Strict' }));
    sendJson(res, 200, { ok: true }, noStore);
    return true;
  }

  // Everything below needs the 监控口令 as well.
  if (!checkMonitorSession(db, cookies[COOKIE_MONITOR], adminToken)) throw new HttpError(401, 'monitor_locked', '请先输入监控口令');

  if (pathname === '/api/monitor/prefs' && method === 'GET') {
    sendJson(res, 200, { tzMode: TZ_MODES.includes(getSetting(db, 'monitor_tz_mode')) ? getSetting(db, 'monitor_tz_mode') : 'dual' }, noStore);
    return true;
  }
  if (pathname === '/api/monitor/prefs' && method === 'PUT') {
    const body = await readJsonBody(req);
    if (!TZ_MODES.includes(body.tzMode)) throw new HttpError(400, 'bad_mode', '显示模式不正确');
    setSetting(db, 'monitor_tz_mode', body.tzMode); // display only: stored times are never touched
    audit('monitor.prefs', `tz=${body.tzMode}`);
    sendJson(res, 200, { tzMode: body.tzMode }, noStore);
    return true;
  }

  if (pathname === '/api/monitor/audit' && method === 'GET') {
    const page = Math.max(1, Math.min(1000, Number.parseInt(query.get('page') || '1', 10) || 1));
    sendIso(res, 200, adminLog(db, { ...rangeFrom(query), page }), noStore);
    return true;
  }

  if (pathname === '/api/monitor/summary' && method === 'GET') {
    sendJson(res, 200, { ...monitorSummary(db), geo: monitor.geo ? monitor.geo.status() : null }, noStore);
    return true;
  }

  if (pathname === '/api/monitor/subjects' && method === 'GET') {
    const page = Math.max(1, Math.min(1000, Number.parseInt(query.get('page') || '1', 10) || 1));
    const ip = String(query.get('ip') || '').trim();
    if (ip && !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw new HttpError(400, 'bad_ip', 'IP 格式不正确');
    const result = listSubjects(db, monitor.key, ctx.secret, { ...filterFrom(query, ip), page, geo: monitor.geo });
    if (ip) audit('monitor.search.ip', '按 IP 搜索');
    sendIso(res, 200, result, noStore);
    return true;
  }

  if (pathname === '/api/monitor/map' && method === 'GET') {
    const ip = String(query.get('ip') || '').trim();
    if (ip && !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw new HttpError(400, 'bad_ip', 'IP 格式不正确');
    sendIso(res, 200, mapPoints(db, monitor.key, ctx.secret, monitor.geo, filterFrom(query, ip)), noStore);
    return true;
  }

  const m = pathname.match(/^\/api\/monitor\/subjects\/(\d+)$/);
  if (m && method === 'GET') {
    const f = filterFrom(query, '');
    const data = subjectEvents(db, monitor.key, Number(m[1]), { geo: monitor.geo, from: f.from, to: f.to, kind: f.kind });
    if (!data) throw notFound('记录不存在');
    audit('monitor.view', `#${m[1]}`);
    sendIso(res, 200, data, noStore);
    return true;
  }
  if (m && method === 'PATCH') {
    const body = await readJsonBody(req);
    const note = String(body.note ?? '').trim();
    if (note.length > 40) throw new HttpError(400, 'too_long', '昵称最多 40 个字');
    if (!setSubjectNote(db, Number(m[1]), note)) throw notFound('记录不存在');
    audit('monitor.note', `#${m[1]}`);
    sendJson(res, 200, { ok: true, note }, noStore);
    return true;
  }
  if (m && method === 'DELETE') {
    if (!deleteSubject(db, Number(m[1]))) throw notFound('记录不存在');
    audit('monitor.delete', `#${m[1]}`);
    sendJson(res, 200, { ok: true }, noStore);
    return true;
  }

  throw notFound('接口不存在');
}
