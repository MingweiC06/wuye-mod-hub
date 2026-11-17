import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-test-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234' });

await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;

test.after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function makeClient(deviceId) {
  const jar = new Map();
  return async function request(pathname, { method = 'GET', body, headers = {}, csrf = true } = {}) {
    const h = {
      ...(csrf ? { 'x-requested-with': 'XMLHttpRequest' } : {}),
      'x-device-id': deviceId,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    };
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

const client = makeClient('test-device-0001');
const adminClient = makeClient('test-admin-device-01');

test('health and site payload', async () => {
  const health = await client('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const site = await client('/api/site');
  assert.equal(site.status, 200);
  assert.equal(site.data.site.name, '乌叶MC');
  assert.equal(site.data.videos.length, 4);
  assert.equal(site.data.categories.length, 7);
  assert.equal(site.data.stats.ideas, 18);
  assert.equal(site.data.stats.votes, 680);
  assert.equal(site.data.stats.openPolls, 2);
  assert.match(site.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(site.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(site.headers.get('cache-control'), 'no-store');
});

test('idea list, detail, filters and pagination', async () => {
  const list = await client('/api/ideas?sort=hot&pageSize=5');
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 17);
  assert.equal(list.data.items.length, 5);
  assert.equal(list.data.hasMore, true);
  assert.ok(list.data.items[0].votes >= list.data.items[1].votes);

  const second = await client('/api/ideas?sort=hot&pageSize=5&page=2');
  assert.equal(second.data.items.length, 5);

  const aeon = await client('/api/ideas?category=aeon&pageSize=24');
  assert.ok(aeon.data.items.every((idea) => idea.category === 'aeon'));

  const detail = await client(`/api/ideas/${list.data.items[0].id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.idea.id, list.data.items[0].id);

  const missing = await client('/api/ideas/999999');
  assert.equal(missing.status, 404);
});

test('idea creation validation and anti-spam', async () => {
  const shortTitle = await client('/api/ideas', {
    method: 'POST',
    body: { title: '太短', description: '这是一个长度足够十个字的测试描述内容。', category: 'aeon' },
  });
  assert.equal(shortTitle.status, 400);

  const badCategory = await client('/api/ideas', {
    method: 'POST',
    body: { title: '一个正常长度的标题', description: '这是一个长度足够十个字的测试描述内容。', category: 'nope' },
  });
  assert.equal(badCategory.status, 400);

  const banned = await client('/api/ideas', {
    method: 'POST',
    body: {
      title: '加微信领取模组',
      description: '这是一个长度足够十个字的测试描述内容，加微信即可领取。',
      category: 'other',
    },
  });
  assert.equal(banned.status, 400);

  const honeypot = await client('/api/ideas', {
    method: 'POST',
    body: {
      title: '机器人提交的测试标题',
      description: '这是一个长度足够十个字的测试描述内容。',
      category: 'other',
      website: 'http://spam.example',
    },
  });
  assert.equal(honeypot.status, 400);

  const created = await client('/api/ideas', {
    method: 'POST',
    body: {
      title: '测试：让星神跳科目三',
      description: '纯粹用于联调测试的灵感描述，长度足够十个字以上。',
      category: 'other',
      author: '测试员',
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.idea.status, 'pending');
  assert.equal(created.data.idea.votes, 0);

  const duplicate = await client('/api/ideas', {
    method: 'POST',
    body: {
      title: '测试：让星神跳科目三',
      description: '重复的标题应该被识别出来，这是另一段描述。',
      category: 'other',
    },
  });
  assert.equal(duplicate.status, 409);
});

test('voting is idempotent per device and can be undone', async () => {
  const list = await client('/api/ideas?sort=hot&pageSize=5');
  const testIdea = list.data.items[0];
  assert.ok(testIdea, 'seed idea should be public');
  const ideaId = testIdea.id;
  const baseVotes = testIdea.votes;

  const vote = await client(`/api/ideas/${ideaId}/vote`, { method: 'POST' });
  assert.equal(vote.status, 200);
  assert.equal(vote.data.voted, true);
  assert.equal(vote.data.votes, baseVotes + 1);

  const again = await client(`/api/ideas/${ideaId}/vote`, { method: 'POST' });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicated, true);
  assert.equal(again.data.votes, baseVotes + 1);

  const unvote = await client(`/api/ideas/${ideaId}/vote`, { method: 'DELETE' });
  assert.equal(unvote.data.votes, baseVotes);
  assert.equal(unvote.data.voted, false);

  const otherClient = makeClient('test-device-0002');
  const otherVote = await otherClient(`/api/ideas/${ideaId}/vote`, { method: 'POST' });
  assert.equal(otherVote.data.votes, baseVotes + 1);
});

test('poll voting enforces rules', async () => {
  const polls = await client('/api/polls');
  assert.equal(polls.status, 200);
  const [openPoll, multiPoll, closedPoll] = polls.data.items;
  assert.equal(openPoll.status, 'open');
  assert.equal(openPoll.allowMultiple, false);
  assert.equal(multiPoll.allowMultiple, true);
  assert.equal(closedPoll.status, 'closed');

  const noChoice = await client(`/api/polls/${openPoll.id}/vote`, { method: 'POST', body: { optionIds: [] } });
  assert.equal(noChoice.status, 400);

  const tooMany = await client(`/api/polls/${openPoll.id}/vote`, {
    method: 'POST',
    body: { optionIds: openPoll.options.slice(0, 2).map((option) => option.id) },
  });
  assert.equal(tooMany.status, 400);

  const invalid = await client(`/api/polls/${openPoll.id}/vote`, { method: 'POST', body: { optionIds: [999999] } });
  assert.equal(invalid.status, 400);

  const voted = await client(`/api/polls/${openPoll.id}/vote`, {
    method: 'POST',
    body: { optionIds: [openPoll.options[0].id] },
  });
  assert.equal(voted.status, 200);
  assert.deepEqual(voted.data.poll.myVote, [openPoll.options[0].id]);
  assert.equal(voted.data.poll.totalBallots, openPoll.totalBallots + 1);

  const duplicate = await client(`/api/polls/${openPoll.id}/vote`, {
    method: 'POST',
    body: { optionIds: [openPoll.options[1].id] },
  });
  assert.equal(duplicate.status, 409);

  const closed = await client(`/api/polls/${closedPoll.id}/vote`, {
    method: 'POST',
    body: { optionIds: [closedPoll.options[0].id] },
  });
  assert.equal(closed.status, 409);

  const multiVote = await client(`/api/polls/${multiPoll.id}/vote`, {
    method: 'POST',
    body: { optionIds: multiPoll.options.slice(0, 2).map((option) => option.id) },
  });
  assert.equal(multiVote.status, 200);
  assert.equal(multiVote.data.poll.myVote.length, 2);
});

test('CSRF guard rejects header-less and cross-origin writes', async () => {
  const noHeader = await client('/api/ideas', {
    method: 'POST',
    csrf: false,
    body: { title: '跨站请求测试标题', description: '这是一段长度足够的跨站请求测试描述。', category: 'other' },
  });
  assert.equal(noHeader.status, 403);

  const badOrigin = await client('/api/ideas', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: { title: '来源校验测试标题', description: '这是一段长度足够的来源校验测试描述。', category: 'other' },
  });
  assert.equal(badOrigin.status, 403);
});

test('admin auth, overview and management', async () => {
  const denied = await adminClient('/api/admin/overview');
  assert.equal(denied.status, 401);

  const wrong = await adminClient('/api/admin/login', { method: 'POST', body: { code: 'wrong-code' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error.code, 'invalid_code');

  const login = await adminClient('/api/admin/login', {
    method: 'POST',
    body: { code: 'test-admin-code-1234' },
  });
  assert.equal(login.status, 200);
  assert.ok(login.data.expiresAt > Date.now());

  const me = await adminClient('/api/admin/me');
  assert.equal(me.data.authed, true);
  assert.equal(me.data.mustChange, false);

  const overview = await adminClient('/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.ok(overview.data.pending.length >= 1);
  assert.ok(overview.data.polls.length >= 3);

  const pendingIdea = overview.data.pending[0];
  const patched = await adminClient(`/api/admin/ideas/${pendingIdea.id}`, {
    method: 'PATCH',
    body: { status: 'planned', officialReply: '收到，排进下期清单。', pinned: true },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.idea.status, 'planned');
  assert.equal(patched.data.idea.officialReply, '收到，排进下期清单。');
  assert.equal(patched.data.idea.pinned, true);

  const hidden = await adminClient(`/api/admin/ideas/${pendingIdea.id}`, {
    method: 'PATCH',
    body: { hidden: true },
  });
  assert.equal(hidden.status, 200);
  const hiddenList = await adminClient('/api/admin/ideas?status=hidden');
  assert.equal(hiddenList.data.items.some((idea) => idea.id === pendingIdea.id), true);

  const publicAfterHide = await client(`/api/ideas/${pendingIdea.id}`);
  assert.equal(publicAfterHide.status, 404);

  const deleted = await adminClient(`/api/admin/ideas/${pendingIdea.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);

  const settings = await adminClient('/api/admin/settings', {
    method: 'PATCH',
    body: { announcement: '测试公告：今晚八点直播。' },
  });
  assert.equal(settings.status, 200);
  const site = await client('/api/site');
  assert.equal(site.data.site.announcement, '测试公告：今晚八点直播。');
});

test('admin creates and manages a poll', async () => {
  const created = await adminClient('/api/admin/polls', {
    method: 'POST',
    body: {
      title: '测试投票：下期做什么',
      description: '这是测试用的投票说明',
      options: [
        { label: '选项一', description: '选项一的说明' },
        { label: '选项二' },
      ],
      allowMultiple: false,
      endsAt: new Date(Date.now() + 2 * 86400_000).toISOString(),
    },
  });
  assert.equal(created.status, 201);
  const poll = created.data.poll;
  assert.equal(poll.options.length, 2);
  assert.equal(poll.status, 'open');

  const badEnds = await adminClient(`/api/admin/polls/${poll.id}`, {
    method: 'PATCH',
    body: { endsAt: new Date(Date.now() - 60_000).toISOString() },
  });
  assert.equal(badEnds.status, 400);

  const closed = await adminClient(`/api/admin/polls/${poll.id}`, {
    method: 'PATCH',
    body: { status: 'closed' },
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.data.poll.status, 'closed');

  const removed = await adminClient(`/api/admin/polls/${poll.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);

  const publicPolls = await client('/api/polls');
  assert.equal(publicPolls.data.items.some((item) => item.id === poll.id), false);
});

test('admin exports CSV with escaped cells', async () => {
  const csv = await adminClient('/api/admin/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /标题/);
  assert.match(csv.text, /繁育/);
  assert.match(csv.headers.get('content-disposition'), /attachment/);
});

test('admin code change revokes sessions', async () => {
  const client2 = makeClient('test-admin-device-02');
  const login = await client2('/api/admin/login', { method: 'POST', body: { code: 'test-admin-code-1234' } });
  assert.equal(login.status, 200);

  const changed = await client2('/api/admin/code', {
    method: 'POST',
    body: { current: 'test-admin-code-1234', next: 'brand-new-admin-code-5678' },
  });
  assert.equal(changed.status, 200);

  const me = await client2('/api/admin/me');
  assert.equal(me.data.authed, false);

  const oldCode = await client2('/api/admin/login', { method: 'POST', body: { code: 'test-admin-code-1234' } });
  assert.equal(oldCode.status, 401);

  const newCode = await client2('/api/admin/login', { method: 'POST', body: { code: 'brand-new-admin-code-5678' } });
  assert.equal(newCode.status, 200);
});

test('static assets are served, traversal is blocked', async () => {
  const asset = await fetch(`${base}/assets/avatar.jpg`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'image/jpeg');
  assert.match(asset.headers.get('cache-control'), /max-age/);

  const traversal = await fetch(`${base}/assets/%2e%2e/%2e%2e/server.js`);
  assert.notEqual(traversal.status, 200);

  const hidden = await fetch(`${base}/../data/admin-code.txt`);
  assert.notEqual(hidden.status, 200);
});
