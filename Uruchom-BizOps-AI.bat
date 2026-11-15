@echo off
chcp 65001 >nul
title BizOps AI Studio — Serwer Lokalny
cd /d "%~dp0"
echo ========================================================
echo   Uruchamianie BizOps AI Studio (http://localhost:5173)
echo ========================================================
start "" "http://localhost:5173/"
"%USERPROFILE%\.bun\bin\bun.exe" .\node_modules\vite\bin\vite.js --port 5173
pause
