param(
    [string]$ComfyRoot = "E:\ComfyUI\Data\Packages\ComfyUI LTX"
)

$resolvedRoot = (Resolve-Path -LiteralPath $ComfyRoot -ErrorAction Stop).Path
$python = Join-Path $resolvedRoot "venv\Scripts\python.exe"
$main = Join-Path $resolvedRoot "main.py"

if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $main)) {
    throw "Installazione ComfyUI non trovata in $resolvedRoot"
}

Set-Location -LiteralPath $resolvedRoot
& $python $main --preview-method auto --use-pytorch-cross-attention --enable-manager --disable-comfy-compiler
