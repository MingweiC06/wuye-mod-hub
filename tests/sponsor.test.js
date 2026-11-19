import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { setSponsorConfig } from '../lib/sponsor.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-sponsor-'));
const app = createApp({ dataDir, adminCode: 'test-admin-code-1234' });
setSponsorConfig(app.db, { wechat: '/media/test-wechat.png' }); // the sponsor form only accepts methods that have a QR
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
  // real vs bot split for the ✎ dialog
  await admin(`/api/admin/ideas/${idea.id}`, { method: 'PATCH', body: { addVotes: 7 } });
  const v = await admin(`/api/admin/ideas/${idea.id}/votes`);
  assert.equal(v.status, 200);
  assert.equal(v.data.total, v.data.real + v.data.bot);
  assert.equal(v.data.total, 7);
  assert.equal((await a(`/api/admin/ideas/${idea.id}/votes`)).status, 401);
});

test('admin can lower real votes (never above what fans cast) and set bot votes', async () => {
  const list = await admin('/api/admin/ideas');
  const idea = list.data.items.filter((i) => !i.hidden).sort((x, y) => y.votes - x.votes)[0];
  // give it some real votes from fans
  for (const dev of ['cut-fan-0001', 'cut-fan-0002', 'cut-fan-0003']) await client(dev)(`/api/ideas/${idea.id}/vote`, { method: 'POST' });
  const v0 = (await admin(`/api/admin/ideas/${idea.id}/votes`)).data;
  assert.ok(v0.original >= 1);
  const put = (body) => admin(`/api/admin/ideas/${idea.id}/votes`, { method: 'PUT', body });
  assert.equal((await put({ real: v0.original + 1, bot: 0 })).status, 400, 'cannot raise real votes');
  assert.equal((await put({ real: -1, bot: 0 })).status, 400);
  assert.equal((await put({ real: 0, bot: -1 })).status, 400, 'total cannot go below zero');
  const r = await put({ real: v0.original - 1, bot: 10 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.real, r.data.cut, r.data.bot, r.data.total], [v0.original - 1, 1, 10, v0.original + 9]);
  const board = (await a('/api/board')).data;
  const shown = [...board.voting, ...board.accepted, ...board.building].find((c) => c.id === idea.id);
  if (shown) assert.equal(shown.votes, v0.original + 9);
  assert.equal((await admin('/api/admin/vote-cuts')).data.cuts[idea.id], 1);
  assert.equal((await a('/api/admin/vote-cuts')).status, 401);
  assert.equal((await client('cut-fan-0009')(`/api/admin/ideas/${idea.id}/votes`, { method: 'PUT', body: { real: 0, bot: 0 } })).status, 401);
  // restore
  assert.equal((await put({ real: v0.original, bot: 0 })).data.cut, 0);
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

test('sponsor form is refused for a method without a QR code', async () => {
  const r = await a('/api/sponsor', { method: 'POST', body: { method: 'alipay', amount: 10, crossBorderConsent: true, ageConfirm: true } });
  assert.equal(r.status, 400);
});

test('admin can delete fan names, sponsorship records and board names', async () => {
  const fan = client('sp-device-del1');
  const c = await fan('/api/me/claim', { method: 'POST', body: { name: '删我测试', crossBorderConsent: true, ageConfirm: true } });
  assert.equal(c.status, 200);
  const s = await fan('/api/sponsor', { method: 'POST', body: { method: 'wechat', amount: 8, crossBorderConsent: true, ageConfirm: true } });
  assert.equal(s.status, 200);
  await admin(`/api/admin/sponsorships/${s.data.id}`, { method: 'PATCH', body: { status: 'confirmed' } });
  const names = async () => (await admin('/api/admin/boards')).data.sponsors.list.map((r) => r.name);
  assert.ok((await names()).includes('删我测试'));
  assert.equal((await admin('/api/admin/boards', { method: 'DELETE', body: { board: 'sponsors', name: '删我测试' } })).status, 200);
  assert.ok(!(await names()).includes('删我测试'));
  const s2 = await fan('/api/sponsor', { method: 'POST', body: { method: 'wechat', amount: 3, crossBorderConsent: true, ageConfirm: true } });
  assert.equal((await admin(`/api/admin/sponsorships/${s2.data.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await admin('/api/admin/sponsorships')).data.items.some((x) => x.id === s2.data.id));
  const p = (await admin('/api/admin/profiles')).data.items.find((x) => x.name === '删我测试');
  assert.equal((await admin(`/api/admin/profiles/${p.id}`, { method: 'DELETE' })).status, 200);
  assert.ok(!(await admin('/api/admin/profiles')).data.items.some((x) => x.name === '删我测试'));
  assert.equal((await admin(`/api/admin/profiles/${p.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await fan('/api/admin/profiles/1', { method: 'DELETE' })).status, 401);
});

test('admin can add a card straight onto the vote board', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const r = await admin('/api/admin/cards', { method: 'POST', body: { title: '新卡测试', game: '原神', description: '一句话', status: 'planned', image: png } });
  assert.equal(r.status, 200);
  const board = (await a('/api/board')).data;
  const c = board.accepted.find((x) => x.id === r.data.id);
  assert.ok(c, 'shows up in 备选区 right away');
  assert.equal(c.game, '原神');
  assert.match(c.image, /^\/media\//);
  // owner note: set on create, shown on the board, editable later
  const n = await admin('/api/admin/cards', { method: 'POST', body: { title: '带备注', note: '下个月开做' } });
  const nb = (await a('/api/board')).data.voting.find((x) => x.id === n.data.id);
  assert.equal(nb.note, '下个月开做');
  await admin(`/api/admin/ideas/${n.data.id}`, { method: 'PATCH', body: { officialReply: '已改' } });
  assert.equal((await admin(`/api/admin/ideas/${n.data.id}/votes`)).data.note, '已改');
  const v = await admin('/api/admin/cards', { method: 'POST', body: { title: '投票区新卡' } });
  assert.ok((await a('/api/board')).data.voting.some((x) => x.id === v.data.id));
  assert.equal((await admin('/api/admin/cards', { method: 'POST', body: { title: '' } })).status, 400);
  assert.equal((await admin('/api/admin/cards', { method: 'POST', body: { title: 'x', status: 'released' } })).status, 400);
  assert.equal((await a('/api/admin/cards', { method: 'POST', body: { title: '偷偷加' } })).status, 401);
});

test('许愿池 and the vote page never share a card; 转到投票 moves a wish over', async () => {
  const fan = client('wish-fan-0001');
  const sub = await fan('/api/ideas', { method: 'POST', body: { title: '想要一个时间停止技能', description: '按下按键全场静止三秒，冷却三十秒', category: 'gameplay', crossBorderConsent: true, ageConfirm: true } });
  assert.equal(sub.status, 201);
  const id = sub.data.idea.id;
  // admin approves → it becomes a wish
  assert.equal((await admin(`/api/admin/ideas/${id}`, { method: 'PATCH', body: { status: 'wish' } })).status, 200);
  const pool = (await a('/api/ideas?pool=1&pageSize=24&sort=new')).data.items;
  assert.ok(pool.some((x) => x.id === id), 'wish is in the 许愿池');
  assert.ok(pool.every((x) => x.status === 'wish'), '许愿池 only shows wishes');
  const inBoard = (b) => [...b.voting, ...b.accepted, ...b.building, ...b.done].some((x) => x.id === id);
  assert.ok(!inBoard((await a('/api/board')).data), 'wish is not on the vote page');
  // fans can still +1 it
  assert.equal((await fan(`/api/ideas/${id}/vote`, { method: 'POST' })).status, 200);
  // 转到投票
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal((await a(`/api/admin/cards/${id}/promote`, { method: 'POST', body: { title: 'x' } })).status, 401);
  const p = await admin(`/api/admin/cards/${id}/promote`, { method: 'POST', body: { title: '时间停止', game: '原创', description: '全场静止三秒', note: '下期考虑', status: 'open', image: png } });
  assert.equal(p.status, 200);
  const board = (await a('/api/board')).data;
  const card = board.voting.find((x) => x.id === id);
  assert.ok(card, 'now on the vote page');
  assert.equal(card.title, '时间停止');
  assert.equal(card.note, '下期考虑');
  assert.match(card.image, /^\/media\//);
  assert.ok(card.votes >= 1, 'votes carried over');
  assert.ok(!(await a('/api/ideas?pool=1&pageSize=24&sort=new')).data.items.some((x) => x.id === id), 'gone from the 许愿池');
});
