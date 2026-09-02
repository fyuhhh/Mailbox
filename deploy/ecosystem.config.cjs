// Definisi proses PM2 untuk server undangan.
// Di server:  pm2 start /opt/undangan/deploy/ecosystem.config.cjs
//             pm2 save && pm2 startup

module.exports = {
  apps: [
    {
      name: 'undangan-api',
      cwd: '/opt/undangan',
      script: 'server.js',

      // Satu proses saja. Basis datanya SQLite berkas tunggal; menjalankan
      // beberapa pekerja pada berkas yang sama hanya menambah kemungkinan
      // "database is locked" tanpa manfaat apa pun — beban puncak acara ini
      // adalah beberapa ratus pemindaian dalam satu malam.
      instances: 1,
      exec_mode: 'fork',

      max_memory_restart: '300M',
      env: { NODE_ENV: 'production' },

      error_file: '/var/log/undangan/api-error.log',
      out_file: '/var/log/undangan/api-out.log',
      time: true,
    },
  ],
};
