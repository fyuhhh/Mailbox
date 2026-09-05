/**
 * Server kiosk — berjalan di PC yang terhubung ke printer struk.
 *
 * Hanya mendengarkan di localhost. Layar sentuh membuka http://localhost:PORT
 * dalam Chrome mode kiosk; tidak ada bagian dari aplikasi ini yang perlu
 * dijangkau dari jaringan.
 */

import express from 'express';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os, { networkInterfaces } from 'node:os';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { bukaDb } from './src/db.js';
import { bukaPengaturan } from './src/pengaturan.js';
import { bukaMember } from './src/member.js';
import { bukaPromo, bacaBerkasKode } from './src/promo.js';
import { bukaBasis } from './src/basis.js';
import { tanamBenih } from './src/benih.js';
import { bukaPrinterOtomatis } from './src/printer-otomatis.js';
import { buatKodeUnik } from './src/kode.js';
import { Printer } from './src/printer.js';
import { Sinkronisasi } from './src/sync.js';

const AKAR = path.dirname(fileURLToPath(import.meta.url));

/*
 * Nilai bawaan dimuat LEBIH DULU, lalu ditimpa oleh .env milik mesin ini.
 *
 * loadEnvFile tidak menimpa variabel yang sudah ada, jadi urutannya menentukan
 * siapa yang menang: yang dimuat belakangan kalah. Karena itu .env.default —
 * yang ikut di penyimpanan kode dan berisi setelan bukan-rahasia — dimuat
 * SESUDAH .env, bukan sebelumnya.
 *
 * Buahnya: PC baru yang hanya menarik kode sudah punya BASE_URL, ukuran kertas,
 * dan nama acara yang benar tanpa siapa pun mengetik apa pun. Yang tersisa
 * hanya dua isian rahasia, dan itu ditanyakan sekali lewat halaman penyiapan.
 */
/*
 * Keduanya boleh tidak ada.
 *
 * loadEnvFile MELEMPAR bila berkasnya tidak ditemukan, dan .env memang belum
 * ada di PC yang baru saja menarik kode — keadaan yang paling normal, bukan
 * kesalahan. Tanpa penjaga ini kiosk mati sebelum sempat menampilkan halaman
 * penyiapan yang justru dibuat untuk keadaan itu.
 */
/**
 * Tempat setelan rahasia disimpan di tingkat MESIN, bukan folder.
 *
 * Folder kiosk sering disalin ulang: unduh ZIP baru, extract ke folder baru,
 * jalankan. Kalau rahasianya hanya hidup di dalam folder, setiap folder baru
 * menuntut penyiapan ulang — dan orang yang mengerjakannya di lokasi belum
 * tentu memegang nilainya.
 *
 * Dengan disimpan di tingkat mesin, penyiapan cukup sekali seumur PC itu.
 */
function berkasSetelanMesin() {
  const dasar = process.platform === 'win32'
    ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : path.join(os.homedir(), 'Library', 'Application Support');
  return path.join(dasar, 'KioskEwalk', 'setelan.env');
}

/*
 * Urutan menentukan siapa yang menang.
 *
 * loadEnvFile TIDAK menimpa nilai yang sudah ada, jadi yang dimuat lebih dulu
 * berlaku. Urutannya: .env milik folder ini, lalu simpanan mesin, lalu nilai
 * bawaan yang ikut di penyimpanan kode. Ketiganya boleh tidak ada.
 */
for (const berkas of [path.join(AKAR, '.env'), berkasSetelanMesin(), path.join(AKAR, '.env.default')]) {
  try { process.loadEnvFile?.(berkas); } catch { /* belum ada */ }
}

/**
 * Alamat LAN mesin ini, untuk BASE_URL=AUTO.
 *
 * Menuliskan IP secara tetap di .env membuat berkas konfigurasi itu tidak bisa
 * dipindahkan: disalin ke laptop lain, QR-nya akan menunjuk ke alamat mesin
 * yang lama dan setiap struk yang tercetak menjadi sampah tanpa ada yang
 * menyadarinya sampai ada tamu yang mengeluh.
 */
function alamatLan() {
  for (const [nama, daftar] of Object.entries(networkInterfaces())) {
    for (const antarmuka of daftar ?? []) {
      if (antarmuka.family !== 'IPv4' || antarmuka.internal) continue;
      // Lewati antarmuka virtual milik Docker/VM yang tidak dijangkau ponsel.
      if (/^(docker|br-|veth|vmnet|utun)/i.test(nama)) continue;
      return antarmuka.address;
    }
  }
  return null;
}

/** Alamat yang hanya bisa dibuka dari dalam jaringan yang sama. */
function alamatLokal(url) {
  return /localhost|127\.0\.0\.1|\b192\.168\.|\b10\.|\b172\.(1[6-9]|2\d|3[01])\./i.test(url);
}

/**
 * Tentukan alamat server undangan.
 *
 * BASE_URL yang kosong TIDAK lagi ditebak. Dulu ia jatuh ke alamat LAN mesin
 * ini, dan akibatnya jauh melampaui daftar member: seluruh QR di struk ikut
 * menunjuk ke sana. Tamu memindai, ponselnya tidak berada di jaringan yang
 * sama, dan yang muncul adalah halaman gagal — sesudah struknya tercetak,
 * sesudah tamunya pergi. Kiosk yang menolak menyala sambil menyebutkan
 * penyebabnya jauh lebih baik daripada kiosk yang menyala lalu mencetak
 * ratusan QR yang tidak bisa dibuka siapa pun.
 */
function tentukanBaseUrl() {
  const mentah = (process.env.BASE_URL || '').trim();
  const portUndangan = Number(process.env.UNDANGAN_PORT) || 5010;

  if (!mentah) {
    console.error('\n  ============================================================');
    console.error('    KIOSK TIDAK BISA MENYALA — BASE_URL belum diisi');
    console.error('  ============================================================\n');
    console.error('    Buka berkas  kiosk\\.env  lalu tambahkan baris ini:\n');
    console.error('        BASE_URL=https://undangan.opsjobs.id\n');
    console.error('    Alamat itu menentukan dua hal sekaligus:');
    console.error('      - dari mana daftar member ditarik');
    console.error('      - ke mana QR di struk menunjuk\n');
    console.error('    Menebaknya berarti mencetak QR yang tidak bisa dibuka tamu.\n');
    process.exit(1);
  }

  if (mentah.toUpperCase() !== 'AUTO') {
    return mentah.toUpperCase().replace(/\/+$/, '');
  }

  const ip = alamatLan();
  const alamat = ip ? `HTTP://${ip}:${portUndangan}` : `HTTP://LOCALHOST:${portUndangan}`;

  console.warn('\n  ============================================================');
  console.warn('    BASE_URL=AUTO — HANYA UNTUK UJI COBA DI MEJA');
  console.warn('  ============================================================\n');
  console.warn(`    Kiosk akan memakai ${alamat}`);
  console.warn('    QR di struk menunjuk ke sana, dan hanya bisa dibuka dari');
  console.warn('    jaringan yang sama. Ponsel tamu TIDAK akan bisa membukanya.\n');
  console.warn('    Untuk acara, ganti isi BASE_URL di kiosk\\.env menjadi:');
  console.warn('        BASE_URL=https://undangan.opsjobs.id\n');

  return alamat;
}

const konf = {
  port: Number(process.env.PORT) || 4000,
  baseUrl: tentukanBaseUrl(),
  secret: process.env.SYNC_SECRET || '',
  namaAcara: process.env.NAMA_ACARA || 'HUT PERUSAHAAN',
  printerNama: process.env.PRINTER_NAME || 'TECH_CLA58',
  // Bila diisi, kiosk mengirim ESC/POS langsung ke soket printer dan seluruh
  // jalur CUPS/antrian sistem dilewati.
  printerHost: (process.env.PRINTER_HOST || '').trim() || null,
  printerPort: Number(process.env.PRINTER_PORT) || 9100,
  printerLebar: Number(process.env.PRINTER_WIDTH) || 58,
  qrModul: Number(process.env.QR_MODULE) || 10,
  dryRun: process.env.PRINTER_DRYRUN === '1',
};

const BATAS_NAMA = 40;
const BATAS_PESAN = 120;

// Video 15 detik dari MediaRecorder berkisar 1-4 MB. Batas 40 MB memberi ruang
// besar untuk kamera beresolusi tinggi tanpa membiarkan satu unggahan rusak
// memenuhi disk kiosk di tengah acara.
const BATAS_VIDEO_MB = 40;

const FOLDER_VIDEO = path.join(AKAR, 'data', 'video');
const FOLDER_VIDEO_SEMENTARA = path.join(FOLDER_VIDEO, 'sementara');
mkdirSync(FOLDER_VIDEO_SEMENTARA, { recursive: true });

/*
 * Benih ditanam SEBELUM basis data mana pun dibuka.
 *
 * bukaDb dan kawan-kawannya membuat berkas kosong kalau belum ada. Kalau benih
 * ditanam sesudahnya, setiap berkas sudah telanjur ada dan penanaman akan
 * melewati semuanya — PC baru menyala dengan daftar member kosong.
 */
const hasilBenih = tanamBenih(path.join(AKAR, 'benih'), path.join(AKAR, 'data'));

