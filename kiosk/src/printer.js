/**
 * Pengiriman byte mentah ke printer struk, dan penyusunan tata letak struknya.
 *
 * Sengaja tidak memakai pustaka USB native (libusb/node-usb). Di Windows,
 * libusb menuntut driver bawaan printer diganti lewat Zadig — begitu diganti,
 * printer hilang dari daftar Printer & Scanner dan tidak bisa dipakai aplikasi
 * lain. Untuk kiosk yang harus dirakit ulang di lokasi acara oleh orang yang
 * bukan programmer, itu terlalu rapuh. Maka: tulis ke berkas sementara, lalu
 * serahkan ke mekanisme cetak mentah bawaan sistem operasi.
 */

import { execFile } from 'node:child_process';
import net from 'node:net';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Struk } from './escpos.js';

const jalankan = promisify(execFile);

export class Printer {
  constructor({ nama, host, port = 9100, lebarMm = 58, qrModul = 10, dryRun = false, folderDryRun }) {
    this.nama = nama;
    this.host = host || null;
    this.port = Number(port) || 9100;
    this.lebarMm = Number(lebarMm) || 58;
    this.qrModul = Number(qrModul) || 10;
    this.dryRun = Boolean(dryRun);
    this.folderDryRun = folderDryRun;
    this.galatTerakhir = null;
  }

  /** True bila printer dijangkau lewat jaringan, bukan lewat antrian sistem. */
  get lewatJaringan() {
    return Boolean(this.host);
  }

  /**
   * Kirim byte ESC/POS langsung ke soket printer.
   *
   * Printer struk jaringan mendengarkan port 9100 dan menerima ESC/POS apa
   * adanya. Jalur ini justru LEBIH sederhana dan lebih jujur daripada lewat
   * CUPS: tidak ada antrian yang bisa menampung pekerjaan diam-diam untuk
   * printer yang sudah mati, dan tidak ada driver yang perlu dipasang di mesin
   * kiosk. Soket yang tersambung dan tuntas terkirim berarti byte-nya benar-
   * benar sampai ke perangkatnya.
   */
  /**
   * Sambungan tetap ke printer, dibuka sekali lalu dipakai ulang.
   *
   * Modul Ethernet printer Epson hanya melayani SATU sambungan pada satu waktu,
   * dan setelah sambungan diputus mendadak ia masih menganggap sesi itu hidup —
   * pada pengujian, port 9100 menolak sambungan baru lebih dari seratus detik
   * sementara port 80, 443, dan 515 tetap melayani dengan normal. Di tengah
   * acara itu berarti printer yang tampak sehat berhenti mencetak tanpa sebab
   * yang kelihatan.
   *
   * Menyambung sekali lalu memakainya berulang menghapus seluruh perilaku itu:
   * tidak ada putus-sambung yang perlu ditunggu printer, dan tidak ada sesi
   * menggantung yang bisa mengunci port.
   */
  async soketPrinter(tenggatMs = 6000) {
    if (this._soket && !this._soket.destroyed && this._soket.writable) return this._soket;

    const soket = await new Promise((selesai, gagal) => {
      const s = new net.Socket();
      let sudah = false;
      const tutup = (galat) => {
        if (sudah) return;
        sudah = true;
        if (galat) { s.destroy(); gagal(galat); } else { selesai(s); }
      };

      s.setTimeout(tenggatMs);
      s.once('timeout', () => tutup(new Error(`Printer ${this.host}:${this.port} tidak menjawab`)));
      s.once('error', (e) => tutup(new Error(jelaskanGalatJaringan(e, this.host, this.port))));
      s.connect(this.port, this.host, () => tutup(null));
    });

    // Setelah tersambung, batas waktu diam dimatikan: sambungan ini memang
    // dibiarkan menganggur di antara tamu, dan menutupnya sendiri hanya
    // mengembalikan masalah putus-sambung yang baru saja dihindari.
    soket.setTimeout(0);
    soket.setKeepAlive(true, 15000);

    // Sambungan yang putus dari sisi printer harus dilupakan, supaya cetak
    // berikutnya membangunnya kembali alih-alih menulis ke soket mati.
    const lupakan = () => { if (this._soket === soket) this._soket = null; };
    soket.once('close', lupakan);
    soket.once('error', lupakan);
    soket.once('end', lupakan);

    this._soket = soket;
    return soket;
  }

