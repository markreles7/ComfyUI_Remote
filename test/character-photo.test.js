import assert from "node:assert/strict";
import test from "node:test";
import {
  characterPhotoGenerationMetadata,
  characterPhotoEngineCatalog,
  normalizeSceneBlueprint,
  routeCharacterPhotoWorkflow,
  sceneBlueprintSummary,
  selectCharacterPhotoReferences,
  surpriseSceneSeed,
} from "../src/character-photo.js";

function reference(id, referenceRole, type = "generic", extra = {}) {
  return { id, referenceRole, type, status: "approved", assetAvailable: true, ...extra };
}

function character(subjectKind = "human") {
  return {
    id: "character-1",
    name: "Emma",
    subjectKind,
    heroImage: "hero",
    references: [
      reference("hero", "hero", "hero"),
      reference("front", "head_front", "face"),
      reference("three-quarter", "head_3q_left", "face"),
      reference("profile", "profile_left", "profile"),
      reference("full-body", "full_body_front", "full_body"),
      reference("walking", "walking", "full_body"),
      reference("sitting", "sitting", "full_body"),
    ],
    identityEvaluation: { evaluations: [] },
  };
}

test("Scene Blueprint normalizza tutti i campi e adatta outfit ai non umani", () => {
  const blueprint = normalizeSceneBlueprint({ location: "spiaggia", action: "cammina" }, {
    userIntent: "Al mare di sera",
    subjectKind: "animal",
    outfitMode: "choose",
  });
  assert.deepEqual(Object.keys(blueprint), [
    "location", "action", "camera", "framing", "lighting", "time", "mood", "outfit", "subjectInteraction", "userIntent",
  ]);
  assert.match(blueprint.outfit, /identity-bearing appearance/);
  assert.equal(blueprint.userIntent, "Al mare di sera");
  assert.match(sceneBlueprintSummary(blueprint, "Rex"), /^Rex:/);
});

test("Sorprendimi produce un seed sensato e deterministico nei test", () => {
  const first = surpriseSceneSeed({ random: () => 0, subjectKind: "human" });
  const last = surpriseSceneSeed({ random: () => 0.999, subjectKind: "animal" });
  assert.match(first.location, /street/);
  assert.match(last.outfit, /original appearance/);
});

test("Dynamic Reference Selector sceglie close-up, profilo e walking dal contesto", () => {
  const source = character();
  const close = selectCharacterPhotoReferences(source, normalizeSceneBlueprint({ action: "selfie", framing: "close-up portrait" }), { maxReferences: 3 });
  assert.deepEqual(close.selectedReferenceIds, ["hero", "front", "three-quarter"]);
  const profile = selectCharacterPhotoReferences(source, normalizeSceneBlueprint({ camera: "left profile", framing: "portrait" }), { maxReferences: 3 });
  assert.equal(profile.selectedReferenceIds[1], "profile");
  const walking = selectCharacterPhotoReferences(source, normalizeSceneBlueprint({ action: "walking", framing: "full body" }), { maxReferences: 3 });
  assert.equal(walking.selectedReferenceIds[1], "walking");
  assert.ok(walking.selectedReferenceIds.includes("full-body"));
  const walkingWide = selectCharacterPhotoReferences(source, normalizeSceneBlueprint({ action: "walking", framing: "full body" }), { maxReferences: 4 });
  assert.ok(!walkingWide.selectedReferenceIds.includes("sitting"));
});

test("Animal sitting usa viste pertinenti senza assumere reference umane", () => {
  const animal = character("animal");
  animal.references = [
    reference("hero", "hero", "hero"),
    reference("side", "full_body_side", "full_body"),
    reference("sitting", "sitting", "full_body"),
    reference("head", "head_3q_left", "face"),
  ];
  const selected = selectCharacterPhotoReferences(animal, normalizeSceneBlueprint({ action: "sitting" }, { subjectKind: "animal" }), { maxReferences: 4 });
  assert.deepEqual(new Set(selected.selectedReferenceIds), new Set(["hero", "sitting", "side", "head"]));
  assert.equal(selected.selectedReferenceIds[1], "sitting");
});

