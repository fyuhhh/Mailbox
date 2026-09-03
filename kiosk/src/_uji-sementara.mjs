// berkas uji sementara — dihapus setelah dipakai
import { Printer } from './printer.js';
const printer = new Printer({
  nama: 'TECH_CLA58',
  host: '127.0.0.1',
  port: 9100,
  lebarMm: 80,
  qrModul: 14,
  dryRun: false,
  folderDryRun: '/tmp/struk-uji',
});
const buffer = printer.susun({
  nama: 'Uji', pesan: 'halo', kode: 'A7K9', namaAcara: 'HUT', waktu: '01/01/2026 00:00',
  nomorAntrian: 1, url: 'HTTPS://UNDANGAN.OPSJOBS.ID/U/A7K9',
});
const status = await printer.status();
console.log('STATUS:', JSON.stringify(status));
await printer.kirim(buffer);
console.log('TERKIRIM — akhir skrip tercapai pada', new Date().toISOString());
