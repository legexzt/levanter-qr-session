# Levanter QR Session Manager

Your **own** WhatsApp session website for Levanter — scan a QR to connect
your WhatsApp from anywhere, and disconnect it with one tap. No more
reading QR codes out of a terminal.

- **Live QR page:** `http://16.4.24.87:8080/` — shows Levanter's current
  WhatsApp pairing QR as a big scannable image, auto-refreshed every 15s.
- **Status:** Waiting to scan / Connected (with the linked number when known).
- **Disconnect:** one tap deletes Levanter's WhatsApp auth files and
  restarts it, so a fresh QR is generated.
- **CI/CD:** every push to `main` auto-deploys to the EC2 via GitHub Actions.

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
