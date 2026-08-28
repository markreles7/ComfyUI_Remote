import { normalizeSubjectKind } from "./character-genesis.js";

const FIELD_LIMITS = Object.freeze({
  location: 240,
  action: 240,
  camera: 180,
  framing: 120,
  lighting: 180,
  time: 120,
  mood: 160,
  outfit: 240,
  subjectInteraction: 240,
  userIntent: 1000,
});

const SURPRISE_PRESETS = Object.freeze([
  { location: "a quiet cobblestone street", action: "walking naturally", time: "blue hour", mood: "cinematic yet candid", lighting: "soft storefront and ambient evening light", camera: "natural eye-level camera", framing: "full body" },
  { location: "a bright contemporary home", action: "relaxing near a window", time: "late morning", mood: "natural and intimate", lighting: "soft window light", camera: "documentary eye-level camera", framing: "three-quarter body" },
  { location: "a calm beach", action: "walking along the shoreline", time: "sunset", mood: "serene and warm", lighting: "soft golden-hour light", camera: "natural eye-level camera", framing: "full body" },
  { location: "a green woodland path", action: "pausing and looking toward the camera", time: "morning", mood: "fresh and spontaneous", lighting: "diffused light through foliage", camera: "natural eye-level camera", framing: "three-quarter body" },
  { location: "an elegant lounge", action: "sitting comfortably", time: "evening", mood: "refined and relaxed", lighting: "warm practical light", camera: "slightly off-axis natural camera", framing: "medium shot" },
]);

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function field(raw, key, fallback = "") {
  return clean(raw?.[key] || fallback, FIELD_LIMITS[key]);
}

export function surpriseSceneSeed({ random = Math.random, subjectKind = "human" } = {}) {
  const index = Math.min(SURPRISE_PRESETS.length - 1, Math.max(0, Math.floor(random() * SURPRISE_PRESETS.length)));
  const preset = { ...SURPRISE_PRESETS[index] };
  if (normalizeSubjectKind(subjectKind) !== "human") preset.outfit = "preserve the subject's original appearance";
  return preset;
}

export function normalizeSceneBlueprint(raw = {}, {
  userIntent = "",
  subjectKind = "human",
  outfitMode = "keep",
} = {}) {
  const kind = normalizeSubjectKind(subjectKind);
  const defaultOutfit = kind === "human"
    ? outfitMode === "change" ? "a context-appropriate outfit may change"
      : outfitMode === "choose" ? "use the outfit requested by the user" : "preserve the original appearance and outfit"
    : "preserve the subject's identity-bearing appearance, covering and accessories";
  const blueprint = {
    location: field(raw, "location", "a context-appropriate real location"),
    action: field(raw, "action", "a natural context-appropriate action"),
    camera: field(raw, "camera", "natural eye-level camera"),
    framing: field(raw, "framing", "three-quarter body"),
    lighting: field(raw, "lighting", "natural coherent light"),
    time: field(raw, "time", "daytime"),
    mood: field(raw, "mood", "natural"),
    outfit: field(raw, "outfit", defaultOutfit),
    subjectInteraction: field(raw, "subjectInteraction", "natural interaction with the setting"),
    userIntent: field(raw, "userIntent", userIntent || "Create a new natural photograph of this character."),
  };
  return blueprint;
}

export function sceneBlueprintSummary(blueprint, characterName = "Il Character") {
  const name = clean(characterName, 100) || "Il Character";
  return `${name}: ${blueprint.action} in ${blueprint.location}, ${blueprint.time}, con atmosfera ${blueprint.mood}.`;
}

function sceneTokens(blueprint) {
  return Object.values(blueprint || {}).join(" ").toLowerCase();
}

function referenceEvaluation(character, referenceId) {
  return (character.identityEvaluation?.evaluations || []).find((item) => item.referenceId === referenceId);
}

function roleScore(reference, tokens, subjectKind) {
  const role = String(reference.referenceRole || "").toLowerCase();
  const type = String(reference.type || "").toLowerCase();
  let score = 0;
  const close = /close|close-up|portrait|selfie|head|viso|primo piano/.test(tokens);
  const profile = /profile|profilo|side view|lateral/.test(tokens);
  const walking = /walk|walking|cammina|passegg/.test(tokens);
  const sitting = /sit|sitting|sedut/.test(tokens);
  const fullBody = /full body|figura intera|walking|cammina|standing|in piedi/.test(tokens);
  const threeQuarter = /three-quarter|3\/4|tre quarti/.test(tokens);
  if (close && (/head_front|head_3q|expression_/.test(role) || type === "face")) score += 95;
  if (profile && (/profile|side_/.test(role) || type === "profile")) score += 120;
  if (threeQuarter && /3q|three_quarter/.test(role)) score += 105;
  if (walking && role === "walking") score += 135;
  if (sitting && role === "sitting") score += 135;
  if (walking && (/full_body|walking|standing/.test(role) || type === "full_body" && role !== "sitting")) score += 90;
  if (sitting && (/full_body|sitting/.test(role) || type === "full_body" && role !== "walking")) score += 90;
  if (fullBody && !walking && !sitting && (/full_body|walking|standing|sitting/.test(role) || type === "full_body")) score += 90;
  if (subjectKind === "animal" && sitting && /full_body_side|head_3q/.test(role)) score += 55;
  if (!score && /head_3q|three_quarter/.test(role)) score += 35;
  if (!score && /head_front|front_view|full_body_front/.test(role)) score += 25;
  return score;
}

