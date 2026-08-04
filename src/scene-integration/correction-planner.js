const CORRECTION_CATEGORY = Object.freeze({
  "local-color-transfer": ["colorCoherence"],
  "exposure-match": ["luminanceCoherence"],
  relighting: ["lightingDirectionCoherence"],
  "shadow-adjustment": ["shadowCoherence"],
  "regional-regeneration": ["perspectiveCoherence", "scaleCoherence", "identityPreservation"],
  "depth-aware-compositing": ["depthCoherence"],
  "blur-match": ["sharpnessCoherence"],
  "grain-match": ["grainNoiseCoherence"],
  "edge-refinement": ["edgeCompositingQuality"],
  "temporal-smoothing": ["temporalConsistency"],
  "mask-recomposite": ["backgroundPreservation"],
});

export function buildCorrectionPlan(evaluation, {
  iteration = 0,
  maxIterations = 2,
  threshold = 75,
} = {}) {
  const stopped = iteration >= maxIterations;
  if (stopped) {
    return {
      iteration,
      maxIterations,
      stopped: true,
      reason: "maximum-iterations-reached",
      actions: [],
      regenerateRegion: false,
    };
  }
  const actions = [];
  for (const [action, categories] of Object.entries(CORRECTION_CATEGORY)) {
    const deficient = categories.filter((category) => {
      const result = evaluation?.categories?.[category];
      return result?.measured && result.confidence >= 0.2 && result.score < threshold;
    });
    if (!deficient.length) continue;
    actions.push({
      id: action,
      categories: deficient,
      reason: deficient.map((category) =>
        `${category}=${evaluation.categories[category].score}`
      ).join(", "),
    });
  }
  return {
    iteration,
    maxIterations,
    stopped: actions.length === 0,
    reason: actions.length ? null : "all-measured-categories-passed",
    actions,
    regenerateRegion: actions.some((action) => action.id === "regional-regeneration"),
  };
}

export function applyCorrectionsToIntegrationPlan(integrationPlan, correctionPlan) {
  const plan = structuredClone(integrationPlan);
  const allowBlurMatch = plan.mediaType === "video";
  const selectedCorrections = correctionPlan.actions
    .map((item) => item.id)
    .filter((id) => allowBlurMatch || id !== "blur-match");
  const ids = new Set(selectedCorrections);
  // Each switch is driven by the evaluator category; unrelated passes stay off.
  plan.controls.matchColor = ids.has("local-color-transfer") || ids.has("exposure-match");
  plan.controls.matchBlur = ids.has("blur-match");
  plan.controls.grainMode = ids.has("grain-match") ? plan.controls.grainMode : "off";
  plan.controls.preserveBackground = ids.has("mask-recomposite");
  plan.controls.temporalConsistency = ids.has("temporal-smoothing");
  plan.controls.occlusionHandling = ids.has("depth-aware-compositing") || ids.has("edge-refinement");
  plan.controls.contactShadows = ids.has("shadow-adjustment");
  plan.appliedParameters.correctionIteration = correctionPlan.iteration + 1;
  plan.appliedParameters.selectedCorrections = selectedCorrections;
  plan.reasons.push(`Correction pass selettivo: ${selectedCorrections.join(", ") || "nessuna azione"}.`);
  return plan;
}
