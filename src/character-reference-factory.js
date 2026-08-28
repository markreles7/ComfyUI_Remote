import { normalizeSubjectKind } from "./character-genesis.js";
import { buildImageWorkflow, qwenEdit2511Lightning8Preset } from "./image-workflows.js";

const ROLE_CATALOG = {
  human: [
    ["head_front", "face", "front", "head portrait", "neutral"],
    ["head_3q_left", "face", "three-quarter left", "head portrait", "neutral"],
    ["head_3q_right", "face", "three-quarter right", "head portrait", "neutral"],
    ["profile_left", "profile", "left profile", "head portrait", "neutral"],
    ["profile_right", "profile", "right profile", "head portrait", "neutral"],
    ["full_body_front", "full_body", "front", "standing", "neutral"],
    ["full_body_back", "full_body", "rear", "standing", "neutral"],
    ["full_body_3q", "full_body", "three-quarter", "standing", "neutral"],
    ["walking", "full_body", "three-quarter", "walking", "neutral"],
    ["expression_neutral", "face", "front", "head portrait", "neutral"],
    ["expression_smile", "face", "front", "head portrait", "smile"],
    ["expression_serious", "face", "front", "head portrait", "serious"],
  ],
  animal: [
    ["head_front", "face", "front", "head portrait", "neutral"],
    ["head_3q_left", "face", "three-quarter left", "head portrait", "neutral"],
    ["head_3q_right", "face", "three-quarter right", "head portrait", "neutral"],
    ["profile_left", "profile", "left profile", "head portrait", "neutral"],
    ["profile_right", "profile", "right profile", "head portrait", "neutral"],
    ["full_body_front", "full_body", "front", "standing", "neutral"],
    ["full_body_side", "full_body", "side", "standing", "neutral"],
    ["full_body_rear_3q", "full_body", "rear three-quarter", "standing", "neutral"],
    ["standing", "full_body", "three-quarter", "standing", "neutral"],
    ["sitting", "full_body", "three-quarter", "sitting", "neutral"],
    ["walking", "full_body", "side", "walking", "neutral"],
    ["characteristic_pose", "generic", "best identity view", "characteristic pose", "natural"],
  ],
  other: [
    ["front_view", "generic", "front", "neutral presentation", "not applicable"],
    ["three_quarter_left", "generic", "three-quarter left", "neutral presentation", "not applicable"],
    ["three_quarter_right", "generic", "three-quarter right", "neutral presentation", "not applicable"],
    ["side_left", "profile", "left side", "neutral presentation", "not applicable"],
    ["side_right", "profile", "right side", "neutral presentation", "not applicable"],
    ["rear_view", "generic", "rear", "neutral presentation", "not applicable"],
    ["top_view", "generic", "top", "neutral presentation", "not applicable"],
    ["detail_primary", "generic", "identity detail", "detail view", "not applicable"],
    ["functional_pose", "generic", "best functional view", "characteristic state", "not applicable"],
    ["scale_context", "generic", "three-quarter", "scale context", "not applicable"],
  ],
};

function text(value, max = 8000) {
  return String(value || "").trim().slice(0, max);
}

function safeId(value, max = 100) {
  const id = text(value, max);
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : "";
}

function catalogFor(subjectKind) {
  const kind = normalizeSubjectKind(subjectKind);
  return ROLE_CATALOG[kind === "auto" ? "other" : kind] || ROLE_CATALOG.other;
}

export function referenceRoleCatalog(subjectKind) {
  return catalogFor(subjectKind).map(([referenceRole, type, angle, pose, expression]) => ({
    referenceRole,
    type,
    angle,
    pose,
    expression,
  }));
}

function roleMap(subjectKind) {
  return new Map(referenceRoleCatalog(subjectKind).map((item) => [item.referenceRole, item]));
}

function proposedItems(raw) {
  const value = Array.isArray(raw) ? raw : raw?.items;
  return Array.isArray(value) ? value : [];
}

function normalizeItem(raw, allowed, existing = null) {
  const proposedRole = typeof raw === "string" ? raw : raw?.referenceRole;
  const definition = allowed.get(text(proposedRole, 80).toLowerCase());
  if (!definition) return null;
  const source = typeof raw === "object" && raw ? raw : {};
  const previous = existing && existing.referenceRole === definition.referenceRole ? existing : {};
  const status = ["missing", "queued", "generating", "ready", "approved", "rejected", "error", "regenerating"]
    .includes(source.status || previous.status)
    ? (source.status || previous.status)
    : "missing";
  return {
    ...definition,
    angle: text(source.angle || definition.angle, 160),
    pose: text(source.pose || definition.pose, 240),
    expression: text(source.expression || definition.expression, 160),
    technicalPrompt: text(source.technicalPrompt || previous.technicalPrompt),
    technicalNegativePrompt: text(source.technicalNegativePrompt || previous.technicalNegativePrompt, 4000),
    status,
    approvedReferenceId: safeId(source.approvedReferenceId || previous.approvedReferenceId) || null,
    candidateGenerationId: safeId(source.candidateGenerationId || previous.candidateGenerationId) || null,
    candidateGenerationIds: [...new Set([
      ...(Array.isArray(previous.candidateGenerationIds) ? previous.candidateGenerationIds : []),
      ...(Array.isArray(source.candidateGenerationIds) ? source.candidateGenerationIds : []),
      source.candidateGenerationId,
      previous.candidateGenerationId,
    ].map(safeId).filter(Boolean))].slice(-20),
    rejectedGenerationIds: [...new Set([
      ...(Array.isArray(previous.rejectedGenerationIds) ? previous.rejectedGenerationIds : []),
      ...(Array.isArray(source.rejectedGenerationIds) ? source.rejectedGenerationIds : []),
    ].map(safeId).filter(Boolean))].slice(-20),
    lastSeed: Number.isSafeInteger(Number(source.lastSeed ?? previous.lastSeed))
      ? Number(source.lastSeed ?? previous.lastSeed)
      : null,
    updatedAt: text(source.updatedAt || previous.updatedAt, 80) || new Date().toISOString(),
  };
}

