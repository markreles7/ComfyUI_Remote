function inputPath(upload) {
  if (!upload?.name) return "";
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function node(classType, inputs, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function number(value, fallback, min, max) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error("Impostazione finishing MiniMax H3 non valida.");
  }
  return parsed;
}

const purgeInputs = Object.freeze({
  purge_cache: true,
  purge_models: true,
  purge_seedvr2_models: false,
  purge_qwen3vl_models: true,
  purge_nunchaku_models: false,
  HSWQ: false,
  Ollama: false,
});

export const H3_PREVIEW_FINISHING_NODES = Object.freeze([
  "VHS_LoadVideo",
  "FILM VFI",
  "DisTorchPurgeVRAMV2",
  "LayerUtility: PurgeVRAM",
  "DaSiWa_RTX_UpscalerRefiner",
  "ImageSharpenKJ",
  "VHS_VideoCombine",
]);

export function buildH3PreviewFinishingWorkflow(sourceVideo, raw = {}) {
  if (!sourceVideo?.name) throw new Error("Il video anteprima MiniMax H3 non è disponibile.");
  const finishingMode = String(raw.finishingMode || "rtx") === "kjLanczos" ? "kjLanczos" : "rtx";
  const rcasStrength = number(raw.rcasStrength, 0.35, 0, 1);
  const actionProfile = String(raw.videoStudioMode) === "actionH3";
  const portrait = /^(9:16|3:4|2:3)/.test(String(raw.aspectRatio || ""));
  const square = String(raw.aspectRatio || "").startsWith("1:1");
  const width = square ? 1024 : portrait ? 720 : 1280;
  const height = square ? 1024 : portrait ? 1280 : 720;
  if (finishingMode === "kjLanczos") {
    const workflow = {
      "1": node("VHS_LoadVideo", {
        video: inputPath(sourceVideo), force_rate: 24, custom_width: 0, custom_height: 0,
        frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "AnimateDiff",
      }, "MiniMax H3 · carica originale e audio nativo"),
      "2": node("ImageResizeKJv2", {
        image: ["1", 0], width, height, upscale_method: "lanczos", keep_proportion: "crop",
        pad_color: "0, 0, 0", crop_position: "center", divisible_by: 8, device: "cpu",
      }, "MiniMax H3 · KJ Lanczos conservativo"),
      "3": node("VHS_VideoCombine", {
        images: ["2", 0], audio: ["1", 2], frame_rate: 24, loop_count: 0,
        filename_prefix: `VideoStudio/${actionProfile ? "ActionH3" : "MiniMaxH3"}/promoted_kj_lanczos`,
        format: "video/h264-mp4", pix_fmt: "yuv420p", crf: 18, save_metadata: true,
        trim_to_audio: false, pingpong: false, save_output: true,
      }, "MiniMax H3 · salva KJ conservativo"),
      "4": node("LayerUtility: PurgeVRAM", {
        anything: ["3", 0], purge_cache: true, purge_models: true,
      }, "MiniMax H3 · libera VRAM finishing"),
    };
    return {
      workflow,
      metadata: {
        workflowId: `videoStudio:${actionProfile ? "actionH3" : "minimaxH3"}:previewFinishing:kjLanczos`,
        workflowName: `Video Studio · ${actionProfile ? "ACTION H3" : "MiniMax H3"} · KJ Lanczos conservativo`,
        videoStudioMode: actionProfile ? "actionH3" : "minimaxH3",
        videoStudioStage: "previewFinishing",
        videoStudioLabel: "Promozione conservativa · KJ Lanczos",
        h3Stage: "promotedFinal",
        finishingMode,
        sourceVideo: inputPath(sourceVideo),
        outputFps: 24,
        outputWidth: width,
        outputHeight: height,
      },
    };
  }
  const workflow = {
    "1": node("VHS_LoadVideo", {
      video: inputPath(sourceVideo),
      force_rate: 24,
      custom_width: 0,
      custom_height: 0,
      frame_load_cap: 0,
      skip_first_frames: 0,
      select_every_nth: 1,
      format: "AnimateDiff",
    }, "MiniMax H3 · carica anteprima e audio nativo"),
    "2": node("FILM VFI", {
      ckpt_name: "film_net_fp32.pt",
      frames: ["1", 0],
      clear_cache_after_n_frames: 10,
      multiplier: 2,
    }, "MiniMax H3 · FILM 24 → 48 FPS"),
    "3": node("DisTorchPurgeVRAMV2", {
      anything: ["2", 0],
      ...purgeInputs,
    }, "MiniMax H3 · purge dopo FILM"),
    "4": node("DaSiWa_RTX_UpscalerRefiner", {
      images: ["3", 0],
      denoise: false,
      denoise_quality: "Medium",
      deblur: true,
      deblur_quality: "Medium",
      upscale: "VSR",
      upscale_quality: "Ultra",
      resize_type: "Scale",
      scale: 2,
      megapixels: 1,
      width: 1920,
      height: 1080,
      divisible_by: "8",
      ratio_preset: "16:9",
      resize_method: "Center Crop (Fill)",
      device_id: 0,
    }, "MiniMax H3 · RTX VSR ×2"),
    "5": node("DisTorchPurgeVRAMV2", {
      anything: ["4", 0],
      ...purgeInputs,
    }, "MiniMax H3 · purge dopo RTX VSR"),
    "6": node("ImageSharpenKJ", {
      image: ["5", 0],
      // ComfyUI V3 DynamicCombo inputs use flattened API paths. Passing an
      // object here is accepted by /prompt but then omitted at execution.
      method: "rcas",
      "method.strength": rcasStrength,
    }, "MiniMax H3 · FSR RCAS organico"),
    "7": node("VHS_VideoCombine", {
      images: ["6", 0],
      audio: ["1", 2],
      frame_rate: 48,
      loop_count: 0,
      filename_prefix: `VideoStudio/${actionProfile ? "ActionH3" : "MiniMaxH3"}/promoted_film_rtx2_rcas`,
      format: "video/h264-mp4",
      pix_fmt: "yuv420p",
      crf: 17,
      save_metadata: true,
      trim_to_audio: false,
      pingpong: false,
      save_output: true,
    }, "MiniMax H3 · salva finale promosso"),
    "8": node("DisTorchPurgeVRAMV2", {
      anything: ["7", 0],
      ...purgeInputs,
    }, "MiniMax H3 · purge finale finishing"),
    "9": node("LayerUtility: PurgeVRAM", {
      anything: ["8", 0],
      purge_cache: true,
      purge_models: true,
    }, "MiniMax H3 · libera VRAM finishing"),
  };
  return {
    workflow,
    metadata: {
      workflowId: `videoStudio:${actionProfile ? "actionH3" : "minimaxH3"}:previewFinishing`,
      workflowName: `Video Studio · ${actionProfile ? "ACTION H3" : "MiniMax H3"} · FILM → RTX ×2 → RCAS`,
      videoStudioMode: actionProfile ? "actionH3" : "minimaxH3",
      videoStudioStage: "previewFinishing",
      videoStudioLabel: "Promozione anteprima · FILM → RTX ×2 → RCAS",
      h3Stage: "promotedFinal",
      sourceVideo: inputPath(sourceVideo),
      filmMultiplier: 2,
      outputFps: 48,
      rtxScale: 2,
      rcasStrength,
      finishingMode,
    },
  };
}

