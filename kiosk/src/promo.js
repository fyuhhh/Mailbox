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
    // Sama seperti xlsx: seluruh kolom dibaca, dan judul kolom di baris pertama
    // dikenali dari ketiadaan angka.
    const baris = readFileSync(berkas, 'utf8').split(/\r?\n/);
    const hasil = [];
    baris.forEach((b, i) => {
      /*
       * Baris komentar dibuang UTUH, sebelum dipotong per kolom.
       *
       * Berkas benih menuliskan aturan ini di kepalanya sendiri, tetapi
       * penguraiannya tidak pernah menjalankannya: baris komentar hanya gagal
       * secara kebetulan karena mengandung spasi. Begitu sebuah kalimat
       * mengandung koma, potongan sesudahnya bisa berupa satu kata tanpa spasi
       * — dan satu kata seperti "pakai" lolos sebagai kode voucher, lalu
       * tercetak di struk tamu yang kasir tidak akan mengenalinya.
       */
      if (b.trim().startsWith('#')) return;

      for (const bagian of b.split(/[,;\t]/)) {
        const nilai = bagian.trim().replace(/^"|"$/g, '');
        if (!nilai) continue;
        if (i === 0 && !/\d/.test(nilai)) continue;
        hasil.push(nilai);
      }
    });
    return hasil;
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
  let barisKe = 0;

  for (const [, isi] of sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
    barisKe += 1;

    /*
     * SELURUH kolom dibaca, bukan hanya kolom A.
     *
     * Berkas persediaan sempat selalu satu kolom, dan penguraiannya dibuat
     * menuruti itu. Berkas berikutnya datang dengan tiga kolom — satu jenis
     * voucher per kolom — dan dua pertiga isinya hilang tanpa suara: yang
     * terbaca hanya kolom pertama, dan tidak ada apa pun yang memberi tahu
     * bahwa sisanya diabaikan.
     */
    for (const sel of isi.matchAll(
      /<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]+)")?[^>]*>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)?<\/c>/gs
    )) {
      const [, , tipe, v, inline] = sel;
      const nilai = String(
        tipe === 's' && v !== undefined ? (teks[Number(v)] ?? '') : (inline ?? v ?? '')
      ).trim();
      if (!nilai) continue;

      /*
       * Baris pertama yang tidak mengandung angka diperlakukan sebagai judul
       * kolom, bukan kode.
       *
       * "Code", "FUNWORLD", "SELFIETIME", "GIFT" — semuanya lolos pemeriksaan
       * bentuk kode dan akan masuk sebagai voucher yang tidak pernah bisa
       * ditukar. Setiap kode sungguhan yang pernah dipakai selalu bercampur
       * huruf dan angka, jadi ketiadaan angka di baris pertama adalah penanda
       * yang jauh lebih dapat dipercaya daripada daftar kata terlarang yang
       * harus ditambah setiap kali ada nama kategori baru.
       */
      if (barisKe === 1 && !/\d/.test(nilai)) continue;

      hasil.push(nilai);
    }
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
    /*
     * Yang SUDAH keluar didahulukan, terbaru di atas.
     *
     * Urutannya semula kebalikannya, dan akibatnya pertanyaan yang paling
     * sering diajukan petugas — "kode ini tadi diberikan ke siapa" — menuntut
     * menggulir melewati ratusan kode yang belum terpakai untuk menemukan
     * segelintir yang sudah.
     */
    daftar: db.prepare(`
      SELECT kode, dipakai, dipakai_oleh, dipakai_pada FROM promo
       ORDER BY dipakai DESC, dipakai_pada DESC, urut
       LIMIT ?
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
