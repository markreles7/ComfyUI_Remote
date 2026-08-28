import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSamePlacePrompt,
  detectImageSeriesCapabilities,
  generateInfluencerBatch,
  generateSamePlaceSeries,
} from "../src/image-series.js";
import { buildImageWorkflow } from "../src/image-workflows.js";

test("Random Influencer crea 1/4/6/9 job con prompt e seed indipendenti", () => {
  for (const count of [1, 4, 6, 9]) {
    const plan = generateInfluencerBatch("alessia_character", count, {
      planningSeed: 42,
      seedMode: "fixed",
      seed: 1000,
    });
    assert.equal(plan.items.length, count);
    assert.equal(new Set(plan.items.map((item) => item.prompt)).size, count);
    assert.equal(new Set(plan.items.map((item) => item.seed)).size, count);
    assert.ok(plan.items.every((item) => item.prompt.startsWith("alessia_character")));
  }
});

test("batch Influencer 6/9 garantisce varietà di shot, location e outfit", () => {
  const plan = generateInfluencerBatch("character", 9, { planningSeed: 7 });
  const prompts = plan.items.map((item) => item.prompt);
  const shots = ["selfie", "full body", "photo taken by another person", "candid", "three-quarter", "over-the-shoulder", "seated"];
  const locations = ["bedroom", "bathroom", "balcony", "living room", "kitchen", "café", "city street", "beach", "park"];
  const outfits = ["t-shirt", "crop top", "tank top", "sweatshirt", "hoodie", "summer dress", "denim skirt", "blouse", "homewear"];
  assert.ok(shots.filter((term) => prompts.some((prompt) => prompt.includes(term))).length >= 3);
  assert.ok(locations.filter((term) => prompts.some((prompt) => prompt.includes(term))).length >= 3);
  assert.ok(outfits.filter((term) => prompts.some((prompt) => prompt.includes(term))).length >= 3);
});

test("Same Place 2/4/6/8 riparte dalla stessa anchor semantica e varia solo elementi consentiti", () => {
  const anchorContext = {
    subjectIdentity: "alessia_character",
    environmentSummary: "small café terrace in Rome",
    outfitSummary: "black t-shirt and denim shorts",
    lightingSummary: "soft afternoon daylight",
    framingSummary: "waist-up smartphone photo",
  };
  for (const count of [2, 4, 6, 8]) {
    const plan = generateSamePlaceSeries({
      count,
      anchorContext,
      planningSeed: 21,
      seedMode: "anchor",
      anchorSeed: 900,
      preserveLocation: 95,
      preserveOutfit: 95,
      preserveLighting: 95,
      preserveFraming: 90,
      variationStrength: 25,
    });
    assert.equal(plan.items.length, count);
    assert.equal(new Set(plan.items.map((item) => item.prompt)).size, count);
    assert.equal(new Set(plan.items.map((item) => item.seed)).size, count);
    for (const item of plan.items) {
      assert.match(item.prompt, /sole main scene reference/i);
      assert.match(item.prompt, /same location.*same background.*same outfit.*same overall lighting/i);
      assert.match(item.prompt, /small café terrace in Rome/);
      assert.match(item.prompt, /Do not replace, redesign, relight, relocate/i);
    }
  }
});

test("Same Place rispetta i toggle disabilitati", () => {
  const plan = generateSamePlaceSeries({
    count: 2,
    planningSeed: 5,
    allowPoseChanges: false,
    allowExpressionChanges: false,
    allowSmallAngleChanges: false,
    allowHandReposition: false,
    allowGazeChanges: false,
  });
  assert.ok(plan.items.every((item) => /minimal natural micro-adjustment/.test(item.variation)));
});

test("prompt Same Place traduce gli slider in lock espliciti", () => {
  const prompt = buildSamePlacePrompt({}, "soft smile", {
    preserveLocation: 100,
    preserveOutfit: 80,
    preserveLighting: 60,
    preserveFraming: 20,
    variationStrength: 20,
  });
  assert.match(prompt, /preserve the location and background exactly/i);
  assert.match(prompt, /strongly preserve the same outfit/i);
  assert.match(prompt, /keep the lighting recognizably consistent/i);
  assert.match(prompt, /retain the main visual identity of the framing/i);
  assert.match(prompt, /very subtle change/i);
});

