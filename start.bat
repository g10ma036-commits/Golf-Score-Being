@echo off
rem Golf Enjoy Manager launcher (double-click to start)
chcp 65001 > nul
cd /d "%~dp0"
where node > nul 2> nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22.13 or later from https://nodejs.org/
  pause
  exit /b 1
)
set GOLF_OPEN_BROWSER=1
node --disable-warning=ExperimentalWarning server.js
pause
