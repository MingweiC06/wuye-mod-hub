// Staging / local preview only: fills 安全监控 with synthetic visitors.
// IPs are either reserved documentation ranges (192.0.2.x, 198.51.100.x, 203.0.113.x, 2001:db8::/32: no location,
// tests the "unknown" display) or well-known public DNS servers owned by companies (Google, 114DNS, Cloudflare, …),
// so locations are real database results but no real person's address is ever shown.  Run:  DATA_DIR=... node scripts/seed-monitor-demo.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { encryptIp, ipHashOf, loadMonitorKey, migrateMonitor } from '../lib/monitor.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
if (!process.env.ALLOW_DEMO_SEED) {
  console.log('Refusing: set ALLOW_DEMO_SEED=1 (never run this on the production data directory).');
  process.exit(1);
}
const db = new DatabaseSync(path.join(dataDir, 'wuye.db'));
migrateMonitor(db);
const secret = db.prepare("SELECT value FROM settings WHERE key = 'secret'").get()?.value || 'demo';
const key = loadMonitorKey(dataDir);
const now = Date.now();
const H = 3600_000;
const UA = {
  win: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 MicroMessenger/8.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  curl: 'curl/8.5.0',
};

const people = [
  { note: '', ua: UA.iphone, ips: ['114.114.114.114'], events: [
    [-26, 'page', '打开「首页」'], [-25.98, 'page', '打开「许愿池」'], [-25.95, 'action', '提交许愿'], [-25.9, 'page', '打开「投票」'], [-25.88, 'action', '给卡片 #3 投票'],
    [-2, 'page', '打开「首页」'], [-1.97, 'page', '打开「下载」'], [-1.95, 'action', '粉丝验证'], [-1.94, 'click', '点击「下载」 · 卡片 #2（下载）'], [-1.93, 'download', '下载模组文件 #2'], [-1.9, 'page', '打开「赞助」'], [-1.89, 'click', '点击「抖音主页」 → www.douyin.com（赞助）'] ] },
  // Same phone after clearing cookies: same IP + identical browser string → 「可能是同一人」.
  { note: '', ua: UA.iphone, ips: ['114.114.114.114'], events: [
    [-0.8, 'page', '打开「投票」'], [-0.79, 'click', '点击「票数最高」（投票）'], [-0.78, 'click', '点击「投一票」 · 卡片 #3（投票）'], [-0.78, 'action', '给卡片 #3 投票'] ] },
  // Someone else on the same school / mobile network: same IP, different browser.
  { note: '', ua: UA.android, ips: ['114.114.114.114'], events: [ [-6, 'page', '打开「排行榜」'], [-5.99, 'click', '点击「本周」（排行榜）'] ] },
  { note: '', ua: UA.android, ips: ['202.96.134.133', '8.8.8.8'], events: [
    [-30, 'page', '打开「投票」'], [-29.99, 'action', '给卡片 #1 投票'], [-5, 'security', 'IP 地址变化', 'ip_change', 1], [-5, 'page', '打开「投票」', '', 1], [-4.99, 'action', '取消卡片 #1 的投票', '', 1], [-4.98, 'action', '给卡片 #4 投票', '', 1] ] },
  { note: '可疑：试后台', ua: UA.win, ips: ['149.112.112.112'], events: [
    [-3, 'page', '打开「首页」'], [-2.99, 'admin', '打开后台页面'], [-2.98, 'security', '站长登录失败', 'login_failed'], [-2.97, 'security', '站长登录失败', 'login_failed'], [-2.96, 'security', '站长登录失败', 'login_failed'],
    [-2.95, 'security', '请求过于频繁被限流：POST /api/admin/login', 'rate_limited'], [-2.9, 'security', '未授权访问后台接口：GET /api/admin/overview', 'denied'] ] },
  { note: '', anon: true, ua: UA.curl, ips: ['2001:db8::4f2a'], events: [
    [-8, 'security', '探测可疑路径：/wp-login.php', 'probe'], [-8, 'security', '探测可疑路径：/.env', 'probe'], [-7.99, 'security', '探测可疑路径：/phpmyadmin/index.php', 'probe'], [-7.98, 'security', '一分钟内请求超过 120 次', 'burst'] ] },
  { note: '我的电脑', admin: true, ua: UA.mac, ips: ['192.0.2.10'], events: [
    [-50, 'admin', '打开后台页面'], [-49.99, 'login', '站长登录成功'], [-0.5, 'page', '打开「投票」'], [-0.2, 'login', '站长退出登录'] ] },
];
for (let i = 0; i < 9; i += 1) {
  people.push({ note: '', ua: [UA.iphone, UA.android, UA.win][i % 3], ips: [['1.1.1.1', '9.9.9.9', '223.5.5.5', '180.76.76.76', '119.29.29.29', '208.67.222.222', '203.0.113.' + (100 + i), '2001:4860:4860::8888', '168.95.1.1'][i]], events: [
    [-(i * 7 + 3), 'page', '打开「首页」'], [-(i * 7 + 2.98), 'page', ['打开「许愿池」', '打开「排行榜」', '打开「投票」'][i % 3]] ] });
}

db.exec('DELETE FROM monitor_events; DELETE FROM monitor_ips; DELETE FROM monitor_subjects;');
const insS = db.prepare('INSERT INTO monitor_subjects (subject, first_seen, last_seen, visits, events, flags, ip_hash, ip_enc, ip_count, ua_label, ua_raw, voter_key, is_admin, admin_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insE = db.prepare('INSERT INTO monitor_events (subject_id, at, kind, label, status, ip_hash, ip_enc, flag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const insI = db.prepare('INSERT INTO monitor_ips (subject_id, ip_hash, first_seen, last_seen) VALUES (?, ?, ?, ?)');
const label = (ua) => (/curl/.test(ua) ? '浏览器 · 未知系统' : /MicroMessenger/.test(ua) ? '微信 · Android' : /iPhone/.test(ua) ? 'Safari · iPhone' : /Macintosh/.test(ua) ? 'Safari · Mac' : 'Chrome · Windows');
people.forEach((p, n) => {
  const times = p.events.map((e) => now + e[0] * H);
  const ips = p.ips.map((ip) => ({ ip, hash: ipHashOf(secret, ip), enc: encryptIp(key, ip) }));
  const last = ips[ips.length - 1];
  const flags = p.events.filter((e) => e[3]).length;
  const r = insS.run(p.anon ? `ip:demo${n}` : `v:demo${n}`, Math.min(...times), Math.max(...times), new Set(times.map((t) => Math.floor(t / (6 * H)))).size, p.events.length, flags, last.hash, last.enc, ips.length, label(p.ua), p.ua, '', p.admin ? 1 : 0, p.note);
  const id = r.lastInsertRowid;
  ips.forEach((x, i) => {
    const mine = p.events.filter((e) => (e[4] || 0) === i).map((e) => now + e[0] * H);
    insI.run(id, x.hash, Math.min(...mine), Math.max(...mine));
  });
  for (const e of p.events) {
    const x = ips[e[4] || 0];
    insE.run(id, now + e[0] * H, e[1], e[2], e[3] === 'login_failed' ? 401 : e[3] === 'rate_limited' ? 429 : 200, x.hash, x.enc, e[3] || '');
  }
});
db.close();
console.log(`Seeded ${people.length} synthetic visitors.`);
