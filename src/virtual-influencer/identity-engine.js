import { CONTENT_LEVELS, validateAdultPrompt, validateContentLevel } from "./schema.js";

const PHOTO_PRESETS = {
  fastPreview: {
    id: "fastPreview",
    name: "Fast Preview",
    referenceLimit: 1,
    validation: "reduced",
    studioPreset: "speed",
    alternatives: 1,
    upscaleMode: "none",
    faceDetailer: false,
    handDetailer: false,
  },
  balanced: {
    id: "balanced",
    name: "Balanced",
    referenceLimit: 3,
    validation: "complete",
    studioPreset: "quality",
    alternatives: 1,
    upscaleMode: "rtx",
    faceDetailer: true,
    handDetailer: true,
  },
  maximumConsistency: {
    id: "maximumConsistency",
    name: "Maximum Consistency",
    referenceLimit: 4,
    validation: "complete",
    studioPreset: "max",
    alternatives: 1,
    upscaleMode: "seedvr2",
    faceDetailer: true,
    handDetailer: true,
  },
};

const PHOTO_ADAPTERS = {
  flux: {
    id: "flux",
    name: "FluxIdentityAdapter",
    studioFamily: "klein",
    modelFamily: "flux2",
    supportedReferences: ["image-reference-as-prompt-conditioning", "canonical-reference-selection"],
    supportedEmbeddings: [],
    supportedLoras: ["model-family-compatible-lora"],
    supportedFaceAdapters: [],
    poseControl: "prompt-and-optional-depth-fallback",
    unavailableControls: ["native-face-embedding", "identity-swap", "temporal-consistency"],
    requiredNodes: ["UNETLoader", "CLIPLoader", "VAELoader", "KSampler", "SaveImage"],
    fallback: "GenericComfyUIIdentityAdapter with identity prompt and metadata validation",
  },
  qwen: {
    id: "qwen",
    name: "QwenIdentityAdapter",
    studioFamily: "qwen2511",
    modelFamily: "qwenEdit",
    supportedReferences: ["source-image", "up-to-four-reference-images"],
    supportedEmbeddings: [],
    supportedLoras: ["qwen-edit-compatible-lora"],
    supportedFaceAdapters: [],
    poseControl: "image-edit-conditioning; structure guide only if installed in Studio",
    unavailableControls: ["native-face-embedding", "unauthorized-face-swap", "temporal-consistency"],
    requiredNodes: ["UNETLoader", "CLIPLoader", "VAELoader", "TextEncodeQwenImageEditPlus", "SaveImage"],
    fallback: "FluxIdentityAdapter if no approved source reference is available",
  },
  ltx: {
    id: "ltx",
    name: "LTXIdentityAdapter",
    studioFamily: null,
    modelFamily: "ltx23",
    supportedReferences: ["keyframe", "motion-reference"],
    supportedEmbeddings: [],
    supportedLoras: ["ltx-compatible-lora"],
    supportedFaceAdapters: [],
    poseControl: "video/keyframe conditioning",
    unavailableControls: ["photo-generation"],
    requiredNodes: ["LTX video nodes"],
    fallback: "Use Flux/Qwen for still photo keyframes before video",
  },
  generic: {
    id: "generic",
    name: "GenericComfyUIIdentityAdapter",
    studioFamily: "klein",
    modelFamily: "generic",
    supportedReferences: ["prompt-only", "metadata-validation"],
    supportedEmbeddings: [],
    supportedLoras: [],
    supportedFaceAdapters: [],
    poseControl: "unavailable",
    unavailableControls: ["model-specific-identity-conditioning"],
    requiredNodes: [],
    fallback: "identity prompt, reference selection, review gate",
  },
};

const ASPECT_RATIOS = {
  portrait: { id: "portrait", label: "4:5", width: 1080, height: 1350, imageResolution: "portrait" },
  vertical: { id: "vertical", label: "9:16", width: 1080, height: 1920, imageResolution: "story" },
  square: { id: "square", label: "1:1", width: 1024, height: 1024, imageResolution: "square" },
  landscape: { id: "landscape", label: "16:9", width: 1536, height: 864, imageResolution: "landscape" },
};

