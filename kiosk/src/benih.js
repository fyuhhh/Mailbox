/**
 * Penanaman data awal ke PC baru — sekali saja, tidak pernah menimpa.
 *
 * Folder `benih/` ikut disalin bersama kiosk. Isinya data yang harus sudah ada
 * sebelum acara dimulai: daftar member dan persediaan kode voucher. Saat kiosk
 * dijalankan pertama kali di sebuah PC, isi folder itu dipindahkan ke `data/`.
 *
 * Sesudah itu tidak pernah lagi. Ini bagian yang paling penting: `data/` adalah
 * satu-satunya tempat tamu yang sudah mendaftar, kode yang sudah keluar, dan
 * rekaman yang sudah diambil tersimpan. Menyalin ulang benih setiap kali kiosk
 * dinyalakan akan mengembalikan kode yang sudah diberikan menjadi "belum
 * keluar", dan dua orang akan membawa pulang kode yang sama.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PENANDA = '.benih-terpasang';

export function tanamBenih(folderBenih, folderData) {
  mkdirSync(folderData, { recursive: true });

  const penanda = path.join(folderData, PENANDA);

  /*
   * Penanda diperiksa lebih dulu, bukan keberadaan tiap berkas.
   *
   * Kalau yang diperiksa keberadaan berkasnya, petugas yang sengaja menghapus
   * promo.db untuk memulai dari nol akan mendapatkannya terisi ulang diam-diam
   * pada penyalaan berikutnya — dan mengira kiosk mengabaikan perintahnya.
   */
  if (existsSync(penanda)) return { ditanam: 0, alasan: 'sudah pernah ditanam' };
  if (!existsSync(folderBenih)) return { ditanam: 0, alasan: 'tidak ada folder benih' };

  /*
   * Berkas kerja SQLite tidak ikut berpindah mesin.
   *
   * -wal dan -shm adalah keadaan sementara milik satu proses di satu komputer.
   * -shm bawaan dari PC lain membuat SQLite membaca keadaan kunci yang tidak
   * ada hubungannya dengan mesin ini, dan gejalanya bukan galat melainkan basis
   * data yang terlihat kosong.
   */
  const daftar = readdirSync(folderBenih)
    .filter((n) => !n.startsWith('.'))
    .filter((n) => !/-(wal|shm|journal)$/.test(n))
    /*
     * Hanya basis data dan keadaan tersimpan yang ditanam.
     *
     * kode-voucher.txt adalah berkas MASUKAN — dibaca di tempatnya lalu
     * diimpor ke promo.db. Menyalinnya ke data/ meninggalkan satu tiruan yang
     * tidak pernah dibaca siapa pun, dan petugas yang menyuntingnya di sana
     * akan bingung kenapa perubahannya tidak berpengaruh.
     */
    .filter((n) => /\.(db|json)$/.test(n));
  let ditanam = 0;
  const nama = [];

  for (const berkas of daftar) {
    const sumber = path.join(folderBenih, berkas);
    if (!statSync(sumber).isFile()) continue;

    const tujuan = path.join(folderData, berkas);

    /*
     * Berkas yang sudah ada tetap tidak disentuh, meski penandanya belum ada.
     *
     * Keadaan ini muncul pada kiosk yang sudah dipakai sebelum benih
     * diperkenalkan: data-nya asli dan sedang dipakai, hanya penandanya yang
     * belum pernah ditulis. Menimpanya akan menghapus acara yang sedang
     * berjalan.
     */
    if (existsSync(tujuan)) continue;

    copyFileSync(sumber, tujuan);
    ditanam += 1;
    nama.push(berkas);
  }

  writeFileSync(penanda, `ditanam pada ${new Date().toISOString()}\n${nama.join('\n')}\n`);
  return { ditanam, nama };
}
