#!/usr/bin/env python3
"""Deterministic, low-VRAM scene analysis for ComfyUI Remote.

The analyzer intentionally labels photographic properties as estimates. Heavy
semantic/depth models are orchestrated separately through ComfyUI.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np


def estimate(value: Any, confidence: float, method: str, unit: str = "normalized", fallback=None):
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, np.ndarray):
        value = value.tolist()
    return {
        "value": value,
        "unit": unit,
        "confidence": round(float(np.clip(confidence, 0, 1)), 3),
        "method": method,
        "fallback": fallback,
    }


def resize_for_analysis(image: np.ndarray, scale: float, max_side: int = 1280) -> np.ndarray:
    height, width = image.shape[:2]
    factor = min(1.0, max(0.1, scale), max_side / max(width, height))
    if factor >= 0.999:
        return image
    return cv2.resize(image, (max(8, round(width * factor)), max(8, round(height * factor))), interpolation=cv2.INTER_AREA)


def palette(image: np.ndarray, count: int = 5):
    pixels = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).reshape(-1, 3).astype(np.float32)
    if len(pixels) > 20000:
        rng = np.random.default_rng(42)
        pixels = pixels[rng.choice(len(pixels), 20000, replace=False)]
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centers = cv2.kmeans(pixels, count, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    frequencies = np.bincount(labels.flatten(), minlength=count) / max(1, len(labels))
    order = np.argsort(frequencies)[::-1]
    return [
        {
            "hex": "#%02x%02x%02x" % tuple(np.clip(centers[index], 0, 255).astype(int)),
            "weight": round(float(frequencies[index]), 4),
        }
        for index in order
    ]


def blockiness(gray: np.ndarray) -> float:
    if gray.shape[0] < 16 or gray.shape[1] < 16:
        return 0.0
    vertical = np.abs(np.diff(gray.astype(np.float32), axis=1))
    horizontal = np.abs(np.diff(gray.astype(np.float32), axis=0))
    boundary = np.mean(vertical[:, 7::8]) + np.mean(horizontal[7::8, :])
    interior = np.mean(vertical[:, 3::8]) + np.mean(horizontal[3::8, :]) + 1e-6
    return float(np.clip((boundary / interior - 1) / 2, 0, 1))


def dominant_light_direction(gray: np.ndarray):
    threshold = np.percentile(gray, 85)
    weights = np.clip(gray.astype(np.float32) - threshold, 0, None)
    total = weights.sum()
    if total < 1:
        return {"x": 0.0, "y": -1.0}, 0.1
    yy, xx = np.indices(gray.shape)
    cx = float((xx * weights).sum() / total) / max(1, gray.shape[1] - 1)
    cy = float((yy * weights).sum() / total) / max(1, gray.shape[0] - 1)
    vector = np.array([cx - 0.5, cy - 0.5], dtype=np.float32)
    norm = float(np.linalg.norm(vector))
    if norm > 1e-5:
        vector /= norm
    return {"x": round(float(vector[0]), 3), "y": round(float(vector[1]), 3)}, min(0.8, 0.25 + norm)


def horizon_estimate(gray: np.ndarray):
    edges = cv2.Canny(gray, 60, 160)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=60, minLineLength=max(40, gray.shape[1] // 5), maxLineGap=12)
    candidates = []
    if lines is not None:
        for line in lines[:, 0]:
            x1, y1, x2, y2 = [int(value) for value in line]
            angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1)))
            if angle < 12 or angle > 168:
                length = math.hypot(x2 - x1, y2 - y1)
                candidates.append(((y1 + y2) / 2, length))
    if not candidates:
        return None, 0.0
    y = sum(value * weight for value, weight in candidates) / sum(weight for _, weight in candidates)
    return float(y / gray.shape[0]), min(0.75, len(candidates) / 12)


def image_metrics(image: np.ndarray, artifact_dir: Path | None = None, prefix: str = "scene"):
    small = image
    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB)
    luma = gray.astype(np.float32) / 255.0
    hist, _ = np.histogram(gray, bins=64, range=(0, 256), density=False)
    hist = hist.astype(np.float64) / max(1, hist.sum())
    means_bgr = small.reshape(-1, 3).mean(axis=0)
    means_rgb = means_bgr[::-1]
    warm_cool = float((means_rgb[0] - means_rgb[2]) / 255.0)
    green_magenta = float((means_rgb[1] - (means_rgb[0] + means_rgb[2]) / 2) / 255.0)
    temperature = int(np.clip(6500 + warm_cool * 6000, 2500, 10000))
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    sharpness_norm = float(np.clip(math.log1p(sharpness) / 8, 0, 1))
    high_pass = gray.astype(np.float32) - cv2.GaussianBlur(gray.astype(np.float32), (0, 0), 1.2)
    grain = float(np.clip(np.std(high_pass) / 64, 0, 1))
    direction, direction_confidence = dominant_light_direction(gray)
    horizon, horizon_confidence = horizon_estimate(gray)

    height, width = gray.shape
    center = luma[height // 4: height * 3 // 4, width // 4: width * 3 // 4]
    border_mask = np.ones_like(luma, dtype=bool)
    border_mask[height // 4: height * 3 // 4, width // 4: width * 3 // 4] = False
    border = luma[border_mask]
    vignette = float(np.clip(center.mean() - border.mean(), -1, 1))
    local_mean = cv2.GaussianBlur(luma, (0, 0), 7)
    local_contrast = float(np.mean(np.abs(luma - local_mean)))
    shadow_fraction = float(np.mean(luma < np.percentile(luma, 25)))
    highlights = luma[luma > np.percentile(luma, 90)]
    shadows = luma[luma < np.percentile(luma, 10)]
    key_ambient = float(np.mean(highlights) / max(0.01, np.mean(shadows))) if len(highlights) and len(shadows) else 1.0
    saturation = float(hsv[:, :, 1].mean() / 255.0)
    bloom = float(np.mean((luma > 0.92) & (cv2.GaussianBlur(luma, (0, 0), 4) > 0.75)))
    edge_density = float(np.mean(cv2.Canny(gray, 80, 180) > 0))
    compression = blockiness(gray)

    # A deliberately low-confidence proxy. A real Depth Anything artifact can
    # replace this through the ComfyUI analysis stage.
    vertical_prior = np.linspace(0.15, 0.85, height, dtype=np.float32)[:, None]
    depth_proxy = cv2.GaussianBlur(0.65 * (1.0 - luma) + 0.35 * vertical_prior, (0, 0), 5)
    depth_proxy = cv2.normalize(depth_proxy, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    artifacts = {}
    if artifact_dir:
        artifact_dir.mkdir(parents=True, exist_ok=True)
        luma_path = artifact_dir / f"{prefix}-luminance.png"
        edges_path = artifact_dir / f"{prefix}-edges.png"
        depth_path = artifact_dir / f"{prefix}-depth-proxy.png"
        histogram_path = artifact_dir / f"{prefix}-histogram.png"
        cv2.imwrite(str(luma_path), gray)
        cv2.imwrite(str(edges_path), cv2.Canny(gray, 80, 180))
        cv2.imwrite(str(depth_path), depth_proxy)
        canvas = np.zeros((320, 640, 3), dtype=np.uint8)
        for channel, color in enumerate([(255, 80, 80), (80, 255, 80), (80, 80, 255)]):
            values = cv2.calcHist([small], [channel], None, [256], [0, 256]).flatten()
            values = values / max(1, values.max()) * 290
            points = np.array([[index * 639 / 255, 310 - value] for index, value in enumerate(values)], np.int32)
            cv2.polylines(canvas, [points], False, color, 1, cv2.LINE_AA)
        cv2.imwrite(str(histogram_path), canvas)
        artifacts = {
            "luminance": luma_path.name,
            "edges": edges_path.name,
            "depthProxy": depth_path.name,
            "histogram": histogram_path.name,
        }

    return {
        "colorProfile": {
            "temperature": estimate(temperature, 0.45, "rgb-warm-cool-balance", "kelvin-estimate"),
            "tint": estimate(green_magenta, 0.5, "rgb-green-magenta-balance"),
            "exposure": estimate(float(np.log2(max(1e-4, luma.mean()) / 0.18)), 0.7, "mean-relative-luminance", "EV-estimate"),
            "luminanceDistribution": estimate(hist.round(6).tolist(), 0.95, "64-bin-luminance-histogram", "probability"),
            "globalContrast": estimate(float(luma.std()), 0.9, "luminance-standard-deviation"),
            "localContrast": estimate(local_contrast, 0.8, "gaussian-local-deviation"),
            "blackPoint": estimate(float(np.percentile(luma, 1)), 0.95, "luminance-percentile-1"),
            "whitePoint": estimate(float(np.percentile(luma, 99)), 0.95, "luminance-percentile-99"),
            "meanSaturation": estimate(saturation, 0.9, "mean-hsv-saturation"),
            "dominantPalette": estimate(palette(small), 0.75, "kmeans-rgb", "hex-weight"),
            "colorCast": estimate({"warmCool": round(warm_cool, 4), "greenMagenta": round(green_magenta, 4)}, 0.55, "channel-balance"),
            "toneRegions": {
                "shadows": estimate(float(np.mean(luma[luma <= np.percentile(luma, 33)])), 0.9, "luminance-tertiles"),
                "midtones": estimate(float(np.mean(luma[(luma > np.percentile(luma, 33)) & (luma < np.percentile(luma, 66))])), 0.9, "luminance-tertiles"),
                "highlights": estimate(float(np.mean(luma[luma >= np.percentile(luma, 66)])), 0.9, "luminance-tertiles"),
            },
        },
        "lightingProfile": {
            "mainDirection": estimate(direction, direction_confidence, "highlight-centroid-2d", "normalized-vector"),
            "shadowSoftness": estimate(float(np.clip(1 - edge_density * 4, 0, 1)), 0.35, "shadow-edge-density"),
            "relativeIntensity": estimate(float(luma.mean()), 0.75, "mean-luminance"),
            "keyToAmbientRatio": estimate(key_ambient, 0.4, "highlight-shadow-ratio", "ratio-estimate"),
            "keyColor": estimate([round(float(value), 2) for value in means_rgb], 0.4, "bright-region-channel-mean", "rgb-255"),
            "backlightPresence": estimate(bool(border.mean() > center.mean() * 1.15), 0.35, "border-center-luminance"),
            "shadowArea": estimate(shadow_fraction, 0.65, "lower-luminance-quartile"),
            "practicalLightPresence": estimate(bool(np.mean(luma > 0.95) > 0.002), 0.35, "compact-highlight-heuristic"),
        },
        "cameraProfile": {
            "depthOfField": estimate(float(np.clip(np.std([
                cv2.Laplacian(tile, cv2.CV_64F).var()
                for tile in np.array_split(gray, 4, axis=1)
            ]) / max(1, sharpness), 0, 1)), 0.35, "regional-sharpness-variance"),
            "blur": estimate(1 - sharpness_norm, 0.7, "laplacian-variance"),
            "apparentSharpness": estimate(sharpness_norm, 0.8, "log-laplacian-variance"),
            "vignette": estimate(vignette, 0.55, "center-border-luminance"),
            "chromaticAberration": estimate(0.0, 0.15, "not-robustly-measurable", fallback="disabled"),
            "lensDistortion": estimate("unknown", 0.0, "insufficient-calibration-data", fallback="none"),
            "perspective": estimate("single-view-estimate", 0.2, "line-orientation-heuristic"),
            "horizonPosition": estimate(horizon, horizon_confidence, "hough-horizontal-lines", "normalized-y"),
            "cameraOrientation": estimate("level" if horizon is not None else "unknown", horizon_confidence, "horizon-lines"),
            "apparentFocalLength": estimate(None, 0.0, "not-identifiable-from-single-uncalibrated-view", "mm-estimate"),
            "bloom": estimate(bloom, 0.45, "highlight-halo-area"),
            "halation": estimate(bloom * max(0, warm_cool), 0.25, "warm-highlight-halo-heuristic"),
        },
        "spatialProfile": {
            "depthMap": estimate(artifacts.get("depthProxy"), 0.18, "luminance-and-vertical-prior", "artifact", fallback="DepthAnythingV2"),
            "mainObjects": estimate([], 0.0, "semantic-model-not-run", fallback="SAM3/Florence2"),
            "groundPlane": estimate({"horizonY": horizon, "bottomY": 1.0}, max(0.1, horizon_confidence * 0.5), "horizon-and-frame-prior"),
            "contactSurfaces": estimate([], 0.0, "semantic-model-not-run", fallback="user-mask-or-depth"),
            "occlusionZones": estimate([], 0.0, "semantic-model-not-run", fallback="SAM3"),
            "perspectiveScale": estimate({"near": 1.0, "far": 0.35}, max(0.1, horizon_confidence * 0.4), "ground-plane-prior"),
            "recommendedPlacement": estimate({"x": 0.5, "y": 0.72}, 0.15, "safe-frame-prior"),
            "contactPoint": estimate({"x": 0.5, "y": 0.9}, 0.15, "lower-frame-prior"),
        },
        "textureProfile": {
            "grainAmount": estimate(grain, 0.65, "high-pass-residual"),
            "grainSize": estimate(1.2, 0.35, "fixed-scale-high-pass", "pixel-estimate"),
            "digitalNoise": estimate(grain * (1 - saturation * 0.25), 0.5, "chromatic-high-pass-heuristic"),
            "compression": estimate(compression, 0.65, "8x8-boundary-discontinuity"),
            "detailLevel": estimate(sharpness_norm, 0.8, "log-laplacian-variance"),
            "texture": estimate("fine" if grain < 0.2 else "coarse", 0.45, "high-pass-residual"),
            "cinematicLook": estimate(float(np.clip(local_contrast * 4 + bloom * 2, 0, 1)), 0.25, "contrast-bloom-heuristic"),
            "finishing": {
                "recommendedGrain": round(float(np.clip(grain * 0.12, 0.003, 0.08)), 4),
                "recommendedBlurSigma": round(float(np.clip((1 - sharpness_norm) * 1.8, 0, 1.8)), 3),
            },
        },
        "artifacts": artifacts,
        "_summary": {
            "meanLuminance": float(luma.mean()),
            "meanSaturation": saturation,
            "sharpness": sharpness_norm,
            "grain": grain,
            "histogram": hist.tolist(),
            "meanLab": [float(value) for value in lab.reshape(-1, 3).mean(axis=0)],
        },
    }


def analyze_image(path: Path, scale: float, artifact_dir: Path | None):
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Unsupported or unreadable image: {path}")
    original_height, original_width = image.shape[:2]
    image = resize_for_analysis(image, scale)
    result = image_metrics(image, artifact_dir)
    result["sourceMetadata"] = {
        "filename": path.name,
        "width": original_width,
        "height": original_height,
        "analysisWidth": image.shape[1],
        "analysisHeight": image.shape[0],
        "channels": 3,
    }
    result["temporalProfile"] = {
        "available": False,
        "reason": "Still image",
    }
    return result


def analyze_video(path: Path, scale: float, max_frames: int, artifact_dir: Path | None):
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Unsupported or unreadable video: {path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / fps if fps > 0 else 0
    sample_count = max(2, min(max_frames, frame_count if frame_count > 0 else max_frames))
    indices = np.linspace(0, max(0, frame_count - 1), sample_count).astype(int) if frame_count > 0 else np.arange(sample_count)
    frames = []
    for index in indices:
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
        ok, frame = capture.read()
        if ok:
            frames.append(resize_for_analysis(frame, scale, 960))
    capture.release()
    if not frames:
        raise RuntimeError("No decodable frames in video")
    base = image_metrics(frames[len(frames) // 2], artifact_dir, "video")
    flows, flow_vectors, histogram_deltas, exposure_values, sharpness_values = [], [], [], [], []
    previous_gray = None
    previous_hist = None
    for frame in frames:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        exposure_values.append(float(gray.mean() / 255))
        sharpness_values.append(float(np.clip(math.log1p(cv2.Laplacian(gray, cv2.CV_64F).var()) / 8, 0, 1)))
        hist = cv2.calcHist([gray], [0], None, [32], [0, 256])
        cv2.normalize(hist, hist)
        if previous_gray is not None:
            flow = cv2.calcOpticalFlowFarneback(previous_gray, gray, None, 0.5, 3, 15, 3, 5, 1.2, 0)
            vector = np.median(flow.reshape(-1, 2), axis=0)
            magnitude = np.linalg.norm(flow, axis=2)
            flows.append(float(np.mean(magnitude)))
            flow_vectors.append([float(vector[0]), float(vector[1])])
            histogram_deltas.append(float(cv2.compareHist(previous_hist, hist, cv2.HISTCMP_BHATTACHARYYA)))
        previous_gray, previous_hist = gray, hist
    mean_flow = float(np.mean(flows)) if flows else 0.0
    median_vector = np.median(np.array(flow_vectors), axis=0).tolist() if flow_vectors else [0.0, 0.0]
    cut_threshold = max(0.35, float(np.mean(histogram_deltas) + 2 * np.std(histogram_deltas))) if histogram_deltas else 1
    cut_indices = [index + 1 for index, value in enumerate(histogram_deltas) if value > cut_threshold]
    temporal_confidence = min(0.85, len(frames) / 24)
    base["sourceMetadata"] = {
        "filename": path.name,
        "width": width,
        "height": height,
        "fps": fps,
        "frameCount": frame_count,
        "duration": duration,
        "sampledFrames": len(frames),
        "analysisWidth": frames[0].shape[1],
        "analysisHeight": frames[0].shape[0],
    }
    base["temporalProfile"] = {
        "available": True,
        "sampling": {
            "strategy": "uniform-chunked-proxy",
            "sampledFrames": len(frames),
            "sourceFrames": frame_count,
            "maximumFrames": max_frames,
            "longVideoFallback": frame_count > max_frames,
        },
        "opticalFlow": estimate(mean_flow, temporal_confidence, "opencv-farneback-proxy", "pixels-per-sampled-frame", fallback="RAFT/UniMatch"),
        "cameraMotion": estimate({"x": round(float(median_vector[0]), 3), "y": round(float(median_vector[1]), 3)}, temporal_confidence * 0.7, "median-dense-flow", "pixels-per-sampled-frame"),
        "motionDirection": estimate(math.degrees(math.atan2(median_vector[1], median_vector[0])) if any(median_vector) else 0, temporal_confidence * 0.6, "median-flow-angle", "degrees"),
        "motionIntensity": estimate(mean_flow / max(1, math.hypot(frames[0].shape[0], frames[0].shape[1])), temporal_confidence, "mean-flow-normalized"),
        "motionBlur": estimate(1 - float(np.mean(sharpness_values)), 0.55, "temporal-sharpness-proxy"),
        "frameRate": estimate(fps, 0.99 if fps > 0 else 0, "container-metadata", "fps"),
        "shutterBlur": estimate(None, 0.0, "not-identifiable-from-frames", "degrees-estimate"),
        "cuts": estimate(cut_indices, temporal_confidence, "histogram-discontinuity", "sample-index"),
        "backgroundStability": estimate(float(np.clip(1 - mean_flow / 20, 0, 1)), temporal_confidence * 0.6, "inverse-dense-flow"),
        "exposureVariation": estimate(float(np.std(exposure_values)), temporal_confidence, "sampled-frame-mean-luminance"),
        "tracking": estimate(None, 0.0, "semantic-tracker-not-run", fallback="SAM3"),
        "occlusionsOverTime": estimate(None, 0.0, "semantic-tracker-not-run", fallback="SAM3"),
    }
    if artifact_dir and len(frames) >= 2:
        first = cv2.cvtColor(frames[0], cv2.COLOR_BGR2GRAY)
        last = cv2.cvtColor(frames[-1], cv2.COLOR_BGR2GRAY)
        flow = cv2.calcOpticalFlowFarneback(first, last, None, 0.5, 3, 15, 3, 5, 1.2, 0)
        magnitude, angle = cv2.cartToPolar(flow[..., 0], flow[..., 1])
        hsv = np.zeros((*first.shape, 3), dtype=np.uint8)
        hsv[..., 0] = angle * 180 / np.pi / 2
        hsv[..., 1] = 255
        hsv[..., 2] = np.clip(cv2.normalize(magnitude, None, 0, 255, cv2.NORM_MINMAX), 0, 255)
        flow_path = artifact_dir / "video-optical-flow-proxy.png"
        cv2.imwrite(str(flow_path), cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR))
        base["artifacts"]["opticalFlowProxy"] = flow_path.name
    return base


def confidence_summary(result: dict):
    values = {}
    for section_name in ("colorProfile", "lightingProfile", "cameraProfile", "spatialProfile", "temporalProfile", "textureProfile"):
        confidences = []
        section = result.get(section_name, {})
        stack = [section]
        while stack:
            current = stack.pop()
            if isinstance(current, dict):
                if "confidence" in current and isinstance(current["confidence"], (int, float)):
                    confidences.append(float(current["confidence"]))
                else:
                    stack.extend(current.values())
            elif isinstance(current, list):
                stack.extend(current)
        values[section_name.replace("Profile", "")] = round(float(np.mean(confidences)), 3) if confidences else 0.0
    values["overall"] = round(float(np.mean(list(values.values()))), 3)
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--media-type", choices=("image", "video"), required=True)
    parser.add_argument("--scale", type=float, default=0.6)
    parser.add_argument("--max-video-frames", type=int, default=72)
    parser.add_argument("--artifacts")
    args = parser.parse_args()
    source = Path(args.input)
    artifact_dir = Path(args.artifacts) if args.artifacts else None
    if args.media_type == "video":
        result = analyze_video(source, args.scale, args.max_video_frames, artifact_dir)
    else:
        result = analyze_image(source, args.scale, artifact_dir)
    summary = result.pop("_summary", {})
    result["confidenceScores"] = confidence_summary(result)
    result["masks"] = {
        "subject": None,
        "intervention": None,
        "occlusion": None,
        "contact": None,
    }
    warnings = [
        "Lighting, camera, focal length and depth values are estimates, not physical measurements.",
    ]
    if result["spatialProfile"]["depthMap"]["confidence"] < 0.5:
        warnings.append("Depth map is a low-confidence proxy until Depth Anything V2 analysis is run.")
    if args.media_type == "video":
        warnings.append("Optical flow uses the lightweight OpenCV Farneback fallback; RAFT/UniMatch weights are not loaded.")
        cuts = result.get("temporalProfile", {}).get("cuts", {}).get("value", [])
        if cuts:
            warnings.append("Possible shot cuts detected: for tracking and editing, process each continuous shot separately.")
        if result.get("temporalProfile", {}).get("sampling", {}).get("longVideoFallback"):
            warnings.append("Long video analyzed with uniformly sampled proxy frames; the original remains the render source.")
    result["analysisWarnings"] = warnings
    result["metricsSummary"] = summary
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
