import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-local-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234', adminLocalOnly: true, trustProxy: true, secureCookies: true, monitor: false });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
test.after(() => app.server.close());

const viaCaddy = { 'X-Forwarded-For': '203.0.113.9', Host: 'wuye.uniquetalentmap.com' };

test('ADMIN_LOCAL_ONLY: admin does not exist from the internet', async () => {
  for (const p of ['/admin', '/admin.html', '/admin-login', '/admin.js', '/admin.css', '/monitor.js', '/admin/monitor', '/api/admin/me']) {
    const r = await fetch(base + p, { headers: viaCaddy, redirect: 'manual' });
    assert.equal(r.status, 404, p);
  }
  const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { ...viaCaddy, 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ code: 'test-admin-code-1234' }) });
  assert.equal(login.status, 404);
  // Public pages still work through the proxy.
  assert.equal((await fetch(`${base}/polls`, { headers: viaCaddy })).status, 200);
});

test('ADMIN_LOCAL_ONLY: works through an SSH tunnel (localhost), with a cookie usable over http', async () => {
  assert.equal((await fetch(`${base}/admin`, { redirect: 'manual' })).status < 400, true);
  const r = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-Device-Id': 'tunnel-device-1' }, body: JSON.stringify({ code: 'test-admin-code-1234' }) });
  assert.equal(r.status, 200);
  assert.ok(!/;\s*Secure/i.test(r.headers.get('set-cookie')), 'no Secure flag on http://localhost');
});
