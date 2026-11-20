import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../public/tz.js';
import { createApp } from '../app.js';
import { rangeFrom } from '../lib/monitor-api.js';

const T = globalThis.WYTZ;
const Z = (iso) => Date.parse(iso);
const q = (o) => new URLSearchParams(o);

test('tz: one UTC instant shown in Beijing and New York', () => {
  const at = Z('2026-11-20T02:16:35Z');
  assert.deepEqual(T.inZone(at, 'bj'), { date: '2026/11/20', time: '10:16:35', abbr: 'UTC+8', ymd: '2026-11-20' });
  assert.deepEqual(T.inZone(at, 'et'), { date: '2026/11/19', time: '21:16:35', abbr: 'EST', ymd: '2026-11-19' });
  // Summer: EDT, UTC-4 (from the zone database, not hard-coded).
  assert.equal(T.inZone(Z('2026-07-01T12:00:00Z'), 'et').time, '08:00:00');
  assert.equal(T.inZone(Z('2026-07-01T12:00:00Z'), 'et').abbr, 'EDT');
  assert.equal(T.offsetAt(Z('2026-07-01T12:00:00Z'), 'America/New_York'), -240);
  assert.equal(T.offsetAt(Z('2026-01-01T12:00:00Z'), 'America/New_York'), -300);
});

test('tz: DST switch days in New York (2026-03-08 and 2026-11-01)', () => {
  // Spring forward: 01:59:59 EST is followed by 03:00:00 EDT.
  assert.equal(T.inZone(Z('2026-03-08T06:59:59Z'), 'et').time, '01:59:59');
  assert.equal(T.inZone(Z('2026-03-08T07:00:00Z'), 'et').time, '03:00:00');
  assert.equal(T.inZone(Z('2026-03-08T07:00:00Z'), 'et').abbr, 'EDT');
  // 02:30 does not exist that day: it moves forward to the first instant after the gap (03:30 EDT).
  assert.equal(T.zonedToUtc('2026-03-08', '02:30', 'et'), Z('2026-03-08T07:30:00Z'));
  // Fall back: 01:30 happens twice; the earlier (EDT) one is used.
  assert.equal(T.zonedToUtc('2026-11-01', '01:30', 'et'), Z('2026-11-01T05:30:00Z'));
  assert.equal(T.inZone(Z('2026-11-01T06:30:00Z'), 'et').time, '01:30:00');
  assert.equal(T.inZone(Z('2026-11-01T06:30:00Z'), 'et').abbr, 'EST');
  // Whole-day ranges: the spring day has 23 hours, the autumn day 25.
  const len = (d) => {
    const r = rangeFrom(q({ zone: 'et', from: d, to: d }));
    return (r.to + 1 - r.from) / 3600_000;
  };
  assert.equal(len('2026-03-08'), 23);
  assert.equal(len('2026-11-01'), 25);
  assert.equal(len('2026-11-02'), 24);
});

test('tz: midnight, Dec → Jan and leap days', () => {
  // Beijing midnight = 16:00 UTC the day before; New York midnight (winter) = 05:00 UTC.
  assert.equal(T.zonedToUtc('2026-11-20', '00:00', 'bj'), Z('2026-11-19T16:00:00Z'));
  assert.equal(T.zonedToUtc('2026-11-20', '00:00', 'et'), Z('2026-11-20T05:00:00Z'));
  // New Year: still 2026 in New York while it is already 2027 in Beijing.
  const ny = Z('2027-01-01T03:00:00Z');
  assert.equal(T.inZone(ny, 'bj').date, '2027/01/01');
  assert.equal(T.inZone(ny, 'et').date, '2026/12/31');
  // Leap years.
  assert.equal(T.zonedToUtc('2028-02-29', '12:00', 'bj'), Z('2028-02-29T04:00:00Z'));
  assert.ok(Number.isNaN(T.zonedToUtc('2027-02-29', '12:00', 'bj')));
  assert.ok(Number.isNaN(T.zonedToUtc('2026-13-01', '00:00', 'et')));
  assert.throws(() => rangeFrom(q({ from: '2027-02-29' })), /开始日期/);
  assert.throws(() => rangeFrom(q({ from: '2026-11-20', to: '2026-11-19' })), /晚于/);
  // End time is inclusive to the end of that minute.
  const r = rangeFrom(q({ zone: 'bj', from: '2026-11-20', fromTime: '09:00', to: '2026-11-20', toTime: '09:30' }));
  assert.equal(r.from, Z('2026-11-20T01:00:00Z'));
  assert.equal(r.to, Z('2026-11-20T01:30:59.999Z'));
});

test('tz: relative times', () => {
  const now = Z('2026-11-20T02:00:00Z'); // 10:00 Beijing
  assert.equal(T.relative(now - 20_000, now), '刚刚');
  assert.equal(T.relative(now - 3 * 60_000, now), '3分钟前');
  assert.equal(T.relative(now - 2 * 3600_000, now), '2小时前');
  assert.equal(T.relative(Z('2026-11-19T10:00:00Z'), now), '昨天');
  assert.equal(T.relative(Z('2026-11-17T02:00:00Z'), now), '3天前');
});

