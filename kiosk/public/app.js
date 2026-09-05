/* =============================================================================
   Alur kiosk.

     pilih ─┬─ tamu   → nama ─────────┐
            └─ member → scan → nama ──┤
                                      └→ siap → rekam → tinjau → proses → hasil

   Yang membedakan kedua jalur hanyalah cara nama diperoleh dan jenis
   struk yang keluar di ujungnya. Seluruh bagian perekaman dipakai bersama —
   menduplikasinya per jalur berarti dua tempat untuk memperbaiki setiap bug
   pengaturan waktu kamera, dan pengaturan waktu itulah bagian yang paling
   mudah salah.

   Ditulis tanpa kerangka kerja dan tanpa proses build: mesin kiosk dirakit
   ulang di lokasi acara, sering oleh orang yang bukan programmer, dan berkas
   yang bisa dibuka langsung di Notepad adalah keunggulan nyata di situasi itu.
   ========================================================================== */

'use strict';

const BATAS = { nama: 40 };

const DIAM_KEMBALI_MS = 60_000;
/**
 * Waktu-waktu yang bisa diubah petugas dari panel, tanpa menyunting kode.
 *
 * Nilai di sini hanya cadangan bila server belum sempat menjawab. Angka yang
 * berlaku diambil dari /api/pengaturan saat kiosk dimuat, sehingga penyesuaian
 * di tengah acara cukup lewat layar — bukan lewat orang yang bisa menyunting
 * berkas dan menyalakan ulang kiosk.
 */
const atur = {
  rekamDetik: 15,      // panjang rekaman, batas atas 15
  abaDetik: 5,         // hitung mundur sebelum kamera merekam
  siapDetik: 60,       // waktu bersiap, boleh dilewati
  hasilDetik: 60,      // hitung mundur di layar hasil
  jedaCetakUlang: 15,  // jeda antar cetak ulang
  putarLayar: 0,
  hanyaMember: 0,      // 1 = jalur ketik nama disembunyikan       // 0 / 90 / 270 untuk TV yang digantung miring
};

let batasAtur = {};


const keadaan = {
  layar: 'pilih',
  jalur: 'tamu',        // 'tamu' | 'member'
  tanpaHadiah: false,   // benar bila persediaan habis dan tamu tetap lanjut
  nama: '',
  memberId: null,
  nomorHp: '',
  videoId: null,        // id unggahan hasil berbingkai
  videoMentahId: null,  // id unggahan salinan mentah, bila ada
  blobRekaman: null,
  blobMentah: null,
  kodeTerakhir: null,
  ketukLampu: 0,
};

const $ = (pilih, akar = document) => akar.querySelector(pilih);
const $$ = (pilih, akar = document) => [...akar.querySelectorAll(pilih)];

const el = (tag, kelas) => {
  const n = document.createElement(tag);
  if (kelas) n.className = kelas;
  return n;
};

/* ================================ PAPAN KETIK ============================== */

const DERET = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
];

function gambarPapan(wadah, jenis) {
  const tanda = ["'", '.'];

  DERET.forEach((huruf, i) => {
    const deret = el('div', 'deret');
    if (i === 2) deret.append(tuts(tanda[0], 'tuts-lebar'));
    huruf.forEach((h) => deret.append(tuts(h)));
    if (i === 2) {
      deret.append(tuts(tanda[1], 'tuts-lebar'));
      deret.append(tuts('⌫', 'tuts-hapus', 'hapus'));
    }
    wadah.append(deret);
  });

  const bawah = el('div', 'deret');
  bawah.append(tuts('spasi', 'tuts-spasi', 'spasi'));
  wadah.append(bawah);
}

function tuts(label, kelasEkstra = '', peran = 'huruf') {
  const b = el('button', `tuts ${kelasEkstra}`.trim());
  b.type = 'button';
  b.textContent = label;
  b.dataset.peran = peran;
  if (peran === 'huruf') b.dataset.nilai = label;
  return b;
}

function ladang() {
  return 'nama';
}

function ketik(karakter) {
  const kunci = ladang();
  if (keadaan[kunci].length >= BATAS[kunci]) return;
  if (karakter === ' ' && (keadaan[kunci] === '' || keadaan[kunci].endsWith(' '))) return;
  keadaan[kunci] += karakter;
  gambarUlangMasukan();
}

function hapus() {
  const kunci = ladang();
  keadaan[kunci] = keadaan[kunci].slice(0, -1);
  gambarUlangMasukan();
}

function gambarUlangMasukan() {
  const kunci = ladang();
  const nilai = keadaan[kunci];
  const kotak = $(`#isian-${kunci}`);
  const sisa = $(`#sisa-${kunci}`);

  kotak.textContent = nilai;
  kotak.classList.toggle('aktif', nilai.length > 0);

  const tersisa = BATAS[kunci] - nilai.length;
  sisa.textContent = tersisa <= 15 ? `sisa ${tersisa} huruf` : '';
  sisa.classList.toggle('hampir', tersisa <= 5);

  if (kunci === 'nama') {
    $('[data-layar="nama"] [data-aksi="lanjut"]').disabled = nilai.trim().length < 2;
  }
}

/* ================================= NAVIGASI =============================== */

function keLayar(nama) {
  keadaan.layar = nama;
  $$('.layar').forEach((s) => { s.hidden = s.dataset.layar !== nama; });
  aturJedaDiam();
}

function mulaiUlang() {
  hentikanSemuaTimer();
  lepasKamera();

  Object.assign(keadaan, {
    jalur: 'tamu', tanpaHadiah: false, nama: '', memberId: null, nomorHp: '',
    videoId: null, videoMentahId: null,
    blobRekaman: null, blobMentah: null, kodeTerakhir: null,
  });

  for (const kunci of ['nama']) {
    $(`#isian-${kunci}`).textContent = '';
    $(`#isian-${kunci}`).classList.remove('aktif');
    $(`#sisa-${kunci}`).textContent = '';
  }
  $('[data-layar="nama"] [data-aksi="lanjut"]').disabled = true;

  const tombolUlang = $('[data-aksi="cetak-ulang"]');
  if (tombolUlang) {
    tombolUlang.disabled = false;
    tombolUlang.textContent = 'Cetak Ulang';
  }

  const tombolRekam = $('#selesai-rekam');
  if (tombolRekam) {
    tombolRekam.hidden = true;
    tombolRekam.disabled = true;
  }

  const petunjuk = $('#member-petunjuk');
  if (petunjuk) petunjuk.textContent = 'Arahkan QR profil PAM-PLUS ke kamera';
  const kamera = $('.kamera-member');
  if (kamera) kamera.dataset.kena = 'tidak';

  bebaskanPemutar();
  keLayar('pilih');

  /*
   * Angka sisa voucher berubah setiap kali satu tercetak; disegarkan di sini
   * supaya tamu berikutnya melihat jumlah yang benar.
   *
   * Saat kiosk dikhususkan untuk pemegang kartu, layar pilih tidak menawarkan
   * apa-apa untuk dipilih — hanya satu jalur yang tersisa. Jadi kamera langsung
   * dinyalakan: tamu berikutnya cukup menempelkan kartunya, tanpa satu ketukan
   * perantara yang tidak menambah apa pun.
   */
  terapkanModeMember().then(() => {
    // Layar diperiksa lagi karena janji ini selesai setelah beberapa ratus
    // milidetik; dalam jeda itu tamu bisa saja sudah menekan sesuatu, dan
    // menariknya kembali ke kamera akan terasa seperti kiosk yang membantah.
    if (keadaan.layar !== 'pilih') return;

    /*
     * Persediaan habis ditanyakan LEBIH DULU, sebelum kamera menyala.
     *
     * Membiarkan tamu memindai kartunya, merekam lima belas detik, lalu baru
     * memberi tahu tidak ada voucher adalah cara terburuk menyampaikannya.
     * Pilihannya diberikan di depan, saat ia belum mengeluarkan apa pun.
     */
    if (sisaVoucher === 0) return keLayar('habis');

    if (Number(atur.hanyaMember) === 1) mulaiPindaiMember();
  });
}

let jedaDiam = null;

