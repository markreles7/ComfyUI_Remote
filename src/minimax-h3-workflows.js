import crypto from "node:crypto";
import { h3ActionPreset } from "./h3-action-presets.js";

export const MINIMAX_H3_MODES = Object.freeze({
  text: { id: "text", name: "Text to Video", family: "fl2va" },
  image: { id: "image", name: "Single Image to Video", family: "fl2va" },
  firstLast: { id: "firstLast", name: "First / Last Frame to Video", family: "fl2va" },
  references: { id: "references", name: "Multi Reference to Video", family: "ref2va" },
});

const ASPECTS = new Set([
  "16:9 (Widescreen)",
  "9:16 (Portrait Widescreen)",
  "1:1 (Square)",
  "4:3 (Standard)",
  "3:4 (Portrait Standard)",
  "2:3 (Portrait Photo)",
  "3:2 (Photo)",
]);

const REALISM_DIRECTIONS = Object.freeze({
  neutral: "",
  documentary: "REALISM DIRECTION: Observational documentary footage, restrained small-amplitude handheld tracking at normal speed, practical available light, natural skin texture, ordinary wardrobe wrinkles, subtle sensor grain and unpolished human timing. Keep physical continuity and avoid beauty retouching, glossy commercial lighting, perfect gimbal motion or exaggerated camera shake.",
  amateurHandheld: "REALISM DIRECTION: Credible amateur footage captured by a real person holding a consumer camera. Use irregular but controlled small-amplitude handheld movement at normal speed, occasional imperfect reframing, brief autofocus correction, subtle auto-exposure breathing, mild rolling shutter during faster movement, natural motion blur, modest sensor noise and compression texture. Use practical uneven light, realistic skin pores, minor clothing wrinkles and unscripted micro-pauses. Avoid polished advertising light, flawless stabilization, excessive bokeh, speed ramps, plastic skin or synthetic random jitter.",
  phoneSelfie: "REALISM DIRECTION: Authentic consumer-phone selfie video held at arm's length, natural wide-angle perspective, imperfect centering, small wrist corrections, restrained stabilization, brief autofocus and auto-exposure adjustment, limited highlight roll-off, realistic phone sharpening and compression. Natural blinking, breathing and conversational pauses; no beauty filter, studio key light, perfect gimbal movement or artificial shake.",
});

const SCENE_PRESET_DIRECTIONS = Object.freeze({
  none: "",
  fantasyVerite: "SCENE PRESET: Naturalistic fantasy-verite footage. Treat the source frame as authoritative for the adult subject's identity, facial anatomy, freckles, hair color and streak, body proportions, worn leather-and-cloth wardrobe, jewelry, weapons, forest environment, practical light, lens perspective and close arm's-length composition. Extend only physically plausible off-frame details. Favor an unhurried walk, natural blinking and breathing, tiny gaze shifts, one restrained expression change, subtle hair, cloth, pendant and pouch response, coherent background parallax and small wrist corrections. Preserve ordinary imperfections: uneven available light, brief focus correction, gentle exposure drift, normal motion blur, modest sensor grain and compression. Keep the take continuous and lived-in. No epic CGI gloss, magical glow, beauty filter, fashion posing, perfect gimbal, synthetic shake, scene replacement, identity drift, face morphing, wardrobe mutation, duplicated props or newly invented people.",
  urbanPhoneDiary: "SCENE PRESET: Authentic urban phone diary. Keep the adult speaker, clothing and location continuous while they walk or pause naturally and address the phone in one uninterrupted take. Use arm's-length wide-angle perspective, imperfect centering, small wrist corrections, ordinary street lighting, realistic background pedestrians and traffic, restrained stabilization, phone autofocus and exposure adaptation, natural conversational timing and synchronized native audio. Avoid influencer-ad gloss, beauty filters, perfect skin, choreographed gestures, gimbal movement, synthetic camera shake, scene changes, subtitles or identity drift.",
  documentaryPortrait: "SCENE PRESET: Observational documentary portrait. Let the adult subject perform one simple believable activity with unforced micro-expressions, breathing, glances and pauses. Use practical available light, modest depth of field, restrained human-operated framing, realistic textures, normal motion blur, subtle sensor noise and coherent diegetic sound. Preserve anatomy, wardrobe, props and spatial continuity. Avoid commercial polish, heroic posing, beauty retouching, dramatic CGI lighting, excessive bokeh, speed ramps, cuts or invented events.",
  dynamicTracking: "SCENE PRESET: Energetic but credible tracking shot. Follow one clearly defined adult subject through one continuous physical action with readable acceleration, foot placement, balance, inertia, cloth and hair response, coherent parallax and a stable ending. The camera operator reacts a fraction late and makes small framing corrections while keeping the subject readable. Preserve identity, outfit, environment and object continuity. Avoid teleporting, floaty motion, impossible speed, random shake, speed ramps, morphing, duplicated limbs, discontinuous backgrounds or music-video gloss.",
});

const ACTION_ANIME_STYLE_LOCK = "ANIME STYLE LOCK: Treat the supplied frame's drawing style as binding and preserve a hand-drawn 2D Japanese TV-anime look from the first frame through the last. Keep clean inked contours, flat cel-shaded color regions, graphic shadow shapes, limited material reflections and painted background treatment. Do not transition toward volumetric 3D, photorealism, CGI, game-engine rendering, plastic skin or physically based materials.";

const H3_BASE_FIELDS = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
const H3_REFERENCE_FIELDS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];

function parseH3PromptFields(source, fields) {
  const aliases = fields.map((field) => field.split("_").join("[\\s_-]+")).join("|");
  const matches = [...String(source || "").matchAll(new RegExp(`\\b(${aliases})\\s*([:\\[])`, "giu"))];
  const parsed = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = match[1].toLocaleLowerCase().replace(/[\s-]+/g, "_");
    const end = matches[index + 1]?.index ?? source.length;
    let value = source.slice(match.index + match[0].length, end).trim();
    if (match[2] === "[") value = value.replace(/\]\s*$/u, "").trim();
    parsed[key] = value;
  }
  return parsed;
}

function ensureFirstShot(body) {
  const value = String(body || "").trim();
  if (/\[Shot\s+1\]/iu.test(value)) return value;
  const triggerPrefix = value.match(/^([\p{L}\p{N}_-]+(?:\s*,\s*[\p{L}\p{N}_-]+)*\.\s+)/u);
  return triggerPrefix
    ? `${triggerPrefix[1]}[Shot 1] ${value.slice(triggerPrefix[0].length).trim()}`
    : `[Shot 1] ${value}`.trim();
}

function finalShotNumber(body) {
  const numbers = [...String(body || "").matchAll(/\[Shot\s+(\d+)\]/giu)].map((match) => Number(match[1]));
  return Math.max(1, ...numbers.filter(Number.isFinite));
}

