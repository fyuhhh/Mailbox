# API Data Member PAM-PLUS

Dokumen untuk pihak yang mengirimkan data keanggotaan.

---

## Alamat

```
POST https://undangan.opsjobs.id/api/member
```

## Header

```
Content-Type: application/json
x-api-key: pam_VLiRH_sMxCzZy-SeyqmMgzMbY3T2JUmy
```

> Kunci ini rahasia. Jangan ditaruh di kode yang dibagikan, di repositori
> publik, atau di aplikasi sisi klien. Kalau bocor, kabari kami — kunci bisa
> diganti tanpa mengubah apa pun di sisi Anda selain satu baris.

## Isi kiriman

Larik objek. Tiga kolom:

| Kolom | Wajib | Keterangan |
|---|---|---|
| `nama` | ya | Minimal 2 huruf |
| `id_pam` | ya | Nomor keanggotaan, unik |
| `nomor_hp` | tidak | Format bebas |

```json
[
  { "nama": "Rina Kartika", "id_pam": "PP-100001", "nomor_hp": "081234567890" },
  { "nama": "Budi Hartono", "id_pam": "PP-100002", "nomor_hp": "081234567891" }
]
```

### Nama kolom alternatif yang juga diterima

Tidak perlu mengubah bentuk ekspor Anda. Semua ini dikenali:

| Untuk | Diterima |
|---|---|
| ID | `id_pam`, `idPam`, `id`, `kode`, `member_id`, `memberId` |
| Nama | `nama`, `name`, `nama_lengkap`, `full_name` |
| Nomor HP | `nomor_hp`, `no_hp`, `hp`, `telepon`, `telp`, `phone`, `wa`, `whatsapp` |

Bungkus `{ "member": [ ... ] }` juga diterima, begitu pula satu objek tunggal.

### Format nomor HP

Semua bentuk berikut diterima dan disimpan seragam sebagai `08…`:

```
081234567890        +62 812-3456-7890        6281234567890        0812 3456 7890
```

## Contoh

```bash
curl -X POST https://undangan.opsjobs.id/api/member \
  -H "x-api-key: pam_VLiRH_sMxCzZy-SeyqmMgzMbY3T2JUmy" \
  -H "Content-Type: application/json" \
  -d '[
    {"nama":"Rina Kartika","id_pam":"PP-100001","nomor_hp":"081234567890"},
    {"nama":"Budi Hartono","id_pam":"PP-100002","nomor_hp":"+62 812-3456-7891"}
  ]'
```

## Jawaban

```json
{
  "ok": true,
  "diterima": 4,
  "masuk": 3,
  "ditolak": 1,
  "total": 3,
  "contohDitolak": [
    { "baris": 4, "isi": "{\"nama\":\"X\",\"id_pam\":\"PP-BAD\"}" }
  ]
}
```

| Kolom | Arti |
|---|---|
| `diterima` | Jumlah baris dalam kiriman |
| `masuk` | Berhasil disimpan |
| `ditolak` | Dilewati karena tidak sah |
| `total` | Jumlah member di basis data setelah kiriman ini |
| `contohDitolak` | Sampai 10 contoh baris bermasalah, untuk penelusuran |

**Baris yang tidak sah dilewati, bukan menggagalkan seluruh kiriman.** Satu baris
rusak di antara sepuluh ribu tidak akan membuat semuanya tertolak.

## Kode status

| Kode | Arti |
|---|---|
| `200` | Diterima (periksa `ditolak` untuk baris yang dilewati) |
| `401` | `x-api-key` salah atau tidak dikirim |
| `413` | Lebih dari 20.000 baris dalam satu kiriman — pecah menjadi beberapa |
| `500` | Galat di sisi kami |

## Mengirim ulang

Data bersifat **upsert**: mengirim `id_pam` yang sama akan **memperbarui** nama
dan nomor HP-nya, bukan membuat duplikat. Aman dikirim berulang kali.

Untuk **mengganti seluruh daftar** (menghapus yang tidak ada di kiriman baru),
tambahkan `?ganti=1`:

```
POST https://undangan.opsjobs.id/api/member?ganti=1
```

Gunakan ini hanya bila kiriman berisi daftar lengkap. Dengan daftar sebagian, ia
akan menghapus sisanya.

## Batas

| | |
|---|---|
| Ukuran badan permintaan | 8 MB |
| Baris per kiriman | 20.000 |
| Laju | 10 permintaan/detik |

## Yang terjadi dengan data ini

Dipakai untuk mengenali tamu saat kartu member dipindai di kiosk acara —
namanya langsung muncul tanpa perlu mengetik. Nomor HP **tidak ditampilkan di
layar dan tidak dicetak di struk**; hanya tersimpan untuk tindak lanjut.