function aturJedaDiam() {
  clearTimeout(jedaDiam);
  // Layar yang punya hitungannya sendiri, atau yang memang menunggu manusia
  // bergerak, tidak boleh direset di tengah jalan oleh pewaktu ini.
  // Layar 'habis' menunggu keputusan manusia, 'terimakasih' dan
  // 'selesai-rekam' punya pewaktu sendiri — semuanya tidak boleh direset di
  // tengah jalan oleh pewaktu diam.
  if (['pilih', 'hasil', 'rekam', 'siap', 'proses',
       'habis', 'terimakasih', 'selesai-rekam'].includes(keadaan.layar)) return;

  /*
   * Di mode khusus member, layar pindai ADALAH layar awal.
   *
   * Tanpa pengecualian ini pewaktu diam akan memanggil mulaiUlang, yang di mode
   * itu menyalakan kamera lagi — kamera mati lalu hidup setiap beberapa puluh
   * detik, semalaman, tepat di depan tamu yang sedang mengarahkan kartunya.
   */
  if (keadaan.layar === 'member' && Number(atur.hanyaMember) === 1) return;
  jedaDiam = setTimeout(mulaiUlang, DIAM_KEMBALI_MS);
}

/* ================================== KAMERA ================================ */

let aliranKamera = null;

/**
 * Buka kamera sekali dan pakai ulang alirannya.
 *
 * Meminta getUserMedia berulang kali membuat lampu kamera berkedip mati-nyala
 * di antara layar, dan pada sebagian perangkat butuh satu sampai dua detik
 * untuk menyala lagi — jeda yang jatuh tepat sebelum hitungan mundur dimulai.
 */
/*
 * Kamera yang dipilih petugas, diingat di peramban mesin ini.
 *
 * Bukan di server: id perangkat hanya berarti di komputer tempat kamera itu
 * dicolok, dan kiosk yang sama dijalankan di beberapa PC.
 */
const KUNCI_KAMERA = 'kameraPilihan';
const KUNCI_MIK = 'mikPilihan';

function kameraTersimpan() {
  try { return localStorage.getItem(KUNCI_KAMERA) || ''; } catch { return ''; }
}

function mikTersimpan() {
  try { return localStorage.getItem(KUNCI_MIK) || ''; } catch { return ''; }
}

/**
 * Syarat mikrofon untuk merekam ucapan.
 *
 * Perangkatnya disebut secara eksplisit bila petugas sudah memilihnya. Ini
 * bagian yang paling sering salah di Windows: peramban memakai perangkat
 * rekam BAWAAN SISTEM, sedangkan mikrofon webcam biasanya bukan bawaan. Yang
 * dipilih di dalam aplikasi Camera Windows tidak berlaku di sini — pilihan itu
 * milik aplikasi itu sendiri.
 *
 * echoCancellation dan noiseSuppression dimatikan. Keduanya dirancang untuk
 * panggilan suara; di atrium yang ramai keduanya menafsirkan keramaian sebagai
 * derau dan bisa menekan suara tamu sampai nyaris hilang. Yang direkam di sini
 * ucapan selamat, bukan rapat.
 */
function syaratAudio() {
  const dasar = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
  const id = mikTersimpan();
  return id ? { ...dasar, deviceId: { exact: id } } : dasar;
}

function simpanKamera(id) {
  try {
    if (id) localStorage.setItem(KUNCI_KAMERA, id);
    else localStorage.removeItem(KUNCI_KAMERA);
  } catch { /* mode privat; pilihan berlaku sampai halaman ditutup */ }
}

function syaratVideo(deviceId) {
  const dasar = { width: { ideal: 1280 }, height: { ideal: 720 } };
  /*
   * `exact`, bukan `ideal`.
   *
   * Dengan `ideal` peramban boleh mengabaikan pilihan petugas dan tetap memakai
   * kamera bawaannya — persis yang mau dihindari. Kegagalan karena perangkatnya
   * dicabut ditangani di pemanggilnya, bukan dengan melonggarkan syaratnya.
   */
  if (deviceId) return { ...dasar, deviceId: { exact: deviceId } };

  // facingMode hanya berarti di ponsel. Di PC ia dibiarkan sebagai anjuran
  // supaya webcam eksternal yang tidak melaporkan arah hadap tidak tersingkir.
  return { ...dasar, facingMode: { ideal: 'user' } };
}

async function bukaKamera({ audio }) {
  const adaAudio = aliranKamera?.getAudioTracks().length > 0;
  if (aliranKamera && (!audio || adaAudio)) return aliranKamera;

  lepasKamera();

  const suara = audio ? syaratAudio() : false;
  const pilihan = kameraTersimpan();

  try {
    aliranKamera = await navigator.mediaDevices.getUserMedia({
      video: syaratVideo(pilihan),
      audio: suara,
    });
  } catch (galat) {
    /*
     * Kamera pilihan tidak ada lagi — kabelnya tercabut, atau colokannya pindah
     * dan sistem memberinya id baru.
     *
     * Antrean tidak dihentikan karena itu. Kiosk kembali ke kamera mana pun
     * yang tersedia dan melupakan pilihan yang sudah mati, supaya percobaan
     * berikutnya tidak gagal dengan cara yang sama. Petugas bisa memilih ulang
     * dari panel.
     */
    const bisaJadiPilihan = Boolean(pilihan) || Boolean(mikTersimpan());
    const perangkatHilang = bisaJadiPilihan &&
      ['OverconstrainedError', 'NotFoundError', 'NotReadableError'].includes(galat.name);
    if (!perangkatHilang) throw galat;

    /*
     * Kedua pilihan dilupakan sekaligus, bukan hanya kameranya.
     *
     * Galatnya tidak memberi tahu perangkat mana yang hilang, dan webcam USB
     * membawa kamera DAN mikrofonnya sekaligus — mencabutnya mematikan
     * keduanya. Mempertahankan salah satunya berarti percobaan berikutnya gagal
     * lagi dengan galat yang sama.
     */
    console.warn('[kamera] perangkat pilihan tidak bisa dipakai:', galat.name);
    simpanKamera('');
    try { localStorage.removeItem(KUNCI_MIK); } catch { /* mode privat */ }

    aliranKamera = await navigator.mediaDevices.getUserMedia({
      video: syaratVideo(''),
      audio: audio ? { autoGainControl: true } : false,
    });
  }

  return aliranKamera;
}

/**
 * Isi pemilih kamera di panel petugas.
 *
 * Nama perangkat baru terbaca setelah izin kamera diberikan; sebelum itu
 * enumerateDevices mengembalikan label kosong. Jadi daftar ini digambar ulang
 * setiap kali panel dibuka, bukan sekali saat halaman dimuat — saat itu kamera
 * biasanya sudah pernah menyala dan namanya sudah terbaca.
 */
