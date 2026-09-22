import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImageWorkflow, IMAGE_MODELS } from "./image-workflows.js";
import { buildUpscaleWorkflow } from "./upscale-workflows.js";
import { buildFirstLastWorkflow } from "./workflows.js";
import { insertModelLoras } from "./loras.js";

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
  duoScene: {
    id: "duoScene",
    name: "DUO SCENE · Anime",
    description: "Inserisce due personaggi distinti in una nuova scena anime, con ambientazione e reference di stile facoltative.",
    input: "optional",
    supportsReferences: false,
    guided: true,
  },
  anima: {
    id: "anima",
    name: "ANIMA · Anime Generator",
    description: "Generazione anime nativa da prompt o con fino a tre identità da profilo/reference sheet e ambientazione facoltativa.",
    input: "text",
    guided: true,
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
  qwenKreaKlein: {
    id: "qwenKreaKlein",
    name: "Qwen · Krea · Klein · SeedVR2",
    description: "Workflow combinato statico: Qwen Image Editing, Krea refine, Klein refine e SeedVR2 finale.",
    input: "source",
    staticWorkflow: true,
  },
  animeToReal: {
    id: "animeToReal",
    name: "The Best Anime to Real",
    description: "Trasforma anime, illustrazioni e personaggi RPG in fotografie ultra realistiche con Qwen Edit, refine Z-Image e SeedVR2.",
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
  kreaRawMaster: {
    id: "kreaRawMaster",
    name: "Krea 2 RAW Master",
    description: "Replica fedele del workflow FameGrid Krea2 Spicy originale: Turbo 0.6, Filter Bypass 1.0, FameGrid 1.0, doppio sampler RES4LYF e Color Finish originale.",
    input: "optional",
  },
};

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const QWEN_KREA_KLEIN_API_FILE = path.resolve(moduleDirectory, "..", "workflows", "Qwen_Krea_Klein_API.json");
const ANIME_TO_REAL_API_FILE = path.resolve(
  moduleDirectory,
  "..",
  "workflows",
  "THE BEST ANIME TO REAL _ ANYTHING TO REAL WORKFLOW_api.json",
);
const KREA_TRIPLE_API_FILES = {
  text: path.resolve(moduleDirectory, "..", "workflows", "KreaTriple_T2I_API.json"),
  img2img: path.resolve(moduleDirectory, "..", "workflows", "KreaTriple_I2I_API.json"),
  selective: path.resolve(moduleDirectory, "..", "workflows", "KreaTriple_Masked_API.json"),
};
const KREA_TRIPLE_NODES = {
  kreaModel: "2",
  kreaSampling: "970090",
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
const KREA_TRIPLE_MODELS = Object.freeze([
  {
    id: "rawBf16",
    name: "Krea 2 RAW BF16 · qualità nativa",
    file: "FluxKrea2\\krea2_raw_bf16.safetensors",
    moodyPromptAnchor: false,
  },
]);
const FLUX2_BASE = "FLUX2\\flux2Klein_9bBase.safetensors";
const FLUX2_TURBO = "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors";
const ZIMAGE_TURBO = "Z-IMG\\z_image_turbo_bf16.safetensors";
const KREA_RAW_MODEL = "FluxKrea2\\krea2_raw_bf16.safetensors";
const KREA2_REFINE = KREA_RAW_MODEL;
const KREA_RAW_CLIP = "qwen3vl_4b_bf16.safetensors";
const KREA_RAW_VAE = "qwen_image_vae.safetensors";
const KREA_FAMEGRID_VAE = "wan_2.1_vae.safetensors";
const KREA_RAW_FIXED_LORAS = Object.freeze([
  { name: "FLUX\\STY_Krea2_Turbo_Rank64_BF16.safetensors", strength: 0.6 },
  { name: "FLUX\\STY_Krea2_Filter_Bypass_v3.safetensors", strength: 1.0 },
  { name: "FLUX\\STY_FameGrid_Krea2_Spice_FIX_trigger-famegrid.safetensors", strength: 1.0 },
]);
const KREA_RAW_ORIGINAL_NEGATIVE = "cartoon, anime, illustration, painting, drawing, sketch, 3d render, cgi, video game, plastic skin, airbrushed, cartoon eyes, overly smooth skin, doll-like, waxy skin, freckles, blurry, out of focus, low resolution, low quality, jpeg artifacts, oversaturated, overexposed, underexposed, harsh shadows, deformed, disfigured, extra limbs, extra fingers, missing fingers, mutated hands, bad anatomy, asymmetrical eyes, cross-eyed, unnatural pose, stiff pose, mannequin, watermark, text, logo, signature, frame, border, duplicate, cloned face, symmetrical face, perfect symmetry, studio backdrop, plain background, overprocessed, HDR look, glossy filter, beauty filter, smooth skin filter, AI artifacts, uncanny valley";
const KREA_RAW_ASPECT_RATIOS = Object.freeze({
  "1:1 (Square)": [1, 1],
  "2:3 (Portrait Photo)": [2, 3],
  "3:2 (Photo)": [3, 2],
  "3:4 (Portrait Standard)": [3, 4],
  "4:3 (Standard)": [4, 3],
  "9:16 (Portrait Widescreen)": [9, 16],
  "16:9 (Widescreen)": [16, 9],
  "21:9 (Ultrawide)": [21, 9],
});

function kreaRawResolution(aspectRatio, megapixels, multiple = 8) {
  const [ratioWidth, ratioHeight] = KREA_RAW_ASPECT_RATIOS[aspectRatio];
  const pixels = megapixels * 1_000_000;
  return [
    Math.max(multiple, Math.round(Math.sqrt(pixels * ratioWidth / ratioHeight) / multiple) * multiple),
    Math.max(multiple, Math.round(Math.sqrt(pixels * ratioHeight / ratioWidth) / multiple) * multiple),
  ];
}
const QWEN_EDIT_2511 = "QWEN\\qwen_image_edit_2511_bf16.safetensors";
const ANIMA_TEXT_ENCODER = "qwen_3_06b_base.safetensors";
const ANIMA_VAE = "qwen_image_vae.safetensors";
const ANIMA_MODELS = Object.freeze([
  { id: "turbo", name: "ANIMA Turbo v1.1 · rapidissimo", file: "ANIMA\\anima_turboV11.safetensors", steps: 8, cfg: 1, sampler: "euler", scheduler: "simple" },
  { id: "animij", name: "Animij S1 · espressivo / pittorico", file: "ANIMA\\animij_s1.safetensors", steps: 32, cfg: 6, sampler: "er_sde", scheduler: "simple" },
  { id: "miaomiao", name: "MiaoMiao Harem ANIMA 1.6 · estetica ricca", file: "ANIMA\\miaomiaoHarem_anima16.safetensors", steps: 30, cfg: 4.5, sampler: "euler_ancestral", scheduler: "normal" },
  { id: "hoseki", name: "Hoseki LustrousMix ANIMA 1.0", file: "ANIMA\\hosekiLustrousmixAnima_animaV10.safetensors", steps: 24, cfg: 4, sampler: "euler_ancestral", scheduler: "normal" },
  { id: "rimix", name: "Ri-mix Illustrious ANIMA α", file: "ANIMA\\riMixIllustriousAnima_riMixAnima.safetensors", steps: 30, cfg: 3, sampler: "er_sde", scheduler: "simple" },
  { id: "wai", name: "WAI-ANIMA v1.0", file: "ANIMA\\waiANIMA_v10Base10.safetensors", steps: 30, cfg: 5, sampler: "euler_ancestral", scheduler: "normal" },
]);
const STORYBOARD_MODELS = {
  qwenImage: {
    id: "qwenImage",
    name: "Qwen Image 2512 · Text to Image",
    draft: IMAGE_MODELS.qwenImage.defaultModelFile,
    quality: IMAGE_MODELS.qwenImage.defaultModelFile,
    steps: IMAGE_MODELS.qwenImage.defaults.steps,
    guidance: IMAGE_MODELS.qwenImage.defaults.guidance,
  },
  qwen2511: {
    id: "qwen2511",
    name: "Qwen Image Edit 2511 BF16",
    draft: QWEN_EDIT_2511,
    quality: QWEN_EDIT_2511,
    steps: 40,
    guidance: 4,
  },
  klein: {
    id: "klein",
    name: "Flux.2 Klein 9B Base",
    draft: FLUX2_TURBO,
    quality: FLUX2_BASE,
  },
  krea2: {
    id: "krea2",
    name: "Krea 2 · Text to Image",
    draft: IMAGE_MODELS.fluxKrea2.defaultModelFile,
    quality: IMAGE_MODELS.fluxKrea2.defaultModelFile,
    steps: IMAGE_MODELS.fluxKrea2.defaults.steps,
    guidance: IMAGE_MODELS.fluxKrea2.defaults.guidance,
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
  const seed = raw.seed === undefined || raw.seed === null || raw.seed === ""
    ? crypto.randomInt(0, 2 ** 31)
    : seedAt(raw);
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

  // The Krea RAW refinement must use a genuine unconditional embedding.
  // ConditioningZeroOut leaves a zero tensor here and produces the coloured
  // speckle/mosaic artifact seen with CFG > 1, even when the negative is empty.
  workflow["396"] = {
    inputs: { text: negativePrompt, clip: ["414", 0] },
    class_type: "CLIPTextEncode",
    _meta: { title: negativePrompt ? "Krea RAW · prompt negativo" : "Krea RAW · negative vuoto codificato" },
  };
  // Krea 2 shares the Qwen Image latent space, not the Wan video VAE.
  if (workflow["415"]?.inputs) workflow["415"].inputs.vae_name = KREA_RAW_VAE;
  // Read the real size of the image entering the img2img refinement so the
  // official dynamic-shift schedule stays correct for every aspect ratio.
  workflow["940100"] = {
    inputs: { image: ["286", 0] },
    class_type: "GetImageSize",
    _meta: { title: "Krea RAW · dimensioni effettive" },
  };
  workflow["940101"] = {
    inputs: {
      model: ["413", 0],
      sampling_mode: "raw_dynamic",
      width: ["940100", 0],
      height: ["940100", 1],
      manual_shift: 1.15,
    },
    class_type: "Krea2ModelSampling",
    _meta: { title: "Krea 2 RAW · shift dinamico ufficiale" },
  };
  if (workflow["499"]?.inputs) {
    workflow["499"].inputs.model = ["940101", 0];
    workflow["499"].inputs.return_with_leftover_noise = "disable";
  }

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
        kreaSamplingNode: "940101",
        kleinRefineNode: "480",
        seedvr2Node: "492",
      },
      loras: [],
    },
  };
}

