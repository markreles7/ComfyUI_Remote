import { buildImageWorkflow } from "../src/image-workflows.js";
import { sceneIntegrationSettings } from "../src/scene-integration/defaults.js";
import { prepareSceneIntegratedWorkflow } from "../src/scene-integration/pipeline.js";
import { emptySceneProfile } from "../src/scene-integration/schema.js";
import { validateWorkflow } from "../src/workflow-validator.js";
import { buildWorkflow } from "../src/workflows.js";

const comfyUrl = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const response = await fetch(`${comfyUrl}/object_info`);
if (!response.ok) throw new Error(`ComfyUI object_info: ${response.status}`);
const definitions = await response.json();
const availableNodes = Object.keys(definitions);
const settings = sceneIntegrationSettings({ enabled: true, preset: "balanced" });

function metric(value, confidence = 0.8) {
  return { value, confidence, method: "audit-fixture", unit: "normalized", fallback: null };
}

function profile(mediaType) {
  const item = emptySceneProfile(mediaType);
  item.id = `audit-${mediaType}`;
  item.colorProfile = {
    temperature: metric(5600),
    meanSaturation: metric(0.4),
    globalContrast: metric(0.2),
    luminanceDistribution: metric(Array(64).fill(1 / 64)),
  };
  item.lightingProfile = {
    mainDirection: metric({ x: -0.6, y: -0.2 }),
    shadowSoftness: metric(0.6),
  };
  item.cameraProfile = { blur: metric(0.2), apparentSharpness: metric(0.8) };
  item.spatialProfile = { depthMap: metric("depth", 0.88) };
  item.temporalProfile = mediaType === "video"
    ? { cameraMotion: metric({ x: 0.5, y: 0.1 }) }
    : {};
  item.textureProfile = {
    grainAmount: metric(0.1),
    finishing: { recommendedGrain: 0.02, recommendedBlurSigma: 0.3 },
  };
  return item;
}

const upload = { name: "scene-audit.png", subfolder: "", type: "input" };
const imageBase = {
  imageMode: "image",
  prompt: "Integrate a person into the original scene.",
  negativePrompt: "",
  imageResolution: "portrait",
  batchSize: "1",
  imageSteps: "8",
  imageGuidance: "1",
  seed: "42",
};

const jobs = [
  buildImageWorkflow("qwenEdit", imageBase, upload),
  buildImageWorkflow("flux2", imageBase, upload),
  buildWorkflow("standard", {
    prompt: "The person moves naturally.",
    negativePrompt: "",
    resolution: "480p",
    orientation: "portrait",
    duration: "4",
    quality: "preview",
    seed: "42",
  }, upload),
];

let failures = 0;
for (const job of jobs) {
  const mediaType = job.metadata.mediaType === "image" ? "image" : "video";
  const integrated = prepareSceneIntegratedWorkflow({
    ...job,
    profile: profile(mediaType),
    settings,
    availableNodes,
    context: {
      sourceInput: job.metadata.sourceImage,
      frameCount: mediaType === "video" ? 97 : 1,
      workflowId: job.metadata.workflowId,
    },
  });
  const issues = validateWorkflow(integrated.workflow, definitions, {
    label: integrated.metadata.workflowName,
  });
  if (issues.length) {
    failures += 1;
    console.error(`\n${integrated.metadata.workflowName}`);
    issues.forEach((issue) => console.error(`- ${issue}`));
  } else {
    console.log(`OK  ${integrated.metadata.workflowName} · ${integrated.plan.adapterName}`);
  }
}
if (failures) process.exitCode = 1;
