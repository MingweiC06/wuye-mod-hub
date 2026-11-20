// Set the 安全监控 passcode (separate from the admin code). Run:  node scripts/set-monitor-code.mjs
// You type the new passcode (twice); it's stored only as a scrypt hash. Open monitor sessions are closed.
// The settings row is the same one lib/monitor.js reads; the service does not need a restart.
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hashSecret } from '../lib/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => {
  process.stdout.write(q);
  const { value } = await lines.next();
  return String(value || '').trim();
};

const code = await ask('New monitor passcode (at least 12 characters, different from the admin code): ');
if (code.length < 12) {
  console.log('\nToo short. Nothing changed.');
  process.exit(1);
}
if ((await ask('\nType it again: ')) !== code) {
  console.log('\nThe two passcodes did not match. Nothing changed.');
  process.exit(1);
}
rl.close();

const db = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'wuye.db'));
db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('monitor_code_hash', hashSecret(code));
try {
  db.exec('DELETE FROM monitor_sessions');
} catch {
  /* the service creates this table on its next start */
}
db.close();
console.log('\nMonitor passcode set. Open /admin/monitor while signed in as admin.');