function formatH3ThreeFieldPrompt(rawPrompt, {
  triggers = [], directives = [], mode = "text", effectiveDuration = 0,
} = {}) {
  const source = String(rawPrompt || "").trim().replace(/\\([_<>{}\[\]])/gu, "$1");
  const fields = parseH3PromptFields(source, mode === "references" ? H3_REFERENCE_FIELDS : H3_BASE_FIELDS);
  const baseFields = mode === "references" ? parseH3PromptFields(source, H3_BASE_FIELDS) : fields;
  let integrated = ensureFirstShot(mode === "references"
    ? fields.detailed_description || baseFields.integrated_multimodal_description || source
    : fields.integrated_multimodal_description || source);
  const selectedTriggers = [...new Set(triggers.map((item) => String(item || "").trim()).filter(Boolean))];
  for (const trigger of [...selectedTriggers].reverse()) {
    if (!integrated.toLocaleLowerCase().includes(trigger.toLocaleLowerCase())) {
      integrated = `${trigger}.${integrated ? ` ${integrated}` : ""}`;
    }
  }
  const alignment = mode === "image"
    ? "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced."
    : mode === "firstLast"
      ? `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${finalShotNumber(integrated)}) aligns with the ${Number(effectiveDuration).toFixed(2)}-second mark of the target video.`
      : "";
  const additions = directives.map((item) => String(item || "").trim()).filter(Boolean);
  if (additions.length) integrated = `${integrated}${integrated ? " " : ""}${additions.join(" ")}`;
  if (mode === "references") {
    return [
      `subject_definitions: ${fields.subject_definitions || "Referenced subjects use the supplied reference labels according to their stated roles."}`,
      `summary: ${fields.summary || "[reference generation] The target video follows the supplied reference roles and requested action."}`,
      `retention_analysis: ${fields.retention_analysis || "Supplied reference roles are preserved according to the user request."}`,
      `detailed_description: ${integrated}`,
      `overall_soundscape: ${fields.overall_soundscape || baseFields.overall_soundscape || "N/A"}`,
      `non_diegetic_music: ${fields.non_diegetic_music || baseFields.non_diegetic_music || "N/A"}`,
    ].join("\n\n");
  }
  const formatted = [
    `integrated_multimodal_description: ${integrated}`,
    `overall_soundscape: ${fields.overall_soundscape || "N/A"}`,
    `non_diegetic_music: ${fields.non_diegetic_music || "N/A"}`,
  ].join("\n\n");
  return alignment ? `${alignment}\n\n${formatted}` : formatted;
}

function inputPath(upload) {
  if (!upload?.name) return "";
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["true", "1", "on"].includes(String(value).toLowerCase());
}

function number(value, fallback, min, max, integer = false) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error("Impostazione MiniMax H3 non valida.");
  }
  return parsed;
}

function framesForDuration(value) {
  const duration = number(value, 5, 4, 15);
  const frames = Math.max(5, Math.round(duration * 24));
  return frames + ((5 - (frames % 17)) % 17);
}

