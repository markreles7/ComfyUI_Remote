function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function uniqueNodeId(workflow, start = 980000) {
  let value = start;
  while (workflow[String(value)]) value += 1;
  return String(value);
}

function isLink(value) {
  return Array.isArray(value) && value.length === 2;
}

function findSourceImageLink(workflow, sourceInput) {
  for (const [id, item] of Object.entries(workflow)) {
    if (item.class_type !== "LoadImage") continue;
    if (sourceInput && String(item.inputs?.image) !== String(sourceInput)) continue;
    return [id, 0];
  }
  return null;
}

function findSourceVideoFrames(workflow) {
  for (const [id, item] of Object.entries(workflow)) {
    if (item.class_type === "GetVideoComponents") return [id, 0];
    if (["VHS_LoadVideo", "VHS_LoadVideoFFmpeg"].includes(item.class_type)) return [id, 0];
  }
  return null;
}

function appendFinishing(workflow, inputLink, referenceLink, plan, batchSize, titlePrefix) {
  let link = inputLink;
  const applied = [];
  if (
    plan.controls.matchColor
    && referenceLink
    && !plan.missingNodes.includes("ColorMatchToReference")
  ) {
    const id = uniqueNodeId(workflow);
    workflow[id] = node({
      images: link,
      reference_image: referenceLink,
      match_strength: plan.finishing.colorStrength,
      batch_size: Math.max(1, Math.min(500, batchSize || 1)),
    }, "ColorMatchToReference", `${titlePrefix} · armonizzazione colore`);
    link = [id, 0];
    applied.push("color-match");
  }
  if (
    plan.mediaType === "video"
    && plan.controls.matchBlur
    && plan.finishing.blurSigma >= 0.15
    && !plan.missingNodes.includes("ImageBlur")
  ) {
    const id = uniqueNodeId(workflow);
    const sigma = Math.max(0.1, Math.min(10, plan.finishing.blurSigma));
    workflow[id] = node({
      image: link,
      blur_radius: Math.max(1, Math.min(31, Math.ceil(sigma * 3))),
      sigma,
    }, "ImageBlur", `${titlePrefix} · armonizzazione nitidezza`);
    link = [id, 0];
    applied.push("blur-match");
  }
  if (
    plan.controls.grainMode !== "off"
    && !plan.missingNodes.includes("FastFilmGrain")
  ) {
    const id = uniqueNodeId(workflow);
    workflow[id] = node({
      images: link,
      grain_intensity: plan.finishing.grainIntensity,
      saturation_mix: plan.finishing.grainSaturationMix,
      batch_size: Math.max(1, Math.min(500, batchSize || 1)),
    }, "FastFilmGrain", `${titlePrefix} · grana finale`);
    link = [id, 0];
    applied.push("grain");
  }
  return { link, applied };
}

function appendPromptConditioning(workflow, lines) {
  const addition = (lines || []).filter(Boolean).join(" ");
  if (!addition) return [];
  const changed = [];
  for (const [id, item] of Object.entries(workflow)) {
    const title = String(item._meta?.title || "").toLowerCase();
    if (!["CLIPTextEncode", "TextEncodeQwenImageEditPlus"].includes(item.class_type)) continue;
    if (/negativ/.test(title)) continue;
    const key = typeof item.inputs?.prompt === "string"
      ? "prompt"
      : typeof item.inputs?.text === "string"
        ? "text"
        : null;
    if (!key) continue;
    item.inputs[key] = `${item.inputs[key]} ${addition}`.trim();
    changed.push(id);
  }
  return changed;
}

function replaceConsumers(workflow, sourceId, replacement, exceptId) {
  for (const [nodeId, item] of Object.entries(workflow)) {
    if (nodeId === exceptId) continue;
    for (const [key, input] of Object.entries(item.inputs || {})) {
      if (isLink(input) && String(input[0]) === String(sourceId) && input[1] === 0) {
        item.inputs[key] = replacement;
      }
    }
  }
}

