import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { insertModelLoras, parseLoras } from "./loras.js";
import { normalizeDynamicInputs } from "./workflow-normalization.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const WORKFLOWS = {
  standard: {
    id: "standard",
    name: "LTX 2.3 1Work",
    description: "Workflow T2V/I2V distilled con audio e upscale 1,5×.",
    file: "LTX2.3_1Work_API.json",
    supportsQuality: false,
    supportsTextToVideo: true,
    supportsVideoModelSelection: true,
    defaultVideoModelId: "normal",
  },
  devfp8: {
    id: "devfp8",
    name: "LTX 2.3 Dev FP8",
    description: "Workflow DEV FP8 T2V/I2V con profili Anteprima e Massima.",
    file: "LTX2.3_DevFP8_I2V_API.json",
    supportsQuality: true,
    supportsTextToVideo: true,
    supportsVideoModelSelection: true,
    defaultVideoModelId: "normal",
  },
  ltxSulphur: {
    id: "ltxSulphur",
    name: "LTX 2.3 Sulphur",
    description: "Workflow LTX 2.3 Dev con LoRA Sulphur, Anteprima rapida e Massima finale.",
    file: "LTX23_Sulphur_I2V_API.json",
    fileByInputMode: {
      text: "LTX23_Sulphur_T2V_API.json",
      image: "LTX23_Sulphur_I2V_API.json",
    },
    supportsQuality: true,
    supportsTextToVideo: true,
    supportsVideoModelSelection: false,
    sulphurPromptAssistant: true,
  },
  director: {
    id: "director",
    name: "LTX 2.3 Director 2 UHD",
    description: "Workflow Director con timeline e profili di qualità.",
    file: "LTX23_Director_2_UHD_STANDALONE_API.json",
    supportsQuality: true,
    supportsVideoModelSelection: true,
    defaultVideoModelId: "normal",
  },
  editAnything: {
    id: "editAnything",
    name: "LTX 2.3 V2V Edit Anything",
    description: "Modifica un video esistente tramite istruzioni testuali, mantenendo movimento e audio opzionale.",
    file: "LTX23_V2V_EDIT_ANYTHING_API.json",
    supportsQuality: false,
    inputKind: "video",
    supportsVideoModelSelection: true,
    defaultVideoModelId: "normal",
  },
};

export const VIDEO_MODELS = {
  normal: {
    id: "normal",
    name: "LTX 2.3 Distilled 1.1 FP8",
    shortName: "LTX 2.3 normale",
    description: "Modello LTX 2.3 distilled predefinito, più leggero e rapido nei workflow guidati.",
    file: "LTX2.3\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
  },
};

export function videoModelConfig(installedModels = []) {
  const installed = new Set(installedModels.map((name) => String(name).toLowerCase()));
  const installedBasenames = new Set(installedModels.map((name) =>
    path.win32.basename(String(name).replaceAll("/", "\\")).toLowerCase()
  ));
  return Object.values(VIDEO_MODELS).map((model) => ({
    ...model,
    available: [model.file, ...(model.aliases || [])].some((file) =>
      installed.has(file.toLowerCase())
      || installedBasenames.has(path.win32.basename(file).toLowerCase())
    ),
  }));
}

function selectVideoModel(definition, requestedId) {
  if (!definition.supportsVideoModelSelection) return null;
  const id = String(requestedId || definition.defaultVideoModelId || "normal");
  const model = VIDEO_MODELS[id];
  if (!model) throw new Error("Modello video LTX 2.3 non valido.");
  return {
    ...model,
    file: resolveLocalVideoModelFile(model),
  };
}

function resolveLocalVideoModelFile(model) {
  const candidates = [model.file, ...(model.aliases || [])];
  const roots = [
    process.env.COMFY_DIFFUSION_MODEL_ROOT,
    "E:\\ComfyUI\\Data\\Models\\DiffusionModels",
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI LTX\\models\\diffusion_models",
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI LTX\\models\\unet",
  ].filter(Boolean);
  for (const candidate of candidates) {
    for (const rootDirectory of roots) {
      const absolute = path.join(rootDirectory, candidate.replaceAll("\\", path.sep));
      if (fs.existsSync(absolute)) return candidate;
    }
  }
  return model.file;
}

