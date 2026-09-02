# Kiosk Undangan QR

Tamu mengetik namanya di layar sentuh, struk ber-QR langsung tercetak, dan QR
itu membuka undangan digital berisi namanya sendiri.

```
  LOKASI ACARA                                  VPS
  ┌──────────────────────────────────┐        ┌────────────────────────┐
  │  Layar 43" portrait (Windows)    │        │  undangan.opsjobs.id   │
  │       ↓ ketik nama + ucapan      │        │                        │
  │  kiosk/  Node + SQLite  ─────────┼───────►│  undangan/  Node       │
  │       ↓ byte ESC/POS             │  POST  │       ↓                │
  │  Printer TECH CLA58 (58mm)       │        │  halaman undangan      │
  │       ↓                          │        └───────────┬────────────┘
  │  struk + QR ─────────────────────┼── scan ────────────┘
  └──────────────────────────────────┘          HP tamu, kuota sendiri
```

## Dua sifat yang menentukan seluruh rancangan

**Antrian tidak boleh berhenti.** Struk selalu dicetak lebih dulu; pengunggahan
ke VPS berjalan paralel dengan tenggat 2,5 detik dan kegagalannya ditelan.
Internet lokasi mati? Struk tetap keluar, datanya mengantre di SQLite, dan
terkirim sendiri begitu jaringan pulih. Printer macet? Alur tetap lanjut dan
tamu diarahkan memindai QR besar di layar.

**"Tercetak" harus berarti kertasnya keluar.** `lp` di macOS dan `copy` di
Windows sama-sama hanya memasukkan pekerjaan ke antrian lalu melaporkan sukses
— antrian milik printer yang tercabut pun menerimanya dengan patuh. Karena itu
`Printer.kirim()` memeriksa keadaan antrian sebelum mengirim, lalu menunggu
pekerjaannya hilang dari antrian sesudahnya. Tanpa keduanya, kiosk akan
memberi tahu tamu bahwa struknya tercetak padahal tidak ada kertas yang keluar,
lalu seluruh tumpukan itu muntah bersamaan saat kabelnya dicolok ulang.

**Tamu tidak menunggu printer.** Struk 58mm berisi QR butuh sekitar tujuh detik
untuk keluar — hampir seluruhnya kecepatan mekanis printer, bukan overhead
perangkat lunak (`lp` sendiri kembali dalam 16 ms). Menahan layar selama itu
berarti belasan menit antrean untuk seratus tamu, jadi `/api/daftar` menjawab
dalam puluhan milidetik dengan `tercetak: null`, menampilkan QR seketika, dan
menyusulkan hasil verifikasi lewat `/api/hasil-cetak/:kode`. Tamu memindai QR
sementara kertasnya masih menggulung.

Jalur **Cetak Ulang** justru sebaliknya: ia menunggu sampai tuntas, karena yang
menekannya adalah petugas yang sedang menghadapi masalah dan butuh jawaban
pasti, bukan tamu yang sedang mengantre.

**Pemindaian QR tidak boleh berujung galat.** Kode yang belum tersinkron atau
salah ketik tetap menampilkan undangan utuh, hanya tanpa sapaan personal.

## Dua jalur tamu

```
  pilih ─┬─ "Isi Nama & Ucapan"  → nama → ucapan ──────────┐
         └─ "Member PAM-PLUS"    → pindai ─────────────────┤   nama dari kartu
                                    └ kartu tak dikenal → nama
                                                            └→ siap (60 dtk, boleh dilewati)
                                                               → aba-aba 5 dtk
                                                               → rekam 15 dtk
                                                               → tinjau (putar / ulang / kirim)
                                                               → cetak
```

Member yang kartunya membawa nama **tidak melewati layar ketik nama sama
sekali** — memintanya mengetik ulang nama yang baru saja dibaca mesin hanya
memperlambat antrean dan mengundang salah ketik. Layar ketik nama hanya muncul
bila namanya benar-benar tidak bisa ditemukan.

Yang membedakan keduanya hanya **satu layar** dan **jenis struk**:

| | Tamu umum | Member PAM-PLUS |
|---|---|---|
| Masuk lewat | Ketik nama | Pindai kartu member |
| Ucapan tertulis | Ya | Tidak — cukup video |
| Struk keluar | **Undangan** | **Voucher diskon 20%** |
| Isi QR | Nama, ucapan, video | Nama, video, klaim voucher |

Seluruh bagian perekaman dipakai bersama kedua jalur. Menduplikasinya per jalur
berarti dua tempat untuk memperbaiki setiap kesalahan pengaturan waktu kamera —
dan pengaturan waktu itulah bagian yang paling mudah salah.

Angka waktunya ada di atas [kiosk/public/app.js](kiosk/public/app.js):
`SIAP_DETIK`, `ABA_DETIK`, `REKAM_DETIK`.

### Format QR kartu member

Format kartu PAM-PLUS belum dipastikan, jadi empat bentuk yang lazim dipakai
penerbit kartu diterima sekaligus. Memilih satu bentuk lalu keliru berarti
setiap kartu ditolak di depan antrean tamu pada hari acara.

