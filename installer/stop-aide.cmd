@echo off
chcp 65001 >nul
setlocal EnableExtensions
if not defined AIDE_DATA set "AIDE_DATA=%APPDATA%\AIDE"
set "PIDFILE=%AIDE_DATA%\server.pid"

if not exist "%PIDFILE%" (
  echo [AIDE] No server.pid found. AIDE may not be running.
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

set /p PID=<"%PIDFILE%"
if "%PID%"=="" (
  del /q "%PIDFILE%" >nul 2>nul
  echo [AIDE] Empty pid file, nothing to stop.
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%PID%' -ErrorAction SilentlyContinue; if($p -and $p.CommandLine -like '*app\server\dist\index.js*'){exit 0}else{exit 1}"
if errorlevel 1 (
  echo [AIDE] PID %PID% is not an AIDE server; removing stale pid file.
  del /q "%PIDFILE%" >nul 2>nul
  ping -n 3 127.0.0.1 >nul
  exit /b 0
)

echo [AIDE] Stopping PID %PID% ...
taskkill /PID %PID% /T /F >nul 2>nul
del /q "%PIDFILE%" >nul 2>nul
echo [AIDE] Stopped.
ping -n 2 127.0.0.1 >nul