const db = bukaDb(path.join(AKAR, 'data', 'kiosk.db'));
const pengaturan = bukaPengaturan(path.join(AKAR, 'data', 'pengaturan.json'));
const member = bukaMember(path.join(AKAR, 'data', 'member.db'));
const promo = bukaPromo(path.join(AKAR, 'data', 'promo.db'));
const basis = bukaBasis(path.join(AKAR, 'data'));

/*
 * Persediaan kode voucher diisi dari berkas teks, sekali, saat masih kosong.
 *
 * Syaratnya "kosong", bukan "belum pernah diimpor". Dengan begitu menjalankan
 * kiosk berulang kali tidak pernah mengembalikan kode yang sudah keluar menjadi
 * belum terpakai — dan petugas yang sengaja mengosongkan persediaan lewat
 * halaman Persiapan Acara mendapat apa yang ia minta, bukan isi lama yang
 * muncul kembali sendiri.
 */
if (promo.total() === 0) {
  const berkasKode = path.join(AKAR, 'benih', 'kode-voucher.txt');
  if (existsSync(berkasKode)) {
    try {
      const hasil = promo.impor(bacaBerkasKode(berkasKode));
      if (hasil.masuk) console.log(`  [promo] ${hasil.masuk} kode dimuat dari benih`);
    } catch (galat) {
      console.warn('  [promo] gagal memuat kode dari benih:', galat.message);
    }
  }
}

/**
 * Cari nama pemilik kartu.
 *
 * Kartu di luar daftar tidak menghentikan alur — pemegangnya tetap dilayani
 * dan mengetik namanya sendiri. Menolak di sini berarti menahan pemegang kartu
 * sah hanya karena daftar di kiosk belum diperbarui.
 */
function cariMember(idPam) {
  return member.cari(idPam);
}

const printer = new Printer({
  nama: konf.printerNama,
  host: konf.printerHost,
  port: konf.printerPort,
  lebarMm: konf.printerLebar,
  qrModul: konf.qrModul,
  dryRun: konf.dryRun,
  folderDryRun: path.join(AKAR, 'data', 'struk-uji'),
});

/*
 * Pengarah printer otomatis.
 *
 * PRINTER_HOST di .env diperlakukan sebagai petunjuk, bukan kebenaran. Kiosk
 * berpindah antar-PC dan antar-jaringan; alamat yang ditulis waktu penyiapan
 * hampir pasti salah begitu berpindah, dan gejalanya — "printer tidak konek" —
 * tidak menunjuk ke sebabnya sama sekali.
 */
const printerOtomatis = bukaPrinterOtomatis({
  printer,
  berkas: path.join(AKAR, 'data', 'printer.json'),
  hostAwal: konf.printerHost,
  portAwal: konf.printerPort,
  namaAwal: konf.printerNama,
});

const sinkron = new Sinkronisasi({
  db,
  baseUrl: konf.baseUrl,
  secret: konf.secret,
  folderVideo: FOLDER_VIDEO,
});
sinkron.mulai();

const app = express();
app.use(express.json({ limit: '32kb' }));
// Safari menghasilkan MP4, bukan WebM. Menerima satu jenis saja membuat
// perekaman di Safari gagal pada langkah unggah, setelah tamu terlanjur
// merekam — kegagalan paling mahal yang bisa dipilih.
app.use(express.raw({ type: ['video/webm', 'video/mp4'], limit: `${BATAS_VIDEO_MB}mb` }));
/*
 * Berkas layar kiosk tidak boleh disinggahi peramban sama sekali.
 *
 * `maxAge: 0` saja tidak cukup: Safari tetap memakai salinan di memorinya dan
 * menyajikan JavaScript lama sampai dimuat ulang paksa. Akibatnya perubahan
 * yang sudah benar terlihat seperti tidak berfungsi — tombol baru tidak muncul,
 * dan waktu habis mencari bug yang tidak ada. Berkasnya dilayani dari localhost,
 * jadi tidak ada ongkos apa pun untuk selalu mengambil yang terbaru.
 */
/*
 * Kiosk dialihkan ke penyiapan selama masih ada yang kosong.
 *
 * HARUS berada sebelum express.static. Sesudahnya, "/" sudah dilayani sebagai
 * index.html dan pengalihan ini tidak pernah dijalankan — tamu melihat layar
 * sambutan dari kiosk yang belum bisa menarik member maupun mencetak, dan
 * kegagalannya baru muncul di depan antrean.
 */
app.get('/', (req, res, next) => {
  const perlu = perluDisiapkan();
  if (!perlu.syncSecret && !perlu.sandiPetugas) return next();
  res.redirect('/siapkan.html');
});

app.use(
  express.static(path.join(AKAR, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate'),
  })
);

// jsQR disajikan langsung dari node_modules alih-alih disalin ke public/:
// menyalinnya berarti ada dua versi berkas yang sama di repo, dan yang salinan
// tidak akan pernah ikut diperbarui saat dependensinya dinaikkan.
app.use('/video', express.static(FOLDER_VIDEO, { maxAge: '1h', index: false }));

app.use(
  '/vendor/jsQR.js',
  express.static(path.join(AKAR, 'node_modules', 'jsqr', 'dist', 'jsQR.js'), { maxAge: '1d' })
);

/**
 * Bersihkan masukan dari layar sentuh.
 *
 * Struk dicetak dalam ASCII, jadi apa pun di luar itu akan hilang saat cetak.
 * Membersihkannya di sini, sebelum disimpan, membuat yang tampil di layar sama
 * persis dengan yang keluar dari printer — tanpa langkah ini tamu melihat
 * namanya utuh di layar lalu menerima struk yang berbeda.
 */
function bersihkan(teks, batas) {
  return String(teks ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, batas);
}

function waktuLokal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function urlUntuk(kode) {
  return `${konf.baseUrl}/U/${kode}`;
}

function bufferStruk(tamu) {
  return printer.susun({
    kodePromo: tamu.kodePromo ?? null,
    nama: tamu.nama,
    pesan: tamu.pesan,
    kode: tamu.kode,
    url: urlUntuk(tamu.kode),
    namaAcara: konf.namaAcara,
    waktu: waktuLokal(new Date(tamu.dibuat_pada)),
    nomorAntrian: tamu.id,
    jenis: tamu.jenis,
    member: tamu.member_id,
  });
}

/** Cetak satu struk dan tunggu sampai tuntas. Mengembalikan hasil, tidak melempar. */
async function cetakStruk(tamu) {
  try {
    await printer.kirim(bufferStruk(tamu));
    db.tambahCetak(tamu.kode);
    return { tercetak: true, galat: null };
  } catch (galat) {
    return { tercetak: false, galat: galat.message };
  }
}

/**
 * Kirim ke printer, dengan satu percobaan ulang bila pengirimannya gagal.
 *
 * HANYA fase pengiriman yang diulang, tidak pernah fase verifikasi. Kegagalan
 * verifikasi berarti pekerjaan sudah masuk antrian tetapi belum keluar dalam
 * batas waktu — dan struk itu masih mungkin menyusul keluar sesaat kemudian.
 * Mengulang di titik itu akan mencetak dua struk untuk satu tamu, yang di meja
 * doorprize berarti satu orang memegang dua kupon.
 */
async function kirimSekaliUlang(buffer) {
  try {
    return await printer.kirim(buffer, { tunggu: false });
  } catch (galat) {
    // Kabel yang memang lepas tidak akan tersambung sendiri dalam satu detik;
    // mengulanginya hanya menunda pesan yang sudah pasti sampai ke tamu.
    if ((await printer.perangkatAda()) === false) throw galat;

    await new Promise((r) => setTimeout(r, 1200));
    return await printer.kirim(buffer, { tunggu: false });
  }
}

/**
 * Hasil cetak yang masih berjalan, dikunci menurut kode tamu.
 *
 * Tidak disimpan ke basis data: begitu layar tamu selesai membacanya, angka
 * ini tidak berguna lagi, sedangkan `jumlah_cetak` di tabel tamu sudah mencatat
 * apa yang perlu dicatat.
 */
const cetakBerjalan = new Map();

/**
 * Mulai mencetak tanpa menahan pemanggil sampai kertasnya keluar.
 *
 * Struk 58mm berisi QR butuh sekitar tujuh detik; menahan tamu berdiri di depan
 * layar selama itu berarti belasan menit antrean untuk seratus tamu. Karena
 * pemeriksaan pra-kirim sudah menyaring printer yang mati, kegagalan setelah
 * titik ini jarang — dan tetap tertangkap oleh verifikasi latar di bawah, yang
 * hasilnya diambil layar lewat /api/hasil-cetak.
 */
async function mulaiCetak(tamu) {
  try {
    await kirimSekaliUlang(bufferStruk(tamu));
  } catch (galat) {
    cetakBerjalan.set(tamu.kode, { selesai: true, tercetak: false, galat: galat.message });
    return { diterima: false, galat: galat.message };
  }

  cetakBerjalan.set(tamu.kode, { selesai: false, tercetak: null, galat: null });

  printer
    .tungguAntrianKosong()
    .then((tuntas) => {
      if (tuntas) db.tambahCetak(tamu.kode);
      cetakBerjalan.set(tamu.kode, {
        selesai: true,
        tercetak: tuntas,
        galat: tuntas ? null : 'Struk tertahan di antrian — cek kertas dan lampu printer',
      });
    })
    .catch((galat) => {
      cetakBerjalan.set(tamu.kode, { selesai: true, tercetak: false, galat: galat.message });
    });

  return { diterima: true, galat: null };
}

