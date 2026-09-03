# Whisper Wishes — aplikasi iPad

Aplikasi lanskap untuk HUT EWALK 17-TH. Tamu menekan layar, hitung mundur 3
detik, kamera depan merekam 30 detik, lalu tamu menekan **Send Your Wishes**
dan kembali ke layar awal.

## Alurnya

| Layar | Isi |
|---|---|
| Beranda | Latar ONE7ELEVEN + tulisan emas *Start to Whisper Your Wishes*. Seluruh layar bisa ditekan. |
| Hitung mundur | Angka 3 · 2 · 1 di atas pratinjau kamera depan |
| Merekam | 30 detik, penanda merah dan sisa waktu di pojok |
| Kirim | Tombol emas *Send Your Wishes* → simpan → kembali ke beranda |

## Di mana videonya tersimpan

Dua tempat, supaya ada cadangan:

1. **Folder Dokumen aplikasi** — ditulis begitu perekaman berhenti, sebelum
   tamu menekan tombol apa pun. Bisa ditarik lewat Finder: sambungkan iPad,
   pilih iPad di sidebar Finder, buka tab **Files**, buka **Whisper Wishes**.
2. **Galeri Foto** — disalin saat tombol *Send Your Wishes* ditekan.

Kalau izin galeri ditolak, rekaman tetap utuh di tempat pertama.

## Memasang

```
bash ipad/PASANG-KE-IPAD.sh
```

Sebelum menjalankannya, di iPad:

1. Colok kabel USB-C ke Mac
2. Tekan **Trust / Percayai** di iPad, masukkan passcode
3. **Settings → Privacy & Security → Developer Mode** → aktifkan
   (iPad minta restart; sekali saja)

Sesudah terpasang, di iPad buka **Settings → General → VPN & Device
Management**, ketuk nama pengembangnya, lalu **Trust**.

## Batas waktu

Aplikasi ditandatangani dengan profil pengembang, jadi ada masa berlakunya.
Profil sekarang berlaku sampai **10 September 2026**. Kalau kedaluwarsa,
aplikasi berhenti bisa dibuka — jalankan `PASANG-KE-IPAD.sh` lagi untuk
memperbaruinya.

## Yang belum diuji

Perekaman **tidak bisa diuji di simulator** — simulator iOS tidak punya kamera
sama sekali. Yang sudah terbukti: aplikasi terbangun, tertandatangani, berjalan
lanskap, dan latar serta tulisan emasnya tampil benar.

Perekaman 30 detik, penyimpanan ke galeri, dan pencerminan kamera depan **harus
dicoba di iPad sungguhan** — sebaiknya beberapa kali berturut-turut, jauh
sebelum hari acara.
