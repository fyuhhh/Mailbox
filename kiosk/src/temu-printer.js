/**
 * Penemuan printer otomatis.
 *
 * Kiosk dipindahkan antar-PC dan antar-jaringan; alamat printer yang ditulis
 * tangan di .env hampir pasti salah begitu berpindah. Berkas ini membuat kiosk
 * mencari sendiri: sapu jaringan lokal, temukan yang membuka port 9100, lalu
 * pastikan yang menjawab benar-benar printer ESC/POS — bukan sembarang
 * perangkat yang kebetulan memakai port yang sama.
 *
 * Tidak ada dependensi baru. Hanya node:net dan node:os.
 */

import net from 'node:net';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const jalankan = promisify(execFile);

/** Berapa host disapa serempak. Ditahan supaya jaringan venue tidak terganggu. */
const SERENTAK = 48;

/** Batas tunggu per host saat menyapu. */
const TUNGGU_SAPU_MS = 400;

/** Batas tunggu saat menanyai satu host yang sudah diketahui membuka porta. */
const TUNGGU_TANYA_MS = 1200;

const PORTA = 9100;

/**
 * Alamat IPv4 milik mesin ini, beserta lebar jaringannya.
 *
 * Antarmuka virtual dilewati. Mini PC acara kerap punya Wi-Fi dan Ethernet
 * sekaligus — keduanya dikembalikan, dan pemanggilnya menyapu semuanya, karena
 * menebak yang mana yang tersambung ke printer justru sumber kesalahan.
 */
export function jaringanLokal() {
  const hasil = [];

  for (const [nama, daftar] of Object.entries(os.networkInterfaces())) {
    for (const antar of daftar ?? []) {
      if (antar.internal) continue;
      if (antar.family !== 'IPv4' && antar.family !== 4) continue;

      /*
       * Hanya /24 dan yang lebih sempit yang disapu.
       *
       * Jaringan /16 berisi 65.534 alamat. Menyapunya berarti puluhan ribu
       * sambungan TCP dan waktu tunggu bermenit-menit — di jaringan venue itu
       * terlihat seperti pemindaian porta, dan bisa membuat kiosk diblokir.
       */
      const bit = hitungBitTopeng(antar.netmask);
      if (bit < 24) {
        hasil.push({ nama, ip: antar.address, topeng: antar.netmask, terlaluLuas: true });
        continue;
      }

      hasil.push({ nama, ip: antar.address, topeng: antar.netmask, terlaluLuas: false });
    }
  }

  return hasil;
}

function hitungBitTopeng(topeng) {
  if (!topeng) return 0;
  return topeng
    .split('.')
    .map((n) => (Number(n) >>> 0).toString(2).replace(/0/g, '').length)
    .reduce((a, b) => a + b, 0);
}

/** Semua alamat host di /24 yang memuat `ip`, kecuali alamat jaringan dan siaran. */
function alamatSekitar(ip) {
  const bagian = ip.split('.').map(Number);
  if (bagian.length !== 4 || bagian.some((n) => Number.isNaN(n))) return [];

  const daftar = [];
  for (let i = 1; i <= 254; i += 1) daftar.push(`${bagian[0]}.${bagian[1]}.${bagian[2]}.${i}`);
  return daftar;
}

/** Coba buka sambungan; benar bila porta menerima. */
function portaTerbuka(host, tunggu) {
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
    soket.connect(PORTA, host);
  });
}

/**
 * Tanyakan status ke perangkat yang porta-nya terbuka.
 *
 * `DLE EOT 1` adalah perintah ESC/POS "kirim status printer". Printer struk
 * menjawabnya dengan satu bita, hampir seketika. Perangkat lain yang kebetulan
 * mendengarkan 9100 — server cetak, kamera IP, apa pun — umumnya diam saja.
 *
 * Diamnya bukan bukti bahwa itu bukan printer: sebagian model tidak menjawab
 * bila sedang sibuk atau kehabisan kertas. Karena itu hasilnya dikembalikan
 * sebagai tingkat keyakinan, bukan sebagai penolakan.
 */
function tanyaEscPos(host) {
  return new Promise((selesai) => {
    const soket = new net.Socket();
    let sudah = false;

    const tutup = (menjawab, bita) => {
      if (sudah) return;
      sudah = true;
      soket.destroy();
      selesai({ menjawab, bita });
    };

    soket.setTimeout(TUNGGU_TANYA_MS);
    soket.once('connect', () => soket.write(Buffer.from([0x10, 0x04, 0x01])));
    soket.once('data', (b) => tutup(true, b[0] ?? null));
    soket.once('timeout', () => tutup(false, null));
    soket.once('error', () => tutup(false, null));
    soket.connect(PORTA, host);
  });
}

