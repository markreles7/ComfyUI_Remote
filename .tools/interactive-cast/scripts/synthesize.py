import argparse
import contextlib
import json
import os
import sys
from pathlib import Path


LANGUAGE_ALIASES = {
    "italiano": "it",
    "italian": "it",
    "english": "en",
    "inglese": "en",
    "spanish": "es",
    "spagnolo": "es",
    "french": "fr",
    "francese": "fr",
    "german": "de",
    "tedesco": "de",
}


def tool_directory():
    configured = os.environ.get("INTERACTIVE_CAST_TOOL_DIR")
    return Path(configured).resolve() if configured else Path(__file__).resolve().parents[1]


def normalize_language(value):
    language = str(value or "en").strip().lower()
    return LANGUAGE_ALIASES.get(language, language.split("-")[0])


def load_model():
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    with contextlib.redirect_stdout(sys.stderr):
        model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
    marker = tool_directory() / "models" / "chatterbox-multilingual" / ".ready"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({
        "model": "ResembleAI/chatterbox",
        "variant": "multilingual-v3",
        "device": device,
    }), encoding="utf-8")
    return model, device


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default="")
    parser.add_argument("--language", default="en")
    parser.add_argument("--speaker", default="speaker")
    parser.add_argument("--reference")
    parser.add_argument("--output")
    parser.add_argument("--prefetch", action="store_true")
    parser.add_argument("--exaggeration", type=float, default=0.5)
    parser.add_argument("--cfg-weight", type=float, default=0.5)
    args = parser.parse_args()

    model, device = load_model()
    if args.prefetch:
        print(json.dumps({
            "configured": True,
            "engine": "chatterbox-multilingual",
            "device": device,
        }))
        return
    if not args.text.strip():
        raise ValueError("Text is required.")
    if not args.output:
        raise ValueError("Output path is required.")
    if not args.reference or not Path(args.reference).is_file():
        raise ValueError("A valid reference audio file is required for voice cloning.")

    import torchaudio

    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    language = normalize_language(args.language)
    with contextlib.redirect_stdout(sys.stderr):
        wav = model.generate(
            args.text.strip(),
            language_id=language,
            audio_prompt_path=str(Path(args.reference).resolve()),
            exaggeration=max(0.0, min(1.0, args.exaggeration)),
            cfg_weight=max(0.0, min(1.0, args.cfg_weight)),
        )
        torchaudio.save(str(output), wav.cpu(), model.sr)
    print(json.dumps({
        "path": str(output),
        "mimeType": "audio/wav",
        "engine": "chatterbox-multilingual",
        "device": device,
        "language": language,
        "speaker": args.speaker,
        "watermarked": True,
    }))


if __name__ == "__main__":
    main()
