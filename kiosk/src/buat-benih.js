/**
 * Susun ulang folder benih dari data yang sedang dipakai sekarang.
 *
 * Dijalankan di PC penyiap, bukan di PC acara: `node src/buat-benih.js`.
 * Hasilnya ikut tersalin ke PC lain bersama folder kiosk.
 *
 * Data tamu (kiosk.db) sengaja TIDAK ikut. PC baru harus mulai dengan daftar
 * tamu kosong supaya penomorannya mulai dari 001; membawa serta daftar tamu PC
 * lama membuat tamu pertama di sana bernomor lanjutan dan struknya salah.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, copyFileSync, existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(AKAR, 'data');
const BENIH = path.join(AKAR, 'benih');

/*
 * Berkas yang harus sudah terisi di PC baru sebelum acara.
 *
 * promo.db SENGAJA TIDAK IKUT. Kode voucher punya satu sumber saja:
 * benih/kode-voucher.txt. Kalau promo.db ikut ditanam, ia menang — kiosk
 * hanya membaca berkas teks itu ketika persediaannya masih kosong, sehingga
 * PC baru terisi kode dari salinan basis data yang mungkin sudah usang, dan
 * kode di berkas teks tidak pernah dibaca sama sekali. Dua sumber untuk satu
 * hal selalu berakhir dengan yang salah yang dipakai.
 */
const IKUT = ['member.db', 'pengaturan.json'];

mkdirSync(BENIH, { recursive: true });

for (const nama of IKUT) {
  const sumber = path.join(DATA, nama);
  if (!existsSync(sumber)) {
    console.warn(`  lewat  ${nama} — tidak ada di data/`);
    continue;
  }

  /*
   * Basis data dirapikan lebih dulu ke satu berkas.
   *
   * SQLite mode WAL menyimpan tulisan terbaru di berkas -wal terpisah. Menyalin
   * .db saja tanpa checkpoint berarti menyalin keadaan lama: daftar member yang
   * baru disinkronkan bisa hilang seluruhnya, dan tidak ada galat apa pun yang
   * memberi tahu — berkasnya sah, isinya saja yang ketinggalan.
   */
  if (nama.endsWith('.db')) {
    const db = new DatabaseSync(sumber);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  }

  const tujuan = path.join(BENIH, nama);
  rmSync(tujuan, { force: true });
  copyFileSync(sumber, tujuan);
  console.log(`  ikut   ${nama.padEnd(18)} ${(statSync(tujuan).size / 1024).toFixed(0)} KB`);
}

/*
 * Sisa berkas kerja dibersihkan dari folder benih.
 *
 * Membuka salah satu basis di sini — bahkan hanya untuk memeriksa isinya —
 * membuat SQLite menaruh -shm dan -wal di sebelahnya. Kalau dibiarkan, keduanya
 * ikut tersalin ke PC lain.
 */
for (const sisa of readdirSync(BENIH)) {
  if (/-(wal|shm|journal)$/.test(sisa)) {
    rmSync(path.join(BENIH, sisa), { force: true });
    console.log(`  buang  ${sisa}`);
  }
}

console.log(`\n  Benih siap di ${BENIH}`);
console.log('  Folder ini ikut tersalin ke PC lain, dan ditanam sekali saat kiosk pertama kali dijalankan di sana.');
