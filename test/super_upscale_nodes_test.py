"""CPU tests; run with ComfyUI's Python (torch/Pillow/numpy available)."""
import importlib.util
import base64
import io
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch
import torch
from PIL import Image

mm = types.ModuleType("comfy.model_management")
mm.throw_exception_if_processing_interrupted = lambda: None
utils = types.ModuleType("comfy.utils")
utils.ProgressBar = lambda count: types.SimpleNamespace(update_absolute=lambda n: None)
comfy = types.ModuleType("comfy")
comfy.model_management, comfy.utils = mm, utils
sys.modules.update({"comfy": comfy, "comfy.model_management": mm, "comfy.utils": utils})
path = pathlib.Path(__file__).resolve().parents[1] / "comfyui_nodes/ComfyUI_Remote_Model_Loaders/super_upscale.py"
spec = importlib.util.spec_from_file_location("super_upscale", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TilesTest(unittest.TestCase):
    def test_roundtrip_edges_overlap_and_aspect_ratio(self):
        for h, w in [(759, 1103), (1103, 759), (67, 45), (512, 512)]:
            image = torch.rand(1, h, w, 3)
            tiles, prompts, layout, ready = module.RemoteSuperUpscaleTiles().prepare(
                image, image, "source", 512, 128, False, "", "")["result"]
            self.assertEqual(len(tiles), len(prompts))
            self.assertTrue(all(max(tile.shape[1:3]) <= 512 for tile in tiles))
            result = module.RemoteSuperUpscaleAssemble().assemble(tiles, [layout])[0]
            self.assertEqual(result.shape, image.shape)
            torch.testing.assert_close(result, image, atol=2e-7, rtol=1e-6)

    def test_8k_coverage(self):
        starts = module.tile_starts(7680, 1024, 128)
        self.assertEqual(starts[0], 0)
        self.assertEqual(starts[-1]+1024, 7680)
        self.assertTrue(all(b-a <= 896 for a,b in zip(starts, starts[1:])))

    def test_vision_failure_never_falls_back(self):
        image = torch.zeros(1, 512, 512, 3)
        with patch.object(module, "purge") as purge, patch.object(module.urllib.request, "urlopen", side_effect=RuntimeError("offline")):
            with self.assertRaisesRegex(RuntimeError, "Vision tile 1"):
                module.RemoteSuperUpscaleTiles().prepare(image, image, "source", 512, 128, True, "http://localhost/caption", "token")
            purge.assert_called_once()

    def test_vision_uses_matching_original_crops_and_distinct_prompts(self):
        original = torch.zeros(1, 64, 448, 3)
        original[:, :, :, 0] = torch.linspace(0, 1, 448)
        current = torch.ones(1, 128, 896, 3)
        observed = []
        def caption(request, timeout):
            payload = json.loads(request.data)
            images = [Image.open(io.BytesIO(base64.b64decode(value))) for value in payload["images"]]
            self.assertEqual(images[0].size, (448, 64))
            self.assertEqual(images[1].size, (256, 64))
            self.assertEqual(images[2].size, (512, 128))
            self.assertEqual(images[2].getpixel((0, 0)), (255, 255, 255))
            observed.append(images[1].getpixel((0, 0))[0])
            return io.BytesIO(json.dumps({"prompt": f"local {len(observed)}", "unloaded": True}).encode())
        with patch.object(module, "purge") as purge, patch.object(module.urllib.request, "urlopen", side_effect=caption):
            result = module.RemoteSuperUpscaleTiles().prepare(current, original, "source", 512, 128, True, "http://localhost/caption", "token")
            self.assertEqual(result["result"][1], ["local 1", "local 2"])
            self.assertEqual(observed[0], 0)
            self.assertGreater(observed[1], 100)
            self.assertEqual(purge.call_count, 4)

    def test_rejects_missing_tiles(self):
        with self.assertRaisesRegex(ValueError, "Numero"):
            module.RemoteSuperUpscaleAssemble().assemble([], [{"positions": [(0,0)]}])


if __name__ == "__main__":
    unittest.main()
