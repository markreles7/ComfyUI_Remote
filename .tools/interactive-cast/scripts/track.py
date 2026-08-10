import argparse
import json
import os
import sys


def box_iou(a, b):
    ax2, ay2 = a["x"] + a["width"], a["y"] + a["height"]
    bx2, by2 = b["x"] + b["width"], b["y"] + b["height"]
    intersection = max(0.0, min(ax2, bx2) - max(a["x"], b["x"])) * max(
        0.0, min(ay2, by2) - max(a["y"], b["y"])
    )
    union = a["width"] * a["height"] + b["width"] * b["height"] - intersection
    return intersection / union if union > 0 else 0.0


def normalized_center_distance(a, b):
    acx, acy = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    bcx, bcy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    scale = max(1.0, a["width"], a["height"], b["width"], b["height"])
    return (((acx - bcx) ** 2 + (acy - bcy) ** 2) ** 0.5) / scale


def associate_detections(tracks, detections, timestamp, max_gap=1.5):
    candidates = []
    for track_index, track in enumerate(tracks):
        if timestamp - track["lastSeen"] > max_gap:
            continue
        for detection_index, detection in enumerate(detections):
            iou = box_iou(track["lastBox"], detection["box"])
            distance = normalized_center_distance(track["lastBox"], detection["box"])
            if iou >= 0.08 or distance <= 0.8:
                candidates.append((iou - distance * 0.15, track_index, detection_index))
    matched_tracks, matched_detections = set(), set()
    for _score, track_index, detection_index in sorted(candidates, reverse=True):
        if track_index in matched_tracks or detection_index in matched_detections:
            continue
        detection = detections[detection_index]
        track = tracks[track_index]
        track["detections"].append(detection)
        track["lastBox"] = detection["box"]
        track["lastSeen"] = timestamp
        matched_tracks.add(track_index)
        matched_detections.add(detection_index)
    for detection_index, detection in enumerate(detections):
        if detection_index in matched_detections:
            continue
        tracks.append({
            "lastBox": detection["box"],
            "lastSeen": timestamp,
            "detections": [detection],
        })


def clamp_crop(box, frame_shape, face=False):
    height, width = frame_shape[:2]
    x, y, w, h = box["x"], box["y"], box["width"], box["height"]
    if face:
        x -= w * 0.12
        y -= h * 0.06
        w *= 1.24
        h *= 0.48
    else:
        x -= w * 0.08
        y -= h * 0.04
        w *= 1.16
        h *= 1.08
    x1, y1 = max(0, int(round(x))), max(0, int(round(y)))
    x2, y2 = min(width, int(round(x + w))), min(height, int(round(y + h)))
    return x1, y1, x2, y2


def write_reference_crops(cv2, video_path, tracks, output_dir):
    if not output_dir:
        return
    os.makedirs(output_dir, exist_ok=True)
    capture = cv2.VideoCapture(video_path)
    for track_index, track in enumerate(tracks):
        actor_dir = os.path.join(output_dir, f"original-{track_index + 1}")
        os.makedirs(actor_dir, exist_ok=True)
        references = []
        ranked = sorted(
            track["detections"],
            key=lambda item: (item.get("sharpness", 0), item["confidence"]),
            reverse=True,
        )[:3]
        for rank, detection in enumerate(ranked, start=1):
            capture.set(cv2.CAP_PROP_POS_MSEC, detection["time"] * 1000)
            ok, frame = capture.read()
            if not ok:
                continue
            for kind, face in (("face", True), ("body", False)):
                x1, y1, x2, y2 = clamp_crop(detection["box"], frame.shape, face=face)
                crop = frame[y1:y2, x1:x2]
                if crop.size == 0:
                    continue
                filename = f"{kind}-{rank:02d}-{detection['time']:.2f}s.jpg".replace(".", "_")
                filename = filename[:-4] + ".jpg"
                target = os.path.join(actor_dir, filename)
                cv2.imwrite(target, crop, [int(cv2.IMWRITE_JPEG_QUALITY), 94])
                references.append({
                    "type": kind,
                    "time": detection["time"],
                    "path": target,
                    "filename": filename,
                    "mimeType": "image/jpeg",
                    "confidence": detection["confidence"],
                    "sharpness": detection.get("sharpness", 0),
                })
        track["references"] = references
    capture.release()


