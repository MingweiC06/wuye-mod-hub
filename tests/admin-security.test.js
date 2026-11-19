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
  assert.equal(pc.lastIp, '127.0.0.1', 'admin devices show their IP (owner safety)');

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

test('primary device: shielded, approves the hand-over, only one that can change code/pattern; IP recorded', async (t) => {
  // own server, so the login rate limit from earlier tests doesn't apply
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-primary-'));
  const app2 = createApp({ dataDir: dir2, adminCode: CODE });
  await new Promise((r) => app2.server.listen(0, '127.0.0.1', r));
  t.after(async () => { await app2.close(); fs.rmSync(dir2, { recursive: true, force: true }); });
  const base2 = `http://127.0.0.1:${app2.server.address().port}`;
  const client2 = (device, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130') => {
    const jar = new Map();
    return async (pathname, { method = 'GET', body } = {}) => {
      const h = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': device, 'user-agent': ua };
      if (body !== undefined) h['content-type'] = 'application/json';
      if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(base2 + pathname, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
      for (const c of res.headers.getSetCookie()) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1));
        else jar.delete(pair.slice(0, i));
      }
      return { status: res.status, data: await res.json().catch(() => null) };
    };
  };
  const A = client2('prim-device-A01');
  const B = client2('prim-device-B01', 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile');
  const login = async (c) => {
    const opts = (await c('/api/admin/login-options')).data;
    return c('/api/admin/login', { method: 'POST', body: opts.pattern ? { code: CODE, pattern: '0-3-6-7-8' } : { code: CODE } });
  };
  // the earlier test may have left a pattern on; turn it off from a device that can
  assert.equal((await login(A)).status, 200);
  await A('/api/admin/pattern', { method: 'PUT', body: { code: CODE, pattern: '' } });
  assert.equal((await login(B)).status, 200);

  const list = async (c) => (await c('/api/admin/devices')).data.devices;
  const me = async (c) => (await list(c)).find((d) => d.current);
  assert.ok((await me(A)).lastIp, 'IP recorded for admin device');

  // A becomes primary (needs the code)
  assert.equal((await A('/api/admin/devices/lock', { method: 'PUT', body: { lock: true, code: 'wrong-code-xx' } })).status, 401);
  assert.equal((await A('/api/admin/devices/lock', { method: 'PUT', body: { lock: true, code: CODE } })).status, 200);
  const aKey = (await me(A)).id;
  assert.ok((await me(A)).locked);

  // B cannot lock, sign A out, remove A, change the code or the pattern
  assert.equal((await B('/api/admin/devices/lock', { method: 'PUT', body: { lock: true, code: CODE } })).status, 409);
  assert.equal((await B(`/api/admin/devices/${aKey}`, { method: 'DELETE' })).status, 403);
  assert.equal((await B(`/api/admin/devices/${aKey}?forget=1`, { method: 'DELETE' })).status, 403);
  assert.equal((await B('/api/admin/code', { method: 'POST', body: { current: CODE, next: 'another-code-123456' } })).status, 403);
  assert.equal((await B('/api/admin/pattern', { method: 'PUT', body: { code: CODE, pattern: '0-1-2-5' } })).status, 403);

  // B asks; only the primary can answer
  assert.equal((await B('/api/admin/devices/primary-request', { method: 'POST', body: { code: CODE } })).status, 200);
  const bKey = (await me(B)).id;
  assert.equal((await B(`/api/admin/devices/${bKey}/primary`, { method: 'POST', body: { approve: true } })).status, 403);
  assert.ok((await list(A)).find((d) => d.id === bKey).primaryRequest);
  // reject, ask again, approve
  assert.equal((await A(`/api/admin/devices/${bKey}/primary`, { method: 'POST', body: { approve: false } })).status, 200);
  assert.ok((await me(A)).locked);
  await B('/api/admin/devices/primary-request', { method: 'POST', body: { code: CODE } });
  assert.equal((await A(`/api/admin/devices/${bKey}/primary`, { method: 'POST', body: { approve: true } })).status, 200);
  assert.ok((await me(B)).locked);
  assert.ok(!(await me(A)).locked);

  // primary changes the code: stays signed in, A is signed out
  const ch = await B('/api/admin/code', { method: 'POST', body: { current: CODE, next: 'brand-new-primary-code' } });
  assert.equal(ch.status, 200);
  assert.equal(ch.data.relogin, false);
  assert.equal((await B('/api/admin/devices')).status, 200, 'primary still signed in');
  assert.equal((await A('/api/admin/devices')).status, 401, 'other device signed out');
  // put things back for any later tests
  await B('/api/admin/code', { method: 'POST', body: { current: 'brand-new-primary-code', next: CODE } });
  await B('/api/admin/devices/lock', { method: 'PUT', body: { lock: false } });
});