  /** Tutup sambungan tetap, bila ada. */
  putusPrinter() {
    if (this._soket && !this._soket.destroyed) this._soket.end();
    this._soket = null;
  }

  /**
   * Arahkan ke printer lain tanpa menyalakan ulang kiosk.
   *
   * Sambungan tetap ke printer lama WAJIB diputus lebih dulu. Tanpa itu, soket
   * lama tetap tersimpan di this._soket dan struk berikutnya dikirim ke alamat
   * yang baru saja ditinggalkan — kiosk melaporkan berhasil, kertas keluar di
   * printer yang salah, dan tidak ada galat di mana pun.
   */
  arahkanKe({ host = null, port = 9100, nama = null }) {
    const sama = this.host === (host || null) && this.nama === (nama ?? this.nama);
    if (sama && this.host) return false;

    this.putusPrinter();
    this.host = host || null;
    this.port = Number(port) || 9100;
    if (nama) this.nama = nama;
    this.galatTerakhir = null;
    // Singgahan kegagalan printer LAMA harus ikut dibuang; kalau tidak, printer
    // baru dilaporkan mati selama empat detik pertama tanpa pernah dicoba.
    this._gagalSampai = 0;
    this._gagalPesan = null;
    return true;
  }

  /**
   * Tulis satu struk ke sambungan tetap.
   *
   * Sambungan sengaja TIDAK ditutup sesudahnya. Printer tidak pernah membalas
   * apa pun, jadi kepastian terjauh yang bisa diperoleh adalah bahwa seluruh
   * isi buffer sudah diserahkan ke lapisan TCP — dan itulah yang ditunggu di
   * sini lewat callback write.
   */
  async kirimJaringan(buffer, tenggatMs = 10000) {
    const tulis = async () => {
      const soket = await this.soketPrinter();
      return new Promise((selesai, gagal) => {
        const jam = setTimeout(
          () => gagal(new Error(`Printer ${this.host} tidak menerima data`)),
          tenggatMs
        );
        soket.write(buffer, (e) => {
          clearTimeout(jam);
          e ? gagal(e) : selesai();
        });
      });
    };

    try {
      await tulis();
    } catch (galat) {
      // Sambungan yang tersimpan mungkin sudah mati tanpa sempat memberi kabar.
      // Satu kali bangun ulang membedakan printer yang benar-benar hilang dari
      // soket basi yang tinggal dibuang.
      this.putusPrinter();
      try {
        await tulis();
      } catch (galatKedua) {
        this.putusPrinter();
        throw galatKedua;
      }
    }
  }

  /**
   * Cek kesiapan printer jaringan.
   *
   * Memakai sambungan tetap yang sama dengan jalur cetak, bukan membuka
   * sambungan pemeriksa sendiri. Layar kiosk memanggil ini setiap sepuluh
   * detik; membuka dan menutup satu sambungan sesering itu ke printer yang
   * hanya melayani satu sesi adalah cara paling pasti untuk menguncinya.
   */
  async cekJaringan() {
    if (this._soket && !this._soket.destroyed && this._soket.writable) {
      return { siap: true, keterangan: 'siap' };
    }

    /*
     * Hasil buruk disinggahi sebentar.
     *
     * Menyambung ke printer yang mati memakan seluruh tenggat soket — sekitar
     * lima detik. Layar kiosk menanyakan status tiap sepuluh detik, dan penyala
     * menanyakannya berulang saat memeriksa kesiapan; tanpa singgahan ini,
     * printer mati membuat SELURUH kiosk tampak menggantung, dan petugas
     * menyimpulkan aplikasinya rusak padahal yang mati cuma printernya.
     *
     * Hasil BAIK tidak disinggahi: begitu printer tersambung, kiosk harus tahu
     * seketika, bukan beberapa detik kemudian.
     */
    if (this._gagalSampai && Date.now() < this._gagalSampai) {
      return { siap: false, keterangan: this._gagalPesan };
    }

    try {
      await this.soketPrinter(2500);
      this._gagalSampai = 0;
      return { siap: true, keterangan: 'siap' };
    } catch (galat) {
      this._gagalSampai = Date.now() + 4000;
      this._gagalPesan = galat.message;
      return { siap: false, keterangan: galat.message };
    }
  }