test("selector esclude rejected, manual rejected e identity FAIL", () => {
  const source = character();
  source.references.find((item) => item.id === "walking").status = "rejected";
  source.references.find((item) => item.id === "full-body").manualReview = { status: "REJECTED" };
  source.identityEvaluation.evaluations = [{ referenceId: "front", status: "FAIL" }];
  const selected = selectCharacterPhotoReferences(source, normalizeSceneBlueprint({ action: "walking", framing: "close-up" }), { maxReferences: 4 });
  assert.ok(!selected.selectedReferenceIds.includes("walking"));
  assert.ok(!selected.selectedReferenceIds.includes("full-body"));
  assert.ok(!selected.selectedReferenceIds.includes("front"));
});

test("Model Router preferisce Qwen e rispetta i limiti multi-reference reali", () => {
  const available = (id) => ({ id, name: id, modelFile: `${id}.safetensors`, available: true, modes: ["text", "image"] });
  assert.equal(routeCharacterPhotoWorkflow([available("flux2"), available("qwenEdit")]).id, "qwenEdit");
  assert.equal(routeCharacterPhotoWorkflow([available("qwenEdit")]).maxReferences, 3);
  assert.equal(routeCharacterPhotoWorkflow([available("flux2")]).maxReferences, 4);
  assert.equal(routeCharacterPhotoWorkflow([{ ...available("qwenEdit"), available: false }]), null);
  assert.equal(routeCharacterPhotoWorkflow([
    available("flux2"),
    { ...available("qwenEdit"), primaryAvailable: false },
  ]).id, "flux2");
});

test("Character Photo espone Qwen 2511 e le due varianti PornMaster v4 dedicate", () => {
  const models = [
    { id: "qwenEdit", name: "Qwen", modelFile: "QWEN\\qwen_image_edit_2511_bf16.safetensors", available: true, primaryAvailable: true, modes: ["image"], models: [] },
    { id: "flux2", name: "Flux.2", modelFile: "FLUX2\\flux2Klein_9bBase.safetensors", available: true, modes: ["text", "image"], models: [
      { file: "FLUX2\\flux2Klein_9bBase.safetensors", defaults: { steps: 20, guidance: 5 } },
      { file: "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors", defaults: { steps: 4, guidance: 1 } },
      { file: "FLUX2\\pornmasterFlux2Klein_v4BaseBf16.safetensors", defaults: { steps: 12, guidance: 2 } },
    ] },
  ];
  const engines = characterPhotoEngineCatalog(models);
  assert.deepEqual(engines.map((item) => item.engineId), ["qwen2511", "pornmaster-v4-turbo", "pornmaster-v4-base-bf16"]);
  assert.equal(routeCharacterPhotoWorkflow(models, "pornmaster-v4-turbo").modelFile, "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors");
  const base = routeCharacterPhotoWorkflow(models, "pornmaster-v4-base-bf16");
  assert.equal(base.modelFile, "FLUX2\\pornmasterFlux2Klein_v4BaseBf16.safetensors");
  assert.deepEqual(base.defaults, { steps: 12, guidance: 2 });
  assert.equal(base.samplingProfile, "base-bf16-quality-12");
  assert.equal(routeCharacterPhotoWorkflow(models, "missing"), null);
});

test("History metadata conserva tutto il contratto Create Photo", () => {
  const source = character();
  const sceneBlueprint = normalizeSceneBlueprint({ location: "beach", action: "walking" });
  const selection = selectCharacterPhotoReferences(source, sceneBlueprint, { maxReferences: 3 });
  const metadata = characterPhotoGenerationMetadata({
    character: source,
    sceneBlueprint,
    selection,
    workflow: { modelFile: "qwen-image-edit.safetensors" },
    technicalPrompt: "Create a natural beach photograph while preserving identity.",
    technicalNegativePrompt: "identity drift, duplicate subject",
    seed: 123,
  });
  for (const field of ["characterId", "sceneBlueprint", "selectedReferenceIds", "referenceSelectionReason", "technicalPrompt", "model", "seed", "output"]) {
    assert.ok(Object.hasOwn(metadata, field), `campo History mancante: ${field}`);
  }
  assert.deepEqual(metadata.output, []);
  assert.equal(metadata.generationPurpose, "character_photo");
});