| Isi QR | Kode | Nama |
|---|---|---|
| `{"id":"PP-9001","nama":"Rina Kartika"}` | PP-9001 | Rina Kartika |
| `PP-9002\|Budi Hartono` | PP-9002 | Budi Hartono |
| `PP-9003;Sari Melati` | PP-9003 | Sari Melati |
| `https://pamplus.id/m?id=PP-9004&nama=Agus Salim` | PP-9004 | Agus Salim |
| `PP-004821` | PP-004821 | dicari di `member.json` |

Nama **di kartu** didahulukan di atas `member.json`: itu yang dipegang tamu di
tangannya, sedangkan daftar di kiosk bisa tertinggal beberapa hari dari data
keanggotaan.

### Daftar member

`kiosk/data/member.json`, dibaca ulang **setiap pemindaian** sehingga bisa
diperbarui di tengah acara tanpa mematikan kiosk:

```json
{ "PP-004821": "Dimas Prayoga", "PP-001234": "Siti Rahayu" }
```

Kartu yang belum ada di daftar **tidak ditolak** — pemegangnya tetap dilayani
dan mengetik namanya sendiri. Menolak di sini berarti menahan pemegang kartu
sah hanya karena daftar di kiosk belum diperbarui.

### Ke mana video pergi

```
  kamera  →  kiosk/data/video/sementara/<uuid>.webm     (diunggah saat tamu meninjau)
          →  kiosk/data/video/<KODE>.webm               (ditautkan saat menekan Kirim)
          →  antrian sinkronisasi                        (menyusul data tamu)
          →  undangan/data/video/<KODE>.webm             (disajikan ke ponsel tamu)
```

Tiga keputusan yang menopang alur ini:

- **Unggahan dimulai saat tamu meninjau**, bukan saat menekan Kirim. Menundanya
  berarti beberapa megabita berpindah persis ketika orang berikutnya sudah
  menunggu giliran.
- **Video menyusul di belakang data tamu** dalam antrian sinkronisasi. Nama yang
  muncul di halaman undangan jauh lebih mendesak daripada videonya, dan unggahan
  besar tidak boleh menahan data ringan di belakangnya.
- **Gagal unggah tidak menghentikan alur.** Struk tetap tercetak, hanya tanpa
  video. Menahan tamu karena masalah yang tidak bisa ia perbaiki sendiri akan
  menghentikan antrean.

Rekaman sementara yang tak pernah diklaim — tamu merekam lalu pergi — dibuang
otomatis setelah satu jam. Tanpa itu, disk kiosk yang penuh menghentikan bukan
hanya perekaman tetapi juga penulisan basis data, yaitu seluruh kiosk.

### Format rekaman

Chrome menghasilkan WebM (VP9/Opus), Safari menghasilkan MP4. Keduanya diterima
di seluruh rantai. Menerima satu jenis saja membuat perekaman di Safari gagal
pada langkah unggah — setelah tamu terlanjur merekam, yaitu titik paling mahal
untuk gagal.

## Menjalankan tanpa terminal

Klik dua kali salah satu berkas ini:

| Berkas | Untuk |
|---|---|
| `Jalankan Kiosk.command` | macOS |
| `Jalankan Kiosk.bat` | Windows |

Keduanya memanggil `mulai.mjs`, yang membuat `.env` dari contohnya bila belum
ada, memasang dependensi bila `node_modules` belum ada, menyalakan server, lalu
membuka Chrome dalam mode kiosk. Jendela hitam yang muncul **harus dibiarkan
terbuka** — menutupnya mematikan kiosk, dan itu disengaja: petugas butuh satu
tanda yang terlihat bahwa kiosk masih hidup.

