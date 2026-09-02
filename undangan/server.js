/**
 * Server undangan digital — berjalan di VPS di balik Nginx.
 *
 * Dua tugas saja:
 *   1. Menerima data tamu dari kiosk (POST /api/tamu, dijaga kunci bersama).
 *   2. Menyajikan halaman undangan untuk /U/:kode yang dipindai dari struk.
 *
 * Aturan yang dipegang di seluruh berkas ini: pemindaian QR TIDAK PERNAH boleh
 * berujung halaman galat. Kode yang tidak dikenal — karena kiosk belum sempat
 * menyinkronkan, atau karena tamu salah ketik — tetap mendapat undangan yang
 * utuh dan pantas dilihat, hanya tanpa sapaan personalnya.
 */

import express from 'express';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { bukaDb } from './src/db.js';
import { bukaMember } from './src/member.js';

const AKAR = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile?.(path.join(AKAR, '.env'));

const konf = {
  port: Number(process.env.PORT) || 5010,

  // Di VPS server ini berada di balik Nginx, jadi mendengarkan loopback saja
  // sudah benar dan sekaligus menutupnya dari internet. Saat diuji di jaringan
  // rumah/kantor tanpa Nginx, ponsel perlu menjangkaunya langsung — itulah
  // satu-satunya alasan nilai ini bisa diubah ke 0.0.0.0.
  host: process.env.LISTEN_HOST || '127.0.0.1',

  secret: process.env.SYNC_SECRET || '',

  // Kunci terpisah untuk pihak ketiga yang mengirim data keanggotaan.
  // Sengaja BUKAN kunci yang sama dengan kiosk: kunci yang dipegang pihak luar
  // harus bisa dicabut atau diganti tanpa membuat setiap kiosk berhenti bekerja.
  kunciMember: process.env.MEMBER_API_KEY || '',
  acara: {
    perusahaan: process.env.NAMA_PERUSAHAAN || 'Perusahaan Kami',
    judul: process.env.JUDUL_ACARA || 'Ulang Tahun',
    tanggal: process.env.TANGGAL_ACARA || '',
    jam: process.env.JAM_ACARA || '',
    lokasi: process.env.LOKASI_ACARA || '',
    alamat: process.env.ALAMAT_ACARA || '',
    petaUrl: process.env.PETA_URL || '',
    mulaiIso: process.env.MULAI_ISO || '',
  },
};

if (!konf.secret) {
  console.error('SYNC_SECRET wajib diisi — server berhenti.');
  process.exit(1);
}

const db = bukaDb(path.join(AKAR, 'data', 'undangan.db'));
const member = bukaMember(path.join(AKAR, 'data', 'member.db'));

const FOLDER_VIDEO = path.join(AKAR, 'data', 'video');
mkdirSync(FOLDER_VIDEO, { recursive: true });

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));   // daftar member bisa puluhan ribu baris
app.use(express.raw({ type: ['video/webm', 'video/mp4'], limit: '40mb' }));

/* ------------------------------- penerimaan ------------------------------- */

/**
 * Bandingkan kunci tanpa membocorkan panjang kecocokan lewat waktu eksekusi.
 * Perbandingan `===` biasa berhenti di byte pertama yang berbeda, sehingga
 * selisih waktunya bisa dipakai menebak kunci karakter demi karakter.
 */
