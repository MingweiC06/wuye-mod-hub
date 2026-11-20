// Install / refresh the DB-IP Lite location databases used by 安全监控.
//   DATA_DIR=/opt/wuye/data node scripts/update-geo.mjs
// Downloads this month's (or last month's) free files from download.db-ip.com, unpacks them,
// checks a known address resolves, then swaps them in. The running site picks them up within an hour.
// Licence: CC BY 4.0, "IP Geolocation by DB-IP" (https://db-ip.com) — credited on the monitor page.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { MMDB } from '../lib/mmdb.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.env.GEO_DIR || path.join(process.env.DATA_DIR || path.join(root, 'data'), 'geo');
fs.mkdirSync(dir, { recursive: true });

function months() {
  const d = new Date();
  const cur = d.toISOString().slice(0, 7);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return [cur, d.toISOString().slice(0, 7)];
}

async function fetchOne(kind) {
  for (const m of months()) {
    const url = `https://download.db-ip.com/free/dbip-${kind}-lite-${m}.mmdb.gz`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const tmp = path.join(dir, `dbip-${kind}-lite.mmdb.tmp`);
    await pipeline(Readable.fromWeb(res.body), createGunzip(), fs.createWriteStream(tmp, { mode: 0o640 }));
    const db = new MMDB(tmp);
    const hit = db.lookup('8.8.8.8');
    db.close();
    const ok = kind === 'city' ? hit?.data?.country?.iso_code === 'US' : Boolean(hit?.data?.autonomous_system_number);
    if (!ok) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`${kind}: downloaded file failed the sanity check`);
    }
    fs.renameSync(tmp, path.join(dir, `dbip-${kind}-lite.mmdb`));
    console.log(`${kind}: ${m} installed (${(fs.statSync(path.join(dir, `dbip-${kind}-lite.mmdb`)).size / 1e6).toFixed(1)} MB)`);
    return;
  }
  throw new Error(`${kind}: no file for ${months().join(' or ')}`);
}

try {
  await fetchOne('city');
  await fetchOne('asn');
} catch (e) {
  console.error(String(e.message || e));
  process.exit(1);
}
