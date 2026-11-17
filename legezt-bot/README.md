# legezt-bot — LEGEZT's own WhatsApp bot core

Our own Baileys client. **Not Levanter.** Levanter stays running only as a fallback
until this bot links WhatsApp; its QR is no longer used anywhere.

## What it does

- Connects to WhatsApp via Baileys and serves its own pairing QR (`GET /api/qr`).
  A QR is only ever served while younger than 45s — never a dead QR.
- Auto-generates the session on scan (Baileys multi-file auth state) and stores it
  in `/var/legezt/auth/` (mode 700, outside the repo). Restart restores the same
  session — no re-scan unless logged out from the phone.
- Self-heals: reconnects with backoff on disconnect, and a 15s watchdog recreates
  the socket when it goes quiet (the failure that killed Levanter's QR for ~7h).
- Plugin system: one file per command in `plugins/` (`.ping`, `.help` built in).
  A broken plugin is skipped + logged, never crashes the bot.
- Muse relay: `POST /api/muse-relay` (localhost-only, `x-api-key` header).
  The key lives in `/var/legezt/config/relay.key` (created by deploy.sh, mode 0640)
  or `LEGEZT_RELAY_KEY` env. Accepts `{ message, from }`, returns `{ reply, handledBy }`.
- Pairing code: `GET /api/qr` also returns `pairingCode` (8 chars, null when
  unavailable) — requested from Baileys for the owner's phone number every
  time a new QR is issued, so the QR and the code refresh together. The number
  lives in `/var/legezt/config/phone.txt` (digits only, country code, no '+',
  mode 600, created empty by deploy.sh, NEVER in Git); the file is read fresh
  on every request, so filling it in needs no restart. `POST /api/pairing-code`
  (localhost-only + same `x-api-key`) forces a fresh code on demand. If the
  code request fails, the QR still works — `pairingCode` is just null.

## Endpoints (binds 127.0.0.1:3001)

| Method | Path | Notes |
|---|---|---|
| GET | `/` | `{ ok, service, version }` |
| GET | `/api/health` | `{ ok, status, account, botUp, uptimeSec }` |
| GET | `/api/qr` | `{ status, account, qrDataUrl, pairingCode, qrAgeSec, qrUpdatedAt, lastPollAt, lastError }` |
| POST | `/api/pairing-code` | localhost-only + API key; forces a fresh pairing code, returns `{ pairingCode, qrAgeSec }` |
| POST | `/api/disconnect` | Pauses the bot (auth files kept, nothing deleted) |
| POST | `/api/connect` | Resumes the bot |
| POST | `/api/muse-relay` | localhost-only + API key; runs the message through the plugin system |

## Run locally

```bash
cd legezt-bot
npm install
PORT=3001 LEGEZT_AUTH_DIR=/tmp/legezt-auth-test LEGEZT_RELAY_KEY=testkey123 node server.js
curl -s http://127.0.0.1:3001/api/health
curl -s http://127.0.0.1:3001/api/qr | head -c 200
curl -s -X POST http://127.0.0.1:3001/api/muse-relay \
  -H 'x-api-key: testkey123' -H 'Content-Type: application/json' \
  -d '{"message":".ping","from":"test"}'
```

## Deploy

Push to `main` — GitHub Actions runs `deploy.sh`, which installs deps and
(restarts the service via PM2 (`pm2 start server.js --name legezt-bot`).
