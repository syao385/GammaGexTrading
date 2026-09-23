@echo off
title Gamma GEX Trading System Desk
cd /d "%~dp0"

echo ============================================================
echo           LAUNCHING GAMMA GEX TRADING DESK
echo ============================================================
echo.

REM 1. Check if uv is installed
where uv >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] 'uv' package manager was not found in your PATH.
    echo Please install uv via: winget install astral-sh.uv
    echo Or download from: https://astral.sh/uv
    echo.
    pause
    exit /b 1
)

REM 2. Check if server is already running on port 8000
curl.exe -s -f -o nul http://127.0.0.1:8000/ >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [i] Gamma GEX Server is already running on port 8000.
    goto launch_browser
)

echo [1/3] Starting backend server in background...
echo       (uv will download/verify dependencies if running for the first time)
start "Gamma GEX Server" /D "%~dp0" cmd /k "uv run --python 3.12 --with fastapi --with uvicorn --with yfinance --with numpy --with scipy --with pandas --with python-multipart --with httpx --with websockets python -m backend.app"

echo.
echo [2/3] Waiting for FastAPI server to initialize at http://127.0.0.1:8000 ...
set /a attempts=0

:wait_loop
timeout /t 1 /nobreak > nul
curl.exe -s -f -o nul http://127.0.0.1:8000/ >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo.
    goto launch_browser
)

set /a attempts+=1 > nul
echo|set /p="."
if %attempts% geq 45 (
    echo.
    echo [!] Server did not respond within 45 seconds.
    echo     Please check the "Gamma GEX Server" terminal window for details or error messages.
    goto end
)
goto wait_loop

:launch_browser
echo.
echo [3/3] Server is ready! Launching web browser dashboard...
start http://127.0.0.1:8000

echo.
echo ============================================================
echo   SYSTEM READY! Server is running at http://127.0.0.1:8000
echo   To shut down the desk, close the "Gamma GEX Server" terminal window.
echo ============================================================

:end
pause