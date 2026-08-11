import { assertSubjectInsertionRequest } from "./schema.js";
import { strategyForSubjectInsertion } from "./strategies.js";

function confidence(profile, path) {
  let value = profile;
  for (const key of path.split(".")) value = value?.[key];
  return Number.isFinite(value?.confidence) ? value.confidence : 0;
}

function artifact(profile, key) {
  return profile?.artifacts?.[key] || profile?.masks?.[key] || null;
}

export function planSubjectInsertion(raw, { availableNodes = [] } = {}) {
  const request = assertSubjectInsertionRequest(raw);
  const strategy = strategyForSubjectInsertion(request, availableNodes);
  const depthConfidence = confidence(request.sceneProfile, "spatialProfile.depthMap");
  const segmentationConfidence = Number(request.sceneProfile?.confidenceScores?.spatial || 0);
  const generatedSubjectMask = request.masks.subject || (
    strategy.runtime.segmentationNode && strategy.runtime.groundingNode
      ? artifact(request.sceneProfile, "subjectMask")
      : null
  );
  const generatedOcclusionMask = request.masks.occlusion || (
    strategy.runtime.depthNode && depthConfidence >= 0.45
      ? artifact(request.sceneProfile, "occlusionMask")
      : null
  );
  const fallbacks = [...strategy.fallbacks];
  if (request.placement.box && !request.masks.edit) {
    fallbacks.push("Il riquadro definisce posizione e scala ma non viene trattato come maschera finale.");
  }
  if (!generatedSubjectMask) {
    fallbacks.push("Maschera soggetto non disponibile: nessuna segmentazione viene dichiarata come eseguita.");
  }
  if (!generatedOcclusionMask) {
    fallbacks.push("Maschera occlusioni non disponibile o depth sotto soglia: nessuna occlusione artificiale viene applicata.");
  }
  const applyDepth = Boolean(strategy.supports.depthControl && depthConfidence >= 0.45);
  return {
    version: "1.0.0",
    requestId: request.requestId,
    pipeline: [
      "source", "scene-understanding", "reference-understanding", "placement",
      "edit-region", "insertion", "local-integration", "identity-detail-refine",
      "seam-light-color-harmonization", "final",
    ],
    source: request.source,
    operation: request.operation,
    subjectType: request.subjectType,
    references: request.references,
    identity: request.identity,
    model: request.model,
    strategy,
    placement: {
      ...request.placement,
      scaleConfidence: request.placement.box ? 0.9 : 0.35,
      perspectiveConfidence: Number(request.sceneProfile?.confidenceScores?.camera || 0),
      depthConfidence,
      destructiveEstimatesApplied: false,
    },
    masks: {
      placementBox: request.placement.box,
      edit: request.masks.edit || null,
      subject: generatedSubjectMask,
      occlusion: generatedOcclusionMask,
      segmentationEngine: generatedSubjectMask ? strategy.runtime.segmentationNode : null,
      groundingEngine: generatedSubjectMask ? strategy.runtime.groundingNode : null,
      depthEngine: applyDepth ? strategy.runtime.depthNode : null,
      confidence: segmentationConfidence,
    },
    scene: {
      profileId: request.source.sceneProfileId || request.sceneProfile?.id || null,
      depthApplied: applyDepth,
      localFinishingOnly: true,
      globalFinishing: false,
    },
    instructions: request.instructions,
    passes: {
      insertion: true,
      identityRefine: request.options.identityRefine && request.subjectType === "person" && request.references.length > 0,
      detailRefine: request.options.detailRefine,
      localHarmonization: request.options.allowFinishing,
      evaluatorDrivenOnly: true,
    },
    fallbacks: [...new Set(fallbacks)],
    debugArtifacts: request.options.debugArtifacts
      ? {
          source: request.source.file ? "available" : "unavailable",
          placementBox: request.placement.box ? "available" : "unavailable",
          editMask: request.masks.edit ? "available" : "unavailable",
          subjectMask: generatedSubjectMask ? "available" : "unavailable",
          occlusionMask: generatedOcclusionMask ? "available" : "unavailable",
          depth: artifact(request.sceneProfile, "depth") ? "available" : "unavailable",
          localCrop: strategy.supports.localCrop ? "workflow-runtime" : "unavailable",
          firstInsertion: "generation-output",
          refined: request.options.detailRefine ? "generation-output" : "disabled",
          final: "generation-output",
        }
      : {},
  };
}
