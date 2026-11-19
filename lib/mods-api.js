/**
 * mods-api.js — fan verification, downloads and admin uploads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkAdminSession, logAudit } from './db.js';
import { HttpError, bad, findBanned, forbidden, notFound, oneOf, optionalString, requireString, toBool, tooMany, unauthorized } from './security.js';
import { readJsonBody, sendJson } from './http.js';
import { recordConsent, requireCrossBorderConsent } from './consent.js';
import { saveImage } from './extras-api.js';
import {
  MOD_KINDS,
  checkDownloadToken,
  checkFanCode,
  countDownload,
  countFans,
  createMod,
  deleteMod,
  downloadToken,
  getFan,
  getFanCode,
  getMod,
  listMods,
  receiveUpload,
  setFanCode,
  updateMod,
  verifyFan,
} from './mods.js';

function hit(ctx, key, limit, windowMs) {
  const r = ctx.limiter.hit(key, limit, windowMs);
  if (!r.ok) {
    const e = tooMany();
    e.retryAfter = r.retryAfter;
    throw e;
  }
}

const filesDir = (ctx) => path.join(ctx.dataDir, 'files');

function safeFileName(name, kind) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[\u0000-\u001f"<>|:*?]/g, '').trim().slice(0, 120);
  const ok = kind === 'mod' ? /\.jar$/i : /\.(zip|mrpack)$/i;
  if (!base || !ok.test(base)) throw bad(kind === 'mod' ? '模组文件需要是 .jar' : '整合包需要是 .zip 或 .mrpack');
  return base;
}

export async function handleMods(ctx) {
  const { req, res, db, method, pathname, query } = ctx;

  /* ---------- public ---------- */
  if (pathname === '/api/fan' && method === 'GET') {
    sendJson(res, 200, { fan: getFan(db, ctx.voterKey), gateOpen: Boolean(getFanCode(db)) });
    return true;
  }

  if (pathname === '/api/fan/verify' && method === 'POST') {
    hit(ctx, `fan:${ctx.ip}`, 12, 3600_000);
    hit(ctx, `fan:v:${ctx.voterKey}`, 8, 3600_000);
    const body = await readJsonBody(req);
    requireCrossBorderConsent(ctx, body, 'fan.verify');
    const nickname = requireString(body.nickname, '抖音昵称', { min: 1, max: 20 });
    if (findBanned(nickname)) throw bad('昵称里包含不适合的词');
    if (!getFanCode(db)) throw new HttpError(503, 'gate_closed', '站长还没有设置粉丝口令');
    if (!checkFanCode(db, body.code)) throw new HttpError(403, 'wrong_code', '口令不对哦，去乌叶MC 的抖音找找最新口令');
    verifyFan(db, ctx.voterKey, nickname);
    recordConsent(ctx, { purpose: 'fan.verify', targetType: 'fan', targetId: ctx.voterKey });
    // 审计只记「发生过验证」，昵称本身不写进日志（删除时无需回溯清理）。
    logAudit(db, { action: 'fan.verify', detail: `len=${nickname.length}`, ipHash: ctx.ipHash });
    sendJson(res, 200, { ok: true, fan: getFan(db, ctx.voterKey) });
    return true;
  }

  if (pathname === '/api/mods' && method === 'GET') {
    const items = listMods(db);
    sendJson(res, 200, {
      mods: items.filter((m) => m.kind === 'mod'),
      modpacks: items.filter((m) => m.kind === 'modpack'),
      fan: getFan(db, ctx.voterKey),
    });
    return true;
  }

  const tok = pathname.match(/^\/api\/mods\/(\d+)\/token$/);
  if (tok && method === 'POST') {
    hit(ctx, `dl:${ctx.voterKey}`, 40, 3600_000);
    if (!getFan(db, ctx.voterKey)) throw new HttpError(403, 'fan_required', '先输入粉丝口令解锁下载');
    const mod = getMod(db, Number(tok[1]));
    if (!mod || mod.hidden) throw notFound('文件不存在');
    sendJson(res, 200, { url: `/api/mods/${mod.id}/download?t=${downloadToken(ctx.secret, mod.id)}` });
    return true;
  }

  const dl = pathname.match(/^\/api\/mods\/(\d+)\/download$/);
  if (dl && method === 'GET') {
    const mod = getMod(db, Number(dl[1]));
    if (!mod || mod.hidden) throw notFound('文件不存在');
    if (!checkDownloadToken(ctx.secret, mod.id, query.get('t'))) throw forbidden('下载链接已过期，请回到下载页重新点击');
    const file = path.join(filesDir(ctx), mod.storedName);
    if (!fs.existsSync(file)) throw notFound('文件丢失了，请联系站长');
    countDownload(db, mod.id);
    res.writeHead(200, {
      'Content-Type': 'application/java-archive',
      'Content-Length': mod.size,
      'Content-Disposition': `attachment; filename="${mod.fileName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(mod.fileName)}`,
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  /* ---------- admin ---------- */
  if (!/^\/api\/admin\/(mods|fan)/.test(pathname)) return false;
  if (!checkAdminSession(db, ctx.cookies.wy_admin)) throw unauthorized('登录已过期，请重新输入管理码');
  const audit = (action, detail) => logAudit(db, { action, detail, ipHash: ctx.ipHash });

  if (pathname === '/api/admin/fan' && method === 'GET') {
    sendJson(res, 200, { code: getFanCode(db), fans: countFans(db) });
    return true;
  }
  if (pathname === '/api/admin/fan' && method === 'PATCH') {
    const body = await readJsonBody(req);
    const code = optionalString(body.code, '粉丝口令', { max: 32 });
    if (code && code.length < 3) throw bad('口令至少 3 个字');
    setFanCode(db, code);
    audit('fan.code', code ? 'set' : 'cleared');
    sendJson(res, 200, { ok: true, code });
    return true;
  }

  if (pathname === '/api/admin/mods' && method === 'GET') {
    sendJson(res, 200, { items: listMods(db, { includeHidden: true }) });
    return true;
  }

  /* Raw binary upload; metadata travels in the query string (URL-encoded). */
  if (pathname === '/api/admin/mods/upload' && method === 'POST') {
    const kind = oneOf(String(query.get('kind') || 'mod'), MOD_KINDS, '类型');
    const meta = {
      kind,
      fileName: safeFileName(query.get('file'), kind),
      name: requireString(query.get('name'), '名称', { min: 1, max: 60 }),
      version: optionalString(query.get('version'), '版本', { max: 30 }),
      mcVersion: optionalString(query.get('mc'), 'MC 版本', { max: 30 }),
      loader: optionalString(query.get('loader'), '加载器', { max: 30 }),
      description: optionalString(query.get('desc'), '介绍', { max: 400 }),
    };
    let upload;
    try {
      upload = await receiveUpload(req, filesDir(ctx));
    } catch (error) {
      if (error.code === 'too_large') throw new HttpError(413, 'payload_too_large', '文件超过 300MB 上限');
      if (error.code === 'not_zip') throw bad('这不是有效的 jar / zip 文件');
      throw bad('上传失败，请重试');
    }
    const id = createMod(db, meta, upload);
    audit('mod.upload', `${meta.name} ${meta.fileName} ${upload.size}B`);
    sendJson(res, 200, { ok: true, mod: getMod(db, id) && listMods(db, { includeHidden: true }).find((m) => m.id === id) });
    return true;
  }

  const am = pathname.match(/^\/api\/admin\/mods\/(\d+)$/);
  if (am && method === 'PATCH') {
    const body = await readJsonBody(req, 6 * 1024 * 1024);
    const patch = {};
    if (body.image === '') patch.image = '';
    else if (body.image) patch.image = saveImage(ctx, body.image);
    if (body.name !== undefined) patch.name = requireString(body.name, '名称', { min: 1, max: 60 });
    for (const [k, label, max] of [['version', '版本', 30], ['mcVersion', 'MC 版本', 30], ['loader', '加载器', 30], ['description', '介绍', 400]]) {
      if (body[k] !== undefined) patch[k] = optionalString(body[k], label, { max });
    }
    if (body.hidden !== undefined) patch.hidden = toBool(body.hidden) ? 1 : 0;
    updateMod(db, Number(am[1]), patch);
    audit('mod.update', `#${am[1]}`);
    sendJson(res, 200, { ok: true, image: patch.image });
    return true;
  }
  if (am && method === 'DELETE') {
    if (!deleteMod(db, Number(am[1]), filesDir(ctx))) throw notFound('文件不存在');
    audit('mod.delete', `#${am[1]}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}
