import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-lockdown-'));
const CODE = 'test-admin-code-1234';
const app = createApp({ dataDir, adminCode: CODE });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function client(device) {
  const jar = new Map();
  return async (pathname, { method = 'GET', body } = {}) => {
    const h = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': device };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + pathname, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
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
    return { status: res.status, data, text };
  };
}

const ADMIN = client('admin-device-001');
const FAN = client('fan-device-00001');
const wish = { title: '想要一只会飞的龙', description: '希望能骑着它在天上飞，最好还会喷火。', category: 'mob', crossBorderConsent: true, ageConfirm: true };

test('lockdown: 只读 blocks fan writes, 维护 shows the maintenance page, admin is never locked out', async () => {
  assert.equal((await ADMIN('/api/admin/login', { method: 'POST', body: { code: CODE } })).status, 200);
  assert.equal((await FAN('/api/admin/lockdown')).status, 401);
  assert.equal((await FAN('/api/admin/lockdown', { method: 'PUT', body: { mode: 'maintenance' } })).status, 401);

  // 只读
  const ro = await ADMIN('/api/admin/lockdown', { method: 'PUT', body: { mode: 'readonly', message: '暂停一小时' } });
  assert.equal(ro.status, 200);
  assert.equal(ro.data.mode, 'readonly');
  const site = await FAN('/api/site');
  assert.deepEqual(site.data.lockdown, { mode: 'readonly', message: '暂停一小时' });
  assert.equal((await FAN('/api/ideas')).status, 200);
  const blocked = await FAN('/api/ideas', { method: 'POST', body: wish });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.error.code, 'lockdown');
  assert.equal(blocked.data.error.message, '暂停一小时');
  assert.equal((await ADMIN('/api/ideas', { method: 'POST', body: wish })).status, 201);
  assert.equal((await FAN('/ideas')).status, 200);

  // 维护
  await ADMIN('/api/admin/lockdown', { method: 'PUT', body: { mode: 'maintenance' } });
  const page = await FAN('/ideas');
  assert.equal(page.status, 503);
  assert.match(page.text, /维护中/);
  assert.equal((await FAN('/')).status, 503);
  assert.equal((await FAN('/api/ideas')).status, 503);
  assert.equal((await FAN('/api/lockdown')).data.mode, 'maintenance');
  assert.equal((await FAN('/cosmic.css')).status, 200);
  assert.equal((await FAN('/admin')).status, 200); // sign-in page stays reachable
  assert.equal((await ADMIN('/ideas')).status, 200);
  assert.equal((await ADMIN('/api/ideas')).status, 200);

  // the Cloudflare switch needs the shield to be configured
  assert.equal((await ADMIN('/api/admin/lockdown', { method: 'PUT', body: { underAttack: true } })).status, 409);
  assert.equal((await ADMIN('/api/admin/lockdown', { method: 'PUT', body: { mode: 'nope' } })).status, 400);

  // back to normal
  await ADMIN('/api/admin/lockdown', { method: 'PUT', body: { mode: 'off' } });
  assert.equal((await FAN('/ideas')).status, 200);
  assert.equal((await FAN('/api/ideas', { method: 'POST', body: { ...wish, title: '想要一只会潜水的鲸鱼' } })).status, 201);
});
