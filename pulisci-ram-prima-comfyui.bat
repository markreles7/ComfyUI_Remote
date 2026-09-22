@echo off
setlocal
pushd "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\pulisci-ram-prima-comfyui.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
echo.
if not "%EXIT_CODE%"=="0" echo Pulizia incompleta. Controlla i messaggi sopra.
pause
exit /b %EXIT_CODE%