export function normalizeReferencePlan(raw = {}, {
  subjectKind = "auto",
  workflow = {},
  existingPlan = null,
} = {}) {
  const kind = normalizeSubjectKind(subjectKind);
  const allowed = roleMap(kind);
  const existingItems = new Map((existingPlan?.items || []).map((item) => [item.referenceRole, item]));
  const selected = [];
  const seen = new Set();
  for (const item of proposedItems(raw)) {
    const role = text(typeof item === "string" ? item : item?.referenceRole, 80).toLowerCase();
    if (seen.has(role)) continue;
    const normalized = normalizeItem(item, allowed, existingItems.get(role));
    if (!normalized) continue;
    seen.add(role);
    selected.push(normalized);
  }
  const fallback = referenceRoleCatalog(kind);
  if (selected.length < 4) {
    for (const item of fallback) {
      if (seen.has(item.referenceRole)) continue;
      selected.push(normalizeItem(item, allowed, existingItems.get(item.referenceRole)));
      seen.add(item.referenceRole);
      if (selected.length >= Math.min(8, fallback.length)) break;
    }
  }
  return {
    version: 1,
    subjectKind: kind,
    heroReferenceId: safeId(raw.heroReferenceId || existingPlan?.heroReferenceId) || null,
    workflow: {
      id: text(workflow.id || raw.workflow?.id || existingPlan?.workflow?.id, 80),
      engineId: text(workflow.engineId || raw.workflow?.engineId || existingPlan?.workflow?.engineId, 80),
      name: text(workflow.name || raw.workflow?.name || existingPlan?.workflow?.name, 300),
      model: text(workflow.model || raw.workflow?.model || existingPlan?.workflow?.model, 400),
      mode: text(workflow.mode || raw.workflow?.mode || existingPlan?.workflow?.mode, 80),
      steps: Number(workflow.steps ?? raw.workflow?.steps ?? existingPlan?.workflow?.steps) || null,
      guidance: Number(workflow.guidance ?? raw.workflow?.guidance ?? existingPlan?.workflow?.guidance) || null,
      samplingProfile: text(workflow.samplingProfile || raw.workflow?.samplingProfile || existingPlan?.workflow?.samplingProfile, 120),
    },
    items: selected,
    createdAt: text(existingPlan?.createdAt || raw.createdAt, 80) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function missingReferenceItems(plan = {}, generationById = new Map()) {
  return (plan.items || []).filter((item) => {
    if (item.approvedReferenceId) return false;
    const generation = item.candidateGenerationId
      ? generationById.get(item.candidateGenerationId)
      : null;
    return !generation || ["error", "interrupted"].includes(generation.status)
      || item.status === "rejected" || item.status === "error";
  });
}

export function patchReferencePlanItem(plan, referenceRole, patch = {}) {
  const items = (plan?.items || []).map((item) => item.referenceRole === referenceRole
    ? { ...item, ...patch, updatedAt: new Date().toISOString() }
    : item);
  if (!items.some((item) => item.referenceRole === referenceRole)) {
    throw new Error("Ruolo reference non presente nel piano adattivo.");
  }
  return { ...plan, items, updatedAt: new Date().toISOString() };
}

export function selectReferenceWorkflow(imageModels = []) {
  return ["qwenEdit", "flux2", "mageFlowEdit"]
    .map((id) => imageModels.find((item) =>
      item.id === id
      && item.available
      && (item.id !== "qwenEdit" || item.primaryAvailable !== false)
      && item.modes?.includes("image")
    ))
    .find(Boolean) || null;
}

export function characterReferenceGenerationMetadata({ character, item, jobMetadata, seed }) {
  return {
    generationType: "characterReferenceCandidate",
    generationPurpose: "character_reference",
    characterId: character.id,
    characterName: character.name,
    referenceRole: item.referenceRole,
    referenceType: item.type,
    angle: item.angle,
    pose: item.pose,
    expression: item.expression,
    sourceHero: character.heroImage,
    subjectKind: character.subjectKind,
    model: jobMetadata.imageModelFile,
    workflow: jobMetadata.workflowName,
    technicalPrompt: item.technicalPrompt,
    technicalNegativePrompt: item.technicalNegativePrompt || "",
    seed,
  };
}

export function buildCharacterReferenceJob({ character, item, workflow, source, seed }) {
  const acceleration = qwenEdit2511Lightning8Preset(workflow.model);
  const job = buildImageWorkflow(workflow.id, {
    imageMode: "image",
    imageModelFile: workflow.model || "",
    prompt: item.technicalPrompt,
    negativePrompt: item.technicalNegativePrompt || "",
    imageResolution: "custom",
    imageWidth: 1024,
    imageHeight: 1024,
    imageSteps: acceleration?.steps || workflow.steps,
    imageGuidance: acceleration?.guidance ?? workflow.guidance,
    denoise: 0.55,
    referenceStrength: 1,
    batchSize: 1,
    outputBase: `Characters/${character.id}/references/${item.referenceRole}`,
    saveOriginal: false,
    upscaleMode: "none",
  }, source, acceleration?.loras || []);
  job.metadata = {
    ...job.metadata,
    ...characterReferenceGenerationMetadata({ character, item, jobMetadata: job.metadata, seed }),
    characterSamplingProfile: acceleration?.samplingProfile || workflow.samplingProfile || "model-native",
  };
  return job;
}
