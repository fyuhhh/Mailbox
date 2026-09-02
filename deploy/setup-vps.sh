#!/usr/bin/env bash
#
# Penyiapan sekali jalan di VPS untuk server undangan.
# Jalankan DI SERVER:  bash setup-vps.sh
#
# Dijalankan ulang aman: setiap langkah memeriksa keadaan sebelum bertindak,
# sehingga menjalankannya dua kali tidak merusak pemasangan yang sudah jadi.

set -euo pipefail

DOMAIN="undangan.opsjobs.id"
APP_ROOT="/opt/undangan"

if [ "$(id -u)" -ne 0 ]; then
  echo "Jalankan sebagai root." >&2
  exit 1
fi

echo "==> Node.js"
if ! command -v node >/dev/null || [ "$(node -e 'console.log(process.versions.node.split(".")[0])')" -lt 22 ]; then
  # node:sqlite baru tersedia sejak Node 22; versi di bawah itu membuat server
  # gagal start dengan galat modul yang tidak jelas penyebabnya.
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
fi
node -v

echo "==> Direktori"
mkdir -p "$APP_ROOT/deploy" "$APP_ROOT/data" /var/log/undangan

echo "==> PM2"
command -v pm2 >/dev/null || npm install -g pm2

echo "==> Nginx"
if [ ! -f /etc/nginx/conf.d/undangan-limit.conf ]; then
  echo "  ! Salin dulu deploy/nginx/undangan-limit.conf ke /etc/nginx/conf.d/"
fi
if [ ! -f "/etc/nginx/sites-available/$DOMAIN.conf" ]; then
  echo "  ! Salin dulu deploy/nginx/$DOMAIN.conf ke /etc/nginx/sites-available/"
else
  ln -sf "/etc/nginx/sites-available/$DOMAIN.conf" "/etc/nginx/sites-enabled/$DOMAIN.conf"
  nginx -t && systemctl reload nginx
fi

echo
echo "==> Langkah berikutnya, berurutan:"
echo "    1. Tambah A record  $DOMAIN -> IP server ini (hPanel > DNS Manager)"
echo "    2. Tunggu propagasi, cek: dig +short $DOMAIN"
echo "    3. Buat $APP_ROOT/.env dari undangan/.env.example, isi SYNC_SECRET"
echo "    4. Dari Mac: ./deploy/deploy.sh"
echo "    5. pm2 start $APP_ROOT/deploy/ecosystem.config.cjs && pm2 save"
echo "    6. certbot --nginx -d $DOMAIN"