async function segarkanDaftarKamera() {
  const pilih = $('#pilih-kamera');
  const kabar = $('#kabar-kamera');
  if (!pilih || !kabar) return;

  if (!navigator.mediaDevices?.enumerateDevices) {
    kabar.textContent = 'Peramban ini tidak bisa mendaftar kamera.';
    kabar.className = 'panel-catatan buruk';
    return;
  }

  let daftar = [];
  try {
    daftar = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch {
    kabar.textContent = 'Daftar kamera tidak bisa dibaca.';
    kabar.className = 'panel-catatan buruk';
    return;
  }

  const tersimpan = kameraTersimpan();
  pilih.innerHTML = '<option value="">Otomatis</option>';

  daftar.forEach((d, i) => {
    const opsi = document.createElement('option');
    opsi.value = d.deviceId;
    // Label kosong berarti izin kamera belum pernah diberikan di peramban ini.
    opsi.textContent = d.label || `Kamera ${i + 1}`;
    pilih.append(opsi);
  });

  pilih.value = daftar.some((d) => d.deviceId === tersimpan) ? tersimpan : '';

  /*
   * Catatan hanya muncul kalau ada yang perlu ditindaklanjuti.
   *
   * Panel ini sudah padat. Kalimat yang berbunyi "semuanya baik-baik saja"
   * memakan dua baris untuk memberi tahu apa yang sudah terlihat sendiri dari
   * nama kamera di pemilihnya.
   */
  if (!daftar.length) {
    kabar.textContent = 'Tidak ada kamera terdeteksi. Periksa kabel USB webcam, lalu buka panel ini lagi.';
    kabar.className = 'panel-catatan buruk';
    kabar.hidden = false;
  } else if (!daftar[0].label) {
    kabar.textContent = `${daftar.length} kamera terdeteksi. Nyalakan kamera sekali supaya namanya terbaca.`;
    kabar.className = 'panel-catatan';
    kabar.hidden = false;
  } else {
    kabar.hidden = true;
  }
}

function lepasKamera() {
  aliranKamera?.getTracks().forEach((t) => t.stop());
  aliranKamera = null;
  for (const id of ['#video-member', '#video-rekam']) {
    const v = $(id);
    if (v) v.srcObject = null;
  }
}

/* ============================ PINDAI KARTU MEMBER ========================= */

let pemindaiMember = null;
let jedaTolakMember = null;
let jedaTerimaKasih = null;
let lanjutkanPindai = null;

async function mulaiPindaiMember() {
  keadaan.jalur = 'member';
  keLayar('member');

  const tirai = $('#tirai-member');
  const pesan = $('#tirai-member-pesan');
  tirai.hidden = false;
  pesan.textContent = 'Menyiapkan kamera…';

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    pesan.innerHTML = 'Kamera tidak tersedia.<br>Gunakan tombol <b>Ketik Manual</b>.';
    return;
  }

  let aliran;
  try {
    aliran = await bukaKamera({ audio: false });
  } catch (galat) {
    /*
     * Pesannya menyebut penyebab yang paling mungkin, bukan hanya nama galatnya.
     *
     * "NotReadableError" tidak berarti apa-apa bagi petugas yang berdiri di
     * depan antrean; "webcam dipakai aplikasi lain" bisa langsung ditindaklanjuti.
     */
    const sebab = {
      NotAllowedError: 'Izin kamera ditolak. Izinkan kamera di peramban.',
      NotFoundError: 'Kamera tidak ditemukan. Periksa kabel USB webcam.',
      NotReadableError: 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu.',
      OverconstrainedError: 'Kamera pilihan tidak ada lagi. Pilih ulang di panel petugas.',
    }[galat.name] || `Kamera gagal dinyalakan (${galat.name}).`;

    pesan.innerHTML = `${sebab}<br>Sementara ini gunakan <b>Ketik Manual</b>.`;
    return;
  }

  const video = $('#video-member');
  video.srcObject = aliran;
  await video.play();
  tirai.hidden = true;

  const kanvas = $('#kanvas-member');
  const konteks = kanvas.getContext('2d', { willReadFrequently: true });

  /*
   * Perulangan pindai disimpan supaya bisa dihidupkan lagi tanpa menyentuh
   * kamera. Sebelumnya interval hanya dihentikan saat QR terbaca; begitu QR itu
   * ditolak, tidak ada yang menyalakannya kembali dan kiosk berhenti memindai
   * untuk seluruh antrean berikutnya — kameranya tetap menyala, jadi tidak ada
   * tanda apa pun bahwa ia sudah mati.
   */
  lanjutkanPindai = () => {
    clearInterval(pemindaiMember);
    pemindaiMember = setInterval(pindaiSekali, 140);
  };

  const pindaiSekali = () => {
    if (video.readyState !== video.HAVE_ENOUGH_DATA) return;

    // Bingkai dikecilkan sebelum didekode: jsQR bekerja per piksel, dan
    // memberinya 1280x720 penuh membuat pratinjau tersendat.
    const skala = Math.min(1, 640 / video.videoWidth);
    kanvas.width = Math.round(video.videoWidth * skala);
    kanvas.height = Math.round(video.videoHeight * skala);
    konteks.drawImage(video, 0, 0, kanvas.width, kanvas.height);

    const bingkai = konteks.getImageData(0, 0, kanvas.width, kanvas.height);
    const hasil = typeof jsQR === 'function'
      ? jsQR(bingkai.data, bingkai.width, bingkai.height, { inversionAttempts: 'attemptBoth' })
      : null;

    $('.kamera-member').dataset.kena = hasil ? 'ya' : 'tidak';
    if (hasil?.data) {
      clearInterval(pemindaiMember);
      terimaKartuMember(hasil.data.trim());
    }
  };

  lanjutkanPindai();
}

async function terimaKartuMember(mentah) {
  let data = {};
  try {
    data = await (await fetch('/api/member', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kode: mentah }),
    })).json();
  } catch {
    data = { status: 'baru' };
  }

  // Yang disimpan adalah kode hasil penguraian server, bukan teks mentah QR.
  // Kartu berformat "PP-004821|Dimas Prayoga" akan tercetak utuh di struk
  // voucher bila teks mentahnya yang dipakai — nomor member bercampur nama.
  keadaan.memberId = (data.kode || String(mentah)).slice(0, 40);

  /*
   * Sudah pernah mengambil: dihentikan di sini, bukan setelah merekam.
   *
   * Kamera dibiarkan tetap menyala dan pesannya menghilang sendiri, supaya
   * antrean tidak tertahan menunggu seseorang menekan tombol — orang berikutnya
   * cukup mengangkat QR-nya.
   */
  if (data.status === 'sudah-ambil') {
    const nama = data.nama ? String(data.nama).toUpperCase() : '';
    $('#member-petunjuk').innerHTML = nama
      ? `<b>${nama}</b> sudah mengambil Gift Voucher<br><small>Satu member satu voucher</small>`
      : 'QR ini sudah pernah mengambil Gift Voucher';
    $('.kamera-member').dataset.kena = 'tolak';

    clearTimeout(jedaTolakMember);
    jedaTolakMember = setTimeout(() => {
      if (keadaan.layar !== 'member') return;
      $('#member-petunjuk').textContent = 'Arahkan QR profil PAM-PLUS ke kamera';
      $('.kamera-member').dataset.kena = 'tidak';
      keadaan.memberId = null;
      lanjutkanPindai?.();
    }, 4000);
    return;
  }

  if (data.nama) {
    // Nama sudah ada di kartu: tamu tidak perlu mengetik apa pun lagi. Meminta
    // ia mengetik ulang nama yang baru saja dibaca mesin adalah langkah yang
    // hanya memperlambat antrean dan mengundang salah ketik.
    keadaan.nama = String(data.nama).toUpperCase().slice(0, BATAS.nama);

    keadaan.nomorHp = data.nomorHp || '';

    $('#member-petunjuk').innerHTML = `Halo, <b>${keadaan.nama}</b>`;
    $('.kamera-member').dataset.kena = 'ya';

    // Jeda sesaat supaya tamu sempat melihat kartunya dikenali, lalu ke layar
    // konfirmasi. Data keanggotaan bisa tertukar atau tertinggal versi, dan
    // struk voucher yang tercetak atas nama orang lain tidak bisa ditarik
    // kembali — jadi tamu memastikannya sendiri sebelum lanjut.
    setTimeout(() => {
      lepasKamera();
      keKonfirmasi();
    }, 900);
    return;
  }

  // Kartu di luar daftar tetap dilayani; ia hanya mengetik namanya sendiri.
  // Menolaknya di sini berarti menahan pemegang kartu sah hanya karena daftar
  // di kiosk belum diperbarui.
  $('#member-petunjuk').textContent = 'QR terbaca \u2014 silakan ketik namamu';
  lanjutKeNama();
}

function lanjutKeNama() {
  clearInterval(pemindaiMember);
  lepasKamera();
  keLayar('nama');
  gambarUlangMasukan();
}

/* ============================== KONFIRMASI ================================ */

function keKonfirmasi() {
  const isi = (id, nilai, kelas) => {
    const el = $(id);
    if (!el) return;
    el.textContent = nilai || 'tidak tercatat';
    el.className = nilai ? (kelas ?? '') : 'kosong';
  };

  $('#konf-nama').textContent = keadaan.nama;
  isi('#konf-nama-nilai', keadaan.nama);
  isi('#konf-id', keadaan.memberId, 'angka');
  isi('#konf-hp', keadaan.nomorHp, 'angka');

  keLayar('konfirmasi');
}

/* =============================== SIAP-SIAP ================================ */

let timerSiap = null;

