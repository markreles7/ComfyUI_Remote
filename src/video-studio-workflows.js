import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkflow } from "./workflows.js";
import { normalizeDynamicInputs } from "./workflow-normalization.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowDirectory = path.resolve(moduleDirectory, "..", "workflows");

const TEMPLATE_FILES = {
  inpaint: "LTX23_ICLORA_INPAINT_API.json",
  lipdub: "LTX23_ICLORA_LIPDUB_API.json",
  ingredients: "LTX23_ICLORA_INGREDIENTS_API.json",
  motionTrack: "LTX23_ICLORA_MOTION_TRACK_API.json",
  unionControl: "LTX23_ICLORA_UNION_CONTROL_API.json",
  hdr: "LTX23_ICLORA_HDR_API.json",
};

const REQUIRED_NODES = {
  autoMask: [
    "RemoteFaceSelectionPoint",
    "SAM3_Detect",
    "SAM3_VideoTrack",
    "SAM3_TrackToMask",
    "SAM3_TrackPreview",
    "ImageFromBatch",
    "ImageToMask",
    "CheckpointLoaderSimple",
  ],
  inpaint: ["LTXVInpaintPreprocess", "LTXVDilateVideoMask", "LTXAddVideoICLoRAGuideAdvanced"],
  lipdub: ["LTXICLoRALoaderModelOnly", "LTXVSetAudioRefTokens", "LTXAddVideoICLoRAGuide"],
  ingredients: ["LTXICLoRALoaderModelOnly", "RepeatImageBatch", "LTXAddVideoICLoRAGuide"],
  motionTrack: ["LTXVSparseTrackEditor", "LTXVDrawTracks", "LTXAddVideoICLoRAGuide"],
  unionControl: ["CannyEdgePreprocessor", "DWPreprocessor", "LTXAddVideoICLoRAGuide"],
  hdr: ["LTXVHDRDecodePostprocess", "LTXAddVideoICLoRAGuide"],
  temporalUpscale: ["LoadVideo", "GetVideoComponents", "LatentUpscaleModelLoader", "LTXVLatentUpsampler", "CreateVideo", "SaveVideo"],
};

const MODEL_CANDIDATES = {
  checkpoint: ["ltx-2.3-22b-dev-fp8.safetensors", "ltx23_fp8.safetensors", "ltx-2.3-22b-dev.safetensors"],
  textEncoder: ["gemma_3_12B_it_fp8_scaled.safetensors", "gemma-3-12b-it-heretic-v2_fp8_e4m3fn.safetensors", "comfy_gemma_3_12B_it.safetensors"],
  distilled: ["ltx-2.3-22b-distilled-lora-384-1.1.safetensors", "ltx-2.3-22b-distilled-lora-384.safetensors"],
  inpaint: ["ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors"],
  lipdub: ["ltx-2.3-22b-ic-lora-lipdub-0.9.safetensors"],
  ingredients: ["ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"],
  motionTrack: ["ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors"],
  unionControl: ["ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors"],
  hdr: ["ltx-2.3-22b-ic-lora-hdr-0.9.safetensors", "ltx2.3_ic_hdr_lora.safetensors"],
  temporalUpscale: ["ltx-2.3-temporal-upscaler-x2-1.0.safetensors"],
  sam3: ["Sam3\\sam3.1_multiplex_fp16.safetensors", "sam3.1_multiplex_fp16.safetensors"],
};

export const VIDEO_STUDIO_MODES = {
  actorReplacement: {
    id: "actorReplacement",
    name: "Actor Replacement Studio",
    description: "Sostituzione guidata del volto o del corpo, preservando movimento, tempi, scena e audio.",
  },
  interactiveScene: {
    id: "interactiveScene",
    name: "Interactive Scene Studio",
    description: "Aggiunge un nuovo personaggio e genera una scena con azioni, battute, risposte e audio sincronizzato.",
  },
  sceneTransform: {
    id: "sceneTransform",
    name: "Scene Transform V2V",
    description: "Trasforma un video seguendo movimento e struttura della clip con IC-LoRA Union Control.",
  },
  hdr: {
    id: "hdr",
    name: "HDR Studio",
    description: "Ricostruisce gamma dinamica ed esposizione tramite la IC-LoRA HDR ufficiale.",
  },
  retake: {
    id: "retake",
    name: "Retake",
    description: "Rigenera una clip mantenendo struttura, audio e durata della sorgente.",
  },
  extend: {
    id: "extend",
    name: "Extend",
    description: "Genera una continuazione dal fotogramma finale e la accoda alla clip originale.",
  },
  temporalUpscale: {
    id: "temporalUpscale",
    name: "Temporal Upscaler 2×",
    description: "Raddoppia i fotogrammi conservando durata, risoluzione e audio.",
  },
  sequentialStory: {
    id: "sequentialStory",
    name: "Storia continua",
    description: "Pianifica N scene, genera job ComfyUI indipendenti, usa continuity frame e concatena il video finale.",
  },
};

function cloneTemplate(name) {
  return JSON.parse(fs.readFileSync(path.join(workflowDirectory, TEMPLATE_FILES[name]), "utf8"));
}

function normalizedBaseName(value) {
  return path.win32.basename(String(value || "").replaceAll("/", "\\")).toLowerCase();
}

