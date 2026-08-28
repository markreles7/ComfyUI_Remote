import { buildVideoStudioInitialJob, videoStudioConfig } from "../src/video-studio-workflows.js";
import { buildH3PreviewFinishingWorkflow } from "../src/h3-preview-workflows.js";
import { validateWorkflow } from "../src/workflow-validator.js";

const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";
const response = await fetch(`${comfyUrl}/object_info`);
if (!response.ok) throw new Error(`ComfyUI object_info: HTTP ${response.status}`);
const definitions = await response.json();

function combo(specification) {
  if (!Array.isArray(specification)) return [];
  if (Array.isArray(specification[0])) return specification[0];
  if (specification[0] === "COMBO") return specification[1]?.options || [];
  return [];
}

const config = videoStudioConfig({
  installedLoras: combo(definitions.LoraLoaderModelOnly?.input?.required?.lora_name),
  installedCheckpoints: combo(definitions.CheckpointLoaderSimple?.input?.required?.ckpt_name),
  installedTextEncoders: combo(definitions.LTXAVTextEncoderLoader?.input?.required?.text_encoder),
  installedLatentUpscalers: combo(definitions.LatentUpscaleModelLoader?.input?.required?.model_name),
  installedDiffusionModels: combo(definitions.UNETLoader?.input?.required?.unet_name),
  installedClips: combo(definitions.CLIPLoader?.input?.required?.clip_name),
  installedVaes: combo(definitions.VAELoader?.input?.required?.vae_name),
  availableNodes: Object.keys(definitions),
});
const installedUnets = combo(definitions.UNETLoader?.input?.required?.unet_name);
const installedUnetFiles = installedUnets.map((name) => String(name).toLowerCase());
const sulphurAvailable = installedUnetFiles.some((name) =>
  name.includes("sulphur_dev_fp8mixed.safetensors")
  || name.includes("sulphur_dev_bf16.safetensors")
  || name.includes("sulphur-2-base.safetensors")
  || name.includes("sulphur_2_base.safetensors")
);

const video = { name: "validation.mp4", subfolder: "remote" };
const image = { name: "validation.png", subfolder: "remote" };
const base = {
  prompt: "A coherent cinematic shot with natural continuous motion.",
  negativePrompt: "flicker, identity drift",
  resolution: "480p",
  orientation: "landscape",
  duration: 6,
  videoModelId: sulphurAvailable ? "sulphur" : "normal",
  seed: 123,
};
const cases = [
  ["actorReplacement/editAnything", { ...base, actorEngine: "editAnything" }, { sourceVideo: video }],
  ["retake", base, { sourceVideo: video }],
  ["extend", { ...base, extendDuration: 4 }, { sourceVideo: video }],
  ["temporalUpscale", { slowMotion: false }, { sourceVideo: video }],
];
if (config.capabilities.inpaint.available && config.capabilities.autoMask.available) {
  cases.unshift(
    ["actorReplacement/face", { ...base, actorEngine: "trackedInpaint", replacementScope: "face" }, { sourceVideo: video, identityImage: image }],
    ["actorReplacement/head", { ...base, actorEngine: "trackedInpaint", replacementScope: "head" }, { sourceVideo: video, identityImage: image }],
    ["actorReplacement/body", { ...base, actorEngine: "trackedInpaint", replacementScope: "body" }, { sourceVideo: video, identityImage: image }],
  );
}
if (config.capabilities.unionControl.available) {
  cases.unshift(
    ["actorReplacement/unionBody", { ...base, actorEngine: "unionControl", replacementScope: "body", controlType: "pose" }, { sourceVideo: video, identityImage: image }],
    ["sceneTransform/unionEdges", { ...base, controlType: "edges" }, { guideVideo: video, referenceSheet: image }],
  );
}
if (config.capabilities.hdr.available) {
  cases.push(["hdr", { ...base, hdrExposure: 7.1, saveExr: false }, { sourceVideo: video }]);
}
if (config.h3.available) {
  const h3Base = {
    h3Mode: "text",
    prompt: "A natural handheld documentary shot with coherent motion and native location audio.",
    duration: 5,
    h3AspectRatio: "16:9 (Widescreen)",
    h3FirstMegapixels: 0.6,
    h3UseTurbo: true,
    h3PurgeBetween: true,
    h3PurgeAfter: true,
    seed: 123,
  };
  cases.push(
    ["minimaxH3/balanced", { ...h3Base, h3RefineMode: "h3Balanced" }, {}],
    ["minimaxH3/maximum", { ...h3Base, h3RefineMode: "h3Maximum", h3SecondMegapixels: 1 }, {}],
    ["minimaxH3/seedvr2", { ...h3Base, h3RefineMode: "seedvr2", h3SeedvrResolution: 768 }, {}],
    ["minimaxH3/rtx", { ...h3Base, h3RefineMode: "rtx" }, {}],
    ["minimaxH3/direct", { ...h3Base, h3RefineMode: "direct", h3FirstMegapixels: 0.9 }, {}],
  );
  if (config.h3.attentionAvailability.comfyKitchen) {
    cases.push(["minimaxH3/kitchen", { ...h3Base, h3RefineMode: "direct", h3FirstMegapixels: 0.9, h3AttentionBackend: "comfyKitchen" }, {}]);
  }
}

const workflows = cases.map(([mode, raw, uploads]) => [
  mode,
  buildVideoStudioInitialJob(
    mode.split("/")[0],
    raw,
    uploads,
    mode === "actorReplacement/editAnything"
      ? [{ name: config.ltxLoras[0], strength: 1 }]
      : mode === "minimaxH3/balanced"
        ? [{ name: config.h3Loras.find((name) => /STY_Realism_People/i.test(name)), strength: 0.8 }].filter((item) => item.name)
        : [],
    config,
  ).workflow,
]);
if (config.h3.available) {
  workflows.push(
    ["minimaxH3/finishing-rtx", buildH3PreviewFinishingWorkflow(video, { finishingMode: "rtx" }).workflow],
    ["minimaxH3/finishing-kj-lanczos", buildH3PreviewFinishingWorkflow(video, {
      finishingMode: "kjLanczos",
      aspectRatio: "9:16 (Portrait Widescreen)",
    }).workflow],
  );
}
const errors = workflows.flatMap(([name, workflow]) =>
  validateWorkflow(workflow, definitions, { label: name }).map((issue) => `${name} · ${issue}`)
);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validati ${workflows.length} workflow Video Studio contro ${Object.keys(definitions).length} nodi ComfyUI.`);
}
