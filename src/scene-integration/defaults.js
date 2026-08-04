export const SCENE_PROFILE_VERSION = "1.0.0";

export const SCENE_INTEGRATION_PRESETS = Object.freeze({
  preview: Object.freeze({
    id: "preview",
    name: "Fast Preview",
    analysisScale: 0.35,
    maxVideoFrames: 24,
    depth: false,
    segmentation: false,
    opticalFlow: false,
    evaluator: true,
    maxIterations: 1,
    upscale: false,
  }),
  balanced: Object.freeze({
    id: "balanced",
    name: "Balanced",
    analysisScale: 0.6,
    maxVideoFrames: 72,
    depth: true,
    segmentation: true,
    opticalFlow: true,
    evaluator: true,
    maxIterations: 2,
    upscale: false,
  }),
  maximum: Object.freeze({
    id: "maximum",
    name: "Maximum Integration",
    analysisScale: 1,
    maxVideoFrames: 144,
    depth: true,
    segmentation: true,
    opticalFlow: true,
    evaluator: true,
    maxIterations: 3,
    upscale: true,
  }),
});

export const DEFAULT_SCENE_INTEGRATION_SETTINGS = Object.freeze({
  enabled: false,
  preset: "balanced",
  reuseAnalysis: true,
  autoPlacement: true,
  autoRelighting: true,
  matchColor: true,
  matchBlur: false,
  grainMode: "match",
  customGrain: 0.04,
  preserveBackground: true,
  temporalConsistency: true,
  occlusionHandling: true,
  contactShadows: true,
  correctionIterations: 2,
  debugArtifacts: false,
});

export function sceneIntegrationSettings(raw = {}) {
  const preset = SCENE_INTEGRATION_PRESETS[raw.preset]
    || SCENE_INTEGRATION_PRESETS.balanced;
  const bool = (value, fallback) => {
    if (typeof value === "boolean") return value;
    if (value == null || value === "") return fallback;
    return ["true", "1", "on", "yes"].includes(String(value).toLowerCase());
  };
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : fallback;
  };
  const grainMode = ["off", "match", "custom"].includes(raw.grainMode)
    ? raw.grainMode
    : DEFAULT_SCENE_INTEGRATION_SETTINGS.grainMode;
  return {
    enabled: bool(raw.enabled, DEFAULT_SCENE_INTEGRATION_SETTINGS.enabled),
    preset: preset.id,
    reuseAnalysis: bool(raw.reuseAnalysis, DEFAULT_SCENE_INTEGRATION_SETTINGS.reuseAnalysis),
    autoPlacement: bool(raw.autoPlacement, DEFAULT_SCENE_INTEGRATION_SETTINGS.autoPlacement),
    autoRelighting: bool(raw.autoRelighting, DEFAULT_SCENE_INTEGRATION_SETTINGS.autoRelighting),
    matchColor: bool(raw.matchColor, DEFAULT_SCENE_INTEGRATION_SETTINGS.matchColor),
    matchBlur: bool(raw.matchBlur, DEFAULT_SCENE_INTEGRATION_SETTINGS.matchBlur),
    grainMode,
    customGrain: number(raw.customGrain, 0.04, 0.001, 0.25),
    preserveBackground: bool(raw.preserveBackground, true),
    temporalConsistency: bool(raw.temporalConsistency, true),
    occlusionHandling: bool(raw.occlusionHandling, true),
    contactShadows: bool(raw.contactShadows, true),
    correctionIterations: Math.round(number(
      raw.correctionIterations,
      preset.maxIterations,
      0,
      preset.maxIterations,
    )),
    debugArtifacts: bool(raw.debugArtifacts, false),
    analysisScale: preset.analysisScale,
    maxVideoFrames: preset.maxVideoFrames,
    depth: preset.depth,
    segmentation: preset.segmentation,
    opticalFlow: preset.opticalFlow,
    evaluator: preset.evaluator,
    upscale: preset.upscale,
  };
}