export const RESOLUTIONS = {
  "360p": { landscape: [640, 352], portrait: [352, 640] },
  "480p": { landscape: [832, 480], portrait: [480, 832] },
  "720p": { landscape: [1280, 704], portrait: [704, 1280] },
};

const QUALITY_LABELS = {
  preview: "ANTEPRIMA ULTRA • RAPIDA",
  max: "QUALITA MASSIMA • FINALE",
};

const LTX23_TEXT_ENCODER = "gemma_3_12B_it_fp8_scaled.safetensors";
const LTX23_TEXT_ENCODER_CKPT = "ltx-2.3-22b-dev-fp8.safetensors";
const LTX23_VIDEO_VAE = "LTX23_video_vae_bf16.safetensors";
const LTX23_SULPHUR_BUILTIN_LORAS = [
  {
    name: "LTX2.3\\ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
    strength: 0.5,
  },
  {
    name: "LTX2.3\\sulphur_lora_rank_768.safetensors",
    strength: 1,
  },
];

function ltxFrameCount(duration, fps = 24) {
  // LTX usa lunghezze temporali 1 + 8n. Con durate intere a 24 fps
  // equivale a duration * fps + 1, ma la formula resta valida anche se
  // in futuro verranno esposti FPS diversi.
  return 1 + (8 * Math.round((duration * fps) / 8));
}

function setLtxFrameCount(workflow, workflowId, duration, fps = 24) {
  const frames = ltxFrameCount(duration, fps);
  if (workflowId === "standard") {
    workflow["445"].inputs.length = frames;
    workflow["450"].inputs.frames_number = frames;
  } else if (workflowId === "devfp8") {
    workflow["108"].inputs.length = frames;
    workflow["171"].inputs.frames_number = frames;
  }
  return frames;
}

function cloneTemplate(file) {
  const absolute = path.join(root, "workflows", file);
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function inputPath(upload) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function viewPath(upload) {
  const params = new URLSearchParams({
    filename: upload.name,
    type: upload.type || "input",
  });
  if (upload.subfolder) params.set("subfolder", upload.subfolder);
  return `/api/view?${params}`;
}

function setDirectorNegative(workflow, text) {
  const nodeId = "900001";
  workflow[nodeId] = {
    inputs: { text, clip: ["419", 0] },
    class_type: "CLIPTextEncode",
    _meta: { title: "Prompt negativo • Web App" },
  };
  workflow["671"].inputs.negative = [nodeId, 0];
}

function useNativeLtxTextEncoder(workflow, nodeId) {
  workflow[nodeId] = {
    ...workflow[nodeId],
    class_type: "LTXAVTextEncoderLoader",
    inputs: {
      text_encoder: LTX23_TEXT_ENCODER,
      ckpt_name: LTX23_TEXT_ENCODER_CKPT,
      device: "default",
    },
    _meta: {
      ...(workflow[nodeId]._meta || {}),
      title: "LTX 2.3 • Gemma text encoder nativo",
    },
  };
}

function replaceLink(workflow, fromLink, toLink) {
  for (const node of Object.values(workflow)) {
    const inputs = node.inputs;
    if (!inputs) continue;
    replaceLinkInObject(inputs, fromLink, toLink);
  }
}

function replaceLinkInObject(value, fromLink, toLink) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)
      && item.length === 2
      && String(item[0]) === String(fromLink[0])
      && Number(item[1]) === Number(fromLink[1])) {
      value[key] = [...toLink];
    } else if (item && typeof item === "object") {
      replaceLinkInObject(item, fromLink, toLink);
    }
  }
}

