/**
 * Penyimpanan tamu di server undangan.
 *
 * Kiosk adalah sumber kebenaran; berkas ini hanya salinan yang dibutuhkan agar
 * halaman undangan bisa menyapa tamu dengan namanya. Karena itu penyisipannya
 * idempoten: kiosk yang mengirim ulang setelah jaringan putus di tengah jalan
 * tidak boleh menghasilkan galat atau baris ganda.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function bukaDb(berkas) {
  mkdirSync(path.dirname(berkas), { recursive: true });
  const db = new DatabaseSync(berkas);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS tamu (
      kode         TEXT PRIMARY KEY,
      nama         TEXT NOT NULL,
      pesan        TEXT NOT NULL DEFAULT '',
      dibuat_pada  TEXT NOT NULL,
      diterima_pada TEXT NOT NULL,
      dibuka       INTEGER NOT NULL DEFAULT 0,
      dibuka_pada  TEXT
    );
  `);

  for (const [kolom, definisi] of [
    ['jenis', "TEXT NOT NULL DEFAULT 'undangan'"],
    ['ada_video', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    const ada = db.prepare(`SELECT 1 FROM pragma_table_info('tamu') WHERE name = ?`).get(kolom);
    if (!ada) db.exec(`ALTER TABLE tamu ADD COLUMN ${kolom} ${definisi}`);
  }

  const st = {
    simpan: db.prepare(`
      INSERT INTO tamu (kode, nama, pesan, dibuat_pada, diterima_pada, jenis)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(kode) DO UPDATE SET
        nama  = excluded.nama,
        pesan = excluded.pesan,
        jenis = excluded.jenis
    `),
    tandaiVideo: db.prepare('UPDATE tamu SET ada_video = 1 WHERE kode = ?'),
    ambil: db.prepare('SELECT * FROM tamu WHERE kode = ?'),
    tandaiDibuka: db.prepare(
      `UPDATE tamu SET dibuka = dibuka + 1, dibuka_pada = ? WHERE kode = ?`
    ),
    statistik: db.prepare(`
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN dibuka > 0 THEN 1 ELSE 0 END) AS sudah_dibuka
      FROM tamu
    `),
  };

  return {
    simpanTamu: (t) =>
      st.simpan.run(
        t.kode, t.nama, t.pesan ?? '', t.dibuat_pada,
        new Date().toISOString(), t.jenis ?? 'undangan'
      ),
    tandaiVideo: (kode) => st.tandaiVideo.run(kode),
    ambilTamu: (kode) => st.ambil.get(kode),
    tandaiDibuka: (kode) => st.tandaiDibuka.run(new Date().toISOString(), kode),
    statistik: () => st.statistik.get(),
  };
}
