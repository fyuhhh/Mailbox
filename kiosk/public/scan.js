/* =============================================================================
   Stasiun check-in: baca QR dari kamera, catat kehadiran.

   Kamera hanya bisa diakses dari secure context. http://localhost termasuk,
   http://192.168.x.x TIDAK — jadi halaman ini harus dibuka di laptop yang
   menjalankan kiosk, bukan lewat alamat LAN dari perangkat lain.
   ========================================================================== */

'use strict';

/**
 * Berapa lama kode yang SAMA diabaikan setelah terbaca.
 *
 * Tamu memegang struknya di depan lensa selama beberapa detik, dan QR itu
 * terbaca ulang di setiap bingkai. Dengan jeda pendek, satu orang menghasilkan
 * beberapa baris riwayat dan layar berpindah dari "Selamat datang" ke "Sudah
 * check-in sebelumnya" selagi orangnya masih berdiri di situ — petugas
 * membacanya sebagai tanda ada yang salah, lalu menahan tamu yang sebenarnya
 * sudah beres. Delapan detik cukup lama untuk melewati satu tamu, dan kode
 * yang BERBEDA tetap terbaca seketika sehingga antrean tidak melambat.
 */
const JEDA_SAMA_MS = 8000;

const JEDA_PINDAI_MS = 120;  // sekitar 8 bingkai per detik
const DIAM_SETELAH_KENA_MS = 1200; // beri layar waktu untuk dibaca

const $ = (p) => document.querySelector(p);

const video = $('#video');
const kanvas = $('#kanvas');
const konteks = kanvas.getContext('2d', { willReadFrequently: true });

let aliran = null;
let pemindai = null;
let terakhirKode = null;
let terakhirWaktu = 0;
let sedangKirim = false;

/* --------------------------------- kamera --------------------------------- */

async function nyalakanKamera() {
  const tirai = $('#tirai-kamera');
  const pesan = $('#tirai-pesan');
  const tombol = $('#tombol-mulai');

  if (!navigator.mediaDevices?.getUserMedia) {
    pesan.innerHTML = window.isSecureContext
      ? 'Peramban ini tidak mendukung akses kamera.'
      : 'Kamera hanya bisa dipakai lewat <b>http://localhost</b>.<br>' +
        'Buka halaman ini di laptop yang menjalankan kiosk.';
    tombol.hidden = true;
    return;
  }

  pesan.textContent = 'Menyiapkan kamera…';
  tombol.hidden = true;

  try {
    aliran = await navigator.mediaDevices.getUserMedia({
      video: {
        // facingMode diabaikan laptop tetapi dipakai ponsel untuk memilih
        // kamera belakang, sehingga halaman yang sama tetap berguna bila
        // kelak disajikan lewat HTTPS.
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false,
    });
  } catch (galat) {
    tombol.hidden = false;
    tombol.textContent = 'Coba Lagi';
    pesan.innerHTML =
      galat.name === 'NotAllowedError'
        ? 'Izin kamera ditolak.<br>Klik ikon kamera di kanan kolom alamat, pilih <b>Izinkan</b>, lalu muat ulang.'
        : galat.name === 'NotFoundError'
          ? 'Tidak ada kamera yang terdeteksi di komputer ini.'
          : `Kamera gagal dinyalakan: ${galat.name}`;
    return;
  }

  video.srcObject = aliran;
  await video.play();

  tirai.hidden = true;
  mulaiPemindai();
}

function mulaiPemindai() {
  clearInterval(pemindai);
  pemindai = setInterval(pindaiSatuBingkai, JEDA_PINDAI_MS);
}

/* -------------------------------- pemindaian ------------------------------ */

function pindaiSatuBingkai() {
  if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

  const l = video.videoWidth;
  const t = video.videoHeight;
  if (!l || !t) return;

  // Turunkan resolusi bingkai sebelum didekode. jsQR bekerja per piksel, dan
  // memberinya 1280x960 penuh membuat tiap bingkai memakan ratusan milidetik —
  // cukup untuk membuat pratinjau kamera tersendat di depan antrean tamu.
  const skala = Math.min(1, 640 / l);
  kanvas.width = Math.round(l * skala);
  kanvas.height = Math.round(t * skala);
  konteks.drawImage(video, 0, 0, kanvas.width, kanvas.height);

  const bingkai = konteks.getImageData(0, 0, kanvas.width, kanvas.height);
  const hasil = jsQR(bingkai.data, bingkai.width, bingkai.height, {
    inversionAttempts: 'attemptBoth', // struk thermal pudar kadang terbaca terbalik
  });

  document.querySelector('.kamera').dataset.kena = hasil ? 'ya' : 'tidak';
  if (!hasil?.data) return;

  const sekarang = Date.now();
  // QR yang sama akan terbaca berkali-kali selama masih di depan lensa. Tanpa
  // jeda ini, satu tamu menghasilkan puluhan baris riwayat dalam dua detik.
  if (hasil.data === terakhirKode && sekarang - terakhirWaktu < JEDA_SAMA_MS) return;

  terakhirKode = hasil.data;
  terakhirWaktu = sekarang;

  // Hentikan pemindaian sejenak. Selain menahan hasil di layar cukup lama untuk
  // dibaca, ini juga membebaskan CPU tepat ketika permintaan jaringan berjalan.
  clearInterval(pemindai);
  setTimeout(mulaiPemindai, DIAM_SETELAH_KENA_MS);

  kirimKehadiran(hasil.data);
}

/* -------------------------------- kehadiran ------------------------------- */

async function kirimKehadiran(kode) {
  if (sedangKirim) return;
  sedangKirim = true;

  try {
    const respons = await fetch('/api/hadir', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kode }),
    });
    tampilkan(await respons.json());
    segarkanRekap();
  } catch {
    tampilkan({ status: 'gagal' });
  } finally {
    sedangKirim = false;
  }
}

