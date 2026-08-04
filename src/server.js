import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { ComfyClient, extractImages, extractVideos } from "./comfy-client.js";
import { editWildcardConfig, pickEditWildcardPrompt } from "./edit-wildcards.js";
import { cancelGeneration } from "./generation-cancellation.js";
import { setGenerationsArchived } from "./generation-archive.js";
import { HistoryStore } from "./history-store.js";
import { LmStudioClient } from "./lm-studio-client.js";
import {
  inspectImageFiles,
  mediaContentDisposition,
  resolveMediaFile,
  streamMediaFile,
} from "./media-files.js";
import {
  IMAGE_RESOLUTIONS,
  SEEDVR2_PROFILES,
  buildImageWorkflow,
  imageModelConfig,
  imageModelSelection,
} from "./image-workflows.js";
import { parseLoras, validateLoras } from "./loras.js";
import {
  applyQwenStructureGuide,
  buildStudioContinuation,
  buildStudioJobs,
  studioConfig,
} from "./studio-workflows.js";
import { buildUpscaleWorkflow, upscaleConfig } from "./upscale-workflows.js";
import {
  buildVideoStudioInitialJob,
  buildVideoStudioLipdubJob,
  videoStudioConfig,
} from "./video-studio-workflows.js";
import {
  comfyQueuePromptIds,
  missingGenerationPatch,
} from "./generation-reconciliation.js";
import {
  RESOLUTIONS,
  WORKFLOWS,
  buildFirstLastWorkflow,
  buildWorkflow,
  videoModelConfig,
} from "./workflows.js";
import { WorkflowPreflight } from "./workflow-validator.js";
import { sceneIntegrationSettings } from "./scene-integration/defaults.js";
import { buildComfySceneAnalysisWorkflow } from "./scene-integration/comfy-analysis-workflows.js";
import { buildSceneCorrectionWorkflow } from "./scene-integration/correction-workflow.js";
import { evaluateAndPlanCorrection, prepareSceneIntegratedWorkflow } from "./scene-integration/pipeline.js";
import { SceneIntegrationService } from "./scene-integration/service.js";
import { VirtualInfluencerStore } from "./virtual-influencer/store.js";
import {
  buildPhotoPlan,
  buildVideoPlan,
  identityEngineConfig,
  photoStudioRequest,
  videoWorkflowRequest,
} from "./virtual-influencer/identity-engine.js";

dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 30);
const maxVideoUploadMb = Number(process.env.MAX_VIDEO_UPLOAD_MB || 512);
const outputDirectory = process.env.OUTPUT_DIRECTORY || "";
const autoPurgeIdle = String(process.env.AUTO_PURGE_IDLE || "true").toLowerCase() !== "false";
const idlePurgeDelayMs = Math.max(5000, Number(process.env.IDLE_PURGE_DELAY_SECONDS || 15) * 1000);
const promptAssistantAutoGenerate =
  String(process.env.LM_STUDIO_AUTO_GENERATE || "true").toLowerCase() !== "false";
const sceneIntegrationEnabled =
  String(process.env.SCENE_INTEGRATION_ENABLED || "true").toLowerCase() !== "false";
const virtualInfluencerEnabled =
  String(process.env.VIRTUAL_INFLUENCER_ENABLED || "true").toLowerCase() !== "false";
const clientId = crypto.randomUUID();
const app = express();
const events = new Set();
const store = new HistoryStore(path.join(root, ".data", "history.json"));
const studioStore = new HistoryStore(path.join(root, ".data", "studio-projects.json"));
const videoStudioStore = new HistoryStore(path.join(root, ".data", "video-studio-projects.json"));
const virtualInfluencerStore = new VirtualInfluencerStore({
  dataDirectory: path.join(root, ".data"),
  enabled: virtualInfluencerEnabled,
});
const sceneIntegration = new SceneIntegrationService({
  root,
  dataDirectory: path.join(root, ".data"),
  enabled: sceneIntegrationEnabled,
  python: process.env.SCENE_ANALYSIS_PYTHON,
});
let idlePurgeTimer = null;

const promptAssistantInstructionsFile = process.env.LM_STUDIO_INSTRUCTIONS_FILE
  ? path.resolve(process.env.LM_STUDIO_INSTRUCTIONS_FILE)
  : path.join(root, "config", "prompt-assistant-instructions.md");
const promptAssistantInstructions = fs.existsSync(promptAssistantInstructionsFile)
  ? fs.readFileSync(promptAssistantInstructionsFile, "utf8")
  : undefined;
const promptAssistant = new LmStudioClient({
  baseUrl: process.env.LM_STUDIO_URL || "http://127.0.0.1:1234",
  model: process.env.LM_STUDIO_MODEL || "",
  apiToken: process.env.LM_STUDIO_API_TOKEN || "",
  contextLength: Number(process.env.LM_STUDIO_CONTEXT_LENGTH || 8192),
  maxTokens: Number(process.env.LM_STUDIO_MAX_TOKENS || 700),
  temperature: Number(process.env.LM_STUDIO_TEMPERATURE || 0.35),
  startServer: String(process.env.LM_STUDIO_START_SERVER || "true").toLowerCase() !== "false",
  lmsCommand: process.env.LM_STUDIO_CLI || "lms",
  instructions: promptAssistantInstructions,
  startupTimeoutMs: Math.max(60000, Number(process.env.LM_STUDIO_LOAD_TIMEOUT_SECONDS || 300) * 1000),
  inferenceTimeoutMs: Math.max(60000, Number(process.env.LM_STUDIO_INFERENCE_TIMEOUT_SECONDS || 300) * 1000),
});
const sulphurPromptAssistantModel = String(process.env.LM_STUDIO_SULPHUR_MODEL || "").trim();

function sulphurRuntimeConfig() {
  const promptEnhancerDirectory = fs.existsSync("D:\\AIMODELS")
    ? "D:\\AIMODELS\\SulphurAI\\Sulphur-2-base"
    : path.join(process.env.USERPROFILE || "", ".cache", "lm-studio", "models", "Sulphur", "promptenhancer");
  const files = [
    {
      name: "sulphur_prompt_enhancer_model-q8_0.gguf",
      repositoryPath: "prompt_enhancer/sulphur_prompt_enhancer_model-q8_0.gguf",
      sizeGb: 8.87,
    },
    {
      name: "mmproj-BF16.gguf",
      repositoryPath: "prompt_enhancer/mmproj-BF16.gguf",
      sizeGb: 0.86,
    },
  ].map((file) => ({
    ...file,
    localPath: path.join(promptEnhancerDirectory, file.name),
    installed: fs.existsSync(path.join(promptEnhancerDirectory, file.name)),
  }));
  return {
    workflowId: "ltxSulphur",
    modelFile: "ltx-2.3-22b-dev-fp8.safetensors + LTX2.3\\sulphur_lora_rank_768.safetensors",
    enhancerModel: sulphurPromptAssistantModel || promptAssistant.publicConfig().model,
    dedicatedEnhancerConfigured: Boolean(sulphurPromptAssistantModel),
    lmStudioDirectory: promptEnhancerDirectory,
    repository: "https://huggingface.co/SulphurAI/Sulphur-2-base",
    files,
  };
}

function broadcast(payload) {
  const text = `data: ${JSON.stringify(payload)}\n\n`;
  for (const response of events) response.write(text);
}

function promptIdFromEvent(event) {
  return event?.data?.prompt_id || event?.data?.promptId || null;
}

const comfy = new ComfyClient({
  httpUrl: process.env.COMFY_URL || "http://127.0.0.1:8188",
  wsUrl: process.env.COMFY_WS || "ws://127.0.0.1:8188",
  clientId,
  onEvent(event) {
    const promptId = promptIdFromEvent(event);
    const record = promptId ? store.list().find((item) => item.promptId === promptId) : null;
    if (record) {
      if (event.type === "progress") {
        const value = Number(event.data?.value || 0);
        const max = Number(event.data?.max || 1);
        const progress = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
        if (record.status !== "running" || record.progress !== progress) {
          // Il valore live resta in memoria; il risultato finale viene persistito dal polling.
          store.update(record.id, { status: "running", progress }, { persist: false });
        }
      } else if (event.type === "executing" && event.data?.node && record.status !== "running") {
        store.update(record.id, { status: "running" }, { persist: false });
      } else if (event.type === "execution_error") {
        store.update(record.id, {
          status: "error",
          error: event.data?.exception_message || "Errore durante la generazione.",
          finishedAt: new Date().toISOString(),
        });
        scheduleIdlePurge();
      }
    }
    broadcast({ ...event, generationId: record?.id || null });
  },
});
comfy.connect();
const workflowPreflight = new WorkflowPreflight(() => comfy.objectInfo(), { ttlMs: 60_000 });

function reconcileStoredImageResults() {
  if (!outputDirectory) return [];
  const patches = new Map();
  for (const item of store.list()) {
    if (item.status !== "completed" || !item.images?.length || item.videos?.length) continue;
    const inspected = inspectImageFiles(outputDirectory, item.images);
    const invalid = inspected.find((imageInfo) =>
      imageInfo.width != null
      && (imageInfo.width < 8 || imageInfo.height < 8
        || imageInfo.width > 32_768 || imageInfo.height > 32_768)
    );
    const primary = inspected.find((imageInfo) => imageInfo.width && imageInfo.height);
    const patch = {
      imageDimensions: inspected.map(({ file, width, height }) => ({
        filename: file.filename,
        width: width ?? null,
        height: height ?? null,
      })),
      outputWidth: primary?.width || null,
      outputHeight: primary?.height || null,
    };
    if (primary && item.imageSettings) {
      patch.imageSettings = {
        ...item.imageSettings,
        finalWidth: primary.width,
        finalHeight: primary.height,
      };
    }
    if (invalid) {
      patch.status = "error";
      patch.error = `Output storico corrotto rilevato automaticamente (${invalid.width}×${invalid.height}). Rigenera l'immagine con la pipeline corretta.`;
    }
    patches.set(item.id, patch);
  }
  return store.patchMany(patches);
}

reconcileStoredImageResults();

async function queueValidatedWorkflow(workflow, label) {
  await workflowPreflight.assert(workflow, { label });
  return comfy.queue(workflow);
}

function parseSceneIntegrationRequest(body = {}) {
  let raw = body.sceneIntegration;
  if (typeof raw === "string" && raw.trim()) {
    try {
      raw = JSON.parse(raw);
    } catch {
      const error = new Error("Le impostazioni Scene Integration non sono valide.");
      error.statusCode = 400;
      throw error;
    }
  }
  raw = raw && typeof raw === "object" ? raw : {};
  if (body.sceneIntegrationProfileId && !raw.profileId) {
    raw.profileId = body.sceneIntegrationProfileId;
  }
  const settings = sceneIntegrationSettings(raw);
  if (!settings.enabled) return null;
  const profileId = String(raw.profileId || "").trim();
  if (!profileId) {
    const error = new Error("Analizza prima la sorgente oppure importa un Scene Profile.");
    error.statusCode = 400;
    throw error;
  }
  const profile = sceneIntegration.getProfile(profileId);
  if (
    settings.preset !== "preview"
    && ["queued", "running"].includes(profile.analysisStatus?.state)
  ) {
    const error = new Error("Depth e segmentazione della scena sono ancora in coda. Attendi il completamento oppure usa Fast Preview.");
    error.statusCode = 409;
    throw error;
  }
  return {
    settings,
    profile,
  };
}

