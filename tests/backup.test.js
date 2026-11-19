import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBackup, decryptOffsiteSnapshot, listSnapshots, sha256File, verifySnapshot } from '../scripts/backup.js';
import { restoreBackup } from '../scripts/restore-backup.js';

const roots = [];

function makeDataDir({ files = 2, secrets = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wuye-backup-test-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'media'), { recursive: true });

  const db = new DatabaseSync(path.join(dataDir, 'wuye.db'));
  db.exec(`
    CREATE TABLE ideas (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE idea_votes (id INTEGER PRIMARY KEY, idea_id INTEGER NOT NULL, voter_key TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO ideas (title) VALUES ('测试许愿一'), ('测试许愿二'), ('测试许愿三');
    INSERT INTO idea_votes (idea_id, voter_key) VALUES (1, 'v1'), (2, 'v2');
    INSERT INTO settings (key, value) VALUES ('announcement', '测试公告');
  `);
  db.close();

  for (let index = 0; index < files; index += 1) {
    fs.writeFileSync(path.join(dataDir, 'files', `mod-${index + 1}.bin`), Buffer.alloc(1024 + index, index + 1));
  }
  fs.writeFileSync(path.join(dataDir, 'media', 'cover.webp'), Buffer.from('RIFF-test-webp-payload'));
  if (secrets) {
    fs.writeFileSync(path.join(dataDir, 'relay-secret.txt'), 'relay-secret-value\n');
    fs.writeFileSync(path.join(dataDir, 'admin-code.txt'), 'test-admin-code-1234\n');
  }
  return { root, dataDir, backupDir: path.join(root, 'backups') };
}

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('creates a snapshot with database, assets, secrets and verified checksums', async () => {
  const { dataDir, backupDir } = makeDataDir();
  const report = await createBackup({ dataDir, backupDir, keep: 3, log: () => {} });

  assert.equal(report.kept, 1);
  assert.equal(report.pruned.length, 0);
  assert.ok(fs.existsSync(path.join(report.snapshotDir, 'wuye.db')));
  assert.ok(fs.existsSync(path.join(report.snapshotDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(report.snapshotDir, 'SHA256SUMS')));
  assert.ok(fs.existsSync(path.join(report.snapshotDir, 'files', 'mod-1.bin')));
  assert.ok(fs.existsSync(path.join(report.snapshotDir, 'media', 'cover.webp')));
  assert.ok(fs.existsSync(path.join(report.snapshotDir, 'secrets', 'relay-secret.txt')));

  const manifest = report.manifest;
  assert.equal(manifest.format, 'wuye-backup');
  assert.equal(manifest.database.integrity, 'ok');
  assert.equal(manifest.database.tables.ideas, 3);
  assert.equal(manifest.database.tables.idea_votes, 2);
  assert.equal(manifest.totals.assets, 3);
  assert.equal(manifest.totals.secrets, 2);
  assert.equal(manifest.assets.length, 3);

  const verified = await verifySnapshot(report.snapshotDir);
  assert.equal(verified.ok, true, verified.problems.join('\n'));
  assert.ok(verified.files >= 6);
});

test('keeps only the newest snapshots according to keep', async () => {
  const { dataDir, backupDir } = makeDataDir();
  await createBackup({ dataDir, backupDir, keep: 5, log: () => {} });
  await createBackup({ dataDir, backupDir, keep: 5, log: () => {} });
  const third = await createBackup({ dataDir, backupDir, keep: 2, log: () => {} });

  const remaining = listSnapshots(backupDir);
  assert.equal(remaining.length, 2);
  assert.equal(third.kept, 2);
  assert.ok(third.pruned.length >= 1);
  assert.ok(remaining.some((snapshot) => snapshot.dir === third.snapshotDir));
});

test('verifySnapshot reports tampered asset files', async () => {
  const { dataDir, backupDir } = makeDataDir();
  const report = await createBackup({ dataDir, backupDir, keep: 3, log: () => {} });
  const target = path.join(report.snapshotDir, 'files', 'mod-1.bin');

  fs.appendFileSync(target, Buffer.from('tampered'));

  const verified = await verifySnapshot(report.snapshotDir);
  assert.equal(verified.ok, false);
  assert.match(verified.problems.join('\n'), /mod-1\.bin/);
  assert.match(verified.problems.join('\n'), /SHA256|哈希|校验/i);
});

test('restores a snapshot into a fresh directory and checks row counts', async () => {
  const { root, dataDir, backupDir } = makeDataDir();
  const report = await createBackup({ dataDir, backupDir, keep: 3, log: () => {} });
  const restored = path.join(root, 'restored');

  const result = await restoreBackup({ snapshot: report.snapshotDir, target: restored, log: () => {} });
  assert.equal(result.target, restored);
  assert.equal(result.tables.ideas, 3);
  assert.ok(fs.existsSync(path.join(restored, 'files', 'mod-1.bin')));
  assert.ok(fs.existsSync(path.join(restored, 'media', 'cover.webp')));
  // 没有 --with-secrets 时不应恢复密钥文件（根目录与 secrets/ 都不该出现）
  assert.equal(fs.existsSync(path.join(restored, 'secrets')), false);
  assert.equal(fs.existsSync(path.join(restored, 'admin-code.txt')), false);
  assert.equal(fs.existsSync(path.join(restored, 'relay-secret.txt')), false);

  const db = new DatabaseSync(path.join(restored, 'wuye.db'), { readOnly: true });
  try {
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM ideas').get().c), 3);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM idea_votes').get().c), 2);
    assert.equal(db.prepare('SELECT value FROM settings WHERE key = ?').get('announcement').value, '测试公告');
  } finally {
    db.close();
  }

  const withSecrets = path.join(root, 'restored-secrets');
  await restoreBackup({ snapshot: report.snapshotDir, target: withSecrets, withSecrets: true, log: () => {} });
  // 密钥文件必须还原到数据目录根（服务器从 DATA_DIR 根读取），而不是 secrets/ 子目录
  assert.ok(fs.existsSync(path.join(withSecrets, 'admin-code.txt')));
  assert.ok(fs.existsSync(path.join(withSecrets, 'relay-secret.txt')));
  assert.equal(fs.existsSync(path.join(withSecrets, 'secrets')), false);
  assert.equal(await sha256File(path.join(withSecrets, 'relay-secret.txt')), await sha256File(path.join(dataDir, 'relay-secret.txt')));

  assert.equal(await sha256File(path.join(restored, 'files', 'mod-1.bin')), await sha256File(path.join(dataDir, 'files', 'mod-1.bin')));
});

