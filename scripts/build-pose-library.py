#!/usr/bin/env python3
"""Build a generic, reusable pose library from local images and videos.

Run this with ComfyUI's Python so the installed DWPose detector is used:
  & 'E:\\ComfyUI\\Data\\Assets\\Python\\cpython-3.12.12-windows-x86_64-none\\python.exe' scripts/build-pose-library.py --source 'C:\\Users\\JohnWick7\\Downloads\\Raccolte'

The output intentionally records body geometry and camera/framing only. It does
not identify people or preserve names from the input folders.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

COMFY_ROOT = Path(r"E:\ComfyUI\Data\Packages\ComfyUI LTX")
AUX_ROOT = COMFY_ROOT / "custom_nodes" / "comfyui_controlnet_aux"


def add_comfy_paths():
    for item in (str(COMFY_ROOT), str(AUX_ROOT), str(AUX_ROOT / "src")):
        if item not in sys.path:
            sys.path.insert(0, item)


def safe_id(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def find_media(source: Path):
    return sorted(path for path in source.rglob("*") if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".mp4", ".mov", ".webm"})


def extract_video_frame(source: Path, target: Path):
    capture = cv2.VideoCapture(str(source))
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    duration = frame_count / fps if fps else None
    if frame_count:
        capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_count // 2))
    ok, frame = capture.read()
    capture.release()
    if not ok:
        return None, duration
    target.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return target, duration


def point(values, index):
    offset = index * 3
    if not values or len(values) < offset + 3 or values[offset + 2] <= 0:
        return None
    return np.array([values[offset], values[offset + 1]], dtype=float)


def describe_pose(openpose):
    people = openpose.get("people") or []
    if not people:
        return None
    body = people[0].get("pose_keypoints_2d")
    left_shoulder, right_shoulder = point(body, 5), point(body, 2)
    left_hip, right_hip = point(body, 11), point(body, 8)
    left_wrist, right_wrist = point(body, 7), point(body, 4)
    joints = [point(body, index) for index in range(18)]
    present = [item for item in joints if item is not None]
    if len(present) < 4:
        return {"category": "partial_body", "prompt": "a natural partial-body pose", "tags": ["partial-body"]}
    all_points = np.stack(present)
    spread_x, spread_y = np.ptp(all_points[:, 0]), np.ptp(all_points[:, 1])
    framing = "full body" if spread_y > spread_x * 1.15 else "medium shot"
    tags = [framing.replace(" ", "-")]
    category = "upright"
    phrase = "standing or seated in a relaxed natural pose"
    if left_shoulder is not None and right_shoulder is not None and left_hip is not None and right_hip is not None:
        shoulder = (left_shoulder + right_shoulder) / 2
        hip = (left_hip + right_hip) / 2
        vector = hip - shoulder
        if abs(vector[0]) > abs(vector[1]) * 0.85:
            category = "reclining"
            phrase = "reclining sideways in a relaxed natural pose"
        elif abs(vector[0]) > abs(vector[1]) * 0.35:
            category = "leaning"
            phrase = "leaning naturally with a relaxed asymmetrical posture"
    raised = any(wrist is not None and wrist[1] < min(item[1] for item in (left_shoulder, right_shoulder) if item is not None) for wrist in (left_wrist, right_wrist)) if (left_shoulder is not None or right_shoulder is not None) else False
    if raised:
        tags.append("raised-arm")
        phrase += ", one arm raised"
        category = "raised_arm" if category == "upright" else category
    return {"category": category, "prompt": f"{phrase}, {framing}", "tags": tags}


def wildcard_files(entries, directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    groups = {}
    for entry in entries:
        if entry.get("pose"):
            groups.setdefault(entry["pose"]["category"], []).append(entry)
    all_prompts = []
    for category, items in groups.items():
        prompts = sorted({item["pose"]["prompt"] for item in items})
        (directory / f"pose_{category}.txt").write_text("\n".join(prompts) + "\n", encoding="utf-8")
        all_prompts.extend(prompts)
    (directory / "pose_library.txt").write_text("\n".join(sorted(set(all_prompts))) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/pose-library"))
    parser.add_argument("--limit", type=int, default=0, help="For a small test run; 0 processes all files.")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    if not source.is_dir():
        raise SystemExit(f"Source folder not found: {source}")
    add_comfy_paths()
    from src.custom_controlnet_aux.dwpose import DwposeDetector

    # The auxiliary node downloads the two public DWPose weights on first use,
    # then reuses the local Hugging Face cache on later runs.
    detector = DwposeDetector.from_pretrained("yzd-v/DWPose", "yzd-v/DWPose", det_filename="yolox_l.onnx", pose_filename="dw-ll_ucoco_384.onnx", torchscript_device="cuda")
    frames_dir, maps_dir, json_dir = output / "frames", output / "openpose", output / "keypoints"
    for directory in (frames_dir, maps_dir, json_dir):
        directory.mkdir(parents=True, exist_ok=True)
    media = find_media(source)
    if args.limit:
        media = media[:args.limit]
    entries = []
    for index, item in enumerate(media, start=1):
        relative = item.relative_to(source)
        entry_id = f"pose-{index:04d}-{safe_id(item.stem)[:36]}"
        video = item.suffix.lower() in {".mp4", ".mov", ".webm"}
        frame, duration = (item, None)
        if video:
            frame, duration = extract_video_frame(item, frames_dir / f"{entry_id}.jpg")
        if frame is None:
            continue
        image = cv2.imread(str(frame))
        if image is None:
            continue
        height, width = image.shape[:2]
        pose_image, keypoints = detector(image, detect_resolution=768, include_body=True, include_hand=False, include_face=False, image_and_json=True, output_type="pil")
        pose_path = maps_dir / f"{entry_id}.png"
        pose_image.save(pose_path)
        keypoint_path = json_dir / f"{entry_id}.json"
        keypoint_path.write_text(json.dumps(keypoints, ensure_ascii=False, indent=2), encoding="utf-8")
        pose = describe_pose(keypoints)
        entries.append({
            "id": entry_id,
            "media_type": "video" if video else "image",
            "source": str(relative).replace("\\", "/"),
            "duration_seconds": round(duration, 3) if duration else None,
            "width": width,
            "height": height,
            "orientation": "portrait" if height > width else "landscape",
            "pose": pose,
            "pose_map": str(pose_path.relative_to(output)).replace("\\", "/"),
            "openpose_json": str(keypoint_path.relative_to(output)).replace("\\", "/"),
        })
        print(f"[{index}/{len(media)}] {entry_id}: {pose['category'] if pose else 'no-person'}", flush=True)
    catalog = {"version": "1.0", "source_count": len(entries), "entries": entries}
    (output / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    wildcard_files(entries, output / "wildcards")
    (output / "README.md").write_text("""# Pose Library\n\n`catalog.json` is the machine-readable index. `wildcards/pose_*.txt` are standard one-line wildcard pools. Each entry includes a generic prompt suffix, a DWPose/OpenPose image map and keypoints JSON.\n\nFor a prompt such as `girl, pool, sun lounger`, choose an entry in the `reclining` group and append its `pose.prompt`; load its `pose_map` in a ControlNet OpenPose/DWPose workflow. Original source media are not copied; video entries retain one derived keyframe solely for pose analysis.\n""", encoding="utf-8")
    print(f"Done: {len(entries)} entries written to {output}")


if __name__ == "__main__":
    main()
