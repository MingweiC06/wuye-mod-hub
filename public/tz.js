/*
 * tz.js — time-zone helpers for the 安全监控 dashboard (browser) and its tests / server (Node).
 *
 * UTC milliseconds are the only source of truth. These helpers only *display* an instant in a zone, or turn
 * a local wall-clock time in a zone into a UTC instant, always through the IANA database built into Intl.
 * No offset (UTC+8, UTC-5, UTC-4…) is ever hard-coded, so New York's EST/EDT switch is handled automatically.
 */
(function (root) {
  'use strict';

  const ZONES = {
    bj: { id: 'Asia/Shanghai', name: '北京时间', short: '北京', flag: '🇨🇳' },
    et: { id: 'America/New_York', name: '美国东部时间', short: '美东', flag: '🇺🇸' },
  };

  const fmtCache = new Map();
  function parts(ms, zoneId) {
    let f = fmtCache.get(zoneId);
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: zoneId,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      });
      fmtCache.set(zoneId, f);
    }
    const out = {};
    for (const p of f.formatToParts(new Date(ms))) out[p.type] = p.value;
    return {
      y: Number(out.year),
      mo: Number(out.month),
      d: Number(out.day),
      h: Number(out.hour),
      mi: Number(out.minute),
      s: Number(out.second),
      abbr: out.timeZoneName || '',
    };
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** { date: '2026/11/20', time: '10:16:35', abbr: 'EST' } for an instant in a zone. */
  function inZone(ms, key) {
    const z = ZONES[key];
    const p = parts(ms, z.id);
    return { date: `${p.y}/${pad(p.mo)}/${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`, abbr: key === 'bj' ? 'UTC+8' : p.abbr, ymd: `${p.y}-${pad(p.mo)}-${pad(p.d)}` };
  }

  /** Offset of `zoneId` at instant `ms`, in minutes (derived from Intl, never hard-coded). */
  function offsetAt(ms, zoneId) {
    const p = parts(ms, zoneId);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
  }

  /**
   * Local wall-clock time in a zone → UTC ms.  '2026-11-20', '00:00' (seconds optional).
   * Non-existent times (the skipped hour when clocks spring forward) move forward to the first valid instant;
   * ambiguous times (the repeated hour in autumn) resolve to the earlier instant. Returns NaN for bad input.
   */
  function zonedToUtc(dateStr, timeStr, key) {
    const z = ZONES[key] || ZONES.bj;
    const dm = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const tm = String(timeStr || '00:00').match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!dm || !tm) return NaN;
    const [y, mo, d] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
    const [h, mi, s] = [Number(tm[1]), Number(tm[2]), Number(tm[3] || 0)];
    const naive = Date.UTC(y, mo - 1, d, h, mi, s);
    const check = new Date(naive);
    if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return NaN;
    // Try both offsets around the instant; keep candidates whose local reading matches the request.
    const offs = new Set([offsetAt(naive - 86400000, z.id), offsetAt(naive, z.id), offsetAt(naive + 86400000, z.id)]);
    const hits = [...offs].map((o) => naive - o * 60000).filter((t) => {
      const p = parts(t, z.id);
      return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi && p.s === s;
    });
    if (hits.length) return Math.min(...hits);
    // Skipped local time (spring forward): the same wall clock under the earlier offset lands after the gap.
    return naive - Math.min(...offs) * 60000;
  }

  /** 刚刚 / 3分钟前 / 2小时前 / 昨天 / 3天前 — from the real instant; "yesterday" means the previous Beijing calendar day. */
  function relative(ms, now = Date.now()) {
    const diff = now - ms;
    if (diff < 0) return '刚刚';
    const m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m}分钟前`;
    const today = inZone(now, 'bj').ymd;
    const then = inZone(ms, 'bj').ymd;
    const days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(then + 'T00:00:00Z')) / 86400000);
    if (days === 0) return `${Math.floor(m / 60)}小时前`;
    if (days === 1) return '昨天';
    if (days < 30) return `${days}天前`;
    if (days < 365) return `${Math.floor(days / 30)}个月前`;
    return `${Math.floor(days / 365)}年前`;
  }

  const api = { ZONES, inZone, offsetAt, zonedToUtc, relative };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WYTZ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
