/**
 * http.js — small HTTP helpers: security headers, JSON bodies, static files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, bad } from './security.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.map': 'application/json; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export function applySecurityHeaders(req, res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);
  if (req.socket?.encrypted || String(req.headers['x-forwarded-proto'] || '').includes('https')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(text);
}

export function sendCsv(res, text, filename) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

export function readJsonBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.includes('application/json')) {
      reject(bad('请求格式不正确'));
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'payload_too_large', '提交的内容太长了'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(bad('请求格式不正确'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(bad('请求格式不正确'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Resolve a URL pathname inside publicDir. Returns an absolute file path or null.
 * Rejects traversal, null bytes, hidden files and non-asset extensions.
 */
export function resolveStaticPath(publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = path.posix.normalize(decoded).replace(/^(\.\.\/)+/, '');
  if (normalized.includes('..')) return null;
  const relative = normalized.replace(/^\/+/, '');
  const absolute = path.resolve(publicDir, relative);
  const root = path.resolve(publicDir);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
  return absolute;
}

export function serveStatic(req, res, publicDir, pathname) {
  let relative = pathname;
  if (relative === '/' || relative === '') relative = '/index.html';
  if (relative.endsWith('/')) relative += 'index.html';

  const file = resolveStaticPath(publicDir, relative);
  if (!file) {
    sendText(res, 400, 'Bad request');
    return;
  }
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) {
    return false;
  }
  const isHtml = ext === '.html';
  const isMedia = ext === '.jpg' || ext === '.png' || ext === '.svg' || ext === '.webp' || ext === '.m4a' || ext === '.mp3';
  const cacheControl = isHtml
    ? 'no-cache'
    : isMedia
      ? 'public, max-age=604800'
      : ext === '.css' || ext === '.js' || ext === '.woff2'
        ? 'public, max-age=86400' // pages load these with ?v=…, bumped on every change
        : 'no-cache';
  // Byte ranges so <audio> can seek / resume.
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range && !isHtml && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, {
      'Content-Type': MIME[ext],
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControl,
      'Last-Modified': stat.mtime.toUTCString(),
    });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext],
    'Content-Length': stat.size,
    'Cache-Control': cacheControl,
    'Last-Modified': stat.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(file).pipe(res);
  return true;
}

export function notFoundPage(res, publicDir) {
  const file = path.join(publicDir, '404.html');
  try {
    const body = fs.readFileSync(file);
    res.writeHead(404, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    sendText(res, 404, '页面走丢了');
  }
}