function configurePurgeNode(node) {
  node.class_type = "DisTorchPurgeVRAMV2";
  node.inputs = {
    ...node.inputs,
    purge_seedvr2_models: false,
    purge_qwen3vl_models: true,
    purge_nunchaku_models: true,
    HSWQ: false,
    Ollama: false,
  };
}

function buildAnimeToRealJob(raw, source) {
  if (!source?.name) throw new Error("Carica l'immagine anime da trasformare.");
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci il prompt enhanced generato con LM Studio.");
  const negativePrompt = String(raw.negativePrompt || "").trim();
  const workflow = cloneStaticWorkflow(ANIME_TO_REAL_API_FILE);
  const seed = raw.seed === undefined || raw.seed === null || raw.seed === ""
    ? crypto.randomInt(0, 2 ** 31)
    : seedAt(raw);
  const sourcePath = inputPath(source);

  // Qwen-VL e i suoi nodi di testo intermedi sono volutamente esclusi: il prompt
  // enhanced di LM Studio alimenta direttamente sia Qwen Edit sia Z-Image.
  for (const id of ["27", "271", "272", "273", "290", "292", "304", "305", "306", "309", "328", "339"]) {
    delete workflow[id];
  }

  workflow["22"].inputs.image = sourcePath;
  workflow["92"].inputs.clip_name = "qwen_2.5_vl_7b_fp8_scaled.safetensors";
  workflow["98"].inputs.unet_name = "QWEN\\qwen_image_edit_2511_bf16.safetensors";
  workflow["108"].inputs.lora_name = "QWEN\\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors";
  workflow["158"].inputs.lora_name = "QWEN\\Anime2Real_v4-22.safetensors";
  workflow["228"].inputs.lora_name = "QWEN\\anything2real_2601_A_final.safetensors";
  workflow["240"].inputs.lora_name = "QWEN\\iphone style.safetensors";
  workflow["241"].inputs.lora_name = "QWEN\\Qwen-Image_SmartphoneSnapshotPhotoReality.safetensors";
  workflow["247"].inputs.lora_name = "QWEN\\NSFW-Qwen_Snofs_1_3.safetensors";
  workflow["313"].inputs.lora_name = "QWEN\\Famegrid_Qwen_Lora_Standard_V1.5_RealSkinFix.safetensors";
  workflow["147"].inputs.prompt = prompt;

  workflow["122"] = {
    inputs: {
      seed,
      steps: 4,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "beta",
      denoise: 1,
      model: ["313", 0],
      positive: ["147", 0],
      negative: ["137", 0],
      latent_image: ["157", 0],
    },
    class_type: "KSampler",
    _meta: { title: "Qwen Edit · 4 step Lightning" },
  };
  workflow["940100"] = {
    inputs: { samples: ["122", 0], vae: ["95", 0] },
    class_type: "VAEDecode",
    _meta: { title: "Qwen Edit · decoded image" },
  };
  workflow["287"].inputs.anything = ["940100", 0];

  workflow["284"].inputs.unet_name = "Z-IMG\\moodyProMix_zitV13.safetensors";
  workflow["261"].inputs.vae_name = "ae.safetensors";
  delete workflow["283"];
  delete workflow["285"];
  workflow["286"].inputs.model = ["284", 0];
  workflow["269"].inputs.text = prompt;
  workflow["268"] = {
    inputs: { model: ["286", 0], scheduler: "beta", steps: 12, denoise: 0.5 },
    class_type: "BasicScheduler",
    _meta: { title: "Z-Image refine · second half schedule" },
  };
  workflow["265"].inputs.noise_seed = seed + 1;

  for (const node of Object.values(workflow)) {
    if (node?.class_type === "LayerUtility: PurgeVRAM V2") configurePurgeNode(node);
  }
  workflow["294"].inputs.seed = seed + 2;
  workflow["294"].inputs.batch_size = 1;
  workflow["296"].inputs.blocks_to_swap = 18;
  workflow["296"].inputs.swap_io_components = true;
  workflow["296"].inputs.offload_device = "cpu";
  workflow["296"].inputs.attention_mode = "sdpa";
  workflow["256"].inputs.filename_prefix = "Studio/anime_to_real/08_finale";
  workflow["940200"] = {
    inputs: { image: workflow["256"].inputs.images },
    class_type: "RemoteImageTensorNormalize",
    _meta: { title: "Normalizza output SeedVR2 per SaveImage" },
  };
  workflow["256"].inputs.images = ["940200", 0];

  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "image",
      workflowId: "studio:animeToReal",
      workflowName: "The Best Anime to Real · Qwen + Z-Image + SeedVR2",
      studioMode: "animeToReal",
      studioStage: "final",
      studioLabel: "Anime/Anything to ultra realistic photo",
      prompt,
      negativePrompt,
      width: numberValue(raw.imageWidth, 1024, 256, 8192, true),
      height: numberValue(raw.imageHeight, 1024, 256, 8192, true),
      seed,
      sourceImage: sourcePath,
      imageModelFile: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
      imageModelName: "Qwen Edit 2511 + MoodyProMix Z-Image + SeedVR2 7B",
      imageModelFamily: "qwenEdit",
      imageSettings: {
        staticWorkflow: path.basename(ANIME_TO_REAL_API_FILE),
        promptSource: "lmStudioEnhanced",
        qwenVlRemoved: true,
        qwenEditNode: "147",
        zImageRefineNode: "265",
        seedvr2Node: "294",
        outputNormalizeNode: "940200",
      },
      loras: [
        "QWEN\\Anime2Real_v4-22.safetensors",
        "QWEN\\anything2real_2601_A_final.safetensors",
        "QWEN\\Famegrid_Qwen_Lora_Standard_V1.5_RealSkinFix.safetensors",
      ],
    },
  };
}

function kreaTripleOperation(raw) {
  const operation = String(raw.kreaTripleOperation || "text");
  if (operation === "image") return "img2img";
  return ["text", "img2img", "selective"].includes(operation) ? operation : "text";
}