test("capability PuLID richiede adapter Flux.2 completo e peso Klein v2", () => {
  const missing = detectImageSeriesCapabilities({ KSampler: { category: "sampling" } });
  assert.equal(missing.pulidFlux2.detected, false);
  assert.equal(missing.pulidFlux2.available, false);
  assert.match(missing.pulidFlux2.reason, /object_info/);
  const detected = detectImageSeriesCapabilities({
    ApplyPuLIDFlux: { display_name: "Apply PuLID Flux" },
    InsightFaceLoader: { display_name: "InsightFace Loader" },
  });
  assert.equal(detected.pulidFlux2.detected, true);
  assert.equal(detected.pulidFlux2.available, false);
  assert.deepEqual(detected.pulidFlux2.pulidNodes, ["ApplyPuLIDFlux"]);
  const ready = detectImageSeriesCapabilities({
    PuLIDInsightFaceLoader: { display_name: "Load InsightFace (PuLID)" },
    PuLIDEVACLIPLoader: { display_name: "Load EVA-CLIP (PuLID)" },
    PuLIDModelLoader: {
      display_name: "Load PuLID Flux.2",
      input: { required: { pulid_file: [["pulid_flux2_klein_v2.safetensors"]] } },
    },
    ApplyPuLIDFlux2: { display_name: "Apply PuLID Flux.2" },
  });
  assert.equal(ready.pulidFlux2.available, true);
  assert.equal(ready.pulidFlux2.modelFile, "pulid_flux2_klein_v2.safetensors");
  assert.deepEqual(ready.pulidFlux2.missingNodes, []);
});

test("workflow Flux.2 applica PuLID dopo le LoRA e conserva la reference", () => {
  const reference = { name: "pulid-face.png", subfolder: "remote" };
  const job = buildImageWorkflow("flux2", {
    imageMode: "text",
    imageModelFile: "FLUX2\\flux2Klein_9bBase.safetensors",
    prompt: "portrait in natural light",
    negativePrompt: "",
    imageResolution: "portrait",
    imageSteps: 8,
    imageGuidance: 1,
    seed: 123,
    batchSize: 1,
    characterConsistency: "loraPulid",
    pulidStrength: 1.4,
    pulidReferenceUpload: reference,
  }, null, [{ name: "FLUX2\\character.safetensors", strength: 0.8 }]);
  assert.equal(job.workflow["900102"].class_type, "PuLIDInsightFaceLoader");
  assert.equal(job.workflow["900103"].class_type, "PuLIDEVACLIPLoader");
  assert.equal(job.workflow["900104"].inputs.pulid_file, "pulid_flux2_klein_v2.safetensors");
  assert.equal(job.workflow["900105"].class_type, "ApplyPuLIDFlux2");
  assert.deepEqual(job.workflow["900105"].inputs.model, ["1016", 0]);
  assert.deepEqual(job.workflow["13"].inputs.model, ["900105", 0]);
  assert.equal(job.metadata.pulidReferenceImage, "remote/pulid-face.png");
  assert.equal(job.metadata.pulidStrength, 1.4);
});

test("workflow immagine conserva metadata indipendenti della serie", () => {
  const job = buildImageWorkflow("qwenImage", {
    imageMode: "text",
    imageModelFile: "QWEN\\qwen_image_2512_fp8_e4m3fn.safetensors",
    prompt: "alessia_character, casual smartphone portrait",
    negativePrompt: "",
    imageResolution: "portrait",
    imageSteps: 20,
    imageGuidance: 4,
    seed: 123,
    batchSize: 1,
    seriesId: "series-1",
    seriesType: "influencer",
    seriesIndex: 3,
    seriesCount: 9,
    seriesLabel: "Influencer 04",
    seriesSeedMode: "fixed",
    characterLora: "QWEN\\character.safetensors",
    characterTrigger: "alessia_character",
    characterLoraStrength: 0.8,
  }, null, [{ name: "QWEN\\character.safetensors", strength: 0.8 }]);
  assert.equal(job.metadata.batchSize, 1);
  assert.equal(job.metadata.seriesId, "series-1");
  assert.equal(job.metadata.seriesIndex, 3);
  assert.equal(job.metadata.seriesCount, 9);
  assert.equal(job.metadata.characterTrigger, "alessia_character");
  assert.deepEqual(job.metadata.loras, [{ name: "QWEN\\character.safetensors", strength: 0.8 }]);
});
