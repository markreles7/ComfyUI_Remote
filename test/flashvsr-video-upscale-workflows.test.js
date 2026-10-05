import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlashVsrVideoUpscaleWorkflow,
  flashVsrVideoUpscaleConfig,
  FLASHVSR_VIDEO_UPSCALE_REQUIRED_NODES,
} from "../src/flashvsr-video-upscale-workflows.js";

const upload = { name: "clip.mp4", subfolder: "remote", type: "input" };

test("FlashVSR Tiny produce un netto 1,5x e mantiene audio e FPS", () => {
  const { workflow, metadata } = buildFlashVsrVideoUpscaleWorkflow({
    flashVsrSourceWidth: 1184,
    flashVsrSourceHeight: 640,
    flashVsrSourceDuration: 12,
    flashVsrFps: 24,
    flashVsrFrameLoadCap: 289,
    seed: 42,
  }, upload);

  assert.equal(workflow["1"].inputs.video, "remote/clip.mp4");
  assert.equal(workflow["1"].inputs.frame_load_cap, 289);
  assert.equal(workflow["3"].class_type, "FlashVSRInitPipe");
  assert.equal(workflow["3"].inputs.mode, "tiny");
  assert.equal(workflow["3"].inputs.vae_model, "LightVAE_W2.1");
  assert.equal(workflow["4"].class_type, "FlashVSRNodeAdv");
  assert.equal(workflow["4"].inputs.scale, 2);
  assert.equal(workflow["4"].inputs.resize_factor, 0.75);
  assert.equal(workflow["4"].inputs.frame_chunk_size, 49);
  assert.deepEqual(workflow["5"].inputs.audio, ["1", 2]);
  assert.deepEqual(workflow["5"].inputs.frame_rate, ["2", 0]);
  assert.equal(metadata.width, 1776);
  assert.equal(metadata.height, 960);
  assert.equal(metadata.upscaleSettings.netScale, 1.5);
});

test("FlashVSR Tiny segnala i nodi mancanti", () => {
  const unavailable = flashVsrVideoUpscaleConfig({ availableNodes: ["VHS_LoadVideo"] });
  assert.equal(unavailable.available, false);
  assert.ok(unavailable.missingNodes.includes("FlashVSRNodeAdv"));

  const available = flashVsrVideoUpscaleConfig({
    availableNodes: [...FLASHVSR_VIDEO_UPSCALE_REQUIRED_NODES],
  });
  assert.equal(available.available, true);
  assert.deepEqual(available.missingNodes, []);
});
