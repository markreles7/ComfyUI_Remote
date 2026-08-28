import { buildVideoStudioInitialJob, videoStudioConfig } from "../src/video-studio-workflows.js";
import { validateWorkflow } from "../src/workflow-validator.js";

const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";
const response = await fetch(`${comfyUrl}/object_info`);
if (!response.ok) throw new Error(`ComfyUI object_info: HTTP ${response.status}`);
const definitions = await response.json();

function choices(node, input) {
  const spec = definitions[node]?.input?.required?.[input];
  if (!spec) return [];
  if (Array.isArray(spec[0])) return spec[0];
  return Array.isArray(spec[1]?.options) ? spec[1].options : [];
}

const installedLoras = choices("LoraLoaderModelOnly", "lora_name").length
  ? choices("LoraLoaderModelOnly", "lora_name")
  : choices("ComfyUILTX25MSRICLoRALoader", "lora_name");
const config = videoStudioConfig({
  installedLoras,
  installedDiffusionModels: choices("UNETLoader", "unet_name"),
  installedClips: choices("CLIPLoader", "clip_name"),
  installedVaes: choices("VAELoader", "vae_name"),
  installedLatentUpscalers: choices("LatentUpscaleModelLoader", "model_name"),
  installedModelPatches: choices("ModelPatchLoader", "model_name"),
  availableNodes: Object.keys(definitions),
});

const uploads = {
  ltx25SourceVideo: { name: "validation-source.mp4", subfolder: "remote" },
  ltx25MsrReferences: [
    { name: "validation-subject-1.png", subfolder: "remote" },
    { name: "validation-subject-2.png", subfolder: "remote" },
    { name: "validation-background.png", subfolder: "remote" },
  ],
};

for (const mode of ["v2vDeblur", "multiReferenceMsr"]) {
  const job = buildVideoStudioInitialJob("ltx25Aio", {
    ltx25Mode: mode,
    ltx25Profile: "preview",
    ltx25Aspect: "16:9",
    ltx25Fps: 24,
    duration: 5,
    seed: 4242,
    prompt: mode === "v2vDeblur"
      ? "DEBLUR the same scene in sharp focus with crisp detail and clean edges."
      : "Image 1 and Image 2 interact naturally in the environment shown by Image 3.",
  }, uploads, [], config);
  const issues = validateWorkflow(job.workflow, definitions, { label: mode });
  console.log(JSON.stringify({ mode, available: config.ltx25.modes[mode].available, nodes: Object.keys(job.workflow).length, issues }, null, 2));
  if (issues.length) process.exitCode = 1;
}
