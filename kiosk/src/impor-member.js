/**
 * Impor daftar member PAM-PLUS dari berkas JSON.
 *
 *   node src/impor-member.js data-member.json
 *   node src/impor-member.js data-member.json --ganti    (kosongkan dulu)
 *   node src/impor-member.js --ringkas                   (lihat isi sekarang)
 *
 * Bentuk berkas yang diterima — semuanya sah:
 *
 *   [ { "nama": "...", "id_pam": "...", "nomor_hp": "..." }, ... ]
 *   { "member": [ ... ] }
 *   { "PP-001": "Nama" }            <- bentuk lama, tanpa nomor HP
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bukaMember } from './member.js';

const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const member = bukaMember(path.join(AKAR, 'data', 'member.db'));

const argumen = process.argv.slice(2);
const ganti = argumen.includes('--ganti');
const berkas = argumen.find((a) => !a.startsWith('--'));

function tampilkanRingkas() {
  const total = member.jumlah();
  console.log(`\n  ${total} member tersimpan.\n`);
  if (!total) return;
  console.log('  ' + 'ID PAM'.padEnd(16) + 'NAMA'.padEnd(26) + 'NOMOR HP');
  console.log('  ' + '-'.repeat(60));
  for (const m of member.contoh(10)) {
    console.log('  ' + m.id_pam.padEnd(16) + m.nama.slice(0, 24).padEnd(26) + (m.nomor_hp || '-'));
  }
  console.log('');
}

if (!berkas) {
  tampilkanRingkas();
  if (argumen.includes('--ringkas')) process.exit(0);
  console.log('  Pemakaian: node src/impor-member.js <berkas.json> [--ganti]\n');
  process.exit(argumen.length ? 0 : 1);
}

let isi;
try {
  isi = JSON.parse(readFileSync(path.resolve(berkas), 'utf8'));
} catch (galat) {
  console.error(`\n  Gagal membaca ${berkas}: ${galat.message}\n`);
  process.exit(1);
}

/**
 * Bentuk lama `{ "PP-001": "Nama" }` diubah menjadi larik.
 *
 * Berkas member.json dari versi sebelumnya masih beredar; menolaknya akan
 * memaksa orang menyusun ulang datanya secara manual tanpa alasan.
 */
function keLarik(masuk) {
  if (Array.isArray(masuk)) return masuk;
  if (Array.isArray(masuk?.member)) return masuk.member;
  if (masuk && typeof masuk === 'object') {
    const nilai = Object.values(masuk);
    if (nilai.every((v) => typeof v === 'string')) {
      return Object.entries(masuk).map(([id_pam, nama]) => ({ id_pam, nama }));
    }
    return [masuk];
  }
  return [];
}

const daftar = keLarik(isi);
console.log(`\n  Membaca ${daftar.length} baris dari ${path.basename(berkas)}…`);

const hasil = member.impor(daftar, { ganti });

console.log(`\n  Masuk    : ${hasil.masuk}`);
console.log(`  Ditolak  : ${hasil.ditolak}`);
console.log(`  Total    : ${hasil.total} member di basis data`);

if (hasil.contohDitolak.length) {
  console.log('\n  Contoh baris yang ditolak (butuh id_pam dan nama minimal 2 huruf):');
  for (const d of hasil.contohDitolak) console.log(`    baris ${d.baris}: ${d.isi}`);
}

tampilkanRingkas();
member.tutup();