Yang tetap harus dipasang sekali di setiap komputer: **Node.js 22+** dari
[nodejs.org](https://nodejs.org). Kedua penyala memeriksanya lebih dulu dan
menawarkan halaman unduhannya bila belum ada, jadi tidak ada pesan galat
membingungkan bagi yang bukan programmer.

`TANPA_PERAMBAN=1` melewati pembukaan Chrome, untuk mesin yang membukanya
sendiri lewat pintasan Startup Windows.

### Memindahkan ke komputer lain

Salin seluruh folder, lalu klik dua kali penyalanya. **Jangan** menyunting
`BASE_URL` — biarkan `AUTO`, dan kiosk akan memakai alamat LAN komputer tempat
ia dijalankan. Menuliskan IP secara tetap membuat folder ini tidak bisa
dipindahkan: di komputer lain, setiap QR yang tercetak akan menunjuk ke alamat
mesin yang lama, dan tidak ada yang menyadarinya sampai ada tamu yang mengeluh.

Folder `node_modules/` dan `data/` tidak perlu ikut disalin — yang pertama
dipasang ulang otomatis, yang kedua adalah data acara di mesin asal.

## Di mana datanya tersimpan

Semuanya **berkas biasa di komputer tempat kiosk berjalan** — tidak ada layanan
awan di antaranya.

| Berkas | Isi |
|---|---|
| `kiosk/data/kiosk.db` | Seluruh tamu: nama, ucapan, kode, waktu, status kirim, jumlah cetak |
| `undangan/data/undangan.db` | Salinan di sisi server undangan, plus catatan siapa sudah membuka |

Keduanya SQLite. Cadangkan dengan menyalin berkasnya — tapi salin juga
`-wal` dan `-shm` di sebelahnya, atau salin saat kiosk sedang mati; berkas
`.db` sendirian bisa tertinggal beberapa tulisan terakhir yang masih ada di
`-wal`.

Membaca isinya kapan saja:

```bash
sqlite3 kiosk/data/kiosk.db "SELECT id, kode, nama, pesan, dibuat_pada FROM tamu ORDER BY id;"
```

Kiosk adalah sumber kebenaran. Bila server undangan hilang seluruhnya, seluruh
data tamu tetap utuh di `kiosk.db` dan bisa dikirim ulang.

## Menjalankan di Mac (pengembangan)

```bash
cd undangan && npm install && cp .env.example .env   # isi SYNC_SECRET
cd ../kiosk  && npm install && cp .env.example .env   # SYNC_SECRET yang sama
```

Untuk menguji tanpa printer, set `PRINTER_DRYRUN=1` di `kiosk/.env` — struk
dibuang ke `kiosk/data/struk-uji/*.bin`.

```bash
node undangan/server.js     # http://localhost:5010
node kiosk/server.js        # http://localhost:4000
```

Uji tata letak kiosk di laptop: kecilkan jendela browser ke rasio 9:16. Seluruh
ukuran memakai `rem` yang terikat viewport, jadi tampilannya identik dengan
layar 43" yang sesungguhnya.

## Rancangan struk

Struk ini **suvenir acara, bukan nota transaksi**. Tamu akan menyimpannya,
memotretnya, dan menunjukkannya ke teman — jadi tidak ada satu pun keterangan
teknis di atasnya: tidak ada alamat server, tidak ada nomor perangkat, tidak
ada jenis printer.

Alamat lengkap yang dulu tercetak di bawah QR sudah dihapus dan digantikan
**kode empat huruf** yang dicetak renggang (`A 7 K 9`). Kode itu sama-sama bisa
dicari petugas di stasiun check-in, tetapi terbaca sebagai nomor tiket, bukan
sebagai alamat internet.

```
 * . * . * . * . * . * . * . * . * . * . * . *

                HUT EWALK KE-10

 * . * . * . * . * . * . * . * . * . * . * . *

               U N D A N G A N
                    untuk

           D i m a s   P r a y o g a

  "Selamat ulang tahun EWALK, makin sukses!"

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

             Pindai untuk membuka
              undangan digitalmu

                 [ KODE QR ]

                A   7   K   9

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

      Tamu ke-42   -   20/09/2026 18:42

          Terima kasih sudah datang!

 * . * . * . * . * . * . * . * . * . * . * . *
```

Hiasannya **hanya memakai karakter ASCII**. Printer struk memang punya karakter
garis kotak di CP437, tetapi tiap merek memetakannya berbeda — yang tampak rapi
di satu printer keluar sebagai simbol acak di printer cadangan, dan itu baru
ketahuan saat printer utama bermasalah di tengah acara.

### Pratinjau kamera = hasil rekaman

Kamera memberi bingkai landscape 1280×720 sementara kotak pratinjau portrait
1080×1920. Dengan `object-fit: cover`, yang terlihat hanya **32% bagian tengah
lebar bingkai** — sedangkan MediaRecorder tetap merekam 1280×720 seluruhnya.
Tamu jadi membingkai dirinya berdasarkan potongan yang bukan yang direkam, lalu
kaget melihat hasilnya. Karena itu pratinjaunya memakai `contain`.

Voucher member memakai kerangka yang sama dengan pembatas `* ~ * ~`, dan
nominalnya dicetak paling besar di paling atas: voucher itu akan dilipat, masuk
kantong, lalu dikeluarkan lagi di depan kasir — yang harus terbaca sekilas
dalam keadaan itu adalah nilainya, bukan nama pemiliknya.

## Memeriksa struk tanpa membuang kertas

```bash
cd kiosk
node src/cek-printer.js                    # pratinjau teks + hitungan muat QR
node src/cek-printer.js --nama="Nama Uji"  # coba nama terpanjang
node src/cek-printer.js --cetak            # kirim ke printer sungguhan
```

Perhatikan baris **mode QR**. Ia harus berbunyi `alfanumerik (hemat)`. Bila
tertulis `BYTE`, ada huruf kecil di `BASE_URL`: QR akan melonjak beberapa versi,
jadi jauh lebih rapat, dan mulai gagal discan dari kertas thermal.

## Kenapa URL ditulis HURUF BESAR

Skema dan nama host pada URL bersifat case-insensitive, sedangkan mode
alfanumerik QR hanya menerima `A-Z 0-9 $%*+-./:`. Menulis seluruh URL dengan
huruf besar membuatnya muat di mode alfanumerik:

| Bentuk | Mode | Simbol | Modul terbesar yang muat di 58mm |
|---|---|---|---|
| `https://undangan.opsjobs.id/u/A7K9` | byte | 29×29 (v3) | 10 dot → 370/384 |
| `HTTPS://UNDANGAN.OPSJOBS.ID/U/A7K9` | alfanumerik | **25×25 (v2)** | **11 dot → 363/384** |

Keduanya muat, tetapi bentuk huruf besar memuat simbol dalam 25 kotak per sisi,
bukan 29. Pada lebar cetak yang sama, tiap kotak jadi sekitar 16% lebih besar —
dan itulah satu-satunya hal yang menentukan apakah QR masih terbaca setelah
kepala cetak thermal sedikit meleberkan tepi tiap kotak, atau kertasnya sempat
terlipat di kantong tamu.

Angka di atas dihitung ulang oleh `node src/cek-printer.js` setiap kali
`BASE_URL` diubah, jadi domain yang lebih panjang akan langsung terlihat
akibatnya sebelum kertas pertama tercetak.

## Menyiapkan VPS (sekali saja)

1. hPanel → DNS Manager → tambah A record `undangan` → `<IP-VPS-KAMU>`
2. Tunggu propagasi: `dig +short undangan.opsjobs.id`
3. Salin berkas Nginx:
   ```bash
   scp deploy/nginx/undangan-limit.conf          root@<IP-VPS-KAMU>:/etc/nginx/conf.d/
   scp deploy/nginx/undangan.opsjobs.id.conf     root@<IP-VPS-KAMU>:/etc/nginx/sites-available/
   ```
4. Di server: `bash setup-vps.sh`, lalu buat `/opt/undangan/.env`
5. Dari Mac: `./deploy/deploy.sh`
6. Di server: `pm2 start /opt/undangan/deploy/ecosystem.config.cjs && pm2 save`
7. `certbot --nginx -d undangan.opsjobs.id`

Update berikutnya cukup `./deploy/deploy.sh`.

## Menyiapkan PC kiosk (Windows)

1. Pasang Node.js 22+ dan driver printer TECH CLA58
2. Printer Properties → **Sharing** → centang *Share this printer*, beri nama
   share tanpa spasi, lalu tulis nama itu di `PRINTER_NAME`
3. Putar layar ke portrait: Settings → Display → Orientation → Portrait
4. `npm install` di folder `kiosk`, isi `.env`
5. Uji: `node src/cek-printer.js --cetak`
6. Jalankan `node server.js`, lalu buka Chrome:
   ```
   chrome.exe --kiosk --app=http://localhost:4000 --touch-events=enabled
   ```

Taruh langkah 6 di folder Startup agar kiosk hidup sendiri setelah PC menyala.

## TV landscape yang digantung miring

TV 43" di acara ini tidak punya pilihan rotasi layar: sinyal masuknya tetap
1920×1080 landscape, sementara perangkatnya digantung miring sehingga sisi
panjangnya berdiri tegak. Yang bisa diputar hanya isinya.

Atur lewat **Panel Petugas → Pengaturan Waktu → Putar layar**:

| Nilai | Isi berputar | Dipakai bila TV digantung |
|---|---|---|
| `0` | tidak | layar memang portrait |
| `90` | searah jarum jam | berlawanan arah jarum jam |
| `270` | berlawanan arah jarum jam | searah jarum jam |

Coba `90` dulu; kalau tulisannya terbalik, ganti ke `270`.

Panggung tetap berbentuk portrait 9:16 lalu diputar utuh, sehingga pada layar
1920×1080 ia menjadi 1080×1920 yang mengisi bidang itu **tepat tanpa sisa**
(diverifikasi: kotak terpasang 1920×1080 di posisi 0,0). Satuan font ikut
ditukar — setelah diputar, lebar panggung terbentang di sepanjang tinggi layar,
jadi acuannya `100vh`, bukan `100vw`. Hasilnya ukuran huruf identik dengan mode
portrait.

Pilihannya diingat di peramban dan dipasang **sebelum bingkai pertama
digambar**. Tanpa itu, setiap pemuatan ulang menampilkan layar tegak lalu
berkedip miring — di TV yang digantung tetap, itu terlihat seperti perangkat
rusak, dan petugas akan mencoba "memperbaikinya".

## Pratinjau TV

**http://localhost:4000/pratinjau.html**

Menguji tampilan di laptop menyesatkan: yang akhirnya dipasang adalah TV 43"
landscape yang digantung miring. Halaman ini memisahkan dua hal yang sering
tertukar:

| Tombol | Menunjukkan |
|---|---|
| **Sinyal ke TV** | Gambar 1920×1080 apa adanya yang dikirim ke TV — miring |
| **Pandangan tamu** | Bingkai TV ikut dimiringkan, jadi terbaca tegak seperti di lokasi |
| **Putar 90° / 270°** | Membandingkan kedua arah pasang tanpa mengubah setelan kiosk |

Iframe-nya dirender pada ukuran TV yang sesungguhnya lalu diperkecil gambarnya.
Menyusutkan iframe secara langsung akan mengubah viewport di dalamnya, dan
seluruh tata letak kiosk terikat pada viewport — yang terlihat bukan lagi yang
akan muncul di TV.

Arah putaran di halaman ini memakai `?putar=` yang **menimpa tanpa menyimpan**,
jadi kiosk di layar penyetel tetap tegak dan bisa dipakai sementara pratinjaunya
miring. Diverifikasi: membuka `/` biasa tetap `data-putar=0` sesudahnya.

## Sistem tipografi

Semua ukuran teks memakai **satu skala** yang didefinisikan di `:root`. Nilai
lepas tidak diperbolehkan.

| Token | Ukuran | Dipakai untuk |
|---|---|---|
| `--t-xs` | 0.95rem | keterangan kecil |
| `--t-sm` | 1.2rem | teks pendamping |
| `--t-md` | 1.5rem | badan teks, label |
| `--t-lg` | 1.9rem | tombol, teks penegas |
| `--t-xl` | 2.4rem | judul kartu, masukan |
| `--t-2xl` | 3rem | judul layar |
| `--t-3xl` | 3.8rem | judul utama |
| `--t-angka` | 15rem | angka hitung mundur (penanda, bukan teks baca) |

Bobot huruf tiga langkah: `--b-normal` (400), `--b-tegas` (600), `--b-judul`
(800). Jarak dan sudut ikut tangga yang sama (`--s-1`..`--s-6`, `--sudut`,
`--sudut-l`, `--sudut-pil`).

Sebelum dirapikan ada **21 ukuran font berbeda dan 5 bobot huruf**, tumbuh satu
per satu setiap kali ada yang disetel. Hasilnya tidak pernah terlihat sengaja:
dua tulisan yang seharusnya setara tampil sedikit berbeda, dan mata membaca
selisih kecil itu sebagai kecerobohan.

Bila menambah komponen baru, pakai token yang sudah ada. Kalau tidak ada yang
cocok, itu tanda skalanya perlu ditinjau — bukan tanda perlu menambah satu
nilai lepas.

### Dua kartu pilihan harus sepadan

Judul kedua kartu dijaga tetap pendek dan sama panjangnya secara visual, dengan
`min-height` yang sama. Sebelumnya judul kartu member berupa satu kalimat penuh
yang membungkus jadi tiga baris dan terpenggal di tanda hubung (`PAM-` /
`PLUS!`) — dua pilihan yang seharusnya setara tampil dengan bobot berbeda, dan
tamu membaca perbedaan itu sebagai petunjuk mana yang "utama". Kalimat lengkapnya
dipindah ke baris keterangan.

## Latar dan warna

Latar acara memakai `kiosk/public/latar.jpg` (templat ONE7ELEVEN, 1004×2008).
Paletnya diambil dengan **mencuplik piksel gambar aslinya**, bukan dikira-kira:

| Bagian | Warna |
|---|---|
| Tengah terang | `#d6d4e6` |
| Tepi atas | `#9278ae` |
| Tepi bawah | `#9496bd` |
| Rerata | `#aca4ca` |

Latarnya terang di tengah dan ungu di tepi — kebalikan dari tema gelap
sebelumnya, jadi seluruh arah kontras dibalik: tinta gelap di atas bidang
terang. Zona sentuh memakai panel kaca buram (`backdrop-filter`) supaya papan
ketik tetap terbaca di kedua keadaan itu tanpa menutupi motif logamnya.

Dua hal yang menentukan tata letaknya:

- **Ruang bebas logo.** Logo ONE7ELEVEN adalah bagian dari gambar latar di
  posisi tetap sekitar 15% tinggi panggung, sedangkan isi layar bergeser —
  layar bermasukan punya zona pajang yang jauh lebih pendek. Tanpa
  `padding-top: 14rem` pada `.zona-pajang`, judulnya naik menabrak logo dan
  keduanya jadi tak terbaca.
- **Gambar dipasang pada panggung, bukan pada `body`.** Panggung itulah yang
  ikut diputar untuk TV miring; kalau gambarnya menempel di `body`, ia tetap
  tegak sementara isinya berputar.

Mengganti latar: timpa `kiosk/public/latar.jpg`. Rasio yang cocok 9:16; gambar
yang lebih ramping akan dipangkas di bagian bawah, tidak pernah di logo.

## Bingkai layar terkunci 9:16

Panggung kiosk dikunci pada rasio layar sungguhan lalu dipusatkan:

```css
.panggung {
  width:  min(100vw, calc(100vh * 9 / 16));
  height: min(100vh, calc(100vw * 16 / 9));
  margin-inline: auto;
}
```

Tanpa ini, tata letak melar mengikuti bentuk jendela: di laptop 16:10 zona
sentuh menjadi pendek dan lebar sehingga papan ketik terdorong keluar layar,
dan apa yang terlihat saat menyetel sama sekali bukan apa yang akan muncul di
layar 43" nanti. Dengan dikunci, jendela seukuran apa pun menampilkan bingkai
yang identik dengan perangkat sungguhan — hanya lebih kecil, dengan pita kosong
di kiri-kanan.

Diverifikasi tidak ada satu pun elemen yang melewati bingkai pada 1080×1920,
2160×3840, 1990×1160, 1440×900, dan 1280×800.

Dua jebakan yang ditemukan saat memverifikasinya:

- **Baris grid `auto` menolak menyusut.** Pembagian tetap 42/58 memotong
  puluhan piksel di bawah setiap layar bermasukan — tepat di tempat tombol
  utama berada. Sekarang `minmax(0, 1fr) auto`: zona sentuh mengambil setinggi
  isinya, sisanya jatuh ke zona pajang.
- **`aspect-ratio` menghitung dari sisi yang salah.** Pemutar tinjau memakai
  `aspect-ratio: 9/16` dengan `height: 100%` di dalam kotak yang tingginya
  ditentukan flex. Karena tidak ada sisi yang pasti, peramban jatuh ke lebar:
  977px lebar menjadi 1737px tinggi, dan tombol Kirim terdorong jauh ke luar
  bingkai — makin parah justru pada jendela yang makin lebar. Diganti dengan
  penempatan absolut + `object-fit: contain`, yang menghapus seluruh
  perhitungan itu.

## Stasiun check-in (kamera laptop)

Buka **http://localhost:4000/scan.html** — atau tekan tiga kali titik status di
layar kiosk, lalu pilih *Check-in Tamu*.

Tamu menunjukkan struknya ke kamera laptop, QR terbaca, kehadirannya tercatat.
Hasilnya dibedakan oleh warna **dan** kata, tidak pernah oleh warna saja: pintu
masuk acara sering remang, dan sebagian orang tidak membedakan merah dari hijau.

| Hasil | Arti |
|---|---|
| **Selamat datang** (hijau) | Tamu terdaftar, baru pertama masuk |
| **Sudah check-in sebelumnya** (kuning) | Kartu yang sama dipakai lagi — jam masuk pertamanya ikut ditampilkan |
| **Kode tidak dikenal** (merah) | Kode sah bentuknya, tetapi tidak ada di daftar tamu kiosk ini |
| **QR tidak terbaca** (merah) | Yang terbaca bukan kode tamu |

Nada pendek yang berbeda menyertai masing-masing, karena petugas di pintu
memandangi tamu, bukan layar.

Kolom **ketik kode manual** menerima kode empat huruf yang tercetak di bawah QR
— jalan keluar ketika struknya sobek, pudar, atau kameranya bermasalah. Kolom
itu juga menerima URL lengkap, jadi hasil pemindaian dari aplikasi lain bisa
ditempel apa adanya.

### Syarat yang tidak bisa dilanggar

Kamera hanya bisa diakses dari **secure context**. `http://localhost` termasuk;
`http://192.168.x.x` **tidak**. Jadi halaman ini harus dibuka di laptop yang
menjalankan kiosk — membukanya lewat alamat LAN dari ponsel akan gagal dengan
sendirinya, dan halaman akan mengatakannya alih-alih diam.

### Bagaimana ini diuji

Kamera diuji dengan kamera sintetis Chrome yang memutar berkas video berisi QR
sungguhan (`--use-file-for-fake-video-capture`), sehingga seluruh rantai
benar-benar dijalankan: izin kamera, aliran video, penurunan resolusi bingkai,
pendekodean jsQR, permintaan ke API, dan penulisan ke basis data.

jsQR juga diuji terpisah terhadap QR yang dihasilkan kiosk ini sendiri, dan
terbaca benar sampai ukuran 3 piksel per modul — jauh lebih kecil daripada
struk yang dipegang di depan kamera laptop.

### Mengosongkan data sebelum acara

```bash
sqlite3 kiosk/data/kiosk.db "UPDATE tamu SET hadir_pada = NULL, jumlah_scan = 0;"   # reset kehadiran saja
sqlite3 kiosk/data/kiosk.db "DELETE FROM tamu;"                                      # hapus seluruh tamu uji
```

## Perilaku layar hasil

| | Nilai | Alasan |
|---|---|---|
| Hitung mundur **Selesai** | 60 detik | Cukup untuk memindai QR, membaca undangan, dan menunggu struk keluar. Menekan **Selesai** langsung mengakhiri; dibiarkan pun kiosk kembali sendiri untuk tamu berikutnya. |
| Tombol **Selesai** saat merekam | aktif setelah 3 detik | Tamu boleh berhenti kapan saja tanpa menunggu 15 detik penuh — tidak semua orang butuh selama itu, dan menahan mereka menatap kamera memperlambat antrean tanpa alasan. Tiga detik pertama tombolnya mati: klip satu detik tidak berguna, dan tamu yang gugup menekan apa pun yang terlihat. |
| Jeda **Cetak Ulang** | 15 detik | Tombolnya ada tepat di jangkauan tamu yang gugup menunggu struknya. Tanpa jeda, satu ketukan berulang bisa menghabiskan setengah gulungan kertas sebelum petugas sempat menengok. |

Selama jeda, tombolnya menampilkan sisa detik (`Tunggu (9)`) alih-alih sekadar
mati — tombol mati tanpa keterangan akan ditekan berkali-kali karena dikira
rusak.

### Diubah dari layar, bukan dari kode

Seluruh angka waktu diatur lewat **Panel Petugas** — ketuk tiga kali titik
status, lalu bagian *Pengaturan Waktu*:

| Pengaturan | Rentang | Bawaan |
|---|---|---|
| Durasi rekaman | 5–15 dtk | 15 |
| Aba-aba sebelum rekam | 3–10 dtk | 5 |
| Waktu bersiap | 15–180 dtk | 60 |
| Layar hasil | 15–120 dtk | 60 |
| Jeda cetak ulang | 0–60 dtk | 15 |

Nilai yang tepat baru ketahuan di lokasi acara: berapa lama tamu sebenarnya
butuh bersiap, seberapa panjang antreannya, seberapa sabar orang menunggu.
Menanamkannya di kode berarti setiap penyesuaian kecil menuntut orang yang bisa
menyunting berkas dan menyalakan ulang kiosk — di tengah acara itu tidak akan
terjadi, dan angkanya dibiarkan salah sampai selesai.

Perubahan berlaku untuk **tamu berikutnya**, tanpa menyalakan ulang apa pun.
Tersimpan di `kiosk/data/pengaturan.json` dan bertahan setelah kiosk dimatikan.

Batas atasnya bukan hiasan: rekaman lebih dari 15 detik membuat berkas membengkak
dan antrean berhenti, sedangkan aba-aba di bawah 3 detik membuat tamu terekam
sedang kebingungan mencari kamera. Nilai di luar rentang **dipaksa masuk**, bukan
ditolak — petugas yang menahan tombol tambah tidak sedang menyerang apa pun, ia
hanya ingin nilai tertingginya.

## Printer lewat jaringan (LAN)

Isi `PRINTER_HOST` di `kiosk/.env` dan seluruh jalur CUPS dilewati — byte
ESC/POS dikirim langsung ke soket printer:

```bash
PRINTER_HOST=192.168.1.102
PRINTER_PORT=9100
PRINTER_WIDTH=80
```

Ini jalur yang lebih sederhana **dan** lebih jujur daripada lewat CUPS: tidak
ada antrian sistem yang bisa menampung pekerjaan diam-diam untuk printer yang
sudah mati, dan tidak ada driver yang perlu dipasang di mesin kiosk. Soket yang
tersambung dan tuntas terkirim berarti byte-nya benar-benar sampai.

Satu keputusan yang perlu diketahui: **printer jaringan tidak diperiksa lebih
dulu sebelum dikirimi.** Pra-periksa membuka satu sambungan TCP lalu langsung
memutusnya, tepat sebelum sambungan yang sesungguhnya — dan banyak printer
struk jaringan hanya melayani satu sambungan pada satu waktu, sehingga koneksi
buangan itu justru bisa membuat cetakan ditolak. Tidak ada yang hilang dengan
melewatinya: pengiriman ke printer yang tak terjangkau tetap gagal dengan pesan
yang sama.

### Syarat mutlak: satu jaringan

PC kiosk dan printer harus berada di subnet yang sama. Cek dengan:

```bash
node -e 'const s=require("net").connect(9100,"192.168.1.102",()=>{console.log("port 9100 TERBUKA");s.end()});s.setTimeout(3000);s.on("timeout",()=>{console.log("timeout — beda jaringan / printer mati");s.destroy()});s.on("error",e=>console.log(e.code))'
```

Pesan galat sudah diterjemahkan ke tindakan:

| Kode soket | Yang ditampilkan kiosk |
|---|---|
| `ECONNREFUSED` | cetak mentah mungkin dimatikan di setelan printer |
| `EHOSTUNREACH` / `ENETUNREACH` | printer berada di jaringan lain |
| `ETIMEDOUT` | cek kabel LAN, daya, dan alamatnya |
| `ENOTFOUND` | nama host tidak dikenali di jaringan ini |

Beri printer **IP statis** di jaringan acara. Kalau ia mengandalkan DHCP lalu
dapat alamat berbeda setelah router restart, kiosk kehilangan printernya di
tengah acara.

### Jangan percaya dialog cetak macOS

Dialog cetak menampilkan antrian yang **terdaftar**, bukan yang bisa dihubungi.
Sebuah antrian bisa muncul rapi lengkap dengan nama dan pilihan kertas
sementara printernya berada di jaringan yang sama sekali tidak terjangkau.
Yang membuktikan hanya dua hal: `lpstat -W completed -o <antrian>` yang berisi
pekerjaan selesai, atau kertas yang benar-benar keluar.

Catatan terkait: antrian IPP generik yang dibuat macOS tanpa driver asli akan
menampilkan **A4** sebagai ukuran kertas apa pun perangkat sebenarnya — itu
bukan bukti printernya A4.

## Kalau printer "kadang tidak terbaca"

Gejala ini punya satu sebab perangkat lunak yang sudah diperbaiki, dan beberapa
sebab perangkat keras yang harus dicari sendiri.

### Yang sudah diperbaiki

CUPS menyimpan pendapat terakhirnya tentang printer. Sesudah cetak berhasil,
`lpstat` berbunyi `is idle` dan `printer-state-reasons` menjadi `none` — lalu
**keduanya bertahan tak berubah walau kabelnya dicabut**, sampai ada pekerjaan
berikutnya yang gagal. Di jendela itu kiosk mengira dirinya siap, menerima
tamu, dan membuatnya menunggu struk yang tidak akan pernah keluar.

Sekarang kehadiran fisik diperiksa lebih dulu lewat `ioreg`, bukan lewat
pendapat CUPS. Pilihan itu diambil dari pengukuran:

| Cara | Waktu | Jujur saat kabel baru dicabut? |
|---|---|---|
| `lpstat -l -p` | 11 ms | tidak |
| `lpinfo -v` | **14.581 ms** | ya |
| `ioreg -p IOUSB` | **6 ms** | ya |

`lpinfo` ikut memindai backend jaringan, jadi mustahil dipakai sebelum tiap
cetak. `ioreg` membaca registry perangkat keras dan selesai dalam 6 ms.

Tiga perbaikan lain menyertainya:

- **Antrian pulih sendiri.** CUPS menonaktifkan antrian setiap kali gagal
  mengirim dan tidak pernah menyalakannya kembali. Pemantau tiap 5 detik
  menyalakannya lagi — tetapi **hanya bila perangkatnya memang ada**, karena
  menyalakan antrian untuk printer yang lepas hanya membuat struk menumpuk
  diam-diam lalu muntah beruntun saat kabelnya tersambung.
- **Pekerjaan macet dibatalkan tepat sasaran.** ID pekerjaan ditangkap dari
  keluaran `lp`, jadi yang dibuang hanya struk yang gagal, bukan seluruh
  antrian berisi struk tamu lain.
- **Satu kali coba ulang** bila pengiriman gagal padahal perangkatnya ada.
  Fase verifikasi tidak pernah diulang: struk yang belum keluar masih mungkin
  menyusul, dan mencetak ulang di titik itu memberi satu tamu dua struk.

### Mencari sebab perangkat kerasnya

```bash
cd kiosk
node src/pantau-printer.js              # sampai Ctrl+C
node src/pantau-printer.js --menit=30
```

Biarkan berjalan sambil mencetak beberapa struk. Setiap perpindahan direkam ke
`kiosk/data/pantau-printer.log` beserta waktunya, dan ringkasannya muncul saat
dihentikan. Cocokkan waktu putusnya dengan apa yang sedang kamu lakukan:

| Pola | Sebab paling mungkin | Tindakan |
|---|---|---|
| Putus tepat **saat mencetak** | Kepala cetak menarik lonjakan arus, tegangan turun, perangkat lepas dari bus | Pakai adaptor daya printer sendiri, atau hub USB berdaya. Jangan ambil daya dari port laptop saja |
| Putus setelah **lama diam** | Port USB ditidurkan sistem operasi | Windows: Device Manager → USB Root Hub → Power Management → hapus centang *Allow the computer to turn off this device* |
| Putus **tanpa pola**, sering saat tersenggol | Kabel atau konektor | Ganti kabel; colok langsung ke komputer, bukan lewat hub, dok, atau port monitor |

Untuk PC kiosk Windows, mematikan *USB selective suspend* di Power Options
adalah langkah standar dan sebaiknya dilakukan sekalipun gejalanya belum
muncul — port yang tertidur di tengah acara terlihat persis seperti printer
rusak.

## Panel petugas

Ketuk **tiga kali** titik status di pojok kanan atas layar. Isinya keadaan
printer, jumlah tamu, jumlah yang belum terkirim, dan tombol *Pulihkan Printer*
untuk mengaktifkan kembali antrian setelah kabel sempat tercabut.

Warna titik: hijau normal, kuning ada antrian belum terkirim, merah berkedip
printer bermasalah.

Tombol **Pulihkan Printer** melakukan dua hal: mengaktifkan kembali antrian
CUPS yang dinonaktifkan sendiri saat printer sempat tercabut, dan membuang
pekerjaan yang tertahan. Yang kedua penting — tanpa itu, struk-struk lama akan
keluar beruntun begitu kabelnya tersambung lagi, dan tamu menerima struk milik
orang lain.

## Sebelum hari-H

- [ ] Cetak uji dari kiosk sungguhan, pindai QR-nya dengan **beberapa merek HP**
- [ ] Cabut kabel printer di tengah pendaftaran, daftarkan satu tamu, dan
      pastikan layar hasil berbunyi *"Struk tidak tercetak"* — bukan pesan
      normal. Bila yang muncul pesan normal, pemeriksaan antrian tidak bekerja
      dan seluruh acara akan berjalan tanpa ada yang menyadari printer mati.
- [ ] Colok kabel lagi, tekan **Pulihkan Printer**, pastikan tidak ada struk
      lama yang muntah beruntun
- [ ] Matikan WiFi PC, daftarkan 2 tamu, nyalakan lagi, pastikan `tertunda`
      kembali ke 0
- [ ] Siapkan gulungan kertas thermal cadangan
- [ ] Isi seluruh nilai di `undangan/.env` di server (tanggal, lokasi, peta)

## Peta berkas

| Berkas | Isi |
|---|---|
| [kiosk/src/escpos.js](kiosk/src/escpos.js) | Penyusun perintah ESC/POS dan hitungan muat QR |
| [kiosk/src/printer.js](kiosk/src/printer.js) | Pengiriman byte ke printer + tata letak struk |
| [kiosk/src/sync.js](kiosk/src/sync.js) | Antrian unggah yang tahan jaringan putus |
| [kiosk/public/gaya.css](kiosk/public/gaya.css) | Tata letak layar 43" portrait |
| [kiosk/public/scan.js](kiosk/public/scan.js) | Stasiun check-in: kamera + pendekodean QR |
| [kiosk/src/pantau-printer.js](kiosk/src/pantau-printer.js) | Perekam sambungan printer untuk gangguan intermiten |
| [undangan/server.js](undangan/server.js) | API penerimaan + penyajian halaman |
| [undangan/public/undangan.html](undangan/public/undangan.html) | Halaman undangan |