function seedValue(value) {
  const normalized = value == null ? "" : String(value).trim();
  if (!normalized || ["random", "casuale", "null", "undefined"].includes(normalized.toLowerCase())) {
    return crypto.randomInt(0, 2 ** 31);
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : crypto.randomInt(0, 2 ** 31);
}

function node(classType, inputs, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function requireUpload(upload, message) {
  if (!upload?.name) throw new Error(message);
  return upload;
}

function addModelLora(workflow, id, modelLink, loraName, strength, title) {
  workflow[id] = node("LoraLoaderModelOnly", {
    model: modelLink,
    lora_name: loraName,
    strength_model: strength,
  }, title);
  return [id, 0];
}

function addLoadImage(workflow, id, upload, title) {
  workflow[id] = node("LoadImage", { image: inputPath(upload) }, title);
  return [id, 0];
}

function addReferenceVideo(workflow, id, upload, title) {
  workflow[id] = node("VHS_LoadVideo", {
    video: inputPath(upload),
    force_rate: 0,
    custom_width: 0,
    custom_height: 0,
    frame_load_cap: 0,
    skip_first_frames: 0,
    select_every_nth: 1,
    format: "AnimateDiff",
  }, title);
  return { frames: [id, 0], audio: [id, 2] };
}

function addReferenceAudio(workflow, id, upload, title) {
  workflow[id] = node("LoadAudio", { audio: inputPath(upload) }, title);
  return [id, 0];
}

function outputNode(prefix, images, audio) {
  return node("VHS_VideoCombine", {
    images,
    audio,
    frame_rate: 24,
    loop_count: 0,
    filename_prefix: prefix,
    format: "video/h264-mp4",
    pix_fmt: "yuv420p",
    crf: 19,
    save_metadata: true,
    trim_to_audio: false,
    pingpong: false,
    save_output: true,
  }, "MiniMax H3 · salva video e audio");
}

export function buildMiniMaxH3Workflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const h3 = config?.h3;
  if (!h3?.available) throw new Error(h3?.reason || "MiniMax H3 non è disponibile nell’istanza ComfyUI attiva.");
  const mode = String(raw.h3Mode || "text");
  const definition = MINIMAX_H3_MODES[mode];
  if (!definition) throw new Error("Modalità MiniMax H3 non riconosciuta.");
  const files = h3.files;
  const requestedModelProfile = String(raw.h3ModelProfile || "base");
  const modelProfile = ["erosMax", "pinkCherry"].includes(requestedModelProfile)
    ? requestedModelProfile
    : "base";
  const erosMax = modelProfile === "erosMax";
  const pinkCherry = modelProfile === "pinkCherry";
  if (erosMax && !files.erosMax) {
    throw new Error("H3 Eros Max beta3 non è installato nell’istanza ComfyUI attiva.");
  }
  if (erosMax && mode === "firstLast") {
    throw new Error("H3 Eros Max beta3 non supporta First / Last Frame: usa Text to Video, Single Image come Picture 1 Ref2VA oppure Multi Reference.");
  }
  if (pinkCherry && !files.pinkCherry) {
    throw new Error("PinkCherry H3 FL2VA 0.6 beta non è installato nell’istanza ComfyUI attiva.");
  }
  if (pinkCherry && mode === "references") {
    throw new Error("PinkCherry 0.6 beta è un modello FL2VA: usa Text to Video, Single Image o First / Last Frame.");
  }
  const effectiveFamily = erosMax && mode === "image" ? "ref2va" : definition.family;
  const promptMode = erosMax && mode === "image" ? "references" : mode;
  const actionProfile = raw.h3Profile === "action";
  const weaponProfile = raw.h3Profile === "weapon";
  const combatProfile = actionProfile || weaponProfile;
  const actionLoraType = actionProfile && raw.actionH3PrimaryLora === "weapon" ? "weapon" : actionProfile ? "combat" : weaponProfile ? "weapon" : "combat";
  const profileName = weaponProfile ? "Weapon Combat" : actionProfile ? "ACTION H3" : "MiniMax H3";
  if (combatProfile && (erosMax || pinkCherry)) throw new Error(`${profileName} usa il checkpoint Hybrid b25-49 dedicato.`);
  if (weaponProfile && definition.family !== "fl2va") {
    throw new Error(`${profileName} supporta soltanto Text to Video, Single Image e First / Last Frame FL2VA.`);
  }
  const selectedActionPreset = actionProfile ? h3ActionPreset(raw.actionH3Preset, actionLoraType) : h3ActionPreset("custom");
  const actionTrigger = actionProfile
    ? actionLoraType === "weapon"
      ? "BUNNY"
      : ["prfight2", "prfight2, prfin1"].includes(String(raw.actionH3Trigger))
        ? String(raw.actionH3Trigger)
        : selectedActionPreset.trigger || ""
    : "";
  const motionRepairEnabled = combatProfile && bool(raw.h3MotionRepair, false);
  const motionRepairTrigger = motionRepairEnabled && bool(raw.h3MotionRepairTrigger, true)
    ? "bunny_crisp_motion"
    : "";
  const userPrompt = String(raw.prompt || "").trim();
  if (!userPrompt) throw new Error(`Inserisci un prompt ${profileName}.`);
  const lookPreset = Object.hasOwn(REALISM_DIRECTIONS, String(raw.h3LookPreset))
    ? String(raw.h3LookPreset)
    : "neutral";
  const scenePreset = Object.hasOwn(SCENE_PRESET_DIRECTIONS, String(raw.h3ScenePreset))
    ? String(raw.h3ScenePreset)
    : "none";
  const actionPreset = actionProfile ? selectedActionPreset.id : "custom";
  const flatAnimeSelected = actionProfile && loras.some((selected) =>
    /(?:^|[\\/])STY_Flat_Anime_H3\.safetensors$/i.test(String(selected.name || ""))
  );
  const duration = number(raw.duration, 5, 4, 15);
  const length = framesForDuration(duration);
  const prompt = formatH3ThreeFieldPrompt(userPrompt, {
    triggers: [actionTrigger, weaponProfile ? "BUNNY" : "", motionRepairTrigger].filter(Boolean),
    directives: [flatAnimeSelected ? ACTION_ANIME_STYLE_LOCK : "", selectedActionPreset.direction, SCENE_PRESET_DIRECTIONS[scenePreset], REALISM_DIRECTIONS[lookPreset]],
    mode: promptMode,
    effectiveDuration: (length - 1) / 24,
  });
  const seed = seedValue(raw.seed);
  const aspectRatio = ASPECTS.has(String(raw.h3AspectRatio))
    ? String(raw.h3AspectRatio)
    : "16:9 (Widescreen)";
  const requestedRunProfile = String(raw.h3RunProfile);
  const runProfile = ["preview", "seedCandidate"].includes(requestedRunProfile) ? requestedRunProfile : "nativeFinal";
  const legacySecondPass = bool(raw.h3SecondPass, true);
  const requestedRefineMode = String(raw.h3RefineMode || (legacySecondPass ? "h3Maximum" : "direct"));
  const refineModes = new Set(["latentLearned", "h3Balanced", "h3Maximum", "seedvr2", "rtx", "direct"]);
  const refineMode = ["preview", "seedCandidate"].includes(runProfile)
    ? "direct"
    : refineModes.has(requestedRefineMode) ? requestedRefineMode : "h3Balanced";
  if (h3.refineAvailability?.[refineMode] === false) {
    throw new Error(`Il refine ${refineMode} non è disponibile nell’istanza ComfyUI attiva.`);
  }
  const secondPass = ["latentLearned", "h3Balanced", "h3Maximum"].includes(refineMode);
  const postRefine = ["seedvr2", "rtx"].includes(refineMode);
  const nativeUseTurbo = erosMax || pinkCherry ? false : bool(raw.h3UseTurbo, true);
  // Ogni percorso rispetta l'interruttore: Turbo OFF significa davvero nessun
  // loader Turbo, sampling nativo a 25 step e canvas iniziale da 0,9 MP.
  const useTurbo = pinkCherry ? false : erosMax || nativeUseTurbo;
  const firstMegapixels = runProfile === "preview"
    ? useTurbo ? 0.4 : 0.9
    : runProfile === "seedCandidate"
      ? useTurbo ? 0.25 : 0.9
      : !useTurbo ? 0.9 : number(raw.h3FirstMegapixels, refineMode === "direct" ? 0.9 : 0.6, 0.2, 1);
  const secondMegapixels = refineMode === "h3Balanced"
    ? 0.9
    : number(raw.h3SecondMegapixels, 1, firstMegapixels, 1);
  const secondSteps = ["latentLearned", "h3Balanced"].includes(refineMode) ? 3 : 4;
  const secondDenoise = refineMode === "latentLearned" ? 0.2 : refineMode === "h3Balanced" ? 0.15 : 0.2;
  const requestedAttentionBackend = String(raw.h3AttentionBackend || "memoryEfficient");
  const attentionBackend = requestedAttentionBackend === "comfyKitchen" ? "comfyKitchen" : "memoryEfficient";
  if (attentionBackend === "comfyKitchen" && h3.attentionAvailability?.comfyKitchen === false) {
    throw new Error("Comfy-Kitchen Attention non è disponibile nell’istanza ComfyUI attiva.");
  }
  // L'anteprima e' volutamente economica, ma la ricetta conserva la scelta
  // nativa per la rigenerazione finale con lo stesso seed.
  const externalTurbo = useTurbo && !erosMax;
  const purgeBetween = (secondPass || postRefine) && bool(raw.h3PurgeBetween, true);
  const purgeAfter = bool(raw.h3PurgeAfter, true);
  const refImageSize = raw.h3ReferenceSize === "max" ? "max" : "match";
  if (actionProfile && actionLoraType === "combat" && !files.combat) throw new Error("La LoRA Combat V2 richiesta da ACTION H3 non è installata.");
  if (actionProfile && actionLoraType === "weapon" && !files.weaponCombat) throw new Error("La LoRA Weapon Combat richiesta da ACTION H3 non è installata.");
  if (actionProfile && !files.hybridB25) throw new Error("Il checkpoint Hybrid b25-49 richiesto da ACTION H3 non è installato.");
  if (weaponProfile && !files.weaponCombat) throw new Error("La LoRA Weapon Combat richiesta non è installata.");
  if (motionRepairEnabled && !files.motionRepair) throw new Error("La LoRA Motion Continuity Repair richiesta non è installata.");
  const modelName = erosMax
    ? files.erosMax
    : pinkCherry
      ? files.pinkCherry
      : actionProfile
        ? files.hybridB25
        : effectiveFamily === "fl2va" ? files.fl2va : files.ref2va;
  const galaxyAceSelected = loras.some((selected) => /(?:^|[\\/])STY_GalaxyAce\.safetensors$/i.test(selected.name));
  if (pinkCherry && galaxyAceSelected) {
    throw new Error("GalaxyAce non è compatibile con PinkCherry INT8 unpruned: usa MiniMax H3 base oppure Eros Max.");
  }
  const workflow = {
    "1": node("CLIPLoader", { clip_name: files.clip, type: "minimax", device: "default" }, "MiniMax H3 · Qwen3-VL INT8"),
    "2": node("VAELoader", { vae_name: files.videoVae }, "MiniMax H3 · Video VAE"),
    "3": node("VAELoader", { vae_name: files.audioVae }, "MiniMax H3 · Audio VAE"),
    "4": node("UNETLoader", { unet_name: modelName, weight_dtype: "default" }, erosMax
      ? "H3 Eros Max beta3 · INT8 ConvRot"
      : pinkCherry
        ? "PinkCherry H3 FL2VA 0.6 beta · INT8 unpruned"
        : actionProfile
          ? "ACTION H3 · Hybrid FL2VA/Ref2VA b25-49 INT8"
          : `MiniMax H3 · ${effectiveFamily.toUpperCase()} INT8`),
    "5": attentionBackend === "comfyKitchen"
      ? node("ModelAttentionBackend", { model: ["4", 0], attention: "comfy kitchen attention" }, "MiniMax H3 · Comfy-Kitchen Attention")
      : node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: ["4", 0] }, "MiniMax H3 · Memory Efficient SageAttention"),
    "20": node("ResolutionSelector", { aspect_ratio: aspectRatio, megapixels: firstMegapixels, multiple: 32 }, "MiniMax H3 · risoluzione primo sampling"),
  };

  let modelLink = ["5", 0];
  let nextLoraId = 10;
  if (externalTurbo) {
    if (!files.turbo) throw new Error("La Turbo LoRA MiniMax H3 configurata non è installata.");
    modelLink = addModelLora(workflow, String(nextLoraId++), modelLink, files.turbo, 1, "MiniMax H3 · Turbo 8 step");
  }
  const automaticProfileLora = actionProfile
    ? actionLoraType === "weapon" ? files.weaponCombat : files.combat
    : weaponProfile ? files.weaponCombat : null;
  const selectedLoras = combatProfile
    ? loras.filter((selected) => ![files.combat, files.weaponCombat, files.motionRepair].filter(Boolean).includes(selected.name))
    : loras;
  if (actionProfile) {
    modelLink = addModelLora(
      workflow,
      String(nextLoraId++),
      modelLink,
      automaticProfileLora,
      number(raw.actionH3CombatStrength, selectedActionPreset.strength || 0.8, 0, 1.5),
      actionLoraType === "weapon" ? "ACTION H3 · Weapon Combat BUNNY" : "ACTION H3 · Combat Base V2",
    );
  }
  if (weaponProfile) {
    modelLink = addModelLora(
      workflow,
      String(nextLoraId++),
      modelLink,
      files.weaponCombat,
      number(raw.weaponCombatStrength, 0.8, 0, 1.5),
      "Weapon Combat H3 · BUNNY",
    );
  }
  if (motionRepairEnabled) {
    modelLink = addModelLora(
      workflow,
      String(nextLoraId++),
      modelLink,
      files.motionRepair,
      number(raw.h3MotionRepairStrength, 0.6, 0, 1.5),
      `${profileName} · Motion Continuity Repair · passaggio 1`,
    );
  }
  for (const selected of selectedLoras) {
    modelLink = addModelLora(
      workflow,
      String(nextLoraId++),
      modelLink,
      selected.name,
      number(selected.strength, 0.8, -2, 2),
      `MiniMax H3 · ${selected.name}`,
    );
  }

  let conditioningLink;
  let latentLink;
  if (effectiveFamily === "fl2va") {
    const inputs = {
      clip: ["1", 0],
      vae: ["2", 0],
      prompt,
      width: ["20", 0],
      height: ["20", 1],
      length,
    };
    if (mode === "image") {
      inputs.first_frame = addLoadImage(workflow, "21", requireUpload(uploads.h3FirstFrame, "Carica l’immagine iniziale per Single Image to Video."), "MiniMax H3 · immagine iniziale");
    }
    if (mode === "firstLast") {
      inputs.first_frame = addLoadImage(workflow, "21", requireUpload(uploads.h3FirstFrame, "Carica il primo fotogramma."), "MiniMax H3 · primo fotogramma");
      inputs.last_frame = addLoadImage(workflow, "22", requireUpload(uploads.h3LastFrame, "Carica l’ultimo fotogramma."), "MiniMax H3 · ultimo fotogramma");
    }
    workflow["25"] = node("MiniMaxH3ImageToVideo", inputs, `MiniMax H3 · ${definition.name}`);
    conditioningLink = ["25", 0];
    latentLink = ["25", 1];
  } else {
    const images = mode === "image"
      ? [requireUpload(uploads.h3FirstFrame, "Carica l’immagine da usare come Picture 1 Ref2VA per H3 Eros Max.")]
      : uploads.h3ReferenceImages || [];
    const videos = uploads.h3ReferenceVideos || [];
    const audios = uploads.h3ReferenceAudios || [];
    if (!images.length && !videos.length && !audios.length) {
      throw new Error("Carica almeno una reference immagine, video o audio per Reference to Video.");
    }
    if (images.length > 9 || videos.length > 3 || audios.length > 3) {
      throw new Error("MiniMax H3 accetta massimo 9 immagini, 3 video e 3 audio reference.");
    }
    const inputs = {
      clip: ["1", 0],
      vae: ["2", 0],
      audio_vae: ["3", 0],
      prompt,
      width: ["20", 0],
      height: ["20", 1],
      length,
      ref_image_size: refImageSize,
    };
    images.forEach((upload, index) => {
      inputs[`ref_images.ref_image_${index}`] = addLoadImage(workflow, String(60 + index), upload, `MiniMax H3 · Picture ${index + 1}`);
    });
    videos.forEach((upload, index) => {
      const loaded = addReferenceVideo(workflow, String(70 + index), upload, `MiniMax H3 · Video ${index + 1}`);
      inputs[`ref_videos.ref_video_${index}`] = loaded.frames;
      inputs[`ref_video_audios.ref_video_audio_${index}`] = loaded.audio;
    });
    audios.forEach((upload, index) => {
      inputs[`ref_audios.ref_audio_${index}`] = addReferenceAudio(workflow, String(80 + index), upload, `MiniMax H3 · Audio ${index + 1}`);
    });
    workflow["25"] = node("MiniMaxH3ReferenceToVideo", inputs, mode === "image" ? "H3 Eros Max · Single Image come Picture 1 Ref2VA" : `${erosMax ? "H3 Eros Max" : "MiniMax H3"} · Multi Reference to Video`);
    conditioningLink = ["25", 0];
    latentLink = ["25", 1];
  }

  workflow["30"] = node("RandomNoise", { noise_seed: seed }, "MiniMax H3 · seed primo sampling");
  workflow["31"] = node("BasicGuider", { model: modelLink, conditioning: conditioningLink }, "MiniMax H3 · guider primo sampling");
  const samplerName = String(raw.h3SamplerName || (erosMax ? "er_sde" : combatProfile ? "res_multistep" : "euler"));
  const schedulerName = String(raw.h3SchedulerName || (erosMax || combatProfile ? "simple" : "beta"));
  workflow["32"] = node("KSamplerSelect", { sampler_name: samplerName }, `MiniMax H3 · ${samplerName}`);
  const firstSteps = number(raw.h3FirstSteps, erosMax ? 6 : useTurbo ? 8 : 25, 1, 50);
  workflow["33"] = node("BasicScheduler", { model: modelLink, scheduler: schedulerName, steps: firstSteps, denoise: 1 }, "MiniMax H3 · scheduler primo sampling");
  workflow["34"] = node("SamplerCustomAdvanced", { noise: ["30", 0], guider: ["31", 0], sampler: ["32", 0], sigmas: ["33", 0], latent_image: latentLink }, "MiniMax H3 · primo sampling");
  workflow["35"] = node("VAEDecode", { samples: ["34", 0], vae: ["2", 0] }, "MiniMax H3 · decode video primo sampling");
  workflow["36"] = node("VAEDecodeAudio", { samples: ["34", 0], vae: ["3", 0] }, "MiniMax H3 · decode audio primo sampling");

  let outputId;
  if (secondPass || postRefine) {
    let firstPassImages = ["35", 0];
    let firstPassAudio = ["36", 0];
    if (purgeBetween) {
      const purgeInputs = {
        purge_cache: true,
        purge_models: true,
        purge_seedvr2_models: false,
        purge_qwen3vl_models: true,
        purge_nunchaku_models: false,
        HSWQ: false,
        Ollama: false,
      };
      workflow["37"] = node("DisTorchPurgeVRAMV2", { anything: firstPassImages, ...purgeInputs }, "MiniMax H3 · scarica modello/VAE dopo il video");
      workflow["38"] = node("DisTorchPurgeVRAMV2", { anything: firstPassAudio, ...purgeInputs }, "MiniMax H3 · scarica modello/VAE dopo l'audio");
      firstPassImages = ["37", 0];
      firstPassAudio = ["38", 0];
    }
    if (refineMode === "rtx") {
      const preserveOrganicTexture = ["documentary", "amateurHandheld", "phoneSelfie"].includes(lookPreset);
      workflow["41"] = node("DaSiWa_RTX_UpscalerRefiner", {
        images: firstPassImages,
        denoise: !preserveOrganicTexture,
        denoise_quality: "Medium",
        deblur: true,
        deblur_quality: "Medium",
        upscale: "VSR",
        upscale_quality: "Ultra",
        resize_type: "Keep Ratio",
        scale: 1.5,
        megapixels: 1,
        width: 1920,
        height: 1080,
        divisible_by: "32",
        ratio_preset: "16:9",
        resize_method: "Center Crop (Fill)",
        device_id: 0,
      }, "MiniMax H3 · refine RTX VSR rapido");
      workflow["52"] = outputNode(`VideoStudio/${weaponProfile ? "WeaponCombat" : actionProfile ? "ActionH3" : "MiniMaxH3"}/${mode}_rtx`, ["41", 0], firstPassAudio);
      outputId = "52";
    } else if (refineMode === "seedvr2") {
      const seedvrResolution = number(raw.h3SeedvrResolution, 768, 360, 1080);
      workflow["40"] = node("SeedVR2LoadDiTModel", {
        model: "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
        device: "cuda:0",
        blocks_to_swap: 24,
        swap_io_components: true,
        offload_device: "cpu",
        cache_model: false,
        attention_mode: "sdpa",
      }, "MiniMax H3 · SeedVR2 3B FP8");
      workflow["41"] = node("SeedVR2LoadVAEModel", {
        model: "ema_vae_fp16.safetensors",
        device: "cuda:0",
        encode_tiled: true,
        encode_tile_size: 768,
        encode_tile_overlap: 96,
        decode_tiled: true,
        decode_tile_size: 768,
        decode_tile_overlap: 96,
        tile_debug: "false",
        offload_device: "cpu",
        cache_model: false,
      }, "MiniMax H3 · SeedVR2 VAE tiled");
      workflow["42"] = node("SeedVR2VideoUpscaler", {
        image: firstPassImages,
        dit: ["40", 0],
        vae: ["41", 0],
        seed,
        resolution: seedvrResolution,
        max_resolution: 1920,
        batch_size: 5,
        uniform_batch_size: true,
        color_correction: "lab",
        temporal_overlap: 2,
        prepend_frames: 0,
        input_noise_scale: 0,
        latent_noise_scale: 0,
        offload_device: "cpu",
        enable_debug: false,
      }, "MiniMax H3 · refine definizione SeedVR2");
      workflow["52"] = outputNode(`VideoStudio/${weaponProfile ? "WeaponCombat" : actionProfile ? "ActionH3" : "MiniMaxH3"}/${mode}_seedvr2`, ["42", 0], firstPassAudio);
      outputId = "52";
    } else {
    workflow["40"] = node("ResolutionSelector", { aspect_ratio: aspectRatio, megapixels: secondMegapixels, multiple: 32 }, "MiniMax H3 · risoluzione secondo sampling");
    let secondConditioningLink = conditioningLink;
    if (effectiveFamily === "fl2va" && mode !== "text") {
      const secondConditioningInputs = {
        clip: ["1", 0],
        vae: ["2", 0],
        prompt,
        width: ["40", 0],
        height: ["40", 1],
        length,
      };
      if (mode === "image") secondConditioningInputs.first_frame = ["21", 0];
      if (mode === "firstLast") {
        secondConditioningInputs.first_frame = ["21", 0];
        secondConditioningInputs.last_frame = ["22", 0];
      }
      workflow["54"] = node(
        "MiniMaxH3ImageToVideo",
        secondConditioningInputs,
        "MiniMax H3 · conditioning seconda risoluzione",
      );
      secondConditioningLink = ["54", 0];
    }
    if (refineMode === "latentLearned") {
      if (!files.latentUpscaler) throw new Error("Manca minimax_h3_latent_upscaler_3d_bf16.safetensors.");
      workflow["41"] = node("LTXVSeparateAVLatent", { av_latent: ["34", 0] }, "Seed Hunter · separa latenti video/audio");
      workflow["42"] = node("MinimaxH3LatentUpscaler3D", {
        latent: ["41", 0],
        model_name: files.latentUpscaler,
        mode: "megapixels",
        "mode.megapixels": secondMegapixels,
        align: 32,
        enable_chunking: true,
        device: "cuda",
        precision: "fp16",
      }, "Seed Hunter · learned latent upscale 3D");
      workflow["44"] = node("LTXVConcatAVLatent", { video_latent: ["42", 0], audio_latent: ["41", 1] }, "Seed Hunter · ricompone latenti AV");
    } else {
    workflow["41"] = node("ImageResizeKJv2", {
      image: firstPassImages,
      width: ["40", 0],
      height: ["40", 1],
      upscale_method: "nvidia_rtx_vsr",
      keep_proportion: "crop",
      pad_color: "0, 0, 0",
      crop_position: "center",
      divisible_by: 0,
      device: "cpu",
    }, "MiniMax H3 · upscale al secondo sampling");
    workflow["42"] = node("VAEEncode", { pixels: ["41", 0], vae: ["2", 0] }, "MiniMax H3 · re-encode video");
    workflow["43"] = node("VAEEncodeAudio", { audio: firstPassAudio, vae: ["3", 0] }, "MiniMax H3 · re-encode audio");
    workflow["44"] = node("LTXVConcatAVLatent", { video_latent: ["42", 0], audio_latent: ["43", 0] }, "MiniMax H3 · ricompone latenti AV");
    }
    let secondModelLink = modelLink;
    if (motionRepairEnabled) {
      // Il secondo passaggio usa una catena separata: la LoRA di riparazione
      // deve essere molto più debole per correggere il moto senza riscrivere la scena.
      secondModelLink = ["5", 0];
      if (externalTurbo) secondModelLink = addModelLora(workflow, String(nextLoraId++), secondModelLink, files.turbo, 1, "MiniMax H3 · Turbo 8 step · passaggio 2");
      if (actionProfile) secondModelLink = addModelLora(workflow, String(nextLoraId++), secondModelLink, automaticProfileLora, number(raw.actionH3CombatStrength, selectedActionPreset.strength || 0.8, 0, 1.5), actionLoraType === "weapon" ? "ACTION H3 · Weapon Combat BUNNY · passaggio 2" : "ACTION H3 · Combat Base V2 · passaggio 2");
      if (weaponProfile) secondModelLink = addModelLora(workflow, String(nextLoraId++), secondModelLink, files.weaponCombat, number(raw.weaponCombatStrength, 0.8, 0, 1.5), "Weapon Combat H3 · BUNNY · passaggio 2");
      secondModelLink = addModelLora(workflow, String(nextLoraId++), secondModelLink, files.motionRepair, number(raw.h3MotionRepairSecondStrength, 0.25, 0, 1), `${profileName} · Motion Continuity Repair · passaggio 2`);
      for (const selected of selectedLoras) secondModelLink = addModelLora(workflow, String(nextLoraId++), secondModelLink, selected.name, number(selected.strength, 0.8, -2, 2), `MiniMax H3 · ${selected.name} · passaggio 2`);
    }
    const secondSamplerName = String(raw.h3SecondSamplerName || samplerName);
    const secondSchedulerName = String(raw.h3SecondSchedulerName || schedulerName);
    const effectiveSecondSteps = number(raw.h3SecondStepsOverride, secondSteps, 1, 30);
    const effectiveSecondDenoise = number(raw.h3SecondDenoiseOverride, secondDenoise, 0.01, 1);
    workflow["45"] = node("RandomNoise", { noise_seed: seed }, "MiniMax H3 · seed secondo sampling");
    workflow["46"] = node("BasicGuider", { model: secondModelLink, conditioning: secondConditioningLink }, "MiniMax H3 · guider secondo sampling");
    workflow["47"] = node("KSamplerSelect", { sampler_name: secondSamplerName }, `MiniMax H3 · ${secondSamplerName} secondo sampling`);
    workflow["48"] = raw.h3SecondSchedulerName || raw.h3SecondStepsOverride || raw.h3SecondDenoiseOverride
      ? node("BasicScheduler", { model: secondModelLink, scheduler: secondSchedulerName, steps: effectiveSecondSteps, denoise: effectiveSecondDenoise }, "MiniMax H3 · scheduler refine controllato")
      : refineMode === "latentLearned"
        ? node("ManualSigmas", { sigmas: "0.9035, 0.6316, 0.3158, 0.0000" }, "Seed Hunter · sigmas refine 3 step")
        : node("BasicScheduler", { model: secondModelLink, scheduler: secondSchedulerName, steps: effectiveSecondSteps, denoise: effectiveSecondDenoise }, "MiniMax H3 · scheduler secondo sampling");
    workflow["49"] = node("SamplerCustomAdvanced", { noise: ["45", 0], guider: ["46", 0], sampler: ["47", 0], sigmas: ["48", 0], latent_image: ["44", 0] }, "MiniMax H3 · secondo sampling");
    workflow["50"] = node("VAEDecode", { samples: ["49", 0], vae: ["2", 0] }, "MiniMax H3 · decode video finale");
    workflow["51"] = node("VAEDecodeAudio", { samples: ["49", 0], vae: ["3", 0] }, "MiniMax H3 · decode audio finale");
    workflow["52"] = outputNode(`VideoStudio/${weaponProfile ? "WeaponCombat" : actionProfile ? "ActionH3" : "MiniMaxH3"}/${mode}_2pass`, ["50", 0], ["51", 0]);
    outputId = "52";
    }
  } else {
    const candidateIndex = Math.max(1, Math.min(3, Number(raw.h3CandidateIndex) || 1));
    const directSuffix = runProfile === "seedCandidate" ? `seed_hunter_candidate_${candidateIndex}_seed_${seed}` : runProfile === "preview" ? "preview" : "direct";
    workflow["52"] = outputNode(`VideoStudio/${runProfile === "seedCandidate" ? "SeedHunterH3" : weaponProfile ? "WeaponCombat" : actionProfile ? "ActionH3" : "MiniMaxH3"}/${mode}_${directSuffix}`, ["35", 0], ["36", 0]);
    outputId = "52";
  }
  if (purgeAfter) {
    workflow["55"] = node("DisTorchPurgeVRAMV2", {
      anything: [outputId, 0],
      purge_cache: true,
      purge_models: true,
      purge_seedvr2_models: refineMode === "seedvr2",
      purge_qwen3vl_models: true,
      purge_nunchaku_models: false,
      HSWQ: false,
      Ollama: false,
    }, "MiniMax H3 · svuota cache dedicate dopo il salvataggio");
    workflow["53"] = node("LayerUtility: PurgeVRAM", { anything: ["55", 0], purge_cache: true, purge_models: true }, "MiniMax H3 · purge finale completo");
  }

  return {
    workflow,
    metadata: {
      workflowId: `videoStudio:${runProfile === "seedCandidate" ? "seedHunterH3" : weaponProfile ? "weaponCombatH3" : actionProfile ? "actionH3" : "minimaxH3"}`,
      workflowName: `Video Studio · ${runProfile === "seedCandidate" ? "Seed Hunter H3" : profileName} · ${definition.name}`,
      videoStudioMode: runProfile === "seedCandidate" ? "seedHunterH3" : weaponProfile ? "weaponCombatH3" : actionProfile ? "actionH3" : "minimaxH3",
      videoStudioStage: runProfile === "preview" ? "preview" : runProfile === "seedCandidate" ? "seedCandidate" : "generation",
      videoStudioLabel: runProfile === "preview" ? `Anteprima rapida · ${definition.name}` : runProfile === "seedCandidate" ? `Candidato ${Math.max(1, Math.min(3, Number(raw.h3CandidateIndex) || 1))} · seed ${seed}` : definition.name,
      h3RunProfile: runProfile,
      h3Stage: runProfile === "preview" ? "preview" : runProfile === "seedCandidate" ? "seedCandidate" : "nativeFinal",
      h3Mode: mode,
      modelFamily: effectiveFamily,
      modelFile: modelName,
      h3Profile: weaponProfile ? "weapon" : actionProfile ? "action" : erosMax ? "erosMax" : pinkCherry ? "pinkCherry" : "standard",
      h3ModelProfile: modelProfile,
      integratedTurbo: erosMax,
      samplerName,
      schedulerName,
      actionTrigger,
      actionPreset,
      actionLoraType: actionProfile ? actionLoraType : null,
      animeStyleLock: flatAnimeSelected,
      combatLora: actionProfile && actionLoraType === "combat" ? files.combat : null,
      combatStrength: actionProfile ? number(raw.actionH3CombatStrength, selectedActionPreset.strength || 0.8, 0, 1.5) : null,
      actionWeaponLora: actionProfile && actionLoraType === "weapon" ? files.weaponCombat : null,
      weaponCombatLora: weaponProfile ? files.weaponCombat : null,
      weaponCombatStrength: weaponProfile ? number(raw.weaponCombatStrength, 0.8, 0, 1.5) : null,
      motionRepairLora: motionRepairEnabled ? files.motionRepair : null,
      motionRepairEnabled,
      motionRepairStrength: motionRepairEnabled ? number(raw.h3MotionRepairStrength, 0.6, 0, 1.5) : null,
      motionRepairSecondStrength: motionRepairEnabled && secondPass ? number(raw.h3MotionRepairSecondStrength, 0.25, 0, 1) : null,
      prompt,
      lookPreset,
      scenePreset,
      duration,
      frames: length,
      seed,
      candidateIndex: runProfile === "seedCandidate" ? Math.max(1, Math.min(3, Number(raw.h3CandidateIndex) || 1)) : null,
      aspectRatio,
      firstMegapixels,
      secondPass,
      refineMode,
      secondMegapixels: secondPass ? secondMegapixels : null,
      secondSteps: secondPass ? number(raw.h3SecondStepsOverride, secondSteps, 1, 30) : null,
      secondDenoise: secondPass ? number(raw.h3SecondDenoiseOverride, secondDenoise, 0.01, 1) : null,
      seedvrResolution: refineMode === "seedvr2" ? number(raw.h3SeedvrResolution, 768, 360, 1080) : null,
      purgeBetween,
      purgeAfter,
      useTurbo,
      nativeUseTurbo,
      externalTurbo,
      attentionBackend,
      loras: combatProfile
        ? [
          { name: automaticProfileLora, strength: actionProfile ? number(raw.actionH3CombatStrength, 0.8, 0, 1.5) : number(raw.weaponCombatStrength, 0.8, 0, 1.5), automatic: true },
          ...(motionRepairEnabled ? [{ name: files.motionRepair, strength: number(raw.h3MotionRepairStrength, 0.6, 0, 1.5), secondStrength: secondPass ? number(raw.h3MotionRepairSecondStrength, 0.25, 0, 1) : null, automatic: true }] : []),
          ...selectedLoras,
        ]
        : loras,
      references: {
        images: (mode === "image" && erosMax ? [uploads.h3FirstFrame] : uploads.h3ReferenceImages || []).filter(Boolean).map(inputPath),
        videos: (uploads.h3ReferenceVideos || []).map(inputPath),
        audios: (uploads.h3ReferenceAudios || []).map(inputPath),
      },
    },
  };
}

