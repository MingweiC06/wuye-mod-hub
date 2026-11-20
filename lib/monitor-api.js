/*
 * monitor-api.js — /api/monitor/* for the private 安全监控 page.
 *
 * Two locks: a signed-in admin session AND the separate 监控口令, which opens a 30-minute monitor
 * session tied to that admin session. Anyone without an admin session gets a plain 404, so the
 * feature is invisible to fans. Every unlock, failed unlock, timeline view and deletion is written
 * to the audit log.
 */
import { checkAdminSession, logAudit } from './db.js';
import { readJsonBody, sendJson } from './http.js';
import { HttpError, notFound, serializeCookie, toBool, tooMany } from './security.js';
import {
  MONITOR_TTL,
  checkMonitorSession,
  createMonitorSession,
  deleteSubject,
  setSubjectNote,
  listSubjects,
  monitorConfigured,
  monitorSummary,
  revokeMonitorSession,
  subjectEvents,
  verifyMonitorCode,
} from './monitor.js';

export const COOKIE_MONITOR = 'wy_mon';

function day(value, endOfDay) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 0;
  // Beijing-time calendar days, like the rest of the site.
  const ms = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(ms) ? ms + (endOfDay ? 86400_000 - 1 : 0) : 0;
}

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
    sendJson(res, 200, { ok: true, expiresAt: Date.now() + MONITOR_TTL }, noStore);
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

  if (pathname === '/api/monitor/summary' && method === 'GET') {
    sendJson(res, 200, monitorSummary(db), noStore);
    return true;
  }

  if (pathname === '/api/monitor/subjects' && method === 'GET') {
    const page = Math.max(1, Math.min(1000, Number.parseInt(query.get('page') || '1', 10) || 1));
    const ip = String(query.get('ip') || '').trim();
    if (ip && !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) throw new HttpError(400, 'bad_ip', 'IP 格式不正确');
    const result = listSubjects(db, monitor.key, ctx.secret, {
      q: String(query.get('q') || '').trim().slice(0, 40),
      ip,
      from: day(query.get('from'), false),
      to: day(query.get('to'), true),
      flagged: toBool(query.get('flagged')),
      page,
    });
    if (ip) audit('monitor.search.ip', '按 IP 搜索');
    sendJson(res, 200, result, noStore);
    return true;
  }

  const m = pathname.match(/^\/api\/monitor\/subjects\/(\d+)$/);
  if (m && method === 'GET') {
    const data = subjectEvents(db, monitor.key, Number(m[1]));
    if (!data) throw notFound('记录不存在');
    audit('monitor.view', `#${m[1]}`);
    sendJson(res, 200, data, noStore);
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
