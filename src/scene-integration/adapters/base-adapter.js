function metric(profile, path, fallback = null) {
  let value = profile;
  for (const key of path.split(".")) value = value?.[key];
  if (value && typeof value === "object" && "value" in value) return value.value;
  return value ?? fallback;
}

function confidence(profile, path, fallback = 0) {
  let value = profile;
  for (const key of path.split(".")) value = value?.[key];
  return Number.isFinite(value?.confidence) ? value.confidence : fallback;
}

export class BaseSceneAdapter {
  constructor({ availableNodes = [] } = {}) {
    this.availableNodes = new Set(availableNodes);
  }

  get id() {
    return "generic";
  }

  get name() {
    return "Generic ComfyUI Adapter";
  }

  get declaredFeatures() {
    return {};
  }

  nodeAvailable(name) {
    return this.availableNodes.has(name);
  }

  commonPlan({ profile, settings, context = {} }) {
    const grain = metric(profile, "textureProfile.finishing.recommendedGrain",
      metric(profile, "textureProfile.grainAmount", 0.04));
    const blur = metric(profile, "textureProfile.finishing.recommendedBlurSigma",
      metric(profile, "cameraProfile.blur", 0));
    const colorConfidence = confidence(profile, "colorProfile.globalContrast", 0.5);
    const hasMask = Boolean(context.maskLink || context.maskUpload);
    const hasSource = Boolean(context.sourceLink || context.sourceInput);
    const blurAllowed = profile.mediaType === "video";
    return {
      adapter: this.id,
      adapterName: this.name,
      mediaType: profile.mediaType,
      supported: [],
      unsupported: [],
      requiredNodes: [],
      missingNodes: [],
      fallbacks: [],
      appliedParameters: {},
      reasons: [],
      controls: {
        matchColor: Boolean(settings.matchColor && hasSource && profile.mediaType === "video"),
        matchBlur: Boolean(blurAllowed && settings.matchBlur && hasSource && Number(blur) > 0.08),
        grainMode: profile.mediaType === "video" ? settings.grainMode : "off",
        preserveBackground: Boolean(settings.preserveBackground && hasMask),
        temporalConsistency: Boolean(settings.temporalConsistency && profile.mediaType === "video"),
        occlusionHandling: Boolean(settings.occlusionHandling && hasMask),
        contactShadows: Boolean(settings.contactShadows && hasMask && context.subjectType !== "person"),
      },
      finishing: {
        colorStrength: Math.max(0.2, Math.min(0.9, 0.45 + colorConfidence * 0.35)),
        blurSigma: blurAllowed ? Math.max(0, Math.min(1.8, Number(blur) || 0)) : 0,
        grainIntensity: settings.grainMode === "custom"
          ? settings.customGrain
          : Math.max(0.003, Math.min(0.08, Number(grain) || 0.04)),
        grainSaturationMix: 0.35,
        contactShadow: {
          opacity: 28,
          distanceX: 10,
          distanceY: 14,
          grow: 5,
          blur: 20,
          color: "#111111",
        },
      },
      promptConditioning: [],
      parameterPolicy: "preserve-native",
    };
  }

  requireNode(plan, node, feature, fallback) {
    plan.requiredNodes.push(node);
    if (this.nodeAvailable(node)) {
      plan.supported.push(feature);
      return true;
    }
    plan.missingNodes.push(node);
    plan.unsupported.push(feature);
    if (fallback) plan.fallbacks.push(fallback);
    return false;
  }

  plan(input) {
    const plan = this.commonPlan(input);
    const hasMask = Boolean(input.context?.maskLink || input.context?.maskUpload);
    if (input.settings.autoPlacement) {
      if (hasMask) {
        plan.supported.push("mask-guided-placement");
        plan.reasons.push("Posizione e scala sono vincolate dalla maschera fornita al workflow.");
      } else {
        plan.unsupported.push("automatic-semantic-placement");
        plan.fallbacks.push("Posizionamento automatico non applicato senza maschera o controllo strutturale compatibile.");
      }
    }
    if (input.settings.autoRelighting) {
      plan.unsupported.push("physical-diffusion-relighting");
      plan.fallbacks.push("Relighting fisico dedicato non disponibile: uso istruzione modello, color transfer e armonizzazione finale dichiarati.");
    }
    if (input.profile.mediaType === "image") {
      plan.reasons.push("Finishing fotografico globale disattivato: armonizzazione e ricomposizione restano confinate al workflow locale mascherato.");
    }
    if (plan.controls.matchColor) {
      this.requireNode(plan, "ColorMatchToReference", "color-reference-finishing",
        "Color matching disattivato: nodo ColorMatchToReference non disponibile.");
    }
    if (plan.controls.matchBlur) {
      this.requireNode(plan, "ImageBlur", "blur-matching",
        "Blur matching disattivato: nodo ImageBlur non disponibile.");
    }
    if (plan.controls.grainMode !== "off") {
      this.requireNode(plan, "FastFilmGrain", "grain-matching",
        "Film grain disattivato: nodo FastFilmGrain non disponibile.");
    }
    if (plan.controls.contactShadows) {
      this.requireNode(plan, "LayerStyle: DropShadow V2", "contact-shadow",
        "Contact shadow non applicata: nodo LayerStyle DropShadow V2 non disponibile.");
    }
    if (plan.controls.occlusionHandling) {
      this.requireNode(plan, "ImageCompositeMasked", "mask-occlusion-compositing",
        "Gestione occlusioni limitata: ImageCompositeMasked non disponibile.");
    }
    plan.appliedParameters = {
      ...plan.appliedParameters,
      colorMatchStrength: plan.finishing.colorStrength,
      blurSigma: plan.finishing.blurSigma,
      grainIntensity: plan.finishing.grainIntensity,
    };
    return plan;
  }
}

export { metric, confidence };
