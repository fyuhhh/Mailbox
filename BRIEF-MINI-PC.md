# Brief untuk agen yang menyiapkan mini PC

Salin seluruh berkas ini ke agen di PC tersebut.

---

## Konteks

Kiosk cetak undangan & gift voucher untuk **HUT EWALK 17-TH**, 9 September 2026,
Atrium EWALK Balikpapan. Mini PC dipasang di TV 43" dan dipakai tamu langsung.

Repo: `https://github.com/fyuhhh/Mailbox.git` (publik)

Arsitektur:

- `kiosk/` — server lokal di mini PC. Kamera, perekam video, pencetak termal.
- `undangan/` — **sudah jalan di VPS**, jangan dijalankan di mini PC.
- Basis data: SQLite di `kiosk/data/`. Tidak perlu memasang basis data apa pun.

---

## Langkah

### 1. Tarik repo

```
git clone https://github.com/fyuhhh/Mailbox.git
```

`node_modules` sudah ikut di dalam repo. **Jangan jalankan `npm install`** — tidak
diperlukan, dan jaringan venue yang tersendat akan membuatnya gagal di saat
paling buruk.

### 2. Jalankan

Klik dua kali **`Jalankan Kiosk.bat`**. Tidak ada yang perlu disesuaikan.

Yang diurus sendiri oleh kiosk, tanpa ditanyakan:

| | |
|---|---|
| Node.js | diunduh sendiri ke folder itu bila belum ada |
| Alamat server, ukuran kertas, nama acara | sudah benar di `kiosk/.env.default` yang ikut repo |
| Printer | dicari sendiri di jaringan, dipakai, lalu diingat |
| Daftar member | ditarik sendiri dari server, diperbarui tiap 2 menit |
| Kode voucher | dimuat sendiri dari `kiosk/benih/kode-voucher.txt` |

### 3. Isi dua nilai rahasia — sekali seumur PC ini

Peramban akan terbuka di halaman **Penyiapan Kiosk**. Isi dua kotak:

| Isian | Dari mana |
|---|---|
| `SYNC_SECRET` | minta ke pemilik proyek — harus sama persis dengan yang di server |
| `SANDI_PETUGAS` | bebas ditentukan, untuk membuka halaman Persiapan Acara & Data Kiosk |

Tekan **Simpan & mulai**. Halaman itu tidak akan muncul lagi.

Jangan mengetik nilai ini di jendela hitam — tanda seru dan tanda `&` adalah
karakter khusus di cmd.exe dan bisa terpotong diam-diam. Formulir peramban tidak
punya masalah itu.

### 4. Buktikan perangkatnya — halaman Perangkat

Ketuk titik status **tiga kali** → **Perangkat**. Satu layar, tiga bagian:

- **Kamera** — pilih webcam eksternal, lihat pratinjaunya
- **Mikrofon** — pilih mikrofon webcam, **bicara dan pastikan meternya bergerak**,
  lalu tekan "Rekam 4 detik & putar". Halaman itu memeriksa isi berkasnya dan
  akan bilang **bisu** kalau tidak ada jalur suara.
- **Printer** — tekan "Cetak struk uji" dan pastikan kertasnya benar-benar keluar

Mikrofon adalah yang paling sering salah: peramban memakai **perangkat rekam
bawaan Windows**, bukan yang dipilih di aplikasi Camera. Kalau bawaannya bukan
mikrofon webcam, rekaman jadi bisu tanpa peringatan apa pun.

## Cara memastikan berhasil

Buka `http://localhost:4000`, ketuk **titik status tiga kali** → panel petugas →
**Data Kiosk** → masukkan `SANDI_PETUGAS`.

Yang harus terlihat:

| Baris | Nilai benar |
|---|---|
| Panel sinkron | hijau, **"Member tersinkron"** |
| Sumber | `HTTPS://UNDANGAN.OPSJOBS.ID` |
| Member PAM-PLUS | **16.054 baris** (angka ini tumbuh sendiri kalau pihak ketiga kirim data baru) |
| Kode Gift Voucher | **20 baris** |
| Tamu & Undangan | **0 baris** sebelum acara |

Kalau panelnya **merah**, tulisannya menyebut sendiri masalahnya:

