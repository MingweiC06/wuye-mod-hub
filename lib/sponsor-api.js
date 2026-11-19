/**
 * sponsor-api.js — name + key identity, 赞助 submissions, leaderboards, admin review.
 */
import { checkAdminSession, logAudit } from './db.js';
import { bad, conflict, findBanned, notFound, oneOf, optionalString, requireString, tooMany, unauthorized } from './security.js';
import { readJsonBody, sendJson } from './http.js';
import { setNickname } from './extras.js';
import {
  METHODS,
  addSponsorship,
  claimName,
  forgetDevice,
  getMe,
  listProfiles,
  listSponsorships,
  mySponsorships,
  resetKey,
  restoreName,
  reviewSponsorship,
  setSponsorConfig,
  sponsorBoard,
  sponsorConfig,
  starBoard,
  boardEdits,
  setBoardEdit,
  sponsorBoardRaw,
  starBoardRaw,
} from './sponsor.js';

function hit(ctx, key, limit, windowMs) {
  const r = ctx.limiter.hit(key, limit, windowMs);
  if (!r.ok) {
    const e = tooMany();
    e.retryAfter = r.retryAfter;
    throw e;
  }
}

function cleanName(raw) {
  const name = requireString(raw, '名字', { min: 1, max: 16 });
  if (findBanned(name)) throw bad('名字里包含不适合的词');
  if (/^匿名/.test(name)) throw bad('这个名字留给匿名赞助');
  return name;
}

