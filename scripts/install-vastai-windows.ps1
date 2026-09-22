[CmdletBinding()]
param(
    [string]$Workspace = "C:\VastAI",
    [string]$ComfyUIRoot = "",
    [ValidateSet("cu128", "cu130")]
    [string]$CudaWheel = "cu128",
    [switch]$Minimal,
    [switch]$SkipSystemPackages,
    [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ComfyUIRoot) { $ComfyUIRoot = Join-Path $Workspace "ComfyUI" }
$ComfyUIRoot = [IO.Path]::GetFullPath($ComfyUIRoot)
$Workspace = [IO.Path]::GetFullPath($Workspace)
$customNodesRoot = Join-Path $ComfyUIRoot "custom_nodes"
$pythonExe = Join-Path $ComfyUIRoot ".venv\Scripts\python.exe"

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user;$env:Path"
}

function Install-WingetPackage([string]$Id, [string]$Label) {
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "$Label non trovato e winget non disponibile. Installa $Label, poi rilancia il BAT."
    }
    Write-Host "Installazione $Label..."
    & winget.exe install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget non ha installato $Label (codice $LASTEXITCODE)." }
    Refresh-Path
}

Write-Step "Preflight spazio e GPU"
$workspaceDrive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($Workspace).TrimEnd("\").TrimEnd(":")) -ErrorAction SilentlyContinue
if ($workspaceDrive) {
    $freeGiB = [math]::Round($workspaceDrive.Free / 1GB, 1)
    Write-Host "Spazio libero su $($workspaceDrive.Root): $freeGiB GiB"
    if ($freeGiB -lt 50) { Write-Warning "Meno di 50 GiB liberi: bastano appena al software, non ai modelli H3/LTX." }
}
if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
    & nvidia-smi.exe --query-gpu=name,memory.total,driver_version --format=csv,noheader
} else {
    Write-Warning "nvidia-smi non trovato: controlla driver NVIDIA/CUDA dell'immagine Vast.ai."
}

if ($ValidateOnly) {
    $requiredFiles = @(
        "config\vastai-custom-nodes.txt", "comfyui_nodes\ComfyUI_Remote_Model_Loaders",
        "docs\VASTAI_MODELS.md", "package.json", "package-lock.json"
    )
    foreach ($relative in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw "File installer mancante: $relative" }
    }
    $manifestLines = Get-Content -LiteralPath (Join-Path $projectRoot "config\vastai-custom-nodes.txt") |
        Where-Object { $_ -and -not $_.TrimStart().StartsWith("#") }
    foreach ($line in $manifestLines) {
        $parts = $line.Split("|", 3)
        if ($parts.Count -ne 3 -or $parts[0] -notin @("core", "extended") -or $parts[2] -notmatch '^https://github\.com/.+\.git$') {
            throw "Riga manifesto non valida: $line"
        }
    }
    Write-Host "Validazione installer completata: $($manifestLines.Count) custom node configurati." -ForegroundColor Green
    return
}

if (-not $SkipSystemPackages) {
    Write-Step "Controllo strumenti di sistema"
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { Install-WingetPackage "Git.Git" "Git" }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS" }
    if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) { Install-WingetPackage "Gyan.FFmpeg" "FFmpeg" }
    $hasPython312 = $false
    if (Get-Command py.exe -ErrorAction SilentlyContinue) {
        & py.exe -3.12 -c "import sys; assert sys.version_info[:2] == (3, 12)" 2>$null
        $hasPython312 = $LASTEXITCODE -eq 0
    } elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
        & python.exe -c "import sys; assert sys.version_info[:2] == (3, 12)" 2>$null
        $hasPython312 = $LASTEXITCODE -eq 0
    }
    if (-not $hasPython312) {
        Install-WingetPackage "Python.Python.3.12" "Python 3.12"
    }
}

foreach ($command in @("git", "node", "npm")) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Comando richiesto non disponibile: $command" }
}
$nodeMajor = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { throw "Serve Node.js 20 o successivo; versione trovata: $(& node --version)" }

$pythonCommand = if (Get-Command py.exe -ErrorAction SilentlyContinue) { @("py", "-3.12") } else { @("python") }
New-Item -ItemType Directory -Force -Path $Workspace | Out-Null

Write-Step "Installazione o aggiornamento ComfyUI"
if (Test-Path -LiteralPath (Join-Path $ComfyUIRoot ".git")) {
    & git -C $ComfyUIRoot pull --ff-only
} elseif (Test-Path -LiteralPath $ComfyUIRoot) {
    throw "La destinazione esiste ma non è un clone Git di ComfyUI: $ComfyUIRoot"
} else {
    & git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git $ComfyUIRoot
}
if ($LASTEXITCODE -ne 0) { throw "Clone/aggiornamento ComfyUI fallito." }

Write-Step "Creazione ambiente Python 3.12 e installazione CUDA/PyTorch"
if (-not (Test-Path -LiteralPath $pythonExe)) {
    if ($pythonCommand[0] -eq "py") { & py -3.12 -m venv (Join-Path $ComfyUIRoot ".venv") }
    else { & python -m venv (Join-Path $ComfyUIRoot ".venv") }
}
& $pythonExe -m pip install --upgrade pip setuptools wheel
& $pythonExe -m pip install torch torchvision torchaudio --index-url "https://download.pytorch.org/whl/$CudaWheel"
& $pythonExe -m pip install -r (Join-Path $ComfyUIRoot "requirements.txt")
& $pythonExe -m pip install --upgrade huggingface_hub

