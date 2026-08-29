import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImageWorkflow, imageModelConfig } from "../src/image-workflows.js";
import { buildStudioContinuation, buildStudioJobs, studioConfig } from "../src/studio-workflows.js";
import { buildUpscaleWorkflow, upscaleConfig } from "../src/upscale-workflows.js";
import {
  buildVideoStudioInitialJob,
  videoStudioConfig,
} from "../src/video-studio-workflows.js";
import {
  buildFirstLastWorkflow,
  buildWorkflow,
  videoModelConfig,
} from "../src/workflows.js";
import { comboOptions, validateWorkflow } from "../src/workflow-validator.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

const [definitions, systemStats] = await Promise.all([
  json(`${comfyUrl}/object_info`),
  json(`${comfyUrl}/system_stats`),
]);
const installedImageModels = comboOptions(definitions.UNETLoader?.input?.required?.unet_name);
const installedImageClips = comboOptions(definitions.CLIPLoader?.input?.required?.clip_name);
const installedImageVaes = comboOptions(definitions.VAELoader?.input?.required?.vae_name);
const installedModelPatches = comboOptions(definitions.ModelPatchLoader?.input?.required?.name);
const availableUpscaleModels = comboOptions(definitions.UpscaleModelLoader?.input?.required?.model_name);
const availableDetectorModels = comboOptions(
  definitions["easy ultralyticsDetectorPipe"]?.input?.required?.model_name,
);
const nodeNames = Object.keys(definitions);
const appConfig = {
  imageModels: imageModelConfig(installedImageModels, {
    clips: installedImageClips,
    vaes: installedImageVaes,
  }),
  studio: studioConfig({
    modelPatches: installedModelPatches,
    preprocessors: ["Canny", "DepthAnythingV2Preprocessor"].filter((name) => definitions[name]),
  }),
  upscaling: upscaleConfig({
    availableNodes: nodeNames,
    availableModels: availableUpscaleModels,
    availableDetectorModels,
    deviceName: systemStats?.devices?.[0]?.name || "",
  }),
};

const image = { name: "validation.png", subfolder: "validation" };
const video = { name: "validation.mp4", subfolder: "validation" };
const references = [
  { name: "reference-1.png", subfolder: "validation" },
  { name: "reference-2.png", subfolder: "validation" },
];
const workflows = [];
const buildErrors = [];
const skipped = [];

function add(label, factory) {
  try {
    const result = factory();
    const jobs = Array.isArray(result) ? result : [result];
    jobs.forEach((job, index) => {
      const workflow = job?.workflow || job;
      workflows.push({
        label: jobs.length > 1 ? `${label} #${index + 1}` : label,
        workflow,
        metadata: job?.metadata || null,
      });
    });
  } catch (error) {
    buildErrors.push(`${label}: ${error.message}`);
  }
}

const baseVideo = {
  prompt: "A coherent cinematic scene with natural continuous movement.",
  negativePrompt: "flicker, geometry drift, identity drift",
  resolution: "480p",
  orientation: "landscape",
  duration: 4,
  quality: "preview",
  seed: 12345,
};
const availableVideoModelIds = videoModelConfig(installedImageModels)
  .filter((model) => model.available)
  .map((model) => model.id);
const validationVideoModelIds = ["normal", "sulphur"].filter((id) => availableVideoModelIds.includes(id));
if (!validationVideoModelIds.length) validationVideoModelIds.push("normal");
const validationVideoModelId = validationVideoModelIds.includes("sulphur") ? "sulphur" : "normal";
for (const modelId of validationVideoModelIds) {
  for (const workflowId of ["standard", "director", "editAnything"]) {
    const scenes = workflowId === "director"
      ? [
          { prompt: "Opening shot.", duration: 2, upload: image },
          { prompt: "Continuous closing shot.", duration: 2, upload: image },
        ]
      : [];
    add(`Genera/${workflowId}/${modelId}`, () => buildWorkflow(
      workflowId,
      {
        ...baseVideo,
        videoInputMode: workflowId === "standard" ? "image" : undefined,
        videoModelId: modelId,
      },
      workflowId === "editAnything" ? video : image,
      scenes,
      [],
    ));
  }
}
for (const inputMode of ["text", "image"]) {
  add(`Genera/devfp8/${inputMode}`, () => buildWorkflow(
    "devfp8",
    { ...baseVideo, videoInputMode: inputMode },
    inputMode === "image" ? image : null,
    [],
    [],
  ));
}
add("Genera/first-last", () => buildFirstLastWorkflow(baseVideo, image, references[0], []));