  /**
   * Kirim buffer ESC/POS ke printer dan tunggu sampai benar-benar tercetak.
   *
   * Baik `lp` di macOS maupun `copy` di Windows hanya MEMASUKKAN pekerjaan ke
   * antrian, lalu melaporkan sukses. Antrian milik printer yang mati atau
   * tercabut tetap menerima pekerjaan dengan patuh. Tanpa dua pemeriksaan di
   * bawah, kiosk akan memberi tahu tamu bahwa struknya tercetak sementara
   * tidak ada kertas yang keluar sama sekali — lalu seluruh tumpukan itu
   * muntah bersamaan saat kabelnya dicolok ulang.
   *
   * Melempar Error berbahasa Indonesia bila gagal, supaya layar kiosk bisa
   * menampilkannya apa adanya ke petugas.
   */
  async kirim(buffer, { tunggu = true } = {}) {
    if (this.dryRun) {
      await mkdir(this.folderDryRun, { recursive: true });
      const tujuan = path.join(this.folderDryRun, `struk-${Date.now()}.bin`);
      await writeFile(tujuan, buffer);
      this.galatTerakhir = null;
      return { dryRun: true, berkas: tujuan };
    }

    // Printer jaringan tidak diperiksa lebih dulu.
    //
    // Pra-periksa membuka satu sambungan TCP lalu langsung memutusnya, tepat
    // sebelum sambungan yang sesungguhnya. Banyak printer struk jaringan hanya
    // melayani satu sambungan pada satu waktu dan butuh sesaat untuk
    // melepaskannya, sehingga koneksi buangan itu justru bisa membuat cetakan
    // berikutnya ditolak. Tidak ada yang hilang dengan melewatinya: pengiriman
    // ke printer yang tak terjangkau tetap gagal dengan pesan yang sama.
    if (this.lewatJaringan) {
      try {
        await this.kirimJaringan(buffer);
        this.galatTerakhir = null;
        return { dryRun: false, terverifikasi: true };
      } catch (galat) {
        this.galatTerakhir = galat.message;
        throw galat;
      }
    }

    // Pemeriksaan pertama: jangan menitipkan apa pun ke antrian yang mati.
    const sebelum = await this.status();
    if (!sebelum.siap) {
      // Antrian yang sekadar dinonaktifkan bisa dihidupkan sendiri selama
      // perangkatnya ada; hanya kabel lepas yang benar-benar buntu.
      const dipulihkan = await this.pulihkanBilaPerlu();
      const kedua = dipulihkan ? await this.status() : sebelum;

      if (!kedua.siap) {
        const pesan = `Printer belum siap: ${kedua.keterangan}`;
        this.galatTerakhir = pesan;
        throw new Error(pesan);
      }
    }

    const sementara = path.join(tmpdir(), `struk-${process.pid}-${Date.now()}.bin`);
    await writeFile(sementara, buffer);

    let idPekerjaan = null;
    try {
      if (process.platform === 'win32') {
        // Printer harus di-share lebih dulu (Properties > Sharing). Menyalin ke
        // nama UNC-nya melewati spooler GDI, jadi byte ESC/POS sampai utuh.
        await jalankan('cmd', ['/c', 'copy', '/b', sementara, `\\\\localhost\\${this.nama}`]);
      } else {
        // -o raw memberi tahu CUPS untuk tidak menyentuh isinya sama sekali.
        const { stdout } = await jalankan('lp', ['-d', this.nama, '-o', 'raw', sementara]);
        // "request id is TECH_CLA58-9 (1 file(s))" — dicatat supaya pekerjaan
        // INI yang dibatalkan bila macet, bukan seluruh isi antrian. Membatalkan
        // semuanya akan ikut membuang struk tamu lain yang sedang menunggu
        // gilirannya keluar.
        idPekerjaan = stdout.match(/request id is (\S+)/)?.[1] ?? null;
      }
    } catch (galat) {
      const pesan = jelaskanGalat(galat, this.nama);
      this.galatTerakhir = pesan;
      throw new Error(pesan);
    } finally {
      await unlink(sementara).catch(() => {});
    }

    this.idPekerjaanTerakhir = idPekerjaan;

    // Pemeriksaan kedua: tunggu pekerjaan hilang dari antrian. Inilah satu-
    // satunya bukti bahwa kertasnya benar-benar keluar.
    //
    // Pemanggil boleh melewatinya dengan `tunggu: false` dan menjalankan
    // tungguAntrianKosong() sendiri di latar. Itu dipakai layar kiosk: struk
    // 58mm berisi QR butuh sekitar tujuh detik untuk keluar, dan menahan tamu
    // berdiri selama itu — dikali seratus tamu — memakan belasan menit antrean
    // tanpa menambah satu pun kepastian yang tidak bisa diperoleh sesudahnya.
    if (!tunggu) return { dryRun: false, terverifikasi: false };

    const tuntas = await this.tungguAntrianKosong();
    if (!tuntas) {
      // Pekerjaan yang tidak keluar dalam batas waktu tidak akan keluar sama
      // sekali. Dibiarkan menggantung, ia menghalangi seluruh antrian dan akan
      // muntah belakangan bersama struk tamu yang sudah lama pulang.
      await this.batalkanPekerjaan(idPekerjaan);

      const pesan = 'Struk tertahan di antrian — cek kertas dan lampu printer';
      this.galatTerakhir = pesan;
      throw new Error(pesan);
    }

    this.galatTerakhir = null;
    return { dryRun: false, terverifikasi: true };
  }

