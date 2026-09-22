@echo off
setlocal EnableExtensions
pushd "%~dp0"

echo ============================================================
echo  ComfyUI Remote - installer All in One per Vast.ai / Windows
echo ============================================================
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-vastai-windows.ps1" %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Installazione non completata. Controlla il messaggio sopra.
) else (
  echo.
  echo Installazione completata.
  echo Avvio successivo: start-vastai.bat
  echo Elenco modelli: docs\VASTAI_MODELS.md
)

popd
exit /b %EXIT_CODE%

