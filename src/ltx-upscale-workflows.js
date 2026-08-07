import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const workflowDirectory = path.resolve(moduleDirectory, "..", "workflows");

const TEMPLATE_FILE = "LTX23_UPSCALE_IC_API.json";

const DEFAULTS = {
  prompt: "upscale",
  negativePrompt:
    "pc game, console game, video game, cartoon, childish, ugly, noise, glitch, warble, " +
    "identity drift, changed face, changed clothes, temporal flicker, distorted anatomy",
  scale: 2,
  steps: 12,
  cfg: 1,
  denoise: 1,
  distilledStrength: 0.6,
  upscaleLoraStrength: 1,
  guideStrength: 1,
  crf: 13,
  frameLoadCap: 121,
};

export const LTX_UPSCALE_REQUIRED_NODES = [
  "VHS_LoadVideo",
  "VHS_VideoCombine",
  "ResizeImageMaskNode",
  "LoraLoaderModelOnly",
  "LTXICLoRALoaderModelOnly",
  "LTXAddVideoICLoRAGuide",
  "LTXVCropGuides",
  "LTXVConditioning",
  "EmptyLTXVLatentVideo",
  "LTXVEmptyLatentAudio",
  "LTXVConcatAVLatent",
  "LTXVSeparateAVLatent",
  "LTXVChunkFeedForward",
  "LTX2SamplingPreviewOverride",
  "BasicScheduler",
  "KSamplerSelect",
  "SamplerCustomAdvanced",
];

export const LTX_UPSCALE_MODEL_FILES = {
  checkpoint: "ltx-2.3-22b-dev-fp8.safetensors",
  distilledLora:
    "LTX2.3\\ltx-2.3-22b-distilled-1.1_lora-dynamic_fro09_avg_rank_111_bf16.safetensors",
  upscaleLora:
    "LTX2.3\\ltx2.3_upscale_ic-lora_06250.safetensors",
  textEncoder:
    "gemma-3-12b-it-heretic-v2_fp8_e4m3fn.safetensors",
  textProjection:
    "ltx-2.3_text_projection_bf16.safetensors",
  videoVae:
    "LTX23_video_vae_bf16.safetensors",
  audioVae:
    "LTX23_audio_vae_bf16.safetensors",
};

function cloneTemplate() {
  const file = path.join(workflowDirectory, TEMPLATE_FILE);

  if (!fs.existsSync(file)) {
    throw new Error(
      `Workflow Upscale LTX non trovato: ${TEMPLATE_FILE}`,
    );
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function inputPath(upload) {
  if (!upload?.name) return "";

  return upload.subfolder
    ? `${upload.subfolder}/${upload.name}`
    : upload.name;
}

function numberValue(
  value,
  fallback,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  } = {},
) {
  const parsed =
    value === undefined || value === null || value === ""
      ? fallback
      : Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < min ||
    parsed > max ||
    (integer && !Number.isInteger(parsed))
  ) {
    throw new Error("Parametro numerico Upscale LTX non valido.");
  }

  return parsed;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") return value;

  return ["true", "1", "on", "yes"].includes(
    String(value).toLowerCase(),
  );
}

function seedValue(value) {
  const parsed = Number(value);

  if (Number.isSafeInteger(parsed) && parsed >= 0) {
    return parsed;
  }

  return crypto.randomInt(0, 2 ** 31);
}

function requiredNode(workflow, id, label) {
  const item = workflow[id];

  if (!item?.inputs) {
    throw new Error(
      `Il workflow Upscale LTX non contiene il nodo ${label} (${id}).`,
    );
  }

  return item;
}

