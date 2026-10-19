@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or later is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4173 in your browser.
echo Keep this window open while using the app. Press Ctrl+C to stop.
node scripts/serve.mjs
pause
