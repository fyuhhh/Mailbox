/**
 * Penyimpanan lokal kiosk.
 *
 * Memakai node:sqlite bawaan Node 22+, bukan better-sqlite3. Alasannya
 * pemasangan di lokasi acara: better-sqlite3 butuh kompilasi native, dan PC
 * kiosk Windows umumnya tidak punya toolchain build. Modul bawaan menghapus
 * seluruh kelas kegagalan itu.
 *
 * Basis data ini adalah sumber kebenaran, bukan singgahan. Bila server
 * undangan atau internet mati sepanjang acara, seluruh data tamu tetap utuh
 * di sini dan bisa disinkronkan belakangan.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function bukaDb(berkas) {
  mkdirSync(path.dirname(berkas), { recursive: true });
  const db = new DatabaseSync(berkas);

  // WAL: penulisan tidak memblokir pembacaan, jadi permintaan status dari
  // layar kiosk tidak pernah tertahan di belakang antrian sinkronisasi.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS tamu (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      kode          TEXT    NOT NULL UNIQUE,
      nama          TEXT    NOT NULL,
      pesan         TEXT    NOT NULL DEFAULT '',
      dibuat_pada   TEXT    NOT NULL,
      tersinkron    INTEGER NOT NULL DEFAULT 0,
      percobaan     INTEGER NOT NULL DEFAULT 0,
      galat_sinkron TEXT,
      jumlah_cetak  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tamu_belum_sinkron
      ON tamu (tersinkron, id) WHERE tersinkron = 0;
  `);

  // Kolom yang ditambahkan setelah acara pertama disiapkan. CREATE TABLE di
  // atas tidak menyentuh tabel yang sudah ada, jadi basis data lama tidak akan
  // pernah mendapat kolom baru tanpa langkah ini — dan kiosk akan gagal dengan
  // galat "no such column" tepat saat dipakai.
  for (const [kolom, definisi] of [
    ['hadir_pada', 'TEXT'],
    ['jumlah_scan', 'INTEGER NOT NULL DEFAULT 0'],
    ['jenis', "TEXT NOT NULL DEFAULT 'undangan'"],
    ['member_id', 'TEXT'],
    ['video', 'TEXT'],
    ['video_terkirim', 'INTEGER NOT NULL DEFAULT 0'],
    // Rekaman apa adanya, tanpa bingkai. Disimpan terpisah supaya bahan
    // aslinya tetap ada bila bingkainya kelak perlu diganti atau dilepas.
    ['video_mentah', 'TEXT'],
  ]) {
    const ada = db.prepare(`SELECT 1 FROM pragma_table_info('tamu') WHERE name = ?`).get(kolom);
    if (!ada) db.exec(`ALTER TABLE tamu ADD COLUMN ${kolom} ${definisi}`);
  }

  const st = {
    adaKode: db.prepare('SELECT 1 FROM tamu WHERE kode = ?'),
    sisip: db.prepare(
      `INSERT INTO tamu (kode, nama, pesan, dibuat_pada, jenis, member_id, video)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    ambilKode: db.prepare('SELECT * FROM tamu WHERE kode = ?'),
    belumSinkron: db.prepare(
      'SELECT * FROM tamu WHERE tersinkron = 0 ORDER BY id LIMIT ?'
    ),
    tandaiSinkron: db.prepare('UPDATE tamu SET tersinkron = 1, galat_sinkron = NULL WHERE kode = ?'),
    catatGagal: db.prepare(
      'UPDATE tamu SET percobaan = percobaan + 1, galat_sinkron = ? WHERE kode = ?'
    ),
    tambahCetak: db.prepare('UPDATE tamu SET jumlah_cetak = jumlah_cetak + 1 WHERE kode = ?'),
    jumlahTotal: db.prepare('SELECT COUNT(*) AS n FROM tamu'),
    voucherMember: db.prepare(`
      SELECT id, kode, nama, dibuat_pada FROM tamu
      WHERE member_id = ? AND jenis = 'voucher'
      ORDER BY id LIMIT 1
    `),
    jumlahTertunda: db.prepare('SELECT COUNT(*) AS n FROM tamu WHERE tersinkron = 0'),
    terakhir: db.prepare('SELECT * FROM tamu ORDER BY id DESC LIMIT ?'),

    // Waktu kehadiran hanya ditulis pada pemindaian PERTAMA. Pemindaian
    // berikutnya tetap menambah penghitung tetapi tidak menggeser waktunya,
    // supaya jam kedatangan yang sebenarnya tidak hilang ketika kartu yang sama
    // dipindai ulang di pintu.
    tandaiHadir: db.prepare(`
      UPDATE tamu
         SET hadir_pada  = COALESCE(hadir_pada, ?),
             jumlah_scan = jumlah_scan + 1
       WHERE kode = ?
    `),
    jumlahHadir: db.prepare('SELECT COUNT(*) AS n FROM tamu WHERE hadir_pada IS NOT NULL'),

    // Video hanya diantre setelah data tamunya sendiri sampai di server.
    // Mengunggah video untuk tamu yang belum dikenal server hanya menghasilkan
    // berkas yatim yang tidak bisa ditautkan ke siapa pun.
    videoAntre: db.prepare(`
      SELECT * FROM tamu
       WHERE video IS NOT NULL AND video_terkirim = 0 AND tersinkron = 1
       ORDER BY id LIMIT ?
    `),
    videoTerkirim: db.prepare('UPDATE tamu SET video_terkirim = 1 WHERE kode = ?'),
    setVideoMentah: db.prepare('UPDATE tamu SET video_mentah = ? WHERE kode = ?'),
  };

  return {
    db,
    kodeDipakai: (kode) => Boolean(st.adaKode.get(kode)),
    simpanTamu({ kode, nama, pesan, dibuatPada, jenis = 'undangan', memberId = null, video = null, videoMentah = null }) {
      const hasil = st.sisip.run(kode, nama, pesan ?? '', dibuatPada, jenis, memberId, video);
      // Kolom mentah diperbarui terpisah: pernyataan sisip di atas dibentuk
      // sebelum kolom ini ada, dan menambah parameter di sana akan memutus
      // basis data lama yang tabelnya belum punya kolomnya.
      if (videoMentah) st.setVideoMentah.run(videoMentah, kode);
      return st.ambilKode.get(kode) ?? { id: hasil.lastInsertRowid, kode, nama, pesan };
    },
    ambilTamu: (kode) => st.ambilKode.get(kode),
    tamuBelumSinkron: (batas = 25) => st.belumSinkron.all(batas),
    tandaiSinkron: (kode) => st.tandaiSinkron.run(kode),
    catatGagalSinkron: (kode, pesan) => st.catatGagal.run(String(pesan).slice(0, 300), kode),
    tambahCetak: (kode) => st.tambahCetak.run(kode),
    ringkasan: () => ({
      total: st.jumlahTotal.get().n,
      tertunda: st.jumlahTertunda.get().n,
    }),
    tamuTerakhir: (batas = 20) => st.terakhir.all(batas),

    /**
     * Catat kehadiran. Mengembalikan tamunya beserta penanda apakah ini
     * pemindaian pertama — petugas di pintu perlu tahu bedanya antara tamu baru
     * datang dan kartu yang sudah dipakai sebelumnya.
     */
    catatHadir(kode) {
      const sebelum = st.ambilKode.get(kode);
      if (!sebelum) return null;

      st.tandaiHadir.run(new Date().toISOString(), kode);
      return { tamu: st.ambilKode.get(kode), pertamaKali: !sebelum.hadir_pada };
    },

    jumlahHadir: () => st.jumlahHadir.get().n,

    videoBelumTerkirim: (batas = 5) => st.videoAntre.all(batas),
    tandaiVideoTerkirim: (kode) => st.videoTerkirim.run(kode),

    /**
     * Voucher yang pernah keluar untuk satu nomor keanggotaan, kalau ada.
     *
     * Satu member satu gift voucher. Pemeriksaannya dilakukan di sini, di data
     * tamu, bukan di persediaan promo: kode promo dikaitkan ke kode tamu yang
     * selalu baru setiap kali orang memindai, sehingga member yang memindai dua
     * kali akan lolos di sana dan membawa pulang dua kode.
     */
    voucherMember: (memberId) => (memberId ? st.voucherMember.get(memberId) ?? null : null),

    /**
     * Kosongkan daftar tamu dan mulai penomoran dari 001 lagi.
     *
     * sqlite_sequence ikut dihapus — tanpa itu AUTOINCREMENT meneruskan angka
     * terakhir, jadi tamu pertama sesudah reset akan bernomor 043 dan seluruh
     * gunanya hilang.
     *
     * Berkas rekaman TIDAK ikut dihapus. Video adalah satu-satunya bagian yang
     * tidak bisa dibuat ulang kalau salah tekan, dan menghapusnya diam-diam
     * bersama tabel bukan sesuatu yang bisa ditarik kembali.
     */
    kosongkanTamu() {
      const sebelum = st.jumlahTotal.get().n;
      db.exec("DELETE FROM tamu; DELETE FROM sqlite_sequence WHERE name = 'tamu';");
      return { dihapus: sebelum, total: st.jumlahTotal.get().n };
    },

    tutup: () => db.close(),
  };
}