function keSiap() {
  $('#siap-sapaan').textContent = keadaan.nama.trim();
  keLayar('siap');

  // Kamera dinyalakan sekarang, bukan saat hitungan mundur dimulai, supaya
  // izin dan waktu penyalaan perangkat tidak memakan detik-detik aba-aba.
  bukaKamera({ audio: true }).catch(() => {});

  let sisa = atur.siapDetik;
  $('#siap-sisa').textContent = sisa;

  clearInterval(timerSiap);
  timerSiap = setInterval(() => {
    sisa -= 1;
    $('#siap-sisa').textContent = Math.max(sisa, 0);
    if (sisa <= 0) {
      clearInterval(timerSiap);
      mulaiRekam();
    }
  }, 1000);
}

/* ================================ MEREKAM ================================= */

let perekam = null;
let timerAba = null;
let timerRekam = null;

/*
 * Rekaman minimum sebelum tombol Selesai bisa ditekan.
 *
 * Tamu boleh berhenti kapan saja setelah ambang ini — tidak semua orang butuh
 * lima belas detik, dan menahan mereka menatap kamera sampai waktunya habis
 * memperlambat antrean tanpa alasan. Tetapi klip satu detik tidak berguna bagi
 * siapa pun, dan tamu yang gugup cenderung menekan apa pun yang terlihat.
 */
const MIN_REKAM_DETIK = 3;

async function mulaiRekam() {
  clearInterval(timerSiap);
  keadaan.blobRekaman = null;
  keadaan.blobMentah = null;
  keadaan.videoId = null;
  keadaan.videoMentahId = null;

  keLayar('rekam');
  $('#tanda-rekam').hidden = true;
  $('#bilah-isi').style.width = '0%';
  $('#rekam-pesan').textContent = 'Bersiap…';

  let aliran;
  try {
    aliran = await bukaKamera({ audio: true });
  } catch (galat) {
    alert(
      galat.name === 'NotAllowedError'
        ? 'Izin kamera/mikrofon ditolak. Tidak bisa merekam ucapan.'
        : `Kamera gagal dinyalakan: ${galat.name}`
    );
    keLayar('siap');
    return;
  }

  const video = $('#video-rekam');
  video.srcObject = aliran;
  await video.play();

  /*
   * Bingkai disiapkan selama hitungan mundur, bukan saat perekaman dimulai.
   *
   * Memuat gambar 1,2 MB tepat pada detik pertama rekaman membuat bingkai
   * pertama terlewat dan awal ucapan tamu terekam tanpa hiasan. Hitungan
   * mundur memberi jeda beberapa detik yang memang sudah ada.
   */
  siapkanBingkai().catch(() => {});

  hitungAbaAba(aliran);
}

function hitungAbaAba(aliran) {
  const kotak = $('#aba-aba');
  const angka = $('#aba-angka');

  let sisa = atur.abaDetik;
  kotak.hidden = false;
  angka.textContent = sisa;
  $('#rekam-pesan').textContent = 'Bersiap…';

  clearInterval(timerAba);
  timerAba = setInterval(() => {
    sisa -= 1;
    if (sisa > 0) {
      angka.textContent = sisa;
      // Elemen diganti agar animasi denyutnya dimulai ulang tiap detik;
      // tanpa itu hanya angka pertama yang terlihat berdenyut.
      angka.style.animation = 'none';
      void angka.offsetWidth;
      angka.style.animation = '';
      return;
    }
    clearInterval(timerAba);
    kotak.hidden = true;
    rekamSekarang(aliran);
  }, 1000);
}

/** Pilih wadah rekaman yang benar-benar didukung peramban ini. */
function tipeRekaman() {
  const pilihan = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    // Safari menghasilkan MP4, bukan WebM. Tanpa cadangan ini, MediaRecorder
    // di Safari gagal dibuat dan seluruh alur perekaman mati diam-diam.
    'video/mp4',
  ];
  return pilihan.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

/* ============================== BINGKAI VIDEO ============================= */

let setelanBingkai = null;
let gambarBingkai = null;
let kanvasBingkai = null;
let gambarUlangBingkai = null;
let perekamMentah = null;

/** Ambil setelan bingkai dan muat gambarnya sekali, lalu simpan di ingatan. */
async function siapkanBingkai() {
  if (setelanBingkai && gambarBingkai) return setelanBingkai;

  try {
    setelanBingkai = await (await fetch('/api/bingkai')).json();
  } catch {
    setelanBingkai = { aktif: 0 };
    return setelanBingkai;
  }

  if (!setelanBingkai.aktif || !setelanBingkai.ada) return setelanBingkai;

  gambarBingkai = await new Promise((selesai) => {
    const img = new Image();
    img.onload = () => selesai(img);
    // Bingkai yang gagal dimuat TIDAK menghentikan perekaman. Tamu sudah
    // berdiri di depan kamera; kehilangan hiasan jauh lebih ringan daripada
    // kehilangan ucapannya.
    img.onerror = () => selesai(null);
    img.src = '/bingkai.png';
  });

  if (!gambarBingkai) setelanBingkai.aktif = 0;
  return setelanBingkai;
}

/**
 * Susun aliran berbingkai dari aliran kamera.
 *
 * Tiap bingkai gambar dilukis ke kanvas: video di bawah, berkas bingkai di
 * atasnya. Kanvas itu lalu dijadikan aliran video tersendiri, dan jalur suara
 * dari kamera disambungkan ke sana — captureStream tidak pernah membawa suara.
 *
 * Mengembalikan null bila bingkai dimatikan atau peramban tidak mendukungnya;
 * pemanggilnya lalu merekam apa adanya.
 */
function aliranBerbingkai(aliranAsal, setelan) {
  if (!setelan?.aktif || !gambarBingkai) return null;
  if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;

  const video = $('#video-rekam');
  const L = setelan.lebar;
  const T = setelan.tinggi;

  kanvasBingkai = document.createElement('canvas');
  kanvasBingkai.width = L;
  kanvasBingkai.height = T;
  const ctx = kanvasBingkai.getContext('2d', { alpha: false });

  const lukis = () => {
    ctx.fillStyle = setelan.latar || '#000000';
    ctx.fillRect(0, 0, L, T);

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    if (vw && vh) {
      /*
       * Video dipasang seperti `object-fit: contain`, lalu diperbesar oleh
       * skala. `cover` akan memotong bagian tepi tanpa memberi tahu siapa pun,
       * dan bagian yang terpotong itu justru wajah tamu di kamera lanskap yang
       * dipasang di kotak potret.
       */
      const dasar = Math.min(L / vw, T / vh);
      const skala = dasar * (setelan.skala / 100);
      const dw = vw * skala;
      const dh = vh * skala;
      const dx = (L - dw) / 2 + (setelan.geserX / 100) * L;
      const dy = (T - dh) / 2 + (setelan.geserY / 100) * T;
      ctx.drawImage(video, dx, dy, dw, dh);
    }

    ctx.drawImage(gambarBingkai, 0, 0, L, T);
    gambarUlangBingkai = requestAnimationFrame(lukis);
  };
  lukis();

  const aliran = kanvasBingkai.captureStream(25);
  for (const trek of aliranAsal.getAudioTracks()) aliran.addTrack(trek);
  return aliran;
}

function hentikanLukisBingkai() {
  cancelAnimationFrame(gambarUlangBingkai);
  gambarUlangBingkai = null;
  kanvasBingkai = null;
}

