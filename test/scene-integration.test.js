import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildImageWorkflow } from "../src/image-workflows.js";
import { SceneProfileCache, sceneCacheKey } from "../src/scene-integration/cache.js";
import {
  applyCorrectionsToIntegrationPlan,
  buildCorrectionPlan,
} from "../src/scene-integration/correction-planner.js";
import { evaluateSceneCoherence } from "../src/scene-integration/evaluator.js";
import { prepareSceneIntegratedWorkflow } from "../src/scene-integration/pipeline.js";
import {
  assertSceneProfile,
  emptySceneProfile,
  migrateSceneProfile,
  validateSceneProfile,
} from "../src/scene-integration/schema.js";
import { sceneIntegrationSettings } from "../src/scene-integration/defaults.js";
import { buildWorkflow } from "../src/workflows.js";

const golden = JSON.parse(fs.readFileSync(
  new URL("./fixtures/scene-golden.json", import.meta.url),
  "utf8",
));

const availableNodes = [
  "ColorMatchToReference",
  "ImageBlur",
  "FastFilmGrain",
  "SaveImage",
  "CreateVideo",
  "VHS_VideoCombine",
];

function value(value, confidence = 0.8) {
  return { value, confidence, method: "fixture", unit: "normalized", fallback: null };
}

function profile(mediaType = "image") {
  const result = emptySceneProfile(mediaType);
  result.id = "profile-fixture";
  result.cacheKey = "cache-fixture";
  result.colorProfile = {
    temperature: value(5600),
    meanSaturation: value(0.42),
    globalContrast: value(0.21),
    luminanceDistribution: value(Array(64).fill(1 / 64), 0.95),
  };
  result.lightingProfile = {
    mainDirection: value({ x: -0.7, y: -0.2 }),
    shadowSoftness: value(0.64),
  };
  result.cameraProfile = {
    blur: value(0.22),
    apparentSharpness: value(0.78),
  };
  result.spatialProfile = {
    depthMap: value("depth.png", 0.88),
  };
  result.temporalProfile = mediaType === "video"
    ? { cameraMotion: value({ x: 1.2, y: 0.1 }, 0.7) }
    : { available: false };
  result.textureProfile = {
    grainAmount: value(0.12),
    finishing: { recommendedGrain: 0.025, recommendedBlurSigma: 0.4 },
  };
  result.masks = {};
  result.confidenceScores = { overall: 0.72 };
  result.analysisWarnings = [];
  return assertSceneProfile(result);
}

test("SceneProfile v1 applica default, valida e migra profili legacy", () => {
  const valid = profile();
  assert.deepEqual(validateSceneProfile(valid), []);
  assert.equal(valid.version, golden.profileVersion);
  for (const section of golden.requiredSections) assert.ok(section in valid);
  const invalid = { version: "", mediaType: "audio" };
  assert.ok(validateSceneProfile(invalid).length > 2);
  const migrated = migrateSceneProfile({ ...valid, version: "0.5.0" });
  assert.equal(migrated.version, "1.0.0");
  assert.ok(migrated.analysisWarnings.some((item) => item.includes("legacy")));
});

test("preset e valutatore rispettano il contratto golden", () => {
  for (const [preset, maxIterations] of Object.entries(golden.presetIterationLimits)) {
    const settings = sceneIntegrationSettings({ enabled: true, preset });
    assert.equal(settings.correctionIterations, maxIterations);
  }
  const evaluation = evaluateSceneCoherence(profile(), profile(), {});
  assert.equal(Object.keys(evaluation.categories).length, golden.scoreCategories);
});

