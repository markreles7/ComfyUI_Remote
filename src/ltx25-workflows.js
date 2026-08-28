import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDynamicInputs } from "./workflow-normalization.js";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "workflows");

const TEMPLATE_BY_MODE = Object.freeze({
  text: "LTX25-SINGLE-API.json",
  multishot: "LTX25-SINGLE-API.json",
  image: "LTX25-SINGLE-API.json",
  firstLast: "LTX25-SINGLE-API.json",
  keyframes: "LTX25-SINGLE-API.json",
  audio: "LTX-2-5-A2V-Two-Stage-Distilled-API.json",
  textAudio: "LTX-2-5-T2A-Single-Stage-Distilled-API.json",
  referenceSheet: "LTX-2-5-ICLoRA-Ingredients-Single-Stage-Distilled-API.json",
  unionControl: "LTX-2-5-ICLoRA-Union-Control-Distilled-API.json",
  inpaint: "LTX-2-5-ICLoRA-Inpaint-Two-Stage-Distilled-API.json",
  outpaint: "LTX-2-5-ICLoRA-Outpaint-Two-Stage-Distilled-API.json",
  motionTrack: "LTX-2-5-ICLoRA-Motion-Track-Distilled-API.json",
  v2vDeblur: "LTX-2-5-V2V-ICLoRA-Single-Stage-Distilled-API.json",
  h3Ltx2k: "LTX-2-5-V2V-ICLoRA-Single-Stage-Distilled-API.json",
  multiReferenceMsr: "LTX25-SINGLE-API.json",
});

const TWO_STAGE_TEMPLATE = "LTX-2-5-T2V-I2V-Two-Stage-Distilled-API.json";
const BASIC_MODES = new Set(["text", "multishot", "image", "firstLast", "keyframes", "multiReferenceMsr"]);
const IMAGE_MODES = new Set(["image", "firstLast", "keyframes", "referenceSheet", "motionTrack"]);
const VIDEO_MODES = new Set(["unionControl", "inpaint", "outpaint", "v2vDeblur", "h3Ltx2k"]);

const MODE_LABELS = Object.freeze({
  text: "Text to Video",
  multishot: "Native Multishot",
  image: "Image to Video",
  firstLast: "First / Last Frame",
  keyframes: "Keyframe multipli",
  audio: "Audio to Video",
  textAudio: "Text to Audio",
  referenceSheet: "Ingredients Reference Sheet",
  unionControl: "Video to Video · Union Control",
  inpaint: "Video Inpainting",
  outpaint: "Video Outpainting",
  motionTrack: "Motion Track",
  v2vDeblur: "Video to Video · Deblur",
  h3Ltx2k: "MiniMax H3 → LTX 2.5 IC 2K",
  multiReferenceMsr: "Multi-Reference MSR",
});

function cloneTemplate(file) {
  return JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || ["true", "1", "on"].includes(String(value).toLowerCase());
}

