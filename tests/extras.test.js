import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { parseCommentPaste, parseDouyinId } from '../lib/extras.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-extras-'));
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
    return { status: res.status, data, headers: res.headers };
  };
}
const fan = client('fan-device-0001');
const fan2 = client('fan-device-0002');
const admin = client('admin-device-0001');
const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'x-requested-with': 'XMLHttpRequest', 'content-type': 'application/json', 'x-device-id': 'admin-device-0001' }, body: JSON.stringify({ code: 'test-admin-code-1234' }) });
const adminCookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
await admin('/api/admin/login', { method: 'POST', body: { code: 'test-admin-code-1234' } });

test('parsers', () => {
  assert.equal(parseDouyinId('https://www.douyin.com/video/7708921594739234043?x=1'), '7708921594739234043');
  assert.equal(parseDouyinId('https://www.douyin.com/user/self?modal_id=7708921594739234043'), '7708921594739234043');
  assert.equal(parseDouyinId('nope'), '');
  assert.equal(parseCommentPaste('小明：想看繁育\n阿哈！').length, 2);
  assert.equal(parseCommentPaste('[{"author":"a","text":"做纯美吧","likes":12}]')[0].likes, 12);
});

test('videos from db, fan likes toggle, admin add', async () => {
  const v = await fan('/api/videos');
  assert.equal(v.data.videos.length, 4);
  const key = v.data.videos[0].key;
  const l1 = await fan(`/api/videos/${key}/like`, { method: 'POST' });
  assert.deepEqual([l1.data.liked, l1.data.fanLikes], [true, 1]);
  const l2 = await fan(`/api/videos/${key}/like`, { method: 'POST' });
  assert.equal(l2.data.liked, false);
  assert.equal((await fan('/api/admin/videos', { method: 'POST', body: {} })).status, 401);
  const add = await admin('/api/admin/videos', { method: 'POST', body: { url: 'https://www.douyin.com/video/7710000000000000001', title: '纯美新作' } });
  assert.equal(add.status, 200);
  const site = await fan('/api/site');
  assert.equal(site.data.videos[0].title, '纯美新作');
  assert.equal(site.data.videos.length, 4);
  const dup = await admin('/api/admin/videos', { method: 'POST', body: { url: '7710000000000000001', title: 'x2' } });
  assert.equal(dup.status, 409);
});

test('comment inbox import, dedupe, promote', async () => {
  const imp = await admin('/api/admin/comments/import', { method: 'POST', body: { raw: '路人甲：求做繁育虫群！！\n路人甲：求做繁育虫群！！\n阿哈来点乐子' } });
  assert.equal(imp.data.added, 2);
  const list = await admin('/api/admin/comments');
  assert.equal(list.data.items.length, 2);
  const id = list.data.items.find((c) => c.author === '路人甲').id;
  const pr = await admin(`/api/admin/comments/${id}/promote`, { method: 'POST', body: { title: '繁育 · 虫群来袭', category: 'aeon' } });
  assert.equal(pr.status, 200);
  const idea = await fan(`/api/ideas/${pr.data.ideaId}`);
  assert.equal(idea.status, 200);
  assert.equal((await admin('/api/admin/comments')).data.items.length, 1);
});

test('bracket voting and advancing', async () => {
  const b = (await fan('/api/bracket')).data.bracket;
  assert.equal(b.matches.length, 4);
  const m = b.matches[0];
  await fan(`/api/bracket/matches/${m.id}/vote`, { method: 'POST', body: { pick: 'b' } });
  const r = await fan2(`/api/bracket/matches/${m.id}/vote`, { method: 'POST', body: { pick: 'b' } });
  assert.equal(r.data.bracket.matches[0].votesB, 2);
  const adv = await admin(`/api/admin/bracket/${b.id}/advance`, { method: 'POST' });
  assert.equal(adv.data.bracket.round, 2);
  assert.equal(adv.data.bracket.matches.find((x) => x.round === 2).a, m.b);
  const late = await fan(`/api/bracket/matches/${m.id}/vote`, { method: 'POST', body: { pick: 'a' } });
  assert.equal(late.status, 409);
});

