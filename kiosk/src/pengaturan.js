/**
 * Pengaturan waktu yang bisa diubah petugas dari layar, tanpa menyunting kode.
 *
 * Nilai yang tepat baru ketahuan di lokasi acara: berapa lama tamu sebenarnya
 * butuh bersiap, seberapa panjang antrean, seberapa sabar orang menunggu.
 * Menanamkannya di kode berarti setiap penyesuaian kecil menuntut orang yang
 * bisa menyunting berkas dan menyalakan ulang kiosk — di tengah acara, itu
 * tidak akan terjadi, dan angkanya akan dibiarkan salah sampai selesai.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Setiap pengaturan membawa batasnya sendiri.
 *
 * Batas atas bukan hiasan: rekaman lebih dari lima belas detik membuat berkas
 * membengkak dan antrean berhenti, sedangkan hitung mundur nol detik membuat
 * tamu terekam sedang kebingungan mencari kamera.
 */
export const BATAS = {
  rekamDetik:      { min: 5,  maks: 15, bawaan: 15, label: 'Durasi rekaman' },
  abaDetik:        { min: 3,  maks: 10, bawaan: 5,  label: 'Aba-aba sebelum rekam' },
  siapDetik:       { min: 15, maks: 180, bawaan: 60, label: 'Waktu bersiap' },
  hasilDetik:      { min: 15, maks: 120, bawaan: 60, label: 'Layar hasil' },
  jedaCetakUlang:  { min: 0,  maks: 60, bawaan: 15, label: 'Jeda cetak ulang' },

  /*
   * Putaran layar, untuk TV landscape yang digantung miring.
   *
   * Berbeda dari yang lain, nilainya dipilih dari daftar — bukan rentang.
   * Nilai antara seperti 45 derajat tidak berarti apa pun bagi perangkat yang
   * sedang dipasang tegak di dinding.
   */
  putarLayar: { pilihan: [0, 90, 270], bawaan: 0, satuan: '', label: 'Putar layar' },

  /*
   * Mode khusus member: jalur "Isi Nama" disembunyikan sepenuhnya.
   *
   * Dipakai saat persediaan voucher terbatas dan kiosk hanya untuk pemegang
   * kartu. Menyembunyikannya lebih baik daripada menampilkan lalu menolak —
   * tamu yang sudah mengetik nama dan merekam video lalu ditolak di akhir akan
   * jauh lebih kecewa daripada yang sejak awal tahu ini bukan untuknya.
   */
  hanyaMember: { pilihan: [0, 1], bawaan: 0, satuan: '', label: 'Khusus member saja' },
};

const bawaan = () =>
  Object.fromEntries(Object.entries(BATAS).map(([k, v]) => [k, v.bawaan]));

/** Paksa nilai ke dalam rentangnya; nilai tak masuk akal dikembalikan ke bawaan. */
function rapikan(masuk = {}) {
  const hasil = {};
  for (const [kunci, batas] of Object.entries(BATAS)) {
    const angka = Math.round(Number(masuk[kunci]));

    if (batas.pilihan) {
      // Nilai di luar daftar dikembalikan ke bawaan, bukan dibulatkan ke yang
      // terdekat: layar terputar 90 derajat ke arah yang salah lebih buruk
      // daripada layar yang tidak terputar sama sekali.
      hasil[kunci] = batas.pilihan.includes(angka) ? angka : batas.bawaan;
      continue;
    }

    hasil[kunci] = Number.isFinite(angka)
      ? Math.min(Math.max(angka, batas.min), batas.maks)
      : batas.bawaan;
  }
  return hasil;
}

export function bukaPengaturan(berkas) {
  mkdirSync(path.dirname(berkas), { recursive: true });

  let nilai;
  try {
    nilai = rapikan(JSON.parse(readFileSync(berkas, 'utf8')));
  } catch {
    // Berkas belum ada, atau isinya rusak. Keduanya sama-sama berarti "pakai
    // bawaan" — kiosk tidak boleh menolak menyala karena satu berkas setelan.
    nilai = bawaan();
  }

  return {
    baca: () => ({ ...nilai }),
    batas: () => BATAS,
    simpan(masuk) {
      nilai = rapikan({ ...nilai, ...masuk });
      writeFileSync(berkas, JSON.stringify(nilai, null, 2));
      return { ...nilai };
    },
  };
}
