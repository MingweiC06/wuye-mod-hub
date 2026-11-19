# Phase 3 — Production readiness review (2026-11-19)

Checked against local HEAD `ff364ea` (+ uncommitted docs) and the live server. Review only — no code or server
changes were made in this phase.

Legend: **Fixed**: done and verified. **Local**: fixed in code, not deployed. **Open**: not done.

## P0

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | Production backups | **Fixed** | Timer enabled (daily 18:47 UTC), 3 v2-encrypted snapshots in B2, `rclone check` 0 diffs, B2 round-trip restore passed (21 tables, 198 rows). |
| 2 | Privacy text vs. code (Douyin nickname) | **Local** | `rules.html` L146 now discloses the manually typed nickname; live site still runs `806ff34` (`/privacy` → 404). Closes on deploy. |

## P1

| # | Item | State | Evidence / note |
|---|---|---|---|
| 1 | robots.txt / sitemap.xml / canonical | **Open** | Live `/robots.txt` and `/sitemap.xml` → 404; no `canonical` in any page; `/index.html` and `/` both 200; two hosts serve the same content. |
| 2 | Open Graph | **Open** | Only `index.html` has `og:image`, relative path `/assets/cover-yaoshi.jpg`. |
| 3 | Privacy notice completeness | **Local** | `/privacy` v2 written; processor identity still undecided (owner). |
| 4 | `/polls` weight + caching | **Open** | Caddy only gzips; no change since audit. |
| 5 | Non-atomic multi-statement deletes | **Open** | `deleteIdea` (`lib/db.js:724`) and `deletePoll` (`lib/db.js:783`) run 2–3 DELETEs without BEGIN/COMMIT. Low real risk (single process, SQLite), simple fix. |
| 6 | Sponsor dead-end | **Partly** | Admin can now upload QR codes (new 赞助收款 tab, live). Still: page offers "我已赞助，提交" even when no QR is set. |
| 7 | Like/vote identity + IP cap | **Open (video likes)** | `/api/videos/:id/like` limits per device only (60/10 min), no per-IP cap; bracket votes have both. |

## Security (P2 items re-checked)

- **Clean:** CSP strict, HSTS, XFO DENY on live responses; Origin-host check on writes (`app.js:106`); rate limiter on API; image uploads check magic bytes; SQL parameterized.
- **Open:** admin session 12 h fixed TTL, no idle expiry (`lib/api.js:68`); CSRF relies on Origin check only (acceptable if Origin always enforced for writes); `data/` is 755 and `wuye.db` 644 on server (readable by any local user; only `ubuntu`/`wuye` exist); `relay-secret.txt` in data dir is a leftover from the abandoned EdgeOne relay.

## Retention

- Approved but **not implemented**: `shield.log` 30-day rotation (currently 4 KB, no urgency), `audit_log` 180 days.
- Sponsorship 60-month retention still **not approved**.

## Monitoring / rollback

- No alerting: a failed backup or a down site is only visible on the server (`systemctl status`). Journal is 17 MB, disk 10 % used, RAM fine.
- No access log in Caddy.
- Rollback = redeploy previous commit with `deploy-oracle.ps1`; data rollback = restore a snapshot (tested).

## Local leftovers

- `backups/.offsite-passphrase.txt`: v1 passphrase in plain text. Bitwarden v1 verified working → can be deleted (owner's call).
- `backups/.b2-rclone.key`: old B2 key material; every old key now returns 401 → can be deleted.

## Owner decisions needed before Phase 4

1. Processor identity on `/privacy` (keep "乌叶MC (individual)" or disclose more).
2. Which Open items are launch blockers. Suggested must-fix: P1-1 (robots/canonical), P1-5 (transactions), P1-6 (sponsor empty state), P1-7 (IP cap on likes), backup-failure alert.
3. Delete the two local secret files above.
4. Implement `shield.log`/`audit_log` retention now or after launch.
