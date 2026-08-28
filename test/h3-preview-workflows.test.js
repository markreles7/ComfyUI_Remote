import assert from "node:assert/strict";
import test from "node:test";
import {
  buildH3PreviewFinishingWorkflow,
  buildH3SceneRecipe,
} from "../src/h3-preview-workflows.js";

const sourceVideo = { name: "preview.mp4", subfolder: "remote", type: "input" };

test("promozione H3 applica FILM, purge, RTX VSR x2 e FSR RCAS nell'ordine", () => {
  const job = buildH3PreviewFinishingWorkflow(sourceVideo, { rcasStrength: 0.35 });
  assert.equal(job.workflow["1"].inputs.video, "remote/preview.mp4");
  assert.equal(job.workflow["2"].class_type, "FILM VFI");
  assert.equal(job.workflow["2"].inputs.multiplier, 2);
  assert.equal(job.workflow["3"].class_type, "DisTorchPurgeVRAMV2");
  assert.equal(job.workflow["4"].class_type, "DaSiWa_RTX_UpscalerRefiner");
  assert.equal(job.workflow["4"].inputs.resize_type, "Scale");
  assert.equal(job.workflow["4"].inputs.scale, 2);
  assert.equal(job.workflow["4"].inputs.denoise, false);
  assert.equal(job.workflow["5"].class_type, "DisTorchPurgeVRAMV2");
  assert.equal(job.workflow["6"].class_type, "ImageSharpenKJ");
  assert.equal(job.workflow["6"].inputs.method, "rcas");
  assert.equal(job.workflow["6"].inputs["method.strength"], 0.35);
  assert.equal(job.workflow["7"].inputs.frame_rate, 48);
  assert.deepEqual(job.workflow["7"].inputs.audio, ["1", 2]);
  assert.equal(job.metadata.h3Stage, "promotedFinal");
});

test("promozione KJ Lanczos conserva 24 fps e audio senza FILM, RTX o sharpening", () => {
  const job = buildH3PreviewFinishingWorkflow(sourceVideo, {
    finishingMode: "kjLanczos",
    aspectRatio: "9:16 (Portrait Widescreen)",
  });
  assert.equal(job.workflow["2"].class_type, "ImageResizeKJv2");
  assert.equal(job.workflow["2"].inputs.upscale_method, "lanczos");
  assert.equal(job.workflow["2"].inputs.width, 720);
  assert.equal(job.workflow["2"].inputs.height, 1280);
  assert.equal(job.workflow["3"].inputs.frame_rate, 24);
  assert.deepEqual(job.workflow["3"].inputs.audio, ["1", 2]);
  assert.equal(Object.values(job.workflow).some((item) => item.class_type === "FILM VFI"), false);
  assert.equal(Object.values(job.workflow).some((item) => item.class_type === "DaSiWa_RTX_UpscalerRefiner"), false);
  assert.equal(job.metadata.finishingMode, "kjLanczos");
});

test("ricetta H3 conserva prompt finale, seed effettivo, riferimenti e impostazioni native", () => {
  const job = {
    metadata: {
      videoStudioMode: "minimaxH3",
      prompt: "r34l1sm. Prompt finale.",
      seed: 123456,
      h3Mode: "image",
      h3Profile: "standard",
      h3ModelProfile: "erosMax",
      integratedTurbo: true,
      lookPreset: "amateurHandheld",
      scenePreset: "fantasyVerite",
      duration: 5,
      frames: 124,
      aspectRatio: "9:16 (Portrait Widescreen)",
      modelFamily: "fl2va",
      modelFile: "minimax_h3_fl2va_int8_convrot.safetensors",
      samplerName: "euler",
      schedulerName: "beta",
      useTurbo: true,
    },
  };
  const raw = {
    prompt: "r34l1sm. Prompt utente.",
    h3FirstMegapixels: "0.6",
    h3RefineMode: "rtx",
    h3PurgeBetween: "true",
    h3UseTurbo: "false",
    h3ModelProfile: "erosMax",
    h3ScenePreset: "fantasyVerite",
  };
  const recipe = buildH3SceneRecipe(job, raw, { h3FirstFrame: { name: "first.png" } }, [{ name: "realism.safetensors", strength: 0.7 }]);
  assert.equal(recipe.seed, 123456);
  assert.equal(recipe.prompt, "r34l1sm. Prompt finale.");
  assert.equal(recipe.nativeSettings.h3RefineMode, "rtx");
  assert.equal(recipe.nativeSettings.h3UseTurbo, "false");
  assert.equal(recipe.h3ModelProfile, "erosMax");
  assert.equal(recipe.integratedTurbo, true);
  assert.equal(recipe.nativeSettings.h3ModelProfile, "erosMax");
  assert.equal(recipe.scenePreset, "fantasyVerite");
  assert.equal(recipe.uploads.h3FirstFrame.name, "first.png");
  assert.equal(recipe.loras[0].strength, 0.7);
});

test("finishing ACTION H3 usa cartella e metadata ACTION senza cambiare la pipeline", () => {
  const job = buildH3PreviewFinishingWorkflow(sourceVideo, { videoStudioMode: "actionH3" });
  assert.equal(job.metadata.videoStudioMode, "actionH3");
  assert.match(job.metadata.workflowId, /actionH3/);
  assert.match(job.workflow["7"].inputs.filename_prefix, /ActionH3/);
  assert.equal(job.workflow["2"].class_type, "FILM VFI");
  assert.equal(job.workflow["4"].class_type, "DaSiWa_RTX_UpscalerRefiner");
  assert.equal(job.workflow["6"].class_type, "ImageSharpenKJ");
});
