@echo off
title Gamma GEX Trading System Desk
echo ============================================================
echo           LAUNCHING GAMMA GEX TRADING DESK
echo ============================================================
echo.
echo [1/3] Verifying and downloading environment dependencies...
echo.

:: Run python app in background
start "Gamma GEX Server" cmd /c "uv run --with fastapi --with uvicorn --with yfinance --with numpy --with scipy --with pandas --with python-multipart python -m backend.app"

echo [2/3] Waiting 5 seconds for FastAPI server to initialize...
timeout /t 5 /nobreak > nul

echo [3/3] Launching web browser dashboard...
start http://127.0.0.1:8000

echo.
echo ============================================================
echo   SYSTEM READY! Server is running at http://127.0.0.1:8000
echo   To shut down the desk, close the server terminal window.
echo ============================================================
pause
