import assert from "node:assert/strict";
import test from "node:test";
import { buildImageWorkflow } from "../src/image-workflows.js";
import { buildStudioJobs } from "../src/studio-workflows.js";
import { buildWorkflow } from "../src/workflows.js";

const upload = { name: "anchor.png", subfolder: "", type: "input" };
const prompt = "Preserve the scene and original actors while inserting the referenced actor.";
const negativePrompt = "blur, identity drift, changed background, changed framing";

test("Interactive Cast builds every supported automatic anchor and LTX path", () => {
  const qwen = buildImageWorkflow("qwenEdit", {
    imageMode: "image",
    imageResolution: "custom",
    imageWidth: 896,
    imageHeight: 1152,
    imageSteps: 8,
    imageGuidance: 1,
    batchSize: 1,
    prompt,
    negativePrompt,
    seed: 42,
    referenceUploads: [{ ...upload, name: "actor-reference.png" }],
    outputBase: "InteractiveCast/test/anchor",
    saveOriginal: false,
    upscaleMode: "none",
  }, upload, []);
  assert.ok(Object.keys(qwen.workflow).length > 0);

  for (const [mode, extra] of [
    ["qwenKreaKlein", {}],
    ["kreaTriple", { kreaTripleOperation: "img2img", kreaTripleDenoise: 0.2 }],
  ]) {
    const jobs = buildStudioJobs(mode, {
      prompt,
      negativePrompt,
      seed: 42,
      imageWidth: 896,
      imageHeight: 1152,
      ...extra,
    }, { source: upload, references: [] }, []);
    assert.equal(jobs.length, 1);
    assert.ok(Object.keys(jobs[0].workflow).length > 0);
  }

  const ltx = buildWorkflow("devfp8", {
    prompt,
    negativePrompt,
    resolution: "480p",
    orientation: "portrait",
    duration: 3,
    quality: "preview",
    seed: 42,
    videoInputMode: "image",
    videoModelId: "normal",
  }, upload, [], []);
  assert.ok(Object.keys(ltx.workflow).length > 0);
});
