/**
 * api.js — JSON API. All validation and rate limiting lives here.
 */
import {
  bad,
  clientIp,
  conflict,
  findBanned,
  forbidden,
  notFound,
  oneOf,
  optionalString,
  requireString,
  serializeCookie,
  toBool,
  toInt,
  tooMany,
} from './security.js';
import { HttpError, unauthorized } from './security.js';
import {
  CATEGORIES,
  CATEGORY_KEYS,
  COMMENT_PICKS,
  PAST_VIDEOS,
  SITE,
  STATUSES,
  STATUS_KEYS,
  VIDEOS,
  addIdeaVote,
  adminOverview,
  castPollVote,
  changeAdminCode,
  checkAdminSession,
  countIdeaVotes,
  countPollBallots,
  createAdminSession,
  createIdea,
  createPoll,
  deleteIdea,
  deletePoll,
  ensureAdminCode,
  findSimilarIdea,
  getIdea,
  getPoll,
  getSetting,
  getSiteStats,
  listIdeas,
  listIdeasAdmin,
  listPolls,
  logAudit,
  removeIdeaVote,
  replacePollOptions,
  revokeAdminSession,
  updateIdea,
  updatePoll,
  verifyAdminCode,
  exportIdeasCsv,
} from './db.js';
import { readJsonBody, sendCsv, sendJson } from './http.js';
import { handleExtras } from './extras-api.js';
import { handleMods } from './mods-api.js';
import { listVideos } from './extras.js';

const COOKIE_ADMIN = 'wy_admin';
const SESSION_TTL = 12 * 3600_000;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function requireAdmin(ctx) {
  const session = checkAdminSession(ctx.db, ctx.cookies[COOKIE_ADMIN]);
  if (!session) throw unauthorized('登录已过期，请重新输入管理码');
  return session;
}

function audit(ctx, action, detail = '') {
  logAudit(ctx.db, { action, detail, ipHash: ctx.ipHash });
}

function hit(ctx, key, limit, windowMs) {
  const result = ctx.limiter.hit(key, limit, windowMs);
  if (!result.ok) {
    const error = tooMany();
    error.retryAfter = result.retryAfter;
    throw error;
  }
}

function parsePage(value) {
  return Math.max(1, Math.min(500, toInt(value ?? 1, '页码', { min: 1, max: 500 })));
}

function parseEndsAt(value) {
  if (value == null || value === '') return null;
  let ts;
  if (typeof value === 'number') ts = value;
  else ts = Date.parse(String(value));
  if (!Number.isFinite(ts)) throw bad('结束时间格式不正确');
  if (ts <= Date.now() + 5 * 60_000) throw bad('结束时间至少要设置在 5 分钟之后');
  if (ts > Date.now() + 366 * 86400_000) throw bad('结束时间太远了');
  return Math.floor(ts);
}

function serializeIdeaInput(body) {
  if (body.website) throw bad('提交失败，请稍后再试');
  const title = requireString(body.title, '灵感标题', { min: 4, max: 40 });
  const description = requireString(body.description, '灵感描述', { min: 10, max: 600 });
  const category = oneOf(String(body.category || ''), CATEGORY_KEYS, '分类');
  const author = optionalString(body.author, '昵称', { max: 16 }) || '匿名玩家';
  const banned = findBanned(`${title}\n${description}\n${author}`);
  if (banned) throw bad('内容里包含不适合发布的关键词，请修改后再试');
  return { title, description, category, author };
}