const baseImage = {
  prompt: "A realistic photographic scene.",
  negativePrompt: "artifacts, malformed anatomy",
  imageResolution: "portrait",
  imageSteps: 8,
  imageGuidance: 1,
  batchSize: 1,
  seed: 12345,
  referenceUploads: references,
};
for (const model of appConfig.imageModels || []) {
  if (!model.available) {
    skipped.push(`Immagini/${model.id}: modello non disponibile`);
    continue;
  }
  for (const variant of model.models || []) {
    for (const mode of model.modes || []) {
      add(`Immagini/${model.id}/${variant.name}/${mode}`, () => buildImageWorkflow(
        model.id,
        { ...baseImage, imageModelFile: variant.file, imageMode: mode },
        mode === "text" ? null : image,
        [],
      ));
    }
  }
}
add("Immagini/post/Highres", () => buildImageWorkflow("fluxKrea2", {
  ...baseImage,
  imageMode: "image",
  highresEnabled: true,
  highresScale: 1.25,
  highresSteps: 4,
  faceDetailer: true,
  handDetailer: true,
}, image, []));
add("Immagini/post/SeedVR2", () => buildImageWorkflow("qwenEdit", {
  ...baseImage,
  imageMode: "image",
  imageModelFile: appConfig.imageModels?.find((item) => item.id === "qwenEdit")?.modelFile,
  upscaleMode: "seedvr2",
  seedvrProfile: "balanced",
  seedvrResolution: 1536,
}, image, []));
add("Immagini/post/RTX", () => buildImageWorkflow("flux2", {
  ...baseImage,
  imageMode: "image",
  imageModelFile: appConfig.imageModels?.find((item) => item.id === "flux2")?.modelFile,
  upscaleMode: "rtx",
}, image, []));

const baseStudio = {
  ...baseImage,
  alternatives: 2,
  editScope: "global",
  shots: JSON.stringify([
    { title: "Shot 1", prompt: "Opening frame." },
    { title: "Shot 2", prompt: "Continuation frame." },
  ]),
};
const studioUploads = {
  source: image,
  mask: references[0],
  guide: references[1],
  firstFrame: image,
  lastFrame: references[0],
  references,
};
for (const mode of appConfig.studio?.modes || []) {
  add(`Image Studio/${mode.id}`, () => buildStudioJobs(mode.id, baseStudio, studioUploads, []));
}
add("Image Studio/final SeedVR2", () => buildStudioContinuation("finalize", {
  ...baseStudio,
  studioMode: "guidedEdit",
  highresEnabled: true,
  upscaleMode: "seedvr2",
  seedvrResolution: 1536,
  autoPurge: true,
}, image, []));

const runtimeVideoConfig = videoStudioConfig({
  installedLoras: comboOptions(definitions.LoraLoaderModelOnly?.input?.required?.lora_name),
  installedCheckpoints: comboOptions(definitions.CheckpointLoaderSimple?.input?.required?.ckpt_name),
  installedTextEncoders: comboOptions(definitions.LTXAVTextEncoderLoader?.input?.required?.text_encoder),
  installedLatentUpscalers: comboOptions(definitions.LatentUpscaleModelLoader?.input?.required?.model_name),
  availableNodes: Object.keys(definitions),
});
const videoUploads = {
  sourceVideo: video,
  maskVideo: video,
  guideVideo: video,
  identityImage: image,
  initialMaskImage: image,
  referenceSheet: image,
  keyframe1: image,
  keyframe2: references[0],
  keyframe3: references[1],
};
const videoCases = [
  ["actorReplacement/editAnything", { ...baseVideo, videoModelId: validationVideoModelId, actorEngine: "editAnything", actorDescription: "person on the left" }],
  ["retake", { ...baseVideo, videoModelId: validationVideoModelId }],
  ["extend", { ...baseVideo, videoModelId: validationVideoModelId, extendDuration: 3 }],
  ["temporalUpscale", { ...baseVideo }],
];
if (runtimeVideoConfig.capabilities.autoMask.available && runtimeVideoConfig.capabilities.inpaint.available) {
  videoCases.push(
    ["actorReplacement/ltxFace", {
      ...baseVideo, actorEngine: "trackedInpaint", replacementScope: "face", actorDescription: "person on the left",
    }],
    ["actorReplacement/ltxBody", {
      ...baseVideo, actorEngine: "trackedInpaint", replacementScope: "body", actorDescription: "person on the left",
    }],
  );
}
if (runtimeVideoConfig.capabilities.unionControl.available) {
  videoCases.push(
    ["actorReplacement/unionBody", {
      ...baseVideo, actorEngine: "unionControl", replacementScope: "body", controlType: "pose",
    }],
    ["sceneTransform/unionEdges", {
      ...baseVideo, controlType: "edges",
    }],
  );
}
if (runtimeVideoConfig.capabilities.ingredients.available) {
  videoCases.push(["interactiveScene", {
    ...baseVideo,
    dialogue: JSON.stringify([{ speaker: "A", line: "Hello." }]),
  }]);
}
if (runtimeVideoConfig.capabilities.hdr.available) {
  videoCases.push(["hdr", { ...baseVideo }]);
}
for (const [mode, raw] of videoCases) {
  const rootMode = mode.split("/")[0];
  add(`Video Studio/${mode}`, () =>
    buildVideoStudioInitialJob(
      rootMode,
      raw,
      videoUploads,
      mode === "actorReplacement/editAnything"
        ? [{ name: runtimeVideoConfig.ltxLoras[0], strength: 1 }]
        : [],
      runtimeVideoConfig,
    )
  );
}
for (const [capability, value] of Object.entries(runtimeVideoConfig.capabilities)) {
  if (!value.available) skipped.push(`Video Studio/${capability}: ${value.missingNodes.join(", ") || "modello mancante"}`);
}

