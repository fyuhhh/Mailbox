/**
 * Penyala kiosk untuk orang yang tidak membuka terminal.
 *
 * Dipanggil oleh "Jalankan Kiosk.command" (macOS) dan "Jalankan Kiosk.bat"
 * (Windows). Seluruh logikanya di sini, bukan diduplikasi ke skrip shell dan
 * batch, supaya perbaikan pada salah satu platform tidak diam-diam meninggalkan
 * platform yang lain.
 *
 * Hanya memakai modul bawaan Node: berkas ini harus tetap berjalan pada salinan
 * segar yang belum pernah dipasangi dependensi apa pun.
 */

import { spawn, execFile } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const jalankan = promisify(execFile);
const AKAR = path.dirname(fileURLToPath(import.meta.url));
const anak = [];

const warna = {
  judul: (t) => `\x1b[1;33m${t}\x1b[0m`,
  baik: (t) => `\x1b[32m${t}\x1b[0m`,
  buruk: (t) => `\x1b[31m${t}\x1b[0m`,
  redup: (t) => `\x1b[90m${t}\x1b[0m`,
};

function garis(teks = '') {
  console.log('  ' + teks);
}

/* --------------------------- persiapan lingkungan ------------------------- */

function siapkanEnv(folder) {
  const env = path.join(AKAR, folder, '.env');
  const contoh = path.join(AKAR, folder, '.env.example');
  if (!existsSync(env) && existsSync(contoh)) {
    copyFileSync(contoh, env);
    garis(warna.redup(`  .env dibuat dari contoh untuk ${folder}/`));
  }
}