/**
 * Terima rekaman greeting.
 *
 * Diunggah lebih dulu dengan nama sementara, lalu ditautkan ke kode tamu saat
 * pendaftaran. Urutan ini disengaja: unggahan bisa berjalan selagi tamu masih
 * meninjau videonya, sehingga menekan Kirim tidak berarti menunggu beberapa
 * megabita berpindah sementara antrean menumpuk di belakangnya.
 */
app.post('/api/video', (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length < 1024) {
    return res.status(400).json({ galat: 'Rekaman kosong atau rusak' });
  }

  const id = randomUUID();
  const akhiran = String(req.get('content-type') ?? '').includes('mp4') ? 'mp4' : 'webm';
  const berkas = path.join(FOLDER_VIDEO_SEMENTARA, `${id}.${akhiran}`);
  try {
    writeFileSync(berkas, req.body);
  } catch (galat) {
    return res.status(500).json({ galat: `Gagal menyimpan rekaman: ${galat.message}` });
  }

  res.json({ videoId: `${id}.${akhiran}`, ukuran: req.body.length });
});

/**
 * Bongkar isi QR kartu member menjadi { kode, nama }.
 *
 * Format kartu PAM-PLUS belum dipastikan, jadi empat bentuk yang lazim dipakai
 * penerbit kartu diterima sekaligus. Memilih satu bentuk lalu keliru berarti
 * setiap kartu ditolak di depan antrean tamu pada hari acara — kegagalan yang
 * jauh lebih mahal daripada beberapa baris penguraian di sini.
 *
 *   {"id":"PP-01","nama":"Dimas"}     JSON
 *   PP-01|Dimas Prayoga               dipisah | ; atau #
 *   https://…/m?id=PP-01&nama=Dimas   URL berparameter
 *   PP-01                             kode polos, nama dicari di member.json
 */
