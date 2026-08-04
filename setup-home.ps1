$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDirectory

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js non è installato. Installa Node.js 20 o successivo e riprova."
}

if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "Creato .env con l'indirizzo Tailscale 100.77.122.74."
}

Write-Host "Installazione dipendenze..."
npm install

Write-Host ""
Write-Host "Configurazione completata."
Write-Host "Avvia l'app con: .\start-home.ps1"
Write-Host "Poi apri: http://100.77.122.74:3000"
