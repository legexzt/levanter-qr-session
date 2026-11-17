# PHASE-2-OPS-REPORT — Ops / Terminal dashboard page

Date: 17 Nov 2026. SPEC §11 (24/7 self-management + Ops terminal) + §12
(AI usage tracking + secret vault). Owner order: a management space +
terminal where the bot/AI manages everything, with AI usage stats and a
vault browser.

## What was built

### Bot side (legezt-bot, Node)

- `ops-api.js` (new, 227 lines): registers the Ops endpoints on the bot's
  localhost API. All three routes are localhost-only + relay `x-api-key`,
  like `/api/muse-relay`.
  - `GET /api/ops` — status (`bot.getStatus()`), usage totals + `getStats()`
    (per-command / per-type / per-day), recent events (newest first, 20),
    PM2 state (`pm2 jlist`, best-effort, 5s timeout), last 25 lines of the
    PM2 out + error logs, and the vault file list with types.
  - `POST /api/restart` — replies `{ok:true, restarting:true}`, then exits
    after 400 ms so PM2 restarts the bot. This is the Restart control.
  - `POST /api/vault/download` — decrypts one vault file by content hash
    (64 hex chars) and streams the original bytes as an attachment with a
    safe content-type. Unknown hash → 404, bad hash → 400, too large
    (>200 MB) → 413. The vault key never leaves the bot; only the hash
    prefix is logged, never the content.
- `usage.js` — aggregates now also sum `inputTokens`/`outputTokens`
  (the .ai plugin already logs them); added `readRecent(limit)` (tails the
  last 128 KB of usage.jsonl, newest first, never throws); added
  `loadFromDisk()` — the in-memory aggregates are rebuilt once from the
  JSONL at startup (same inode, up to load-time size), so a bot restart no
  longer zeroes the dashboard. Events appended after load are counted once
  (they were already aggregated by `logUsage()`); a rotated file is
  skipped. Only the last 2 MB are replayed to bound startup cost.
- `vault.js` — added `listVault()` (index entries, newest first, no
  directory scan).
- `api.js` — only wires in `registerOpsRoutes()`; no other logic changed.
  `bot.js` / `server.js` untouched. Every file ≤400 lines.

### Dashboard side (php-dashboard, PHP 8.1)

- `views/ops.php` (new, 397 lines) — "Ops & Terminal" page, behind the
  passcode gate. Sections: Live status (connection, account, paused badge,
  uptime, storage, last error, last checked); AI usage totals (AI calls,
  total tokens in/out, tasks done/failed); AI usage tables (per command,
  per day, last 30 days); Recent activity; Errors (failures by command,
  recent failures, error-log lines); Processes (PM2 table: status, uptime,
  restarts, memory); Secret vault browser (file, type, size, stored date,
  Download link); Controls; Recent logs (last 25 output lines). Every
  number comes from `/api/ops` — nothing is guessed; when the bot API is
  unreachable the page says so instead of showing zeros.
- `lib/ops.php` (new, 315 lines) — bot-API client (relay key, 8s timeout),
  vault-download streamer (downloads to a temp file, then streams it with
  the bot's content-type/disposition, 200 MB cap), uptime/bytes/time
  formatters, bounded `/var/legezt` storage walk. PHP never reads the
  vault key.
- `lib/ops-actions.php` (new, 125 lines) — the Ops POST actions
  (ops-restart, ops-pause, ops-resume, ops-disconnect, ops-reconnect) and
  the vault-download GET. All CSRF-protected, all written to the audit log,
  all redirect back to `?page=ops&notice=…`.
- `public/index.php` — routes `page=ops` (title "Ops & Terminal") and calls
  `handle_ops_actions()`; `views/layout.php` — "Ops" sidebar entry.
- `public/assets/app.js` — `confirm-action` handler (confirm dialog from
  the form's `data-confirm`); `public/assets/style.css` — `.log-view`,
  `.table-scroll`, `.ops-note`, `.data-table` (multi-column tables; the
  status table stays `.kv-table`).
- No raw shell prompt anywhere (SPEC §11: out of scope unless the owner
  explicitly asks). Controls only.

## Honest notes on the controls

- Restart is a bot exit + PM2 restart, not a `pm2 restart` shell call —
  PHP (www-data) cannot run pm2. Same effect, same supervisor.
- Pause and Disconnect share the bot's `pause()` mechanism (socket closed,
  auth kept, resume reconnects). The two buttons log different audit
  events, but under the hood they are the same action in the current bot
  core. A pause that keeps the socket open would need a bot.js change.

## What was tested

- Local endpoint test (`/tmp/test-ops.js`, fake bot + fixture usage log,
  vault, and pm2): **27/27 checks passed** — `/api/ops` totals
  (aiCalls 2, aiTokens 4000, in 3000 / out 1000, tasks 6, fail 1),
  per-command/per-day stats, recent events newest-first, PM2 parsing,
  log tails, vault list, vault download returning the exact original
  bytes (PDF content-type + attachment), 404/400/401 cases, restart
  replying 200 and scheduling `process.exit(0)`, restart without key
  → 401 with no exit, and no double-count when `logUsage()` runs after
  the startup replay.
- `node --check` passes on api.js, ops-api.js, usage.js, vault.js, app.js.
- PHP: `php -l` is **not available on the VM** (no php-cli), so a
  structural balance check was run instead (comments/strings stripped,
  `()[]{}` balance + `<?php`/`?>` tag balance) — all 8 PHP files pass —
  plus a full re-read of the new view and a cross-check that every CSS
  class the Ops page uses exists in style.css. All referenced PHP
  functions (`csrf_token`, `verify_csrf`, `is_logged_in`, `qr_relay_key`,
  `db_log`, `qr_api`) were verified to exist.
- Every changed file is ≤400 lines (SPEC §10).

## What is still open

- **php -l was not run** (no php-cli on the VM). `views/ops.php` was never
  php-linted — if the Ops page ever shows a 500, that file is the first
  suspect, same as the earlier `views/connect.php` note.
- **Ops page login check not verified live.** The dashboard passcode is
  not recorded anywhere, so the page could not be opened via curl. Verify
  by logging in as the owner and opening Ops: status, usage, PM2, vault,
  and one control (e.g. Refresh) should render. If the bot API is down,
  the page must show "Ops service unavailable", not zeros.
- Live deploy verification: after this push, check the GitHub Actions
  run, then `curl` the dashboard (200) and `/health`
  (`botUp:true`, `whatsapp:"connected"`). The new `/api/ops` endpoint is
  localhost-only, so it cannot be curled from the VM — its first live
  proof is the Ops page itself.
- Aggregates replay only the active `usage.jsonl` (last 2 MB); rotated
  archives (`usage-<ts>.jsonl`) are not replayed, so very old history
  (before the last rotation) does not appear in the per-day table.
- PM2 state depends on `pm2 jlist` succeeding on the EC2 as user ubuntu;
  if it fails, the page shows "PM2 info is unavailable" and the rest
  still renders.