export function buildMiniMaxH3SeamlessChainWorkflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const h3 = config?.h3;
  if (!h3?.seamlessChain?.available) throw new Error(h3?.seamlessChain?.reason || "H3 Seamless Chain non è disponibile.");
  const segments = String(raw.prompt || "").split(/^\s*---+\s*$/mu).map((value) => value.trim()).filter(Boolean);
  if (segments.length < 2 || segments.length > 8) throw new Error("H3 Seamless Chain richiede da 2 a 8 prompt separati da --- su una riga.");
  const useTurbo = bool(raw.h3ChainUseTurbo, true);
  const mode = uploads.h3FirstFrame?.name ? "image" : "text";
  const duration = number(raw.duration, 5, 4, 15);
  const seed = seedValue(raw.seed);
  const aspectRatio = ASPECTS.has(String(raw.h3ChainAspectRatio)) ? String(raw.h3ChainAspectRatio) : "16:9 (Widescreen)";
  const workflow = {
    "1": node("CLIPLoader", { clip_name: h3.files.clip, type: "minimax", device: "default" }, "H3 Seamless Chain · Qwen3-VL"),
    "2": node("VAELoader", { vae_name: h3.files.videoVae }, "H3 Seamless Chain · Video VAE"),
    "3": node("VAELoader", { vae_name: h3.files.audioVae }, "H3 Seamless Chain · Audio VAE"),
    "4": node("UNETLoader", { unet_name: h3.files.fl2va, weight_dtype: "default" }, "H3 Seamless Chain · FL2VA INT8"),
    "5": node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: ["4", 0] }, "H3 Seamless Chain · Memory Efficient Sage"),
    "6": node("ResolutionSelector", { aspect_ratio: aspectRatio, megapixels: useTurbo ? 0.4 : 0.9, multiple: 32 }, "H3 Seamless Chain · risoluzione nativa per take"),
  };
  let modelLink = ["5", 0];
  let nextId = 10;
  if (useTurbo) modelLink = addModelLora(workflow, String(nextId++), modelLink, h3.files.turbo, 1, "H3 Seamless Chain · Turbo 8 step");
  for (const selected of loras) modelLink = addModelLora(workflow, String(nextId++), modelLink, selected.name, number(selected.strength, 0.8, -2, 2), `H3 Seamless Chain · ${selected.name}`);
  const inputs = {
    model: modelLink,
    clip: ["1", 0],
    video_vae: ["2", 0],
    audio_vae: ["3", 0],
    script: segments.join("\n---\n"),
    shot_count: 0,
    width: ["6", 0],
    height: ["6", 1],
    frames_per_shot: framesForDuration(duration),
    seed,
    steps: useTurbo ? 8 : 25,
    seed_per_shot: true,
    sampler_name: "res_multistep",
    scheduler: "simple",
    save_every_shot: true,
  };
  if (mode === "image") inputs.start_image = addLoadImage(workflow, "7", uploads.h3FirstFrame, "H3 Seamless Chain · unica immagine iniziale");
  workflow["30"] = node("H3MultishotSampler", inputs, "H3 Seamless Chain · ogni take eredita il frame finale precedente");
  workflow["31"] = outputNode("VideoStudio/H3SeamlessChain/master", ["30", 0], ["30", 1]);
  workflow["32"] = node("DisTorchPurgeVRAMV2", { anything: ["31", 0], purge_cache: true, purge_models: true, purge_seedvr2_models: false, purge_qwen3vl_models: true, purge_nunchaku_models: false, HSWQ: false, Ollama: false }, "H3 Seamless Chain · purge finale");
  return {
    workflow,
    metadata: {
      workflowId: "videoStudio:h3SeamlessChain",
      workflowName: "Video Studio · H3 Multishot Seamless Chain",
      videoStudioMode: "h3SeamlessChain",
      videoStudioStage: "generation",
      videoStudioLabel: `${segments.length} take concatenati · ${duration} s ciascuno`,
      prompt: segments.join("\n---\n"), segments: segments.length, duration, totalDuration: segments.length * duration,
      seed, aspectRatio, useTurbo, steps: useTurbo ? 8 : 25, samplerName: "res_multistep", schedulerName: "simple",
      startImage: mode === "image" ? inputPath(uploads.h3FirstFrame) : null,
      loras,
    },
  };
}