- `SALAH SUMBER — menarik dari server lokal` → perbaiki `BASE_URL` (lihat langkah 3)
- `SYNC_SECRET kosong` → isi di `kiosk/.env`
- `Penarikan member GAGAL: <sebab>` → jaringan, atau `SYNC_SECRET` tidak cocok

Ada tombol **"Tarik member sekarang"** untuk menarik seketika tanpa menunggu.

---

## Hal yang WAJIB dipahami sebelum menyentuh apa pun

### Daftar member TIDAK ada di repo, dan memang tidak boleh

Kiosk menariknya sendiri dari VPS saat menyala dan setiap 2 menit, dengan server
sebagai sumber kebenaran (`ganti: true`). Mini PC yang baru di-clone akan terisi
16.054 member dengan sendirinya, dan setiap kiriman baru pihak ketiga ke
`POST /api/member` ikut masuk tanpa disentuh.

**Jangan** menyalin `member.db` ke repo. Isinya 16 ribu nama dan nomor telepon
orang sungguhan, titipan pihak ketiga, dan repo ini publik. Selain itu salinannya
akan langsung basi.

### Kode voucher hanya masuk sekali

`kiosk/benih/kode-voucher.txt` dibaca **hanya** saat persediaan masih kosong.
Menjalankan kiosk berulang kali tidak mengimpor ulang — kalau tidak begitu, kode
yang sudah keluar akan kembali jadi "belum terpakai" dan dua orang membawa pulang
kode yang sama.

**20 kode di berkas itu adalah kode UJI COBA** (dari berkas "Testing PromoCode
Voucher 2026"). Sebelum 9 September, ganti seluruh isinya dengan kode produksi,
lalu di halaman Persiapan Acara: **kosongkan** persediaan → **impor** ulang.
Kode uji akan ditolak kasir, dan tamu sudah pergi saat itu ketahuan.

### Data tidak pernah ditimpa

`kiosk/benih/` ditanam ke `kiosk/data/` **satu kali**, ditandai berkas
`data/.benih-terpasang`. Menjalankan ulang kiosk tidak pernah menimpa daftar
tamu, kode yang sudah keluar, atau rekaman video.

Kalau memang ingin memulai benar-benar dari nol: hapus folder `kiosk/data/`.

### Jangan jalankan `undangan/` di mini PC

Sudah jalan di VPS. Menjalankannya di sini membuat kiosk berpotensi menarik dari
server lokal yang kosong — persis masalah `BASE_URL` di atas.

---

## Sebelum acara — daftar periksa

- [ ] Halaman Perangkat: kamera **menyala**, mikrofon **suara terekam**, printer **siap**
- [ ] Panel Data Kiosk hijau, sumber `HTTPS://UNDANGAN.OPSJOBS.ID`
- [ ] Member 16.054 (atau lebih, kalau pihak ketiga kirim lagi)
- [ ] **Kode produksi sudah menggantikan 20 kode uji**
- [ ] Cetak struk percobaan, **pindai QR-nya dengan ponsel yang memakai data
      seluler, bukan WiFi venue** — ini satu-satunya cara membuktikan `BASE_URL`
      benar
- [ ] Printer termal menyala dan kertasnya cukup
- [ ] Kamera berfungsi (layar pindai QR terbuka sendiri di mode khusus member)
- [ ] Putar layar disetel sesuai pemasangan TV (panel petugas → Putar layar)
- [ ] Reset nomor tamu ke 001 sesudah semua percobaan selesai
      (Persiapan Acara → Reset nomor tamu)

---

## Hal yang belum pernah diuji di Windows

Dikembangkan di macOS. Yang belum terbukti dan harus dicoba **jauh sebelum
hari-H**, bukan di hari-H:

1. `Jalankan Kiosk.bat` — pengunduhan Node.js otomatis dan mode kiosk Chrome
2. Pencetakan ke printer termal dari Windows
3. Penyapuan jaringan menembus Windows Firewall
4. Kamera dan mikrofon webcam eksternal di Chrome Windows

Kalau ada yang gagal, laporkan pesan galatnya apa adanya. Jangan menambal dengan
menebak.
