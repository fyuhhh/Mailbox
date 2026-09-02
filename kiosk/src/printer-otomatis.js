/**
 * Pengarah printer otomatis.
 *
 * Tugasnya satu: memastikan objek Printer selalu menunjuk ke printer yang
 * benar-benar menjawab, tanpa siapa pun perlu mengetik alamat.
 *
 * Urutan yang dicoba disusun dari yang paling mungkin benar ke yang paling
 * umum, dan setiap langkah HARUS dibuktikan menjawab sebelum dipakai. Alamat
 * yang tertulis di berkas bukan bukti bahwa printernya ada di sana — itu justru
 * kesalahan yang paling sering terjadi saat kiosk dipindahkan antar-jaringan.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { cariPrinter, printerSistem } from './temu-printer.js';

/** Apakah host ini menjawab di porta cetak? */
function menjawab(host, port, tunggu = 1200) {
  return new Promise((selesai) => {
    const soket = new net.Socket();
    let sudah = false;
    const tutup = (hasil) => {
      if (sudah) return;
      sudah = true;
      soket.destroy();
      selesai(hasil);
    };
    soket.setTimeout(tunggu);
    soket.once('connect', () => tutup(true));
    soket.once('timeout', () => tutup(false));
    soket.once('error', () => tutup(false));
    soket.connect(port, host);
  });
}

export function bukaPrinterOtomatis({ printer, berkas, hostAwal, portAwal = 9100, namaAwal }) {
  mkdirSync(path.dirname(berkas), { recursive: true });

  /** Pilihan yang pernah berhasil di mesin ini. */
  function bacaIngatan() {
    try {
      return JSON.parse(readFileSync(berkas, 'utf8'));
    } catch {
      return {};
    }
  }

  function simpanIngatan(isi) {
    try {
      writeFileSync(berkas, JSON.stringify(isi, null, 2));
    } catch {
      /* Berkas tidak bisa ditulis; pilihan tetap berlaku sampai kiosk dimatikan. */
    }
  }

  const keadaan = {
    sedangCari: false,
    terakhirCari: null,
    ditemukan: [],
    sumberPilihan: null,   // 'ingatan' | 'setelan' | 'temuan' | 'sistem' | null
    dilewati: [],
  };

  /**
   * Pastikan printer menunjuk ke sesuatu yang menjawab.
   *
   * `paksaSapu` memaksa penyapuan meski alamat sekarang masih menjawab —
   * dipakai oleh tombol "cari printer" di halaman petugas.
   */
  async function pastikan({ paksaSapu = false } = {}) {
    if (keadaan.sedangCari) return { berubah: false, alasan: 'sedang mencari' };
    keadaan.sedangCari = true;

    try {
      const ingatan = bacaIngatan();

      /*
       * Alamat yang sedang dipakai diperiksa lebih dulu.
       *
       * Kalau printer masih menjawab di tempatnya, tidak ada alasan menyapu
       * seluruh jaringan — dan tidak ada alasan mengubah apa pun.
       */
      if (!paksaSapu && printer.host && (await menjawab(printer.host, printer.port))) {
        return { berubah: false, alasan: 'printer sekarang masih menjawab' };
      }

      // 1. Yang terakhir berhasil di mesin ini.
      if (!paksaSapu && ingatan.host && (await menjawab(ingatan.host, ingatan.port || 9100))) {
        const berubah = printer.arahkanKe({ host: ingatan.host, port: ingatan.port || 9100 });
        keadaan.sumberPilihan = 'ingatan';
        return { berubah, alasan: `memakai printer yang diingat (${ingatan.host})` };
      }

      // 2. Yang tertulis di setelan.
      if (!paksaSapu && hostAwal && (await menjawab(hostAwal, portAwal))) {
        const berubah = printer.arahkanKe({ host: hostAwal, port: portAwal });
        keadaan.sumberPilihan = 'setelan';
        simpanIngatan({ host: hostAwal, port: portAwal, sumber: 'setelan' });
        return { berubah, alasan: `memakai alamat dari setelan (${hostAwal})` };
      }

      // 3. Sapu jaringan.
      const hasil = await cariPrinter({ dahulukan: [ingatan.host, hostAwal].filter(Boolean) });
      keadaan.terakhirCari = hasil.diperiksaJumlah;
      keadaan.ditemukan = hasil.printer;
      keadaan.dilewati = hasil.dilewati;

      /*
       * Hanya yang menjawab ESC/POS yang diambil sendiri.
       *
       * Perangkat lain bisa saja mendengarkan porta 9100. Mengirim ESC/POS ke
       * sana tidak mencetak apa pun dan bisa membingungkan perangkat itu, jadi
       * yang meragukan tetap ditampilkan untuk dipilih manusia — tidak dipakai
       * diam-diam.
       */
      const yakin = hasil.printer.filter((p) => p.menjawabEscPos);

      if (yakin.length === 1) {
        const p = yakin[0];
        const berubah = printer.arahkanKe({ host: p.host, port: p.port });
        keadaan.sumberPilihan = 'temuan';
        simpanIngatan({ host: p.host, port: p.port, sumber: 'temuan-otomatis' });
        return { berubah, alasan: `printer ditemukan sendiri di ${p.host}` };
      }

      if (yakin.length > 1) {
        return {
          berubah: false,
          alasan: `${yakin.length} printer ditemukan — petugas harus memilih`,
          perluPilih: true,
        };
      }

      // 4. Printer yang terpasang di sistem (USB).
      const sistem = await printerSistem();
      if (sistem.length === 1 && !printer.host) {
        const berubah = printer.arahkanKe({ host: null, nama: sistem[0].nama });
        keadaan.sumberPilihan = 'sistem';
        simpanIngatan({ host: null, nama: sistem[0].nama, sumber: 'sistem' });
        return { berubah, alasan: `memakai printer sistem "${sistem[0].nama}"` };
      }

      return {
        berubah: false,
        alasan: hasil.printer.length
          ? 'ada perangkat di porta 9100 tetapi tidak ada yang menjawab sebagai printer'
          : 'tidak ada printer ditemukan di jaringan ini',
        perluPilih: hasil.printer.length > 0,
      };
    } finally {
      keadaan.sedangCari = false;
    }
  }

  /** Pilihan manusia. Menimpa apa pun, dan diingat. */
  function pilih({ host, port = 9100, nama = null }) {
    const berubah = printer.arahkanKe({ host: host || null, port, nama });
    keadaan.sumberPilihan = 'manual';
    simpanIngatan({ host: host || null, port, nama, sumber: 'manual' });
    return berubah;
  }

  function ringkas() {
    return {
      dipakai: printer.host
        ? { host: printer.host, port: printer.port, jenis: 'jaringan' }
        : { nama: printer.nama, jenis: 'sistem' },
      sumberPilihan: keadaan.sumberPilihan,
      sedangCari: keadaan.sedangCari,
      ditemukan: keadaan.ditemukan,
      dilewati: keadaan.dilewati,
    };
  }

  return { pastikan, pilih, ringkas, cari: cariPrinter, printerSistem, keadaan };
}
