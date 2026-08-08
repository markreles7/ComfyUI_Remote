import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImageWorkflow } from "./image-workflows.js";
import { buildUpscaleWorkflow } from "./upscale-workflows.js";
import { buildFirstLastWorkflow } from "./workflows.js";

export const STUDIO_MODES = {
  guidedEdit: {
    id: "guidedEdit",
    name: "Editor Guidato",
    description: "Inserisci, rimuovi o modifica persone, animali, oggetti, stile e luce indicando con precisione area, relazione e guida strutturale.",
    input: "source",
    supportsMask: true,
    supportsReferences: true,
    guided: true,
  },
  smartphone: {
    id: "smartphone",
    name: "Smartphone Photo Editor",
    description: "Editing fotografico protetto con maschera, alternative Flux.2 e rifinitura guidata.",
    input: "source",
    supportsMask: true,
    supportsReferences: true,
    guided: true,
    legacy: true,
  },
  smartEditor: {
    id: "smartEditor",
    name: "Smart Image Editor",
    description: "Editing Flux.2 globale o locale con preset Conservativo, Bilanciato e Creativo.",
    input: "source",
    supportsMask: true,
    supportsReferences: true,
    guided: true,
    legacy: true,
  },
  inpaint: {
    id: "inpaint",
    name: "Inpainting intelligente",
    description: "Modifica soltanto una maschera manuale o trovata automaticamente con SAM.",
    input: "source",
    supportsMask: true,
    supportsReferences: true,
    legacy: true,
  },
  multiReference: {
    id: "multiReference",
    name: "Multi-Reference Composer",
    description: "Combina immagine principale, persona, posa e stile/costume con Flux.2.",
    input: "source",
    supportsReferences: true,
    legacy: true,
  },
  storyboard: {
    id: "storyboard",
    name: "Storyboard Director",
    description: "Genera 2–4 shot separati dalle stesse reference master.",
    input: "optional",
    supportsReferences: true,
    guided: true,
  },
  firstLast: {
    id: "firstLast",
    name: "LTX First / Last Frame",
    description: "Anima una transizione LTX 2.3 fra due fotogrammi, con movimento e camera controllati.",
    input: "firstLast",
  },
  bible: {
    id: "bible",
    name: "Character & Location Bible",
    description: "Crea viste coerenti del personaggio o della location per storyboard e animazione.",
    input: "source",
    supportsReferences: true,
  },
  camera: {
    id: "camera",
    name: "Camera, posa e composizione",
    description: "Cambia shot, angolo, vista, distanza e posa conservando il soggetto.",
    input: "source",
    supportsReferences: true,
    legacy: true,
  },
  relight: {
    id: "relight",
    name: "Relighting e continuità",
    description: "Modifica luce, meteo, ora e look cromatico mantenendo la scena.",
    input: "source",
    supportsMask: true,
    legacy: true,
  },
  perfect: {
    id: "perfect",
    name: "Perfect Image Studio",
    description: "Bozze multi-modello, selezione guidata, qualità, detailer e upscale finale.",
    input: "optional",
    supportsReferences: true,
    guided: true,
  },
  qwenKreaKlein: {
    id: "qwenKreaKlein",
    name: "Qwen · Krea · Klein · SeedVR2",
    description: "Workflow combinato statico: Qwen Image Editing, Krea refine, Klein refine e SeedVR2 finale.",
    input: "source",
    staticWorkflow: true,
  },
  kreaTriple: {
    id: "kreaTriple",
    name: "Krea Triple Studio",
    description: "Pipeline statica Krea, Z-Image, Flux2 Klein e SeedVR2 con modalità Text, Image e Selective Edit.",
    input: "optional",
    supportsMask: true,
    staticWorkflow: true,
  },
};

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const QWEN_KREA_KLEIN_API_FILE = path.resolve(moduleDirectory, "..", "workflows", "Qwen_Krea_Klein_API.json");
const KREA_TRIPLE_API_FILES = {
  text: path.resolve(moduleDirectory, "..", "workflows", "KreaTriple_T2I_API.json"),
  img2img: path.resolve(moduleDirectory, "..", "workflows", "KreaTriple_I2I_API.json"),
  selective: path.resolve(moduleDirectory, "..", "workflows", "KreaTriple_Masked_API.json"),
};
const KREA_TRIPLE_NODES = {
  kreaPrompt: "5",
  kreaLatent: "8",
  zPrompt: "15",
  zSampler: "17",
  kleinPrompt: "59",
  kleinNoise: "29",
  seedvr2: "69",
  seedvr2Dit: "99",
  resolution: "23",
  finalImage: "45",
  finalSave: "49",
};
const FLUX2_BASE = "FLUX2\\flux2Klein_9bBase.safetensors";
const FLUX2_TURBO = "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors";
const ZIMAGE_TURBO = "Z-IMG\\z_image_turbo_bf16.safetensors";
const FLUX1_REALISTIC = "FLUX1D\\cyberrealisticFlux_v25.safetensors";
const QWEN_EDIT = "QWEN\\BigLoveGwen2_mxfp8.safetensors";
const QWEN_EDIT_2511 = "QWEN\\qwen_image_edit_2511_bf16.safetensors";
const STORYBOARD_MODELS = {
  qwen2511: {
    id: "qwen2511",
    name: "Qwen Image Edit 2511 BF16",
    draft: QWEN_EDIT_2511,
    quality: QWEN_EDIT_2511,
  },
  klein: {
    id: "klein",
    name: "BigLove Klein 4",
    draft: "FLUX2\\BigLoveKlein4_bf16.safetensors",
    quality: "FLUX2\\BigLoveKlein4_bf16.safetensors",
  },
  gwen: {
    id: "gwen",
    name: "BigLove Gwen 2",
    draft: "QWEN\\BigLoveGwen2_mxfp8.safetensors",
    quality: "QWEN\\BigLoveGwen2_mxfp8.safetensors",
  },
};

const PRESETS = {
  conservative: { label: "Conservativo", steps: 24, guidance: 4.5, referenceStrength: 1.25 },
  balanced: { label: "Bilanciato", steps: 20, guidance: 4, referenceStrength: 1 },
  creative: { label: "Creativo", steps: 16, guidance: 3.5, referenceStrength: 0.75 },
};

function numberValue(value, fallback, min, max, integer = false) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error("Impostazione numerica non valida.");
  }
  return parsed;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "on" || value === "1";
}