Write-Step "Installazione custom node"
New-Item -ItemType Directory -Force -Path $customNodesRoot | Out-Null
$manifest = Join-Path $projectRoot "config\vastai-custom-nodes.txt"
$entries = Get-Content -LiteralPath $manifest | Where-Object { $_ -and -not $_.TrimStart().StartsWith("#") }
foreach ($entry in $entries) {
    $tier, $folder, $url = $entry.Split("|", 3)
    if ($Minimal -and $tier -eq "extended") { continue }
    $destination = Join-Path $customNodesRoot $folder
    $gitExit = 0
    if (Test-Path -LiteralPath (Join-Path $destination ".git")) {
        Write-Host "Aggiorno $folder"
        & git -C $destination pull --ff-only
        $gitExit = $LASTEXITCODE
    } elseif (-not (Test-Path -LiteralPath $destination)) {
        Write-Host "Clono $folder"
        & git clone --depth 1 $url $destination
        $gitExit = $LASTEXITCODE
    } else {
        Write-Warning "$folder esiste senza metadati Git: lo lascio invariato."
    }
    if ($gitExit -ne 0) { throw "Installazione custom node fallita: $folder" }
    if ($folder -eq "Nvidia_RTX_Nodes_ComfyUI") {
        & $pythonExe -m pip install --upgrade wheel-stub
        if ($LASTEXITCODE -ne 0) { throw "Installazione wheel-stub per NVIDIA RTX VSR fallita." }
        & $pythonExe -m pip install --upgrade --no-build-isolation --extra-index-url https://pypi.nvidia.com nvidia-vfx
        if ($LASTEXITCODE -ne 0) { throw "Installazione runtime nvidia-vfx fallita." }
    }
    $requirements = Join-Path $destination "requirements.txt"
    if (Test-Path -LiteralPath $requirements) { & $pythonExe -m pip install -r $requirements }
    $installPy = Join-Path $destination "install.py"
    if (Test-Path -LiteralPath $installPy) {
        Push-Location $destination
        try { & $pythonExe $installPy } finally { Pop-Location }
    }
}

if (-not $Minimal) {
    & $pythonExe -c "import nvvfx; print('NVIDIA RTX Video Super Resolution: runtime OK')"
    if ($LASTEXITCODE -ne 0) { throw "Il runtime NVIDIA RTX VSR non è importabile." }
}

Write-Step "Installazione nodo locale ComfyUI Remote"
$localNodesRoot = Join-Path $projectRoot "comfyui_nodes"
Get-ChildItem -LiteralPath $localNodesRoot -Directory | ForEach-Object {
    $destination = Join-Path $customNodesRoot $_.Name
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Copy-Item -Path (Join-Path $_.FullName "*") -Destination $destination -Recurse -Force
    $requirements = Join-Path $destination "requirements.txt"
    if (Test-Path -LiteralPath $requirements) { & $pythonExe -m pip install -r $requirements }
}

Write-Step "Creazione cartelle modelli"
$modelFolders = @(
    "diffusion_models", "diffusion_models\FluxKrea2", "diffusion_models\FLUX2",
    "diffusion_models\QWEN", "diffusion_models\Z-IMG", "text_encoders", "vae",
    "loras", "loras\H3", "latent_upscale_models", "model_patches", "upscale_models",
    "SEEDVR2", "pulid", "insightface"
)
foreach ($folder in $modelFolders) { New-Item -ItemType Directory -Force -Path (Join-Path $ComfyUIRoot "models\$folder") | Out-Null }
New-Item -ItemType Directory -Force -Path (Join-Path $ComfyUIRoot "output") | Out-Null

Write-Step "Installazione webapp"
Push-Location $projectRoot
try { & npm ci --omit=dev } finally { Pop-Location }

$envFile = Join-Path $projectRoot ".env"
$envLines = @(
    "HOST=127.0.0.1",
    "PORT=3000",
    "COMFY_URL=http://127.0.0.1:8188",
    "COMFY_WS=ws://127.0.0.1:8188",
    "OUTPUT_DIRECTORY=$ComfyUIRoot\output",
    "MAX_UPLOAD_MB=30",
    "MAX_VIDEO_UPLOAD_MB=512",
    "AUTO_PURGE_IDLE=true",
    "IDLE_PURGE_DELAY_SECONDS=15",
    "APP_CONFIG_TTL_SECONDS=60",
    "APP_CONFIG_BOOTSTRAP_WAIT_MS=1200",
    "SCENE_INTEGRATION_ENABLED=true",
    "SCENE_ANALYSIS_PYTHON=$pythonExe",
    "INTERACTIVE_CAST_INSIGHTFACE_ROOT=$ComfyUIRoot\models\insightface",
    "LM_STUDIO_START_SERVER=false",
    "LM_STUDIO_AUTO_GENERATE=false"
)
if (-not (Test-Path -LiteralPath $envFile)) {
    Set-Content -LiteralPath $envFile -Value $envLines -Encoding UTF8
    Write-Host "Creato $envFile"
} else {
    Write-Warning ".env esistente conservato. Verifica manualmente OUTPUT_DIRECTORY e SCENE_ANALYSIS_PYTHON."
}

$stateFile = Join-Path $projectRoot ".vastai-install.env"
Set-Content -LiteralPath $stateFile -Value @(
    "COMFYUI_ROOT=$ComfyUIRoot",
    "COMFYUI_PYTHON=$pythonExe",
    "WEBAPP_ROOT=$projectRoot"
) -Encoding UTF8

Write-Step "Controllo GPU Python"
& $pythonExe -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.version.cuda); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NON RILEVATA')"

Write-Host "`nInstallazione completata." -ForegroundColor Green
Write-Host "1. Scarica i modelli indicati in: $projectRoot\docs\VASTAI_MODELS.md"
Write-Host "2. Avvia con: $projectRoot\start-vastai.bat"
Write-Host "3. Accedi tramite tunnel SSH; non esporre direttamente le porte 3000/8188."