export function buildMiniMaxH3FastWorkflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const fast = config?.h3?.fast;
  if (!fast?.available) {
    throw new Error(fast?.reason || "MiniMax H3 Fast non è disponibile nell’istanza ComfyUI attiva.");
  }
  const files = fast.files;
  const mode = raw.h3FastMode === "text" ? "text" : "image";
  const source = mode === "image"
    ? requireUpload(uploads.h3FirstFrame, "Carica l’immagine iniziale per MiniMax H3 Fast Image to Video.")
    : null;
  const userPrompt = String(raw.prompt || "").trim();
  if (!userPrompt) throw new Error("Inserisci un prompt MiniMax H3 Fast.");
  const duration = number(raw.duration, 5, 4, 15);
  const length = framesForDuration(duration);
  const seed = seedValue(raw.seed);
  const aspectRatio = ASPECTS.has(String(raw.h3FastAspectRatio))
    ? String(raw.h3FastAspectRatio)
    : "16:9 (Widescreen)";
  const useTurbo = bool(raw.h3FastUseTurbo, true);
  const firstMegapixels = useTurbo ? number(raw.h3FastFirstMegapixels, 0.2, 0.2, 0.6) : 0.9;
  const targetMegapixels = useTurbo ? number(raw.h3FastTargetMegapixels, 0.98, firstMegapixels, 1.2) : 0.9;
  const splitStep = number(raw.h3FastSplitStep, 6, 1, 11, true);
  const turboStrength = number(raw.h3FastTurboStrength, 0.75, 0, 1.5);
  const prompt = formatH3ThreeFieldPrompt(userPrompt, {
    mode,
    effectiveDuration: (length - 1) / 24,
  });

  const workflow = {
    "1": node("CLIPLoader", { clip_name: files.clip, type: "minimax", device: "default" }, "MiniMax H3 Fast · Qwen3-VL"),
    "2": node("VAELoader", { vae_name: files.videoVae }, "MiniMax H3 Fast · Video VAE"),
    "3": node("VAELoader", { vae_name: files.audioVae }, "MiniMax H3 Fast · Audio VAE"),
    "4": node("UNETLoader", { unet_name: files.hybrid, weight_dtype: "default" }, "MiniMax H3 Fast · hybrid FL2VA/Ref2VA INT8"),
    "5": node("ResolutionSelector", { aspect_ratio: aspectRatio, megapixels: firstMegapixels, multiple: 128 }, "MiniMax H3 Fast · risoluzione stage 1"),
    "6": node("ResolutionSelector", { aspect_ratio: aspectRatio, megapixels: targetMegapixels, multiple: 32 }, "MiniMax H3 Fast · risoluzione finale"),
  };
  if (source) {
    workflow["7"] = node("LoadImage", { image: inputPath(source) }, "MiniMax H3 Fast · immagine iniziale");
    workflow["8"] = node("ImageResizeKJv2", {
      image: ["7", 0], width: ["6", 0], height: ["6", 1], upscale_method: "nearest-exact",
      keep_proportion: "crop", pad_color: "0, 0, 0", crop_position: "center", divisible_by: 32, device: "cpu",
    }, "MiniMax H3 Fast · adatta frame iniziale");
  }

  let modelLink = ["4", 0];
  let loraId = 10;
  for (const selected of loras) {
    modelLink = addModelLora(workflow, String(loraId++), modelLink, selected.name, number(selected.strength, 0.8, -2, 2), `MiniMax H3 Fast · ${selected.name}`);
  }
  if (useTurbo) {
    modelLink = addModelLora(workflow, "18", modelLink, files.turbo, turboStrength, "MiniMax H3 Fast · Turbo 4 step");
  }
  workflow["19"] = node("ModelAttentionBackend", { model: modelLink, attention: "comfy kitchen attention" }, "MiniMax H3 Fast · Comfy-Kitchen Attention");
  modelLink = ["19", 0];

  const firstConditioning = { clip: ["1", 0], vae: ["2", 0], prompt, width: ["5", 0], height: ["5", 1], length };
  const finalConditioning = { clip: ["1", 0], vae: ["2", 0], prompt, width: ["6", 0], height: ["6", 1], length };
  if (source) {
    firstConditioning.first_frame = ["8", 0];
    finalConditioning.first_frame = ["8", 0];
  }
  workflow["20"] = node("MiniMaxH3ImageToVideo", firstConditioning, `MiniMax H3 Fast · ${mode === "text" ? "T2V" : "I2V"} stage 1`);
  if (useTurbo) workflow["21"] = node("MiniMaxH3ImageToVideo", finalConditioning, `MiniMax H3 Fast · ${mode === "text" ? "T2V" : "I2V"} stage 2`);
  workflow["22"] = node("RandomNoise", { noise_seed: seed }, "MiniMax H3 Fast · seed condiviso");
  if (useTurbo) {
    workflow["23"] = node("MiniMaxH3DualClockSamplerT8", {
      model: modelLink, av_latent: ["20", 1], steps: 12, shift_video: 12, shift_audio: 3,
      sampler_name: "dual_clock_euler", scheduler: "native_flow",
    }, "MiniMax H3 Fast · Dual Clock T8");
    workflow["24"] = node("SplitSigmas", { sigmas: ["23", 2], step: splitStep }, "MiniMax H3 Fast · sigma split");
    workflow["25"] = node("BasicGuider", { model: ["23", 0], conditioning: ["20", 0] }, "MiniMax H3 Fast · guider stage 1");
    workflow["26"] = node("SamplerCustomAdvanced", {
      noise: ["22", 0], guider: ["25", 0], sampler: ["23", 1], sigmas: ["24", 0], latent_image: ["20", 1],
    }, "MiniMax H3 Fast · sampling parziale stage 1");
    workflow["27"] = node("LTXVSeparateAVLatent", { av_latent: ["26", 1] }, "MiniMax H3 Fast · separa latent AV");
    workflow["28"] = node("MinimaxH3LatentUpscaler3D", {
      latent: ["27", 0], model_name: files.latentUpscaler, mode: "target dimensions",
      "mode.width": ["6", 0], "mode.height": ["6", 1], align: 32, device: "cuda",
      precision: files.latentUpscaler.toLowerCase().includes("bf16") ? "bf16" : "fp16", enable_chunking: true,
    }, "MiniMax H3 Fast · learned latent upscale 3D");
    workflow["29"] = node("LTXVConcatAVLatent", { video_latent: ["28", 0], audio_latent: ["27", 1] }, "MiniMax H3 Fast · ricompone latent AV");
    workflow["30"] = node("BasicGuider", { model: modelLink, conditioning: ["21", 0] }, "MiniMax H3 Fast · guider stage 2");
    workflow["31"] = node("KSamplerSelect", { sampler_name: "euler" }, "MiniMax H3 Fast · Euler finale");
    workflow["32"] = node("ManualSigmas", { sigmas: "0.9035, 0.6316, 0.3158, 0.0000" }, "MiniMax H3 Fast · sigmas finali");
    workflow["33"] = node("SamplerCustomAdvanced", {
      noise: ["22", 0], guider: ["30", 0], sampler: ["31", 0], sigmas: ["32", 0], latent_image: ["29", 0],
    }, "MiniMax H3 Fast · sampling finale");
  } else {
    workflow["25"] = node("BasicGuider", { model: modelLink, conditioning: ["20", 0] }, "MiniMax H3 Fast · guider nativo 25-step");
    workflow["31"] = node("KSamplerSelect", { sampler_name: "euler" }, "MiniMax H3 Fast · Euler nativo");
    workflow["32"] = node("BasicScheduler", { model: modelLink, scheduler: "beta", steps: 25, denoise: 1 }, "MiniMax H3 Fast · scheduler nativo 25 step");
    workflow["33"] = node("SamplerCustomAdvanced", {
      noise: ["22", 0], guider: ["25", 0], sampler: ["31", 0], sigmas: ["32", 0], latent_image: ["20", 1],
    }, "MiniMax H3 Fast · sampling nativo 0,9 MP");
  }
  workflow["34"] = node("VAEDecode", { samples: ["33", 0], vae: ["2", 0] }, "MiniMax H3 Fast · decode video");
  workflow["35"] = node("VAEDecodeAudio", { samples: ["33", 0], vae: ["3", 0] }, "MiniMax H3 Fast · decode audio");
  workflow["36"] = outputNode(`VideoStudio/MinimaxH3Fast/${mode}_${useTurbo ? "sigma_split" : "native_25step"}`, ["34", 0], ["35", 0]);

  return {
    workflow,
    metadata: {
      workflowId: "videoStudio:minimaxH3Fast",
      workflowName: `Video Studio · MiniMax H3 Fast · ${mode === "text" ? "T2V" : "I2V"} ${useTurbo ? "Sigma-Split" : "Native 25-step"}`,
      videoStudioMode: "minimaxH3Fast",
      videoStudioStage: "generation",
      videoStudioLabel: `${mode === "text" ? "T2V" : "I2V"} ${useTurbo ? "2-Stage Sigma-Split" : "0,9 MP · 25 step · Turbo OFF"}`,
      h3Mode: mode,
      h3Profile: useTurbo ? "fastSigmaSplit" : "native25",
      modelFile: files.hybrid,
      prompt,
      duration,
      frames: length,
      seed,
      aspectRatio,
      firstMegapixels,
      secondMegapixels: targetMegapixels,
      splitStep,
      turboStrength,
      useTurbo,
      externalTurbo: useTurbo,
      steps: useTurbo ? 12 : 25,
      samplerName: useTurbo ? "dual_clock_euler → euler" : "euler",
      schedulerName: useTurbo ? "native_flow → manual_sigmas" : "beta",
      latentUpscaler: useTurbo ? files.latentUpscaler : null,
      loras,
      references: { images: source ? [inputPath(source)] : [], videos: [], audios: [] },
    },
  };
}
