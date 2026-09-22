import crypto from "node:crypto";
import { h3ActionPreset } from "./h3-action-presets.js";

const TASK_LABELS = Object.freeze({
  t2v: "t2v — 文生视频(Text to Video)",
  i2v: "i2v — 图生视频(Image to Video)",
  fl2v: "fl2v — 首尾帧生视频(First-Last Frame)",
  r2v: "r2v — 参考主体生视频(Reference to Video)",
});

const RATIOS = Object.freeze({
  "16:9": [16, 9],
  "9:16": [9, 16],
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "3:2": [3, 2],
  "2:3": [2, 3],
});

function node(classType, inputs, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["true", "1", "on"].includes(String(value).toLowerCase());
}

function number(value, fallback, min, max, integer = false) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error("Impostazione AllInOne non valida.");
  }
  return parsed;
}

function inputPath(upload) {
  if (!upload?.name) return "";
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function segmentFrames(duration) {
  const raw = Math.max(5, Math.round(duration * 24));
  return raw + ((5 - (raw % 17)) % 17);
}

function dimensions(aspect, megapixels) {
  const [rw, rh] = RATIOS[aspect] || RATIOS["16:9"];
  const scale = Math.sqrt((megapixels * 1_000_000) / (rw * rh));
  return {
    width: Math.max(32, Math.round((rw * scale) / 32) * 32),
    height: Math.max(32, Math.round((rh * scale) / 32) * 32),
  };
}

function prompts(value) {
  const result = String(value || "")
    .split(/^\s*---+\s*$/mu)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!result.length) throw new Error("Inserisci almeno un prompt nella timeline AllInOne.");
  if (result.length > 24) throw new Error("AllInOne accetta massimo 24 segmenti per progetto.");
  return result;
}

function withLoraTriggers(scenePrompts, loras, metadata = {}, automaticTriggers = []) {
  const triggers = [...new Set([...automaticTriggers, ...loras
    .map((selected) => String(metadata[selected.name]?.trigger || "").trim())
    .filter(Boolean)].map((item) => String(item || "").trim()).filter(Boolean))];
  if (!triggers.length) return scenePrompts;
  return scenePrompts.map((prompt) => {
    const normalized = prompt.toLocaleLowerCase();
    const missing = triggers.filter((trigger) => !normalized.includes(trigger.toLocaleLowerCase()));
    return missing.length ? `${missing.join(", ")}. ${prompt}` : prompt;
  });
}

function imageRef(upload, index = 0) {
  const file = inputPath(upload);
  return file ? { index, imageFile: file, fileName: upload.name || "", type: "input", subfolder: upload.subfolder || "" } : null;
}

function mediaRef(upload, index, kind) {
  const file = inputPath(upload);
  if (!file) return null;
  return kind === "audio"
    ? { index, audioFile: file, fileName: upload.name || "", type: "input", subfolder: upload.subfolder || "" }
    : { index, videoFile: file, fileName: upload.name || "", type: "input", subfolder: upload.subfolder || "", pairedAudioFile: "", linked: true };
}

