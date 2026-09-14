@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Install Vietnamese OCR for Android Bridge

fltmc >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Dang yeu cau quyen Administrator...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ==========================================================
echo  Cai Tesseract OCR + Vietnamese language data
 echo ==========================================================
echo.

where winget.exe >nul 2>nul
if not "%errorlevel%"=="0" (
  echo [LOI] Khong tim thay winget.exe.
  echo Hay cai App Installer tu Microsoft Store roi chay lai.
  pause
  exit /b 1
)

echo [1/3] Cai/kiem tra Tesseract OCR...
winget install --id UB-Mannheim.TesseractOCR -e --accept-package-agreements --accept-source-agreements

set "TESSERACT_EXE="
if exist "%ProgramFiles%\Tesseract-OCR\tesseract.exe" set "TESSERACT_EXE=%ProgramFiles%\Tesseract-OCR\tesseract.exe"
if not defined TESSERACT_EXE if exist "%ProgramFiles(x86)%\Tesseract-OCR\tesseract.exe" set "TESSERACT_EXE=%ProgramFiles(x86)%\Tesseract-OCR\tesseract.exe"

if not defined TESSERACT_EXE (
  for /f "delims=" %%I in ('where tesseract.exe 2^>nul') do if not defined TESSERACT_EXE set "TESSERACT_EXE=%%I"
)

if not defined TESSERACT_EXE (
  echo.
  echo [LOI] Da chay winget nhung khong tim thay tesseract.exe.
  echo Hay khoi dong lai Windows hoac cai Tesseract thu cong.
  pause
  exit /b 1
)

echo Tesseract: %TESSERACT_EXE%
for %%I in ("%TESSERACT_EXE%") do set "TESSDATA_DIR=%%~dpItessdata"

if not exist "%TESSDATA_DIR%" mkdir "%TESSDATA_DIR%"

"%TESSERACT_EXE%" --list-langs 2>nul | findstr /x /c:"vie" >nul
if "%errorlevel%"=="0" goto :have_vie

echo.
echo [2/3] Dang tai model OCR tieng Viet vie.traineddata...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/vie.traineddata' -OutFile '%TESSDATA_DIR%\vie.traineddata'"
if not "%errorlevel%"=="0" (
  echo [LOI] Khong tai duoc vie.traineddata.
  pause
  exit /b 1
)

:have_vie
echo.
echo [3/3] Kiem tra ngon ngu OCR...
"%TESSERACT_EXE%" --list-langs
"%TESSERACT_EXE%" --list-langs 2>nul | findstr /x /c:"vie" >nul
if not "%errorlevel%"=="0" (
  echo.
  echo [LOI] Tesseract van chua nhan model vie.
  echo Thu muc tessdata: %TESSDATA_DIR%
  pause
  exit /b 1
)

echo.
echo ==========================================================
echo  OK - Vietnamese OCR da san sang.
echo  Dong bridge cu va chay lai start-bridge.bat
 echo ==========================================================
pause
endlocal