function applyLtxSulphurWorkflow(workflow, options, upload, inputMode, width, height, seed) {
  const frames = ltxFrameCount(options.duration);

  /*
   * Sulphur esegue il primo passaggio a metà risoluzione.
   * Tutti gli elementi che entrano nel primo latent devono quindi usare
   * esattamente le stesse dimensioni.
   */
  const firstPassWidth = Math.max(32, Math.round(width / 2));
  const firstPassHeight = Math.max(32, Math.round(height / 2));

  workflow["29"].inputs.value = options.prompt;
  workflow["30"].inputs.text = options.prompt;
  workflow["41"].inputs.text = options.negativePrompt;

  workflow["27"].inputs.value = frames;
  workflow["26"].inputs.value = 24;
  workflow["24"].inputs.value = 24;

  /*
   * Risoluzione finale.
   */
  workflow["40"].inputs.value = width;
  workflow["25"].inputs.value = height;

  /*
   * Risoluzione del primo passaggio latent.
   */
  workflow["18"].inputs.value = firstPassWidth;
  workflow["20"].inputs.value = firstPassHeight;

  workflow["1"].inputs.noise_seed = seed;
  workflow["2"].inputs.noise_seed = seed;

  workflow["44"].inputs.ckpt_name =
    "ltx-2.3-22b-dev-fp8.safetensors";

  workflow["45"].inputs.filename_prefix =
    "video/LTX23_SULPHUR";

  workflow["49"].inputs.lora_name =
    LTX23_SULPHUR_BUILTIN_LORAS[0].name;

  workflow["49"].inputs.strength_model =
    LTX23_SULPHUR_BUILTIN_LORAS[0].strength;

  workflow["59"].inputs.model = ["49", 0];

  workflow["59"].inputs.lora_name =
    LTX23_SULPHUR_BUILTIN_LORAS[1].name;

  workflow["59"].inputs.strength_model =
    LTX23_SULPHUR_BUILTIN_LORAS[1].strength;

  workflow["8"].inputs.model = ["59", 0];
  workflow["42"].inputs.model = ["59", 0];

  applyLtxSulphurQuality(workflow, options.quality);

  if (inputMode === "image") {
    if (!upload) {
      throw new Error(
        "Il workflow Sulphur Image-to-Video richiede un'immagine.",
      );
    }

    /*
     * L'immagine guida entra nel latent del primo passaggio.
     * Non deve quindi essere ridimensionata alla risoluzione finale.
     */
    workflow["67"].inputs.image = inputPath(upload);
    workflow["68"].inputs.width = firstPassWidth;
    workflow["68"].inputs.height = firstPassHeight;
  } else if (workflow["990411"]) {
    /*
     * Anche l'immagine neutra utilizzata dal template T2V deve essere
     * coerente con il latent del primo passaggio.
     */
    workflow["990411"].inputs.width = firstPassWidth;
    workflow["990411"].inputs.height = firstPassHeight;
  }
}

function applyLtxSulphurQuality(workflow, quality) {
  if (workflow["47"]) {
    workflow["47"].inputs.steps = quality === "preview" ? 12 : 24;
    workflow["47"].inputs.max_shift = 2.72;
    workflow["47"].inputs.base_shift = 0.8;
    workflow["47"].inputs.stretch = true;
    workflow["47"].inputs.terminal = 0;
  }
  if (quality !== "preview") {
    workflow["43"].inputs.samples = ["37", 0];
    workflow["23"].inputs.samples = ["37", 1];
    return;
  }
  // Anteprima: salta il sampler/refine finale e decodifica il primo pass
  // gia' alla stessa dimensione latente, evitando mismatch tra mezze e
  // piene risoluzioni.
  workflow["43"].inputs.samples = ["35", 0];
  workflow["23"].inputs.samples = ["35", 1];
}