function rekamSekarang(aliran) {
  const mimeType = tipeRekaman();
  const potongan = [];
  const potonganMentah = [];

  /*
   * Dua perekam berjalan bersamaan: kanvas berbingkai dan kamera apa adanya.
   *
   * Menyusun bingkainya SESUDAH perekaman selesai akan jauh lebih ringan bagi
   * mesin, tetapi menuntut memutar ulang seluruh rekaman ke kanvas — lima
   * belas detik lagi untuk tiap tamu, di depan antrean. Merekam serentak
   * memakai lebih banyak tenaga tetapi tidak menambah waktu tunggu sedetik pun.
   */
  const berbingkai = aliranBerbingkai(aliran, setelanBingkai);

  try {
    perekam = mimeType
      ? new MediaRecorder(berbingkai ?? aliran, { mimeType })
      : new MediaRecorder(berbingkai ?? aliran);
  } catch (galat) {
    alert(`Perangkat ini tidak bisa merekam video: ${galat.message}`);
    hentikanLukisBingkai();
    keLayar('siap');
    return;
  }

  /*
   * Perekam mentah hanya dipasang bila bingkai memang dipakai.
   *
   * Tanpa bingkai, keduanya akan merekam hal yang persis sama — dua berkas
   * kembar yang memakan tenaga dan ruang tanpa menambah apa pun.
   */
  perekamMentah = null;
  if (berbingkai) {
    try {
      perekamMentah = mimeType ? new MediaRecorder(aliran, { mimeType }) : new MediaRecorder(aliran);
      perekamMentah.ondataavailable = (ev) => { if (ev.data?.size) potonganMentah.push(ev.data); };
      perekamMentah.onstop = () => {
        keadaan.blobMentah = new Blob(potonganMentah, { type: perekamMentah.mimeType || 'video/webm' });
      };
    } catch (galat) {
      // Mesin lemah bisa menolak perekam kedua. Rekaman berbingkai tetap jalan;
      // yang hilang hanya salinan mentahnya, dan itu bukan alasan menggagalkan
      // ucapan tamu yang sedang direkam.
      console.warn('[rekam] perekam mentah tidak bisa dipasang:', galat.name);
      perekamMentah = null;
    }
  }

  perekam.ondataavailable = (ev) => { if (ev.data?.size) potongan.push(ev.data); };

  perekam.onstop = () => {
    const jenis = perekam.mimeType || mimeType || 'video/webm';
    keadaan.blobRekaman = new Blob(potongan, { type: jenis });
    hentikanLukisBingkai();
    keTinjau();
  };

  perekam.start();
  perekamMentah?.start();

  $('#tanda-rekam').hidden = false;
  $('#rekam-pesan').textContent = 'Sampaikan ucapanmu untuk EWALK!';

  const tombol = $('#selesai-rekam');
  tombol.hidden = false;
  tombol.disabled = true;
  tombol.textContent = `Selesai (${MIN_REKAM_DETIK})`;

  let sisa = atur.rekamDetik;
  $('#rekam-sisa').textContent = sisa;
  $('#bilah-isi').style.width = '0%';

  clearInterval(timerRekam);
  timerRekam = setInterval(() => {
    sisa -= 1;
    $('#rekam-sisa').textContent = Math.max(sisa, 0);
    $('#bilah-isi').style.width = `${((atur.rekamDetik - sisa) / atur.rekamDetik) * 100}%`;

    const berjalan = atur.rekamDetik - sisa;
    if (berjalan < MIN_REKAM_DETIK) {
      tombol.textContent = `Selesai (${MIN_REKAM_DETIK - berjalan})`;
    } else if (tombol.disabled) {
      tombol.disabled = false;
      tombol.textContent = 'Selesai';
    }

    if (sisa <= 0) hentikanRekam();
  }, 1000);
}

/**
 * Hentikan perekaman — karena waktunya habis, atau karena tamu menekan Selesai.
 *
 * Aman dipanggil berkali-kali: penjaga di bawah mencegah stop kedua pada
 * perekam yang sudah berhenti, yang di sebagian peramban melempar galat dan
 * mematikan seluruh alur tepat sebelum rekamannya sempat disimpan.
 */
function hentikanRekam() {
  clearInterval(timerRekam);

  const tombol = $('#selesai-rekam');
  if (tombol) {
    tombol.hidden = true;
    tombol.disabled = true;
  }

  if (perekam?.state === 'recording') perekam.stop();
  if (perekamMentah?.state === 'recording') perekamMentah.stop();
}

/* ================================= TINJAU ================================= */

let urlPemutar = null;

function bebaskanPemutar() {
  if (urlPemutar) URL.revokeObjectURL(urlPemutar);
  urlPemutar = null;
  const v = $('#video-tinjau');
  if (v) v.removeAttribute('src');
}

function keTinjau() {
  /*
   * Tulisan disesuaikan supaya tidak menjanjikan struk yang tidak akan keluar.
   *
   * "Kirim & Cetak" pada alur tanpa hadiah membuat tamu menunggu di depan
   * printer yang memang tidak akan mengeluarkan apa pun.
   */
  const ajakan = $('#tinjau-ajakan');
  const tombol = $('#tombol-kirim');
  if (ajakan && tombol) {
    if (keadaan.tanpaHadiah) {
      ajakan.textContent = 'Sudah bagus? Kirim ucapanmu untuk EWALK.';
      tombol.textContent = 'Kirim Ucapan';
    } else {
      ajakan.textContent = 'Sudah bagus? Kirim dan strukmu akan tercetak.';
      tombol.textContent = 'Kirim & Cetak';
    }
  }

  bebaskanPemutar();

  urlPemutar = URL.createObjectURL(keadaan.blobRekaman);
  $('#video-tinjau').src = urlPemutar;
  $('#tinjau-sapaan').textContent = keadaan.nama.trim();
  $('#tinjau-status').textContent = 'Mengunggah rekaman…';

  keLayar('tinjau');
  lepasKamera();

  // Unggahan dimulai sekarang, selagi tamu menonton hasilnya. Menundanya sampai
  // tombol Kirim ditekan berarti beberapa megabita berpindah persis ketika
  // orang berikutnya sudah menunggu giliran.
  unggahRekaman();
}

async function unggahSatu(blob) {
  const respons = await fetch('/api/video', {
    method: 'POST',
    headers: { 'content-type': 'video/webm' },
    body: blob,
  });
  const data = await respons.json();
  if (!respons.ok) throw new Error(data.galat || 'gagal');
  return data.videoId;
}

async function unggahRekaman() {
  if (!keadaan.blobRekaman) return;

  try {
    keadaan.videoId = await unggahSatu(keadaan.blobRekaman);

    /*
     * Salinan mentah diunggah SESUDAH yang berbingkai, dan kegagalannya
     * diabaikan.
     *
     * Yang berbingkai adalah hasil yang dipakai; yang mentah hanya bahan
     * cadangan. Menggagalkan seluruh unggahan karena cadangannya tidak sampai
     * berarti membuang hasil yang sudah berhasil terkirim.
     */
    if (keadaan.blobMentah) {
      try {
        keadaan.videoMentahId = await unggahSatu(keadaan.blobMentah);
      } catch {
        keadaan.videoMentahId = null;
      }
    }

    $('#tinjau-status').textContent = 'Rekaman siap dikirim.';
  } catch (galat) {
    // Kegagalan unggah tidak menghentikan alur: strukmu tetap tercetak, hanya
    // tanpa video. Menahan tamu di sini akan menghentikan antrean karena
    // masalah yang tidak bisa ia perbaiki sendiri.
    keadaan.videoId = null;
    keadaan.videoMentahId = null;
    $('#tinjau-status').textContent = 'Rekaman gagal diunggah — struk tetap bisa dicetak.';
  }
}

/* ================================== KIRIM ================================= */