export function buildLtxUpscaleWorkflow(rawOptions = {}, upload) {
  if (!upload?.name) {
    throw new Error("Carica un video da elaborare con Upscale LTX.");
  }

  const workflow = cloneTemplate();

  const sourceVideo = inputPath(upload);

  const prompt =
    String(rawOptions.prompt || DEFAULTS.prompt).trim() ||
    DEFAULTS.prompt;

  const negativePrompt =
    String(
      rawOptions.negativePrompt || DEFAULTS.negativePrompt,
    ).trim() || DEFAULTS.negativePrompt;

  const seed = seedValue(rawOptions.seed);

  const scale = numberValue(
    rawOptions.ltxUpscaleScale,
    DEFAULTS.scale,
    {
      min: 1,
      max: 4,
    },
  );

  const steps = numberValue(
    rawOptions.ltxUpscaleSteps,
    DEFAULTS.steps,
    {
      min: 4,
      max: 30,
      integer: true,
    },
  );

  const distilledStrength = numberValue(
    rawOptions.ltxUpscaleDistilledStrength,
    DEFAULTS.distilledStrength,
    {
      min: 0,
      max: 2,
    },
  );

  const upscaleLoraStrength = numberValue(
    rawOptions.ltxUpscaleLoraStrength,
    DEFAULTS.upscaleLoraStrength,
    {
      min: 0,
      max: 2,
    },
  );

  const guideStrength = numberValue(
    rawOptions.ltxUpscaleGuideStrength,
    DEFAULTS.guideStrength,
    {
      min: 0,
      max: 2,
    },
  );

  const crf = numberValue(
    rawOptions.ltxUpscaleCrf,
    DEFAULTS.crf,
    {
      min: 0,
      max: 51,
      integer: true,
    },
  );

  const frameLoadCap = numberValue(
    rawOptions.ltxUpscaleFrameLoadCap,
    DEFAULTS.frameLoadCap,
    {
      min: 1,
      max: 1000,
      integer: true,
    },
  );

  const sourceDuration = numberValue(
    rawOptions.ltxUpscaleSourceDuration,
    0,
    {
      min: 0,
      max: 24 * 60 * 60,
    },
  );

  const fps = 24;

  const processedDuration = sourceDuration > 0
    ? Math.min(sourceDuration, frameLoadCap / fps)
    : frameLoadCap / fps;

  const keepAudio = booleanValue(
    rawOptions.ltxUpscaleKeepAudio,
    true,
  );

  // 5070 — video sorgente
  const videoLoader = requiredNode(
    workflow,
    "5070",
    "Load Video",
  );

  videoLoader.inputs.video = sourceVideo;
  videoLoader.inputs.frame_load_cap = frameLoadCap;
  videoLoader.inputs.skip_first_frames = 0;
  videoLoader.inputs.select_every_nth = 1;

  // 5093 — resize/upscale
  const resize = requiredNode(
    workflow,
    "5093",
    "Resize 2×",
  );

  resize.inputs.resize_type = "scale by multiplier";
  resize.inputs["resize_type.multiplier"] = scale;
  resize.inputs.scale_method = "bicubic";
  resize.inputs.input = ["5070", 0];

  // 2483 — prompt positivo
  requiredNode(
    workflow,
    "2483",
    "Prompt positivo",
  ).inputs.text = prompt;

  // 2612 — prompt negativo
  requiredNode(
    workflow,
    "2612",
    "Prompt negativo",
  ).inputs.text = negativePrompt;

  // 4832 — seed
  requiredNode(
    workflow,
    "4832",
    "Seed",
  ).inputs.noise_seed = seed;

  // 4922 — Distilled 1.1 LoRA
  const distilledLora = requiredNode(
    workflow,
    "4922",
    "Distilled LoRA",
  );

  distilledLora.inputs.lora_name =
    LTX_UPSCALE_MODEL_FILES.distilledLora;
  distilledLora.inputs.strength_model =
    distilledStrength;

  // 5011 — Upscale IC-LoRA
  const upscaleLora = requiredNode(
    workflow,
    "5011",
    "Upscale IC-LoRA",
  );

  upscaleLora.inputs.lora_name =
    LTX_UPSCALE_MODEL_FILES.upscaleLora;
  upscaleLora.inputs.strength_model =
    upscaleLoraStrength;

  // 5074 — scheduler
  const scheduler = requiredNode(
    workflow,
    "5074",
    "Scheduler",
  );

  scheduler.inputs.steps = steps;
  scheduler.inputs.denoise = DEFAULTS.denoise;

  // Il workflow corretto usa il nodo 5012 per la forza della guida IC-LoRA.
  if (
    workflow["5012"]?.inputs &&
    "strength" in workflow["5012"].inputs
  ) {
    workflow["5012"].inputs.strength = guideStrength;
  }

  // 5071 — output video
  const output = requiredNode(
    workflow,
    "5071",
    "Salvataggio video",
  );

  output.inputs.filename_prefix =
    "LTX23_Upscale_IC_WebApp";
  output.inputs.crf = crf;
  output.inputs.save_output = true;

  if (!keepAudio) {
    delete output.inputs.audio;
  } else {
    output.inputs.audio = ["5070", 2];
  }

  return {
    workflow,
    metadata: {
      generationType: "ltxUpscale",
      mediaType: "video",
      duration: Number(processedDuration.toFixed(2)),
      fps,
      workflowId: "ltxUpscaleIC",
      workflowName: "LTX 2.3 Upscale IC-LoRA",
      sourceVideo,
      prompt,
      negativePrompt,
      seed,
      upscaleSettings: {
        engineName: "LTX 2.3 IC-LoRA",
        presetName: String(rawOptions.ltxUpscalePreset || "balanced"),
        scale,
        steps,
        distilledStrength,
        upscaleLoraStrength,
        guideStrength,
        crf,
        frameLoadCap,
        keepAudio,
      },
      models: {
        checkpoint: LTX_UPSCALE_MODEL_FILES.checkpoint,
        distilledLora:
          LTX_UPSCALE_MODEL_FILES.distilledLora,
        upscaleLora:
          LTX_UPSCALE_MODEL_FILES.upscaleLora,
        textEncoder:
          LTX_UPSCALE_MODEL_FILES.textEncoder,
        textProjection:
          LTX_UPSCALE_MODEL_FILES.textProjection,
        videoVae:
          LTX_UPSCALE_MODEL_FILES.videoVae,
        audioVae:
          LTX_UPSCALE_MODEL_FILES.audioVae,
      },
    },
  };
}

