#!/bin/bash
#
# Klik dua kali berkas ini di Finder untuk menyalakan kiosk.
#
# Jendela Terminal akan terbuka dan HARUS dibiarkan terbuka selama acara —
# menutupnya mematikan kiosk. Itu disengaja: tanpa jendela yang terlihat,
# tidak ada cara bagi petugas untuk tahu kiosk masih hidup atau sudah mati.

cd "$(dirname "$0")" || exit 1

# Finder menjalankan berkas ini dengan PATH yang sangat minim dan tidak memuat
# ~/.zshrc, sehingga Node yang dipasang lewat Homebrew atau nvm tidak terlihat.
# Lokasi-lokasi berikut dicoba satu per satu sebelum menyerah.
for lokasi in /usr/local/bin /opt/homebrew/bin "$HOME/.nvm/versions/node"/*/bin; do
  [ -d "$lokasi" ] && PATH="$lokasi:$PATH"
done
export PATH

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js belum terpasang di komputer ini."
  echo
  echo "  Pasang dulu dari https://nodejs.org (pilih versi LTS),"
  echo "  lalu klik dua kali berkas ini lagi."
  echo
  read -r -p "  Tekan Enter untuk membuka halaman unduhan..." _
  open "https://nodejs.org/en/download"
  exit 1
fi

node mulai.mjs
