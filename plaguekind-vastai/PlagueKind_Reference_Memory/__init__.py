"""Standalone Qwen unload node used by the PlagueKind R2V export."""

import gc
import comfy.model_management as model_management


class RemoteUnloadCLIP:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"conditioning": ("CONDITIONING",), "clip": ("CLIP",)}}

    RETURN_TYPES = ("CONDITIONING",)
    FUNCTION = "unload"
    CATEGORY = "PlagueKind/memory"

    def unload(self, conditioning, clip):
        patcher = getattr(clip, "patcher", None)
        try:
            if patcher is not None:
                model_management.unload_model_and_clones(
                    patcher, unload_additional_models=False, all_devices=True
                )
                if hasattr(patcher, "partially_unload_ram"):
                    patcher.partially_unload_ram(1 << 60)
            gc.collect()
            model_management.soft_empty_cache()
        except Exception as exc:
            print(f"[RemoteUnloadCLIP] cleanup skipped: {exc}")
        return (conditioning,)


NODE_CLASS_MAPPINGS = {"RemoteUnloadCLIP": RemoteUnloadCLIP}
NODE_DISPLAY_NAME_MAPPINGS = {"RemoteUnloadCLIP": "Unload CLIP After Conditioning"}


class _OptionalReference:
    INPUT_NAME = "reference"
    DATA_TYPE = "IMAGE"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"enabled": ("BOOLEAN", {"default": False})},
            "optional": {cls.INPUT_NAME: (cls.DATA_TYPE, {"lazy": True})},
        }

    RETURN_TYPES = (DATA_TYPE,)
    FUNCTION = "select"
    CATEGORY = "PlagueKind/references"

    def check_lazy_status(self, enabled, **kwargs):
        return [self.INPUT_NAME] if enabled else []

    def select(self, enabled, **kwargs):
        return (kwargs.get(self.INPUT_NAME) if enabled else None,)


class PlagueKindOptionalImage(_OptionalReference):
    INPUT_NAME = "image"
    DATA_TYPE = "IMAGE"
    RETURN_TYPES = ("IMAGE",)


class PlagueKindOptionalAudio(_OptionalReference):
    INPUT_NAME = "audio"
    DATA_TYPE = "AUDIO"
    RETURN_TYPES = ("AUDIO",)


NODE_CLASS_MAPPINGS.update({
    "PlagueKindOptionalImage": PlagueKindOptionalImage,
    "PlagueKindOptionalAudio": PlagueKindOptionalAudio,
})
NODE_DISPLAY_NAME_MAPPINGS.update({
    "PlagueKindOptionalImage": "Optional Reference Image/Video Frames",
    "PlagueKindOptionalAudio": "Optional Reference Audio",
})
