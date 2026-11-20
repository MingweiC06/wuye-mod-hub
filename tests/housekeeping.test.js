import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pruneAudit, pruneMedia } from '../lib/housekeeping.js';

test('housekeeping: unused old images go, used or fresh ones stay; audit log keeps one year', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-hk-'));
  fs.mkdirSync(path.join(dir, 'media'));
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE ideas (id INTEGER, image TEXT); CREATE TABLE settings (key TEXT, value TEXT); CREATE TABLE audit_log (action TEXT, created_at INTEGER)");
  db.prepare('INSERT INTO ideas VALUES (1, ?)').run('/media/used-card.webp');
  db.prepare('INSERT INTO settings VALUES (?, ?)').run('sponsor', JSON.stringify({ wechat: '/media/qr-code.png' }));
  const old = Date.now() / 1000 - 30 * 86400;
  for (const f of ['used-card.webp', 'qr-code.png', 'gone-old.jpg', 'gone-new.jpg']) fs.writeFileSync(path.join(dir, 'media', f), 'x');
  for (const f of ['used-card.webp', 'qr-code.png', 'gone-old.jpg']) fs.utimesSync(path.join(dir, 'media', f), old, old);
  assert.equal(pruneMedia(db, dir), 1);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'media')).sort(), ['gone-new.jpg', 'qr-code.png', 'used-card.webp']);
  db.prepare('INSERT INTO audit_log VALUES (?, ?)').run('old', Date.now() - 400 * 86400e3);
  db.prepare('INSERT INTO audit_log VALUES (?, ?)').run('new', Date.now() - 10 * 86400e3);
  assert.equal(pruneAudit(db), 1);
  assert.equal(db.prepare('SELECT action FROM audit_log').get().action, 'new');
});
