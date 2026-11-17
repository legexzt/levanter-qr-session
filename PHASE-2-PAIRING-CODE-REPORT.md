# Phase 2 follow-up — Pairing code on the Connect page

Owner order 17 Nov 2026 ~11:10 IST: show the 8-character WhatsApp pairing code
next to the QR (link by typing the code: WhatsApp → Linked devices → Link with
phone number), refreshing together with the QR, with a one-tap Copy button.

## What was built

**legezt-bot (Node)**
- NEW `legezt-bot/pairing.js` — reads the owner phone number from
  `/var/legezt/config/phone.txt` (digits only, country code, no '+'), requests
  the code via Baileys `sock.requestPairingCode(number)` (10s timeout, validates
  `/^[A-Z0-9]{8}$/`), caches it per QR cycle (20s minimum gap between requests),
  never throws, never logs the number or the code.
- `bot.js` — on every new QR, fires a pairing-code request (fire-and-forget;
  the QR still works when the code fails). `getQr()` now returns `pairingCode`
  (null when the QR is stale or no code). New `requestPairingCode()` for
  on-demand refresh (5s minimum gap). `server.js` passes the phone-file path
  (env `LEGEZT_PHONE_FILE`, default `/var/legezt/config/phone.txt`).
- `api.js` — NEW `POST /api/pairing-code` (localhost-only + same `x-api-key`
  as `/api/muse-relay`; shared `requireLocalApiKey` guard now used by both).
  Error map: not-waiting 409, phone-not-configured 503, no-socket 503,
  too-soon 429, request-failed 502. Success returns `{ pairingCode, qrAgeSec }`.

**Dashboard (PHP/JS)**
- `lib/qr.php` — `qr_request()` takes optional headers + by-ref HTTP status;
  NEW `qr_relay_key()` (reads `/var/legezt/config/relay.key`) and
  `qr_pairing_code()` (POSTs to the bot with the key, passes the bot's JSON
  through). `qr_status()` passes `pairingCode` through unchanged.
- `views/connect.php` — in the waiting branch, under the QR: the code shown as
  `ABCD-1234` (raw 8 chars in `data-pairing-code`), Copy button, New code
  button (CSRF), hint line "WhatsApp → Linked devices → Link with phone
  number → enter this code." When no code is available, a muted note says so
  and the QR still works.
- `public/assets/app.js` — 10s poll updates the code text in place together
  with the QR (reloads the page when a code first appears); Copy uses
  `navigator.clipboard` with a textarea fallback and shows "Copied" for 2s;
  New code POSTs to `index.php?action=pairing-code` and shows friendly errors.
- `public/index.php` — NEW POST action `pairing-code` (login + CSRF required).
- `public/assets/style.css` — `.pairing-block`, `.pairing-code` (28px mono),
  `.pairing-actions`, `.pairing-note`.

**deploy.sh** — creates `/var/legezt/config/phone.txt` (mode 600) if missing,
empty, with a setup note. The number itself is NEVER in Git.

## One-time server step (NOT done by this deploy)

The phone file is created EMPTY by deploy.sh. Fill it once on the EC2
(Instance Connect, user ubuntu) — the bot reads it fresh on every request,
so the next QR cycle issues a code with NO restart:

```bash
echo -n '919182481181' | sudo tee /var/legezt/config/phone.txt >/dev/null
sudo chown ubuntu:ubuntu /var/legezt/config/phone.txt
sudo chmod 0600 /var/legezt/config/phone.txt
```

(Owner number +91 9182481181. Never put it in Git.)

## What was tested

- `node --check` clean on all 8 JS files; bot.js 399 lines (under the 400 cap).
- Pairing module unit test (fake socket): valid/invalid/missing phone file,
  code request + uppercase normalisation, per-QR caching, stale-QR hiding,
  on-demand refresh, too-soon 5s guard, failing socket → null (no crash),
  clear() — all passed.
- Live local run of server.js (port 3101, empty phone file): `/api/health`
  ok; `/api/qr` returns `pairingCode: null` in the shape; POST
  `/api/pairing-code` with good key → 409 not-waiting (correct — no QR was
  waiting), bad key → 401. NOTE: the Muse VM's egress proxy blocks the
  Baileys websocket (SSL EPROTO), so no real QR was emitted locally — the
  socket kept reconnecting (watchdog worked). A REAL pairing code can only
  be verified live on the EC2 after the phone file is filled.
- PHP: no php-cli on the VM (could not install); structural balance check
  passed on all 5 changed PHP files (braces/parens/brackets all 0, all start
  `<?php`). `views/connect.php` is only rendered when logged in — eyeball
  the Connect page after deploy. Phone number confirmed absent from all repo
  files.

## Still open / owner must check

1. Fill `/var/legezt/config/phone.txt` on the EC2 (command above), then open
   the Connect page: the QR AND the 8-char code must both show; Copy copies
   the raw code; New code fetches a fresh one; the code changes when the QR
   changes. Then link WhatsApp by typing the code on the phone.
2. Live deploy verification by curl (dashboard 200, /health botUp:true) is
   still to be done after the push — see the deploy run.
