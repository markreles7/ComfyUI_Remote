import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCharacterReferenceJob,
  characterReferenceGenerationMetadata,
  missingReferenceItems,
  normalizeReferencePlan,
  patchReferencePlanItem,
  referenceRoleCatalog,
  selectReferenceWorkflow,
} from "../src/character-reference-factory.js";

function proposed(kind) {
  return referenceRoleCatalog(kind).slice(0, 6).map((item) => ({
    ...item,
    technicalPrompt: `Edit only the view for ${item.referenceRole} while preserving identity.`,
    technicalNegativePrompt: "identity drift, extra subjects, text, watermark",
  }));
}

test("il catalogo è adattivo per human, animal e other senza ruoli arbitrari", () => {
  const human = referenceRoleCatalog("human").map((item) => item.referenceRole);
  const animal = referenceRoleCatalog("animal").map((item) => item.referenceRole);
  const other = referenceRoleCatalog("other").map((item) => item.referenceRole);
  assert.ok(human.includes("expression_smile"));
  assert.ok(animal.includes("characteristic_pose"));
  assert.ok(!animal.includes("expression_smile"));
  assert.ok(other.includes("detail_primary"));
  assert.ok(!other.includes("head_front"));

  const plan = normalizeReferencePlan({
    items: [{ referenceRole: "invented_arbitrary_role", technicalPrompt: "bad" }, ...proposed("animal")],
    heroReferenceId: "hero-123",
  }, { subjectKind: "animal", workflow: { id: "qwenEdit", name: "Qwen Image Edit 2511" } });
  assert.equal(plan.items.some((item) => item.referenceRole === "invented_arbitrary_role"), false);
  assert.equal(plan.subjectKind, "animal");
  assert.ok(plan.items.every((item) => ["face", "profile", "full_body", "generic"].includes(item.type)));
});

test("Genera mancanti esclude approvate e candidate ancora valide", () => {
  let plan = normalizeReferencePlan({ items: proposed("human") }, { subjectKind: "human" });
  plan = patchReferencePlanItem(plan, "head_front", {
    status: "approved",
    approvedReferenceId: "approved-1",
  });
  plan = patchReferencePlanItem(plan, "head_3q_left", {
    status: "ready",
    candidateGenerationId: "generation-ready",
  });
  plan = patchReferencePlanItem(plan, "head_3q_right", {
    status: "error",
    candidateGenerationId: "generation-error",
  });
  const generations = new Map([
    ["generation-ready", { id: "generation-ready", status: "completed" }],
    ["generation-error", { id: "generation-error", status: "error" }],
  ]);
  const missing = missingReferenceItems(plan, generations).map((item) => item.referenceRole);
  assert.ok(!missing.includes("head_front"));
  assert.ok(!missing.includes("head_3q_left"));
  assert.ok(missing.includes("head_3q_right"));
  assert.ok(missing.includes("profile_left"));
});

test("rigenerazione conserva la reference approvata finché non viene sostituita", () => {
  let plan = normalizeReferencePlan({ items: proposed("animal") }, { subjectKind: "animal" });
  plan = patchReferencePlanItem(plan, "head_front", {
    status: "approved",
    approvedReferenceId: "reference-old",
  });
  plan = patchReferencePlanItem(plan, "head_front", {
    status: "regenerating",
    candidateGenerationId: "generation-new",
    candidateGenerationIds: ["generation-new"],
  });
  const item = plan.items.find((entry) => entry.referenceRole === "head_front");
  assert.equal(item.approvedReferenceId, "reference-old");
  assert.equal(item.candidateGenerationId, "generation-new");
  assert.equal(item.status, "regenerating");
});

test("Qwen Image Edit 2511 ha priorità soltanto quando disponibile", () => {
  const models = [
    { id: "flux2", available: true, modes: ["image"] },
    { id: "qwenEdit", available: true, modes: ["image"] },
  ];
  assert.equal(selectReferenceWorkflow(models).id, "qwenEdit");
  assert.equal(selectReferenceWorkflow(models.map((item) => item.id === "qwenEdit" ? { ...item, available: false } : item)).id, "flux2");
  assert.equal(selectReferenceWorkflow(models.map((item) => item.id === "qwenEdit" ? { ...item, primaryAvailable: false } : item)).id, "flux2");
  assert.equal(selectReferenceWorkflow([]), null);
});

