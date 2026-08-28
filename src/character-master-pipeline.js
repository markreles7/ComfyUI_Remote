export const MASTER_PIPELINE_STATUSES = Object.freeze(["requested", "running", "completed", "failed", "skipped"]);

export const MASTER_QUALITY_PRESETS = Object.freeze({
  fast: {
    id: "fast",
    label: "Veloce",
    stages: { scene: true, krea: false, klein: false, seedvr2: false },
  },
  balanced: {
    id: "balanced",
    label: "Bilanciata",
    stages: { scene: true, krea: true, klein: false, seedvr2: true },
  },
  max: {
    id: "max",
    label: "Massima",
    stages: { scene: true, krea: true, klein: true, seedvr2: true },
  },
});

const STAGE_DEFINITIONS = Object.freeze([
  { id: "scene", label: "Scene Draft", capability: "scene", objective: "identity, composition, pose and environment" },
  { id: "krea", label: "Krea Refined", capability: "krea", objective: "conservative photographic realism, materials, light, skin or coat, subject-background integration and microrealism" },
  { id: "klein", label: "Klein Refined", capability: "klein", objective: "conservative microdetail, texture and small artifact correction without reinterpreting the character" },
  { id: "seedvr2", label: "Master", capability: "seedvr2", objective: "SeedVR2 3B restoration, final upscale and final detail" },
]);

function normalizePreset(value) {
  return MASTER_QUALITY_PRESETS[value] || MASTER_QUALITY_PRESETS.balanced;
}

function stageOverride(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

export function createCharacterMasterPipeline({
  preset = "balanced",
  advancedStages = {},
  capabilities = {},
  models = {},
} = {}) {
  const selected = normalizePreset(preset);
  const stages = STAGE_DEFINITIONS.map((definition) => {
    const requested = definition.id === "scene"
      ? true
      : stageOverride(advancedStages[definition.id], selected.stages[definition.id]);
    const available = definition.id === "scene" || capabilities[definition.capability] !== false;
    return {
      ...definition,
      requested,
      status: requested && available ? "requested" : "skipped",
      reason: requested && !available ? `${definition.label} non disponibile nella configurazione reale.`
        : requested ? null : `Disattivato dal preset ${selected.label}.`,
      generationId: null,
      sourceGenerationId: null,
      prompt: null,
      model: models[definition.id] || null,
      output: [],
      error: null,
      startedAt: null,
      finishedAt: null,
    };
  });
  return {
    version: 1,
    preset: selected.id,
    presetLabel: selected.label,
    status: "running",
    stages,
    rootGenerationId: null,
    lastValidGenerationId: null,
    masterGenerationId: null,
    identityValidation: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updateMasterPipelineStage(pipeline, stageId, patch = {}) {
  if (!pipeline?.stages?.some((stage) => stage.id === stageId)) throw new Error(`Stage pipeline sconosciuto: ${stageId}`);
  if (patch.status && !MASTER_PIPELINE_STATUSES.includes(patch.status)) throw new Error(`Stato stage non valido: ${patch.status}`);
  return {
    ...pipeline,
    stages: pipeline.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage),
    updatedAt: new Date().toISOString(),
  };
}

export function nextMasterPipelineStage(pipeline) {
  return pipeline?.stages?.find((stage) => stage.requested && stage.status === "requested") || null;
}

export function finishCharacterMasterPipeline(pipeline, { masterGenerationId, identityValidation = null } = {}) {
  return {
    ...pipeline,
    status: pipeline.stages.some((stage) => stage.status === "failed") ? "completed_with_warnings" : "completed",
    masterGenerationId: masterGenerationId || pipeline.lastValidGenerationId,
    identityValidation,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function identityProtectionContract(subjectKind = "other", blueprint = {}) {
  if (subjectKind === "human") {
    return "Preserve the exact same human identity: face geometry, hair, apparent age and body proportions. Do not beautify into a different person.";
  }
  if (subjectKind === "animal") {
    return "Preserve the exact same animal identity: head morphology, body morphology, coat or feathers, markings, pattern, colors and proportions. Never humanize the animal.";
  }
  const identity = blueprint.identity || {};
  const traits = [identity.appearance, identity.head, identity.body, identity.hairOrCoat, ...(identity.distinctiveFeatures || []), ...(identity.colors || [])]
    .filter(Boolean).join(", ");
  return `Preserve every identity-bearing characteristic of this subject${traits ? `: ${traits}` : " as defined by the Character Blueprint"}. Do not assume human anatomy.`;
}

export function seedVr2PresetForQuality(qualityPreset) {
  return qualityPreset === "balanced" ? "speed" : "quality";
}
