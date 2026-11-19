// Set a new admin code. Run:  node scripts/set-admin-code.mjs
// You type the new code (twice); it's stored only as a hash. All admin sessions are signed out.
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hashSecret } from '../lib/security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, (a) => r(a.trim())));

const code = await ask('New admin code (at least 12 characters): ');
if (code.length < 12) {
  console.log('Too short. Nothing changed.');
  process.exit(1);
}
if ((await ask('Type it again: ')) !== code) {
  console.log('The two codes did not match. Nothing changed.');
  process.exit(1);
}
rl.close();

const db = new DatabaseSync(path.join(process.env.DATA_DIR || path.join(root, 'data'), 'wuye.db'));
const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
set.run('admin_code_hash', hashSecret(code));
set.run('admin_code_source', 'custom');
set.run('admin_code_updated_at', String(Date.now()));
try {
  db.exec('DELETE FROM admin_sessions');
} catch {
  /* table name differs: old sessions simply expire */
}
db.close();
console.clear();
console.log('Admin code changed. Sign in at https://wuye.uniquetalentmap.com/admin with the new code.');
