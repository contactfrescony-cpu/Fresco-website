@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Node.js 20 or newer is required. Install Node.js LTS, then run this file again. & pause & exit /b 1)
if not exist node_modules (
  echo Installing packages - first run only...
  call npm install
  if errorlevel 1 (pause & exit /b 1)
)
echo Building the website...
call npm run build
if errorlevel 1 (pause & exit /b 1)
start "" http://localhost:8000
node server.js
