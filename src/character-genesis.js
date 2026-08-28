const SUBJECT_KINDS = new Set(["auto", "human", "animal", "other"]);

function text(value, max = 1200) {
  return String(value || "").trim().slice(0, max);
}

function list(value, maxItems = 16) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/\r?\n|,/);
  return items.map((item) => text(item, 240)).filter(Boolean).slice(0, maxItems);
}

export function normalizeSubjectKind(value, fallback = "auto") {
  const kind = text(value, 20).toLowerCase();
  return SUBJECT_KINDS.has(kind) ? kind : fallback;
}

export function normalizeCharacterBlueprint(raw = {}, { sourceDescription = "" } = {}) {
  const identity = raw.identity && typeof raw.identity === "object" ? raw.identity : {};
  const distinctiveFeatures = list(
    identity.distinctiveFeatures ?? raw.distinctiveFeatures,
  );
  const colors = list(identity.colors ?? raw.colors);
  return {
    version: 1,
    subjectKind: normalizeSubjectKind(raw.subjectKind),
    identity: {
      appearance: text(identity.appearance ?? raw.appearance),
      head: text(identity.head ?? raw.head),
      body: text(identity.body ?? raw.body),
      hairOrCoat: text(identity.hairOrCoat ?? raw.hairOrCoat),
      distinctiveFeatures,
      colors,
      proportions: text(identity.proportions ?? raw.proportions),
    },
    sourceDescription: text(raw.sourceDescription || sourceDescription, 4000),
  };
}

export function blueprintIdentityHints(blueprint = {}) {
  const normalized = normalizeCharacterBlueprint(blueprint);
  const identity = normalized.identity;
  return {
    face: identity.head,
    hair: identity.hairOrCoat,
    body: [identity.body, identity.proportions].filter(Boolean).join("; "),
  };
}

export function blueprintDescription(blueprint = {}) {
  const normalized = normalizeCharacterBlueprint(blueprint);
  const identity = normalized.identity;
  return [
    identity.appearance,
    identity.distinctiveFeatures.length
      ? `Distinctive features: ${identity.distinctiveFeatures.join(", ")}`
      : "",
    identity.colors.length ? `Colors: ${identity.colors.join(", ")}` : "",
  ].filter(Boolean).join(". ");
}

export function normalizeGenesis(raw = {}, fallback = {}) {
  const sourceType = raw.sourceType === "photo" ? "photo" : "description";
  const seedValue = Number(raw.seed ?? fallback.seed);
  return {
    sourceType,
    sourceDescription: text(raw.sourceDescription ?? fallback.sourceDescription, 4000),
    generator: text(raw.generator ?? fallback.generator, 120),
    model: text(raw.model ?? fallback.model, 300),
    seed: Number.isSafeInteger(seedValue) && seedValue >= 0 ? seedValue : null,
    technicalPrompt: text(raw.technicalPrompt ?? fallback.technicalPrompt, 8000),
    technicalNegativePrompt: text(raw.technicalNegativePrompt ?? fallback.technicalNegativePrompt, 4000),
    promptModel: text(raw.promptModel ?? fallback.promptModel, 300),
    createdAt: text(raw.createdAt, 80) || new Date().toISOString(),
    candidateGenerationIds: list(raw.candidateGenerationIds, 12),
    selectedGenerationId: text(raw.selectedGenerationId, 100) || null,
  };
}