export function uraiKartuMember(mentah) {
  const teks = String(mentah ?? '').trim();
  if (!teks) return { kode: '', nama: '' };

  const rapikan = (v) => String(v ?? '').trim().slice(0, BATAS_NAMA);

  if (teks.startsWith('{')) {
    try {
      const j = JSON.parse(teks);
      const kode = rapikan(j.id ?? j.kode ?? j.member ?? '');
      if (kode) return { kode, nama: rapikan(j.nama ?? j.name ?? '') };
    } catch {
      // Bukan JSON yang sah — lanjut ke bentuk berikutnya.
    }
  }

  if (/^https?:\/\//i.test(teks)) {
    try {
      const u = new URL(teks);
      const kode = rapikan(u.searchParams.get('id') ?? u.searchParams.get('kode') ?? '');
      if (kode) {
        return { kode, nama: rapikan(u.searchParams.get('nama') ?? u.searchParams.get('name') ?? '') };
      }
    } catch {
      // URL tidak sah — lanjut.
    }
  }

  const dipisah = teks.split(/[|;#]/);
  if (dipisah.length >= 2 && dipisah[0].trim()) {
    return { kode: rapikan(dipisah[0]), nama: rapikan(dipisah[1]) };
  }

  return { kode: rapikan(teks), nama: '' };
}

app.post('/api/member', (req, res) => {
  const { kode, nama: namaDariKartu } = uraiKartuMember(req.body?.kode);
  if (!kode) return res.status(400).json({ status: 'tidak-terbaca' });

  // Kartu boleh juga berisi nomor HP-nya saja; sebagian penerbit mencetak itu
  // alih-alih nomor keanggotaan, dan petugas mengetiknya saat kartu tertinggal.
  const tercatat = cariMember(kode) ?? member.cariNomor(kode);

  // Nama di kartu didahulukan: itu yang dipegang tamu di tangannya, sedangkan
  // daftar di kiosk bisa tertinggal beberapa hari dari data keanggotaan.
  const nama = namaDariKartu || tercatat?.nama || '';

  /*
   * Member yang sudah pernah mengambil voucher dihentikan di sini.
   *
   * Sengaja diperiksa sebelum layar rekam, bukan sesudahnya: menolak setelah
   * orang berdiri merekam lima belas detik ucapan adalah cara terburuk untuk
   * menyampaikan kabar bahwa jatahnya sudah habis.
   */
  const sudah = db.voucherMember(tercatat?.id_pam ?? kode);
  if (sudah) {
    return res.json({
      status: 'sudah-ambil',
      kode: tercatat?.id_pam ?? kode,
      nama: sudah.nama || nama,
      nomor: sudah.id,
      pada: sudah.dibuat_pada,
    });
  }

  // Kartu di luar daftar tidak menghentikan alur. Tamu tetap dilayani, hanya
  // namanya diketik sendiri — menolak di sini berarti menahan pemegang kartu
  // sah hanya karena daftar di kiosk belum diperbarui.
  res.json({
    status: nama ? 'dikenal' : 'baru',
    kode: tercatat?.id_pam ?? kode,
    nama,
    // Tidak ditampilkan di layar maupun dicetak di struk; hanya ikut tersimpan
    // bersama data tamu untuk tindak lanjut sesudah acara.
    nomorHp: tercatat?.nomor_hp ?? '',
  });
});

/* -------------------------------- member ---------------------------------- */

/**
 * Impor daftar member dari JSON.
 *
 * Menerima larik objek, atau objek tunggal. Nama kolomnya boleh bermacam bentuk
 * (id_pam / idPam / id / kode, nomor_hp / hp / telepon / phone, nama / name) —
 * ekspor keanggotaan tidak pernah seragam, dan meminta orang menyunting ribuan
 * baris agar cocok dengan satu bentuk pilihanku jauh lebih mahal daripada
 * menerima semuanya di sini.
 */
app.post('/api/member/impor', (req, res) => {
  const isi = req.body;
  const daftar = Array.isArray(isi) ? isi : Array.isArray(isi?.member) ? isi.member : [isi];

  try {
    const hasil = member.impor(daftar, { ganti: req.query.ganti === '1' });
    res.json(hasil);
  } catch (galat) {
    res.status(500).json({ galat: galat.message });
  }
});

/** Daftar member untuk layar petugas, dengan pencarian. */
app.get('/api/member/daftar', (req, res) => {
  const batas = Math.min(Math.max(Number(req.query.batas) || 100, 1), 500);
  const baris = member.telusuri(req.query.cari, batas);
  const ringkas = member.ringkas();

  res.json({
    ...ringkas,
    ditampilkan: baris.length,
    batas,
    tarik: {
      waktu: keadaanMember.waktu,
      galat: keadaanMember.galat,
      sedang: keadaanMember.sedang,
    },
    member: baris,
  });
});

/** Tarik sekarang juga, tanpa menunggu putaran berikutnya. */
app.post('/api/member/tarik', async (_req, res) => {
  await tarikMember();
  res.json({
    ...member.ringkas(),
    tarik: { waktu: keadaanMember.waktu, galat: keadaanMember.galat },
  });
});

app.get('/api/member/ringkas', (_req, res) => {
  res.json({
    total: member.jumlah(),
    // Nomor HP disamarkan: layar ini terbuka di depan antrean tamu, dan tidak
    // ada alasan nomor orang lain terbaca oleh siapa pun yang lewat.
    contoh: member.contoh(5).map((m) => ({
      id_pam: m.id_pam,
      nama: m.nama,
      nomor_hp: m.nomor_hp ? m.nomor_hp.slice(0, 4) + '****' + m.nomor_hp.slice(-3) : '',
    })),
  });
});

/**
 * Pindahkan rekaman sementara menjadi milik seorang tamu.
 *
 * Dinamai menurut kode tamu, bukan UUID unggahan, supaya isi folder video bisa
 * dicocokkan dengan daftar tamu hanya dengan melihat nama berkasnya — hal yang
 * sangat menolong ketika ada yang harus dicari ulang di tengah acara.
 */
function tautkanVideo(videoId, kode, akhiranNama = '') {
  if (!videoId) return null;

  // basename memotong komponen jalur apa pun yang ikut terkirim, sehingga nilai
  // seperti "../../server.js" tidak bisa memindahkan berkas di luar folder video.
  const bersih = path.basename(String(videoId));
  if (!/^[0-9a-f-]+\.(webm|mp4)$/i.test(bersih)) return null;

  const asal = path.join(FOLDER_VIDEO_SEMENTARA, bersih);
  if (!existsSync(asal)) return null;

  const berkas = `${kode}${akhiranNama}${path.extname(bersih)}`;
  try {
    renameSync(asal, path.join(FOLDER_VIDEO, berkas));
    return berkas;
  } catch {
    return null;
  }
}

/* ------------------------------- kode promo ------------------------------- */

/* ------------------------------ gerbang sandi ----------------------------- */

/*
 * Sandi petugas dibaca dari .env, tidak pernah ditulis di dalam kode.
 *
 * Berkas .env tidak ikut masuk ke penyimpanan kode, sedangkan server.js ikut.
 * Menaruh sandinya di sini sama saja dengan menerbitkannya, dan yang dijaga di
 * balik sandi ini justru daftar kode voucher.
 */
let SANDI_PETUGAS = process.env.SANDI_PETUGAS || '';

/*
 * Karcis masuk hanya hidup selama server hidup — disimpan di ingatan, bukan di
 * disk. Menyalakan ulang kiosk berarti petugas mengetik sandinya sekali lagi,
 * dan itu memang yang diinginkan: karcis yang tertinggal di peramban tidak
 * boleh membuka apa pun keesokan harinya.
 */
const karcis = new Map();
const KARCIS_HIDUP_MS = 4 * 60 * 60 * 1000;

/*
 * Perbandingan waktu-tetap.
 *
 * `===` pada teks berhenti di huruf pertama yang berbeda, sehingga lamanya
 * jawaban membocorkan berapa huruf awal yang sudah benar. Panjang sandi
 * disamakan lebih dulu dengan hash, karena timingSafeEqual menolak dua penyangga
 * yang panjangnya berbeda — dan penolakan itu sendiri membocorkan panjangnya.
 */
function sandiCocok(diberikan) {
  if (!SANDI_PETUGAS) return false;
  const a = createHash('sha256').update(String(diberikan)).digest();
  const b = createHash('sha256').update(SANDI_PETUGAS).digest();
  return timingSafeEqual(a, b);
}

let gagalMasuk = 0;

app.post('/api/masuk', async (req, res) => {
  if (!SANDI_PETUGAS) {
    return res.status(503).json({ galat: 'SANDI_PETUGAS belum diisi di berkas .env kiosk.' });
  }

  /*
   * Perlambatan bertingkat setelah salah berulang.
   *
   * Tanpa ini, sandi bisa ditebak dari LAN acara secepat jaringan mengizinkan.
   * Angkanya dibatasi lima detik supaya petugas yang benar-benar salah ketik
   * tidak ikut terhukum lama di depan antrean.
   */
  if (gagalMasuk > 3) {
    await new Promise((r) => setTimeout(r, Math.min(5000, (gagalMasuk - 3) * 700)));
  }

  if (!sandiCocok(req.body?.sandi)) {
    gagalMasuk += 1;
    console.warn(`  [masuk] sandi salah (${gagalMasuk}x)`);
    return res.status(401).json({ galat: 'Sandi salah.' });
  }

  gagalMasuk = 0;
  const token = randomBytes(24).toString('hex');
  karcis.set(token, Date.now() + KARCIS_HIDUP_MS);
  res.json({ token, berlakuMs: KARCIS_HIDUP_MS });
});

/** Penjaga rute: hanya melewatkan permintaan yang membawa karcis yang masih hidup. */
function butuhSandi(req, res, next) {
  const token = String(req.get('x-sandi') || '');
  const sampai = karcis.get(token);

  if (!sampai) return res.status(401).json({ galat: 'Perlu sandi petugas.', kode: 'perlu-sandi' });
  if (sampai < Date.now()) {
    karcis.delete(token);
    return res.status(401).json({ galat: 'Sesi habis, masukkan sandi lagi.', kode: 'perlu-sandi' });
  }

  next();
}

/*
 * Ringkasan terbuka, daftar kodenya tidak.
 *
 * Layar sambutan menampilkan "masih tersisa N Gift Voucher" dan membutuhkan
 * angka ini tanpa sandi. Sebelumnya rute yang sama juga mengembalikan seluruh
 * kodenya, jadi siapa pun yang terhubung ke jaringan acara bisa membuka
 * /api/promo di peramban dan menyalin dua puluh kode itu tanpa melewati apa pun.
 */
app.get('/api/promo', (_req, res) => {
  res.json(promo.ringkas());
});

/* ------------------------------ bingkai video ----------------------------- */

const BERKAS_BINGKAI = path.join(AKAR, 'data', 'bingkai.json');

/*
 * Setelan bingkai disimpan di server, bukan di peramban.
 *
 * Posisi bingkai adalah keputusan produksi yang berlaku untuk seluruh rekaman
 * acara, bukan kenyamanan per-mesin seperti pilihan kamera. Menyimpannya di
 * localStorage berarti membersihkan data peramban — atau memakai profil
 * berbeda — diam-diam mengembalikan bingkai ke posisi bawaan di tengah acara.
 */
const BINGKAI_BAWAAN = {
  aktif: 1,
  lebar: 720,
  tinggi: 1280,
  skala: 100,      // persen, terhadap ukuran "isi penuh"
  geserX: 0,       // persen lebar
  geserY: 0,       // persen tinggi
  latar: '#000000',
};

function bacaBingkai() {
  try {
    return { ...BINGKAI_BAWAAN, ...JSON.parse(readFileSync(BERKAS_BINGKAI, 'utf8')) };
  } catch {
    return { ...BINGKAI_BAWAAN };
  }
}

app.get('/api/bingkai', (_req, res) => {
  res.json({ ...bacaBingkai(), ada: existsSync(path.join(AKAR, 'public', 'bingkai.png')) });
});

app.post('/api/bingkai', (req, res) => {
  const b = req.body ?? {};
  const angka = (nilai, min, maks, bawaan) => {
    const n = Number(nilai);
    return Number.isFinite(n) ? Math.min(maks, Math.max(min, n)) : bawaan;
  };

  const baru = {
    aktif: Number(b.aktif) === 0 ? 0 : 1,
    lebar: angka(b.lebar, 360, 1080, BINGKAI_BAWAAN.lebar),
    tinggi: angka(b.tinggi, 640, 1920, BINGKAI_BAWAAN.tinggi),
    skala: angka(b.skala, 50, 250, BINGKAI_BAWAAN.skala),
    geserX: angka(b.geserX, -100, 100, BINGKAI_BAWAAN.geserX),
    geserY: angka(b.geserY, -100, 100, BINGKAI_BAWAAN.geserY),
    latar: /^#[0-9a-f]{6}$/i.test(String(b.latar)) ? String(b.latar) : BINGKAI_BAWAAN.latar,
  };

  try {
    mkdirSync(path.dirname(BERKAS_BINGKAI), { recursive: true });
    writeFileSync(BERKAS_BINGKAI, JSON.stringify(baru, null, 2));
  } catch (galat) {
    return res.status(500).json({ galat: galat.message });
  }

  console.log(`  [bingkai] setelan disimpan (skala ${baru.skala}%, geser ${baru.geserX}/${baru.geserY})`);
  res.json(baru);
});

/* ------------------------------ penyiapan awal ---------------------------- */

/*
 * Dua rahasia diminta lewat peramban, bukan lewat berkas .bat.
 *
 * Sandi petugas mengandung tanda seru, dan tanda seru adalah karakter khusus di
 * cmd.exe ketika delayed expansion menyala — nilainya bisa terpotong tanpa ada
 * yang menyadarinya sampai halaman petugas menolak sandi yang "sudah benar".
 * Formulir di peramban tidak punya kelas kesalahan itu sama sekali.
 */
function perluDisiapkan() {
  return { syncSecret: !konf.secret, sandiPetugas: !SANDI_PETUGAS };
}

app.get('/api/siapkan', (_req, res) => {
  const perlu = perluDisiapkan();
  res.json({ perlu, selesai: !perlu.syncSecret && !perlu.sandiPetugas, baseUrl: konf.baseUrl });
});

app.post('/api/siapkan', (req, res) => {
  const perlu = perluDisiapkan();

  /*
   * Hanya yang MASIH kosong yang boleh diisi lewat sini.
   *
   * Tanpa batas ini, halaman penyiapan menjadi cara siapa pun yang bisa
   * menjangkau kiosk untuk mengganti sandi petugas dan kunci server — tanpa
   * perlu tahu nilai yang lama.
   */
  const baru = {};
  if (perlu.syncSecret) {
    const nilai = bersihkan(req.body?.syncSecret, 200);
    if (nilai) baru.SYNC_SECRET = nilai;
  }
  if (perlu.sandiPetugas) {
    const nilai = String(req.body?.sandiPetugas ?? '').trim().slice(0, 200);
    if (nilai) baru.SANDI_PETUGAS = nilai;
  }

  if (!Object.keys(baru).length) {
    return res.status(400).json({ galat: 'Tidak ada yang perlu disimpan.' });
  }

  try {
    tulisEnv(baru);
  } catch (galat) {
    return res.status(500).json({ galat: `Gagal menulis kiosk/.env: ${galat.message}` });
  }

  /*
   * Nilainya langsung berlaku, tanpa menyalakan ulang kiosk.
   *
   * Menyuruh petugas menutup jendela hitam lalu membukanya lagi adalah langkah
   * tambahan yang bisa dilupakan, dan kiosk yang tampak sudah siap padahal
   * belum akan menyesatkan.
   */
  if (baru.SYNC_SECRET) {
    konf.secret = baru.SYNC_SECRET;
    sinkron.secret = baru.SYNC_SECRET;
    tarikMember().catch(() => {});
  }
  if (baru.SANDI_PETUGAS) SANDI_PETUGAS = baru.SANDI_PETUGAS;

  console.log(`  [siapkan] ${Object.keys(baru).join(', ')} tersimpan`);
  res.json({ ok: true, tersimpan: Object.keys(baru), selesai: !perluDisiapkan().syncSecret });
});

/**
 * Tulis atau perbarui baris di kiosk/.env tanpa merusak isi yang sudah ada.
 *
 * Baris lain dipertahankan apa adanya — termasuk komentar dan setelan yang
 * disunting tangan oleh petugas — karena menulis ulang seluruh berkas berarti
 * diam-diam membuang apa pun yang tidak dikenali kode ini.
 */
function tulisEnv(nilai) {
  /*
   * Ditulis ke DUA tempat: folder ini, dan simpanan tingkat mesin.
   *
   * Yang di folder membuat kiosk ini langsung jalan. Yang di tingkat mesin
   * membuat folder berikutnya — hasil unduhan ZIP yang baru — tidak perlu
   * disiapkan lagi sama sekali.
   */
  tulisSatuEnv(path.join(AKAR, '.env'), nilai);

  try {
    const mesin = berkasSetelanMesin();
    mkdirSync(path.dirname(mesin), { recursive: true });
    tulisSatuEnv(mesin, nilai);
    console.log(`  [siapkan] disimpan juga di ${mesin}`);
  } catch (galat) {
    // Bukan kegagalan: kiosk ini tetap jalan dengan .env di foldernya sendiri.
    console.warn('  [siapkan] simpanan tingkat mesin gagal ditulis:', galat.message);
  }
}

function tulisSatuEnv(berkas, nilai) {
  let baris = [];
  try {
    baris = readFileSync(berkas, 'utf8').split(/\r?\n/);
  } catch { /* belum ada; dibuat baru */ }

  for (const [kunci, isi] of Object.entries(nilai)) {
    const pola = new RegExp(`^\\s*${kunci}\\s*=`);
    const i = baris.findIndex((b) => pola.test(b));
    if (i >= 0) baris[i] = `${kunci}=${isi}`;
    else baris.push(`${kunci}=${isi}`);
  }

  writeFileSync(berkas, baris.join('\n').replace(/\n+$/, '') + '\n');
}

/* ---------------------------- penjelajah data ----------------------------- */

/*
 * Semuanya di balik sandi yang sama dengan halaman voucher.
 *
 * Tabel member berisi enam belas ribu nama dan nomor telepon, dan tabel tamu
 * memuat nama beserta tautan rekaman wajahnya. Keduanya lebih perlu dijaga
 * daripada kode voucher, bukan kurang.
 */
app.get('/api/basis', butuhSandi, (_req, res) => {
  /*
   * Keadaan sinkron ikut dikirim, bukan hanya jumlah barisnya.
   *
   * "Member di kiosk ini cuma 4.000" bisa berarti dua hal yang sangat berbeda:
   * server memang baru punya segitu, atau penarikan gagal dan yang terlihat
   * adalah salinan basi. Tanpa waktu penarikan terakhir dan galatnya, petugas
   * di lokasi tidak punya cara membedakannya — dan akan menyalahkan datanya,
   * bukan jaringannya.
   */
  res.json({
    basis: basis.ringkas(),
    sinkronMember: {
      waktu: keadaanMember.waktu,
      galat: keadaanMember.galat,
      sedang: keadaanMember.sedang,
      sumber: konf.baseUrl,
      adaSecret: Boolean(konf.secret),
      sumberLokal: alamatLokal(konf.baseUrl),
    },
  });
});

/** Tarik ulang daftar member sekarang juga, tanpa menunggu dua menit. */
app.post('/api/basis/tarik-member', butuhSandi, async (_req, res) => {
  await tarikMember();
  res.json({
    waktu: keadaanMember.waktu,
    galat: keadaanMember.galat,
    total: member.jumlah?.() ?? null,
  });
});

app.get('/api/basis/baris', butuhSandi, (req, res) => {
  try {
    res.json(basis.baris({
      basis: String(req.query.basis || ''),
      tabel: String(req.query.tabel || ''),
      hal: req.query.hal,
      batas: req.query.batas,
      cari: req.query.cari,
    }));
  } catch (galat) {
    res.status(400).json({ galat: galat.message });
  }
});

app.get('/api/basis/csv', butuhSandi, (req, res) => {
  const nama = `${String(req.query.basis || 'data')}-${String(req.query.tabel || 'tabel')}.csv`;
  try {
    const isi = basis.csv({ basis: String(req.query.basis || ''), tabel: String(req.query.tabel || '') });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${nama}"`);
    res.send(isi);
  } catch (galat) {
    res.status(400).json({ galat: galat.message });
  }
});

app.get('/api/promo/daftar', butuhSandi, (_req, res) => {
  res.json({ ...promo.ringkas(), daftar: promo.daftar(200) });
});

/**
 * Impor persediaan kode dari berkas .xlsx / .csv / .txt yang sudah ada di PC.
 *
 * Jalurnya dikirim, bukan isinya: berkas promo diletakkan petugas di folder
 * kiosk, dan mengunggah lewat layar sentuh 43 inci bukan hal yang masuk akal.
 */
/**
 * Lepas catatan pemakaian seluruh kode.
 *
 * Sengaja TIDAK menghapus kodenya: persediaan yang sudah dimuat tetap ada,
 * hanya statusnya kembali kosong. Menghapus lalu meminta impor ulang di tengah
 * acara adalah cara yang bagus untuk kehilangan berkasnya.
 */
app.post('/api/promo/reset', butuhSandi, (_req, res) => {
  const hasil = promo.reset();
  console.log(`  [promo] direset — ${hasil.dilepas} kode dilepas, sisa ${hasil.sisa}`);
  res.json(hasil);
});

/**
 * Kosongkan daftar tamu dan mulai penomoran dari 001.
 *
 * Ini juga yang melepas penjagaan "satu member satu voucher": catatan siapa
 * yang sudah mengambil ada di tabel tamu, jadi setelah reset semua orang
 * berhak lagi — persis seperti persediaan promo yang direset.
 */
app.post('/api/tamu/reset', butuhSandi, (_req, res) => {
  const hasil = db.kosongkanTamu();

  /*
   * Kode promo ikut dilepas, dan itu bukan tambahan yang bisa dipisahkan.
   *
   * Kode dicatat terpakai "oleh" kode tamu. Begitu tabel tamu dikosongkan,
   * catatan itu menunjuk ke tamu yang tidak ada lagi: kodenya tidak akan pernah
   * bisa dicetak ulang untuk siapa pun, tetapi tetap dihitung habis. Persediaan
   * akan menyusut tanpa ada satu voucher pun yang beredar.
   */
  const promoDilepas = promo.reset().dilepas;

  console.log(`  [tamu] direset — ${hasil.dihapus} tamu dihapus, penomoran mulai dari 1`);
  if (promoDilepas) console.log(`  [promo] ${promoDilepas} kode ikut dilepas`);
  res.json({ ...hasil, promoDilepas });
});

/** Buang seluruh persediaan, untuk diganti berkas baru. */
app.post('/api/promo/kosongkan', butuhSandi, (_req, res) => {
  const hasil = promo.kosongkan();
  console.log('  [promo] persediaan dikosongkan');
  res.json(hasil);
});

app.post('/api/promo/impor', butuhSandi, (req, res) => {
  const berkas = String(req.body?.berkas ?? '').trim();
  if (!berkas) return res.status(400).json({ galat: 'Jalur berkas kosong' });

  try {
    const jalur = path.isAbsolute(berkas) ? berkas : path.join(AKAR, '..', berkas);
    const hasil = promo.impor(bacaBerkasKode(jalur));
    console.log(`  [promo] ${hasil.masuk} kode masuk, sisa ${hasil.sisa}`);
    res.json(hasil);
  } catch (galat) {
    res.status(400).json({ galat: galat.message });
  }
});

/**
 * Unggah berkas kode langsung dari peramban.
 *
 * Sebelumnya satu-satunya cara mengganti persediaan adalah menyunting berkas
 * teks di dalam folder kiosk dengan Notepad. Itu menuntut petugas mencari
 * folder yang benar, menghindari akhiran .txt ganda yang disembunyikan
 * Windows, lalu menyalakan ulang kiosk — tiga kesempatan gagal untuk pekerjaan
 * yang seharusnya cukup memilih berkas.
 *
 * Berkas dikirim mentah, bukan lewat form multipart, supaya tidak ada
 * dependensi baru yang harus ikut dipasang di PC acara.
 */
app.post(
  '/api/promo/unggah',
  butuhSandi,
  express.raw({ type: '*/*', limit: '8mb' }),
  (req, res) => {
    const nama = String(req.get('x-nama-berkas') || 'kode.txt');
    const ganti = req.get('x-ganti') === '1';

    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ galat: 'Berkas kosong.' });
    }

    /*
     * Berkas ditulis ke tempat sementara karena pengurai xlsx memanggil `unzip`
     * atas sebuah jalur. Menguraikannya dari memori berarti menulis pengurai
     * zip sendiri — pekerjaan yang jauh lebih besar daripada nilainya di sini.
     */
    const akhiran = (path.extname(nama) || '.txt').toLowerCase();
    const sementara = path.join(os.tmpdir(), `promo-unggah-${randomUUID()}${akhiran}`);

    try {
      writeFileSync(sementara, req.body);
      const kode = bacaBerkasKode(sementara);

      /*
       * Persediaan lama dikosongkan HANYA bila diminta, dan sesudah berkas
       * berhasil diurai. Mengosongkan lebih dulu berarti berkas yang ternyata
       * rusak meninggalkan kiosk tanpa kode sama sekali — di tengah acara,
       * itu jauh lebih buruk daripada persediaan lama yang masih ada.
       */
      if (ganti) promo.kosongkan();

      const hasil = promo.impor(kode);
      console.log(`  [promo] unggah "${nama}": ${hasil.masuk} kode masuk, sisa ${hasil.sisa}`);
      res.json({ ...hasil, nama, diganti: ganti });
    } catch (galat) {
      res.status(400).json({ galat: galat.message });
    } finally {
      try { unlinkSync(sementara); } catch { /* sudah hilang */ }
    }
  },
);