function makeTimeline({ taskKey, scenePrompts, duration, width, height, megapixels, aspect, uploads, continuity, overlap }) {
  const frameCount = segmentFrames(duration);
  const startImages = uploads.directorStartImages || [];
  const endImages = uploads.directorEndImages || [];
  const refs = (uploads.directorReferenceImages || []).map((item, index) => imageRef(item, index));
  const refVideos = (uploads.directorReferenceVideos || []).map((item, index) => mediaRef(item, index, "video"));
  const refAudios = (uploads.directorReferenceAudios || []).map((item, index) => mediaRef(item, index, "audio"));
  if (taskKey === "i2v" && !startImages.length) {
    throw new Error("I2V AllInOne richiede almeno l’immagine iniziale del primo segmento.");
  }
  const chainedI2v = taskKey === "i2v" && startImages.length < scenePrompts.length;
  if (chainedI2v && !continuity) {
    throw new Error("Con una sola immagine iniziale, attiva Continuità automatica: i segmenti successivi useranno l’uscita del segmento precedente.");
  }
  if (taskKey === "fl2v" && (startImages.length < scenePrompts.length || endImages.length < scenePrompts.length)) {
    throw new Error("First/Last AllInOne richiede una coppia di immagini per ciascun prompt/segmento.");
  }
  if (taskKey === "r2v" && !refs.length && !refVideos.length && !refAudios.length) {
    throw new Error("Reference AllInOne richiede almeno una reference immagine, video o audio.");
  }
  const segments = scenePrompts.map((prompt, index) => {
    const startImage = imageRef(startImages[index]);
    const endImage = imageRef(endImages[index]);
    return {
      id: `allinone_${index + 1}`,
      start: index * frameCount,
      length: frameCount,
      frameCount,
      durationSec: duration,
      prompt,
      negativePrompt: "",
      taskType: chainedI2v
        ? (startImage ? TASK_LABELS.i2v : TASK_LABELS.t2v)
        : "",
      refs: taskKey === "r2v" ? refs : [],
      refVideos: taskKey === "r2v" ? refVideos : [],
      refAudios: taskKey === "r2v" ? refAudios : [],
      genImage: startImage ? { imageFile: startImage.imageFile, fileName: startImage.fileName } : { imageFile: "" },
      startImage: startImage || null,
      endImage: endImage || null,
      continuityFromPrev: continuity && index > 0,
      refImageSize: "match",
    };
  });
  const totalFrames = frameCount * segments.length;
  const shots = taskKey === "fl2v" ? segments.map((segment) => ({
    id: segment.id,
    durationSec: segment.durationSec,
    prompt: segment.prompt,
    negativePrompt: segment.negativePrompt,
    continuityFromPrev: segment.continuityFromPrev,
    startImage: segment.startImage,
    endImage: segment.endImage,
  })) : undefined;
  return {
    version: 5,
    editMode: "segment",
    timelineMode: taskKey === "fl2v" ? "fl2v" : "prompt_batch",
    totalFrames,
    frameRate: 24,
    width,
    height,
    refMaxSize: Math.max(width, height),
    video: { fileName: "", videoFile: "", subfolder: "", type: "input", frames: [], frameMap: [], sourceFrameCount: 0, deletedSourceRanges: [] },
    videoClips: [],
    global: {
      taskType: chainedI2v ? TASK_LABELS.t2v : TASK_LABELS[taskKey], prompt: "", refs: taskKey === "r2v" ? refs : [],
      refVideos: taskKey === "r2v" ? refVideos : [], refAudios: taskKey === "r2v" ? refAudios : [],
      referenceVideo: { videoFile: "", fileName: "", type: "input", subfolder: "" },
      continuousReference: false, genImage: { imageFile: "" }, commonEnabled: taskKey === "r2v", commonCollapsed: false,
    },
    output: {
      mode: "fixed", aspectRatio: aspect, megapixels, multiple: 32, longEdge: Math.max(width, height), width, height,
      maxExportFrames: 0, exportMode: "all", audioMode: "generate", exportSourceImages: false,
      refImageSize: "match", continuityEnabled: continuity, continuityOverlapFrames: overlap,
    },
    runSelectEnabled: false,
    runSelection: [],
    segments,
    ...(shots ? { shots } : {}),
    gen: { defaultFrameCount: frameCount },
    durationSec: duration * segments.length,
    liveTaePreview: false,
    batchDetailMode: "solo",
  };
}

