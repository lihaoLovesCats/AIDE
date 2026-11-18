@echo off
chcp 65001 >nul
title AIDE
setlocal EnableExtensions
set "ROOT=%~dp0"
if not defined AIDE_DATA set "AIDE_DATA=%APPDATA%\AIDE"
if not defined AIDE_PORT set "AIDE_PORT=7800"
set "AIDE_WEB_DIST=%ROOT%app\web"
if not exist "%AIDE_DATA%" mkdir "%AIDE_DATA%" >nul 2>nul

if not exist "%ROOT%node\node.exe" (
  echo [AIDE] Installation is incomplete: node\node.exe is missing.
  echo [AIDE] Please reinstall AIDE.
  pause
  exit /b 1
)

rem If AIDE is already listening, just open the browser.
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod 'http://127.0.0.1:%AIDE_PORT%/api/health' -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  echo [AIDE] Already running, opening browser...
  start "" http://127.0.0.1:%AIDE_PORT%
  exit /b 0
)

where claude >nul 2>nul
if errorlevel 1 (
  echo.
  echo [AIDE] WARNING: claude CLI was not found in PATH.
  echo         Install Claude Code CLI and sign in before using agents.
  echo         https://docs.anthropic.com/en/docs/claude-code
  echo.
  ping -n 5 127.0.0.1 >nul
)

echo [AIDE] Starting...
echo         URL:  http://127.0.0.1:%AIDE_PORT%
echo         Data: %AIDE_DATA%
echo         Close this window or run stop-aide.cmd to stop AIDE.
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%open-browser.ps1"
"%ROOT%node\node.exe" "%ROOT%app\server\dist\index.js" 1>>"%AIDE_DATA%\server.log" 2>&1
set "CODE=%errorlevel%"

echo.
echo [AIDE] Server exited with code %CODE%. Last log lines:
powershell -NoProfile -Command "Get-Content -Tail 25 -Encoding UTF8 '%AIDE_DATA%\server.log'"
echo.
pause
