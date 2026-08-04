import { BaseSceneAdapter, confidence, metric } from "./base-adapter.js";

export class FluxKleinAdapter extends BaseSceneAdapter {
  get id() {
    return "flux2-klein";
  }

  get name() {
    return "FLUX.2 Klein Adapter";
  }

  plan(input) {
    const plan = super.plan(input);
    const { profile, settings, context = {} } = input;
    plan.supported.push("multi-reference-conditioning", "reference-latent", "image-to-image-strength");
    plan.appliedParameters.referenceStrength = Math.max(0.4, Math.min(
      1.4,
      Number(context.referenceStrength ?? 1),
    ));
    plan.appliedParameters.denoise = Math.max(0.2, Math.min(0.9, Number(context.denoise ?? 0.6)));
    if (context.maskLink || context.maskUpload) {
      plan.supported.push("external-soft-mask-compositing", "background-preservation");
    } else if (settings.preserveBackground) {
      plan.unsupported.push("strict-background-preservation");
      plan.fallbacks.push("Klein senza maschera conserva lo sfondo solo semanticamente; fornire una maschera abilita la ricomposizione esatta.");
    }
    if (settings.depth) {
      plan.unsupported.push("native-klein-depth-control");
      plan.fallbacks.push("Nessun ControlNet depth FLUX.2 Klein compatibile è stato verificato: uso reference latent e compositing depth-aware solo nel finishing.");
    }
    const light = metric(profile, "lightingProfile.mainDirection", {});
    const lightConfidence = confidence(profile, "lightingProfile.mainDirection");
    if (settings.autoRelighting && lightConfidence > 0.3) {
      plan.promptConditioning.push(`Match the estimated source key-light direction ${JSON.stringify(light)}.`);
      plan.appliedParameters.lightDirectionConfidence = lightConfidence;
    }
    plan.reasons.push("Klein usa il profilo per reference/denoise e un finishing deterministico, senza inventare ControlNet incompatibili.");
    return plan;
  }
}
