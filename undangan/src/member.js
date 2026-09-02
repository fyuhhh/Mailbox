/**
 * Basis data member PAM-PLUS.
 *
 * Salinan modul yang sama dipakai di kiosk. Dua tempat karena keduanya adalah
 * pemasangan terpisah — VPS menerima kiriman dari pihak ketiga, kiosk menyimpan
 * salinannya agar pemindaian kartu tetap bekerja tanpa jaringan. Aturan
 * pembacaan JSON-nya harus persis sama di kedua sisi; kalau berubah, ubah
 * keduanya.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Samakan bentuk nomor telepon Indonesia.
 *
 * Data keanggotaan hampir selalu bercampur bentuk: 0812…, +62812…, 62812…,
 * dan sebagian memakai spasi atau tanda hubung. Tanpa disamakan, satu orang
 * yang sama tercatat sebagai beberapa nomor berbeda, dan pencarian lewat nomor
 * meleset justru pada tamu yang datanya paling rapi.
 */
export function rapikanNomor(mentah) {
  const angka = String(mentah ?? '').replace(/[^\d+]/g, '');
  if (!angka) return '';

  if (angka.startsWith('+62')) return '0' + angka.slice(3);
  if (angka.startsWith('62')) return '0' + angka.slice(2);
  if (angka.startsWith('0')) return angka;
  // Nomor tanpa awalan apa pun, misal 812… — dilengkapi menjadi 0812…
  return '0' + angka;
}

/** ID kartu disamakan huruf besar dan tanpa spasi, supaya cocok apa pun cara ketiknya. */
export function rapikanId(mentah) {
  return String(mentah ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Ambil satu member dari bentuk JSON apa pun yang lazim dipakai.
 *
 * Nama kolom di ekspor keanggotaan tidak pernah seragam — id_pam, idPam, id,
 * kode, member_id semuanya dipakai di tempat berbeda. Menerima semuanya jauh
 * lebih murah daripada meminta orang menyunting ribuan baris JSON agar cocok
 * dengan satu bentuk yang kebetulan kupilih.
 */
export function bacaBaris(baris) {
  if (!baris || typeof baris !== 'object') return null;

  const ambil = (...kunci) => {
    for (const k of kunci) {
      const nilai = baris[k];
      if (nilai !== undefined && nilai !== null && String(nilai).trim() !== '') {
        return String(nilai).trim();
      }
    }
    return '';
  };

  const idPam = rapikanId(ambil('id_pam', 'idPam', 'idpam', 'id', 'kode', 'member_id', 'memberId', 'member'));
  const nama = ambil('nama', 'name', 'nama_lengkap', 'namaLengkap', 'full_name');
  const nomorHp = rapikanNomor(ambil('nomor_hp', 'nomorHp', 'no_hp', 'noHp', 'hp', 'telepon', 'telp', 'phone', 'wa', 'whatsapp'));

  if (!idPam || nama.length < 2) return null;
  return { idPam, nama: nama.slice(0, 60), nomorHp: nomorHp.slice(0, 20) };
}

export function bukaMember(berkas) {
  mkdirSync(path.dirname(berkas), { recursive: true });
  const db = new DatabaseSync(berkas);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS member (
      id_pam        TEXT PRIMARY KEY,
      nama          TEXT NOT NULL,
      nomor_hp      TEXT NOT NULL DEFAULT '',
      diperbarui    TEXT NOT NULL
    );

    -- Pencarian lewat nomor HP dipakai saat kartu tamu hilang atau tidak
    -- terbaca; tanpa indeks ini, petugas menunggu pemindaian seluruh tabel
    -- tepat ketika antrean sedang tertahan.
    CREATE INDEX IF NOT EXISTS idx_member_hp ON member (nomor_hp) WHERE nomor_hp <> '';
  `);

  const st = {
    simpan: db.prepare(`
      INSERT INTO member (id_pam, nama, nomor_hp, diperbarui)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id_pam) DO UPDATE SET
        nama       = excluded.nama,
        nomor_hp   = excluded.nomor_hp,
        diperbarui = excluded.diperbarui
    `),
    ambil: db.prepare('SELECT * FROM member WHERE id_pam = ?'),
    ambilHp: db.prepare('SELECT * FROM member WHERE nomor_hp = ? LIMIT 1'),
    jumlah: db.prepare('SELECT COUNT(*) AS n FROM member'),
    contoh: db.prepare('SELECT * FROM member ORDER BY diperbarui DESC LIMIT ?'),
    semua: db.prepare('SELECT id_pam, nama, nomor_hp FROM member ORDER BY id_pam'),
    kosongkan: db.prepare('DELETE FROM member'),
  };

  return {
    /** Masukkan sekumpulan baris JSON. Mengembalikan ringkasan, bukan melempar. */
    impor(daftar, { ganti = false } = {}) {
      const baris = Array.isArray(daftar) ? daftar : [daftar];
      const waktu = new Date().toISOString();
      let masuk = 0;
      const ditolak = [];

      // Satu transaksi untuk seluruh berkas: mengimpor sepuluh ribu baris satu
      // per satu berarti sepuluh ribu penulisan disk, dan kiosk membeku selama
      // itu berlangsung.
      db.exec('BEGIN');
      try {
        if (ganti) st.kosongkan.run();
        for (const [i, mentah] of baris.entries()) {
          const m = bacaBaris(mentah);
          if (!m) {
            if (ditolak.length < 10) ditolak.push({ baris: i + 1, isi: ringkas(mentah) });
            continue;
          }
          st.simpan.run(m.idPam, m.nama, m.nomorHp, waktu);
          masuk++;
        }
        db.exec('COMMIT');
      } catch (galat) {
        db.exec('ROLLBACK');
        throw galat;
      }

      return { masuk, ditolak: baris.length - masuk, contohDitolak: ditolak, total: st.jumlah.get().n };
    },

    cari(idPam) {
      return st.ambil.get(rapikanId(idPam)) ?? null;
    },

    cariNomor(nomor) {
      const rapi = rapikanNomor(nomor);
      return rapi ? (st.ambilHp.get(rapi) ?? null) : null;
    },

    /** Seluruh isi tabel, untuk ditarik kiosk. */
    semua: () => st.semua.all(),

    jumlah: () => st.jumlah.get().n,
    contoh: (n = 5) => st.contoh.all(n),
    tutup: () => db.close(),
  };
}

function ringkas(nilai) {
  const teks = typeof nilai === 'object' ? JSON.stringify(nilai) : String(nilai);
  return teks.length > 80 ? teks.slice(0, 77) + '…' : teks;
}
