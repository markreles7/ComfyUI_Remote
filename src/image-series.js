import crypto from "node:crypto";

export const INFLUENCER_COUNTS = Object.freeze([1, 2, 4, 6, 9]);
export const SAME_PLACE_COUNTS = Object.freeze([2, 4, 6, 8]);

export const INFLUENCER_CATALOG = Object.freeze({
  shotTypes: Object.freeze([
    { value: "casual arm-length selfie", group: "selfie", weight: 15 },
    { value: "close-up selfie", group: "selfie", weight: 15 },
    { value: "mirror selfie", group: "mirror", weight: 15 },
    { value: "candid photo taken by another person", group: "otherPerson", weight: 12 },
    { value: "waist-up photo taken by another person", group: "otherPerson", weight: 8 },
    { value: "full body photo", group: "fullBody", weight: 15 },
    { value: "three-quarter body photo", group: "candid", weight: 5 },
    { value: "over-the-shoulder photo", group: "candid", weight: 4 },
    { value: "seated casual photo", group: "candid", weight: 5 },
    { value: "spontaneous candid photo", group: "candid", weight: 6 },
  ]),
  locations: Object.freeze([
    "bedroom", "bathroom", "balcony", "living room", "kitchen", "café", "city street",
    "shopping street", "supermarket", "mall", "park", "beach promenade", "beach",
    "train station", "car passenger seat", "parking area", "hotel room", "restaurant",
  ]),
  poses: Object.freeze([
    "looking into camera", "looking away", "adjusting hair", "touching hair", "holding phone",
    "sitting casually", "walking", "leaning against a wall", "smiling naturally", "laughing",
    "looking over the shoulder", "crossing legs", "resting one arm on a table",
  ]),
  outfits: Object.freeze([
    "fitted t-shirt and denim shorts", "crop top and jeans", "tank top and jeans",
    "oversized sweatshirt and shorts", "hoodie and leggings", "casual summer dress",
    "fitted top and denim skirt", "simple blouse and jeans", "casual homewear",
  ]),
  lighting: Object.freeze([
    "natural daylight", "cloudy daylight", "warm indoor light", "bathroom lighting",
    "evening street lighting", "soft window light", "harsh midday sunlight", "mixed indoor lighting",
  ]),
  cameraStyles: Object.freeze([
    "amateur smartphone photo, casual social media photography, realistic skin texture, slightly imperfect framing, subtle smartphone lens distortion, natural exposure, minor highlight clipping, ordinary lighting, realistic phone HDR, non-professional photography",
    "unpolished phone snapshot, authentic social feed aesthetic, natural skin detail, casual imperfect composition, mild wide-angle phone perspective, automatic exposure, realistic mobile HDR, everyday available light",
    "spontaneous smartphone picture, believable amateur photography, true-to-life skin texture, minor framing imbalance, subtle phone lens artifacts, ordinary exposure, gentle highlight clipping, no studio polish",
    "casual mobile-camera photo, realistic social media snapshot, natural pores and skin detail, slightly off-center framing, restrained computational HDR, practical ambient light, non-commercial photography",
  ]),
});

export const SAME_PLACE_VARIATIONS = Object.freeze({
  poses: Object.freeze([
    "torso slightly turned with a relaxed natural posture",
    "relaxed seated posture in the same position",
    "gentle over-the-shoulder posture",
    "weight shifted naturally to the other leg",
    "shoulders relaxed with a subtle candid lean",
    "upright posture with a small natural body turn",
    "a quiet candid pause without changing position in the scene",
    "a subtle pose adjustment appropriate to the same mini photo session",
  ]),
  expressions: Object.freeze([
    "slight natural smile", "soft spontaneous smile", "neutral relaxed expression",
    "brief candid laugh", "calm thoughtful expression", "gentle confident expression",
  ]),
  gazes: Object.freeze([
    "looking into the camera", "looking slightly away from the camera", "glancing over the shoulder",
    "eyes briefly lowered", "looking toward a nearby point in the same scene",
  ]),
  hands: Object.freeze([
    "one hand touching the hair", "hands repositioned naturally", "one hand resting casually",
    "holding the phone naturally", "one hand lightly touching the outfit",
  ]),
  angles: Object.freeze([
    "a barely perceptible camera angle change", "a subtle eye-level micro-angle change",
    "a very small handheld reframing", "the same framing with a slight lateral camera shift",
  ]),
});