test("cache Scene Profile usa hash del file e impostazioni e si invalida", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scene-cache-"));
  try {
    const first = sceneCacheKey(Buffer.from("same source"), { preset: "balanced" });
    const second = sceneCacheKey(Buffer.from("same source"), { preset: "maximum" });
    assert.notEqual(first, second);
    const cache = new SceneProfileCache(directory);
    const stored = { ...profile(), id: "cached-profile", cacheKey: first };
    cache.put(first, stored);
    assert.equal(cache.get(first).id, "cached-profile");
    assert.equal(cache.invalidate(first), true);
    assert.equal(cache.get(first), null);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("adapter Qwen preserva parametri nativi e non applica finishing globale alle immagini", () => {
  const upload = { name: "source.png", subfolder: "remote", type: "input" };
  const job = buildImageWorkflow("qwenEdit", {
    imageMode: "image",
    prompt: "Add a person beside the table.",
    negativePrompt: "",
    imageResolution: "portrait",
    batchSize: "1",
    imageSteps: "8",
    imageGuidance: "1",
    seed: "123",
  }, upload);
  const integrated = prepareSceneIntegratedWorkflow({
    ...job,
    profile: profile(),
    settings: sceneIntegrationSettings({ enabled: true, preset: "balanced" }),
    availableNodes,
    context: { sourceInput: "remote/source.png", denoise: 0.55 },
  });
  assert.equal(integrated.plan.adapter, "qwen-image-edit-2511");
  assert.equal(integrated.plan.parameterPolicy, "preserve-native");
  assert.equal(integrated.plan.appliedParameters.denoise, undefined);
  const classes = Object.values(integrated.workflow).map((item) => item.class_type);
  assert.ok(!classes.includes("ColorMatchToReference"));
  assert.ok(!classes.includes("ImageBlur"));
  assert.ok(!classes.includes("FastFilmGrain"));
  assert.ok(integrated.workflowReport.outputRewrites.every((entry) =>
    !entry.operations.includes("blur-match")
  ));
});

test("il finishing fotografico globale non modifica né bozze né master", () => {
  const source = {
    "1": { inputs: { image: "source.png" }, class_type: "LoadImage", _meta: { title: "Source" } },
    "2": { inputs: { images: ["1", 0], filename_prefix: "draft_preview" }, class_type: "SaveImage", _meta: { title: "Bozza" } },
    "3": { inputs: { images: ["1", 0], filename_prefix: "master_final" }, class_type: "SaveImage", _meta: { title: "Master finale" } },
  };
  const integrated = prepareSceneIntegratedWorkflow({
    workflow: source,
    metadata: {
      workflowId: "qwenEdit",
      workflowName: "Fixture multi-output",
      mediaType: "image",
      sourceImage: "source.png",
    },
    profile: profile(),
    settings: sceneIntegrationSettings({ enabled: true, preset: "balanced" }),
    availableNodes,
    context: { sourceInput: "source.png" },
  });
  assert.deepEqual(integrated.workflow["2"].inputs.images, ["1", 0]);
  assert.deepEqual(integrated.workflow["3"].inputs.images, ["1", 0]);
  assert.deepEqual(integrated.workflowReport.outputRewrites, []);
});

test("adapter Klein dichiara il fallback depth senza inventare un ControlNet", () => {
  const upload = { name: "source.png", subfolder: "remote", type: "input" };
  const job = buildImageWorkflow("fluxKlein9b", {
    imageMode: "image",
    prompt: "Place the subject naturally in the room.",
    negativePrompt: "",
    imageResolution: "portrait",
    batchSize: "1",
    imageSteps: "8",
    imageGuidance: "1",
    seed: "123",
  }, upload);
  const integrated = prepareSceneIntegratedWorkflow({
    ...job,
    profile: profile(),
    settings: sceneIntegrationSettings({ enabled: true, preset: "balanced" }),
    availableNodes,
    context: { sourceInput: "remote/source.png" },
  });
  assert.equal(integrated.plan.adapter, "flux2-klein");
  assert.ok(integrated.plan.unsupported.includes("native-klein-depth-control"));
  assert.ok(integrated.plan.fallbacks.some((item) => item.includes("ControlNet depth")));
});

test("adapter LTX usa il profilo su un vero batch video prima dell'output", () => {
  const upload = { name: "frame.png", subfolder: "remote", type: "input" };
  const job = buildWorkflow("standard", {
    prompt: "The person walks forward.",
    negativePrompt: "",
    resolution: "480p",
    orientation: "portrait",
    duration: "4",
    quality: "preview",
    seed: "123",
  }, upload);
  const integrated = prepareSceneIntegratedWorkflow({
    ...job,
    profile: profile("video"),
    settings: sceneIntegrationSettings({ enabled: true, preset: "balanced" }),
    availableNodes,
    context: { sourceInput: "remote/frame.png", frameCount: 97, workflowId: "standard" },
  });
  assert.equal(integrated.plan.adapter, "ltx-2.3-video");
  assert.ok(integrated.workflowReport.outputRewrites.some((item) =>
    item.operations.includes("color-match")
  ));
  assert.ok(Object.values(integrated.workflow).some((item) =>
    item.class_type === "FastFilmGrain" && item.inputs.batch_size === 97
  ));
});

test("adapter LTX Sulphur usa controlli video dedicati senza fallback generico", () => {
  const upload = { name: "frame.png", subfolder: "remote", type: "input" };
  const job = buildWorkflow("ltxSulphur", {
    prompt: "The camera slowly pushes in while the subject stays in the same room.",
    negativePrompt: "",
    videoInputMode: "image",
    resolution: "480p",
    orientation: "portrait",
    duration: "4",
    quality: "preview",
    seed: "123",
  }, upload);
  const integrated = prepareSceneIntegratedWorkflow({
    ...job,
    profile: profile("video"),
    settings: sceneIntegrationSettings({ enabled: true, preset: "balanced" }),
    availableNodes,
    context: { sourceInput: "remote/frame.png", frameCount: 97, workflowId: "ltxSulphur" },
  });
  assert.equal(integrated.plan.adapter, "ltx-2-3-sulphur-video");
  assert.equal(integrated.plan.adapterName, "LTX 2.3 Sulphur Video Adapter");
  assert.ok(integrated.plan.supported.includes("source-frame-placement-lock"));
  assert.ok(integrated.plan.supported.includes("prompt-guided-light-continuity"));
  assert.ok(!integrated.plan.fallbacks.some((item) => item.includes("adapter dedicato")));
  assert.ok(!integrated.plan.fallbacks.some((item) => item.includes("Posizionamento automatico")));
  assert.ok(!integrated.plan.fallbacks.some((item) => item.includes("Relighting fisico")));
  assert.match(integrated.workflow["30"].inputs.text, /source key-light direction/);
  assert.match(integrated.workflow["30"].inputs.text, /composition/);
});

test("evaluator produce categorie separate e correction pass soltanto per quelle insufficienti", () => {
  const source = profile();
  const result = structuredClone(source);
  result.colorProfile.temperature.value = 9500;
  result.cameraProfile.apparentSharpness.value = 0.1;
  result.textureProfile.grainAmount.value = 0.8;
  const evaluation = evaluateSceneCoherence(source, result, {
    backgroundPreservation: { score: 96, confidence: 0.9 },
    edgeCompositingQuality: { score: 90, confidence: 0.8 },
  });
  assert.equal(Object.keys(evaluation.categories).length, 16);
  assert.ok(evaluation.categories.colorCoherence.score < 75);
  assert.equal(evaluation.categories.backgroundPreservation.score, 96);
  const correction = buildCorrectionPlan(evaluation, { iteration: 0, maxIterations: 2 });
  const ids = correction.actions.map((item) => item.id);
  assert.ok(ids.includes("local-color-transfer"));
  assert.ok(ids.includes("blur-match"));
  assert.ok(ids.includes("grain-match"));
  assert.ok(!ids.includes("mask-recomposite"));
  const imagePlan = {
    mediaType: "image",
    controls: {
      matchColor: true,
      matchBlur: true,
      grainMode: "match",
      preserveBackground: false,
      temporalConsistency: false,
      occlusionHandling: false,
      contactShadows: false,
    },
    finishing: { blurSigma: 0.4 },
    appliedParameters: {},
    reasons: [],
  };
  const correctedImagePlan = applyCorrectionsToIntegrationPlan(imagePlan, correction);
  assert.equal(correctedImagePlan.controls.matchBlur, false);
  assert.ok(!correctedImagePlan.appliedParameters.selectedCorrections.includes("blur-match"));
  assert.equal(buildCorrectionPlan(evaluation, { iteration: 2, maxIterations: 2 }).stopped, true);
});
