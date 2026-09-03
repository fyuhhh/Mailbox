@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"
title Kiosk HUT EWALK 17-TH

REM ===========================================================================
REM  KIOSK HUT EWALK 17-TH  --  peluncur satu klik
REM
REM  BERKAS INI HARUS BERAKHIR BARIS CRLF.
REM
REM  cmd.exe membaca .bat baris demi baris dan menuntut CRLF. Dengan LF saja,
REM  blok "if ( ... )" dan sambungan baris "^" pecah menjadi potongan yang
REM  dicoba dijalankan sebagai perintah tersendiri -- gejalanya adalah deretan
REM  galat aneh seperti 'f' is not recognized, 'not' is not recognized. Bahkan
REM  baris cd di atas ikut gagal, sehingga folder kerja tetap System32 dan
REM  Node terunduh ke tempat yang salah.
REM
REM  Berkas .gitattributes di akar proyek memaksa git selalu menuliskan .bat
REM  dengan CRLF, apa pun sistem tempat kodenya disunting.
REM
REM  Karena alasan yang sama, berkas ini menghindari blok berkurung sama
REM  sekali dan memakai label "goto" -- satu baris satu perintah, jauh lebih
REM  tahan terhadap kesalahan semacam ini.
REM ===========================================================================

echo.
echo   ============================================
echo     KIOSK HUT EWALK 17-TH
echo   ============================================
echo.

set "NODE="
set "NODEV=v22.11.0"

REM -- 1. node.exe yang diletakkan langsung di folder ini ---------------------
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if defined NODE goto NODE_LOKAL

REM -- 2. hasil unduhan sebelumnya -------------------------------------------
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if defined NODE goto NODE_LOKAL

REM -- 3. Node yang sudah terpasang di Windows --------------------------------
REM  Diperiksa dengan menjalankannya, bukan hanya dengan "where".
REM  Setelah memasang Node, jendela cmd yang SUDAH terbuka tidak ikut
REM  memperbarui PATH-nya, jadi "where" bisa gagal padahal Node sudah ada.
where node >nul 2>&1
if not errorlevel 1 set "NODE=node"
if defined NODE goto NODE_SISTEM

REM -- 4. lokasi pemasangan baku, kalau PATH belum menyegarkan diri -----------
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if defined NODE goto NODE_SISTEM

if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if defined NODE goto NODE_SISTEM

if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if defined NODE goto NODE_SISTEM

goto UNDUH_NODE


:NODE_LOKAL
echo   Node    : ikut di folder ini
goto NODE_SIAP

:NODE_SISTEM
echo   Node    : sudah terpasang di Windows
goto NODE_SIAP


:UNDUH_NODE
echo   Node    : belum ada, mengunduh sekali (sekitar 30 MB)...
echo.

REM  Sisa unduhan yang gagal dibuang lebih dulu.
REM  Tanpa ini, Rename-Item berhenti dengan "Cannot create a file when that
REM  file already exists" dan percobaan kedua selalu gagal -- tepat seperti
REM  yang terjadi pada percobaan sebelumnya.
if exist "%~dp0node" rmdir /s /q "%~dp0node"
if exist "%~dp0node.zip" del /q "%~dp0node.zip"

REM  Unblock-File di ujung perintah menghapus penanda "berkas ini dari
REM  internet" (Mark of the Web) dari node.exe dan seluruh isi folder node.
REM  Tanpa itu, Smart App Control di Windows 11 menolak menjalankannya dengan
REM  pesan "blocked a file that may be unsafe" -- dan kiosk berhenti di situ
REM  meski unduhannya sendiri berhasil.
REM
REM  Seluruh perintah PowerShell ditulis dalam SATU baris.
REM  Sambungan baris "^" adalah hal pertama yang rusak bila berkas ini pernah
REM  tersimpan dengan akhir baris yang salah, dan pesan galatnya sama sekali
REM  tidak menunjuk ke sebabnya. Kutip tunggal dipakai di dalam supaya tidak
REM  ada tanda kutip yang perlu di-escape.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $v='%NODEV%'; $u='https://nodejs.org/dist/' + $v + '/node-' + $v + '-win-x64.zip'; Write-Host '   mengunduh dari nodejs.org...'; Invoke-WebRequest -Uri $u -OutFile 'node.zip' -UseBasicParsing; Write-Host '   membuka paket...'; Expand-Archive -Path 'node.zip' -DestinationPath '.' -Force; Rename-Item -Path ('node-' + $v + '-win-x64') -NewName 'node'; Remove-Item 'node.zip' -Force; Get-ChildItem -Path 'node' -Recurse -File | Unblock-File"

if exist "%~dp0node\node.exe" goto UNDUH_BERES

echo.
echo   [X] Node.js gagal diunduh.
echo.
echo       Pasang sendiri dari https://nodejs.org  (pilih "Windows Installer .msi")
echo       Setelah terpasang, TUTUP jendela ini lalu klik dua kali berkas ini
echo       lagi -- jendela lama tidak ikut mengetahui Node yang baru terpasang.
echo.
pause
exit /b 1

:UNDUH_BERES
set "NODE=%~dp0node\node.exe"
echo   Node    : selesai diunduh


:NODE_SIAP
echo   Setelan : diurus sendiri oleh kiosk
echo.
echo   Menyalakan kiosk...
echo.

REM --------------------------------------------------------------------------
REM  Peramban dibuka terpisah dan diberi jeda supaya server sempat siap.
REM  Chrome dipakai dalam mode kiosk bila ada; kalau tidak, peramban bawaan.
REM --------------------------------------------------------------------------
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME="

REM  PowerShell dipakai untuk menunda lalu membuka, BUKAN cmd bersarang.
REM  Bentuk  cmd /c "... start "" "%CHROME%" ..."  menaruh tanda kutip di dalam
REM  tanda kutip; cmd melucuti kutip terluar lalu salah menafsirkan sisanya,
REM  dan peramban terbuka dengan alamat yang salah atau tidak terbuka sama
REM  sekali. Di PowerShell seluruh argumen cukup memakai kutip tunggal.
if defined CHROME goto BUKA_CHROME
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 5; Start-Process 'http://localhost:4000'"
goto NYALAKAN

:BUKA_CHROME
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 5; Start-Process -FilePath '%CHROME%' -ArgumentList '--kiosk','--autoplay-policy=no-user-gesture-required','http://localhost:4000'"

:NYALAKAN
"%NODE%" "%~dp0kiosk\server.js"

echo.
echo   Kiosk berhenti.
echo.
pause
