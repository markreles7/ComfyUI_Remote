import crypto from "node:crypto";
import { SEEDVR2_PROFILES } from "./image-workflows.js";

const NSFW_DETAILER_DETECTORS = [
  "bbox/female-breast-v4.7.pt",
  "bbox/nipples_v2_yolov11s-seg.pt",
  "bbox/pussy_yolo11s_seg_best.pt",
  "bbox/assdetailer-seg.pt",
  "bbox/penisV2.pt",
  "bbox/CockAndBallYolo8x.pt",
];

export const UPSCALE_ENGINES = {
  lanczos: {
    id: "lanczos",
    name: "Lanczos / Bicubic",
    description: "Ridimensionamento classico, rapido e senza modelli AI.",
  },
  model: {
    id: "model",
    name: "AI Upscale Model",
    description: "ESRGAN, RealESRGAN, UltraSharp, Remacri e tutti i modelli locali installati.",
  },
  seedvr2: {
    id: "seedvr2",
    name: "SeedVR2",
    description: "Upscaling generativo ad alta qualità con ricostruzione dei dettagli.",
  },
  rtx: {
    id: "rtx",
    name: "NVIDIA RTX VSR",
    description: "Upscaling, denoise e deblur accelerati dalla GPU NVIDIA RTX.",
  },
};

export const UPSCALE_PRESETS = {
  speed: { id: "speed", name: "Velocità" },
  quality: { id: "quality", name: "Qualità" },
  max: { id: "max", name: "Qualità MAX" },
};

function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function inputPath(upload) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function booleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "on" || value === "1";
}

function seedOption(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : crypto.randomInt(0, 2 ** 31);
}

function numberOption(value, fallback, { min, max } = {}) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max ?? parsed, Math.max(min ?? parsed, parsed));
}

function modelScale(modelName) {
  const match = String(modelName).match(/(?:^|[^0-9])([248])x|x([248])(?:[^0-9]|$)/i);
  return match ? Number(match[1] || match[2]) : null;
}

