import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  SUPER_UPSCALE_FILES,
  SUPER_UPSCALE_REQUIRED_NODES,
  buildSuperUpscaleWorkflow,
  superUpscaleConfig,
} from "../src/super-upscale-workflows.js";

const upload = { name: "photo.webp", subfolder: "remote", type: "input" };

test("SUPER UPSCALE replica la pipeline SeedVR2, tile Z-Image e ClearReality", () => {
  const { workflow, metadata } = buildSuperUpscaleWorkflow({
    superUpscalePreset: "8k",
    superUpscaleDenoise: "0.35",
    superUpscaleControlStrength: "0.5",
    superUpscaleSeed: "42",
  }, upload, { modelPatch: "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors" });

  assert.equal(workflow["12"].inputs.resolution, 3840);
  assert.equal(workflow["20"].inputs.width_factor, 2);
  assert.match(workflow["34"].inputs.text, /preserve the exact visible subject/);
  assert.equal(workflow["39"].inputs.steps, 8);
  assert.equal(workflow["39"].inputs.denoise, 0.35);
  assert.equal(workflow["37"].inputs.strength, 0.5);
  assert.equal(workflow["50"].inputs.model_name, "4x-ClearRealityV1.pth");
  assert.equal(workflow["52"].inputs.size, 7680);
  assert.equal(metadata.generationType, "superUpscale");
  assert.equal(metadata.upscaleSettings.tileGrid, "2×2");
});

test("SUPER UPSCALE usa la descrizione Vision prodotta prima di ComfyUI", () => {
  const { workflow, metadata } = buildSuperUpscaleWorkflow({
    superUpscaleVisionPrompt: "A woman in a bedroom, black lace fabric, soft daylight, preserve exact composition",
  }, upload, { modelPatch: "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors" });
  assert.equal(workflow["34"].inputs.text, "A woman in a bedroom, black lace fabric, soft daylight, preserve exact composition");
  assert.equal(metadata.upscaleSettings.autoCaption, "LM Studio Vision");
  assert.equal(Object.values(workflow).some((item) => item.class_type === "AILab_QwenVL_Advanced"), false);
});

test("SUPER UPSCALE espone 4K, 6K e 8K senza superare 7680 px", () => {
  const patch = { modelPatch: "Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors" };
  assert.equal(buildSuperUpscaleWorkflow({ superUpscalePreset: "4k" }, upload, patch).workflow["52"].inputs.size, 4096);
  assert.equal(buildSuperUpscaleWorkflow({ superUpscalePreset: "6k" }, upload, patch).workflow["52"].inputs.size, 6144);
  assert.equal(buildSuperUpscaleWorkflow({ superUpscalePreset: "8k" }, upload, patch).workflow["52"].inputs.size, 7680);
});

test("preflight SUPER UPSCALE accetta la revisione ControlNet 2601 installata", () => {
  const config = superUpscaleConfig({
    availableNodes: SUPER_UPSCALE_REQUIRED_NODES,
    installedSeedvr2Models: [SUPER_UPSCALE_FILES.seedvrModel],
    installedSeedvr2Vaes: [SUPER_UPSCALE_FILES.seedvrVae],
    installedDiffusionModels: [SUPER_UPSCALE_FILES.diffusionModel],
    installedClips: [SUPER_UPSCALE_FILES.clip],
    installedVaes: [SUPER_UPSCALE_FILES.vae],
    installedModelPatches: ["Z-Image-Turbo-Fun-Controlnet-Union-2.1-2601-8steps.safetensors"],
    installedUpscaleModels: [SUPER_UPSCALE_FILES.upscaleModel],
  });
  assert.equal(config.available, true);
  assert.equal(config.missingNodes.length, 0);
  assert.equal(config.missingFiles.length, 0);
});

test("Genera espone SUPER UPSCALE e lo collega alla route di generazione", () => {
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(html, /data-generation-type="superUpscale"/);
  assert.match(html, /id="super-upscale-options"/);
  assert.match(html, /name="superUpscaleImage"/);
  assert.match(client, /isSuperUpscaleGeneration/);
  assert.match(server, /buildSuperUpscaleWorkflow/);
  assert.match(server, /request\.body\.generationType === "superUpscale"/);
});
