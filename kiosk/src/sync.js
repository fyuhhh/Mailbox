/**
 * Pengunggah data tamu ke server undangan.
 *
 * Prinsip yang dipegang: sinkronisasi TIDAK PERNAH boleh menghalangi cetak.
 * Antrian di depan kiosk adalah kendala nyata acara — begitu tamu menekan
 * tombol, struk harus keluar, ada internet atau tidak. Karena itu unggahan
 * pertama diberi tenggat pendek dan kegagalannya ditelan; berkasnya sudah
 * aman di SQLite dan perulangan latar belakang yang akan menuntaskannya.
 */

const TENGGAT_LANGSUNG_MS = 2500;
const TENGGAT_LATAR_MS = 8000;

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export class Sinkronisasi {
  constructor({ db, baseUrl, secret, jedaMs = 15000, folderVideo = null, log = console }) {
    this.folderVideo = folderVideo;
    this.db = db;
    // Alamat disimpan huruf besar untuk QR; fetch butuh bentuk normalnya.
    this.baseUrl = String(baseUrl).toLowerCase().replace(/\/+$/, '');
    this.secret = secret;
    this.jedaMs = jedaMs;
    this.log = log;
    this.timer = null;
    this.sedangJalan = false;
    this.daring = null; // null = belum pernah mencoba
  }

  mulai() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.putaran().catch((e) => this.log.error('[sync] putaran gagal:', e.message));
    }, this.jedaMs);
    this.timer.unref?.();
    this.putaran().catch(() => {});
  }

  berhenti() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Coba kirim satu tamu sekarang juga. Tidak melempar. */
  async kirimSegera(tamu) {
    try {
      await this.kirim(tamu, TENGGAT_LANGSUNG_MS);
      this.db.tandaiSinkron(tamu.kode);
      this.daring = true;
      return true;
    } catch (galat) {
      this.db.catatGagalSinkron(tamu.kode, galat.message);
      this.daring = false;
      return false;
    }
  }

  async putaran() {
    if (this.sedangJalan) return;
    this.sedangJalan = true;
    try {
      const antrian = this.db.tamuBelumSinkron(25);

      for (const tamu of antrian) {
        try {
          await this.kirim(tamu, TENGGAT_LATAR_MS);
          this.db.tandaiSinkron(tamu.kode);
          this.daring = true;
        } catch (galat) {
          this.db.catatGagalSinkron(tamu.kode, galat.message);
          this.daring = false;
          // Berhenti pada kegagalan pertama. Bila penyebabnya internet mati,
          // meneruskan 24 tamu sisanya hanya menaikkan penghitung percobaan
          // mereka tanpa hasil dan menghabiskan tenggat waktu putaran ini.
          break;
        }
      }

      // Video menyusul setelah data tamunya sampai — beberapa megabita per
      // rekaman, dan mengirimkannya lebih dulu akan menahan data tamu yang
      // ringan di belakang antrean unggahan besar. Nama tamu yang muncul di
      // halaman undangan jauh lebih mendesak daripada videonya.
      await this.putaranVideo();
    } finally {
      this.sedangJalan = false;
    }
  }

  async putaranVideo() {
    if (!this.folderVideo) return;

    for (const tamu of this.db.videoBelumTerkirim(3)) {
      const berkas = path.join(this.folderVideo, tamu.video);
      if (!existsSync(berkas)) {
        // Berkasnya hilang — tandai selesai supaya tidak dicoba selamanya.
        this.db.tandaiVideoTerkirim(tamu.kode);
        continue;
      }

      try {
        await this.kirimVideo(tamu.kode, readFileSync(berkas), path.extname(tamu.video));
        this.db.tandaiVideoTerkirim(tamu.kode);
        this.daring = true;
      } catch (galat) {
        this.db.catatGagalSinkron(tamu.kode, `video: ${galat.message}`);
        this.daring = false;
        break;
      }
    }
  }

  async kirimVideo(kode, isi, akhiran = '.webm') {
    // Tenggat jauh lebih longgar daripada data tamu: unggahan beberapa megabita
    // lewat jaringan acara memang lambat, dan memutusnya di tengah jalan hanya
    // menghasilkan percobaan berulang yang tidak pernah selesai.
    const respons = await fetch(`${this.baseUrl}/api/video/${kode}`, {
      method: 'POST',
      headers: {
        'content-type': akhiran === '.mp4' ? 'video/mp4' : 'video/webm',
        'x-sync-secret': this.secret,
      },
      body: isi,
      signal: AbortSignal.timeout(120_000),
    });

    if (!respons.ok) {
      throw new Error(`HTTP ${respons.status} ${(await respons.text().catch(() => '')).slice(0, 120)}`);
    }
  }

  async kirim(tamu, tenggatMs) {
    const batal = AbortSignal.timeout(tenggatMs);
    const respons = await fetch(`${this.baseUrl}/api/tamu`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sync-secret': this.secret,
      },
      body: JSON.stringify({
        kode: tamu.kode,
        nama: tamu.nama,
        pesan: tamu.pesan ?? '',
        dibuat_pada: tamu.dibuat_pada,
        jenis: tamu.jenis ?? 'undangan',
      }),
      signal: batal,
    });

    if (!respons.ok) {
      const isi = await respons.text().catch(() => '');
      throw new Error(`HTTP ${respons.status} ${isi.slice(0, 120)}`);
    }
  }

  status() {
    const { total, tertunda } = this.db.ringkasan();
    return { total, tertunda, daring: this.daring };
  }
}
