/**
 * shield.js — turns Cloudflare "I'm Under Attack" mode on automatically when
 * traffic spikes, and back off once it has been calm for a while.
 *
 * Enabled only when CF_API_TOKEN and CF_ZONE_ID are set. The token needs just
 * "Zone → Zone Settings → Edit" for the one zone.
 *
 *   SHIELD_RPM        requests per minute that count as an attack (default 1500)
 *   SHIELD_CALM_MIN   calm minutes before switching back (default 30)
 */
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';

export function createShield({ token, zoneId, dataDir, rpm = 1500, calmMinutes = 30, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const enabled = Boolean(token && zoneId);
  const logFile = path.join(dataDir || '.', 'shield.log');
  let count = 0;
  let attackOn = false;
  let previousLevel = 'medium';
  let calm = 0;
  let busy = false;

  function log(msg) {
    const line = `${new Date(now()).toISOString()} ${msg}\n`;
    try {
      fs.appendFileSync(logFile, line);
    } catch {}
    console.log(`[shield] ${msg}`);
  }

  async function call(method, body) {
    const res = await fetchImpl(`${API}/zones/${zoneId}/settings/security_level`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(data.errors || data).slice(0, 200)}`);
    return data.result && data.result.value;
  }

  async function tick() {
    const n = count;
    count = 0;
    if (!enabled || busy) return;
    busy = true;
    try {
      if (!attackOn && n >= rpm) {
        const current = await call('GET');
        if (current !== 'under_attack') previousLevel = current || 'medium';
        await call('PATCH', { value: 'under_attack' });
        attackOn = true;
        calm = 0;
        log(`ON  — ${n} requests in the last minute (limit ${rpm}). Under Attack mode enabled.`);
      } else if (attackOn) {
        calm = n < rpm / 3 ? calm + 1 : 0;
        if (calm >= calmMinutes) {
          await call('PATCH', { value: previousLevel });
          attackOn = false;
          log(`OFF — calm for ${calmMinutes} minutes. Security level back to "${previousLevel}".`);
        }
      }
    } catch (error) {
      log(`ERROR ${error.message}`);
    } finally {
      busy = false;
    }
  }

  const timer = enabled ? setInterval(tick, 60_000) : null;
  if (timer && timer.unref) timer.unref();
  if (enabled) log(`watching: limit ${rpm} requests/minute, back off after ${calmMinutes} calm minutes`);

  return {
    enabled,
    /** Count one request that came in through Cloudflare. */
    hit() {
      count += 1;
    },
    tick,
    status: () => ({ enabled, attackOn, count, calm }),
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
