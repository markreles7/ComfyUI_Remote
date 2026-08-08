import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSeedvr2VideoUpscaleWorkflow,
  seedvr2VideoUpscaleConfig,
} from "../src/seedvr2-video-upscale-workflows.js";

const upload = { name: "clip.mp4", subfolder: "remote", type: "input" };

test("costruisce SeedVR2 Video Upscale mantenendo audio e FPS sorgente", () => {
  const { workflow, metadata } = buildSeedvr2VideoUpscaleWorkflow({
    seedvr2VideoPreset: "quality",
    seedvr2VideoResolution: "1080",
    seedvr2VideoFrameLoadCap: "121",
    seedvr2VideoSourceDuration: "8",
    seed: "42",
  }, upload);

  assert.equal(workflow["1"].class_type, "VHS_LoadVideo");
  assert.equal(workflow["1"].inputs.video, "remote/clip.mp4");
  assert.equal(workflow["1"].inputs.frame_load_cap, 121);
  assert.equal(workflow["2"].class_type, "VHS_VideoInfo");
  assert.deepEqual(workflow["6"].inputs.image, ["1", 0]);
  assert.equal(workflow["6"].inputs.resolution, 1080);
  assert.equal(workflow["6"].inputs.batch_size, 17);
  assert.equal(workflow["6"].inputs.temporal_overlap, 3);
  assert.deepEqual(workflow["7"].inputs.audio, ["1", 2]);
  assert.deepEqual(workflow["7"].inputs.frame_rate, ["2", 0]);
  assert.equal(workflow["7"].inputs.crf, 13);
  assert.equal(workflow["7"].class_type, "VHS_VideoCombine");
  assert.equal(metadata.generationType, "seedvr2VideoUpscale");
  assert.equal(metadata.mediaType, "video");
  assert.equal(metadata.duration, 5.04);
  assert.equal(metadata.seed, 42);
});

test("SeedVR2 Video Anteprima e Massima cambiano profilo senza pass aggiuntivi", () => {
  const preview = buildSeedvr2VideoUpscaleWorkflow({
    seedvr2VideoPreset: "preview",
    seed: "7",
  }, upload);
  const max = buildSeedvr2VideoUpscaleWorkflow({
    seedvr2VideoPreset: "max",
    seedvr2VideoKeepAudio: "false",
    seed: "7",
  }, upload);

  assert.equal(preview.workflow["4"].inputs.model, "seedvr2_ema_3b_fp8_e4m3fn.safetensors");
  assert.equal(preview.workflow["6"].inputs.resolution, 720);
  assert.equal(preview.workflow["6"].inputs.batch_size, 9);
  assert.equal(max.workflow["4"].inputs.model, "seedvr2_ema_7b_fp16.safetensors");
  assert.equal(max.workflow["6"].inputs.resolution, 1440);
  assert.equal(max.workflow["6"].inputs.temporal_overlap, 5);
  assert.equal(max.workflow["7"].inputs.audio, undefined);
  assert.equal(Object.values(max.workflow).filter((item) => item.class_type === "SeedVR2VideoUpscaler").length, 1);
});

test("espone SeedVR2 Video solo quando nodi, DiT e VAE sono disponibili", () => {
  const config = seedvr2VideoUpscaleConfig({
    availableNodes: [
      "LoadVideo",
      "VHS_LoadVideo",
      "VHS_VideoInfo",
      "VHS_VideoCombine",
      "SeedVR2LoadDiTModel",
      "SeedVR2LoadVAEModel",
      "SeedVR2VideoUpscaler",
      "SeedVR2TorchCompileSettings",
    ],
    installedSeedvr2Models: [
      "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
    ],
    installedVaes: ["ema_vae_fp16.safetensors"],
  });

  assert.equal(config.available, true);
  assert.equal(config.profiles.find((profile) => profile.id === "quality").available, true);
  assert.equal(config.profiles.find((profile) => profile.id === "max").available, false);
});
