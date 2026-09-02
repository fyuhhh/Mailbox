/**
 * Penyusun perintah ESC/POS untuk printer struk thermal.
 *
 * Perintah dikirim sebagai byte mentah, bukan lewat dialog cetak sistem.
 * Konsekuensinya dua hal yang justru kita butuhkan di kiosk:
 *
 *   1. Tidak ada satu pun popup — cetak benar-benar otomatis.
 *   2. QR digambar oleh chip printer sendiri (perintah GS ( k), bukan dikirim
 *      sebagai gambar raster. Hasilnya jauh lebih tajam dan jauh lebih cepat;
 *      raster 384x384 lewat USB full-speed terasa seperti jeda satu detik,
 *      sedangkan QR native keluar seketika.
 */

const ESC = 0x1b;
const GS = 0x1d;

// Font A pada printer 58mm = 12 dot per karakter pada area cetak 384 dot.
export const KOLOM = { 58: 32, 80: 48 };
export const LEBAR_DOT = { 58: 384, 80: 576 };

/** Buang diakritik dan karakter non-ASCII; printer default memakai CP437. */
export function keAscii(teks) {
  return String(teks ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\n]/g, '');
}

/** Bungkus teks pada batas kata, dipotong paksa bila satu kata lebih panjang dari kolom. */
export function bungkus(teks, kolom) {
  const baris = [];
  for (const paragraf of keAscii(teks).split('\n')) {
    let sisa = paragraf.trim();
    if (!sisa) {
      baris.push('');
      continue;
    }
    while (sisa.length > kolom) {
      let potong = sisa.lastIndexOf(' ', kolom);
      if (potong <= 0) potong = kolom;
      baris.push(sisa.slice(0, potong).trim());
      sisa = sisa.slice(potong).trim();
    }
    if (sisa) baris.push(sisa);
  }
  return baris;
}

export class Struk {
  constructor({ lebarMm = 58 } = {}) {
    this.kolom = KOLOM[lebarMm] ?? KOLOM[58];
    this.lebarDot = LEBAR_DOT[lebarMm] ?? LEBAR_DOT[58];
    this.potongan = [];
  }

  raw(...byte) {
    this.potongan.push(Buffer.from(byte));
    return this;
  }

  /** ESC @ — reset ke kondisi awal, wajib di baris pertama setiap struk. */
  init() {
    return this.raw(ESC, 0x40);
  }

  /** ESC a n — 0 kiri, 1 tengah, 2 kanan. */
  rata(posisi) {
    return this.raw(ESC, 0x61, { kiri: 0, tengah: 1, kanan: 2 }[posisi] ?? 0);
  }

  /** ESC E n */
  tebal(aktif) {
    return this.raw(ESC, 0x45, aktif ? 1 : 0);
  }

  /**
   * GS ! n — pengali ukuran karakter.
   * Nibble atas = lebar, nibble bawah = tinggi, masing-masing 1..8 kali.
   */
  ukuran(lebar = 1, tinggi = 1) {
    const l = Math.min(Math.max(lebar, 1), 8) - 1;
    const t = Math.min(Math.max(tinggi, 1), 8) - 1;
    return this.raw(GS, 0x21, (l << 4) | t);
  }

  teks(isi) {
    this.potongan.push(Buffer.from(keAscii(isi), 'ascii'));
    return this;
  }

  baris(isi = '') {
    return this.teks(isi + '\n');
  }

  /** Tulis teks panjang dengan pembungkusan otomatis pada lebar kertas. */
  paragraf(isi, { kolom = this.kolom } = {}) {
    for (const b of bungkus(isi, kolom)) this.baris(b);
    return this;
  }

  garis(karakter = '-') {
    return this.baris(karakter.repeat(this.kolom));
  }

