import assert from "node:assert/strict";
import test from "node:test";
import { buildUpscaleWorkflow, upscaleConfig } from "../src/upscale-workflows.js";

const upload = { name: "pool.jpg", subfolder: "remote", type: "input" };
const models = ["RealESRGAN_x2.pth", "4x-ClearRealityV1.pth", "8x_NMKD-Superscale_150000_G.pth"];

test("costruisce upscaling classico Lanczos con i tre preset", () => {
  const speed = buildUpscaleWorkflow({ upscaleEngine: "lanczos", upscalePreset: "speed" }, upload, models);
  const quality = buildUpscaleWorkflow({ upscaleEngine: "lanczos", upscalePreset: "quality" }, upload, models);
  const max = buildUpscaleWorkflow({ upscaleEngine: "lanczos", upscalePreset: "max" }, upload, models);
  assert.equal(speed.workflow["10"].inputs.upscale_method, "bicubic");
  assert.equal(quality.workflow["10"].inputs.upscale_method, "lanczos");
  assert.equal(max.workflow["10"].inputs.scale_by, 4);
  assert.equal(max.metadata.upscaleSettings.preset, "max");
});

test("costruisce upscale con qualsiasi modello AI locale installato", () => {
  const { workflow, metadata } = buildUpscaleWorkflow({
    upscaleEngine: "model",
    upscalePreset: "quality",
    upscaleModel: "4x-ClearRealityV1.pth",
    upscaleAutoPurge: "on",
  }, upload, models);
  assert.equal(workflow["2"].class_type, "VRAM_Debug");
  assert.equal(workflow["10"].inputs.model_name, "4x-ClearRealityV1.pth");
  assert.equal(workflow["11"].class_type, "UpscaleWithModelAdvanced");
  assert.equal(workflow["11"].inputs.max_batch_size, 1);
  assert.equal(metadata.upscaleSettings.scale, 4);
});

test("costruisce SeedVR2 Velocità, Qualità e MAX con profili anti-OOM", () => {
  const speed = buildUpscaleWorkflow({
    upscaleEngine: "seedvr2", upscalePreset: "speed", upscaleAutoPurge: "on", seed: "42",
  }, upload, models);
  const quality = buildUpscaleWorkflow({
    upscaleEngine: "seedvr2", upscalePreset: "quality", upscaleAutoPurge: "on", seed: "42",
  }, upload, models);
  const max = buildUpscaleWorkflow({
    upscaleEngine: "seedvr2", upscalePreset: "max", upscaleAutoPurge: "on", seed: "42",
  }, upload, models);
  assert.equal(speed.workflow["12"].inputs.resolution, 1536);
  assert.equal(quality.workflow["12"].inputs.resolution, 2048);
  assert.equal(max.workflow["12"].inputs.resolution, 2656);
  assert.equal(max.workflow["10"].inputs.model, "seedvr2_ema_7b_fp16.safetensors");
  assert.equal(max.workflow["10"].inputs.blocks_to_swap, 24);
  assert.equal(max.workflow["11"].inputs.decode_tiled, true);
  assert.equal(max.workflow["12"].inputs.batch_size, 1);
  assert.equal(max.workflow["13"].class_type, "RemoteImageTensorNormalize");
});

test("applica detailer volto occhi e mani prima di SeedVR2", () => {
  const { workflow, metadata } = buildUpscaleWorkflow({
    upscaleEngine: "seedvr2",
    upscalePreset: "quality",
    upscaleAutoPurge: "on",
    upscaleSourceWidth: "1024",
    upscaleSourceHeight: "768",
    upscaleFaceDetailer: "on",
    upscaleEyeDetailer: "on",
    upscaleHandDetailer: "on",
    upscaleFaceDenoise: "0.18",
    upscaleEyeDenoise: "0.12",
    upscaleHandDenoise: "0.25",
    seed: "42",
  }, upload, models);
  assert.equal(workflow["300"].class_type, "UNETLoader");
  assert.equal(workflow["311"].inputs.model_name, "bbox/face_yolov8n.pt");
  assert.equal(workflow["321"].inputs.model_name, "bbox/face_yolov8n.pt");
  assert.equal(workflow["331"].inputs.model_name, "bbox/hand_yolov8s.pt");
  assert.deepEqual(workflow["2"].inputs.image_pass, ["333", 1]);
  assert.deepEqual(workflow["12"].inputs.image, ["2", 1]);
  assert.equal(metadata.upscaleSettings.preDetailer, true);
  assert.deepEqual(metadata.upscaleSettings.preDetailerPasses.map((pass) => pass.id), ["face", "eyes", "hands"]);
});

