"""Bounded tiles, original-anchored Vision captions and feathered reconstruction.

All captions finish (and LM Studio unloads) before the dependent model-name gate
allows ComfyUI loaders to run. Images remain on CPU during the handoff.
"""
import base64
import gc
import io
import json
import math
import urllib.request

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F
import comfy.model_management as mm
import comfy.utils


def tile_starts(length, size, overlap):
    if length <= size:
        return [0]
    starts = list(range(0, length - size + 1, size - overlap))
    if starts[-1] != length - size:
        starts.append(length - size)
    return starts


def png64(tensor, maximum):
    pixels = (tensor[0].detach().cpu().clamp(0, 1).numpy() * 255).round().astype(np.uint8)
    image = Image.fromarray(pixels[:, :, :3])
    image.thumbnail((maximum, maximum), Image.Resampling.LANCZOS)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return base64.b64encode(stream.getvalue()).decode("ascii")


def purge():
    mm.unload_all_models()
    gc.collect()
    mm.soft_empty_cache()
    if torch.cuda.is_available():
        torch.cuda.synchronize()
        torch.cuda.empty_cache()


class RemoteSuperUpscaleTiles:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "image": ("IMAGE",), "reference": ("IMAGE",),
            "global_prompt": ("STRING", {"multiline": True}),
            "tile_size": ("INT", {"default": 1024, "min": 512, "max": 1536, "step": 16}),
            "overlap": ("INT", {"default": 128, "min": 32, "max": 256, "step": 16}),
            "vision": ("BOOLEAN", {"default": False}),
            "caption_url": ("STRING", {"default": ""}),
            "caption_token": ("STRING", {"default": ""}),
        }}

    RETURN_TYPES = ("IMAGE", "STRING", "REMOTE_TILE_LAYOUT", "STRING")
    RETURN_NAMES = ("tiles", "prompts", "layout", "ready")
    OUTPUT_IS_LIST = (True, True, False, False)
    FUNCTION = "prepare"
    CATEGORY = "Remote/Upscale"

    def prepare(self, image, reference, global_prompt, tile_size, overlap,
                vision, caption_url, caption_token):
        if image.shape[0] != 1 or reference.shape[0] != 1:
            raise ValueError("SUPER UPSCALE richiede una sola immagine.")
        if overlap >= tile_size:
            raise ValueError("Overlap non valido.")
        image = image.detach().cpu().float()
        reference = reference.detach().cpu().float()
        h, w = image.shape[1:3]
        rh, rw = reference.shape[1:3]
        ph, pw = math.ceil(h / 16) * 16, math.ceil(w / 16) * 16
        padded = F.pad(image.movedim(-1, 1), (0, pw-w, 0, ph-h), mode="replicate").movedim(1, -1)
        th, tw = min(tile_size, ph), min(tile_size, pw)
        positions = [(x, y) for y in tile_starts(ph, th, overlap)
                     for x in tile_starts(pw, tw, overlap)]
        tiles, prompts = [], []
        progress = comfy.utils.ProgressBar(len(positions))
        original = png64(reference, 512) if vision else None
        for index, (x, y) in enumerate(positions):
            mm.throw_exception_if_processing_interrupted()
            tile = padded[:, y:y+th, x:x+tw, :].contiguous()
            prompt = global_prompt
            if vision:
                if not caption_url or not caption_token:
                    raise ValueError("Configurazione callback LM Studio mancante.")
                # Anchor each caption to the matching ORIGINAL crop, not only the synthesis.
                x0, y0 = min(rw-1, int(x/w*rw)), min(rh-1, int(y/h*rh))
                x1, y1 = min(rw, math.ceil((x+tw)/w*rw)), min(rh, math.ceil((y+th)/h*rh))
                crop = reference[:, y0:max(y0+1, y1), x0:max(x0+1, x1), :]
                purge()
                print(f"[SUPER UPSCALE] Vision tile {index+1}/{len(positions)}; ComfyUI models unloaded", flush=True)
                payload = {"images": [original, png64(crop, 768), png64(tile, 768)],
                           "globalPrompt": global_prompt}
                request = urllib.request.Request(caption_url,
                    data=json.dumps(payload).encode("utf-8"),
                    headers={"Content-Type": "application/json", "Authorization": f"Bearer {caption_token}"})
                try:
                    with urllib.request.urlopen(request, timeout=900) as response:
                        result = json.load(response)
                except Exception as error:
                    raise RuntimeError(f"LM Studio Vision tile {index+1}: {error}") from error
                mm.throw_exception_if_processing_interrupted()
                if not result.get("unloaded") or not str(result.get("prompt", "")).strip():
                    raise RuntimeError("Vision non valida o modelli LM Studio ancora caricati.")
                prompt = result["prompt"]
                purge()
            tiles.append(tile)
            prompts.append(prompt)
            progress.update_absolute(index+1)
        layout = {"height": h, "width": w, "padded_height": ph, "padded_width": pw,
                  "tile_height": th, "tile_width": tw, "positions": positions, "overlap": overlap}
        # Captions are recorded in ComfyUI history for diagnosis and reproducibility.
        return {"ui": {"text": prompts}, "result": (tiles, prompts, layout, "vision-unloaded")}


