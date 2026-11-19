import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { DEMO_BRACKET, SEED_IDEAS, SEED_POLLS } from './fixtures/demo.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-erasure-test-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234', demo: { ideas: SEED_IDEAS, polls: SEED_POLLS, bracket: DEMO_BRACKET } });

await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeClient(deviceId) {
  const jar = new Map();
  return async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
    const h = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': deviceId, ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jar.size) h.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + pathname, {
      method,
      headers: h,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers, text };
  };
}

const fan = makeClient('erase-fan-device-01');
const admin = makeClient('erase-admin-device-1');

async function loginAdmin() {
  const res = await admin('/api/admin/login', { method: 'POST', body: { code: 'test-admin-code-1234' } });
  assert.equal(res.status, 200);
}

test('fan nickname is stored without being written into the audit log', async () => {
  await loginAdmin();
  const gate = await admin('/api/admin/fan', { method: 'PATCH', body: { code: 'K7Q' } });
  assert.equal(gate.status, 200);

  const verify = await fan('/api/fan/verify', {
    method: 'POST',
    body: { nickname: '测试昵称小明', code: 'K7Q', crossBorderConsent: true, ageConfirm: true },
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.data.fan.nickname, '测试昵称小明');

  const rows = app.db.prepare("SELECT detail FROM audit_log WHERE action = 'fan.verify'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail, 'len=6');
  assert.ok(!rows[0].detail.includes('小明'));
});

test('erasure requires DELETE confirmation and the admin code', async () => {
  const list = await admin('/api/admin/erasure?type=fan');
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.labels.fan, '下载验证昵称');
  const target = list.data.items.find((item) => item.nickname === '测试昵称小明');
  assert.ok(target, '刚刚验证的昵称应该在列表里');

  const noConfirm = await admin('/api/admin/erasure/delete', {
    method: 'POST',
    body: { type: 'fan', id: target.id, code: 'test-admin-code-1234', confirm: 'yes' },
  });
  assert.equal(noConfirm.status, 400);

  const wrongCode = await admin('/api/admin/erasure/delete', {
    method: 'POST',
    body: { type: 'fan', id: target.id, code: 'definitely-wrong', confirm: 'DELETE' },
  });
  assert.equal(wrongCode.status, 403);
  assert.equal(wrongCode.data.error.code, 'invalid_code');

  const still = app.db.prepare('SELECT COUNT(*) AS n FROM fans').get().n;
  assert.equal(still, 1, '被拒绝的请求不能删掉任何数据');
});

test('erasure hard-deletes the fan row and scrubs legacy nickname audit rows', async () => {
  // 模拟旧版本留下的、detail 里带昵称的审计行
  app.db
    .prepare("INSERT INTO audit_log (action, detail, ip_hash, created_at) VALUES ('fan.verify', ?, '', ?)")
    .run('测试昵称小明', new Date().toISOString());

  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE target_type = 'fan'").get().n,
    1,
    'fan.verify 应写一条同意证据',
  );

  const list = await admin('/api/admin/erasure?type=fan');
  const target = list.data.items.find((item) => item.nickname === '测试昵称小明');

  const res = await admin('/api/admin/erasure/delete', {
    method: 'POST',
    body: { type: 'fan', id: target.id, code: 'test-admin-code-1234', confirm: 'DELETE' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.equal(res.data.removed, 1);
  assert.equal(res.data.related.audit, 1);
  assert.ok(res.data.related.consent >= 1, 'related 应该报告清理的同意证据数');

  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM fans').get().n, 0);
  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE detail = '测试昵称小明'").get().n,
    0,
    '旧审计里的昵称也要清掉',
  );
  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE target_type = 'fan'").get().n,
    0,
    '同意证据要与对应记录一起删除',
  );

  const after = await admin('/api/admin/erasure?type=fan');
  assert.equal(after.data.items.length, 0);
});

test('the delete action is audited without copying personal data', async () => {
  const row = app.db.prepare("SELECT detail FROM audit_log WHERE action = 'data.erase' ORDER BY id DESC LIMIT 1").get();
  assert.ok(row, '应该有 data.erase 审计记录');
  assert.match(row.detail, /^fan#/);
  assert.ok(!row.detail.includes('小明'));
  assert.ok(!row.detail.includes('测试昵称'));
});

test('deleting a sponsorship or profile also removes its consent evidence', async () => {
  const sponsor = makeClient('erase-sponsor-device-1');
  const claim = await sponsor('/api/me/claim', {
    method: 'POST',
    body: { name: '捐赠测试员', crossBorderConsent: true, ageConfirm: true },
  });
  assert.equal(claim.status, 200);
  const profileId = claim.data.me.id;

  const created = await sponsor('/api/sponsor', {
    method: 'POST',
    body: { method: 'wechat', amount: 66, note: '订单 66', message: '加油', anonymous: false, crossBorderConsent: true, ageConfirm: true },
  });
  assert.equal(created.status, 200);
  const sponsorshipId = created.data.id;

  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE target_type = 'sponsorship' AND target_id = ?").get(String(sponsorshipId)).n,
    1,
  );
  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE target_type = 'profile' AND target_id = ?").get(String(profileId)).n,
    1,
  );

  const dropSponsorship = await admin('/api/admin/erasure/delete', {
    method: 'POST',
    body: { type: 'sponsorship', id: sponsorshipId, code: 'test-admin-code-1234', confirm: 'DELETE' },
  });
  assert.equal(dropSponsorship.status, 200);
  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE target_type = 'sponsorship'").get().n,
    0,
  );

  const dropProfile = await admin('/api/admin/erasure/delete', {
    method: 'POST',
    body: { type: 'profile', id: profileId, code: 'test-admin-code-1234', confirm: 'DELETE' },
  });
  assert.equal(dropProfile.status, 200);
  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM consent_records WHERE target_type = 'profile'").get().n,
    0,
  );
});

test('erasure rejects unknown types and malformed identifiers', async () => {
  const badType = await admin('/api/admin/erasure?type=everything');
  assert.equal(badType.status, 400);
  const badId = await admin('/api/admin/erasure/delete', {
    method: 'POST',
    body: { type: 'fan', id: 'x', code: 'test-admin-code-1234', confirm: 'DELETE' },
  });
  assert.equal(badId.status, 400);
});