app.post('/api/daftar', async (req, res) => {
  const nama = bersihkan(req.body?.nama, BATAS_NAMA);
  const pesan = bersihkan(req.body?.pesan, BATAS_PESAN);
  /*
   * Tiga jenis, bukan dua.
   *
   * "tanpaHadiah" dipakai ketika persediaan voucher habis dan tamu memilih
   * tetap ikut merekam. Ucapannya tersimpan seperti biasa, tetapi tidak ada
   * kode yang diambil dan tidak ada kertas yang keluar — mencetak struk yang
   * tidak bisa ditukar apa pun hanya membuat tamu mengantre di kasir untuk
   * ditolak.
   */
  const jenisMinta = req.body?.jenis;
  const jenis = jenisMinta === 'voucher' ? 'voucher'
    : jenisMinta === 'tanpaHadiah' ? 'tanpaHadiah'
    : 'undangan';
  const memberId = bersihkan(req.body?.memberId, 40) || null;

  if (nama.length < 2) {
    return res.status(400).json({ galat: 'Nama minimal 2 huruf' });
  }

  /*
   * Penjagaan yang sebenarnya ada di sini, bukan di layar.
   *
   * Layar pindai memang sudah menolak member yang pernah mengambil, tetapi
   * tombol "Ketik Manual" melewati layar itu sepenuhnya — dan yang menentukan
   * apakah voucher kedua keluar adalah permintaan ini, bukan tampilan.
   */
  if (jenis === 'voucher' && memberId) {   // eslint-disable-line
    const sudah = db.voucherMember(memberId);
    if (sudah) {
      return res.status(409).json({
        galat: 'Nomor keanggotaan ini sudah pernah mengambil Gift Voucher.',
        kode: 'sudah-ambil',
        nomor: sudah.id,
        nama: sudah.nama,
        pada: sudah.dibuat_pada,
      });
    }
  }

  let tamu;
  try {
    const kode = buatKodeUnik(db.kodeDipakai);
    /*
     * Dua berkas disimpan: yang berbingkai dan yang mentah.
     *
     * Yang berbingkai memakai nama tanpa akhiran karena itulah yang dipakai di
     * mana-mana — dikirim ke server undangan, ditampilkan di halaman rekaman.
     * Yang mentah diberi akhiran "-mentah" dan tinggal di PC ini saja: bahan
     * asli tanpa bingkai, kalau kelak bingkainya perlu diganti atau dilepas.
     */
    const video = tautkanVideo(req.body?.videoId, kode);
    const videoMentah = tautkanVideo(req.body?.videoMentahId, kode, '-mentah');

    tamu = db.simpanTamu({
      kode,
      nama,
      pesan,
      dibuatPada: new Date().toISOString(),
      jenis,
      memberId,
      video,
      videoMentah,
    });
  } catch (galat) {
    return res.status(500).json({ galat: galat.message });
  }

  /*
   * Kode promo diambil SEBELUM struk disusun.
   *
   * Voucher tanpa kode adalah kertas kosong bagi kasir, jadi ketiadaan
   * persediaan harus ketahuan sekarang — bukan setelah struk keluar. Kalau
   * habis, tamu tetap dilayani dan strukanya dicetak sebagai undangan biasa;
   * menolak di sini berarti menahan orang yang sudah mengantre dan merekam.
   */
  let kodePromo = null;
  if (tamu.jenis === 'voucher') {   // tanpaHadiah sengaja tidak masuk sini
    try {
      kodePromo = promo.ambilUntuk(tamu.kode);
      if (!kodePromo) console.warn('  [promo] persediaan habis — struk dicetak tanpa kode');
    } catch (galat) {
      console.error('  [promo] gagal mengambil kode:', galat.message);
    }
  }
  tamu = { ...tamu, kodePromo };

  /*
   * Yang tanpa hadiah tidak dicetak sama sekali.
   *
   * Ucapannya tetap dikirim ke server undangan — video itulah yang jadi bahan
   * acara, dan justru itu satu-satunya alasan tamu diminta tetap merekam.
   */
  const [hasilCetak] = await Promise.all([
    tamu.jenis === 'tanpaHadiah'
      ? Promise.resolve({ diterima: false, dilewati: true })
      : mulaiCetak(tamu),
    sinkron.kirimSegera(tamu),
  ]);

  const url = urlUntuk(tamu.kode);

  /*
   * QR di layar harus SAMA PERSIS dengan yang tercetak di kertas.
   *
   * Struk voucher membawa kode promo di dalam QR-nya supaya bisa dipindai
   * sistem PAM-PLUS; layar hasil dulu selalu menggambar QR undangan. Tamu
   * memindai yang di layar, mendapat halaman undangan, dan menyimpulkan
   * vouchernya gagal — padahal kertas di tangannya benar.
   */
  const isiQr = tamu.jenis === 'voucher' && kodePromo ? kodePromo : url;

  /*
   * Tanpa hadiah berarti tanpa apa pun untuk dipindai.
   *
   * Membuat QR undangan di sini akan memancing tamu memindainya, membuka
   * halaman undangan, lalu mengira ia tetap mendapat sesuatu.
   */
  const qr = tamu.jenis === 'tanpaHadiah' ? null : await QRCode.toDataURL(isiQr, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 12,
    color: { dark: '#101010', light: '#ffffff' },
  });

  res.json({
    kode: tamu.kode,
    nama: tamu.nama,
    pesan: tamu.pesan,
    nomor: tamu.id,
    jenis: tamu.jenis,
    adaVideo: Boolean(tamu.video),
    url,
    urlTampil: url.toLowerCase(),
    qr,
    // null berarti "masih dicetak" — layar menampilkan QR lebih dulu lalu
    // menanyakan hasilnya lewat /api/hasil-cetak.
    kodePromo,
    sisaPromo: promo.sisa(),
    tercetak: hasilCetak.diterima ? null : false,
    galatCetak: hasilCetak.galat,
  });
});

