import crypto from "node:crypto";

const DEFAULTS = {
  preset: "quality",
  model: "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
  vae: "ema_vae_fp16.safetensors",
  fps: 24,
  frameLoadCap: 121,
  crf: 13,
};

export const SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES = [
  "VHS_LoadVideo",
  "VHS_VideoInfo",
  "VHS_VideoCombine",
  "SeedVR2LoadDiTModel",
  "SeedVR2LoadVAEModel",
  "SeedVR2VideoUpscaler",
];

export const SEEDVR2_VIDEO_UPSCALE_PROFILES = {
  preview: {
    id: "preview",
    name: "Anteprima",
    description: "Molto rapida: batch piccolo, overlap ridotto e modello 3B.",
    model: "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
    resolution: 720,
    batchSize: 9,
    temporalOverlap: 1,
    blocksToSwap: 32,
    swapIoComponents: true,
    encodeTileSize: 768,
    decodeTileSize: 768,
    crf: 16,
  },
  quality: {
    id: "quality",
    name: "Qualita",
    description: "Bilanciata: piu' dettaglio e continuita' temporale.",
    model: "seedvr2_ema_3b_fp8_e4m3fn.safetensors",
    resolution: 1080,
    batchSize: 17,
    temporalOverlap: 3,
    blocksToSwap: 32,
    swapIoComponents: false,
    encodeTileSize: 1024,
    decodeTileSize: 768,
    crf: 13,
  },
  max: {
    id: "max",
    name: "Massima",
    description: "Finale: usa SeedVR2 7B se installato, piu' lenta e pesante.",
    model: "seedvr2_ema_7b_fp16.safetensors",
    resolution: 1440,
    batchSize: 17,
    temporalOverlap: 5,
    blocksToSwap: 32,
    swapIoComponents: false,
    encodeTileSize: 768,
    decodeTileSize: 768,
    crf: 10,
  },
};

function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function inputPath(upload) {
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "on", "yes"].includes(String(value).toLowerCase());
}

function numberValue(value, fallback, { min, max, integer = false, label }) {
  const parsed = value === undefined || value === null || value === ""
    ? fallback
    : Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error(`${label} non valido.`);
  }
  return parsed;
}

function seedValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : crypto.randomInt(0, 2 ** 31);
}