async function kirim() {
  // Layar proses juga tidak boleh menyebut cetakan pada alur tanpa hadiah.
  const jd = $('#proses-judul');
  const aj = $('#proses-ajakan');
  if (jd && aj) {
    jd.textContent = keadaan.tanpaHadiah ? 'Menyimpan ucapanmu…' : 'Mencetak undanganmu…';
    aj.textContent = keadaan.tanpaHadiah ? 'Sebentar saja' : 'Ambil struk yang keluar dari mesin';
  }

  keLayar('proses');

  let data;
  try {
    const respons = await fetch('/api/daftar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nama: keadaan.nama.trim(),
        jenis: keadaan.tanpaHadiah ? 'tanpaHadiah'
             : keadaan.jalur === 'member' ? 'voucher' : 'undangan',
        memberId: keadaan.memberId,
        videoId: keadaan.videoId,
        videoMentahId: keadaan.videoMentahId,
      }),
    });
    data = await respons.json();

    /*
     * Jatah sudah terpakai bukan "kendala" — tidak ada yang bisa diperbaiki
     * dengan mengulang, jadi tamu dikembalikan ke awal alih-alih ditinggalkan
     * di layar tinjau dengan tombol yang akan gagal lagi setiap kali ditekan.
     */
    if (respons.status === 409 && data.kode === 'sudah-ambil') {
      alert(`${data.nama || 'Nomor keanggotaan ini'} sudah pernah mengambil Gift Voucher.\n\nSatu member satu voucher.`);
      return mulaiUlang();
    }

    if (!respons.ok) throw new Error(data.galat || 'Gagal mendaftar');
  } catch (galat) {
    alert(`Maaf, terjadi kendala: ${galat.message}`);
    keLayar('tinjau');
    return;
  }

  keadaan.kodeTerakhir = data.kode;

  /*
   * Tanpa hadiah berhenti di sini.
   *
   * Tidak ada QR, tidak ada kode, tidak ada struk — jadi layar hasil yang
   * seluruh isinya tentang ketiga hal itu tidak punya apa pun untuk
   * ditampilkan. Tamu diberi ucapan terima kasih, lalu kiosk kembali sendiri.
   */
  if (keadaan.tanpaHadiah) {
    $('#selesai-pesan').textContent = 'Ucapanmu sudah tersimpan. Terima kasih sudah ikut merayakan!';
    keLayar('selesai-rekam');
    mulaiHitungMundur('#hitung-mundur-2');
    return;
  }

  $('#hasil-nama').textContent = data.nama;
  $('#hasil-qr').src = data.qr;

  /*
   * Layar hasil menampilkan hal yang SAMA dengan kertasnya.
   *
   * Untuk voucher, yang tercetak di bawah QR adalah kode promo — itu yang
   * dibaca kasir. Menampilkan kode tamu di layar membuat dua angka berbeda
   * beredar untuk satu orang, dan yang salah satunya akan ditunjukkan tamu ke
   * kasir saat strukanya terselip.
   */
  const voucher = data.jenis === 'voucher';
  $('#hasil-kode').textContent = voucher ? (data.kodePromo || data.kode) : data.kode;
  $('#hasil-kelir').textContent = voucher ? 'Gift Voucher untuk' : 'Undangan untuk';
  $('#hasil-qr').alt = voucher ? 'Kode QR gift voucher' : 'Kode QR undangan';

  if (data.tercetak === false) {
    catatanCetak(false);
  } else {
    $('#hasil-catatan').innerHTML = 'Strukmu sedang dicetak…';
    pantauCetak(data.kode);
  }

  keLayar('hasil');
  bebaskanPemutar();
  mulaiHitungMundur();
}

function catatanCetak(berhasil) {
  const voucher = keadaan.jalur === 'member';
  $('#hasil-catatan').innerHTML = berhasil
    ? (voucher ? 'Ambil strukmu — tunjukkan QR ini untuk klaim voucher' : 'Ambil strukmu, lalu pindai QR-nya')
    : '<b>Struk tidak tercetak.</b> Pindai QR di bawah ini sekarang.';
}

let timerCetak = null;

function pantauCetak(kode) {
  clearInterval(timerCetak);
  const berhenti = Date.now() + 20000;

  timerCetak = setInterval(async () => {
    if (Date.now() > berhenti) return clearInterval(timerCetak);

    let hasil;
    try {
      hasil = await (await fetch(`/api/hasil-cetak/${kode}`)).json();
    } catch {
      return;
    }
    if (!hasil.selesai) return;

    clearInterval(timerCetak);
    catatanCetak(hasil.tercetak);
  }, 400);
}

/* ============================ HITUNG MUNDUR HASIL ========================= */

let timerMundur = null;
let timerJeda = null;

function mulaiHitungMundur(sasaran = '#hitung-mundur') {
  clearInterval(timerMundur);
  let sisa = atur.hasilDetik;
  // Layar penutup tanpa struk memakai labelnya sendiri; keduanya berbagi
  // pewaktu yang sama supaya tidak ada dua hitungan berjalan bersamaan.
  const label = $(sasaran) ?? $('#hitung-mundur');
  label.textContent = `(${sisa})`;

  timerMundur = setInterval(() => {
    sisa -= 1;
    label.textContent = sisa > 0 ? `(${sisa})` : '';
    if (sisa <= 0) {
      clearInterval(timerMundur);
      mulaiUlang();
    }
  }, 1000);
}

async function cetakUlang() {
  if (!keadaan.kodeTerakhir) return;

  const tombol = $('[data-aksi="cetak-ulang"]');
  if (tombol.disabled) return;

  clearInterval(timerMundur);
  tombol.disabled = true;
  tombol.textContent = 'Mencetak…';

  let data = {};
  try {
    data = await (await fetch(`/api/cetak-ulang/${keadaan.kodeTerakhir}`, { method: 'POST' })).json();
  } catch {
    data = { tercetak: false, galatCetak: 'kiosk tidak merespons' };
  }

  catatanCetak(Boolean(data.tercetak));
  if (!data.tercetak) alert(`Printer masih bermasalah:\n${data.galatCetak || 'tidak diketahui'}`);

  mulaiJedaCetakUlang();
  mulaiHitungMundur();
}

function mulaiJedaCetakUlang() {
  const tombol = $('[data-aksi="cetak-ulang"]');
  clearInterval(timerJeda);

  let sisa = atur.jedaCetakUlang;
  tombol.disabled = true;
  tombol.textContent = `Tunggu (${sisa})`;

  timerJeda = setInterval(() => {
    sisa -= 1;
    if (sisa > 0) return void (tombol.textContent = `Tunggu (${sisa})`);
    clearInterval(timerJeda);
    tombol.disabled = false;
    tombol.textContent = 'Cetak Ulang';
  }, 1000);
}

function hentikanSemuaTimer() {
  for (const t of [timerSiap, timerAba, timerRekam, timerCetak, timerMundur, timerJeda, pemindaiMember]) {
    clearInterval(t);
  }
  clearTimeout(jedaDiam);
  clearTimeout(jedaTolakMember);
  clearTimeout(jedaTerimaKasih);
  if (perekam?.state === 'recording') {
    // Lepas penangan sebelum berhenti: onstop yang tersisa akan melompat ke
    // layar tinjau tepat setelah kiosk direset untuk tamu berikutnya.
    perekam.onstop = null;
    perekam.stop();
  }
  perekam = null;
}

/* ================================ STATUS ================================== */

async function segarkanStatus() {
  let s;
  try {
    s = await (await fetch('/api/status')).json();
  } catch {
    return;
  }

  /*
   * Judul acara diambil dari server, bukan ditulis tetap di HTML.
   *
   * Sebelumnya nama acara ada di dua tempat — NAMA_ACARA untuk struk dan
   * tulisan tetap di halaman — sehingga mengubah salah satunya membuat kertas
   * dan layar menyebut acara yang berbeda, tanpa ada yang menyadarinya sampai
   * tamu membandingkan keduanya.
   */
  if (s.acara) {
    for (const id of ['#judul-acara-pilih', '#judul-acara']) {
      const el = $(id);
      if (el && el.textContent !== s.acara) el.textContent = s.acara;
    }
  }

  const lampu = $('#lampu');
  const printerBermasalah = !s.printer.siap;
  const adaTertunda = s.sinkron.tertunda > 0;
  lampu.dataset.keadaan = printerBermasalah ? 'bahaya' : adaTertunda ? 'tertunda' : 'baik';

  $('#rincian-status').innerHTML = `
    <dt>Printer</dt><dd class="${s.printer.siap ? 'baik' : 'buruk'}">${
      // Kata "Printer" di awal keterangan dibuang: barisnya sudah berlabel
      // "Printer", dan mengulangnya memakan tiga baris di panel untuk pesan
      // yang muat dalam satu.
      String(s.printer.keterangan || '').replace(/^Printer\s+/i, '')
    }</dd>
    <dt>Tamu terdaftar</dt><dd>${s.sinkron.total}</dd>
    <dt>Belum terkirim</dt><dd class="${adaTertunda ? 'buruk' : 'baik'}">${s.sinkron.tertunda}</dd>
    <dt>Server undangan</dt><dd class="${s.sinkron.daring === false ? 'buruk' : 'baik'}">${
      s.sinkron.daring === null ? 'belum dicoba' : s.sinkron.daring ? 'terhubung' : 'tidak terhubung'
    }</dd>
    <dt>Mode</dt><dd>${s.dryRun ? 'UJI (tanpa printer)' : 'normal'}</dd>
  `;
}

/* =============================== PENGATURAN =============================== */