async function integrateSceneJob(job, body = {}, context = {}) {
  const request = parseSceneIntegrationRequest(body);
  if (!request) return job;
  const definitions = await workflowPreflight.definitions();
  const descriptor = [
    job.metadata?.imageModelId,
    job.metadata?.imageModelName,
    job.metadata?.imageModelFile,
    job.metadata?.imageModelFamily,
  ].filter(Boolean).join(" ");
  let profileDepthApplied = false;
  const depthConfidence = Number(request.profile.spatialProfile?.depthMap?.confidence || 0);
  if (
    /(qwen.*edit|biglovegwen|gwen2)/i.test(descriptor)
    && depthConfidence >= 0.35
    && !job.workflow["960002"]
  ) {
    const depthPatch = "qwen_image_depth_diffsynth_controlnet.safetensors";
    const installedPatches = comboOptions(
      definitions?.ModelPatchLoader?.input?.required?.name,
    );
    const depthFile = sceneIntegration.artifactFile(request.profile.id, "depth");
    if (depthFile && installedPatches.some((name) =>
      String(name).toLowerCase() === depthPatch.toLowerCase()
    )) {
      const depthUpload = await comfy.uploadImage({
        buffer: fs.readFileSync(depthFile),
        mimetype: "image/png",
        originalname: `scene-depth-${request.profile.id}.png`,
      });
      applyQwenStructureGuide(
        job.workflow,
        "qwenEdit",
        {
          structureGuide: "depth",
          structureStrength: Math.max(0.4, Math.min(0.9, depthConfidence)),
        },
        null,
        depthUpload,
      );
      profileDepthApplied = true;
    }
  }
  const integrated = prepareSceneIntegratedWorkflow({
    workflow: job.workflow,
    metadata: job.metadata,
    profile: request.profile,
    settings: request.settings,
    availableNodes: Object.keys(definitions),
    context: {
      sourceInput: job.metadata?.sourceImage || job.metadata?.sourceVideo || null,
      frameCount: Math.max(1, Math.round((job.metadata?.duration || 1) * (job.metadata?.fps || 1))),
      denoise: job.metadata?.imageSettings?.denoise,
      referenceStrength: job.metadata?.imageSettings?.referenceStrength,
      workflowId: job.metadata?.workflowId,
      ...context,
      structureGuideAvailable: context.structureGuideAvailable || profileDepthApplied,
    },
  });
  return {
    workflow: integrated.workflow,
    metadata: integrated.metadata,
  };
}