test('monitor API: ISO UTC output, zone-aware date filter, category filter, sessions, prefs, admin log', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-tz-'));
  const CODE = 'test-admin-code-1234';
  const MON = 'monitor-pass-5678-xyz';
  const app = createApp({ dataDir, adminCode: CODE, monitorCode: MON });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const jar = new Map();
  const call = async (p, { method = 'GET', body } = {}) => {
    const h = { 'x-requested-with': 'XMLHttpRequest', 'x-device-id': 'admin-device-001', 'user-agent': 'Mozilla/5.0 Chrome/130.0' };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (pair.slice(i + 1)) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  assert.equal((await call('/api/admin/login', { method: 'POST', body: { code: CODE } })).status, 200);
  assert.equal((await call('/api/monitor/unlock', { method: 'POST', body: { code: MON } })).status, 200);

  // Synthetic visitors with fixed UTC instants (test database only).
  const db = app.db;
  const now = Date.now();
  const mk = (note) => Number(db.prepare("INSERT INTO monitor_subjects (subject, first_seen, last_seen, ua_label, admin_note) VALUES (?, ?, ?, 'Chrome · Windows', ?)").run(`test-${note}`, now, now, note).lastInsertRowid);
  const A = mk('A');
  const B = mk('B');
  const ev = (sid, iso, kind = 'page') => db.prepare("INSERT INTO monitor_events (subject_id, at, kind, label, status, ip_hash, flag) VALUES (?, ?, ?, 'x', 200, '', '')").run(sid, Z(iso), kind);
  // A: 2025-11-20 01:00 UTC = 11/20 09:00 Beijing = 11/19 20:00 New York.
  ev(A, '2025-11-20T01:00:00Z');
  ev(A, '2025-11-20T01:10:00Z', 'click');
  ev(A, '2025-11-20T03:00:00Z'); // > 30 min later: second session
  // B: 2025-11-20 14:00 UTC = 11/20 22:00 Beijing = 11/20 09:00 New York.
  ev(B, '2025-11-20T14:00:00Z', 'download');
  const firstFor = (sid) => db.prepare('SELECT MIN(at) a, MAX(at) b FROM monitor_events WHERE subject_id = ?').get(sid);
  for (const sid of [A, B]) db.prepare('UPDATE monitor_subjects SET first_seen = ?, last_seen = ? WHERE id = ?').run(firstFor(sid).a, firstFor(sid).b, sid);
  const before = JSON.stringify(db.prepare('SELECT at FROM monitor_events ORDER BY id').all());

  const ids = async (qs) => (await call(`/api/monitor/subjects?${qs}`)).data.items.map((x) => x.id).sort();
  assert.deepEqual(await ids('zone=bj&from=2025-11-20&to=2025-11-20'), [A, B].sort());
  assert.deepEqual(await ids('zone=et&from=2025-11-19&to=2025-11-19'), [A]);
  assert.deepEqual(await ids('zone=et&from=2025-11-20&to=2025-11-20'), [B]);
  assert.deepEqual(await ids('zone=bj&from=2025-11-20&fromTime=21:00&to=2025-11-20&toTime=23:00'), [B]);
  assert.deepEqual(await ids('kind=download'), [B]);
  assert.deepEqual(await ids('kind=click&zone=et&from=2025-11-20&to=2025-11-20'), []);

  const list = (await call('/api/monitor/subjects')).data.items;
  const a = list.find((x) => x.id === A);
  assert.equal(a.firstSeen, '2025-11-20T01:00:00.000Z', 'ISO 8601 UTC');
  assert.equal(a.lastSeen, '2025-11-20T03:00:00.000Z');
  assert.ok(list.findIndex((x) => x.id === B) < list.findIndex((x) => x.id === A), 'sorted newest first by the real instant');

  const d = (await call(`/api/monitor/subjects/${A}`)).data;
  assert.deepEqual(d.events.map((e) => [e.at, e.session]), [
    ['2025-11-20T03:00:00.000Z', 2],
    ['2025-11-20T01:10:00.000Z', 1],
    ['2025-11-20T01:00:00.000Z', 1],
  ]);
  assert.equal(d.sessions, 2);
  const onlyClick = (await call(`/api/monitor/subjects/${A}?kind=click`)).data.events;
  assert.deepEqual(onlyClick.map((e) => e.session), [1]);

  // Display mode is saved, validated and audited — and never touches stored times.
  assert.equal((await call('/api/monitor/prefs')).data.tzMode, 'dual');
  assert.equal((await call('/api/monitor/prefs', { method: 'PUT', body: { tzMode: 'et' } })).status, 200);
  assert.equal((await call('/api/monitor/prefs')).data.tzMode, 'et');
  assert.equal((await call('/api/monitor/prefs', { method: 'PUT', body: { tzMode: 'utc-5' } })).status, 400);
  assert.equal(JSON.stringify(db.prepare('SELECT at FROM monitor_events ORDER BY id').all()), before, 'stored timestamps unchanged');

  const log = (await call('/api/monitor/audit')).data;
  assert.ok(log.items.some((x) => x.action === 'monitor.prefs' && x.detail === 'tz=et'));
  assert.match(log.items[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal((await call('/api/monitor/audit?zone=bj&from=2020-01-01&to=2020-01-02')).data.total, 0);
  assert.equal((await call('/api/monitor/subjects?from=2026-02-30')).status, 400);
});