test('refuses to overwrite an existing database without force', async () => {
  const { root, dataDir, backupDir } = makeDataDir();
  const report = await createBackup({ dataDir, backupDir, keep: 3, log: () => {} });
  const restored = path.join(root, 'guarded');
  await restoreBackup({ snapshot: report.snapshotDir, target: restored, log: () => {} });

  await assert.rejects(
    () => restoreBackup({ snapshot: report.snapshotDir, target: restored, log: () => {} }),
    /--force/,
  );

  // --force 允许覆盖
  await restoreBackup({ snapshot: report.snapshotDir, target: restored, force: true, log: () => {} });
});

test('encrypts offsite copies and decrypts them back with the passphrase', async () => {
  const { root, dataDir, backupDir } = makeDataDir();
  const offsiteDir = path.join(root, 'offsite');
  const passphrase = 'test-passphrase-1234';

  const report = await createBackup({ dataDir, backupDir, keep: 3, offsiteDir, passphrase, log: () => {} });
  assert.ok(report.offsite);
  // 异地加密覆盖快照里的全部文件（含 SHA256SUMS 本身），而 verifySnapshot 统计的是清单登记的文件数
  assert.equal(report.offsite.files, report.verified + 1);
  const offsiteSnapshot = fs.readdirSync(offsiteDir).filter((name) => name.startsWith('snapshot-'))[0];
  assert.ok(fs.existsSync(path.join(offsiteDir, offsiteSnapshot, 'RESTORE.txt')));

  const decryptedDir = path.join(root, 'decrypted');
  const decrypted = await decryptOffsiteSnapshot(offsiteDir, decryptedDir, passphrase);
  assert.equal(decrypted.files, report.verified);
  assert.ok(fs.existsSync(path.join(decryptedDir, 'wuye.db')));

  const restored = path.join(root, 'restored-from-offsite');
  await restoreBackup({ snapshot: decryptedDir, target: restored, log: () => {} });
  assert.ok(fs.existsSync(path.join(restored, 'files', 'mod-2.bin')));

  // 口令错误：中文提示，且不写出任何明文
  const wrongDir = path.join(root, 'wrong-passphrase');
  await assert.rejects(
    () => decryptOffsiteSnapshot(offsiteDir, wrongDir, 'not-the-passphrase'),
    /解密失败：口令不正确/,
  );
});

test('encrypted offsite copies are not written without a passphrase', async () => {
  const { root, dataDir, backupDir } = makeDataDir();
  const offsiteDir = path.join(root, 'offsite');
  await assert.rejects(
    () => createBackup({ dataDir, backupDir, keep: 3, offsiteDir, passphrase: '', log: () => {} }),
    /BACKUP_PASSPHRASE/,
  );
});
