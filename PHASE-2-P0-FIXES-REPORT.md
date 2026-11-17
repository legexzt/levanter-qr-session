# PHASE-2-P0-FIXES-REPORT — P0 crash-report fixes (17 Nov 2026)

Owner approved ("ok") 17 Nov 2026 ~13:26 IST. Implements the P0 list from
`~/workspace/legezt-bot/CRASH_ANALYSIS_REPORT.md` §6 (F-05, F-06, F-07, F-08,
F-09, F-10, F-28, F-30, F-31). TLS (F-30) is investigate + report only.

## What was fixed

### 1. Connected-state liveness probe (F-06) — `legezt-bot/bot.js`
- The 15s watchdog now also runs in the CONNECTED state. It recreates the
  socket when the WebSocket is not open (`sock.ws.isOpen`, Baileys'
  WebSocketClient getter = `readyState === OPEN`) or when no socket
  activity has been seen for 60 minutes.
- Activity is refreshed on every `connection.update`, `messages.upsert`,
  `creds.update`, and every successful `sendMessage`.
- Why 60 min for the activity threshold: a healthy personal account can be
  quiet for hours, so a short threshold would recreate the socket all night
  (reconnects are themselves a ban signal). Baileys' own 30s keep-alive
  (closes a socket with no frames for 35s) is the first line of defence;
  `isOpen` is the second; the 60-min activity check is the third-line
  safety net for a wedged handler. It bounds a silent death to ≤60 min
  (Levanter's was ~7h). Tunable: lower it if silent deaths recur, raise it
  if quiet nights cause too many reconnects.
- `getStatus()` now also reports `lastActivitySec` so the Ops page can
  show liveness, not just "connected".

### 2. Reason-aware reconnect table + 515-guard (F-08, F-09, F-10) — `legezt-bot/lib/reconnect.js` (new) + `bot.js`
- The old close handler had one branch (401 → stop, everything else →
  reconnect with backoff). Each reason now has its own rule (codes verified
  from the installed Baileys 6.7.24 `DisconnectReason` enum, not guessed):
  - **401 loggedOut → stop.** Fresh scan needed.
  - **403 forbidden → stop, do not retry.** Retrying a restricted account
    can deepen the restriction.
  - **411 multideviceMismatch → stop.** Owner action needed.
  - **440 connectionReplaced → stop.** Do not fight the other session.
  - **500 badSession → reconnect with backoff, but stop after 5
    consecutive 500s.** No session backup exists yet (P1, F-13), so the
    cap is what stops a corrupt session looping forever.
  - **515 restartRequired → reconnect immediately, no backoff, attempt
    not counted.** (WhatsApp sends 515 on purpose after pairing.)
  - **408 / 428 / 503 / unknown → reconnect with exponential backoff**
    (2s → 4s → 8s … capped at 30s, as before).
- **515-guard:** a 401 arriving within 30s of a 515 is WhatsApp cleaning up
  the OLD session slot, not a real logout (Evolution API PR #2509). The
  first such 401 is ignored and the bot reconnects; a second 401 is
  treated as a real logout. The guard is consumed once so it cannot loop.

### 3. PM2 ecosystem file + startup (F-05, F-07) — `ecosystem.config.js` (new) + `deploy.sh`
- `ecosystem.config.js` at the repo root, three apps (legezt-bot,
  qr-session, levanter), each with `min_uptime: '10s'`, `max_restarts: 10`,
  `restart_delay: 3000`, `exp_backoff_restart_delay: 100`,
  `max_memory_restart: '512M'`. Levanter's entry is `script: '.'`
  (its documented start, `pm2 start .`, resolved via its package.json).
- `deploy.sh` now starts/restarts legezt-bot and qr-session with
  `pm2 startOrRestart ecosystem.config.js --only <name>` (a failure warns
  instead of aborting the deploy; the health checks at the end show the
  real status). Levanter is in the ecosystem file but is NOT restarted by
  deploys (it is the fallback; only the parent stops it).
- **`pm2 startup` (the systemd unit) is NOT done here** — it must run ON
  the EC2. Exact commands are in "EC2-side steps left" below.

### 4. Close the fallback exposure (F-28, F-31) — `qr-session/server.js` (code part)
- `qr-session` now binds to `127.0.0.1` only (was `0.0.0.0`, no auth).
  The dashboard does not proxy it (it uses legezt-bot on 127.0.0.1:3001
  since Phase 2), so nothing in the dashboard breaks. The deploy health
  check (`curl http://localhost:8080/api/health`) still works.
- The live Levanter QR and the `POST /api/disconnect` endpoint (which
  DELETES auth files) are no longer reachable from the internet.
- **Security-group cleanup and stopping Levanter are EC2/AWS-side steps**
  (see below) — not done in code.

### 5. TLS on the dashboard (F-30) — INVESTIGATION ONLY, not implemented
- **No domain points at the EC2 today.** `legezt.in` resolves to
  198.18.75.97 and `www.legezt.in` to 198.18.75.98 (a proxy/CDN range, not
  the EC2). `pioneera.me` resolves to 198.18.75.99 (also not the EC2).
  Reverse lookup on 16.4.24.87 returns nothing. The dashboard is reached
  by bare public IP only.
- **No TLS is served on the EC2 today.** A TCP connect to 16.4.24.87:443
  succeeds (the security group appears to allow it), but the TLS handshake
  fails — nothing is listening with a certificate.
- **Options:**
  - (a) **Let's Encrypt with a domain (recommended).** Point a subdomain
    at the EC2 (e.g. `bot.legezt.in` → A record 16.4.24.87), then certbot
    issues a free certificate. Needs the owner's DNS access (legezt.in).
    If the domain is Cloudflare-proxied (orange cloud), either pause the
    proxy for the subdomain or use certbot's DNS challenge.
  - (b) **Self-signed certificate.** Works immediately with no domain,
    but browsers show a scary warning on every visit and the owner must
    click through it. Encrypts the traffic, but does not prove identity.
  - (c) **Defer.** Keep plain HTTP until a domain is pointed at the EC2.
- **Recommended: (a).** Exact steps are in "EC2-side steps left" below.
  Nothing was changed for TLS in this push — no certificate was requested
  and nginx was not changed to force HTTPS.

## What was tested (all local, VM, 17 Nov 2026)

- `node --check` passes on `bot.js`, `lib/reconnect.js`,
  `qr-session/server.js`, `ecosystem.config.js`.
- **Reconnect unit test** (`/tmp/kimi/test_reconnect.js`) — **19/19**:
  401/403/411/440 → stop; 515 → immediate; 408/428/503/unknown →
  backoff; 401 within 30s of a 515 → immediate (ignored once); second
  401 → stop; 500 under the cap → backoff, at/after 5 → stop.
- **Liveness probe test** (`/tmp/kimi/test_liveness.js`, fake socket, no
  network) — **14/14**: connected + ws open + fresh activity → no
  recreate; ws closed → recreate; 61m quiet → recreate; 59m quiet → no
  recreate; no sock → recreate; paused → no recreate; `getStatus`
  `lastActivitySec` correct; 515 → immediate reconnect; 401 after 515 →
  ignored and reconnected; second 401 → stopped; 403 → stopped with no
  reconnect attempt.
- **Regression suites still green**: `/tmp/kimi/test_plugins.js` **48/48**,
  `/tmp/kimi/test_usage_vault.js` **37/37** (unchanged from the plugin build).
- **Live verification (curl from the VM, after deploy):** _to be filled in
  after the push — dashboard 200, `/health` `botUp:true` +
  `whatsapp:"connected"`._

## EC2-side steps left (for the parent — these cannot be done from the VM)

Run these on the EC2 via Instance Connect (device browser, root sign-in).
Do them in this order; verify each one before the next.

### A. `pm2 startup` — make the bot survive a reboot (F-07)
```bash
# As user ubuntu on the EC2:
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# The command prints a sudo command — run that sudo command as instructed,
# then:
pm2 save
pm2 status
```
Verify: `pm2 status` shows legezt-bot, qr-session, levanter online. (A full
reboot test — `sudo reboot` and confirm the bot reconnects by itself — is
the real proof; do it only when the owner is available to re-scan if
something goes wrong.)

### B. Close the fallback exposure in AWS (F-28, F-31)
1. AWS Console → EC2 → Security Groups → `levanter-sg`
   (`sg-043b79faecb288f42`) → Inbound rules → **remove TCP 3000 and
   TCP 8080** (0.0.0.0/0). Keep 22 (SSH), 80 (HTTP), 443 (HTTPS, for TLS).
   (qr-session already binds 127.0.0.1 after this deploy, so removing the
   rules is defence in depth — nothing external can reach it either way.)
2. **Stop Levanter only after confirming legezt-bot is the verified
   primary** (it is: connected since 17 Nov 12:38 IST, plugins live):
   ```bash
   pm2 stop levanter
   pm2 delete levanter
   pm2 save
   ```
   Keep `/home/ubuntu/levanter` on disk as a cold standby — do not delete
   the code or its session yet.

### C. TLS — Let's Encrypt with a subdomain (F-30, recommended option)
Prerequisite: the owner points a subdomain at the EC2. In the legezt.in
DNS (registrar / Cloudflare DNS, DNS-only / grey cloud for this record):
```
bot.legezt.in.  A  16.4.24.87
```
Wait for DNS to propagate (`nslookup bot.legezt.in` must return
16.4.24.87), then on the EC2:
```bash
sudo apt-get update -qq && sudo apt-get install -y -qq certbot python3-certbot-nginx
sudo certbot --nginx -d bot.legezt.in
# Answer the prompts (email for expiry notices, agree to the ToS).
# certbot writes the certificate, updates nginx/legezt.conf for HTTPS,
# and adds an HTTP -> HTTPS redirect. Then:
sudo nginx -t && sudo systemctl reload nginx
curl -s https://bot.legezt.in/health | head -c 200; echo
```
Notes: certbot auto-renews (a systemd timer is installed by the package).
If the subdomain must stay Cloudflare-proxied (orange cloud), use the DNS
challenge instead (`sudo certbot --nginx -d bot.legezt.in --preferred-challenges dns` —
it will ask for a TXT record). Until TLS is done, the dashboard stays on
plain HTTP — do not share the dashboard URL publicly.

## What is still open (not in this step)

- **Live deploy verification** — after this push, check the GitHub Actions
  run, then `curl` the dashboard (200) and `/health` (`botUp:true`,
  `whatsapp:"connected"`). The bot restarts on deploy; the session must
  persist with no re-scan (it did on every previous deploy).
- **EC2-side steps A–C above** (pm2 startup, SG cleanup, stop Levanter,
  TLS) — all need the parent / the owner.
- **P1 items from the crash report** (not P0, not done here): deploy
  health gate (F-35), session + vault-key backup (F-13, F-24), disk cap +
  retention (F-23, F-25, F-34), fail-fast on uncaught exceptions (F-01,
  F-02), Bedrock circuit breaker + key-health monitoring (F-20, F-21).
- **`bot.js` is now 545 lines** (was 451; SPEC §10 says ≤400). The growth
  is the P0 liveness probe + the reason-aware close handler; the reconnect
  table itself was extracted to `lib/reconnect.js` (80 lines) to keep it
  down. Splitting bot.js further (e.g. extracting the connection
  lifecycle) is a follow-up refactor — not done here to avoid touching
  stable live core logic.
- **The 60-minute activity threshold is a judgement call** (see §1). If
  the owner sees reconnects on quiet nights, raise it; if a silent death
  ever recurs, lower it. The threshold is one constant in `_watchdogTick`.
- `views/connect.php` PHP syntax was never linted (no php-cli on the VM)
  — if the Connect page shows a 500, that file is the first suspect
  (pre-existing, unchanged by this fix).