export function buildMiniMaxH3DirectorWorkflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const h3 = config.h3 || {};
  const files = h3.files || {};
  if (!h3.director?.available) throw new Error(h3.director?.reason || "MiniMax H3 Director non è disponibile.");
  const taskKey = ["t2v", "i2v", "fl2v", "r2v"].includes(raw.directorMode) ? raw.directorMode : "t2v";
  const directorPreset = raw.directorPreset === "actionScene" ? "actionScene" : "standard";
  const actionLoraType = raw.directorActionLora === "weapon" ? "weapon" : "combat";
  const actionPreset = directorPreset === "actionScene"
    ? h3ActionPreset(raw.directorActionPreset, actionLoraType)
    : h3ActionPreset("custom");
  const actionLora = directorPreset === "actionScene"
    ? actionLoraType === "weapon" ? files.weaponCombat : files.combat
    : null;
  if (directorPreset === "actionScene" && !files.hybridB25) {
    throw new Error("ACTION SCENE richiede minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors.");
  }
  if (directorPreset === "actionScene" && !actionLora) {
    throw new Error(`ACTION SCENE richiede la LoRA ${actionLoraType === "weapon" ? "Weapon Combat" : "Combat V2"}.`);
  }
  const actionTrigger = directorPreset === "actionScene" ? actionPreset.trigger || (actionLoraType === "weapon" ? "BUNNY" : "prfight2") : "";
  const selectedLoras = actionLora
    ? loras.filter((selected) => ![files.combat, files.weaponCombat].filter(Boolean).includes(selected.name))
    : loras;
  const directedPrompts = prompts(raw.prompt).map((prompt) => actionPreset.direction ? `${prompt} ${actionPreset.direction}` : prompt);
  const scenePrompts = withLoraTriggers(directedPrompts, selectedLoras, config.h3LoraMetadata || {}, [actionTrigger]);
  const expectedSegmentCount = number(raw.directorSegmentCount, scenePrompts.length, 1, 24, true);
  if (expectedSegmentCount !== scenePrompts.length) {
    throw new Error(`AllInOne ha ricevuto ${scenePrompts.length} segmento/i invece dei ${expectedSegmentCount} riconosciuti nell’interfaccia. Il workflow è stato bloccato per evitare un video troncato.`);
  }
  const duration = number(raw.duration, 5, 4, 15);
  const aspect = RATIOS[raw.directorAspectRatio] ? raw.directorAspectRatio : "16:9";
  const useTurbo = bool(raw.directorUseTurbo, true);
  const megapixels = useTurbo ? number(raw.directorMegapixels, 0.4, 0.2, 1) : 0.9;
  const { width, height } = dimensions(aspect, megapixels);
  const continuity = bool(raw.directorContinuity, true) && scenePrompts.length > 1;
  const overlap = [5, 22, 39, 56].includes(Number(raw.directorContinuityFrames)) ? Number(raw.directorContinuityFrames) : 22;
  const timeline = makeTimeline({ taskKey, scenePrompts, duration, width, height, megapixels, aspect, uploads, continuity, overlap });
  const chainedI2v = taskKey === "i2v"
    && (uploads.directorStartImages || []).length < scenePrompts.length;
  const seedText = String(raw.seed || "").trim();
  const seed = /^\d+$/u.test(seedText) ? Number(seedText) : crypto.randomInt(0, 2 ** 31);
  const modelName = directorPreset === "actionScene" ? files.hybridB25 : taskKey === "r2v" ? files.ref2va : files.fl2va;
  const workflow = {
    "1": node("UNETLoader", { unet_name: modelName, weight_dtype: "default" }, directorPreset === "actionScene"
      ? "AllInOne ACTION SCENE · Hybrid b25-49 INT8"
      : `AllInOne · ${taskKey.toUpperCase()} INT8`),
    "2": node("CLIPLoader", { clip_name: files.clip, type: "minimax", device: "default" }, "AllInOne · Qwen3-VL"),
    "3": node("VAELoader", { vae_name: files.videoVae }, "AllInOne · Video VAE"),
    "4": node("VAELoader", { vae_name: files.audioVae }, "AllInOne · Audio VAE"),
    "6": node("MiniMaxH3MemoryEfficientSageAttentionPatch", { model: ["1", 0] }, "AllInOne · Memory Efficient SageAttention"),
  };
  let modelLink = ["6", 0];
  let loraId = 10;
  if (useTurbo) {
    workflow[String(loraId)] = node("LoraLoaderModelOnly", { model: modelLink, lora_name: files.turbo, strength_model: 1 }, "AllInOne · Turbo 8 step");
    modelLink = [String(loraId++), 0];
  }
  if (actionLora) {
    workflow[String(loraId)] = node("LoraLoaderModelOnly", {
      model: modelLink,
      lora_name: actionLora,
      strength_model: number(raw.directorActionStrength, actionPreset.strength || 0.8, 0, 1.5),
    }, `AllInOne ACTION SCENE · ${actionLoraType === "weapon" ? "Weapon Combat BUNNY" : "Combat Base V2"}`);
    modelLink = [String(loraId++), 0];
  }
  for (const selected of selectedLoras) {
    workflow[String(loraId)] = node("LoraLoaderModelOnly", {
      model: modelLink, lora_name: selected.name, strength_model: number(selected.strength, 0.8, -2, 2),
    }, `AllInOne · ${selected.name}`);
    modelLink = [String(loraId++), 0];
  }
  const refineMode = ["off", "refine", "upscale", "latent_upscale"].includes(raw.directorRefineMode) ? raw.directorRefineMode : "off";
  let refineLink;
  if (refineMode !== "off") {
    const refineInputs = {
      mode: refineMode,
      upscale_method: "h3_latent",
      latent_upscale_model: files.latentUpscaler,
      sampler: "res_multistep",
      passes: number(raw.directorRefinePasses, 1, 1, 3, true),
      refine_model: ["6", 0],
      seed_mode: "inherit",
      aspect_ratio: "跟随导演台",
      megapixels: 1,
      width: 0,
      height: 0,
      skip_fl2v: true,
      confirm_first_pass: false,
    };
    if (["refine", "upscale"].includes(refineMode)) {
      workflow["30"] = node("BasicScheduler", { model: ["6", 0], scheduler: "simple", steps: 3, denoise: 0.15 }, "AllInOne · sigma refine conservativo");
      refineInputs.sigmas = ["30", 0];
    }
    workflow["31"] = node("MiniMaxH3DirectorRefine", refineInputs, "AllInOne · Director Refine");
    refineLink = ["31", 0];
  }
  const directorInputs = {
    model: modelLink, video_vae: ["3", 0], audio_vae: ["4", 0], clip: ["2", 0],
    task_type: timeline.global.taskType, global_prompt: "", bd_grp_sample: "Sampling",
    cfg: 1, seed, frame_rate: 24, width, height, ref_max_size: Math.max(width, height),
    total_frames: timeline.totalFrames, timeline_data: JSON.stringify(timeline), bd_grp_advanced: "Advanced",
    steps: useTurbo ? 8 : 25, sampler: "res_multistep", scheduler: "simple", shift_video: 12, shift_audio: 3,
    bd_grp_perf: "Performance", clear_vram_between_segments: true, export_source_images: false,
  };
  if (refineLink) directorInputs.refine = refineLink;
  workflow["40"] = node("MiniMaxH3Director", directorInputs, "AllInOne · MiniMax H3 Director");
  workflow["41"] = node("CreateVideo", { images: ["40", 0], audio: ["40", 1], fps: ["40", 2], bit_depth: 8 }, "AllInOne · crea video");
  workflow["42"] = node("SaveVideo", { video: ["41", 0], filename_prefix: "VideoStudio/AllInOne", format: "auto", codec: "auto" }, "AllInOne · salva video");
  workflow["43"] = node("PreviewAny", { source: ["40", 5] }, "AllInOne · rapporto Director");
  return {
    workflow,
    metadata: {
      workflowId: "videoStudio:minimaxH3AllInOne",
      workflowName: "AllInOne · MiniMax H3 Director",
      videoStudioMode: "minimaxH3AllInOne",
      videoStudioStage: "director",
      videoStudioLabel: `${directorPreset === "actionScene" ? "AllInOne ACTION SCENE" : "AllInOne"} · ${scenePrompts.length} segment${scenePrompts.length === 1 ? "o" : "i"}`,
      prompt: String(raw.prompt || "").trim(), negativePrompt: "", seed,
      duration: duration * scenePrompts.length, fps: 24, taskKey, segmentCount: scenePrompts.length,
      useTurbo, steps: useTurbo ? 8 : 25, megapixels, width, height, continuity, continuityFrames: overlap, refineMode,
      directorPreset, modelFile: modelName, actionLoraType: directorPreset === "actionScene" ? actionLoraType : null,
      actionPreset: directorPreset === "actionScene" ? actionPreset.id : null,
      actionLora: actionLora || null, actionStrength: actionLora ? number(raw.directorActionStrength, actionPreset.strength || 0.8, 0, 1.5) : null,
      samplerName: "res_multistep", schedulerName: "simple", actionTrigger: actionTrigger || null,
      startImageStrategy: chainedI2v ? "first-image-then-previous-segment" : "per-segment",
    },
  };
}