  /**
   * Pembatas berhias untuk struk acara.
   *
   * Hanya memakai karakter ASCII. Printer struk memang punya karakter garis
   * kotak di CP437, tetapi tiap merek memetakannya berbeda — yang tampak rapi
   * di satu printer keluar sebagai simbol acak di printer cadangan, dan itu
   * baru ketahuan saat printer utama bermasalah di tengah acara.
   */
  hias(pola = '* . ') {
    const penuh = pola.repeat(Math.ceil(this.kolom / pola.length)).slice(0, this.kolom);
    // Ekornya dipotong sampai berakhir di karakter yang sama dengan awalan,
    // supaya pembatas atas dan bawah tampak simetris di kertas.
    return this.baris(penuh.slice(0, penuh.lastIndexOf(pola[0]) + 1));
  }

  /** Renggangkan teks agar terbaca sebagai label, bukan kalimat. */
  renggang(teks, sela = ' ') {
    return this.baris(keAscii(teks).split('').join(sela));
  }

  /** ESC d n — maju n baris. */
  majuBaris(n = 1) {
    return this.raw(ESC, 0x64, Math.min(Math.max(n, 0), 255));
  }

  /**
   * GS ( k — cetak QR memakai generator internal printer.
   *
   * `modul` adalah lebar satu kotak QR dalam dot. Nilainya dibatasi di sini
   * supaya QR beserta zona sunyinya tidak melebihi lebar kertas: QR yang
   * terpotong tepinya tidak akan pernah terbaca pemindai apa pun.
   */
  qr(data, { modul = 8, koreksi = 'M' } = {}) {
    const isi = Buffer.from(String(data), 'ascii');
    const modulAman = this.modulMaksimum(isi.length, modul);

    // fn 165: pilih model — 50 = Model 2.
    this.raw(GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // fn 167: ukuran modul.
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, modulAman);
    // fn 169: tingkat koreksi galat — 48=L 49=M 50=Q 51=H.
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, { L: 48, M: 49, Q: 50, H: 51 }[koreksi] ?? 49);
    // fn 180: simpan data ke buffer simbol. Panjang mencakup 3 byte cn/fn/m.
    const n = isi.length + 3;
    this.raw(GS, 0x28, 0x6b, n & 0xff, (n >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.potongan.push(isi);
    // fn 181: cetak isi buffer simbol.
    this.raw(GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  /**
   * Turunkan ukuran modul sampai simbol muat di lebar kertas.
   *
   * Perkiraan sisi simbol memakai versi QR terkecil yang sanggup menampung
   * data pada koreksi M, ditambah zona sunyi 4 modul di kiri dan kanan.
   */
  modulMaksimum(panjangData, diminta) {
    const sisi = sisiModulQr(panjangData) + 8;
    const muat = Math.floor(this.lebarDot / sisi);
    return Math.min(Math.max(Math.min(diminta, muat), 1), 16);
  }

  /** GS V — potong kertas sebagian setelah memajukan kertas melewati pisau. */
  potong() {
    return this.raw(GS, 0x56, 0x42, 0x00);
  }

  build() {
    return Buffer.concat(this.potongan);
  }
}

/**
 * Sisi simbol QR (dalam modul) untuk sejumlah karakter, koreksi galat M.
 *
 * Dua tabel karena mode alfanumerik memuat jauh lebih banyak per simbol
 * daripada mode byte — itulah alasan URL pada struk ini ditulis huruf besar.
 */
const KAPASITAS_ALFANUMERIK = [25, 47, 77, 114, 154, 195, 224, 279, 335, 395];
const KAPASITAS_BYTE = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

export function sisiModulQr(panjangData) {
  const tabel = KAPASITAS_ALFANUMERIK; // pemanggil selalu mengirim URL huruf besar
  for (let i = 0; i < tabel.length; i++) {
    if (panjangData <= tabel[i]) return 21 + i * 4; // versi 1 = 21x21, +4 tiap versi
  }
  return 21 + tabel.length * 4;
}

/** True bila seluruh karakter muat di mode alfanumerik QR (yang paling hemat). */
export function alfanumerikMurni(teks) {
  return /^[0-9A-Z $%*+\-./:]*$/.test(teks);
}
