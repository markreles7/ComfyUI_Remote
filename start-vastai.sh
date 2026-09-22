#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -f "$PROJECT_ROOT/.vastai-install.env" ]] || { echo "Esegui prima ./install-vastai-all-in-one.sh" >&2; exit 1; }
set -a; source "$PROJECT_ROOT/.vastai-install.env"; set +a
mkdir -p "$PROJECT_ROOT/.data/vastai-logs"
LOWVRAM_ARGS=()
[[ "${LOW_VRAM:-false}" == "true" ]] && LOWVRAM_ARGS+=(--lowvram)
nohup "$COMFYUI_PYTHON" "$COMFYUI_ROOT/main.py" --listen 127.0.0.1 --port 8188 "${LOWVRAM_ARGS[@]}" > "$PROJECT_ROOT/.data/vastai-logs/comfyui.out.log" 2> "$PROJECT_ROOT/.data/vastai-logs/comfyui.err.log" &
(cd "$PROJECT_ROOT" && nohup npm start > .data/vastai-logs/webapp.out.log 2> .data/vastai-logs/webapp.err.log &)
echo "ComfyUI e webapp avviati su localhost (8188 e 3000)."
echo "Tunnel: ssh -L 3000:127.0.0.1:3000 -L 8188:127.0.0.1:8188 root@HOST_VAST"

