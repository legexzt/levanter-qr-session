#!/usr/bin/env bash
# deploy.sh — run on the EC2 by the GitHub Actions pipeline.
# Pulls the latest code, installs deps, (re)starts the qr-session app via PM2,
# and sets up the LEGEZT PHP dashboard (nginx + php-fpm).
# What: deploys both the Node QR service and the PHP dashboard.
# Called by: .github/workflows/deploy.yml on every push to main.
# Needs: git, sudo (passwordless, standard for the ubuntu user on EC2).
set -euo pipefail

REPO_DIR="/home/ubuntu/levanter-qr-session"
APP_NAME="qr-session"
PHP_APP_DIR="$REPO_DIR/php-dashboard"
LEGEZT_DIR="/var/legezt"

cd "$REPO_DIR"
git pull --ff-only origin main

# ---- Node: qr-session (unchanged) -------------------------------------------
cd "$REPO_DIR/qr-session"
npm install --no-audit --no-fund --omit=dev

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME"
fi
pm2 save

# ---- PHP: install packages (only the ones that are missing) -----------------
export DEBIAN_FRONTEND=noninteractive
MISSING_PKGS=""
for pkg in php8.2 php8.2-fpm php8.2-sqlite3 php8.2-curl nginx ffmpeg; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    MISSING_PKGS="$MISSING_PKGS $pkg"
  fi
done
if [ -n "$MISSING_PKGS" ]; then
  echo "installing missing packages:$MISSING_PKGS"
  sudo apt-get update -qq
  # shellcheck disable=SC2086
  sudo apt-get install -y -qq $MISSING_PKGS
fi

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
if systemctl is-active --quiet php8.2-fpm; then
  sudo systemctl reload php8.2-fpm
else
  sudo systemctl start php8.2-fpm
fi

# ---- Health checks -----------------------------------------------------------
echo "deploy ok: $APP_NAME is $(pm2 describe "$APP_NAME" | grep -o 'status[^,]*' | head -1)"
curl -s -o /dev/null -w "qr-session http=%{http_code}\n" http://localhost:8080/api/health || true
curl -s -o /dev/null -w "levanter  http=%{http_code}\n" http://localhost:3000/ || true
curl -s -o /dev/null -w "legezt php http=%{http_code}\n" http://localhost/ || true
curl -s http://localhost/health | head -c 300; echo

if [ ! -f "$LEGEZT_DIR/config/passcode.hash" ]; then
  echo "NOTE: no passcode set yet. On the EC2 run:"
  echo "  sudo php $PHP_APP_DIR/scripts/set-passcode.php"
  echo "Then open http://16.4.24.87/ and sign in with it."
fi