function applyContactShadowComposites(workflow, plan) {
  if (
    !plan.controls.contactShadows
    || plan.missingNodes.includes("LayerStyle: DropShadow V2")
  ) return [];
  const applied = [];
  const composites = Object.entries(workflow).filter(([, item]) =>
    item.class_type === "ImageCompositeMasked"
    && isLink(item.inputs?.destination)
    && isLink(item.inputs?.source)
    && isLink(item.inputs?.mask)
  );
  for (const [compositeId, composite] of composites) {
    const id = uniqueNodeId(workflow);
    const shadow = plan.finishing.contactShadow;
    workflow[id] = node({
      background_image: composite.inputs.destination,
      layer_image: composite.inputs.source,
      layer_mask: composite.inputs.mask,
      invert_mask: false,
      blend_mode: "normal",
      opacity: shadow.opacity,
      distance_x: shadow.distanceX,
      distance_y: shadow.distanceY,
      grow: shadow.grow,
      blur: shadow.blur,
      shadow_color: shadow.color,
    }, "LayerStyle: DropShadow V2", "Scene Integration · contact shadow");
    replaceConsumers(workflow, compositeId, [id, 0], id);
    applied.push({ compositeNode: compositeId, shadowNode: id });
  }
  return applied;
}

function outputScore(item) {
  const label = `${item?._meta?.title || ""} ${item?.inputs?.filename_prefix || ""}`.toLowerCase();
  let score = 0;
  if (/final|master|enhanced|upscal|output/.test(label)) score += 4;
  if (/original|source|before|preview|bozz|draft|intermediate|reference|debug/.test(label)) score -= 6;
  if (item?.class_type === "CreateVideo") score += 2;
  if (item?.class_type === "VHS_VideoCombine" && item?.inputs?.save_output === false) score -= 20;
  return score;
}

function finalOutputNodes(workflow) {
  const candidates = Object.entries(workflow).filter(([, item]) => {
    if (item.class_type === "SaveImage") return isLink(item.inputs?.images);
    if (item.class_type === "CreateVideo") return isLink(item.inputs?.images);
    return item.class_type === "VHS_VideoCombine"
      && item.inputs?.save_output !== false
      && isLink(item.inputs?.images);
  });
  if (candidates.length <= 1) return candidates;
  const scores = candidates.map(([id, item]) => ({ id, item, score: outputScore(item) }));
  const best = Math.max(...scores.map((entry) => entry.score));
  if (best <= 0) return candidates;
  return scores
    .filter((entry) => entry.score === best)
    .map(({ id, item }) => [id, item]);
}

export function applySceneIntegrationPlan(workflow, {
  plan,
  profile,
  sourceInput = null,
  frameCount = 1,
} = {}) {
  if (!plan || !profile) return {
    applied: false,
    reason: "profile-or-plan-missing",
    nodes: [],
  };
  const sourceImage = findSourceImageLink(workflow, sourceInput);
  const sourceFrames = profile.mediaType === "video" ? findSourceVideoFrames(workflow) : null;
  const reference = sourceFrames || sourceImage;
  const created = [];
  const rewired = [];
  const promptNodes = appendPromptConditioning(workflow, plan.promptConditioning);
  const contactShadows = applyContactShadowComposites(workflow, plan);

  for (const [id, item] of finalOutputNodes(workflow)) {
    let inputName = null;
    if (item.class_type === "SaveImage" && isLink(item.inputs?.images)) inputName = "images";
    if (item.class_type === "CreateVideo" && isLink(item.inputs?.images)) inputName = "images";
    if (item.class_type === "VHS_VideoCombine" && isLink(item.inputs?.images)) inputName = "images";
    if (!inputName) continue;
    const before = new Set(Object.keys(workflow));
    const result = appendFinishing(
      workflow,
      item.inputs[inputName],
      reference,
      plan,
      ["CreateVideo", "VHS_VideoCombine"].includes(item.class_type) ? frameCount : 1,
      profile.mediaType === "video" ? "Scene Integration video" : "Scene Integration immagine",
    );
    item.inputs[inputName] = result.link;
    for (const nodeId of Object.keys(workflow)) {
      if (!before.has(nodeId)) created.push(nodeId);
    }
    if (result.applied.length) rewired.push({ outputNode: id, operations: result.applied });
  }

  plan.appliedParameters.workflowNodes = created;
  plan.appliedParameters.promptNodes = promptNodes;
  plan.appliedParameters.outputRewrites = rewired;
  plan.appliedParameters.contactShadows = contactShadows;
  return {
    applied: created.length > 0 || promptNodes.length > 0 || contactShadows.length > 0,
    nodes: created,
    promptNodes,
    outputRewrites: rewired,
    contactShadows,
    sourceReference: reference,
    warnings: reference ? [] : ["Nessun input originale collegabile al finishing: color matching saltato."],
  };
}
