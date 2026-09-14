@echo off
setlocal
cd /d "%~dp0"
title Android UI Text Bridge

if not defined ADB_PATH if exist "%~dp0adb.exe" set "ADB_PATH=%~dp0adb.exe"

if not defined ADB_PATH (
  for /f "delims=" %%I in ('where adb.exe 2^>nul') do if not defined ADB_PATH set "ADB_PATH=%%I"
)

if not defined ADB_PATH (
  set "SCRCPY_EXE="
  for /f "delims=" %%I in ('where scrcpy.exe 2^>nul') do if not defined SCRCPY_EXE set "SCRCPY_EXE=%%I"
  if defined SCRCPY_EXE call :adb_from_scrcpy
)

if defined ADB_PATH echo ADB: %ADB_PATH%

echo.
echo Dang khoi dong Android UI Text Bridge...
echo Moi loi se duoc ghi truc tiep trong cua so nay.
echo Giu cua so nay mo trong khi su dung extension.
echo.

where py.exe >nul 2>nul
if %errorlevel%==0 (
  py -3 "%~dp0android-bridge.py"
  if errorlevel 1 (
    echo.
    echo ==========================================================
    echo [LOI] Android bridge da dung bat thuong.
    echo Xem thong bao loi o phia tren. Cua so nay se duoc giu lai.
    echo ==========================================================
    pause
  )
  goto :end
)

where python.exe >nul 2>nul
if %errorlevel%==0 (
  python "%~dp0android-bridge.py"
  if errorlevel 1 (
    echo.
    echo ==========================================================
    echo [LOI] Android bridge da dung bat thuong.
    echo Xem thong bao loi o phia tren. Cua so nay se duoc giu lai.
    echo ==========================================================
    pause
  )
  goto :end
)

echo [LOI] Khong tim thay Python.
echo Cai Python 3 hoac them python.exe vao PATH roi chay lai file nay.
pause
goto :end

:adb_from_scrcpy
for %%I in ("%SCRCPY_EXE%") do if exist "%%~dpIadb.exe" set "ADB_PATH=%%~dpIadb.exe"
exit /b

:end
endlocal
