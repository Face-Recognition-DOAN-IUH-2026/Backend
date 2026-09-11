@echo off
title Fire Detection Service (Port 8008)
cd /d "%~dp0"
echo ===================================================
echo   Starting Fire Detection Service on Port 8008
echo ===================================================
python -m uvicorn api.app:app --host 0.0.0.0 --port 8008 --reload
pause
