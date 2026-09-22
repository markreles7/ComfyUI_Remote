import crypto from "node:crypto";

export const SUPER_UPSCALE_PRESETS = {
  "4k": { id: "4k", name: "4K", restoreSize: 2048, finalSize: 4096 },
  "6k": { id: "6k", name: "6K", restoreSize: 3072, finalSize: 6144 },
  "8k": { id: "8k", name: "8K MAX", restoreSize: 3840, finalSize: 7680 },
};

export const SUPER_UPSCALE_FILES = {
  seedvrModel: "seedvr2_ema_7b_fp16.safetensors",
  seedvrVae: "ema_vae_fp16.safetensors",
  diffusionModel: "Z-IMG\\z_image_turbo_bf16.safetensors",
  clip: "qwen_3_4b.safetensors",
  vae: "ae.safetensors",
  upscaleModel: "4x-ClearRealityV1.pth",
  visionModel: "LM Studio Vision",
};

export const SUPER_UPSCALE_REQUIRED_NODES = [
  "LoadImage",
  "LayerUtility: ImageScaleByAspectRatio V2",
  "SeedVR2LoadDiTModel",
  "SeedVR2LoadVAEModel",
  "SeedVR2VideoUpscaler",
  "VRAM_Debug",
  "TTP_Tile_image_size",
  "TTP_Image_Tile_Batch",
  "easy imageBatchToImageList",
  "ImageScaleDownToSize",
  "UNETLoader",
  "CLIPLoader",
  "VAELoader",
  "CLIPTextEncode",
  "ConditioningZeroOut",
  "ModelPatchLoader",
  "CannyEdgePreprocessor",
  "QwenImageDiffsynthControlnet",
  "VAEEncode",
  "KSampler",
  "VAEDecode",
  "ImageListToImageBatch",
  "TTP_Image_Assy",
  "ImageSharpen",
  "ColorMatch",
  "JWImageSaturation",
  "UpscaleModelLoader",
  "ImageUpscaleWithModel",
  "RemoteImageTensorNormalize",
  "SaveImage",
];

const DEFAULT_RESTORE_PROMPT = "RAW photo, 8k uhd, dslr, sharp focus, authentic textures, natural lighting, masterpiece, preserve the exact visible subject, identity, anatomy, expression, pose, clothing, objects, environment, composition, camera angle, colors and lighting, reconstruct clean realistic micro-details, natural skin texture, individual hair strands, tactile fabric weave, precise material edges, no new objects, no composition changes";

function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function inputPath(upload) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function numeric(value, fallback, min, max) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function seedValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= 4294967295
    ? parsed
    : crypto.randomInt(1, 2 ** 31);
}

function matchInstalled(installed, expected) {
  return installed.some((item) => String(item).toLowerCase() === expected.toLowerCase());
}

function compatiblePatch(installed = []) {
  return installed.find((name) => /Z-Image-Turbo-Fun-Controlnet-Union-2\.1-26\d{2}-8steps\.safetensors/i.test(name)) || null;
}