export async function handleSponsor(ctx, saveImage) {
  const { req, res, db, method, pathname } = ctx;

  /* ---------- identity ---------- */
  if (pathname === '/api/me' && method === 'GET') {
    sendJson(res, 200, { me: getMe(db, ctx.voterKey) });
    return true;
  }
  if (pathname === '/api/me/claim' && method === 'POST') {
    hit(ctx, `claim:${ctx.ip}`, 6, 3600_000);
    const body = await readJsonBody(req);
    const name = cleanName(body.name);
    const r = claimName(db, ctx.voterKey, name);
    if (r.error) throw conflict('这个名字已经有人用了。如果是你，用名字 + 钥匙找回');
    setNickname(db, ctx.voterKey, r.profile.name);
    sendJson(res, 200, { ok: true, me: r.profile, key: r.key });
    return true;
  }
  if (pathname === '/api/me/restore' && method === 'POST') {
    hit(ctx, `restore:${ctx.ip}`, 10, 3600_000);
    const body = await readJsonBody(req);
    const name = requireString(body.name, '名字', { min: 1, max: 16 });
    const key = requireString(body.key, '钥匙', { min: 6, max: 40 });
    const r = restoreName(db, ctx.voterKey, name, key);
    if (r.error) throw unauthorized('名字或钥匙不对');
    setNickname(db, ctx.voterKey, r.profile.name);
    sendJson(res, 200, { ok: true, me: r.profile });
    return true;
  }
  if (pathname === '/api/me/forget' && method === 'POST') {
    forgetDevice(db, ctx.voterKey);
    sendJson(res, 200, { ok: true });
    return true;
  }

  /* ---------- sponsor + boards ---------- */
  if (pathname === '/api/sponsor' && method === 'GET') {
    sendJson(res, 200, { config: sponsorConfig(db), me: getMe(db, ctx.voterKey), mine: mySponsorships(db, ctx.voterKey) });
    return true;
  }
  if (pathname === '/api/sponsor' && method === 'POST') {
    hit(ctx, `sponsor:${ctx.voterKey}`, 6, 3600_000);
    const body = await readJsonBody(req);
    const pay = oneOf(String(body.method || ''), METHODS, '付款方式');
    const yuan = Number(body.amount);
    if (!Number.isFinite(yuan) || yuan < 1 || yuan > 100000) throw bad('金额请填 1 – 100000 元');
    const note = optionalString(body.note, '付款备注', { max: 40 }) || '';
    const message = optionalString(body.message, '留言', { max: 60 }) || '';
    if (findBanned(message)) throw bad('留言里包含不适合的词');
    const anonymous = Boolean(body.anonymous) || !getMe(db, ctx.voterKey);
    const id = addSponsorship(db, ctx.voterKey, { anonymous, method: pay, amountCents: Math.round(yuan * 100), note, message });
    sendJson(res, 200, { ok: true, id, anonymous });
    return true;
  }
  if (pathname === '/api/leaderboard' && method === 'GET') {
    sendJson(res, 200, { sponsors: sponsorBoard(db), stars: starBoard(db), me: getMe(db, ctx.voterKey) });
    return true;
  }

  /* ---------- admin ---------- */
  if (!/^\/api\/admin\/(sponsor|profiles|boards)/.test(pathname)) return false;
  if (!checkAdminSession(db, ctx.cookies.wy_admin)) throw unauthorized('登录已过期，请重新输入管理码');

  if (pathname === '/api/admin/boards' && method === 'GET') {
    const rows = (board, raw, key, unit) => {
      const edits = new Map(boardEdits(db, board).map((e) => [e.name, e]));
      const list = raw.filter((r) => r.name).map((r) => ({ name: r.name, real: Math.round(r[key] / unit), adjust: 0, hidden: false, ...edits.get(r.name) }));
      for (const e of edits.values()) if (!list.some((r) => r.name === e.name)) list.push({ real: 0, ...e });
      const anon = raw.filter((r) => !r.name).length;
      return { list, anon };
    };
    sendJson(res, 200, {
      stars: rows('stars', starBoardRaw(db), 'points', 1),
      sponsors: rows('sponsors', sponsorBoardRaw(db), 'total', 100),
    });
    return true;
  }
  if (pathname === '/api/admin/boards' && method === 'PUT') {
    const body = await readJsonBody(req);
    const board = oneOf(String(body.board || ''), ['stars', 'sponsors'], '榜单');
    const name = requireString(body.name, '名字', { max: 20 });
    const adjust = Number(body.adjust || 0);
    if (!Number.isInteger(adjust) || Math.abs(adjust) > 1000000) throw bad('调整值要填整数');
    setBoardEdit(db, board, name, { adjust, hidden: Boolean(body.hidden) });
    logAudit(db, { action: `board.${board}`, detail: `${name} ${adjust}${body.hidden ? ' hidden' : ''}`, ipHash: ctx.ipHash });
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/admin/sponsorships' && method === 'GET') {
    sendJson(res, 200, { items: listSponsorships(db) });
    return true;
  }
  const one = pathname.match(/^\/api\/admin\/sponsorships\/(\d+)$/);
  if (one && method === 'PATCH') {
    const body = await readJsonBody(req);
    const status = oneOf(String(body.status || ''), ['pending', 'confirmed', 'rejected'], '状态');
    if (!reviewSponsorship(db, Number(one[1]), status)) throw notFound('记录不存在');
    logAudit(db, { action: `sponsor.${status}`, detail: one[1], ipHash: ctx.ipHash });
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (pathname === '/api/admin/sponsor-config' && method === 'GET') {
    sendJson(res, 200, { config: sponsorConfig(db) });
    return true;
  }
  if (pathname === '/api/admin/sponsor-config' && method === 'PATCH') {
    const body = await readJsonBody(req, 6 * 1024 * 1024);
    const patch = {};
    for (const k of ['wechat', 'alipay']) {
      if (body[k] === '') patch[k] = '';
      else if (body[k]) patch[k] = saveImage(ctx, body[k]);
    }
    if (body.note !== undefined) patch.note = optionalString(body.note, '说明', { max: 200 }) || '';
    setSponsorConfig(db, patch);
    logAudit(db, { action: 'sponsor.config', detail: Object.keys(patch).join(','), ipHash: ctx.ipHash });
    sendJson(res, 200, { ok: true, config: sponsorConfig(db) });
    return true;
  }
  if (pathname === '/api/admin/profiles' && method === 'GET') {
    sendJson(res, 200, { items: listProfiles(db) });
    return true;
  }
  const rk = pathname.match(/^\/api\/admin\/profiles\/(\d+)\/reset-key$/);
  if (rk && method === 'POST') {
    const r = resetKey(db, Number(rk[1]));
    if (!r) throw notFound('这个名字不存在');
    logAudit(db, { action: 'profile.reset-key', detail: r.name, ipHash: ctx.ipHash });
    sendJson(res, 200, { ok: true, name: r.name, key: r.key });
    return true;
  }
  return false;
}
