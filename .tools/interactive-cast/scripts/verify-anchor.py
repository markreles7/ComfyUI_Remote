import argparse
import contextlib
import io
import json
import os
import sys

import cv2
import numpy as np


def parse_region(value):
    parts = [float(item) for item in str(value or "").split(",")]
    if len(parts) != 4:
        raise ValueError("region must contain x,y,width,height")
    return tuple(max(0.0, min(1.0, item)) for item in parts)


def load_image(path):
    image = cv2.imread(path)
    if image is None:
        raise ValueError(f"cannot read image: {path}")
    return image


def face_record(face, width, height):
    x1, y1, x2, y2 = [float(item) for item in face.bbox]
    return {
        "box": [x1, y1, x2, y2],
        "normalizedBox": [x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height],
        "center": [((x1 + x2) / 2) / width, ((y1 + y2) / 2) / height],
        "detScore": float(face.det_score),
    }


def in_region(face, region, width, height):
    x1, y1, x2, y2 = [float(item) for item in face.bbox]
    cx = ((x1 + x2) / 2) / width
    cy = ((y1 + y2) / 2) / height
    x, y, w, h = region
    return x <= cx <= x + w and y <= cy <= y + h


def similarity(a, b):
    return float(np.dot(a.normed_embedding, b.normed_embedding))


def pixel_metrics(source, candidate, region):
    if source.shape[:2] != candidate.shape[:2]:
        candidate = cv2.resize(candidate, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    height, width = source.shape[:2]
    x, y, w, h = region
    left = max(0, min(width - 1, int(x * width)))
    top = max(0, min(height - 1, int(y * height)))
    right = max(left + 1, min(width, int((x + w) * width)))
    bottom = max(top + 1, min(height, int((y + h) * height)))
    delta = np.mean(np.abs(source.astype(np.float32) - candidate.astype(np.float32)), axis=2)
    inside = delta[top:bottom, left:right]
    outside_mask = np.ones((height, width), dtype=bool)
    outside_mask[top:bottom, left:right] = False
    return {
        "insideMeanDelta": float(np.mean(inside) / 255.0),
        "insideChangedRatio": float(np.mean(inside >= 12.0)),
        "outsideMeanDelta": float(np.mean(delta[outside_mask]) / 255.0) if np.any(outside_mask) else 0.0,
    }


def build_app(model_root):
    with contextlib.redirect_stdout(io.StringIO()):
        from insightface.app import FaceAnalysis
        app = FaceAnalysis(name="buffalo_l", root=model_root, providers=["CPUExecutionProvider"])
        app.prepare(ctx_id=-1, det_size=(640, 640))
    return app


def detect(app, image):
    with contextlib.redirect_stdout(io.StringIO()):
        return app.get(image)


def analyze(args, app):
    source = load_image(args.source)
    height, width = source.shape[:2]
    faces = detect(app, source)
    return {
        "status": "analyzed",
        "image": {"width": width, "height": height},
        "faces": [face_record(face, width, height) for face in faces],
    }


def verify(args, app):
    source = load_image(args.source)
    candidate = load_image(args.candidate)
    references = [load_image(item) for item in args.reference]
    region = parse_region(args.region)
    source_faces = detect(app, source)
    candidate_faces = detect(app, candidate)
    reference_faces = [face for image in references for face in detect(app, image)]
    height, width = candidate.shape[:2]
    region_faces = [face for face in candidate_faces if in_region(face, region, width, height)]

    identity_matches = [
        similarity(reference, candidate_face)
        for reference in reference_faces
        for candidate_face in region_faces
    ]
    best_identity = max(identity_matches, default=-1.0)
    source_matches = [
        max((similarity(source_face, candidate_face) for candidate_face in candidate_faces), default=-1.0)
        for source_face in source_faces
    ]
    preserved_sources = sum(value >= args.preserve_threshold for value in source_matches)
    pixels = pixel_metrics(source, candidate, region)

    checks = {
        "referenceFaceAvailable": bool(reference_faces),
        "newIdentityMatched": best_identity >= args.identity_threshold,
        "personCountIncreased": len(candidate_faces) >= len(source_faces) + 1,
        "originalFacesPreserved": not source_faces or preserved_sources == len(source_faces),
        "targetRegionChanged": pixels["insideChangedRatio"] >= args.change_ratio,
        "outsideRegionPreserved": pixels["outsideMeanDelta"] <= args.outside_delta,
    }
    failures = [name for name, passed in checks.items() if not passed]
    return {
        "status": "passed" if not failures else "rejected",
        "engine": "insightface-buffalo-l-anchor-gate",
        "checks": checks,
        "failures": failures,
        "sourceFaceCount": len(source_faces),
        "candidateFaceCount": len(candidate_faces),
        "candidateFacesInTargetRegion": len(region_faces),
        "referenceFaceCount": len(reference_faces),
        "bestIdentitySimilarity": round(best_identity, 4),
        "sourceFaceSimilarities": [round(value, 4) for value in source_matches],
        "thresholds": {
            "identity": args.identity_threshold,
            "preserve": args.preserve_threshold,
            "changeRatio": args.change_ratio,
            "outsideDelta": args.outside_delta,
        },
        "pixels": {name: round(value, 6) for name, value in pixels.items()},
        "sourceFaces": [face_record(face, source.shape[1], source.shape[0]) for face in source_faces],
        "candidateFaces": [face_record(face, width, height) for face in candidate_faces],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["analyze", "verify"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--candidate")
    parser.add_argument("--reference", action="append", default=[])
    parser.add_argument("--region", default="0.35,0.12,0.25,0.76")
    parser.add_argument("--model-root", required=True)
    parser.add_argument("--identity-threshold", type=float, default=0.32)
    parser.add_argument("--preserve-threshold", type=float, default=0.30)
    parser.add_argument("--change-ratio", type=float, default=0.08)
    parser.add_argument("--outside-delta", type=float, default=0.025)
    args = parser.parse_args()
    if args.mode == "verify" and (not args.candidate or not args.reference):
        raise ValueError("verify requires --candidate and at least one --reference")
    app = build_app(args.model_root)
    result = analyze(args, app) if args.mode == "analyze" else verify(args, app)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=True))
        sys.exit(1)
