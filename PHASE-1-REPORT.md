# LEGEZT — Phase 1 Report

Date: 17 Nov 2026. Built by Kimi K3.1 (AWS Bedrock, us-east-1, model
`us.moonshotai.kimi-k3.1`) under Patrick's guidance, from `legezt-bot/SPEC.md`.

## What was built

PHP dashboard on the same EC2, served by nginx + php-fpm on port 80.
WordPress-style dark admin panel, self-hosted CSS/JS only — no CDN, no Cloudflare.

- **Passcode gate + security** (`config.php`, `lib/auth.php`, `lib/db.php`,
  `lib/security.php`, `scripts/set-passcode.php`): Argon2id passcode hash in
  `/var/legezt/config/passcode.hash` (outside web root); 5 failed attempts per IP
  → 15-minute lockout in SQLite; honeypot field; CSRF + 10-minute form tokens;
  scanner User-Agent blocking; strict security headers; HttpOnly + SameSite=Strict
  sessions (Secure flag only on HTTPS — the site is plain HTTP for now, so a
  Secure cookie would break login); 30-min idle / 8-hour absolute timeout.
  Every login attempt is logged to `audit_log`.
- **Dashboard + Connect pages** (`views/dashboard.php`, `views/connect.php`,
  `lib/qr.php`): Dashboard shows WhatsApp status, storage used, recent activity
  (from `audit_log`). Connect shows the live Baileys QR by proxying the existing
  Node qr-session service (`http://127.0.0.1:8080/api/qr`) — the QR is NOT
  reimplemented in PHP. Auto-refresh via `assets/app.js` (10s poll while waiting).
  Disconnect posts to the qr-session `/api/disconnect`.
- **Placeholders** for Chats / Media / Plugins / Listener / Settings — each honestly
  says which phase builds it. Settings shows real read-only values (timeouts,
  paths, QR service URL).
- **Health endpoint** (`public/health.php`, no login): `{ ok, whatsapp,
  levanterUp, storage_used_mb, uptime }`.
- **nginx** (`nginx/legezt.conf`): port 80, web root `php-dashboard/public`,
  `/health` rewrite, php-fpm socket, no proxying to ports 3000/8080.
- **Deploy** (`deploy.sh`): installs php8.2/php-fpm/sqlite3/curl/nginx/ffmpeg
  if missing; creates `/var/legezt/{config,data,storage}` with www-data
  permissions; installs the nginx site; reloads nginx + php-fpm; health-checks
  qr-session, levanter, the PHP site and `/health`. Port 80 opened in
  `levanter-sg` (verified via AWS CLI).

## What was tested (local, PHP 8.3 built-in server)

- `php -l` clean on all 15 PHP files; `node --check` clean on `app.js`.
- Login page renders (200) with passcode + honeypot fields; all 5 security
  headers present; CSS/JS serve 200.
- Wrong passcode → redirect `?error=1`; honeypot filled → silent `?error=1`;
  correct passcode → redirect `?page=dashboard`; dashboard + connect render 200.
- Brute force: 5 wrong attempts → 6th returns `?error=locked`, page shows
  "Locked for 15 minute(s)".
- Unauthenticated dashboard request shows the login page only (no content leak).
- Logout → redirect to login; dashboard after logout shows login again.
- Audit log recorded every event (honeypot_blocked, login_failed, login_locked,
  login_success, logout).
- `/health` returns `{"ok":true,"whatsapp":"unavailable",...}` locally
  (no qr-session on the test VM — expected; the EC2 check is below).

## What is still open

- **Passcode is NOT set on the EC2 yet.** The owner (or Patrick via EC2 Instance
  Connect) must run once on the EC2:
  `sudo php /home/ubuntu/levanter-qr-session/php-dashboard/scripts/set-passcode.php`
  Until then the login page shows "Passcode is not set yet" and no one can sign in.
- **Live EC2 verification pending:** after the GitHub Actions deploy runs,
  confirm `http://16.4.24.87/` shows the passcode gate, `/health` returns
  `ok:true`, and the Connect page shows the real QR (scan to link WhatsApp).
- Kimi K3.1 notes: ap-south-1 Kimi quota is 0 — all calls used us-east-1
  inference profile `us.moonshotai.kimi-k3.1`. Kimi spends ~9–12k tokens
  reasoning per call, so max_tokens was raised to 32000; one call still hit
  `finish_reason: length` (health.php was re-requested in the next call).
  One extractor bug (missing closing fence) was fixed in the local helper.
- Phase 2 (LEGEZT bot core, plugins, `.ping`, Muse bridge) and Phase 3
  (listener, ML, storage) are NOT started.