  /** Batalkan satu pekerjaan tertentu, bukan seluruh antrian. */
  async batalkanPekerjaan(id) {
    if (!id || this.dryRun) return;
    if (process.platform === 'win32') {
      await jalankan('powershell', [
        '-NoProfile', '-Command',
        `Get-PrintJob -PrinterName '${this.nama}' -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue`,
      ]).catch(() => {});
      return;
    }
    await jalankan('cancel', [id]).catch(() => {});
  }

  /**
   * Hidupkan kembali antrian yang mematikan dirinya sendiri, bila perangkatnya
   * memang ada.
   *
   * CUPS menonaktifkan antrian setiap kali gagal mengirim, dan TIDAK pernah
   * menyalakannya kembali sendiri. Tanpa ini, printer yang lepas satu detik
   * lalu tersambung lagi meninggalkan kiosk dalam keadaan mati sampai ada orang
   * yang menyadarinya dan menekan tombol — yang di tengah acara berarti antrean
   * tamu berhenti tanpa sebab yang kelihatan.
   *
   * Syarat "perangkatnya ada" penting: menyalakan antrian untuk printer yang
   * kabelnya memang lepas hanya membuat pekerjaan menumpuk diam-diam.
   */
  async pulihkanBilaPerlu() {
    // Printer jaringan tidak punya antrian yang bisa dinonaktifkan CUPS, jadi
    // tidak ada yang perlu dipulihkan — ia langsung siap begitu bisa dihubungi.
    if (this.dryRun || this.lewatJaringan || process.platform === 'win32') return null;

    if ((await this.perangkatAda()) !== true) return null;

    try {
      const { stdout } = await jalankan('lpstat', ['-p', this.nama]);
      if (!/disabled/i.test(stdout)) return null;
    } catch {
      return null;
    }

    await jalankan('cupsenable', [this.nama]).catch(() => {});
    return 'antrian diaktifkan kembali';
  }

