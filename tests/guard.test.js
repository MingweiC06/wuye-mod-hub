import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { claimIpVote, isHostingOrg, loginBlocked, LOGIN_GLOBAL_MAX, LOGIN_IP_MAX, migrateGuard, netBlock, recordLoginFail, clearLoginFails } from '../lib/guard.js';

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE admin_devices (device_key TEXT PRIMARY KEY); CREATE TABLE idea_votes (idea_id INTEGER, voter_key TEXT, created_at INTEGER, ip_hash TEXT)');
  migrateGuard(db);
  return db;
}

test('guard: network blocks', () => {
  assert.equal(netBlock('1.2.3.4'), '1.2.3.0/24');
  assert.equal(netBlock('::ffff:1.2.3.99'), '1.2.3.0/24');
  assert.equal(netBlock('2001:db8:abcd:12::1'), '2001:0db8:abcd::/48');
  assert.equal(netBlock('2001:db8::1'), '2001:0db8:0000::/48');
});

test('guard: login lockout survives in the database, per IP and site-wide', () => {
  const db = freshDb();
  const now = Date.now();
  for (let i = 0; i < LOGIN_IP_MAX; i += 1) recordLoginFail(db, 'ipA', 'devX', now);
  assert.equal(loginBlocked(db, 'ipA', 'devX', now).code, 'login_locked');
  assert.equal(loginBlocked(db, 'ipA', 'devX', now + 3601_000), null, 'an hour later it is open again');
  clearLoginFails(db, 'ipA');
  // Many IPs, one or two tries each: the site-wide shield kicks in, known devices still get through.
  for (let i = 0; i < LOGIN_GLOBAL_MAX; i += 1) recordLoginFail(db, `ip${i}`, '', now);
  assert.equal(loginBlocked(db, 'fresh', 'newdev', now).code, 'login_shielded');
  db.prepare('INSERT INTO admin_devices (device_key) VALUES (?)').run('owner');
  assert.equal(loginBlocked(db, 'fresh', 'owner', now), null);
});

test('guard: one vote per network for polls and 对决; hosting networks detected', () => {
  const db = freshDb();
  assert.equal(claimIpVote(db, 'poll', 1, 'ip1', 'v1'), true);
  assert.equal(claimIpVote(db, 'poll', 1, 'ip1', 'v1'), true, 'same device may change its pick');
  assert.equal(claimIpVote(db, 'poll', 1, 'ip1', 'v2'), false, 'another device on the same IP is refused');
  assert.equal(claimIpVote(db, 'poll', 2, 'ip1', 'v2'), true, 'a different poll is fine');
  assert.ok(isHostingOrg('AMAZON-02'));
  assert.ok(isHostingOrg('DigitalOcean, LLC'));
  assert.ok(!isHostingOrg('China Mobile communications corporation'));
  assert.ok(!isHostingOrg('Chinanet'));
  assert.ok(!isHostingOrg('Comcast Cable Communications, LLC'));
});
