import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-sponsor-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234' });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.server.address().port}`;
test.after(async () => { await app.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function client(deviceId) {
  const jar = new Map();
  return async (p, { method = 'GET', body } = {}) => {
    const h = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': deviceId };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}
const a = client('sp-device-000a');
const b = client('sp-device-000b');
const admin = client('sp-admin-0001');
await admin('/api/admin/login', { method: 'POST', body: { code: 'test-admin-code-1234' } });

test('names: claim, taken, restore on another device, forget', async () => {
  const c = await a('/api/me/claim', { method: 'POST', body: { name: '星穹旅人', crossBorderConsent: true, ageConfirm: true } });
  assert.equal(c.status, 200);
  assert.match(c.data.key, /^WY-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal((await b('/api/me/claim', { method: 'POST', body: { name: '星穹旅人', crossBorderConsent: true, ageConfirm: true } })).status, 409);
  assert.equal((await b('/api/me/restore', { method: 'POST', body: { name: '星穹旅人', key: 'WY-AAAA-AAAA', crossBorderConsent: true, ageConfirm: true } })).status, 401);
  const r = await b('/api/me/restore', { method: 'POST', body: { name: '星穹旅人', key: c.data.key, crossBorderConsent: true, ageConfirm: true } });
  assert.equal(r.data.me.name, '星穹旅人');
  await b('/api/me/forget', { method: 'POST' });
  assert.equal((await b('/api/me')).data.me, null);
});

test('sponsorship amounts stay admin-only', async () => {
  const s = await a('/api/sponsor', { method: 'POST', body: { method: 'wechat', amount: 66, note: '星穹', message: '加油', anonymous: false, crossBorderConsent: true, ageConfirm: true } });
  assert.equal(s.status, 200);
  let board = await a('/api/leaderboard');
  assert.equal(board.data.sponsors.length, 0, 'pending is not on the board');
  const list = await admin('/api/admin/sponsorships');
  assert.equal(list.data.items[0].amountCents, 6600);
  await admin(`/api/admin/sponsorships/${list.data.items[0].id}`, { method: 'PATCH', body: { status: 'confirmed' } });
  board = await b('/api/leaderboard');
  assert.equal(board.data.sponsors[0].name, '星穹旅人');
  assert.ok(!JSON.stringify(board.data).includes('6600') && !/amount/i.test(JSON.stringify(board.data)));
  assert.ok(!/amount/i.test(JSON.stringify((await a('/api/sponsor')).data.mine)));
  assert.equal((await a('/api/admin/sponsorships')).status, 401);
});

test('new wishes wait for approval; one vote per wish per IP', async () => {
  const w = await a('/api/ideas', { method: 'POST', body: { title: '测试许愿·纯美女神', description: '想看纯美女神的模组，做成一个完整的Boss战吧', category: 'aeon', crossBorderConsent: true, ageConfirm: true } });
  assert.equal(w.status, 201);
  const id = w.data.idea.id;
  assert.equal((await a(`/api/ideas/${id}/vote`, { method: 'POST' })).status, 404, 'cannot vote before approval');
  const ok = await admin(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { status: 'open' } });
  assert.equal(ok.status, 200);
  const v1 = await a(`/api/ideas/${id}/vote`, { method: 'POST' });
  assert.equal(v1.status, 200);
  const again = await a(`/api/ideas/${id}/vote`, { method: 'POST' });
  assert.equal(again.data.votes, v1.data.votes, 'same device cannot vote twice');
  const other = await b(`/api/ideas/${id}/vote`, { method: 'POST' });
  assert.equal(other.status, 409, 'second device on the same IP is locked out');
});

test('admin can add and remove bot votes, never below zero', async () => {
  const list = await admin('/api/admin/ideas');
  const idea = list.data.items.find((i) => !i.hidden);
  const before = Number(idea.votes);
  const up = await admin(`/api/admin/ideas/${idea.id}`, { method: 'PATCH', body: { addVotes: 50 } });
  assert.equal(up.status, 200);
  assert.equal(up.data.idea.votes, before + 50);
  const down = await admin(`/api/admin/ideas/${idea.id}`, { method: 'PATCH', body: { addVotes: -1000000 + 1 } });
  assert.equal(down.status, 400, 'absurd numbers rejected');
  const floor = await admin(`/api/admin/ideas/${idea.id}`, { method: 'PATCH', body: { addVotes: -99999 } });
  assert.equal(floor.data.idea.votes, 0);
  assert.equal((await a(`/api/admin/ideas/${idea.id}`, { method: 'PATCH', body: { addVotes: 5 } })).status, 401);
});

test('admin can adjust, hide and add names on both leaderboards', async () => {
  const put = (body) => admin('/api/admin/boards', { method: 'PUT', body });
  assert.equal((await put({ board: 'stars', name: '手动加的人', adjust: 500 })).status, 200);
  assert.equal((await put({ board: 'sponsors', name: '神秘老板', adjust: 999 })).status, 200);
  let lb = (await a('/api/leaderboard')).data;
  assert.deepEqual(lb.stars[0], { rank: 1, name: '手动加的人', points: 500 });
  assert.equal(lb.sponsors[0].name, '神秘老板');
  assert.ok(!/999/.test(JSON.stringify(lb.sponsors)), 'sponsor amounts stay private');
  await put({ board: 'sponsors', name: '星穹旅人', hidden: true });
  lb = (await a('/api/leaderboard')).data;
  assert.ok(!lb.sponsors.some((s) => s.name === '星穹旅人'));
  const view = (await admin('/api/admin/boards')).data;
  assert.ok(view.sponsors.list.find((r) => r.name === '星穹旅人').real === 66);
  assert.equal((await a('/api/admin/boards')).status, 401);
});