const VIDEO_PRESETS = {
  fastPreview: {
    id: "fastPreview",
    name: "Fast Preview",
    validation: "reduced",
    quality: "preview",
    resolution: "480p",
    maxDuration: 6,
    upscale: false,
  },
  balanced: {
    id: "balanced",
    name: "Balanced",
    validation: "complete",
    quality: "max",
    resolution: "480p",
    maxDuration: 10,
    upscale: false,
  },
  maximumConsistency: {
    id: "maximumConsistency",
    name: "Maximum Consistency",
    validation: "complete",
    quality: "max",
    resolution: "720p",
    maxDuration: 10,
    upscale: true,
  },
};

function text(value) {
  return String(value || "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/\r?\n|,/).map(text).filter(Boolean);
}

function numberValue(value, fallback, min, max) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error("Valore numerico non valido.");
  }
  return parsed;
}

function optionalSeed(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function adapterFor(raw, profile) {
  const requested = String(raw.model || raw.adapter || profile.generationDefaults?.imageModelFamily || "flux").toLowerCase();
  if (["qwen", "qwenedit", "qwen2511"].includes(requested)) return PHOTO_ADAPTERS.qwen;
  if (["flux", "flux2", "klein"].includes(requested)) return PHOTO_ADAPTERS.flux;
  return PHOTO_ADAPTERS.generic;
}

function referenceScore(asset, intentCategories) {
  const categories = new Set(asset.categories || []);
  const overlap = intentCategories.filter((category) => categories.has(category)).length;
  return (
    (asset.canonical ? 50 : 0)
    + (asset.status === "approved" ? 30 : 0)
    + overlap * 12
    + Math.min(10, Math.round((asset.quality?.score || 0) / 10))
    - (asset.duplicate ? 25 : 0)
  );
}

function desiredCategories(raw) {
  return [
    text(raw.framing),
    text(raw.orientation),
    text(raw.expression),
    text(raw.lighting),
  ].filter(Boolean);
}

export function selectIdentityReferences(profile, raw = {}) {
  const preset = PHOTO_PRESETS[raw.qualityPreset] || PHOTO_PRESETS.fastPreview;
  const intentCategories = desiredCategories(raw);
  return (profile.referenceAssets || [])
    .filter((asset) => asset.status === "approved")
    .map((asset) => ({ ...asset, identitySelectionScore: referenceScore(asset, intentCategories) }))
    .sort((a, b) => b.identitySelectionScore - a.identitySelectionScore)
    .slice(0, preset.referenceLimit);
}

export function buildIdentitySignature(profile, version, references) {
  return {
    influencerId: profile.id,
    versionId: version?.id || profile.currentVersionId,
    displayName: profile.displayName,
    declaredAge: profile.identityProfile.declaredAge,
    synthetic: profile.disclosureSettings.synthetic,
    identityLocks: profile.identityLocks,
    canonicalPrompt: version?.canonicalPrompts?.identity || "",
    referenceIds: references.map((asset) => asset.id),
  };
}

export function composePhotoPrompt(profile, raw = {}, references = []) {
  const identity = profile.identityProfile;
  const appearance = profile.appearanceProfile;
  const fragments = [
    `${profile.displayName}, fictional AI-generated adult virtual creator, declared age ${identity.declaredAge}`,
    identity.fictionalNationality && `imaginary nationality ${identity.fictionalNationality}`,
    identity.fictionalCity && `based in fictional city ${identity.fictionalCity}`,
    identity.narrativeProfession,
    appearance.faceShape,
    appearance.eyeColorAndShape,
    appearance.hair,
    appearance.skinTone,
    appearance.bodyShape,
    appearance.approximateHeight,
    appearance.bodyProportions,
    appearance.distinctiveMarks,
    appearance.makeup,
    appearance.aestheticStyle,
    appearance.recurringAccessories?.join(", "),
    appearance.tattoosEnabled ? appearance.tattoos : "",
    appearance.immutableElements?.length ? `must preserve: ${appearance.immutableElements.join(", ")}` : "",
    raw.outfit && `outfit: ${text(raw.outfit)}`,
    raw.location && `location: ${text(raw.location)}`,
    raw.environment && `environment: ${text(raw.environment)}`,
    raw.pose && `pose: ${text(raw.pose)}`,
    raw.expression && `expression: ${text(raw.expression)}`,
    raw.framing && `framing: ${text(raw.framing)}`,
    raw.orientation && `face orientation: ${text(raw.orientation)}`,
    raw.photographicStyle && `photographic style: ${text(raw.photographicStyle)}`,
    raw.sceneReference && `scene reference: ${text(raw.sceneReference)}`,
    raw.poseReference && `pose reference: ${text(raw.poseReference)}`,
    references.length ? `preserve identity from ${references.length} approved synthetic reference image(s)` : "",
    "clear adult appearance, realistic anatomy, coherent identity, natural lighting, no real person impersonation",
  ];
  const prompt = fragments.map(text).filter(Boolean).join(", ");
  validateAdultPrompt([prompt, raw.negativePrompt, raw.outfit, raw.location, raw.pose, raw.expression]);
  return prompt;
}

export function buildPhotoPlan(profile, raw = {}) {
  const version = (profile.versions || []).find((item) =>
    item.id === (raw.versionId || profile.currentVersionId)
  ) || (profile.versions || []).at(-1);
  const contentLevel = validateContentLevel(raw.contentLevel ?? 0, profile);
  if (contentLevel.id > profile.contentRules.maxContentLevel) {
    throw new Error("Il livello di sensualità supera le regole del profilo.");
  }
  const adapter = adapterFor(raw, profile);
  const preset = PHOTO_PRESETS[raw.qualityPreset] || PHOTO_PRESETS.fastPreview;
  let references = selectIdentityReferences(profile, raw);
  let effectiveAdapter = adapter;
  const warnings = [];
  if (adapter.id === "qwen" && !references.length) {
    effectiveAdapter = PHOTO_ADAPTERS.flux;
    warnings.push("Qwen Image Edit richiede una reference sorgente approvata: fallback a Flux/Klein.");
  }
  if (!references.length) {
    warnings.push("Nessuna reference approvata: la coerenza dipende dalla Character Bible e richiede review manuale.");
  }
  const aspect = ASPECT_RATIOS[raw.aspectRatio] || ASPECT_RATIOS.portrait;
  const prompt = composePhotoPrompt(profile, raw, references);
  const negativePrompt = [
    version?.negativePrompts?.identity,
    "age-ambiguous appearance, immature appearance, real person impersonation, unauthorized identity transfer",
    text(raw.negativePrompt),
  ].filter(Boolean).join(", ");
  validateAdultPrompt([negativePrompt]);
  return {
    type: "influencerPhoto",
    profileId: profile.id,
    versionId: version?.id || profile.currentVersionId,
    contentLevel: contentLevel.id,
    adapter: effectiveAdapter,
    requestedAdapter: adapter.id,
    qualityPreset: preset,
    references,
    identitySignature: buildIdentitySignature(profile, version, references),
    prompt,
    negativePrompt,
    aspect,
    seed: optionalSeed(raw.seed),
    quantity: Math.round(numberValue(raw.quantity, preset.alternatives, 1, 4)),
    fields: {
      outfit: text(raw.outfit),
      location: text(raw.location || raw.environment),
      pose: text(raw.pose),
      expression: text(raw.expression),
      framing: text(raw.framing),
      orientation: text(raw.orientation),
      photographicStyle: text(raw.photographicStyle),
      tags: list(raw.tags),
    },
    warnings,
  };
}

export function composeVideoPrompt(profile, raw = {}, references = []) {
  const identity = profile.identityProfile;
  const appearance = profile.appearanceProfile;
  const fragments = [
    `${profile.displayName}, fictional AI-generated adult virtual creator, declared age ${identity.declaredAge}`,
    appearance.faceShape,
    appearance.eyeColorAndShape,
    appearance.hair,
    appearance.skinTone,
    appearance.bodyShape,
    appearance.bodyProportions,
    appearance.immutableElements?.length ? `must preserve identity details: ${appearance.immutableElements.join(", ")}` : "",
    references.length ? `use the approved synthetic keyframe as identity anchor` : "",
    raw.actionPrompt || raw.prompt,
    raw.cameraMotion && `camera movement: ${text(raw.cameraMotion)}`,
    raw.motionIntensity && `motion intensity: ${text(raw.motionIntensity)}`,
    "preserve facial identity, adult appearance, body proportions, clothing continuity, lighting continuity, color match and temporal consistency",
    "short coherent LTX video clip, no real person impersonation, no unauthorized identity transfer",
  ];
  const prompt = fragments.map(text).filter(Boolean).join(", ");
  validateAdultPrompt([prompt, raw.negativePrompt, raw.actionPrompt, raw.prompt]);
  return prompt;
}

export function buildVideoPlan(profile, raw = {}) {
  const version = (profile.versions || []).find((item) =>
    item.id === (raw.versionId || profile.currentVersionId)
  ) || (profile.versions || []).at(-1);
  const contentLevel = validateContentLevel(raw.contentLevel ?? 0, profile);
  if (contentLevel.id > profile.contentRules.maxContentLevel) {
    throw new Error("Il livello di sensualità supera le regole del profilo.");
  }
  const preset = VIDEO_PRESETS[raw.qualityPreset] || VIDEO_PRESETS.fastPreview;
  const duration = Math.round(numberValue(raw.duration, Math.min(5, preset.maxDuration), 3, 10));
  const fps = Math.round(numberValue(raw.fps, 24, 12, 30));
  const references = selectIdentityReferences(profile, {
    ...raw,
    qualityPreset: raw.qualityPreset || "balanced",
    framing: raw.framing || "mezzo busto",
  });
  if (!references.length) {
    throw new Error("Influencer Video richiede almeno una reference approvata come keyframe iniziale.");
  }
  const aspect = ASPECT_RATIOS[raw.aspectRatio] || ASPECT_RATIOS.vertical;
  const prompt = composeVideoPrompt(profile, raw, references);
  const negativePrompt = [
    version?.negativePrompts?.identity,
    "age-ambiguous appearance, immature appearance, identity drift, facial flicker, warped anatomy, unauthorized identity transfer",
    text(raw.negativePrompt),
  ].filter(Boolean).join(", ");
  validateAdultPrompt([negativePrompt]);
  return {
    type: "influencerVideo",
    profileId: profile.id,
    versionId: version?.id || profile.currentVersionId,
    contentLevel: contentLevel.id,
    adapter: PHOTO_ADAPTERS.ltx,
    qualityPreset: preset,
    references,
    keyframeReferenceId: raw.keyframeReferenceId || references[0].id,
    identitySignature: buildIdentitySignature(profile, version, references),
    prompt,
    negativePrompt,
    aspect,
    duration,
    fps,
    seed: optionalSeed(raw.seed),
    fields: {
      actionPrompt: text(raw.actionPrompt || raw.prompt),
      cameraMotion: text(raw.cameraMotion || "static"),
      motionIntensity: text(raw.motionIntensity || "medium"),
      aspectRatio: aspect.id,
      tags: list(raw.tags),
    },
    warnings: [
      "Milestone 3 usa metriche temporali proxy: face embedding, optical flow e tracking avanzato richiedono nodi/modelli dedicati.",
    ],
  };
}

export function videoWorkflowRequest(plan) {
  return {
    workflowId: "standard",
    projectName: `Influencer Video - ${plan.identitySignature.displayName}`,
    prompt: plan.prompt,
    negativePrompt: plan.negativePrompt,
    resolution: plan.qualityPreset.resolution,
    orientation: plan.aspect.id === "landscape" ? "landscape" : "portrait",
    duration: plan.duration,
    quality: plan.qualityPreset.quality,
    seed: plan.seed,
    cameraMotion: plan.fields.cameraMotion,
    motionIntensity: plan.fields.motionIntensity,
    audioMode: "generated",
  };
}

export function photoStudioRequest(plan, uploadedReferences = []) {
  const source = plan.adapter.id === "qwen" ? uploadedReferences[0] : null;
  const references = plan.adapter.id === "qwen" ? uploadedReferences.slice(1, 4) : uploadedReferences.slice(0, 4);
  return {
    studioMode: "perfect",
    projectName: `Influencer Photo - ${plan.identitySignature.displayName}`,
    prompt: plan.prompt,
    negativePrompt: plan.negativePrompt,
    perfectFamily: plan.adapter.studioFamily || "klein",
    studioPreset: plan.qualityPreset.studioPreset,
    alternatives: Math.max(2, plan.quantity),
    imageResolution: plan.aspect.imageResolution,
    imageWidth: plan.aspect.width,
    imageHeight: plan.aspect.height,
    seed: plan.seed,
    batchSize: 1,
    upscaleMode: plan.qualityPreset.upscaleMode,
    faceDetailer: plan.qualityPreset.faceDetailer,
    handDetailer: plan.qualityPreset.handDetailer,
    referenceUploads: references,
    sourceUpload: source,
  };
}

export function identityEngineConfig() {
  return {
    adapters: PHOTO_ADAPTERS,
    photoPresets: PHOTO_PRESETS,
    videoPresets: VIDEO_PRESETS,
    aspectRatios: ASPECT_RATIOS,
    contentLevels: CONTENT_LEVELS,
  };
}
