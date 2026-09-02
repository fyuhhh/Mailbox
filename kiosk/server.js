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
import { networkInterfaces } from 'node:os';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { randomUUID, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { bukaDb } from './src/db.js';
import { bukaPengaturan } from './src/pengaturan.js';
import { bukaMember } from './src/member.js';
import { bukaPromo, bacaBerkasKode } from './src/promo.js';
import { buatKodeUnik } from './src/kode.js';
import { Printer } from './src/printer.js';
import { Sinkronisasi } from './src/sync.js';

const AKAR = path.dirname(fileURLToPath(import.meta.url));

process.loadEnvFile?.(path.join(AKAR, '.env'));

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

function tentukanBaseUrl() {
  const mentah = (process.env.BASE_URL || '').trim();
  const portUndangan = Number(process.env.UNDANGAN_PORT) || 5010;

  if (mentah && mentah.toUpperCase() !== 'AUTO') {
    return mentah.toUpperCase().replace(/\/+$/, '');
  }

  const ip = alamatLan();
  if (!ip) {
    console.warn('\n  ! BASE_URL=AUTO tetapi tidak ada alamat LAN yang terdeteksi.');
    console.warn('    QR akan menunjuk ke localhost dan TIDAK bisa dibuka dari ponsel.\n');
    return `HTTP://LOCALHOST:${portUndangan}`;
  }
  return `HTTP://${ip}:${portUndangan}`;
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

const db = bukaDb(path.join(AKAR, 'data', 'kiosk.db'));
const pengaturan = bukaPengaturan(path.join(AKAR, 'data', 'pengaturan.json'));
const member = bukaMember(path.join(AKAR, 'data', 'member.db'));
const promo = bukaPromo(path.join(AKAR, 'data', 'promo.db'));

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
function tautkanVideo(videoId, kode) {
  if (!videoId) return null;

  // basename memotong komponen jalur apa pun yang ikut terkirim, sehingga nilai
  // seperti "../../server.js" tidak bisa memindahkan berkas di luar folder video.
  const bersih = path.basename(String(videoId));
  if (!/^[0-9a-f-]+\.(webm|mp4)$/i.test(bersih)) return null;

  const asal = path.join(FOLDER_VIDEO_SEMENTARA, bersih);
  if (!existsSync(asal)) return null;

  const berkas = `${kode}${path.extname(bersih)}`;
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
const SANDI_PETUGAS = process.env.SANDI_PETUGAS || '';

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

app.post('/api/daftar', async (req, res) => {
  const nama = bersihkan(req.body?.nama, BATAS_NAMA);
  const pesan = bersihkan(req.body?.pesan, BATAS_PESAN);
  const jenis = req.body?.jenis === 'voucher' ? 'voucher' : 'undangan';
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
  if (jenis === 'voucher' && memberId) {
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
    const video = tautkanVideo(req.body?.videoId, kode);
    tamu = db.simpanTamu({
      kode,
      nama,
      pesan,
      dibuatPada: new Date().toISOString(),
      jenis,
      memberId,
      video,
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
  if (tamu.jenis === 'voucher') {
    try {
      kodePromo = promo.ambilUntuk(tamu.kode);
      if (!kodePromo) console.warn('  [promo] persediaan habis — struk dicetak tanpa kode');
    } catch (galat) {
      console.error('  [promo] gagal mengambil kode:', galat.message);
    }
  }
  tamu = { ...tamu, kodePromo };

  // Cetak dan unggah berjalan bersamaan: tamu tidak perlu menunggu jaringan,
  // dan halaman undangannya sudah aktif saat ia mengangkat struk.
  const [hasilCetak] = await Promise.all([
    mulaiCetak(tamu),
    sinkron.kirimSegera(tamu),
  ]);

  const url = urlUntuk(tamu.kode);
  const qr = await QRCode.toDataURL(url, {
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
    const kode = nama.replace(/\.[^.]+$/, '').toUpperCase();
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

const pemantauMember = setInterval(tarikMember, 2 * 60 * 1000);
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

// Hanya localhost: kiosk tidak punya alasan menerima koneksi dari jaringan.
app.listen(konf.port, '127.0.0.1', () => {
  console.log(`\n  Kiosk siap  ->  http://localhost:${konf.port}`);
  console.log(`  Undangan    ->  ${konf.baseUrl}`);
  const tujuanPrinter = konf.printerHost
    ? `${konf.printerHost}:${konf.printerPort} (jaringan)`
    : `${konf.printerNama} (USB)`;
  console.log(`  Printer     ->  ${tujuanPrinter} ${konf.printerLebar}mm${konf.dryRun ? '  [MODE UJI]' : ''}`);
  if (!konf.secret) {
    console.warn('\n  ! SYNC_SECRET kosong — data tamu tidak akan diterima server undangan.');
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