function findInstalled(installed, candidates) {
  for (const candidate of candidates) {
    const match = installed.find((item) => normalizedBaseName(item) === candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

function missingNodes(availableNodes, required) {
  const nodes = new Set(availableNodes);
  return required.filter((name) => !nodes.has(name));
}

export function videoStudioConfig({
  installedLoras = [],
  installedCheckpoints = [],
  installedTextEncoders = [],
  installedLatentUpscalers = [],
  availableNodes = [],
} = {}) {
  const files = {
    checkpoint: findInstalled(installedCheckpoints, MODEL_CANDIDATES.checkpoint),
    textEncoder: findInstalled(installedTextEncoders, MODEL_CANDIDATES.textEncoder),
    distilled: findInstalled(installedLoras, MODEL_CANDIDATES.distilled),
    inpaint: findInstalled(installedLoras, MODEL_CANDIDATES.inpaint),
    lipdub: findInstalled(installedLoras, MODEL_CANDIDATES.lipdub),
    ingredients: findInstalled(installedLoras, MODEL_CANDIDATES.ingredients),
    motionTrack: findInstalled(installedLoras, MODEL_CANDIDATES.motionTrack),
    unionControl: findInstalled(installedLoras, MODEL_CANDIDATES.unionControl),
    hdr: findInstalled(installedLoras, MODEL_CANDIDATES.hdr),
    temporalUpscale: findInstalled(installedLatentUpscalers, MODEL_CANDIDATES.temporalUpscale),
    sam3: findInstalled(installedCheckpoints, MODEL_CANDIDATES.sam3),
  };
  const commonReady = Boolean(files.checkpoint && files.textEncoder && files.distilled);
  const capabilities = Object.fromEntries(Object.entries(REQUIRED_NODES).map(([id, nodes]) => {
    const missing = missingNodes(availableNodes, nodes);
    const modelReady = id === "temporalUpscale"
      ? Boolean(files.temporalUpscale)
      : id === "autoMask"
        ? Boolean(files.sam3)
        : Boolean(files[id]);
    const requiresBase = !["temporalUpscale", "autoMask"].includes(id);
    return [id, {
      available: (!requiresBase || commonReady) && modelReady && missing.length === 0,
      modelReady,
      missingNodes: missing,
    }];
  }));

  return {
    modes: Object.values(VIDEO_STUDIO_MODES),
    capabilities,
    files,
    ltxLoras: installedLoras.filter((name) =>
      /(^|[\\/])LTX2\.3[\\/]/i.test(name)
      && !/(^|[\\/_-])ic([\\/_-]|lora)|distilled|ic_hdr|sulphur/i.test(name)
    ),
    engines: [
      {
        id: "trackedInpaint",
        name: "LTX 2.3 Actor Replace · consigliato",
        available: capabilities.inpaint.available,
        autoMaskAvailable: capabilities.autoMask.available,
        description: capabilities.autoMask.available
          ? "SAM3 traccia la persona e la IC-LoRA In/Outpainting sostituisce viso, testa o corpo."
          : "Usa la stessa pipeline LTX 2.3 con una maschera video manuale.",
      },
      {
        id: "unionControl",
        name: "Union Control · corpo completo / motion transfer",
        available: capabilities.unionControl.available,
        description: "Usa la clip come guida pose/edge e una reference per rigenerare il personaggio seguendo la performance.",
      },
      {
        id: "editAnything",
        name: "Edit Anything + Identity LoRA",
        available: true,
        description: "Fallback globale già installato; richiede una LoRA della persona per un’identità precisa.",
      },
    ],
  };
}

function inputPath(upload) {
  if (!upload?.name) return "";
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function numberValue(value, fallback, min, max, integer = false) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error("Impostazione numerica Video Studio non valida.");
  }
  return parsed;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "on"].includes(String(value).toLowerCase()) || value === true;
}

function seedValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : crypto.randomInt(0, 2 ** 31);
}

function replaceStrings(value, replacements) {
  if (typeof value === "string") {
    const base = normalizedBaseName(value);
    const replacement = replacements.get(base);
    return replacement || value;
  }
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacements));
  if (!value || typeof value !== "object") return value;
  for (const key of Object.keys(value)) value[key] = replaceStrings(value[key], replacements);
  return value;
}

function prepareOfficialTemplate(template, config) {
  if (!config.files.checkpoint || !config.files.textEncoder || !config.files.distilled) {
    throw new Error("I modelli base LTX 2.3 richiesti da Video Studio non sono disponibili.");
  }
  const replacements = new Map([
    ["ltx-2.3-22b-dev.safetensors", config.files.checkpoint],
    ["comfy_gemma_3_12b_it.safetensors", config.files.textEncoder],
    ["ltx-2.3-22b-distilled-lora-384-1.1.safetensors", config.files.distilled],
    ["ltx-2.3-22b-distilled-lora-384.safetensors", config.files.distilled],
  ]);
  if (config.files.inpaint) replacements.set(MODEL_CANDIDATES.inpaint[0], config.files.inpaint);
  if (config.files.lipdub) replacements.set(MODEL_CANDIDATES.lipdub[0], config.files.lipdub);
  if (config.files.ingredients) replacements.set(MODEL_CANDIDATES.ingredients[0], config.files.ingredients);
  if (config.files.motionTrack) replacements.set(MODEL_CANDIDATES.motionTrack[0], config.files.motionTrack);
  if (config.files.unionControl) replacements.set(MODEL_CANDIDATES.unionControl[0], config.files.unionControl);
  if (config.files.hdr) replacements.set(MODEL_CANDIDATES.hdr[0], config.files.hdr);
  return normalizeDynamicInputs(replaceStrings(template, replacements));
}