function inputPath(upload) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function cloneStaticWorkflow(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function staticWorkflowNodes(workflow, classType) {
  return Object.entries(workflow).filter(([, item]) => item?.class_type === classType);
}

function buildQwenKreaKleinJob(raw, source) {
  if (!source?.name) throw new Error("Carica la fotografia principale per Qwen · Krea · Klein.");
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci il prompt di editing per Qwen.");
  const workflow = cloneStaticWorkflow(QWEN_KREA_KLEIN_API_FILE);
  const seed = seedAt(raw);
  const sourcePath = inputPath(source);

  const loadImage = workflow["78"]
    || staticWorkflowNodes(workflow, "LoadImage").find(([, item]) => typeof item.inputs?.image === "string")?.[1];
  if (!loadImage?.inputs) throw new Error("Il workflow Qwen_Krea_Klein_API non contiene un LoadImage configurabile.");
  loadImage.inputs.image = sourcePath;

  if (workflow["110"]?.inputs) workflow["110"].inputs.prompt = prompt;
  else {
    const qwenPrompt = staticWorkflowNodes(workflow, "TextEncodeQwenImageEditPlus")[0]?.[1];
    if (!qwenPrompt?.inputs) throw new Error("Il workflow Qwen_Krea_Klein_API non contiene il prompt Qwen Edit.");
    qwenPrompt.inputs.prompt = prompt;
  }

  const negativePrompt = String(raw.negativePrompt || "").trim();
  if (negativePrompt && workflow["77"]?.inputs) workflow["77"].inputs.prompt = negativePrompt;

  for (const item of Object.values(workflow)) {
    if (item?.class_type === "easy seed" && item.inputs) item.inputs.seed = seed;
    if (item?.class_type === "RandomNoise" && item.inputs && Number.isFinite(Number(item.inputs.noise_seed))) {
      item.inputs.noise_seed = seed;
    }
    if (item?.class_type === "SeedVR2VideoUpscaler" && item.inputs) item.inputs.seed = seed;
    if (item?.class_type === "SaveImage" && item.inputs) {
      item.inputs.filename_prefix = "Studio/qwen_krea_klein/08_finale";
    }
  }
  if (workflow["527"]?.inputs?.images) {
    workflow["939999"] = {
      inputs: { image: workflow["527"].inputs.images },
      class_type: "RemoteImageTensorNormalize",
      _meta: { title: "Normalizza output SeedVR2" },
    };
    workflow["527"].inputs.images = ["939999", 0];
  }

  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "image",
      workflowId: "studio:qwenKreaKlein",
      workflowName: "Qwen · Krea · Klein · SeedVR2",
      studioMode: "qwenKreaKlein",
      studioStage: "final",
      studioLabel: "Workflow combinato statico",
      prompt,
      negativePrompt,
      width: numberValue(raw.imageWidth, 1152, 256, 8192, true),
      height: numberValue(raw.imageHeight, 896, 256, 8192, true),
      seed,
      sourceImage: sourcePath,
      imageModelFile: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
      imageModelName: "Qwen_Krea_Klein_API",
      imageModelFamily: "qwenEdit",
      imageSettings: {
        staticWorkflow: "Qwen_Krea_Klein_API.json",
        qwenEditNode: "110",
        kreaRefineNode: "499",
        kleinRefineNode: "480",
        seedvr2Node: "492",
      },
      loras: [],
    },
  };
}

function kreaTripleOperation(raw) {
  const operation = String(raw.kreaTripleOperation || "text");
  if (operation === "image") return "img2img";
  return ["text", "img2img", "selective"].includes(operation) ? operation : "text";
}

function configureKreaTripleCommon(workflow, raw, { operation, prompt, negativePrompt, seed, width, height }) {
  const nodes = KREA_TRIPLE_NODES;
  workflow[nodes.kreaPrompt].inputs.text = prompt;
  workflow[nodes.zPrompt].inputs.text = prompt;
  workflow[nodes.kleinPrompt].inputs.text = prompt;
  workflow[nodes.kreaLatent].inputs.seed = seed;
  workflow[nodes.zSampler].inputs.seed = seed + 1;
  workflow[nodes.kleinNoise].inputs.noise_seed = seed + 2;
  workflow[nodes.seedvr2].inputs.seed = seed;
  workflow[nodes.resolution].inputs.use_custom_resolution = true;
  workflow[nodes.resolution].inputs.custom_width = width;
  workflow[nodes.resolution].inputs.custom_height = height;
  workflow[nodes.finalSave].inputs.filename_prefix = `Studio/krea_triple/${operation}/08_finale`;
  if (workflow[nodes.seedvr2Dit]?.inputs) {
    workflow[nodes.seedvr2Dit].inputs.cache_model = true;
    workflow[nodes.seedvr2Dit].inputs.attention_mode = "sdpa";
  }
  if (negativePrompt) {
    for (const id of ["6", "16", "37"]) {
      if (workflow[id]?.class_type === "ConditioningZeroOut") workflow[id].inputs._negative_prompt_note = negativePrompt;
    }
  }
}

function addKreaTripleSourceLatent(workflow, source, raw, width, height) {
  workflow["970100"] = {
    inputs: { image: inputPath(source) },
    class_type: "LoadImage",
    _meta: { title: "Krea Triple · source image" },
  };
  workflow["970101"] = {
    inputs: {
      image: ["970100", 0],
      upscale_method: "lanczos",
      width,
      height,
      crop: "center",
    },
    class_type: "ImageScale",
    _meta: { title: "Krea Triple · source to Krea size" },
  };
  workflow["970102"] = {
    inputs: {
      pixels: ["970101", 0],
      vae: ["4", 0],
    },
    class_type: "VAEEncode",
    _meta: { title: "Krea Triple · source latent" },
  };
  workflow[KREA_TRIPLE_NODES.kreaLatent].inputs.latent_image = ["970102", 0];
  workflow[KREA_TRIPLE_NODES.kreaLatent].inputs.denoise =
    numberValue(raw.kreaTripleDenoise ?? raw.denoise, 0.35, 0.1, 0.8);
}

