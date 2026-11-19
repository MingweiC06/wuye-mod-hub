/**
 * extras-api.js — JSON routes for videos, comment inbox, bracket, roadmap,
 * supporters and the embeddable side widget. Called from api.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CATEGORY_KEYS, checkAdminSession, getIdea, getSetting, listIdeas, listPolls, logAudit } from './db.js';
import { bad, conflict, findBanned, notFound, oneOf, optionalString, randomHex, requireString, toInt, tooMany, unauthorized } from './security.js';
import { readJsonBody, sendJson } from './http.js';
import { recordConsent, requireCrossBorderConsent } from './consent.js';
import {
  addVideo,
  advanceBracket,
  createBracket,
  deleteVideo,
  dismissComment,
  getBracket,
  getNickname,
  importComments,
  listCards,
  listComments,
  listRoadmap,
  listVideos,
  parseCollectorVideo,
  parseCommentPaste,
  parseDouyinId,
  promoteComment,
  setCard,
  setNickname,
  setProgress,
  supporterBoard,
  toggleVideoLike,
  updateVideo,
  voteBoard,
  voteBracket,
} from './extras.js';

function hit(ctx, key, limit, windowMs) {
  const r = ctx.limiter.hit(key, limit, windowMs);
  if (!r.ok) {
    const e = tooMany();
    e.retryAfter = r.retryAfter;
    throw e;
  }
}

function requireAdmin(ctx) {
  if (!checkAdminSession(ctx.db, ctx.cookies.wy_admin)) throw unauthorized('登录已过期，请重新输入管理码');
}

function audit(ctx, action, detail = '') {
  logAudit(ctx.db, { action, detail, ipHash: ctx.ipHash });
}

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function saveImage(ctx, dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw bad('封面需要是 JPG / PNG / WebP 图片');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2.5 * 1024 * 1024) throw bad('封面图片不能超过 2.5MB');
  const magic = buf.subarray(0, 12).toString('hex');
  const ok = magic.startsWith('ffd8ff') || magic.startsWith('89504e47') || (magic.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw bad('图片文件已损坏或格式不对');
  const dir = path.join(ctx.dataDir, 'media');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomHex(4)}.${IMAGE_TYPES[m[1]]}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return `/media/${name}`;
}

function videoInput(body, ctx, { partial = false } = {}) {
  const out = {};
  const str = (key, label, max) => {
    if (body[key] === undefined) return;
    out[key] = optionalString(body[key], label, { max });
  };
  if (!partial) {
    out.douyinId = parseDouyinId(body.url);
    if (!out.douyinId) throw bad('没认出抖音视频链接，请粘贴形如 douyin.com/video/7xxxx 的地址');
    out.title = requireString(body.title, '视频标题', { min: 2, max: 60 });
  } else if (body.title !== undefined) {
    out.title = requireString(body.title, '视频标题', { min: 2, max: 60 });
  }
  str('series', '系列名', 40);
  str('tag', '标签', 20);
  str('plays', '播放量', 12);
  str('likes', '点赞数', 12);
  str('published', '日期', 12);
  if (body.coverData) out.cover = saveImage(ctx, body.coverData);
  else if (body.cover !== undefined) {
    const c = String(body.cover || '');
    if (c && !/^\/(assets|media)\/[\w.-]+$/.test(c)) throw bad('封面地址不正确');
    out.cover = c;
  }
  if (body.featured !== undefined && partial) out.featured = body.featured ? 1 : 0;
  if (!partial) for (const k of ['series', 'tag', 'cover', 'plays', 'likes', 'published']) out[k] = out[k] || '';
  return out;
}

/** Best-effort: copy a Douyin CDN cover into DATA_DIR/media (site must stay self-hosted). */
async function fetchDouyinCover(ctx, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '';
  }
  if (u.protocol !== 'https:' || !/(^|\.)(douyinpic\.com|douyinstatic\.com|byteimg\.com)$/.test(u.hostname)) return '';
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { referer: 'https://www.douyin.com/' } });
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 2.5 * 1024 * 1024) return '';
    const type = res.headers.get('content-type') || '';
    const mime = type.includes('png') ? 'image/png' : type.includes('webp') ? 'image/webp' : 'image/jpeg';
    return saveImage(ctx, `data:${mime};base64,${buf.toString('base64')}`);
  } catch {
    return '';
  }
}

