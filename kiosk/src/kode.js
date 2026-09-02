/**
 * Pembangkit kode tamu.
 *
 * Alfabet sengaja membuang 0/O, 1/I/L dan U. Empat karakter pertama akan
 * dibacakan lewat pengeras suara saat doorprize dan diketik ulang oleh tamu
 * yang QR-nya gagal discan, jadi pasangan huruf yang mirip lebih mahal
 * ongkosnya daripada ruang kode yang hilang. Sisa 28 karakter tetap memberi
 * 614.656 kombinasi untuk panjang 4 — jauh di atas kebutuhan satu acara.
 *
 * Seluruh karakternya juga ada di mode alfanumerik QR, syarat agar simbol
 * tetap di versi terkecil.
 */

import { randomInt } from 'node:crypto';

const ALFABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const PANJANG = 4;

export function buatKode() {
  let hasil = '';
  for (let i = 0; i < PANJANG; i++) hasil += ALFABET[randomInt(ALFABET.length)];
  return hasil;
}

/**
 * Kode unik terhadap `sudahDipakai`. Menyerah setelah sejumlah percobaan agar
 * alfabet yang kehabisan ruang memunculkan galat, bukan perulangan tak
 * berujung yang membekukan kiosk di tengah antrian.
 */
export function buatKodeUnik(sudahDipakai, percobaan = 200) {
  for (let i = 0; i < percobaan; i++) {
    const kode = buatKode();
    if (!sudahDipakai(kode)) return kode;
  }
  throw new Error('Tidak menemukan kode unik baru — ruang kode hampir penuh');
}

export { ALFABET, PANJANG };