class RemoteSuperUpscaleModelNames:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {name: ("STRING", {"default": ""}) for name in
                ("ready", "unet", "clip", "vae", "patch")}}
    # Legacy loaders declare their input as an option list rather than COMBO.
    # A wildcard is required for compatibility with both schema generations.
    RETURN_TYPES = ("*", "*", "*", "*")
    FUNCTION = "names"
    CATEGORY = "Remote/Upscale"

    def names(self, ready, unet, clip, vae, patch):
        if ready != "vision-unloaded":
            raise RuntimeError("Il passaggio di memoria Vision non è completato.")
        return (unet, clip, vae, patch)


class RemoteSuperUpscaleAssemble:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"tiles": ("IMAGE",), "layout": ("REMOTE_TILE_LAYOUT",)}}
    INPUT_IS_LIST = True
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "assemble"
    CATEGORY = "Remote/Upscale"

    def assemble(self, tiles, layout):
        layout = layout[0]
        positions = layout["positions"]
        if len(tiles) != len(positions):
            raise ValueError("Numero di tile restaurati non corrispondente.")
        ph, pw = layout["padded_height"], layout["padded_width"]
        th, tw = layout["tile_height"], layout["tile_width"]
        result = torch.zeros((1, ph, pw, 3), dtype=torch.float32)
        weights = torch.zeros((1, ph, pw, 1), dtype=torch.float32)
        for tile, (x, y) in zip(tiles, positions):
            mm.throw_exception_if_processing_interrupted()
            if tuple(tile.shape) != (1, th, tw, 3):
                raise ValueError(f"Dimensione tile inattesa: {tuple(tile.shape)}")
            wx, wy = torch.ones(tw), torch.ones(th)
            ox, oy = min(layout["overlap"], tw//2), min(layout["overlap"], th//2)
            if x > 0: wx[:ox] = torch.linspace(1/(ox+1), 1, ox)
            if x+tw < pw: wx[-ox:] = torch.linspace(1, 1/(ox+1), ox)
            if y > 0: wy[:oy] = torch.linspace(1/(oy+1), 1, oy)
            if y+th < ph: wy[-oy:] = torch.linspace(1, 1/(oy+1), oy)
            mask = (wy[:, None] * wx[None, :])[None, :, :, None]
            result[:, y:y+th, x:x+tw] += tile.detach().cpu().float() * mask
            weights[:, y:y+th, x:x+tw] += mask
        if not torch.all(weights > 0):
            raise ValueError("La griglia lascia pixel scoperti.")
        result /= weights
        return (result[:, :layout["height"], :layout["width"]].clamp(0, 1).contiguous(),)


NODE_CLASS_MAPPINGS = {cls.__name__: cls for cls in
    (RemoteSuperUpscaleTiles, RemoteSuperUpscaleModelNames, RemoteSuperUpscaleAssemble)}
