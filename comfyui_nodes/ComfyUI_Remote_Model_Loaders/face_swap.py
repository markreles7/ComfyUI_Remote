"""Tracked face replacement node used by ComfyUI Remote Video Studio."""

from pathlib import Path
import json

import cv2
import numpy as np
import torch

import comfy.model_management as model_management
import folder_paths


def _providers():
    import onnxruntime

    available = onnxruntime.get_available_providers()
    preferred = [
        "CUDAExecutionProvider",
        "DmlExecutionProvider",
        "CPUExecutionProvider",
    ]
    return [provider for provider in preferred if provider in available]


def _to_bgr(image):
    rgb = image[..., :3].detach().cpu().numpy()
    rgb = np.clip(rgb * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def _to_tensor(image):
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    return torch.from_numpy(rgb.astype(np.float32) / 255.0).unsqueeze(0)


def _center(face, width, height):
    x1, y1, x2, y2 = face.bbox
    return np.array([
        ((x1 + x2) * 0.5) / max(width, 1),
        ((y1 + y2) * 0.5) / max(height, 1),
    ], dtype=np.float32)


def _embedding(face):
    value = getattr(face, "normed_embedding", None)
    if value is not None:
        return value
    value = getattr(face, "embedding", None)
    if value is None:
        return None
    norm = np.linalg.norm(value)
    return value / norm if norm else value


def _model_root():
    package_models = Path(folder_paths.models_dir)
    candidates = [package_models / "insightface"]
    if len(package_models.parents) >= 3:
        candidates.append(package_models.parents[2] / "Models" / "insightface")
    for candidate in candidates:
        if (candidate / "inswapper_128.onnx").is_file():
            return candidate
    return candidates[0]


class RemoteTrackedFaceSwap:
    """Replace one selected face throughout an image/video batch.

    The target is selected on the first frame using a normalized click position.
    Subsequent frames are matched using the original actor's face embedding and
    recent position, so another actor is not swapped merely because people cross.
    """

    _analysis = None
    _swapper = None
    _cache_key = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "reference": ("IMAGE",),
                "target_x": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "target_y": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "target_face_index": ("INT", {"default": 0, "min": 0, "max": 32}),
                "detection_size": ("INT", {"default": 640, "min": 320, "max": 1280, "step": 64}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "swap"
    CATEGORY = "ComfyUI Remote/video"

    @classmethod
    def _load_models(cls, detection_size):
        from insightface.app import FaceAnalysis
        from insightface.model_zoo import get_model

        root = _model_root()
        swap_path = root / "inswapper_128.onnx"
        analysis_path = root / "models" / "buffalo_l"
        if not swap_path.is_file():
            raise FileNotFoundError(f"Modello Face Swap mancante: {swap_path}")
        if not analysis_path.is_dir():
            raise FileNotFoundError(f"Modello Face Analysis mancante: {analysis_path}")

        providers = _providers()
        cache_key = (str(root), tuple(providers), int(detection_size))
        if cls._cache_key == cache_key and cls._analysis is not None and cls._swapper is not None:
            return cls._analysis, cls._swapper

        analysis = FaceAnalysis(name="buffalo_l", root=str(root), providers=providers)
        context_id = 0 if "CUDAExecutionProvider" in providers else -1
        analysis.prepare(ctx_id=context_id, det_size=(detection_size, detection_size))
        swapper = get_model(str(swap_path), providers=providers)
        cls._analysis = analysis
        cls._swapper = swapper
        cls._cache_key = cache_key
        return analysis, swapper

    @staticmethod
    def _first_target(faces, width, height, target_x, target_y, target_face_index):
        if not faces:
            return None
        click = np.array([target_x, target_y], dtype=np.float32)
        ranked = sorted(faces, key=lambda face: np.linalg.norm(_center(face, width, height) - click))
        if 0 <= target_face_index < len(ranked) and target_x == 0.5 and target_y == 0.5:
            left_to_right = sorted(faces, key=lambda face: face.bbox[0])
            return left_to_right[target_face_index]
        return ranked[0]

    @staticmethod
    def _tracked_target(faces, width, height, identity, previous_center):
        if not faces:
            return None
        scores = []
        for face in faces:
            current = _center(face, width, height)
            position_score = 1.0 - min(1.0, float(np.linalg.norm(current - previous_center)))
            candidate = _embedding(face)
            identity_score = float(np.dot(identity, candidate)) if identity is not None and candidate is not None else 0.0
            scores.append((identity_score + 0.20 * position_score, face))
        return max(scores, key=lambda item: item[0])[1]

    def swap(self, images, reference, target_x, target_y, target_face_index, detection_size):
        if reference.shape[0] != 1:
            reference = reference[:1]
        analysis, swapper = self._load_models(int(detection_size))
        reference_bgr = _to_bgr(reference[0])
        source_faces = analysis.get(reference_bgr)
        if not source_faces:
            raise ValueError("Nessun volto rilevato nella reference della nuova identità.")
        source_face = max(
            source_faces,
            key=lambda face: (face.bbox[2] - face.bbox[0]) * (face.bbox[3] - face.bbox[1]),
        )

        output = []
        identity = None
        previous_center = np.array([target_x, target_y], dtype=np.float32)
        for index, image in enumerate(images):
            model_management.throw_exception_if_processing_interrupted()
            frame = _to_bgr(image)
            height, width = frame.shape[:2]
            faces = analysis.get(frame)
            if index == 0:
                target = self._first_target(
                    faces, width, height, target_x, target_y, int(target_face_index)
                )
                if target is None:
                    raise ValueError("Nessun volto rilevato nel primo fotogramma del video.")
                identity = _embedding(target)
            else:
                target = self._tracked_target(faces, width, height, identity, previous_center)

            if target is not None:
                previous_center = _center(target, width, height)
                frame = swapper.get(frame, target, source_face, paste_back=True)
            output.append(_to_tensor(frame))
        return (torch.cat(output, dim=0),)


class RemoteFaceSelectionPoint:
    """Find the requested face and return a SAM-compatible positive point."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "target_x": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "target_y": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "target_face_index": ("INT", {"default": 0, "min": 0, "max": 32}),
                "use_click": ("BOOLEAN", {"default": False}),
                "detection_size": ("INT", {"default": 640, "min": 320, "max": 1280, "step": 64}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("positive_coords",)
    FUNCTION = "select"
    CATEGORY = "ComfyUI Remote/video"

    def select(self, image, target_x, target_y, target_face_index, use_click, detection_size):
        analysis, _swapper = RemoteTrackedFaceSwap._load_models(int(detection_size))
        frame = _to_bgr(image[0])
        height, width = frame.shape[:2]
        faces = analysis.get(frame)
        if not faces:
            raise ValueError("Nessun volto rilevato nel primo fotogramma del video.")
        if use_click:
            target = RemoteTrackedFaceSwap._first_target(
                faces, width, height, target_x, target_y, int(target_face_index)
            )
        else:
            ordered = sorted(faces, key=lambda face: face.bbox[0])
            if int(target_face_index) >= len(ordered):
                raise ValueError(
                    f"Volto {int(target_face_index) + 1} non disponibile: rilevati {len(ordered)} volti."
                )
            target = ordered[int(target_face_index)]
        center = _center(target, width, height)
        return (json.dumps([{
            "x": int(round(float(center[0]) * width)),
            "y": int(round(float(center[1]) * height)),
        }]),)