function mapIdeaForAdmin(idea) {
  return idea;
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export async function handleApi(ctx) {
  const { req, res, db, method, pathname, query } = ctx;

  if (await handleMods(ctx)) return true;
  if (await handleExtras(ctx)) return true;

  /* ---------------- site ---------------- */
  if (pathname === '/api/site' && method === 'GET') {
    const announcement = getSetting(db, 'announcement');
    sendJson(res, 200, {
      site: { ...SITE, announcement },
      stats: getSiteStats(db),
      ...(({ videos, pastVideos }) => ({ videos, pastVideos }))(listVideos(db, ctx.voterKey)),
      commentPicks: COMMENT_PICKS,
      categories: CATEGORIES,
      statuses: STATUSES,
      serverTime: Date.now(),
    });
    return true;
  }

  if (pathname === '/api/health' && method === 'GET') {
    sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    return true;
  }

  /* ---------------- ideas ---------------- */
  if (pathname === '/api/ideas' && method === 'GET') {
    const sort = query.get('sort') === 'new' ? 'new' : 'hot';
    const category = oneOf(query.get('category') || '', ['', ...CATEGORY_KEYS], '分类');
    const status = oneOf(query.get('status') || '', ['', ...STATUS_KEYS], '状态');
    const q = String(query.get('q') || '').trim().slice(0, 30);
    const page = parsePage(query.get('page'));
    const pageSize = Math.max(1, Math.min(24, toInt(query.get('pageSize') || 12, '每页数量', { min: 1, max: 24 })));
    const result = listIdeas(db, { voterKey: ctx.voterKey, sort, category, status, q, page, pageSize });
    sendJson(res, 200, result);
    return true;
  }

  if (pathname === '/api/ideas' && method === 'POST') {
    hit(ctx, `idea:${ctx.ip}`, 8, 3600_000);
    const body = await readJsonBody(req);
    const input = serializeIdeaInput(body);
    const similar = findSimilarIdea(db, input.title);
    if (similar) throw conflict('这个灵感已经有人提过啦，去给它投票吧');
    const idea = createIdea(db, input);
    audit(ctx, 'idea.create', `#${idea.id} ${idea.title}`);
    sendJson(res, 201, { ok: true, idea });
    return true;
  }

  const ideaDetail = pathname.match(/^\/api\/ideas\/(\d+)$/);
  if (ideaDetail && method === 'GET') {
    const idea = getIdea(db, Number(ideaDetail[1]), ctx.voterKey);
    if (!idea) throw notFound('这个灵感不存在或已被隐藏');
    sendJson(res, 200, { idea });
    return true;
  }

  const ideaVote = pathname.match(/^\/api\/ideas\/(\d+)\/vote$/);
  if (ideaVote) {
    const ideaId = Number(ideaVote[1]);
    const idea = getIdea(db, ideaId, ctx.voterKey);
    if (!idea) throw notFound('这个灵感不存在或已被隐藏');
    if (method === 'POST') {
      hit(ctx, `vote:${ctx.ip}`, 120, 600_000);
      hit(ctx, `vote:voter:${ctx.voterKey}`, 40, 600_000);
      const result = addIdeaVote(db, ideaId, ctx.voterKey);
      sendJson(res, 200, { ok: true, votes: countIdeaVotes(db, ideaId), voted: true, duplicated: result.duplicated });
      return true;
    }
    if (method === 'DELETE') {
      removeIdeaVote(db, ideaId, ctx.voterKey);
      sendJson(res, 200, { ok: true, votes: countIdeaVotes(db, ideaId), voted: false });
      return true;
    }
  }

  /* ---------------- polls ---------------- */
  if (pathname === '/api/polls' && method === 'GET') {
    sendJson(res, 200, { items: listPolls(db, ctx.voterKey) });
    return true;
  }

  const pollVote = pathname.match(/^\/api\/polls\/(\d+)\/vote$/);
  if (pollVote && method === 'POST') {
    hit(ctx, `pollvote:${ctx.ip}`, 60, 600_000);
    hit(ctx, `pollvote:voter:${ctx.voterKey}`, 20, 600_000);
    const body = await readJsonBody(req);
    const poll = getPoll(db, Number(pollVote[1]), ctx.voterKey);
    if (!poll) throw notFound('这次投票不存在');
    if (poll.status !== 'open') throw conflict('这次投票已经结束啦');
    if (!Array.isArray(body.optionIds)) throw bad('请选择要投的选项');
    const optionIds = [...new Set(body.optionIds.map((id) => toInt(id, '选项', { min: 1 })))];
    if (!optionIds.length) throw bad('请选择要投的选项');
    if (optionIds.length > 8) throw bad('选择的选项太多了');
    if (!poll.allowMultiple && optionIds.length !== 1) throw bad('这次投票只能选一个选项');
    if (poll.allowMultiple && optionIds.length > 3) throw bad('最多选择 3 个选项');
    const valid = new Set(poll.options.map((option) => option.id));
    for (const id of optionIds) if (!valid.has(id)) throw bad('选项不存在，请刷新页面重试');
    const result = castPollVote(db, poll, ctx.voterKey, optionIds);
    if (result.duplicated) throw conflict('你已经投过票啦，每个设备只能投一次');
    sendJson(res, 200, { ok: true, poll: getPoll(db, poll.id, ctx.voterKey) });
    return true;
  }

  /* ---------------- admin auth ---------------- */
  if (pathname === '/api/admin/me' && method === 'GET') {
    const session = checkAdminSession(db, ctx.cookies[COOKIE_ADMIN]);
    sendJson(res, 200, {
      authed: Boolean(session),
      expiresAt: session ? session.expiresAt : null,
      mustChange: Boolean(session) && getSetting(db, 'admin_code_source') === 'generated',
    });
    return true;
  }

  if (pathname === '/api/admin/login' && method === 'POST') {
    hit(ctx, `login:${ctx.ip}`, 8, 15 * 60_000);
    const body = await readJsonBody(req);
    const code = requireString(body.code, '管理码', { min: 4, max: 128 });
    if (!verifyAdminCode(db, code)) {
      await new Promise((resolve) => setTimeout(resolve, 280));
      audit(ctx, 'admin.login.failed');
      throw new HttpError(401, 'invalid_code', '管理码不正确，请再试一次');
    }
    const { token, expiresAt } = createAdminSession(db, SESSION_TTL);
    ctx.setCookie(serializeCookie(COOKIE_ADMIN, token, { maxAge: SESSION_TTL / 1000, secure: ctx.secureCookies }));
    audit(ctx, 'admin.login', 'ok');
    sendJson(res, 200, { ok: true, expiresAt });
    return true;
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    revokeAdminSession(db, ctx.cookies[COOKIE_ADMIN]);
    ctx.setCookie(serializeCookie(COOKIE_ADMIN, '', { maxAge: 0, secure: ctx.secureCookies }));
    sendJson(res, 200, { ok: true });
    return true;
  }

  /* ---------------- admin api ---------------- */
  if (pathname.startsWith('/api/admin/')) {
    const session = requireAdmin(ctx);

    if (pathname === '/api/admin/overview' && method === 'GET') {
      sendJson(res, 200, {
        ...adminOverview(db),
        mustChange: getSetting(db, 'admin_code_source') === 'generated',
        sessionExpiresAt: session.expiresAt,
      });
      return true;
    }

    if (pathname === '/api/admin/ideas' && method === 'GET') {
      const q = String(query.get('q') || '').trim().slice(0, 30);
      const status = oneOf(query.get('status') || '', ['', 'hidden', ...STATUS_KEYS], '状态');
      const page = parsePage(query.get('page'));
      const result = listIdeasAdmin(db, { q, status, page, pageSize: 50 });
      sendJson(res, 200, result);
      return true;
    }

    const adminIdea = pathname.match(/^\/api\/admin\/ideas\/(\d+)$/);
    if (adminIdea && method === 'PATCH') {
      const ideaId = Number(adminIdea[1]);
      const body = await readJsonBody(req);
      const patch = {};
      if (body.status !== undefined) patch.status = oneOf(String(body.status), STATUS_KEYS, '状态');
      if (body.officialReply !== undefined) {
        patch.officialReply = optionalString(body.officialReply, '官方回复', { max: 300 });
      }
      if (body.pinned !== undefined) patch.pinned = toBool(body.pinned);
      if (body.hidden !== undefined) patch.hidden = toBool(body.hidden);
      if (!Object.keys(patch).length) throw bad('没有要修改的内容');
      const updated = updateIdea(db, ideaId, patch);
      if (!updated) throw notFound('这个灵感不存在');
      audit(ctx, 'idea.update', `#${ideaId} ${Object.keys(patch).join(',')}`);
      sendJson(res, 200, { ok: true, idea: updated });
      return true;
    }

    if (adminIdea && method === 'DELETE') {
      const ideaId = Number(adminIdea[1]);
      const row = db.prepare('SELECT id, title FROM ideas WHERE id = ?').get(ideaId);
      if (!row) throw notFound('这个灵感不存在');
      deleteIdea(db, ideaId);
      audit(ctx, 'idea.delete', `#${ideaId} ${row.title}`);
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (pathname === '/api/admin/polls' && method === 'GET') {
      sendJson(res, 200, { items: listPolls(db, '__none__') });
      return true;
    }

    if (pathname === '/api/admin/polls' && method === 'POST') {
      const body = await readJsonBody(req);
      const title = requireString(body.title, '投票标题', { min: 4, max: 60 });
      const description = optionalString(body.description, '投票说明', { max: 300 });
      const endsAt = parseEndsAt(body.endsAt);
      const allowMultiple = toBool(body.allowMultiple);
      if (!Array.isArray(body.options)) throw bad('请添加投票选项');
      const options = body.options.map((option, index) => {
        if (typeof option === 'string') {
          return { label: requireString(option, `选项 ${index + 1}`, { min: 1, max: 30 }), description: '' };
        }
        return {
          label: requireString(option?.label, `选项 ${index + 1}`, { min: 1, max: 30 }),
          description: optionalString(option?.description, `选项 ${index + 1} 说明`, { max: 80 }),
        };
      });
      if (options.length < 2) throw bad('至少需要 2 个选项');
      if (options.length > 8) throw bad('最多 8 个选项');
      if (new Set(options.map((option) => option.label)).size !== options.length) throw bad('选项名称不能重复');
      const pollId = createPoll(db, { title, description, allowMultiple, endsAt, options });
      audit(ctx, 'poll.create', `#${pollId} ${title}`);
      sendJson(res, 201, { ok: true, poll: getPoll(db, pollId, '__none__') });
      return true;
    }

    const adminPoll = pathname.match(/^\/api\/admin\/polls\/(\d+)$/);
    if (adminPoll && method === 'PATCH') {
      const pollId = Number(adminPoll[1]);
      const poll = getPoll(db, pollId, '__none__');
      if (!poll) throw notFound('这次投票不存在');
      const body = await readJsonBody(req);
      const patch = {};
      if (body.title !== undefined) patch.title = requireString(body.title, '投票标题', { min: 4, max: 60 });
      if (body.description !== undefined) {
        patch.description = optionalString(body.description, '投票说明', { max: 300 });
      }
      if (body.status !== undefined) patch.status = oneOf(String(body.status), ['open', 'closed'], '状态');
      if (body.endsAt !== undefined) patch.endsAt = parseEndsAt(body.endsAt);
      if (body.allowMultiple !== undefined) patch.allowMultiple = toBool(body.allowMultiple);
      if (!Object.keys(patch).length) throw bad('没有要修改的内容');
      if (patch.status === 'open' && patch.endsAt === null) patch.endsAt = null;
      updatePoll(db, pollId, patch);
      audit(ctx, 'poll.update', `#${pollId} ${Object.keys(patch).join(',')}`);
      sendJson(res, 200, { ok: true, poll: getPoll(db, pollId, '__none__') });
      return true;
    }

    if (adminPoll && method === 'DELETE') {
      const pollId = Number(adminPoll[1]);
      if (!getPoll(db, pollId, '__none__')) throw notFound('这次投票不存在');
      deletePoll(db, pollId);
      audit(ctx, 'poll.delete', `#${pollId}`);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const adminPollOptions = pathname.match(/^\/api\/admin\/polls\/(\d+)\/options$/);
    if (adminPollOptions && method === 'PUT') {
      const pollId = Number(adminPollOptions[1]);
      if (!getPoll(db, pollId, '__none__')) throw notFound('这次投票不存在');
      if (countPollBallots(db, pollId) > 0) throw conflict('已经有人投票了，不能修改选项；可以结束这次投票后新建一个');
      const body = await readJsonBody(req);
      if (!Array.isArray(body.options)) throw bad('请添加投票选项');
      const options = body.options.map((option, index) => ({
        label: requireString(typeof option === 'string' ? option : option?.label, `选项 ${index + 1}`, {
          min: 1,
          max: 30,
        }),
        description: optionalString(typeof option === 'string' ? '' : option?.description, `选项 ${index + 1} 说明`, {
          max: 80,
        }),
      }));
      if (options.length < 2 || options.length > 8) throw bad('选项数量需要在 2 到 8 个之间');
      replacePollOptions(db, pollId, options);
      audit(ctx, 'poll.options', `#${pollId}`);
      sendJson(res, 200, { ok: true, poll: getPoll(db, pollId, '__none__') });
      return true;
    }

    if (pathname === '/api/admin/settings' && method === 'PATCH') {
      const body = await readJsonBody(req);
      if (body.announcement === undefined) throw bad('没有要修改的内容');
      const announcement = optionalString(body.announcement, '公告', { max: 300 });
      const banned = findBanned(announcement);
      if (banned) throw bad('公告里包含不适合发布的关键词');
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('announcement', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(announcement);
      audit(ctx, 'settings.update', 'announcement');
      sendJson(res, 200, { ok: true, announcement });
      return true;
    }

    if (pathname === '/api/admin/code' && method === 'POST') {
      const body = await readJsonBody(req);
      const current = requireString(body.current, '当前管理码', { min: 4, max: 128 });
      const next = requireString(body.next, '新管理码', { min: 10, max: 64 });
      if (!verifyAdminCode(db, current)) throw new HttpError(401, 'invalid_code', '当前管理码不正确');
      if (next === current) throw bad('新管理码不能和当前一样');
      changeAdminCode(db, next);
      ctx.setCookie(serializeCookie(COOKIE_ADMIN, '', { maxAge: 0, secure: ctx.secureCookies }));
      audit(ctx, 'admin.code.change');
      sendJson(res, 200, { ok: true, relogin: true });
      return true;
    }

    if (pathname === '/api/admin/export.csv' && method === 'GET') {
      const csv = exportIdeasCsv(db);
      audit(ctx, 'admin.export');
      sendCsv(res, csv, `wuye-ideas-${new Date().toISOString().slice(0, 10)}.csv`);
      return true;
    }

    throw notFound('接口不存在');
  }

  return false;
}
