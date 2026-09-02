/**
 * Penjelajah basis data bawaan.
 *
 * Menggantikan peran phpMyAdmin untuk kiosk ini. phpMyAdmin sendiri tidak bisa
 * dipakai di sini: ia pengelola MySQL, sedangkan seluruh data kiosk disimpan
 * dalam berkas SQLite — dipilih justru supaya folder kiosk bisa disalin ke PC
 * lain lalu jalan tanpa memasang basis data, PHP, atau server web apa pun.
 *
 * Seluruh sambungan di berkas ini dibuka HANYA-BACA. Halaman pengelola tidak
 * pernah boleh menjadi jalan untuk mengubah data tamu di tengah acara; yang
 * boleh mengubah hanya alur kiosk sendiri dan tombol-tombol yang sudah ada
 * beserta konfirmasinya.
 */

import { DatabaseSync } from 'node:sqlite';
import { statSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Nama tabel tidak bisa dititipkan sebagai parameter, jadi harus dicocokkan. */
function tabelSah(db, nama) {
  const ada = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(nama);
  return Boolean(ada);
}

function bukaBaca(berkas) {
  if (!existsSync(berkas)) return null;
  return new DatabaseSync(berkas, { readOnly: true });
}

export function bukaBasis(folderData) {
  /*
   * Daftar tetap, bukan pindaian folder.
   *
   * Membiarkan nama berkas datang dari permintaan berarti mengizinkan siapa pun
   * yang lolos sandi membuka berkas SQLite mana pun di komputer itu, termasuk
   * yang bukan milik kiosk.
   */
  const PETA = {
    kiosk:  { berkas: path.join(folderData, 'kiosk.db'),  judul: 'Tamu & Undangan' },
    promo:  { berkas: path.join(folderData, 'promo.db'),  judul: 'Kode Gift Voucher' },
    member: { berkas: path.join(folderData, 'member.db'), judul: 'Member PAM-PLUS' },
  };

  /** Ringkasan semua basis: berapa tabel, berapa baris, berapa besar berkasnya. */
  function ringkas() {
    return Object.entries(PETA).map(([kunci, info]) => {
      const db = bukaBaca(info.berkas);
      if (!db) return { kunci, judul: info.judul, ada: false, tabel: [] };

      try {
        const tabel = db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
          .all()
          .map((t) => ({
            nama: t.name,
            baris: db.prepare(`SELECT COUNT(*) AS n FROM "${t.name}"`).get().n,
          }));

        return {
          kunci,
          judul: info.judul,
          ada: true,
          ukuran: statSync(info.berkas).size,
          tabel,
        };
      } finally {
        db.close();
      }
    });
  }

  /**
   * Sepotong isi tabel, sudah dihalaman.
   *
   * Tabel member berisi enam belas ribu baris; mengirim semuanya sekaligus akan
   * membekukan peramban di layar sentuh kiosk selama beberapa detik.
   */
  function baris({ basis, tabel, hal = 1, batas = 50, cari = '' }) {
    const info = PETA[basis];
    if (!info) throw new Error('Basis data tidak dikenal.');

    const db = bukaBaca(info.berkas);
    if (!db) throw new Error('Berkas basis data belum ada.');

    try {
      if (!tabelSah(db, tabel)) throw new Error('Tabel tidak dikenal.');

      const kolom = db.prepare(`SELECT name, type FROM pragma_table_info('${tabel}')`).all();

      /*
       * Pencarian menyapu seluruh kolom sekaligus.
       *
       * Petugas di acara mencari "nomor HP ini punya siapa" atau "kode ini sudah
       * keluar ke siapa" tanpa tahu — dan tanpa perlu tahu — kolom mana yang
       * menyimpannya.
       */
      const kunciCari = String(cari || '').trim();
      const syarat = kunciCari
        ? 'WHERE ' + kolom.map((k) => `CAST("${k.name}" AS TEXT) LIKE ?`).join(' OR ')
        : '';
      const nilaiCari = kunciCari ? kolom.map(() => `%${kunciCari}%`) : [];

      const total = db.prepare(`SELECT COUNT(*) AS n FROM "${tabel}" ${syarat}`).get(...nilaiCari).n;

      const perHal = Math.min(Math.max(Number(batas) || 50, 1), 200);
      const halTotal = Math.max(1, Math.ceil(total / perHal));
      const halIni = Math.min(Math.max(Number(hal) || 1, 1), halTotal);

      // rowid dipakai sebagai urutan bawaan supaya baris terbaru berada di atas
      // tanpa perlu tahu tabel ini punya kolom waktu atau tidak.
      const isi = db
        .prepare(`SELECT * FROM "${tabel}" ${syarat} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
        .all(...nilaiCari, perHal, (halIni - 1) * perHal);

      return { kolom: kolom.map((k) => k.name), baris: isi, total, hal: halIni, halTotal, perHal };
    } finally {
      db.close();
    }
  }

  /** Seluruh isi satu tabel sebagai CSV, untuk ditarik keluar dan diolah. */
  function csv({ basis, tabel }) {
    const info = PETA[basis];
    if (!info) throw new Error('Basis data tidak dikenal.');

    const db = bukaBaca(info.berkas);
    if (!db) throw new Error('Berkas basis data belum ada.');

    try {
      if (!tabelSah(db, tabel)) throw new Error('Tabel tidak dikenal.');

      const kolom = db.prepare(`SELECT name FROM pragma_table_info('${tabel}')`).all().map((k) => k.name);
      const isi = db.prepare(`SELECT * FROM "${tabel}" ORDER BY rowid`).all();

      /*
       * Nilai dibungkus tanda kutip dan tanda kutip di dalamnya digandakan.
       *
       * Nama tamu boleh mengandung koma, dan tanpa pembungkus itu satu nama
       * akan terbaca sebagai dua kolom saat berkasnya dibuka di Excel.
       */
      const sel = (v) => {
        if (v === null || v === undefined) return '';
        return `"${String(v).replace(/"/g, '""')}"`;
      };

      const baris = [kolom.map(sel).join(',')];
      for (const r of isi) baris.push(kolom.map((k) => sel(r[k])).join(','));

      /*
       * BOM di depan berkas.
       *
       * Excel di Windows membaca CSV tanpa BOM sebagai ANSI, sehingga nama
       * beraksen dan huruf non-latin berubah jadi sampah begitu dibuka.
       */
      return '﻿' + baris.join('\r\n') + '\r\n';
    } finally {
      db.close();
    }
  }

  return { ringkas, baris, csv, peta: PETA };
}
