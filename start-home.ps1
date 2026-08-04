$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDirectory

if (-not (Test-Path -LiteralPath ".env")) {
    throw "File .env mancante. Esegui prima .\setup-home.ps1"
}

$existingProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe' AND CommandLine LIKE '%src/server.js%'" | Select-Object -ExpandProperty ProcessId)
if ($existingProcesses.Count -gt 0) {
    foreach ($processId in $existingProcesses) {
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

npm start