  /**
   * Tunggu antrian printer kosong kembali.
   *
   * Batas waktunya longgar dengan sengaja: struk 58mm berisi QR butuh sekitar
   * satu sampai dua detik untuk keluar, dan kertas yang hampir habis membuatnya
   * lebih lambat lagi. Melaporkan gagal terlalu cepat akan memicu cetak ulang
   * untuk struk yang sebenarnya sedang keluar baik-baik saja.
   */
  async tungguAntrianKosong(batasMs = 8000, jedaMs = 200) {
    const tenggat = Date.now() + batasMs;

    while (Date.now() < tenggat) {
      if ((await this.jumlahPekerjaanTertunda()) === 0) return true;
      await new Promise((r) => setTimeout(r, jedaMs));
    }
    return false;
  }

  /** Berapa pekerjaan yang masih mengantre untuk printer ini. */
  async jumlahPekerjaanTertunda() {
    try {
      if (process.platform === 'win32') {
        const { stdout } = await jalankan('powershell', [
          '-NoProfile', '-Command',
          `@(Get-PrintJob -PrinterName '${this.nama}' -ErrorAction SilentlyContinue).Count`,
        ]);
        return Number(stdout.trim()) || 0;
      }
      // `lpstat -o <antrian>` hanya menampilkan pekerjaan yang belum selesai.
      const { stdout } = await jalankan('lpstat', ['-o', this.nama]);
      return stdout.trim() ? stdout.trim().split('\n').length : 0;
    } catch {
      // lpstat keluar dengan status bukan-nol ketika tidak ada pekerjaan sama
      // sekali pada sebagian versi CUPS; itu berarti kosong, bukan galat.
      return 0;
    }
  }

  /**
   * Nama produk USB milik antrian ini, diambil dari device-uri-nya.
   *
   * `usb://TECH/CLA58?serial=YAEN...` -> "CLA58", yang persis itulah yang
   * ditulis ioreg sebagai nama simpul perangkatnya. Diambil sekali lalu
   * disimpan: nilainya tidak berubah selama antriannya tidak diubah.
   */
  async penandaUsb() {
    if (this._penanda !== undefined) return this._penanda;

    if (process.env.PRINTER_USB_NAME) {
      this._penanda = process.env.PRINTER_USB_NAME;
      return this._penanda;
    }

    try {
      const { stdout } = await jalankan('lpoptions', ['-p', this.nama]);
      const cocok = stdout.match(/device-uri=usb:\/\/([^/\s]+)\/([^?\s]+)/);
      this._penanda = cocok ? decodeURIComponent(cocok[2]) : null;
    } catch {
      this._penanda = null;
    }
    return this._penanda;
  }

  /**
   * Apakah printernya benar-benar ada di bus USB saat ini.
   *
   * Mengembalikan null bila tidak bisa dipastikan, supaya pemanggil bisa
   * membedakan "tidak ada" dari "tidak tahu" — keduanya tidak boleh
   * diperlakukan sama.
   *
   * Ini satu-satunya pemeriksaan yang tidak bisa dibohongi keadaan basi. CUPS
   * menyimpan pendapat terakhirnya: sesudah cetak berhasil, `lpstat` berbunyi
   * "is idle" dan printer-state-reasons menjadi "none", lalu KEDUANYA bertahan
   * tak berubah walau kabelnya dicabut — sampai ada pekerjaan berikutnya yang
   * gagal. Di jendela itulah kiosk mengira dirinya siap padahal tidak, menerima
   * tamu, lalu membuatnya menunggu struk yang tidak akan pernah keluar.
   *
   * ioreg membaca langsung dari registry perangkat keras dan selesai dalam
   * sekitar 6 ms. Pembanding yang juga jujur, `lpinfo -v`, butuh 14 detik
   * karena ikut memindai backend jaringan — jauh di luar anggaran waktu untuk
   * pemeriksaan yang dijalankan sebelum setiap cetak.
   */
  async perangkatAda() {
    if (this.dryRun) return true;
    if (this.lewatJaringan) return (await this.cekJaringan()).siap;
    if (process.platform === 'win32') return null; // ditangani lewat status Windows

    const penanda = await this.penandaUsb();
    if (!penanda) return null;

    try {
      const { stdout } = await jalankan('ioreg', ['-p', 'IOUSB', '-w0']);
      return stdout.includes(penanda);
    } catch {
      return null;
    }
  }

