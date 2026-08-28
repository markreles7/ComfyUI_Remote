const BLUEPRINT_FIELDS = [
  "scene",
  "subjectMotion",
  "cameraMotion",
  "framing",
  "environmentMotion",
  "facialPerformance",
  "dialogue",
  "emotion",
];

function text(value, fallback = "", max = 2000) {
  return String(value ?? fallback).trim().slice(0, max);
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function normalizeVideoBlueprint(raw = {}, fallback = {}) {
  const normalized = Object.fromEntries(BLUEPRINT_FIELDS.map((field) => [
    field,
    text(raw[field], fallback[field] || (field === "dialogue" ? "" : "natural")),
  ]));
  const dialogue = normalized.dialogue;
  const requestedAudio = text(raw.audioMode, fallback.audioMode || (dialogue ? "native" : "none"), 40);
  const normalizedAudio = requestedAudio === "external" ? "externalTts" : requestedAudio;
  return {
    ...normalized,
    duration: clampInteger(raw.duration, clampInteger(fallback.duration, 5, 1, 30), 1, 30),
    audioMode: ["none", "native", "externalTts", "existing"].includes(normalizedAudio)
      ? normalizedAudio
      : dialogue ? "native" : "none",
  };
}

export const CHARACTER_VIDEO_ENGINE_DEFINITIONS = Object.freeze({
  ltx23: {
    id: "ltx23",
    name: "LTX 2.3",
    capabilities: {
      imageToVideo: true,
      textToVideo: true,
      dialogue: true,
      nativeAudio: true,
      externalAudio: false,
      supportsNativeAudio: true,
      supportsDialogue: true,
      supportsAudioConditioning: false,
      supportsLipSync: false,
      supportsExternalAudio: false,
      firstLastFrame: true,
      referenceCharacter: false,
      longDuration: false,
      videoToVideo: true,
    },
    workflowPreference: {
      fast: ["standard", "devfp8"],
      balanced: ["standard", "devfp8"],
      max: ["devfp8", "standard"],
    },
  },
  ltx25: {
    id: "ltx25",
    name: "LTX 2.5",
    capabilities: {},
    reason: "Nessun workflow LTX 2.5 è integrato nel repository.",
  },
  minimaxH3: {
    id: "minimaxH3",
    name: "MiniMax H3",
    capabilities: {
      imageToVideo: true,
      textToVideo: false,
      dialogue: true,
      nativeAudio: true,
      externalAudio: false,
      supportsNativeAudio: true,
      supportsDialogue: true,
      supportsAudioConditioning: false,
      supportsLipSync: false,
      supportsExternalAudio: false,
      firstLastFrame: false,
      referenceCharacter: true,
      longDuration: false,
      videoToVideo: false,
    },
    workflowPreference: {
      fast: ["minimaxH3"],
      balanced: ["minimaxH3"],
      max: ["minimaxH3"],
    },
  },
});

export function createCharacterVideoRouter({ workflowAvailability = {}, videoModels = [], audioCapabilities = {} } = {}) {
  const normalModel = videoModels.find((model) => model.id === "normal");
  const ltx = CHARACTER_VIDEO_ENGINE_DEFINITIONS.ltx23;
  const workflows = Object.keys(workflowAvailability).filter((id) =>
    ["standard", "devfp8"].includes(id) && workflowAvailability[id] === true);
  const modelAvailable = Boolean(normalModel?.available);
  const available = modelAvailable && workflows.length > 0;
  const engines = [{
    ...ltx,
    capabilities: {
      ...ltx.capabilities,
      supportsLipSync: Boolean(audioCapabilities.lipSync),
      supportsExternalAudio: Boolean(audioCapabilities.lipSync),
      externalAudio: Boolean(audioCapabilities.lipSync),
      externalTts: Boolean(audioCapabilities.voiceTts && audioCapabilities.lipSync),
      existingAudio: Boolean(audioCapabilities.lipSync),
    },
    available,
    workflows,
    model: normalModel?.file || null,
    reason: available ? null : !modelAvailable
      ? "Il modello LTX 2.3 configurato non risulta installato."
      : "I workflow LTX 2.3 non sono compatibili con i nodi ComfyUI rilevati.",
  }];
  const minimax = CHARACTER_VIDEO_ENGINE_DEFINITIONS.minimaxH3;
  const minimaxAvailable = workflowAvailability.minimaxH3 === true;
  engines.push({
    ...minimax,
    available: minimaxAvailable,
    workflows: minimaxAvailable ? ["minimaxH3"] : [],
    model: minimaxAvailable
      ? "minimaxH3INT8INT4_ref2vaINT8Pruned.safetensors + minimaxH3INT8INT4_fl2vaINT8Pruned.safetensors"
      : null,
    reason: minimaxAvailable ? null : "Il workflow MiniMax H3 non è compatibile con i nodi o i modelli ComfyUI rilevati.",
  });
  const preparedUnavailable = [CHARACTER_VIDEO_ENGINE_DEFINITIONS.ltx25]
    .map((engine) => ({ ...engine, available: false, workflows: [] }));
  return { engines, preparedUnavailable };
}

export function routeCharacterVideo({ router, requestedEngine = "auto", quality = "balanced", requirements = {} } = {}) {
  const requested = String(requestedEngine || "auto");
  const available = (router?.engines || []).filter((engine) => engine.available);
  const candidates = requested === "auto"
    ? available
    : available.filter((engine) => engine.id === requested);
  if (!candidates.length) {
    const known = [...(router?.engines || []), ...(router?.preparedUnavailable || [])]
      .find((engine) => engine.id === requested);
    throw new Error(known?.reason || "Nessun Video Engine realmente disponibile soddisfa la richiesta.");
  }
  const required = Object.entries(requirements).filter(([, enabled]) => enabled).map(([name]) => name);
  const engine = candidates.find((candidate) => required.every((capability) => candidate.capabilities?.[capability] === true));
  if (!engine) throw new Error(`Nessun Video Engine disponibile supporta: ${required.join(", ")}.`);
  const preset = ["fast", "balanced", "max"].includes(quality) ? quality : "balanced";
  const workflowId = engine.workflowPreference[preset].find((id) => engine.workflows.includes(id));
  if (!workflowId) throw new Error(`${engine.name} non ha un workflow disponibile per il preset richiesto.`);
  return { engine, workflowId, quality: preset };
}

export function videoRequirements({ sourceMode = "anchor", dialogue = "", audioMode = "none" } = {}) {
  const speaks = Boolean(text(dialogue));
  return {
    imageToVideo: sourceMode !== "text",
    supportsDialogue: speaks,
    supportsNativeAudio: speaks && audioMode === "native",
    supportsExternalAudio: speaks && ["externalTts", "existing"].includes(audioMode),
    supportsLipSync: speaks && ["externalTts", "existing"].includes(audioMode),
  };
}

export function motionPromptSections(blueprint, identityProtection = "") {
  const value = normalizeVideoBlueprint(blueprint);
  return [
    `Scene: ${value.scene}.`,
    `Subject motion: ${value.subjectMotion}.`,
    `Body motion: physically plausible full-body motion consistent with the subject and action.`,
    `Face: ${value.facialPerformance}; emotion: ${value.emotion}.`,
    `Camera: ${value.cameraMotion}; framing: ${value.framing}.`,
    `Environment motion: ${value.environmentMotion}.`,
    `Secondary motion: natural clothing, hair, coat, foliage, reflections or particles only where present.`,
    `Identity stability: ${identityProtection || "preserve the exact same subject identity throughout every frame"}.`,
    value.dialogue ? `Dialogue: ${value.dialogue}. Audio mode: ${value.audioMode}.` : "No spoken dialogue.",
  ];
}

export function characterVideoHistoryMetadata({
  character,
  videoBlueprint,
  anchorGenerationId = null,
  anchorImage = null,
  route,
  motionPrompt,
  sourceMode,
} = {}) {
  return {
    generationType: "video",
    mediaType: "video",
    generationPurpose: "character_video",
    characterId: character.id,
    characterName: character.name,
    videoBlueprint: normalizeVideoBlueprint(videoBlueprint),
    anchorGenerationId,
    anchorImage,
    videoEngine: route.engine.id,
    workflow: route.workflowId,
    motionPrompt: text(motionPrompt, "", 12_000),
    sourceMode,
    output: [],
  };
}