app.get('/api/hasil-cetak/:kode', (req, res) => {
  const kode = String(req.params.kode).toUpperCase();
  const hasil = cetakBerjalan.get(kode);

  if (!hasil) return res.json({ selesai: false, tercetak: null, galat: null });

  // Dibuang setelah dibaca tuntas agar peta ini tidak tumbuh sepanjang acara.
  if (hasil.selesai) cetakBerjalan.delete(kode);
  res.json(hasil);
});

app.post('/api/cetak-ulang/:kode', async (req, res) => {
  let tamu = db.ambilTamu(String(req.params.kode).toUpperCase());
  if (!tamu) return res.status(404).json({ galat: 'Kode tidak ditemukan' });

  // Kode promo yang sudah pernah diberikan kepada tamu ini dipakai lagi —
  // ambilUntuk mengembalikan kode yang sama, bukan mengambil yang baru. Tanpa
  // itu, satu cetak ulang menghabiskan satu voucher dari persediaan.
  if (tamu.jenis === 'voucher') {
    tamu = { ...tamu, kodePromo: promo.ambilUntuk(tamu.kode) };
  }

  const hasil = await cetakStruk(tamu);
  res.json({ tercetak: hasil.tercetak, galatCetak: hasil.galat });
});

/**
 * Tanda hidup yang tidak menyentuh perangkat keras apa pun.
 *
 * Dipakai penyala untuk memastikan kiosk siap. Sengaja terpisah dari
 * /api/status: status ikut menanyai printer, dan printer yang mati membuat
 * jawabannya lambat — cukup lambat untuk membuat penyala menyimpulkan kiosk
 * gagal menyala padahal ia sehat sepenuhnya.
 */
/*
 * Denyut ringan: tidak menyentuh printer sama sekali.
 *
 * /api/status ikut menanyai printer, dan printer jaringan yang mati membuat
 * jawabannya tertahan beberapa detik menunggu TCP menyerah. Halaman yang hanya
 * butuh jumlah tamu tidak boleh ikut menunggu itu.
 */
app.get('/api/hidup', (_req, res) => res.json({ ok: true, sinkron: sinkron.status() }));

