import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { deviceLabel, normalizePattern } from '../lib/admin-security.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-adminsec-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234' });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function client(device, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130') {
  const jar = new Map();
  return async (pathname, { method = 'GET', body } = {}) => {
    const h = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': device, 'user-agent': ua };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + pathname, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1));
      else jar.delete(pair.slice(0, i));
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

const CODE = 'test-admin-code-1234';
const PC = client('pc-device-0001');
const PHONE = client('phone-device-01', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');

test('pattern helpers', () => {
  assert.equal(normalizePattern([0, 4, 8, 5]), '0-4-8-5');
  assert.equal(normalizePattern('0-1-2'), null); // too short
  assert.equal(normalizePattern('0-1-1-2'), null); // repeated dot
  assert.equal(normalizePattern('0-1-2-9'), null); // out of range
  assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'), 'Safari · iPhone');
  assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Edg/130'), 'Edge · Windows');
});

test('devices are recorded per sign-in and can be signed out', async () => {
  const a = await PC('/api/admin/login', { method: 'POST', body: { code: CODE } });
  assert.equal(a.status, 200);
  assert.equal(a.data.newDevice, true);
  const b = await PHONE('/api/admin/login', { method: 'POST', body: { code: CODE } });
  assert.equal(b.data.newDevice, true);
  const again = await PC('/api/admin/login', { method: 'POST', body: { code: CODE } });
  assert.equal(again.data.newDevice, false);

  const list = await PC('/api/admin/devices');
  assert.equal(list.status, 200);
  const pc = list.data.devices.find((d) => d.current);
  const phone = list.data.devices.find((d) => d.label === 'Safari · iPhone');
  assert.equal(pc.label, 'Chrome · Windows');
  assert.equal(pc.logins, 2);
  assert.ok(phone.signedIn);
  assert.ok(!JSON.stringify(list.data).includes('127.0.0.1'));

  const out = await PC(`/api/admin/devices/${phone.id}`, { method: 'DELETE' });
  assert.equal(out.status, 200);
  assert.equal((await PHONE('/api/admin/devices')).status, 401);
  assert.equal((await PC('/api/admin/devices')).status, 200);
});

test('unlock pattern is required once set, and errors do not say which part was wrong', async () => {
  const bad = await PC('/api/admin/pattern', { method: 'PUT', body: { code: 'wrong-code-0000', pattern: '0-4-8-5' } });
  assert.equal(bad.status, 401);
  const short = await PC('/api/admin/pattern', { method: 'PUT', body: { code: CODE, pattern: '0-1-2' } });
  assert.equal(short.status, 400);
  const set = await PC('/api/admin/pattern', { method: 'PUT', body: { code: CODE, pattern: '0-4-8-5' } });
  assert.equal(set.status, 200);
  assert.equal(set.data.pattern, true);

  const opts = await fetch(`${base}/api/admin/login-options`).then((r) => r.json());
  assert.equal(opts.pattern, true);

  const fresh = client('third-device-001');
  const noPattern = await fresh('/api/admin/login', { method: 'POST', body: { code: CODE } });
  assert.equal(noPattern.data.error.code, 'pattern_required');
  const wrongPattern = await fresh('/api/admin/login', { method: 'POST', body: { code: CODE, pattern: '0-1-2-5' } });
  const wrongCode = await fresh('/api/admin/login', { method: 'POST', body: { code: 'nope-nope-nope', pattern: '0-4-8-5' } });
  assert.equal(wrongPattern.status, 401);
  assert.equal(wrongPattern.data.error.message, wrongCode.data.error.message);
  const ok = await fresh('/api/admin/login', { method: 'POST', body: { code: CODE, pattern: '0-4-8-5' } });
  assert.equal(ok.status, 200);

  const off = await PC('/api/admin/pattern', { method: 'PUT', body: { code: CODE, pattern: '' } });
  assert.equal(off.data.pattern, false);
  const plain = await client('fourth-device-01')('/api/admin/login', { method: 'POST', body: { code: CODE } });
  assert.equal(plain.status, 200);
});