export function ltxUpscaleConfig({
  availableNodes = [],
  installedCheckpoints = [],
  installedLoras = [],
  installedTextEncoders = [],
  installedVaes = [],
} = {}) {
  const normalized = (value) =>
    String(value || "")
      .replaceAll("/", "\\")
      .toLowerCase();

  const hasFile = (list, expected) =>
    list.some(
      (name) =>
        normalized(name) === normalized(expected) ||
        normalized(name).endsWith(
          `\\${normalized(expected)}`,
        ),
    );

  const missingNodes = LTX_UPSCALE_REQUIRED_NODES.filter(
    (name) => !availableNodes.includes(name),
  );

  const files = {
    checkpoint: hasFile(
      installedCheckpoints,
      LTX_UPSCALE_MODEL_FILES.checkpoint,
    ),
    distilledLora: hasFile(
      installedLoras,
      LTX_UPSCALE_MODEL_FILES.distilledLora,
    ),
    upscaleLora: hasFile(
      installedLoras,
      LTX_UPSCALE_MODEL_FILES.upscaleLora,
    ),
    textEncoder: hasFile(
      installedTextEncoders,
      LTX_UPSCALE_MODEL_FILES.textEncoder,
    ),
    textProjection: hasFile(
      installedTextEncoders,
      LTX_UPSCALE_MODEL_FILES.textProjection,
    ),
    videoVae: hasFile(
      installedVaes,
      LTX_UPSCALE_MODEL_FILES.videoVae,
    ),
    audioVae: hasFile(
      installedVaes,
      LTX_UPSCALE_MODEL_FILES.audioVae,
    ),
  };

  const missingFiles = Object.entries(files)
    .filter(([, installed]) => !installed)
    .map(([id]) => id);

  return {
    id: "ltxUpscaleIC",
    name: "LTX 2.3 Upscale IC-LoRA",
    description:
      "Secondo passaggio generativo LTX 2.3 per ricostruire dettaglio e aumentare la risoluzione del video.",
    available:
      missingNodes.length === 0 &&
      missingFiles.length === 0,
    missingNodes,
    missingFiles,
    files,
    defaults: {
      scale: DEFAULTS.scale,
      steps: DEFAULTS.steps,
      distilledStrength:
        DEFAULTS.distilledStrength,
      upscaleLoraStrength:
        DEFAULTS.upscaleLoraStrength,
      guideStrength:
        DEFAULTS.guideStrength,
      crf: DEFAULTS.crf,
      frameLoadCap:
        DEFAULTS.frameLoadCap,
      prompt: DEFAULTS.prompt,
      negativePrompt:
        DEFAULTS.negativePrompt,
    },
    modelFiles: LTX_UPSCALE_MODEL_FILES,
  };
}