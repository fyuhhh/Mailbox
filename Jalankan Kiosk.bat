@echo off
REM
REM Klik dua kali berkas ini untuk menyalakan kiosk.
REM
REM Jendela hitam yang muncul HARUS dibiarkan terbuka selama acara —
REM menutupnya mematikan kiosk. Itu disengaja: tanpa jendela yang terlihat,
REM tidak ada cara bagi petugas untuk tahu kiosk masih hidup atau sudah mati.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js belum terpasang di komputer ini.
  echo.
  echo   Pasang dulu dari https://nodejs.org ^(pilih versi LTS^),
  echo   lalu klik dua kali berkas ini lagi.
  echo.
  pause
  start "" "https://nodejs.org/en/download"
  exit /b 1
)

node mulai.mjs

REM Bila Node keluar karena galat, jendela ditahan agar pesannya sempat dibaca
REM alih-alih berkedip lalu hilang.
if errorlevel 1 pause