async function waitForComfyHistory(promptId, profileId, timeoutMs = 15 * 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const payload = await comfy.history(promptId);
    const entry = payload?.[promptId];
    if (entry) {
      const files = extractImages(entry);
      if (files.length) return { entry, files };
      const localFiles = localComfyAnalysisFiles(profileId);
      if (localFiles.length) return { entry, files: localFiles };
      if (entry.status?.completed === true || entry.status?.status_str === "error") {
        throw new Error("L’analisi ComfyUI è terminata senza produrre depth o maschere.");
      }
    }
    if (Date.now() - startedAt > 5000) {
      const queueIds = comfyQueuePromptIds(await comfy.queueStatus());
      if (!queueIds.running.has(promptId) && !queueIds.pending.has(promptId)) {
        const localFiles = localComfyAnalysisFiles(profileId);
        if (localFiles.length) return { entry, files: localFiles };
        throw new Error("Il job di analisi non è più presente nella coda ComfyUI.");
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("L’analisi depth/segmentazione ComfyUI ha superato il tempo massimo.");
}

function localComfyAnalysisFiles(profileId) {
  if (!outputDirectory) return [];
  const directory = path.resolve(outputDirectory, "SceneIntegration", String(profileId));
  const base = path.resolve(outputDirectory);
  if (!directory.startsWith(`${base}${path.sep}`) || !fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .filter((entry) => /(?:depth|subject_mask|tracked_mask)/i.test(entry.name))
    .map((entry) => ({
      filename: entry.name,
      subfolder: `SceneIntegration/${profileId}`,
      type: "output",
      localPath: path.join(directory, entry.name),
    }))
    .sort((left, right) => String(left.filename).localeCompare(String(right.filename)));
}

async function downloadComfyFile(file) {
  if (file?.localPath) return fs.readFileSync(file.localPath);
  const response = await fetch(comfy.mediaUrl(file), { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Impossibile recuperare l’artefatto ComfyUI (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function applyComfyAnalysisOutputs(profile, files, promptId) {
  let current = profile;
  for (const output of files) {
    const lower = `${output.subfolder}/${output.filename}`.toLowerCase();
    if (lower.includes("tracked_mask")) {
      const artifactKey = "trackedMask";
      current = sceneIntegration.attachArtifact(
        profile.id,
        artifactKey,
        await downloadComfyFile(output),
        output.filename,
        {
          temporalProfile: {
            ...current.temporalProfile,
            tracking: {
              value: artifactKey,
              confidence: 0.82,
              method: "SAM3-video-track",
              unit: "mask-artifact",
              fallback: null,
            },
            occlusionsOverTime: {
              value: "tracked-mask-available",
              confidence: 0.65,
              method: "SAM3-mask-visibility",
              unit: "qualitative",
              fallback: null,
            },
          },
        },
      );
    } else if (lower.includes("subject_mask")) {
      const artifactKey = "subjectMask";
      current = sceneIntegration.attachArtifact(
        profile.id,
        artifactKey,
        await downloadComfyFile(output),
        output.filename,
        {
          masks: {
            ...current.masks,
            subject: {
              artifact: artifactKey,
              confidence: 0.68,
              method: "Florence2-referring-expression-segmentation",
              fallback: null,
            },
          },
          spatialProfile: {
            ...current.spatialProfile,
            mainObjects: {
              value: ["main person or primary foreground subject"],
              confidence: 0.68,
              method: "Florence2",
              unit: "semantic-label",
              fallback: null,
            },
          },
        },
      );
    } else if (lower.includes("depth")) {
      const artifactKey = "depth";
      current = sceneIntegration.attachArtifact(
        profile.id,
        artifactKey,
        await downloadComfyFile(output),
        output.filename,
        {
          spatialProfile: {
            ...current.spatialProfile,
            depthMap: {
              value: artifactKey,
              confidence: 0.88,
              method: "DepthAnythingV2-VITS",
              unit: "relative-depth-artifact",
              fallback: null,
            },
          },
        },
      );
    }
  }
  return sceneIntegration.updateProfile({
    ...current,
    analysisWarnings: (current.analysisWarnings || [])
      .filter((warning) => !String(warning).startsWith("Analisi ComfyUI non completata:")),
    analysisStatus: {
      state: "completed",
      promptId,
      startedAt: profile.analysisStatus?.startedAt,
      finishedAt: new Date().toISOString(),
    },
  });
}

async function enrichProfileWithComfyAnalysis(profile, file) {
  const settings = profile.analysisSettings || {};
  const segmentationEnabled = false;
  if (!settings.depth && !segmentationEnabled) return profile;
  if (settings.segmentation && !segmentationEnabled) {
    profile = sceneIntegration.updateProfile({
      ...profile,
      analysisSettings: {
        ...settings,
        segmentation: false,
      },
      analysisWarnings: [
        ...(profile.analysisWarnings || []).filter((warning) =>
          !String(warning).includes("Segmentazione Florence2 disabilitata")
        ),
        "Segmentazione Florence2 disabilitata per incompatibilita' del nodo LayerStyle: usa maschera manuale/SAM nei workflow che richiedono selezione precisa.",
      ],
    });
  }
  let uploaded;
  if (profile.mediaType === "video") uploaded = await comfy.uploadInput(file);
  else uploaded = await comfy.uploadImage(file);
  const definitions = await workflowPreflight.definitions();
  const sam3Checkpoint = comboOptions(
    definitions?.CheckpointLoaderSimple?.input?.required?.ckpt_name,
  ).find((name) => /sam3/i.test(String(name))) || null;
  const trackingRequested = profile.mediaType === "video" && settings.preset === "maximum";
  const duration = Number(profile.sourceMetadata?.duration || 0);
  const trackingEnabled = trackingRequested && (!duration || duration <= 30);
  if (trackingRequested && !trackingEnabled) {
    profile = sceneIntegration.updateProfile({
      ...profile,
      analysisWarnings: [
        ...(profile.analysisWarnings || []),
        "Tracking SAM3 completo limitato ai video fino a 30 secondi: usato il proxy temporale campionato per evitare OOM.",
      ],
    });
  }
  const workflow = buildComfySceneAnalysisWorkflow({
    input: uploaded.name,
    mediaType: profile.mediaType,
    profileId: profile.id,
    depth: settings.depth,
    segmentation: segmentationEnabled,
    tracking: segmentationEnabled && trackingEnabled,
    sam3Checkpoint,
    analysisScale: settings.analysisScale,
  });
  const queued = await queueValidatedWorkflow(workflow, "Scene Analysis · depth e segmentazione");
  profile = sceneIntegration.updateProfile({
    ...profile,
    analysisStatus: {
      state: "queued",
      promptId: queued.prompt_id,
      startedAt: new Date().toISOString(),
    },
  });
  const { files } = await waitForComfyHistory(queued.prompt_id, profile.id);
  return applyComfyAnalysisOutputs(profile, files, queued.prompt_id);
}

async function reconcileSceneProfileAnalysis(profile) {
  if ((profile.analysisWarnings || []).some((warning) =>
    String(warning).startsWith("Analisi ComfyUI non completata:")
  )) {
    const localFiles = localComfyAnalysisFiles(profile.id);
    if (localFiles.length) {
      return applyComfyAnalysisOutputs(profile, localFiles, profile.analysisStatus?.promptId || null);
    }
  }
  if (profile.analysisStatus?.state === "error") {
    const localFiles = localComfyAnalysisFiles(profile.id);
    if (localFiles.length) {
      return applyComfyAnalysisOutputs(profile, localFiles, profile.analysisStatus?.promptId || null);
    }
    if (!String(profile.analysisStatus?.error || "").includes("senza produrre depth o maschere")) {
      return profile;
    }
  }
  if (
    profile.analysisStatus?.state !== "error"
    && !["queued", "running"].includes(profile.analysisStatus?.state)
  ) return profile;
  const promptId = profile.analysisStatus?.promptId;
  if (promptId) {
    const history = await comfy.history(promptId);
    const entry = history?.[promptId];
    const files = entry ? extractImages(entry) : [];
    if (files.length) return applyComfyAnalysisOutputs(profile, files, promptId);
    const localFiles = localComfyAnalysisFiles(profile.id);
    if (localFiles.length) return applyComfyAnalysisOutputs(profile, localFiles, promptId);
    const queueIds = comfyQueuePromptIds(await comfy.queueStatus());
    if (queueIds.running.has(promptId) || queueIds.pending.has(promptId)) return profile;
  }
  const source = sceneIntegration.sourceFile(profile.id);
  const startedAt = Date.parse(profile.analysisStatus?.startedAt || "");
  if (!promptId && Number.isFinite(startedAt) && Date.now() - startedAt < 30_000) {
    return profile;
  }
  if (!source) {
    return sceneIntegration.updateProfile({
      ...profile,
      analysisStatus: {
        ...profile.analysisStatus,
        state: "error",
        error: "Analisi interrotta dal riavvio e sorgente locale non disponibile.",
        finishedAt: new Date().toISOString(),
      },
    });
  }
  const file = {
    buffer: fs.readFileSync(source),
    mimetype: profile.sourceMetadata?.mimeType || (profile.mediaType === "video" ? "video/mp4" : "image/png"),
    originalname: profile.sourceMetadata?.originalName || path.basename(source),
    size: fs.statSync(source).size,
  };
  return scheduleComfyProfileAnalysis(profile, file);
}

function scheduleComfyProfileAnalysis(profile, file) {
  const safeFile = {
    buffer: Buffer.from(file.buffer),
    mimetype: file.mimetype,
    originalname: file.originalname,
    size: file.size,
  };
  const queuedProfile = sceneIntegration.updateProfile({
    ...profile,
    analysisStatus: {
      state: "queued",
      promptId: null,
      startedAt: new Date().toISOString(),
    },
  });
  void enrichProfileWithComfyAnalysis(queuedProfile, safeFile)
    .then(async (completed) => {
      await releaseComfyMemoryIfIdle();
      broadcast({
        type: "scene_profile_updated",
        profileId: completed.id,
        data: completed,
      });
    })
    .catch((error) => {
      const latest = sceneIntegration.getProfile(profile.id);
      const failed = sceneIntegration.updateProfile({
        ...latest,
        analysisStatus: {
          ...latest.analysisStatus,
          state: "error",
          error: error.message,
          finishedAt: new Date().toISOString(),
        },
        analysisWarnings: [
          ...(latest.analysisWarnings || []),
          `Analisi ComfyUI non completata: ${error.message}`,
        ],
      });
      broadcast({
        type: "scene_profile_updated",
        profileId: failed.id,
        data: failed,
      });
    });
  return queuedProfile;
}

function appendProjectGeneration(projectId, generationId) {
  if (!projectId) return;
  for (const projectStore of [studioStore, videoStudioStore]) {
    const project = projectStore.get(projectId);
    if (!project || project.generationIds?.includes(generationId)) continue;
    projectStore.update(projectId, {
      generationIds: [...(project.generationIds || []), generationId],
      updatedAt: new Date().toISOString(),
    });
  }
}

async function finalizeSceneIntegration(item, mediaFile, localPath) {
  const integration = item.sceneIntegration;
  if (!integration?.enabled || !localPath || integration.evaluationInProgress) return item;
  store.update(item.id, {
    sceneIntegration: { ...integration, evaluationInProgress: true },
  }, { persist: false });
  try {
    const analyzed = await sceneIntegration.analyzeResultFile(integration.profileId, localPath);
    const result = evaluateAndPlanCorrection({
      ...analyzed,
      integration,
    });
    const iterationRecord = {
      index: (integration.iterations?.length || 0) + 1,
      evaluatedAt: new Date().toISOString(),
      evaluation: result.evaluation,
      correction: result.correction,
    };
    let nextIntegration = {
      ...integration,
      evaluationInProgress: false,
      evaluation: result.evaluation,
      correctionPlan: result.correction,
      resultProfile: {
        id: analyzed.resultProfile.id,
        confidenceScores: analyzed.resultProfile.confidenceScores,
        analysisWarnings: analyzed.resultProfile.analysisWarnings,
      },
      evaluationArtifacts: analyzed.evaluationArtifacts || {},
      iterations: [...(integration.iterations || []), iterationRecord],
    };
    let updated = store.update(item.id, { sceneIntegration: nextIntegration });
    broadcast({ type: "generation_updated", generationId: item.id, data: updated });

    if (
      item.mediaType !== "image"
      || !result.nextIntegrationPlan
      || result.correction.stopped
      || result.correction.regenerateRegion
      || !item.sourceImage
    ) return updated;

    const resultUpload = await comfy.reuseOutputImage(
      mediaFile,
      `scene-integration-${item.id}.png`,
    );
    const correctionJob = buildSceneCorrectionWorkflow({
      resultInput: resultUpload.name,
      sourceInput: item.sourceImage,
      nextIntegrationPlan: result.nextIntegrationPlan,
      prefix: `SceneIntegration/${item.id}/correction_${iterationRecord.index}`,
    });
    if (!correctionJob.applied.length) return updated;
    const queued = await queueValidatedWorkflow(
      correctionJob.workflow,
      `Scene Integration · Correzione ${iterationRecord.index}`,
    );
    if (!queued.prompt_id) return updated;
    const childIntegration = {
      ...nextIntegration,
      adapterReport: result.nextIntegrationPlan,
      evaluation: null,
      correctionPlan: null,
      correctionOf: item.id,
      evaluationInProgress: false,
    };
    const child = store.add({
      ...item,
      id: crypto.randomUUID(),
      promptId: queued.prompt_id,
      workflowId: "scene-integration:correction",
      workflowName: `Scene Integration · Correzione ${iterationRecord.index}`,
      status: "queued",
      progress: 0,
      images: [],
      videos: [],
      createdAt: new Date().toISOString(),
      finishedAt: null,
      correctionParentId: item.id,
      sceneIntegration: childIntegration,
    });
    nextIntegration = {
      ...nextIntegration,
      correctionGenerationId: child.id,
    };
    updated = store.update(item.id, { sceneIntegration: nextIntegration });
    appendProjectGeneration(item.projectId, child.id);
    broadcast({
      type: "generation_created",
      generationId: child.id,
      projectId: child.projectId || null,
      data: child,
    });
    broadcast({ type: "generation_updated", generationId: item.id, data: updated });
    return updated;
  } catch (error) {
    const latest = store.get(item.id) || item;
    const updated = store.update(item.id, {
      sceneIntegration: {
        ...latest.sceneIntegration,
        evaluationInProgress: false,
        evaluationError: error.message,
      },
    });
    broadcast({ type: "generation_updated", generationId: item.id, data: updated });
    return updated;
  }
}

async function resumePendingSceneEvaluations() {
  if (!outputDirectory) return;
  for (const item of store.list()) {
    if (
      item.status !== "completed"
      || !item.sceneIntegration?.enabled
      || item.sceneIntegration.evaluation
      || item.sceneIntegration.evaluationError
    ) continue;
    const mediaFile = item.images?.[0] || item.videos?.at(-1);
    const resolved = mediaFile ? resolveMediaFile(outputDirectory, mediaFile) : null;
    if (!resolved?.path) continue;
    await finalizeSceneIntegration(item, mediaFile, resolved.path);
  }
}

setTimeout(() => {
  void resumePendingSceneEvaluations();
}, 1500);

async function objectDefinition(name) {
  try {
    const info = await comfy.objectInfo(name);
    return info?.[name] || null;
  } catch {
    return null;
  }
}

function comboOptions(specification) {
  if (!Array.isArray(specification)) return [];
  if (Array.isArray(specification[0])) return specification[0];
  if (specification[0] === "COMBO" && Array.isArray(specification[1]?.options)) {
    return specification[1].options;
  }
  return [];
}

function studioProjectView(project) {
  const generations = (project.generationIds || [])
    .map((id) => store.get(id))
    .filter(Boolean);
  const active = generations.some((item) => ["queued", "running"].includes(item.status));
  const completed = generations.length > 0 && generations.every((item) =>
    ["completed", "error", "interrupted"].includes(item.status)
  );
  const failed = generations.filter((item) => ["error", "interrupted"].includes(item.status)).length;
  return {
    ...project,
    status: active ? "running" : completed ? (failed === generations.length ? "error" : "completed") : project.status,
    generations,
  };
}

function videoStudioProjectView(project) {
  return studioProjectView(project);
}

async function videoStudioRuntimeConfig() {
  try {
    const info = await comfy.objectInfo();
    return videoStudioConfig({
      installedLoras: comboOptions(info?.LoraLoaderModelOnly?.input?.required?.lora_name),
      installedCheckpoints: comboOptions(info?.CheckpointLoaderSimple?.input?.required?.ckpt_name),
      installedTextEncoders: comboOptions(info?.LTXAVTextEncoderLoader?.input?.required?.text_encoder),
      installedLatentUpscalers: comboOptions(info?.LatentUpscaleModelLoader?.input?.required?.model_name),
      availableNodes: Object.keys(info || {}),
    });
  } catch {
    return videoStudioConfig();
  }
}

async function validateStudioModels(jobs) {
  const [info, checkpointInfo, patchInfo] = await Promise.all([
    comfy.objectInfo("UNETLoader"),
    comfy.objectInfo("CheckpointLoaderSimple"),
    comfy.objectInfo("ModelPatchLoader"),
  ]);
  const installed = comboOptions(info?.UNETLoader?.input?.required?.unet_name);
  const installedCheckpoints = comboOptions(checkpointInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name);
  const installedPatches = comboOptions(patchInfo?.ModelPatchLoader?.input?.required?.name);
  for (const job of jobs) {
    const requiredUnets = new Set([
      ...Object.values(job.workflow || {})
        .filter((item) => item.class_type === "UNETLoader" && item.inputs?.unet_name)
        .map((item) => item.inputs.unet_name),
    ].filter(Boolean));
    const requiredCheckpoints = new Set([
      ...Object.values(job.workflow || {})
        .filter((item) => item.class_type === "CheckpointLoaderSimple" && item.inputs?.ckpt_name)
        .map((item) => item.inputs.ckpt_name),
    ].filter(Boolean));
    if (job.metadata?.imageModelFile) {
      if (requiredCheckpoints.size) requiredCheckpoints.add(job.metadata.imageModelFile);
      else requiredUnets.add(job.metadata.imageModelFile);
    }
    for (const modelFile of requiredUnets) {
      if (!installed.some((name) =>
        String(name).toLowerCase() === String(modelFile).toLowerCase()
      )) {
        throw new Error(`Il modello richiesto non è installato: ${modelFile}`);
      }
    }
    for (const modelFile of requiredCheckpoints) {
      if (!installedCheckpoints.some((name) =>
        String(name).toLowerCase() === String(modelFile).toLowerCase()
      )) {
        throw new Error(`Il checkpoint richiesto non è installato: ${modelFile}`);
      }
    }
    for (const item of Object.values(job.workflow || {})) {
      if (item.class_type !== "ModelPatchLoader") continue;
      if (!installedPatches.some((name) =>
        String(name).toLowerCase() === String(item.inputs.name).toLowerCase()
      )) {
        throw new Error(`La guida strutturale Qwen non è installata: ${item.inputs.name}`);
      }
    }
  }
}

async function queueStudioJob(job, projectId) {
  const queued = await queueValidatedWorkflow(
    job.workflow,
    job.metadata?.workflowName || job.metadata?.studioLabel || "Studio",
  );
  if (!queued.prompt_id) throw new Error("ComfyUI non ha restituito un ID di generazione.");
  const item = store.add({
    id: crypto.randomUUID(),
    promptId: queued.prompt_id,
    projectId,
    status: "queued",
    progress: 0,
    videos: [],
    images: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
    ...job.metadata,
  });
  broadcast({ type: "generation_created", generationId: item.id, projectId, data: item });
  return item;
}

function studioFilesByRole(files) {
  return {
    source: files.find((file) => file.fieldname === "sourceImage") || null,
    mask: files.find((file) => file.fieldname === "maskImage") || null,
    guide: files.find((file) => file.fieldname === "guideImage") || null,
    firstFrame: files.find((file) => file.fieldname === "firstFrame") || null,
    lastFrame: files.find((file) => file.fieldname === "lastFrame") || null,
    references: files
      .filter((file) => /^reference[1-4]$/.test(file.fieldname))
      .sort((a, b) => a.fieldname.localeCompare(b.fieldname)),
  };
}

async function uploadStudioFiles(files) {
  const roles = studioFilesByRole(files);
  const entries = [
    ["source", roles.source],
    ["mask", roles.mask],
    ["guide", roles.guide],
    ["firstFrame", roles.firstFrame],
    ["lastFrame", roles.lastFrame],
  ];
  const uploaded = {};
  for (const [key, file] of entries) {
    if (!file) continue;
    if (!file.mimetype.startsWith("image/")) throw new Error("I workflow Studio accettano soltanto immagini.");
    validateUploadSize(file, maxUploadMb, "Un'immagine");
    uploaded[key] = await comfy.uploadImage(file);
  }
  uploaded.references = [];
  for (const file of roles.references) {
    if (!file.mimetype.startsWith("image/")) throw new Error("Le reference devono essere immagini.");
    validateUploadSize(file, maxUploadMb, "Una reference");
    uploaded.references.push(await comfy.uploadImage(file));
  }
  return uploaded;
}

async function uploadVirtualInfluencerReferences(profileId, references) {
  const uploaded = [];
  for (const reference of references) {
    const resolved = virtualInfluencerStore.assetPath(profileId, reference.id);
    if (!resolved?.path) continue;
    const buffer = fs.readFileSync(resolved.path);
    uploaded.push(await comfy.uploadImage({
      buffer,
      mimetype: reference.mimeType || "image/png",
      originalname: reference.filename || reference.originalName || `${reference.id}.png`,
      size: buffer.length,
    }));
  }
  return uploaded;
}

function virtualInfluencerPrompt(profile) {
  if (!profile) return "";
  const identity = profile.identityProfile || {};
  const appearance = profile.appearanceProfile || {};
  return [
    `${profile.displayName}, AI-generated fictional adult virtual creator, declared age ${identity.declaredAge}`,
    appearance.faceShape,
    appearance.eyeColorAndShape,
    appearance.hair,
    appearance.skinTone,
    appearance.bodyShape,
    appearance.bodyProportions,
    appearance.distinctiveMarks,
    appearance.makeup,
    appearance.aestheticStyle,
    appearance.immutableElements?.length ? `must preserve: ${appearance.immutableElements.join(", ")}` : "",
    "preserve identity from the supplied approved synthetic reference image",
  ].filter(Boolean).join(", ");
}

function selectedVirtualInfluencer(id) {
  const profileId = String(id || "").trim();
  if (!profileId) return null;
  const profile = virtualInfluencerStore.getProfile(profileId);
  const references = (profile.referenceAssets || [])
    .filter((asset) => asset.status === "approved")
    .sort((a, b) => {
      if (a.canonical !== b.canonical) return a.canonical ? -1 : 1;
      return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
    });
  if (!references.length) throw new Error(`${profile.displayName} non ha reference approvate.`);
  return {
    profile,
    references,
    prompt: virtualInfluencerPrompt(profile),
  };
}

async function uploadVirtualInfluencerSelection(profileId, limit = 1) {
  const selection = selectedVirtualInfluencer(profileId);
  if (!selection) return null;
  const uploads = await uploadVirtualInfluencerReferences(
    selection.profile.id,
    selection.references.slice(0, Math.max(1, limit)),
  );
  return { ...selection, uploads };
}

function withVirtualInfluencerPrompt(raw, selection) {
  if (!selection) return raw;
  return {
    ...raw,
    prompt: [selection.prompt, String(raw.prompt || "").trim()].filter(Boolean).join(". "),
  };
}

async function uploadVideoStudioFiles(files) {
  const roles = {
    sourceVideo: files.find((file) => file.fieldname === "sourceVideo") || null,
    maskVideo: files.find((file) => file.fieldname === "maskVideo") || null,
    guideVideo: files.find((file) => file.fieldname === "guideVideo") || null,
    identityImage: files.find((file) => file.fieldname === "identityImage") || null,
    initialMaskImage: files.find((file) => file.fieldname === "initialMaskImage") || null,
    referenceSheet: files.find((file) => file.fieldname === "referenceSheet") || null,
    keyframe1: files.find((file) => file.fieldname === "keyframe1") || null,
    keyframe2: files.find((file) => file.fieldname === "keyframe2") || null,
    keyframe3: files.find((file) => file.fieldname === "keyframe3") || null,
    keyframe4: files.find((file) => file.fieldname === "keyframe4") || null,
  };
  const uploaded = {};
  for (const [key, file] of Object.entries(roles)) {
    if (!file) continue;
    const isVideo = key.endsWith("Video");
    if (isVideo && !file.mimetype.startsWith("video/")) {
      throw new Error(`${key === "maskVideo" ? "La maschera" : "La scena"} deve essere un video.`);
    }
    if (!isVideo && !file.mimetype.startsWith("image/")) {
      throw new Error("Le reference devono essere immagini PNG, JPG o WebP.");
    }
    validateUploadSize(file, isVideo ? maxVideoUploadMb : maxUploadMb, isVideo ? "Il video" : "L’immagine");
    uploaded[key] = isVideo ? await comfy.uploadInput(file) : await comfy.uploadImage(file);
  }
  return uploaded;
}

async function imageEnhancementCapabilities() {
  const [upscale, seedDit, seedVae, seedUpscaler, seedNormalize, vramDebug] = await Promise.all([
    objectDefinition("UpscaleModelLoader"),
    objectDefinition("SeedVR2LoadDiTModel"),
    objectDefinition("SeedVR2LoadVAEModel"),
    objectDefinition("SeedVR2VideoUpscaler"),
    objectDefinition("RemoteImageTensorNormalize"),
    objectDefinition("VRAM_Debug"),
  ]);
  const upscaleModels = comboOptions(upscale?.input?.required?.model_name);
  const seedModels = comboOptions(seedDit?.input?.required?.model);
  const seedvr2Profiles = Object.entries(SEEDVR2_PROFILES).map(([id, profile]) => ({
    id,
    name: profile.name,
    available: seedModels.includes(profile.model),
  }));
  return {
    fastUpscale: Boolean(upscaleModels.includes("RealESRGAN_x2.pth")),
    seedvr2: Boolean(seedDit && seedVae && seedUpscaler && seedNormalize && seedvr2Profiles.some((profile) => profile.available)),
    seedvr2Profiles,
    faceEnhance: false,
    faceModels: [],
    faceEnhanceReason: "GFPGAN è installato, ma il vecchio Face Enhance MTB è disabilitato perché in questa istanza può produrre immagini larghe 3 px. Per i volti usa Face/Eye Detailer nella sezione Upscaling.",
    phasePurge: Boolean(vramDebug),
    idlePurge: autoPurgeIdle,
    idlePurgeDelaySeconds: idlePurgeDelayMs / 1000,
  };
}

async function standaloneUpscaleCapabilities() {
  const nodeNames = [
    "UpscaleModelLoader",
    "UpscaleWithModelAdvanced",
    "SeedVR2LoadDiTModel",
    "SeedVR2LoadVAEModel",
    "SeedVR2VideoUpscaler",
    "RemoteImageTensorNormalize",
    "DaSiWa_RTX_UpscalerRefiner",
    "VRAM_Debug",
    "UNETLoader",
    "DualCLIPLoader",
    "VAELoader",
    "ModelSamplingFlux",
    "easy pipeIn",
    "easy samLoaderPipe",
    "easy ultralyticsDetectorPipe",
    "easy preDetailerFix",
    "easy detailerFix",
  ];
  const [definitions, stats] = await Promise.all([
    Promise.all(nodeNames.map((name) => objectDefinition(name))),
    comfy.health().catch(() => null),
  ]);
  const definitionByName = new Map(nodeNames.map((name, index) => [name, definitions[index]]));
  const availableModels = comboOptions(
    definitionByName.get("UpscaleModelLoader")?.input?.required?.model_name,
  );
  const availableDetectorModels = comboOptions(
    definitionByName.get("easy ultralyticsDetectorPipe")?.input?.required?.model_name,
  );
  return upscaleConfig({
    availableNodes: nodeNames.filter((name) => definitionByName.get(name)),
    availableModels,
    availableDetectorModels,
    deviceName: stats?.devices?.[0]?.name || "",
  });
}

function cancelIdlePurge() {
  if (!idlePurgeTimer) return;
  clearTimeout(idlePurgeTimer);
  idlePurgeTimer = null;
}

function scheduleIdlePurge() {
  if (!autoPurgeIdle) return;
  cancelIdlePurge();
  idlePurgeTimer = setTimeout(async () => {
    idlePurgeTimer = null;
    try {
      const queue = await comfy.queueStatus();
      const busy = (queue?.queue_running?.length || 0) + (queue?.queue_pending?.length || 0) > 0;
      if (busy) {
        scheduleIdlePurge();
        return;
      }
      await comfy.free({ unloadModels: true, freeMemory: true });
      broadcast({ type: "idle_purge", data: { completed: true } });
    } catch {
      // Un purge automatico non deve interferire con generazioni o disponibilità della webapp.
    }
  }, idlePurgeDelayMs);
}

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public"), {
  extensions: ["html"],
  etag: true,
  maxAge: 0,
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(maxUploadMb, maxVideoUploadMb) * 1024 * 1024, files: 12 },
  fileFilter(_request, file, callback) {
    callback(null, /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime|x-matroska|x-msvideo))$/.test(file.mimetype));
  },
});

function validateUploadSize(file, maximumMb, label) {
  if (file.size > maximumMb * 1024 * 1024) {
    throw new Error(`${label} supera il limite di ${maximumMb} MB.`);
  }
}

function requireVirtualInfluencerEnabled(_request, response, next) {
  if (!virtualInfluencerEnabled) {
    response.status(404).json({ error: "Virtual Influencer Studio è disabilitato." });
    return;
  }
  next();
}

async function releaseComfyMemoryIfIdle() {
  try {
    const queue = await comfy.queueStatus();
    const busy = (queue?.queue_running?.length || 0) + (queue?.queue_pending?.length || 0) > 0;
    if (busy) return { released: false, reason: "queue-busy" };
    await comfy.free({ unloadModels: true, freeMemory: true });
    return { released: true, reason: null };
  } catch (error) {
    return { released: false, reason: "comfy-offline", detail: error.message };
  }
}

app.get("/api/config", async (_request, response) => {
  let installedImageModels = [];
  let installedImageCheckpoints = [];
  let installedImageClips = [];
  let installedImageVaes = [];
  let installedLoras = [];
  let installedModelPatches = [];
  const studioPreprocessors = [];
  const enhancements = await imageEnhancementCapabilities();
  const upscaling = await standaloneUpscaleCapabilities();
  const videoStudio = await videoStudioRuntimeConfig();
  try {
    const [modelInfo, checkpointInfo, clipInfo, vaeInfo, loraInfo, patchInfo, cannyInfo, depthInfo] = await Promise.all([
      comfy.objectInfo("UNETLoader"),
      comfy.objectInfo("CheckpointLoaderSimple"),
      comfy.objectInfo("CLIPLoader"),
      comfy.objectInfo("VAELoader"),
      comfy.objectInfo("LoraLoaderModelOnly"),
      comfy.objectInfo("ModelPatchLoader"),
      comfy.objectInfo("Canny"),
      comfy.objectInfo("DepthAnythingV2Preprocessor"),
    ]);
    installedImageModels = comboOptions(modelInfo?.UNETLoader?.input?.required?.unet_name);
    installedImageCheckpoints = comboOptions(checkpointInfo?.CheckpointLoaderSimple?.input?.required?.ckpt_name);
    installedImageClips = comboOptions(clipInfo?.CLIPLoader?.input?.required?.clip_name);
    installedImageVaes = comboOptions(vaeInfo?.VAELoader?.input?.required?.vae_name);
    installedLoras = comboOptions(loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name);
    installedModelPatches = comboOptions(patchInfo?.ModelPatchLoader?.input?.required?.name);
    if (cannyInfo?.Canny) studioPreprocessors.push("Canny");
    if (depthInfo?.DepthAnythingV2Preprocessor) {
      studioPreprocessors.push("DepthAnythingV2Preprocessor");
    }
  } catch {
    // La configurazione resta utilizzabile anche se ComfyUI è momentaneamente offline.
  }
  response.json({
    workflows: Object.values(WORKFLOWS).map(({ file: _file, ...item }) => item),
    videoModels: videoModelConfig(installedImageModels),
    resolutions: RESOLUTIONS,
    imageModels: imageModelConfig(installedImageModels, {
      checkpoints: installedImageCheckpoints,
      clips: installedImageClips,
      vaes: installedImageVaes,
    }),
    imageResolutions: IMAGE_RESOLUTIONS,
    loras: installedLoras,
    fps: 24,
    outputDirectory,
    maxUploadMb,
    maxVideoUploadMb,
    imageEnhancements: enhancements,
    upscaling,
    studio: studioConfig({
      modelPatches: installedModelPatches,
      preprocessors: studioPreprocessors,
    }),
    videoStudio,
    promptAssistant: { ...promptAssistant.publicConfig(), autoGenerate: promptAssistantAutoGenerate },
    sulphur: sulphurRuntimeConfig(),
    editWildcards: editWildcardConfig(root),
    sceneIntegration: await sceneIntegration.capabilities(),
    virtualInfluencer: {
      ...virtualInfluencerStore.config(),
      identityEngine: identityEngineConfig(),
      availableProfiles: virtualInfluencerStore.listProfiles().map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        slug: profile.slug,
        status: profile.status,
        approvedReferences: profile.identityDatasetReadiness?.approvedCount || 0,
        canonicalReferences: profile.identityDatasetReadiness?.canonicalCount || 0,
        readiness: profile.identityDatasetReadiness?.status || "unknown",
      })),
    },
  });
});