for (const engine of appConfig.upscaling?.engines || []) {
  if (!engine.available) {
    skipped.push(`Upscaling/${engine.id}: non disponibile`);
    continue;
  }
  for (const preset of appConfig.upscaling?.presets || []) {
    add(`Upscaling/${engine.id}/${preset.id}`, () => buildUpscaleWorkflow({
      upscaleEngine: engine.id,
      upscalePreset: preset.id,
      upscaleModel: appConfig.upscaling.models?.[0] || "",
      upscaleSourceWidth: 896,
      upscaleSourceHeight: 1152,
      seed: 12345,
    }, image, appConfig.upscaling.models || []));
  }
}
if (appConfig.upscaling?.detailers?.available) {
  add("Upscaling/SeedVR2/all-detailers", () => buildUpscaleWorkflow({
    upscaleEngine: "seedvr2",
    upscalePreset: "speed",
    upscaleSourceWidth: 896,
    upscaleSourceHeight: 1152,
    upscaleFaceDetailer: true,
    upscaleEyeDetailer: true,
    upscaleHandDetailer: true,
    upscaleSkinDetailer: true,
    upscaleNsfwDetailer: appConfig.upscaling.detailers.nsfw,
    seed: 12345,
  }, image, appConfig.upscaling.models || []));
}

const validationErrors = [];
for (const item of workflows) {
  const issues = validateWorkflow(item.workflow, definitions, { label: item.label });
  if (issues.length) validationErrors.push({ label: item.label, issues });
}

const templateDirectory = path.join(root, "workflows");
const templates = fs.readdirSync(templateDirectory)
  .filter((name) => name.endsWith(".json"))
  .map((name) => {
    const workflow = JSON.parse(fs.readFileSync(path.join(templateDirectory, name), "utf8"));
    const missingNodes = [...new Set(
      Object.values(workflow)
        .map((node) => node.class_type)
        .filter((classType) => !definitions[classType]),
    )].sort();
    return { name, nodes: Object.keys(workflow).length, missingNodes };
  });

const report = {
  generatedAt: new Date().toISOString(),
  comfyUrl,
  nodeTypes: Object.keys(definitions).length,
  generatedWorkflows: workflows.length,
  validWorkflows: workflows.length - validationErrors.length,
  invalidWorkflows: validationErrors.length,
  buildErrors,
  validationErrors,
  skipped,
  templates,
};
const reportFile = path.join(root, ".data", "workflow-audit.json");
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`Workflow costruiti: ${report.generatedWorkflows}`);
console.log(`Workflow validi: ${report.validWorkflows}`);
console.log(`Workflow non validi: ${report.invalidWorkflows}`);
console.log(`Errori di costruzione: ${report.buildErrors.length}`);
console.log(`Modalità non disponibili: ${report.skipped.length}`);
console.log(`Report: ${reportFile}`);
if (buildErrors.length) console.error(buildErrors.join("\n"));
for (const error of validationErrors) {
  console.error(`${error.label}\n${error.issues.map((issue) => `  - ${issue}`).join("\n")}`);
}
if (buildErrors.length || validationErrors.length) process.exitCode = 1;
