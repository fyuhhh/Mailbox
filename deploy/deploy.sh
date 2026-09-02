#!/usr/bin/env bash
#
# Kirim server undangan ke VPS.  Jalankan dari Mac:  ./deploy/deploy.sh
#
# Mengikuti pola yang sama dengan deploy Opsjobs: rsync sumber, pasang
# dependensi di server, lalu restart proses PM2.

set -euo pipefail

VPS_HOST="${VPS_HOST:-root@<IP-VPS-KAMU>}"
APP_ROOT="/opt/undangan"
DOMAIN="undangan.opsjobs.id"

cd "$(dirname "$0")/.."

echo "==> Mengirim sumber server undangan"
# --delete tanpa pengecualian ini akan menghapus .env dan seluruh data tamu
# yang tercatat di server setiap kali deploy dijalankan.
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
  --exclude '*.log' \
  undangan/ "$VPS_HOST:$APP_ROOT/"

echo "==> Menyalin berkas deploy"
rsync -avz deploy/ecosystem.config.cjs "$VPS_HOST:$APP_ROOT/deploy/"

echo "==> Memasang dependensi dan me-restart API"
ssh "$VPS_HOST" "cd $APP_ROOT && npm ci --omit=dev && pm2 restart undangan-api --update-env"

echo
echo "==> Selesai"
echo "    Undangan : https://$DOMAIN"
