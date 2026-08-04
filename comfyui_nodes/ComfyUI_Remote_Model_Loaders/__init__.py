"""Model loaders required by ComfyUI Remote.

The NF4 parameter handling is adapted from ComfyUI_bitsandbytes_NF4 by
comfyanonymous (AGPL-3.0) and the Forge implementation credited there.
"""

import json

import folder_paths
import numpy as np
import torch
import bitsandbytes as bnb
from bitsandbytes.nn.modules import Params4bit, QuantState

import comfy.ops
import comfy.sd
import comfy.utils

from .face_swap import RemoteFaceSelectionPoint, RemoteTrackedFaceSwap


def functional_linear_4bits(x, weight, bias):
    output = bnb.matmul_4bit(x, weight.t(), bias=bias, quant_state=weight.quant_state)
    return output.to(x)


def copy_quant_state(state, device=None):
    if state is None:
        return None
    device = device or state.absmax.device
    state2 = (
        QuantState(
            absmax=state.state2.absmax.to(device),
            shape=state.state2.shape,
            code=state.state2.code.to(device),
            blocksize=state.state2.blocksize,
            quant_type=state.state2.quant_type,
            dtype=state.state2.dtype,
        )
        if state.nested
        else None
    )
    return QuantState(
        absmax=state.absmax.to(device),
        shape=state.shape,
        code=state.code.to(device),
        blocksize=state.blocksize,
        quant_type=state.quant_type,
        dtype=state.dtype,
        offset=state.offset.to(device) if state.nested else None,
        state2=state2,
    )


class RemoteParams4bit(Params4bit):
    def detach(self):
        return RemoteParams4bit(
            self.data.detach(),
            requires_grad=False,
            quant_state=copy_quant_state(self.quant_state),
            blocksize=self.blocksize,
            compress_statistics=self.compress_statistics,
            quant_type=self.quant_type,
            quant_storage=self.quant_storage,
            bnb_quantized=self.bnb_quantized,
            module=self.module,
        )

    def to(self, *args, **kwargs):
        device, dtype, non_blocking, _convert_to_format = torch._C._nn._parse_to(*args, **kwargs)
        if device is not None and device.type == "cuda" and not self.bnb_quantized:
            return self._quantize(device)
        converted = RemoteParams4bit(
            torch.nn.Parameter.to(self, device=device, dtype=dtype, non_blocking=non_blocking),
            requires_grad=self.requires_grad,
            quant_state=copy_quant_state(self.quant_state, device),
            blocksize=self.blocksize,
            compress_statistics=self.compress_statistics,
            quant_type=self.quant_type,
            quant_storage=self.quant_storage,
            bnb_quantized=self.bnb_quantized,
            module=self.module,
        )
        self.module.quant_state = converted.quant_state
        self.data = converted.data
        self.quant_state = converted.quant_state
        return converted


class RemoteLoader4bit(torch.nn.Module):
    def __init__(self, *, device, dtype, quant_type="nf4", **_kwargs):
        super().__init__()
        self.dummy = torch.nn.Parameter(torch.empty(1, device=device, dtype=dtype))
        self.weight = None
        self.quant_state = None
        self.bias = None
        self.quant_type = quant_type

    def _save_to_state_dict(self, destination, prefix, keep_vars):
        super()._save_to_state_dict(destination, prefix, keep_vars)
        quant_state = getattr(self.weight, "quant_state", None)
        if quant_state is not None:
            for key, value in quant_state.as_dict(packed=True).items():
                destination[prefix + "weight." + key] = value if keep_vars else value.detach()

    def _load_from_state_dict(
        self,
        state_dict,
        prefix,
        local_metadata,
        strict,
        missing_keys,
        unexpected_keys,
        error_msgs,
    ):
        quant_state_keys = {
            key[len(prefix + "weight."):]
            for key in state_dict
            if key.startswith(prefix + "weight.")
        }
        if any("bitsandbytes" in key for key in quant_state_keys):
            quant_state_dict = {
                key: state_dict[prefix + "weight." + key]
                for key in quant_state_keys
            }
            self.weight = RemoteParams4bit.from_prequantized(
                data=state_dict[prefix + "weight"],
                quantized_stats=quant_state_dict,
                requires_grad=False,
                device=self.dummy.device,
                module=self,
            )
            self.quant_state = self.weight.quant_state
            if prefix + "bias" in state_dict:
                self.bias = torch.nn.Parameter(state_dict[prefix + "bias"].to(self.dummy))
            del self.dummy
            return
        super()._load_from_state_dict(
            state_dict,
            prefix,
            local_metadata,
            strict,
            missing_keys,
            unexpected_keys,
            error_msgs,
        )


class NF4Operations(comfy.ops.manual_cast):
    class Linear(RemoteLoader4bit):
        def __init__(self, *args, device=None, dtype=None, **kwargs):
            super().__init__(device=device, dtype=dtype, quant_type="nf4")
            self.parameters_manual_cast = False

        def forward(self, x):
            self.weight.quant_state = self.quant_state
            if self.bias is not None and self.bias.dtype != x.dtype:
                self.bias.data = self.bias.data.to(x.dtype)
            return functional_linear_4bits(x, self.weight, self.bias)


