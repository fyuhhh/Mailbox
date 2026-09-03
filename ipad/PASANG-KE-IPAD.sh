#!/bin/bash
#
# Pasang Whisper Wishes ke iPad yang tersambung lewat kabel.
#
# Jalankan dari Terminal:   bash ipad/PASANG-KE-IPAD.sh
#
set -e
cd "$(dirname "$0")/WhisperWishes"

echo
echo "  === Whisper Wishes — pemasangan ke iPad ==="
echo

# 1. Cari iPad yang benar-benar tersambung sekarang.
echo "  Mencari iPad..."
DAFTAR=$(xcrun devicectl list devices 2>/dev/null || true)
BARIS=$(echo "$DAFTAR" | grep -i "ipad" | grep -iv "unavailable" | head -1)

if [ -z "$BARIS" ]; then
  echo
  echo "  [X] Tidak ada iPad tersambung."
  echo
  echo "      1. Colok iPad ke Mac dengan kabel USB-C"
  echo "      2. Di iPad, tekan 'Trust' / 'Percayai' lalu masukkan passcode"
  echo "      3. Nyalakan Developer Mode di iPad:"
  echo "         Settings > Privacy & Security > Developer Mode > aktifkan"
  echo "         (iPad akan minta restart — itu wajar, sekali saja)"
  echo "      4. Jalankan berkas ini lagi"
  echo
  exit 1
fi

ID=$(echo "$BARIS" | awk '{print $(NF-2)}')
NAMA=$(echo "$BARIS" | awk '{print $1, $2}')
echo "  Ditemukan: $NAMA  ($ID)"
echo

# 2. Bangun ulang. -allowProvisioningUpdates mendaftarkan iPad ini ke profil
#    pengembang secara otomatis kalau belum terdaftar.
echo "  Membangun aplikasi..."
xcodebuild -project WhisperWishes.xcodeproj -target WhisperWishes \
  -sdk iphoneos -configuration Release -allowProvisioningUpdates \
  -quiet build

APP="build/Release-iphoneos/WhisperWishes.app"
[ -d "$APP" ] || { echo "  [X] Hasil bangunan tidak ditemukan."; exit 1; }

# 3. Pasang.
echo "  Memasang ke iPad..."
xcrun devicectl device install app --device "$ID" "$APP"

echo
echo "  === Selesai ==="
echo
echo "  Di iPad, buka:  Settings > General > VPN & Device Management"
echo "  Ketuk nama pengembangnya, lalu 'Trust'."
echo "  Sesudah itu aplikasi Whisper Wishes bisa dibuka dari layar utama."
echo