/** Jalankan `tugas` atas `daftar`, paling banyak `serentak` sekaligus. */
async function petaTerbatas(daftar, serentak, tugas) {
  const hasil = new Array(daftar.length);
  let berikut = 0;

  async function pekerja() {
    while (berikut < daftar.length) {
      const i = berikut;
      berikut += 1;
      hasil[i] = await tugas(daftar[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(serentak, daftar.length) }, pekerja));
  return hasil;
}

/**
 * Sapu jaringan lokal, kembalikan printer yang ditemukan.
 *
 * `dahulukan` disapa lebih dulu dan di luar batas serentak, supaya alamat yang
 * sudah dikenal — dari .env atau dari acara sebelumnya — ketemu dalam sepersekian
 * detik alih-alih menunggu seluruh /24 selesai.
 */
export async function cariPrinter({ dahulukan = [], padaKemajuan = null } = {}) {
  const antar = jaringanLokal();
  const kandidat = new Set();

  for (const a of dahulukan) if (a) kandidat.add(String(a).trim());

  const dilewati = [];
  for (const a of antar) {
    if (a.terlaluLuas) {
      dilewati.push(`${a.nama} (${a.ip}/${hitungBitTopeng(a.topeng)}) terlalu luas untuk disapu`);
      continue;
    }
    for (const ip of alamatSekitar(a.ip)) kandidat.add(ip);
  }

  const daftar = [...kandidat];
  let selesai = 0;

  const terbuka = [];
  await petaTerbatas(daftar, SERENTAK, async (host) => {
    const bisa = await portaTerbuka(host, TUNGGU_SAPU_MS);
    selesai += 1;
    if (padaKemajuan && selesai % 32 === 0) padaKemajuan(selesai, daftar.length);
    if (bisa) terbuka.push(host);
  });

  // Hanya yang porta-nya terbuka yang ditanyai — jumlahnya segelintir, jadi
  // pertanyaan yang lebih lambat ini tidak menambah waktu berarti.
  const diperiksa = await petaTerbatas(terbuka, 8, async (host) => {
    const { menjawab, bita } = await tanyaEscPos(host);
    return {
      host,
      port: PORTA,
      menjawabEscPos: menjawab,
      status: bita,
      keyakinan: menjawab ? 'tinggi' : 'sedang',
    };
  });

  /*
   * Yang menjawab ESC/POS didahulukan dalam daftar.
   *
   * Pemilihan otomatis mengambil yang teratas, dan salah memilih berarti
   * mengirim ESC/POS ke perangkat yang bukan printer.
   */
  diperiksa.sort((a, b) => Number(b.menjawabEscPos) - Number(a.menjawabEscPos));

  return { printer: diperiksa, diperiksaJumlah: daftar.length, dilewati };
}

/**
 * Printer yang terpasang di sistem operasi ini.
 *
 * Dipakai untuk printer yang dicolok lewat USB, yang tidak punya alamat IP dan
 * karena itu tidak akan pernah muncul dalam penyapuan jaringan.
 */
export async function printerSistem() {
  try {
    if (process.platform === 'win32') {
      /*
       * Get-Printer, bukan wmic.
       *
       * wmic sudah dicabut dari Windows 11 dan tidak ada lagi di pemasangan
       * baru; memanggilnya akan gagal justru di mesin yang paling baru.
       */
      const { stdout } = await jalankan('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-Printer | Select-Object -Property Name,PortName,PrinterStatus,Shared,ShareName | ConvertTo-Json -Compress',
      ], { timeout: 15000 });

      const mentah = JSON.parse(stdout.trim() || '[]');
      const daftar = Array.isArray(mentah) ? mentah : [mentah];

      return daftar.map((p) => ({
        nama: p.Name,
        porta: p.PortName,
        keadaan: p.PrinterStatus,
        dibagikan: Boolean(p.Shared),
        namaBagi: p.ShareName || null,
      }));
    }

    const { stdout } = await jalankan('lpstat', ['-p'], { timeout: 15000 });
    return stdout
      .split('\n')
      .map((b) => b.match(/^printer\s+(\S+)/))
      .filter(Boolean)
      .map((m) => ({ nama: m[1], porta: null, keadaan: null, dibagikan: null, namaBagi: null }));
  } catch {
    // Tidak ada printer terpasang, atau perintahnya tidak tersedia. Bukan galat:
    // kiosk yang memakai printer jaringan tidak membutuhkan daftar ini sama sekali.
    return [];
  }
}
