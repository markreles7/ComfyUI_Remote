import { BaseSceneAdapter, confidence, metric } from "./base-adapter.js";

export class LTXVideoAdapter extends BaseSceneAdapter {
  get id() {
    return "ltx-2.3-video";
  }

  get name() {
    return "LTX 2.3 Video Adapter";
  }

  plan(input) {
    const plan = super.plan(input);
    const { profile, settings, context = {} } = input;
    plan.supported.push("first-frame-conditioning", "temporal-prompt-conditioning");
    if (/unionControl/i.test(String(context.engine || "")) || /sceneTransform/i.test(String(context.workflowId || ""))) {
      plan.supported.push("union-control-edge", "union-control-pose");
      if (settings.depth) {
        plan.unsupported.push("union-control-depth-disabled");
        plan.fallbacks.push("Il template locale usa Edge/Pose per Union Control; Depth resta disattivato finché non è verificato sul workflow corrente.");
      }
    } else if (settings.depth) {
      plan.unsupported.push("native-depth-on-this-ltx-workflow");
      plan.fallbacks.push("Depth non viene applicato nei workflow Video Studio rimasti; usa maschera/tracking quando devi preservare una regione.");
    }
    if (context.maskLink || context.trackedMask) {
      plan.supported.push("sam3-tracked-mask", "occlusion-handling");
    } else if (settings.occlusionHandling) {
      plan.unsupported.push("tracked-occlusion-mask");
      plan.fallbacks.push("Senza maschera/tracking l’occlusione resta una stima; SAM3 è disponibile nei workflow Tracked Inpaint.");
    }
    const motion = metric(profile, "temporalProfile.cameraMotion", null);
    const motionConfidence = confidence(profile, "temporalProfile.cameraMotion");
    if (profile.mediaType === "video" && motion && motionConfidence > 0.25) {
      plan.appliedParameters.cameraMotion = motion;
      plan.appliedParameters.temporalConfidence = motionConfidence;
      plan.promptConditioning.push(`Preserve source camera motion vector ${JSON.stringify(motion)} and exposure continuity.`);
    }
    if (settings.temporalConsistency) {
      plan.supported.push("final-frame-color-consistency");
      plan.reasons.push("Il color matching viene applicato al batch di frame prima di CreateVideo.");
    }
    plan.reasons.push("LTX riceve soltanto controlli temporali compatibili con il workflow selezionato.");
    return plan;
  }
}
