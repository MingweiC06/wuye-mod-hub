/**
 * server.js — entry point.
 *
 *   node server.js
 *
 * Environment:
 *   PORT            默认 8080
 *   HOST            默认 0.0.0.0
 *   DATA_DIR        数据目录（默认 ./data）
 *   ADMIN_CODE      首次启动时设置管理码（>=10 位）；不设置则自动生成
 *   TRUST_PROXY     置 1 时信任 X-Forwarded-For（部署在 Nginx 后面时使用）
 *   COOKIE_SECURE   置 1 时 Cookie 只走 HTTPS（生产环境建议开启）
 *   NODE_ENV        production 时隐藏详细错误
 *   CF_API_TOKEN    Cloudflare API 令牌（只需 Zone Settings: Edit），与 CF_ZONE_ID 一起开启自动 Under Attack
 *   CF_ZONE_ID      Cloudflare 区域 ID
 *   SHIELD_RPM      每分钟请求数超过多少算攻击（默认 1500）
 *   SHIELD_CALM_MIN 平静多少分钟后自动关闭（默认 30）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';

// Cloudflare token for the auto Under Attack watcher: env var, or data/cf-token.txt (one line).
function readToken() {
  try {
    return fs.readFileSync(path.join(process.env.DATA_DIR || 'data', 'cf-token.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

// Shared secret for the China relay (EdgeOne Pages → here). Lives in data/relay-secret.txt.
function readRelaySecret() {
  try {
    return fs.readFileSync(path.join(process.env.DATA_DIR || 'data', 'relay-secret.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp({
  dataDir: process.env.DATA_DIR,
  adminCode: process.env.ADMIN_CODE,
  trustProxy: process.env.TRUST_PROXY === '1',
  secureCookies: process.env.COOKIE_SECURE === '1',
  cfApiToken: process.env.CF_API_TOKEN || readToken(),
  relaySecret: process.env.RELAY_SECRET || readRelaySecret(),
  cfZoneId: process.env.CF_ZONE_ID,
  shieldRpm: process.env.SHIELD_RPM,
  shieldCalmMinutes: process.env.SHIELD_CALM_MIN,
});

app.server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log('');
  console.log('  乌叶MC · 模组许愿池');
  console.log(`  站点地址   ${url}`);
  console.log(`  管理后台   ${url}/admin`);
  console.log(`  数据目录   ${app.dataDir}`);
  if (app.adminCodeCreated && app.adminCode) {
    console.log('');
    console.log('  ┌──────────────────────────────────────────────┐');
    console.log('  │  首次启动，管理员登录码（请立即保存）：      │');
    console.log(`  │    ${app.adminCode}                        │`);
    console.log('  │  也保存在 data/admin-code.txt                │');
    console.log('  └──────────────────────────────────────────────┘');
  }
  console.log('');
});

app.server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，换一个 PORT 再启动，例如：PORT=8081 node server.js`);
  } else {
    console.error('启动失败：', error);
  }
  process.exitCode = 1;
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n收到 ${signal}，正在关闭……`);
  try {
    await app.close();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