/** Widget GET endpoints may be read from the talent-map origin. */
function allowWidgetCors(ctx) {
  const origin = String(ctx.req.headers.origin || '');
  const allowed = String(process.env.WIDGET_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    ctx.res.setHeader('Access-Control-Allow-Origin', origin);
    ctx.res.setHeader('Vary', 'Origin');
  }
  ctx.res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

export async function handleExtras(ctx) {
  const { req, res, db, method, pathname } = ctx;

  /* ---------- public ---------- */
  if (pathname === '/api/widget' && method === 'GET') {
    allowWidgetCors(ctx);
    const { videos } = listVideos(db);
    const ideas = listIdeas(db, { voterKey: '__none__', sort: 'hot', pageSize: 5 }).items.map((i) => ({ id: i.id, title: i.title, votes: i.votes, category: i.category }));
    const poll = listPolls(db, '__none__').find((p) => p.status === 'open') || null;
    const bracket = getBracket(db);
    sendJson(res, 200, {
      latest: videos[0] || null,
      ideas,
      poll: poll && { id: poll.id, title: poll.title, totalVotes: poll.totalVotes, options: poll.options.slice(0, 4).map((o) => ({ label: o.label, votes: o.votes })) },
      bracket: bracket && { title: bracket.title, round: bracket.round, totalRounds: bracket.totalRounds, champion: bracket.champion, matches: bracket.matches.filter((m) => m.round === bracket.round).slice(0, 2) },
      announcement: getSetting(db, 'announcement'),
    });
    return true;
  }

  if (pathname === '/api/videos' && method === 'GET') {
    sendJson(res, 200, listVideos(db, ctx.voterKey));
    return true;
  }

  const like = pathname.match(/^\/api\/videos\/(\d+)\/like$/);
  if (like && method === 'POST') {
    hit(ctx, `vlike:${ctx.voterKey}`, 60, 600_000);
    hit(ctx, `vlike:ip:${ctx.ip}`, 120, 600_000); // clearing cookies gives a new device id, not a new IP
    const r = toggleVideoLike(db, Number(like[1]), ctx.voterKey);
    if (!r) throw notFound('视频不存在');
    sendJson(res, 200, { ok: true, ...r });
    return true;
  }

  if (pathname === '/api/bracket' && method === 'GET') {
    sendJson(res, 200, { bracket: getBracket(db, ctx.voterKey) });
    return true;
  }

  const bv = pathname.match(/^\/api\/bracket\/matches\/(\d+)\/vote$/);
  if (bv && method === 'POST') {
    hit(ctx, `bvote:${ctx.voterKey}`, 40, 600_000);
    hit(ctx, `bvote:ip:${ctx.ip}`, 120, 600_000);
    const body = await readJsonBody(req);
    const pick = oneOf(String(body.pick || ''), ['a', 'b'], '选择');
    const r = voteBracket(db, Number(bv[1]), ctx.voterKey, pick);
    if (r.error === 'missing') throw notFound('对决不存在');
    if (r.error) throw conflict('这一轮对决已经结束啦');
    sendJson(res, 200, { ok: true, bracket: getBracket(db, ctx.voterKey, r.bracketId) });
    return true;
  }

  if (pathname === '/api/board' && method === 'GET') {
    const sort = ['votes', 'mentions', 'new', 'game'].includes(ctx.query.get('sort')) ? ctx.query.get('sort') : 'votes';
    const game = String(ctx.query.get('game') || '').slice(0, 40);
    sendJson(res, 200, voteBoard(db, ctx.voterKey, { sort, game }));
    return true;
  }

  if (pathname === '/api/roadmap' && method === 'GET') {
    sendJson(res, 200, { items: listRoadmap(db) });
    return true;
  }

  if (pathname === '/api/supporters' && method === 'GET') {
    sendJson(res, 200, { items: supporterBoard(db, 10), me: getNickname(db, ctx.voterKey) });
    return true;
  }

  if (pathname === '/api/me/nickname' && method === 'POST') {
    hit(ctx, `nick:${ctx.voterKey}`, 6, 3600_000);
    const body = await readJsonBody(req);
    requireCrossBorderConsent(ctx, body, 'me.nickname');
    const nickname = requireString(body.nickname, '昵称', { min: 1, max: 16 });
    if (findBanned(nickname)) throw bad('昵称里包含不适合的词');
    setNickname(db, ctx.voterKey, nickname);
    recordConsent(ctx, { purpose: 'me.nickname', targetType: 'supporter', targetId: ctx.voterKey });
    sendJson(res, 200, { ok: true, nickname });
    return true;
  }

  /* ---------- admin ---------- */
  if (!pathname.startsWith('/api/admin/')) return false;
  const adminRoutes = /^\/api\/admin\/(videos|comments|bracket|roadmap|media|cards)/;
  if (!adminRoutes.test(pathname)) return false;
  requireAdmin(ctx);

  if (pathname === '/api/admin/cards' && method === 'GET') {
    sendJson(res, 200, { items: listCards(db) });
    return true;
  }
  const card = pathname.match(/^\/api\/admin\/cards\/(\d+)$/);
  if (card && method === 'PATCH') {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    const patch = {};
    if (body.game !== undefined) patch.game = optionalString(body.game, '游戏', { max: 40 });
    if (body.image === '') patch.image = '';
    else if (body.image !== undefined) patch.image = saveImage(ctx, body.image);
    if (body.video !== undefined) {
      const v = String(body.video || '').trim();
      patch.video = v ? parseDouyinId(v) : '';
      if (v && !patch.video) throw bad('没认出抖音视频链接，请粘贴形如 douyin.com/video/7xxxx 的地址');
    }
    if (!setCard(db, Number(card[1]), patch)) throw notFound('这个灵感不存在');
    audit(ctx, 'card.update', `#${card[1]} ${Object.keys(patch).join(',')}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/admin/videos' && method === 'GET') {
    sendJson(res, 200, { items: listVideos(db).all });
    return true;
  }
  if (pathname === '/api/admin/videos' && method === 'POST') {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    const v = videoInput(body, ctx);
    if (db.prepare('SELECT 1 FROM videos WHERE douyin_id = ?').get(v.douyinId)) throw conflict('这条视频已经添加过了');
    const key = addVideo(db, v);
    audit(ctx, 'video.add', `${v.douyinId} ${v.title}`);
    sendJson(res, 200, { ok: true, key });
    return true;
  }
  const av = pathname.match(/^\/api\/admin\/videos\/(\d+)$/);
  if (av && method === 'PATCH') {
    const body = await readJsonBody(req, 4 * 1024 * 1024);
    updateVideo(db, Number(av[1]), videoInput(body, ctx, { partial: true }));
    audit(ctx, 'video.update', `#${av[1]}`);
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (av && method === 'DELETE') {
    deleteVideo(db, Number(av[1]));
    audit(ctx, 'video.delete', `#${av[1]}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/admin/comments' && method === 'GET') {
    const status = oneOf(ctx.query.get('status') || 'new', ['new', 'promoted', 'dismissed'], '状态');
    sendJson(res, 200, { items: listComments(db, status) });
    return true;
  }
  if (pathname === '/api/admin/comments/import' && method === 'POST') {
    const body = await readJsonBody(req, 1024 * 1024);
    const comments = parseCommentPaste(body.raw);
    if (!comments.length && !parseCollectorVideo(body.raw)) throw bad('没有识别到评论内容');
    let videoKey = null;
    let videoAdded = false;
    const pasted = parseCollectorVideo(body.raw);
    const did = pasted ? pasted.douyinId : parseDouyinId(body.videoUrl || '');
    if (did) videoKey = Number(db.prepare('SELECT id FROM videos WHERE douyin_id = ?').get(did)?.id) || null;
    if (pasted && !videoKey && body.addVideo !== false) {
      const cover = await fetchDouyinCover(ctx, pasted.coverUrl);
      videoKey = addVideo(db, { ...pasted, tag: '', plays: '', cover });
      videoAdded = true;
      audit(ctx, 'video.add', `${pasted.douyinId} ${pasted.title} (collector)`);
    }
    const r = comments.length ? importComments(db, videoKey, comments) : { added: 0, total: 0 };
    audit(ctx, 'comments.import', `${r.added}/${r.total}`);
    sendJson(res, 200, { ok: true, ...r, videoAdded });
    return true;
  }
  const ac = pathname.match(/^\/api\/admin\/comments\/(\d+)\/(promote|dismiss)$/);
  if (ac && method === 'POST') {
    const id = Number(ac[1]);
    if (ac[2] === 'dismiss') {
      dismissComment(db, id);
      sendJson(res, 200, { ok: true });
      return true;
    }
    const body = await readJsonBody(req);
    let ideaId = null;
    let title = '';
    let category = 'other';
    if (body.ideaId) {
      ideaId = toInt(body.ideaId, '灵感编号', { min: 1 });
      if (!getIdea(db, ideaId, '__none__', { includePending: true })) throw notFound('目标灵感不存在');
    } else {
      title = requireString(body.title, '灵感标题', { min: 2, max: 40 });
      category = oneOf(String(body.category || 'other'), CATEGORY_KEYS, '分类');
    }
    const target = promoteComment(db, id, { title, category, ideaId });
    if (!target) throw notFound('评论不存在');
    audit(ctx, 'comment.promote', `#${id} -> idea #${target}`);
    sendJson(res, 200, { ok: true, ideaId: target });
    return true;
  }

  if (pathname === '/api/admin/bracket' && method === 'GET') {
    sendJson(res, 200, { bracket: getBracket(db) });
    return true;
  }
  if (pathname === '/api/admin/bracket' && method === 'POST') {
    const body = await readJsonBody(req);
    const title = requireString(body.title, '擂台标题', { min: 2, max: 30 });
    const entrants = (Array.isArray(body.entrants) ? body.entrants : [])
      .map((e) => String(e || '').trim().slice(0, 24))
      .filter(Boolean);
    if (![4, 8, 16].includes(entrants.length)) throw bad('参赛选手需要 4、8 或 16 个');
    if (new Set(entrants).size !== entrants.length) throw bad('参赛选手不能重名');
    const id = createBracket(db, { title, entrants });
    audit(ctx, 'bracket.create', title);
    sendJson(res, 200, { ok: true, bracket: getBracket(db, '__none__', id) });
    return true;
  }
  const adv = pathname.match(/^\/api\/admin\/bracket\/(\d+)\/advance$/);
  if (adv && method === 'POST') {
    const b = advanceBracket(db, Number(adv[1]));
    if (!b) throw conflict('擂台已结束或不存在');
    audit(ctx, 'bracket.advance', `#${adv[1]} -> round ${b.round}`);
    sendJson(res, 200, { ok: true, bracket: b });
    return true;
  }

  if (pathname === '/api/admin/roadmap' && method === 'GET') {
    const rows = db
      .prepare("SELECT id, title, status, progress, progress_note AS note FROM ideas WHERE hidden = 0 AND status IN ('planned','building','released') ORDER BY updated_at DESC LIMIT 60")
      .all()
      .map((r) => ({ ...r, id: Number(r.id), progress: Number(r.progress) }));
    sendJson(res, 200, { items: rows });
    return true;
  }
  const rp = pathname.match(/^\/api\/admin\/roadmap\/(\d+)$/);
  if (rp && method === 'PATCH') {
    const body = await readJsonBody(req);
    const progress = toInt(body.progress ?? 0, '进度', { min: 0, max: 100 });
    const note = optionalString(body.note, '进度说明', { max: 60 });
    setProgress(db, Number(rp[1]), progress, note);
    audit(ctx, 'roadmap.update', `#${rp[1]} ${progress}%`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