function addKreaTripleMaskComposite(workflow, source, mask, raw) {
  workflow["970110"] = {
    inputs: { image: inputPath(mask) },
    class_type: "LoadImage",
    _meta: { title: "Krea Triple · maschera manuale" },
  };
  workflow["970120"] = {
    inputs: { image: [KREA_TRIPLE_NODES.finalImage, 0] },
    class_type: "GetImageSize",
    _meta: { title: "Krea Triple · final size" },
  };
  workflow["970121"] = {
    inputs: {
      image: ["970100", 0],
      upscale_method: "lanczos",
      width: ["970120", 0],
      height: ["970120", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Krea Triple · original to final size" },
  };
  workflow["970122"] = {
    inputs: {
      image: ["970110", 0],
      upscale_method: "nearest-exact",
      width: ["970120", 0],
      height: ["970120", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Krea Triple · mask to final size" },
  };
  workflow["970123"] = {
    inputs: { image: ["970122", 0], channel: "red" },
    class_type: "ImageToMask",
    _meta: { title: "Krea Triple · image to mask" },
  };
  workflow["970124"] = {
    inputs: {
      mask: ["970123", 0],
      expand: numberValue(raw.maskGrow, 32, 0, 256, true),
      tapered_corners: true,
    },
    class_type: "GrowMask",
    _meta: { title: "Krea Triple · grow mask" },
  };
  workflow["970125"] = {
    inputs: {
      mask: ["970124", 0],
      left: numberValue(raw.maskFeather, 24, 0, 256, true),
      top: numberValue(raw.maskFeather, 24, 0, 256, true),
      right: numberValue(raw.maskFeather, 24, 0, 256, true),
      bottom: numberValue(raw.maskFeather, 24, 0, 256, true),
    },
    class_type: "FeatherMask",
    _meta: { title: "Krea Triple · feather mask" },
  };
  workflow["970126"] = {
    inputs: {
      destination: ["970121", 0],
      source: [KREA_TRIPLE_NODES.finalImage, 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ["970125", 0],
    },
    class_type: "ImageCompositeMasked",
    _meta: { title: "Krea Triple · selective final composite" },
  };
  workflow[KREA_TRIPLE_NODES.finalSave].inputs.images = ["970126", 0];
}

function buildKreaTripleJob(raw, { source, mask }) {
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci il prompt per Krea Triple Studio.");
  const operation = kreaTripleOperation(raw);
  if (operation !== "text" && !source?.name) throw new Error("Krea Triple Image to Image richiede una fotografia sorgente.");
  if (operation === "selective" && !mask?.name) throw new Error("Krea Triple Selective richiede una maschera manuale.");
  const workflow = cloneStaticWorkflow(KREA_TRIPLE_API_FILES[operation]);
  const [width, height] = dimensions(raw);
  const seed = seedAt(raw);
  const negativePrompt = String(raw.negativePrompt || "").trim();
  configureKreaTripleCommon(workflow, raw, { operation, prompt, negativePrompt, seed, width, height });
  if (operation !== "text") addKreaTripleSourceLatent(workflow, source, raw, width, height);
  if (operation === "selective") addKreaTripleMaskComposite(workflow, source, mask, raw);
  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "image",
      workflowId: "studio:kreaTriple",
      workflowName: `Krea Triple Studio · ${operation === "text" ? "Text to Image" : operation === "img2img" ? "Image to Image" : "Selective Image Edit"}`,
      studioMode: "kreaTriple",
      studioStage: "final",
      studioLabel: operation === "text" ? "Text to Image" : operation === "img2img" ? "Image to Image" : "Selective Image Edit",
      prompt,
      negativePrompt,
      width,
      height,
      seed,
      sourceImage: source?.name ? inputPath(source) : null,
      maskImage: mask?.name ? inputPath(mask) : null,
      imageModelName: "Krea + Z-Image + Flux2 Klein + SeedVR2",
      imageModelFamily: "kreaTriple",
      imageSettings: {
        operation,
        denoise: operation === "text" ? 1 : numberValue(raw.kreaTripleDenoise ?? raw.denoise, 0.35, 0.1, 0.8),
        staticWorkflow: path.basename(KREA_TRIPLE_API_FILES[operation]),
        nodes: KREA_TRIPLE_NODES,
        seedvr2CacheModelBoolean: workflow[KREA_TRIPLE_NODES.seedvr2Dit]?.inputs?.cache_model === true,
      },
      loras: [],
    },
  };
}

function dimensions(raw) {
  const width = numberValue(raw.imageWidth, 1152, 256, 4096, true);
  const height = numberValue(raw.imageHeight, 896, 256, 4096, true);
  const maxPixels = 2_000_000;
  const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  return [
    Math.max(256, Math.round((width * scale) / 16) * 16),
    Math.max(256, Math.round((height * scale) / 16) * 16),
  ];
}

function seedAt(raw, index = 0) {
  const parsed = Number(raw.seed);
  const seed = Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : crypto.randomInt(0, 2 ** 31);
  return seed + index;
}

function imageOptions(raw, {
  modelFile,
  mode,
  prompt,
  seed,
  width,
  height,
  references = [],
  steps,
  guidance,
  denoise,
  upscale = false,
  imageRecipe = "standard",
  recipeUpscaleMode = null,
  recipeSeedvrProfile = null,
  recipeSeedvrResolution = null,
} = {}) {
  const family = modelFile.startsWith("FLUX2\\")
    ? "flux2"
    : modelFile.startsWith("QWEN\\")
      ? (mode === "text" ? "qwenImage" : "qwenEdit")
    : modelFile.startsWith("Z-IMG\\")
      ? "zImage"
      : "flux1";
  return {
    modelId: family,
    raw: {
      ...raw,
      imageModelFile: modelFile,
      imageMode: mode,
      imageResolution: "custom",
      imageWidth: width,
      imageHeight: height,
      imageSteps: steps,
      imageGuidance: guidance,
      denoise,
      prompt,
      seed,
      batchSize: 1,
      referenceUploads: references,
      highresEnabled: upscale && boolValue(raw.highresEnabled),
      upscaleMode: upscale ? (recipeUpscaleMode || raw.upscaleMode) : "none",
      seedvrProfile: recipeSeedvrProfile || raw.seedvrProfile,
      seedvrResolution: recipeSeedvrResolution || raw.seedvrResolution,
      imageRecipe,
      autoPurge: upscale && boolValue(raw.autoPurge, true),
      saveOriginal: true,
    },
  };
}

function lorasForModel(loras, modelFile) {
  const prefix = modelFile.startsWith("FLUX2\\")
    ? "FLUX2\\"
    : modelFile.startsWith("QWEN\\")
      ? "QWEN\\"
    : modelFile.startsWith("Z-IMG\\")
      ? "ZIMG\\"
      : "FLUX\\";
  return (Array.isArray(loras) ? loras : []).filter((item) => {
    const name = String(item?.name || "");
    return name.toUpperCase().startsWith(prefix.toUpperCase());
  });
}

function stageFolder(stage) {
  return {
    drafts: "01_bozze",
    variations: "03_variazioni",
    quality: "04_qualita_flux2",
    final: "08_finale",
    storyboard: "storyboard",
    bible: "bible",
    video: "video",
    animation: "animazioni",
  }[stage] || stage;
}

function setStudioSavePrefixes(workflow, studioMode, stage, family) {
  const folder = studioMode === "perfect" && stage === "drafts"
    ? (family === "zImage" ? "02_bozze_zimage" : "01_bozze_flux2")
    : stageFolder(stage);
  const prefix = `Studio/${studioMode}/${folder}`;
  for (const item of Object.values(workflow)) {
    if (item.class_type === "SaveImage") item.inputs.filename_prefix = prefix;
  }
}

function applySourcePreparation(workflow, raw, source) {
  if (!source?.name || !boolValue(raw.sourceDenoise, true) || !workflow["21"]) return false;
  workflow["949900"] = {
    inputs: {
      image: ["20", 0],
      blur_radius: 1,
      sigma: 0.5,
    },
    class_type: "ImageBlur",
    _meta: { title: "Preparazione · filtro rumore locale" },
  };
  workflow["949901"] = {
    inputs: {
      image1: ["20", 0],
      image2: ["949900", 0],
      blend_factor: 0.18,
      blend_mode: "normal",
    },
    class_type: "ImageBlend",
    _meta: { title: "Preparazione · conserva texture originale" },
  };
  workflow["21"].inputs.image = ["949901", 0];
  return true;
}

function protectWithMask(workflow, maskUpload, raw, width, height, automaticTarget = "", family = "flux2") {
  let mask;
  if (maskUpload?.name) {
    workflow["950100"] = {
      inputs: { image: inputPath(maskUpload) },
      class_type: "LoadImage",
      _meta: { title: "Maschera manuale" },
    };
    workflow["950101"] = {
      inputs: {
        image: ["950100", 0],
        upscale_method: "nearest-exact",
        width,
        height,
        crop: "center",
      },
      class_type: "ImageScale",
      _meta: { title: "Adatta maschera" },
    };
    workflow["950102"] = {
      inputs: { image: ["950101", 0], channel: "red" },
      class_type: "ImageToMask",
      _meta: { title: "Immagine a maschera" },
    };
    mask = ["950102", 0];
  } else if (automaticTarget) {
    if (raw.autoMaskEngine === "florence") {
      workflow["950090"] = {
        inputs: { version: "base" },
        class_type: "LayerMask: LoadFlorence2Model",
        _meta: { title: "Florence 2 Base" },
      };
      workflow["950102"] = {
        inputs: {
          florence2_model: ["950090", 0],
          image: ["21", 0],
          task: "referring expression segmentation",
          text_input: automaticTarget,
          detail_method: "GuidedFilter",
          detail_erode: 6,
          detail_dilate: 6,
          black_point: 0.15,
          white_point: 0.99,
          process_detail: true,
          device: "cuda",
          max_megapixels: 2,
        },
        class_type: "LayerMask: Florence2Ultra",
        _meta: { title: "Maschera automatica Florence 2" },
      };
    } else {
      workflow["950102"] = {
        inputs: {
          image: ["21", 0],
          sam_model: "sam_vit_b (375MB)",
          grounding_dino_model: "GroundingDINO_SwinT_OGC (694MB)",
          threshold: numberValue(raw.maskThreshold, 0.3, 0.05, 0.95),
          detail_method: "GuidedFilter",
          detail_erode: 6,
          detail_dilate: 6,
          black_point: 0.15,
          white_point: 0.99,
          process_detail: true,
          prompt: automaticTarget,
          device: "cuda",
          max_megapixels: 2,
          cache_model: true,
        },
        class_type: "LayerMask: SegmentAnythingUltra V2",
        _meta: { title: "Maschera automatica SAM + GroundingDINO" },
      };
    }
    mask = ["950102", 1];
  } else {
    return false;
  }
  const grow = numberValue(raw.maskGrow, 32, 0, 256, true);
  const feather = numberValue(raw.maskFeather, 24, 0, 256, true);
  workflow["950103"] = {
    inputs: { mask, expand: grow, tapered_corners: true },
    class_type: "GrowMask",
    _meta: { title: "Espandi maschera" },
  };
  workflow["950104"] = {
    inputs: {
      mask: ["950103", 0],
      left: feather,
      top: feather,
      right: feather,
      bottom: feather,
    },
    class_type: "FeatherMask",
    _meta: { title: "Sfuma maschera" },
  };
  if (family !== "flux2") {
    const finalImage = workflow["940001"]?.inputs?.images
      || workflow["14"]?.inputs?.images
      || workflow["10"]?.inputs?.images
      || workflow["16"]?.inputs?.images
      || ["13", 0];
    workflow["950105"] = {
      inputs: { image: ["20", 0] },
      class_type: "GetImageSize",
      _meta: { title: "Dimensioni fotografia originale" },
    };
    workflow["950106"] = {
      inputs: {
        image: finalImage,
        upscale_method: "lanczos",
        width: ["950105", 0],
        height: ["950105", 1],
        crop: "disabled",
      },
      class_type: "ImageScale",
      _meta: { title: "Refine alla risoluzione originale" },
    };
    workflow["950107"] = {
      inputs: { mask: ["950104", 0] },
      class_type: "MaskToImage",
      _meta: { title: "Maschera refine" },
    };
    workflow["950108"] = {
      inputs: {
        image: ["950107", 0],
        upscale_method: "bilinear",
        width: ["950105", 0],
        height: ["950105", 1],
        crop: "disabled",
      },
      class_type: "ImageScale",
      _meta: { title: "Maschera refine alla risoluzione originale" },
    };
    workflow["950109"] = {
      inputs: { image: ["950108", 0], channel: "red" },
      class_type: "ImageToMask",
      _meta: { title: "Maschera refine finale" },
    };
    workflow["950110"] = {
      inputs: {
        destination: ["20", 0],
        source: ["950106", 0],
        x: 0,
        y: 0,
        resize_source: false,
        mask: ["950109", 0],
      },
      class_type: "ImageCompositeMasked",
      _meta: { title: "Refine localizzato protetto" },
    };
    workflow["950111"] = {
      inputs: { image1: ["20", 0], image2: ["950110", 0] },
      class_type: "ImageBatch",
      _meta: { title: "Prima / Master protetto" },
    };
    workflow["950112"] = {
      inputs: {
        images: ["950111", 0],
        filename_prefix: `${raw.outputBase || "Studio/local"}/08_finale_protetto`,
      },
      class_type: "SaveImage",
      _meta: { title: "Salva master localizzato" },
    };
    return true;
  }
  const contextPercent = numberValue(raw.contextPercent, 35, 20, 60, true);
  const contextPadding = Math.round(Math.min(width, height) * contextPercent / 100);
  workflow["950105"] = {
    inputs: {
      image: ["21", 0],
      mask: ["950104", 0],
      base_resolution: Math.min(1536, Math.max(width, height)),
      padding: contextPadding,
      min_crop_resolution: 512,
      max_crop_resolution: 1536,
    },
    class_type: "ImageCropByMaskAndResize",
    _meta: { title: `Crop locale con ${contextPercent}% di contesto` },
  };
  workflow["950106"] = {
    inputs: { image: ["950105", 0] },
    class_type: "GetImageSize",
    _meta: { title: "Dimensioni crop locale" },
  };
  workflow["22"].inputs.pixels = ["950105", 0];
  workflow["6"].inputs.width = ["950106", 0];
  workflow["6"].inputs.height = ["950106", 1];
  workflow["10"].inputs.width = ["950106", 0];
  workflow["10"].inputs.height = ["950106", 1];
  workflow["950107"] = {
    inputs: {
      destination: ["21", 0],
      source: ["15", 0],
      mask: ["950105", 1],
      bbox: ["950105", 2],
    },
    class_type: "ImageUncropByMask",
    _meta: { title: "Reinserisci crop nella foto di lavoro" },
  };
  workflow["950108"] = {
    inputs: { image: ["20", 0] },
    class_type: "GetImageSize",
    _meta: { title: "Dimensioni fotografia originale" },
  };
  workflow["950109"] = {
    inputs: {
      image: ["950107", 0],
      upscale_method: "lanczos",
      width: ["950108", 0],
      height: ["950108", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Ripristina risoluzione originale" },
  };
  workflow["950110"] = {
    inputs: { mask: ["950104", 0] },
    class_type: "MaskToImage",
    _meta: { title: "Maschera per ripristino" },
  };
  workflow["950111"] = {
    inputs: {
      image: ["950110", 0],
      upscale_method: "bilinear",
      width: ["950108", 0],
      height: ["950108", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Maschera alla risoluzione originale" },
  };
  workflow["950112"] = {
    inputs: { image: ["950111", 0], channel: "red" },
    class_type: "ImageToMask",
    _meta: { title: "Maschera finale" },
  };
  workflow["950113"] = {
    inputs: {
      destination: ["20", 0],
      source: ["950109", 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ["950112", 0],
    },
    class_type: "ImageCompositeMasked",
    _meta: { title: "Ricomposizione protetta sull'originale" },
  };
  workflow["950114"] = {
    inputs: { image1: ["20", 0], image2: ["950113", 0] },
    class_type: "ImageBatch",
    _meta: { title: "Prima / Dopo" },
  };
  workflow["16"].inputs.images = ["950114", 0];
  workflow["16"].inputs.filename_prefix = "Studio_before_after";
  return true;
}

function buildImageJob({
  studioMode,
  stage,
  label,
  raw,
  source,
  references = [],
  guide,
  mask,
  modelFile,
  prompt,
  seed,
  width,
  height,
  steps,
  guidance,
  denoise = 0.25,
  protectMask = false,
  automaticTarget = "",
  upscale = false,
  imageRecipe = "standard",
  recipeUpscaleMode = null,
  recipeSeedvrProfile = null,
  recipeSeedvrResolution = null,
  loras,
  extraMetadata = {},
}) {
  const mode = source ? "image" : "text";
  const options = imageOptions(raw, {
    modelFile,
    mode,
    prompt,
    seed,
    width,
    height,
    references,
    steps,
    guidance,
    denoise,
    upscale,
    imageRecipe,
    recipeUpscaleMode,
    recipeSeedvrProfile,
    recipeSeedvrResolution,
  });
  const compatibleLoras = lorasForModel(loras, modelFile);
  const result = buildImageWorkflow(options.modelId, options.raw, source, compatibleLoras);
  const structureGuide = applyQwenStructureGuide(
    result.workflow,
    result.metadata.imageModelFamily,
    raw,
    source,
    guide,
  );
  const sourcePrepared = applySourcePreparation(result.workflow, raw, source);
  const protectedEdit = protectMask && protectWithMask(
    result.workflow,
    mask,
    raw,
    width,
    height,
    automaticTarget,
    result.metadata.imageModelFamily,
  );
  if (!boolValue(options.raw.preserveStages)) {
    setStudioSavePrefixes(result.workflow, studioMode, stage, result.metadata.imageModelFamily);
  }
  return {
    ...result,
    metadata: {
      ...result.metadata,
      workflowId: `studio:${studioMode}`,
      workflowName: `${STUDIO_MODES[studioMode].name} · ${label}`,
      studioMode,
      studioStage: stage,
      studioLabel: label,
      protectedEdit,
      includesBeforeAfter: protectedEdit,
      beforeAfterTail: protectedEdit && boolValue(options.raw.preserveStages),
      sourcePrepared,
      structureGuide,
      requestedLoraCount: Array.isArray(loras) ? loras.length : 0,
      appliedLoraCount: compatibleLoras.length,
      ...extraMetadata,
    },
  };
}

function parseShots(raw) {
  let shots;
  try {
    shots = JSON.parse(raw.shots || "[]");
  } catch {
    throw new Error("Le descrizioni dello storyboard non sono valide.");
  }
  if (!Array.isArray(shots) || shots.length < 2 || shots.length > 4) {
    throw new Error("Lo storyboard deve contenere da 2 a 4 shot.");
  }
  return shots.map((shot, index) => ({
    title: String(shot.title || `Shot ${index + 1}`).trim(),
    prompt: String(shot.prompt || "").trim(),
  }));
}

function promptWithContinuity(globalPrompt, style, shot, index, total) {
  return [
    globalPrompt,
    style && `Locked global visual style: ${style}.`,
    `Storyboard shot ${index + 1} of ${total}: ${shot.title}. ${shot.prompt}`,
    "Preserve the exact same adult characters, wardrobe, location design, lighting logic and color palette as the master references.",
    "This must be a standalone full-resolution cinematic frame, not a grid, collage, contact sheet or comic panel.",
  ].filter(Boolean).join(" ");
}

function storyboardModelSelection(raw, preset) {
  const family = STORYBOARD_MODELS[String(raw.storyboardFamily || "klein")];
  if (!family) throw new Error("Famiglia modello storyboard non valida.");
  const profile = "quality";
  const gwen = family.id === "gwen";
  return {
    family,
    profile,
    modelFile: family.quality,
    steps: gwen ? 6 : preset.steps,
    guidance: gwen ? 1 : preset.guidance,
  };
}

function perfectModelSelection(raw, preset, requestedProfile = "draft") {
  const family = STORYBOARD_MODELS[String(raw.perfectFamily || "gwen")];
  if (!family) throw new Error("Famiglia modello Perfect Image non valida.");
  const profile = "quality";
  const modelFile = family.id === "klein"
    ? String(raw.perfectKleinModel || family.quality)
    : String(raw.perfectQwenModel || family.quality);
  const gwen = /biglovegwen2/i.test(modelFile);
  const qwen2511 = /qwen[_-]?image[_-]?edit[_-]?2511/i.test(modelFile);
  return {
    family,
    profile,
    modelFile,
    steps: qwen2511 ? 4 : gwen ? 6 : preset.steps,
    guidance: qwen2511 || gwen ? 1 : preset.guidance,
  };
}

function guidedModelSelection(raw, preset) {
  const family = String(raw.guidedModelFamily || "qwen");
  if (family === "klein" || family === "flux2") {
    return {
      family: "flux2",
      name: "Flux.2 Klein",
      modelFile: String(raw.guidedKleinModel || raw.flux2BaseModel || STORYBOARD_MODELS.klein.quality),
      steps: numberValue(raw.guidedSteps, preset.steps, 1, 50, true),
      guidance: numberValue(raw.guidedGuidance, 5, 0, 20),
      imageRecipe: "klein4b",
    };
  }
  const modelFile = String(raw.qwenEditModel || QWEN_EDIT);
  const bigLove = /biglovegwen2/i.test(modelFile);
  const official2511 = /qwen[_-]?image[_-]?edit[_-]?2511/i.test(modelFile);
  return {
    family: "qwenEdit",
    name: official2511 ? "Qwen Image Edit 2511" : "BigLove Gwen / Qwen",
    modelFile,
    steps: numberValue(raw.guidedSteps, official2511 ? 4 : bigLove ? 6 : 6, 1, 50, true),
    guidance: numberValue(raw.guidedGuidance, official2511 || bigLove ? 1 : 1, 0, 20),
    imageRecipe: "runninghub",
  };
}

function perfectRecipeSelection(raw, familyId) {
  const requested = String(raw.perfectRecipe || "runninghub");
  if (familyId === "klein") {
    return requested === "standard"
      ? { id: "standard", name: "Standard webapp", imageRecipe: "standard", upscale: false }
      : { id: "runninghub-klein4b", name: "RunningHub Klein 4B Accelerated", imageRecipe: "klein4b", upscale: false };
  }
  if (requested === "standard") {
    return { id: "standard", name: "Standard webapp", imageRecipe: "standard", upscale: false };
  }
  if (requested === "runninghubSeedvr") {
    return {
      id: "runninghub-qwen-seedvr",
      name: "RunningHub Qwen multi-reference + SeedVR finale",
      imageRecipe: "runninghub",
      upscale: true,
      upscaleMode: "seedvr2",
      seedvrProfile: "realistic",
      seedvrResolution: 2048,
    };
  }
  return {
    id: "runninghub-qwen",
    name: "RunningHub Qwen multi-reference",
    imageRecipe: "runninghub",
    upscale: false,
  };
}

function identityReferencePrompt(source, references) {
  if (!source?.name) return "";
  const assignments = [
    "Identity reference assignment: image 1 is the exact identity of the primary adult person.",
  ];
  references.forEach((_reference, index) => {
    assignments.push(
      `Image ${index + 2} is the exact identity of adult person ${index + 2}.`
    );
  });
  assignments.push(
    "Keep each identity separate and recognizable: preserve facial geometry, eyes, nose, mouth, jaw, skin tone and hairstyle from its assigned image. Never blend, average, swap or invent the referenced faces."
  );
  return assignments.join(" ");
}

function editingControls(raw) {
  const preservation = numberValue(raw.originalPreservation, 100, 0, 100, true);
  const editIntensity = numberValue(raw.editIntensity, 50, 0, 100, true);
  const identity = numberValue(raw.referenceAdherence, 80, 0, 100, true);
  const pose = numberValue(raw.poseAdherence, 70, 0, 100, true);
  const freedom = numberValue(raw.creativeFreedom, 30, 0, 100, true);
  return {
    preservation,
    editIntensity,
    identity,
    pose,
    freedom,
    prompt: `Control targets: original preservation ${preservation}%, edit intensity ${editIntensity}%, reference identity ${identity}%, pose adherence ${pose}%, creative freedom ${freedom}%.`,
  };
}

const GUIDED_ACTIONS = {
  addPerson: "Add the described adult person inside the selected area.",
  addAnimal: "Add the described animal inside the selected area.",
  addObject: "Add the described object inside the selected area.",
  replace: "Replace only the selected subject with the described result.",
  remove: "Remove only the selected subject and reconstruct the background that should naturally exist behind it.",
  modify: "Modify only the selected part according to the instruction.",
  background: "Change the background while preserving the principal subjects exactly.",
  style: "Transform the global visual style while preserving identities, pose, composition and geometry.",
  relight: "Change only lighting, weather and color response while preserving identities, pose, composition and geometry.",
};

function parsePlacement(raw) {
  try {
    const value = JSON.parse(raw.placement || "null");
    if (!value || typeof value !== "object") return null;
    const x = numberValue(value.x, 0, 0, 1);
    const y = numberValue(value.y, 0, 0, 1);
    const width = numberValue(value.width, 0, 0, 1);
    const height = numberValue(value.height, 0, 0, 1);
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function guidedEditPrompt(raw, prompt, controls) {
  const action = GUIDED_ACTIONS[raw.editAction] || GUIDED_ACTIONS.modify;
  const placement = parsePlacement(raw);
  const position = String(raw.spatialInstruction || "").trim();
  const interaction = String(raw.subjectInteraction || "").trim();
  const depth = String(raw.depthRelation || "integrated naturally in the scene").trim();
  const contact = String(raw.contactInstruction || "").trim();
  const preservation = String(raw.preserveInstruction || "").trim();
  const placementText = placement
    ? `Target box in normalized image coordinates: left ${Math.round(placement.x * 100)}%, top ${Math.round(placement.y * 100)}%, width ${Math.round(placement.width * 100)}%, height ${Math.round(placement.height * 100)}%. Keep the new or modified subject inside this area.`
    : "";
  return [
    action,
    prompt,
    controls.prompt,
    placementText,
    position && `Spatial instruction: ${position}.`,
    interaction && `Action and interaction: ${interaction}.`,
    depth && `Depth and occlusion: ${depth}.`,
    contact && `Physical contact and environmental reaction: ${contact}.`,
    preservation && `Must remain unchanged: ${preservation}.`,
    "Preserve every unrequested element of the source photograph.",
    "Match perspective, focal length, scale, anatomy, depth, occlusion, contact shadows, reflections, white balance, sensor texture and ambient light.",
    "The result must look captured in the original photograph, never pasted on top of it.",
  ].filter(Boolean).join(" ");
}

export function applyQwenStructureGuide(workflow, family, raw, source, guideUpload) {
  if (family !== "qwenEdit") return null;
  let type = String(raw.structureGuide || "none");
  if (type === "automatic") type = guideUpload?.name ? "canny" : "none";
  if (!["canny", "depth", "sketch"].includes(type)) return null;

  const sourceImage = guideUpload?.name
    ? ["960000", 0]
    : workflow["21"]
      ? ["21", 0]
      : ["20", 0];
  if (guideUpload?.name) {
    workflow["960000"] = {
      inputs: { image: inputPath(guideUpload) },
      class_type: "LoadImage",
      _meta: { title: "Guida strutturale separata" },
    };
  }

  let controlImage = sourceImage;
  let patchName = "qwen_image_canny_diffsynth_controlnet.safetensors";
  if (type === "canny" || type === "sketch") {
    workflow["960001"] = {
      inputs: {
        image: sourceImage,
        low_threshold: numberValue(raw.cannyLow, 0.25, 0.01, 0.99),
        high_threshold: numberValue(raw.cannyHigh, 0.75, 0.01, 0.99),
      },
      class_type: "Canny",
      _meta: { title: type === "sketch" ? "Pulisci sketch / linee" : "Estrai contorni Canny" },
    };
    controlImage = ["960001", 0];
  } else {
    patchName = "qwen_image_depth_diffsynth_controlnet.safetensors";
    if (!guideUpload?.name) {
      workflow["960001"] = {
        inputs: {
          image: sourceImage,
          ckpt_name: "depth_anything_v2_vits.pth",
          resolution: 768,
        },
        class_type: "DepthAnythingV2Preprocessor",
        _meta: { title: "Stima profondità automatica" },
      };
      controlImage = ["960001", 0];
    }
  }

  workflow["960002"] = {
    inputs: { name: patchName },
    class_type: "ModelPatchLoader",
    _meta: { title: `Qwen Control · ${type}` },
  };
  const samplerModel = workflow["8"]?.inputs?.model;
  if (!samplerModel) throw new Error("Il workflow Qwen selezionato non espone un sampler compatibile con la guida.");
  workflow["960003"] = {
    inputs: {
      model: samplerModel,
      model_patch: ["960002", 0],
      vae: ["3", 0],
      image: controlImage,
      strength: numberValue(raw.structureStrength, 0.75, 0, 2),
    },
    class_type: "QwenImageDiffsynthControlnet",
    _meta: { title: `Applica guida ${type}` },
  };
  workflow["8"].inputs.model = ["960003", 0];
  return {
    type,
    strength: numberValue(raw.structureStrength, 0.75, 0, 2),
    separateImage: Boolean(guideUpload?.name),
  };
}

export function studioConfig({ modelPatches = [], preprocessors = [] } = {}) {
  const patchAvailable = (name) => modelPatches.some((item) =>
    String(item).toLowerCase() === name.toLowerCase()
  );
  return {
    modes: Object.values(STUDIO_MODES).filter((mode) => !mode.legacy),
    presets: Object.entries(PRESETS).map(([id, item]) => ({ id, name: item.label })),
    limits: { alternatives: [2, 4], references: 4, storyboardShots: [2, 4] },
    structureGuides: [
      { id: "automatic", name: "Automatico · consigliato", available: true },
      {
        id: "canny",
        name: "Contorni · Canny",
        available: preprocessors.includes("Canny")
          && patchAvailable("qwen_image_canny_diffsynth_controlnet.safetensors"),
      },
      {
        id: "sketch",
        name: "Sketch / disegno",
        available: preprocessors.includes("Canny")
          && patchAvailable("qwen_image_canny_diffsynth_controlnet.safetensors"),
      },
      {
        id: "depth",
        name: "Profondità · Depth",
        available: preprocessors.includes("DepthAnythingV2Preprocessor")
          && patchAvailable("qwen_image_depth_diffsynth_controlnet.safetensors"),
      },
      { id: "none", name: "Nessuna guida strutturale", available: true },
    ],
    defaults: {
      flux2Base: FLUX2_BASE,
      flux2Turbo: FLUX2_TURBO,
      zImageTurbo: ZIMAGE_TURBO,
      flux1Realistic: FLUX1_REALISTIC,
      qwenEdit: QWEN_EDIT,
      guidedKlein: STORYBOARD_MODELS.klein.quality,
      perfectQwen: QWEN_EDIT,
      perfectKlein: STORYBOARD_MODELS.klein.quality,
    },
    storyboardModels: Object.values(STORYBOARD_MODELS),
  };
}

export function buildStudioJobs(studioMode, raw, uploads, loras = undefined) {
  if (!STUDIO_MODES[studioMode]) throw new Error("Workflow Studio non riconosciuto.");
  const source = uploads.source || null;
  const references = (uploads.references || []).filter(Boolean).slice(0, 3);
  const mask = uploads.mask || null;
  const guide = uploads.guide || null;
  const [width, height] = dimensions(raw);
  const prompt = String(raw.prompt || "").trim();
  if (!prompt && studioMode !== "firstLast") throw new Error("Inserisci il prompt.");
  if (STUDIO_MODES[studioMode].input === "source" && !source?.name) {
    throw new Error("Carica la fotografia principale.");
  }
  if (studioMode === "qwenKreaKlein") {
    return [buildQwenKreaKleinJob(raw, source)];
  }
  if (studioMode === "kreaTriple") {
    return [buildKreaTripleJob(raw, { source, mask })];
  }
  const preset = PRESETS[raw.editPreset] || PRESETS.balanced;
  const alternatives = numberValue(raw.alternatives, 2, 2, 4, true);
  const automaticTarget = String(raw.maskTarget || "").trim();
  const modelBase = String(raw.flux2BaseModel || FLUX2_BASE);
  const modelTurbo = String(raw.flux2TurboModel || FLUX2_TURBO);
  const controls = editingControls(raw);

  if (studioMode === "firstLast") {
    const videoLoras = (Array.isArray(loras) ? loras : []).filter((item) =>
      String(item?.name || "").toUpperCase().startsWith("LTX2.3\\")
    );
    const result = buildFirstLastWorkflow(raw, uploads.firstFrame, uploads.lastFrame, videoLoras);
    return [{
      ...result,
      metadata: {
        ...result.metadata,
        studioMode,
        studioStage: "video",
        studioLabel: "Transizione",
      },
    }];
  }

  if (studioMode === "storyboard") {
    const shots = parseShots(raw);
    const storyboardModel = storyboardModelSelection(raw, preset);
    return shots.map((shot, index) => buildImageJob({
      studioMode,
      stage: "storyboard",
      label: shot.title,
      raw,
      source,
      references,
      modelFile: storyboardModel.modelFile,
      prompt: promptWithContinuity(prompt, String(raw.globalStyle || ""), shot, index, shots.length),
      seed: seedAt(raw, index),
      width,
      height,
      steps: storyboardModel.steps,
      guidance: storyboardModel.guidance,
      loras,
      extraMetadata: {
        shotIndex: index + 1,
        shotCount: shots.length,
        shotTitle: shot.title,
        globalPrompt: prompt,
        globalStyle: String(raw.globalStyle || ""),
        storyboardModelFamily: storyboardModel.family.id,
        storyboardModelName: storyboardModel.family.name,
        storyboardModelProfile: storyboardModel.profile,
      },
    }));
  }

  if (studioMode === "bible") {
    const type = raw.bibleType === "location" ? "location" : "character";
    const defaults = type === "character"
      ? ["close-up portrait", "full body front view", "left profile", "three-quarter view", "rear view", "expressions sheet"]
      : ["wide establishing view", "opposite side view", "architectural details", "day version", "night version", "simplified 360-degree environment reference"];
    let views;
    try {
      views = JSON.parse(raw.bibleViews || "[]");
    } catch {
      views = [];
    }
    if (!Array.isArray(views) || !views.length) views = defaults;
    return views.slice(0, 8).map((view, index) => buildImageJob({
      studioMode,
      stage: "bible",
      label: String(view),
      raw,
      source,
      references,
      modelFile: modelBase,
      prompt: [
        prompt,
        controls.prompt,
        `${type === "character" ? "Character reference" : "Location reference"} view: ${view}.`,
        "Preserve identity, materials, proportions, wardrobe and design from the master image.",
        "Clean reference frame, coherent neutral presentation, no collage unless explicitly requested.",
      ].join(" "),
      seed: seedAt(raw, index),
      width,
      height,
      steps: preset.steps,
      guidance: preset.guidance,
      loras,
      extraMetadata: { bibleType: type, bibleView: view },
    }));
  }

  if (studioMode === "perfect") {
    const perfectModel = perfectModelSelection(raw, preset, "draft");
    const perfectRecipe = perfectRecipeSelection(raw, perfectModel.family.id);
    if (/qwen[_-]?image[_-]?edit[_-]?2511/i.test(perfectModel.modelFile) && !source?.name) {
      throw new Error("Qwen Image Edit 2511 richiede una prima immagine/reference master.");
    }
    const identityPrompt = identityReferencePrompt(source, references);
    return Array.from({ length: alternatives }, (_, index) =>
      buildImageJob({
        studioMode,
        stage: "drafts",
        label: `${perfectModel.family.name} · Bozza ${index + 1}`,
        raw,
        source,
        references,
        modelFile: perfectModel.modelFile,
        prompt: `${prompt} ${identityPrompt} ${controls.prompt}`,
        seed: seedAt(raw, index),
        width,
        height,
        steps: perfectModel.steps,
        guidance: perfectModel.guidance,
        upscale: perfectRecipe.upscale,
        imageRecipe: perfectRecipe.imageRecipe,
        recipeUpscaleMode: perfectRecipe.upscaleMode,
        recipeSeedvrProfile: perfectRecipe.seedvrProfile,
        recipeSeedvrResolution: perfectRecipe.seedvrResolution,
        loras,
        extraMetadata: {
          guidedAction: "select_draft",
          perfectModelFamily: perfectModel.family.id,
          perfectModelName: perfectModel.family.name,
          perfectModelProfile: perfectModel.profile,
          perfectRecipe: perfectRecipe.id,
          perfectRecipeName: perfectRecipe.name,
          identityReferenceCount: source ? references.length + 1 : 0,
        },
      })
    );
  }

  if (studioMode === "guidedEdit") {
    const guidedModel = guidedModelSelection(raw, preset);
    const globalAction = ["style", "relight", "background"].includes(raw.editAction);
    const masked = !globalAction || Boolean(mask?.name || automaticTarget);
    if (masked && !mask?.name && !automaticTarget) {
      throw new Error("Disegna l’area della modifica, traccia il riquadro di posizionamento oppure usa la selezione automatica.");
    }
    const guidedPrompt = guidedEditPrompt(raw, prompt, controls);
    return Array.from({ length: alternatives }, (_, index) => buildImageJob({
      studioMode,
      stage: "drafts",
      label: `Proposta guidata ${index + 1}`,
      raw,
      source,
      references,
      guide,
      mask,
      modelFile: guidedModel.modelFile,
      prompt: guidedPrompt,
      seed: seedAt(raw, index),
      width,
      height,
      steps: guidedModel.steps,
      guidance: guidedModel.guidance,
      imageRecipe: guidedModel.imageRecipe,
      protectMask: masked,
      automaticTarget,
      loras,
      extraMetadata: {
        guidedModelFamily: guidedModel.family,
        guidedModelName: guidedModel.name,
        guidedModelFile: guidedModel.modelFile,
        editAction: raw.editAction || "modify",
        editPreset: preset.label,
        editScope: masked ? "local" : "global",
        placement: parsePlacement(raw),
        referenceCount: references.length,
        editingControls: controls,
        guidedAction: "select_draft",
      },
    }));
  }

  const modePrompts = {
    smartphone: [
      prompt,
      controls.prompt,
      "Preserve every unrequested element of the original smartphone photograph.",
      "Match camera perspective, scale, depth, contact shadows, reflections, occlusion, white balance, sensor texture and ambient lighting.",
      "The edit must look naturally captured in the original amateur photograph, not pasted or studio-lit.",
    ].join(" "),
    smartEditor: [
      prompt,
      controls.prompt,
      `Editing behavior: ${preset.label}. Preserve all elements that were not explicitly requested to change.`,
    ].join(" "),
    inpaint: [
      prompt,
      controls.prompt,
      "Modify only the selected region. Blend boundaries, shadows, reflections, color temperature and depth with the untouched photograph.",
    ].join(" "),
    multiReference: [
      prompt,
      controls.prompt,
      "Image 1 is the principal scene. Image 2 identifies the person, image 3 guides pose or clothing, and image 4 guides style when provided.",
      "Combine only the requested properties and maintain a coherent photographic result.",
    ].join(" "),
    camera: [
      prompt,
      controls.prompt,
      `Shot size: ${raw.shotSize || "medium"}. Camera angle: ${raw.cameraAngle || "eye level"}.`,
      `View: ${raw.subjectView || "three-quarter"}. Camera distance/depth: ${raw.cameraDepth || "natural"}.`,
      "Preserve subject identity, wardrobe and environment unless explicitly changed.",
    ].join(" "),
    relight: [
      prompt,
      controls.prompt,
      `Time/weather: ${raw.weather || "unchanged"}. Lighting: ${raw.lighting || "cinematic natural light"}.`,
      `Locked color look: ${raw.globalStyle || "natural photographic color"}.`,
      "Preserve geometry, identity, materials and composition. Rebuild physically coherent shadows and reflections.",
    ].join(" "),
  };
  const masked = ["smartphone", "inpaint"].includes(studioMode)
    || (studioMode === "smartEditor" && raw.editScope === "local")
    || (studioMode === "relight" && (mask?.name || automaticTarget));
  if (masked && !mask?.name && !automaticTarget) {
    throw new Error("Disegna una maschera oppure indica cosa selezionare automaticamente.");
  }
  return Array.from({ length: alternatives }, (_, index) => buildImageJob({
    studioMode,
    stage: "drafts",
    label: `Alternativa ${index + 1}`,
    raw,
    source,
    references,
    mask,
    modelFile: studioMode === "smartphone" ? modelTurbo : modelBase,
    prompt: modePrompts[studioMode],
    seed: seedAt(raw, index),
    width,
    height,
    steps: studioMode === "smartphone" ? 8 : preset.steps,
    guidance: studioMode === "smartphone" ? 1 : preset.guidance,
    protectMask: masked,
    automaticTarget,
    loras,
    extraMetadata: {
      editPreset: preset.label,
      editScope: masked ? "local" : "global",
      referenceCount: references.length,
      editingControls: controls,
      guidedAction: ["smartphone", "smartEditor"].includes(studioMode) ? "select_draft" : null,
    },
  }));
}

export function buildStudioContinuation(action, raw, selectedUpload, loras = undefined) {
  if (!selectedUpload?.name) throw new Error("Il risultato selezionato non è disponibile.");
  const [width, height] = dimensions(raw);
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci le istruzioni per lo stadio successivo.");
  if (action === "variation" || action === "quality") {
    const perfect = raw.studioMode === "perfect"
      ? perfectModelSelection(raw, PRESETS[raw.editPreset] || PRESETS.balanced,
        action === "quality" ? "quality" : "draft")
      : null;
    const perfectRecipe = perfect ? perfectRecipeSelection(raw, perfect.family.id) : null;
    const continuationReferences = Array.isArray(raw.referenceUploads)
      ? raw.referenceUploads.filter(Boolean).slice(0, 3)
      : [];
    const localized = ["smartphone", "inpaint"].includes(raw.studioMode)
      || (raw.studioMode === "guidedEdit" && (raw.maskUpload?.name || raw.maskTarget))
      || (raw.studioMode === "smartEditor" && raw.editScope === "local")
      || (raw.studioMode === "relight" && (raw.maskUpload?.name || raw.maskTarget));
    return buildImageJob({
      studioMode: raw.studioMode || "perfect",
      stage: action === "variation" ? "variations" : "quality",
      label: perfect
        ? `${perfect.family.name} · ${action === "variation" ? "Variazione" : "Qualità"}`
        : (action === "variation" ? "Variazione controllata" : "Flux.2 qualità"),
      raw,
      source: selectedUpload,
      references: continuationReferences,
      modelFile: perfect
        ? perfect.modelFile
        : (action === "variation"
          ? (raw.flux2TurboModel || FLUX2_TURBO)
          : (raw.flux2BaseModel || FLUX2_BASE)),
      prompt: [
        prompt,
        perfect && identityReferencePrompt(selectedUpload, continuationReferences),
        action === "variation"
          ? "Create a controlled variation while preserving composition, character identity and color continuity."
          : "Produce the definitive high-quality version while preserving the approved composition.",
      ].filter(Boolean).join(" "),
      seed: seedAt(raw),
      width,
      height,
      steps: perfect ? perfect.steps : (action === "variation" ? 8 : 22),
      guidance: perfect ? perfect.guidance : (action === "variation" ? 1 : 4.5),
      denoise: action === "variation" ? 0.42 : 0.22,
      upscale: action === "quality" && Boolean(perfectRecipe?.upscale),
      imageRecipe: perfectRecipe?.imageRecipe || "standard",
      recipeUpscaleMode: perfectRecipe?.upscaleMode,
      recipeSeedvrProfile: perfectRecipe?.seedvrProfile,
      recipeSeedvrResolution: perfectRecipe?.seedvrResolution,
      mask: raw.maskUpload,
      protectMask: localized,
      automaticTarget: String(raw.maskTarget || "").trim(),
      loras,
      extraMetadata: {
        guidedAction: action === "variation" ? "select_draft" : "finalize",
        perfectModelFamily: perfect?.family.id,
        perfectModelName: perfect?.family.name,
        perfectModelProfile: perfect?.profile,
        perfectRecipe: perfectRecipe?.id,
        perfectRecipeName: perfectRecipe?.name,
        identityReferenceCount: perfect ? continuationReferences.length + 1 : undefined,
      },
    });
  }
  if (action === "finalize") {
    const studioPreset = String(raw.studioPreset || "quality");
    if (studioPreset === "speed") {
      const finalOutput = String(raw.finalOutput || "rtx");
      if (finalOutput === "none") {
        return {
          workflow: {
            "1": {
              inputs: { image: inputPath(selectedUpload) },
              class_type: "LoadImage",
              _meta: { title: "Risultato selezionato" },
            },
            "99": {
              inputs: {
                images: ["1", 0],
                filename_prefix: `Studio/${raw.studioMode || "perfect"}/08_finale`,
              },
              class_type: "SaveImage",
              _meta: { title: "Salva senza upscale" },
            },
          },
          metadata: {
            mediaType: "image",
            generationType: "image",
            workflowId: `studio:${raw.studioMode || "perfect"}`,
            workflowName: `${STUDIO_MODES[raw.studioMode || "perfect"].name} · Master veloce`,
            studioMode: raw.studioMode || "perfect",
            studioStage: "final",
            studioLabel: "Master veloce · stessa risoluzione",
            prompt,
            width,
            height,
            loras: [],
          },
        };
      }
      const engine = finalOutput === "realesrgan"
        ? "model"
        : finalOutput.startsWith("seed")
          ? "seedvr2"
          : "rtx";
      const preset = finalOutput === "seed7" ? "max" : "speed";
      const result = buildUpscaleWorkflow({
        upscaleEngine: engine,
        upscalePreset: preset,
        upscaleModel: "RealESRGAN_x2.pth",
        upscaleAutoPurge: true,
        upscaleSourceWidth: width,
        upscaleSourceHeight: height,
        seed: raw.seed,
      }, selectedUpload, ["RealESRGAN_x2.pth"]);
      result.workflow["99"].inputs.filename_prefix = `Studio/${raw.studioMode || "perfect"}/08_finale`;
      return {
        ...result,
        metadata: {
          ...result.metadata,
          generationType: "image",
          workflowId: `studio:${raw.studioMode || "perfect"}`,
          workflowName: `${STUDIO_MODES[raw.studioMode || "perfect"].name} · Master veloce`,
          studioMode: raw.studioMode || "perfect",
          studioStage: "final",
          studioLabel: "Master veloce · upscale",
          prompt,
        },
      };
    }
    const faceDetailer = boolValue(raw.faceDetailer, true);
    const handDetailer = boolValue(raw.handDetailer, true);
    const localized = ["smartphone", "inpaint"].includes(raw.studioMode)
      || (raw.studioMode === "guidedEdit" && (raw.maskUpload?.name || raw.maskTarget))
      || (raw.studioMode === "smartEditor" && raw.editScope === "local")
      || (raw.studioMode === "relight" && (raw.maskUpload?.name || raw.maskTarget));
    return buildImageJob({
      studioMode: raw.studioMode || "perfect",
      stage: "final",
      label: "Master finale",
      raw: {
        ...raw,
        faceDetailer,
        handDetailer,
        preserveStages: true,
        outputBase: `Studio/${raw.studioMode || "perfect"}`,
      },
      source: selectedUpload,
      modelFile: String(raw.flux1RefineModel || FLUX1_REALISTIC),
      prompt: `${prompt} Refine photographic skin, hair, fabric, materials and natural light without changing the approved composition.`,
      seed: seedAt(raw),
      width,
      height,
      steps: 24,
      guidance: 3.5,
      denoise: numberValue(raw.refineDenoise, studioPreset === "max" ? 0.24 : 0.18, 0.15, 0.32),
      upscale: true,
      mask: raw.maskUpload,
      protectMask: localized,
      automaticTarget: String(raw.maskTarget || "").trim(),
      loras,
      extraMetadata: {
        studioPreset,
        faceDetailer,
        handDetailer,
      },
    });
  }
  throw new Error("Azione guidata non riconosciuta.");
}
