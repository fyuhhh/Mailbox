/**
 * Perekam sambungan printer.
 *
 *   node src/pantau-printer.js            -> pantau sampai dihentikan Ctrl+C
 *   node src/pantau-printer.js --menit=30 -> pantau 30 menit lalu berhenti
 *
 * Masalah "kadang printer tidak terbaca" tidak bisa didiagnosis dari satu kali
 * melihat: saat diperiksa, keadaannya selalu salah satu dari dua, dan yang
 * menentukan justru KAPAN dan SESERING APA ia berpindah. Berkas ini merekam
 * setiap perpindahan beserta waktunya, jadi biarkan berjalan sambil mencetak
 * beberapa struk, lalu baca ringkasannya.
 *
 * Yang dicari:
 *   - putus tepat SAAT mencetak  -> printer kekurangan daya saat kepala cetak
 *                                   menyala; pakai adaptor dayanya sendiri
 *                                   atau hub USB berdaya
 *   - putus saat diam beberapa menit -> sistem operasi menidurkan port USB
 *   - putus acak sambil disenggol    -> kabel atau konektor
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFile } from 'node:fs/promises';

const jalankan = promisify(execFile);
const AKAR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.loadEnvFile?.(path.join(AKAR, '.env'));

const JEDA_MS = 500;
const menitArg = process.argv.find((a) => a.startsWith('--menit='));
const batasMs = menitArg ? Number(menitArg.slice(8)) * 60_000 : Infinity;
const LOG = path.join(AKAR, 'data', 'pantau-printer.log');

async function penandaUsb() {
  if (process.env.PRINTER_USB_NAME) return process.env.PRINTER_USB_NAME;
  try {
    const { stdout } = await jalankan('lpoptions', ['-p', process.env.PRINTER_NAME]);
    return decodeURIComponent(stdout.match(/device-uri=usb:\/\/[^/\s]+\/([^?\s]+)/)?.[1] ?? '');
  } catch {
    return '';
  }
}

async function terpasang(penanda) {
  try {
    const { stdout } = await jalankan('ioreg', ['-p', 'IOUSB', '-w0']);
    return stdout.includes(penanda);
  } catch {
    return false;
  }
}

const jam = (d = new Date()) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

const durasi = (ms) => {
  const d = Math.round(ms / 1000);
  if (d < 60) return `${d} detik`;
  return `${Math.floor(d / 60)} menit ${d % 60} detik`;
};

const penanda = await penandaUsb();
if (!penanda) {
  console.error('\n  Tidak bisa menentukan nama perangkat USB.');
  console.error('  Isi PRINTER_USB_NAME di .env, lalu jalankan lagi.\n');
  process.exit(1);
}

console.log(`\n  Memantau "${penanda}" setiap ${JEDA_MS} ms.`);
console.log(`  Catatan ditulis ke data/pantau-printer.log`);
console.log(`  Tekan Ctrl+C untuk berhenti dan melihat ringkasan.\n`);

const mulai = Date.now();
const peristiwa = [];
let keadaan = await terpasang(penanda);
let sejak = Date.now();

console.log(`  ${jam()}  mulai — printer ${keadaan ? 'TERPASANG' : 'TIDAK ADA'}`);

async function catat(baris) {
  console.log('  ' + baris);
  await appendFile(LOG, new Date().toISOString() + '  ' + baris + '\n').catch(() => {});
}

function ringkas() {
  const total = Date.now() - mulai;
  const putus = peristiwa.filter((p) => !p.jadi).length;

  console.log('\n  ' + '─'.repeat(52));
  console.log(`  Dipantau  : ${durasi(total)}`);
  console.log(`  Terputus  : ${putus} kali`);

  if (putus === 0) {
    console.log('\n  Sambungan stabil sepanjang pemantauan.');
    console.log('  Bila gangguan tetap terjadi, pantau lebih lama sambil mencetak.');
  } else {
    const tersambung = peristiwa.filter((p) => p.jadi === false).map((p) => p.bertahan);
    const rata = tersambung.reduce((a, b) => a + b, 0) / tersambung.length;
    console.log(`  Rata-rata bertahan sebelum putus: ${durasi(rata)}`);
    console.log('\n  Bandingkan waktu putus di atas dengan waktu kamu mencetak:');
    console.log('    putus tepat saat mencetak  -> daya kurang saat kepala cetak menyala');
    console.log('    putus setelah lama diam    -> port USB ditidurkan sistem');
    console.log('    putus tanpa pola           -> kabel atau konektor');
  }
  console.log('');
}

process.on('SIGINT', () => {
  ringkas();
  process.exit(0);
});

while (Date.now() - mulai < batasMs) {
  await new Promise((r) => setTimeout(r, JEDA_MS));
  const sekarang = await terpasang(penanda);
  if (sekarang === keadaan) continue;

  const bertahan = Date.now() - sejak;
  peristiwa.push({ jadi: sekarang, bertahan, pada: Date.now() });
  await catat(
    `${jam()}  ${sekarang ? 'TERSAMBUNG' : 'PUTUS'}` +
      `  (keadaan sebelumnya bertahan ${durasi(bertahan)})`
  );
  keadaan = sekarang;
  sejak = Date.now();
}

ringkas();