  /**
   * Cek apakah printer benar-benar siap menerima cetakan.
   *
   * Antrian yang `enabled` sama sekali tidak menjamin ada printer di ujung
   * kabel: CUPS dengan senang hati menerima pekerjaan ke antrian aktif milik
   * printer yang tercabut, dan baru melaporkan "The printer is offline" pada
   * baris keterangan di bawahnya. Karena itu seluruh keluaran diperiksa
   * terhadap daftar keadaan gagal di bawah, bukan hanya kata "disabled".
   *
   * Tidak melempar — hanya melaporkan, karena layar kiosk memanggil ini setiap
   * sepuluh detik dan tidak boleh ikut mati bila printernya bermasalah.
   */
  async status() {
    if (this.dryRun) return { siap: true, keterangan: 'mode uji (tanpa printer)' };

    // Printer jaringan tidak punya antrian sistem untuk ditanyai; sambungan
    // soketnya sendiri yang menjadi jawabannya.
    if (this.lewatJaringan) return this.cekJaringan();

    try {
      // Kehadiran fisik didahulukan: bila kabelnya lepas, apa pun yang
      // dikatakan CUPS tentang antriannya tidak lagi relevan.
      if ((await this.perangkatAda()) === false) {
        return { siap: false, keterangan: 'printer tidak terhubung — cek kabel USB dan daya' };
      }

      const teks =
        process.platform === 'win32'
          ? await this.statusWindows()
          : (await jalankan('lpstat', ['-l', '-p', this.nama])).stdout;

      for (const { pola, pesan } of KEADAAN_GAGAL) {
        if (pola.test(teks)) return { siap: false, keterangan: pesan };
      }
      return { siap: true, keterangan: 'siap' };
    } catch {
      return { siap: false, keterangan: `printer "${this.nama}" tidak ditemukan` };
    }
  }

  /**
   * Keadaan printer di Windows sebagai teks, untuk dicocokkan dengan pola yang
   * sama seperti keluaran CUPS.
   *
   * Memakai PowerShell, bukan wmic: wmic sudah tidak dipasang lagi pada
   * Windows 11 versi baru, dan kiosk ini akan dirakit di mesin yang belum
   * tentu punya perintah itu.
   */
  async statusWindows() {
    const { stdout } = await jalankan('powershell', [
      '-NoProfile', '-Command',
      `$p = Get-Printer -Name '${this.nama}' -ErrorAction SilentlyContinue;` +
      `if (-not $p) { $p = Get-Printer | Where-Object ShareName -eq '${this.nama}' };` +
      `if (-not $p) { 'tidak-ditemukan' } else { "$($p.PrinterStatus) $($p.JobCount)" }`,
    ]);
    if (/tidak-ditemukan/.test(stdout)) throw new Error('printer tidak ditemukan');
    return stdout;
  }

  /**
   * Hidupkan lagi antrian CUPS yang dinonaktifkan sendiri setelah printer
   * sempat tercabut. Tanpa ini, mencolok kembali kabelnya tidak cukup —
   * struk akan diam menumpuk di antrian dan kiosk tampak "berhasil" padahal
   * tidak ada kertas yang keluar.
   */
  async pulihkan() {
    if (this.dryRun || process.platform === 'win32') return;
    await jalankan('cupsenable', [this.nama]).catch(() => {});
    await jalankan('cancel', ['-a', this.nama]).catch(() => {});
  }

