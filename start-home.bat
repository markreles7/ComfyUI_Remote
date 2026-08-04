@echo off
setlocal

pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-home.ps1"
set "EXIT_CODE=%ERRORLEVEL%"
popd

exit /b %EXIT_CODE%
