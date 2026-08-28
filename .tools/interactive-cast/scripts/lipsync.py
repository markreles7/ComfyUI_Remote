import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def tool_directory():
    configured = os.environ.get("INTERACTIVE_CAST_TOOL_DIR")
    return Path(configured).resolve() if configured else Path(__file__).resolve().parents[1]


def media_duration(file):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(file)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    return max(0.04, float(probe.stdout.strip()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--end", type=float, default=0)
    parser.add_argument("--mask")
    parser.add_argument("--batch-size", type=int, default=4)
    args = parser.parse_args()

    tool_dir = tool_directory()
    engine = tool_dir / "engines" / "musetalk"
    models = engine / "models"
    video = Path(args.video).resolve()
    audio = Path(args.audio).resolve()
    output = Path(args.output).resolve()
    if not video.is_file() or not audio.is_file():
        raise FileNotFoundError("MuseTalk requires an existing source video and dialogue audio.")

    output.parent.mkdir(parents=True, exist_ok=True)
    cache_dir = tool_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix="interactive-cast-musetalk-", dir=cache_dir))
    result_dir = work_dir / "results"
    config = work_dir / "task.json"
    output_name = "interactive-cast-lipsync.mp4"
    config.write_text(json.dumps({
        "interactive_cast": {
            "video_path": str(video),
            "audio_path": str(audio),
            "result_name": output_name,
        }
    }), encoding="utf-8")

    command = [
        sys.executable,
        "-m", "scripts.inference",
        "--inference_config", str(config),
        "--result_dir", str(result_dir),
        "--unet_model_path", str(models / "musetalkV15" / "unet.pth"),
        "--unet_config", str(models / "musetalkV15" / "musetalk.json"),
        "--whisper_dir", str(models / "whisper"),
        "--vae_type", "sd-vae",
        "--version", "v15",
        "--batch_size", str(max(1, min(16, args.batch_size))),
        "--use_float16",
        "--parsing_mode", "jaw",
        "--output_vid_name", output_name,
    ]
    engine_env = os.environ.copy()
    engine_env["PYTHONUTF8"] = "1"
    engine_env["PYTHONIOENCODING"] = "utf-8"
    engine_env["TORCH_HOME"] = str(tool_dir / "cache" / "torch")
    engine_env["HF_HOME"] = str(tool_dir / "cache" / "huggingface")
    engine_env["PYTHONPATH"] = os.pathsep.join(filter(None, [
        str(engine),
        str(engine / "musetalk" / "utils"),
        engine_env.get("PYTHONPATH", ""),
    ]))
    completed = subprocess.run(
        command,
        cwd=engine,
        env=engine_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
        check=False,
    )
    sys.stderr.write(completed.stdout or "")
    sys.stderr.write(completed.stderr or "")
    generated = result_dir / "v15" / output_name
    if completed.returncode != 0 or not generated.is_file():
        tail = "\n".join((completed.stdout or "").splitlines()[-12:])
        raise RuntimeError(
            f"MuseTalk 1.5 did not produce the expected output (exit {completed.returncode}). "
            f"Last engine output: {tail}"
        )
    source_duration = media_duration(video)
    normalized = work_dir / "duration-normalized.mp4"
    normalize = subprocess.run([
        "ffmpeg", "-y", "-i", str(generated),
        "-vf", "tpad=stop_mode=clone:stop_duration=3600",
        "-af", "apad", "-t", f"{source_duration:.6f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(normalized),
    ], capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if normalize.returncode != 0 or not normalized.is_file():
        raise RuntimeError(f"Lip-sync duration normalization failed: {normalize.stderr[-1000:]}")
    shutil.copy2(normalized, output)
    shutil.rmtree(work_dir, ignore_errors=True)
    print(json.dumps({
        "path": str(output),
        "mimeType": "video/mp4",
        "engine": "musetalk-1.5",
        "mode": "jaw-region-lipsync",
        "sourceStart": args.start,
        "sourceEnd": args.end,
        "duration": source_duration,
        "externalMaskUsed": False,
        "externalMaskNote": "MuseTalk 1.5 applies its own parsed jaw mask." if args.mask else None,
    }))


if __name__ == "__main__":
    main()
