import assert from "node:assert/strict";
import test from "node:test";
import {
  createCharacterMasterPipeline,
  finishCharacterMasterPipeline,
  identityProtectionContract,
  nextMasterPipelineStage,
  seedVr2PresetForQuality,
  updateMasterPipelineStage,
} from "../src/character-master-pipeline.js";

const capabilities = { scene: true, krea: true, klein: true, seedvr2: true };

test("i preset Veloce, Bilanciata e Massima richiedono gli stage previsti", () => {
  const statuses = (preset) => Object.fromEntries(createCharacterMasterPipeline({ preset, capabilities }).stages.map((stage) => [stage.id, stage.status]));
  assert.deepEqual(statuses("fast"), { scene: "requested", krea: "skipped", klein: "skipped", seedvr2: "skipped" });
  assert.deepEqual(statuses("balanced"), { scene: "requested", krea: "requested", klein: "skipped", seedvr2: "requested" });
  assert.deepEqual(statuses("max"), { scene: "requested", krea: "requested", klein: "requested", seedvr2: "requested" });
});

test("Advanced può sovrascrivere gli stage e una capability assente viene saltata esplicitamente", () => {
  const pipeline = createCharacterMasterPipeline({
    preset: "fast",
    advancedStages: { klein: true, seedvr2: true },
    capabilities: { ...capabilities, klein: false },
  });
  assert.equal(pipeline.stages.find((stage) => stage.id === "klein").status, "skipped");
  assert.match(pipeline.stages.find((stage) => stage.id === "klein").reason, /non disponibile/);
  assert.equal(pipeline.stages.find((stage) => stage.id === "seedvr2").status, "requested");
});

test("il fallimento isolato conserva l'ultimo output valido e prosegue allo stage successivo", () => {
  let pipeline = createCharacterMasterPipeline({ preset: "balanced", capabilities });
  pipeline = updateMasterPipelineStage(pipeline, "scene", { status: "completed", generationId: "scene-1", output: [{ filename: "scene.png" }] });
  pipeline = { ...pipeline, lastValidGenerationId: "scene-1" };
  pipeline = updateMasterPipelineStage(pipeline, "krea", { status: "failed", error: "Krea error" });
  assert.equal(pipeline.lastValidGenerationId, "scene-1");
  assert.equal(nextMasterPipelineStage(pipeline).id, "seedvr2");
  const finished = finishCharacterMasterPipeline(pipeline, { masterGenerationId: "scene-1" });
  assert.equal(finished.status, "completed_with_warnings");
  assert.equal(finished.masterGenerationId, "scene-1");
});

test("la protezione identità è specifica per umani, animali e altri soggetti", () => {
  assert.match(identityProtectionContract("human"), /face geometry.*hair.*age.*body proportions/i);
  assert.match(identityProtectionContract("animal"), /morphology.*coat or feathers.*markings.*colors.*proportions/i);
  assert.match(identityProtectionContract("other", { identity: { appearance: "red robot", distinctiveFeatures: ["one blue eye"] } }), /red robot.*one blue eye/i);
});

test("SeedVR2 usa sempre profili 3B configurati per velocità o qualità", () => {
  assert.equal(seedVr2PresetForQuality("balanced"), "speed");
  assert.equal(seedVr2PresetForQuality("max"), "quality");
});
