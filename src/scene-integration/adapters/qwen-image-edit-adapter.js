import { BaseSceneAdapter, confidence, metric } from "./base-adapter.js";

export class QwenImageEditAdapter extends BaseSceneAdapter {
  get id() {
    return "qwen-image-edit-2511";
  }

  get name() {
    return "Qwen Image Edit 2511 Adapter";
  }

  plan(input) {
    const plan = super.plan(input);
    const { profile, settings, context = {} } = input;
    plan.supported.push("reference-image-conditioning", "image-to-image-strength");
    plan.appliedParameters.denoise = Math.max(0.25, Math.min(
      0.85,
      Number(context.denoise ?? 0.55),
    ));
    if (context.maskLink || context.maskUpload) {
      plan.supported.push("regional-mask", "background-preservation");
      plan.reasons.push("La maschera permette di mantenere invariati i pixel esterni alla zona di intervento.");
    } else if (settings.preserveBackground) {
      plan.unsupported.push("strict-background-preservation");
      plan.fallbacks.push("Preservazione tramite istruzione Qwen e ricomposizione soltanto se viene fornita una maschera.");
    }
    const depthConfidence = confidence(profile, "spatialProfile.depthMap");
    if (settings.depth && context.structureGuideAvailable && depthConfidence > 0.35) {
      plan.supported.push("qwen-depth-structure-guide");
      plan.appliedParameters.depthStrength = Math.max(0.35, Math.min(0.85, depthConfidence));
    } else if (settings.depth) {
      plan.unsupported.push("qwen-depth-structure-guide");
      plan.fallbacks.push("Depth non collegata: profilo poco affidabile o ModelPatch Qwen non disponibile.");
    }
    plan.promptConditioning.push(
      `Preserve source illumination direction ${JSON.stringify(metric(profile, "lightingProfile.mainDirection", {}))}.`,
      "Keep all pixels outside the requested edit region unchanged.",
    );
    plan.reasons.push("Qwen riceve reference e istruzione semantica; colore e grana vengono armonizzati dopo il decode, mentre il blur matching resta disattivato sulle foto per preservare nitidezza.");
    return plan;
  }
}
