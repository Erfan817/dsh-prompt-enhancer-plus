@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Please install Node.js first.
  pause
  exit /b 1
)
node "desktop\local.mjs"
if errorlevel 1 (
  echo.
  echo Desktop startup failed. Please share the error text above.
  pause
)
endlocal
