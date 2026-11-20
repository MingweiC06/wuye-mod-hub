/**
 * app.js — creates the HTTP server: security middleware, static files, API.
 */
import { createShield } from './lib/shield.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAdminSession, ensureAdminCode, getSecret, openDatabase, seedDatabase } from './lib/db.js';
import { applySecurityHeaders, notFoundPage, readJsonBody, sendJson, serveStatic } from './lib/http.js';
import { handleApi } from './lib/api.js';
import { migrateExtras, seedExtras } from './lib/extras.js';
import { migrateMods } from './lib/mods.js';
import { migrateSponsor } from './lib/sponsor.js';
import { migrateConsent } from './lib/consent.js';
import { migrateVisits, recordVisit } from './lib/visits.js';
import { migrateAdminSecurity } from './lib/admin-security.js';
import { getLockdown, lockdownRefusal } from './lib/lockdown.js';
import { createMonitor, loadMonitorKey, migrateMonitor, monitorConfigured, sanitizeClicks, setMonitorCode } from './lib/monitor.js';
import { handleMonitor } from './lib/monitor-api.js';
import { createGeo, migrateGeo } from './lib/geo.js';
import { migrateGuard, netHash } from './lib/guard.js';
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
  ['/privacy', '/privacy.html'],
  ['/downloads', '/downloads.html'],
  ['/sponsor', '/sponsor.html'],
  ['/leaderboard', '/leaderboard.html'],
]);

// Public pages search engines should index, by clean URL. One canonical host avoids duplicate content
// across wuye.* / wuyecn.* and the `.html` variants.
const CANONICAL_ORIGIN = String(process.env.CANONICAL_ORIGIN || 'https://wuye.uniquetalentmap.com').replace(/\/+$/, '');
const PUBLIC_PAGES = new Set(['/', '/ideas', '/polls', '/rules', '/privacy', '/downloads', '/sponsor', '/leaderboard']);

