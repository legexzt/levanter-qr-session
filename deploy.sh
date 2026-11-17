#!/usr/bin/env bash
# deploy.sh — run on the EC2 by the GitHub Actions pipeline.
# Pulls the latest code, installs deps, (re)starts the qr-session app via PM2,
# and sets up the LEGEZT PHP dashboard (nginx + php-fpm).
# What: deploys both the Node QR service and the PHP dashboard.
# Called by: .github/workflows/deploy.yml on every push to main.
# Needs: git, sudo (passwordless, standard for the ubuntu user on EC2).
set -euo pipefail

# Serialize deploys: several pushes in a row trigger several workflow runs,
# and concurrent runs would fight over apt/dpkg locks and git. Wait up to
# 10 minutes for another deploy to finish, then run alone.
exec 9>/tmp/legezt-deploy.lock
flock -w 600 9 || { echo "deploy lock busy after 10 min, aborting"; exit 1; }

REPO_DIR="/home/ubuntu/levanter-qr-session"
APP_NAME="qr-session"
PHP_APP_DIR="$REPO_DIR/php-dashboard"
LEGEZT_DIR="/var/legezt"

cd "$REPO_DIR"
git pull --ff-only origin main

# ---- Node: qr-session (fallback only — Levanter's QR is no longer used) ------
cd "$REPO_DIR/qr-session"
npm install --no-audit --no-fund --omit=dev

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME"
fi
pm2 save

# ---- Node: legezt-bot (Phase 2 — OUR OWN WhatsApp bot, port 3001) ------------
# Own Baileys client + own QR generator. Levanter (port 3000) is NOT touched
# and stays running as the fallback until legezt-bot links WhatsApp.
BOT_NAME="legezt-bot"
BOT_DIR="$REPO_DIR/legezt-bot"
cd "$BOT_DIR"
npm install --no-audit --no-fund --omit=dev

# Auth dir for the Baileys multi-file session (outside the repo, never in Git).
sudo mkdir -p "$LEGEZT_DIR/auth"
sudo chown ubuntu:ubuntu "$LEGEZT_DIR/auth"
sudo chmod 0700 "$LEGEZT_DIR/auth"

# Muse-relay API key (localhost-only endpoint). Created once, never overwritten,
# readable by the bot (ubuntu) and the PHP dashboard (www-data group).
if [ ! -f "$LEGEZT_DIR/config/relay.key" ]; then
  sudo mkdir -p "$LEGEZT_DIR/config"
  openssl rand -hex 32 | sudo tee "$LEGEZT_DIR/config/relay.key" >/dev/null
  sudo chown ubuntu:www-data "$LEGEZT_DIR/config/relay.key"
  sudo chmod 0640 "$LEGEZT_DIR/config/relay.key"
  echo "relay key created at $LEGEZT_DIR/config/relay.key"
fi

# Owner phone number for the WhatsApp pairing code (digits only, country
# code, no '+'). Created empty if missing - the number itself is NEVER in
# Git. Set it once on the EC2, then the next QR cycle issues a pairing
# code automatically (no bot restart needed - the file is read fresh).
if [ ! -f "$LEGEZT_DIR/config/phone.txt" ]; then
  sudo mkdir -p "$LEGEZT_DIR/config"
  sudo touch "$LEGEZT_DIR/config/phone.txt"
  sudo chown ubuntu:ubuntu "$LEGEZT_DIR/config/phone.txt"
  sudo chmod 0600 "$LEGEZT_DIR/config/phone.txt"
  echo "NOTE: pairing code disabled - set the owner phone number once:"
  echo "  echo -n '<digits-only number with country code>' | sudo tee $LEGEZT_DIR/config/phone.txt >/dev/null"
fi

if pm2 describe "$BOT_NAME" >/dev/null 2>&1; then
  pm2 restart "$BOT_NAME" --update-env
else
  pm2 start server.js --name "$BOT_NAME"
fi
pm2 save

