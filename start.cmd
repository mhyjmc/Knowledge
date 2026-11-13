@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 20.19 or newer first.
  pause
  exit /b 1
)
if not exist "node_modules\concurrently\dist\bin\concurrently.js" (
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd run dev
pause
