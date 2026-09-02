@echo off
chcp 65001 >nul 2>&1

REM ===========================================================================
REM  KIOSK HUT EWALK 17-TH  —  peluncur satu klik
REM
REM  Klik dua kali berkas ini. Tidak ada yang perlu diatur lebih dulu.
REM
REM    Node.js belum ada       -> diunduh sendiri ke folder ini
REM    Setelan belum ada       -> ditanya sekali di peramban, bukan di sini
REM    Printer                 -> dicari sendiri di jaringan, lalu diingat
REM    Daftar member           -> ditarik sendiri dari server, terus diperbarui
REM
REM  Berkas ini SENGAJA tidak menanyakan apa-apa. Nilai rahasia mengandung
REM  tanda baca seperti "!" dan "&" yang diperlakukan khusus oleh cmd.exe;
REM  nilainya bisa terpotong tanpa ada yang menyadarinya sampai kiosk menolak
REM  sandi yang sebenarnya sudah benar. Formulir di peramban tidak punya
REM  kelemahan itu sama sekali.
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
REM  Cari Node.js
REM
REM  Urutannya disengaja: node.exe di folder ini lebih dulu, baru yang terpasang
REM  di sistem. Kiosk acara tidak boleh ikut berubah perilakunya hanya karena
REM  seseorang memperbarui Node di PC ini bulan depan.
REM --------------------------------------------------------------------------
set "NODE="

if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if not defined NODE if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"

if not defined NODE (
  where node >nul 2>&1
  if not errorlevel 1 set "NODE=node"
)

if not defined NODE (
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
)

echo   Node    : siap
echo   Setelan : diurus sendiri oleh kiosk
echo.
echo   Menyalakan kiosk...
echo.

REM --------------------------------------------------------------------------
REM  Peramban dibuka terpisah dan diberi jeda.
REM
REM  Kalau dijalankan seketika, halamannya terbuka sebelum server sempat
REM  mendengarkan, dan yang muncul adalah galat sambungan alih-alih kiosk.
REM
REM  Chrome dibuka dalam mode kiosk bila ada — layar penuh tanpa bilah alamat,
REM  supaya tamu tidak bisa keluar dari halaman. Kalau tidak ada, peramban
REM  bawaan dipakai apa adanya.
REM --------------------------------------------------------------------------
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

if exist "%CHROME%" (
  start "" /min cmd /c "timeout /t 4 >nul & start """" ""%CHROME%"" --kiosk --autoplay-policy=no-user-gesture-required http://localhost:4000"
) else (
  start "" /min cmd /c "timeout /t 4 >nul & start http://localhost:4000"
)

"%NODE%" "%~dp0kiosk\server.js"

echo.
echo   Kiosk berhenti.
echo.
pause
