import crypto from "node:crypto";

const INSERT_ACTIONS = new Set(["addPerson", "addAnimal", "addObject"]);
const LOCAL_ACTIONS = new Set([
  ...INSERT_ACTIONS,
  "replace",
  "remove",
  "modify",
]);

function text(value) {
  return String(value || "").trim();
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedBox(value) {
  const box = object(value);
  const values = [box.x, box.y, box.width, box.height].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    width: Math.max(0.001, Math.min(1, width)),
    height: Math.max(0.001, Math.min(1, height)),
    role: "placement-geometry",
    isMask: false,
  };
}

export function normalizeSubjectInsertionRequest(raw = {}) {
  const operation = text(raw.operation || raw.editAction || "modify");
  const placement = object(raw.placement);
  const identity = object(raw.identity);
  const source = object(raw.source);
  const references = Array.isArray(raw.references) ? raw.references : [];
  return {
    version: "1.0.0",
    requestId: text(raw.requestId) || crypto.randomUUID(),
    mediaType: raw.mediaType === "video" ? "video" : "image",
    frameIndex: Number.isInteger(raw.frameIndex) ? raw.frameIndex : null,
    source: {
      file: text(source.file || raw.sourceFile),
      previousFrame: text(source.previousFrame || raw.previousFrame),
      sceneProfileId: text(source.sceneProfileId || raw.sceneProfileId),
    },
    operation,
    insertion: INSERT_ACTIONS.has(operation),
    localEdit: LOCAL_ACTIONS.has(operation),
    subjectType: operation === "addPerson" ? "person"
      : operation === "addAnimal" ? "animal"
        : operation === "addObject" ? "object"
          : text(raw.subjectType) || "existing-subject",
    identity: {
      subjectId: text(identity.subjectId || raw.subjectId),
      subjectName: text(identity.subjectName || raw.subjectName),
      characterId: text(identity.characterId || raw.characterId),
      source: references.length ? "references" : "description",
    },
    references: references.map((item, index) => ({
      id: text(item?.id) || `reference-${index + 1}`,
      file: text(item?.file || item?.name),
      role: ["identity", "appearance", "pose", "style"].includes(item?.role)
        ? item.role
        : index === 0 ? "identity" : index === 1 ? "pose" : "style",
    })).filter((item) => item.file),
    placement: {
      box: normalizedBox(placement.box || raw.placementBox || raw.placement),
      text: text(placement.text || raw.spatialInstruction),
      depthRelation: text(placement.depthRelation || raw.depthRelation),
      method: text(placement.method || raw.placementMethod) || "combined",
    },
    masks: {
      edit: text(raw.editMask || raw.maskFile),
      subject: text(raw.subjectMask),
      occlusion: text(raw.occlusionMask),
    },
    instructions: {
      prompt: text(raw.prompt),
      interaction: text(raw.interaction || raw.subjectInteraction),
      contact: text(raw.contact || raw.contactInstruction),
      preserve: text(raw.preserve || raw.preserveInstruction),
    },
    model: {
      family: text(raw.modelFamily || raw.guidedModelFamily || "qwen").toLowerCase(),
      id: text(raw.modelId),
      file: text(raw.modelFile),
    },
    sceneProfile: object(raw.sceneProfile),
    options: {
      debugArtifacts: Boolean(raw.debugArtifacts),
      allowFinishing: raw.allowFinishing !== false,
      identityRefine: raw.identityRefine !== false,
      detailRefine: raw.detailRefine !== false,
    },
  };
}

export function assertSubjectInsertionRequest(raw) {
  const value = normalizeSubjectInsertionRequest(raw);
  if (!value.source.file) throw new Error("Subject Insertion richiede una sorgente immagine o frame.");
  if (!value.instructions.prompt) throw new Error("Subject Insertion richiede una descrizione del risultato.");
  if (value.insertion && !value.placement.box && !value.placement.text) {
    throw new Error("Indica la posizione con un riquadro, un punto o una descrizione spaziale.");
  }
  if (value.operation === "addPerson" && !value.references.length && !value.identity.characterId) {
    value.identity.source = "description";
  }
  return value;
}

export function subjectInsertionResult(plan, output = {}) {
  return {
    version: "1.0.0",
    requestId: plan.requestId,
    source: plan.source,
    final: output.final || null,
    references: plan.references,
    model: plan.model,
    strategy: plan.strategy,
    placement: plan.placement,
    masks: plan.masks,
    scene: plan.scene,
    identity: plan.identity,
    corrections: output.corrections || [],
    fallbacks: plan.fallbacks,
    preservation: output.preservation || null,
    debugArtifacts: output.debugArtifacts || {},
  };
}