  /**
   * Susun struk lengkap dan kembalikan buffernya.
   *
   * `jenis` memilih antara undangan (tamu umum) dan voucher (member PAM-PLUS).
   * Keduanya berbagi kepala, QR, dan kaki yang sama; yang berbeda hanya bagian
   * tengahnya. Dipisah menjadi dua fungsi utuh akan menduplikasi seluruh
   * perhitungan lebar dan pemotongan kertas — tempat paling mahal untuk
   * membiarkan dua salinan menyimpang diam-diam.
   */
  /**
   * Pilih bentuk struk menurut jenisnya.
   *
   * Seluruh data diteruskan apa adanya, bukan disusun ulang kolom demi kolom.
   * Versi sebelumnya mendaftar kolomnya satu per satu, sehingga setiap kolom
   * baru yang ditambahkan di hulu — kodePromo, misalnya — terbuang diam-diam di
   * sini dan muncul sebagai nilai kosong di kertas, tanpa galat di mana pun.
   */
  susun(data) {
    return data?.jenis === 'voucher' ? this.susunVoucher(data) : this.susunUndangan(data);
  }

  /**
   * Struk undangan dan struk voucher.
   *
   * Keduanya memakai kerangka yang sama dan hanya berbeda pada satu baris ajakan
   * serta nomor member. Menyatukannya mencegah keduanya perlahan menyimpang
   * setiap kali salah satunya disetel — masalah yang sudah terjadi sekali di
   * sini, ketika voucher tertinggal memakai tata letak lama.
   *
   * Tidak ada keterangan teknis di struk ini: tamu menyimpannya, memotretnya,
   * dan menunjukkannya ke teman.
   */
  susunUndangan(data) {
    return this.susunStruk({ ...data, jenis: 'undangan' });
  }

  susunVoucher(data) {
    return this.susunStruk({ ...data, jenis: 'voucher' });
  }

  susunStruk({ nama, kode, url, namaAcara, waktu, nomorAntrian, member, jenis, kodePromo }) {
    const s = new Struk({ lebarMm: this.lebarMm });
    const kolomBesar = Math.floor(s.kolom / 2); // huruf lebar ganda = 2 kolom
    const voucher = jenis === 'voucher';

    s.init().rata('tengah');

    s.hias();
    s.majuBaris(1);
    s.ukuran(1, 2).tebal(true).paragraf(namaAcara, { kolom: s.kolom }).tebal(false).ukuran(1, 1);
    s.majuBaris(1);
    s.hias();
    s.majuBaris(2);

    s.baris(voucher ? 'Gift Voucher untuk' : 'Undangan untuk');
    s.majuBaris(1);
    s.ukuran(2, 2).tebal(true).paragraf(nama, { kolom: kolomBesar });
    s.tebal(false).ukuran(1, 1);

    if (voucher && member) {
      s.majuBaris(1);
      s.baris(member);
    }

    s.majuBaris(2);
    s.garis('~');
    s.majuBaris(1);

    if (voucher && !kodePromo) {
      // Persediaan kode habis. Struk tetap keluar supaya tamu tidak berdiri
      // menunggu, tetapi dinyatakan apa adanya — voucher tanpa kode yang
      // terlihat sah justru membuat tamu ditolak di kasir tanpa penjelasan.
      s.tebal(true).baris('KODE VOUCHER HABIS').tebal(false);
      s.majuBaris(1);
      s.paragraf('Tunjukkan struk ini ke petugas.');
    } else {
      s.baris(voucher ? 'Pindai untuk claim' : 'Pindai untuk membuka');
      s.baris(voucher ? 'gift vouchermu' : 'undanganmu');
      s.majuBaris(1);

      /*
       * Voucher membawa KODE PROMO-nya sendiri, bukan alamat undangan.
       * Kode itulah yang dipindai sistem PAM-PLUS di kasir, jadi QR harus
       * berisi kodenya apa adanya — bukan tautan yang harus dibuka dulu.
       */
      s.qr(voucher ? kodePromo : url, { modul: this.qrModul, koreksi: 'M' });

      if (voucher) {
        // Dicetak juga sebagai teks: bila QR gagal terbaca pemindai kasir,
        // kodenya masih bisa diketik manual.
        s.majuBaris(1);
        s.tebal(true).baris(kodePromo).tebal(false);
      }
    }

    s.majuBaris(1);
    s.garis('~');
    s.majuBaris(1);

    s.baris(`Tamu ke-${nomorAntrian}`);
    s.baris(waktu);
    s.majuBaris(2);
    s.tebal(true).baris('Terima kasih!').tebal(false);
    s.majuBaris(1);
    s.hias();
    s.majuBaris(4);
    s.potong();

    return s.build();
  }
}

