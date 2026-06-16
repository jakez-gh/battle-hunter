@echo off
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required to run this game.
    echo Download it from https://nodejs.org and re-run this script.
    pause
    exit /b 1
)
echo Starting Battle Hunter at http://localhost:8377
timeout /t 1 /nobreak >nul
start "" http://localhost:8377
node tools/serve.mjs