function kreaTripleModelSelection(raw) {
  const requested = String(raw.kreaTripleModel || KREA_TRIPLE_MODELS[0].file).replaceAll("/", "\\");
  const selected = KREA_TRIPLE_MODELS.find((model) => model.file.toLowerCase() === requested.toLowerCase());
  if (!selected) throw new Error("Modello Krea Triple non riconosciuto.");
  return selected;
}

function configureKreaTripleCommon(workflow, raw, { operation, model, prompt, negativePrompt, seed, width, height }) {
  const nodes = KREA_TRIPLE_NODES;
  workflow[nodes.kreaModel].inputs.unet_name = model.file;
  workflow[nodes.kreaSampling] = {
    inputs: {
      model: [nodes.kreaModel, 0],
      sampling_mode: "raw_dynamic",
      width,
      height,
      manual_shift: 1.15,
    },
    class_type: "Krea2ModelSampling",
    _meta: { title: "Krea 2 RAW · shift dinamico ufficiale" },
  };
  workflow[nodes.kreaLatent].inputs.model = [nodes.kreaSampling, 0];
  workflow[nodes.kreaPrompt].inputs.text = prompt;
  workflow[nodes.zPrompt].inputs.text = prompt;
  workflow[nodes.kleinPrompt].inputs.text = prompt;
  workflow[nodes.kreaLatent].inputs.seed = seed;
  // This is an img2img cleanup stage, not an independent variation.  Keep
  // the seed stable and the denoise low so Z-Image cannot repaint anatomy or
  // amplify the RAW model's high-frequency texture.
  workflow[nodes.zSampler].inputs.seed = seed;
  workflow[nodes.zSampler].inputs.denoise = Math.min(
    numberValue(raw.kreaTripleZRefineDenoise, 0.12, 0.05, 0.25),
    0.15,
  );
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
  // Krea 2 RAW uses real unconditional embeddings for CFG.  Zeroing the
  // positive conditioning when the negative prompt is empty produces the
  // coloured dot/mosaic pattern seen at native 1K resolutions.
  for (const [id, clipId] of [["6", "3"], ["16", "75"], ["37", "32"]]) {
    workflow[id] = {
      inputs: { text: negativePrompt, clip: [clipId, 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "Krea Triple · negative conditioning codificato" },
    };
  }

  // These two nodes were debug saves in the imported template and created
  // large, misleading intermediate files.  Keep previews available without
  // treating damaged intermediate stages as deliverables.
  for (const id of ["25", "38"]) {
    if (workflow[id]?.class_type !== "SaveImage") continue;
    const images = workflow[id].inputs.images;
    workflow[id] = { inputs: { images }, class_type: "PreviewImage", _meta: { title: "Krea Triple · anteprima diagnostica" } };
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

function addKreaTripleMaskComposite(workflow, source, mask, raw, generatedImage) {
  workflow["970110"] = {
    inputs: { image: inputPath(mask) },
    class_type: "LoadImage",
    _meta: { title: "Krea Triple · maschera manuale" },
  };
  workflow["970120"] = {
    inputs: { image: generatedImage },
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
      source: generatedImage,
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

function pruneWorkflowToOutputs(workflow, outputIds) {
  const required = new Set(outputIds.filter((id) => workflow[id]));
  const pending = [...required];
  while (pending.length) {
    const id = pending.pop();
    const node = workflow[id];
    if (!node?.inputs) continue;
    for (const value of Object.values(node.inputs)) {
      if (!Array.isArray(value) || value.length !== 2) continue;
      const dependency = String(value[0]);
      if (!workflow[dependency] || required.has(dependency)) continue;
      required.add(dependency);
      pending.push(dependency);
    }
  }
  for (const id of Object.keys(workflow)) {
    if (!required.has(id)) delete workflow[id];
  }
}

function configureKreaTripleStages(workflow, raw, operation, source, mask) {
  const stages = {
    krea: true,
    zImage: boolValue(raw.kreaTripleUseZImage, true),
    klein: boolValue(raw.kreaTripleUseKlein, true),
    seedvr2: boolValue(raw.kreaTripleUseSeedVR2, true),
  };
  let generatedImage = ["9", 0];
  const previewOutputs = ["10"];

  if (stages.zImage) {
    generatedImage = ["18", 0];
    previewOutputs.push("25");
  }
  if (stages.klein) {
    workflow["33"].inputs.image = generatedImage;
    workflow["67"].inputs.image_ref = generatedImage;
    generatedImage = ["67", 0];
    previewOutputs.push("38");
  }
  if (stages.seedvr2) {
    workflow["42"].inputs.image = generatedImage;
    generatedImage = [KREA_TRIPLE_NODES.finalImage, 0];
  }

  if (operation === "selective") {
    addKreaTripleMaskComposite(workflow, source, mask, raw, generatedImage);
  } else {
    workflow[KREA_TRIPLE_NODES.finalSave].inputs.images = generatedImage;
  }
  pruneWorkflowToOutputs(workflow, [KREA_TRIPLE_NODES.finalSave, ...previewOutputs]);
  return stages;
}

function buildKreaTripleJob(raw, { source, mask }) {
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci il prompt per Krea Triple Studio.");
  const operation = kreaTripleOperation(raw);
  if (operation !== "text" && !source?.name) throw new Error("Krea Triple Image to Image richiede una fotografia sorgente.");
  if (operation === "selective" && !mask?.name) throw new Error("Krea Triple Selective richiede una maschera manuale.");
  const workflow = cloneStaticWorkflow(KREA_TRIPLE_API_FILES[operation]);
  const model = kreaTripleModelSelection(raw);
  const [requestedWidth, requestedHeight] = dimensions(raw);
  const [width, height] = fitKreaRawResolution(requestedWidth, requestedHeight);
  const seed = seedAt(raw);
  const negativePrompt = String(raw.negativePrompt || "").trim();
  configureKreaTripleCommon(workflow, raw, { operation, model, prompt, negativePrompt, seed, width, height });
  if (operation !== "text") addKreaTripleSourceLatent(workflow, source, raw, width, height);
  const stages = configureKreaTripleStages(workflow, raw, operation, source, mask);
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
      imageModelName: `${model.name} + Z-Image + Flux2 Klein + SeedVR2`,
      imageModelFamily: "kreaTriple",
      imageSettings: {
        operation,
        requestedWidth,
        requestedHeight,
        kreaNativeWidth: width,
        kreaNativeHeight: height,
        kreaModel: model.file,
        kreaModelId: model.id,
        moodyPromptAnchor: model.moodyPromptAnchor,
        denoise: operation === "text" ? 1 : numberValue(raw.kreaTripleDenoise ?? raw.denoise, 0.35, 0.1, 0.8),
        staticWorkflow: path.basename(KREA_TRIPLE_API_FILES[operation]),
        nodes: KREA_TRIPLE_NODES,
        seedvr2CacheModelBoolean: workflow[KREA_TRIPLE_NODES.seedvr2Dit]?.inputs?.cache_model === true,
        stages,
        finalStage: stages.seedvr2 ? "seedvr2" : stages.klein ? "klein" : stages.zImage ? "zImage" : "krea",
      },
      loras: [],
    },
  };
}

function buildKreaRawMasterJob(raw, loras = []) {
  const userPrompt = String(raw.prompt || "").trim();
  if (!userPrompt) throw new Error("Inserisci il prompt per Krea 2 RAW Master.");
  const prompt = /^famegrid\s*,?/i.test(userPrompt) ? userPrompt : `famegrid,\n${userPrompt}`;
  const extraNegative = String(raw.negativePrompt || "").trim();
  const negativePrompt = extraNegative
    ? `${KREA_RAW_ORIGINAL_NEGATIVE}, ${extraNegative}`
    : KREA_RAW_ORIGINAL_NEGATIVE;
  const requestedAspectRatio = String(raw.kreaRawAspectRatio || "9:16 (Portrait Widescreen)");
  const aspectRatio = KREA_RAW_ASPECT_RATIOS[requestedAspectRatio]
    ? requestedAspectRatio
    : "9:16 (Portrait Widescreen)";
  const megapixels = numberValue(raw.kreaRawMegapixels, 1.2, 0.1, 16);
  const resolutionMultiple = 8;
  const [width, height] = kreaRawResolution(aspectRatio, megapixels, resolutionMultiple);
  const seed = raw.seed === undefined || raw.seed === null || raw.seed === ""
    ? crypto.randomInt(0, 2 ** 31)
    : seedAt(raw);
  const refineSeed = raw.seed === undefined || raw.seed === null || raw.seed === ""
    ? crypto.randomInt(0, 2 ** 31)
    : seed + 1;
  const workflow = {
    "316": { inputs: { unet_name: KREA_RAW_MODEL, weight_dtype: "default" }, class_type: "UNETLoader", _meta: { title: "Load Diffusion Model" } },
    "154": { inputs: { lora_name: KREA_RAW_FIXED_LORAS[0].name, strength_model: 0.6, model: ["316", 0] }, class_type: "LoraLoaderModelOnly", _meta: { title: "Krea 2 Turbo" } },
    "155": { inputs: { lora_name: KREA_RAW_FIXED_LORAS[1].name, strength_model: 1.0, model: ["154", 0] }, class_type: "LoraLoaderModelOnly", _meta: { title: "Krea 2 filter bypass" } },
    "128": { inputs: { lora_name: KREA_RAW_FIXED_LORAS[2].name, strength_model: 1.0, model: ["155", 0] }, class_type: "LoraLoaderModelOnly", _meta: { title: "FameGrid Spicy · strength 1.0" } },
    "317": { inputs: { clip_name: KREA_RAW_CLIP, type: "krea2", device: "default" }, class_type: "CLIPLoader", _meta: { title: "Load CLIP" } },
    "48": { inputs: { value: prompt }, class_type: "PrimitiveStringMultiline", _meta: { title: "Positive" } },
    "6": { inputs: { text: ["48", 0], clip: ["317", 0] }, class_type: "CLIPTextEncode", _meta: { title: "CLIP Text Encode (Prompt)" } },
    "271": { inputs: { value: negativePrompt }, class_type: "PrimitiveStringMultiline", _meta: { title: "Negative" } },
    "272": { inputs: { text: ["271", 0], clip: ["317", 0] }, class_type: "CLIPTextEncode", _meta: { title: "CLIP Text Encode (Prompt)" } },
    "282": { inputs: { value: 1.0 }, class_type: "PrimitiveFloat", _meta: { title: "CFG" } },
    "341": { inputs: { aspect_ratio: aspectRatio, megapixels, multiple: resolutionMultiple }, class_type: "ResolutionSelector", _meta: { title: "Resolution Selector" } },
    "232": { inputs: { width: ["341", 0], height: ["341", 1], batch_size: 1 }, class_type: "EmptyLatentImage", _meta: { title: "Empty Latent Image" } },
    "210": { inputs: { vae_name: KREA_FAMEGRID_VAE }, class_type: "VAELoader", _meta: { title: "Load VAE" } },
  };
  const optionalLoras = lorasForModel(loras, KREA_RAW_MODEL);
  let modelLink = ["128", 0];
  optionalLoras.forEach((lora, index) => {
    const id = String(900100 + index);
    workflow[id] = {
      inputs: { model: modelLink, lora_name: lora.name, strength_model: lora.strength },
      class_type: "LoraLoaderModelOnly",
      _meta: { title: `LoRA aggiuntiva ${index + 1} · ${lora.name}` },
    };
    modelLink = [id, 0];
  });
  workflow["265"] = {
    inputs: {
      eta: 0.5,
      sampler_name: "multistep/res_2m",
      scheduler: "beta57",
      steps: 6,
      steps_to_run: -1,
      denoise: 1.0,
      cfg: ["282", 0],
      seed,
      sampler_mode: "standard",
      bongmath: true,
      model: modelLink,
      positive: ["6", 0],
      negative: ["272", 0],
      latent_image: ["232", 0],
    },
    class_type: "ClownsharKSampler_Beta",
    _meta: { title: "ClownsharKSampler · RES 2M" },
  };
  workflow["274"] = {
    inputs: {
      eta: 0.5,
      sampler_name: "multistep/deis_3m",
      scheduler: "bong_tangent",
      steps: 2,
      steps_to_run: -1,
      denoise: 0.2,
      cfg: ["282", 0],
      seed: refineSeed,
      sampler_mode: "standard",
      bongmath: true,
      model: modelLink,
      positive: ["6", 0],
      negative: ["272", 0],
      latent_image: ["265", 0],
    },
    class_type: "ClownsharKSampler_Beta",
    _meta: { title: "ClownsharKSampler · DEIS 3M refine" },
  };
  workflow["8"] = { inputs: { samples: ["274", 0], vae: ["210", 0] }, class_type: "VAEDecode", _meta: { title: "VAE Decode" } };
  workflow["340"] = {
    inputs: { image: ["8", 0], color_strength: 1.0, sharpen_strength: 0.2 },
    class_type: "FameGridColorFinish",
    _meta: { title: "FameGrid color and detail finish" },
  };
  workflow["213"] = { inputs: { images: ["340", 0], filename_prefix: "Studio/krea_raw_master/famegrid_v2" }, class_type: "SaveImage", _meta: { title: "Save Image" } };
  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "image",
      workflowId: "studio:kreaRawMaster",
      workflowName: "Krea 2 RAW Master",
      studioMode: "kreaRawMaster",
      studioStage: "final",
      studioLabel: "ORIGINALE · FameGrid Krea2 Spicy · doppio RES4LYF",
      prompt,
      negativePrompt,
      width,
      height,
      seed,
      imageModelFile: KREA_RAW_MODEL,
      imageModelName: "Krea 2 Raw BF16 + Turbo 0.6 + Filter Bypass + FameGrid 1.0",
      imageModelFamily: "fluxKrea2",
      imageSettings: {
        sourceWorkflow: "FameGrid_Krea2_Spicy_CORRECTED.json",
        faithfulOriginal: true,
        samplers: [
          { node: "265", sampler: "multistep/res_2m", scheduler: "beta57", steps: 6, denoise: 1.0, cfg: 1.0, seed },
          { node: "274", sampler: "multistep/deis_3m", scheduler: "bong_tangent", steps: 2, denoise: 0.2, cfg: 1.0, seed: refineSeed },
        ],
        resolutionSelector: { node: "341", aspectRatio, megapixels, multiple: resolutionMultiple },
        colorFinish: { colorStrength: 1.0, sharpenStrength: 0.2 },
        fixedLoras: KREA_RAW_FIXED_LORAS,
        upscale: "manual",
      },
      loras: [...KREA_RAW_FIXED_LORAS, ...optionalLoras],
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

function fitKreaRawResolution(width, height) {
  // Krea 2 RAW is trained for roughly 1K generation.  Running the base model
  // directly near 2 MP produces the coloured high-frequency ringing visible
  // in the affected outputs.  Preserve aspect ratio on a 32 px latent grid;
  // later Krea Triple stages perform the high-resolution reconstruction.
  const maxPixels = 1024 * 1024;
  if (width * height <= maxPixels) return [width, height];
  const scale = Math.sqrt(maxPixels / (width * height));
  const fittedWidth = Math.max(256, Math.floor((width * scale) / 32) * 32);
  const fittedHeight = Math.max(256, Math.floor((height * scale) / 32) * 32);
  return [fittedWidth, fittedHeight];
}

function seedAt(raw, index = 0) {
  const parsed = Number(raw.seed);
  const seed = Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : crypto.randomInt(0, 2 ** 31);
  return seed + index;
}

function animaReferencePrompt(raw, scenePrompt, references) {
  const flags = [
    boolValue(raw.animaHasCharacter2),
    boolValue(raw.animaHasCharacter3),
    boolValue(raw.animaHasEnvironment),
  ];
  if (references.length !== flags.filter(Boolean).length) {
    throw new Error("Le reference ANIMA non corrispondono agli slot selezionati. Ricarica i personaggi e l’ambientazione.");
  }
  const roles = [{ image: 1, role: "character1" }];
  let imageIndex = 2;
  if (flags[0]) roles.push({ image: imageIndex++, role: "character2" });
  if (flags[1]) roles.push({ image: imageIndex++, role: "character3" });
  if (flags[2]) roles.push({ image: imageIndex++, role: "environment" });
  const roleInstructions = roles.map(({ image, role }) => role === "environment"
    ? `Image ${image} is the environment reference only. Preserve its location, spatial layout, camera viewpoint, architecture and lighting direction; never copy people from it.`
    : `Image ${image} is the identity reference for character ${role.slice(-1)} only. It may be a portrait or a reference sheet. Preserve that character's recognizable face, hairstyle, colors, body traits, outfit-defining details and distinctive features; never reproduce the sheet layout.`);
  const presentCharacters = roles
    .filter((item) => item.role.startsWith("character"))
    .map((item) => Number(item.role.slice(-1)));
  return {
    prompt: [
      `Create one unified single-frame anime scene with exactly ${roles.filter((item) => item.role !== "environment").length} principal referenced character(s).`,
      ...roleInstructions,
      `Requested scene: ${scenePrompt}`,
      ...presentCharacters.map((number) => {
        const text = String(raw[`animaCharacter${number}Direction`] || "").trim();
        return text && `Character ${number} role, placement and action: ${text}.`;
      }).filter(Boolean),
      "Keep every identity separate and recognizable. Never merge, average, swap or leak faces, hair, bodies, clothing or accessories between characters.",
      "Integrate anatomy, gaze, scale, pose, perspective, contact, occlusion, shadows and environmental light naturally.",
      "Output one finished scene only, never a collage, split screen, lineup, comparison panel or reference sheet.",
    ].join(" "),
    roles,
  };
}

const ANIMA_QUALITY_LEVELS = new Set(["fast", "balanced", "max"]);

function animaSamplingPasses(raw, model, initialDenoise) {
  const quality = ANIMA_QUALITY_LEVELS.has(String(raw.animaQuality || "fast"))
    ? String(raw.animaQuality || "fast")
    : "fast";
  const passes = [{
    stage: "base",
    steps: model.steps,
    cfg: model.cfg,
    sampler: model.sampler,
    scheduler: model.scheduler,
    denoise: initialDenoise,
  }];
  if (quality === "balanced" || quality === "max") {
    const denoise = Math.round(Math.min(0.24, initialDenoise * 0.48) * 100) / 100;
    passes.push({
      stage: "detail",
      steps: Math.max(6, Math.min(12, Math.round(model.steps * 0.4))),
      cfg: model.cfg,
      sampler: "er_sde",
      scheduler: "simple",
      denoise,
    });
  }
  if (quality === "max") {
    const previous = passes.at(-1).denoise;
    passes.push({
      stage: "polish",
      steps: Math.max(4, Math.min(8, Math.round(model.steps * 0.25))),
      cfg: model.cfg,
      sampler: "dpmpp_2m_sde",
      scheduler: "karras",
      denoise: Math.round(Math.min(0.12, previous * 0.5) * 100) / 100,
    });
  }
  return { quality, passes };
}

function addAnimaRefinementPasses(workflow, {
  baseSamplerId,
  extraSamplerIds,
  modelLink,
  positive,
  negative,
  seed,
  sampling,
  decodeId,
}) {
  const samplerIds = [baseSamplerId];
  let previous = baseSamplerId;
  sampling.passes.slice(1).forEach((pass, index) => {
    const nodeId = extraSamplerIds[index];
    workflow[nodeId] = {
      inputs: {
        model: modelLink,
        positive,
        negative,
        latent_image: [previous, 0],
        seed: seed + 2000 + index,
        steps: pass.steps,
        cfg: pass.cfg,
        sampler_name: pass.sampler,
        scheduler: pass.scheduler,
        denoise: pass.denoise,
      },
      class_type: "KSampler",
      _meta: { title: `ANIMA · ${pass.stage === "detail" ? "dettaglio" : "polish finale"} · denoise ${pass.denoise}` },
    };
    samplerIds.push(nodeId);
    previous = nodeId;
  });
  workflow[decodeId].inputs.samples = [previous, 0];
  return samplerIds;
}

function buildAnimaJob(raw, model, index, width, height, { source, references = [] } = {}, loras = []) {
  const seed = seedAt({ ...raw, seed: raw.animaSeed }, index);
  const scenePrompt = String(raw.prompt || "").trim();
  const usesReferences = String(raw.animaInputMode || "text") === "references";
  if (usesReferences && !source?.name) throw new Error("Carica almeno il personaggio principale per ANIMA.");
  const referencePlan = usesReferences ? animaReferencePrompt(raw, scenePrompt, references) : null;
  const prompt = referencePlan?.prompt || scenePrompt;
  const negative = String(raw.negativePrompt || "").trim()
    || "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, malformed anatomy, extra limbs, extra fingers, text, watermark";
  const initialDenoise = usesReferences
    ? numberValue(raw.animaReferenceStrength, 0.5, 0.2, 0.8)
    : 1;
  const sampling = animaSamplingPasses(raw, model, initialDenoise);
  let workflow = {
    "1": {
      inputs: { unet_name: model.file, weight_dtype: "default" },
      class_type: "UNETLoader",
      _meta: { title: `ANIMA · ${model.name}` },
    },
    "2": {
      inputs: { clip_name: ANIMA_TEXT_ENCODER, type: "stable_diffusion", device: "default" },
      class_type: "CLIPLoader",
      _meta: { title: "ANIMA · Qwen3 0.6B" },
    },
    "3": {
      inputs: { vae_name: ANIMA_VAE },
      class_type: "VAELoader",
      _meta: { title: "ANIMA · Qwen Image VAE" },
    },
    "4": {
      inputs: { text: prompt, clip: ["2", 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "ANIMA · Prompt" },
    },
    "5": {
      inputs: { text: negative, clip: ["2", 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "ANIMA · Negative" },
    },
    "6": {
      inputs: { width, height, batch_size: 1 },
      class_type: "EmptyLatentImage",
      _meta: { title: "ANIMA · Formato" },
    },
    "7": {
      inputs: {
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        seed,
        steps: model.steps,
        cfg: model.cfg,
        sampler_name: model.sampler,
        scheduler: model.scheduler,
        denoise: initialDenoise,
      },
      class_type: "KSampler",
      _meta: { title: `ANIMA · ${model.steps} step · CFG ${model.cfg}` },
    },
    "8": {
      inputs: { samples: ["7", 0], vae: ["3", 0] },
      class_type: "VAEDecode",
      _meta: { title: "ANIMA · Decode" },
    },
    "9": {
      inputs: { images: ["8", 0], filename_prefix: `Studio/anima/${model.id}` },
      class_type: "SaveImage",
      _meta: { title: "ANIMA · Salva" },
    },
  };
  let animaSamplerIds = ["7"];
  if (usesReferences) {
    const composition = buildImageWorkflow("flux2", {
      imageModelFile: FLUX2_BASE,
      imageMode: "image",
      imageResolution: "custom",
      imageWidth: width,
      imageHeight: height,
      imageSteps: 20,
      imageGuidance: 5,
      denoise: 1,
      prompt,
      negativePrompt: `${negative}, merged identities, blended faces, identity leakage, duplicate principal character, collage, split screen, reference sheet`,
      seed,
      batchSize: 1,
      referenceUploads: references,
      upscaleMode: "none",
      saveOriginal: true,
    }, source, []);
    workflow = composition.workflow;
    for (const [nodeId, node] of Object.entries(workflow)) {
      if (node.class_type === "SaveImage") delete workflow[nodeId];
    }
    workflow["970001"] = {
      inputs: { image: ["15", 0], upscale_method: "lanczos", width, height, crop: "disabled" },
      class_type: "ImageScale",
      _meta: { title: "ANIMA · adatta composizione identitaria" },
    };
    workflow["970002"] = {
      inputs: { unet_name: model.file, weight_dtype: "default" },
      class_type: "UNETLoader",
      _meta: { title: `ANIMA · ${model.name}` },
    };
    workflow["970003"] = {
      inputs: { clip_name: ANIMA_TEXT_ENCODER, type: "stable_diffusion", device: "default" },
      class_type: "CLIPLoader",
      _meta: { title: "ANIMA · Qwen3 0.6B" },
    };
    workflow["970004"] = {
      inputs: { vae_name: ANIMA_VAE },
      class_type: "VAELoader",
      _meta: { title: "ANIMA · Qwen Image VAE" },
    };
    workflow["970005"] = {
      inputs: { text: prompt, clip: ["970003", 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "ANIMA · prompt scena coerente" },
    };
    workflow["970006"] = {
      inputs: { text: negative, clip: ["970003", 0] },
      class_type: "CLIPTextEncode",
      _meta: { title: "ANIMA · negativo" },
    };
    workflow["970007"] = {
      inputs: { pixels: ["970001", 0], vae: ["970004", 0] },
      class_type: "VAEEncode",
      _meta: { title: "ANIMA · encode composizione" },
    };
    workflow["970008"] = {
      inputs: {
        model: ["970002", 0],
        positive: ["970005", 0],
        negative: ["970006", 0],
        latent_image: ["970007", 0],
        seed: seed + 1000,
        steps: model.steps,
        cfg: model.cfg,
        sampler_name: model.sampler,
        scheduler: model.scheduler,
        denoise: initialDenoise,
      },
      class_type: "KSampler",
      _meta: { title: `ANIMA · render ${model.steps} step · CFG ${model.cfg}` },
    };
    workflow["970009"] = {
      inputs: { samples: ["970008", 0], vae: ["970004", 0] },
      class_type: "VAEDecode",
      _meta: { title: "ANIMA · decode finale" },
    };
    workflow["970010"] = {
      inputs: { images: ["970009", 0], filename_prefix: `Studio/anima/${model.id}_references` },
      class_type: "SaveImage",
      _meta: { title: "ANIMA · salva scena coerente" },
    };
    animaSamplerIds = addAnimaRefinementPasses(workflow, {
      baseSamplerId: "970008",
      extraSamplerIds: ["970011", "970012"],
      modelLink: ["970002", 0],
      positive: ["970005", 0],
      negative: ["970006", 0],
      seed,
      sampling,
      decodeId: "970009",
    });
  } else {
    animaSamplerIds = addAnimaRefinementPasses(workflow, {
      baseSamplerId: "7",
      extraSamplerIds: ["7101", "7102"],
      modelLink: ["1", 0],
      positive: ["4", 0],
      negative: ["5", 0],
      seed,
      sampling,
      decodeId: "8",
    });
  }
  const animaModelNodeId = usesReferences ? "970002" : "1";
  insertModelLoras(workflow, loras, [animaModelNodeId, 0], animaSamplerIds);
  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "image",
      workflowId: "studio:anima",
      workflowName: `${STUDIO_MODES.anima.name} · ${model.name}`,
      studioMode: "anima",
      studioStage: "drafts",
      studioLabel: `${model.name} · ${sampling.quality.toUpperCase()} · Variante ${index + 1}`,
      prompt: scenePrompt,
      effectivePrompt: prompt,
      negativePrompt: negative,
      seed,
      width,
      height,
      imageModelId: model.id,
      imageModelName: model.name,
      imageModelFamily: "anima",
      imageModelFile: model.file,
      sourceImage: usesReferences ? inputPath(source) : null,
      referenceImages: usesReferences ? references.map(inputPath) : [],
      referenceCount: usesReferences ? references.length + 1 : 0,
      referenceRoles: referencePlan?.roles || [],
      identityPolicy: usesReferences ? "multi-character-distinct-identities" : "text-only",
      imageSettings: {
        steps: model.steps,
        totalSteps: sampling.passes.reduce((total, pass) => total + pass.steps, 0),
        guidance: model.cfg,
        sampler: model.sampler,
        scheduler: model.scheduler,
        textEncoder: ANIMA_TEXT_ENCODER,
        vae: ANIMA_VAE,
        inputMode: usesReferences ? "references" : "text",
        identityComposer: usesReferences ? FLUX2_BASE : null,
        animaDenoise: initialDenoise,
        quality: sampling.quality,
        samplerCount: sampling.passes.length,
        samplingPasses: sampling.passes,
      },
      loras,
    },
  };
}

const DUO_STYLE_PRESETS = Object.freeze({
  cinematic: "high-end cinematic anime illustration, expressive clean linework, detailed cel shading, controlled highlights, rich color design, coherent cinematic lighting",
  romantic: "romantic anime illustration, elegant clean linework, soft cel shading, warm harmonious palette, delicate atmospheric light",
  action: "dynamic action anime key visual, energetic linework, strong readable silhouettes, dramatic perspective, crisp cel shading and cinematic impact",
  manga: "polished manga-inspired illustration, precise ink lines, restrained color accents, graphic shadows and highly readable composition",
  realistic: "semi-realistic anime illustration, recognizable facial structure, refined anatomy, detailed hair and fabric, cinematic natural light",
});

function duoScenePrompt(raw, scenePrompt, references) {
  if (!boolValue(raw.duoHasFemale)) throw new Error("Carica la reference della donna.");
  const expectedReferences = 1 + Number(boolValue(raw.duoHasEnvironment)) + Number(boolValue(raw.duoHasStyle));
  if (references.length !== expectedReferences) {
    throw new Error("Le reference DUO SCENE non corrispondono agli slot selezionati. Ricarica uomo, donna, ambiente e stile.");
  }
  const roles = [{ image: 1, role: "maleIdentity" }, { image: 2, role: "femaleIdentity" }];
  let imageIndex = 3;
  if (boolValue(raw.duoHasEnvironment)) roles.push({ image: imageIndex++, role: "environment" });
  if (boolValue(raw.duoHasStyle)) roles.push({ image: imageIndex++, role: "style" });
  const roleInstructions = roles.map(({ image, role }) => ({
    maleIdentity: `Image ${image} is the identity reference for the male character only. Preserve his recognizable facial structure, hairstyle, hair color and distinctive features.`,
    femaleIdentity: `Image ${image} is the identity reference for the female character only. Preserve her recognizable facial structure, hairstyle, hair color and distinctive features.`,
    environment: `Image ${image} defines the environment, architecture, camera viewpoint, spatial layout and lighting direction only. Do not copy people from it.`,
    style: `Image ${image} defines visual anime language, linework, shading, palette and rendering style only. Do not copy its character identity or composition.`,
  })[role]);
  const style = DUO_STYLE_PRESETS[String(raw.duoStylePreset || "cinematic")] || DUO_STYLE_PRESETS.cinematic;
  return {
    prompt: [
      "Create one unified, single-frame anime scene containing the two separately referenced principal characters.",
      ...roleInstructions,
      `Requested scene: ${scenePrompt}`,
      `Visual treatment: ${style}.`,
      String(raw.duoMalePlacement || "").trim() && `Male character placement/action: ${String(raw.duoMalePlacement).trim()}.`,
      String(raw.duoFemalePlacement || "").trim() && `Female character placement/action: ${String(raw.duoFemalePlacement).trim()}.`,
      "Keep the two identities completely distinct. Never blend, swap or average their faces, hair, bodies, clothes or accessories.",
      "Show exactly one instance of each principal character unless the scene prompt explicitly requests background extras.",
      "Integrate gaze, scale, anatomy, perspective, contact, shadows and occlusions naturally. Produce one scene, never a collage, split screen, character sheet or comparison panel.",
    ].filter(Boolean).join(" "),
    roles,
  };
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
      : "fluxKrea2";
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
    : modelFile.startsWith("ANIMA\\")
      ? "ANIMA\\"
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
  const folder = stageFolder(stage);
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
  return {
    family,
    profile,
    modelFile: family.quality,
    steps: family.steps ?? preset.steps,
    guidance: family.guidance ?? preset.guidance,
  };
}

function guidedModelSelection(raw, preset, loras = []) {
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
  const modelFile = String(raw.qwenEditModel || QWEN_EDIT_2511);
  const bigLove = /biglovegwen2/i.test(modelFile);
  const official2511 = /qwen[_-]?image[_-]?edit[_-]?2511/i.test(modelFile);
  const loraNames = (Array.isArray(loras) ? loras : []).map((item) => String(item?.name || item));
  const lightning4 = loraNames.some((name) => /qwen.+edit.+2511.+lightning.+4steps/i.test(name));
  const lightning8 = loraNames.some((name) => /qwen.+edit.+2511.+lightning.+8steps/i.test(name));
  const nativeSteps = official2511 ? 28 : bigLove ? 6 : 6;
  const nativeGuidance = official2511 ? 4 : 1;
  return {
    family: "qwenEdit",
    name: official2511 ? "Qwen Image Edit 2511" : "BigLove Gwen / Qwen",
    modelFile,
    steps: numberValue(raw.guidedSteps, lightning4 ? 4 : lightning8 ? 8 : nativeSteps, 1, 50, true),
    guidance: numberValue(raw.guidedGuidance, lightning4 || lightning8 ? 1 : nativeGuidance, 0, 20),
    imageRecipe: "runninghub",
    samplingProfile: lightning4 ? "lightning-4" : lightning8 ? "lightning-8" : official2511 ? "native-quality" : "model-native",
  };
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

export function resolveGuidedCompositionPolicy(raw = {}) {
  if (["freeSpace", "recomposeGroup"].includes(raw.compositionPolicy)) {
    return raw.compositionPolicy;
  }
  if (!["addPerson", "addAnimal", "addObject"].includes(raw.editAction)) return "freeSpace";
  const instruction = [raw.spatialInstruction, raw.prompt].filter(Boolean).join(" ").toLowerCase();
  return /\bbetween\b|\bin the middle of\b|\bat the cent(?:er|re) of (?:the )?(?:two|both)\b|\btra (?:i|le|due)\b|\bfra (?:i|le|due)\b|\bin mezzo (?:ai|alle|a due)\b/.test(instruction)
    ? "recomposeGroup"
    : "freeSpace";
}

function guidedNegativePrompt(raw, compositionPolicy) {
  const original = String(raw.negativePrompt || "").trim();
  if (compositionPolicy !== "recomposeGroup") return original;
  const compatible = original.split(",").map((item) => item.trim()).filter((item) =>
    item && !/outside the selected|redraw the whole|change the composition|camera angle|framing/i.test(item)
  );
  compatible.push(
    "identity drift in any of the three people",
    "changed facial features or wardrobe",
    "duplicate people",
    "extra people beyond the one requested",
    "floating torso",
    "cropped body",
    "incorrect scale",
    "flat pasted appearance",
    "broken anatomy",
  );
  return [...new Set(compatible)].join(", ");
}

function guidedEditPrompt(raw, prompt, controls) {
  const action = GUIDED_ACTIONS[raw.editAction] || GUIDED_ACTIONS.modify;
  const placement = parsePlacement(raw);
  const position = String(raw.spatialInstruction || "").trim();
  const interaction = String(raw.subjectInteraction || "").trim();
  const depth = String(raw.depthRelation || "integrated naturally in the scene").trim();
  const contact = String(raw.contactInstruction || "").trim();
  const preservation = String(raw.preserveInstruction || "").trim();
  const subjectName = String(raw.subjectName || "the inserted subject").trim();
  const insertion = ["addPerson", "addAnimal", "addObject"].includes(raw.editAction);
  const compositionPolicy = resolveGuidedCompositionPolicy(raw);
  const recomposeGroup = insertion && compositionPolicy === "recomposeGroup";
  const placementText = placement
    ? `Target box in normalized image coordinates: left ${Math.round(placement.x * 100)}%, top ${Math.round(placement.y * 100)}%, width ${Math.round(placement.width * 100)}%, height ${Math.round(placement.height * 100)}%. Keep the new or modified subject inside this area.`
    : "";
  return [
    action,
    recomposeGroup && "COMPOSITION POLICY: RECOMPOSE THE GROUP TO CREATE REAL PHYSICAL SPACE. Minimally move the existing subjects sideways while preserving their identity, face, wardrobe, pose character, lighting and camera perspective. This explicitly overrides generic instructions to keep every source pixel or the exact original subject positions.",
    prompt,
    controls.prompt,
    insertion && (recomposeGroup
      ? "SOURCE/WHERE: image 1 defines the original people, camera and environment. Preserve their identity and appearance, but recompose their horizontal spacing enough to make a credible place for the new subject."
      : "SOURCE/WHERE: image 1 is the original photograph and defines camera, background, geometry and untouched people. Do not regenerate it globally."),
    insertion && `SUBJECT/WHO: ${subjectName}. Identity and appearance come only from the dedicated subject references; do not blend them with people already in the source.`,
    insertion && `PLACEMENT/WHAT: insert only this subject in the requested region and interaction. The bounding box is placement geometry, not a rectangular edit mask.`,
    placementText,
    position && `Spatial instruction: ${position}.`,
    interaction && `Action and interaction: ${interaction}.`,
    depth && `Depth and occlusion: ${depth}.`,
    contact && `Physical contact and environmental reaction: ${contact}.`,
    preservation && `Must remain unchanged: ${preservation}.`,
    recomposeGroup
      ? "Preserve every unrequested visual attribute, but do not preserve the exact pixels or exact horizontal positions inside the group recomposition area."
      : "Preserve every unrequested element of the source photograph.",
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

export function studioConfig({
  modelPatches = [],
  preprocessors = [],
  imageModels = [],
  textEncoders = [],
  vaes = [],
  loras = [],
  availableNodes = [],
} = {}) {
  const patchAvailable = (name) => modelPatches.some((item) =>
    String(item).toLowerCase() === name.toLowerCase()
  );
  return {
    modes: Object.values(STUDIO_MODES).filter((mode) => !mode.legacy),
    presets: Object.entries(PRESETS).map(([id, item]) => ({ id, name: item.label })),
    limits: { alternatives: [2, 4], references: 4, storyboardShots: [2, 4] },
    kreaTripleModels: KREA_TRIPLE_MODELS.map((model) => ({
      ...model,
      available: imageModels.some((file) => String(file).replaceAll("/", "\\").toLowerCase() === model.file.toLowerCase()),
    })),
    kreaRawMaster: {
      model: KREA_RAW_MODEL,
      clip: KREA_RAW_CLIP,
      vae: KREA_FAMEGRID_VAE,
      fixedLoras: KREA_RAW_FIXED_LORAS,
      modelAvailable: imageModels.some((file) => String(file).replaceAll("/", "\\").toLowerCase() === KREA_RAW_MODEL.toLowerCase()),
      clipAvailable: textEncoders.some((file) => String(file).toLowerCase() === KREA_RAW_CLIP.toLowerCase()),
      vaeAvailable: vaes.some((file) => String(file).toLowerCase() === KREA_FAMEGRID_VAE.toLowerCase()),
      lorasAvailable: KREA_RAW_FIXED_LORAS.every((required) => loras.some((file) => String(file).replaceAll("/", "\\").toLowerCase() === required.name.toLowerCase())),
      samplerAvailable: availableNodes.includes("ClownsharKSampler_Beta"),
      resolutionSelectorAvailable: availableNodes.includes("ResolutionSelector"),
      colorFinishAvailable: availableNodes.includes("FameGridColorFinish"),
    },
    anima: {
      models: ANIMA_MODELS.map((model) => ({
        ...model,
        available: imageModels.some((file) => String(file).replaceAll("/", "\\").toLowerCase() === model.file.toLowerCase()),
      })),
      textEncoder: ANIMA_TEXT_ENCODER,
      vae: ANIMA_VAE,
      textEncoderAvailable: textEncoders.some((file) => String(file).toLowerCase() === ANIMA_TEXT_ENCODER.toLowerCase()),
      vaeAvailable: vaes.some((file) => String(file).toLowerCase() === ANIMA_VAE.toLowerCase()),
    },
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
      krea2Refine: KREA2_REFINE,
      qwenEdit: QWEN_EDIT_2511,
      guidedKlein: STORYBOARD_MODELS.klein.quality,
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
  if (studioMode === "animeToReal") {
    return [buildAnimeToRealJob(raw, source)];
  }
  if (studioMode === "kreaTriple") {
    return [buildKreaTripleJob(raw, { source, mask })];
  }
  if (studioMode === "kreaRawMaster") {
    return [buildKreaRawMasterJob(raw, loras)];
  }
  if (studioMode === "anima") {
    const requested = String(raw.animaModel || ANIMA_MODELS[0].file).replaceAll("/", "\\");
    const model = ANIMA_MODELS.find((item) => item.file.toLowerCase() === requested.toLowerCase());
    if (!model) throw new Error("Checkpoint ANIMA non riconosciuto.");
    const outputs = numberValue(raw.animaOutputs, 1, 1, 4, true);
    const animaLoras = lorasForModel(loras, model.file);
    return Array.from({ length: outputs }, (_, index) => buildAnimaJob(raw, model, index, width, height, {
      source,
      references,
    }, animaLoras));
  }
  const preset = PRESETS[raw.editPreset] || PRESETS.balanced;
  const alternatives = numberValue(raw.alternatives, 2, boolValue(raw.promptBatchItem) ? 1 : 2, 4, true);
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

  if (studioMode === "duoScene") {
    if (!source?.name) throw new Error("Carica la reference dell’uomo.");
    const duo = duoScenePrompt(raw, prompt, references);
    const duoNegative = [
      String(raw.negativePrompt || "").trim(),
      "merged identities, blended faces, face swap, duplicated character, duplicate body, extra principal character, mixed hairstyles, identity leakage, collage, split screen, character sheet, reference sheet, text, watermark, malformed anatomy, extra limbs, extra fingers",
    ].filter(Boolean).join(", ");
    const duoRaw = { ...raw, negativePrompt: duoNegative, sourceDenoise: false };
    return Array.from({ length: alternatives }, (_, index) => buildImageJob({
      studioMode,
      stage: "drafts",
      label: `Scena anime ${index + 1}`,
      raw: duoRaw,
      source,
      references,
      modelFile: modelBase,
      prompt: duo.prompt,
      seed: seedAt(raw, index),
      width,
      height,
      steps: preset.steps,
      guidance: preset.guidance,
      denoise: 1,
      loras,
      extraMetadata: {
        editPreset: preset.label,
        referenceCount: references.length + 1,
        referenceRoles: duo.roles,
        duoStylePreset: String(raw.duoStylePreset || "cinematic"),
        hasEnvironmentReference: boolValue(raw.duoHasEnvironment),
        hasStyleReference: boolValue(raw.duoHasStyle),
        identityPolicy: "two-distinct-identities",
        guidedAction: "select_draft",
      },
    }));
  }

  if (studioMode === "storyboard") {
    const storyboardModel = storyboardModelSelection(raw, preset);
    if (boolValue(raw.promptBatchItem)) {
      return [buildImageJob({
        studioMode,
        stage: "drafts",
        label: "Scena da elenco prompt",
        raw,
        source,
        references,
        modelFile: storyboardModel.modelFile,
        prompt,
        seed: seedAt(raw),
        width,
        height,
        steps: storyboardModel.steps,
        guidance: storyboardModel.guidance,
        loras,
        extraMetadata: {
          storyboardModelFamily: storyboardModel.family.id,
          storyboardModelName: storyboardModel.family.name,
          storyboardModelProfile: storyboardModel.profile,
          promptBatchItem: true,
        },
      })];
    }
    const shots = parseShots(raw);
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

  if (studioMode === "guidedEdit") {
    const guidedModel = guidedModelSelection(raw, preset, loras);
    const globalAction = ["style", "relight", "background"].includes(raw.editAction);
    const masked = !globalAction || Boolean(mask?.name || automaticTarget);
    const placement = parsePlacement(raw);
    const compositionPolicy = resolveGuidedCompositionPolicy(raw);
    if (masked && !mask?.name && !automaticTarget && !placement) {
      throw new Error("Disegna l’area della modifica, traccia il riquadro di posizionamento oppure usa la selezione automatica.");
    }
    const guidedPrompt = guidedEditPrompt(raw, prompt, controls);
    const guidedRaw = {
      ...raw,
      negativePrompt: guidedNegativePrompt(raw, compositionPolicy),
    };
    return Array.from({ length: alternatives }, (_, index) => buildImageJob({
      studioMode,
      stage: "drafts",
      label: `Proposta guidata ${index + 1}`,
      raw: guidedRaw,
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
      protectMask: compositionPolicy === "freeSpace" && Boolean(mask?.name || automaticTarget),
      automaticTarget,
      loras,
      extraMetadata: {
        guidedModelFamily: guidedModel.family,
        guidedModelName: guidedModel.name,
        guidedModelFile: guidedModel.modelFile,
        guidedSamplingProfile: guidedModel.samplingProfile,
        editAction: raw.editAction || "modify",
        editPreset: preset.label,
        editScope: masked ? "local" : "global",
        placement,
        compositionPolicy,
        referencePreparation: raw.identityReferenceFormat === "characterSheet"
          ? "character-sheet-front-and-face"
          : raw.identityReferenceFormat || "single",
        referenceCount: references.length,
        subjectIdentity: {
          subjectId: String(raw.subjectId || "").trim() || null,
          subjectName: String(raw.subjectName || "").trim() || null,
          characterId: String(raw.characterId || "").trim() || null,
          referenceRoles: references.map((_item, referenceIndex) =>
            ["identity", "pose", "appearance"][referenceIndex] || "appearance"
          ),
        },
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
    const continuationReferences = Array.isArray(raw.referenceUploads)
      ? raw.referenceUploads.filter(Boolean).slice(0, 3)
      : [];
    const localized = ["smartphone", "inpaint"].includes(raw.studioMode)
      || (raw.studioMode === "guidedEdit" && (raw.maskUpload?.name || raw.maskTarget))
      || (raw.studioMode === "smartEditor" && raw.editScope === "local")
      || (raw.studioMode === "relight" && (raw.maskUpload?.name || raw.maskTarget));
    return buildImageJob({
      studioMode: raw.studioMode || "guidedEdit",
      stage: action === "variation" ? "variations" : "quality",
      label: action === "variation" ? "Variazione controllata" : "Flux.2 qualità",
      raw,
      source: selectedUpload,
      references: continuationReferences,
      modelFile: action === "variation"
        ? (raw.flux2TurboModel || FLUX2_TURBO)
        : (raw.flux2BaseModel || FLUX2_BASE),
      prompt: [
        prompt,
        action === "variation"
          ? "Create a controlled variation while preserving composition, character identity and color continuity."
          : "Produce the definitive high-quality version while preserving the approved composition.",
      ].filter(Boolean).join(" "),
      seed: seedAt(raw),
      width,
      height,
      steps: action === "variation" ? 8 : 22,
      guidance: action === "variation" ? 1 : 4.5,
      denoise: action === "variation" ? 0.42 : 0.22,
      upscale: false,
      imageRecipe: "standard",
      mask: raw.maskUpload,
      protectMask: localized,
      automaticTarget: String(raw.maskTarget || "").trim(),
      loras,
      extraMetadata: {
        guidedAction: action === "variation" ? "select_draft" : "finalize",
        identityReferenceCount: continuationReferences.length + 1,
      },
    });
  }
  if (action === "finalize") {
    const studioPreset = String(raw.studioPreset || "quality");
    if (studioPreset === "speed" || ["duoScene", "anima"].includes(raw.studioMode)) {
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
                filename_prefix: `Studio/${raw.studioMode || "guidedEdit"}/08_finale`,
              },
              class_type: "SaveImage",
              _meta: { title: "Salva senza upscale" },
            },
          },
          metadata: {
            mediaType: "image",
            generationType: "image",
            workflowId: `studio:${raw.studioMode || "guidedEdit"}`,
            workflowName: `${STUDIO_MODES[raw.studioMode || "guidedEdit"].name} · Master veloce`,
            studioMode: raw.studioMode || "guidedEdit",
            studioStage: "final",
            studioLabel: "Master veloce · stessa risoluzione",
            prompt,
            width,
            height,
            loras: [],
          },
        };
      }
      const engine = ["realesrgan", "animeSharp"].includes(finalOutput)
        ? "model"
        : finalOutput.startsWith("seed")
          ? "seedvr2"
          : "rtx";
      const preset = finalOutput === "seed7" ? "max" : finalOutput === "animeSharp" ? "quality" : "speed";
      const upscaleModel = finalOutput === "animeSharp" ? "4x-AnimeSharp.pth" : "RealESRGAN_x2.pth";
      const result = buildUpscaleWorkflow({
        upscaleEngine: engine,
        upscalePreset: preset,
        upscaleModel,
        upscaleAutoPurge: true,
        upscaleSourceWidth: width,
        upscaleSourceHeight: height,
        seed: raw.seed,
      }, selectedUpload, [upscaleModel]);
      result.workflow["99"].inputs.filename_prefix = `Studio/${raw.studioMode || "guidedEdit"}/08_finale`;
      return {
        ...result,
        metadata: {
          ...result.metadata,
          generationType: "image",
          workflowId: `studio:${raw.studioMode || "guidedEdit"}`,
          workflowName: `${STUDIO_MODES[raw.studioMode || "guidedEdit"].name} · ${["duoScene", "anima"].includes(raw.studioMode) ? "Master anime" : "Master veloce"}`,
          studioMode: raw.studioMode || "guidedEdit",
          studioStage: "final",
          studioLabel: ["duoScene", "anima"].includes(raw.studioMode) ? "Master anime · upscale" : "Master veloce · upscale",
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
      studioMode: raw.studioMode || "guidedEdit",
      stage: "final",
      label: "Master finale",
      raw: {
        ...raw,
        faceDetailer,
        handDetailer,
        preserveStages: true,
        outputBase: `Studio/${raw.studioMode || "guidedEdit"}`,
      },
      source: selectedUpload,
      modelFile: String(raw.krea2RefineModel || KREA2_REFINE),
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
