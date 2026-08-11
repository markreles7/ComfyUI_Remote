function get(profile, path, fallback = null) {
  let value = profile;
  for (const key of path.split(".")) value = value?.[key];
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value ?? fallback;
}

function conf(profile, path, fallback = 0) {
  let value = profile;
  for (const key of path.split(".")) value = value?.[key];
  return Number.isFinite(value?.confidence) ? value.confidence : fallback;
}

function scoreFromDistance(distance, tolerance) {
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - distance / tolerance))));
}

function numericCategory(source, result, path, tolerance, label, correction) {
  const left = Number(get(source, path));
  const right = Number(get(result, path));
  const confidence = Math.min(conf(source, path, 0.5), conf(result, path, 0.5));
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return unavailable(label, correction);
  }
  const score = scoreFromDistance(Math.abs(left - right), tolerance);
  return category(score, confidence, label, correction);
}

function vectorCategory(source, result, path, tolerance, label, correction) {
  const left = get(source, path);
  const right = get(result, path);
  const confidence = Math.min(conf(source, path, 0.4), conf(result, path, 0.4));
  if (!left || !right || !Number.isFinite(left.x) || !Number.isFinite(right.x)) {
    return unavailable(label, correction);
  }
  const distance = Math.hypot(left.x - right.x, left.y - right.y);
  return category(scoreFromDistance(distance, tolerance), confidence, label, correction);
}

function histogramCategory(source, result) {
  const left = get(source, "colorProfile.luminanceDistribution");
  const right = get(result, "colorProfile.luminanceDistribution");
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return unavailable("Distribuzione luminanza", "exposure-match");
  }
  const distance = Math.sqrt(left.reduce((sum, value, index) =>
    sum + (Number(value) - Number(right[index])) ** 2, 0));
  return category(scoreFromDistance(distance, 0.35), 0.9, "Distribuzione luminanza", "exposure-match");
}

function category(score, confidence, label, correction) {
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: safeScore,
    confidence: Math.max(0, Math.min(1, Number(confidence) || 0)),
    problems: safeScore < 75 ? [`${label}: coerenza insufficiente (${safeScore}/100).`] : [],
    recommendedCorrection: safeScore < 75 ? correction : null,
    measured: true,
  };
}

function unavailable(label, correction) {
  return {
    score: 50,
    confidence: 0,
    problems: [`${label}: dati insufficienti per una valutazione affidabile.`],
    recommendedCorrection: correction,
    measured: false,
  };
}

function suppliedMetric(metrics, name, label, correction) {
  const value = metrics?.[name];
  if (!value || !Number.isFinite(Number(value.score))) return unavailable(label, correction);
  return category(Number(value.score), Number(value.confidence ?? 0.8), label, correction);
}

export function evaluateSceneCoherence(sourceProfile, resultProfile, suppliedMetrics = {}) {
  const colorTemperature = numericCategory(
    sourceProfile, resultProfile, "colorProfile.temperature", 3500,
    "Temperatura colore", "local-color-transfer",
  );
  const saturation = numericCategory(
    sourceProfile, resultProfile, "colorProfile.meanSaturation", 0.45,
    "Saturazione", "local-color-transfer",
  );
  const colorScore = Math.round((colorTemperature.score + saturation.score) / 2);
  const colorConfidence = Math.min(colorTemperature.confidence, saturation.confidence);
  const categories = {
    colorCoherence: category(colorScore, colorConfidence, "Colore", "local-color-transfer"),
    luminanceCoherence: histogramCategory(sourceProfile, resultProfile),
    lightingDirectionCoherence: vectorCategory(
      sourceProfile, resultProfile, "lightingProfile.mainDirection", 1.4,
      "Direzione luce", "relighting",
    ),
    shadowCoherence: numericCategory(
      sourceProfile, resultProfile, "lightingProfile.shadowSoftness", 0.7,
      "Ombre", "shadow-adjustment",
    ),
    perspectiveCoherence: suppliedMetric(
      suppliedMetrics, "perspectiveCoherence", "Prospettiva", "regional-regeneration",
    ),
    scaleCoherence: suppliedMetric(
      suppliedMetrics, "scaleCoherence", "Scala", "regional-regeneration",
    ),
    depthCoherence: suppliedMetric(
      suppliedMetrics, "depthCoherence", "Profondità", "depth-aware-compositing",
    ),
    sharpnessCoherence: numericCategory(
      sourceProfile, resultProfile, "cameraProfile.apparentSharpness", 0.65,
      "Nitidezza", "blur-match",
    ),
    grainNoiseCoherence: numericCategory(
      sourceProfile, resultProfile, "textureProfile.grainAmount", 0.45,
      "Grana e rumore", "grain-match",
    ),
    edgeCompositingQuality: suppliedMetric(
      suppliedMetrics, "edgeCompositingQuality", "Bordi compositing", "edge-refinement",
    ),
    temporalConsistency: sourceProfile.mediaType === "video"
      ? suppliedMetric(suppliedMetrics, "temporalConsistency", "Consistenza temporale", "temporal-smoothing")
      : category(100, 1, "Consistenza temporale", null),
    identityPreservation: suppliedMetric(
      suppliedMetrics, "identityPreservation", "Identità", "regional-regeneration",
    ),
    backgroundPreservation: suppliedMetric(
      suppliedMetrics, "backgroundPreservation", "Sfondo", "mask-recomposite",
    ),
    outsideRoiPreservation: suppliedMetric(
      suppliedMetrics, "outsideRoiPreservation", "Pixel esterni alla ROI", "mask-recomposite",
    ),
    boundaryDifference: suppliedMetric(
      suppliedMetrics, "boundaryDifference", "Continuità al bordo", "edge-refinement",
    ),
  };

  const measured = Object.values(categories).filter((item) => item.measured && item.confidence > 0);
  const weighted = measured.reduce((sum, item) => sum + item.score * item.confidence, 0);
  const weight = measured.reduce((sum, item) => sum + item.confidence, 0);
  const overallScore = weight ? Math.round(weighted / weight) : 50;
  const problems = Object.entries(categories).flatMap(([id, item]) =>
    item.problems.map((message) => ({ category: id, message }))
  );
  const corrections = [...new Set(Object.values(categories)
    .filter((item) => item.measured && item.score < 75 && item.confidence >= 0.2)
    .map((item) => item.recommendedCorrection)
    .filter(Boolean))];
  const severe = Object.values(categories).some((item) =>
    item.measured && item.confidence >= 0.4 && item.score < 40
  );
  return {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    overallScore,
    confidence: measured.length / Object.keys(categories).length,
    categories,
    problems,
    recommendedCorrections: corrections,
    recommendation: severe ? "regenerate-region" : corrections.length ? "correct" : "accept",
  };
}
