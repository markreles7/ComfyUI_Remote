import { adapterForGeneration } from "./adapters/registry.js";
import { applyCorrectionsToIntegrationPlan, buildCorrectionPlan } from "./correction-planner.js";
import { evaluateSceneCoherence } from "./evaluator.js";
import { applySceneIntegrationPlan } from "./workflow-integration.js";

export function prepareSceneIntegratedWorkflow({
  workflow,
  metadata,
  profile,
  settings,
  availableNodes,
  context = {},
}) {
  const adapter = adapterForGeneration(metadata, { availableNodes });
  const plan = adapter.plan({ profile, settings, context });
  const workflowReport = applySceneIntegrationPlan(workflow, {
    plan,
    profile,
    sourceInput: context.sourceInput,
    frameCount: context.frameCount,
  });
  return {
    workflow,
    plan,
    workflowReport,
    metadata: {
      ...metadata,
      sceneIntegration: {
        enabled: true,
        profileId: profile.id,
        profileVersion: profile.version,
        preset: settings.preset,
        settings,
        adapterReport: plan,
        workflowReport,
        evaluation: null,
        iterations: [],
      },
    },
  };
}

export function evaluateAndPlanCorrection({
  sourceProfile,
  resultProfile,
  suppliedMetrics,
  integration,
}) {
  const evaluation = evaluateSceneCoherence(sourceProfile, resultProfile, suppliedMetrics);
  const iteration = integration?.iterations?.length || 0;
  const maxIterations = integration?.settings?.correctionIterations ?? 0;
  const correction = buildCorrectionPlan(evaluation, { iteration, maxIterations });
  return {
    evaluation,
    correction,
    nextIntegrationPlan: correction.actions.length
      ? applyCorrectionsToIntegrationPlan(integration.adapterReport, correction)
      : null,
  };
}