test('roadmap progress and supporter board', async () => {
  const ideas = (await admin('/api/admin/roadmap')).data.items;
  assert.ok(ideas.length > 0);
  await admin(`/api/admin/ideas/${ideas[0].id}`, { method: 'PATCH', body: { status: 'building' } });
  await admin(`/api/admin/roadmap/${ideas[0].id}`, { method: 'PATCH', body: { progress: 40, note: '技能特效完成' } });
  const rm = (await fan('/api/roadmap')).data.items.find((i) => i.id === ideas[0].id);
  assert.equal(rm.progress, 40);
  await fan('/api/me/nickname', { method: 'POST', body: { nickname: '星穹列车长' } });
  const board = (await fan('/api/supporters')).data;
  assert.equal(board.me, '星穹列车长');
  assert.equal(board.items[0].nickname, '星穹列车长');
});

test('widget endpoint is CORS-readable for allowed origin', async () => {
  process.env.WIDGET_ORIGINS = 'https://talent.example';
  const res = await fetch(base + '/api/widget', { headers: { origin: 'https://talent.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://talent.example');
  const data = await res.json();
  assert.ok(data.ideas.length && data.latest && data.bracket);
});

test('collector paste adds the video and its comments together', async () => {
  const raw = JSON.stringify({ wuye: 1, video: { id: '7712345678901234567', title: '纯美复刻', likes: '1.2万', published: '11-18', cover: 'https://evil.example/x.jpg' }, comments: [{ author: 'a', text: '下期做阿哈！', likes: 9 }] });
  const r = await admin('/api/admin/comments/import', { method: 'POST', body: { raw } });
  assert.equal(r.status, 200);
  assert.equal(r.data.videoAdded, true);
  assert.equal(r.data.added, 1);
  const site = await fan('/api/site');
  assert.equal(site.data.videos[0].title, '纯美复刻');
  const again = await admin('/api/admin/comments/import', { method: 'POST', body: { raw } });
  assert.equal(again.data.videoAdded, false);
});

test('fan code gate, jar upload, signed download', async () => {
  const fanX = client('fan-device-gate-01');
  assert.equal((await fanX('/api/fan/verify', { method: 'POST', body: { nickname: 'x', code: 'abc' } })).status, 503);
  assert.equal((await admin('/api/admin/fan', { method: 'PATCH', body: { code: '星穹 列车' } })).status, 200);
  assert.equal((await fanX('/api/fan/verify', { method: 'POST', body: { nickname: '小星', code: 'wrong' } })).status, 403);

  // A tiny valid zip header is enough for the magic-byte check.
  const jar = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(64, 1)]);
  const up = (qs, bytes) => fetch(`${base}/api/admin/mods/upload?${qs}`, {
    method: 'POST',
    headers: { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': 'admin-device-0001', 'content-type': 'application/octet-stream', cookie: adminCookie },
    body: bytes,
  });
  const qs = new URLSearchParams({ kind: 'mod', file: '帝弓司命-1.0.jar', name: '帝弓司命', version: '1.0', mc: '1.21.1', loader: 'NeoForge' }).toString();
  assert.equal((await up(qs, Buffer.from('not a jar at all'))).status, 400);
  assert.equal((await up(qs.replace('.jar', '.exe'), jar)).status, 400);
  const ok = await up(qs, jar);
  assert.equal(ok.status, 200);
  const mod = (await ok.json()).mod;
  assert.equal(mod.size, jar.length);

  const list = await fanX('/api/mods');
  assert.equal(list.data.mods.length, 1);
  assert.equal(list.data.modpacks.length, 0);
  assert.equal((await fanX(`/api/mods/${mod.id}/token`, { method: 'POST' })).status, 403);
  assert.equal((await fanX('/api/fan/verify', { method: 'POST', body: { nickname: '小星', code: '星穹列车' } })).status, 200);
  const t = await fanX(`/api/mods/${mod.id}/token`, { method: 'POST' });
  const file = await fetch(base + t.data.url);
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(await file.arrayBuffer()).length, jar.length);
  assert.match(file.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal((await fetch(`${base}/api/mods/${mod.id}/download?t=1.bad`)).status, 403);
  assert.equal((await fanX('/api/mods')).data.mods[0].downloads, 1);
});