class RemoteUNETLoaderNF4:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "unet_name": (folder_paths.get_filename_list("diffusion_models"),),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet"
    CATEGORY = "ComfyUI Remote/loaders"

    def load_unet(self, unet_name):
        path = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
        model = comfy.sd.load_diffusion_model(
            path,
            model_options={"custom_operations": NF4Operations},
        )
        return (model,)


def _inject_legacy_convrot_metadata(state_dict):
    """Complete early Comfy ConvRot metadata without rewriting paid checkpoints."""
    patched = 0
    for key in [name for name in state_dict if name.endswith(".comfy_quant")]:
        value = state_dict[key]
        try:
            config = json.loads(bytes(value.detach().cpu().tolist()).decode("utf-8"))
        except (TypeError, ValueError, UnicodeDecodeError):
            continue
        if config.get("format") or not config.get("convrot"):
            continue
        config["format"] = "int8_tensorwise"
        state_dict[key] = torch.tensor(
            list(json.dumps(config).encode("utf-8")),
            dtype=torch.uint8,
        )
        patched += 1
    if patched == 0:
        raise ValueError(
            "Il checkpoint INT8 ConvRot non contiene metadati legacy compatibili."
        )
    return state_dict


def _load_legacy_convrot_model(path):
    state_dict, metadata = comfy.utils.load_torch_file(path, return_metadata=True)
    _inject_legacy_convrot_metadata(state_dict)
    model = comfy.sd.load_diffusion_model_state_dict(
        state_dict,
        model_options={},
        metadata=metadata,
    )
    if model is None:
        raise RuntimeError(f"Modello ConvRot non riconosciuto: {path}")
    model.cached_patcher_init = (_load_legacy_convrot_model, (path,))
    return model


class RemoteUNETLoaderConvRotINT8:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "unet_name": (folder_paths.get_filename_list("diffusion_models"),),
            }
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet"
    CATEGORY = "ComfyUI Remote/loaders"

    def load_unet(self, unet_name):
        path = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
        return (_load_legacy_convrot_model(path),)


class RemoteImageTensorNormalize:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "normalize"
    CATEGORY = "ComfyUI Remote/image"

    def normalize(self, image):
        original_type = type(image).__name__
        if isinstance(image, (list, tuple)) and image:
            if all(isinstance(item, torch.Tensor) for item in image):
                try:
                    image = torch.stack(list(image), dim=0)
                except Exception:
                    try:
                        image = torch.cat(list(image), dim=0)
                    except Exception:
                        return (image,)
            else:
                return (image,)
        elif isinstance(image, np.ndarray):
            image = torch.from_numpy(image)

        if not isinstance(image, torch.Tensor):
            return (image,)

        result = image
        original_shape = tuple(result.shape)
        while result.ndim > 4 and 1 in result.shape:
            singleton = next(index for index, size in enumerate(result.shape) if size == 1)
            result = result.squeeze(singleton)

        # ComfyUI usa BHWC. Alcuni nodi video restituiscono CHW/BCHW o HCW/BHCW;
        # in quest'ultimo caso SaveImage interpreta il canale RGB come larghezza.
        if result.ndim == 2:
            result = result.unsqueeze(0).unsqueeze(-1)
        elif result.ndim == 3:
            if result.shape[-1] in (1, 3, 4):
                result = result.unsqueeze(0)
            elif result.shape[0] in (1, 3, 4):
                result = result.permute(1, 2, 0).unsqueeze(0)
            elif result.shape[1] in (1, 3, 4):
                result = result.permute(0, 2, 1).unsqueeze(0)
            else:
                result = result.unsqueeze(0).unsqueeze(-1)
        elif result.ndim == 4:
            if result.shape[-1] in (1, 3, 4):
                pass
            elif result.shape[1] in (1, 3, 4):
                result = result.permute(0, 2, 3, 1)
            elif result.shape[2] in (1, 3, 4):
                result = result.permute(0, 1, 3, 2)

        if result.ndim == 4 and result.shape[-1] == 1:
            result = result.repeat(1, 1, 1, 3)

        print(
            f"[RemoteImageTensorNormalize] {original_type} "
            f"{original_shape} -> {tuple(result.shape)}"
        )
        return (result.contiguous().clamp(0, 1),)


NODE_CLASS_MAPPINGS = {
    "RemoteUNETLoaderNF4": RemoteUNETLoaderNF4,
    "RemoteUNETLoaderConvRotINT8": RemoteUNETLoaderConvRotINT8,
    "RemoteTrackedFaceSwap": RemoteTrackedFaceSwap,
    "RemoteFaceSelectionPoint": RemoteFaceSelectionPoint,
    "RemoteImageTensorNormalize": RemoteImageTensorNormalize,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "RemoteUNETLoaderNF4": "Load Diffusion Model NF4 (Remote)",
    "RemoteUNETLoaderConvRotINT8": "Load Diffusion Model INT8 ConvRot (Remote)",
    "RemoteTrackedFaceSwap": "Tracked Face Swap (Remote)",
    "RemoteFaceSelectionPoint": "Select Face for SAM (Remote)",
    "RemoteImageTensorNormalize": "Normalize Image Tensor (Remote)",
}