function applyDirector(workflow, options, scenes, width, height, seed) {
  const node = workflow["672"].inputs;
  const sceneFrames = scenes.map((scene) => Math.round(scene.duration * 24));
  const frames = sceneFrames.reduce((total, value) => total + value, 0);
  const timeline = JSON.parse(node.timeline_data);
  const templateSegment = timeline.segments[0] || {};
  let cursor = 0;

  Object.assign(node, {
    start_second: 0,
    end_second: options.duration,
    duration_seconds: options.duration,
    start_frame: 0,
    end_frame: frames,
    duration_frames: frames,
    frame_rate: 24,
    local_prompts: scenes.map((scene) => scene.prompt).join(" | "),
    segment_lengths: sceneFrames.join(","),
    guide_strength: scenes.filter((scene) => scene.upload).map(() => "1.00").join(","),
  });

  timeline.global_prompt = options.globalPrompt;
  timeline.normalStartFrame = 0;
  timeline.normalDurationFrames = frames;
  timeline.segments = scenes.map((scene, index) => {
    const length = sceneFrames[index];
    const segment = {
      ...(index === 0 ? templateSegment : {}),
      id: crypto.randomUUID(),
      start: cursor,
      length,
      prompt: scene.prompt,
      type: scene.upload ? "image" : "text",
      guideStrength: scene.upload ? 1 : undefined,
      isEndFrame: false,
    };
    cursor += length;
    if (scene.upload) {
      segment.imageFile = inputPath(scene.upload);
      segment.imageB64 = viewPath(scene.upload);
    } else {
      delete segment.imageFile;
      delete segment.imageB64;
    }
    return segment;
  });
  node.timeline_data = JSON.stringify(timeline);

  // LHResolutionSetting è un plugin locale che può restituire 0 sull'uscita
  // height quando viene pilotato tramite API (il Director lo arrotonda poi a
  // 64 px). Due costanti separate rendono width/height deterministici.
  delete workflow["726"];
  workflow["900002"] = {
    inputs: { value: width },
    class_type: "INTConstant",
    _meta: { title: "Larghezza • Web App" },
  };
  workflow["900003"] = {
    inputs: { value: height },
    class_type: "INTConstant",
    _meta: { title: "Altezza • Web App" },
  };
  node.custom_width = ["900002", 0];
  node.custom_height = ["900003", 0];
  workflow["654"].inputs.noise_seed = seed;
  workflow["764"].inputs.modalita = QUALITY_LABELS[options.quality];
  setDirectorNegative(workflow, options.negativePrompt);
}

function numberOption(rawValue, fallback, { min, max, integer = false, label }) {
  const value = rawValue === undefined || rawValue === "" ? fallback : Number(rawValue);
  const valid = Number.isFinite(value)
    && value >= min
    && value <= max
    && (!integer || Number.isInteger(value));
  if (!valid) throw new Error(`${label} non valido.`);
  return value;
}

function booleanOption(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === true || value === "true" || value === "1" || value === "on";
}

function applyEditAnything(workflow, rawOptions, upload, seed) {
  const settings = {
    maxDimension: numberOption(rawOptions.maxDimension, 960, {
      min: 320, max: 1920, integer: true, label: "Lato massimo",
    }),
    steps: numberOption(rawOptions.steps, 8, {
      min: 1, max: 50, integer: true, label: "Numero di step",
    }),
    cfg: numberOption(rawOptions.cfg, 1, {
      min: 0, max: 20, label: "CFG",
    }),
    nagScale: numberOption(rawOptions.nagScale, 11, {
      min: 0, max: 30, label: "NAG scale",
    }),
    editStrength: numberOption(rawOptions.editStrength, 1, {
      min: 0, max: 2, label: "Intensità Edit Anything",
    }),
    auxiliaryLoraStrength: numberOption(rawOptions.auxiliaryLoraStrength, 0.95, {
      min: 0, max: 2, label: "Intensità LoRA aggiuntiva",
    }),
    promptEnhancer: booleanOption(rawOptions.promptEnhancer),
    useInputAudio: booleanOption(rawOptions.useInputAudio, true),
    auxiliaryLora: booleanOption(rawOptions.auxiliaryLora),
  };

  workflow["840"].inputs.video = inputPath(upload);
  workflow["5322"].inputs.value = String(rawOptions.prompt || "").trim();
  workflow["5318"].inputs.text = String(rawOptions.negativePrompt || "").trim();
  workflow["5334"].inputs.value = Number(rawOptions.duration);
  workflow["77"].inputs.noise_seed = seed;
  workflow["846"].inputs.value = settings.maxDimension;
  workflow["5324"].inputs.value = settings.promptEnhancer;
  workflow["5414"].inputs.value = settings.useInputAudio;
  workflow["94"].inputs.steps = settings.steps;
  workflow["93"].inputs.cfg = settings.cfg;
  workflow["5389"].inputs.nag_scale = settings.nagScale;
  workflow["5343"].inputs.lora_1.strength = settings.editStrength;
  if (settings.auxiliaryLora) {
    workflow["218"].inputs.strength_model = settings.auxiliaryLoraStrength;
  } else {
    workflow["5343"].inputs.model = ["219", 0];
    delete workflow["218"];
  }

  // Il nodo VHS presente nel workflow pubblico non veniva sempre incluso
  // negli output terminali da alcune build recenti di ComfyUI. Il percorso
  // core CreateVideo -> SaveVideo rende esplicito l'output da eseguire e
  // mantiene audio, FPS e frame finali invariati.
  const legacyOutput = workflow["5368"];
  workflow["990100"] = {
    inputs: {
      fps: legacyOutput.inputs.frame_rate,
      bit_depth: 8,
      images: legacyOutput.inputs.images,
      audio: legacyOutput.inputs.audio,
    },
    class_type: "CreateVideo",
    _meta: { title: "CREA VIDEO FINALE • V2V EDIT ANYTHING" },
  };
  workflow["990101"] = {
    inputs: {
      filename_prefix: "video/LTX23_EDIT_ANYTHING",
      format: "mp4",
      codec: "h264",
      video: ["990100", 0],
    },
    class_type: "SaveVideo",
    _meta: { title: "SALVA VIDEO FINALE • V2V EDIT ANYTHING" },
  };
  delete workflow["5368"];

  return settings;
}

