#!/usr/bin/env python3
"""Deterministic comparison metrics used by the Scene Integration evaluator."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from skimage.metrics import structural_similarity


def metric(score, confidence, method):
    return {
        "score": round(float(np.clip(score, 0, 100)), 2),
        "confidence": round(float(np.clip(confidence, 0, 1)), 3),
        "method": method,
    }


def load_image(path: str):
    image = cv2.imread(path, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Unable to read image: {path}")
    return image


def inferred_change_mask(source, result):
    source_lab = cv2.cvtColor(source, cv2.COLOR_BGR2LAB).astype(np.float32)
    result_lab = cv2.cvtColor(result, cv2.COLOR_BGR2LAB).astype(np.float32)
    difference = np.linalg.norm(source_lab - result_lab, axis=2)
    threshold = max(10.0, float(np.percentile(difference, 70)))
    mask = (difference > threshold).astype(np.uint8) * 255
    kernel = np.ones((7, 7), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
    if count > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        mask = (labels == largest).astype(np.uint8) * 255
    return mask


def identity_metric(source, result):
    try:
        from insightface.app import FaceAnalysis

        analyzer = FaceAnalysis(
            name="buffalo_sc",
            providers=["CPUExecutionProvider"],
        )
        analyzer.prepare(ctx_id=-1, det_size=(640, 640))
        source_faces = analyzer.get(source)
        result_faces = analyzer.get(result)
        source_embeddings = [
            face.normed_embedding
            for face in source_faces
            if getattr(face, "normed_embedding", None) is not None
        ]
        result_embeddings = [
            face.normed_embedding
            for face in result_faces
            if getattr(face, "normed_embedding", None) is not None
        ]
        if not source_embeddings or not result_embeddings:
            return metric(50, 0.0, "insightface-no-comparable-faces")
        similarities = []
        for source_embedding in source_embeddings:
            similarities.append(max(
                float(np.dot(source_embedding, result_embedding))
                for result_embedding in result_embeddings
            ))
        cosine = float(np.mean(similarities))
        score = np.clip((cosine - 0.15) / 0.75, 0, 1) * 100
        face_coverage = min(len(source_embeddings), len(result_embeddings)) / max(
            len(source_embeddings),
            len(result_embeddings),
        )
        return metric(
            score,
            0.82 * face_coverage,
            f"insightface-buffalo_sc-cosine:{cosine:.3f}",
        )
    except Exception as error:
        return metric(50, 0.0, f"identity-analysis-unavailable:{type(error).__name__}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--mask")
    parser.add_argument("--output", required=True)
    parser.add_argument("--artifacts")
    args = parser.parse_args()
    source = load_image(args.source)
    result = load_image(args.result)
    result = cv2.resize(result, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_LANCZOS4)
    explicit_mask = bool(args.mask)
    if explicit_mask:
        mask = cv2.imread(args.mask, cv2.IMREAD_GRAYSCALE)
        if mask is None:
            raise RuntimeError("Unable to read evaluation mask")
        mask = cv2.resize(mask, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_NEAREST)
    else:
        mask = inferred_change_mask(source, result)
    outside = mask < 64
    source_gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    result_gray = cv2.cvtColor(result, cv2.COLOR_BGR2GRAY)
    _, ssim_map = structural_similarity(source_gray, result_gray, data_range=255, full=True)
    background_score = float(np.mean(ssim_map[outside]) * 100) if np.any(outside) else 50.0
    boundary = cv2.morphologyEx(mask, cv2.MORPH_GRADIENT, np.ones((9, 9), np.uint8)) > 0
    source_edges = cv2.Laplacian(source_gray, cv2.CV_32F)
    result_edges = cv2.Laplacian(result_gray, cv2.CV_32F)
    edge_delta = np.mean(np.abs(source_edges[boundary] - result_edges[boundary])) if np.any(boundary) else 64
    edge_score = 100 * (1 - np.clip(edge_delta / 128, 0, 1))
    source_lines = cv2.Canny(source_gray, 80, 180)
    result_lines = cv2.Canny(result_gray, 80, 180)
    line_overlap = np.mean((source_lines > 0) == (result_lines > 0)) * 100
    # Perspective and scale are proxy scores. Confidence remains deliberately
    # low because semantic geometry is not available in this deterministic pass.
    metrics = {
        "backgroundPreservation": metric(background_score, 0.88 if explicit_mask else 0.38, "masked-ssim" if explicit_mask else "inferred-change-mask-ssim"),
        "edgeCompositingQuality": metric(edge_score, 0.7 if explicit_mask else 0.35, "mask-boundary-laplacian"),
        "perspectiveCoherence": metric(line_overlap, 0.28, "global-edge-structure-proxy"),
        "scaleCoherence": metric(50, 0.0, "semantic-subject-scale-unavailable"),
        "depthCoherence": metric(50, 0.0, "depth-map-comparison-not-run"),
        "identityPreservation": identity_metric(source, result),
    }
    artifacts = {}
    if args.artifacts:
        artifact_dir = Path(args.artifacts)
        artifact_dir.mkdir(parents=True, exist_ok=True)
        token = Path(args.output).stem.replace("comfy-remote-compare-", "")[-16:]
        mask_name = f"evaluation-mask-{token}.png"
        difference_name = f"evaluation-difference-{token}.png"
        difference = cv2.absdiff(source, result)
        heat = cv2.applyColorMap(
            cv2.normalize(
                cv2.cvtColor(difference, cv2.COLOR_BGR2GRAY),
                None,
                0,
                255,
                cv2.NORM_MINMAX,
            ).astype(np.uint8),
            cv2.COLORMAP_TURBO,
        )
        cv2.imwrite(str(artifact_dir / mask_name), mask)
        cv2.imwrite(str(artifact_dir / difference_name), heat)
        artifacts = {
            "evaluationMask": mask_name,
            "evaluationDifference": difference_name,
        }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump({
            "metrics": metrics,
            "usedExplicitMask": explicit_mask,
            "artifacts": artifacts,
        }, handle, indent=2)


if __name__ == "__main__":
    main()
