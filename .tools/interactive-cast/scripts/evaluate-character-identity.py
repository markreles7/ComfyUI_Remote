import argparse
import contextlib
import io
import json
import sys


def runtime():
    try:
        import cv2
        import numpy as np
        import onnxruntime
        from insightface.app import FaceAnalysis
        return {
            "available": True,
            "cv2": cv2,
            "np": np,
            "FaceAnalysis": FaceAnalysis,
            "providers": onnxruntime.get_available_providers(),
        }
    except Exception as error:
        return {"available": False, "error": str(error), "providers": []}


def build_app(info, model_root):
    preferred = [
        provider for provider in ["CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider"]
        if provider in info["providers"]
    ]
    with contextlib.redirect_stdout(io.StringIO()):
        app = info["FaceAnalysis"](name="buffalo_l", root=model_root, providers=preferred)
        app.prepare(ctx_id=0 if "CUDAExecutionProvider" in preferred else -1, det_size=(640, 640))
    return app


def largest_face(app, cv2, path):
    image = cv2.imread(path)
    if image is None:
        raise ValueError(f"cannot read image: {path}")
    with contextlib.redirect_stdout(io.StringIO()):
        faces = app.get(image)
    if not faces:
        return None
    return max(faces, key=lambda face: float((face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1])))


def normalized_embedding(face, np):
    value = getattr(face, "normed_embedding", None)
    if value is not None:
        return value
    value = getattr(face, "embedding", None)
    if value is None:
        return None
    norm = np.linalg.norm(value)
    return value / norm if norm else value


def parse_reference(value):
    reference_id, separator, path = value.partition("=")
    if not separator or not reference_id or not path:
        raise ValueError("reference must use id=path")
    return reference_id, path


def evaluate(args, info):
    app = build_app(info, args.model_root)
    hero_face = largest_face(app, info["cv2"], args.hero)
    if hero_face is None:
        return {"status": "failed", "error": "Nessun volto umano rilevato nella Hero.", "evaluations": []}
    hero_embedding = normalized_embedding(hero_face, info["np"])
    if hero_embedding is None:
        return {"status": "failed", "error": "Embedding InsightFace non disponibile per la Hero.", "evaluations": []}
    evaluations = []
    for raw in args.reference:
        reference_id, path = parse_reference(raw)
        face = largest_face(app, info["cv2"], path)
        if face is None:
            evaluations.append({"referenceId": reference_id, "score": None, "warnings": ["Nessun volto umano rilevato nella reference."]})
            continue
        embedding = normalized_embedding(face, info["np"])
        score = float(info["np"].dot(hero_embedding, embedding)) if embedding is not None else None
        evaluations.append({
            "referenceId": reference_id,
            "score": round(score, 6) if score is not None else None,
            "warnings": [] if score is not None else ["Embedding InsightFace non disponibile nella reference."],
        })
    return {"status": "completed", "engine": "InsightFace buffalo_l", "evaluations": evaluations}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["capabilities", "evaluate"])
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--hero")
    parser.add_argument("--reference", action="append", default=[])
    args = parser.parse_args()
    info = runtime()
    if args.mode == "capabilities":
        print(json.dumps({
            "available": info["available"],
            "engine": "InsightFace buffalo_l",
            "subjectKindsSupported": ["human"],
            "providers": info.get("providers", []),
            "error": info.get("error"),
        }, ensure_ascii=True))
        return
    if not info["available"]:
        print(json.dumps({"status": "failed", "error": info.get("error"), "evaluations": []}, ensure_ascii=True))
        return
    if not args.hero or not args.reference:
        raise ValueError("evaluate requires --hero and at least one --reference")
    print(json.dumps(evaluate(args, info), ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error), "evaluations": []}, ensure_ascii=True))
        sys.exit(1)
