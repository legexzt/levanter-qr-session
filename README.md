# LEGEZT — Private WhatsApp Dashboard

Your **own** WhatsApp system — a passcode-protected PHP dashboard (`http://16.4.24.87/`)
plus the QR session service below. Scan a QR to connect your WhatsApp from anywhere,
and disconnect it with one tap. No more reading QR codes out of a terminal.

- **Dashboard:** `http://16.4.24.87/` — passcode gate, then a WordPress-style admin panel
  (Dashboard, Connect/QR, Chats, Media, Plugins, Listener, Settings). Dashboard and
  Connect are live in Phase 1; the rest arrive in Phase 2/3.
- **Live QR page:** `http://16.4.24.87:8080/` — shows the current WhatsApp pairing QR
  as a big scannable image, auto-refreshed every 15s.
- **Status:** Waiting to scan / Connected (with the linked number when known).
- **Disconnect:** one tap deletes the WhatsApp auth files and restarts the bot, so a fresh QR is generated.
- **CI/CD:** every push to `main` auto-deploys to the EC2 via GitHub Actions.

## LEGEZT PHP dashboard (Phase 1)

**Security first — no Cloudflare, no external services:**
- Passcode gate on open. Argon2id hash stored at `/var/legezt/config/passcode.hash`
  (mode 0600/0640, outside the web root). Set it once on the EC2:
  `sudo php /home/ubuntu/levanter-qr-session/php-dashboard/scripts/set-passcode.php`
- 5 failed attempts per IP → 15-minute lockout (SQLite, `/var/legezt/data/legezt.sqlite`).
  Every login attempt is logged. Honeypot field, CSRF + 10-minute form tokens,
  scanner User-Agent blocking, strict security headers, HttpOnly + SameSite=Strict sessions
  (Secure flag only on HTTPS), 30-minute idle timeout, 8-hour absolute timeout.
- The QR page reuses the Node qr-session service (`http://127.0.0.1:8080/api/qr`) —
  the QR is never reimplemented in PHP.

**Layout:**

```
php-dashboard/
├── config.php             # constants + paths (/var/legezt/...)
├── lib/                   # auth.php, db.php, qr.php, security.php
├── public/                # web root: index.php, health.php, assets/
├── views/                 # login, layout, dashboard, connect + Phase 2/3 placeholders
├── scripts/set-passcode.php
└── nginx/legezt.conf      # nginx site (port 80, php-fpm)
```

**Health:** `GET /health` → `{ ok, whatsapp, levanterUp, storage_used_mb, uptime }`
(no login required).

**Deploy:** `deploy.sh` installs php8.2/php-fpm/nginx/ffmpeg if missing, creates
`/var/legezt/{config,data,storage}` with www-data permissions, installs the nginx
site, reloads nginx + php-fpm, and health-checks both the QR service and the PHP site.
Port 80 is open in the `levanter-sg` security group.

## How the QR is captured

Levanter (Baileys) prints the pairing QR to its PM2 logs using
`qrcode-terminal` (ASCII half-block art). This app reads the tail of
Levanter's PM2 log (`~/.pm2/logs/levanter-out.log`, falling back to
`pm2 logs levanter`), decodes the ASCII art back into the QR string
(`qr-extract.js`, using `jsQR`), and re-renders it as a crisp PNG
(`qrcode`). It always uses the **latest** QR block, so an expired QR is
replaced automatically.

## Project layout

```
levanter-qr-session/
├── qr-session/            # the web app (Node.js + Express)
│   ├── server.js          # Express server, QR poller, disconnect API
│   ├── qr-extract.js      # log -> QR string decoder + PNG renderer
│   ├── package.json
│   └── public/index.html  # mobile-friendly QR page
├── deploy.sh              # run on the EC2 by the pipeline
└── .github/workflows/deploy.yml   # GitHub Actions -> EC2 SSH deploy
```

## Setup (one time)

### 1. EC2 — deploy key (lets GitHub Actions SSH in)

On the EC2 (via EC2 Instance Connect), as user `ubuntu`:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/levanter-deploy -N "" -C "github-deploy"
cat ~/.ssh/levanter-deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 2. GitHub — secret

Repo → **Settings → Secrets and variables → Actions → New repository secret**

- Name: `EC2_SSH_KEY`
- Value: the full contents of `~/.ssh/levanter-deploy` (the **private** key)

### 3. AWS — open port 8080

Security group `levanter-sg` → Inbound rules → Add rule: **TCP 8080** from
`0.0.0.0/0` (ports 22 and 3000 are already open).

### 4. Deploy

Push to `main` (or run the workflow manually from the Actions tab).
The pipeline SSHes in, pulls the latest code, runs `npm install`, and
(re)starts the app with PM2 as `qr-session`.

## Use

1. Open `http://16.4.24.87:8080/` on your phone.
2. WhatsApp → Settings → Linked Devices → Link a Device → scan the QR.
3. To unlink: tap **Disconnect WhatsApp** on the page (or delete the
   session and restart Levanter from the EC2).

## API

- `GET /api/qr` — `{ status, account, levanterUp, qrDataUrl, qrUpdatedAt, qrAgeSec }`
- `GET /api/health` — `{ ok, levanterUp, status }`
- `POST /api/disconnect` — deletes Levanter's session/auth folders, restarts
  Levanter, waits for a fresh QR.

## Notes

- Never commit secrets: no `API_KEY`, no `.pem`, no private keys in this repo.
- The app never links a WhatsApp account by itself — only the owner scans.
- Levanter itself is untouched; this app only reads its logs and restarts
  it on an explicit disconnect.