function boundedNumber(value, fallback, min, max, label) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${label} non valido.`);
  return parsed;
}

function choice(values, random) {
  return values[Math.floor(random() * values.length) % values.length];
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function weightedChoice(values, random) {
  const total = values.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of values) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return values.at(-1);
}

function independentSeeds(count, { seedMode = "random", seed, anchorSeed } = {}, random) {
  let base;
  if (seedMode === "fixed") {
    base = boundedNumber(seed, NaN, 0, Number.MAX_SAFE_INTEGER, "Seed fisso");
  } else if (seedMode === "anchor") {
    base = boundedNumber(anchorSeed, NaN, 0, Number.MAX_SAFE_INTEGER, "Seed anchor");
  }
  const seen = new Set();
  return Array.from({ length: count }, (_, index) => {
    let candidate = base === undefined
      ? crypto.randomInt(0, 2 ** 31)
      : (Math.trunc(base) + index * 104729) % Number.MAX_SAFE_INTEGER;
    while (seen.has(candidate)) candidate = (candidate + 1) % Number.MAX_SAFE_INTEGER;
    seen.add(candidate);
    return candidate;
  });
}

function promptParts(parts) {
  return parts.map((part) => String(part || "").trim().replace(/^[,.;\s]+|[,.;\s]+$/g, ""))
    .filter(Boolean).join(", ");
}

export function generateInfluencerPrompt(characterTrigger, options = {}) {
  const random = options.random || Math.random;
  const shot = options.shot || weightedChoice(INFLUENCER_CATALOG.shotTypes, random).value;
  const modular = promptParts([
    characterTrigger,
    shot,
    options.location || choice(INFLUENCER_CATALOG.locations, random),
    options.pose || choice(INFLUENCER_CATALOG.poses, random),
    `wearing ${options.outfit || choice(INFLUENCER_CATALOG.outfits, random)}`,
    options.lighting || choice(INFLUENCER_CATALOG.lighting, random),
    options.cameraStyle || choice(INFLUENCER_CATALOG.cameraStyles, random),
  ]);
  const manual = String(options.manualPrompt || "").trim();
  return manual ? promptParts([characterTrigger, manual, modular.replace(String(characterTrigger || ""), "")]) : modular;
}

export function generateInfluencerBatch(characterTrigger, count, options = {}) {
  if (!INFLUENCER_COUNTS.includes(Number(count))) throw new Error("Numero immagini Influencer non valido.");
  const planningSeed = Number.isSafeInteger(Number(options.planningSeed))
    ? Number(options.planningSeed)
    : crypto.randomInt(0, 2 ** 31);
  const random = seededRandom(planningSeed);
  const minimumDiversity = count >= 6 ? 3 : Math.min(count, 2);
  const locations = shuffle(INFLUENCER_CATALOG.locations, random);
  const outfits = shuffle(INFLUENCER_CATALOG.outfits, random);
  const forcedShots = shuffle(INFLUENCER_CATALOG.shotTypes, random).slice(0, minimumDiversity);
  const seeds = independentSeeds(count, options, random);
  const usedPrompts = new Set();
  const items = [];
  for (let index = 0; index < count; index += 1) {
    let prompt;
    let attempts = 0;
    do {
      const shot = index < forcedShots.length ? forcedShots[index] : weightedChoice(INFLUENCER_CATALOG.shotTypes, random);
      prompt = generateInfluencerPrompt(characterTrigger, {
        random,
        shot: shot.value,
        location: locations[index % locations.length],
        outfit: outfits[index % outfits.length],
        manualPrompt: options.promptMode === "manual" ? options.manualPrompt : "",
      });
      attempts += 1;
    } while (usedPrompts.has(prompt) && attempts < 12);
    usedPrompts.add(prompt);
    items.push({
      index,
      label: `Influencer ${String(index + 1).padStart(2, "0")}`,
      prompt,
      seed: seeds[index],
    });
  }
  return { type: "influencer", count, planningSeed, items };
}

function preservationInstruction(label, value) {
  if (value >= 90) return `preserve the ${label} exactly`;
  if (value >= 70) return `strongly preserve the same ${label}`;
  if (value >= 45) return `keep the ${label} recognizably consistent`;
  return `retain the main visual identity of the ${label}`;
}

function samePlaceVariation(options, index, random) {
  const parts = [];
  if (options.allowPoseChanges !== false) parts.push(choice(SAME_PLACE_VARIATIONS.poses, random));
  if (options.allowExpressionChanges !== false) parts.push(choice(SAME_PLACE_VARIATIONS.expressions, random));
  if (options.allowGazeChanges !== false) parts.push(choice(SAME_PLACE_VARIATIONS.gazes, random));
  if (options.allowHandReposition !== false) parts.push(choice(SAME_PLACE_VARIATIONS.hands, random));
  if (options.allowSmallAngleChanges !== false) parts.push(choice(SAME_PLACE_VARIATIONS.angles, random));
  if (!parts.length) parts.push("a minimal natural micro-adjustment while keeping the composition unchanged");
  return `${parts.join(", ")}; variation ${index + 1}`;
}

export function buildSamePlacePrompt(anchorContext = {}, variation, options = {}) {
  const preserveLocation = boundedNumber(options.preserveLocation, 95, 0, 100, "Preserva luogo");
  const preserveOutfit = boundedNumber(options.preserveOutfit, 95, 0, 100, "Preserva outfit");
  const preserveLighting = boundedNumber(options.preserveLighting, 95, 0, 100, "Preserva luce");
  const preserveFraming = boundedNumber(options.preserveFraming, 90, 0, 100, "Preserva inquadratura");
  const variationStrength = boundedNumber(options.variationStrength, 25, 0, 100, "Forza variazione");
  const strength = variationStrength <= 30 ? "very subtle" : variationStrength <= 60 ? "controlled" : "noticeable but scene-safe";
  const context = promptParts([
    anchorContext.subjectIdentity,
    anchorContext.environmentSummary,
    anchorContext.outfitSummary,
    anchorContext.lightingSummary,
    anchorContext.framingSummary,
  ]);
  return [
    "Use the anchor image as the sole main scene reference.",
    "Preserve the same adult person, the same location, the same background and environment, the same outfit, and the same overall lighting conditions.",
    `${preservationInstruction("location and background", preserveLocation)}; ${preservationInstruction("outfit", preserveOutfit)}; ${preservationInstruction("lighting", preserveLighting)}; ${preservationInstruction("framing", preserveFraming)}.`,
    "Create a new casual social-media-style photo that looks as if it was taken only a few seconds apart in the same mini photo session.",
    `Allow only a ${strength} change in pose, expression, gaze, hand position, or micro camera angle according to the enabled controls.`,
    context ? `Anchor context: ${context}.` : "",
    `Variation: ${variation}.`,
    "Do not replace, redesign, relight, relocate, or progressively reinterpret the scene.",
  ].filter(Boolean).join(" ");
}

export function buildSamePlaceSeriesPrompts(anchorContext, count, options = {}) {
  if (!SAME_PLACE_COUNTS.includes(Number(count))) throw new Error("Numero immagini Same Place non valido.");
  const planningSeed = Number.isSafeInteger(Number(options.planningSeed))
    ? Number(options.planningSeed)
    : crypto.randomInt(0, 2 ** 31);
  const random = seededRandom(planningSeed);
  const seeds = independentSeeds(count, options, random);
  const used = new Set();
  const items = Array.from({ length: count }, (_, index) => {
    let variation;
    let attempts = 0;
    do {
      variation = samePlaceVariation(options, index, random);
      attempts += 1;
    } while (used.has(variation.replace(/; variation \d+$/, "")) && attempts < 12);
    used.add(variation.replace(/; variation \d+$/, ""));
    return {
      index,
      label: `Same Place ${String(index + 1).padStart(2, "0")}`,
      variation,
      prompt: buildSamePlacePrompt(anchorContext, variation, options),
      seed: seeds[index],
    };
  });
  return { type: "samePlace", count, planningSeed, anchorContext, items };
}

export function generateSamePlaceSeries(options = {}) {
  return buildSamePlaceSeriesPrompts(options.anchorContext || {}, Number(options.count), options);
}

function definitionText(name, definition) {
  return [name, definition?.display_name, definition?.name, definition?.category]
    .filter(Boolean).join(" ");
}

export function detectImageSeriesCapabilities(objectInfo = {}) {
  const entries = Object.entries(objectInfo || {});
  const pulidNodes = entries.filter(([name, definition]) => /pulid/i.test(definitionText(name, definition)))
    .map(([name]) => name).sort();
  const insightFaceNodes = entries.filter(([name, definition]) => /insight\s*face/i.test(definitionText(name, definition)))
    .map(([name]) => name).sort();
  const requiredNodes = [
    "PuLIDInsightFaceLoader",
    "PuLIDEVACLIPLoader",
    "PuLIDModelLoader",
    "ApplyPuLIDFlux2",
  ];
  const missingNodes = requiredNodes.filter((name) => !objectInfo?.[name]);
  const modelChoices = objectInfo?.PuLIDModelLoader?.input?.required?.pulid_file?.[0];
  const installedModels = Array.isArray(modelChoices) ? modelChoices.map(String) : [];
  const modelFile = installedModels.find((name) => /pulid_flux2_klein_v2\.safetensors$/i.test(name)) || null;
  const detected = pulidNodes.length > 0 && insightFaceNodes.length > 0;
  const available = missingNodes.length === 0 && Boolean(modelFile);
  return {
    independentJobs: true,
    influencerCounts: [...INFLUENCER_COUNTS],
    samePlaceCounts: [...SAME_PLACE_COUNTS],
    pulidFlux2: {
      detected,
      available,
      pulidNodes,
      insightFaceNodes,
      requiredNodes,
      missingNodes,
      installedModels,
      modelFile,
      provider: "CUDA",
      reason: available
        ? null
        : missingNodes.length
          ? `PuLID Flux.2 non disponibile: /object_info non espone i nodi ${missingNodes.join(", ")}.`
          : "PuLID Flux.2 non disponibile: manca pulid_flux2_klein_v2.safetensors nella cartella models/pulid del pacchetto ComfyUI attivo.",
    },
  };
}
