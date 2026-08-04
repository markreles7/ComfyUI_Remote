import { confidence, metric } from "./base-adapter.js";
import { LTXVideoAdapter } from "./ltx-video-adapter.js";

export class SulphurVideoAdapter extends LTXVideoAdapter {
  get id() {
    return "ltx-2-3-sulphur-video";
  }

  get name() {
    return "LTX 2.3 Sulphur Video Adapter";
  }

  plan(input) {
    const plan = super.plan(input);
    const { profile, settings, context = {} } = input;
    plan.supported.push("ltx-sulphur-lora-conditioning", "source-frame-preservation");

    const light = metric(profile, "lightingProfile.mainDirection", {});
    const lightConfidence = confidence(profile, "lightingProfile.mainDirection");
    if (settings.autoRelighting && lightConfidence > 0.25) {
      plan.supported.push("prompt-guided-light-continuity");
      plan.appliedParameters.lightDirection = light;
      plan.appliedParameters.lightDirectionConfidence = lightConfidence;
      plan.promptConditioning.push(
        `For LTX 2.3 Sulphur, preserve and match the source key-light direction ${JSON.stringify(light)}, shadow softness and exposure continuity across every frame.`,
      );
      plan.unsupported = plan.unsupported.filter((item) => item !== "physical-diffusion-relighting");
      plan.fallbacks = plan.fallbacks.filter((item) => !item.includes("Relighting fisico dedicato"));
    }

    if (settings.autoPlacement && !context.maskLink && !context.maskUpload) {
      plan.unsupported = plan.unsupported.filter((item) => item !== "automatic-semantic-placement");
      plan.fallbacks = plan.fallbacks.filter((item) => !item.includes("Posizionamento automatico"));
      plan.supported.push("source-frame-placement-lock");
      plan.reasons.push("LTX 2.3 Sulphur usa il frame sorgente come vincolo di composizione: senza maschera non sposta semanticamente soggetti o sfondo.");
      plan.promptConditioning.push(
        "Keep the source frame composition, subject placement, scale, camera crop and background geometry stable unless the prompt explicitly changes them.",
      );
    }

    plan.reasons.push("Adapter dedicato LTX 2.3 Sulphur: applica vincoli LTX video-safe, prompt conditioning e finishing verificati.");
    return plan;
  }
}
