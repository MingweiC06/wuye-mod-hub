import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { setSponsorConfig } from '../lib/sponsor.js';
import { DEMO_BRACKET, SEED_IDEAS, SEED_POLLS } from './fixtures/demo.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-privacy-test-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234', demo: { ideas: SEED_IDEAS, polls: SEED_POLLS, bracket: DEMO_BRACKET } });
setSponsorConfig(app.db, { wechat: '/media/test-wechat.png' }); // the sponsor form only accepts methods that have a QR

await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const PAGES = ['/', '/ideas', '/polls', '/downloads', '/leaderboard', '/sponsor', '/rules'];

test('privacy policy page is served and covers every collected field', async () => {
  const res = await fetch(`${base}/privacy`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();

  assert.match(html, /<title>隐私政策/);
  assert.match(html, /我们会保存什么/);
  assert.match(html, /保存多久/);
  assert.match(html, /未成年人/);
  assert.match(html, /wy_vid/);
  assert.match(html, /抖音昵称/);
  assert.match(html, /User-Agent/);
  assert.match(html, /删除/);
  assert.match(html, /27276177171/);
  assert.match(html, /<link rel="stylesheet" href="\/privacy\.css/);

  // 严格 CSP 下不允许内联样式
  assert.doesNotMatch(html, /\sstyle="/);
});

test('privacy stylesheet is served from the same origin', async () => {
  const res = await fetch(`${base}/privacy.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
});

test('rules FAQ matches the real nickname collection behaviour', async () => {
  const res = await fetch(`${base}/rules`);
  assert.equal(res.status, 200);
  const html = await res.text();

  assert.match(html, /不会去验证或关联你的抖音账号/);
  assert.match(html, /解锁下载/);
  assert.match(html, /href="\/privacy"/);
  assert.doesNotMatch(html, /不会。本站与抖音账号体系完全独立/);
  assert.doesNotMatch(html, /<p>不会。<\/p>/);
});

test('every public page links to the privacy policy in its footer', async () => {
  for (const page of PAGES) {
    const res = await fetch(`${base}${page}`);
    assert.equal(res.status, 200, `${page} should return 200`);
    const html = await res.text();
    assert.match(html, /<a href="\/privacy">隐私政策<\/a>/, `${page} footer should link to /privacy`);
  }
});

test('privacy page does not leak secrets or server paths', async () => {
  const html = await (await fetch(`${base}/privacy`)).text();
  assert.doesNotMatch(html, /\/opt\/wuye/);
  assert.doesNotMatch(html, /relay-secret/);
  assert.doesNotMatch(html, /admin-code/);
});

test('privacy page v2 explains cross-border, retention, minors and processor identity', async () => {
  const html = await (await fetch(`${base}/privacy`)).text();
  assert.match(html, /id="cross-border"/);
  assert.match(html, /美国弗吉尼亚北部/);
  assert.match(html, /us-ashburn-1/);
  assert.match(html, /EdgeOne[^<]{0,20}未启用|尚未启用/);
  assert.match(html, /Backblaze B2/);
  assert.match(html, /180 天/);
  assert.match(html, /7 个工作日/);
  assert.match(html, /不满 14 周岁/);
  assert.match(html, /以「乌叶MC」身份个人运营/);
  assert.match(html, /版本 v3/);
  assert.match(html, /90 天后自动删除/);
  assert.match(html, /href="#cross-border"/);
});

function cookieClient() {
  const jar = new Map();
  return async function request(pathname, { method = 'GET', body } = {}) {
    const headers = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': 'privacy-test-device-1' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.size) headers.cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + pathname, {
      method,
      headers,
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
    return { status: res.status, data, headers: res.headers };
  };
}

test('wy_vid cookie lasts 180 days and slides on writes, not on page reads', async () => {
  const client = cookieClient();
  const visit = await client('/api/site');
  assert.equal(visit.status, 200);
  const first = visit.headers.getSetCookie().find((c) => c.startsWith('wy_vid='));
  assert.ok(first, 'first API request should set wy_vid');
  assert.match(first, /Max-Age=15552000/);
  assert.match(first, /HttpOnly/i);
  assert.match(first, /SameSite=Lax/i);

  const read = await client('/api/site');
  assert.equal(read.status, 200);
  assert.equal(
    read.headers.getSetCookie().filter((c) => c.startsWith('wy_vid=')).length,
    0,
    'reading a page/API must not extend the cookie',
  );

  const write = await client('/api/ideas', {
    method: 'POST',
    body: { title: '跨境同意测试标题', description: '这是一段足够长的许愿描述内容。', category: 'aeon', crossBorderConsent: true, ageConfirm: true },
  });
  assert.ok([200, 201].includes(write.status), `unexpected status ${write.status}`);
  const refreshed = write.headers.getSetCookie().find((c) => c.startsWith('wy_vid='));
  assert.ok(refreshed, 'a successful write should refresh the cookie');
  assert.match(refreshed, /Max-Age=15552000/);
});

test('submitting personal data without consent is rejected before it is stored', async () => {
  const client = cookieClient();
  const idea = await client('/api/ideas', {
    method: 'POST',
    body: { title: '没有勾选同意的标题', description: '这是一段足够长的许愿描述内容。', category: 'aeon' },
  });
  assert.equal(idea.status, 400);
  assert.equal(idea.data.error.code, 'consent_required');
  assert.match(idea.data.error.message, /个人信息出境/);

  const sponsor = await client('/api/sponsor', {
    method: 'POST',
    body: { method: 'wechat', amount: 10, note: '', message: '' },
  });
  assert.equal(sponsor.status, 400);
  assert.equal(sponsor.data.error.code, 'consent_required');

  const claim = await client('/api/me/claim', { method: 'POST', body: { name: '没同意就起名' } });
  assert.equal(claim.status, 400);
  assert.equal(claim.data.error.code, 'consent_required');

  const fan = await client('/api/fan/verify', { method: 'POST', body: { nickname: '没同意', code: 'ABC' } });
  assert.equal(fan.status, 400);
  assert.equal(fan.data.error.code, 'consent_required');
});

test('public forms expose separate consent and age checkboxes', async () => {
  for (const [page, id, ageId] of [
    ['/ideas', 'idea-consent', 'idea-age'],
    ['/downloads', 'gate-consent', 'gate-age'],
    ['/sponsor', 'sp-consent', 'sp-age'],
    ['/', 'nick-consent', 'nick-age'],
  ]) {
    const html = await (await fetch(`${base}${page}`)).text();
    assert.match(html, new RegExp(`id="${id}"`), `${page} should contain #${id}`);
    assert.match(html, /name="crossBorderConsent"/, `${page} checkbox should be named`);
    assert.match(html, /href="\/privacy#cross-border"/, `${page} should link to the cross-border section`);
    assert.match(html, new RegExp(`id="${ageId}"`), `${page} should contain #${ageId}`);
    assert.match(html, /name="ageConfirm"/, `${page} should ask for age confirmation`);
  }
});

test('age confirmation is required before personal data is stored', async () => {
  const client = cookieClient();
  const res = await client('/api/ideas', {
    method: 'POST',
    body: {
      title: '只勾同意没勾年龄',
      description: '这是一段足够长的许愿描述内容。',
      category: 'aeon',
      crossBorderConsent: true,
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error.code, 'age_required');
  assert.match(res.data.error.message, /14 周岁/);
  assert.equal(
    app.db.prepare("SELECT COUNT(*) AS n FROM ideas WHERE title = '只勾同意没勾年龄'").get().n,
    0,
    'nothing should be stored when the age confirmation is missing',
  );
});

test('consent evidence stores version, purpose, target and no personal content', async () => {
  const client = cookieClient();
  const title = '同意证据留痕测试标题';
  const res = await client('/api/ideas', {
    method: 'POST',
    body: {
      title,
      description: '这是一段足够长的许愿描述内容，用来验证同意证据只记录元数据。',
      category: 'aeon',
      author: '证据测试员',
      crossBorderConsent: true,
      ageConfirm: true,
    },
  });
  assert.ok([200, 201].includes(res.status), `unexpected status ${res.status}`);
  const ideaId = res.data.idea && res.data.idea.id;
  assert.ok(ideaId, 'created idea should have an id');

  const rows = app.db.prepare("SELECT * FROM consent_records WHERE target_type = 'idea' AND target_id = ?").all(String(ideaId));
  assert.equal(rows.length, 1, 'exactly one consent record should exist');
  const row = rows[0];
  assert.equal(row.scope, 'cross-border');
  assert.equal(row.policy_version, '2026-11-19');
  assert.equal(row.purpose, 'idea.create');
  assert.equal(row.age_confirmed, 1);
  assert.match(row.voter_key, /^[0-9a-f]{16,}$/i, 'voter_key 应该是设备 HMAC 摘要');
  assert.equal(typeof row.created_at, 'number');
  assert.ok(row.created_at > 0);

  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes(title), false, 'consent evidence must not copy the submitted content');
  assert.equal(serialized.includes('证据测试员'), false, 'consent evidence must not copy the nickname');

  const audit = app.db
    .prepare("SELECT detail FROM audit_log WHERE action = 'consent.cross-border' ORDER BY id DESC LIMIT 1")
    .get();
  assert.ok(audit, 'a consent audit event should exist');
  assert.match(audit.detail, /idea\.create/);
  assert.match(audit.detail, /2026-11-19/);
});

