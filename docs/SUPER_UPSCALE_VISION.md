# SUPER UPSCALE v2

All three presets retain the original input for SeedVR2 (no forced 1024-pixel
pre-reduction), restore at 2048/3072/3840, upscale with ClearReality to
4096/6144/7680, then refine at that final resolution.

Both Z-Image stages use tiles no larger than 1024 px, with 128 px overlap,
replicate padding to a multiple of 16 and feathered reconstruction cropped
back to the exact image dimensions. First-stage denoise defaults to 0.25;
the final stage uses 0.18 and ControlNet strength at least 0.65.

Before the final sampler, each tile is captioned by the configured LM Studio
Vision model using three references: the original full composition, the
matching original crop and the current upscaled crop. The original governs
geometry and content. Captions are recorded in the ComfyUI history output
of node 60. This is one re-evaluation stage, not a new caption at each denoising
step. Sky and intentional depth-of-field blur should remain smooth.

The ComfyUI node unloads managed models, collects garbage and empties the
CUDA allocator before each caption. The server loads/unloads LM Studio using
the existing client and verifies that no LM Studio model remains loaded.
An explicit dependency gates all final-stage model loaders until all captions
finish. Driver/display allocations are not expected to become zero.
Vision errors and failed unloads stop the job; no silent generic fallback.

## Installation

Update `ComfyUI_Remote_Model_Loaders` in ComfyUI's `custom_nodes` with both
`__init__.py` and `super_upscale.py`, preserving its other files. Restart ComfyUI
and the web app while idle. The capability check reports missing new nodes.
LM Studio Vision must be enabled. The server issues a per-process callback
token; do not restart the web app during an active upscale.

For a separate ComfyUI host, set `SUPER_UPSCALE_CAPTION_URL` to the web app's
reachable `/api/super-upscale/caption` URL. Otherwise the configured app host
and port are used (wildcard bind addresses resolve to loopback locally).

## Verification

```
node --test test/super-upscale-workflows.test.js test/super-upscale-vision.test.js test/lm-studio-client.test.js
<ComfyUI Python> test/super_upscale_nodes_test.py
```

The local-caption stage adds substantial latency, particularly at 8K. Added
texture is a plausible reconstruction, not recovery of unavailable truth.
Compare original, previous upscale and v2 at equal display size and inspect
matching 100% crops before concluding that perceived sharpness improved.