async function pasangDependensi(folder) {
  if (existsSync(path.join(AKAR, folder, 'node_modules'))) return;

  garis(`Memasang dependensi ${folder}/ — sekali saja, mohon tunggu…`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  await new Promise((selesai, gagal) => {
    const proses = spawn(npm, ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: path.join(AKAR, folder),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proses.on('exit', (kode) => (kode === 0 ? selesai() : gagal(new Error(`npm install gagal (kode ${kode})`))));
    proses.on('error', gagal);
  });
}

/* ------------------------------ baca konfigurasi -------------------------- */

/**
 * Baca satu nilai dari berkas .env.
 *
 * Tidak memakai process.loadEnvFile: penyala ini membaca dua berkas .env yang
 * berbeda (kiosk dan undangan) yang memakai nama kunci yang sama, dan memuat
 * keduanya ke process.env akan membuat yang terakhir menimpa yang pertama.
 */
function bacaEnv(folder, kunci, bawaan = '') {
  const berkas = path.join(AKAR, folder, '.env');
  if (!existsSync(berkas)) return bawaan;
  const cocok = readFileSync(berkas, 'utf8').match(new RegExp(`^\\s*${kunci}\\s*=\\s*(.*)$`, 'm'));
  return cocok ? cocok[1].trim() : bawaan;
}

function alamatLan() {
  for (const [nama, daftar] of Object.entries(networkInterfaces())) {
    for (const antarmuka of daftar ?? []) {
      if (antarmuka.family !== 'IPv4' || antarmuka.internal) continue;
      if (/^(docker|br-|veth|vmnet|utun)/i.test(nama)) continue;
      return antarmuka.address;
    }
  }
  return null;
}

/* -------------------------------- penyalaan ------------------------------- */

function nyalakan(folder, label) {
  const proses = spawn(process.execPath, ['server.js'], {
    cwd: path.join(AKAR, folder),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tulis = (aliran) => (data) => {
    for (const b of String(data).split('\n')) {
      if (b.trim()) garis(warna.redup(`[${label}] `) + b.trim());
    }
  };
  proses.stdout.on('data', tulis());
  proses.stderr.on('data', tulis());

  proses.on('exit', (kode) => {
    if (kode !== 0 && kode !== null) {
      garis(warna.buruk(`[${label}] berhenti dengan kode ${kode}`));
    }
  });

  anak.push(proses);
  return proses;
}

async function tungguSiap(url, batasMs = 25000) {
  const tenggat = Date.now() + batasMs;
  while (Date.now() < tenggat) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function bukaPeramban(url) {
  // Mode kiosk lebih dulu; bila Chrome tidak ada, peramban bawaan sudah cukup
  // untuk mencoba-coba di laptop.
  const percobaan =
    process.platform === 'win32'
      ? [
          ['cmd', ['/c', 'start', '', 'chrome', '--kiosk', `--app=${url}`, '--touch-events=enabled']],
          ['cmd', ['/c', 'start', '', url]],
        ]
      : [
          ['open', ['-na', 'Google Chrome', '--args', '--kiosk', `--app=${url}`]],
          ['open', [url]],
        ];

  for (const [perintah, argumen] of percobaan) {
    try {
      await jalankan(perintah, argumen);
      return;
    } catch {}
  }
  garis(warna.redup('Tidak bisa membuka peramban otomatis — buka alamat di atas secara manual.'));
}

/* ---------------------------------- utama --------------------------------- */

console.log();
garis(warna.judul('KIOSK UNDANGAN'));
garis(warna.redup('─'.repeat(52)));

siapkanEnv('kiosk');
siapkanEnv('undangan');

const portKiosk = Number(bacaEnv('kiosk', 'PORT', '4000'));
const portUndangan = Number(bacaEnv('undangan', 'PORT', '5010'));
const baseUrl = bacaEnv('kiosk', 'BASE_URL', 'AUTO');

// Server undangan hanya dinyalakan bila memang dilayani mesin ini. Kalau
// BASE_URL menunjuk ke VPS, menyalakannya di sini cuma menyalakan server yang
// tidak akan pernah dikunjungi siapa pun.
const undanganLokal = /^\s*(AUTO|)\s*$/i.test(baseUrl) || /localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./i.test(baseUrl);

try {
  await pasangDependensi('kiosk');
  if (undanganLokal) await pasangDependensi('undangan');
} catch (galat) {
  garis(warna.buruk(`Gagal memasang dependensi: ${galat.message}`));
  garis('Pastikan komputer ini terhubung internet, lalu jalankan berkas ini lagi.');
  await tahan();
}

if (undanganLokal) {
  nyalakan('undangan', 'undangan');
  await tungguSiap(`http://127.0.0.1:${portUndangan}/`);
}

nyalakan('kiosk', 'kiosk');
const siap = await tungguSiap(`http://127.0.0.1:${portKiosk}/api/hidup`);

console.log();
if (!siap) {
  garis(warna.buruk('Kiosk tidak merespons. Lihat pesan di atas untuk penyebabnya.'));
  await tahan();
}

const ip = alamatLan();
garis(warna.baik('Kiosk siap.'));
garis();
garis(`  Layar kiosk   : http://localhost:${portKiosk}`);
if (undanganLokal && ip) {
  garis(`  Undangan (HP) : http://${ip}:${portUndangan}`);
  garis(warna.redup(`  Ponsel harus berada di jaringan yang sama (${ip.split('.').slice(0, 3).join('.')}.x)`));
} else {
  garis(`  Undangan      : ${baseUrl.toLowerCase()}`);
}
garis();
garis(warna.redup('Tutup jendela ini untuk mematikan kiosk.'));
console.log();

// TANPA_PERAMBAN=1 melewati langkah ini, untuk mesin yang membuka Chrome
// sendiri lewat pintasan Startup, dan untuk menguji penyala tanpa layar
// diambil alih mode kiosk.
if (process.env.TANPA_PERAMBAN !== '1') {
  await bukaPeramban(`http://localhost:${portKiosk}`);
} else {
  garis(warna.redup('Peramban tidak dibuka (TANPA_PERAMBAN=1).'));
}

/* --------------------------------- penutup -------------------------------- */

function bereskan() {
  for (const proses of anak) proses.kill();
  process.exit(0);
}

for (const sinyal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinyal, bereskan);

async function tahan() {
  garis();
  garis(warna.redup('Tekan Ctrl+C untuk menutup.'));
  await new Promise(() => {});
}

// Jaga proses tetap hidup selama server anak berjalan.
await new Promise(() => {});