export function buildH3SceneRecipe(job, raw = {}, uploads = {}, loras = []) {
  const metadata = job?.metadata || {};
  if (!["minimaxH3", "actionH3", "seedHunterH3"].includes(metadata.videoStudioMode)) return null;
  return {
    schemaVersion: 1,
    prompt: metadata.prompt,
    userPrompt: String(raw.prompt || "").trim(),
    seed: metadata.seed,
    h3Mode: metadata.h3Mode,
    h3Profile: metadata.h3Profile,
    h3ModelProfile: metadata.h3ModelProfile || "base",
    integratedTurbo: Boolean(metadata.integratedTurbo),
    actionPreset: metadata.actionPreset || "custom",
    lookPreset: metadata.lookPreset,
    scenePreset: metadata.scenePreset || "none",
    duration: metadata.duration,
    frames: metadata.frames,
    aspectRatio: metadata.aspectRatio,
    modelFamily: metadata.modelFamily,
    modelFile: metadata.modelFile,
    samplerName: metadata.samplerName,
    schedulerName: metadata.schedulerName,
    useTurbo: metadata.useTurbo,
    loras: structuredClone(loras || []),
    uploads: structuredClone(uploads || {}),
    nativeSettings: {
      h3FirstMegapixels: raw.h3FirstMegapixels,
      h3RefineMode: raw.h3RefineMode,
      h3SecondMegapixels: raw.h3SecondMegapixels,
      h3SeedvrResolution: raw.h3SeedvrResolution,
      h3PurgeBetween: raw.h3PurgeBetween,
      h3PurgeAfter: raw.h3PurgeAfter,
      h3UseTurbo: raw.h3UseTurbo,
      h3ModelProfile: raw.h3ModelProfile,
      h3AttentionBackend: raw.h3AttentionBackend,
      h3LookPreset: raw.h3LookPreset,
      h3ScenePreset: raw.h3ScenePreset,
      actionH3Preset: raw.actionH3Preset,
      h3ReferenceSize: raw.h3ReferenceSize,
    },
  };
}