export function selectCharacterPhotoReferences(character, blueprint, { maxReferences = 3 } = {}) {
  const references = Array.isArray(character?.references) ? character.references : [];
  const hero = references.find((reference) => reference.id === character.heroImage)
    || references.find((reference) => reference.type === "hero");
  if (!hero || ["rejected", "failed", "error"].includes(hero.status) || !hero.assetAvailable) {
    throw new Error("Il Character deve avere una Hero valida per creare una foto.");
  }
  const tokens = sceneTokens(blueprint);
  const kind = normalizeSubjectKind(character.referencePlan?.subjectKind || character.subjectKind);
  const candidates = references
    .filter((reference) => reference.id !== hero.id && !["rejected", "failed", "error"].includes(reference.status) && reference.assetAvailable)
    .filter((reference) => reference.manualReview?.status !== "REJECTED")
    .filter((reference) => referenceEvaluation(character, reference.id)?.status !== "FAIL")
    .map((reference) => {
      const evaluation = referenceEvaluation(character, reference.id);
      const relevance = roleScore(reference, tokens, kind);
      const identityBonus = reference.manualReview?.status === "APPROVED" ? 30
        : evaluation?.status === "PASS" ? 24 : evaluation?.status === "WARNING" ? -10 : 0;
      return { reference, relevance, score: relevance + identityBonus, evaluation };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.score - a.score || String(a.reference.id).localeCompare(String(b.reference.id)));
  const selected = [hero, ...candidates.slice(0, Math.max(0, Math.min(4, Number(maxReferences) || 3) - 1)).map((item) => item.reference)];
  return {
    references: selected,
    selectedReferenceIds: selected.map((reference) => reference.id),
    referenceSelectionReason: selected.map((reference) => {
      if (reference.id === hero.id) return { referenceId: reference.id, reason: "Hero identitaria primaria" };
      const scored = candidates.find((item) => item.reference.id === reference.id);
      return {
        referenceId: reference.id,
        reason: `${reference.referenceRole || reference.type || "reference"} pertinente alla scena${scored?.evaluation?.status ? ` · identity ${scored.evaluation.status}` : ""}`,
      };
    }),
  };
}

export function characterPhotoEngineCatalog(imageModels = []) {
  const qwen = imageModels.find((item) =>
    item.id === "qwenEdit"
    && item.available
    && item.primaryAvailable !== false
    && item.modes?.includes("image")
  );
  const flux2 = imageModels.find((item) => item.id === "flux2" && item.available && item.modes?.includes("image"));
  const pornMasterTurbo = flux2?.models?.find((model) => /pornmaster.*flux2.*klein.*v4.*turbo/i.test(String(model.file || "")))
    || flux2?.models?.find((model) => /pornmaster.*v4.*turbo/i.test(String(model.file || "")));
  const pornMasterBaseBf16 = flux2?.models?.find((model) => /pornmaster.*flux2.*klein.*v4.*base.*bf16/i.test(String(model.file || "")))
    || flux2?.models?.find((model) => /pornmaster.*v4.*base.*bf16/i.test(String(model.file || "")));
  return [
    qwen ? {
      ...qwen,
      engineId: "qwen2511",
      name: "Qwen Image Edit 2511",
      maxReferences: 3,
      promptTarget: "qwenedit",
    } : null,
    flux2 && pornMasterTurbo ? {
      ...flux2,
      engineId: "pornmaster-v4-turbo",
      name: "PornMaster Flux2 Klein v4Turbo",
      modelFile: pornMasterTurbo.file,
      defaults: pornMasterTurbo.defaults || { steps: 4, guidance: 1 },
      maxReferences: 4,
      promptTarget: "flux2_klein_architect",
    } : null,
    flux2 && pornMasterBaseBf16 ? {
      ...flux2,
      engineId: "pornmaster-v4-base-bf16",
      name: "PornMaster Flux2 Klein v4 Base BF16",
      modelFile: pornMasterBaseBf16.file,
      defaults: pornMasterBaseBf16.defaults || { steps: 12, guidance: 2 },
      samplingProfile: "base-bf16-quality-12",
      maxReferences: 4,
      promptTarget: "flux2_klein_architect",
    } : null,
  ].filter(Boolean);
}

export function routeCharacterPhotoWorkflow(imageModels = [], preferredEngine = "auto") {
  const dedicated = characterPhotoEngineCatalog(imageModels);
  if (preferredEngine && preferredEngine !== "auto") {
    return dedicated.find((item) => item.engineId === preferredEngine) || null;
  }
  if (dedicated.length) return dedicated[0];
  const limits = {
    qwenEdit: { maxReferences: 3, promptTarget: "qwenedit" },
    flux2: { maxReferences: 4, promptTarget: "flux2_klein_architect" },
    mageFlowEdit: { maxReferences: 3, promptTarget: "studio" },
  };
  for (const id of ["qwenEdit", "flux2", "mageFlowEdit"]) {
    const model = imageModels.find((item) =>
      item.id === id
      && item.available
      && (item.id !== "qwenEdit" || item.primaryAvailable !== false)
      && item.modes?.includes("image")
    );
    if (model) return { ...model, ...limits[id], engineId: id };
  }
  return null;
}

export function characterPhotoGenerationMetadata({
  character,
  sceneBlueprint,
  selection,
  workflow,
  technicalPrompt,
  technicalNegativePrompt = "",
  seed,
} = {}) {
  return {
    generationType: "characterPhoto",
    generationPurpose: "character_photo",
    characterId: character.id,
    characterName: character.name,
    sceneBlueprint,
    selectedReferenceIds: [...selection.selectedReferenceIds],
    referenceSelectionReason: selection.referenceSelectionReason.map((item) => ({ ...item })),
    technicalPrompt,
    technicalNegativePrompt,
    model: workflow.modelFile,
    seed,
    output: [],
  };
}
