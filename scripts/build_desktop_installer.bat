@echo off
REM Desktop installer build entry: Electron shell + PyInstaller sidecar + NSIS setup.
REM Usage: scripts\build_desktop_installer.bat [-SkipExe] [-SkipInstall]  (switches passed through to ps1)
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\build_desktop_installer.ps1" %*
set EC=%ERRORLEVEL%
echo.
if not "%EC%"=="0" echo [ERROR] build failed, exit code %EC%. Check logs\build_installer.log
exit /b %EC%