/**
 * Keadaan yang berarti "jangan kirim apa pun sekarang", beserta kalimat yang
 * langsung memberi tahu petugas apa yang harus dipegang.
 *
 * Urutannya berarti: yang lebih spesifik didahulukan, sehingga kertas habis
 * tidak dilaporkan sebagai "printer offline" yang membuat petugas mencabut
 * kabel padahal yang kurang cuma gulungan kertas.
 */
const KEADAAN_GAGAL = [
  { pola: /media-empty|media-needed|out of paper|PaperOut/i,
    pesan: 'kertas habis — ganti gulungan' },
  { pola: /media-jam|PaperJam/i,
    pesan: 'kertas macet — buka penutup dan rapikan gulungan' },
  { pola: /cover-open|DoorOpen/i,
    pesan: 'penutup printer terbuka' },
  { pola: /offline|Unable to send data|PaperProblem|Error/i,
    pesan: 'printer offline — cek kabel data dan tombol daya' },
  { pola: /disabled since/i,
    pesan: 'antrian dinonaktifkan — tekan Pulihkan Printer' },
  { pola: /paused|Paused/i,
    pesan: 'antrian dijeda — tekan Pulihkan Printer' },
  { pola: /rejecting jobs/i,
    pesan: 'antrian menolak pekerjaan baru' },
];

/** Ubah kode galat soket menjadi kalimat yang menunjuk tindakan. */
function jelaskanGalatJaringan(galat, host, port) {
  switch (galat.code) {
    case 'ECONNREFUSED':
      return `Printer ${host} menolak sambungan di port ${port} — cetak mentah mungkin dimatikan di setelan printer`;
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return `Alamat ${host} tidak terjangkau — printer berada di jaringan lain`;
    case 'ETIMEDOUT':
      return `Printer ${host} tidak menjawab — cek kabel LAN, daya, dan alamatnya`;
    case 'ENOTFOUND':
      return `Nama "${host}" tidak dikenali di jaringan ini`;
    default:
      return `Gagal menghubungi printer ${host}:${port} (${galat.code ?? galat.message})`;
  }
}

function jelaskanGalat(galat, namaPrinter) {
  const keluaran = `${galat.stderr ?? ''} ${galat.stdout ?? ''} ${galat.message ?? ''}`.trim();

  if (/not found|tidak ditemukan|The system cannot find/i.test(keluaran)) {
    return `Printer "${namaPrinter}" tidak ditemukan. Cek kabel USB dan nama printer di .env`;
  }
  if (/network path|jalur jaringan/i.test(keluaran)) {
    return `Printer "${namaPrinter}" belum di-share di Windows. Buka Printer Properties > Sharing > centang Share this printer`;
  }
  if (/ENOENT/i.test(keluaran)) {
    return process.platform === 'win32'
      ? 'Perintah cetak Windows tidak tersedia'
      : 'Perintah `lp` tidak ditemukan — CUPS belum terpasang';
  }
  return `Gagal mengirim ke printer: ${keluaran.slice(0, 200)}`;
}