export function buildSuperUpscaleWorkflow(rawOptions = {}, upload, runtime = {}) {
  if (!upload?.name) throw new Error("Carica una foto per SUPER UPSCALE.");
  const preset = SUPER_UPSCALE_PRESETS[String(rawOptions.superUpscalePreset || "8k")];
  if (!preset) throw new Error("Preset SUPER UPSCALE non valido.");
  const seed = seedValue(rawOptions.superUpscaleSeed ?? rawOptions.seed);
  const denoise = numeric(rawOptions.superUpscaleDenoise, 0.35, 0.15, 0.55);
  const controlStrength = numeric(rawOptions.superUpscaleControlStrength, 0.5, 0.2, 1);
  const modelPatch = runtime.modelPatch || rawOptions.superUpscaleModelPatch;
  if (!modelPatch) throw new Error("Manca il ControlNet Union per Z-Image Turbo.");

  const workflow = {
    "1": node({ image: inputPath(upload) }, "LoadImage", "SUPER UPSCALE · sorgente"),
    "2": node({
      aspect_ratio: "original", proportional_width: 1, proportional_height: 1,
      fit: "letterbox", method: "lanczos", round_to_multiple: "8",
      scale_to_side: "longest", scale_to_length: 1024, background_color: "#000000",
      image: ["1", 0],
    }, "LayerUtility: ImageScaleByAspectRatio V2", "Prepara sorgente a 1024 px"),
    "10": node({
      model: SUPER_UPSCALE_FILES.seedvrModel, device: "cuda:0", blocks_to_swap: 36,
      swap_io_components: false, offload_device: "cpu", attention_mode: "sdpa",
    }, "SeedVR2LoadDiTModel", "SeedVR2 7B · restauro"),
    "11": node({
      model: SUPER_UPSCALE_FILES.seedvrVae, device: "cuda:0",
      encode_tiled: true, encode_tile_size: 1024, encode_tile_overlap: 128,
      decode_tiled: true, decode_tile_size: 1024, decode_tile_overlap: 128,
      tile_debug: "false", offload_device: "cpu",
    }, "SeedVR2LoadVAEModel", "SeedVR2 VAE · tiled"),
    "12": node({
      image: ["2", 0], dit: ["10", 0], vae: ["11", 0], seed,
      resolution: preset.restoreSize, max_resolution: preset.restoreSize,
      batch_size: 1, uniform_batch_size: false, color_correction: "lab",
      temporal_overlap: 16, prepend_frames: 0, input_noise_scale: 0,
      latent_noise_scale: 0, offload_device: "cpu", enable_debug: false,
    }, "SeedVR2VideoUpscaler", `SeedVR2 · ${preset.restoreSize}px`),
    "13": node({
      empty_cache: true, gc_collect: true, unload_all_models: true, image_pass: ["12", 0],
    }, "VRAM_Debug", "Libera VRAM dopo SeedVR2"),
    "14": node({
      aspect_ratio: "original", proportional_width: 1, proportional_height: 1,
      fit: "letterbox", method: "lanczos", round_to_multiple: "8",
      scale_to_side: "longest", scale_to_length: preset.restoreSize,
      background_color: "#000000", image: ["13", 1],
    }, "LayerUtility: ImageScaleByAspectRatio V2", "Normalizza dimensione restauro"),
    "20": node({ image: ["14", 0], width_factor: 2, height_factor: 2, overlap_rate: 0.2 }, "TTP_Tile_image_size", "Tile 2×2 · overlap 20%"),
    "21": node({ image: ["14", 0], tile_width: ["20", 0], tile_height: ["20", 1] }, "TTP_Image_Tile_Batch", "Divide in tile"),
    "22": node({ image: ["21", 0] }, "easy imageBatchToImageList", "Tile come lista"),
    "30": node({ unet_name: SUPER_UPSCALE_FILES.diffusionModel, weight_dtype: "default" }, "UNETLoader", "Z-Image Turbo"),
    "31": node({ clip_name: SUPER_UPSCALE_FILES.clip, type: "qwen_image", device: "default" }, "CLIPLoader", "Qwen text encoder"),
    "32": node({ vae_name: SUPER_UPSCALE_FILES.vae }, "VAELoader", "Z-Image VAE"),
    "33": node({ name: modelPatch }, "ModelPatchLoader", "Z-Image ControlNet Union"),
    "34": node({
      text: String(rawOptions.superUpscaleVisionPrompt || "").trim() || DEFAULT_RESTORE_PROMPT,
      clip: ["31", 0],
    }, "CLIPTextEncode", "Descrizione Vision della sorgente"),
    "35": node({ conditioning: ["34", 0] }, "ConditioningZeroOut", "Condizionamento negativo neutro"),
    "36": node({ low_threshold: 100, high_threshold: 200, resolution: 1024, image: ["22", 0] }, "CannyEdgePreprocessor", "Bordi strutturali"),
    "37": node({
      model: ["30", 0], model_patch: ["33", 0], vae: ["32", 0],
      image: ["36", 0], strength: controlStrength,
    }, "QwenImageDiffsynthControlnet", "ControlNet · fedeltà struttura"),
    "38": node({ pixels: ["22", 0], vae: ["32", 0] }, "VAEEncode", "Codifica tile originale"),
    "39": node({
      seed, steps: 8, cfg: 1, sampler_name: "euler", scheduler: "simple",
      denoise, model: ["37", 0], positive: ["34", 0], negative: ["35", 0], latent_image: ["38", 0],
    }, "KSampler", "Restauro generativo Z-Image · 8 step"),
    "40": node({ samples: ["39", 0], vae: ["32", 0] }, "VAEDecode", "Decodifica tile restaurato"),
    "41": node({ images: ["40", 0] }, "ImageListToImageBatch", "Riunisce i tile"),
    "42": node({
      tiles: ["41", 0], positions: ["21", 1], original_size: ["21", 2], grid_size: ["21", 3], padding: 64,
    }, "TTP_Image_Assy", "Ricompone con fusione overlap"),
    "43": node({ image: ["42", 0], sharpen_radius: 1, sigma: 0.4, alpha: 0.5 }, "ImageSharpen", "Micro-sharpen controllato"),
    "44": node({ image_ref: ["1", 0], image_target: ["43", 0], method: "mkl", strength: 1, multithread: true }, "ColorMatch", "Ripristina i colori originali"),
    "45": node({ image: ["44", 0], factor: 1.1 }, "JWImageSaturation", "Saturazione naturale"),
    "50": node({ model_name: SUPER_UPSCALE_FILES.upscaleModel }, "UpscaleModelLoader", "ClearReality 4×"),
    "51": node({ upscale_model: ["50", 0], image: ["45", 0] }, "ImageUpscaleWithModel", "ClearReality · dettaglio finale"),
    "52": node({ images: ["51", 0], size: preset.finalSize, mode: true }, "ImageScaleDownToSize", `Limite finale ${preset.name}`),
    "53": node({ image: ["52", 0] }, "RemoteImageTensorNormalize", "Normalizza output finale"),
    "99": node({ images: ["53", 0], filename_prefix: `Remote_SUPER_UPSCALE_${preset.id}` }, "SaveImage", "Salva SUPER UPSCALE"),
  };

  return {
    workflow,
    metadata: {
      mediaType: "image",
      generationType: "superUpscale",
      workflowId: `superUpscale:${preset.id}`,
      workflowName: `SUPER UPSCALE · ${preset.name}`,
      prompt: "",
      negativePrompt: "",
      resolution: `Lato lungo max ${preset.finalSize}px`,
      width: null,
      height: null,
      duration: null,
      fps: null,
      quality: preset.id,
      seed,
      batchSize: 1,
      sourceImage: inputPath(upload),
      upscaleSettings: {
        engine: "superUpscale",
        engineName: "SeedVR2 7B + Z-Image ControlNet + ClearReality",
        preset: preset.id,
        presetName: preset.name,
        model: SUPER_UPSCALE_FILES.upscaleModel,
        targetLongEdge: preset.finalSize,
        restoreSize: preset.restoreSize,
        denoise,
        controlStrength,
        tileGrid: "2×2",
        autoCaption: rawOptions.superUpscaleVisionPrompt ? SUPER_UPSCALE_FILES.visionModel : "Fallback universale",
        modelPatch,
        autoPurge: true,
      },
      loras: [],
    },
  };
}