export function createApp(options = {}) {
  const dataDir = path.resolve(options.dataDir || path.join(ROOT, 'data'));
  const publicDir = path.resolve(options.publicDir || DEFAULT_PUBLIC);
  const trustProxy = Boolean(options.trustProxy);
  const secureCookies = Boolean(options.secureCookies);
  // 后台本地化: with ADMIN_LOCAL_ONLY the admin (pages, scripts, APIs) only answers requests made on the
  // server itself — i.e. through an SSH tunnel. Anything that came through Caddy / Cloudflare / the China relay gets 404.
  const adminLocalOnly = Boolean(options.adminLocalOnly);
  const ADMIN_PATH = /^\/(admin(\/.*|\.html|\.js|\.css|-login(\.html|\.js)?|-channel\.js)?|monitor(\.html|\.js)?|api\/(admin|monitor)(\/.*)?)$/;
  const relaySecret = String(options.relaySecret || '');

  fs.mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(path.join(dataDir, 'wuye.db'));
  seedDatabase(db, options.demo);
  migrateExtras(db);
  migrateMods(db);
  migrateSponsor(db);
  migrateConsent(db);
  migrateVisits(db);
  migrateAdminSecurity(db);
  migrateMonitor(db);
  migrateGeo(db);
  migrateGuard(db);
  seedExtras(db, options.demo);
  const admin = ensureAdminCode(db, dataDir, options.adminCode);
  const secret = getSecret(db);
  const limiter = new RateLimiter();
  // 安全监控: off only when explicitly disabled. Staging sets syntheticIps so no real IP is ever stored there.
  const monitor = options.monitor === false ? null : createMonitor(db, { secret, key: loadMonitorKey(dataDir), synthetic: Boolean(options.syntheticIps) });
  if (monitor && options.monitorCode && !monitorConfigured(db)) setMonitorCode(db, options.monitorCode);
  // IP location estimates from local DB-IP Lite files in DATA_DIR/geo (or GEO_DIR). Nothing is sent out.
  if (monitor) monitor.geo = createGeo(dataDir, { dir: options.geoDir });
  const shield = createShield({
    token: options.cfApiToken,
    zoneId: options.cfZoneId,
    dataDir,
    rpm: Number(options.shieldRpm) || 1500,
    calmMinutes: Number(options.shieldCalmMinutes) || 30,
  });

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
    if (req.headers['cf-connecting-ip']) shield.hit();
    applySecurityHeaders(req, res);
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    // China relay (EdgeOne): trusted only with the shared secret; carries the visitor's real IP and host.
    const relayed = Boolean(relaySecret) && sha256(String(req.headers['x-wuye-relay'] || '')) === sha256(relaySecret);
    const relayIp = relayed ? String(req.headers['x-wuye-client-ip'] || '').trim() : '';
    const ip = relayIp && /^[0-9a-fA-F:.]{3,45}$/.test(relayIp) ? relayIp : clientIp(req, trustProxy);
    const host = relayed && req.headers['x-wuye-host'] ? String(req.headers['x-wuye-host']) : String(req.headers.host || '');
    const isLocal =
      !relayed &&
      !req.headers['x-forwarded-for'] &&
      !req.headers['cf-connecting-ip'] &&
      /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(String(req.socket?.remoteAddress || '')) &&
      /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(req.headers.host || ''));
    if (adminLocalOnly && !isLocal && ADMIN_PATH.test(pathname)) {
      if (pathname.startsWith('/api/')) sendJson(res, 404, { error: { code: 'not_found', message: '接口不存在' } });
      else notFoundPage(res, publicDir);
      return;
    }

    // 安全监控: one record per finished request (route + status only, never bodies).
    const reqCookies = parseCookies(req.headers.cookie);
    const seen = { vid: /^[a-f0-9]{32}$/.test(reqCookies.wy_vid || '') ? reqCookies.wy_vid : '', voterKey: '', clicks: [] };
    if (monitor) {
      res.on('finish', () => {
        monitor.record({
          vid: seen.vid,
          ip,
          ua: String(req.headers['user-agent'] || ''),
          method: req.method === 'HEAD' ? 'GET' : req.method,
          pathname,
          status: res.statusCode,
          isApi: pathname.startsWith('/api/'),
          voterKey: seen.voterKey,
          clicks: seen.clicks,
          isAdmin: () => Boolean(checkAdminSession(db, reqCookies.wy_admin)),
        });
      });
    }

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
          if (!originHost || originHost !== host) {
            throw forbidden('请求来源校验失败');
          }
        }
      }

      const cookies = parseCookies(req.headers.cookie);
      let vid = cookies.wy_vid;
      const vidMaxAge = 180 * 24 * 3600; // 180 天：与 localStorage 设备标识的 TTL 保持一致
      if (!/^[a-f0-9]{32}$/.test(vid || '')) {
        vid = randomHex(16);
        res.appendHeader(
          'Set-Cookie',
          serializeCookie('wy_vid', vid, { maxAge: vidMaxAge, secure: secureCookies && !isLocal, sameSite: 'Lax' }),
        );
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        // 滑动续期：只在实际提交（投票/许愿/赞助…）时续期，读取页面不下发多余的 Set-Cookie。
        res.appendHeader(
          'Set-Cookie',
          serializeCookie('wy_vid', vid, { maxAge: vidMaxAge, secure: secureCookies && !isLocal, sameSite: 'Lax' }),
        );
      }
      const deviceHeader = String(req.headers['x-device-id'] || '');
      const device = /^[A-Za-z0-9_-]{8,64}$/.test(deviceHeader) ? deviceHeader : '';
      // Device id (localStorage) is the primary identity so the site also works inside the
      // partner-site iframe, where third-party cookies are often blocked.
      const voterKey = device ? hmacHex(secret, `v2:d:${device}`) : hmacHex(secret, `v1:${vid}:-`);
      const ipHash = sha256(`${secret}:${ip}`).slice(0, 16);
      seen.vid = vid;
      seen.voterKey = voterKey;

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
        netHash: netHash(secret, ip),
        geo: monitor ? monitor.geo : null,
        voterKey,
        secret,
        limiter,
        dataDir,
        // Through the tunnel the page is plain http://localhost, so the admin cookie can't be Secure there.
        secureCookies: secureCookies && !isLocal,
        isLocal,
        shield,
        setCookie(value) {
          res.appendHeader('Set-Cookie', value);
        },
      };

      // 只读 / 维护 lockdown (admin panel → 站点设置 → 紧急模式)
      const refusal = lockdownRefusal(db, { pathname, method: ctx.method, isAdmin: () => Boolean(checkAdminSession(db, cookies.wy_admin)) });
      if (refusal) {
        sendJson(res, refusal.status, { error: { code: refusal.code, message: refusal.message } }, { 'Retry-After': '600', 'Cache-Control': 'no-store' });
        return;
      }

      // In-page click tracker (public/app.js): batches of button / link labels for 安全监控.
      if (pathname === '/api/t' && ctx.method === 'POST') {
        const ok = limiter.hit(`t:${seen.vid || ip}`, 30, 60_000).ok;
        const body = await readJsonBody(req, 8 * 1024).catch(() => null);
        if (monitor && ok && body) seen.clicks = sanitizeClicks(body);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (await handleMonitor(ctx, monitor)) return;
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

    // 维护 mode: fans get the 维护中 page instead of any page; assets, media and the admin keep working.
    if (!pathname.startsWith('/admin') && (pathname === '/' || PUBLIC_PAGES.has(pathname) || pathname.endsWith('.html'))) {
      if (getLockdown(db).mode === 'maintenance' && !checkAdminSession(db, parseCookies(req.headers.cookie).wy_admin)) {
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '600' });
        res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(publicDir, 'maintenance.html')));
        return;
      }
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

    // `/ideas.html` → `/ideas`, `/index.html` → `/` (301), so each page has exactly one URL.
    const clean = pathname === '/index.html' ? '/' : pathname.replace(/\.html$/, '');
    if (clean !== pathname && PUBLIC_PAGES.has(clean) && (req.method === 'GET' || req.method === 'HEAD')) {
      const q = req.url.indexOf('?');
      res.writeHead(301, { Location: clean + (q >= 0 ? req.url.slice(q) : '') });
      res.end();
      return;
    }
    // The private 安全监控 page: only for a signed-in admin; for everyone else it does not exist.
    if (pathname === '/monitor.html') {
      notFoundPage(res, publicDir);
      return;
    }
    if (pathname === '/admin/monitor') {
      if (!monitor || !checkAdminSession(db, reqCookies.wy_admin)) {
        notFoundPage(res, publicDir);
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      if (!serveStatic(req, res, publicDir, '/monitor.html')) notFoundPage(res, publicDir);
      return;
    }

    if (PUBLIC_PAGES.has(pathname)) {
      // Give first-time visitors the anonymous visitor cookie on the page itself, so their timeline starts here.
      if (monitor && !seen.vid && req.method === 'GET') {
        seen.vid = randomHex(16);
        res.appendHeader('Set-Cookie', serializeCookie('wy_vid', seen.vid, { maxAge: 180 * 24 * 3600, secure: secureCookies && !isLocal, sameSite: 'Lax' }));
      }
      res.setHeader('Link', `<${CANONICAL_ORIGIN}${pathname}>; rel="canonical"`);
      if (req.method === 'GET') {
        try {
          recordVisit(db, secret, { path: pathname, ip, userAgent: String(req.headers['user-agent'] || '') });
        } catch {
          // counting must never break the page
        }
      }
    }

    let target = pathname;
    if (PAGE_REWRITES.has(target)) target = PAGE_REWRITES.get(target);
    // The dashboard itself is only served to a signed-in admin; everyone else gets the sign-in page.
    if (target === '/admin.html') {
      res.setHeader('Cache-Control', 'no-store');
      if (!checkAdminSession(db, parseCookies(req.headers.cookie).wy_admin)) target = '/admin-login.html';
    }
    if (target === '/admin-login.html' && pathname !== '/admin' && pathname !== '/admin.html') {
      notFoundPage(res, publicDir);
      return;
    }
    if (target === '/') target = '/index.html';
    if (target.endsWith('/')) target += 'index.html';

    // Only allow real files inside public/, and only known asset/page extensions.
    if (!/\.(html|css|js|mjs|json|txt|xml|svg|png|jpe?g|webp|ico|woff2|m4a|mp3)$/i.test(target)) {
      notFoundPage(res, publicDir);
      return;
    }
    const served = serveStatic(req, res, publicDir, target);
    if (!served) notFoundPage(res, publicDir);
  }

  function close() {
    shield.stop();
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
    shield,
    close,
  };
}