function numberValue(value, fallback, min, max, integer = false, label = "Valore") {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} LTX 2.5 non valido.`);
  }
  return parsed;
}

function seedValue(value) {
  const candidate = Array.isArray(value)
    ? [...value].reverse().find((item) => item != null && String(item).trim() !== "") ?? ""
    : value;
  const normalized = candidate == null ? "" : String(candidate).trim();
  if (!normalized || ["null", "undefined", "random", "casuale"].includes(normalized.toLowerCase())) {
    return Math.floor(Math.random() * 2_147_483_647);
  }
  return numberValue(normalized, 0, 0, Number.MAX_SAFE_INTEGER, true, "Seed");
}

function inputPath(upload) {
  if (!upload?.name) return "";
  return upload.subfolder ? `${upload.subfolder}/${upload.name}` : upload.name;
}

function replaceLinks(workflow, source, replacement, skipIds = new Set()) {
  for (const [id, node] of Object.entries(workflow)) {
    if (skipIds.has(id)) continue;
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (Array.isArray(value) && String(value[0]) === String(source[0]) && Number(value[1]) === Number(source[1])) {
        node.inputs[key] = [...replacement];
      }
    }
  }
}

function nextNodeId(workflow, prefix = "ltx25") {
  let index = 1;
  while (workflow[`${prefix}_${index}`]) index += 1;
  return `${prefix}_${index}`;
}

function passthroughPurge(workflow, source, title, { models = true } = {}) {
  const id = nextNodeId(workflow, "ltx25_purge");
  workflow[id] = {
    inputs: {
      anything: source,
      purge_cache: true,
      purge_models: models,
      purge_seedvr2_models: false,
      purge_qwen3vl_models: false,
      purge_nunchaku_models: false,
      HSWQ: false,
      Ollama: false,
    },
    class_type: "DisTorchPurgeVRAMV2",
    _meta: { title },
  };
  replaceLinks(workflow, source, [id, 0], new Set([id]));
  return [id, 0];
}

function addFinalPurge(workflow) {
  const save = Object.entries(workflow).find(([, node]) => ["SaveVideo", "SaveAudioAdvanced"].includes(node.class_type));
  if (!save) return;
  const id = nextNodeId(workflow, "ltx25_final_purge");
  workflow[id] = {
    inputs: { anything: [save[0], 0], purge_cache: true, purge_models: true },
    class_type: "LayerUtility: PurgeVRAM",
    _meta: { title: "LTX 2.5 · Purge finale dopo salvataggio" },
  };
}

function modelLink(workflow) {
  const entry = Object.entries(workflow).find(([, node]) => node.class_type === "UNETLoader");
  return entry ? [entry[0], 0] : null;
}

function applyStyleLoras(workflow, loras = []) {
  let link = modelLink(workflow);
  if (!link) return;
  for (const lora of loras) {
    const id = nextNodeId(workflow, "ltx25_style_lora");
    workflow[id] = {
      inputs: { model: link, lora_name: lora.name, strength_model: Number(lora.strength) },
      class_type: "LoraLoaderModelOnly",
      _meta: { title: `LTX 2.5 · ${path.win32.basename(lora.name)}` },
    };
    link = [id, 0];
  }
  const adapterLoaders = Object.entries(workflow).filter(([, node]) =>
    ["LTXICLoRALoaderModelOnly", "ComfyUILTX25MSRICLoRALoader"].includes(node.class_type)
    && node.inputs?.model
  );
  for (const [, node] of adapterLoaders) node.inputs.model = link;
  if (!adapterLoaders.length) {
    for (const node of Object.values(workflow)) {
      if (["CFGGuider", "BasicGuider"].includes(node.class_type) && node.inputs?.model) node.inputs.model = link;
    }
  }
}

function resolutionFor(profile, aspect) {
  const landscape = {
    preview: [512, 288],
    balanced: [768, 448],
    final: [512, 288],
    maximum: [640, 352],
  }[profile] || [512, 288];
  const ratio = String(aspect || "16:9");
  if (ratio === "9:16") return [landscape[1], landscape[0]];
  if (ratio === "1:1") return profile === "preview" ? [384, 384] : profile === "balanced" ? [576, 576] : [448, 448];
  if (ratio === "4:3") return profile === "preview" ? [448, 352] : [640, 480];
  if (ratio === "3:4") return profile === "preview" ? [352, 448] : [480, 640];
  return landscape;
}

function frameCount(duration, fps) {
  return 1 + Math.floor((duration * fps) / 8) * 8;
}

const LTX25_NEGATIVE_FALLBACK = [
  "identity drift", "face morphing", "temporal flicker", "deformed anatomy",
  "duplicated limbs", "changing outfit", "collage", "triptych", "split screen",
  "contact sheet", "static pose", "frozen frame", "subtitles", "text", "watermark",
].join(", ");

const NON_VISUAL_NEGATIVE = /\b(?:buffer|memory leak|deadlock|thread|cache miss|branch misprediction|pipeline stall|instruction fetch|data hazard|control hazard|segmentation fault|null pointer|stack overflow|heap corruption|socket|dns|ssl|http|database|query timeout|api rate|cdn|load balancer|firewall|proxy|cookie|json|xml|csv|yaml|sql|xss|csrf|cors|websocket|mqtt|kafka|redis|mongodb|postgres|oracle|mysql|react|vue|angular|svelte|webpack|typescript|javascript|plugin crash|driver crash)\b/i;

function cleanLtx25NegativePrompt(value) {
  const source = String(value || LTX25_NEGATIVE_FALLBACK);
  const parts = source
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter((part) => part && part.length <= 80 && !NON_VISUAL_NEGATIVE.test(part));
  const unique = [];
  const seen = new Set();
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    const next = [...unique, part].join(", ");
    if (unique.length >= 48 || next.length > 900) break;
    seen.add(key);
    unique.push(part);
  }
  return unique.length ? unique.join(", ") : LTX25_NEGATIVE_FALLBACK;
}

function ingredientsPrompt(prompt) {
  return [
    "REFERENCE SHEET RULES: The uploaded sheet contains multiple views of the same Subject 1.",
    "The left, center and right panels are identity, hairstyle, glasses, body and wardrobe references only.",
    "Do not reproduce the reference sheet, its panels, borders, collage, triptych or split-screen layout in the output.",
    "Generate one single full-frame continuous moving shot. Subject 1 must leave the reference poses and perform the requested physical action with visible body displacement, natural limb motion, breathing, hair and fabric movement, while preserving identity.",
    prompt,
  ].join(" ");
}

function configureModels(workflow, config, decoder) {
  for (const node of Object.values(workflow)) {
    if (node.class_type === "UNETLoader") {
      node.inputs.unet_name = config.files.ltx25Transformer;
      node.inputs.weight_dtype = "default";
    }
    if (node.class_type === "CLIPLoader") {
      node.inputs.clip_name = config.files.ltx25TextEncoder;
      node.inputs.type = "ltxv";
      node.inputs.device = "cpu";
    }
    if (node.class_type === "VAELoader") {
      const current = String(node.inputs.vae_name || "").toLowerCase();
      node.inputs.vae_name = current.includes("audio")
        ? config.files.ltx25AudioVae
        : decoder === "diffusion" ? config.files.ltx25VideoVae : config.files.ltx25VideoVaeConv;
    }
    if (node.class_type === "LatentUpscaleModelLoader") node.inputs.model_name = config.files.ltx25SpatialUpscaler;
    if (node.class_type === "GemmaAPITextEncode" && node.inputs.ckpt_name) {
      node.inputs.ckpt_name = config.files.ltx25Transformer;
    }
  }
}

function configureCommon(workflow, { prompt, negativePrompt, seed, fps, duration, prefix }) {
  const promptNodes = Object.values(workflow).filter((node) => node.class_type === "PrimitiveStringMultiline");
  for (const node of promptNodes) {
    const title = String(node._meta?.title || "").toLowerCase();
    node.inputs.value = title.includes("negative") ? negativePrompt : prompt;
  }
  for (const node of Object.values(workflow)) {
    if (node.class_type === "CLIPTextEncode") {
      const linkedText = node.inputs.text;
      if (Array.isArray(linkedText)) {
        const source = workflow[String(linkedText[0])];
        const title = String(source?._meta?.title || node._meta?.title || "").toLowerCase();
        node.inputs.text = title.includes("negative") ? negativePrompt : prompt;
      }
    }
    if (node.class_type === "RandomNoise") node.inputs.noise_seed = seed;
    if (node.class_type === "SaveVideo") node.inputs.filename_prefix = prefix;
    if (node.class_type === "PrimitiveFloat") {
      const title = String(node._meta?.title || "").toLowerCase();
      if (title.includes("fps") || title.includes("frame per second")) node.inputs.value = fps;
      if (title.includes("duration")) node.inputs.value = duration;
    }
    if (node.class_type === "PrimitiveBoolean" && String(node._meta?.title || "").toLowerCase() === "boolean") {
      // Nei template ufficiali questo è il toggle I2V, non il prompt enhancer.
      node.inputs.value = false;
    }
  }
  // Il prompt è già migliorato nella webapp tramite LM Studio: evita il secondo LLM incluso nel template.
  for (const [id, node] of Object.entries(workflow)) {
    if (node.class_type === "ComfySwitchNode" && id.endsWith(":5556")) node.inputs.switch = false;
  }
}

function pruneToOutputs(workflow) {
  const roots = Object.entries(workflow)
    .filter(([, node]) => ["SaveVideo", "SaveAudioAdvanced"].includes(node.class_type))
    .map(([id]) => id);
  const keep = new Set();
  const visit = (id) => {
    id = String(id);
    if (keep.has(id) || !workflow[id]) return;
    keep.add(id);
    for (const value of Object.values(workflow[id].inputs || {})) {
      if (Array.isArray(value) && value.length === 2) visit(value[0]);
    }
  };
  roots.forEach(visit);
  for (const id of Object.keys(workflow)) if (!keep.has(id)) delete workflow[id];
}

function removeInternalPromptEnhancer(workflow) {
  const positiveRaw = Object.entries(workflow).find(([, node]) =>
    node.class_type === "PrimitiveStringMultiline" && !String(node._meta?.title || "").toLowerCase().includes("negative")
  );
  const conditioning = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVConditioning");
  for (const [id, node] of Object.entries(workflow)) {
    if (node.class_type !== "ComfySwitchNode") continue;
    const title = String(node._meta?.title || "").toLowerCase();
    if ((id.endsWith(":5556") || title === "if/else switch") && positiveRaw) {
      replaceLinks(workflow, [id, 0], [positiveRaw[0], 0]);
    } else if (title.includes("positive conditioning source") && conditioning) {
      replaceLinks(workflow, [id, 0], [conditioning[0], 0]);
    } else if (title.includes("negative conditioning source") && conditioning) {
      replaceLinks(workflow, [id, 0], [conditioning[0], 1]);
    }
  }
}

function directConditioning(workflow, prompt, negativePrompt, fps) {
  const clip = Object.entries(workflow).find(([, node]) => node.class_type === "CLIPLoader" &&
    String(node.inputs.clip_name).includes("gemma4-12b")) || Object.entries(workflow).find(([, node]) => node.class_type === "CLIPLoader");
  const conditioning = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVConditioning");
  if (!clip || !conditioning) return null;
  const positiveId = nextNodeId(workflow, "ltx25_positive");
  const negativeId = nextNodeId(workflow, "ltx25_negative");
  workflow[positiveId] = { inputs: { text: prompt, clip: [clip[0], 0] }, class_type: "CLIPTextEncode", _meta: { title: "LTX 2.5 · Prompt positivo" } };
  workflow[negativeId] = { inputs: { text: negativePrompt, clip: [clip[0], 0] }, class_type: "CLIPTextEncode", _meta: { title: "LTX 2.5 · Prompt negativo" } };
  conditioning[1].inputs = { positive: [positiveId, 0], negative: [negativeId, 0], frame_rate: fps };
  for (const node of Object.values(workflow)) {
    if (node.class_type === "CFGGuider") {
      node.inputs.positive = [conditioning[0], 0];
      node.inputs.negative = [conditioning[0], 1];
    }
  }
  return { positive: [conditioning[0], 0], negative: [conditioning[0], 1] };
}

function configureBasicGraph(workflow, mode, uploads, settings, config) {
  const frames = frameCount(settings.duration, settings.fps);
  let [width, height] = resolutionFor(settings.profile, settings.aspect);
  if (mode === "multiReferenceMsr" && ["final", "maximum"].includes(settings.profile)) {
    [width, height] = resolutionFor(settings.profile === "final" ? "balanced" : "maximum", settings.aspect);
    if (settings.profile === "maximum") {
      const portrait = ["9:16", "3:4"].includes(settings.aspect);
      [width, height] = portrait ? [544, 960] : [960, 544];
    }
  }
  const twoStage = settings.twoStage;
  const unetId = Object.entries(workflow).find(([, node]) => node.class_type === "UNETLoader")?.[0];
  const videoVaeId = Object.entries(workflow).find(([, node]) => node.class_type === "VAELoader" && !String(node.inputs.vae_name).toLowerCase().includes("audio"))?.[0];
  const emptyVideo = Object.entries(workflow).find(([, node]) => node.class_type === "EmptyLTXVLatentVideo");
  const emptyAudio = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVEmptyLatentAudio");
  const concatNodes = Object.entries(workflow).filter(([, node]) => node.class_type === "LTXVConcatAVLatent");
  const conditioners = directConditioning(workflow, settings.prompt, settings.negativePrompt, settings.fps);

  emptyVideo[1].inputs = { width, height, length: frames, batch_size: 1 };
  emptyAudio[1].inputs.frames_number = frames;
  emptyAudio[1].inputs.frame_rate = settings.fps;
  for (const node of Object.values(workflow)) {
    if (node.class_type === "CreateVideo") node.inputs.fps = settings.fps;
    if (node.class_type === "VAEDecodeTiled") {
      node.inputs.tile_size = 256;
      node.inputs.overlap = 64;
      node.inputs.temporal_size = settings.profile === "preview" ? 64 : 48;
      node.inputs.temporal_overlap = 16;
    }
  }

  const imageNodes = Object.entries(workflow).filter(([, node]) => node.class_type === "LoadImage");
  const imagePreprocess = Object.entries(workflow).find(([, node]) => node.class_type === "ResizeImageMaskNode");
  const i2vNodes = Object.entries(workflow).filter(([, node]) => node.class_type === "LTXVImgToVideoInplace");
  const guideUploads = mode === "firstLast"
    ? [uploads.ltx25FirstFrame, uploads.ltx25LastFrame]
    : mode === "keyframes"
      ? [uploads.ltx25FirstFrame, ...(uploads.ltx25Keyframes || []), uploads.ltx25LastFrame].filter(Boolean)
      : [];

  if (mode === "image") {
    if (!uploads.ltx25FirstFrame?.name) throw new Error("Image to Video LTX 2.5 richiede un’immagine iniziale.");
    imageNodes[0][1].inputs.image = inputPath(uploads.ltx25FirstFrame);
    imagePreprocess[1].inputs["resize_type.longer_size"] = Math.max(width, height);
    for (const [, node] of i2vNodes) node.inputs.bypass = false;
  } else {
    for (const [, node] of i2vNodes) {
      const latent = node.inputs.latent;
      replaceLinks(workflow, [node === i2vNodes[0]?.[1] ? i2vNodes[0][0] : "", 0], latent);
    }
    if (concatNodes[0]) concatNodes[0][1].inputs.video_latent = [emptyVideo[0], 0];
    if (twoStage) {
      const upsampler = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVLatentUpsampler");
      if (concatNodes[1] && upsampler) concatNodes[1][1].inputs.video_latent = [upsampler[0], 0];
    }
  }

  if (mode === "multiReferenceMsr") {
    const references = uploads.ltx25MsrReferences || [];
    if (!references.length) throw new Error("Multi-Reference MSR richiede almeno un’immagine reference.");
    if (references.length > 5) throw new Error("Multi-Reference MSR accetta massimo cinque immagini.");
    const msrLora = config.files.ltx25Msr;
    if (!msrLora) throw new Error("Manca LTX-2.5-Licon-MSR-V1.safetensors.");

    const loaderId = nextNodeId(workflow, "ltx25_msr_loader");
    workflow[loaderId] = {
      inputs: { model: [unetId, 0], lora_name: msrLora, strength_model: 1 },
      class_type: "ComfyUILTX25MSRICLoRALoader",
      _meta: { title: "LTX 2.5 · Licon MSR Loader" },
    };
    const guideId = nextNodeId(workflow, "ltx25_msr_guide");
    const guideInputs = {
      positive: conditioners.positive,
      negative: conditioners.negative,
      vae: [videoVaeId, 0],
      latent: [emptyVideo[0], 0],
      msr_parameters: [loaderId, 1],
      strength: 1,
      reference_frames: "33",
      use_tiled_encode: true,
      tile_size: 256,
      tile_overlap: 64,
    };
    const slots = ["pic1", "pic2", "pic3", "pic4", "background"];
    references.forEach((upload, index) => {
      const loadId = nextNodeId(workflow, "ltx25_msr_reference");
      workflow[loadId] = {
        inputs: { image: inputPath(upload) },
        class_type: "LoadImage",
        _meta: { title: index === 4 ? "LTX 2.5 MSR · Background" : `LTX 2.5 MSR · Reference ${index + 1}` },
      };
      guideInputs[slots[index]] = [loadId, 0];
    });
    workflow[guideId] = {
      inputs: guideInputs,
      class_type: "ComfyUILTX25MSRMultiReferenceGuide",
      _meta: { title: "LTX 2.5 · Multi-Reference Guide" },
    };
    concatNodes[0][1].inputs.video_latent = [guideId, 2];
    for (const node of Object.values(workflow)) {
      if (node.class_type === "CFGGuider") {
        node.inputs.model = [loaderId, 0];
        node.inputs.positive = [guideId, 0];
        node.inputs.negative = [guideId, 1];
      }
    }
    const separate = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVSeparateAVLatent");
    const decode = Object.values(workflow).find((node) => node.class_type === "VAEDecodeTiled");
    if (separate && decode) {
      const cropId = nextNodeId(workflow, "ltx25_msr_crop");
      workflow[cropId] = {
        inputs: { positive: [guideId, 0], negative: [guideId, 1], latent: [separate[0], 0] },
        class_type: "LTXVCropGuides",
        _meta: { title: "LTX 2.5 · Rimuovi slot reference prima del decode" },
      };
      decode.inputs.samples = [cropId, 2];
    }
  }

  if (["firstLast", "keyframes"].includes(mode)) {
    if (guideUploads.length < 2) throw new Error("Carica almeno primo e ultimo frame per il controllo keyframe LTX 2.5.");
    const guideId = nextNodeId(workflow, "ltx25_guides");
    const inputs = {
      positive: conditioners.positive,
      negative: conditioners.negative,
      vae: [videoVaeId, 0],
      latent: [emptyVideo[0], 0],
      num_guides: String(Math.min(guideUploads.length, 8)),
    };
    guideUploads.slice(0, 8).forEach((upload, index) => {
      const loadId = nextNodeId(workflow, "ltx25_keyframe");
      workflow[loadId] = { inputs: { image: inputPath(upload) }, class_type: "LoadImage", _meta: { title: `LTX 2.5 · Keyframe ${index + 1}` } };
      inputs[`image_${index + 1}`] = [loadId, 0];
      inputs[`frame_idx_${index + 1}`] = index === guideUploads.length - 1 ? frames - 1 : Math.round(index * (frames - 1) / (guideUploads.length - 1));
      inputs[`strength_${index + 1}`] = 1;
    });
    workflow[guideId] = { inputs, class_type: "LTXVAddGuideMulti", _meta: { title: "LTX 2.5 · First/Last e keyframe multipli" } };
    concatNodes[0][1].inputs.video_latent = [guideId, 2];
    for (const node of Object.values(workflow)) {
      if (node.class_type === "CFGGuider") {
        node.inputs.positive = [guideId, 0];
        node.inputs.negative = [guideId, 1];
      }
    }
  }

  // Dopo il text encoding libera Gemma prima che il transformer INT8 venga materializzato.
  const conditioning = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVConditioning");
  if (conditioning) {
    const p = passthroughPurge(workflow, [conditioning[0], 0], "LTX 2.5 · Purge Gemma dopo prompt");
    const n = passthroughPurge(workflow, [conditioning[0], 1], "LTX 2.5 · Purge Gemma negativo");
    if (conditioners) {
      conditioners.positive = p;
      conditioners.negative = n;
    }
  }

  if (twoStage) {
    const stageOne = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVSeparateAVLatent");
    const upsampler = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVLatentUpsampler");
    if (stageOne && upsampler) {
      const purgedStageOne = passthroughPurge(workflow, [stageOne[0], 0], "LTX 2.5 · Purge transformer fra Stage 1 e upscaler");
      upsampler[1].inputs.samples = purgedStageOne;
      passthroughPurge(workflow, [upsampler[0], 0], "LTX 2.5 · Purge upscaler prima dello Stage 2");
    }
  }

  return { width, height, frames, finalWidth: twoStage ? width * 2 : width, finalHeight: twoStage ? height * 2 : height, unetId };
}

function assignAdvancedUploads(workflow, mode, uploads) {
  const loadImages = Object.entries(workflow).filter(([, node]) => node.class_type === "LoadImage");
  const loadVideos = Object.entries(workflow).filter(([, node]) => ["LoadVideo", "VHS_LoadVideo"].includes(node.class_type));
  const sourceVideo = uploads.ltx25SourceVideo;
  const maskVideo = uploads.ltx25MaskVideo;
  const image = uploads.ltx25ReferenceSheet || uploads.ltx25FirstFrame;

  loadVideos.forEach(([id, node], index) => {
    const upload = mode === "inpaint" && index === 1 ? maskVideo : sourceVideo;
    const key = node.class_type === "LoadVideo" ? "file" : "video";
    node.inputs[key] = inputPath(upload);
  });
  loadImages.forEach(([, node]) => { node.inputs.image = inputPath(image); });

  if (VIDEO_MODES.has(mode) && !sourceVideo?.name) throw new Error(`${MODE_LABELS[mode]} richiede un video sorgente.`);
  if (mode === "inpaint" && !maskVideo?.name) throw new Error("Video Inpainting richiede un video maschera bianco/nero.");
  if (IMAGE_MODES.has(mode) && !image?.name) throw new Error(`${MODE_LABELS[mode]} richiede un’immagine/reference.`);
}

function configureAdvancedGraph(workflow, mode, uploads, settings, config) {
  assignAdvancedUploads(workflow, mode, uploads);
  if (mode === "audio") {
    if (!uploads.ltx25Audio?.name) throw new Error("Audio to Video richiede un file audio.");
    for (const node of Object.values(workflow)) if (node.class_type === "LoadAudio") node.inputs.audio = inputPath(uploads.ltx25Audio);
    for (const node of Object.values(workflow)) if (node.class_type === "LoadImage") node.inputs.image = inputPath(uploads.ltx25FirstFrame);
  }
  const icLora = {
    referenceSheet: config.files.ingredients,
    unionControl: config.files.unionControl,
    inpaint: config.files.inpaint,
    outpaint: config.files.inpaint,
    motionTrack: config.files.motionTrack,
    v2vDeblur: config.files.ltx25Deblur,
    h3Ltx2k: config.files.ltx25PixelUpscaler,
  }[mode];
  for (const node of Object.values(workflow)) {
    if (node.class_type === "LTXICLoRALoaderModelOnly" && icLora) node.inputs.lora_name = icLora;
    if (node.class_type === "VAEDecodeTiled") {
      node.inputs.tile_size = 256;
      node.inputs.overlap = 64;
      node.inputs.temporal_size = 48;
      node.inputs.temporal_overlap = 16;
    }
    if (node.class_type === "PrimitiveInt" && String(node._meta?.title || "").toLowerCase().includes("target width")) {
      node.inputs.value = resolutionFor(settings.profile, settings.aspect)[0] * 2;
    }
    if (node.class_type === "PrimitiveInt" && String(node._meta?.title || "").toLowerCase().includes("target height")) {
      node.inputs.value = resolutionFor(settings.profile, settings.aspect)[1] * 2;
    }
  }
  if (mode === "h3Ltx2k") {
    for (const node of Object.values(workflow)) {
      const title = String(node._meta?.title || "").toLowerCase();
      if (node.class_type === "PrimitiveInt" && title.includes("target width")) node.inputs.value = 2048;
      if (node.class_type === "PrimitiveInt" && title.includes("target height")) node.inputs.value = 1152;
      if (node.class_type === "VAEDecodeTiled") {
        node.inputs.tile_size = 256;
        node.inputs.overlap = 64;
        node.inputs.temporal_size = 32;
        node.inputs.temporal_overlap = 8;
      }
    }
  }
  if (mode === "referenceSheet") {
    const [width, height] = resolutionFor(settings.profile, settings.aspect);
    const frames = frameCount(settings.duration, settings.fps);
    for (const node of Object.values(workflow)) {
      if (node.class_type === "EmptyLTXVLatentVideo") {
        node.inputs = { width, height, length: frames, batch_size: 1 };
      }
      if (node.class_type === "LTXVEmptyLatentAudio") {
        node.inputs.frames_number = frames;
        node.inputs.frame_rate = settings.fps;
      }
      if (node.class_type === "RepeatImageBatch") node.inputs.amount = frames;
      if (node.class_type === "LTXVConditioning") node.inputs.frame_rate = settings.fps;
      if (node.class_type === "CreateVideo") node.inputs.fps = settings.fps;
      if (node.class_type === "LTXAddVideoICLoRAGuide") {
        // La tavola deve guidare l'identità, non diventare un fermo immagine per 8 secondi.
        node.inputs.strength = settings.profile === "preview" ? 0.72 : settings.profile === "balanced" ? 0.8 : 0.86;
      }
    }
  }
  removeInternalPromptEnhancer(workflow);

  // I workflow ufficiali avanzati includono Gemma/API enhancer e più switch.
  // Dopo il bypass di LM Studio inseriamo il purge direttamente sulle conditioning
  // effettivamente consumate, così il text encoder viene liberato prima del denoise.
  for (const [conditioningId, node] of Object.entries(workflow).filter(([, candidate]) => candidate.class_type === "LTXVConditioning")) {
    const positiveUsed = Object.values(workflow).some((consumer) => Object.values(consumer.inputs || {}).some((value) =>
      Array.isArray(value) && String(value[0]) === String(conditioningId) && Number(value[1]) === 0));
    const negativeUsed = Object.values(workflow).some((consumer) => Object.values(consumer.inputs || {}).some((value) =>
      Array.isArray(value) && String(value[0]) === String(conditioningId) && Number(value[1]) === 1));
    if (positiveUsed) passthroughPurge(workflow, [conditioningId, 0], "LTX 2.5 AIO · Purge Gemma dopo prompt positivo");
    if (negativeUsed) passthroughPurge(workflow, [conditioningId, 1], "LTX 2.5 AIO · Purge Gemma dopo prompt negativo");
  }
  if (mode === "unionControl") {
    const badNodes = Object.entries(workflow).filter(([, node]) => !node.class_type);
    const control = Object.entries(workflow).find(([, node]) => node.class_type === (settings.controlType === "pose" ? "DWPreprocessor" : "CannyEdgePreprocessor"));
    const badOutput = badNodes.find(([, node]) => Object.hasOwn(node.inputs || {}, "depths")) || badNodes.at(-1);
    if (!control || !badOutput) throw new Error("Preprocessore Union Control LTX 2.5 non disponibile.");
    replaceLinks(workflow, [badOutput[0], 0], [control[0], 0]);
  }
  if (mode === "motionTrack") {
    const editor = Object.values(workflow).find((node) => node.class_type === "LTXVSparseTrackEditor");
    if (editor && settings.motionPreset !== "customDefault") {
      const starts = settings.motionPreset === "vertical"
        ? [[480, 450], [300, 390]]
        : settings.motionPreset === "horizontal"
          ? [[180, 270], [250, 380]]
          : [[180, 180], [780, 180]];
      const ends = settings.motionPreset === "vertical"
        ? [[480, 90], [300, 150]]
        : settings.motionPreset === "horizontal"
          ? [[780, 270], [700, 380]]
          : [[780, 430], [180, 430]];
      const lines = starts.map((start, index) => Array.from({ length: 25 }, (_, step) => ({
        x: Math.round(start[0] + (ends[index][0] - start[0]) * step / 24),
        y: Math.round(start[1] + (ends[index][1] - start[1]) * step / 24),
      })));
      editor.inputs.coordinates = JSON.stringify(lines);
      editor.inputs.points_store = JSON.stringify(lines.map((line) => [line[0], line.at(-1)]));
    }
  }
  // I template advanced usano il toggle enhancer separato: disattivalo, poiché LM Studio ha già lavorato sul testo.
  for (const [id, node] of Object.entries(workflow)) {
    if (node.class_type === "ComfySwitchNode" && id.endsWith(":5556")) node.inputs.switch = false;
  }
  // Purge vincolato al primo output del sampler di Stage 1.
  const separates = Object.entries(workflow).filter(([, node]) => node.class_type === "LTXVSeparateAVLatent");
  const upsampler = Object.entries(workflow).find(([, node]) => node.class_type === "LTXVLatentUpsampler");
  if (separates[0] && upsampler) {
    const purged = passthroughPurge(workflow, [separates[0][0], 0], "LTX 2.5 AIO · Purge fra Stage 1 e Stage 2");
    upsampler[1].inputs.samples = purged;
    passthroughPurge(workflow, [upsampler[0], 0], "LTX 2.5 AIO · Purge upscaler prima del refine");
  } else if (separates.length > 1) {
    // In/Outpaint ufficiali fanno upscale via decode → resize → re-encode,
    // non tramite LTXVLatentUpsampler. Questo vincolo forza comunque la
    // liberazione del primo sampling prima di costruire il secondo passaggio.
    passthroughPurge(workflow, [separates[0][0], 0], "LTX 2.5 AIO · Purge Stage 1 prima di resize e refine");
  }
}

export function buildLtx25Workflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const mode = String(raw.ltx25Mode || "text");
  if (!TEMPLATE_BY_MODE[mode]) throw new Error("Modalità LTX 2.5 AIO non riconosciuta.");
  const capability = config.ltx25?.modes?.[mode];
  if (capability && !capability.available) throw new Error(capability.reason || `${MODE_LABELS[mode]} non disponibile.`);

  const profile = ["preview", "balanced", "final", "maximum"].includes(raw.ltx25Profile) ? raw.ltx25Profile : "preview";
  const twoStage = BASIC_MODES.has(mode) && ["final", "maximum"].includes(profile) && !["firstLast", "keyframes", "multiReferenceMsr"].includes(mode);
  const rawPrompt = String(raw.prompt || "").trim();
  if (!rawPrompt) throw new Error("Inserisci il prompt LTX 2.5.");
  const prompt = mode === "referenceSheet" ? ingredientsPrompt(rawPrompt) : rawPrompt;
  const negativePrompt = cleanLtx25NegativePrompt(raw.negativePrompt);
  const settings = {
    prompt,
    negativePrompt,
    profile,
    twoStage,
    aspect: String(raw.ltx25Aspect || "16:9"),
    fps: numberValue(raw.ltx25Fps, 24, 8, 50, true, "FPS"),
    duration: numberValue(raw.duration, 5, 2, 20, false, "Durata"),
    seed: seedValue(raw.seed),
    decoder: raw.ltx25Decoder === "diffusion" ? "diffusion" : "conv",
    controlType: raw.ltx25ControlType === "pose" ? "pose" : "canny",
    motionPreset: ["horizontal", "vertical", "cross", "customDefault"].includes(raw.ltx25MotionPreset) ? raw.ltx25MotionPreset : "horizontal",
    loraPreset: ["custom", "selfieOrganic", "selfieHandheld", "fantasyHandheld", "cinematicNatural", "actionHandheld", "actionCinematic", "actionMultishot"].includes(raw.ltx25LoraPreset)
      ? raw.ltx25LoraPreset
      : "custom",
  };

  const template = BASIC_MODES.has(mode) && twoStage ? TWO_STAGE_TEMPLATE : TEMPLATE_BY_MODE[mode];
  const workflow = cloneTemplate(template);
  configureModels(workflow, config, settings.decoder);
  configureCommon(workflow, {
    ...settings,
    prefix: `VideoStudio/LTX25_AIO/${mode}_${profile}`,
  });

  let dimensions = null;
  if (BASIC_MODES.has(mode)) dimensions = configureBasicGraph(workflow, mode, uploads, settings, config);
  else configureAdvancedGraph(workflow, mode, uploads, settings, config);

  applyStyleLoras(workflow, loras);
  normalizeDynamicInputs(workflow);
  pruneToOutputs(workflow);
  addFinalPurge(workflow);
  const effectiveTwoStage = Object.values(workflow).filter((node) => node.class_type === "SamplerCustomAdvanced").length > 1;
  const purgePlan = Object.values(workflow)
    .filter((node) => ["DisTorchPurgeVRAMV2", "LayerUtility: PurgeVRAM"].includes(node.class_type))
    .map((node) => String(node._meta?.title || node.class_type));

  return {
    workflow,
    metadata: {
      workflowId: `videoStudio:ltx25:${mode}`,
      workflowName: `LTX 2.5 AIO · ${MODE_LABELS[mode]}`,
      videoStudioMode: "ltx25Aio",
      videoStudioStage: profile,
      videoStudioLabel: `${MODE_LABELS[mode]} · ${profile}`,
      ltx25Mode: mode,
      ltx25Profile: profile,
      prompt,
      negativePrompt,
      seed: settings.seed,
      fps: settings.fps,
      duration: settings.duration,
      decoder: settings.decoder,
      ltx25LoraPreset: settings.loraPreset,
      twoStage: effectiveTwoStage,
      purgePlan,
      ...(dimensions || {}),
    },
  };
}

export { MODE_LABELS as LTX25_MODE_LABELS };