export function superUpscaleConfig({
  availableNodes = [], installedSeedvr2Models = [], installedSeedvr2Vaes = [],
  installedDiffusionModels = [], installedClips = [], installedVaes = [],
  installedModelPatches = [], installedUpscaleModels = [],
} = {}) {
  const nodes = new Set(availableNodes);
  const missingNodes = SUPER_UPSCALE_REQUIRED_NODES.filter((name) => !nodes.has(name));
  const modelPatch = compatiblePatch(installedModelPatches);
  const checks = [
    [installedSeedvr2Models, SUPER_UPSCALE_FILES.seedvrModel],
    [installedSeedvr2Vaes, SUPER_UPSCALE_FILES.seedvrVae],
    [installedDiffusionModels, SUPER_UPSCALE_FILES.diffusionModel],
    [installedClips, SUPER_UPSCALE_FILES.clip],
    [installedVaes, SUPER_UPSCALE_FILES.vae],
    [installedUpscaleModels, SUPER_UPSCALE_FILES.upscaleModel],
  ];
  const missingFiles = checks.filter(([list, name]) => !matchInstalled(list, name)).map(([, name]) => name);
  if (!modelPatch) missingFiles.push("Z-Image-Turbo-Fun-Controlnet-Union-2.1-26xx-8steps.safetensors");
  return {
    available: missingNodes.length === 0 && missingFiles.length === 0,
    missingNodes,
    missingFiles,
    modelPatch,
    presets: Object.values(SUPER_UPSCALE_PRESETS),
    pipeline: ["LM Studio Vision", "SeedVR2 7B", "Z-Image ControlNet 8 step", "ClearReality 4×"],
    visionModel: SUPER_UPSCALE_FILES.visionModel,
  };
}