/**
 * Ambil pengaturan waktu dari server dan terapkan ke layar.
 *
 * Dipanggil saat kiosk dimuat dan setiap kali petugas mengubahnya, jadi
 * perubahan langsung berlaku untuk tamu berikutnya tanpa menyalakan ulang
 * apa pun.
 */
async function muatPengaturan() {
  try {
    const { nilai, batas } = await (await fetch('/api/pengaturan')).json();
    Object.assign(atur, nilai);
    batasAtur = batas;
  } catch {
    // Server belum siap; nilai cadangan di objek `atur` tetap dipakai supaya
    // kiosk tidak berhenti hanya karena setelan gagal diambil.
    return;
  }

  const teks = $('#teks-durasi');
  if (teks) teks.textContent = atur.rekamDetik;
  terapkanPutaran();
  terapkanModeMember();
  gambarSetelan();
}

/**
 * Sembunyikan jalur ketik nama, dan tampilkan sisa gift voucher.
 *
 * Saat kiosk dikhususkan untuk pemegang kartu, tamu umum harus tahu itu
 * SEBELUM mengantre — bukan setelah mengetik nama dan merekam video.
 */
/// Sisa voucher terakhir yang diketahui. null berarti belum pernah terbaca.
let sisaVoucher = null;

async function terapkanModeMember() {
  const kartuTamu = $('#kartu-tamu');
  const ajakan = $('#ajakan-pilih');
  const sisa = $('#sisa-voucher');
  if (!kartuTamu || !sisa) return;

  const khusus = Number(atur.hanyaMember) === 1;
  kartuTamu.hidden = khusus;
  sisa.hidden = !khusus;

  // Tidak ada layar untuk dituju oleh "Kembali" ketika pindai kartu adalah
  // layar awalnya; tombolnya hanya akan memutar tamu kembali ke tempat sama.
  const kembali = $('[data-aksi="batal-member"]');
  if (kembali) kembali.hidden = khusus;

  const sisaMember = $('#sisa-voucher-member');
  if (sisaMember) sisaMember.hidden = !khusus;

  if (!khusus) {
    ajakan.innerHTML = 'Rekam video ucapanmu untuk <b>EWALK</b><br>dan bawa pulang undanganmu sendiri';
    // Sisa tetap dibaca: layar "habis" berlaku di kedua mode.
    try { sisaVoucher = (await (await fetch('/api/promo')).json()).sisa; } catch { /* biarkan */ }
    return;
  }

  ajakan.innerHTML = 'Khusus pemegang profil <b>PAM-PLUS</b>';

  let n = null;
  try {
    n = (await (await fetch('/api/promo')).json()).sisa;
    sisaVoucher = n;
  } catch {
    // Angka tidak bisa diambil; baris sisa dibiarkan apa adanya daripada
    // menampilkan angka yang mungkin salah.
    return;
  }

  const kelas = 'sisa-voucher' + (n === 0 ? ' habis' : n <= 10 ? ' menipis' : '');
  const teks = n === 0
    ? 'Gift Voucher sudah habis'
    : `Masih tersisa ${n} Gift Voucher \u2014 silakan scan QR profil PAM-PLUS di sini`;

  for (const el of [sisa, sisaMember]) {
    if (!el) continue;
    el.className = kelas;
    el.textContent = teks;
  }
}

/**
 * Pasang putaran layar, dan ingat pilihannya di peramban.
 *
 * Disimpan lokal supaya pemuatan berikutnya sudah terputar sejak bingkai
 * pertama. Tanpa itu, setiap kali kiosk dimuat ulang tamu melihat layar tegak
 * berkedip miring sesaat — di TV yang digantung tetap, itu terlihat seperti
 * perangkat yang rusak.
 */
function terapkanPutaran() {
  /*
   * `?putar=` menimpa setelan tersimpan, tanpa mengubahnya.
   *
   * Dipakai halaman pratinjau agar bisa menunjukkan tampilan TV yang dimiringkan
   * sementara kiosk di layar penyetel tetap tegak dan bisa dipakai. Tanpa
   * pemisahan ini, memeriksa mode TV berarti membuat kiosk yang sedang dipakai
   * ikut miring.
   */
  /*
   * Keberadaan parameter diperiksa DULU, sebelum nilainya diangkakan.
   *
   * `Number(null)` bernilai 0, dan 0 adalah rotasi yang sah — jadi memeriksa
   * angkanya lebih dulu membuat penimpaan selalu aktif dengan nilai 0, bahkan
   * pada alamat tanpa ?putar= sama sekali. Akibatnya setelan tersimpan tidak
   * pernah terpakai: menekan Putar layar di panel tampak tidak melakukan apa-apa.
   */
  const mentah = new URLSearchParams(location.search).get('putar');
  const paksa = mentah === null ? null : Number(mentah);
  const adaPaksaan = paksa !== null && [0, 90, 270].includes(paksa);

  const dipilih = adaPaksaan ? paksa : atur.putarLayar;
  const derajat = [0, 90, 270].includes(dipilih) ? dipilih : 0;
  document.documentElement.dataset.putar = String(derajat);

  // Nilai paksaan tidak ikut disimpan: ia milik satu pratinjau, bukan setelan
  // perangkat.
  if (adaPaksaan) return;

  try {
    localStorage.setItem('putarLayar', String(derajat));
  } catch {
    // Mode penjelajahan pribadi menolak penyimpanan; putaran tetap berlaku
    // untuk sesi ini, hanya tidak diingat.
  }
}

function gambarSetelan() {
  const wadah = $('#setelan');
  if (!wadah || !Object.keys(batasAtur).length) return;

  wadah.innerHTML = '';
  for (const [kunci, batas] of Object.entries(batasAtur)) {
    const daftar = batas.pilihan ?? null;
    const nilai = atur[kunci];
    const posisi = daftar ? daftar.indexOf(nilai) : -1;

    /*
     * Satuan mengikuti arti nilainya, bukan bentuk kontrolnya.
     *
     * Semua pengaturan berdaftar sempat diberi tanda derajat, sehingga
     * "Khusus member saja" tampil sebagai "1°" — angka yang tidak berarti
     * apa-apa bagi petugas yang membacanya.
     */
    const yaTidak = daftar && daftar.length === 2 && daftar[0] === 0 && daftar[1] === 1;
    const keterangan = yaTidak ? 'mati / nyala'
      : daftar ? daftar.map((d) => d + '\u00b0').join(' / ')
      : `${batas.min}\u2013${batas.maks} detik`;
    const tampil = yaTidak ? (nilai ? 'NYALA' : 'mati')
      : daftar ? `${nilai}&deg;`
      : `${nilai}<small> dtk</small>`;

    const baris = el('div', 'setelan-baris');
    baris.innerHTML = `
      <div class="setelan-label">${batas.label}
        <small>${keterangan}</small>
      </div>
      <div class="setelan-atur">
        <button class="setelan-tombol" type="button" data-atur="${kunci}" data-arah="-1">-</button>
        <div class="setelan-nilai">${tampil}</div>
        <button class="setelan-tombol" type="button" data-atur="${kunci}" data-arah="1">+</button>
      </div>`;

    // Tombol dimatikan di ujung, bukan diam-diam mengabaikan tekanan — tombol
    // yang ditekan tanpa reaksi terbaca sebagai kiosk yang macet.
    baris.querySelector('[data-arah="-1"]').disabled = daftar ? posisi <= 0 : nilai <= batas.min;
    baris.querySelector('[data-arah="1"]').disabled = daftar
      ? posisi >= daftar.length - 1
      : nilai >= batas.maks;

    wadah.append(baris);
  }
}

let simpanTertunda = null;

