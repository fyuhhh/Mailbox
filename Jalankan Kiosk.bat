@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

REM ===========================================================================
REM  KIOSK HUT EWALK 17-TH  —  peluncur satu klik
REM
REM  Klik dua kali berkas ini. Kalau ada yang belum siap, berkas ini yang
REM  menyiapkannya, bukan kamu:
REM
REM    - Node.js belum ada       -> diunduh sendiri ke folder ini
REM    - Setelan .env belum ada  -> ditanya sekali, lalu diingat selamanya
REM    - Daftar member kosong    -> ditarik sendiri dari server, otomatis
REM
REM  Jendela hitam ini HARUS dibiarkan terbuka selama acara. Menutupnya
REM  mematikan kiosk. Itu disengaja: tanpa jendela yang terlihat, petugas
REM  tidak punya cara tahu kiosk masih hidup atau sudah mati.
REM ===========================================================================

cd /d "%~dp0"
title Kiosk HUT EWALK 17-TH

echo.
echo   ============================================
echo     KIOSK HUT EWALK 17-TH
echo   ============================================
echo.

REM --------------------------------------------------------------------------
REM  1. Cari Node.js
REM
REM  Urutannya disengaja: node.exe di folder ini lebih dulu, baru yang
REM  terpasang di sistem. Kiosk acara tidak boleh ikut berubah perilakunya
REM  hanya karena seseorang memperbarui Node di PC ini bulan depan.
REM --------------------------------------------------------------------------
set "NODE="

if exist "%~dp0node.exe" (
  set "NODE=%~dp0node.exe"
  echo   Node    : ikut di folder ini
  goto :node_siap
)

if exist "%~dp0node\node.exe" (
  set "NODE=%~dp0node\node.exe"
  echo   Node    : ikut di folder ini
  goto :node_siap
)

where node >nul 2>&1
if %errorlevel%==0 (
  set "NODE=node"
  echo   Node    : terpasang di sistem
  goto :node_siap
)

echo   Node    : belum ada, mengunduh sekali ^(sekitar 30 MB^)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$v='v22.11.0';" ^
  "$url=\"https://nodejs.org/dist/$v/node-$v-win-x64.zip\";" ^
  "Write-Host '   mengunduh dari nodejs.org...';" ^
  "Invoke-WebRequest -Uri $url -OutFile 'node.zip' -UseBasicParsing;" ^
  "Write-Host '   membuka paket...';" ^
  "Expand-Archive -Path 'node.zip' -DestinationPath '.' -Force;" ^
  "Rename-Item -Path \"node-$v-win-x64\" -NewName 'node';" ^
  "Remove-Item 'node.zip' -Force;"

if not exist "%~dp0node\node.exe" (
  echo.
  echo   [X] Node.js gagal diunduh.
  echo.
  echo       PC ini perlu internet untuk unduhan pertama saja.
  echo       Atau pasang Node.js sendiri dari https://nodejs.org
  echo       lalu klik dua kali berkas ini lagi.
  echo.
  pause
  exit /b 1
)

set "NODE=%~dp0node\node.exe"
echo   Node    : selesai diunduh

:node_siap

REM --------------------------------------------------------------------------
REM  2. Setelan rahasia
REM
REM  SYNC_SECRET dan SANDI_PETUGAS tidak ikut disimpan di penyimpanan kode:
REM  yang pertama adalah kunci ke seluruh daftar member, yang kedua kunci ke
REM  daftar kode voucher. Keduanya ditanyakan sekali di PC ini, disimpan di
REM  kiosk\.env, dan tidak pernah ditanyakan lagi.
REM --------------------------------------------------------------------------
if exist "%~dp0kiosk\.env" goto :setelan_siap

echo.
echo   ------------------------------------------------------------
echo     Penyiapan sekali jalan
echo   ------------------------------------------------------------
echo.
echo   Dua isian ini hanya ditanyakan sekarang. Sesudah tersimpan,
echo   klik dua kali berkas ini langsung membuka kiosk.
echo.

set "SYNCSECRET="
set /p "SYNCSECRET=  SYNC_SECRET (kunci ke server undangan) : "
if "!SYNCSECRET!"=="" (
  echo.
  echo   [X] SYNC_SECRET tidak boleh kosong — tanpa itu daftar member
  echo       tidak bisa ditarik dan struk tidak terkirim ke server.
  echo.
  pause
  exit /b 1
)

set "SANDIPETUGAS="
set /p "SANDIPETUGAS=  SANDI_PETUGAS (buka halaman data)      : "
if "!SANDIPETUGAS!"=="" (
  echo.
  echo   [X] SANDI_PETUGAS tidak boleh kosong — halaman Persiapan
  echo       Acara dan Data Kiosk tidak akan bisa dibuka.
  echo.
  pause
  exit /b 1
)

echo.
set "PRINTERHOST="
set /p "PRINTERHOST=  Alamat printer jaringan (kosongkan jika USB) : "

>  "%~dp0kiosk\.env" echo # Dibuat otomatis oleh JALANKAN KIOSK.bat. Sunting bebas.
>> "%~dp0kiosk\.env" echo PORT=4000
>> "%~dp0kiosk\.env" echo BASE_URL=https://undangan.opsjobs.id
>> "%~dp0kiosk\.env" echo SYNC_SECRET=!SYNCSECRET!
>> "%~dp0kiosk\.env" echo SANDI_PETUGAS=!SANDIPETUGAS!
>> "%~dp0kiosk\.env" echo PRINTER_HOST=!PRINTERHOST!
>> "%~dp0kiosk\.env" echo PRINTER_PORT=9100
>> "%~dp0kiosk\.env" echo PRINTER_NAME=
>> "%~dp0kiosk\.env" echo PRINTER_WIDTH=80
>> "%~dp0kiosk\.env" echo NAMA_ACARA=HUT EWALK 17-TH

echo.
echo   Tersimpan di kiosk\.env
echo.

:setelan_siap
echo   Setelan : siap

REM --------------------------------------------------------------------------
REM  3. Nyalakan
REM
REM  Peramban dibuka terpisah dan diberi jeda: kalau dijalankan seketika,
REM  halamannya terbuka sebelum server sempat mendengarkan dan yang muncul
REM  adalah galat sambungan, bukan kiosk.
REM --------------------------------------------------------------------------
echo.
echo   Menyalakan kiosk...
echo.

start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:4000"

"%NODE%" "%~dp0kiosk\server.js"

echo.
echo   Kiosk berhenti.
echo.
pause