test("applica detailer pelle e fisico con SAM prima dell'upscale", () => {
  const { workflow, metadata } = buildUpscaleWorkflow({
    upscaleEngine: "seedvr2",
    upscalePreset: "quality",
    upscaleAutoPurge: "on",
    upscaleSkinDetailer: "on",
    upscaleSkinDenoise: "0.11",
    seed: "42",
  }, upload, models);
  assert.equal(workflow["307"].class_type, "easy samLoaderPipe");
  assert.equal(workflow["341"].inputs.model_name, "bbox/person_yolov8n-seg.pt");
  assert.deepEqual(workflow["342"].inputs.sam_pipe, ["307", 0]);
  assert.equal(workflow["342"].inputs.denoise, 0.11);
  assert.deepEqual(workflow["2"].inputs.image_pass, ["343", 1]);
  assert.deepEqual(metadata.upscaleSettings.preDetailerPasses.map((pass) => pass.id), ["skin"]);
});

test("applica il gruppo pre-detailer NSFW anatomia prima dell'upscale", () => {
  const { workflow, metadata } = buildUpscaleWorkflow({
    upscaleEngine: "seedvr2",
    upscalePreset: "quality",
    upscaleAutoPurge: "on",
    upscaleNsfwDetailer: "on",
    upscaleNsfwDenoise: "0.10",
    seed: "42",
  }, upload, models);
  assert.equal(workflow["351"].inputs.model_name, "bbox/female-breast-v4.7.pt");
  assert.equal(workflow["361"].inputs.model_name, "bbox/nipples_v2_yolov11s-seg.pt");
  assert.equal(workflow["371"].inputs.model_name, "bbox/pussy_yolo11s_seg_best.pt");
  assert.equal(workflow["381"].inputs.model_name, "bbox/assdetailer-seg.pt");
  assert.equal(workflow["391"].inputs.model_name, "bbox/penisV2.pt");
  assert.equal(workflow["401"].inputs.model_name, "bbox/CockAndBallYolo8x.pt");
  assert.deepEqual(workflow["402"].inputs.sam_pipe, ["307", 0]);
  assert.equal(workflow["402"].inputs.denoise, 0.10);
  assert.deepEqual(workflow["2"].inputs.image_pass, ["403", 1]);
  assert.deepEqual(metadata.upscaleSettings.preDetailerPasses.map((pass) => pass.id), [
    "nsfw_breast",
    "nsfw_nipples",
    "nsfw_vagina",
    "nsfw_anus",
    "nsfw_penis",
    "nsfw_male_genitals",
  ]);
});

test("costruisce RTX VSR con denoise e deblur Ultra nel preset MAX", () => {
  const { workflow, metadata } = buildUpscaleWorkflow({
    upscaleEngine: "rtx",
    upscalePreset: "max",
    upscaleAutoPurge: "on",
  }, upload, models);
  assert.equal(workflow["10"].class_type, "DaSiWa_RTX_UpscalerRefiner");
  assert.equal(workflow["10"].inputs.upscale, "High Bitrate");
  assert.equal(workflow["10"].inputs.upscale_quality, "Ultra");
  assert.equal(workflow["10"].inputs.denoise, true);
  assert.equal(workflow["10"].inputs.deblur, true);
  assert.equal(workflow["10"].inputs.scale, 4);
  assert.equal(metadata.upscaleSettings.engine, "rtx");
});

test("espone soltanto motori supportati da nodi, modelli e GPU disponibili", () => {
  const config = upscaleConfig({
    availableNodes: [
      "UpscaleWithModelAdvanced",
      "SeedVR2LoadDiTModel",
      "SeedVR2LoadVAEModel",
      "SeedVR2VideoUpscaler",
      "RemoteImageTensorNormalize",
      "DaSiWa_RTX_UpscalerRefiner",
    ],
    availableModels: models,
    deviceName: "cuda:0 NVIDIA GeForce RTX 4070 SUPER",
  });
  assert.equal(config.engines.find((engine) => engine.id === "model").available, true);
  assert.equal(config.engines.find((engine) => engine.id === "seedvr2").available, true);
  assert.equal(config.engines.find((engine) => engine.id === "rtx").available, true);
  assert.deepEqual(config.models, models);
  assert.equal(config.detailers.available, false);
});

test("espone i pre-detailer quando Impact Pack e nodi Flux sono disponibili", () => {
  const config = upscaleConfig({
    availableNodes: [
      "UNETLoader",
      "DualCLIPLoader",
      "VAELoader",
      "ModelSamplingFlux",
      "easy pipeIn",
      "easy samLoaderPipe",
      "easy ultralyticsDetectorPipe",
      "easy preDetailerFix",
      "easy detailerFix",
    ],
    availableModels: models,
    availableDetectorModels: [
      "bbox/female-breast-v4.7.pt",
      "bbox/nipples_v2_yolov11s-seg.pt",
      "bbox/pussy_yolo11s_seg_best.pt",
      "bbox/assdetailer-seg.pt",
      "bbox/penisV2.pt",
      "bbox/CockAndBallYolo8x.pt",
    ],
  });
  assert.equal(config.detailers.available, true);
  assert.equal(config.detailers.nsfw, true);
});
