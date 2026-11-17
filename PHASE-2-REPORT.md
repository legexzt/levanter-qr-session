# PHASE-2-REPORT — OUR OWN WhatsApp bot core (`legezt-bot`)

Date: 17 Nov 2026. Built with Kimi K3.1 via Bedrock us-east-1 (inference profile
`us.moonshotai.kimi-k3.1`). Owner order 17 Nov ~10:02 IST: stop using Levanter's QR.

## What was built

New Node.js service `legezt-bot/` (PM2 name `legezt-bot`, binds 127.0.0.1:3001):

- `server.js` (64 lines) — entry point; wires bot + API; graceful shutdown.
- `bot.js` (386 lines) — Baileys 6.7.24 client. Own QR generator (renders Baileys QR
  as PNG data URL, serves it only while < 45s old — never a dead QR). Session
  auto-generated on scan into `/var/legezt/auth/` (mode 700). Self-heals:
  reconnects with backoff on close, and a 15s watchdog recreates the socket
  when it goes quiet (the failure that left Levanter silent ~7h while "online").
  Disconnect never deletes auth/cache/data; `pause()`/`resume()` for manual
  disconnect/reconnect.
- `api.js` (239 lines) — Express API: `GET /`, `GET /api/health`,
  `GET /api/qr`, `POST /api/disconnect`, `POST /api/connect`,
  `POST /api/muse-relay` (localhost-only + `x-api-key`; key from
  `/var/legezt/config/relay.key`, created by deploy.sh, mode 0640).
- `plugins/loader.js` (96 lines) — loads `plugins/*.js`, validates
  `{ name, command, description, run }`, skips broken/disabled/duplicate
  plugins with a log line, never crashes the bot.
- `plugins/ping.js` (`.ping` → pong + latency), `plugins/help.js` (`.help` →
  command list), `plugins/news-agent.js` (`.news`, disabled by default —
  extension point for the owner's news agent, NOT built now).
- `package.json` — PINNED deps: `@whiskeysockets/baileys 6.7.24`,
  `express 5.3.0`, `pino 10.4.0`, `qrcode 1.5.4`. No unpinned git dep
  (Levanter's unpinned Baileys is part of why it broke).
- `README.md` — service doc + local test commands.

Dashboard switch (PHP, Phase 1 gate untouched):

- `php-dashboard/config.php` — `QR_BASE_URL` now `http://127.0.0.1:3001`
  (was qr-session :8080).
- `php-dashboard/lib/qr.php` — added `qr_connect()` (`POST /api/connect`).
- `php-dashboard/public/index.php` — added `reconnect` action (POST + CSRF,
  mirrors the disconnect action).
- `php-dashboard/views/connect.php` — accepts `disconnected`/`starting`
  statuses, shows a Reconnect button when disconnected, port text updated
  to legezt-bot/3001.
- `php-dashboard/public/health.php` — reads `botUp` (falls back to
  `levanterUp`), reports it as `botUp` too.

Deploy:

- `deploy.sh` — installs legezt-bot deps, creates `/var/legezt/auth` (0700),
  creates the relay key once (never overwritten), starts/restarts
  `legezt-bot` via PM2, adds legezt-bot to the health checks. Levanter
  (3000) + qr-session (8080) + PHP (80) are NOT touched and keep running
  as the fallback. PHP 8.1 (jammy) — NOT 8.2.
- `.gitignore` — added `auth/`, `config/`, `storage/` per SPEC §1.7.

## What was tested (Muse VM, local)

- `node --check` clean on all 7 JS files; `php -l` clean on all 5 changed
  PHP files.
- Bot ran locally (test auth dir + test relay key): `/api/health` →
  `{"ok":true,"status":"unknown","account":null,"botUp":true,...}` (status
  unknown because the VM's egress proxy blocks direct WSS to WhatsApp —
  see open items); `/` → service info; plugin load log shows `.help` +
  `.ping` loaded, `news-agent` disabled-skipped.
- Muse relay: `.ping` → `pong 🏓 — LEGEZT is alive (via relay)`,
  handledBy ping; `.help` → full command list; free text → fallback reply
  (real responder, not a "not wired" stub); wrong/missing key → 401;
  empty message → 400 with detail.
- Disconnect → `paused:true, status:disconnected`; Connect →
  `paused:false, status:unknown`. Auth files untouched by both.
- QR render: `qrcode.toDataURL` on a dummy string → valid PNG data URL.
- Loader: a broken plugin (bad export) and a crashing plugin (throw on
  load) are both skipped with a log line; `.help` + `.ping` still load.

## Live deploy verification (EC2, after push)

- (to be filled after the push + curl checks)

## Still open

- **Live QR + WhatsApp link NOT yet verified on the EC2.** The VM cannot
  reach WhatsApp over WSS (egress proxy), so no real QR was emitted locally.
  On the EC2 the bot must print a QR, the owner scans it, and `.ping`
  must reply on WhatsApp. If the EC2 bot also fails to emit a QR, check
  `pm2 logs legezt-bot` and the Baileys version.
- **Watchdog not live-tested** (15s interval, needs a stuck socket to fire);
  code-reviewed only. The reconnect backoff IS proven (attempts 1–3 logged
  with growing delays on the VM).
- **Muse-side wiring is a later step:** the relay endpoint works and routes
  through the plugin system, but no Muse worker calls it yet. The PHP
  dashboard does not call it either (Phase 2 scope). The relay key lives at
  `/var/legezt/config/relay.key` (mode 0640, ubuntu:www-data) for that wiring.
- **Levanter + qr-session still running** as the fallback (owner's call to
  stop them once legezt-bot links WhatsApp).
- **SPEC §4 "all Levanter plugins"**: Phase 2 ships `.ping` + `.help` only
  (the two the owner asked to verify first). Sticker/downloaders/group-admin
  plugins are NOT built — they belong to a follow-up, not this phase.