function applyPreUpscaleDetailers(workflow, image, options) {
  const face = booleanOption(options.upscaleFaceDetailer);
  const eyes = booleanOption(options.upscaleEyeDetailer);
  const hands = booleanOption(options.upscaleHandDetailer);
  const skin = booleanOption(options.upscaleSkinDetailer);
  const nsfw = booleanOption(options.upscaleNsfwDetailer);
  if (!face && !eyes && !hands && !skin && !nsfw) return { image, enabled: false, passes: [] };

  const width = Number(options.upscaleSourceWidth) || 1024;
  const height = Number(options.upscaleSourceHeight) || 1024;
  workflow["300"] = node({
    unet_name: "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors",
    weight_dtype: "default",
  }, "UNETLoader", "Pre-upscale detailer · Krea2");
  workflow["301"] = node({
    clip_name: "qwen3vl_4b_fp8_scaled.safetensors",
    type: "krea2",
    device: "default",
  }, "CLIPLoader", "Pre-upscale detailer · text encoder Krea2");
  workflow["302"] = node({ vae_name: "qwen_image_vae.safetensors" }, "VAELoader", "Pre-upscale detailer · VAE Krea2");
  workflow["304"] = node({
    text: "realistic photographic local refinement, preserve exact identity, preserve composition, natural skin texture, clean edges",
    clip: ["301", 0],
  }, "CLIPTextEncode", "Pre-upscale detailer · prompt");
  workflow["306"] = node({ conditioning: ["304", 0] }, "ConditioningZeroOut", "Pre-upscale detailer · negativo");
  workflow["307"] = node({
    model_name: "sam_vit_b_01ec64.pth",
    device_mode: "AUTO",
    sam_detection_hint: "center-1",
    sam_dilation: 0,
    sam_threshold: 0.93,
    sam_bbox_expansion: 8,
    sam_mask_hint_threshold: 0.7,
    sam_mask_hint_use_negative: "False",
  }, "easy samLoaderPipe", "Pre-upscale detailer · SAM condiviso");

  const passes = [
    {
      enabled: face,
      offset: 10,
      id: "face",
      title: "Volto",
      detector: "bbox/face_yolov8n.pt",
      threshold: 0.45,
      dilation: 12,
      cropFactor: 2.5,
      guideSize: 512,
      denoise: numberOption(options.upscaleFaceDenoise, 0.18, { min: 0.05, max: 0.45 }),
      wildcard: "natural facial detail, realistic skin texture, preserve exact identity, accurate mouth and nose",
    },
    {
      enabled: eyes,
      offset: 20,
      id: "eyes",
      title: "Occhi",
      detector: "bbox/face_yolov8n.pt",
      threshold: 0.42,
      dilation: 6,
      cropFactor: 3.2,
      guideSize: 384,
      denoise: numberOption(options.upscaleEyeDenoise, 0.14, { min: 0.04, max: 0.35 }),
      wildcard: "sharp natural eyes, realistic iris detail, correct gaze direction, clean eyelids, preserve identity",
    },
    {
      enabled: hands,
      offset: 30,
      id: "hands",
      title: "Mani",
      detector: "bbox/hand_yolov8s.pt",
      threshold: 0.35,
      dilation: 18,
      cropFactor: 2.8,
      guideSize: 512,
      denoise: numberOption(options.upscaleHandDenoise, 0.24, { min: 0.05, max: 0.55 }),
      wildcard: "anatomically correct natural hands, realistic fingers, preserve pose, preserve jewelry and contact",
    },
    {
      enabled: skin,
      offset: 40,
      id: "skin",
      title: "Pelle/fisico",
      detector: "bbox/person_yolov8n-seg.pt",
      threshold: 0.35,
      dilation: 4,
      cropFactor: 1.25,
      guideSize: 768,
      denoise: numberOption(options.upscaleSkinDenoise, 0.12, { min: 0.04, max: 0.28 }),
      wildcard: "natural realistic skin texture, remove AI cracked skin texture, reduce scratchy over-sharpened artifacts, preserve exact body shape, preserve anatomy, preserve pose, preserve identity, subtle skin pores, smooth natural tonal transitions, no plastic skin",
    },
    {
      enabled: nsfw,
      offset: 50,
      id: "nsfw_breast",
      title: "NSFW seno",
      detector: "bbox/female-breast-v4.7.pt",
      threshold: 0.35,
      dilation: 10,
      cropFactor: 2.0,
      guideSize: 640,
      denoise: numberOption(options.upscaleNsfwDenoise, 0.12, { min: 0.04, max: 0.30 }),
      wildcard: "natural adult anatomy, realistic breast skin texture, preserve exact pose and body shape, correct volume and lighting, reduce AI texture artifacts, no plastic skin",
    },
    {
      enabled: nsfw,
      offset: 60,
      id: "nsfw_nipples",
      title: "NSFW capezzoli",
      detector: "bbox/nipples_v2_yolov11s-seg.pt",
      threshold: 0.32,
      dilation: 8,
      cropFactor: 2.6,
      guideSize: 512,
      denoise: numberOption(options.upscaleNsfwDenoise, 0.12, { min: 0.04, max: 0.30 }),
      wildcard: "natural adult nipple detail, realistic skin transitions, preserve size position and lighting, correct texture without over-sharpening",
    },
    {
      enabled: nsfw,
      offset: 70,
      id: "nsfw_vagina",
      title: "NSFW vagina",
      detector: "bbox/pussy_yolo11s_seg_best.pt",
      threshold: 0.30,
      dilation: 10,
      cropFactor: 2.3,
      guideSize: 512,
      denoise: numberOption(options.upscaleNsfwDenoise, 0.12, { min: 0.04, max: 0.30 }),
      wildcard: "natural adult vulva anatomy, realistic skin texture, preserve exact pose and camera angle, clean edges, reduce AI artifacts, no exaggerated anatomy",
    },
    {
      enabled: nsfw,
      offset: 80,
      id: "nsfw_anus",
      title: "NSFW ano",
      detector: "bbox/assdetailer-seg.pt",
      threshold: 0.32,
      dilation: 10,
      cropFactor: 2.3,
      guideSize: 512,
      denoise: numberOption(options.upscaleNsfwDenoise, 0.12, { min: 0.04, max: 0.30 }),
      wildcard: "natural adult posterior anatomy, realistic skin texture, preserve exact pose and body shape, clean realistic detail, reduce AI artifacts",
    },
    {
      enabled: nsfw,
      offset: 90,
      id: "nsfw_penis",
      title: "NSFW pene",
      detector: "bbox/penisV2.pt",
      threshold: 0.32,
      dilation: 10,
      cropFactor: 2.4,
      guideSize: 512,
      denoise: numberOption(options.upscaleNsfwDenoise, 0.12, { min: 0.04, max: 0.30 }),
      wildcard: "natural adult male genital anatomy, realistic skin texture, preserve exact pose and lighting, clean edges, reduce AI artifacts, no exaggerated anatomy",
    },
    {
      enabled: nsfw,
      offset: 100,
      id: "nsfw_male_genitals",
      title: "NSFW genitali maschili",
      detector: "bbox/CockAndBallYolo8x.pt",
      threshold: 0.32,
      dilation: 10,
      cropFactor: 2.4,
      guideSize: 512,
      denoise: numberOption(options.upscaleNsfwDenoise, 0.12, { min: 0.04, max: 0.30 }),
      wildcard: "natural adult male genital anatomy, realistic skin texture and proportions, preserve exact pose and lighting, reduce AI artifacts",
    },
  ];
  const applied = [];
  let current = image;
  for (const pass of passes) {
    if (!pass.enabled) continue;
    const pipeId = String(300 + pass.offset);
    const detectorId = String(301 + pass.offset);
    const prepareId = String(302 + pass.offset);
    const fixId = String(303 + pass.offset);
    workflow[pipeId] = node({
      model: ["300", 0],
      pos: ["304", 0],
      neg: ["306", 0],
      vae: ["302", 0],
      clip: ["301", 0],
      image: current,
    }, "easy pipeIn", `Pre-upscale detailer ${pass.title} · pipeline`);
    workflow[detectorId] = node({
      model_name: pass.detector,
      bbox_threshold: pass.threshold,
      bbox_dilation: pass.dilation,
      bbox_crop_factor: pass.cropFactor,
    }, "easy ultralyticsDetectorPipe", `Pre-upscale detailer ${pass.title} · detector`);
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
      drop_size: pass.id === "hands" ? 24 : 16,
      wildcard: pass.wildcard,
      cycle: 1,
      bbox_segm_pipe: [detectorId, 0],
      sam_pipe: ["307", 0],
      optional_image: current,
    }, "easy preDetailerFix", `Pre-upscale detailer ${pass.title} · prepara`);
    workflow[fixId] = node({
      pipe: [prepareId, 0],
      image_output: "Hide",
      link_id: 0,
      save_prefix: `Upscale_pre_detailer_${pass.id}`,
    }, "easy detailerFix", `Pre-upscale detailer ${pass.title} · applica`);
    current = [fixId, 1];
    applied.push({ id: pass.id, name: pass.title, denoise: pass.denoise });
  }
  return { image: current, enabled: applied.length > 0, passes: applied };
}

