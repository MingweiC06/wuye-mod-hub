/**
 * app.js — creates the HTTP server: security middleware, static files, API.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureAdminCode, getSecret, openDatabase, seedDatabase } from './lib/db.js';
import { applySecurityHeaders, notFoundPage, sendJson, serveStatic } from './lib/http.js';
import { handleApi } from './lib/api.js';
import { migrateExtras, seedExtras } from './lib/extras.js';
import { migrateMods } from './lib/mods.js';
import {
  HttpError,
  RateLimiter,
  clientIp,
  forbidden,
  hmacHex,
  parseCookies,
  randomHex,
  serializeCookie,
  sha256,
} from './lib/security.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
const DEFAULT_PUBLIC = path.join(ROOT, 'public');

const PAGE_REWRITES = new Map([
  ['/ideas', '/ideas.html'],
  ['/polls', '/polls.html'],
  ['/admin', '/admin.html'],
  ['/rules', '/rules.html'],
  ['/downloads', '/downloads.html'],
]);

export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || path.join(ROOT, 'data'));
  const publicDir = path.resolve(options.publicDir || DEFAULT_PUBLIC);
  const trustProxy = Boolean(options.trustProxy);
  const secureCookies = Boolean(options.secureCookies);

  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, 'wuye.db'));
  seedDatabase(db, options.demo);
  migrateExtras(db);
  migrateMods(db);
  seedExtras(db, options.demo);
  const admin = ensureAdminCode(db, dataDir, options.adminCode);
  const secret = getSecret(db);
  const limiter = new RateLimiter();

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        const headers = error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {};
        sendJson(res, error.status, { error: { code: error.code, message: error.message } }, headers);
        return;
      }
      console.error('[unhandled]', error);
      sendJson(res, 500, { error: { code: 'internal', message: '服务器开小差了，请稍后再试' } });
    });
  });

  async function handleRequest(req, res) {
    applySecurityHeaders(req, res);
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const ip = clientIp(req, trustProxy);

    if (pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        sendJson(res, 405, { error: { code: 'method_not_allowed', message: '请求方式不支持' } });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const requestedWith = String(req.headers['x-requested-with'] || '');
        if (requestedWith !== 'XMLHttpRequest') {
          throw forbidden('请求校验失败，请刷新页面后重试');
        }
        const origin = req.headers.origin;
        if (origin) {
          let originHost = '';
          try {
            originHost = new URL(origin).host;
          } catch {
            originHost = '';
          }
          if (!originHost || originHost !== String(req.headers.host || '')) {
            throw forbidden('请求来源校验失败');
          }
        }
      }

      const cookies = parseCookies(req.headers.cookie);
      let vid = cookies.wy_vid;
      if (!/^[a-f0-9]{32}$/.test(vid || '')) {
        vid = randomHex(16);
        res.appendHeader(
          'Set-Cookie',
          serializeCookie('wy_vid', vid, { maxAge: 400 * 24 * 3600, secure: secureCookies, sameSite: 'Lax' }),
        );
      }
      const deviceHeader = String(req.headers['x-device-id'] || '');
      const device = /^[A-Za-z0-9_-]{8,64}$/.test(deviceHeader) ? deviceHeader : '';
      // Device id (localStorage) is the primary identity so the site also works inside the
      // partner-site iframe, where third-party cookies are often blocked.
      const voterKey = device ? hmacHex(secret, `v2:d:${device}`) : hmacHex(secret, `v1:${vid}:-`);
      const ipHash = sha256(`${secret}:${ip}`).slice(0, 16);

      const ctx = {
        req,
        res,
        db,
        method: req.method === 'HEAD' ? 'GET' : req.method,
        pathname,
        query: url.searchParams,
        cookies,
        ip,
        ipHash,
        voterKey,
        secret,
        limiter,
        dataDir,
        secureCookies,
        setCookie(value) {
          res.appendHeader('Set-Cookie', value);
        },
      };

      const handled = await handleApi(ctx);
      if (!handled) {
        sendJson(res, 404, { error: { code: 'not_found', message: '接口不存在' } });
      }
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    // Uploaded covers live in DATA_DIR/media so they survive redeploys.
    if (pathname.startsWith('/media/')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (!/^\/media\/[\w-]+\.(jpg|png|webp)$/.test(pathname) || !serveStatic(req, res, dataDir, pathname)) notFoundPage(res, publicDir);
      return;
    }
    // The side widget is embedded on the talent-map site (another origin).
    if (pathname === '/widget.js' || pathname.startsWith('/assets/')) {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }

    // Let partner sites (WIDGET_ORIGINS) show public pages full-screen in an iframe. Admin stays unframeable.
    const frameOrigins = String(process.env.WIDGET_ORIGINS || '').split(',').map((o) => o.trim()).filter((o) => /^https?:\/\/[\w.-]+(:\d+)?$/.test(o));
    if (frameOrigins.length && !pathname.startsWith('/admin')) {
      res.removeHeader('X-Frame-Options');
      const csp = String(res.getHeader('Content-Security-Policy') || '');
      res.setHeader('Content-Security-Policy', csp.replace("frame-ancestors 'none'", `frame-ancestors 'self' ${frameOrigins.join(' ')}`));
    }

    let target = pathname;
    if (PAGE_REWRITES.has(target)) target = PAGE_REWRITES.get(target);
    if (target === '/') target = '/index.html';
    if (target.endsWith('/')) target += 'index.html';

    // Only allow real files inside public/, and only known asset/page extensions.
    if (!/\.(html|css|js|mjs|json|txt|svg|png|jpe?g|webp|ico|woff2)$/i.test(target)) {
      notFoundPage(res, publicDir);
      return;
    }
    const served = serveStatic(req, res, publicDir, target);
    if (!served) notFoundPage(res, publicDir);
  }

  function close() {
    return new Promise((resolve) => {
      server.close(() => {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        resolve();
      });
    });
  }

  return {
    server,
    db,
    dataDir,
    publicDir,
    adminCode: admin.code,
    adminCodeCreated: admin.created,
    close,
  };
}
