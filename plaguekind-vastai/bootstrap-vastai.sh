#!/usr/bin/env bash
set -Eeuo pipefail

# Bootstrap per il template ufficiale Vast.ai ComfyUI. Scarica il pacchetto
# pubblicato dal repository, lo estrae e installa soltanto ComfyUI/PlagueKind.
WORKSPACE_ROOT="${WORKSPACE:-/workspace}"
COMFYUI_ROOT="${COMFYUI_ROOT:-$WORKSPACE_ROOT/ComfyUI}"
PACKAGE_URL="${PLAGUEKIND_PACKAGE_URL:-https://raw.githubusercontent.com/markreles7/ComfyUI_Remote/main/plaguekind-vastai.zip}"
PACKAGE_ZIP="$WORKSPACE_ROOT/plaguekind-vastai.zip"
PACKAGE_DIR="$WORKSPACE_ROOT/plaguekind-vastai"
LOG_FILE="$WORKSPACE_ROOT/plaguekind-vastai-install.log"

mkdir -p "$WORKSPACE_ROOT"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "[$(date -Is)] Bootstrap PlagueKind H3 V9"

if [[ ! -f "$COMFYUI_ROOT/main.py" ]]; then
  echo "ComfyUI non trovato in $COMFYUI_ROOT." >&2
  echo "Usa il template ufficiale vastai/comfy oppure imposta COMFYUI_ROOT." >&2
  exit 1
fi

if [[ -z "${CIVITAI_API_TOKEN:-${CIVITAI_TOKEN:-}}" ]]; then
  echo "CIVITAI_API_TOKEN non impostato: serve per le LoRA Combat e Weapon." >&2
  echo "Aggiungilo tra le variabili d'ambiente del template Vast.ai e riavvia." >&2
  exit 1
fi

command -v curl >/dev/null || { echo "curl non disponibile nel template." >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 non disponibile nel template." >&2; exit 1; }

echo "Download pacchetto: $PACKAGE_URL"
curl --fail --location --retry 5 --retry-delay 5 \
  --output "$PACKAGE_ZIP.part" "$PACKAGE_URL"
mv "$PACKAGE_ZIP.part" "$PACKAGE_ZIP"

# zipfile evita di dipendere dal comando unzip. L'estrazione sovrascrive solo
# i file distribuiti nel pacchetto e non tocca modelli/output già persistenti.
python3 -m zipfile -e "$PACKAGE_ZIP" "$WORKSPACE_ROOT"
chmod +x "$PACKAGE_DIR/install.sh"

COMFYUI_ROOT="$COMFYUI_ROOT" "$PACKAGE_DIR/install.sh"
COMFYUI_ROOT="$COMFYUI_ROOT" "$PACKAGE_DIR/install.sh" --check

echo "[$(date -Is)] Installazione PlagueKind completata."
echo "Se ComfyUI era già avviato: supervisorctl restart comfyui"
