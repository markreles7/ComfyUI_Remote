const CATEGORY_KEYS = [
  "faceSimilarity",
  "eyeConsistency",
  "hairConsistency",
  "skinToneConsistency",
  "ageConsistency",
  "bodyConsistency",
  "proportionConsistency",
  "tattooConsistency",
  "accessoryConsistency",
  "voiceConsistency",
  "temporalIdentityConsistency",
];

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function enabledLocks(profile) {
  return Object.entries(profile.identityLocks || {})
    .filter(([, lock]) => lock?.enabled);
}

function scoreFromLocks(profile) {
  const locks = enabledLocks(profile);
  if (!locks.length) return 54;
  const avg = locks.reduce((sum, [, lock]) =>
    sum + Number(lock.strength || 0) * 100 - Number(lock.tolerance || 0) * 20,
  0) / locks.length;
  return clampScore(avg);
}

function scoreFromReferences(references) {
  if (!references.length) return 38;
  const canonical = references.filter((asset) => asset.canonical).length;
  const quality = references.reduce((sum, asset) => sum + Number(asset.quality?.score || 50), 0) / references.length;
  return clampScore(quality * 0.55 + Math.min(4, references.length) * 9 + canonical * 7);
}

export function validateInfluencerImage({ profile, plan, generation = null, mediaFile = null } = {}) {
  const references = plan?.references || [];
  const lockScore = scoreFromLocks(profile);
  const referenceScore = scoreFromReferences(references);
  const readinessScore = Number(profile.identityDatasetReadiness?.score || 0);
  const outputScore = generation?.outputWidth && generation?.outputHeight ? 78 : mediaFile ? 68 : 50;
  const tattooConfigured = Boolean(profile.appearanceProfile?.tattoosEnabled && profile.appearanceProfile?.tattoos);
  const accessoryConfigured = Boolean(profile.appearanceProfile?.recurringAccessories?.length);

  const categoryScores = {
    faceSimilarity: clampScore(referenceScore * 0.6 + lockScore * 0.4),
    eyeConsistency: clampScore(lockScore * (profile.identityLocks?.eyes?.enabled ? 1 : 0.82)),
    hairConsistency: clampScore(lockScore * (profile.identityLocks?.hair?.enabled ? 1 : 0.84)),
    skinToneConsistency: clampScore(lockScore * (profile.identityLocks?.skinTone?.enabled ? 1 : 0.84)),
    ageConsistency: clampScore(profile.identityProfile?.declaredAge >= 21 ? 92 : 0),
    bodyConsistency: clampScore(lockScore * (profile.identityLocks?.bodyShape?.enabled ? 0.95 : 0.76)),
    proportionConsistency: clampScore(lockScore * (profile.identityLocks?.proportions?.enabled ? 0.95 : 0.72)),
    tattooConsistency: tattooConfigured ? clampScore(lockScore * 0.85) : 100,
    accessoryConsistency: accessoryConfigured ? clampScore(lockScore * 0.8) : 100,
    voiceConsistency: 100,
    temporalIdentityConsistency: 100,
  };
  const weighted = (
    categoryScores.faceSimilarity * 0.22
    + categoryScores.eyeConsistency * 0.08
    + categoryScores.hairConsistency * 0.08
    + categoryScores.skinToneConsistency * 0.08
    + categoryScores.ageConsistency * 0.14
    + categoryScores.bodyConsistency * 0.08
    + categoryScores.proportionConsistency * 0.08
    + categoryScores.tattooConsistency * 0.06
    + categoryScores.accessoryConsistency * 0.04
    + outputScore * 0.14
  );
  const overallScore = clampScore(weighted);
  const detectedProblems = [];
  if (readinessScore < 45) detectedProblems.push("Identity Dataset insufficiente o sbilanciato.");
  if (!references.length) detectedProblems.push("Nessuna reference approvata usata dal piano foto.");
  if (overallScore < 65) detectedProblems.push("Identity score sotto soglia di review.");
  if (generation?.dimensionWarning) detectedProblems.push(generation.dimensionWarning);

  return {
    overallScore,
    categoryScores: Object.fromEntries(CATEGORY_KEYS.map((key) => [key, categoryScores[key] ?? 100])),
    confidence: references.length >= 3 && readinessScore >= 75 ? "medium" : "low",
    detectedProblems,
    recommendedAction: overallScore >= 78 ? "review" : "retry-or-correct",
    reject: overallScore < 50,
    retry: overallScore < 65,
    correctionSettings: {
      strengthenIdentityPrompt: overallScore < 78,
      requireMoreReferences: references.length < 2,
      useCanonicalOnly: readinessScore < 75,
    },
    methods: [
      "dataset-readiness",
      "reference-quality",
      "identity-lock-coverage",
      "metadata-and-dimension-check",
    ],
    unavailableMethods: [
      "face-embedding",
      "landmark-detection",
      "segmentation",
      "pose-estimation",
      "perceptual-similarity",
      "histogram-comparison",
    ],
  };
}

export function validateAnatomyAndQuality({ generation = null } = {}) {
  const validDimensions = !generation?.dimensionWarning;
  const categoryScores = {
    hands: 62,
    fingerCount: 58,
    eyes: 72,
    teeth: 66,
    earrings: 70,
    glasses: 70,
    bodyAnatomy: 64,
    proportions: 66,
    duplicateLimbs: 64,
    reflections: 70,
    deformedText: 76,
    fusedObjects: 66,
    backgroundAltered: validDimensions ? 72 : 45,
    corruptedFrames: validDimensions ? 88 : 20,
    flicker: 100,
    motionDeformation: 100,
  };
  const overallScore = clampScore(Object.values(categoryScores).reduce((sum, value) => sum + value, 0) / Object.keys(categoryScores).length);
  return {
    overallScore,
    categoryScores,
    mode: "preview",
    configurable: true,
    detectedProblems: validDimensions ? [] : [generation.dimensionWarning],
    recommendedAction: overallScore >= 70 ? "review" : "manual-check",
  };
}
