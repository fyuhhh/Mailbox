/**
 * Persediaan kode promo untuk voucher member PAM-PLUS.
 *
 * Setiap kode dipakai TEPAT SEKALI. Itu syarat yang tidak bisa ditawar: kode
 * yang tercetak dua kali berarti dua tamu memegang voucher yang sama, dan yang
 * kedua ditolak di kasir tanpa ada yang bisa menjelaskan kenapa.
 *
 * Karena itu pengambilan kode dilakukan dalam satu transaksi yang menandai
 * pemakaiannya sekaligus — bukan "cari yang kosong" lalu "tandai" sebagai dua
 * langkah terpisah, yang bisa disela permintaan lain di antaranya.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

/**
 * Baca kolom kode dari berkas .xlsx, .csv, atau .txt.
 *
 * xlsx dibongkar sendiri tanpa pustaka: berkasnya hanya zip berisi XML, dan
 * menambah dependensi untuk membaca satu kolom teks tidak sepadan dengan
 * ongkos pemeliharaannya.
 */
export function bacaBerkasKode(berkas) {
  const akhiran = path.extname(berkas).toLowerCase();

  if (akhiran === '.csv' || akhiran === '.txt') {
    return readFileSync(berkas, 'utf8')
      .split(/\r?\n/)
      .map((b) => b.split(/[,;\t]/)[0].trim().replace(/^"|"$/g, ''));
  }

  if (akhiran !== '.xlsx') throw new Error(`Format ${akhiran} tidak didukung`);

  const sementara = path.join(os.tmpdir(), `promo-${Date.now()}`);
  mkdirSync(sementara, { recursive: true });
  execFileSync('unzip', ['-q', '-o', berkas, '-d', sementara]);

  let teks = [];
  try {
    const ss = readFileSync(path.join(sementara, 'xl/sharedStrings.xml'), 'utf8');
    teks = [...ss.matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
        .map((t) => t[1])
        .join('')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    );
  } catch {
    // Berkas tanpa sharedStrings memakai nilai inline; ditangani di bawah.
  }

  const sheet = readFileSync(path.join(sementara, 'xl/worksheets/sheet1.xml'), 'utf8');
  const hasil = [];
  for (const [, isi] of sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    // Hanya kolom pertama; berkas persediaan kode selalu satu kolom.
    const sel = isi.match(
      /<c r="A\d+"(?:[^>]*t="([^"]+)")?[^>]*>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)?<\/c>/s
    );
    if (!sel) continue;
    const [, tipe, v, inline] = sel;
    hasil.push(tipe === 's' && v !== undefined ? (teks[Number(v)] ?? '') : (inline ?? v ?? ''));
  }
  return hasil;
}

/** Kode sah: 4-64 karakter, huruf/angka/strip. Baris judul otomatis tersaring. */
function sahkan(mentah) {
  const k = String(mentah ?? '').trim();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(k)) return null;
  if (/^(code|kode|promo|voucher|no|nomor)$/i.test(k)) return null;
  return k;
}

export function bukaPromo(berkas) {
  mkdirSync(path.dirname(berkas), { recursive: true });
  const db = new DatabaseSync(berkas);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS promo (
      kode        TEXT PRIMARY KEY,
      dipakai     INTEGER NOT NULL DEFAULT 0,
      dipakai_oleh TEXT,
      dipakai_pada TEXT,
      urut        INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_promo_kosong ON promo (urut) WHERE dipakai = 0;
  `);

  const st = {
    sisip: db.prepare('INSERT OR IGNORE INTO promo (kode, urut) VALUES (?, ?)'),
    berikutnya: db.prepare('SELECT kode FROM promo WHERE dipakai = 0 ORDER BY urut LIMIT 1'),
    pakai: db.prepare(
      'UPDATE promo SET dipakai = 1, dipakai_oleh = ?, dipakai_pada = ? WHERE kode = ? AND dipakai = 0'
    ),
    sisa: db.prepare('SELECT COUNT(*) AS n FROM promo WHERE dipakai = 0'),
    total: db.prepare('SELECT COUNT(*) AS n FROM promo'),
    milik: db.prepare('SELECT kode FROM promo WHERE dipakai_oleh = ?'),
    daftar: db.prepare(`
      SELECT kode, dipakai, dipakai_oleh, dipakai_pada FROM promo
       ORDER BY dipakai, urut LIMIT ?
    `),
    maksUrut: db.prepare('SELECT COALESCE(MAX(urut), 0) AS n FROM promo'),
  };

  return {
    impor(daftar) {
      const baris = Array.isArray(daftar) ? daftar : [daftar];
      let urut = st.maksUrut.get().n;
      let masuk = 0;
      let ditolak = 0;

      db.exec('BEGIN');
      try {
        for (const mentah of baris) {
          const kode = sahkan(mentah);
          if (!kode) { ditolak++; continue; }
          const hasil = st.sisip.run(kode, ++urut);
          if (hasil.changes) masuk++; else ditolak++;   // duplikat diabaikan
        }
        db.exec('COMMIT');
      } catch (galat) {
        db.exec('ROLLBACK');
        throw galat;
      }
      return { masuk, ditolak, total: st.total.get().n, sisa: st.sisa.get().n };
    },

    /**
     * Ambil satu kode untuk seorang tamu, sekaligus menandainya terpakai.
     *
     * Tamu yang sama yang meminta dua kali mendapat kode yang sama, bukan dua
     * kode — mencetak ulang struk tidak boleh menghabiskan persediaan.
     */
    ambilUntuk(kodeTamu) {
      const sudah = st.milik.get(kodeTamu);
      if (sudah) return sudah.kode;

      db.exec('BEGIN IMMEDIATE');
      try {
        const calon = st.berikutnya.get();
        if (!calon) { db.exec('ROLLBACK'); return null; }
        const hasil = st.pakai.run(kodeTamu, new Date().toISOString(), calon.kode);
        db.exec('COMMIT');
        return hasil.changes ? calon.kode : null;
      } catch (galat) {
        db.exec('ROLLBACK');
        throw galat;
      }
    },

    /**
     * Kembalikan seluruh kode ke keadaan belum terpakai.
     *
     * Dipakai saat mengulang persiapan atau setelah uji coba. Kode-nya sendiri
     * tidak dihapus — yang dilepas hanya catatan pemakaiannya, sehingga
     * persediaan yang sudah dimuat tidak perlu diimpor ulang.
     */
    reset() {
      const sebelum = st.total.get().n - st.sisa.get().n;
      db.exec("UPDATE promo SET dipakai = 0, dipakai_oleh = NULL, dipakai_pada = NULL");
      return { dilepas: sebelum, total: st.total.get().n, sisa: st.sisa.get().n };
    },

    /** Buang seluruh persediaan, untuk diganti berkas baru. */
    kosongkan() {
      db.exec('DELETE FROM promo');
      return { total: 0, sisa: 0 };
    },

    sisa: () => st.sisa.get().n,
    total: () => st.total.get().n,
    ringkas: () => ({ total: st.total.get().n, sisa: st.sisa.get().n }),
    daftar: (batas = 200) => st.daftar.all(batas),
    tutup: () => db.close(),
  };
}