export function buildSeedvr2VideoUpscaleWorkflow(rawOptions = {}, upload) {
  if (!upload?.name) {
    throw new Error("Carica un video da elaborare con SeedVR2.");
  }

  const presetId = String(rawOptions.seedvr2VideoPreset || DEFAULTS.preset);
  const profile = SEEDVR2_VIDEO_UPSCALE_PROFILES[presetId];
  if (!profile) throw new Error("Preset SeedVR2 Video non valido.");

  const seed = seedValue(rawOptions.seedvr2VideoSeed || rawOptions.seed);
  const keepAudio = booleanValue(rawOptions.seedvr2VideoKeepAudio, true);
  const sourceVideo = inputPath(upload);
  const frameLoadCap = numberValue(
    rawOptions.seedvr2VideoFrameLoadCap,
    DEFAULTS.frameLoadCap,
    { min: 1, max: 2000, integer: true, label: "Numero massimo fotogrammi SeedVR2" },
  );
  const fpsFallback = numberValue(
    rawOptions.seedvr2VideoFps,
    DEFAULTS.fps,
    { min: 1, max: 120, label: "FPS SeedVR2" },
  );
  const crf = numberValue(
    rawOptions.seedvr2VideoCrf,
    profile.crf ?? DEFAULTS.crf,
    { min: 0, max: 51, integer: true, label: "CRF SeedVR2" },
  );
  const resolution = numberValue(
    rawOptions.seedvr2VideoResolution,
    profile.resolution,
    { min: 360, max: 4096, integer: true, label: "Risoluzione SeedVR2" },
  );
  const maxResolution = numberValue(
    rawOptions.seedvr2VideoMaxResolution,
    4096,
    { min: resolution, max: 8192, integer: true, label: "Risoluzione massima SeedVR2" },
  );

  const model = String(rawOptions.seedvr2VideoModel || profile.model || DEFAULTS.model);
  const vae = String(rawOptions.seedvr2VideoVae || DEFAULTS.vae);

  const workflow = {
    "1": node(
      {
        video: sourceVideo,
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: frameLoadCap,
        skip_first_frames: 0,
        select_every_nth: 1,
      },
      "VHS_LoadVideo",
      "Video sorgente",
    ),
    "2": node(
      {
        video_info: ["1", 3],
      },
      "VHS_VideoInfo",
      "FPS sorgente",
    ),
    "4": node(
      {
        model,
        device: "cuda:0",
        blocks_to_swap: profile.blocksToSwap,
        swap_io_components: profile.swapIoComponents,
        offload_device: "cpu",
        cache_model: false,
        attention_mode: "sdpa",
      },
      "SeedVR2LoadDiTModel",
      "SeedVR2 DiT",
    ),
    "5": node(
      {
        model: vae,
        device: "cuda:0",
        encode_tiled: true,
        encode_tile_size: profile.encodeTileSize,
        encode_tile_overlap: 128,
        decode_tiled: true,
        decode_tile_size: profile.decodeTileSize,
        decode_tile_overlap: 128,
        tile_debug: "false",
        offload_device: "cpu",
        cache_model: false,
      },
      "SeedVR2LoadVAEModel",
      "SeedVR2 VAE tiled",
    ),
    "6": node(
      {
        image: ["1", 0],
        dit: ["4", 0],
        vae: ["5", 0],
        seed,
        resolution,
        max_resolution: maxResolution,
        batch_size: profile.batchSize,
        uniform_batch_size: true,
        color_correction: "lab",
        temporal_overlap: profile.temporalOverlap,
        prepend_frames: 0,
        input_noise_scale: 0,
        latent_noise_scale: 0,
        offload_device: "cpu",
        enable_debug: false,
      },
      "SeedVR2VideoUpscaler",
      `SeedVR2 Video · ${profile.name}`,
    ),
    "7": node(
      {
        frame_rate: ["2", 0],
        loop_count: 0,
        filename_prefix: `video/SeedVR2_Video_Upscale_${presetId}`,
        format: "video/h264-mp4",
        pix_fmt: "yuv420p",
        crf,
        save_metadata: true,
        trim_to_audio: false,
        pingpong: false,
        save_output: true,
        images: ["6", 0],
        audio: ["1", 2],
      },
      "VHS_VideoCombine",
      "Salva video SeedVR2",
    ),
  };

  if (!keepAudio) {
    delete workflow["7"].inputs.audio;
  }

  const sourceDuration = numberValue(
    rawOptions.seedvr2VideoSourceDuration,
    0,
    { min: 0, max: 24 * 60 * 60, label: "Durata sorgente SeedVR2" },
  );
  const processedDuration = sourceDuration > 0
    ? Math.min(sourceDuration, frameLoadCap / fpsFallback)
    : frameLoadCap / fpsFallback;

  return {
    workflow,
    metadata: {
      generationType: "seedvr2VideoUpscale",
      mediaType: "video",
      workflowId: `seedvr2VideoUpscale:${presetId}`,
      workflowName: `SeedVR2 Video Upscale · ${profile.name}`,
      prompt: "",
      negativePrompt: "",
      seed,
      duration: Number(processedDuration.toFixed(2)),
      fps: fpsFallback,
      sourceVideo,
      upscaleSettings: {
        engine: "seedvr2Video",
        engineName: "SeedVR2 Video Upscale",
        preset: presetId,
        presetName: profile.name,
        model,
        vae,
        resolution,
        maxResolution,
        batchSize: profile.batchSize,
        temporalOverlap: profile.temporalOverlap,
        frameLoadCap,
        keepAudio,
        crf,
      },
      models: {
        seedvr2: model,
        vae,
      },
      loras: [],
    },
  };
}

export function seedvr2VideoUpscaleConfig({
  availableNodes = [],
  installedSeedvr2Models = [],
  installedVaes = [],
} = {}) {
  const nodes = new Set(availableNodes);
  const normalized = (value) => String(value || "").replaceAll("/", "\\").toLowerCase();
  const hasFile = (list, expected) =>
    list.some((name) => {
      const actual = normalized(name);
      const wanted = normalized(expected);
      return actual === wanted || actual.endsWith(`\\${wanted}`);
    });

  const missingNodes = SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES.filter(
    (name) => !nodes.has(name),
  );

  const profiles = Object.values(SEEDVR2_VIDEO_UPSCALE_PROFILES).map((profile) => ({
    ...profile,
    available: hasFile(installedSeedvr2Models, profile.model),
  }));

  const vaeAvailable = hasFile(installedVaes, DEFAULTS.vae);
  const available = missingNodes.length === 0 &&
    vaeAvailable &&
    profiles.some((profile) => profile.available);

  return {
    id: "seedvr2VideoUpscale",
    name: "SeedVR2 Video Upscale",
    description:
      "Upscaling video generativo frame-consistent con SeedVR2, senza pass LTX.",
    available,
    missingNodes,
    missingFiles: [...new Set([
      ...profiles
        .filter((profile) => !profile.available)
        .map((profile) => profile.model),
      ...(vaeAvailable ? [] : [DEFAULTS.vae]),
    ])],
    profiles,
    defaults: {
      preset: DEFAULTS.preset,
      frameLoadCap: DEFAULTS.frameLoadCap,
      fps: DEFAULTS.fps,
      crf: DEFAULTS.crf,
      keepAudio: true,
      vae: DEFAULTS.vae,
    },
  };
}