export function buildWorkflow(workflowId, rawOptions, upload, directorScenes = [], rawLoras = undefined) {
  const definition = WORKFLOWS[workflowId];
  if (!definition) throw new Error("Workflow non riconosciuto.");
  const directorHasImage = workflowId === "director"
    && directorScenes.some((scene) => scene?.upload?.name);
  const inputMode = workflowId === "director"
    ? directorHasImage ? "image" : "text"
    : workflowId === "editAnything"
      ? "video"
      : definition.supportsTextToVideo && rawOptions.videoInputMode === "text"
        ? "text"
        : "image";

  const scenes = workflowId === "director"
    ? directorScenes.map((scene) => ({
        ...scene,
        prompt: String(scene.prompt || "").trim(),
        duration: Number(scene.duration),
      }))
    : [];
  if (inputMode !== "text" && workflowId !== "director" && !upload?.name) {
    throw new Error(workflowId === "editAnything" ? "Video di input mancante." : "Immagine di input mancante.");
  }
  if (workflowId === "director") {
    if (!scenes.length || scenes.length > 8) throw new Error("Lo storyboard deve contenere da 1 a 8 scene.");
    if (scenes.some((scene) => !scene.prompt)) throw new Error("Ogni scena deve avere un prompt.");
    if (scenes.some((scene) => !Number.isInteger(scene.duration) || scene.duration < 1 || scene.duration > 30)) {
      throw new Error("La durata di ogni scena deve essere compresa tra 1 e 30 secondi.");
    }
  }

  const directorDuration = scenes.reduce((total, scene) => total + scene.duration, 0);

  const options = {
    prompt: workflowId === "director" ? scenes[0]?.prompt || "" : String(rawOptions.prompt || "").trim(),
    globalPrompt: String(rawOptions.directorGlobalPrompt || "").trim(),
    negativePrompt: String(rawOptions.negativePrompt || "").trim(),
    resolution: rawOptions.resolution || (workflowId === "director" ? "480p" : undefined),
    orientation: rawOptions.orientation,
    duration: workflowId === "director" ? directorDuration : Number(rawOptions.duration),
    quality: rawOptions.quality === "preview" ? "preview" : "max",
  };
  if (!options.prompt) throw new Error("Inserisci il prompt positivo.");
  if (workflowId !== "editAnything" && !RESOLUTIONS[options.resolution]) {
    throw new Error("Risoluzione non valida.");
  }
  if (workflowId !== "editAnything" && !["portrait", "landscape"].includes(options.orientation)) {
    throw new Error("Orientamento non valido.");
  }
  const maxDuration = workflowId === "director" ? 60 : 30;
  if (!Number.isInteger(options.duration) || options.duration < 1 || options.duration > maxDuration) {
    throw new Error(`La durata totale deve essere compresa tra 1 e ${maxDuration} secondi.`);
  }

  const parsedSeed = Number(rawOptions.seed);
  const seed = Number.isSafeInteger(parsedSeed) && parsedSeed >= 0
    ? parsedSeed
    : crypto.randomInt(0, 2 ** 31);
  const [width, height] = workflowId === "editAnything"
    ? [null, null]
    : RESOLUTIONS[options.resolution][options.orientation];
  const templateFile = definition.fileByInputMode?.[inputMode] || definition.file;
  const workflow = cloneTemplate(templateFile);
  const videoModel = definition.dedicatedVideoModelId
    ? {
        ...VIDEO_MODELS[definition.dedicatedVideoModelId],
        file: resolveLocalVideoModelFile(VIDEO_MODELS[definition.dedicatedVideoModelId]),
      }
    : selectVideoModel(definition, rawOptions.videoModelId);
  const builtInLoras = workflowId === "ltxSulphur" ? LTX23_SULPHUR_BUILTIN_LORAS : [];
  const builtInLoraNames = new Set(builtInLoras.map((lora) => lora.name.toLowerCase()));
  const parsedLoras = parseLoras(rawLoras ?? rawOptions.loras);
  const loras = parsedLoras.filter((lora) => !builtInLoraNames.has(lora.name.toLowerCase()));
  let editSettings = null;
  let loraSourceLink = null;
  let loraConsumerIds = null;

  if (workflowId === "ltxSulphur") {
    applyLtxSulphurWorkflow(workflow, options, upload, inputMode, width, height, seed);
    loraSourceLink = ["59", 0];
    loraConsumerIds = ["8", "42"];
  } else if (workflowId === "standard") {
    workflow["121"].inputs.text = options.prompt;
    workflow["110"].inputs.text = options.negativePrompt;
    workflow["291"].inputs.value = options.duration;
    workflow["292"].inputs.value = width;
    workflow["293"].inputs.value = height;
    workflow["458"].inputs.value = 24;
    workflow["439"].inputs.seed = seed;
    workflow["550"].inputs.model_name = videoModel.file;
    workflow["550"].inputs.sage_attention = "auto";
    loraSourceLink = ["550", 0];
    loraConsumerIds = ["547", "548"];
    setLtxFrameCount(workflow, workflowId, options.duration);
    if (inputMode === "image") {
      workflow["436"].inputs.image = inputPath(upload);
    } else {
      workflow["445"].inputs.width = width;
      workflow["445"].inputs.height = height;
      delete workflow["558"].inputs["num_images.image_1"];
      delete workflow["560"].inputs["num_images.image_1"];
    }
  } else if (workflowId === "devfp8") {
    workflow["121"].inputs.text = options.prompt;
    workflow["110"].inputs.text = options.negativePrompt;
    workflow["236"].inputs.value = options.duration;
    workflow["237"].inputs.value = width;
    workflow["238"].inputs.value = height;
    workflow["233"].inputs.value = 24;
    workflow["114"].inputs.noise_seed = seed;
    workflow["115"].inputs.noise_seed = seed;
    workflow["463"].inputs.modalita = QUALITY_LABELS[options.quality];
    workflow["289"].inputs.sage_attention = "auto";
    loraSourceLink = ["466", 0];
    loraConsumerIds = ["289"];
    setLtxFrameCount(workflow, workflowId, options.duration);
    if (inputMode === "image") {
      workflow["149"].inputs.image = inputPath(upload);
      workflow["239"].inputs.value = false;
    } else {
      workflow["239"].inputs.value = true;
      workflow["153"].inputs.bypass = true;
      workflow["154"].inputs.bypass = true;
      workflow["153"].inputs.image = ["111", 0];
      workflow["154"].inputs.image = ["111", 0];
    }
  } else if (workflowId === "director") {
    applyDirector(workflow, options, scenes, width, height, seed);
    workflow["724"].inputs.unet_name = videoModel.file;
    loraSourceLink = ["724", 0];
    loraConsumerIds = ["741"];
  } else {
    editSettings = applyEditAnything(workflow, rawOptions, upload, seed);
    workflow["219"].inputs.unet_name = videoModel.file;
    loraSourceLink = ["5343", 0];
    loraConsumerIds = ["198"];
  }

  insertModelLoras(workflow, loras, loraSourceLink, loraConsumerIds);
  normalizeDynamicInputs(workflow);

  const sceneMetadata = scenes.map((scene, index) => ({
    index: index + 1,
    prompt: scene.prompt,
    duration: scene.duration,
    hasImage: Boolean(scene.upload),
  }));
  const firstUpload = workflowId === "director"
    ? scenes.find((scene) => scene.upload)?.upload
    : upload;

  return {
    workflow,
    metadata: {
      workflowId,
      workflowName: definition.name,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      resolution: workflowId === "editAnything" ? `${editSettings.maxDimension}px max` : options.resolution,
      orientation: workflowId === "editAnything" ? "source" : options.orientation,
      width,
      height,
      duration: options.duration,
      fps: 24,
      quality: definition.supportsQuality ? options.quality : null,
      seed,
      inputMode,
      videoModelId: workflowId === "ltxSulphur" ? "ltx23-sulphur" : (videoModel?.id || "devfp8"),
      videoModelName: workflowId === "ltxSulphur" ? "LTX 2.3 Dev + Sulphur LoRA" : (videoModel?.name || "LTX 2.3 Dev FP8"),
      videoModelFile: workflowId === "ltxSulphur" ? "ltx-2.3-22b-dev-fp8.safetensors" : (videoModel?.file || "ltx-2.3-22b-dev-fp8.safetensors"),
      sourceImage: (inputMode === "image" || workflowId === "director") && firstUpload
        ? inputPath(firstUpload)
        : null,
      sourceVideo: workflowId === "editAnything" ? inputPath(upload) : null,
      sceneCount: workflowId === "director" ? scenes.length : 1,
      scenes: workflowId === "director" ? sceneMetadata : null,
      globalPrompt: workflowId === "director" ? options.globalPrompt : null,
      editSettings,
      loras: [...builtInLoras, ...loras],
    },
  };
}

