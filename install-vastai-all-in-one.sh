#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${VASTAI_WORKSPACE:-/workspace}"
COMFYUI_ROOT="${COMFYUI_ROOT:-$WORKSPACE/ComfyUI}"
CUDA_WHEEL="${CUDA_WHEEL:-cu128}"
INSTALL_TIER="${INSTALL_TIER:-full}"
VALIDATE_ONLY="${VALIDATE_ONLY:-false}"
[[ "${1:-}" == "--check" ]] && VALIDATE_ONLY=true

step() { printf '\n==> %s\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Comando mancante: $1" >&2; exit 1; }; }

step "Preflight spazio e GPU"
df -h "$WORKSPACE" 2>/dev/null || df -h "$(dirname "$WORKSPACE")"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
  echo "ATTENZIONE: nvidia-smi non trovato; controlla il template CUDA di Vast.ai."
fi

if [[ "$VALIDATE_ONLY" == "true" ]]; then
  for required in config/vastai-custom-nodes.txt comfyui_nodes/ComfyUI_Remote_Model_Loaders docs/VASTAI_MODELS.md package.json package-lock.json; do
    [[ -e "$PROJECT_ROOT/$required" ]] || { echo "File installer mancante: $required" >&2; exit 1; }
  done
  awk -F'|' 'NF && $1 !~ /^#/ { if (NF != 3 || ($1 != "core" && $1 != "extended") || $3 !~ /^https:\/\/github\.com\/.+\.git$/) exit 1; count++ } END { if (!count) exit 1; print "Validazione installer completata: " count " custom node configurati." }' "$PROJECT_ROOT/config/vastai-custom-nodes.txt"
  exit 0
fi

if command -v apt-get >/dev/null 2>&1; then
  step "Dipendenze di sistema"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y git curl ca-certificates ffmpeg build-essential libgl1 libglib2.0-0
  if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
fi
need git; need curl; need node; need npm

step "Installazione uv e Python 3.12"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
need uv
uv python install 3.12

step "Installazione o aggiornamento ComfyUI"
mkdir -p "$WORKSPACE"
if [[ -d "$COMFYUI_ROOT/.git" ]]; then
  git -C "$COMFYUI_ROOT" pull --ff-only
elif [[ -e "$COMFYUI_ROOT" ]]; then
  echo "La destinazione esiste ma non è un clone Git: $COMFYUI_ROOT" >&2; exit 1
else
  git clone --depth 1 https://github.com/Comfy-Org/ComfyUI.git "$COMFYUI_ROOT"
fi

PYTHON="$COMFYUI_ROOT/.venv/bin/python"
[[ -x "$PYTHON" ]] || uv venv --python 3.12 "$COMFYUI_ROOT/.venv"
uv pip install --python "$PYTHON" torch torchvision torchaudio --index-url "https://download.pytorch.org/whl/$CUDA_WHEEL"
uv pip install --python "$PYTHON" -r "$COMFYUI_ROOT/requirements.txt"
uv pip install --python "$PYTHON" --upgrade huggingface_hub

step "Installazione custom node"
mkdir -p "$COMFYUI_ROOT/custom_nodes"
while IFS='|' read -r tier folder url; do
  [[ -z "${tier:-}" || "$tier" == \#* ]] && continue
  [[ "$INSTALL_TIER" == "minimal" && "$tier" == "extended" ]] && continue
  destination="$COMFYUI_ROOT/custom_nodes/$folder"
  if [[ -d "$destination/.git" ]]; then git -C "$destination" pull --ff-only
  elif [[ ! -e "$destination" ]]; then git clone --depth 1 "$url" "$destination"
  else echo "ATTENZIONE: $folder esiste senza .git; conservato."; fi
  if [[ "$folder" == "Nvidia_RTX_Nodes_ComfyUI" ]]; then
    [[ "$(uname -m)" == "x86_64" || "$(uname -m)" == "amd64" ]] || { echo "NVIDIA RTX VSR richiede Linux x86_64." >&2; exit 1; }
    uv pip install --python "$PYTHON" --upgrade wheel-stub
    uv pip install --python "$PYTHON" --upgrade --no-build-isolation --extra-index-url https://pypi.nvidia.com nvidia-vfx
  fi
  [[ -f "$destination/requirements.txt" ]] && uv pip install --python "$PYTHON" -r "$destination/requirements.txt"
  [[ -f "$destination/install.py" ]] && (cd "$destination" && "$PYTHON" install.py)
done < "$PROJECT_ROOT/config/vastai-custom-nodes.txt"

if [[ "$INSTALL_TIER" != "minimal" ]]; then
  "$PYTHON" -c "import nvvfx; print('NVIDIA RTX Video Super Resolution: runtime OK')"
fi

step "Installazione nodo locale e cartelle modelli"
cp -a "$PROJECT_ROOT/comfyui_nodes/." "$COMFYUI_ROOT/custom_nodes/"
while IFS= read -r requirements; do uv pip install --python "$PYTHON" -r "$requirements"; done < <(find "$PROJECT_ROOT/comfyui_nodes" -name requirements.txt -type f)
for folder in diffusion_models diffusion_models/FluxKrea2 diffusion_models/FLUX2 diffusion_models/QWEN diffusion_models/Z-IMG text_encoders vae loras loras/H3 latent_upscale_models model_patches upscale_models SEEDVR2 pulid insightface; do
  mkdir -p "$COMFYUI_ROOT/models/$folder"
done
mkdir -p "$COMFYUI_ROOT/output"

step "Installazione webapp"
(cd "$PROJECT_ROOT" && npm ci --omit=dev)
if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
  cat > "$PROJECT_ROOT/.env" <<EOF
HOST=127.0.0.1
PORT=3000
COMFY_URL=http://127.0.0.1:8188
COMFY_WS=ws://127.0.0.1:8188
OUTPUT_DIRECTORY=$COMFYUI_ROOT/output
MAX_UPLOAD_MB=30
MAX_VIDEO_UPLOAD_MB=512
AUTO_PURGE_IDLE=true
IDLE_PURGE_DELAY_SECONDS=15
APP_CONFIG_TTL_SECONDS=60
APP_CONFIG_BOOTSTRAP_WAIT_MS=1200
SCENE_INTEGRATION_ENABLED=true
SCENE_ANALYSIS_PYTHON=$PYTHON
INTERACTIVE_CAST_INSIGHTFACE_ROOT=$COMFYUI_ROOT/models/insightface
LM_STUDIO_START_SERVER=false
LM_STUDIO_AUTO_GENERATE=false
EOF
else
  echo "ATTENZIONE: .env esistente conservato. Verifica i percorsi."
fi
cat > "$PROJECT_ROOT/.vastai-install.env" <<EOF
COMFYUI_ROOT=$COMFYUI_ROOT
COMFYUI_PYTHON=$PYTHON
WEBAPP_ROOT=$PROJECT_ROOT
EOF

step "Controllo GPU"
"$PYTHON" -c "import torch; print('PyTorch:', torch.__version__); print('CUDA:', torch.version.cuda); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NON RILEVATA')"
printf '\nInstallazione completata.\nModelli: %s/docs/VASTAI_MODELS.md\nAvvio: %s/start-vastai.sh\n' "$PROJECT_ROOT" "$PROJECT_ROOT"
