@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

rem OpenX 一键重启：结束占用 3921 / 5173 的旧进程，再启动 dev

cd /d "%~dp0"

echo.
echo [OpenX] 正在检查并结束旧进程...

call :kill_port 3921
call :kill_port 5173

echo.
echo [OpenX] 启动 server + web ...
echo   API:  http://127.0.0.1:3921
echo   Web:  http://localhost:5173/
echo.

pnpm dev
goto :eof

:kill_port
set "PORT=%~1"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  if not "%%a"=="0" (
    echo   结束端口 %PORT% 上的进程 PID=%%a
    taskkill /PID %%a /F >nul 2>&1
  )
)
exit /b 0
