import { BaseSceneAdapter } from "./base-adapter.js";

export class GenericComfyUIAdapter extends BaseSceneAdapter {
  plan(input) {
    const plan = super.plan(input);
    plan.supported.push("post-generation-finishing");
    plan.unsupported.push("model-specific-conditioning");
    plan.fallbacks.push("Il generatore non ha un adapter dedicato: vengono usati solo compositing e finishing verificati tramite /object_info.");
    plan.reasons.push("Il Generic Adapter non modifica sampler o conditioning sconosciuti.");
    return plan;
  }
}