# ---- PHP: install packages (only the ones that are missing) -----------------
export DEBIAN_FRONTEND=noninteractive
# NOTE: the EC2 runs Ubuntu 22.04 (jammy), whose default repos ship PHP 8.1 —
# php8.2 does not exist there, so "Unable to locate package php8.2" killed
# every deploy. Use php8.1 (jammy default); the dashboard needs nothing newer.
MISSING_PKGS=""
for pkg in php8.1 php8.1-fpm php8.1-sqlite3 php8.1-curl nginx ffmpeg; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    MISSING_PKGS="$MISSING_PKGS $pkg"
  fi
done
if [ -n "$MISSING_PKGS" ]; then
  echo "installing missing packages:$MISSING_PKGS"
  # The EC2 archive mirror occasionally answers 503 — retry once before giving up.
  sudo apt-get update -qq || { sleep 20; sudo apt-get update -qq; }
  # shellcheck disable=SC2086
  sudo apt-get install -y -qq $MISSING_PKGS
fi

# ---- PHP: web-root traversal -------------------------------------------------
# nginx runs as www-data and must traverse from / down to the web root.
# /home/ubuntu is 750 by default on EC2, so without this nginx gets
# "stat() ... failed (13: Permission denied)" and every request 404s.
sudo chmod 0751 /home/ubuntu
sudo chmod 0755 "$REPO_DIR" "$PHP_APP_DIR" "$PHP_APP_DIR/public"
sudo find "$PHP_APP_DIR" -type d -exec chmod 0755 {} +
sudo find "$PHP_APP_DIR" -type f -exec chmod 0644 {} +

# ---- PHP: runtime directories + permissions ---------------------------------
# php-fpm runs as www-data: it must read the passcode hash and write the DB.
sudo mkdir -p "$LEGEZT_DIR/config" "$LEGEZT_DIR/data" "$LEGEZT_DIR/storage"
sudo chown ubuntu:www-data "$LEGEZT_DIR" "$LEGEZT_DIR/config" "$LEGEZT_DIR/data" "$LEGEZT_DIR/storage"
sudo chmod 0750 "$LEGEZT_DIR/config"
sudo chmod 0770 "$LEGEZT_DIR/data" "$LEGEZT_DIR/storage"
if [ -f "$LEGEZT_DIR/config/passcode.hash" ]; then
  sudo chgrp www-data "$LEGEZT_DIR/config/passcode.hash" || true
  sudo chmod 0640 "$LEGEZT_DIR/config/passcode.hash" || true
fi

# ---- PHP: nginx site ---------------------------------------------------------
sudo cp "$PHP_APP_DIR/nginx/legezt.conf" /etc/nginx/sites-available/legezt
sudo ln -sf /etc/nginx/sites-available/legezt /etc/nginx/sites-enabled/legezt
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
if systemctl is-active --quiet nginx; then
  sudo systemctl reload nginx
else
  sudo systemctl start nginx
fi
if systemctl is-active --quiet php8.1-fpm; then
  sudo systemctl reload php8.1-fpm
else
  sudo systemctl start php8.1-fpm
fi

# ---- Health checks -----------------------------------------------------------
echo "deploy ok: $APP_NAME is $(pm2 describe "$APP_NAME" | grep -o 'status[^,]*' | head -1)"
echo "deploy ok: $BOT_NAME is $(pm2 describe "$BOT_NAME" | grep -o 'status[^,]*' | head -1)"
curl -s -o /dev/null -w "qr-session http=%{http_code}\n" http://localhost:8080/api/health || true
curl -s -o /dev/null -w "levanter  http=%{http_code}\n" http://localhost:3000/ || true
curl -s -o /dev/null -w "legezt-bot http=%{http_code}\n" http://localhost:3001/api/health || true
curl -s -o /dev/null -w "legezt php http=%{http_code}\n" http://localhost/ || true
curl -s http://localhost/health | head -c 300; echo

if [ ! -f "$LEGEZT_DIR/config/passcode.hash" ]; then
  echo "NOTE: no passcode set yet. On the EC2 run:"
  echo "  sudo php $PHP_APP_DIR/scripts/set-passcode.php"
  echo "Then open http://16.4.24.87/ and sign in with it."
fi
