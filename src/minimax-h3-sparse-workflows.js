import crypto from "node:crypto";

const ASPECTS = Object.freeze({
  "16:9 (Widescreen)": [16, 9],
  "9:16 (Portrait Widescreen)": [9, 16],
  "1:1 (Square)": [1, 1],
  "4:3 (Standard)": [4, 3],
  "3:4 (Portrait Standard)": [3, 4],
  "3:2 (Photo)": [3, 2],
  "2:3 (Portrait Photo)": [2, 3],
});

const DIRECTOR_TASKS = Object.freeze({
  text: "t2v — 文生视频(Text to Video)",
  image: "i2v — 图生视频(Image to Video)",
  references: "r2v — 参考主体生视频(Reference to Video)",
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
    throw new Error("Impostazione PlagueKind H3 Sparse V9 non valida.");
  }
  return parsed;
}

function seedValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : crypto.randomInt(0, 2 ** 31);
}

function inputPath(upload) {
  if (!upload?.name) return "";
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function framesForDuration(value) {
  const duration = number(value, 8, 4, 15);
  const frames = Math.max(5, Math.round(duration * 24));
  return frames + ((5 - (frames % 17)) % 17);
}

function dimensions(aspectRatio, megapixels) {
  const [rw, rh] = ASPECTS[aspectRatio] || ASPECTS["4:3 (Standard)"];
  const pixels = number(megapixels, 0.98, 0.2, 2) * 1_000_000;
  const width = Math.max(32, Math.floor(Math.sqrt(pixels * rw / rh) / 32) * 32);
  const height = Math.max(32, Math.floor(Math.sqrt(pixels * rh / rw) / 32) * 32);
  return { width, height };
}

function requireUpload(upload, message) {
  if (!upload?.name) throw new Error(message);
  return upload;
}

function loadImage(workflow, id, upload, title) {
  workflow[id] = node("LoadImage", { image: inputPath(upload) }, title);
  return [id, 0];
}

function loadReferenceVideo(workflow, id, upload, title) {
  workflow[id] = node("LoadVideo", { file: inputPath(upload) }, title);
  workflow[`${id}1`] = node("GetVideoComponents", { video: [id, 0] }, `${title} · frames e audio originali`);
  return { frames: [`${id}1`, 0], audio: [`${id}1`, 1] };
}

function loadReferenceAudio(workflow, id, upload, title) {
  workflow[id] = node("LoadAudio", { audio: inputPath(upload) }, title);
  return [id, 0];
}

function loraStack(files, loras) {
  return JSON.stringify([
    { on: true, lora: files.parasyteTurbo, str: 1.5, v: 1, a: 1, t: 1 },
    { on: false, lora: files.fast6Turbo, str: 0.5, v: 1, a: 1, t: 1 },
    ...loras.map((entry) => ({
      on: true,
      lora: entry.name,
      str: number(entry.strength, 0.8, -2, 5),
      v: 1,
      a: 1,
      t: 1,
    })),
  ]);
}

function modelCompatibility(modelName) {
  const name = String(modelName || "").toLowerCase();
  if (name.includes("hybrid")) return { text: true, image: true, firstLast: true, references: true };
  if (name.includes("eros")) return { text: true, image: true, firstLast: false, references: true };
  if (name.includes("ref2va") && !name.includes("fl2va")) return { text: false, image: false, firstLast: false, references: true };
  if (name.includes("fl2va") || name.includes("pinkcherry")) return { text: true, image: true, firstLast: true, references: false };
  return { text: true, image: true, firstLast: true, references: true };
}

function sequencePrompts(value) {
  return String(value || "")
    .split(/^\s*---+\s*$/mu)
    .map((item) => item.trim())
    .filter(Boolean);
}

function imageRef(upload, index = 0) {
  const file = inputPath(upload);
  return file ? {
    index, imageFile: file, fileName: upload.name || "", type: "input", subfolder: upload.subfolder || "",
  } : null;
}

function mediaRef(upload, index, kind) {
  const file = inputPath(upload);
  if (!file) return null;
  return kind === "audio"
    ? { index, audioFile: file, fileName: upload.name || "", type: "input", subfolder: upload.subfolder || "" }
    : { index, videoFile: file, fileName: upload.name || "", type: "input", subfolder: upload.subfolder || "", pairedAudioFile: "", linked: true };
}

function sparseSequenceTimeline({ mode, prompts, duration, width, height, megapixels, aspectRatio, uploads, overlap }) {
  const frameCount = framesForDuration(duration);
  const firstImage = mode === "image"
    ? imageRef(requireUpload(uploads.h3FirstFrame, "Carica il frame iniziale della prima sequenza."))
    : null;
  const refs = mode === "references"
    ? (uploads.h3ReferenceImages || []).map((item, index) => imageRef(item, index)).filter(Boolean)
    : [];
  const refVideos = mode === "references"
    ? (uploads.h3ReferenceVideos || []).map((item, index) => mediaRef(item, index, "video")).filter(Boolean)
    : [];
  const refAudios = mode === "references"
    ? (uploads.h3ReferenceAudios || []).map((item, index) => mediaRef(item, index, "audio")).filter(Boolean)
    : [];
  if (mode === "references" && !refs.length && !refVideos.length && !refAudios.length) {
    throw new Error("Carica almeno una reference immagine, video o audio.");
  }
  const segments = prompts.map((prompt, index) => ({
    id: `plaguekind_${index + 1}`,
    start: index * frameCount,
    length: frameCount,
    frameCount,
    durationSec: duration,
    prompt,
    negativePrompt: "",
    taskType: mode === "image" ? (index === 0 ? DIRECTOR_TASKS.image : DIRECTOR_TASKS.text) : "",
    refs: mode === "references" ? refs : [],
    refVideos: mode === "references" ? refVideos : [],
    refAudios: mode === "references" ? refAudios : [],
    genImage: index === 0 && firstImage
      ? { imageFile: firstImage.imageFile, fileName: firstImage.fileName }
      : { imageFile: "" },
    startImage: index === 0 ? firstImage : null,
    endImage: null,
    continuityFromPrev: index > 0,
    refImageSize: "match",
  }));
  return {
    version: 5,
    // PlagueKind can release the 32B Qwen encoder as soon as each segment has
    // produced its conditioning. The Director reloads it only when the next
    // segment needs to be encoded.
    preconditionAllSegments: true,
    unloadClipAfterConditioning: true,
    // The installed Director uses this flag to decide whether the inter-segment
    // cleanup only empties CUDA cache or also unloads H3 and releases its
    // dynamic pinned-RAM registrations. PlagueKind always chooses the latter:
    // the continuity handoff is already copied to CPU before cleanup.
    keepModelWarmBetweenSegments: false,
    editMode: "segment",
    timelineMode: "prompt_batch",
    totalFrames: frameCount * segments.length,
    frameRate: 24,
    width,
    height,
    refMaxSize: Math.max(width, height),
    video: { fileName: "", videoFile: "", subfolder: "", type: "input", frames: [], frameMap: [], sourceFrameCount: 0, deletedSourceRanges: [] },
    videoClips: [],
    global: {
      taskType: mode === "image" ? DIRECTOR_TASKS.text : DIRECTOR_TASKS[mode],
      prompt: "",
      refs: mode === "references" ? refs : [],
      refVideos: mode === "references" ? refVideos : [],
      refAudios: mode === "references" ? refAudios : [],
      referenceVideo: { videoFile: "", fileName: "", type: "input", subfolder: "" },
      continuousReference: false,
      genImage: { imageFile: "" },
      commonEnabled: mode === "references",
      commonCollapsed: false,
    },
    output: {
      mode: "fixed", aspectRatio, megapixels, multiple: 32, longEdge: Math.max(width, height), width, height,
      maxExportFrames: 0, exportMode: "all", audioMode: "generate", exportSourceImages: false,
      refImageSize: "match", continuityEnabled: true, continuityOverlapFrames: overlap,
    },
    runSelectEnabled: false,
    runSelection: [],
    segments,
    gen: { defaultFrameCount: frameCount },
    durationSec: duration * segments.length,
    liveTaePreview: false,
    batchDetailMode: "solo",
  };
}

export function buildMiniMaxH3SparseV9Workflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const sparse = config?.h3?.sparseV9;
  if (!sparse?.available) throw new Error(sparse?.reason || "PlagueKind H3 Sparse V9 non è disponibile.");
  const files = sparse.files || {};
  const mode = String(raw.h3SparseMode || "image");
  if (!["text", "image", "firstLast", "references"].includes(mode)) throw new Error("Modalità H3 Sparse V9 non valida.");
  const availableModels = Array.isArray(sparse.modelOptions) && sparse.modelOptions.length
    ? sparse.modelOptions
    : [files.hybrid].filter(Boolean);
  const modelFile = String(raw.h3SparseModel || files.hybrid || "");
  if (!availableModels.includes(modelFile)) {
    throw new Error("Il modello MiniMax H3 richiesto per PlagueKind non è installato.");
  }
  if (!modelCompatibility(modelFile)[mode]) {
    throw new Error(`Il modello ${modelFile} non supporta la modalità ${mode} nel workflow PlagueKind.`);
  }
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Inserisci il prompt per PlagueKind H3 Sparse V9.");
  const multiSequence = bool(raw.h3SparseMultiSequence, false);
  const prompts = sequencePrompts(prompt);
  if (multiSequence && mode === "firstLast") {
    throw new Error("Le sequenze continuative PlagueKind supportano Text, Single Image e Reference. First / Last Frame resta disponibile per una singola sequenza.");
  }
  if (multiSequence && (prompts.length < 2 || prompts.length > 8)) {
    throw new Error("PlagueKind continuativo richiede da 2 a 8 prompt separati da --- su una riga.");
  }
  const expectedSegmentCount = number(raw.h3SparseSegmentCount, prompts.length, 1, 8, true);
  if (multiSequence && expectedSegmentCount !== prompts.length) {
    throw new Error(`PlagueKind ha ricevuto ${prompts.length} sequenze invece delle ${expectedSegmentCount} riconosciute nell’interfaccia. Invio bloccato per evitare un video troncato.`);
  }
  const aspectRatio = String(raw.h3SparseAspectRatio || "4:3 (Standard)");
  const megapixels = number(raw.h3SparseMegapixels, 0.98, 0.2, 2);
  const { width, height } = dimensions(aspectRatio, megapixels);
  const { width: upscaleWidth, height: upscaleHeight } = dimensions(aspectRatio, 1);
  const duration = number(raw.duration, 8, 4, 15);
  const length = framesForDuration(duration);
  const seed = seedValue(raw.seed);
  const cacheEnabled = bool(raw.h3SparseCache, false);
  // This installation targets a 12 GB GPU. Keep both memory-saving patches on
  // for every PlagueKind mode, including requests restored from older drafts.
  const lowVramEnabled = true;
  const latentUpscale = bool(raw.h3SparseLatentUpscale, false);
  if (multiSequence && latentUpscale) {
    throw new Error("Il latent upscale MMH3 lavora sul latent di una singola clip: disattivalo per le sequenze continuative. FILM, RTX VSR e RCAS saranno disponibili dal pulsante di miglioramento sul video completato.");
  }
  const temporalChunks = bool(raw.h3SparseTemporalChunks, true);
  const spatialTiling = bool(raw.h3SparseSpatialTiling, true);
  // FILM, RTX and RCAS run only as a separate, user-triggered finishing job.
  // The expensive H3 generation can therefore be judged before post-processing.
  const film = false;
  const rtx = false;
  const sharpen = false;
  const sparsity = number(raw.h3SparseSparsity, 0.7, 0, 0.95);
  const steps = number(raw.h3SparseSteps, 8, 1, 50, true);
  const workflow = {
    "1": node("UNETLoader", { unet_name: modelFile, weight_dtype: "default" }, `PlagueKind V9 · ${modelFile}`),
    "2": node("VAELoader", { vae_name: files.videoVae }, "PlagueKind V9 · MiniMax H3 Video VAE INT8"),
    "3": node("VAELoader", { vae_name: files.audioVae }, "PlagueKind V9 · MiniMax H3 Audio VAE FP32"),
    "4": node("CLIPLoader", { clip_name: files.clip, type: "minimax", device: "default" }, "PlagueKind V9 · Qwen3-VL 32B INT8"),
    "5": node("H3SLAAttention", {
      model: ["1", 0], sparsity_ratio: sparsity, block_size: "32", min_seq_len: 12288,
      dense_last_steps: 0, protect_audio: false, enabled: true, dense_steps: "1",
      dense_backend: "comfy_kitchen", disable_fp16_accum: true, stabilize_motion: false,
      reference_protection: "Off", tail_correction: false, use_int8_qk: true, engine: "comfy_kitchen",
    }, "PlagueKind V9 · SLA Sparse Attention · sparsità originale 0,70"),
  };
  let modelLink = ["5", 0];
  if (cacheEnabled) {
    workflow["6"] = node("H3MiniMaxCache", {
      model: modelLink, reuse_threshold: 0.11, start_percent: 0.05,
      end_percent: 0.8, max_steps: 1, device: "auto", verbose: false,
    }, "PlagueKind V9 · H3 Cache originale");
    modelLink = ["6", 0];
  }
  if (lowVramEnabled) {
    workflow["7"] = node("MiniMaxLowVRAMAttention", { model: modelLink, head_chunks: 4 }, "PlagueKind V9 · Low VRAM Attention");
    workflow["8"] = node("MiniMaxChunkFeedForward", { model: ["7", 0], chunks: 2, seq_threshold: 4096 }, "PlagueKind V9 · Chunk Feed Forward");
    modelLink = ["8", 0];
  }
  workflow["9"] = node("LTX_lora_loader", {
    model: modelLink, mode: "minimax", stack_data: loraStack(files, loras),
  }, "PlagueKind V9 · stack LoRA originale · Parasyte 1,5 / Fast6 bypass");
  workflow["10"] = node("ModelPreviewOverrideKJ", {
    model: ["9", 0], max_resolution: 512, jpeg_quality: 80,
    suppress_default_preview: true, preview_frames: 1, preview_fps: 8,
    tiny_vae: "taeh3.safetensors",
  }, "PlagueKind V9 · anteprima TAE H3");
  // `port` scans dense H3 checkpoints to reconstruct the AdaLN basis. On the
  // Windows/PyTorch build used by this studio, safetensors can terminate the
  // whole ComfyUI process with an access violation during that scan. The node
  // author documents that the restored AdaLN contribution is only ~0.02% and
  // that `strip` produces the same visible output while safely removing the
  // incompatible patches, so use the stable mode for production generations.
  workflow["11"] = node("H3AdaLNLoRAFix", { model: ["10", 0], mode: "strip" }, "PlagueKind V9 · AdaLN LoRA Fix · Windows safe");
  workflow["12"] = node("MiniMaxH3SigmaShift", { model: ["11", 0], shift_video: 12, shift_audio: 3 }, "PlagueKind V9 · shift video 12 / audio 3");

  if (multiSequence) {
    const overlap = [5, 22, 39, 56].includes(Number(raw.h3SparseContinuityFrames))
      ? Number(raw.h3SparseContinuityFrames)
      : 22;
    const timeline = sparseSequenceTimeline({
      mode, prompts, duration, width, height, megapixels, aspectRatio, uploads, overlap,
    });
    workflow["20"] = node("MiniMaxH3Director", {
      // Director applies MiniMaxH3SigmaShift internally. Feed the unshifted
      // AdaLN-fixed model so the multi-sequence path receives the shift once.
      model: ["11", 0], video_vae: ["2", 0], audio_vae: ["3", 0], clip: ["4", 0],
      task_type: timeline.global.taskType, global_prompt: "", bd_grp_sample: "Sampling",
      cfg: 1, seed, frame_rate: 24, width, height, ref_max_size: Math.max(width, height),
      total_frames: timeline.totalFrames, timeline_data: JSON.stringify(timeline), bd_grp_advanced: "Advanced",
      steps, sampler: "er_sde", scheduler: "beta57", shift_video: 12, shift_audio: 3,
      bd_grp_perf: "Performance", clear_vram_between_segments: true, export_source_images: false,
    }, "PlagueKind V9 · Director · sequenze continuative");
    workflow["59"] = node("DisTorchPurgeVRAMV2", {
      anything: ["20", 0], purge_cache: true, purge_models: true,
      purge_seedvr2_models: false, purge_qwen3vl_models: true,
      purge_nunchaku_models: false, HSWQ: false, Ollama: false,
    }, "PlagueKind V9 · purge H3 prima della finitura");
    let images = ["59", 0];
    let fps = ["20", 2];
    if (film) {
      workflow["52"] = node("FrameInterpolationModelLoader", { model_name: files.film }, "PlagueKind V9 · FILM FP16");
      workflow["53"] = node("FrameInterpolate", { interp_model: ["52", 0], images, multiplier: 2 }, "PlagueKind V9 · FILM ×2");
      images = ["53", 0];
      fps = 48;
    }
    if (rtx) {
      workflow["54"] = node("RTXVideoSuperResolution", {
        images, resize_type: "scale by multiplier", "resize_type.scale": 1.5, quality: "HIGH",
      }, "PlagueKind V9 · RTX VSR ×1,5 HIGH");
      images = ["54", 0];
    }
    if (sharpen) {
      workflow["55"] = node("RemoteChunkedRCAS", { image: images, strength: 0.3, chunk_size: 2 }, "PlagueKind V9 · FSR RCAS 0,3 · memory safe");
      images = ["55", 0];
    }
    workflow["56"] = node("CreateVideo", { images, audio: ["20", 1], fps, bit_depth: 8, color_space: "sRGB" }, "PlagueKind V9 · master continuativo");
    workflow["57"] = node("SaveVideo", {
      video: ["56", 0], filename_prefix: "VideoStudio/PlagueKindH3SparseV9_Continuous", format: "auto",
      codec: "h264", "codec.encoding": "re-encode", "codec.encoding.crf": 10,
    }, "PlagueKind V9 · salva sequenze continuative");
    workflow["58"] = node("PreviewAny", { source: ["20", 5] }, "PlagueKind V9 · rapporto continuità Director");
    return {
      workflow,
      metadata: {
        workflowId: "videoStudio:h3SparseV9",
        workflowName: "Video Studio · PlagueKind H3 Sparse V9 · Sequenze continuative",
        videoStudioMode: "h3SparseV9",
        videoStudioStage: "generation",
        videoStudioLabel: `H3 Sparse V9 · ${prompts.length} sequenze continuative · ${width}×${height}`,
        modelFile,
        prompt, mode, duration: duration * prompts.length, segmentDuration: duration,
        segmentCount: prompts.length, frames: timeline.totalFrames, fps: 24, seed, width, height, aspectRatio, megapixels,
        multiSequence: true, continuity: true, continuityFrames: overlap,
        startImageStrategy: mode === "image" ? "first-image-then-previous-segment" : mode === "references" ? "shared-references-and-previous-segment" : "previous-segment",
        sparse: { engine: "comfy_kitchen", sparsity, blockSize: 32, denseSteps: "1", protectAudio: false, stabilizeMotion: false, int8Qk: true },
        adalnMode: "strip", cacheEnabled, lowVramEnabled, steps, sampler: "er_sde", scheduler: "beta57",
        stages: { latentUpscale: false, upscaleWidth, upscaleHeight, temporalChunks: false, spatialTiling: false, film, rtx, sharpen },
        loras: [{ name: files.parasyteTurbo, strength: 1.5, automatic: true }, ...loras],
      },
    };
  }

  let conditioningLink;
  let latentLink;
  if (mode === "references") {
    const images = uploads.h3ReferenceImages || [];
    const videos = uploads.h3ReferenceVideos || [];
    const audios = uploads.h3ReferenceAudios || [];
    if (!images.length && !videos.length && !audios.length) throw new Error("Carica almeno una reference immagine, video o audio.");
    const inputs = {
      clip: ["4", 0], vae: ["2", 0], audio_vae: ["3", 0], prompt,
      width, height, length, ref_image_size: String(raw.h3SparseReferenceSize || "match"),
    };
    images.forEach((upload, index) => { inputs[`ref_images.ref_image_${index}`] = loadImage(workflow, String(100 + index), upload, `PlagueKind V9 · Picture ${index + 1}`); });
    videos.forEach((upload, index) => {
      const loaded = loadReferenceVideo(workflow, String(120 + index), upload, `PlagueKind V9 · Video ${index + 1}`);
      inputs[`ref_videos.ref_video_${index}`] = loaded.frames;
      inputs[`ref_video_audios.ref_video_audio_${index}`] = loaded.audio;
    });
    audios.forEach((upload, index) => { inputs[`ref_audios.ref_audio_${index}`] = loadReferenceAudio(workflow, String(140 + index), upload, `PlagueKind V9 · Audio ${index + 1}`); });
    workflow["20"] = node("MiniMaxH3ReferenceToVideo", inputs, "PlagueKind V9 · Reference to Video");
    conditioningLink = ["20", 0];
    latentLink = ["20", 1];
  } else {
    const inputs = { clip: ["4", 0], vae: ["2", 0], prompt, width, height, length };
    if (mode === "image" || mode === "firstLast") inputs.first_frame = loadImage(workflow, "21", requireUpload(uploads.h3FirstFrame, "Carica il primo frame."), "PlagueKind V9 · primo frame");
    if (mode === "firstLast") inputs.last_frame = loadImage(workflow, "22", requireUpload(uploads.h3LastFrame, "Carica l’ultimo frame."), "PlagueKind V9 · ultimo frame");
    workflow["20"] = node("MiniMaxH3ImageToVideo", inputs, `PlagueKind V9 · ${mode === "text" ? "Text to Video" : mode === "image" ? "Image to Video" : "First / Last Frame"}`);
    conditioningLink = ["20", 0];
    latentLink = ["20", 1];
  }

  // The conditioning is self-contained. Passing it through this node gives
  // ComfyUI an explicit dependency boundary at which the large Qwen encoder
  // can be unloaded before sampling begins, without touching H3 or the VAEs.
  workflow["23"] = node("RemoteUnloadCLIP", {
    conditioning: conditioningLink,
    clip: ["4", 0],
  }, "PlagueKind V9 · scarica Qwen dopo conditioning");
  conditioningLink = ["23", 0];

  workflow["30"] = node("RandomNoise", { noise_seed: seed }, "PlagueKind V9 · seed fisso/ripetibile");
  workflow["31"] = node("BasicGuider", { model: ["12", 0], conditioning: conditioningLink }, "PlagueKind V9 · Basic Guider");
  workflow["32"] = node("SamplerER_SDE", {
    solver_type: "ODE", max_stage: 3, eta: 0, s_noise: 1,
  }, "PlagueKind V9 · ER-SDE · ODE originale");
  workflow["33"] = node("BasicScheduler", { model: ["12", 0], scheduler: "beta57", steps, denoise: 1 }, "PlagueKind V9 · beta57 · 8 step originali");
  workflow["34"] = node("SamplerCustomAdvanced", { noise: ["30", 0], guider: ["31", 0], sampler: ["32", 0], sigmas: ["33", 0], latent_image: latentLink }, "PlagueKind V9 · sampling principale");

  let outputLatent = ["34", 0];
  if (latentUpscale) {
    workflow["40"] = node("ManualSigmas", { sigmas: "0.4824, 0.2412, 0.0" }, "PlagueKind V9 · sigmas latent upscale originali");
    workflow["41"] = node("MMH3LatentUpscaleWithModelParams", {
      model_name: files.latentUpscaler, width: upscaleWidth, height: upscaleHeight, device: "cuda", precision: "bf16",
    }, "PlagueKind V9 · latent upscaler 3D BF16");
    if (temporalChunks) workflow["42"] = node("MMH3TemporalSplitParams", { chunk_length: 102, temporal_overlap: 17, anchor_strength: 0.999 }, "PlagueKind V9 · temporal chunks");
    if (spatialTiling) workflow["43"] = node("MMH3SpatialSplitParams", {
      upscale_width: 2560, upscale_height: 1920, tile_size_mode: "auto", tile_width: 736, tile_height: 736,
      grid_rows: 3, grid_cols: 1, spatial_w_overlap: 128, spatial_h_overlap: 128,
      fade_width: 32, fade_height: 32, min_tile_size: 256, overlap_mode: "earlier",
      overlap_blend: "linear", joint_steps: true, token_budget: 70000,
    }, "PlagueKind V9 · spatial tiling originale");
    const upscaleInputs = {
      model: ["12", 0], conditioning: conditioningLink, latent: ["34", 0], noise: ["30", 0],
      sampler: ["32", 0], sigmas: ["40", 0], cfg: 1, latent_upscale_param: ["41", 0],
    };
    if (temporalChunks) upscaleInputs.temporal_split_param = ["42", 0];
    if (spatialTiling) upscaleInputs.spatial_split_param = ["43", 0];
    workflow["44"] = node("MMH3UltimateUpscale", upscaleInputs, "PlagueKind V9 · MMH3 Ultimate Upscale");
    outputLatent = ["44", 0];
  }

  workflow["50"] = node("VAEDecode", { samples: outputLatent, vae: ["2", 0] }, "PlagueKind V9 · decode video");
  workflow["51"] = node("VAEDecodeAudio", { samples: outputLatent, vae: ["3", 0] }, "PlagueKind V9 · decode audio");
  let images = ["50", 0];
  let fps = 24;
  if (film) {
    workflow["52"] = node("FrameInterpolationModelLoader", { model_name: files.film }, "PlagueKind V9 · FILM FP16");
    workflow["53"] = node("FrameInterpolate", { interp_model: ["52", 0], images, multiplier: 2 }, "PlagueKind V9 · FILM ×2");
    images = ["53", 0];
    fps = 48;
  }
  if (rtx) {
    workflow["54"] = node("RTXVideoSuperResolution", {
      images, resize_type: "scale by multiplier", "resize_type.scale": 1.5, quality: "HIGH",
    }, "PlagueKind V9 · RTX VSR ×1,5 HIGH");
    images = ["54", 0];
  }
  if (sharpen) {
    workflow["55"] = node("RemoteChunkedRCAS", { image: images, strength: 0.3, chunk_size: 2 }, "PlagueKind V9 · FSR RCAS 0,3 · memory safe");
    images = ["55", 0];
  }
  workflow["56"] = node("CreateVideo", { images, audio: ["51", 0], fps, bit_depth: 8, color_space: "sRGB" }, "PlagueKind V9 · video e audio nativi");
  workflow["57"] = node("SaveVideo", {
    video: ["56", 0], filename_prefix: "VideoStudio/PlagueKindH3SparseV9", format: "auto",
    codec: "h264", "codec.encoding": "re-encode", "codec.encoding.crf": 10,
  }, "PlagueKind V9 · H.264 CRF 10");

  return {
    workflow,
    metadata: {
      workflowId: "videoStudio:h3SparseV9",
      workflowName: "Video Studio · PlagueKind H3 Sparse V9",
      videoStudioMode: "h3SparseV9",
      videoStudioStage: "generation",
      videoStudioLabel: `H3 Sparse V9 · ${mode} · ${width}×${height}`,
      modelFile,
      prompt, mode, duration, frames: length, fps, seed, width, height, aspectRatio, megapixels,
      sparse: {
          engine: "comfy_kitchen", sparsity, blockSize: 32, denseSteps: "1",
          protectAudio: false, stabilizeMotion: false, int8Qk: true,
      },
      adalnMode: "strip",
      cacheEnabled, lowVramEnabled, steps, sampler: "er_sde (ODE, eta 0)", scheduler: "beta57",
      stages: { latentUpscale, upscaleWidth, upscaleHeight, temporalChunks: latentUpscale && temporalChunks, spatialTiling: latentUpscale && spatialTiling, film, rtx, sharpen },
      loras: [{ name: files.parasyteTurbo, strength: 1.5, automatic: true }, ...loras],
    },
  };
}