app.get('/api/status', async (_req, res) => {
  const [statusPrinter] = await Promise.all([printer.status()]);
  res.json({
    printer: statusPrinter,
    sinkron: sinkron.status(),
    acara: konf.namaAcara,
    dryRun: konf.dryRun,
  });
});

/** Dipanggil dari layar petugas setelah kabel printer dicolok ulang. */
app.post('/api/printer/pulihkan', async (_req, res) => {
  await printer.pulihkan();
  res.json(await printer.status());
});

app.get('/api/tamu-terakhir', (_req, res) => {
  res.json(db.tamuTerakhir(20));
});

/* ------------------------------- check-in --------------------------------- */

/**
 * Ambil kode tamu dari apa pun yang terbaca pemindai.
 *
 * Yang dipindai biasanya URL lengkap dari struk, tetapi petugas juga bisa
 * mengetik kodenya langsung ketika QR-nya sobek atau pudar. Keduanya diterima
 * di sini, karena memaksa petugas mengubah bentuknya sendiri di depan antrean
 * tamu adalah cara yang bagus untuk membuat pintu masuk macet.
 */
function bacaKode(mentah) {
  const teks = String(mentah ?? '').trim();
  if (!teks) return null;

  // Bentuk URL: ambil ruas terakhir setelah /U/ atau /u/.
  const dariUrl = teks.match(/\/[uU]\/([0-9A-Za-z]{4,8})\s*$/);
  if (dariUrl) return dariUrl[1].toUpperCase();

  const polos = teks.match(/^[0-9A-Za-z]{4,8}$/);
  return polos ? teks.toUpperCase() : null;
}

app.post('/api/hadir', (req, res) => {
  const kode = bacaKode(req.body?.kode);
  if (!kode) return res.status(400).json({ status: 'tidak-terbaca' });

  const hasil = db.catatHadir(kode);
  if (!hasil) return res.json({ status: 'asing', kode });

  res.json({
    status: hasil.pertamaKali ? 'baru' : 'ulang',
    kode,
    nama: hasil.tamu.nama,
    pesan: hasil.tamu.pesan,
    nomor: hasil.tamu.id,
    hadirPada: hasil.tamu.hadir_pada,
    jumlahScan: hasil.tamu.jumlah_scan,
  });
});

/* ------------------------------ pengaturan -------------------------------- */

app.get('/api/pengaturan', (_req, res) => {
  res.json({ nilai: pengaturan.baca(), batas: pengaturan.batas() });
});

app.post('/api/pengaturan', (req, res) => {
  // Nilai di luar rentang dipaksa masuk, bukan ditolak: petugas yang menahan
  // tombol tambah tidak sedang menyerang apa pun, ia hanya ingin nilai
  // tertingginya.
  res.json({ nilai: pengaturan.simpan(req.body ?? {}), batas: pengaturan.batas() });
});

/* ------------------------------ rekaman video ----------------------------- */

/**
 * Daftar rekaman yang tersimpan di PC ini.
 *
 * Sumber daftarnya berkas di disk, bukan tabel tamu: berkas itulah yang
 * sebenarnya ada dan yang akan dipakai belakangan sebagai bahan. Tabel tamu
 * dipakai untuk melengkapi nama — dan rekaman yang tamunya sudah terhapus
 * tetap ikut terdaftar, bukan hilang diam-diam dari pandangan.
 */
app.get('/api/rekaman', (_req, res) => {
  const folder = path.join(AKAR, 'data', 'video');
  let berkas = [];
  try {
    berkas = readdirSync(folder).filter((n) => /\.(webm|mp4)$/i.test(n));
  } catch {
    return res.json({ total: 0, totalMB: 0, rekaman: [] });
  }

  const daftar = berkas.map((nama) => {
    /*
     * Akhiran "-mentah" dilucuti sebelum mencari tamunya.
     *
     * Sejak rekaman disimpan dua kali, berkas mentah bernama <kode>-mentah.webm.
     * Tanpa pelucutan ini kodenya terbaca "B5HZ-MENTAH", tamunya tidak ketemu,
     * dan seluruh baris itu tampil tanpa nama seolah rekaman milik entah siapa.
     */
    const dasar = nama.replace(/\.[^.]+$/, '');
    const mentah = /-mentah$/i.test(dasar);
    const kode = dasar.replace(/-mentah$/i, '').toUpperCase();
    const tamu = db.ambilTamu(kode);
    let ukuran = 0;
    let dibuat = null;
    try {
      const st = statSync(path.join(folder, nama));
      ukuran = st.size;
      dibuat = st.mtime.toISOString();
    } catch {}
    return {
      kode,
      berkas: nama,
      mentah,
      nama: tamu?.nama ?? null,
      nomor: tamu?.id ?? null,
      jenis: tamu?.jenis ?? null,
      ukuranMB: Math.round((ukuran / 1048576) * 10) / 10,
      dibuat,
      url: `/rekaman/${encodeURIComponent(nama)}`,
    };
  });

  // Terbaru di atas: yang baru direkam adalah yang paling sering dicari.
  daftar.sort((a, b) => String(b.dibuat).localeCompare(String(a.dibuat)));

  res.json({
    total: daftar.length,
    totalMB: Math.round(daftar.reduce((n, r) => n + r.ukuranMB, 0) * 10) / 10,
    rekaman: daftar,
  });
});

/** Sajikan satu berkas rekaman untuk diputar. */
app.get('/rekaman/:berkas', (req, res) => {
  const nama = path.basename(String(req.params.berkas));
  if (!/^[A-Za-z0-9_-]+\.(webm|mp4)$/.test(nama)) return res.status(400).end();
  res.sendFile(path.join(AKAR, 'data', 'video', nama), (galat) => {
    if (galat && !res.headersSent) res.status(404).end();
  });
});

/**
 * Hapus satu rekaman.
 *
 * Berkasnya benar-benar dihapus, tidak dipindahkan ke tempat lain. Petugas yang
 * menekan hapus di tengah acara sedang membebaskan ruang atau membuang rekaman
 * yang gagal; menyembunyikannya di folder lain hanya memindahkan masalahnya.
 */
app.delete('/api/rekaman/:berkas', (req, res) => {
  const nama = path.basename(String(req.params.berkas));
  if (!/^[A-Za-z0-9_-]+\.(webm|mp4)$/.test(nama)) return res.status(400).json({ galat: 'Nama berkas tidak sah' });

  try {
    unlinkSync(path.join(AKAR, 'data', 'video', nama));
    console.log(`  [video] ${nama} dihapus petugas`);
    res.json({ ok: true });
  } catch (galat) {
    res.status(404).json({ galat: galat.code === 'ENOENT' ? 'Berkas sudah tidak ada' : galat.message });
  }
});

app.get('/api/rekap', (_req, res) => {
  const { total } = db.ringkasan();
  res.json({ total, hadir: db.jumlahHadir() });
});

/**
 * Buang rekaman sementara yang tidak pernah diklaim.
 *
 * Setiap tamu yang merekam lalu pergi sebelum menekan Kirim meninggalkan satu
 * berkas beberapa megabita di folder sementara. Sepanjang acara itu menumpuk
 * tanpa batas, dan disk kiosk yang penuh menghentikan bukan hanya perekaman
 * tetapi juga penulisan basis data — yaitu seluruh kiosk.
 *
 * Ambang satu jam jauh lebih lama daripada alur terpanjang yang mungkin
 * (persiapan 60 detik + rekam 15 detik + peninjauan), sehingga rekaman yang
 * masih akan dipakai tidak pernah ikut terbuang.
 */
const UMUR_SEMENTARA_MS = 60 * 60 * 1000;

function bersihkanVideoSementara() {
  let dibuang = 0;
  try {
    for (const berkas of readdirSync(FOLDER_VIDEO_SEMENTARA)) {
      const jalur = path.join(FOLDER_VIDEO_SEMENTARA, berkas);
      if (Date.now() - statSync(jalur).mtimeMs < UMUR_SEMENTARA_MS) continue;
      rmSync(jalur, { force: true });
      dibuang += 1;
    }
  } catch {
    // Folder belum ada atau tidak terbaca; tidak ada yang perlu dibersihkan.
  }
  if (dibuang) console.log(`  [video] ${dibuang} rekaman sementara dibuang`);
}

const pembersihVideo = setInterval(bersihkanVideoSementara, 10 * 60 * 1000);
pembersihVideo.unref?.();
bersihkanVideoSementara();

/**
 * Tarik salinan daftar member dari server.
 *
 * Kiosk menyimpan salinannya sendiri, bukan menanyakan server tiap kali kartu
 * dipindai: pemindaian terjadi di depan tamu, dan menjadikannya bergantung
 * jaringan berarti antrean berhenti setiap kali sinyal tersendat. Salinan lokal
 * menjawab dalam mikrodetik dan tidak pernah gagal.
 *
 * Kegagalan menarik tidak pernah dilaporkan sebagai galat: daftar yang sudah
 * ada tetap dipakai, hanya mungkin tertinggal beberapa jam dari data terbaru.
 */
/*
 * Keadaan penarikan terakhir, untuk ditampilkan di layar petugas.
 *
 * Tanpa ini, halaman member hanya bisa bilang berapa yang tersimpan — bukan
 * apakah angka itu masih segar. Petugas yang menunggu member baru muncul perlu
 * tahu bedanya antara "belum dikirim pihak ketiga" dan "kiosk gagal menarik".
 */
