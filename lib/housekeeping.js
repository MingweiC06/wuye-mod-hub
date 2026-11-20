/**
 * housekeeping.js — once a day:
 *   - delete uploaded images (DATA_DIR/media) that nothing in the database points to any more
 *     (replaced covers, deleted cards). Only files older than MEDIA_GRACE_DAYS are touched, so an upload
 *     that is still being saved is never removed. Backups keep a copy either way.
 *   - trim the 操作记录 (audit_log) to the last AUDIT_KEEP_DAYS.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MEDIA_GRACE_DAYS = 7;
export const AUDIT_KEEP_DAYS = 365;
const DAY = 86400_000;

/** Every /media/<file> mentioned anywhere in the database (all text columns of all tables). */
export function referencedMedia(db) {
  const used = new Set();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info("${t}")`).all().filter((c) => !c.type || /TEXT|CHAR|CLOB/i.test(c.type)).map((c) => c.name);
    for (const c of cols) {
      for (const r of db.prepare(`SELECT "${c}" AS v FROM "${t}" WHERE "${c}" LIKE '%/media/%'`).all()) {
        for (const m of String(r.v).matchAll(/\/media\/([\w-]+\.(?:jpg|png|webp))/g)) used.add(m[1]);
      }
    }
  }
  return used;
}

export function pruneMedia(db, dataDir, now = Date.now()) {
  const dir = path.join(dataDir, 'media');
  if (!fs.existsSync(dir)) return 0;
  const used = referencedMedia(db);
  let removed = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!/^[\w-]+\.(jpg|png|webp)$/.test(f) || used.has(f)) continue;
    const p = path.join(dir, f);
    if (now - fs.statSync(p).mtimeMs < MEDIA_GRACE_DAYS * DAY) continue;
    fs.unlinkSync(p);
    removed += 1;
  }
  return removed;
}

export function pruneAudit(db, now = Date.now()) {
  return db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(now - AUDIT_KEEP_DAYS * DAY).changes;
}

/** Runs once shortly after start, then every 24 hours. Never throws. */
export function startHousekeeping(db, dataDir) {
  const run = () => {
    try {
      const media = pruneMedia(db, dataDir);
      const audit = pruneAudit(db);
      if (media || audit) console.log(`[housekeeping] removed ${media} unused image(s), ${audit} audit row(s) older than ${AUDIT_KEEP_DAYS} days`);
    } catch (e) {
      console.error('[housekeeping]', e.message);
    }
  };
  const first = setTimeout(run, 5 * 60_000);
  const timer = setInterval(run, DAY);
  first.unref?.();
  timer.unref?.();
  return { run, stop: () => (clearTimeout(first), clearInterval(timer)) };
}
