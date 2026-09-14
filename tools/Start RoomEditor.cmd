@echo off
cd /d "%~dp0.."
start "" "http://localhost:8765/index.html"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\serve.ps1"