const keadaanMember = { waktu: null, hasil: null, galat: null, sedang: false };

async function tarikMember() {
  if (!konf.secret) return;
  keadaanMember.sedang = true;

  const alamat = konf.baseUrl.toLowerCase().replace(/\/+$/, '');
  try {
    const respons = await fetch(`${alamat}/api/member/sinkron`, {
      headers: { 'x-sync-secret': konf.secret },
      signal: AbortSignal.timeout(20000),
    });
    if (!respons.ok) return;

    const { member: daftar } = await respons.json();
    if (!Array.isArray(daftar) || daftar.length === 0) return;

    // `ganti` sengaja true: server adalah sumber kebenaran daftar member, dan
    // menggabungkan tanpa mengganti membuat member yang sudah dicabut
    // keanggotaannya tetap hidup di kiosk selamanya.
    const hasil = member.impor(daftar, { ganti: true });
    keadaanMember.hasil = hasil.total;
    keadaanMember.galat = null;
    console.log(`  [member] ${hasil.total} member tersinkron`);
  } catch (galat) {
    // Jaringan sedang tidak bisa dihubungi. Salinan lama tetap dipakai.
    keadaanMember.galat = galat.message;
  } finally {
    keadaanMember.waktu = new Date().toISOString();
    keadaanMember.sedang = false;
  }
}

/*
 * Daftar member ditarik tiap 20 detik.
 *
 * Sebelumnya dua menit. Pihak ketiga masih mengirim data sampai hari acara,
 * dan member yang baru didaftarkan lalu langsung datang ke kiosk akan ditolak
 * selama sisa dua menit itu — di depan antrean, tanpa cara memperbaikinya
 * selain menunggu.
 */
const pemantauMember = setInterval(tarikMember, 20 * 1000);
pemantauMember.unref?.();
tarikMember();

/**
 * Pemantau pemulihan printer.
 *
 * CUPS menonaktifkan antrian setiap kali gagal mengirim dan tidak pernah
 * menyalakannya kembali sendiri. Tanpa pemantau ini, printer yang lepas sekejap
 * lalu tersambung lagi meninggalkan kiosk mati sampai ada orang yang menyadari
 * dan menekan tombol di panel petugas — dan di tengah acara, yang menyadarinya
 * biasanya tamu ketiga yang tidak menerima struk.
 */
const pemantauPrinter = setInterval(() => {
  printer
    .pulihkanBilaPerlu()
    .then((hasil) => hasil && console.log(`  [printer] ${hasil}`))
    .catch(() => {});
}, 5000);
pemantauPrinter.unref?.();

/*
 * Pencari printer yang berjalan sendiri.
 *
 * Dijalankan lebih jarang daripada pemulih di atas karena penyapuan jaringan
 * jauh lebih mahal, dan `pastikan` keluar seketika selama printer sekarang
 * masih menjawab — biaya sesungguhnya hanya muncul saat printer benar-benar
 * hilang. Inilah yang membuat printer yang dicabut lalu dicolok ke porta lain,
 * atau yang mendapat alamat DHCP berbeda, tersambung lagi tanpa disentuh.
 */
const pencariPrinter = setInterval(() => {
  if (konf.dryRun) return;
  printerOtomatis
    .pastikan()
    .then((h) => h.berubah && console.log(`  [printer] ${h.alasan}`))
    .catch(() => {});
}, 20_000);
pencariPrinter.unref?.();

/* ------------------------------- printer API ------------------------------ */

app.get('/api/printer', async (_req, res) => {
  const [status, sistem] = await Promise.all([printer.status(), printerOtomatis.printerSistem()]);
  res.json({ ...printerOtomatis.ringkas(), status, sistem });
});

/** Sapu jaringan sekarang juga, lalu pakai hasilnya bila jelas. */
app.post('/api/printer/cari', async (_req, res) => {
  try {
    const hasil = await printerOtomatis.pastikan({ paksaSapu: true });
    const [status, sistem] = await Promise.all([printer.status(), printerOtomatis.printerSistem()]);
    res.json({ ...hasil, ...printerOtomatis.ringkas(), status, sistem });
  } catch (galat) {
    res.status(500).json({ galat: galat.message });
  }
});

/** Pilihan manusia menimpa apa pun, dan diingat di mesin ini. */
app.post('/api/printer/pilih', async (req, res) => {
  const host = bersihkan(req.body?.host, 60) || null;
  const nama = bersihkan(req.body?.nama, 120) || null;
  const port = Number(req.body?.port) || 9100;

  if (!host && !nama) return res.status(400).json({ galat: 'Sebutkan host atau nama printer.' });

  printerOtomatis.pilih({ host, port, nama });
  res.json({ ...printerOtomatis.ringkas(), status: await printer.status() });
});

/**
 * Cetak struk percobaan.
 *
 * Satu-satunya cara membuktikan printer benar — "porta 9100 terbuka" hanya
 * membuktikan ada yang mendengarkan di sana, bukan bahwa kertas keluar.
 */
app.post('/api/printer/uji', async (_req, res) => {
  try {
    /*
     * Struk uji memakai jalur cetak yang SAMA dengan struk tamu.
     *
     * Kalau ia memakai jalur sendiri yang lebih sederhana, ia akan berhasil di
     * saat struk sungguhan gagal, dan petugas berangkat ke acara dengan
     * keyakinan yang keliru.
     */
    const buffer = printer.susun({
      jenis: 'undangan',
      nama: 'UJI PRINTER',
      pesan: '',
      kode: 'UJI0',
      url: urlUntuk('UJI0'),
      namaAcara: konf.namaAcara,
      waktu: waktuLokal(new Date()),
      nomorAntrian: 0,
      member: null,
      kodePromo: null,
    });

    await printer.kirim(buffer, { tunggu: true });
    res.json({ ok: true, tujuan: printerOtomatis.ringkas().dipakai });
  } catch (galat) {
    res.status(500).json({ ok: false, galat: galat.message });
  }
});

// Hanya localhost: kiosk tidak punya alasan menerima koneksi dari jaringan.
app.listen(konf.port, '127.0.0.1', () => {
  console.log(`\n  Kiosk siap  ->  http://localhost:${konf.port}`);
  console.log(`  Undangan    ->  ${konf.baseUrl}`);
  const tujuanPrinter = konf.printerHost
    ? `${konf.printerHost}:${konf.printerPort} (jaringan)`
    : `${konf.printerNama} (USB)`;
  console.log(`  Printer     ->  ${tujuanPrinter} ${konf.printerLebar}mm${konf.dryRun ? '  [MODE UJI]' : ''}`);
  if (hasilBenih.ditanam) {
    console.log(`  Data awal   ->  ${hasilBenih.ditanam} berkas ditanam (${hasilBenih.nama.join(', ')})`);
  }
  if (!konf.secret) {
    console.warn('\n  ! SYNC_SECRET kosong — data tamu tidak akan diterima server undangan.');
  }
  if (!SANDI_PETUGAS) {
    console.warn('  ! SANDI_PETUGAS kosong — halaman Persiapan Acara & Data tidak bisa dibuka.');
  }

  /*
   * Persediaan kosong diberitahukan keras-keras.
   *
   * Kiosk tetap melayani tamu tanpa kode — struk voucher tercetak tanpa kode di
   * dalamnya, dan itu baru ketahuan di kasir, saat tamu sudah pergi membawa
   * kertas yang tidak berlaku.
   */
  /*
   * Alamat lokal diperingatkan setiap kali menyala, bukan sekali di awal.
   *
   * Petugas acara tidak membaca gulungan log; yang dilihat hanya beberapa baris
   * terakhir di jendela hitam. Peringatan yang tergulung ke atas sama saja
   * dengan tidak ada.
   */
  if (alamatLokal(konf.baseUrl)) {
    console.warn('\n  ============================================================');
    console.warn('    PERINGATAN: alamat undangan menunjuk ke jaringan lokal');
    console.warn('  ============================================================\n');
    console.warn(`    ${konf.baseUrl}\n`);
    console.warn('    Akibatnya, sekarang juga:');
    console.warn('      - QR di struk TIDAK bisa dibuka ponsel tamu');
    console.warn('      - daftar member ditarik dari server lokal, bukan VPS\n');
    console.warn('    Perbaiki di kiosk\\.env, satu baris:');
    console.warn('        BASE_URL=https://undangan.opsjobs.id\n');
    console.warn('    lalu jalankan ulang kiosk.\n');
  }

  if (promo.total() === 0) {
    console.warn('\n  ! Belum ada kode Gift Voucher.');
    console.warn('    Isi kiosk/benih/kode-voucher.txt lalu jalankan ulang,');
    console.warn('    atau impor dari halaman Persiapan Acara.');
  }
  console.log('');
});

for (const sinyal of ['SIGINT', 'SIGTERM']) {
  process.on(sinyal, () => {
    clearInterval(pemantauPrinter);
    clearInterval(pemantauMember);
    clearInterval(pembersihVideo);
    sinkron.berhenti();
    db.tutup();
    process.exit(0);
  });
}
