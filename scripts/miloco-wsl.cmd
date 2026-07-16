@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0miloco-wsl.ps1" %*
exit /b %ERRORLEVEL%
