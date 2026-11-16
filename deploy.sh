#!/usr/bin/env bash
# deploy.sh — run on the EC2 by the GitHub Actions pipeline.
# Pulls the latest code, installs deps, (re)starts the qr-session app via PM2.
set -euo pipefail

REPO_DIR="/home/ubuntu/levanter-qr-session"
APP_NAME="qr-session"

cd "$REPO_DIR"
git pull --ff-only origin main

cd "$REPO_DIR/qr-session"
npm install --no-audit --no-fund --omit=dev

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
else
  pm2 start server.js --name "$APP_NAME"
fi
pm2 save

echo "deploy ok: $APP_NAME is $(pm2 describe "$APP_NAME" | grep -o 'status[^,]*' | head -1)"
curl -s -o /dev/null -w "qr-session http=%{http_code}\n" http://localhost:8080/api/health || true
curl -s -o /dev/null -w "levanter  http=%{http_code}\n" http://localhost:3000/ || true
