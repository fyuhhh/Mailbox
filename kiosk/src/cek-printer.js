/**
 * Pemeriksa struk tanpa printer.
 *
 *   node src/cek-printer.js            -> pratinjau teks + rincian QR
 *   node src/cek-printer.js --cetak    -> kirim struk uji ke printer sungguhan
 *
 * Dibuat karena satu-satunya cara lain memverifikasi tata letak adalah
 * mencetaknya, dan menghabiskan gulungan kertas untuk itu saat menyetel ulang
 * di lokasi acara jelas bukan pilihan yang masuk akal.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Printer } from './printer.js';
import { sisiModulQr, alfanumerikMurni, LEBAR_DOT } from './escpos.js';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.loadEnvFile?.(path.join(AKAR, '.env'));

const cetakSungguhan = process.argv.includes('--cetak');
const lebarMm = Number(process.env.PRINTER_WIDTH) || 58;
const qrModul = Number(process.env.QR_MODULE) || 10;
const baseUrl = (process.env.BASE_URL || 'HTTPS://UNDANGAN.OPSJOBS.ID').toUpperCase().replace(/\/+$/, '');

const printer = new Printer({
  nama: process.env.PRINTER_NAME || 'TECH_CLA58',
  lebarMm,
  qrModul,
  dryRun: !cetakSungguhan,
  folderDryRun: path.join(AKAR, 'data', 'struk-uji'),
});

const contoh = {
  nama: process.argv.find((a) => a.startsWith('--nama='))?.slice(7) || 'Bagus Wicaksono Pratama',
  pesan: 'Selamat ulang tahun, semoga makin sukses dan berkah!',
  kode: 'A7K9',
  namaAcara: process.env.NAMA_ACARA || 'HUT PERUSAHAAN',
  waktu: '20/09/2026 18:42',
  nomorAntrian: 123,
};
contoh.url = `${baseUrl}/U/${contoh.kode}`;

const buffer = printer.susun(contoh);

/* ------------------------------- laporan QR ------------------------------- */

const sisi = sisiModulQr(contoh.url.length);
const modulTerpakai = Math.min(qrModul, Math.floor(LEBAR_DOT[lebarMm] / (sisi + 8)));
const lebarCetak = (sisi + 8) * modulTerpakai;
const lebarKertas = LEBAR_DOT[lebarMm];

console.log(`\n  KERTAS ${lebarMm}mm — ${lebarKertas} dot\n`);
console.log(`  URL             ${contoh.url}`);
console.log(`  panjang         ${contoh.url.length} karakter`);
console.log(`  mode QR         ${alfanumerikMurni(contoh.url) ? 'alfanumerik (hemat)' : 'BYTE — URL mengandung huruf kecil!'}`);
console.log(`  simbol          ${sisi}x${sisi} modul (versi ${(sisi - 21) / 4 + 1})`);
console.log(`  ukuran modul    ${modulTerpakai} dot${modulTerpakai < qrModul ? `  (diturunkan dari ${qrModul} agar muat)` : ''}`);
console.log(`  lebar tercetak  ${lebarCetak} / ${lebarKertas} dot  ~${(lebarCetak / 8).toFixed(0)}mm`);

if (lebarCetak > lebarKertas) {
  console.log('\n  ! QR MELEBIHI LEBAR KERTAS — akan terpotong dan tidak terbaca.');
} else if (modulTerpakai < 6) {
  console.log('\n  ! Modul di bawah 6 dot: QR jadi rapat dan sering gagal discan dari thermal.');
  console.log('    Pendekkan BASE_URL atau pakai kertas 80mm.');
} else {
  console.log('\n  QR aman untuk dipindai.');
}

/* ---------------------------- pratinjau teks ------------------------------ */

console.log('\n  PRATINJAU TEKS (perintah biner dibuang)\n');

const kolom = lebarMm === 80 ? 48 : 32;
console.log('  +' + '-'.repeat(kolom) + '+');
for (const b of pratinjau(buffer, kolom)) {
  console.log('  |' + b.padEnd(kolom).slice(0, kolom) + '|');
}
console.log('  +' + '-'.repeat(kolom) + '+');

/**
 * Pisahkan teks yang benar-benar tercetak dari perintah kendali.
 *
 * Ditelusuri byte demi byte mengikuti panjang parameter tiap perintah, bukan
 * dengan pencocokan pola. Perintah ESC/POS panjangnya berbeda-beda dan
 * sebagiannya nol parameter, sehingga pola apa pun yang memakai kuantifier
 * opsional akan menelan byte milik perintah sesudahnya.
 */
function pratinjau(buf, kolom) {
  // Jumlah byte parameter setelah dua byte penanda perintah.
  const PARAM = {
    '1b40': 0, // ESC @   inisialisasi
    '1b61': 1, // ESC a   perataan
    '1b45': 1, // ESC E   tebal
    '1b64': 1, // ESC d   maju n baris
    '1d21': 1, // GS  !   ukuran karakter
    '1d56': 2, // GS  V   potong kertas
  };

  const baris = [];
  let kini = '';
  let rata = 0;        // 0 kiri, 1 tengah, 2 kanan
  let gandaLebar = false;
  let i = 0;

  // Perataan diterapkan saat baris ditutup, bukan saat perintahnya dibaca:
  // ESC a hampir selalu dikirim sebelum teksnya, jadi menerapkannya belakangan
  // memberi hasil yang sama dengan yang keluar di kertas. Tanpa meniru ini,
  // pratinjau menampilkan segalanya rata kiri dan tata letak yang sebenarnya
  // rapi terlihat berantakan — cukup meyakinkan untuk memicu "perbaikan" yang
  // justru merusaknya.
  const tutupBaris = () => {
    const isi = kini.trimEnd();
    const sisa = Math.max(kolom - isi.length, 0);
    baris.push(
      rata === 1 ? ' '.repeat(Math.floor(sisa / 2)) + isi
      : rata === 2 ? ' '.repeat(sisa) + isi
      : isi
    );
    kini = '';
  };

  while (i < buf.length) {
    if (buf[i] === 0x1d && buf[i + 1] === 0x28 && buf[i + 2] === 0x6b) {
      const panjang = buf[i + 3] | (buf[i + 4] << 8);
      if (buf[i + 6] === 0x51) { tutupBaris(); kini = '[ KODE QR ]'; tutupBaris(); }
      i += 5 + panjang;
      continue;
    }

    const kunci = buf[i].toString(16).padStart(2, '0') + (buf[i + 1] ?? 0).toString(16).padStart(2, '0');
    if (kunci in PARAM) {
      if (kunci === '1d21') gandaLebar = (buf[i + 2] >> 4) > 0;
      if (kunci === '1b61') rata = buf[i + 2];
      if (kunci === '1b64') { tutupBaris(); for (let n = 1; n < buf[i + 2]; n++) baris.push(''); }
      i += 2 + PARAM[kunci];
      continue;
    }

    if (buf[i] === 0x0a) tutupBaris();
    else if (buf[i] >= 0x20 && buf[i] < 0x7f) kini += String.fromCharCode(buf[i]) + (gandaLebar ? ' ' : '');
    i++;
  }
  if (kini) tutupBaris();

  return baris;
}

if (cetakSungguhan) {
  const status = await printer.status();
  console.log(`  Printer: ${status.keterangan}`);
  await printer.kirim(buffer);
  console.log('  Terkirim ke printer.\n');
} else {
  console.log('  Jalankan dengan --cetak untuk mengirimnya ke printer sungguhan.\n');
}
