"""Download only the weights named in the PlagueKind V9 graphical workflow."""
from pathlib import Path
import argparse
import hashlib
import os
import sys
import urllib.error
import urllib.request

MODELS = (
    ("smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models", "minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors", "diffusion_models/video/minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors"),
    ("Kijai/MiniMax-H3-experimental", "minimax_h3_video_vae_int8_convrot.safetensors", "vae/minimax_h3_video_vae_int8_convrot.safetensors"),
    ("Comfy-Org/MiniMax-H3", "vae/minimax_h3_audio_vae_fp32.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors"),
    ("Comfy-Org/MiniMax-H3", "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors", "text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors"),
    ("Plaguekind/H3-Lora", "H3-PK-Parasyte-Turbo.safetensors", "loras/H3/turbo/test/H3-PK-Parasyte-Turbo.safetensors"),
    ("Plaguekind/H3-Lora", "otherturbo/fasth3_6step.safetensors", "loras/H3/turbo/test/fasth3_6step.safetensors"),
    ("Kijai/MiniMax-H3-TAE", "vae_approx/taeh3.safetensors", "vae_approx/taeh3.safetensors"),
    ("deAPI-ai/minimax-h3-33b-int8", "loras/h3_silu_temb_grid.safetensors", "h3_adaln/h3_silu_temb_grid.safetensors"),
    ("LBH-123-AI/Minimax_h3_latent_Upscaler", "minimax_h3_latent_upscaler_3d_bf16.safetensors", "latent_upscale_models/minimax_h3_latent_upscaler_3d_bf16.safetensors"),
    ("Comfy-Org/frame_interpolation", "frame_interpolation/film_net_fp16.safetensors", "frame_interpolation/film_net_fp16.safetensors"),
)

# Exact versions identified from the SHA-256 hashes of the user's local files.
# Civitai downloads require a personal API token; it is read from the
# environment and is never written into the package or printed to the console.
CIVITAI_LORAS = (
    (
        "Combat V2 BASE",
        "https://civitai.com/api/download/models/3246572?fileId=3129355",
        "loras/H3/STY_Combat.safetensors",
        "5b3edb09e9d6029439badf9bc9db4ba4a355ae679b0810888de82c4793c0bac8",
    ),
    (
        "Weapon Combat v1.0",
        "https://civitai.com/api/download/models/3283995?fileId=3168220",
        "loras/H3/MOT_Weapon_Combat_H3_trigger-BUNNY.safetensors",
        "d49de2902f3ea5e6889d9489c031ed64694de93d6a77c111d164f83c0dc359df",
    ),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download_civitai(url: str, target: Path, expected_sha256: str, token: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "User-Agent": "PlagueKind-VastAI-Installer/1.0",
            "Accept": "application/octet-stream",
        },
    )
    digest = hashlib.sha256()
    try:
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
            content_type = response.headers.get("Content-Type", "")
            if "text/html" in content_type.lower():
                raise RuntimeError("Civitai ha restituito la pagina di login: token mancante o non valido")
            while True:
                block = response.read(8 * 1024 * 1024)
                if not block:
                    break
                output.write(block)
                digest.update(block)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Civitai HTTP {exc.code}: verifica CIVITAI_API_TOKEN") from exc
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    actual = digest.hexdigest()
    if actual != expected_sha256:
        partial.unlink(missing_ok=True)
        raise RuntimeError(
            f"SHA-256 errato per {target.name}: atteso {expected_sha256}, ricevuto {actual}"
        )
    partial.replace(target)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("comfyui_root", type=Path)
    args = parser.parse_args()
    root = args.comfyui_root / "models"
    if args.check:
        missing = [destination for _, _, destination in MODELS if not (root / destination).is_file() or (root / destination).stat().st_size == 0]
        for _, _, destination, expected_sha256 in CIVITAI_LORAS:
            target = root / destination
            if not target.is_file() or target.stat().st_size == 0:
                missing.append(destination)
            elif sha256_file(target) != expected_sha256:
                missing.append(f"{destination} (SHA-256 non corrispondente)")
        for destination in missing:
            print(f"MISSING {destination}")
        total = len(MODELS) + len(CIVITAI_LORAS)
        print(f"Pesi verificati: {total - len(missing)}/{total}")
        return 1 if missing else 0

    from huggingface_hub import hf_hub_download

    for repo, source, destination in MODELS:
        target = root / destination
        if target.is_file() and target.stat().st_size > 0:
            print(f"Gia presente: {destination}")
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        print(f"Download: {repo}/{source} -> {destination}", flush=True)
        revision = "09592c6221ec95cc8e0fae67842e34926c4e668b" if repo == "LBH-123-AI/Minimax_h3_latent_Upscaler" else None
        hf_hub_download(repo_id=repo, filename=source, revision=revision, local_dir=target.parent)
        downloaded = target.parent / source
        if downloaded != target:
            downloaded.replace(target)
        if not target.is_file() or target.stat().st_size == 0:
            raise RuntimeError(f"Download incompleto: {destination}")

    token = os.environ.get("CIVITAI_API_TOKEN") or os.environ.get("CIVITAI_TOKEN")
    for label, url, destination, expected_sha256 in CIVITAI_LORAS:
        target = root / destination
        if target.is_file() and target.stat().st_size > 0:
            actual = sha256_file(target)
            if actual == expected_sha256:
                print(f"Gia presente e verificata: {destination}")
                continue
            raise RuntimeError(f"File esistente ma diverso dalla versione richiesta: {destination}")
        if not token:
            raise RuntimeError(
                "Le LoRA Combat e Weapon richiedono un token Civitai. "
                "Esegui: export CIVITAI_API_TOKEN='il_tuo_token' e rilancia ./install.sh"
            )
        print(f"Download Civitai: {label} -> {destination}", flush=True)
        download_civitai(url, target, expected_sha256, token)
        print(f"SHA-256 verificato: {destination}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"ERRORE: {exc}", file=sys.stderr)
        sys.exit(1)