function ubahSetelan(kunci, arah) {
  const batas = batasAtur[kunci];
  if (!batas) return;

  let baru;
  if (batas.pilihan) {
    const i = batas.pilihan.indexOf(atur[kunci]);
    baru = batas.pilihan[Math.min(Math.max(i + arah, 0), batas.pilihan.length - 1)];
  } else {
    baru = Math.min(Math.max(atur[kunci] + arah, batas.min), batas.maks);
  }
  if (baru === atur[kunci]) return;

  atur[kunci] = baru;
  gambarSetelan();

  if (kunci === 'putarLayar') terapkanPutaran();
  if (kunci === 'hanyaMember') {
    terapkanModeMember().then(() => {
      // Menyalakan mode ini di tengah acara harus langsung terlihat: petugas
      // menutup panel dan kamera sudah siap, tanpa perlu memuat ulang halaman.
      if (Number(atur.hanyaMember) === 1 && keadaan.layar === 'pilih') mulaiPindaiMember();
    });
  }

  if (kunci === 'rekamDetik') {
    const teks = $('#teks-durasi');
    if (teks) teks.textContent = baru;
  }

  // Penyimpanan ditunda sebentar supaya menekan tombol beberapa kali berturut-
  // turut menghasilkan satu tulisan ke disk, bukan satu tulisan per ketukan.
  clearTimeout(simpanTertunda);
  simpanTertunda = setTimeout(() => {
    fetch('/api/pengaturan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(atur),
    }).catch(() => {});
  }, 600);
}

/* ================================= PEREKAT ================================ */

document.addEventListener('DOMContentLoaded', () => {
  gambarPapan($('[data-papan="nama"]'), 'nama');

  document.addEventListener('click', (ev) => {
    const setel = ev.target.closest('[data-atur]');
    if (setel) return ubahSetelan(setel.dataset.atur, Number(setel.dataset.arah));

    const t = ev.target.closest('[data-peran], [data-aksi]');
    aturJedaDiam();
    if (!t) return;

    switch (t.dataset.peran) {
      case 'huruf': return ketik(t.dataset.nilai);
      case 'spasi': return ketik(' ');
      case 'hapus': return hapus();
    }

    switch (t.dataset.aksi) {
      case 'jalur-tamu':
        keadaan.jalur = 'tamu';
        return lanjutKeNama();
      case 'habis-lanjut':
        /*
         * Lanjut tanpa hadiah. Alurnya sama persis sampai selesai merekam;
         * yang berbeda hanya di ujungnya — tidak ada kode diambil dan tidak
         * ada kertas keluar.
         */
        keadaan.tanpaHadiah = true;
        return mulaiPindaiMember();

      case 'habis-tidak':
        keLayar('terimakasih');
        // Kembali sendiri supaya tamu berikutnya tidak menemukan layar ucapan
        // terima kasih milik orang sebelumnya.
        clearTimeout(jedaTerimaKasih);
        jedaTerimaKasih = setTimeout(mulaiUlang, 4000);
        return;

      case 'jalur-member':
        return mulaiPindaiMember();
      case 'batal-member':
        clearInterval(pemindaiMember);
        lepasKamera();
        return mulaiUlang();
      case 'lewati-member':
        return lanjutKeNama();

      case 'bersih':
        keadaan[ladang()] = '';
        return gambarUlangMasukan();
      case 'lanjut':
        return keSiap();
      case 'konf-benar':
        return keSiap();

      case 'konf-salah':
        // Kembali memindai, bukan kembali ke awal: yang salah kartunya, bukan
        // pilihan jalurnya.
        return mulaiPindaiMember();

      case 'kembali-pilih':
        // Tamu yang salah memilih jalur harus bisa mundur tanpa menunggu
        // waktu diam habis; di depan antrean, menunggu itu terasa macet.
        return mulaiUlang();

      case 'kembali':
        return keLayar('nama');
      case 'kirim':
        return keSiap();

      case 'selesai-rekam':
        return hentikanRekam();

      case 'mulai-rekam':
        return mulaiRekam();
      case 'batal-rekam':
        clearInterval(timerSiap);
        lepasKamera();
        return keLayar('nama');

      case 'ulangi-rekam':
        bebaskanPemutar();
        return mulaiRekam();
      case 'kirim-rekaman':
        return kirim();

      case 'cetak-ulang': return cetakUlang();
      case 'selesai':
        clearInterval(timerMundur);
        return mulaiUlang();
      case 'pulihkan-printer':
        return fetch('/api/printer/pulihkan', { method: 'POST' }).then(segarkanStatus);
      case 'tutup-panel':
        return void ($('#tirai').hidden = true);
    }
  });

  /*
   * Pemilih kamera pindah ke halaman Perangkat, yang punya pratinjau dan meter
   * suara. Penangan ini dibiarkan berpenjaga supaya halaman yang masih memuat
   * pemilihnya tetap bekerja.
   */
  const pilihKamera = $('#pilih-kamera');
  if (pilihKamera) {
    pilihKamera.addEventListener('change', () => {
      simpanKamera(pilihKamera.value);

      /*
       * Aliran yang sedang jalan dilepas, bukan dibiarkan.
       *
       * bukaKamera memakai ulang aliran yang masih hidup, jadi tanpa ini kamera
       * lama tetap terpakai sampai kiosk kebetulan melepasnya sendiri — dan
       * petugas menyimpulkan pemilihnya tidak berfungsi.
       */
      lepasKamera();
      segarkanDaftarKamera();

      // Layar pindai dihidupkan ulang supaya pergantiannya langsung terlihat.
      if (keadaan.layar === 'member') mulaiPindaiMember();
    });
  }

  /*
   * Webcam USB dicabut atau dicolok saat kiosk hidup.
   *
   * Daftar di panel ikut berubah, dan kalau yang tercabut adalah kamera yang
   * sedang dipakai, pilihannya dilupakan supaya percobaan berikutnya jatuh ke
   * kamera yang masih ada alih-alih gagal berulang-ulang.
   */
  navigator.mediaDevices?.addEventListener?.('devicechange', async () => {
    const tersimpan = kameraTersimpan();
    if (tersimpan) {
      try {
        const ada = (await navigator.mediaDevices.enumerateDevices())
          .some((d) => d.kind === 'videoinput' && d.deviceId === tersimpan);
        if (!ada) {
          console.warn('[kamera] perangkat pilihan dicabut; kembali ke otomatis');
          simpanKamera('');
        }
      } catch { /* daftar tidak terbaca; biarkan bukaKamera yang menanganinya */ }
    }
    if (!$('#tirai').hidden) segarkanDaftarKamera();
  });

  // Panel petugas: tiga ketukan pada lampu status dalam dua detik. Gerakan ini
  // tidak mungkin terpicu tanpa sengaja oleh tamu, dan tidak menuntut papan
  // ketik fisik yang memang tidak ada di kiosk.
  $('#lampu').addEventListener('click', () => {
    keadaan.ketukLampu += 1;
    clearTimeout($('#lampu')._jeda);
    $('#lampu')._jeda = setTimeout(() => { keadaan.ketukLampu = 0; }, 2000);
    if (keadaan.ketukLampu >= 3) {
      keadaan.ketukLampu = 0;
      segarkanStatus();
      segarkanDaftarKamera();
      $('#tirai').hidden = false;
    }
  });

  // Papan ketik fisik tetap dilayani: berguna saat pengembangan, dan sebagai
  // jalan keluar bila lapisan sentuh layar bermasalah saat acara.
  document.addEventListener('keydown', (ev) => {
    if (!$('#tirai').hidden) return;
    if (keadaan.layar !== 'nama') return;

    if (ev.key === 'Backspace') { ev.preventDefault(); return hapus(); }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (keadaan.layar === 'nama' && keadaan.nama.trim().length >= 2) {
        if (keadaan.jalur === 'member') return keSiap();
        return keSiap();
      }
      return;
    }
    if (ev.key.length === 1) { ev.preventDefault(); ketik(ev.key.toUpperCase()); }
  });

  document.addEventListener('gesturestart', (ev) => ev.preventDefault());
  document.addEventListener('contextmenu', (ev) => ev.preventDefault());
  window.addEventListener('pagehide', () => { hentikanSemuaTimer(); lepasKamera(); });

  /*
   * Setelan dimuat lebih dulu, baru layar disiapkan.
   *
   * Keduanya sempat dijalankan berbarengan, sehingga mulaiUlang membaca
   * hanyaMember yang masih bernilai bawaan dan kiosk membuka layar pilih —
   * kamera baru menyala setelah tamu pertama menekan sesuatu, persis yang tidak
   * diinginkan.
   */
  muatPengaturan().finally(mulaiUlang);

  // Gambar bingkai dimuat sejak kiosk menyala supaya tamu pertama tidak
  // menunggu unduhannya.
  siapkanBingkai().catch(() => {});
  segarkanStatus();
  setInterval(segarkanStatus, 10_000);
});
