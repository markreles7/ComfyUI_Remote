import { SCENE_PROFILE_VERSION } from "./defaults.js";

const PROFILE_SECTIONS = [
  "sourceMetadata",
  "colorProfile",
  "lightingProfile",
  "cameraProfile",
  "spatialProfile",
  "temporalProfile",
  "textureProfile",
  "masks",
  "confidenceScores",
];

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function warnings(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    : [];
}

export function emptySceneProfile(mediaType = "image") {
  return {
    version: SCENE_PROFILE_VERSION,
    id: null,
    cacheKey: null,
    createdAt: new Date().toISOString(),
    mediaType: mediaType === "video" ? "video" : "image",
    sourceMetadata: {},
    analysisSettings: {},
    colorProfile: {},
    lightingProfile: {},
    cameraProfile: {},
    spatialProfile: {},
    temporalProfile: {},
    textureProfile: {},
    masks: {},
    artifacts: {},
    confidenceScores: {},
    analysisWarnings: [],
  };
}

export function normalizeSceneProfile(raw, {
  id = raw?.id || null,
  cacheKey = raw?.cacheKey || null,
} = {}) {
  const mediaType = raw?.mediaType === "video" ? "video" : "image";
  const profile = {
    ...emptySceneProfile(mediaType),
    ...object(raw),
    id,
    cacheKey,
    version: String(raw?.version || SCENE_PROFILE_VERSION),
    mediaType,
    createdAt: raw?.createdAt || new Date().toISOString(),
    analysisSettings: object(raw?.analysisSettings),
    artifacts: object(raw?.artifacts),
    analysisWarnings: warnings(raw?.analysisWarnings),
  };
  for (const section of PROFILE_SECTIONS) profile[section] = object(raw?.[section]);
  return profile;
}

export function validateSceneProfile(raw, { allowFutureVersion = false } = {}) {
  const issues = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return ["Il profilo non è un oggetto JSON."];
  }
  if (typeof raw.version !== "string" || !raw.version.trim()) {
    issues.push("version mancante.");
  } else if (!allowFutureVersion && raw.version.split(".")[0] !== SCENE_PROFILE_VERSION.split(".")[0]) {
    issues.push(`Versione profilo non supportata: ${raw.version}.`);
  }
  if (!["image", "video"].includes(raw.mediaType)) {
    issues.push("mediaType deve essere image o video.");
  }
  for (const section of PROFILE_SECTIONS) {
    if (!raw[section] || typeof raw[section] !== "object" || Array.isArray(raw[section])) {
      issues.push(`${section} deve essere un oggetto.`);
    }
  }
  if (!Array.isArray(raw.analysisWarnings)) {
    issues.push("analysisWarnings deve essere un array.");
  }
  return issues;
}

export function assertSceneProfile(raw, options) {
  const issues = validateSceneProfile(raw, options);
  if (issues.length) {
    const error = new Error(`Scene Profile non valido:\n${issues.map((item) => `- ${item}`).join("\n")}`);
    error.statusCode = 400;
    error.issues = issues;
    throw error;
  }
  return normalizeSceneProfile(raw);
}

export function migrateSceneProfile(raw) {
  const profile = normalizeSceneProfile(raw);
  const major = Number.parseInt(profile.version.split(".")[0], 10);
  if (!Number.isFinite(major) || major < 1) {
    profile.analysisWarnings.push("Profilo legacy normalizzato allo schema 1.0.0.");
  }
  profile.version = SCENE_PROFILE_VERSION;
  return assertSceneProfile(profile);
}