function parseKeyframeSettings(value, count, duration) {
  let parsed = value;
  if (typeof parsed === "string" && parsed.trim()) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new Error("Le impostazioni dei keyframe non sono valide.");
    }
  }
  const defaults = Array.from({ length: count }, (_, index) => ({
    time: count === 1 ? 0 : (duration * index) / (count - 1),
    strength: 1,
  }));
  if (!Array.isArray(parsed)) return defaults;
  return defaults.map((fallback, index) => {
    const row = parsed[index] || {};
    const time = Number(row.time);
    const strength = Number(row.strength);
    return {
      time: Number.isFinite(time) ? Math.max(0, Math.min(duration, time)) : fallback.time,
      strength: Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : fallback.strength,
    };
  });
}

export function buildKeyframeWorkflow(rawOptions, uploads, rawLoras = undefined) {
  const keyframes = (uploads || []).filter((upload) => upload?.name).slice(0, 4);
  if (keyframes.length < 2) throw new Error("Carica almeno due keyframe.");
  const duration = Number(rawOptions.duration || 5);
  const settings = parseKeyframeSettings(rawOptions.keyframes, keyframes.length, duration);
  settings[0].time = 0;
  settings[settings.length - 1].time = duration;
  if (settings.some((row, index) => index > 0 && row.time <= settings[index - 1].time)) {
    throw new Error("I tempi dei keyframe devono essere in ordine crescente.");
  }
  const camera = String(rawOptions.cameraMotion || "static").trim();
  const motion = String(rawOptions.motionIntensity || "medium").trim();
  const basePrompt = String(rawOptions.prompt || "").trim();
  const prompt = [
    basePrompt,
    `Camera movement: ${camera}.`,
    `Motion intensity: ${motion}.`,
    `Create one continuous, physically plausible transition through all ${keyframes.length} supplied keyframes in chronological order.`,
    "Preserve character identity, clothing, environment, lighting continuity and spatial geometry.",
  ].filter(Boolean).join(" ");
  const { workflow, metadata } = buildWorkflow("standard", {
    ...rawOptions,
    prompt,
    resolution: rawOptions.resolution || "480p",
    orientation: rawOptions.orientation || "landscape",
    duration,
  }, keyframes[0], [], rawLoras);

  const totalFrames = ltxFrameCount(metadata.duration);
  Object.assign(workflow["558"].inputs, {
    num_images: String(keyframes.length),
    "num_images.strength_1": settings[0].strength,
    "num_images.index_1": 0,
  });
  Object.assign(workflow["560"].inputs, {
    num_images: String(keyframes.length),
    "num_images.strength_1": settings[0].strength,
    "num_images.index_1": 0,
  });
  keyframes.slice(1).forEach((upload, offset) => {
    const number = offset + 2;
    const nodeOffset = (number - 2) * 10;
    const loadId = String(980001 + nodeOffset);
    const resizeId = String(980002 + nodeOffset);
    const preprocessId = String(980003 + nodeOffset);
    const requestedFrame = Math.round((settings[number - 1].time * 24) / 8) * 8;
    const frameIndex = Math.max(0, Math.min(totalFrames - 1, requestedFrame));
    workflow[loadId] = {
      inputs: { image: inputPath(upload) },
      class_type: "LoadImage",
      _meta: { title: `Keyframe ${number}` },
    };
    workflow[resizeId] = {
      inputs: {
        width: ["292", 0],
        height: ["293", 0],
        upscale_method: "nearest-exact",
        keep_proportion: "crop",
        pad_color: "0, 0, 0",
        crop_position: "center",
        divisible_by: 32,
        device: "cpu",
        image: [loadId, 0],
      },
      class_type: "ImageResizeKJv2",
      _meta: { title: `Adatta keyframe ${number}` },
    };
    workflow[preprocessId] = {
      inputs: { img_compression: 33, image: [resizeId, 0] },
      class_type: "LTXVPreprocess",
      _meta: { title: `Preprocess keyframe ${number}` },
    };
    Object.assign(workflow["558"].inputs, {
      [`num_images.strength_${number}`]: settings[number - 1].strength,
      [`num_images.index_${number}`]: frameIndex,
      [`num_images.image_${number}`]: [preprocessId, 0],
    });
    Object.assign(workflow["560"].inputs, {
      [`num_images.strength_${number}`]: settings[number - 1].strength,
      [`num_images.index_${number}`]: frameIndex,
      [`num_images.image_${number}`]: [resizeId, 0],
    });
  });
  if (String(rawOptions.audioMode || "generated") === "silent") {
    delete workflow["492"].inputs.audio;
  }
  return {
    workflow,
    metadata: {
      ...metadata,
      workflowId: keyframes.length === 2 ? "firstLast" : "keyframes",
      workflowName: `LTX 2.3 · ${keyframes.length} Keyframe`,
      sourceImage: inputPath(keyframes[0]),
      lastFrame: inputPath(keyframes[keyframes.length - 1]),
      keyframes: keyframes.map((upload, index) => ({
        image: inputPath(upload),
        time: settings[index].time,
        strength: settings[index].strength,
      })),
      cameraMotion: camera,
      motionIntensity: motion,
      audioMode: String(rawOptions.audioMode || "generated"),
    },
  };
}

export function buildFirstLastWorkflow(rawOptions, firstUpload, lastUpload, rawLoras = undefined) {
  if (!firstUpload?.name || !lastUpload?.name) {
    throw new Error("Carica sia il primo sia l’ultimo fotogramma.");
  }
  const reversed = booleanOption(rawOptions.reverseFrames);
  const uploads = reversed ? [lastUpload, firstUpload] : [firstUpload, lastUpload];
  const result = buildKeyframeWorkflow(rawOptions, uploads, rawLoras);
  result.metadata.reverseFrames = reversed;
  result.metadata.workflowName = "LTX 2.3 · First / Last Frame";
  return result;
}
