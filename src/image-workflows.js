import crypto from "node:crypto";
import { insertModelLoras, parseLoras } from "./loras.js";

export const IMAGE_MODELS = {
  flux1: {
    id: "flux1",
    name: "Flux.1",
    family: "flux1",
    modelPrefix: "FLUX1D\\",
    modelExcludes: ["KREA2"],
    defaultModelFile: "FLUX1D\\flux1-dev.safetensors",
    description: "Modelli Flux.1 compatibili, con img2img e Flux Redux reference.",
    modes: ["text", "image", "reference"],
    defaults: { steps: 28, guidance: 3.5 },
  },
  fluxKrea2: {
    id: "fluxKrea2",
    name: "Flux Krea 2",
    family: "krea2",
    modelPrefix: "FLUX1D\\",
    modelIncludes: ["KREA2"],
    defaultModelFile: "FLUX1D\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors",
    description: "Checkpoint Krea 2 con encoder Qwen3-VL, VAE Qwen e sampling nativo Krea2.",
    modes: ["text", "image"],
    defaults: { steps: 8, guidance: 1 },
    dependencies: {
      clip: "qwen3vl_4b_fp8_scaled.safetensors",
      vae: "qwen_image_vae.safetensors",
    },
  },
  flux2: {
    id: "flux2",
    name: "Flux.2",
    family: "flux2",
    modelPrefix: "FLUX2\\",
    defaultModelFile: "FLUX2\\flux2Klein_9bBase.safetensors",
    description: "Modelli Flux.2 compatibili con editing reference nativo.",
    modes: ["text", "image"],
    defaults: { steps: 20, guidance: 5 },
  },
  zImage: {
    id: "zImage",
    name: "Z-Image",
    family: "zimage",
    modelPrefix: "Z-IMG\\",
    defaultModelFile: "Z-IMG\\z_image_turbo_bf16.safetensors",
    description: "Modelli Z-Image compatibili per generazione e img2img.",
    modes: ["text", "image"],
    defaults: { steps: 8, guidance: 1 },
  },
  mageFlow: {
    id: "mageFlow",
    name: "Mage-Flow",
    family: "mageflow",
    modelPrefix: "",
    modelIncludes: ["MAGE_FLOW_BF16"],
    defaultModelFile: "mage_flow_bf16.safetensors",
    description: "Microsoft Mage-Flow 4B RL-aligned BF16 per Text to Image nativo fino a 2048 px.",
    modes: ["text"],
    defaults: { steps: 20, guidance: 5 },
    dependencies: {
      clip: "qwen3vl_4b_bf16.safetensors",
      vae: "mage_flow_vae_bf16.safetensors",
    },
  },
  mageFlowEdit: {
    id: "mageFlowEdit",
    name: "Mage-Flow Edit",
    family: "mageflowedit",
    modelPrefix: "",
    modelIncludes: ["MAGE_FLOW_EDIT_BF16"],
    defaultModelFile: "mage_flow_edit_bf16.safetensors",
    description: "Microsoft Mage-Flow Edit 4B RL-aligned BF16 per modifiche guidate da istruzioni e immagini reference.",
    modes: ["image"],
    defaults: { steps: 30, guidance: 5 },
    dependencies: {
      clip: "qwen3vl_4b_bf16.safetensors",
      vae: "mage_flow_vae_bf16.safetensors",
    },
  },
  qwenImage: {
    id: "qwenImage",
    name: "Qwen Text to Image",
    family: "qwen",
    modelPrefix: "QWEN\\",
    modelIncludes: ["QWEN_IMAGE_2512", "QWENIMAGE2512", "QWEN_RAPID_AIO_NSFW", "QWEN-RAPID-AIO-NSFW", "BIGLOVEGWEN2"],
    defaultModelFile: "QWEN\\qwen_image_2512_fp8_e4m3fn.safetensors",
    description: "Qwen Image 2512 FP8 per Text to Image; BigLove Gwen 2 resta disponibile in compatibilità testo.",
    modes: ["text"],
    defaults: { steps: 50, guidance: 4 },
    dependencies: {
      clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      vae: "qwen_image_vae.safetensors",
    },
  },
  qwenEdit: {
    id: "qwenEdit",
    name: "Qwen Image Edit 2511",
    family: "qwenedit",
    modelPrefix: "QWEN\\",
    modelIncludes: ["QWEN_IMAGE_EDIT_2511", "QWENIMAGEEDIT2511", "QWEN_RAPID_AIO_NSFW", "QWEN-RAPID-AIO-NSFW", "BIGLOVEGWEN2"],
    defaultModelFile: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
    description: "Qwen Image Edit 2511 BF16 come motore primario; BigLove Gwen 2 e Qwen Rapid AIO restano varianti a selezione esplicita.",
    modes: ["image"],
    defaults: { steps: 40, guidance: 4 },
    dependencies: {
      clip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
      vae: "qwen_image_vae.safetensors",
    },
  },
  sdxlReal: {
    id: "sdxlReal",
    name: "SDXL Realistic Photo",
    family: "sdxl",
    loader: "checkpoint",
    modelIncludes: [
      "REALVISXL",
      "REALVIS_XL",
      "JUGGERNAUT",
      "EPICREALISM",
      "CYBERREALISTIC",
      "REALISTIC",
      "PHOTOREAL",
    ],
    defaultModelFile: "RealVisXL_V5.0_fp16.safetensors",
    description: "Checkpoint SDXL fotorealistici per text to image e img2img editing su selfie/foto reali.",
    modes: ["text", "image"],
    defaults: { steps: 28, guidance: 5.5 },
  },
};

export const QWEN_EDIT_2511_LIGHTNING_8_LORA = Object.freeze({
  name: "QWEN\\Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors",
  strength: 1,
});

export function qwenEdit2511Lightning8Preset(modelFile = IMAGE_MODELS.qwenEdit.defaultModelFile) {
  const official2511 = /qwen[_-]?image[_-]?edit[_-]?2511/i.test(String(modelFile || ""));
  return official2511 ? {
    steps: 8,
    guidance: 1,
    loras: [{ ...QWEN_EDIT_2511_LIGHTNING_8_LORA }],
    samplingProfile: "lightning-8",
  } : null;
}

const LEGACY_IMAGE_MODEL_IDS = {
  fluxDev: { familyId: "flux1", defaultModelFile: "FLUX1D\\flux1-dev.safetensors" },
  fluxKrea: { familyId: "fluxKrea2", defaultModelFile: "FLUX1D\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors" },
  fluxKlein9b: { familyId: "flux2", defaultModelFile: "FLUX2\\flux2Klein_9bBase.safetensors" },
};

export const IMAGE_RESOLUTIONS = {
  square: [1024, 1024],
  portrait: [896, 1152],
  landscape: [1152, 896],
  wide: [1344, 768],
  vertical: [768, 1344],
};

export const SEEDVR2_PROFILES = {
  balanced: {
    name: "Leggero · SeedVR2 3B FP8",
    model: "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
    blocksToSwap: 16,
  },
  realistic: {
    name: "Massimo · SeedVR2 7B FP16",
    model: "seedvr2_ema_7b_fp16.safetensors",
    blocksToSwap: 24,
  },
};

