#!/usr/bin/env bash
set -Eeuo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMFYUI_ROOT="${COMFYUI_ROOT:-/workspace/ComfyUI}"
if [[ ! -f "$COMFYUI_ROOT/main.py" ]]; then
  echo "ComfyUI non trovato in $COMFYUI_ROOT. Imposta COMFYUI_ROOT al percorso del template Vast.ai." >&2
  exit 1
fi

PYTHON="${COMFYUI_PYTHON:-}"
if [[ -z "$PYTHON" ]]; then
  for candidate in "$COMFYUI_ROOT/venv/bin/python" "$COMFYUI_ROOT/.venv/bin/python" /venv/main/bin/python /opt/venv/bin/python; do
    if [[ -x "$candidate" ]]; then PYTHON="$candidate"; break; fi
  done
fi
PYTHON="${PYTHON:-$(command -v python3)}"
echo "ComfyUI: $COMFYUI_ROOT"
echo "Python: $PYTHON"

if [[ "${1:-}" == "--check" ]]; then
  "$PYTHON" "$PACKAGE_DIR/models.py" --check "$COMFYUI_ROOT"
  [[ -f "$COMFYUI_ROOT/custom_nodes/Nvidia_RTX_Nodes_ComfyUI/__init__.py" ]] || {
    echo "Nodo NVIDIA RTX VSR mancante: riesegui ./install.sh" >&2
    exit 1
  }
  "$PYTHON" -c "import nvvfx; print('NVIDIA VFX runtime: OK')" || {
    echo "Runtime nvidia-vfx mancante o non caricabile: riesegui ./install.sh" >&2
    exit 1
  }
  exit $?
fi

command -v git >/dev/null || { echo "git mancante nel template" >&2; exit 1; }
"$PYTHON" -m pip --version >/dev/null || { echo "pip mancante nell'ambiente Python di ComfyUI" >&2; exit 1; }

mkdir -p "$COMFYUI_ROOT/custom_nodes" "$COMFYUI_ROOT/user/default/workflows"
while IFS='|' read -r name url; do
  [[ -z "$name" || "$name" == \#* ]] && continue
  destination="$COMFYUI_ROOT/custom_nodes/$name"
  if [[ -d "$destination/.git" ]]; then
    echo "Gia presente: $name"
  elif [[ -e "$destination" ]]; then
    echo "Directory esistente non Git: $destination; controllo manuale necessario" >&2
    exit 1
  else
    git clone --depth 1 "$url" "$destination"
  fi
  if [[ "$name" == "Nvidia_RTX_Nodes_ComfyUI" ]]; then
    architecture="$(uname -m)"
    if [[ "$architecture" != "x86_64" && "$architecture" != "amd64" ]]; then
      echo "NVIDIA RTX VSR richiede Linux x86_64; architettura rilevata: $architecture" >&2
      exit 1
    fi
    echo "Installazione runtime NVIDIA VFX dal repository NVIDIA PyPI"
    "$PYTHON" -m pip install --upgrade wheel-stub
    "$PYTHON" -m pip install --upgrade --no-build-isolation --extra-index-url https://pypi.nvidia.com nvidia-vfx
  fi
  if [[ -f "$destination/requirements.txt" ]]; then
    "$PYTHON" -m pip install -r "$destination/requirements.txt"
  fi
done < "$PACKAGE_DIR/nodes.txt"

[[ -f "$COMFYUI_ROOT/custom_nodes/Nvidia_RTX_Nodes_ComfyUI/__init__.py" ]] || {
  echo "Installazione incompleta: Nvidia_RTX_Nodes_ComfyUI non è presente." >&2
  exit 1
}
"$PYTHON" -c "import nvvfx; print('NVIDIA RTX Video Super Resolution: nodo e runtime disponibili')" || {
  echo "Il repository RTX è presente ma il runtime nvidia-vfx non è importabile." >&2
  exit 1
}

local_node="$PACKAGE_DIR/PlagueKind_Reference_Memory"
if [[ ! -d "$local_node" ]]; then
  echo "Nodi locali mancanti: $local_node. Estrai di nuovo il pacchetto completo." >&2
  exit 1
fi
cp -a "$local_node" "$COMFYUI_ROOT/custom_nodes/"
"$PYTHON" -m pip install --upgrade huggingface_hub
combat_lora="$COMFYUI_ROOT/models/loras/H3/STY_Combat.safetensors"
weapon_lora="$COMFYUI_ROOT/models/loras/H3/MOT_Weapon_Combat_H3_trigger-BUNNY.safetensors"
if [[ -z "${CIVITAI_API_TOKEN:-${CIVITAI_TOKEN:-}}" && ( ! -s "$combat_lora" || ! -s "$weapon_lora" ) ]]; then
  if [[ -t 0 ]]; then
    echo "Le LoRA Combat e Weapon sono su Civitai e richiedono un API token personale."
    read -r -s -p "CIVITAI_API_TOKEN: " CIVITAI_API_TOKEN
    echo
    export CIVITAI_API_TOKEN
  else
    echo "Token Civitai mancante. Imposta CIVITAI_API_TOKEN e rilancia ./install.sh" >&2
    exit 1
  fi
fi
"$PYTHON" "$PACKAGE_DIR/models.py" "$COMFYUI_ROOT"
cp "$PACKAGE_DIR/PlagueKind_H3_V9_Reference_ComfyUI.json" "$COMFYUI_ROOT/user/default/workflows/"
cp "$PACKAGE_DIR/PlagueKind_H3_V9_Continuous_R2V_ComfyUI.json" "$COMFYUI_ROOT/user/default/workflows/"
cp "$PACKAGE_DIR/PlagueKind_H3_V9_Continuous_R2V_UHD_ComfyUI.json" "$COMFYUI_ROOT/user/default/workflows/"
echo "Installazione terminata. Riavvia ComfyUI, poi apri il workflow R2V singolo, continuo standard o Continuous_R2V_UHD per il master 4K."
