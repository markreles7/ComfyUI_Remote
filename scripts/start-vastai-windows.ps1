[CmdletBinding()]
param([switch]$LowVram)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$stateFile = Join-Path $projectRoot ".vastai-install.env"
if (-not (Test-Path -LiteralPath $stateFile)) { throw "Esegui prima install-vastai-all-in-one.bat" }
$state = @{}
Get-Content -LiteralPath $stateFile | ForEach-Object {
    if ($_ -match '^([^=]+)=(.*)$') { $state[$matches[1]] = $matches[2] }
}
$comfyRoot = $state.COMFYUI_ROOT
$pythonExe = $state.COMFYUI_PYTHON
if (-not (Test-Path -LiteralPath $pythonExe)) { throw "Python ComfyUI non trovato: $pythonExe" }

$logs = Join-Path $projectRoot ".data\vastai-logs"
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$comfyArgs = @("main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-comfy-compiler")
if ($LowVram) { $comfyArgs += "--lowvram" }

Write-Host "Avvio ComfyUI..."
Start-Process -FilePath $pythonExe -ArgumentList $comfyArgs -WorkingDirectory $comfyRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "comfyui.out.log") -RedirectStandardError (Join-Path $logs "comfyui.err.log")
Write-Host "Avvio webapp..."
Start-Process -FilePath "npm.cmd" -ArgumentList "start" -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logs "webapp.out.log") -RedirectStandardError (Join-Path $logs "webapp.err.log")

Write-Host "Servizi avviati su localhost: ComfyUI 8188, webapp 3000."
Write-Host "Da PC locale usa un tunnel SSH: ssh -L 3000:127.0.0.1:3000 -L 8188:127.0.0.1:8188 UTENTE@HOST_VAST"