export function buildUpscaleWorkflow(rawOptions, upload, availableModels = []) {
  if (!upload?.name) throw new Error("Carica una foto da ingrandire.");
  const engine = String(rawOptions.upscaleEngine || "model");
  if (!UPSCALE_ENGINES[engine]) throw new Error("Motore di upscaling non valido.");
  const preset = String(rawOptions.upscalePreset || "quality");
  if (!UPSCALE_PRESETS[preset]) throw new Error("Preset di upscaling non valido.");
  const selectedModel = String(rawOptions.upscaleModel || "");
  if (engine === "model" && !availableModels.some((name) => name.toLowerCase() === selectedModel.toLowerCase())) {
    throw new Error("Modello di upscaling non installato.");
  }
  const autoPurge = booleanOption(rawOptions.upscaleAutoPurge, true);
  const seed = seedOption(rawOptions.seed);
  const sourceWidth = Number(rawOptions.upscaleSourceWidth);
  const sourceHeight = Number(rawOptions.upscaleSourceHeight);
  const sourceMaxEdge = Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight)
    && sourceWidth > 0 && sourceHeight > 0
    ? Math.max(sourceWidth, sourceHeight)
    : null;
  const safeScale = (requested) => sourceMaxEdge
    ? Math.max(1, Math.floor(Math.min(requested, 8192 / sourceMaxEdge) * 100) / 100)
    : requested;
  const workflow = {
    "1": node({ image: inputPath(upload) }, "LoadImage", "Foto da ingrandire"),
  };
  let image = ["1", 0];
  const detailerResult = applyPreUpscaleDetailers(workflow, image, { ...rawOptions, seed });
  image = detailerResult.image;

  if (engine !== "lanczos" && autoPurge) {
    workflow["2"] = node({
      empty_cache: true,
      gc_collect: true,
      unload_all_models: true,
      image_pass: image,
    }, "VRAM_Debug", "Libera VRAM prima dell'upscale");
    image = ["2", 1];
  }

  if (engine === "lanczos") {
    const settings = {
      speed: { method: "bicubic", scale: 2 },
      quality: { method: "lanczos", scale: 2 },
      max: { method: "lanczos", scale: 4 },
    }[preset];
    settings.scale = safeScale(settings.scale);
    workflow["10"] = node({
      image,
      upscale_method: settings.method,
      scale_by: settings.scale,
    }, "ImageScaleBy", `${settings.method} ${settings.scale}×`);
    image = ["10", 0];
  } else if (engine === "model") {
    const settings = {
      speed: { tile: 512, precision: "fp16", channelsLast: true },
      quality: { tile: 384, precision: "fp16", channelsLast: false },
      max: { tile: 256, precision: "fp32", channelsLast: false },
    }[preset];
    workflow["10"] = node({ model_name: selectedModel }, "UpscaleModelLoader", selectedModel);
    workflow["11"] = node({
      upscale_model: ["10", 0],
      image,
      max_batch_size: 1,
      tile_size: settings.tile,
      channels_last: settings.channelsLast,
      precision: settings.precision,
    }, "UpscaleWithModelAdvanced", `AI upscale · ${UPSCALE_PRESETS[preset].name}`);
    image = ["11", 0];
  } else if (engine === "seedvr2") {
    const settings = {
      speed: { profile: "fast", resolution: 1280, blocks: 24 },
      quality: { profile: "balanced", resolution: 1536, blocks: 16 },
      max: { profile: "maximum", resolution: 1792, blocks: 32 },
    }[preset];
    const profile = SEEDVR2_PROFILES[settings.profile];
    workflow["10"] = node({
      model: profile.model,
      device: "cuda:0",
      blocks_to_swap: settings.blocks,
      swap_io_components: true,
      offload_device: "cpu",
      cache_model: false,
      attention_mode: "sdpa",
    }, "SeedVR2LoadDiTModel", profile.name);
    workflow["11"] = node({
      model: "ema_vae_fp16.safetensors",
      device: "cuda:0",
      encode_tiled: true,
      encode_tile_size: preset === "max" ? 768 : 1024,
      encode_tile_overlap: 128,
      decode_tiled: true,
      decode_tile_size: preset === "max" ? 768 : 1024,
      decode_tile_overlap: 128,
      tile_debug: "false",
      offload_device: "cpu",
      cache_model: false,
    }, "SeedVR2LoadVAEModel", "SeedVR2 VAE tiled");
    workflow["12"] = node({
      image,
      dit: ["10", 0],
      vae: ["11", 0],
      seed,
      resolution: settings.resolution,
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
    }, "SeedVR2VideoUpscaler", `SeedVR2 · ${UPSCALE_PRESETS[preset].name}`);
    workflow["13"] = node({
      image: ["12", 0],
    }, "RemoteImageTensorNormalize", "Normalizza output SeedVR2");
    image = ["13", 0];
  } else {
    const settings = {
      speed: {
        denoise: false, denoiseQuality: "Low", deblur: false, deblurQuality: "Low",
        upscale: "VSR", upscaleQuality: "Medium", scale: 2,
      },
      quality: {
        denoise: true, denoiseQuality: "High", deblur: false, deblurQuality: "Medium",
        upscale: "VSR", upscaleQuality: "High", scale: 2,
      },
      max: {
        denoise: true, denoiseQuality: "Ultra", deblur: true, deblurQuality: "Ultra",
        upscale: "High Bitrate", upscaleQuality: "Ultra", scale: 4,
      },
    }[preset];
    settings.scale = safeScale(settings.scale);
    workflow["10"] = node({
      images: image,
      denoise: settings.denoise,
      denoise_quality: settings.denoiseQuality,
      deblur: settings.deblur,
      deblur_quality: settings.deblurQuality,
      upscale: settings.upscale,
      upscale_quality: settings.upscaleQuality,
      resize_type: "Scale",
      scale: settings.scale,
      megapixels: 2,
      width: 1920,
      height: 1080,
      divisible_by: "8",
      ratio_preset: "16:9",
      resize_method: "Letterbox (Fit)",
      device_id: 0,
    }, "DaSiWa_RTX_UpscalerRefiner", `RTX VSR · ${UPSCALE_PRESETS[preset].name}`);
    image = ["10", 0];
  }

  workflow["98"] = node({
    image,
  }, "RemoteImageTensorNormalize", "Normalizza output finale");
  image = ["98", 0];

  workflow["99"] = node({
    images: image,
    filename_prefix: `Remote_upscale_${engine}_${preset}`,
  }, "SaveImage", "Salva immagine ingrandita");

  const presetScale = engine === "lanczos"
    ? safeScale(preset === "max" ? 4 : 2)
    : engine === "rtx"
      ? safeScale(preset === "max" ? 4 : 2)
      : engine === "model"
        ? modelScale(selectedModel)
        : null;
  const seedvrResolution = engine === "seedvr2"
    ? ({ speed: 1536, quality: 2048, max: 2656 }[preset])
    : null;
  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "upscale",
      workflowId: `upscale:${engine}:${preset}`,
      workflowName: `Upscaling · ${UPSCALE_ENGINES[engine].name} · ${UPSCALE_PRESETS[preset].name}`,
      prompt: "",
      negativePrompt: "",
      resolution: presetScale ? `${presetScale}×` : `Lato corto ${seedvrResolution}px`,
      width: null,
      height: null,
      duration: null,
      fps: null,
      quality: preset,
      seed,
      batchSize: 1,
      sourceImage: inputPath(upload),
      upscaleSettings: {
        engine,
        engineName: UPSCALE_ENGINES[engine].name,
        preset,
        presetName: UPSCALE_PRESETS[preset].name,
        model: engine === "model" ? selectedModel : null,
        scale: presetScale,
        targetShortEdge: seedvrResolution,
        autoPurge,
        preDetailer: detailerResult.enabled,
        preDetailerPasses: detailerResult.passes,
      },
      loras: [],
    },
  };
}