test("History metadata contiene tutti i campi Character Reference richiesti", () => {
  const metadata = characterReferenceGenerationMetadata({
    character: { id: "character-1", name: "Milo", heroImage: "hero-1", subjectKind: "animal" },
    item: {
      referenceRole: "walking",
      type: "full_body",
      angle: "side",
      pose: "walking",
      expression: "neutral",
      technicalPrompt: "Preserve the same dog and show a side walking view.",
      technicalNegativePrompt: "changed coat, changed markings, extra animals",
    },
    jobMetadata: {
      imageModelFile: "QWEN/qwen_image_edit_2511.safetensors",
      workflowName: "Qwen Image Edit 2511",
    },
    seed: 987,
  });
  assert.deepEqual({
    characterId: metadata.characterId,
    characterName: metadata.characterName,
    generationPurpose: metadata.generationPurpose,
    referenceRole: metadata.referenceRole,
    sourceHero: metadata.sourceHero,
    model: metadata.model,
    workflow: metadata.workflow,
    seed: metadata.seed,
    technicalPrompt: metadata.technicalPrompt,
  }, {
    characterId: "character-1",
    characterName: "Milo",
    generationPurpose: "character_reference",
    referenceRole: "walking",
    sourceHero: "hero-1",
    model: "QWEN/qwen_image_edit_2511.safetensors",
    workflow: "Qwen Image Edit 2511",
    seed: 987,
    technicalPrompt: "Preserve the same dog and show a side walking view.",
  });
});

test("ogni reference costruisce una generazione Qwen Edit indipendente", () => {
  const base = {
    character: { id: "character-1", name: "Milo", heroImage: "hero-1", subjectKind: "animal" },
    item: {
      referenceRole: "walking",
      type: "full_body",
      angle: "side",
      pose: "walking",
      expression: "neutral",
      technicalPrompt: "Preserve the same dog and change only to a side walking view.",
      technicalNegativePrompt: "changed coat, extra animals, collage, text",
    },
    workflow: {
      id: "qwenEdit",
      name: "Qwen Image Edit 2511",
      model: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
      mode: "image",
    },
    source: { name: "hero.png", subfolder: "", type: "input" },
  };
  const first = buildCharacterReferenceJob({ ...base, seed: 101 });
  const second = buildCharacterReferenceJob({ ...base, seed: 202 });
  assert.notEqual(first.workflow, second.workflow);
  assert.equal(first.metadata.seed, 101);
  assert.equal(second.metadata.seed, 202);
  assert.equal(first.metadata.batchSize, 1);
  assert.equal(first.metadata.sourceHero, "hero-1");
  assert.equal(first.metadata.generationPurpose, "character_reference");
  assert.equal(first.metadata.imageSettings.steps, 8);
  assert.equal(first.metadata.imageSettings.guidance, 1);
  assert.equal(first.metadata.characterSamplingProfile, "lightning-8");
  assert.deepEqual(first.metadata.loras, [{
    name: "QWEN\\Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors",
    strength: 1,
  }]);
  const lightningNode = Object.values(first.workflow).find((node) => node.class_type === "LoraLoaderModelOnly");
  assert.equal(lightningNode.inputs.lora_name, first.metadata.loras[0].name);
  assert.equal(first.workflow["8"].inputs.steps, 8);
  assert.equal(first.workflow["8"].inputs.cfg, 1);
  assert.match(first.metadata.workflowId, /qwenEdit:image/);
  assert.doesNotMatch(first.metadata.technicalPrompt, /contact sheet|collage/i);
});

test("il Reference Plan conserva il motore identitario scelto e il relativo sampling", () => {
  const plan = normalizeReferencePlan({ items: proposed("human") }, {
    subjectKind: "human",
    workflow: {
      id: "flux2",
      engineId: "pornmaster-v4-turbo",
      name: "PornMaster Flux2 Klein v4Turbo",
      model: "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors",
      mode: "image",
      steps: 4,
      guidance: 1,
      samplingProfile: "pornmaster-v4-turbo",
    },
  });
  assert.equal(plan.workflow.engineId, "pornmaster-v4-turbo");
  assert.equal(plan.workflow.steps, 4);
  assert.equal(plan.workflow.guidance, 1);
  assert.equal(plan.workflow.samplingProfile, "pornmaster-v4-turbo");

  const job = buildCharacterReferenceJob({
    character: { id: "character-2", name: "Ava", heroImage: "hero-2", subjectKind: "human" },
    item: plan.items[0],
    workflow: plan.workflow,
    source: { name: "hero.png", subfolder: "", type: "input" },
    seed: 303,
  });
  assert.equal(job.metadata.imageSettings.steps, 4);
  assert.equal(job.metadata.imageSettings.guidance, 1);
  assert.equal(job.metadata.characterSamplingProfile, "pornmaster-v4-turbo");
  assert.equal(job.metadata.imageModelFile, plan.workflow.model);
});
