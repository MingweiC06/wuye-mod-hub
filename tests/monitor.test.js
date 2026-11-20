import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

const CODE = 'test-admin-code-1234';
const MON = 'monitor-pass-5678-xyz';

async function start(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-monitor-'));
  const app = createApp({ dataDir, adminCode: CODE, monitorCode: MON, ...extra });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { app, dataDir, base: `http://127.0.0.1:${app.server.address().port}` };
}

function client(base, device, ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36') {
  const jar = new Map();
  return async (pathname, { method = 'GET', body } = {}) => {
    const h = { 'x-requested-with': 'XMLHttpRequest', 'user-agent': ua };
    if (device) h['x-device-id'] = device;
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + pathname, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1));
      else jar.delete(pair.slice(0, i));
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, text, jar };
  };
}

const settle = () => new Promise((r) => setTimeout(r, 30)); // 'finish' handlers run after the response

test('monitor: records visits and actions, hides itself from fans, needs both locks', async (t) => {
  const { app, dataDir, base } = await start();
  t.after(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const FAN = client(base, 'fan-device-00001');
  const ADMIN = client(base, 'admin-device-001');

  // A fan browses and makes a wish.
  const page = await FAN('/ideas');
  assert.equal(page.status, 200);
  assert.ok(page.jar.get('wy_vid'), 'first page view hands out the visitor cookie');
  await FAN('/downloads');
  const wishTitle = '想要一只会飞的龙龙龙';
  assert.equal((await FAN('/api/ideas', { method: 'POST', body: { title: wishTitle, description: '希望能骑着它在天上飞，最好还会喷火。', category: 'mob', crossBorderConsent: true, ageConfirm: true } })).status, 201);
  await FAN('/wp-login.php');
  // In-page clicks: labels only; junk and unknown pages are dropped.
  assert.equal((await FAN('/api/t', { method: 'POST', body: { events: [
    { label: '投一票', page: '/polls', card: 7, at: Date.now() },
    { label: '抖音主页', page: '/', host: 'www.douyin.com' },
    { label: 'x', page: '/admin' },
    { label: '<script>', page: '/nope' },
  ] } })).status, 204);
  await settle();

  // Stored: encrypted IP, labels only, never the content.
  const db = app.db;
  const ev = db.prepare('SELECT * FROM monitor_events').all();
  assert.ok(ev.some((e) => e.label === '打开「许愿池」'));
  assert.ok(ev.some((e) => e.label === '提交许愿'));
  assert.ok(ev.some((e) => e.flag === 'probe'));
  assert.ok(ev.some((e) => e.kind === 'click' && e.label === '点击「投一票」 · 卡片 #7（投票）'));
  assert.ok(ev.some((e) => e.label === '点击「抖音主页」 → www.douyin.com（首页）'));
  assert.equal(ev.filter((e) => e.kind === 'click').length, 2);
  const dump = JSON.stringify(db.prepare('SELECT * FROM monitor_subjects').all()) + JSON.stringify(ev);
  assert.ok(!dump.includes(wishTitle), 'no form content');
  assert.ok(!dump.includes('127.0.0.1'), 'no plaintext IP in the database');
  assert.ok(fs.existsSync(path.join(dataDir, 'monitor.key')));

  // Invisible to fans.
  assert.equal((await FAN('/admin/monitor')).status, 404);
  assert.equal((await FAN('/monitor.html')).status, 404);
  assert.equal((await FAN('/api/monitor/status')).status, 404);
  assert.equal((await FAN('/api/monitor/subjects')).status, 404);
  assert.equal((await FAN('/api/monitor/unlock', { method: 'POST', body: { code: MON } })).status, 404);

  // Failed admin sign-in is flagged.
  assert.equal((await FAN('/api/admin/login', { method: 'POST', body: { code: 'wrong-code-000' } })).status, 401);
  await settle();
  assert.ok(db.prepare("SELECT 1 FROM monitor_events WHERE flag = 'login_failed'").get());

  // Admin alone is not enough.
  assert.equal((await ADMIN('/api/admin/login', { method: 'POST', body: { code: CODE } })).status, 200);
  assert.equal((await ADMIN('/admin/monitor')).status, 200);
  assert.deepEqual((await ADMIN('/api/monitor/status')).data, { configured: true, unlocked: false });
  assert.equal((await ADMIN('/api/monitor/subjects')).status, 401);
  assert.equal((await ADMIN('/api/monitor/unlock', { method: 'POST', body: { code: CODE } })).status, 401, 'admin code is not the monitor passcode');
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'monitor.unlock.failed'").get());

  // Both locks open.
  const un = await ADMIN('/api/monitor/unlock', { method: 'POST', body: { code: MON } });
  assert.equal(un.status, 200);
  const list = await ADMIN('/api/monitor/subjects');
  assert.equal(list.status, 200);
  const fan = list.data.items.find((u) => !u.isAdmin && u.events >= 3);
  assert.ok(fan, 'fan is listed');
  assert.match(fan.ip, /127\.0\.0\.1/);
  const tl = await ADMIN(`/api/monitor/subjects/${fan.id}`);
  assert.ok(tl.data.events.some((e) => e.kind === 'page'));
  assert.equal(tl.data.ips.length, 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'monitor.view'").get());

  // Filters.
  assert.ok((await ADMIN('/api/monitor/subjects?ip=127.0.0.1')).data.total >= 1 || (await ADMIN('/api/monitor/subjects?ip=::ffff:127.0.0.1')).data.total >= 1);
  assert.equal((await ADMIN('/api/monitor/subjects?ip=203.0.113.9')).data.total, 0);
  assert.equal((await ADMIN('/api/monitor/subjects?ip=bad<ip>')).status, 400);
  assert.ok((await ADMIN('/api/monitor/subjects?flagged=1')).data.total >= 1);
  assert.equal((await ADMIN(`/api/monitor/subjects?q=%23${fan.id}`)).data.total, 1);

  // Same IP + same browser after "clearing cookies" (a fresh client) is suggested as the same person.
  const FAN2 = client(base, 'fan-device-00002');
  await FAN2('/ideas');
  await settle();
  const again = await ADMIN(`/api/monitor/subjects/${fan.id}`);
  assert.ok(again.data.related.some((o) => o.likelySame));
  assert.ok((await ADMIN('/api/monitor/subjects')).data.items.some((u) => u.sharedIp >= 1));

  // Private nickname.
  assert.equal((await ADMIN(`/api/monitor/subjects/${fan.id}`, { method: 'PATCH', body: { note: '刷票号A' } })).status, 200);
  assert.equal((await ADMIN('/api/monitor/subjects?q=刷票号')).data.items[0].note, '刷票号A');
  assert.equal((await FAN(`/api/monitor/subjects/${fan.id}`, { method: 'PATCH', body: { note: 'x' } })).status, 404);

  // Summary + deletion.
  const sum = await ADMIN('/api/monitor/summary');
  assert.ok(sum.data.loginFailed >= 1 && sum.data.probes >= 1);
  assert.equal((await ADMIN(`/api/monitor/subjects/${fan.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await ADMIN(`/api/monitor/subjects/${fan.id}`)).status, 404);

  // The monitor session dies with the admin session.
  await ADMIN('/api/admin/logout', { method: 'POST' });
  assert.equal((await ADMIN('/api/monitor/subjects')).status, 404);

  // Existing site still works.
  assert.equal((await FAN('/api/ideas')).status, 200);
  assert.equal((await FAN('/')).status, 200);
});

test('monitor: unlock attempts are rate limited', async (t) => {
  const { app, dataDir, base } = await start();
  t.after(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const ADMIN = client(base, 'admin-device-002');
  await ADMIN('/api/admin/login', { method: 'POST', body: { code: CODE } });
  const codes = [];
  for (let i = 0; i < 6; i += 1) codes.push((await ADMIN('/api/monitor/unlock', { method: 'POST', body: { code: `nope-${i}-xxxxxxx` } })).status);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
});

test('monitor: staging mode stores synthetic IPs only', async (t) => {
  const { app, dataDir, base } = await start({ syntheticIps: true });
  t.after(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const FAN = client(base, 'fan-device-00009');
  const ADMIN = client(base, 'admin-device-003');
  await FAN('/ideas');
  await settle();
  await ADMIN('/api/admin/login', { method: 'POST', body: { code: CODE } });
  await ADMIN('/api/monitor/unlock', { method: 'POST', body: { code: MON } });
  const items = (await ADMIN('/api/monitor/subjects')).data.items;
  assert.ok(items.length >= 1);
  for (const u of items) assert.match(u.ip, /^198\.18\.\d+\.\d+$/);
});