export function upscaleConfig({
  availableNodes = [],
  availableModels = [],
  availableDetectorModels = [],
  deviceName = "",
} = {}) {
  const nodes = new Set(availableNodes);
  const detectorModels = new Set(availableDetectorModels);
  const isRtx = /NVIDIA\s+GeForce\s+RTX/i.test(deviceName);
  const hasNsfwDetectors = NSFW_DETAILER_DETECTORS.every((name) => detectorModels.has(name));
  return {
    engines: Object.values(UPSCALE_ENGINES).map((engine) => ({
      ...engine,
      available: engine.id === "lanczos"
        || (engine.id === "model" && nodes.has("UpscaleWithModelAdvanced") && availableModels.length > 0)
        || (engine.id === "seedvr2" && ["SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler", "RemoteImageTensorNormalize"].every((name) => nodes.has(name)))
        || (engine.id === "rtx" && nodes.has("DaSiWa_RTX_UpscalerRefiner") && isRtx),
    })),
    presets: Object.values(UPSCALE_PRESETS),
    models: availableModels,
    detailers: {
      available: ["UNETLoader", "DualCLIPLoader", "VAELoader", "ModelSamplingFlux", "easy pipeIn", "easy samLoaderPipe", "easy ultralyticsDetectorPipe", "easy preDetailerFix", "easy detailerFix"]
        .every((name) => nodes.has(name)),
      face: nodes.has("easy ultralyticsDetectorPipe"),
      eyes: nodes.has("easy ultralyticsDetectorPipe"),
      hands: nodes.has("easy ultralyticsDetectorPipe"),
      skin: nodes.has("easy ultralyticsDetectorPipe"),
      nsfw: hasNsfwDetectors,
      nsfwDetectors: NSFW_DETAILER_DETECTORS.map((name) => ({
        name,
        available: detectorModels.has(name),
      })),
      model: "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors",
    },
    deviceName,
    cloudEnginesExcluded: ["Magnific", "Recraft", "WaveSpeed"],
  };
}
