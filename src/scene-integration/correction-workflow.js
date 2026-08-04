function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

export function buildSceneCorrectionWorkflow({
  resultInput,
  sourceInput,
  nextIntegrationPlan,
  prefix = "SceneIntegration/corrected",
}) {
  if (!resultInput || !sourceInput) throw new Error("Correzione Scene Integration: input mancanti.");
  const plan = nextIntegrationPlan;
  const workflow = {
    "1": node({ image: resultInput }, "LoadImage", "Risultato da correggere"),
    "2": node({ image: sourceInput }, "LoadImage", "Sorgente colore"),
  };
  let image = ["1", 0];
  const applied = [];
  if (plan.controls.matchColor && !plan.missingNodes.includes("ColorMatchToReference")) {
    workflow["10"] = node({
      images: image,
      reference_image: ["2", 0],
      match_strength: plan.finishing.colorStrength,
      batch_size: 1,
    }, "ColorMatchToReference", "Correzione selettiva · colore/luminanza");
    image = ["10", 0];
    applied.push("color-match");
  }
  if (
    plan.mediaType === "video"
    && plan.controls.matchBlur
    && plan.finishing.blurSigma >= 0.15
    && !plan.missingNodes.includes("ImageBlur")
  ) {
    const sigma = Math.max(0.1, Math.min(10, plan.finishing.blurSigma));
    workflow["11"] = node({
      image,
      blur_radius: Math.max(1, Math.min(31, Math.ceil(sigma * 3))),
      sigma,
    }, "ImageBlur", "Correzione selettiva · nitidezza");
    image = ["11", 0];
    applied.push("blur-match");
  }
  if (plan.controls.grainMode !== "off" && !plan.missingNodes.includes("FastFilmGrain")) {
    workflow["12"] = node({
      images: image,
      grain_intensity: plan.finishing.grainIntensity,
      saturation_mix: plan.finishing.grainSaturationMix,
      batch_size: 1,
    }, "FastFilmGrain", "Correzione selettiva · grana");
    image = ["12", 0];
    applied.push("grain-match");
  }
  workflow["20"] = node({
    images: image,
    filename_prefix: prefix,
  }, "SaveImage", "Salva correzione Scene Integration");
  return { workflow, applied };
}
