import crypto from "node:crypto";

const DEFAULTS = Object.freeze({
  fps: 24,
  scale: 2,
  resizeFactor: 0.75,
  frameLoadCap: 289,
  crf: 13,
});

export const FLASHVSR_VIDEO_UPSCALE_REQUIRED_NODES = Object.freeze([
  "VHS_LoadVideo",
  "VHS_VideoInfo",
  "VHS_VideoCombine",
  "FlashVSRInitPipe",
  "FlashVSRNodeAdv",
]);

function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function inputPath(upload) {
  return upload?.subfolder ? `${upload.subfolder}/${upload.name}` : upload?.name || "";
}

function numeric(value, fallback, min, max, label, integer = false) {
  const parsed = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} non valido.`);
  }
  return parsed;
}

function seedValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : crypto.randomInt(0, 2 ** 31);
}

export function buildFlashVsrVideoUpscaleWorkflow(raw = {}, upload) {
  if (!upload?.name) throw new Error("Il video da migliorare con FlashVSR non è disponibile.");

  const sourceWidth = numeric(raw.flashVsrSourceWidth, 1184, 2, 8192, "Larghezza sorgente FlashVSR", true);
  const sourceHeight = numeric(raw.flashVsrSourceHeight, 640, 2, 8192, "Altezza sorgente FlashVSR", true);
  const fps = numeric(raw.flashVsrFps, DEFAULTS.fps, 1, 120, "FPS FlashVSR");
  const duration = numeric(raw.flashVsrSourceDuration, 12, 0.04, 3600, "Durata FlashVSR");
  const frameLoadCap = numeric(
    raw.flashVsrFrameLoadCap,
    Math.min(2000, Math.ceil(duration * fps) + 1),
    1,
    2000,
    "Numero massimo fotogrammi FlashVSR",
    true,
  );
  const crf = numeric(raw.flashVsrCrf, DEFAULTS.crf, 0, 51, "CRF FlashVSR", true);
  const seed = seedValue(raw.flashVsrSeed ?? raw.seed);
  const resizeFactor = numeric(raw.flashVsrResizeFactor, DEFAULTS.resizeFactor, 0.1, 1, "Fattore resize FlashVSR");
  const scale = numeric(raw.flashVsrScale, DEFAULTS.scale, 2, 4, "Scala FlashVSR", true);
  const outputWidth = Math.round(sourceWidth * resizeFactor * scale / 2) * 2;
  const outputHeight = Math.round(sourceHeight * resizeFactor * scale / 2) * 2;
  const sourceVideo = inputPath(upload);

  const workflow = {
    "1": node({
      video: sourceVideo,
      force_rate: 0,
      custom_width: 0,
      custom_height: 0,
      frame_load_cap: frameLoadCap,
      skip_first_frames: 0,
      select_every_nth: 1,
    }, "VHS_LoadVideo", "FlashVSR · video sorgente"),
    "2": node({ video_info: ["1", 3] }, "VHS_VideoInfo", "FlashVSR · FPS sorgente"),
    "3": node({
      model: "FlashVSR-v1.1",
      mode: "tiny",
      vae_model: "LightVAE_W2.1",
      force_offload: true,
      precision: "bf16",
      device: "cuda:0",
      attention_mode: "sparse_sage_attention",
    }, "FlashVSRInitPipe", "FlashVSR v1.1 · Tiny · LightVAE"),
    "4": node({
      pipe: ["3", 0],
      frames: ["1", 0],
      scale,
      color_fix: true,
      tiled_vae: true,
      tiled_dit: true,
      tile_size: 256,
      tile_overlap: 24,
      unload_dit: true,
      sparse_ratio: 1.5,
      kv_ratio: 3,
      local_range: 11,
      seed,
      frame_chunk_size: 49,
      enable_debug: true,
      keep_models_on_cpu: true,
      resize_factor: resizeFactor,
    }, "FlashVSRNodeAdv", "FlashVSR Tiny · netto 1,5× · 12 GB VRAM"),
    "5": node({
      frame_rate: ["2", 0],
      loop_count: 0,
      filename_prefix: "VideoStudio/PlagueKindH3SparseV9/flashvsr_tiny_1_5x",
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
      images: ["4", 0],
      audio: ["1", 2],
    }, "VHS_VideoCombine", "FlashVSR Tiny · salva video e audio"),
  };

  return {
    workflow,
    metadata: {
      generationType: "flashVsrVideoUpscale",
      mediaType: "video",
      workflowId: "videoStudio:h3SparseV9:flashVsrTiny15",
      workflowName: "Video Studio · PlagueKind · FlashVSR Tiny 1,5×",
      prompt: "",
      negativePrompt: "",
      seed,
      duration,
      fps,
      width: outputWidth,
      height: outputHeight,
      sourceVideo,
      upscaleSettings: {
        engine: "flashVsrTiny",
        model: "FlashVSR-v1.1",
        mode: "tiny",
        vae: "LightVAE_W2.1",
        scale,
        resizeFactor,
        netScale: resizeFactor * scale,
        outputWidth,
        outputHeight,
        frameChunkSize: 49,
        tiledVae: true,
        tiledDit: true,
        attention: "sparse_sage_attention",
      },
      models: { flashVsr: "FlashVSR-v1.1", vae: "LightVAE_W2.1" },
      loras: [],
    },
  };
}

export function flashVsrVideoUpscaleConfig({ availableNodes = [] } = {}) {
  const nodes = new Set(availableNodes);
  const missingNodes = FLASHVSR_VIDEO_UPSCALE_REQUIRED_NODES.filter((name) => !nodes.has(name));
  return {
    id: "flashVsrTiny15",
    name: "FlashVSR Tiny 1,5×",
    available: missingNodes.length === 0,
    missingNodes,
    outputScale: 1.5,
    profile: "tiny",
    vae: "LightVAE_W2.1",
  };
}