function insertIdentityLoras(workflow, loras, modelInputNodeId) {
  let model = workflow[modelInputNodeId].inputs.model;
  loras.forEach((lora, index) => {
    const id = String(990100 + index);
    workflow[id] = {
      inputs: {
        model,
        lora_name: lora.name,
        strength_model: numberValue(lora.strength, 0.8, -2, 2),
      },
      class_type: "LoraLoaderModelOnly",
      _meta: { title: `Video Studio · Identity LoRA ${index + 1}` },
    };
    model = [id, 0];
  });
  workflow[modelInputNodeId].inputs.model = model;
}

function parseDialogue(value) {
  let rows = value;
  if (typeof value === "string") {
    try {
      rows = JSON.parse(value);
    } catch {
      throw new Error("Il copione dei dialoghi non è valido.");
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => ({
    speaker: String(row.speaker || "").trim(),
    line: String(row.line || "").trim(),
    delivery: String(row.delivery || "").trim(),
  })).filter((row) => row.speaker && row.line).slice(0, 12);
}

function dialoguePrompt(dialogue) {
  if (!dialogue.length) return "";
  return [
    "Dialogue order and synchronized performance:",
    ...dialogue.map((row, index) =>
      `${index + 1}. ${row.speaker} says${row.delivery ? ` ${row.delivery}` : ""}: "${row.line}"`
    ),
    "Only the named speaker moves their lips during each line. The other characters listen, maintain eye contact and react naturally.",
  ].join("\n");
}

function replacementPrompt(raw) {
  const scope = raw.replacementScope === "body"
    ? "entire actor"
    : raw.replacementScope === "head"
      ? "face, head and hair"
      : "face only";
  const target = String(raw.targetActor || "the selected actor").trim();
  const instructions = String(raw.prompt || "").trim();
  const transcript = String(raw.transcript || "").trim();
  return [
    `Replace the ${scope} of ${target} with the identity shown in the supplied reference.`,
    instructions,
    "Preserve the original acting, body trajectory, timing, camera, environment, lighting, occlusions and physical interactions.",
    raw.replacementScope === "face"
      ? "Only rebuild the face inside the tracked mask; preserve the original head motion, hair silhouette, expressions and mouth timing."
      : raw.replacementScope === "head"
        ? "Preserve the original neck and body performance while rebuilding the selected head and hair."
        : "Transfer the original pose, gestures and performance to the replacement body.",
    "This is an LTX 2.3 IC-LoRA inpainting replacement pass, not a real-person face swap.",
    transcript ? `Original spoken dialogue and timing: "${transcript}".` : "",
    "Keep the original audio unchanged.",
  ].filter(Boolean).join(" ");
}

function initialMetadata(mode, stage, label, raw, extra = {}) {
  return {
    workflowId: `videoStudio:${mode}`,
    workflowName: `${VIDEO_STUDIO_MODES[mode].name} · ${label}`,
    videoStudioMode: mode,
    videoStudioStage: stage,
    videoStudioLabel: label,
    prompt: String(raw.prompt || "").trim(),
    negativePrompt: String(raw.negativePrompt || "").trim(),
    seed: extra.seed,
    duration: Number(raw.duration || 10),
    fps: 24,
    ...extra,
  };
}

function actorSelection(raw) {
  const targetX = numberValue(raw.targetPointX, 0.5, 0, 1);
  const targetY = numberValue(raw.targetPointY, 0.5, 0, 1);
  const targetFaceIndex = numberValue(raw.targetFaceIndex, 0, 0, 32, true);
  const selectionMode = ["auto", "click", "paint", "manual"].includes(raw.selectionMode)
    ? raw.selectionMode
    : "auto";
  return {
    selectionMode,
    targetX,
    targetY,
    targetFaceIndex,
    useClick: selectionMode === "click",
  };
}

function buildTrackedActorReplacement(raw, uploads, loras, config) {
  if (!config.capabilities.inpaint.available) {
    throw new Error("Tracked Inpaint richiede la IC-LoRA ufficiale LTX 2.3 In/Outpainting, non ancora installata.");
  }
  if (!uploads.sourceVideo?.name || !uploads.identityImage?.name) {
    throw new Error("Tracked Inpaint richiede video e reference dell’identità.");
  }
  const selection = actorSelection({
    ...raw,
    selectionMode: raw.selectionMode || (uploads.maskVideo?.name ? "manual" : "auto"),
  });
  const usesManualVideo = selection.selectionMode === "manual";
  const usesPaintedMask = selection.selectionMode === "paint";
  if (usesManualVideo && !uploads.maskVideo?.name) {
    throw new Error("La modalità maschera manuale richiede un video maschera.");
  }
  if (usesPaintedMask && !uploads.initialMaskImage?.name) {
    throw new Error("Disegna la zona da seguire sul primo fotogramma.");
  }
  if (!usesManualVideo && !config.capabilities.autoMask.available) {
    throw new Error("La maschera automatica richiede SAM3 e i nodi di selezione/tracking.");
  }
  const workflow = prepareOfficialTemplate(cloneTemplate("inpaint"), config);
  const seed = seedValue(raw.seed);
  workflow["5368"].inputs.file = inputPath(uploads.sourceVideo);
  workflow["2004"].inputs.image = inputPath(uploads.identityImage);
  workflow["2483"].inputs.text = replacementPrompt(raw);
  workflow["2612"].inputs.text = String(raw.negativePrompt || "identity drift, changed background, changed camera, temporal flicker");
  workflow["4832"].inputs.noise_seed = seed + 1;
  workflow["5210"].inputs.noise_seed = seed;
  workflow["5400"].inputs.value = numberValue(
    raw.maskDilation,
    raw.replacementScope === "body" ? 22 : raw.replacementScope === "head" ? 16 : 10,
    0,
    96,
    true,
  );
  workflow["5228"].inputs.filename_prefix = `VideoStudio/actor_replacement/${raw.replacementScope || "face"}`;
  if (usesManualVideo) {
    workflow["5375"].inputs.file = inputPath(uploads.maskVideo);
  } else {
    delete workflow["5375"];
    delete workflow["5376"];
    workflow["990300"] = {
      inputs: { ckpt_name: config.files.sam3 },
      class_type: "CheckpointLoaderSimple",
      _meta: { title: "SAM3 · segmentazione e tracking" },
    };
    workflow["990301"] = {
      inputs: { image: ["5168", 0], batch_index: 0, length: 1 },
      class_type: "ImageFromBatch",
      _meta: { title: "Primo fotogramma" },
    };
    if (usesPaintedMask) {
      workflow["990302"] = {
        inputs: { image: inputPath(uploads.initialMaskImage) },
        class_type: "LoadImage",
        _meta: { title: "Maschera disegnata sul primo frame" },
      };
      workflow["990303"] = {
        inputs: { image: ["990302", 0], channel: "red" },
        class_type: "ImageToMask",
        _meta: { title: "Maschera iniziale" },
      };
    } else {
      workflow["990302"] = {
        inputs: {
          image: ["990301", 0],
          target_x: selection.targetX,
          target_y: selection.targetY,
          target_face_index: selection.targetFaceIndex,
          use_click: selection.useClick,
          detection_size: numberValue(raw.faceDetectionSize, 640, 320, 1280, true),
        },
        class_type: "RemoteFaceSelectionPoint",
        _meta: { title: "Seleziona automaticamente l’attore" },
      };
      workflow["990303"] = {
        inputs: {
          model: ["990300", 0],
          image: ["990301", 0],
          positive_coords: ["990302", 0],
          threshold: numberValue(raw.trackingThreshold, 0.5, 0, 1),
          refine_iterations: 2,
          individual_masks: false,
        },
        class_type: "SAM3_Detect",
        _meta: { title: "Segmenta attore selezionato" },
      };
    }
    workflow["990304"] = {
      inputs: {
        images: ["5168", 0],
        model: ["990300", 0],
        initial_mask: ["990303", 0],
        detection_threshold: numberValue(raw.trackingThreshold, 0.5, 0, 1),
        max_objects: 1,
        detect_interval: numberValue(raw.trackingInterval, 3, 1, 30, true),
      },
      class_type: "SAM3_VideoTrack",
      _meta: { title: "Propaga maschera nel video" },
    };
    workflow["5377"] = {
      inputs: { track_data: ["990304", 0], object_indices: "0" },
      class_type: "SAM3_TrackToMask",
      _meta: { title: "Maschera temporale automatica" },
    };
    workflow["990305"] = {
      inputs: {
        track_data: ["990304", 0],
        images: ["5168", 0],
        opacity: 0.55,
        fps: ["5168", 2],
      },
      class_type: "SAM3_TrackPreview",
      _meta: { title: "Anteprima tracking SAM3" },
    };
  }
  insertIdentityLoras(workflow, loras, "5011");
  return {
    workflow,
    metadata: initialMetadata("actorReplacement", "replacement", "Sostituzione tracciata", raw, {
      seed,
      sourceVideo: inputPath(uploads.sourceVideo),
      replacementScope: ["face", "head", "body"].includes(raw.replacementScope) ? raw.replacementScope : "face",
      engine: "trackedInpaint",
      maskMode: selection.selectionMode,
      actorSelection: selection,
      identityLoras: loras,
    }),
  };
}

function buildEditAnythingActorReplacement(raw, uploads, loras) {
  if (!uploads.sourceVideo?.name) throw new Error("Carica il video della scena.");
  if (!loras.length) {
    throw new Error("Il fallback Edit Anything richiede almeno una Identity LoRA LTX 2.3.");
  }
  const seed = seedValue(raw.seed);
  const result = buildWorkflow("editAnything", {
    ...raw,
    prompt: replacementPrompt(raw),
    duration: numberValue(raw.duration, 10, 1, 30, true),
    seed,
    maxDimension: numberValue(raw.maxDimension, 960, 320, 1920, true),
    steps: numberValue(raw.steps, 8, 1, 30, true),
    cfg: 1,
    nagScale: numberValue(raw.nagScale, 11, 0, 30),
    editStrength: numberValue(raw.editStrength, raw.replacementScope === "body" ? 1 : 0.75, 0, 2),
    useInputAudio: true,
    promptEnhancer: booleanValue(raw.promptEnhancer),
    auxiliaryLora: false,
  }, uploads.sourceVideo, [], loras);
  result.metadata = initialMetadata("actorReplacement", "replacement", "Sostituzione Edit Anything", raw, {
    seed,
    sourceVideo: inputPath(uploads.sourceVideo),
    replacementScope: ["face", "head", "body"].includes(raw.replacementScope) ? raw.replacementScope : "face",
    engine: "editAnything",
    identityLoras: loras,
    editSettings: result.metadata.editSettings,
  });
  return result;
}

function unionControlType(raw, fallback = "pose") {
  return ["edges", "pose"].includes(raw.controlType) ? raw.controlType : fallback;
}

function prepareUnionControlWorkflow(raw, uploads, loras, config, {
  mode,
  stage,
  label,
  filenamePrefix,
  defaultControlType = "pose",
  prompt,
  metadata = {},
}) {
  if (!config.capabilities.unionControl.available) {
    throw new Error("IC-LoRA Union Control non disponibile: installa la LoRA Union Control e i nodi Canny/DW Pose LTX 2.3.");
  }
  if (!uploads.guideVideo?.name && !uploads.sourceVideo?.name) {
    throw new Error("Union Control richiede un video guida.");
  }
  if (!uploads.referenceSheet?.name && !uploads.identityImage?.name) {
    throw new Error("Union Control richiede una reference image o un frame editato.");
  }
  const controlType = unionControlType(raw, defaultControlType);
  const guideVideo = uploads.guideVideo || uploads.sourceVideo;
  const referenceImage = uploads.referenceSheet || uploads.identityImage;
  const seed = seedValue(raw.seed);
  const workflow = prepareOfficialTemplate(cloneTemplate("unionControl"), config);
  delete workflow["5060"];
  delete workflow["5061"];
  delete workflow["5062"];
  workflow["5001"].inputs.file = inputPath(guideVideo);
  workflow["2004"].inputs.image = inputPath(referenceImage);
  workflow["2483"].inputs.text = prompt;
  workflow["2612"].inputs.text = String(raw.negativePrompt || "identity drift, temporal flicker, warped anatomy, changed camera, inconsistent background");
  workflow["4832"].inputs.noise_seed = seed;
  workflow["5012"].inputs.strength = numberValue(raw.controlStrength, controlType === "pose" ? 0.85 : 0.78, 0, 1.5);
  workflow["4852"].inputs.filename_prefix = filenamePrefix;
  workflow["5028"].inputs.input = controlType === "pose" ? ["4986", 0] : ["4991", 0];
  insertIdentityLoras(workflow, loras, "5011");
  return {
    workflow,
    metadata: initialMetadata(mode, stage, label, raw, {
      seed,
      sourceVideo: inputPath(guideVideo),
      sourceImage: inputPath(referenceImage),
      controlType,
      controlStrength: workflow["5012"].inputs.strength,
      engine: "unionControl",
      identityLoras: loras,
      ...metadata,
    }),
  };
}

function buildUnionActorReplacement(raw, uploads, loras, config) {
  const scope = ["body", "head", "face"].includes(raw.replacementScope) ? raw.replacementScope : "body";
  const prompt = [
    `Replace the ${scope === "face" ? "face" : scope === "head" ? "head and hair" : "entire person"} of ${String(raw.targetActor || "the selected actor").trim()} with the identity from the reference image.`,
    "Use the source video as motion and pose control. Preserve dance timing, body rhythm, camera movement, framing and shot duration.",
    String(raw.prompt || "").trim(),
    scope === "body"
      ? "Regenerate the full replacement performer following the source pose and silhouette; keep the environment coherent."
      : "For partial replacement prefer tracked inpainting if the face/head must stay inside the original footage.",
    "Do not use real-person face swap; this is LTX 2.3 Union Control motion transfer.",
  ].filter(Boolean).join(" ");
  return prepareUnionControlWorkflow(raw, uploads, loras, config, {
    mode: "actorReplacement",
    stage: "replacement",
    label: "Union Control · sostituzione personaggio",
    filenamePrefix: `VideoStudio/actor_replacement/union_${scope}`,
    defaultControlType: "pose",
    prompt,
    metadata: { replacementScope: scope },
  });
}

function buildSceneTransform(raw, uploads, loras, config) {
  const editGoal = String(raw.prompt || "").trim();
  if (!editGoal) throw new Error("Descrivi la trasformazione video-to-video.");
  const prompt = [
    editGoal,
    "Use the source clip as temporal control: preserve camera movement, timing, perspective, subject scale and scene geometry unless explicitly changed.",
    "Use the reference frame as the target visual direction for the transformed scene.",
    "For background replacement, keep the foreground person stable while rebuilding only the environment described.",
    "For adding a new character, the reference frame should already show the desired spatial placement; otherwise use Interactive Scene or First/Last after creating edited frames.",
  ].join(" ");
  return prepareUnionControlWorkflow(raw, uploads, loras, config, {
    mode: "sceneTransform",
    stage: "v2v",
    label: "Union Control · video-to-video",
    filenamePrefix: "VideoStudio/scene_transform/union",
    defaultControlType: "edges",
    prompt,
    metadata: {
      editUseCase: String(raw.editUseCase || "background"),
    },
  });
}

function buildInteractiveScene(raw, uploads, loras, config) {
  if (!config.capabilities.ingredients.available) {
    throw new Error("La IC-LoRA Ingredients richiesta da Interactive Scene non è disponibile.");
  }
  if (!uploads.referenceSheet?.name) {
    throw new Error("Carica il keyframe o reference sheet con il nuovo personaggio già posizionato.");
  }
  const dialogue = parseDialogue(raw.dialogue);
  if (!dialogue.length) throw new Error("Inserisci almeno una battuta nel copione.");
  const scenePrompt = String(raw.prompt || "").trim();
  if (!scenePrompt) throw new Error("Descrivi la scena e le azioni.");
  const duration = numberValue(raw.duration, 10, 2, 20, true);
  const frames = Math.floor((duration * 24) / 8) * 8 + 1;
  const seed = seedValue(raw.seed);
  const workflow = prepareOfficialTemplate(cloneTemplate("ingredients"), config);
  workflow["2004"].inputs.image = inputPath(uploads.referenceSheet);
  workflow["2483"].inputs.text = [
    "### Reference Sheet",
    String(raw.referenceDescription || "Use the supplied image as the exact visual reference for characters, clothing and location."),
    "### Scene Direction",
    scenePrompt,
    `Camera movement: ${String(raw.cameraMotion || "subtle handheld").trim()}.`,
    dialoguePrompt(dialogue),
    "Maintain character identity, wardrobe, spatial positions and location continuity for the entire shot.",
  ].join("\n");
  workflow["2612"].inputs.text = String(raw.negativePrompt || "identity drift, character switching, overlapping speech, extra people, temporal flicker");
  workflow["5072"].inputs.value = frames;
  workflow["4832"].inputs.noise_seed = seed;
  workflow["4852"].inputs.filename_prefix = "VideoStudio/interactive_scene";
  insertIdentityLoras(workflow, loras, "5011");
  return {
    workflow,
    metadata: initialMetadata("interactiveScene", "scene", "Scena interattiva", raw, {
      seed,
      sourceImage: inputPath(uploads.referenceSheet),
      duration,
      dialogue,
      cameraMotion: String(raw.cameraMotion || "subtle handheld"),
      identityLoras: loras,
    }),
  };
}

function buildHdrStudio(raw, uploads, loras, config) {
  if (!config.capabilities.hdr.available) {
    throw new Error("HDR Studio è predisposto, ma la IC-LoRA ufficiale HDR è gated: accetta la licenza Lightricks e installa ltx-2.3-22b-ic-lora-hdr-0.9.safetensors.");
  }
  if (!uploads.sourceVideo?.name) throw new Error("Carica il video da convertire in HDR.");
  const workflow = prepareOfficialTemplate(cloneTemplate("hdr"), config);
  const seed = seedValue(raw.seed);
  workflow["5106"].inputs.file = inputPath(uploads.sourceVideo);
  workflow["2483"].inputs.text = String(raw.prompt || "Natural cinematic HDR footage with recovered highlights and clean shadow detail.");
  workflow["2612"].inputs.text = String(raw.negativePrompt || "clipped highlights, crushed blacks, halos, oversaturation, temporal flicker");
  workflow["4832"].inputs.noise_seed = seed;
  workflow["5114"].inputs.exposure = numberValue(raw.hdrExposure, 7.1, -10, 10);
  workflow["5114"].inputs.save_exr = booleanValue(raw.saveExr, false);
  workflow["5108"].inputs.fps = ["5105", 2];
  workflow["5109"].inputs.filename_prefix = "VideoStudio/hdr";
  insertIdentityLoras(workflow, loras, "5011");
  return {
    workflow,
    metadata: initialMetadata("hdr", "hdr", "HDR IC-LoRA", raw, {
      seed,
      sourceVideo: inputPath(uploads.sourceVideo),
      exposure: workflow["5114"].inputs.exposure,
      saveExr: workflow["5114"].inputs.save_exr,
    }),
  };
}

function buildRetake(raw, uploads, loras) {
  if (!uploads.sourceVideo?.name) throw new Error("Carica la clip da rigenerare.");
  const seed = seedValue(raw.seed);
  const result = buildWorkflow("editAnything", {
    ...raw,
    prompt: String(raw.prompt || "").trim(),
    duration: numberValue(raw.duration, 10, 1, 30, true),
    seed,
    videoModelId: raw.videoModelId || "normal",
    maxDimension: numberValue(raw.maxDimension, 960, 320, 1920, true),
    steps: numberValue(raw.steps, 8, 1, 30, true),
    cfg: 1,
    nagScale: numberValue(raw.nagScale, 11, 0, 30),
    editStrength: numberValue(raw.editStrength, 0.75, 0, 2),
    useInputAudio: true,
    promptEnhancer: booleanValue(raw.promptEnhancer),
    auxiliaryLora: false,
  }, uploads.sourceVideo, [], loras);
  const workflow = result.workflow;
  delete workflow["990100"];
  delete workflow["990101"];
  workflow["990300"] = {
    inputs: { images: ["5355", 0], fps: ["830", 0], bit_depth: 8, audio: ["5417", 0] },
    class_type: "CreateVideo",
    _meta: { title: "Retake · video finale" },
  };
  workflow["990301"] = {
    inputs: { video: ["990300", 0], filename_prefix: "VideoStudio/retake", format: "auto", codec: "auto" },
    class_type: "SaveVideo",
    _meta: { title: "Retake · salva" },
  };
  result.metadata = {
    ...result.metadata,
    ...initialMetadata("retake", "retake", `Retake · ${result.metadata.videoModelName}`, raw, {
      videoModelId: result.metadata.videoModelId,
      videoModelName: result.metadata.videoModelName,
      editSettings: result.metadata.editSettings,
      identityLoras: loras,
      seed,
      sourceVideo: inputPath(uploads.sourceVideo),
    }),
  };
  return result;
}

function buildExtend(raw, uploads, loras) {
  if (!uploads.sourceVideo?.name) throw new Error("Carica la clip da prolungare.");
  const seed = seedValue(raw.seed);
  const result = buildWorkflow("standard", {
    ...raw,
    prompt: String(raw.prompt || "").trim(),
    inputMode: "image",
    duration: numberValue(raw.extendDuration, 5, 1, 15, true),
    resolution: raw.resolution || "480p",
    orientation: raw.orientation || "landscape",
    videoModelId: raw.videoModelId || "normal",
    seed,
  }, { name: "__last_frame__.png", subfolder: "" }, [], loras);
  const workflow = result.workflow;
  delete workflow["436"];
  workflow["990200"] = {
    inputs: { file: inputPath(uploads.sourceVideo) },
    class_type: "LoadVideo",
    _meta: { title: "Extend · clip originale" },
  };
  workflow["990201"] = {
    inputs: { video: ["990200", 0] },
    class_type: "GetVideoComponents",
    _meta: { title: "Extend · componenti originali" },
  };
  workflow["990202"] = {
    inputs: { image: ["990201", 0], batch_index: -1, length: 1 },
    class_type: "ImageFromBatch",
    _meta: { title: "Extend · ultimo fotogramma" },
  };
  workflow["434"].inputs.image = ["990202", 0];
  workflow["990203"] = {
    inputs: {
      width: ["292", 0],
      height: ["293", 0],
      upscale_method: "lanczos",
      keep_proportion: "crop",
      pad_color: "0, 0, 0",
      crop_position: "center",
      divisible_by: 32,
      device: "cpu",
      image: ["990201", 0],
    },
    class_type: "ImageResizeKJv2",
    _meta: { title: "Extend · adatta clip originale" },
  };
  workflow["990204"] = {
    inputs: { image1: ["990203", 0], image2: ["486", 0] },
    class_type: "ImageBatch",
    _meta: { title: "Extend · accoda fotogrammi" },
  };
  workflow["990205"] = {
    inputs: { audio1: ["990201", 1], audio2: ["553", 0], direction: "after" },
    class_type: "AudioConcat",
    _meta: { title: "Extend · accoda audio" },
  };
  workflow["990206"] = {
    inputs: { images: ["990204", 0], fps: ["990201", 2], bit_depth: 8, audio: ["990205", 0] },
    class_type: "CreateVideo",
    _meta: { title: "Extend · video finale" },
  };
  workflow["990207"] = {
    inputs: { video: ["990206", 0], filename_prefix: "VideoStudio/extend", format: "auto", codec: "auto" },
    class_type: "SaveVideo",
    _meta: { title: "Extend · salva" },
  };
  workflow["492"].inputs.save_output = false;
  result.metadata = {
    ...result.metadata,
    ...initialMetadata("extend", "extend", `Extend · ${result.metadata.videoModelName}`, raw, {
      videoModelId: result.metadata.videoModelId,
      videoModelName: result.metadata.videoModelName,
      identityLoras: loras,
      seed,
      sourceVideo: inputPath(uploads.sourceVideo),
      extensionDuration: Number(raw.extendDuration || 5),
    }),
  };
  return result;
}

function buildTemporalUpscale(raw, uploads, config) {
  if (!config.capabilities.temporalUpscale.available) {
    throw new Error("Il Temporal Upscaler LTX 2.3 ×2 non è disponibile nell’istanza ComfyUI attiva.");
  }
  if (!uploads.sourceVideo?.name) throw new Error("Carica il video da interpolare.");
  const slowMotion = booleanValue(raw.slowMotion, false);
  const workflow = {
    "991000": { inputs: { file: inputPath(uploads.sourceVideo) }, class_type: "LoadVideo", _meta: { title: "Video sorgente" } },
    "991001": { inputs: { video: ["991000", 0] }, class_type: "GetVideoComponents", _meta: { title: "Componenti video" } },
    "991002": {
      inputs: { vae_name: "LTX23_video_vae_bf16.safetensors", device: "main_device", weight_dtype: "bf16" },
      class_type: "VAELoaderKJ",
      _meta: { title: "LTX 2.3 Video VAE" },
    },
    "991003": { inputs: { pixels: ["991001", 0], vae: ["991002", 0] }, class_type: "VAEEncode", _meta: { title: "Encode video" } },
    "991004": {
      inputs: { model_name: config.files.temporalUpscale },
      class_type: "LatentUpscaleModelLoader",
      _meta: { title: "Temporal Upscaler ×2" },
    },
    "991005": {
      inputs: { samples: ["991003", 0], upscale_model: ["991004", 0], vae: ["991002", 0] },
      class_type: "LTXVLatentUpsampler",
      _meta: { title: "Interpola latenti ×2" },
    },
    "991006": {
      inputs: { samples: ["991005", 0], vae: ["991002", 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 },
      class_type: "VAEDecodeTiled",
      _meta: { title: "Decode temporale" },
    },
    "991007": {
      inputs: { value: slowMotion ? "a" : "a*2", a: ["991001", 2] },
      class_type: "SimpleMath+",
      _meta: { title: slowMotion ? "FPS originali · slow motion" : "FPS ×2 · durata invariata" },
    },
    "991008": {
      inputs: { images: ["991006", 0], fps: ["991007", 0], bit_depth: 8, audio: ["991001", 1] },
      class_type: "CreateVideo",
      _meta: { title: "Crea video interpolato" },
    },
    "991009": {
      inputs: { video: ["991008", 0], filename_prefix: "VideoStudio/temporal_x2", format: "auto", codec: "auto" },
      class_type: "SaveVideo",
      _meta: { title: "Salva Temporal ×2" },
    },
  };
  return {
    workflow,
    metadata: initialMetadata("temporalUpscale", "temporalUpscale", slowMotion ? "Temporal ×2 · slow motion" : "Temporal ×2 · FPS doppi", raw, {
      sourceVideo: inputPath(uploads.sourceVideo),
      slowMotion,
      temporalModel: config.files.temporalUpscale,
    }),
  };
}

export function buildVideoStudioInitialJob(mode, raw, uploads, loras, config) {
  if (!VIDEO_STUDIO_MODES[mode]) throw new Error("Workflow Video Studio non riconosciuto.");
  if (mode === "sequentialStory") {
    throw new Error("Storia continua usa gli endpoint Sequential Story dedicati, non il builder Video Studio standard.");
  }
  if (mode === "interactiveScene") return buildInteractiveScene(raw, uploads, loras, config);
  if (mode === "sceneTransform") return buildSceneTransform(raw, uploads, loras, config);
  if (mode === "hdr") return buildHdrStudio(raw, uploads, loras, config);
  if (mode === "retake") return buildRetake(raw, uploads, loras);
  if (mode === "extend") return buildExtend(raw, uploads, loras);
  if (mode === "temporalUpscale") return buildTemporalUpscale(raw, uploads, config);
  if (raw.actorEngine === "faceSwap") {
    throw new Error("Il vecchio Face Swap è stato rimosso: usa Actor Replacement con ambito Solo viso.");
  }
  if (raw.actorEngine === "unionControl") return buildUnionActorReplacement(raw, uploads, loras, config);
  return raw.actorEngine === "editAnything"
    ? buildEditAnythingActorReplacement(raw, uploads, loras)
    : buildTrackedActorReplacement(raw, uploads, loras, config);
}

export function buildVideoStudioLipdubJob(raw, videoUpload, loras, config) {
  if (!config.capabilities.lipdub.available) {
    throw new Error("La IC-LoRA LipDub richiesta non è disponibile.");
  }
  if (!videoUpload?.name) throw new Error("Il video da sincronizzare non è disponibile.");
  const dialogue = parseDialogue(raw.dialogue);
  const prompt = [
    String(raw.prompt || "").trim(),
    dialoguePrompt(dialogue),
    String(raw.transcript || "").trim()
      ? `Preserve this spoken content and timing: "${String(raw.transcript).trim()}".`
      : "",
    "Preserve identity, body movement, camera, background and all non-speaking facial details.",
  ].filter(Boolean).join("\n");
  if (!prompt.trim()) throw new Error("Inserisci dialogo o trascrizione per LipDub.");
  const seed = seedValue(raw.seed);
  const workflow = prepareOfficialTemplate(cloneTemplate("lipdub"), config);
  workflow["5002"].inputs.file = inputPath(videoUpload);
  workflow["2483"].inputs.text = prompt;
  workflow["2612"].inputs.text = String(raw.negativePrompt || "identity drift, changed scene, overlapping speech, unsynchronized lips");
  workflow["4832"].inputs.noise_seed = seed + 1;
  workflow["4967"].inputs.noise_seed = seed;
  workflow["4852"].inputs.filename_prefix = "VideoStudio/lipdub";
  insertIdentityLoras(workflow, loras, "5012");
  return {
    workflow,
    metadata: {
      workflowId: "videoStudio:lipdub",
      workflowName: "Video Studio · LipDub",
      videoStudioStage: "lipdub",
      videoStudioLabel: "Dialogo e lip-sync",
      prompt,
      seed,
      sourceVideo: inputPath(videoUpload),
      dialogue,
      identityLoras: loras,
    },
  };
}

export function videoStudioTemplateClasses() {
  return Object.fromEntries(Object.entries(TEMPLATE_FILES).map(([id, file]) => {
    const workflow = JSON.parse(fs.readFileSync(path.join(workflowDirectory, file), "utf8"));
    return [id, [...new Set(Object.values(workflow).map((node) => node.class_type))]];
  }));
}
