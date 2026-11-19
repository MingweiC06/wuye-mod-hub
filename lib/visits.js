/*
 * Visit counts for the admin page — no raw IPs, nothing per person.
 *
 * - page_visits: one row per (day, page) with a counter.
 * - visit_uniques: one row per (day, visitor) where visitor = HMAC(secret, day + ip), truncated.
 *   The day is part of the hash, so the same person gets a different code every day and days can't be
 *   linked. Rows older than 8 days are deleted.
 * - Obvious bots (search engines, curl, uptime checkers) are not counted.
 * Days use Beijing time (UTC+8), matching the rest of the product.
 */
import { hmacHex } from './security.js';

const KEEP_DAYS = 8;
const BOT_UA = /bot|crawl|spider|slurp|curl|wget|python|httpclient|monitor|uptime|headless|preview|facebookexternalhit/i;

export function migrateVisits(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_visits (
      day   TEXT    NOT NULL,
      path  TEXT    NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, path)
    );
    CREATE TABLE IF NOT EXISTS visit_uniques (
      day     TEXT NOT NULL,
      visitor TEXT NOT NULL,
      PRIMARY KEY (day, visitor)
    );
  `);
}

/** YYYY-MM-DD in Beijing time. */
export function beijingDay(ms = Date.now()) {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

let lastPrunedDay = '';

export function recordVisit(db, secret, { path, ip, userAgent }) {
  if (!userAgent || BOT_UA.test(userAgent)) return;
  const day = beijingDay();
  db.prepare(
    'INSERT INTO page_visits (day, path, count) VALUES (?, ?, 1) ON CONFLICT(day, path) DO UPDATE SET count = count + 1',
  ).run(day, path);
  db.prepare('INSERT OR IGNORE INTO visit_uniques (day, visitor) VALUES (?, ?)').run(day, hmacHex(secret, `visit:${day}:${ip}`).slice(0, 16));
  if (lastPrunedDay !== day) {
    lastPrunedDay = day;
    const cutoff = beijingDay(Date.now() - KEEP_DAYS * 86400_000);
    db.prepare('DELETE FROM visit_uniques WHERE day < ?').run(cutoff);
    db.prepare('DELETE FROM page_visits WHERE day < ?').run(cutoff);
  }
}

/** Last 7 days (oldest first) plus today's page breakdown. */
export function visitSummary(db) {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) days.push(beijingDay(Date.now() - i * 86400_000));
  const views = new Map(db.prepare('SELECT day, SUM(count) AS n FROM page_visits WHERE day >= ? GROUP BY day').all(days[0]).map((r) => [r.day, Number(r.n)]));
  const uniques = new Map(db.prepare('SELECT day, COUNT(*) AS n FROM visit_uniques WHERE day >= ? GROUP BY day').all(days[0]).map((r) => [r.day, Number(r.n)]));
  const pages = db
    .prepare('SELECT path, SUM(count) AS n FROM page_visits WHERE day >= ? GROUP BY path ORDER BY n DESC')
    .all(days[0])
    .map((r) => ({ path: r.path, views: Number(r.n) }));
  return {
    days: days.map((day) => ({ day, views: views.get(day) || 0, visitors: uniques.get(day) || 0 })),
    pages,
  };
}