app.get("/api/virtual-influencer/config", (_request, response) => {
  response.json({
    ...virtualInfluencerStore.config(),
    identityEngine: identityEngineConfig(),
  });
});

app.get("/api/virtual-influencer/profiles", requireVirtualInfluencerEnabled, (_request, response) => {
  response.json({ profiles: virtualInfluencerStore.listProfiles() });
});

app.post("/api/virtual-influencer/profiles", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json({ profile: virtualInfluencerStore.createProfile(request.body) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/virtual-influencer/profiles/:id", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json({ profile: virtualInfluencerStore.getProfile(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/virtual-influencer/profiles/:id/bible", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json({ profile: virtualInfluencerStore.updateBible(request.params.id, request.body) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/versions", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.createVersion(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/outfits", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.createOutfit(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/virtual-influencer/profiles/:id/outfits/:outfitId", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updateOutfit(request.params.id, request.params.outfitId, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/locations", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.createLocation(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/virtual-influencer/profiles/:id/locations/:locationId", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updateLocation(request.params.id, request.params.locationId, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/batches", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.createBatchQueue(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/virtual-influencer/profiles/:id/batches/:queueId", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updateBatchQueue(
      request.params.id,
      request.params.queueId,
      String(request.body.action || ""),
    ));
  } catch (error) {
    next(error);
  }
});

app.get("/api/virtual-influencer/profiles/:id/debug-report", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json({ report: virtualInfluencerStore.debugReport(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/cache/invalidate", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.invalidateCache(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.put("/api/virtual-influencer/profiles/:id/voice", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updateVoiceProfile(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.put("/api/virtual-influencer/profiles/:id/disclosure", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updateDisclosureSettings(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.put("/api/virtual-influencer/profiles/:id/platform-policies/:platform", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updatePlatformPolicy(request.params.id, request.params.platform, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/captions", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.createCaptionDraft(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/content-projects", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.createContentProject(request.params.id, request.body));
  } catch (error) {
    next(error);
  }
});

app.patch("/api/virtual-influencer/profiles/:id/content-projects/:projectId", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.json(virtualInfluencerStore.updateContentProject(request.params.id, request.params.projectId, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/content-projects/:projectId/analytics", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.recordAnalytics(request.params.id, request.params.projectId, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/content-projects/:projectId/analytics/import-csv", requireVirtualInfluencerEnabled, (request, response, next) => {
  try {
    response.status(201).json(virtualInfluencerStore.importAnalyticsCsv(
      request.params.id,
      request.params.projectId,
      request.body.csv || request.body.csvText || "",
    ));
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/photos", requireVirtualInfluencerEnabled, async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const profile = virtualInfluencerStore.getProfile(request.params.id);
    const enrichedInput = virtualInfluencerStore.enrichGenerationInput(profile.id, request.body);
    const cachedPlan = virtualInfluencerStore.getCachedPlan(profile.id, "photo", enrichedInput);
    const plan = cachedPlan.plan || buildPhotoPlan(profile, enrichedInput);
    if (!cachedPlan.cached) virtualInfluencerStore.putCachedPlan(profile.id, "photo", enrichedInput, plan);
    const uploadedReferences = await uploadVirtualInfluencerReferences(profile.id, plan.references);
    const studioRaw = photoStudioRequest(plan, uploadedReferences);
    const uploaded = {
      source: studioRaw.sourceUpload || null,
      references: studioRaw.referenceUploads || [],
    };
    const jobs = buildStudioJobs("perfect", studioRaw, uploaded, []);
    await validateStudioModels(jobs);
    const project = studioStore.add({
      id: crypto.randomUUID(),
      studioMode: "perfect",
      name: studioRaw.projectName,
      prompt: plan.prompt,
      executionMode: "guided",
      autoState: "drafts",
      settings: {
        ...studioRaw,
        virtualInfluencer: {
          profileId: profile.id,
          versionId: plan.versionId,
          adapter: plan.adapter.name,
          qualityPreset: plan.qualityPreset.id,
        },
      },
      uploads: uploaded,
      loras: [],
      status: "queued",
      generationIds: [],
      selections: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const createdAsset = virtualInfluencerStore.createPhotoAsset(profile.id, plan, project.id, []);
    const created = [];
    for (const job of jobs) {
      job.metadata = {
        ...job.metadata,
        virtualInfluencer: {
          profileId: profile.id,
          assetId: createdAsset.asset.id,
          versionId: plan.versionId,
          contentType: "photo",
          adapter: plan.adapter.name,
          requestedAdapter: plan.requestedAdapter,
          identityScorePreview: createdAsset.asset.validationScores.identity.overallScore,
          disclosure: createdAsset.asset.disclosure,
          referenceIds: plan.references.map((item) => item.id),
          planCache: { key: cachedPlan.key, hit: cachedPlan.cached },
        },
      };
      created.push(await queueStudioJob(job, project.id));
    }
    const updatedProject = studioStore.update(project.id, {
      generationIds: created.map((item) => item.id),
      updatedAt: new Date().toISOString(),
    });
    const updatedAsset = virtualInfluencerStore.updateGeneratedAssetGenerations(
      profile.id,
      createdAsset.asset.id,
      created.map((item) => item.id),
    );
    broadcast({ type: "virtual_influencer_photo_created", profileId: profile.id, data: updatedAsset.asset });
    response.status(202).json({
      profile: updatedAsset.profile,
      asset: updatedAsset.asset,
      project: studioProjectView(updatedProject),
      plan: {
        adapter: plan.adapter,
        requestedAdapter: plan.requestedAdapter,
        references: plan.references.map((item) => item.id),
        warnings: plan.warnings,
        cache: { key: cachedPlan.key, hit: cachedPlan.cached },
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/virtual-influencer/profiles/:id/videos", requireVirtualInfluencerEnabled, async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const profile = virtualInfluencerStore.getProfile(request.params.id);
    const enrichedInput = virtualInfluencerStore.enrichGenerationInput(profile.id, request.body);
    const cachedPlan = virtualInfluencerStore.getCachedPlan(profile.id, "video", enrichedInput);
    const plan = cachedPlan.plan || buildVideoPlan(profile, enrichedInput);
    if (!cachedPlan.cached) virtualInfluencerStore.putCachedPlan(profile.id, "video", enrichedInput, plan);
    const keyframe = plan.references.find((item) => item.id === plan.keyframeReferenceId) || plan.references[0];
    const [uploadedKeyframe] = await uploadVirtualInfluencerReferences(profile.id, [keyframe]);
    if (!uploadedKeyframe?.name) throw new Error("Keyframe iniziale non disponibile per LTX.");
    const raw = videoWorkflowRequest(plan);
    const job = buildWorkflow("standard", raw, uploadedKeyframe, [], []);
    job.metadata = {
      ...job.metadata,
      workflowId: "virtualInfluencer:video",
      workflowName: "Virtual Influencer Studio · Influencer Video",
      virtualInfluencer: {
        profileId: profile.id,
        assetId: null,
        versionId: plan.versionId,
        contentType: "video",
        adapter: plan.adapter.name,
        identityScorePreview: null,
        disclosure: null,
        referenceIds: plan.references.map((item) => item.id),
        keyframeReferenceId: keyframe.id,
        planCache: { key: cachedPlan.key, hit: cachedPlan.cached },
      },
    };
    const project = videoStudioStore.add({
      id: crypto.randomUUID(),
      videoStudioMode: "influencerVideo",
      name: raw.projectName,
      prompt: plan.prompt,
      settings: {
        ...raw,
        virtualInfluencer: {
          profileId: profile.id,
          versionId: plan.versionId,
          adapter: plan.adapter.name,
          qualityPreset: plan.qualityPreset.id,
        },
      },
      uploads: { source: uploadedKeyframe, references: [] },
      loras: [],
      status: "queued",
      generationIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const createdAsset = virtualInfluencerStore.createVideoAsset(profile.id, plan, project.id, []);
    job.metadata.virtualInfluencer.assetId = createdAsset.asset.id;
    job.metadata.virtualInfluencer.identityScorePreview = createdAsset.asset.validationScores.identity.overallScore;
    job.metadata.virtualInfluencer.disclosure = createdAsset.asset.disclosure;
    const generation = await queueStudioJob(job, project.id);
    const updatedProject = videoStudioStore.update(project.id, {
      generationIds: [generation.id],
      updatedAt: new Date().toISOString(),
    });
    const updatedAsset = virtualInfluencerStore.updateGeneratedAssetGenerations(
      profile.id,
      createdAsset.asset.id,
      [generation.id],
    );
    broadcast({ type: "virtual_influencer_video_created", profileId: profile.id, data: updatedAsset.asset });
    response.status(202).json({
      profile: updatedAsset.profile,
      asset: updatedAsset.asset,
      project: videoStudioProjectView(updatedProject),
      plan: {
        adapter: plan.adapter,
        keyframeReferenceId: keyframe.id,
        references: plan.references.map((item) => item.id),
        warnings: plan.warnings,
        cache: { key: cachedPlan.key, hit: cachedPlan.cached },
      },
    });
  } catch (error) {
    next(error);
  }
});

app.patch(
  "/api/virtual-influencer/profiles/:id/generated-assets/:assetId/review",
  requireVirtualInfluencerEnabled,
  (request, response, next) => {
    try {
      response.json(virtualInfluencerStore.reviewGeneratedAsset(
        request.params.id,
        request.params.assetId,
        request.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/virtual-influencer/profiles/:id/generated-assets/:assetId/export",
  requireVirtualInfluencerEnabled,
  (request, response, next) => {
    try {
      response.status(201).json(virtualInfluencerStore.exportGeneratedAsset(
        request.params.id,
        request.params.assetId,
        request.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/virtual-influencer/profiles/:id/generated-assets/:assetId/compare-versions",
  requireVirtualInfluencerEnabled,
  (request, response, next) => {
    try {
      response.status(201).json(virtualInfluencerStore.compareGeneratedAssetVersions(
        request.params.id,
        request.params.assetId,
      ));
    } catch (error) {
      next(error);
    }
  },
);

app.post(
  "/api/virtual-influencer/profiles/:id/references",
  requireVirtualInfluencerEnabled,
  upload.single("referenceImage"),
  (request, response, next) => {
    try {
      if (!request.file) throw new Error("Carica una reference identitaria.");
      validateUploadSize(request.file, maxUploadMb, "La reference");
      response.status(201).json(virtualInfluencerStore.addReference(request.params.id, request.file, request.body));
    } catch (error) {
      next(error);
    }
  },
);

app.patch(
  "/api/virtual-influencer/profiles/:id/references/:assetId",
  requireVirtualInfluencerEnabled,
  (request, response, next) => {
    try {
      response.json(virtualInfluencerStore.updateReference(
        request.params.id,
        request.params.assetId,
        request.body,
      ));
    } catch (error) {
      next(error);
    }
  },
);

app.delete(
  "/api/virtual-influencer/profiles/:id/references/:assetId",
  requireVirtualInfluencerEnabled,
  (request, response, next) => {
    try {
      response.json(virtualInfluencerStore.removeReference(request.params.id, request.params.assetId));
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  "/api/virtual-influencer/assets/:profileId/:assetId",
  requireVirtualInfluencerEnabled,
  (request, response, next) => {
    try {
      const match = virtualInfluencerStore.assetPath(request.params.profileId, request.params.assetId);
      if (!match) {
        response.status(404).json({ error: "Reference non trovata." });
        return;
      }
      streamMediaFile(request, response, match, match.asset.filename, request.query.download === "1");
    } catch (error) {
      next(error);
    }
  },
);

app.get("/api/scene-integration/config", async (_request, response) => {
  response.json(await sceneIntegration.capabilities());
});

app.post("/api/scene-integration/analyze", upload.single("sceneSource"), async (request, response, next) => {
  try {
    const file = request.file;
    if (!file) throw new Error("Carica una sorgente da analizzare.");
    validateUploadSize(
      file,
      file.mimetype.startsWith("video/") ? maxVideoUploadMb : maxUploadMb,
      "La sorgente",
    );
    let settings = request.body.settings || {};
    if (typeof settings === "string" && settings.trim()) settings = JSON.parse(settings);
    const result = await sceneIntegration.analyzeBuffer(file, settings);
    const depthReady = result.profile.spatialProfile?.depthMap?.method === "DepthAnythingV2-VITS";
    const segmentationReady = Boolean(result.profile.masks?.subject);
    if (
      (result.profile.analysisSettings?.depth && !depthReady)
      || (result.profile.analysisSettings?.segmentation && !segmentationReady)
    ) {
      result.profile = scheduleComfyProfileAnalysis(result.profile, file);
      result.analysisPending = true;
    }
    response.status(result.analysisPending ? 202 : result.cached ? 200 : 201).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/scene-integration/profiles/:id", async (request, response, next) => {
  try {
    const profile = sceneIntegration.getProfile(request.params.id);
    response.json(await reconcileSceneProfileAnalysis(profile));
  } catch (error) {
    next(error);
  }
});

app.get("/api/scene-integration/profiles/:id/export", (request, response, next) => {
  try {
    const profile = sceneIntegration.getProfile(request.params.id);
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="scene-profile-${profile.id}.json"`);
    response.send(JSON.stringify(profile, null, 2));
  } catch (error) {
    next(error);
  }
});

app.post("/api/scene-integration/profiles/import", (request, response, next) => {
  try {
    const profile = sceneIntegration.importProfile(request.body?.profile || request.body);
    response.status(201).json(profile);
  } catch (error) {
    next(error);
  }
});

app.get("/api/scene-integration/artifacts/:profileId/:name", (request, response, next) => {
  try {
    const file = sceneIntegration.artifact(request.params.profileId, request.params.name);
    if (!file) return response.status(404).json({ error: "Artefatto non trovato." });
    response.type(path.extname(file));
    fs.createReadStream(file)
      .once("error", next)
      .pipe(response);
  } catch (error) {
    next(error);
  }
});

app.get("/api/scene-integration/profiles/:id/source", (request, response, next) => {
  try {
    const profile = sceneIntegration.getProfile(request.params.id);
    if (!profile.analysisSettings?.debugArtifacts) {
      return response.status(404).json({ error: "Sorgente debug non esposta per questo profilo." });
    }
    const file = sceneIntegration.sourceFile(profile.id);
    if (!file) return response.status(404).json({ error: "Sorgente non trovata." });
    response.type(path.extname(file));
    fs.createReadStream(file)
      .once("error", next)
      .pipe(response);
  } catch (error) {
    next(error);
  }
});

app.get("/api/health", async (_request, response) => {
  try {
    const stats = await comfy.health();
    response.json({ connected: true, stats });
  } catch (error) {
    response.status(503).json({ connected: false, error: error.message });
  }
});

app.get("/api/events", (request, response) => {
  response.setHeader("content-type", "text/event-stream");
  response.setHeader("cache-control", "no-cache");
  response.setHeader("connection", "keep-alive");
  response.flushHeaders();
  response.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
  events.add(response);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
  request.on("close", () => {
    clearInterval(heartbeat);
    events.delete(response);
  });
});

app.post("/api/edit-wildcards/random", (request, response, next) => {
  try {
    const result = pickEditWildcardPrompt(root, {
      family: String(request.body.family || "gwen"),
      mode: String(request.body.mode || "replace"),
      base: String(request.body.base || ""),
      seed: request.body.seed,
      maxLength: Number(request.body.maxLength || 1400),
    });
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/generations", (_request, response) => response.json(store.list()));

app.post("/api/generations/archive", (request, response) => {
  try {
    const archived = request.body?.archived;
    if (typeof archived !== "boolean") {
      return response.status(400).json({ error: "Stato archivio non valido." });
    }
    const generations = setGenerationsArchived({
      store,
      ids: request.body?.ids,
      archived,
    });
    for (const generation of generations) {
      broadcast({
        type: "generation_updated",
        generationId: generation.id,
        projectId: generation.projectId || null,
        data: generation,
      });
    }
    response.json({ generations });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.get("/api/studio/projects", (_request, response) => {
  response.json(studioStore.list().map(studioProjectView));
});

app.get("/api/studio/projects/:id", (request, response) => {
  const project = studioStore.get(request.params.id);
  if (!project) return response.status(404).json({ error: "Progetto Studio non trovato." });
  response.json(studioProjectView(project));
});

app.get("/api/video-studio/projects", (_request, response) => {
  response.json(videoStudioStore.list().map(videoStudioProjectView));
});

app.get("/api/video-studio/projects/:id", (request, response) => {
  const project = videoStudioStore.get(request.params.id);
  if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
  response.json(videoStudioProjectView(project));
});

app.post("/api/video-studio/projects", upload.any(), async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const config = await videoStudioRuntimeConfig();
    const selectedLoras = parseLoras(request.body.loras);
    if (selectedLoras.length) validateLoras(selectedLoras, config.ltxLoras);
    const uploaded = await uploadVideoStudioFiles(request.files || []);
    const influencer = await uploadVirtualInfluencerSelection(request.body.virtualInfluencerId, 1);
    if (influencer?.uploads[0]) {
      if (!uploaded.identityImage) uploaded.identityImage = influencer.uploads[0];
      if (!uploaded.referenceSheet) uploaded.referenceSheet = influencer.uploads[0];
      request.body = withVirtualInfluencerPrompt(request.body, influencer);
    }
    let job = buildVideoStudioInitialJob(
      request.body.videoStudioMode,
      request.body,
      uploaded,
      selectedLoras,
      config,
    );
    job = await integrateSceneJob(job, request.body, {
      trackedMask: request.body.videoStudioMode === "actorReplacement",
    });
    const project = videoStudioStore.add({
      id: crypto.randomUUID(),
      videoStudioMode: request.body.videoStudioMode,
      name: String(request.body.projectName || job.metadata.workflowName || "Progetto Video Studio").trim(),
      prompt: String(request.body.prompt || "").trim(),
      settings: { ...request.body, loras: undefined },
      uploads: uploaded,
      loras: selectedLoras,
      status: "queued",
      generationIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const generation = await queueStudioJob(job, project.id);
    const updated = videoStudioStore.update(project.id, {
      generationIds: [generation.id],
      updatedAt: new Date().toISOString(),
    });
    broadcast({
      type: "video_studio_project_created",
      projectId: project.id,
      data: videoStudioProjectView(updated),
    });
    response.status(202).json(videoStudioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/projects/:id/lipdub", async (request, response, next) => {
  try {
    cancelIdlePurge();
    const project = videoStudioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
    const requested = request.body.generationId ? store.get(String(request.body.generationId)) : null;
    const generations = (project.generationIds || []).map((id) => store.get(id)).filter(Boolean);
    const generation = requested || [...generations].reverse().find((item) =>
      item.status === "completed" && item.videos?.length
    );
    if (!generation || generation.projectId !== project.id || !generation.videos?.length) {
      throw new Error("Completa prima uno stadio video del progetto.");
    }
    const selectedUpload = await comfy.reuseOutputFile(
      generation.videos.at(-1),
      `video-studio-${project.id}.mp4`,
      "video/mp4",
    );
    const config = await videoStudioRuntimeConfig();
    const job = buildVideoStudioLipdubJob(
      { ...project.settings, ...request.body },
      selectedUpload,
      project.loras || [],
      config,
    );
    const created = await queueStudioJob(job, project.id);
    const updated = videoStudioStore.update(project.id, {
      generationIds: [...(project.generationIds || []), created.id],
      updatedAt: new Date().toISOString(),
    });
    response.status(202).json(videoStudioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/studio/projects", upload.any(), async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const selectedLoras = parseLoras(request.body.loras);
    if (selectedLoras.length) {
      const loraInfo = await comfy.objectInfo("LoraLoaderModelOnly");
      validateLoras(
        selectedLoras,
        comboOptions(loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name),
      );
    }
    const uploaded = await uploadStudioFiles(request.files || []);
    const influencer = await uploadVirtualInfluencerSelection(request.body.virtualInfluencerId, 4);
    if (influencer?.uploads.length) {
      if (!uploaded.source?.name && ["perfect", "bible", "qwenKreaKlein"].includes(request.body.studioMode)) {
        uploaded.source = influencer.uploads[0];
        uploaded.references = [...influencer.uploads.slice(1), ...(uploaded.references || [])].slice(0, 3);
      } else {
        uploaded.references = [...influencer.uploads, ...(uploaded.references || [])].slice(0, 3);
      }
      request.body = withVirtualInfluencerPrompt(request.body, influencer);
    }
    let jobs = buildStudioJobs(request.body.studioMode, request.body, uploaded, selectedLoras);
    jobs = await Promise.all(jobs.map((job) => integrateSceneJob(job, request.body, {
      maskUpload: uploaded.mask || null,
      structureGuideAvailable: Boolean(uploaded.guide),
    })));
    await validateStudioModels(jobs);
    const project = studioStore.add({
      id: crypto.randomUUID(),
      studioMode: request.body.studioMode,
      name: String(request.body.projectName || jobs[0]?.metadata?.workflowName || "Progetto Studio").trim(),
      prompt: String(request.body.prompt || "").trim(),
      executionMode: request.body.studioMode === "perfect"
        && request.body.executionMode === "automatic"
        ? "automatic"
        : "guided",
      autoState: "drafts",
      settings: { ...request.body, loras: undefined },
      uploads: uploaded,
      loras: selectedLoras,
      status: "queued",
      generationIds: [],
      selections: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const created = [];
    for (const job of jobs) {
      created.push(await queueStudioJob(job, project.id));
    }
    const updated = studioStore.update(project.id, {
      generationIds: created.map((item) => item.id),
      updatedAt: new Date().toISOString(),
    });
    broadcast({ type: "studio_project_created", projectId: project.id, data: studioProjectView(updated) });
    response.status(202).json(studioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/studio/projects/:id/continue", async (request, response, next) => {
  try {
    cancelIdlePurge();
    const project = studioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Studio non trovato." });
    const generation = store.get(String(request.body.generationId || ""));
    if (!generation || generation.projectId !== project.id) {
      throw new Error("La generazione selezionata non appartiene a questo progetto.");
    }
    if (generation.status !== "completed" || !generation.images?.length) {
      throw new Error("Il risultato selezionato non è ancora disponibile.");
    }
    const index = Number.isInteger(Number(request.body.imageIndex))
      ? Number(request.body.imageIndex)
      : generation.images.length - 1;
    const file = generation.images[index];
    if (!file) throw new Error("Immagine selezionata non trovata.");
    const selectedUpload = await comfy.reuseOutputImage(file, `studio-${project.id}.png`);
    const selectedLoras = parseLoras(request.body.loras);
    if (selectedLoras.length) {
      const loraInfo = await comfy.objectInfo("LoraLoaderModelOnly");
      validateLoras(
        selectedLoras,
        comboOptions(loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name),
      );
    }
    const job = buildStudioContinuation(request.body.action, {
      ...project.settings,
      ...request.body,
      studioMode: project.studioMode,
      prompt: request.body.prompt || project.prompt,
      editScope: request.body.editScope || project.settings?.editScope,
      maskUpload: project.uploads?.mask,
      maskTarget: request.body.maskTarget || project.settings?.maskTarget,
      referenceUploads: project.uploads?.references || [],
    }, selectedUpload, selectedLoras);
    await validateStudioModels([job]);
    const created = await queueStudioJob(job, project.id);
    const updated = studioStore.update(project.id, {
      generationIds: [...(project.generationIds || []), created.id],
      selections: [
        ...(project.selections || []),
        {
          generationId: generation.id,
          imageIndex: index,
          action: request.body.action,
          createdAt: new Date().toISOString(),
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    response.status(202).json(studioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/studio/projects/:id/animate-storyboard", async (request, response, next) => {
  try {
    cancelIdlePurge();
    const project = studioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Studio non trovato." });
    const shots = (project.generationIds || [])
      .map((id) => store.get(id))
      .filter((item) =>
        item?.studioStage === "storyboard"
        && item.status === "completed"
        && item.images?.length
      )
      .sort((a, b) => Number(a.shotIndex) - Number(b.shotIndex));
    if (shots.length < 2) throw new Error("Servono almeno due shot storyboard completati.");
    const selectedLoras = parseLoras(request.body.loras);
    if (selectedLoras.length) {
      const loraInfo = await comfy.objectInfo("LoraLoaderModelOnly");
      validateLoras(
        selectedLoras,
        comboOptions(loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name),
      );
    }
    const created = [];
    for (let index = 0; index < shots.length - 1; index += 1) {
      const firstFile = shots[index].images.at(-1);
      const lastFile = shots[index + 1].images.at(-1);
      const [first, last] = await Promise.all([
        comfy.reuseOutputImage(firstFile, `shot-${index + 1}.png`),
        comfy.reuseOutputImage(lastFile, `shot-${index + 2}.png`),
      ]);
      const job = buildFirstLastWorkflow({
        ...request.body,
        prompt: request.body.prompt || `Transition from ${shots[index].shotTitle} to ${shots[index + 1].shotTitle}.`,
        resolution: request.body.resolution || "480p",
        orientation: request.body.orientation || shots[index].orientation || "landscape",
        duration: Number(request.body.duration || 5),
      }, first, last, selectedLoras.filter((item) =>
        String(item.name).toUpperCase().startsWith("LTX2.3\\")
      ));
      job.metadata = {
        ...job.metadata,
        studioMode: "firstLast",
        studioStage: "animation",
        studioLabel: `${shots[index].shotTitle} → ${shots[index + 1].shotTitle}`,
        shotPair: [shots[index].shotIndex, shots[index + 1].shotIndex],
      };
      created.push(await queueStudioJob(job, project.id));
    }
    const updated = studioStore.update(project.id, {
      generationIds: [...(project.generationIds || []), ...created.map((item) => item.id)],
      updatedAt: new Date().toISOString(),
    });
    response.status(202).json(studioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.get("/api/generations/:id", (request, response) => {
  const item = store.get(request.params.id);
  if (!item) return response.status(404).json({ error: "Generazione non trovata." });
  response.json(item);
});

app.post("/api/generations", upload.any(), async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const files = request.files || [];
    const generationType = request.body.generationType === "image"
      ? "image"
      : request.body.generationType === "upscale"
        ? "upscale"
        : "video";
    const selectedLoras = generationType === "upscale" ? [] : parseLoras(request.body.loras);
    if (selectedLoras.length) {
      const loraInfo = await comfy.objectInfo("LoraLoaderModelOnly");
      const installedLoras = comboOptions(loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name);
      validateLoras(selectedLoras, installedLoras);
    }
    let uploaded = null;
    let directorScenes = [];
    let availableUpscaleModels = [];
    const influencer = generationType === "upscale"
      ? null
      : await uploadVirtualInfluencerSelection(request.body.virtualInfluencerId, 4);
    if (influencer) request.body = withVirtualInfluencerPrompt(request.body, influencer);

    if (generationType === "image") {
      const definition = imageModelSelection(request.body.imageModelId, request.body.imageModelFile);
      const modelLoader = definition.loader === "checkpoint" ? "CheckpointLoaderSimple" : "UNETLoader";
      const [info, clipInfo, vaeInfo] = await Promise.all([
        comfy.objectInfo(modelLoader),
        definition.dependencies?.clip ? comfy.objectInfo("CLIPLoader") : Promise.resolve(null),
        definition.dependencies?.vae ? comfy.objectInfo("VAELoader") : Promise.resolve(null),
      ]);
      const installed = definition.loader === "checkpoint"
        ? comboOptions(info?.CheckpointLoaderSimple?.input?.required?.ckpt_name)
        : comboOptions(info?.UNETLoader?.input?.required?.unet_name);
      if (!installed.some((name) =>
        String(name).toLowerCase() === definition.modelFile.toLowerCase()
      )) {
        throw new Error(`Il modello ${definition.name} non è installato: ${definition.modelFile}`);
      }
      const installedClips = comboOptions(clipInfo?.CLIPLoader?.input?.required?.clip_name);
      if (definition.dependencies?.clip && !installedClips.some((name) =>
        String(name).toLowerCase() === definition.dependencies.clip.toLowerCase()
      )) {
        throw new Error(`Manca il text encoder Qwen: ${definition.dependencies.clip}`);
      }
      const installedVaes = comboOptions(vaeInfo?.VAELoader?.input?.required?.vae_name);
      if (definition.dependencies?.vae && !installedVaes.some((name) =>
        String(name).toLowerCase() === definition.dependencies.vae.toLowerCase()
      )) {
        throw new Error(`Manca il VAE Qwen: ${definition.dependencies.vae}`);
      }
      const enhancements = await imageEnhancementCapabilities();
      const upscaleMode = String(request.body.upscaleMode || "none");
      if (upscaleMode === "fast" && !enhancements.fastUpscale) {
        throw new Error("RealESRGAN 2× non è disponibile in questa installazione ComfyUI.");
      }
      if (upscaleMode === "seedvr2") {
        if (!enhancements.seedvr2) throw new Error("SeedVR2 non è disponibile in questa installazione ComfyUI.");
        const profile = enhancements.seedvr2Profiles.find((item) => item.id === request.body.seedvrProfile);
        if (!profile?.available) throw new Error("Il profilo SeedVR2 selezionato non è installato.");
      }
      const wantsPhasePurge = ["true", "on", "1"].includes(String(request.body.autoPurge).toLowerCase());
      if (wantsPhasePurge && upscaleMode !== "none" && !enhancements.phasePurge) {
        throw new Error("Il nodo VRAM Debug necessario al purge automatico non è disponibile.");
      }
      const imageFile = files.find((file) => file.fieldname === "sourceImage");
      if (request.body.imageMode !== "text") {
        if (imageFile?.mimetype.startsWith("image/")) {
          validateUploadSize(imageFile, maxUploadMb, "L'immagine");
          uploaded = await comfy.uploadImage(imageFile);
        } else if (influencer?.uploads[0]) {
          uploaded = influencer.uploads[0];
        } else {
          throw new Error("Carica un'immagine PNG, JPG o WebP.");
        }
      }
      if (influencer?.uploads.length) {
        request.body.referenceUploads = request.body.imageMode === "text"
          ? influencer.uploads.slice(0, 4)
          : influencer.uploads.filter((item) => item.name !== uploaded?.name).slice(0, 3);
      }
    } else if (generationType === "upscale") {
      const capabilities = await standaloneUpscaleCapabilities();
      const selectedEngine = capabilities.engines.find((engine) => engine.id === request.body.upscaleEngine);
      if (!selectedEngine?.available) {
        throw new Error("Il motore di upscaling selezionato non è disponibile.");
      }
      const imageFile = files.find((file) => file.fieldname === "upscaleImage");
      if (!imageFile || !imageFile.mimetype.startsWith("image/")) {
        throw new Error("Carica una foto PNG, JPG o WebP da ingrandire.");
      }
      validateUploadSize(imageFile, maxUploadMb, "L'immagine");
      uploaded = await comfy.uploadImage(imageFile);
      availableUpscaleModels = capabilities.models;
    } else if (request.body.workflowId === "director") {
      let storyboard;
      try {
        storyboard = JSON.parse(request.body.storyboard || "[]");
      } catch {
        throw new Error("Lo storyboard inviato non è valido.");
      }
      if (!Array.isArray(storyboard)) throw new Error("Lo storyboard inviato non è valido.");

      const uploadedByField = new Map();
      await Promise.all(files.map(async (file) => {
        validateUploadSize(file, maxUploadMb, "Un'immagine");
        uploadedByField.set(file.fieldname, await comfy.uploadImage(file));
      }));
      directorScenes = storyboard.map((scene) => ({
        id: String(scene.id || ""),
        prompt: scene.prompt,
        duration: scene.duration,
        upload: uploadedByField.get(`sceneImage_${scene.id}`) || null,
      }));
    } else if (request.body.workflowId === "editAnything") {
      const videoFile = files.find((file) => file.fieldname === "video");
      if (!videoFile || !videoFile.mimetype.startsWith("video/")) {
        throw new Error("Carica un video MP4, WebM, MOV, MKV o AVI.");
      }
      validateUploadSize(videoFile, maxVideoUploadMb, "Il video");
      uploaded = await comfy.uploadInput(videoFile);
    } else {
      const textToVideo = request.body.videoInputMode === "text"
        && WORKFLOWS[request.body.workflowId]?.supportsTextToVideo;
      if (!textToVideo) {
        const imageFile = files.find((file) => file.fieldname === "image");
        if (imageFile?.mimetype.startsWith("image/")) {
          validateUploadSize(imageFile, maxUploadMb, "L'immagine");
          uploaded = await comfy.uploadImage(imageFile);
        } else if (influencer?.uploads[0]) {
          uploaded = influencer.uploads[0];
        } else {
          throw new Error("Carica un'immagine PNG, JPG o WebP.");
        }
      }
    }

    let job = generationType === "image"
      ? buildImageWorkflow(request.body.imageModelId, request.body, uploaded, selectedLoras)
      : generationType === "upscale"
        ? buildUpscaleWorkflow(request.body, uploaded, availableUpscaleModels)
        : buildWorkflow(request.body.workflowId, request.body, uploaded, directorScenes, selectedLoras);
    if (generationType !== "upscale") {
      job = await integrateSceneJob(job, request.body);
    }
    const { workflow, metadata } = job;
    const queued = await queueValidatedWorkflow(
      workflow,
      metadata?.workflowName || metadata?.workflowId || generationType,
    );
    if (!queued.prompt_id) throw new Error("ComfyUI non ha restituito un ID di generazione.");

    const item = store.add({
      id: crypto.randomUUID(),
      promptId: queued.prompt_id,
      status: "queued",
      progress: 0,
      videos: [],
      images: [],
      createdAt: new Date().toISOString(),
      finishedAt: null,
      ...metadata,
    });
    broadcast({ type: "generation_created", generationId: item.id, data: item });
    response.status(202).json(item);
  } catch (error) {
    next(error);
  }
});

async function cancelGenerationRoute(request, response, next) {
  try {
    const item = store.get(request.params.id);
    if (!item) return response.status(404).json({ error: "Generazione non trovata." });
    const result = await cancelGeneration({ comfy, store, item });
    if (!result.cancelled && result.reason === "not-active") {
      return response.status(409).json({
        error: "La generazione non è più presente nella coda attiva. Aggiorna lo stato e riprova.",
      });
    }
    if (result.cancelled) {
      broadcast({
        type: "generation_updated",
        generationId: item.id,
        projectId: item.projectId || null,
        data: result.generation,
      });
    }
    scheduleIdlePurge();
    response.json(result.generation);
  } catch (error) {
    next(error);
  }
}

app.post("/api/generations/:id/cancel", cancelGenerationRoute);
// Alias compatibile con le versioni precedenti della webapp.
app.post("/api/generations/:id/interrupt", cancelGenerationRoute);

app.post("/api/system/:action", async (request, response, next) => {
  try {
    const actions = {
      cache: { freeMemory: true },
      models: { unloadModels: true },
      vram: { freeMemory: true },
      ram: { freeMemory: true },
      all: { unloadModels: true, freeMemory: true },
    };
    const options = actions[request.params.action];
    if (!options) return response.status(400).json({ error: "Azione non valida." });
    await comfy.free(options);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/prompt-assistant/enhance", upload.single("sourceImage"), async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Il Prompt Assistant non è configurato. Imposta LM_STUDIO_MODEL." });
    }
    const allowedTargets = new Set([
      "flux1", "flux2", "qwen", "qwenedit", "zimage", "ltx", "ltx_architect", "ltx_scenes", "ltxedit", "studio", "videostudio",
      "sulphur_ltx", "sulphur_ltx_architect", "sulphur_ltx_scenes", "sulphur_ltxedit", "sulphur_videostudio", "sulphur_prompt",
      "qwen_image_edit_architect", "flux2_klein_architect",
      "reverse_qwen", "reverse_klein",
    ]);
    const body = request.body || {};
    const target = String(body.target || "").toLowerCase();
    if (!allowedTargets.has(target)) return response.status(400).json({ error: "Workflow di destinazione non valido." });
    if (request.file) {
      if (!request.file.mimetype.startsWith("image/")) {
        return response.status(400).json({ error: "Il Prompt Assistant vision accetta PNG, JPG o WebP." });
      }
      validateUploadSize(request.file, maxUploadMb, "L'immagine");
    }

    const before = await releaseComfyMemoryIfIdle();
    const result = await promptAssistant.enhance({
      text: body.text,
      target,
      mode: String(body.mode || "text"),
      workflowName: String(body.workflowName || ""),
      image: request.file || null,
      model: (target.startsWith("sulphur_") || target === "sulphur_prompt") ? sulphurPromptAssistantModel : "",
      includeNegative: String(body.includeNegative || "").toLowerCase() === "true",
    });
    const after = await releaseComfyMemoryIfIdle();
    if (result.unloadError) {
      throw new Error(`Prompt creato, ma LM Studio non ha scaricato il modello: ${result.unloadError}`);
    }
    response.json({
      ...result,
      cleanup: {
        lmStudioModelUnloaded: true,
        comfyMemoryReleased: after.released,
        comfyMemoryReason: after.reason,
        comfyMemoryPrepared: before.released,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/prompt-assistant/director", upload.any(), async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Il Prompt Assistant non è configurato. Imposta LM_STUDIO_MODEL." });
    }
    let scenes;
    try {
      scenes = JSON.parse(request.body.scenes || "[]");
    } catch {
      throw new Error("Le scene Director inviate al Prompt Assistant non sono valide.");
    }
    if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 3) {
      throw new Error("Il Prompt Assistant Director accetta da 1 a 3 scene.");
    }
    const files = request.files || [];
    const fileByField = new Map();
    for (const file of files) {
      if (!file.mimetype.startsWith("image/")) {
        throw new Error("Il Prompt Assistant Director accetta solo immagini PNG, JPG o WebP.");
      }
      validateUploadSize(file, maxUploadMb, "Un'immagine Director");
      fileByField.set(file.fieldname, file);
    }
    const before = await releaseComfyMemoryIfIdle();
    const result = await promptAssistant.enhanceDirectorStoryboard({
      text: request.body.text,
      scenes: scenes.map((scene) => ({
        prompt: scene.prompt,
        duration: scene.duration,
        image: fileByField.get(`sceneImage_${scene.id}`) || null,
      })),
    });
    const after = await releaseComfyMemoryIfIdle();
    if (result.unloadError) {
      throw new Error(`Prompt Director creato, ma LM Studio non ha scaricato il modello: ${result.unloadError}`);
    }
    response.json({
      ...result,
      cleanup: {
        lmStudioModelUnloaded: true,
        comfyMemoryReleased: after.released,
        comfyMemoryReason: after.reason,
        comfyMemoryPrepared: before.released,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/media/:generationId/:index", async (request, response, next) => {
  try {
    const item = store.get(request.params.generationId);
    const file = item?.videos?.[Number(request.params.index)];
    if (!file) return response.status(404).json({ error: "Video non trovato." });

    const download = request.query.download === "1";
    const localFile = resolveMediaFile(outputDirectory, file);
    if (localFile) {
      streamMediaFile(request, response, localFile, file.filename, download);
      return;
    }

    // Fallback senza il body timeout di fetch/Undici.
    const upstreamUrl = new URL(comfy.mediaUrl(file));
    const transport = upstreamUrl.protocol === "https:" ? https : http;
    const headers = request.headers.range ? { range: request.headers.range } : {};
    const upstreamRequest = transport.get(upstreamUrl, { headers }, (upstream) => {
      for (const header of ["content-type", "content-length", "accept-ranges", "content-range"]) {
        const value = upstream.headers[header];
        if (value) response.setHeader(header, value);
      }
      response.setHeader("content-disposition", mediaContentDisposition(file.filename, download));
      response.status(upstream.statusCode || 200);
      upstream.on("error", (error) => response.destroy(error));
      upstream.pipe(response);
    });
    upstreamRequest.on("error", next);
    response.on("close", () => {
      if (!response.writableEnded) upstreamRequest.destroy();
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/image/:generationId/:index", async (request, response, next) => {
  try {
    const item = store.get(request.params.generationId);
    const file = item?.images?.[Number(request.params.index)];
    if (!file) return response.status(404).json({ error: "Immagine non trovata." });

    const download = request.query.download === "1";
    const localFile = resolveMediaFile(outputDirectory, file);
    if (localFile) {
      streamMediaFile(request, response, localFile, file.filename, download);
      return;
    }
    const upstreamUrl = new URL(comfy.mediaUrl(file));
    const transport = upstreamUrl.protocol === "https:" ? https : http;
    const upstreamRequest = transport.get(upstreamUrl, (upstream) => {
      for (const header of ["content-type", "content-length"]) {
        if (upstream.headers[header]) response.setHeader(header, upstream.headers[header]);
      }
      response.setHeader("content-disposition", mediaContentDisposition(file.filename, download));
      response.status(upstream.statusCode || 200);
      upstream.pipe(response);
    });
    upstreamRequest.on("error", next);
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  const status = error instanceof multer.MulterError ? 400 : Number(error.statusCode) || 500;
  response.status(status).json({ error: error.message || "Errore interno." });
});

function terminalGeneration(item) {
  return ["completed", "error", "interrupted"].includes(item?.status);
}

function automaticContinuationOptions(project, action, generation) {
  const preset = String(project.settings?.studioPreset || "quality");
  const isMax = preset === "max";
  const finalOutput = String(project.settings?.finalOutput || (isMax ? "seed7" : "seed3"));
  const upscaleMode = {
    none: "none",
    seed3: "seedvr2",
    seed7: "seedvr2",
    rtx: "rtx",
    realesrgan: "fast",
  }[finalOutput] || "seedvr2";
  return {
    ...project.settings,
    studioMode: project.studioMode,
    prompt: project.prompt,
    maskUpload: project.uploads?.mask,
    referenceUploads: project.uploads?.references || [],
    maskTarget: project.settings?.maskTarget,
    imageWidth: generation.width,
    imageHeight: generation.height,
    studioPreset: preset,
    refineDenoise: isMax ? 0.24 : 0.18,
    highresEnabled: action === "finalize" && preset !== "speed",
    highresScale: isMax ? 1.5 : 1.25,
    highresSteps: isMax ? 12 : 8,
    highresDenoise: isMax ? 0.25 : 0.2,
    upscaleMode: action === "finalize" ? upscaleMode : "none",
    rtxQuality: isMax ? "Ultra" : "High",
    seedvrProfile: finalOutput === "seed7" ? "realistic" : "balanced",
    seedvrResolution: finalOutput === "seed7" ? 2656 : 2048,
    autoPurge: true,
    saveOriginal: true,
    faceDetailer: project.settings?.faceDetailer ?? true,
    handDetailer: project.settings?.handDetailer ?? true,
  };
}

async function queueAutomaticContinuation(project, sourceGeneration, action, nextState) {
  const imageIndex = sourceGeneration.images.length - 1;
  const selectedUpload = await comfy.reuseOutputImage(
    sourceGeneration.images[imageIndex],
    `studio-auto-${project.id}-${action}.png`,
  );
  const job = buildStudioContinuation(
    action,
    automaticContinuationOptions(project, action, sourceGeneration),
    selectedUpload,
    project.loras || [],
  );
  await validateStudioModels([job]);
  const created = await queueStudioJob(job, project.id);
  studioStore.update(project.id, {
    generationIds: [...(project.generationIds || []), created.id],
    selections: [
      ...(project.selections || []),
      {
        generationId: sourceGeneration.id,
        imageIndex,
        action,
        automatic: true,
        createdAt: new Date().toISOString(),
      },
    ],
    autoState: nextState,
    updatedAt: new Date().toISOString(),
  });
}

async function advanceAutomaticStudioProjects() {
  for (const project of studioStore.list().filter((item) =>
    item.studioMode === "perfect" && item.executionMode === "automatic"
  )) {
    const generations = (project.generationIds || []).map((id) => store.get(id)).filter(Boolean);
    if (generations.some((item) => ["queued", "running"].includes(item.status))) continue;

    const quality = generations.filter((item) => item.studioStage === "quality");
    const finals = generations.filter((item) => item.studioStage === "final");
    if (!quality.length && project.autoState === "drafts") {
      const drafts = generations.filter((item) => item.studioStage === "drafts");
      if (!drafts.length || !drafts.every(terminalGeneration)) continue;
      const selected = drafts.find((item) => item.status === "completed" && item.images?.length);
      if (!selected) {
        studioStore.update(project.id, { autoState: "error", updatedAt: new Date().toISOString() });
        continue;
      }
      const speed = project.settings?.studioPreset === "speed";
      const max = project.settings?.studioPreset === "max";
      studioStore.update(project.id, {
        autoState: speed ? "final_queueing" : max ? "variation_queueing" : "quality_queueing",
        updatedAt: new Date().toISOString(),
      });
      try {
        await queueAutomaticContinuation(
          project,
          selected,
          speed ? "finalize" : max ? "variation" : "quality",
          speed ? "final" : max ? "variations" : "quality",
        );
      } catch (error) {
        studioStore.update(project.id, {
          autoState: "error",
          autoError: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    if (!quality.length && project.autoState === "variations") {
      const variations = generations.filter((item) => item.studioStage === "variations");
      if (!variations.length || !variations.every(terminalGeneration)) continue;
      const selected = variations.find((item) => item.status === "completed" && item.images?.length);
      if (!selected) {
        studioStore.update(project.id, { autoState: "error", updatedAt: new Date().toISOString() });
        continue;
      }
      studioStore.update(project.id, { autoState: "quality_queueing", updatedAt: new Date().toISOString() });
      try {
        await queueAutomaticContinuation(project, selected, "quality", "quality");
      } catch (error) {
        studioStore.update(project.id, {
          autoState: "error",
          autoError: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    if (!finals.length && quality.length && project.autoState === "quality") {
      if (!quality.every(terminalGeneration)) continue;
      const selected = quality.find((item) => item.status === "completed" && item.images?.length);
      if (!selected) {
        studioStore.update(project.id, { autoState: "error", updatedAt: new Date().toISOString() });
        continue;
      }
      studioStore.update(project.id, { autoState: "final_queueing", updatedAt: new Date().toISOString() });
      try {
        await queueAutomaticContinuation(project, selected, "finalize", "final");
      } catch (error) {
        studioStore.update(project.id, {
          autoState: "error",
          autoError: error.message,
          updatedAt: new Date().toISOString(),
        });
      }
      continue;
    }
    if (finals.length && finals.every(terminalGeneration) && project.autoState === "final") {
      studioStore.update(project.id, {
        autoState: finals.some((item) => item.status === "completed") ? "done" : "error",
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

let polling = false;
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    const pending = store.list().filter((item) => ["queued", "running"].includes(item.status));
    let queueIds = null;
    try {
      queueIds = comfyQueuePromptIds(await comfy.queueStatus());
    } catch {
      // Senza lo stato della coda non chiudiamo job potenzialmente ancora attivi.
    }
    for (const item of pending) {
      try {
        const payload = await comfy.history(item.promptId);
        const entry = payload?.[item.promptId];
        if (!entry) {
          const patch = queueIds
            ? missingGenerationPatch(item, queueIds)
            : null;
          if (patch) {
            const updated = store.update(item.id, patch);
            broadcast({ type: "generation_updated", generationId: item.id, data: updated });
            if (patch.finishedAt) scheduleIdlePurge();
          }
          continue;
        }
        const videos = extractVideos(entry);
        const images = extractImages(entry);
        const completed = entry.status?.completed === true;
        const statusText = entry.status?.status_str;
        if (videos.length || images.length) {
          const isImageGeneration = item.mediaType === "image"
            || ["image", "upscale"].includes(item.generationType);
          const inspectedImages = isImageGeneration
            ? inspectImageFiles(outputDirectory, images)
            : [];
          const invalidImage = inspectedImages.find((imageInfo) =>
            imageInfo.width != null
            && (imageInfo.width < 8 || imageInfo.height < 8
              || imageInfo.width > 32_768 || imageInfo.height > 32_768)
          );
          if (invalidImage) {
            const updated = store.update(item.id, {
              status: "error",
              progress: 100,
              videos,
              images,
              imageDimensions: inspectedImages.map(({ file, width, height }) => ({
                filename: file.filename,
                width: width ?? null,
                height: height ?? null,
              })),
              error: `ComfyUI ha prodotto un'immagine con dimensioni non valide (${invalidImage.width}×${invalidImage.height}). Il risultato è stato bloccato per evitare di considerare riuscito un output corrotto.`,
              finishedAt: new Date().toISOString(),
            });
            broadcast({ type: "generation_updated", generationId: item.id, data: updated });
            scheduleIdlePurge();
            continue;
          }
          const primaryImage = inspectedImages.find((imageInfo) => imageInfo.width && imageInfo.height);
          const expectedWidth = item.imageSettings?.finalWidth || item.width;
          const expectedHeight = item.imageSettings?.finalHeight || item.height;
          const expectedRatio = expectedWidth && expectedHeight ? expectedWidth / expectedHeight : null;
          const actualRatio = primaryImage ? primaryImage.width / primaryImage.height : null;
          const ratioDrift = expectedRatio && actualRatio
            ? Math.abs(actualRatio / expectedRatio - 1)
            : 0;
          const updated = store.update(item.id, {
            status: "completed",
            progress: 100,
            videos,
            images,
            imageDimensions: inspectedImages.map(({ file, width, height }) => ({
              filename: file.filename,
              width: width ?? null,
              height: height ?? null,
            })),
            outputWidth: primaryImage?.width || null,
            outputHeight: primaryImage?.height || null,
            dimensionWarning: ratioDrift > 0.05
              ? `L'output reale ${primaryImage.width}×${primaryImage.height} ha proporzioni diverse da quelle richieste ${expectedWidth}×${expectedHeight}.`
              : null,
            imageSettings: item.imageSettings && primaryImage
              ? {
                  ...item.imageSettings,
                  finalWidth: primaryImage.width,
                  finalHeight: primaryImage.height,
                }
              : item.imageSettings,
            finishedAt: new Date().toISOString(),
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          const influencerAsset = virtualInfluencerStore.updateGeneratedAssetFromGeneration(updated);
          if (influencerAsset) {
            broadcast({
              type: "virtual_influencer_asset_updated",
              profileId: influencerAsset.profile.id,
              data: influencerAsset.asset,
            });
          }
          if (updated.sceneIntegration?.enabled) {
            const mediaFile = primaryImage?.file || videos.at(-1);
            const localPath = primaryImage?.path
              || resolveMediaFile(outputDirectory, videos.at(-1))?.path
              || null;
            // La valutazione può includere analisi video e face embedding CPU:
            // non deve bloccare il polling globale né l'aggiornamento della pagina.
            void finalizeSceneIntegration(updated, mediaFile, localPath);
          }
          scheduleIdlePurge();
        } else if (completed) {
          const updated = store.update(item.id, {
            status: "error",
            error: "ComfyUI ha completato il workflow ma non ha prodotto nessun file visualizzabile o scaricabile.",
            finishedAt: new Date().toISOString(),
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          scheduleIdlePurge();
        } else if (statusText === "error") {
          const updated = store.update(item.id, {
            status: "error",
            error: "ComfyUI ha terminato il workflow con un errore.",
            finishedAt: new Date().toISOString(),
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          scheduleIdlePurge();
        }
      } catch {
        // ComfyUI può essere temporaneamente occupato o non raggiungibile.
      }
    }
    await advanceAutomaticStudioProjects();
  } finally {
    polling = false;
  }
}, 2000);

const server = app.listen(port, host, () => {
  console.log(`LTX Remote Studio: http://${host}:${port}`);
  console.log(`ComfyUI: ${process.env.COMFY_URL || "http://127.0.0.1:8188"}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