function numberOption(value, fallback, { min, max, integer = false, label }) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} non valido.`);
  }
  return parsed;
}

function booleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "on" || value === "1";
}

function inputPath(upload) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function friendlyModelName(filename) {
  const basename = String(filename).split(/[\\/]/).pop()?.replace(/\.(safetensors|gguf|ckpt|pt|pth)$/i, "") || filename;
  const known = {
    "flux1-dev": "Flux.1 Dev",
    "flux1-krea-dev_fp8_scaled": "Flux.1 Krea Dev FP8",
    "darkBeast30BF16INT8_darkBeastKREA2FP8": "DarkBeast Krea2 FP8",
    "moodyKrea2Mix_v50": "Moody Krea2 Mix v5",
    "flux2Klein_9bBase": "Flux.2 Klein 9B Base",
    "z_image_turbo_bf16": "Z-Image Turbo BF16",
    "mage_flow_bf16": "Mage-Flow 4B RL · BF16",
    "mage_flow_edit_bf16": "Mage-Flow Edit 4B RL · BF16",
    "qwen_image_2512_fp8_e4m3fn": "Qwen Image 2512 FP8",
    "qwen_image_edit_2511_bf16": "Qwen Image Edit 2511 BF16",
    "Qwen-Rapid-AIO-NSFW-v23": "Qwen Rapid AIO NSFW v23",
    "BigLoveGwen2_mxfp8": "BigLove Gwen 2 · MXFP8",
    "BigLoveGwen2_nf4": "BigLove Gwen 2 · NF4 leggero",
    "BigLoveKlein4_bf16": "BigLove Klein 4 · BF16",
    "BigLoveKlein4_int8_convrot": "BigLove Klein 4 · INT8 ConvRot",
    "pornmasterFlux2Klein_v4BaseBf16": "PornMaster Flux2 Klein v4 Base · BF16",
    "pornmasterFlux2Klein_v4TurboFp8": "PornMaster Flux2 Klein v4 Turbo · FP8",
    "RealVisXL_V5.0": "RealVisXL V5.0",
    "RealVisXL_V5.0_fp16": "RealVisXL V5.0 fp16",
    "RealVisXL_V5.0_Lightning": "RealVisXL V5.0 Lightning",
    "Juggernaut-XL-v9": "Juggernaut XL v9",
    "Juggernaut-X-v10": "Juggernaut X v10",
    "Juggernaut-XI-v11": "Juggernaut XI v11",
    "Juggernaut-XI-byRunDiffusion": "Juggernaut XI by RunDiffusion",
  };
  return known[basename] || basename.replaceAll("_", " ");
}

function variantDefaults(definition, modelFile) {
  if (definition.family === "flux2" && /pornmaster.*flux2.*klein.*v4.*turbo/i.test(modelFile)) {
    return { steps: 4, guidance: 1 };
  }
  if (definition.family === "flux2" && /pornmaster.*flux2.*klein.*v4.*base.*bf16/i.test(modelFile)) {
    return { steps: 12, guidance: 2 };
  }
  if (definition.family === "qwenedit" && /BIGLOVEGWEN2/i.test(modelFile)) {
    return { steps: 6, guidance: 1 };
  }
  if (/qwen[-_ ]?rapid[-_ ]?aio[-_ ]?nsfw|rapid[-_ ]?aio[-_ ]?nsfw/i.test(modelFile)) {
    return { steps: 8, guidance: 1 };
  }
  if (/lightning[-_ ]?4|4steps/i.test(modelFile)) return { steps: 4, guidance: 1 };
  if (/lightning[-_ ]?8|8steps|turbo|schnell|hyper/i.test(modelFile)) return { steps: 8, guidance: 1 };
  return definition.defaults;
}

function isBigLoveGwen2(modelFile) {
  return /BIGLOVEGWEN2/i.test(String(modelFile || ""));
}

function modelCompatible(definition, modelFile) {
  const value = String(modelFile || "");
  const normalized = value.toLocaleUpperCase();
  const basename = normalized.split(/[\\/]/).pop() || normalized;
  if (definition.modelExcludes?.some((token) => basename.includes(String(token).toLocaleUpperCase()))) {
    return false;
  }
  const familyMatch = definition.modelIncludes?.length
    ? definition.modelIncludes.some((token) => basename.includes(token))
    : true;
  if (!familyMatch) return false;
  if (definition.loader === "checkpoint") return true;
  const hasFolder = /[\\/]/.test(value);
  if (!hasFolder) return Boolean(definition.modelIncludes?.length);
  const prefix = definition.modelPrefix.toLocaleUpperCase();
  if (normalized.startsWith(prefix)) return true;
  const folderName = prefix.replace(/[\\/]+$/, "");
  return normalized.includes(`\\${folderName}\\`) || normalized.includes(`/${folderName}/`);
}

function buildKrea2(definition, options, upload) {
  const workflow = {
    "1": node({ unet_name: definition.modelFile, weight_dtype: "default" }, "UNETLoader", definition.name),
    "2": node({
      clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
      type: "krea2",
      device: "default",
    }, "CLIPLoader", "Text encoder Krea 2"),
    "3": node({ vae_name: "qwen_image_vae.safetensors" }, "VAELoader", "VAE Krea 2"),
    "5": node({ text: options.prompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt Krea 2"),
    "6": node({ conditioning: ["5", 0] }, "ConditioningZeroOut", "Negativo Krea 2"),
    "8": node({
      seed: options.seed,
      steps: options.steps,
      cfg: options.guidance,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: options.mode === "image" ? options.denoise : 1,
      model: ["1", 0],
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["7", 0],
    }, "KSampler", "Sampler Krea 2"),
    "9": node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode Krea 2"),
    "10": node({ images: ["9", 0], filename_prefix: `Remote_${definition.id}` }, "SaveImage", "Salva Krea 2"),
  };
  if (options.mode === "image") {
    workflow["20"] = node({ image: inputPath(upload) }, "LoadImage", "Immagine iniziale Krea 2");
    workflow["21"] = node({
      image: ["20", 0],
      upscale_method: "lanczos",
      width: options.width,
      height: options.height,
      crop: "center",
    }, "ImageScale", "Adatta immagine Krea 2");
    workflow["7"] = node({ pixels: ["21", 0], vae: ["3", 0] }, "VAEEncode", "Latent img2img Krea 2");
  } else {
    workflow["7"] = node({
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "EmptyLatentImage", "Latent vuoto Krea 2");
  }
  return workflow;
}

export function imageModelSelection(modelId, requestedModelFile = "") {
  const legacy = LEGACY_IMAGE_MODEL_IDS[modelId];
  const familyId = legacy?.familyId || modelId;
  const base = IMAGE_MODELS[familyId];
  if (!base) throw new Error("Famiglia immagine non riconosciuta.");
  const modelFile = String(requestedModelFile || legacy?.defaultModelFile || base.defaultModelFile);
  if (!modelCompatible(base, modelFile)) {
    throw new Error(`Il modello selezionato non è compatibile con ${base.name}.`);
  }
  return {
    ...base,
    modelFile,
    name: friendlyModelName(modelFile),
    defaults: variantDefaults(base, modelFile),
  };
}

function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function buildFlux1(definition, options, upload) {
  const workflow = {
    "1": node({ unet_name: definition.modelFile, weight_dtype: "fp8_e4m3fn" }, "UNETLoader", definition.name),
    "2": node({
      clip_name1: "t5xxl_fp8_e4m3fn_scaled.safetensors",
      clip_name2: "clip_l.safetensors",
      type: "flux",
      device: "default",
    }, "DualCLIPLoader", "Text encoders Flux"),
    "3": node({ vae_name: "ae.safetensors" }, "VAELoader", "VAE Flux"),
    "4": node({
      model: ["1", 0],
      max_shift: 1.15,
      base_shift: 0.5,
      width: options.width,
      height: options.height,
    }, "ModelSamplingFlux", "Model sampling Flux"),
    "5": node({ text: options.prompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt"),
    "6": node({ conditioning: ["5", 0], guidance: options.guidance }, "FluxGuidance", "Flux guidance"),
    "8": node({ noise_seed: options.seed }, "RandomNoise", "Seed"),
    "9": node({
      model: ["4", 0],
      scheduler: "simple",
      steps: options.steps,
      denoise: options.mode === "image" ? options.denoise : 1,
    }, "BasicScheduler", "Scheduler"),
    "10": node({ sampler_name: "euler" }, "KSamplerSelect", "Sampler"),
    "13": node({ samples: ["12", 0], vae: ["3", 0] }, "VAEDecode", "Decode"),
    "14": node({ images: ["13", 0], filename_prefix: `Remote_${definition.id}` }, "SaveImage", "Save image"),
  };

  let conditioning = ["6", 0];
  if (options.mode === "image") {
    workflow["20"] = node({ image: inputPath(upload) }, "LoadImage", "Immagine iniziale");
    workflow["21"] = node({
      image: ["20", 0],
      upscale_method: "lanczos",
      width: options.width,
      height: options.height,
      crop: "center",
    }, "ImageScale", "Adatta immagine");
    workflow["7"] = node({ pixels: ["21", 0], vae: ["3", 0] }, "VAEEncode", "Img2Img latent");
  } else {
    workflow["7"] = node({
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "EmptySD3LatentImage", "Latent vuoto");
  }

  if (options.mode === "reference") {
    workflow["20"] = node({ image: inputPath(upload) }, "LoadImage", "Reference image");
    workflow["22"] = node({ style_model_name: "flux1-redux-dev.safetensors" }, "StyleModelLoader", "Flux Redux");
    workflow["23"] = node({ clip_name: "sigclip_vision_patch14_384.safetensors" }, "CLIPVisionLoader", "SigCLIP Vision");
    workflow["24"] = node({
      clip_vision: ["23", 0],
      image: ["20", 0],
      crop: "center",
    }, "CLIPVisionEncode", "Encode reference");
    workflow["25"] = node({
      conditioning: conditioning,
      style_model: ["22", 0],
      clip_vision_output: ["24", 0],
      strength: options.referenceStrength,
      strength_type: "multiply",
    }, "StyleModelApply", "Applica reference");
    conditioning = ["25", 0];
  }

  workflow["11"] = node({ model: ["4", 0], conditioning }, "BasicGuider", "Guider");
  workflow["12"] = node({
    noise: ["8", 0],
    guider: ["11", 0],
    sampler: ["10", 0],
    sigmas: ["9", 0],
    latent_image: ["7", 0],
  }, "SamplerCustomAdvanced", "Genera");
  return workflow;
}

function buildKlein(definition, options, upload, referenceUploads = []) {
  const runningHubRecipe = ["runninghub", "klein4b"].includes(String(options.imageRecipe || "").toLowerCase());
  const runningHubNative4b = runningHubRecipe && /flux-?2[_-]klein[_-]4b/i.test(definition.modelFile);
  const clipName = runningHubNative4b ? "qwen_3_4b.safetensors" : "qwen_3_8b_fp8mixed.safetensors";
  const clipTitle = runningHubNative4b ? "Qwen3 4B · RunningHub Klein" : "Qwen3 8B";
  const loader = /_int8_convrot(?:\.|$)/i.test(definition.modelFile)
    ? node(
      { unet_name: definition.modelFile },
      "RemoteUNETLoaderConvRotINT8",
      definition.name,
    )
    : node(
      { unet_name: definition.modelFile, weight_dtype: "default" },
      "UNETLoader",
      definition.name,
    );
  const workflow = {
    "1": loader,
    "2": node({
      clip_name: clipName,
      type: "flux2",
      device: "default",
    }, "CLIPLoader", clipTitle),
    "3": node({ vae_name: "flux2-vae.safetensors" }, "VAELoader", "VAE Flux.2"),
    "4": node({ text: options.prompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt positivo"),
    "5": node({ text: options.negativePrompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt negativo"),
    "6": node({
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "EmptyFlux2LatentImage", "Latent Flux.2"),
    "10": node({
      steps: options.steps,
      width: options.width,
      height: options.height,
    }, "Flux2Scheduler", "Flux.2 scheduler"),
    "11": node({ sampler_name: "euler" }, "KSamplerSelect", "Sampler"),
    "12": node({ noise_seed: options.seed }, "RandomNoise", "Seed"),
    "14": node({
      noise: ["12", 0],
      guider: ["13", 0],
      sampler: ["11", 0],
      sigmas: ["10", 0],
      latent_image: ["6", 0],
    }, "SamplerCustomAdvanced", "Genera"),
    "15": node({ samples: ["14", 0], vae: ["3", 0] }, "VAEDecode", "Decode"),
    "16": node({ images: ["15", 0], filename_prefix: "Remote_fluxKlein9b" }, "SaveImage", "Save image"),
  };
  let positive = ["4", 0];
  let negative = ["5", 0];
  if (options.mode === "image") {
    const references = [upload, ...referenceUploads].filter((item) => item?.name).slice(0, 4);
    references.forEach((reference, index) => {
      const base = 20 + index * 5;
      const label = index === 0 ? "Immagine principale" : `Reference ${index + 1}`;
      workflow[String(base)] = node({ image: inputPath(reference) }, "LoadImage", label);
      workflow[String(base + 1)] = node({
        image: [String(base), 0],
        upscale_method: "nearest-exact",
        megapixels: index === 0 ? 1.5 : 1,
        resolution_steps: 1,
      }, "ImageScaleToTotalPixels", `Normalizza ${label.toLowerCase()} senza crop`);
      workflow[String(base + 2)] = node({
        pixels: [String(base + 1), 0],
        vae: ["3", 0],
      }, "VAEEncode", `Encode ${label.toLowerCase()}`);
      workflow[String(base + 3)] = node({
        conditioning: positive,
        latent: [String(base + 2), 0],
      }, "ReferenceLatent", `Reference positiva ${index + 1}`);
      workflow[String(base + 4)] = node({
        conditioning: negative,
        latent: [String(base + 2), 0],
      }, "ReferenceLatent", `Reference negativa ${index + 1}`);
      positive = [String(base + 3), 0];
      negative = [String(base + 4), 0];
    });
    if (runningHubRecipe && references[0]?.name) {
      workflow["14"].inputs.latent_image = ["22", 0];
      workflow["6"]._meta.title = "Latent Flux.2 · fallback non usato dalla ricetta RunningHub";
    }
  }
  workflow["13"] = node({
    model: ["1", 0],
    positive,
    negative,
    cfg: options.guidance,
  }, "CFGGuider", "CFG guider");
  return workflow;
}

function applyPuLIDFlux2(workflow, options) {
  const consistency = options.characterConsistency;
  if (!["pulid", "loraPulid"].includes(consistency)) return;
  if (!options.pulidReferenceUpload?.name) {
    throw new Error("Carica una reference volto per usare PuLID Flux.2.");
  }
  const currentModel = workflow["13"]?.inputs?.model;
  if (!currentModel) throw new Error("Punto di applicazione PuLID Flux.2 non trovato nel workflow.");
  workflow["900101"] = node({
    image: inputPath(options.pulidReferenceUpload),
  }, "LoadImage", "Reference identità PuLID");
  workflow["900102"] = node({
    provider: "CUDA",
  }, "PuLIDInsightFaceLoader", "InsightFace AntelopeV2 · CUDA");
  workflow["900103"] = node({}, "PuLIDEVACLIPLoader", "EVA-CLIP PuLID");
  workflow["900104"] = node({
    pulid_file: "pulid_flux2_klein_v2.safetensors",
  }, "PuLIDModelLoader", "PuLID Flux.2 Klein v2");
  workflow["900105"] = node({
    model: currentModel,
    pulid_model: ["900104", 0],
    strength: options.pulidStrength,
    eva_clip: ["900103", 0],
    face_analysis: ["900102", 0],
    image: ["900101", 0],
    face_index: 0,
    debug_mode: false,
  }, "ApplyPuLIDFlux2", "Applica identità PuLID Flux.2");
  workflow["13"].inputs.model = ["900105", 0];
}

function buildZImage(definition, options, upload) {
  const workflow = {
    "1": node({ unet_name: definition.modelFile, weight_dtype: "default" }, "UNETLoader", definition.name),
    "2": node({
      clip_name: "qwen_3_4b.safetensors",
      type: "lumina2",
      device: "default",
    }, "CLIPLoader", "Qwen3 4B"),
    "3": node({ vae_name: "ae.safetensors" }, "VAELoader", "VAE"),
    "4": node({ model: ["1", 0], shift: 3 }, "ModelSamplingAuraFlow", "AuraFlow sampling"),
    "5": node({ text: options.prompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt positivo"),
    "6": node({ text: options.negativePrompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt negativo"),
    "8": node({
      model: ["4", 0],
      seed: options.seed,
      steps: options.steps,
      cfg: options.guidance,
      sampler_name: "euler",
      scheduler: "simple",
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["7", 0],
      denoise: options.mode === "image" ? options.denoise : 1,
    }, "KSampler", "Genera"),
    "9": node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode"),
    "10": node({ images: ["9", 0], filename_prefix: "Remote_zImage" }, "SaveImage", "Save image"),
  };
  if (options.mode === "image") {
    workflow["20"] = node({ image: inputPath(upload) }, "LoadImage", "Immagine iniziale");
    workflow["21"] = node({
      image: ["20", 0],
      upscale_method: "lanczos",
      width: options.width,
      height: options.height,
      crop: "center",
    }, "ImageScale", "Adatta immagine");
    workflow["7"] = node({ pixels: ["21", 0], vae: ["3", 0] }, "VAEEncode", "Img2Img latent");
  } else {
    workflow["7"] = node({
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "EmptySD3LatentImage", "Latent vuoto");
  }
  return workflow;
}

function buildQwenText(definition, options) {
  return {
    "1": qwenDiffusionLoader(definition),
    "2": node({
      clip_name: definition.dependencies.clip,
      type: "qwen_image",
      device: "default",
    }, "CLIPLoader", "Qwen 2.5 VL 7B"),
    "3": node({ vae_name: definition.dependencies.vae }, "VAELoader", "VAE Qwen Image"),
    "4": node({ model: ["1", 0], shift: 3.1 }, "ModelSamplingAuraFlow", "Qwen sampling"),
    "5": node({ text: options.prompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt positivo"),
    "6": node({ text: options.negativePrompt, clip: ["2", 0] }, "CLIPTextEncode", "Prompt negativo"),
    "7": node({
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "EmptySD3LatentImage", "Latent Qwen Image"),
    "8": node({
      model: ["4", 0],
      seed: options.seed,
      steps: options.steps,
      cfg: options.guidance,
      sampler_name: "euler",
      scheduler: "simple",
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["7", 0],
      denoise: 1,
    }, "KSampler", "Genera"),
    "9": node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode"),
    "10": node({ images: ["9", 0], filename_prefix: "Remote_qwenImage2512" }, "SaveImage", "Save image"),
  };
}

function buildMageFlow(definition, options) {
  return {
    "1": node({ unet_name: definition.modelFile, weight_dtype: "default" }, "UNETLoader", definition.name),
    "2": node({
      clip_name: definition.dependencies.clip,
      type: "mage",
      device: "default",
    }, "CLIPLoader", "Qwen3-VL 4B BF16 · Mage-Flow"),
    "3": node({ vae_name: definition.dependencies.vae }, "VAELoader", "Mage VAE BF16"),
    "5": node({
      clip: ["2", 0],
      prompt: options.prompt,
      negative_prompt: options.negativePrompt || " ",
      images: {},
      vae: ["3", 0],
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "TextEncodeMageFlowEdit", "Prompt e latent Mage-Flow"),
    "8": node({
      model: ["1", 0],
      seed: options.seed,
      steps: options.steps,
      cfg: options.guidance,
      sampler_name: "euler",
      scheduler: "simple",
      positive: ["5", 0],
      negative: ["5", 1],
      latent_image: ["5", 2],
      denoise: 1,
    }, "KSampler", "Genera Mage-Flow"),
    "9": node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode Mage VAE"),
    "10": node({ images: ["9", 0], filename_prefix: "Remote_mageFlow" }, "SaveImage", "Salva Mage-Flow"),
  };
}

function buildMageFlowEdit(definition, options, upload, referenceUploads = []) {
  const workflow = {
    "1": node({ unet_name: definition.modelFile, weight_dtype: "default" }, "UNETLoader", definition.name),
    "2": node({
      clip_name: definition.dependencies.clip,
      type: "mage",
      device: "default",
    }, "CLIPLoader", "Qwen3-VL 4B BF16 · Mage-Flow Edit"),
    "3": node({ vae_name: definition.dependencies.vae }, "VAELoader", "Mage VAE BF16"),
    "20": node({ image: inputPath(upload) }, "LoadImage", "Immagine da modificare"),
  };
  const references = [upload, ...referenceUploads].filter((item) => item?.name).slice(0, 3);
  const images = { image_1: ["20", 0] };
  references.slice(1).forEach((reference, index) => {
    const id = String(21 + index);
    workflow[id] = node({ image: inputPath(reference) }, "LoadImage", `Reference Mage ${index + 2}`);
    images[`image_${index + 2}`] = [id, 0];
  });
  workflow["5"] = node({
    clip: ["2", 0],
    prompt: options.prompt,
    negative_prompt: options.negativePrompt || " ",
    images,
    vae: ["3", 0],
    width: options.width,
    height: options.height,
    batch_size: 1,
  }, "TextEncodeMageFlowEdit", "Istruzione, reference e latent Mage-Flow Edit");
  workflow["8"] = node({
    model: ["1", 0],
    seed: options.seed,
    steps: options.steps,
    cfg: options.guidance,
    sampler_name: "euler",
    scheduler: "simple",
    positive: ["5", 0],
    negative: ["5", 1],
    latent_image: ["5", 2],
    denoise: 1,
  }, "KSampler", "Modifica con Mage-Flow");
  workflow["9"] = node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode Mage VAE");
  workflow["10"] = node({ images: ["9", 0], filename_prefix: "Remote_mageFlowEdit" }, "SaveImage", "Salva Mage-Flow Edit");
  return workflow;
}

function qwenDiffusionLoader(definition) {
  if (/_nf4(?:\.|$)/i.test(definition.modelFile)) {
    return node(
      { unet_name: definition.modelFile },
      "RemoteUNETLoaderNF4",
      `${definition.name} · NF4`,
    );
  }
  return node(
    { unet_name: definition.modelFile, weight_dtype: "default" },
    "UNETLoader",
    definition.name,
  );
}

function qwenEditReferences(workflow, upload, referenceUploads, firstImage) {
  const references = [upload, ...referenceUploads].filter((item) => item?.name).slice(0, 3);
  const imageInputs = { image1: firstImage };
  references.slice(1).forEach((reference, index) => {
    const id = String(22 + index);
    workflow[id] = node({ image: inputPath(reference) }, "LoadImage", `Reference ${index + 2}`);
    imageInputs[`image${index + 2}`] = [id, 0];
  });
  return imageInputs;
}

function buildStandardQwenEdit(definition, options, upload, referenceUploads = []) {
  const workflow = {
    "1": qwenDiffusionLoader(definition),
    "2": node({
      clip_name: definition.dependencies.clip,
      type: "qwen_image",
      device: "default",
    }, "CLIPLoader", "Qwen 2.5 VL 7B"),
    "3": node({ vae_name: definition.dependencies.vae }, "VAELoader", "VAE Qwen Image"),
    "4": node({ model: ["1", 0], shift: 3.1 }, "ModelSamplingAuraFlow", "Qwen sampling"),
    "12": node({ model: ["4", 0], strength: 1, pre_cfg: false }, "CFGNorm", "CFG Norm"),
    "20": node({ image: inputPath(upload) }, "LoadImage", "Immagine da modificare"),
    "21": node({
      image: ["20", 0],
      upscale_method: "lanczos",
      megapixels: 1.5,
      resolution_steps: 1,
    }, "ImageScaleToTotalPixels", "Normalizza a 1,5 MP"),
  };
  const imageInputs = qwenEditReferences(workflow, upload, referenceUploads, ["21", 0]);
  workflow["5"] = node({
    clip: ["2", 0],
    prompt: options.prompt,
    vae: ["3", 0],
    ...imageInputs,
  }, "TextEncodeQwenImageEditPlus", "Istruzione positiva Qwen Edit");
  workflow["6"] = node({
    clip: ["2", 0],
    prompt: options.negativePrompt,
    vae: ["3", 0],
    ...imageInputs,
  }, "TextEncodeQwenImageEditPlus", "Istruzione negativa Qwen Edit");
  workflow["13"] = node({
    conditioning: ["5", 0],
    reference_latents_method: "index_timestep_zero",
  }, "FluxKontextMultiReferenceLatentMethod", "Metodo reference positivo");
  workflow["14"] = node({
    conditioning: ["6", 0],
    reference_latents_method: "index_timestep_zero",
  }, "FluxKontextMultiReferenceLatentMethod", "Metodo reference negativo");
  workflow["7"] = node({ pixels: ["21", 0], vae: ["3", 0] }, "VAEEncode", "Latent immagine iniziale");
  workflow["8"] = node({
    model: ["12", 0],
    seed: options.seed,
    steps: options.steps,
    cfg: options.guidance,
    sampler_name: "euler",
    scheduler: "simple",
    positive: ["13", 0],
    negative: ["14", 0],
    latent_image: ["7", 0],
    denoise: 1,
  }, "KSampler", "Modifica immagine");
  workflow["9"] = node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode");
  workflow["10"] = node({ images: ["9", 0], filename_prefix: "Remote_qwenEdit2511" }, "SaveImage", "Save image");
  return workflow;
}

function buildBigLoveQwenEdit(definition, options, upload, referenceUploads = []) {
  const workflow = {
    "1": qwenDiffusionLoader(definition),
    "2": node({
      clip_name: definition.dependencies.clip,
      type: "qwen_image",
      device: "default",
    }, "CLIPLoader", "Qwen 2.5 VL 7B · BigLove recipe"),
    "3": node({ vae_name: definition.dependencies.vae }, "VAELoader", "VAE Qwen Image"),
    "4": node({ model: ["1", 0], shift: 3.1 }, "ModelSamplingAuraFlow", "BigLove · Qwen sampling"),
    "12": node({ model: ["4", 0], strength: 1, pre_cfg: false }, "CFGNorm", "BigLove · CFG Norm"),
    "20": node({ image: inputPath(upload) }, "LoadImage", "Immagine da modificare"),
    "21": node({
      image: ["20", 0],
      upscale_method: "lanczos",
      megapixels: 1.5,
      resolution_steps: 1,
    }, "ImageScaleToTotalPixels", "BigLove · normalizza a 1,5 MP"),
  };
  const imageInputs = qwenEditReferences(workflow, upload, referenceUploads, ["21", 0]);
  workflow["5"] = node({
    clip: ["2", 0],
    prompt: options.prompt,
    vae: ["3", 0],
    ...imageInputs,
  }, "TextEncodeQwenImageEditPlus", "Istruzione positiva BigLove");
  workflow["6"] = node({
    clip: ["2", 0],
    prompt: options.negativePrompt,
    vae: ["3", 0],
    ...imageInputs,
  }, "TextEncodeQwenImageEditPlus", "Istruzione negativa BigLove");
  workflow["13"] = node({
    conditioning: ["5", 0],
    reference_latents_method: "index_timestep_zero",
  }, "FluxKontextMultiReferenceLatentMethod", "BigLove · metodo reference positivo");
  workflow["14"] = node({
    conditioning: ["6", 0],
    reference_latents_method: "index_timestep_zero",
  }, "FluxKontextMultiReferenceLatentMethod", "BigLove · metodo reference negativo");
  workflow["7"] = node({ pixels: ["21", 0], vae: ["3", 0] }, "VAEEncode", "Latent BigLove");
  workflow["8"] = node({
    model: ["12", 0],
    seed: options.seed,
    steps: options.steps,
    cfg: options.guidance,
    sampler_name: "euler",
    scheduler: "simple",
    positive: ["13", 0],
    negative: ["14", 0],
    latent_image: ["7", 0],
    denoise: 1,
  }, "KSampler", "BigLove · Qwen recipe edit");
  workflow["9"] = node({ samples: ["8", 0], vae: ["3", 0] }, "VAEDecode", "Decode");
  workflow["10"] = node({
    images: ["9", 0],
    filename_prefix: "Remote_bigLoveQwenEdit",
  }, "SaveImage", "Salva BigLove");
  return workflow;
}

function buildQwenEdit(definition, options, upload, referenceUploads = []) {
  return isBigLoveGwen2(definition.modelFile)
    ? buildBigLoveQwenEdit(definition, options, upload, referenceUploads)
    : buildStandardQwenEdit(definition, options, upload, referenceUploads);
}

function buildSdxlRealistic(definition, options, upload) {
  const negative = options.negativePrompt || [
    "cgi",
    "3d render",
    "anime",
    "cartoon",
    "painting",
    "plastic skin",
    "airbrushed",
    "over-smoothed skin",
    "deformed anatomy",
    "bad hands",
    "extra fingers",
    "distorted face",
    "low quality",
    "watermark",
  ].join(", ");
  const workflow = {
    "1": node({ ckpt_name: definition.modelFile }, "CheckpointLoaderSimple", definition.name),
    "5": node({ text: options.prompt, clip: ["1", 1] }, "CLIPTextEncode", "Prompt realistico"),
    "6": node({ text: negative, clip: ["1", 1] }, "CLIPTextEncode", "Negative realistico"),
    "8": node({
      model: ["1", 0],
      seed: options.seed,
      steps: options.steps,
      cfg: options.guidance,
      sampler_name: "dpmpp_2m_sde",
      scheduler: "karras",
      positive: ["5", 0],
      negative: ["6", 0],
      latent_image: ["7", 0],
      denoise: options.mode === "image" ? options.denoise : 1,
    }, "KSampler", "SDXL realistic sampler"),
    "9": node({ samples: ["8", 0], vae: ["1", 2] }, "VAEDecode", "Decode SDXL"),
    "10": node({
      images: ["9", 0],
      filename_prefix: `Remote_${definition.id}`,
    }, "SaveImage", "Salva SDXL realistic"),
  };

  if (options.mode === "image") {
    workflow["20"] = node({ image: inputPath(upload) }, "LoadImage", "Foto da modificare");
    workflow["21"] = node({
      image: ["20", 0],
      upscale_method: "lanczos",
      width: options.width,
      height: options.height,
      crop: "center",
    }, "ImageScale", "Adatta foto a SDXL");
    workflow["7"] = node({ pixels: ["21", 0], vae: ["1", 2] }, "VAEEncode", "Latent img2img SDXL");
  } else {
    workflow["7"] = node({
      width: options.width,
      height: options.height,
      batch_size: options.batchSize,
    }, "EmptyLatentImage", "Latent vuoto SDXL");
  }

  return workflow;
}

function applyPortableDetectionDetailers(workflow, definition, options) {
  const source = definition.family === "flux2" ? ["15", 0] : ["9", 0];
  const saveId = definition.family === "flux2" ? "16" : "10";

  // Qwen, Klein and Z-Image do not expose a detailer-compatible MODEL/CLIP
  // pipeline. Refine only the detected crops with the same photographic
  // Flux.1 pipeline used by standalone Upscaling, then return the crops to the
  // original full-resolution image. The primary generator remains unchanged.
  workflow["905000"] = node({
    unet_name: "FLUX1D\\cyberrealisticFlux_v25.safetensors",
    weight_dtype: "fp8_e4m3fn",
  }, "UNETLoader", "Face Detailer universale · Flux.1 realistico");
  workflow["905001"] = node({
    clip_name1: "t5xxl_fp8_e4m3fn_scaled.safetensors",
    clip_name2: "clip_l.safetensors",
    type: "flux",
    device: "default",
  }, "DualCLIPLoader", "Face Detailer universale · text encoders");
  workflow["905002"] = node({ vae_name: "ae.safetensors" }, "VAELoader", "Face Detailer universale · VAE");
  workflow["905003"] = node({
    model: ["905000", 0],
    max_shift: 1.15,
    base_shift: 0.5,
    width: options.width,
    height: options.height,
  }, "ModelSamplingFlux", "Face Detailer universale · sampling");
  workflow["905004"] = node({
    text: "natural photographic local refinement, preserve exact identity, realistic skin texture, accurate eyes, mouth and nose",
    clip: ["905001", 0],
  }, "CLIPTextEncode", "Face Detailer universale · prompt");
  workflow["905005"] = node({
    conditioning: ["905004", 0],
    guidance: 3.5,
  }, "FluxGuidance", "Face Detailer universale · guidance");
  workflow["905006"] = node({
    conditioning: ["905005", 0],
  }, "ConditioningZeroOut", "Face Detailer universale · negativo");
  workflow["905007"] = node({
    model_name: "sam_vit_b_01ec64.pth",
    device_mode: "AUTO",
    sam_detection_hint: "center-1",
    sam_dilation: 0,
    sam_threshold: 0.93,
    sam_bbox_expansion: 8,
    sam_mask_hint_threshold: 0.7,
    sam_mask_hint_use_negative: "False",
  }, "easy samLoaderPipe", "Face Detailer universale · SAM");

  const passes = [
    {
      enabled: options.faceDetailer,
      offset: 10,
      title: "Volto",
      detector: "bbox/face_yolov8n.pt",
      threshold: 0.45,
      dilation: 12,
      cropFactor: 2.5,
      guideSize: 512,
      denoise: options.faceDetailerDenoise,
      wildcard: "natural facial detail, realistic skin texture, preserve exact identity, accurate eyes, mouth and nose",
    },
    {
      enabled: options.handDetailer,
      offset: 20,
      title: "Mani",
      detector: "bbox/hand_yolov8s.pt",
      threshold: 0.35,
      dilation: 18,
      cropFactor: 2.8,
      guideSize: 512,
      denoise: options.handDetailerDenoise,
      wildcard: "anatomically correct natural hands, realistic fingers, preserve pose, jewelry and contact",
    },
  ];
  let image = source;
  for (const pass of passes) {
    if (!pass.enabled) continue;
    const pipeId = String(905000 + pass.offset);
    const detectorId = String(905001 + pass.offset);
    const prepareId = String(905002 + pass.offset);
    const fixId = String(905003 + pass.offset);
    workflow[pipeId] = node({
      model: ["905003", 0],
      pos: ["905005", 0],
      neg: ["905006", 0],
      vae: ["905002", 0],
      clip: ["905001", 0],
      image,
    }, "easy pipeIn", `Face Detailer universale ${pass.title} · pipeline`);
    workflow[detectorId] = node({
      model_name: pass.detector,
      bbox_threshold: pass.threshold,
      bbox_dilation: pass.dilation,
      bbox_crop_factor: pass.cropFactor,
    }, "easy ultralyticsDetectorPipe", `Face Detailer universale ${pass.title} · detector`);
    workflow[prepareId] = node({
      pipe: [pipeId, 0],
      guide_size: pass.guideSize,
      guide_size_for: true,
      max_size: 1024,
      seed: options.seed + pass.offset,
      steps: 10,
      cfg: 3.5,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: pass.denoise,
      feather: 8,
      noise_mask: true,
      force_inpaint: true,
      drop_size: pass.title === "Mani" ? 24 : 16,
      wildcard: pass.wildcard,
      cycle: 1,
      bbox_segm_pipe: [detectorId, 0],
      sam_pipe: ["905007", 0],
      optional_image: image,
    }, "easy preDetailerFix", `Face Detailer universale ${pass.title} · prepara`);
    workflow[fixId] = node({
      pipe: [prepareId, 0],
      image_output: "Hide",
      link_id: 0,
      save_prefix: `Image_face_detailer_${pass.title.toLowerCase()}`,
    }, "easy detailerFix", `Face Detailer universale ${pass.title} · applica`);
    image = [fixId, 1];
  }
  if (options.preserveStages) {
    workflow["905099"] = node({
      images: image,
      filename_prefix: `${options.outputBase}/06_face_hands`,
    }, "SaveImage", "Salva fase volto e mani");
  }
  // Keep the untouched base SaveImage when requested; applyImagePostProcessing
  // will save this refined image as the enhanced/final output.
  if (!workflow[saveId]) throw new Error(`Output base ${saveId} non disponibile per Face Detailer.`);
  return image;
}

function applyDetectionDetailers(workflow, definition, options) {
  if (!options.faceDetailer && !options.handDetailer) return null;
  if (definition.family !== "flux1") {
    return applyPortableDetectionDetailers(workflow, definition, options);
  }

  workflow["905000"] = node(
    { conditioning: ["6", 0] },
    "ConditioningZeroOut",
    "Detailer · condizionamento negativo",
  );
  let image = ["13", 0];
  const passes = [
    {
      enabled: options.faceDetailer,
      offset: 10,
      title: "Volto",
      detector: "bbox/face_yolov8n.pt",
      threshold: 0.45,
      dilation: 12,
      cropFactor: 2.5,
      guideSize: 512,
      denoise: options.faceDetailerDenoise,
      wildcard: "natural facial detail, realistic skin texture, accurate eyes, preserve identity",
    },
    {
      enabled: options.handDetailer,
      offset: 20,
      title: "Mani",
      detector: "bbox/hand_yolov8s.pt",
      threshold: 0.35,
      dilation: 18,
      cropFactor: 2.8,
      guideSize: 512,
      denoise: options.handDetailerDenoise,
      wildcard: "anatomically correct natural hands, realistic fingers, preserve pose and jewelry",
    },
  ];
  for (const pass of passes) {
    if (!pass.enabled) continue;
    const pipeId = String(905000 + pass.offset);
    const detectorId = String(905001 + pass.offset);
    const prepareId = String(905002 + pass.offset);
    const fixId = String(905003 + pass.offset);
    workflow[pipeId] = node({
      model: ["4", 0],
      pos: ["6", 0],
      neg: ["905000", 0],
      vae: ["3", 0],
      clip: ["2", 0],
      image,
    }, "easy pipeIn", `Detailer ${pass.title} · pipeline`);
    workflow[detectorId] = node({
      model_name: pass.detector,
      bbox_threshold: pass.threshold,
      bbox_dilation: pass.dilation,
      bbox_crop_factor: pass.cropFactor,
    }, "easy ultralyticsDetectorPipe", `Detailer ${pass.title} · detector`);
    workflow[prepareId] = node({
      pipe: [pipeId, 0],
      guide_size: pass.guideSize,
      guide_size_for: true,
      max_size: 1024,
      seed: options.seed + pass.offset,
      steps: 12,
      cfg: options.guidance,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: pass.denoise,
      feather: 8,
      noise_mask: true,
      force_inpaint: true,
      drop_size: pass.title === "Mani" ? 24 : 16,
      wildcard: pass.wildcard,
      cycle: 1,
      bbox_segm_pipe: [detectorId, 0],
      optional_image: image,
    }, "easy preDetailerFix", `Detailer ${pass.title} · prepara`);
    workflow[fixId] = node({
      pipe: [prepareId, 0],
      image_output: "Hide",
      link_id: 0,
      save_prefix: `Studio_detailer_${pass.title.toLowerCase()}`,
    }, "easy detailerFix", `Detailer ${pass.title} · applica`);
    image = [fixId, 1];
  }
  if (options.preserveStages) {
    workflow["905099"] = node({
      images: image,
      filename_prefix: `${options.outputBase}/06_face_hands`,
    }, "SaveImage", "Salva fase volto e mani");
  } else {
    workflow["14"].inputs.images = image;
  }
  return image;
}

function applyHighresFix(workflow, definition, options, preparedImage = null) {
  const family = definition.family;
  const base = family === "flux1"
    ? { image: ["13", 0], save: "14", model: ["4", 0], vae: ["3", 0], guider: ["11", 0], sampler: ["10", 0] }
    : family === "krea2"
      ? { image: ["9", 0], save: "10", model: ["1", 0], vae: ["3", 0], positive: ["5", 0], negative: ["6", 0] }
    : family === "flux2"
      ? { image: ["15", 0], save: "16", model: ["1", 0], vae: ["3", 0], guider: ["13", 0], sampler: ["11", 0] }
      : family === "qwenedit"
        ? {
            image: ["9", 0],
            save: "10",
            model: workflow["8"].inputs.model,
            vae: ["3", 0],
            positive: workflow["8"].inputs.positive,
            negative: workflow["8"].inputs.negative,
          }
        : ["mageflow", "mageflowedit"].includes(family)
          ? { image: ["9", 0], save: "10", model: ["1", 0], vae: ["3", 0], positive: ["5", 0], negative: ["5", 1] }
        : family === "sdxl"
          ? { image: ["9", 0], save: "10", model: ["1", 0], vae: ["1", 2], positive: ["5", 0], negative: ["6", 0] }
        : { image: ["9", 0], save: "10", model: ["4", 0], vae: ["3", 0], positive: ["5", 0], negative: ["6", 0] };
  if (preparedImage) base.image = preparedImage;
  if (!options.highresEnabled) {
    return { image: base.image, originalSaveId: base.save, enhanced: Boolean(preparedImage) };
  }

  workflow["910001"] = node({
    image: base.image,
    upscale_method: "lanczos",
    scale_by: options.highresScale,
  }, "ImageScaleBy", "Highres Fix · ingrandimento");
  workflow["910002"] = node({ pixels: ["910001", 0], vae: base.vae }, "VAEEncode", "Highres Fix · encode");

  if (family === "flux1") {
    workflow["910003"] = node({ noise_seed: options.seed + 1 }, "RandomNoise", "Highres Fix · seed");
    workflow["910004"] = node({
      model: base.model,
      scheduler: "simple",
      steps: options.highresSteps,
      denoise: options.highresDenoise,
    }, "BasicScheduler", "Highres Fix · scheduler");
    workflow["910005"] = node({
      noise: ["910003", 0],
      guider: base.guider,
      sampler: base.sampler,
      sigmas: ["910004", 0],
      latent_image: ["910002", 0],
    }, "SamplerCustomAdvanced", "Highres Fix · refine");
  } else if (family === "flux2") {
    const scheduleSteps = Math.min(60, Math.ceil(options.highresSteps / options.highresDenoise));
    workflow["910003"] = node({ noise_seed: options.seed + 1 }, "RandomNoise", "Highres Fix · seed");
    workflow["910004"] = node({
      steps: scheduleSteps,
      width: Math.round(options.width * options.highresScale),
      height: Math.round(options.height * options.highresScale),
    }, "Flux2Scheduler", "Highres Fix · Flux.2 scheduler");
    workflow["910005"] = node({
      sigmas: ["910004", 0],
      step: Math.max(0, scheduleSteps - options.highresSteps),
    }, "SplitSigmas", "Highres Fix · denoise");
    workflow["910006"] = node({
      noise: ["910003", 0],
      guider: base.guider,
      sampler: base.sampler,
      sigmas: ["910005", 1],
      latent_image: ["910002", 0],
    }, "SamplerCustomAdvanced", "Highres Fix · refine");
  } else {
    workflow["910005"] = node({
      model: base.model,
      seed: options.seed + 1,
      steps: options.highresSteps,
      cfg: options.guidance,
      sampler_name: "euler",
      scheduler: "simple",
      positive: base.positive,
      negative: base.negative,
      latent_image: ["910002", 0],
      denoise: options.highresDenoise,
    }, "KSampler", "Highres Fix · refine");
  }

  const samples = family === "flux2" ? ["910006", 0] : ["910005", 0];
  workflow["910007"] = node({ samples, vae: base.vae }, "VAEDecode", "Highres Fix · decode");
  if (options.preserveStages) {
    workflow["910008"] = node({
      images: ["910007", 0],
      filename_prefix: `${options.outputBase}/07_highres`,
    }, "SaveImage", "Salva fase Highres");
  }
  return { image: ["910007", 0], originalSaveId: base.save, enhanced: true };
}

function applyImagePostProcessing(workflow, definition, options) {
  const detailedImage = applyDetectionDetailers(workflow, definition, options);
  const highres = applyHighresFix(workflow, definition, options, detailedImage);
  let image = highres.image;
  let enhanced = highres.enhanced;

  if (options.upscaleMode !== "none") {
    if (options.autoPurge) {
      workflow["920001"] = node({
        empty_cache: true,
        gc_collect: true,
        unload_all_models: true,
        image_pass: image,
      }, "VRAM_Debug", "Libera VRAM prima dell'upscale");
      image = ["920001", 1];
    }

    if (options.upscaleMode === "fast") {
      workflow["920002"] = node({
        model_name: "RealESRGAN_x2.pth",
      }, "UpscaleModelLoader", "RealESRGAN 2×");
      workflow["920003"] = node({
        upscale_model: ["920002", 0],
        images: image,
        per_batch: 1,
        downscale_ratio: 1,
        downscale_method: "lanczos",
        precision: "float16",
      }, "ImageUpscaleWithModelBatched", "Upscale rapido 2×");
      image = ["920003", 0];
    } else if (options.upscaleMode === "rtx") {
      workflow["920002"] = node({
        images: image,
        denoise: true,
        denoise_quality: options.rtxQuality,
        deblur: true,
        deblur_quality: options.rtxQuality,
        upscale: "VSR",
        upscale_quality: options.rtxQuality,
        resize_type: "Scale",
        scale: 2,
        megapixels: 2,
        width: 1920,
        height: 1080,
        divisible_by: "8",
        ratio_preset: "16:9",
        resize_method: "Letterbox (Fit)",
        device_id: 0,
      }, "DaSiWa_RTX_UpscalerRefiner", "RTX VSR · upscale e pulizia");
      image = ["920002", 0];
    } else {
      const profile = SEEDVR2_PROFILES[options.seedvrProfile];
      workflow["920002"] = node({
        model: profile.model,
        device: "cuda:0",
        blocks_to_swap: profile.blocksToSwap,
        swap_io_components: true,
        offload_device: "cpu",
        cache_model: false,
        attention_mode: "sdpa",
      }, "SeedVR2LoadDiTModel", profile.name);
      workflow["920003"] = node({
        model: "ema_vae_fp16.safetensors",
        device: "cuda:0",
        encode_tiled: true,
        encode_tile_size: 1024,
        encode_tile_overlap: 128,
        decode_tiled: true,
        decode_tile_size: 1024,
        decode_tile_overlap: 128,
        tile_debug: "false",
        offload_device: "cpu",
        cache_model: false,
      }, "SeedVR2LoadVAEModel", "SeedVR2 VAE tiled");
      workflow["920004"] = node({
        image,
        dit: ["920002", 0],
        vae: ["920003", 0],
        seed: options.seed,
        resolution: options.seedvrResolution,
        max_resolution: 4096,
        batch_size: 1,
        uniform_batch_size: false,
        color_correction: "lab",
        temporal_overlap: 0,
        prepend_frames: 0,
        input_noise_scale: 0,
        latent_noise_scale: 0,
        offload_device: "cpu",
        enable_debug: false,
      }, "SeedVR2VideoUpscaler", "SeedVR2 upscale finale");
      workflow["920005"] = node({
        image: ["920004", 0],
      }, "RemoteImageTensorNormalize", "Normalizza output SeedVR2");
      image = ["920005", 0];
    }
    enhanced = true;
  }

  if (enhanced) {
    if (!options.saveOriginal) delete workflow[highres.originalSaveId];
    workflow["939999"] = node({
      image,
    }, "RemoteImageTensorNormalize", "Normalizza output finale");
    image = ["939999", 0];
    workflow["940001"] = node({
      images: image,
      filename_prefix: options.preserveStages
        ? `${options.outputBase}/08_finale`
        : `Remote_${definition.id}_enhanced`,
    }, "SaveImage", "Salva risultato migliorato");
  }
}

export function buildImageWorkflow(modelId, rawOptions, upload, rawLoras = undefined) {
  const definition = imageModelSelection(modelId, rawOptions.imageModelFile);
  const mode = String(rawOptions.imageMode || "text");
  if (!definition.modes.includes(mode)) throw new Error("Modalità non supportata dal modello selezionato.");
  if (mode !== "text" && !upload?.name) throw new Error("Carica un'immagine iniziale o di riferimento.");
  const prompt = String(rawOptions.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci il prompt.");
  const resolution = String(rawOptions.imageResolution || "portrait");
  let dimensions = IMAGE_RESOLUTIONS[resolution];
  if (resolution === "custom") {
    dimensions = [
      numberOption(rawOptions.imageWidth, 1024, {
        min: 256, max: 4096, integer: true, label: "Larghezza immagine",
      }),
      numberOption(rawOptions.imageHeight, 1024, {
        min: 256, max: 4096, integer: true, label: "Altezza immagine",
      }),
    ].map((value) => Math.max(256, Math.round(value / 16) * 16));
  }
  if (!dimensions) throw new Error("Formato immagine non valido.");
  const [width, height] = dimensions;
  const parsedSeed = Number(rawOptions.seed);
  const seed = Number.isSafeInteger(parsedSeed) && parsedSeed >= 0
    ? parsedSeed
    : crypto.randomInt(0, 2 ** 31);
  const options = {
    mode,
    prompt,
    negativePrompt: String(rawOptions.negativePrompt || "").trim(),
    resolution,
    width,
    height,
    seed,
    batchSize: numberOption(rawOptions.batchSize, 1, {
      min: 1, max: 4, integer: true, label: "Numero immagini",
    }),
    steps: numberOption(rawOptions.imageSteps, definition.defaults.steps, {
      min: 1, max: 50, integer: true, label: "Numero di step",
    }),
    guidance: numberOption(rawOptions.imageGuidance, definition.defaults.guidance, {
      min: 0, max: 20, label: "Guidance",
    }),
    denoise: numberOption(rawOptions.denoise, 0.6, {
      min: 0.05, max: 1, label: "Denoise",
    }),
    referenceStrength: numberOption(rawOptions.referenceStrength, 1, {
      min: 0, max: 2, label: "Intensità reference",
    }),
    highresEnabled: booleanOption(rawOptions.highresEnabled),
    highresScale: numberOption(rawOptions.highresScale, 1.5, {
      min: 1.25, max: 2, label: "Fattore Highres Fix",
    }),
    highresSteps: numberOption(rawOptions.highresSteps, 10, {
      min: 4, max: 30, integer: true, label: "Step Highres Fix",
    }),
    highresDenoise: numberOption(rawOptions.highresDenoise, 0.25, {
      min: 0.1, max: 0.5, label: "Denoise Highres Fix",
    }),
    upscaleMode: ["none", "fast", "seedvr2", "rtx"].includes(rawOptions.upscaleMode)
      ? rawOptions.upscaleMode
      : "none",
    rtxQuality: ["Low", "Medium", "High", "Ultra"].includes(rawOptions.rtxQuality)
      ? rawOptions.rtxQuality
      : "High",
    seedvrProfile: SEEDVR2_PROFILES[rawOptions.seedvrProfile] ? rawOptions.seedvrProfile : "balanced",
    seedvrResolution: numberOption(rawOptions.seedvrResolution, 2048, {
      min: 1536, max: 3072, integer: true, label: "Risoluzione SeedVR2",
    }),
    autoPurge: booleanOption(rawOptions.autoPurge),
    saveOriginal: booleanOption(rawOptions.saveOriginal),
    // Restore Face (mtb) currently returns malformed 3px-wide tensors in this
    // ComfyUI instance. Keep the UI option disabled and ignore stale form data;
    // use the dedicated face/detailer passes instead.
    faceEnhance: false,
    faceModel: String(rawOptions.faceModel || ""),
    faceStrength: numberOption(rawOptions.faceStrength, 0.5, {
      min: 0.1, max: 1, label: "Intensità miglioramento volti",
    }),
    faceDetailer: booleanOption(rawOptions.faceDetailer),
    handDetailer: booleanOption(rawOptions.handDetailer),
    faceDetailerDenoise: numberOption(rawOptions.faceDetailerDenoise, 0.22, {
      min: 0.05, max: 0.5, label: "Denoise detailer volto",
    }),
    handDetailerDenoise: numberOption(rawOptions.handDetailerDenoise, 0.28, {
      min: 0.05, max: 0.6, label: "Denoise detailer mani",
    }),
    imageRecipe: String(rawOptions.imageRecipe || "standard"),
    preserveStages: booleanOption(rawOptions.preserveStages),
    outputBase: String(rawOptions.outputBase || "Studio/image"),
    characterConsistency: ["off", "lora", "pulid", "loraPulid"].includes(rawOptions.characterConsistency)
      ? rawOptions.characterConsistency
      : "off",
    pulidStrength: numberOption(rawOptions.pulidStrength, 1.4, {
      min: 0, max: 2, label: "Forza PuLID",
    }),
    pulidReferenceUpload: rawOptions.pulidReferenceUpload || null,
  };
  if (options.batchSize > 1 && (
    options.highresEnabled
    || options.upscaleMode === "seedvr2"
    || options.faceDetailer
    || options.handDetailer
  )) {
    throw new Error("Highres Fix, SeedVR2 e i Detailer richiedono Numero immagini = 1 per evitare errori di memoria.");
  }
  if (definition.family === "qwenedit" && options.batchSize > 1) {
    throw new Error("Qwen Image Edit 2511 richiede Numero immagini = 1.");
  }
  if (["mageflow", "mageflowedit"].includes(definition.family) && options.batchSize > 1) {
    throw new Error("Mage-Flow BF16 richiede Numero immagini = 1 su questa configurazione.");
  }
  if (options.faceEnhance && !options.faceModel) {
    throw new Error("Nessun modello di miglioramento volti disponibile.");
  }
  if (["pulid", "loraPulid"].includes(options.characterConsistency) && definition.family !== "flux2") {
    throw new Error("PuLID è compatibile solo con Flux.2 Klein nella configurazione attuale.");
  }
  const workflow = definition.family === "flux1"
    ? buildFlux1(definition, options, upload)
    : definition.family === "krea2"
      ? buildKrea2(definition, options, upload)
    : definition.family === "flux2"
      ? buildKlein(definition, options, upload, rawOptions.referenceUploads)
      : definition.family === "qwen"
        ? buildQwenText(definition, options)
        : definition.family === "mageflow"
          ? buildMageFlow(definition, options)
        : definition.family === "mageflowedit"
          ? buildMageFlowEdit(definition, options, upload, rawOptions.referenceUploads)
        : definition.family === "qwenedit"
          ? buildQwenEdit(definition, options, upload, rawOptions.referenceUploads)
          : definition.family === "sdxl"
            ? buildSdxlRealistic(definition, options, upload)
            : buildZImage(definition, options, upload);
  if (options.preserveStages && definition.family === "flux1") {
    workflow["14"].inputs.filename_prefix = `${options.outputBase}/05_refine_flux1`;
  }
  const loras = parseLoras(rawLoras ?? rawOptions.loras);
  if (definition.family === "qwenedit" && isBigLoveGwen2(definition.modelFile)) {
    insertModelLoras(workflow, loras, ["1", 0], ["8"]);
  } else if (definition.family === "sdxl") {
    insertModelLoras(workflow, loras, ["1", 0], ["8"]);
  } else if (["mageflow", "mageflowedit", "krea2"].includes(definition.family)) {
    insertModelLoras(workflow, loras, ["1", 0], ["8"]);
  } else if (definition.family === "flux1" || definition.family === "qwen" || definition.family === "qwenedit") {
    insertModelLoras(workflow, loras, ["1", 0], ["4"]);
  } else if (definition.family === "flux2") {
    insertModelLoras(workflow, loras, ["1", 0], ["13"]);
  } else {
    insertModelLoras(workflow, loras, ["1", 0], ["4"]);
  }
  if (definition.family === "flux2") applyPuLIDFlux2(workflow, options);
  applyImagePostProcessing(workflow, definition, options);
  let finalWidth = width * (options.highresEnabled ? options.highresScale : 1);
  let finalHeight = height * (options.highresEnabled ? options.highresScale : 1);
  if (options.upscaleMode === "fast" || options.upscaleMode === "rtx") {
    finalWidth *= 2;
    finalHeight *= 2;
  } else if (options.upscaleMode === "seedvr2") {
    const ratio = options.seedvrResolution / Math.min(finalWidth, finalHeight);
    finalWidth *= ratio;
    finalHeight *= ratio;
    const maxEdge = Math.max(finalWidth, finalHeight);
    if (maxEdge > 4096) {
      const limitRatio = 4096 / maxEdge;
      finalWidth *= limitRatio;
      finalHeight *= limitRatio;
    }
  }
  finalWidth = Math.round(finalWidth);
  finalHeight = Math.round(finalHeight);
  const enhanced = options.highresEnabled || options.upscaleMode !== "none" || options.faceEnhance
    || options.faceDetailer || options.handDetailer;
  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "image",
      workflowId: `image:${modelId}:${mode}`,
      workflowName: definition.family === "qwenedit" && isBigLoveGwen2(definition.modelFile)
        ? `${definition.name} · BigLove Image Editing`
        : `${definition.name} · ${mode === "text" ? "Text to Image" : mode === "reference" ? "Reference" : "Image to Image"}`,
      imageModelId: modelId,
      imageModelFamily: definition.id,
      imageModelFile: definition.modelFile,
      imageModelName: definition.name,
      imageMode: mode,
      prompt,
      negativePrompt: options.negativePrompt,
      resolution,
      orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
      width,
      height,
      duration: null,
      fps: null,
      quality: null,
      seed,
      batchSize: options.batchSize,
      sourceImage: upload ? inputPath(upload) : null,
      referenceImages: Array.isArray(rawOptions.referenceUploads)
        ? rawOptions.referenceUploads.map(inputPath)
        : [],
      pulidReferenceImage: options.pulidReferenceUpload
        ? inputPath(options.pulidReferenceUpload)
        : null,
      imageSettings: {
        steps: options.steps,
        guidance: options.guidance,
        denoise: ["qwenedit", "mageflowedit"].includes(definition.family) ? 1 : mode === "image" ? options.denoise : null,
        referenceStrength: mode === "reference" ? options.referenceStrength : null,
        highresEnabled: options.highresEnabled,
        highresScale: options.highresEnabled ? options.highresScale : null,
        highresSteps: options.highresEnabled ? options.highresSteps : null,
        highresDenoise: options.highresEnabled ? options.highresDenoise : null,
        upscaleMode: options.upscaleMode,
        rtxQuality: options.upscaleMode === "rtx" ? options.rtxQuality : null,
        seedvrProfile: options.upscaleMode === "seedvr2" ? options.seedvrProfile : null,
        seedvrResolution: options.upscaleMode === "seedvr2" ? options.seedvrResolution : null,
        faceEnhance: options.faceEnhance,
        faceStrength: options.faceEnhance ? options.faceStrength : null,
        faceDetailer: options.faceDetailer,
        handDetailer: options.handDetailer,
        faceDetailerDenoise: options.faceDetailer ? options.faceDetailerDenoise : null,
        handDetailerDenoise: options.handDetailer ? options.handDetailerDenoise : null,
        imageRecipe: options.imageRecipe,
        autoPurge: options.autoPurge,
        saveOriginal: options.saveOriginal,
        enhanced,
        finalWidth: enhanced ? finalWidth : width,
        finalHeight: enhanced ? finalHeight : height,
      },
      seriesId: String(rawOptions.seriesId || "").trim() || null,
      seriesType: ["influencer", "samePlace"].includes(rawOptions.seriesType)
        ? rawOptions.seriesType
        : null,
      seriesIndex: rawOptions.seriesIndex === undefined
        ? null
        : numberOption(rawOptions.seriesIndex, 0, { min: 0, max: 8, integer: true, label: "Indice serie" }),
      seriesCount: rawOptions.seriesCount === undefined
        ? null
        : numberOption(rawOptions.seriesCount, 1, { min: 1, max: 9, integer: true, label: "Numero elementi serie" }),
      seriesLabel: String(rawOptions.seriesLabel || "").trim() || null,
      seriesVariation: String(rawOptions.seriesVariation || "").trim() || null,
      seriesSeedMode: ["random", "fixed", "anchor"].includes(rawOptions.seriesSeedMode)
        ? rawOptions.seriesSeedMode
        : null,
      seriesRevision: numberOption(rawOptions.seriesRevision, 0, { min: 0, max: 999, integer: true, label: "Revisione serie" }),
      seriesParentGenerationId: String(rawOptions.seriesParentGenerationId || "").trim() || null,
      anchorGenerationId: String(rawOptions.anchorGenerationId || "").trim() || null,
      anchorImageIndex: rawOptions.anchorImageIndex === undefined || rawOptions.anchorImageIndex === ""
        ? null
        : numberOption(rawOptions.anchorImageIndex, 0, { min: 0, max: 99, integer: true, label: "Indice anchor" }),
      anchorContext: rawOptions.anchorContext && typeof rawOptions.anchorContext === "object"
        ? rawOptions.anchorContext
        : (() => {
            try { return JSON.parse(String(rawOptions.anchorContext || "null")); } catch { return null; }
          })(),
      sceneLock: ["high", "medium", "low"].includes(rawOptions.sceneLock)
        ? rawOptions.sceneLock
        : null,
      characterLora: String(rawOptions.characterLora || "").trim() || null,
      characterTrigger: String(rawOptions.characterTrigger || "").trim() || null,
      characterLoraStrength: rawOptions.characterLoraStrength === undefined || rawOptions.characterLoraStrength === ""
        ? null
        : numberOption(rawOptions.characterLoraStrength, 1, { min: -10, max: 10, label: "Forza Character LoRA" }),
      characterConsistency: ["off", "lora", "pulid", "loraPulid"].includes(rawOptions.characterConsistency)
        ? rawOptions.characterConsistency
        : null,
      pulidStrength: ["pulid", "loraPulid"].includes(options.characterConsistency)
        ? options.pulidStrength
        : null,
      loras,
    },
  };
}

export function imageModelConfig(installedModelNames = [], installedComponents = {}) {
  const installedClips = installedComponents.clips || [];
  const installedVaes = installedComponents.vaes || [];
  const installedCheckpoints = installedComponents.checkpoints || [];
  return Object.values(IMAGE_MODELS).map((definition) => {
    const sourceModels = definition.loader === "checkpoint" ? installedCheckpoints : installedModelNames;
    const models = sourceModels
      .filter((name) => modelCompatible(definition, name))
      .map((file) => ({
        file,
        name: friendlyModelName(file),
        defaults: variantDefaults(definition, file),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "it"));
    const configuredDefaultAvailable = models.some((model) =>
      model.file.toLowerCase() === definition.defaultModelFile.toLowerCase()
    );
    // Le varianti Qwen Edit (Gwen/AIO) non devono diventare automaticamente il
    // motore primario quando il checkpoint ufficiale 2511 non è installato.
    const defaultModelFile = configuredDefaultAvailable || definition.id === "qwenEdit"
      ? definition.defaultModelFile
      : models[0]?.file || definition.defaultModelFile;
    const missingRequirements = [];
    if (definition.dependencies?.clip && !installedClips.some((name) =>
      String(name).toLowerCase() === definition.dependencies.clip.toLowerCase()
    )) missingRequirements.push(`CLIP: ${definition.dependencies.clip}`);
    if (definition.dependencies?.vae && !installedVaes.some((name) =>
      String(name).toLowerCase() === definition.dependencies.vae.toLowerCase()
    )) missingRequirements.push(`VAE: ${definition.dependencies.vae}`);
    return {
      ...definition,
      modelFile: defaultModelFile,
      defaultModelFile,
      models,
      missingRequirements,
      available: models.length > 0 && missingRequirements.length === 0,
      primaryAvailable: configuredDefaultAvailable && missingRequirements.length === 0,
    };
  });
}