def main():
    parser = argparse.ArgumentParser(description="Interactive Cast OpenCV multi-person tracker")
    parser.add_argument("--video", required=True)
    parser.add_argument("--sample-step", type=float, default=0.5)
    parser.add_argument("--max-frames", type=int, default=240)
    parser.add_argument("--output-dir", default="")
    args = parser.parse_args()

    try:
        import cv2
    except Exception as exc:
        print(json.dumps({
            "configured": False,
            "engine": "opencv-hog-iou",
            "actors": [],
            "warnings": [f"OpenCV is not configured in .tools/interactive-cast: {exc}"],
        }))
        return 0

    required_apis = ("HOGDescriptor", "HOGDescriptor_getDefaultPeopleDetector")
    missing_apis = [name for name in required_apis if not hasattr(cv2, name)]
    if missing_apis:
        print(json.dumps({
            "configured": False,
            "engine": "opencv-hog-iou",
            "actors": [],
            "warnings": [
                "OpenCV installation is incomplete; missing APIs: " + ", ".join(missing_apis)
            ],
        }))
        return 0

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(json.dumps({
            "configured": False,
            "engine": "opencv-hog-iou",
            "actors": [],
            "warnings": ["OpenCV could not open the source video."],
        }))
        return 0

    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
    duration = frame_count / fps if fps else 0
    frame_interval = max(1, int(round(fps * max(0.1, args.sample_step))))
    detector = cv2.HOGDescriptor()
    detector.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
    tracks = []
    frame_index = 0
    sampled = 0

    while sampled < args.max_frames:
        ok, original_frame = cap.read()
        if not ok:
            break
        if frame_index % frame_interval:
            frame_index += 1
            continue
        sampled += 1
        timestamp = frame_index / fps if fps else 0
        frame = original_frame
        scale = 720.0 / max(1, frame.shape[1])
        if scale < 1:
            frame = cv2.resize(frame, None, fx=scale, fy=scale)
        rects, weights = detector.detectMultiScale(
            frame,
            winStride=(8, 8),
            padding=(8, 8),
            scale=1.05,
        )
        inverse_scale = 1 / scale if scale < 1 else 1
        detections = []
        for rect, weight in zip(rects, weights):
            if float(weight) < 0.25:
                continue
            x, y, w, h = [float(value) * inverse_scale for value in rect]
            x1, y1, x2, y2 = clamp_crop(
                {"x": x, "y": y, "width": w, "height": h}, original_frame.shape, face=True)
            face_region = original_frame[y1:y2, x1:x2]
            sharpness = float(cv2.Laplacian(face_region, cv2.CV_64F).var()) if face_region.size else 0.0
            detections.append({
                "time": round(timestamp, 3),
                "box": {"x": round(x, 2), "y": round(y, 2), "width": round(w, 2), "height": round(h, 2)},
                "confidence": round(float(weight), 4),
                "sharpness": round(sharpness, 3),
            })
        associate_detections(tracks, detections, timestamp)
        frame_index += 1
    cap.release()

    minimum_observations = 2 if sampled >= 4 else 1
    tracks = [track for track in tracks if len(track["detections"]) >= minimum_observations]
    tracks.sort(key=lambda track: (-len(track["detections"]), track["detections"][0]["box"]["x"]))
    write_reference_crops(cv2, args.video, tracks, args.output_dir)
    actors = []
    for index, track in enumerate(tracks):
        detections = sorted(track["detections"], key=lambda item: item["time"])
        actors.append({
            "actorId": f"original-{index + 1}",
            "label": f"Original Actor {index + 1}",
            "frames": [{"time": item["time"], "confidence": item["confidence"]} for item in detections],
            "boundingBoxes": detections,
            "confidence": round(sum(item["confidence"] for item in detections) / len(detections), 4),
            "firstSeen": detections[0]["time"],
            "lastSeen": detections[-1]["time"],
            "status": "tracked",
            "references": track.get("references", []),
        })

    warnings = [
        "OpenCV HOG+IoU is a local lightweight tracker; review actor names and boxes before final render."
    ]
    if not actors:
        warnings.append("No stable person track was found; manual actor assignment remains available.")
    print(json.dumps({
        "configured": True,
        "engine": "opencv-hog-iou",
        "actors": actors,
        "duration": duration,
        "sampledFrames": sampled,
        "warnings": warnings,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