function kunciCocok(diberikan) {
  const a = Buffer.from(String(diberikan ?? ''));
  const b = Buffer.from(konf.secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Pembanding tahan-waktu untuk kunci selain SYNC_SECRET. */
function samaAman(diberikan, benar) {
  const a = Buffer.from(String(diberikan ?? ''));
  const b = Buffer.from(String(benar ?? ''));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

app.post('/api/tamu', (req, res) => {
  if (!kunciCocok(req.get('x-sync-secret'))) {
    return res.status(401).json({ galat: 'Kunci tidak cocok' });
  }

  const kode = String(req.body?.kode ?? '').toUpperCase().trim();
  const nama = String(req.body?.nama ?? '').trim().slice(0, 40);

  if (!/^[0-9A-Z]{4,8}$/.test(kode) || nama.length < 2) {
    return res.status(400).json({ galat: 'Data tamu tidak sah' });
  }

  db.simpanTamu({
    kode,
    nama,
    pesan: String(req.body?.pesan ?? '').trim().slice(0, 120),
    dibuat_pada: String(req.body?.dibuat_pada ?? new Date().toISOString()),
    jenis: req.body?.jenis === 'voucher' ? 'voucher' : 'undangan',
  });

  res.json({ ok: true, kode });
});

/**
 * Terima rekaman greeting dari kiosk.
 *
 * Kode divalidasi dengan pola ketat sebelum dipakai menyusun nama berkas.
 * Tanpa itu, nilai seperti "../../server" akan menulis di luar folder video —
 * dan titik akhir ini menerima berkas biner puluhan megabita.
 */
app.post('/api/video/:kode', (req, res) => {
  if (!kunciCocok(req.get('x-sync-secret'))) {
    return res.status(401).json({ galat: 'Kunci tidak cocok' });
  }

  const kode = String(req.params.kode ?? '').toUpperCase();
  if (!/^[0-9A-Z]{4,8}$/.test(kode)) {
    return res.status(400).json({ galat: 'Kode tidak sah' });
  }
  if (!Buffer.isBuffer(req.body) || req.body.length < 1024) {
    return res.status(400).json({ galat: 'Rekaman kosong' });
  }

  const akhiran = String(req.get('content-type') ?? '').includes('mp4') ? 'mp4' : 'webm';
  writeFileSync(path.join(FOLDER_VIDEO, `${kode}.${akhiran}`), req.body);
  db.tandaiVideo(kode);
  res.json({ ok: true, kode, ukuran: req.body.length });
});

// Rekaman disajikan sebagai berkas statis biasa; <video> di halaman undangan
// mengandalkan permintaan Range untuk mulai memutar sebelum berkasnya utuh.
app.use('/video', express.static(FOLDER_VIDEO, { maxAge: '1d', index: false }));

/* ------------------------------ data member ------------------------------- */

/**
 * Terima daftar member dari pihak ketiga.
 *
 * Dibuat sesantai mungkin dalam menerima bentuk data: larik objek, satu objek,
 * atau dibungkus { "member": [...] }; nama kolomnya boleh id_pam / idPam / id /
 * kode, nomor_hp / hp / telepon / phone, nama / name. Pihak ketiga tidak akan
 * menyesuaikan ekspornya demi bentuk yang kebetulan kupilih, dan setiap
 * ketidakcocokan kecil berarti pertukaran surel berhari-hari.
 *
 * Baris yang tidak sah dilewati, bukan menggagalkan seluruh kiriman: satu baris
 * rusak di antara sepuluh ribu tidak boleh membuat semuanya tertolak.
 */
app.post('/api/member', (req, res) => {
  if (!konf.kunciMember || !samaAman(req.get('x-api-key'), konf.kunciMember)) {
    return res.status(401).json({ galat: 'Kunci API tidak sah' });
  }

  const isi = req.body;
  const daftar = Array.isArray(isi) ? isi : Array.isArray(isi?.member) ? isi.member : [isi];

  if (daftar.length > 20000) {
    return res.status(413).json({ galat: 'Maksimum 20.000 baris per kiriman' });
  }

  try {
    const hasil = member.impor(daftar, { ganti: req.query.ganti === '1' });
    res.json({
      ok: true,
      diterima: daftar.length,
      masuk: hasil.masuk,
      ditolak: hasil.ditolak,
      total: hasil.total,
      contohDitolak: hasil.contohDitolak,
    });
  } catch (galat) {
    res.status(500).json({ galat: galat.message });
  }
});

/** Kiosk menarik salinan daftar member ke penyimpanan lokalnya. */
app.get('/api/member/sinkron', (req, res) => {
  if (!kunciCocok(req.get('x-sync-secret'))) return res.status(401).end();
  res.json({ total: member.jumlah(), member: member.semua() });
});

app.get('/api/statistik', (req, res) => {
  if (!kunciCocok(req.get('x-sync-secret'))) return res.status(401).end();
  res.json(db.statistik());
});

/* -------------------------------- halaman --------------------------------- */

// Templat dibaca sekali saat start. PM2 memuat ulang proses setiap deploy,
// jadi berkas yang berubah tetap terambil tanpa membaca disk tiap permintaan.
const TEMPLAT = readFileSync(path.join(AKAR, 'public', 'undangan.html'), 'utf8');

const LOLOS = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const lolos = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => LOLOS[c]);

function sajikanUndangan(req, res) {
  const kode = String(req.params.kode ?? '').toUpperCase();
  const tamu = db.ambilTamu(kode);

  if (tamu) db.tandaiDibuka(kode);

  const berkasVideo = ['webm', 'mp4']
    .map((a) => `${kode}.${a}`)
    .find((b) => Boolean(tamu) && existsSync(path.join(FOLDER_VIDEO, b)));

  const data = {
    ...konf.acara,
    kode,
    nama: tamu?.nama ?? '',
    pesan: tamu?.pesan ?? '',
    dikenali: Boolean(tamu),
    jenis: tamu?.jenis ?? 'undangan',
    videoUrl: berkasVideo ? `/video/${berkasVideo}` : '',
  };

  const halaman = TEMPLAT
    .replaceAll('{{NAMA}}', lolos(data.nama))
    .replaceAll('{{PESAN}}', lolos(data.pesan))
    .replaceAll('{{PERUSAHAAN}}', lolos(data.perusahaan))
    .replaceAll('{{JUDUL}}', lolos(data.judul))
    .replaceAll('{{TANGGAL}}', lolos(data.tanggal))
    .replaceAll('{{JAM}}', lolos(data.jam))
    .replaceAll('{{LOKASI}}', lolos(data.lokasi))
    .replaceAll('{{ALAMAT}}', lolos(data.alamat))
    .replaceAll('{{PETA_URL}}', lolos(data.petaUrl))
    .replaceAll('{{KODE}}', lolos(data.kode))
    .replaceAll('{{VIDEO_URL}}', lolos(data.videoUrl))
    // Ditanam sebagai JSON supaya skrip halaman tidak perlu permintaan kedua;
    // di jaringan seluler dalam gedung, permintaan kedua itulah yang biasanya
    // membuat halaman terasa lambat.
    .replaceAll('{{DATA_JSON}}', JSON.stringify(data).replace(/</g, '\\u003c'));

  res.type('html').send(halaman);
}

// Nginx meneruskan huruf apa adanya, dan struk mencetak /U/ huruf besar demi
// menghemat ruang QR. Express mencocokkan rute tanpa membedakan huruf besar
// dan kecil secara bawaan, tetapi kedua bentuk ditulis eksplisit agar tidak
// diam-diam rusak bila setelan itu berubah.
app.get('/U/:kode', sajikanUndangan);
app.get('/u/:kode', sajikanUndangan);

app.use(express.static(path.join(AKAR, 'public'), { maxAge: '1h' }));

// Akar situs dan alamat tak dikenal apa pun tetap menampilkan undangan umum,
// bukan 404. Tamu yang salah mengetik satu huruf tetap sampai ke acara.
app.get('/', (req, res) => sajikanUndangan({ params: { kode: '' } }, res));
app.use((req, res) => sajikanUndangan({ params: { kode: '' } }, res));

app.listen(konf.port, konf.host, () => {
  console.log(`Server undangan berjalan di ${konf.host}:${konf.port}`);
  if (konf.host !== '127.0.0.1') {
    console.warn('  ! Mendengarkan di luar loopback — hanya untuk uji di jaringan lokal.');
  }
});
