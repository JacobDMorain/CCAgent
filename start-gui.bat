@echo off
setlocal

cd /d "%~dp0"

where pnpm.cmd >nul 2>nul
if errorlevel 1 (
  echo pnpm.cmd was not found in PATH.
  echo Please install pnpm or open this project from an environment where pnpm.cmd is available.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-gui.ps1" %*
set EXIT_CODE=%ERRORLEVEL%

if not "%EXIT_CODE%"=="0" (
  echo.
  echo CCAgent GUI failed to start. Exit code: %EXIT_CODE%
  pause
)

exit /b %EXIT_CODE%
