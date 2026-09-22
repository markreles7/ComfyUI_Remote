import assert from "node:assert/strict";
import test from "node:test";
import { buildH3DeRopeWorkflow } from "../src/h3-derope-workflows.js";

const source = { name: "source.mp4", subfolder: "remote" };
const config = {
  h3: {
    temporalDeRope: { available: true },
    files: {
      videoVae: "video-vae.safetensors",
      audioVae: "audio-vae.safetensors",
      fl2va: "fl2va.safetensors",
      clip: "qwen3vl.safetensors",
    },
  },
};

test("Temporal De-Rope applica davvero il profilo e prepara un prompt H3 completo", () => {
  const job = buildH3DeRopeWorkflow({ profile: "economy", seed: 42, prompt: "A runner turns sharply." }, source, config);
  assert.equal(job.workflow["300"].inputs.file, "remote/source.mp4");
  assert.equal(job.workflow["305"].inputs.preset, "custom");
  assert.equal(job.workflow["305"].inputs.q, 0.85);
  assert.equal(job.workflow["309"].inputs.preset, "custom");
  assert.equal(job.workflow["309"].inputs.inject, 0.65);
  assert.match(job.workflow["311"].inputs.prompt, /^integrated_multimodal_description:/);
  assert.match(job.workflow["311"].inputs.prompt, /overall_soundscape:/);
  assert.match(job.workflow["311"].inputs.prompt, /non_diegetic_music:/);
  assert.equal(job.workflow["327"].class_type, "DisTorchPurgeVRAMV2");
  assert.deepEqual(job.workflow["327"].inputs.anything, ["316", 0]);
  assert.deepEqual(job.workflow["318"].inputs.images, ["327", 0]);
});
