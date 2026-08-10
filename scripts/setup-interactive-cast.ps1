param(
  [switch]$SkipPythonPackages,
  [switch]$SkipVoice,
  [switch]$SkipLipSync,
  [switch]$SkipModelDownloads
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ToolDir = Join-Path $Root ".tools\interactive-cast"
$ModelsDir = Join-Path $ToolDir "models"
$CacheDir = Join-Path $ToolDir "cache"
$EnginesDir = Join-Path $ToolDir "engines"
$BaseVenv = Join-Path $ToolDir ".venv"
$VoiceVenv = Join-Path $ToolDir ".venv-voice"
$LipSyncVenv = Join-Path $ToolDir ".venv-lipsync"
$Requirements = Join-Path $ToolDir "requirements.txt"
$LipSyncRequirements = Join-Path $ToolDir "requirements-lipsync.txt"
$ChatterboxDir = Join-Path $EnginesDir "chatterbox"
$MuseTalkDir = Join-Path $EnginesDir "musetalk"

New-Item -ItemType Directory -Force -Path $ToolDir, $ModelsDir, $CacheDir, $EnginesDir | Out-Null
$env:UV_CACHE_DIR = Join-Path $CacheDir "uv"
$env:UV_PYTHON_INSTALL_DIR = Join-Path $ToolDir "python"
$env:HF_HOME = Join-Path $CacheDir "huggingface"
$env:HF_HUB_DISABLE_XET = "1"
$env:TORCH_HOME = Join-Path $CacheDir "torch"

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) { throw $Message }
}

function Ensure-Repository([string]$Url, [string]$Directory) {
  if (Test-Path (Join-Path $Directory ".git")) {
    Write-Host "Engine gia presente: $Directory"
    return
  }
  if (Test-Path $Directory) {
    throw "La directory engine esiste ma non e un clone Git valido: $Directory"
  }
  & git clone --depth 1 $Url $Directory
  Assert-LastExitCode "Clone fallito: $Url"
}

function Ensure-Venv([string]$Directory, [string]$PythonVersion) {
  $Python = Join-Path $Directory "Scripts\python.exe"
  if (Test-Path $Python) { return $Python }
  & uv venv $Directory --python $PythonVersion
  Assert-LastExitCode "Virtualenv Python $PythonVersion non creato: $Directory"
  if (-not (Test-Path $Python)) { throw "Interpreter virtualenv mancante: $Python" }
  return $Python
}

function Download-Hf([string[]]$Arguments) {
  & hf download @Arguments
  Assert-LastExitCode "Download Hugging Face fallito: $($Arguments -join ' ')"
}

Write-Host "Interactive Cast setup isolato"
Write-Host "Tool directory: $ToolDir"

foreach ($Command in @("git", "uv", "hf", "ffmpeg", "ffprobe", "node")) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    throw "$Command non trovato nel PATH."
  }
}

$BasePython = Ensure-Venv $BaseVenv "3.11"
if (-not $SkipPythonPackages -and (Test-Path $Requirements)) {
  & uv pip install --python $BasePython -r $Requirements
  Assert-LastExitCode "Installazione dipendenze base Interactive Cast fallita."
}

if (-not $SkipVoice) {
  Ensure-Repository "https://github.com/resemble-ai/chatterbox.git" $ChatterboxDir
  $VoicePython = Ensure-Venv $VoiceVenv "3.11"
  if (-not $SkipPythonPackages) {
    & uv pip install --python $VoicePython -e $ChatterboxDir
    Assert-LastExitCode "Installazione Chatterbox fallita."
    & uv pip install --python $VoicePython torch==2.6.0+cu124 torchaudio==2.6.0+cu124 --index-url https://download.pytorch.org/whl/cu124 --reinstall
    Assert-LastExitCode "Installazione Torch CUDA isolato per Chatterbox fallita."
  }
  if (-not $SkipModelDownloads) {
    $env:INTERACTIVE_CAST_TOOL_DIR = $ToolDir
    & $VoicePython (Join-Path $ToolDir "scripts\synthesize.py") --prefetch
    Assert-LastExitCode "Prefetch Chatterbox Multilingual v3 fallito."
  }
}

if (-not $SkipLipSync) {
  Ensure-Repository "https://github.com/TMElyralab/MuseTalk.git" $MuseTalkDir
  $LipSyncPython = Ensure-Venv $LipSyncVenv "3.10"
  if (-not $SkipPythonPackages) {
    & uv pip install --python $LipSyncPython torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118
    Assert-LastExitCode "Installazione Torch CUDA isolato per MuseTalk fallita."
    & uv pip install --python $LipSyncPython -r $LipSyncRequirements
    Assert-LastExitCode "Installazione dipendenze MuseTalk fallita."
    & uv pip install --python $LipSyncPython pip setuptools==80.9.0 wheel
    Assert-LastExitCode "Bootstrap build tools MuseTalk fallito."
    & uv pip install --python $LipSyncPython chumpy==0.70 --no-build-isolation
    Assert-LastExitCode "Installazione compatibilita chumpy per MMPose fallita."
    & uv pip install --python $LipSyncPython mmengine==0.10.7 mmdet==3.1.0 mmpose==1.1.0
    Assert-LastExitCode "Installazione stack MMPose per MuseTalk fallita."
    & uv pip install --python $LipSyncPython mmcv==2.0.1 --find-links https://download.openmmlab.com/mmcv/dist/cu118/torch2.0/index.html
    Assert-LastExitCode "Installazione estensioni MMCV CUDA per MuseTalk fallita."
  }
  if (-not $SkipModelDownloads) {
    $MuseModels = Join-Path $MuseTalkDir "models"
    Download-Hf @("TMElyralab/MuseTalk", "--local-dir", $MuseModels, "--include", "musetalkV15/*")
    Download-Hf @("stabilityai/sd-vae-ft-mse", "--local-dir", (Join-Path $MuseModels "sd-vae"), "config.json", "diffusion_pytorch_model.bin")
    Download-Hf @("openai/whisper-tiny", "--local-dir", (Join-Path $MuseModels "whisper"), "config.json", "pytorch_model.bin", "preprocessor_config.json")
    Download-Hf @("yzd-v/DWPose", "--local-dir", (Join-Path $MuseModels "dwpose"), "dw-ll_ucoco_384.pth")
    Download-Hf @("ManyOtherFunctions/face-parse-bisent", "--local-dir", (Join-Path $MuseModels "face-parse-bisent"), "79999_iter.pth", "resnet18-5c106cde.pth")
    $S3fdDirectory = Join-Path $CacheDir "torch\hub\checkpoints"
    $S3fdPath = Join-Path $S3fdDirectory "s3fd-619a316812.pth"
    if (-not (Test-Path $S3fdPath)) {
      New-Item -ItemType Directory -Force -Path $S3fdDirectory | Out-Null
      Invoke-WebRequest -Uri "https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth" -OutFile $S3fdPath
    }
  }
}

node (Join-Path $Root "scripts\audit-interactive-cast.js")
Assert-LastExitCode "Audit Interactive Cast fallito."

Write-Host "Interactive Cast configurato. Nessun pacchetto del Python ComfyUI e stato modificato."
