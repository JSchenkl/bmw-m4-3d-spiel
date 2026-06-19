@echo off
cd /d "%~dp0"
echo BMW M4 Viewer wird gestartet ...
start "" http://localhost:8000
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