const TAMPILAN = {
  baru: { label: 'Selamat datang', warna: 'baru' },
  ulang: { label: 'Sudah check-in sebelumnya', warna: 'ulang' },
  asing: { label: 'Kode tidak dikenal', warna: 'asing' },
  'tidak-terbaca': { label: 'QR tidak terbaca', warna: 'asing' },
  gagal: { label: 'Kiosk tidak merespons', warna: 'asing' },
};

function tampilkan(data) {
  const bentuk = TAMPILAN[data.status] ?? TAMPILAN.gagal;
  const kotak = $('#hasil');

  kotak.dataset.status = bentuk.warna;
  $('#hasil-label').textContent = bentuk.label;
  $('#hasil-nama').textContent = data.nama ?? (data.kode ? data.kode : '—');

  $('#hasil-detail').textContent =
    data.status === 'baru'
      ? `${data.kode} · tamu ke-${data.nomor}${data.pesan ? ` · "${data.pesan}"` : ''}`
      : data.status === 'ulang'
        ? `${data.kode} · pertama masuk ${jam(data.hadirPada)} · dipindai ${data.jumlahScan}×`
        : data.status === 'asing'
          ? 'Kode ini tidak ada di daftar tamu kiosk ini'
          : '';

  bunyi(data.status);
  catatRiwayat(data, bentuk);
}

function jam(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}

function catatRiwayat(data, bentuk) {
  const daftar = $('#riwayat');
  daftar.querySelector('.riwayat-kosong')?.remove();

  const baris = document.createElement('li');
  baris.dataset.status = bentuk.warna;
  baris.innerHTML =
    `<span>${(data.nama ?? data.kode ?? '—')} — ${bentuk.label}</span>` +
    `<span class="riwayat-jam">${jam(new Date().toISOString())}</span>`;

  daftar.prepend(baris);
  while (daftar.children.length > 12) daftar.lastElementChild.remove();
}

/**
 * Nada pendek sebagai penanda.
 *
 * Petugas di pintu memandangi tamu, bukan layar. Nada yang berbeda untuk
 * diterima dan ditolak membuat pemindaian bisa dinilai tanpa menunduk.
 */
function bunyi(status) {
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const nada = audio.createOscillator();
    const volume = audio.createGain();

    nada.frequency.value = status === 'baru' ? 880 : status === 'ulang' ? 620 : 320;
    volume.gain.setValueAtTime(0.12, audio.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);

    nada.connect(volume).connect(audio.destination);
    nada.start();
    nada.stop(audio.currentTime + 0.22);
    setTimeout(() => audio.close(), 400);
  } catch {
    // Perangkat tanpa audio tetap berfungsi; bunyi hanyalah pelengkap.
  }
}

/* --------------------------------- rekap ---------------------------------- */

async function segarkanRekap() {
  try {
    const { total, hadir } = await (await fetch('/api/rekap')).json();
    $('#rekap').textContent = `${hadir} dari ${total} tamu sudah check-in`;
  } catch {
    $('#rekap').textContent = 'kiosk tidak merespons';
  }
}

/* --------------------------------- perekat -------------------------------- */

$('#tombol-mulai').addEventListener('click', nyalakanKamera);

$('#manual').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const isian = $('#kode-manual');
  const kode = isian.value.trim();
  if (!kode) return;
  kirimKehadiran(kode);
  isian.value = '';
  isian.focus();
});

// Lepaskan kamera saat tab ditutup: lampu kamera yang tetap menyala membuat
// orang mengira perangkatnya masih merekam.
window.addEventListener('pagehide', () => {
  clearInterval(pemindai);
  aliran?.getTracks().forEach((t) => t.stop());
});

segarkanRekap();
setInterval(segarkanRekap, 15000);
nyalakanKamera();
