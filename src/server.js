import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { ComfyClient, extractImages, extractVideos } from "./comfy-client.js";
import { editWildcardConfig, pickEditWildcardPrompt } from "./edit-wildcards.js";
import { cancelGeneration } from "./generation-cancellation.js";
import { setGenerationsArchived } from "./generation-archive.js";
import {
  cleanupCandidates,
  cleanupMode,
  estimateGenerationCleanup,
  queryGenerations,
} from "./generation-library.js";
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
  buildLtxUpscaleWorkflow,
  ltxUpscaleConfig,
  LTX_UPSCALE_REQUIRED_NODES,
} from "./ltx-upscale-workflows.js";
import {
  buildSeedvr2VideoUpscaleWorkflow,
  seedvr2VideoUpscaleConfig,
  SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES,
} from "./seedvr2-video-upscale-workflows.js";
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
import { planSubjectInsertion, subjectInsertionResult } from "./subject-insertion/index.js";
import { CharacterStore } from "./characters.js";
import {
  buildCharacterAnchorFrameRequest,
  resolveCharacterAdapter,
  uploadCharacterReferences,
  withCharacterPrompt,
} from "./character-adapters.js";
import {
  SequentialStoryService,
  SequentialStoryStore,
  cosineSimilarity,
  fingerprintFromPgm,
  validateSequentialStoryPlan,
} from "./sequential-story.js";
import {
  InteractiveCastOrchestrator,
  InteractiveCastProjectStore,
  validateInteractiveCastAssistantPlan,
} from "./interactive-cast/index.js";
import { GpuResourceManager } from "./gpu-resource-manager.js";

dotenv.config();

const execFile = promisify(execFileCallback);

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
const clientId = crypto.randomUUID();
const app = express();
const events = new Set();
const store = new HistoryStore(path.join(root, ".data", "history.json"));
const studioStore = new HistoryStore(path.join(root, ".data", "studio-projects.json"));
const videoStudioStore = new HistoryStore(path.join(root, ".data", "video-studio-projects.json"));
const interactiveCastStore = new InteractiveCastProjectStore({
  file: path.join(root, ".data", "interactive-cast-projects.json"),
  assetDirectory: path.join(root, ".data", "interactive-cast-assets"),
});
const sequentialStoryStore = new SequentialStoryStore({
  file: path.join(root, ".data", "sequential-stories.json"),
  assetDirectory: path.join(root, ".data", "sequential-story-assets"),
});
const characterStore = new CharacterStore({
  dataDirectory: path.join(root, ".data"),
});
const sceneIntegration = new SceneIntegrationService({
  root,
  dataDirectory: path.join(root, ".data"),
  enabled: sceneIntegrationEnabled,
  python: process.env.SCENE_ANALYSIS_PYTHON,
});
const interactiveCast = new InteractiveCastOrchestrator({
  root,
  store: interactiveCastStore,
  characterStore,
});
const gpuResourceManager = new GpuResourceManager({
  releaseComfyMemory: releaseComfyMemoryIfIdle,
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
        const firstRunningEvent = record.status !== "running" && !record.startedAt;

        if (firstRunningEvent) {
          store.update(record.id, {
            status: "running",
            progress,
            startedAt: new Date().toISOString(),
          });
        } else if (record.status !== "running" || record.progress !== progress) {
          // Gli aggiornamenti live successivi restano in memoria.
          store.update(record.id, { status: "running", progress }, { persist: false });
        }
      } else if (
        event.type === "executing"
        && event.data?.node
        && record.status !== "running"
      ) {
        const patch = { status: "running" };
        if (!record.startedAt) patch.startedAt = new Date().toISOString();

        // Il primo passaggio a running viene persistito una sola volta.
        store.update(record.id, patch, { persist: Boolean(patch.startedAt) });
      } else if (event.type === "execution_error") {
        const finishedAt = new Date().toISOString();
        const startedAtMs = Date.parse(record.startedAt || "");
        const finishedAtMs = Date.parse(finishedAt);

        store.update(record.id, {
          status: "error",
          error: event.data?.exception_message || "Errore durante la generazione.",
          finishedAt,
          durationMs: Number.isFinite(startedAtMs)
            ? Math.max(0, finishedAtMs - startedAtMs)
            : null,
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

function isActiveStatus(status) {
  return ["queued", "running"].includes(status);
}

function videoStudioProjectGenerations(project) {
  return (project?.generationIds || [])
    .map((id) => store.get(id))
    .filter(Boolean);
}

function videoStudioProjectIsActive(project) {
  return videoStudioProjectGenerations(project).some((item) => isActiveStatus(item.status));
}

function removeGeneratedMediaFiles(generations) {
  if (!outputDirectory) return { deleted: [], skipped: [], warning: "OUTPUT_DIRECTORY non configurata." };
  const deleted = [];
  const skipped = [];
  const seen = new Set();
  for (const generation of generations) {
    for (const file of [...(generation.images || []), ...(generation.videos || [])]) {
      const match = resolveMediaFile(outputDirectory, file);
      if (!match?.path || seen.has(match.path)) continue;
      seen.add(match.path);
      try {
        fs.rmSync(match.path, { force: true });
        deleted.push(match.path);
      } catch (error) {
        skipped.push({ path: match.path, error: error.message });
      }
    }
  }
  return { deleted, skipped, warning: null };
}

function generationMediaResolver(media) {
  return outputDirectory ? resolveMediaFile(outputDirectory, media) : null;
}

function cleanupGenerationMedia(generations) {
  const media = removeGeneratedMediaFiles(generations);
  const patches = new Map();
  for (const generation of generations) {
    patches.set(generation.id, {
      images: [],
      videos: [],
      mediaDeleted: true,
      mediaDeletedAt: new Date().toISOString(),
    });
  }
  store.patchMany(patches);
  return media;
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

function recordSequentialStoryFinal(project) {
  const item = store.add({
    id: crypto.randomUUID(),
    promptId: null,
    projectId: project.id,
    status: "completed",
    progress: 100,
    videos: project.finalVideo ? [project.finalVideo] : [],
    images: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: new Date().toISOString(),
    generationType: "sequentialStoryFinal",
    workflowId: "videoStudio:sequentialStory",
    workflowName: "Sequential Story · finale",
    prompt: project.title,
    sequentialStoryId: project.id,
    sceneCount: project.scenes?.length || 0,
    totalDuration: project.totalDuration,
    concatMode: project.concatMode,
  });
  broadcast({ type: "generation_created", generationId: item.id, projectId: project.id, data: item });
  return item;
}

function maybeRegisterCharacterSheet(generation, primaryImage) {
  if (generation.generationType !== "characterSheet" || generation.characterSheetImported) return null;
  if (!generation.characterId || !primaryImage?.path) return null;
  const result = characterStore.addReferenceFromPath(generation.characterId, primaryImage.path, {
    type: "sheet",
    status: "approved",
    tags: [
      "generated character sheet",
      generation.characterSheetWorkflow,
      generation.workflowName,
    ].filter(Boolean).join(","),
  });
  return {
    character: result.character,
    reference: result.reference,
  };
}

async function waitForGenerationRecord(generationId, timeoutMs = 30 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = store.get(generationId);
    if (item && !["queued", "running"].includes(item.status)) return item;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timeout durante una generazione Sequential Story ausiliaria.");
}

function uploadLocalImageForComfy(filePath) {
  const buffer = fs.readFileSync(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const mimetype = extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".webp"
      ? "image/webp"
      : "image/png";
  return comfy.uploadImage({
    buffer,
    mimetype,
    originalname: path.basename(filePath),
    size: buffer.length,
  });
}

async function uploadSequentialCharacterReferences(characterId, limit = 3) {
  if (!characterId) return [];
  const selection = await uploadCharacterReferences({
    characterStore,
    comfy,
    characterId,
    limit,
  }).catch(() => null);
  return selection?.uploads || [];
}

async function generateSequentialAnchorFrame({
  project,
  scene,
  sceneIndex,
  previousFrame,
  prompt,
  seed,
}) {
  if (!outputDirectory) throw new Error("OUTPUT_DIRECTORY non configurata per anchor frame.");
  const characterUploads = await uploadSequentialCharacterReferences(project.settings?.characterId, 3);
  const previousUpload = previousFrame?.path
    ? await uploadLocalImageForComfy(previousFrame.path)
    : null;
  const sourceUpload = previousUpload || characterUploads[0] || null;
  if (!sourceUpload) {
    return { status: "anchor unavailable: no continuity frame or character reference" };
  }
  const referenceUploads = previousUpload ? characterUploads : characterUploads.slice(1);
  const anchorPrompt = [
    "Create a clean still anchor frame for the next LTX image-to-video scene.",
    "Preserve identity, face geometry, hairstyle, body proportions, wardrobe continuity, camera angle and lighting unless the scene explicitly changes them.",
    "Use the supplied image as the visual continuity source, not as a loose inspiration.",
    prompt,
  ].join("\n");
  const job = buildImageWorkflow(project.settings.anchorImageModelId || "qwenEdit", {
    imageMode: "image",
    imageModelFile: project.settings.anchorImageModelFile || "",
    imageResolution: "custom",
    imageWidth: project.settings.orientation === "portrait" ? 832 : 1152,
    imageHeight: project.settings.orientation === "portrait" ? 1152 : 832,
    imageSteps: project.settings.quality === "preview" ? 8 : 16,
    imageGuidance: 1,
    denoise: previousUpload ? 0.32 : 0.48,
    batchSize: 1,
    prompt: anchorPrompt,
    negativePrompt: scene.negativePrompt,
    seed,
    referenceUploads,
    outputBase: `SequentialStory/${project.id}/anchor`,
    saveOriginal: false,
    upscaleMode: "none",
  }, sourceUpload, []);
  job.metadata = {
    ...job.metadata,
    workflowId: "videoStudio:sequentialStory:anchor",
    workflowName: `Sequential Story · anchor scena ${scene.index}`,
    generationType: "sequentialStoryAnchor",
    sequentialStoryId: project.id,
    sceneId: scene.id,
    sceneIndex: scene.index,
    sceneCount: project.scenes.length,
    prompt: anchorPrompt,
    negativePrompt: scene.negativePrompt,
    seed,
  };
  const queued = await queueStudioJob(job, project.id);
  const generation = await waitForGenerationRecord(queued.id);
  if (generation.status !== "completed" || !generation.images?.length) {
    throw new Error(generation.error || "Anchor frame non prodotto.");
  }
  const image = generation.images.at(-1);
  const resolved = resolveMediaFile(outputDirectory, image);
  if (!resolved) throw new Error("Anchor frame non trovato su disco.");
  const upload = await uploadLocalImageForComfy(resolved.path);
  return {
    status: "anchor generated",
    generationId: generation.id,
    upload,
    file: {
      ...image,
      path: resolved.path,
      type: "sequential-story-anchor",
    },
  };
}

const sequentialStoryService = new SequentialStoryService({
  store: sequentialStoryStore,
  promptAssistant,
  buildWorkflow,
  queueJob: queueStudioJob,
  generationStore: store,
  comfy,
  outputDirectory,
  broadcast,
  recordFinalVideo: recordSequentialStoryFinal,
  anchorFrameGenerator: generateSequentialAnchorFrame,
});

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

async function uploadCharacterSelection(raw, context = {}, limit = 1) {
  const characterId = String(raw.characterId || "").trim();
  if (!characterId) return null;
  const selection = await uploadCharacterReferences({
    characterStore,
    comfy,
    characterId,
    limit,
  });
  const adapter = resolveCharacterAdapter({
    ...context,
    character: selection.character,
    options: {
      identityStrength: raw.identityStrength,
      lockFace: raw.lockFace,
      lockHair: raw.lockHair,
      lockBody: raw.lockBody,
      lockOutfit: raw.lockOutfit,
    },
  });
  return { ...selection, adapter };
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

function interactiveCastSegmentTask(project, segmentId) {
  const task = (project.renderPackage?.segmentTasks?.tasks || [])
    .find((item) => item.segmentId === segmentId);
  if (!task) throw new Error("Task generativo Interactive Cast non trovato.");
  return task;
}

async function uploadInteractiveCastActorReferences(project, limit = 2) {
  const uploads = [];
  for (const actor of project.actors?.added || []) {
    if (uploads.length >= limit) break;
    if (actor.type === "characterPack") {
      const characterId = String(actor.actorId || "").replace(/^character:/, "");
      const selection = await uploadCharacterReferences({
        characterStore,
        comfy,
        characterId,
        limit: limit - uploads.length,
      }).catch(() => null);
      uploads.push(...(selection?.uploads || []));
      continue;
    }
    const referencePath = actor.reference?.relativePath
      ? interactiveCastStore.assetPath(project.id, actor.reference.relativePath)
      : actor.reference?.path;
    if (!referencePath || !fs.existsSync(referencePath)) continue;
    const buffer = fs.readFileSync(referencePath);
    uploads.push(await comfy.uploadImage({
      buffer,
      mimetype: actor.reference?.mimeType || "image/png",
      originalname: actor.reference?.originalName || path.basename(referencePath),
      size: buffer.length,
    }));
  }
  return uploads.slice(0, limit);
}

function interactiveCastVideoResolution(project, requested = "") {
  if (["360p", "480p", "720p"].includes(requested)) return requested;
  const longest = Math.max(Number(project.analysis?.width || 0), Number(project.analysis?.height || 0));
  if (longest >= 1100) return "720p";
  if (longest >= 720) return "480p";
  return "360p";
}

async function queueInteractiveCastLtxSegment({ project, task, anchorUpload, settings, sourceGenerationId }) {
  const duration = Math.max(1, Math.min(30, Math.ceil(Number(task.duration || 1))));
  const job = buildWorkflow("devfp8", {
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    resolution: interactiveCastVideoResolution(project, settings.resolution),
    orientation: Number(project.analysis?.width || 0) >= Number(project.analysis?.height || 0)
      ? "landscape"
      : "portrait",
    duration,
    quality: settings.quality === "max" ? "max" : "preview",
    seed: settings.seed,
    videoInputMode: "image",
    videoModelId: "normal",
  }, anchorUpload, [], []);
  job.metadata = {
    ...job.metadata,
    projectId: project.id,
    workflowId: "interactiveCast:ltx-segment",
    workflowName: `Interactive Cast · LTX segmento ${task.segmentId}`,
    interactiveCast: {
      projectId: project.id,
      segmentId: task.segmentId,
      phase: "video",
      anchorWorkflowId: settings.anchorWorkflowId,
      sourceGenerationId,
      settings,
    },
  };
  const generation = await queueStudioJob(job, project.id);
  interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
    status: "queued",
    phase: "video",
    generationId: generation.id,
    anchorGenerationId: sourceGenerationId,
    settings,
  });
  return generation;
}

async function queueInteractiveCastAnchorRefine({ project, task, sourceUpload, settings, sourceGenerationId }) {
  const studioMode = settings.anchorWorkflowId === "krea-triple" ? "kreaTriple" : "qwenKreaKlein";
  const jobs = buildStudioJobs(studioMode, {
    prompt: [
      "Refine this Interactive Cast anchor without changing composition or identity.",
      task.prompt,
      "Preserve all original actors, the inserted actor, framing, perspective, lighting and background exactly.",
    ].join(" "),
    negativePrompt: task.negativePrompt,
    seed: settings.seed,
    imageWidth: Number(project.analysis?.width || 1152),
    imageHeight: Number(project.analysis?.height || 896),
    kreaTripleOperation: "img2img",
    kreaTripleDenoise: settings.quality === "max" ? 0.3 : 0.2,
  }, { source: sourceUpload, references: [] }, []);
  const job = jobs[0];
  job.metadata = {
    ...job.metadata,
    projectId: project.id,
    workflowId: `interactiveCast:anchor:${settings.anchorWorkflowId}`,
    workflowName: `Interactive Cast · anchor ${settings.anchorWorkflowId}`,
    interactiveCast: {
      projectId: project.id,
      segmentId: task.segmentId,
      phase: "anchor-refine",
      anchorWorkflowId: settings.anchorWorkflowId,
      sourceGenerationId,
      settings,
    },
  };
  const generation = await queueStudioJob(job, project.id);
  interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
    status: "queued",
    phase: "anchor-refine",
    generationId: generation.id,
    baseAnchorGenerationId: sourceGenerationId,
    settings,
  });
  return generation;
}

async function startInteractiveCastSegmentGeneration(projectId, segmentId, raw = {}) {
  const project = interactiveCast.get(projectId);
  const task = interactiveCastSegmentTask(project, segmentId);
  if (task.mode !== "generative") {
    throw new Error("La generazione LTX automatica è disponibile soltanto per finestre generative.");
  }
  if (["queued", "running"].includes(task.generation?.status)) {
    const error = new Error("Questo segmento è già in generazione.");
    error.statusCode = 409;
    throw error;
  }
  if (!task.anchorFrame?.path || !fs.existsSync(task.anchorFrame.path)) {
    throw new Error("Anchor frame sorgente mancante: prepara nuovamente i segmenti.");
  }
  const settings = {
    anchorWorkflowId: task.anchorWorkflow?.id || project.settings?.anchorWorkflowId || "qwen-image-edit",
    quality: raw.quality === "max" ? "max" : "preview",
    resolution: interactiveCastVideoResolution(project, String(raw.resolution || "")),
    seed: Number.isSafeInteger(Number(raw.seed)) && Number(raw.seed) >= 0
      ? Number(raw.seed)
      : crypto.randomInt(0, 2 ** 31),
  };
  const sourceUpload = await uploadLocalImageForComfy(task.anchorFrame.path);
  const referenceUploads = await uploadInteractiveCastActorReferences(project, 2);
  const job = buildImageWorkflow("qwenEdit", {
    imageMode: "image",
    imageResolution: "custom",
    imageWidth: Math.min(4096, Math.max(256, Number(project.analysis?.width || 1152))),
    imageHeight: Math.min(4096, Math.max(256, Number(project.analysis?.height || 896))),
    imageSteps: settings.quality === "max" ? 16 : 8,
    imageGuidance: 1,
    batchSize: 1,
    prompt: [task.anchorRequirement, task.prompt].filter(Boolean).join("\n"),
    negativePrompt: task.negativePrompt,
    seed: settings.seed,
    referenceUploads,
    outputBase: `InteractiveCast/${project.id}/${segmentId}/anchor-base`,
    saveOriginal: false,
    upscaleMode: "none",
  }, sourceUpload, []);
  job.metadata = {
    ...job.metadata,
    projectId,
    workflowId: "interactiveCast:anchor:qwen-image-edit",
    workflowName: `Interactive Cast · anchor Qwen ${segmentId}`,
    interactiveCast: {
      projectId,
      segmentId,
      phase: "anchor-base",
      anchorWorkflowId: settings.anchorWorkflowId,
      referenceCount: referenceUploads.length,
      settings,
    },
  };
  const generation = await queueStudioJob(job, projectId);
  const updated = interactiveCast.updateSegmentGeneration(projectId, segmentId, {
    status: "queued",
    phase: "anchor-base",
    generationId: generation.id,
    settings,
  });
  return { project: updated, generation };
}

async function advanceInteractiveCastGeneration(generation) {
  const metadata = generation.interactiveCast;
  if (!metadata?.projectId || !metadata.segmentId) return;
  try {
    const project = interactiveCast.get(metadata.projectId);
    const task = interactiveCastSegmentTask(project, metadata.segmentId);
    if (generation.status !== "completed") {
      if (["error", "cancelled"].includes(generation.status)) {
        interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
          status: "failed",
          phase: metadata.phase,
          generationId: generation.id,
          error: generation.error || `Generazione ${generation.status}.`,
        });
      }
      return;
    }
    if (metadata.phase === "video") {
      if (!outputDirectory) throw new Error("OUTPUT_DIRECTORY non configurata per recuperare il segmento LTX.");
      const resolved = resolveMediaFile(outputDirectory, generation.videos?.at(-1));
      if (!resolved?.path) throw new Error("Video LTX Interactive Cast non trovato su disco.");
      await interactiveCast.attachGeneratedSegment(project.id, task.segmentId, {
        path: resolved.path,
        originalName: generation.videos.at(-1)?.filename || `${task.segmentId}.mp4`,
        mimeType: "video/mp4",
        generationId: generation.id,
      });
      return;
    }
    const image = generation.images?.at(-1);
    if (!image) throw new Error("Anchor Interactive Cast non prodotto.");
    const upload = await comfy.reuseOutputImage(image, `interactive-cast-${task.segmentId}-${metadata.phase}.png`);
    if (metadata.phase === "anchor-base" && metadata.anchorWorkflowId !== "qwen-image-edit") {
      await queueInteractiveCastAnchorRefine({
        project,
        task,
        sourceUpload: upload,
        settings: metadata.settings,
        sourceGenerationId: generation.id,
      });
      return;
    }
    await queueInteractiveCastLtxSegment({
      project,
      task,
      anchorUpload: upload,
      settings: metadata.settings,
      sourceGenerationId: generation.id,
    });
  } catch (error) {
    interactiveCast.updateSegmentGeneration(metadata.projectId, metadata.segmentId, {
      status: "failed",
      phase: metadata.phase,
      generationId: generation.id,
      error: error.message,
    });
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

  let ltxUpscale;
  let seedvr2VideoUpscale;

  try {
    const nodeDefinitions = await Promise.all(
      LTX_UPSCALE_REQUIRED_NODES.map((name) =>
        objectDefinition(name),
      ),
    );

    const availableNodes =
      LTX_UPSCALE_REQUIRED_NODES.filter(
        (_name, index) => Boolean(nodeDefinitions[index]),
      );

    ltxUpscale = ltxUpscaleConfig({
      availableNodes,
      installedCheckpoints: [
        ...installedImageModels,
        ...installedImageCheckpoints,
      ],
      installedLoras,
      installedTextEncoders: installedImageClips,
      installedVaes: installedImageVaes,
    });
  } catch {
    ltxUpscale = ltxUpscaleConfig();
  }

  try {
    const [
      ditInfo,
      vaeInfo,
      ...nodeDefinitions
    ] = await Promise.all([
      comfy.objectInfo("SeedVR2LoadDiTModel"),
      comfy.objectInfo("SeedVR2LoadVAEModel"),
      ...SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES.map((name) =>
        objectDefinition(name),
      ),
      objectDefinition("SeedVR2TorchCompileSettings"),
    ]);

    const requiredWithCompile = [
      ...SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES,
      "SeedVR2TorchCompileSettings",
    ];
    const availableNodes = requiredWithCompile.filter(
      (_name, index) => Boolean(nodeDefinitions[index]),
    );

    seedvr2VideoUpscale = seedvr2VideoUpscaleConfig({
      availableNodes,
      installedSeedvr2Models: comboOptions(
        ditInfo?.SeedVR2LoadDiTModel?.input?.required?.model,
      ),
      installedVaes: comboOptions(
        vaeInfo?.SeedVR2LoadVAEModel?.input?.required?.model,
      ),
    });
  } catch {
    seedvr2VideoUpscale = seedvr2VideoUpscaleConfig();
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
    ltxUpscale,
    seedvr2VideoUpscale,
    studio: studioConfig({
      modelPatches: installedModelPatches,
      preprocessors: studioPreprocessors,
    }),
    videoStudio,
    interactiveCast: await interactiveCast.capabilities(),
    promptAssistant: { ...promptAssistant.publicConfig(), autoGenerate: promptAssistantAutoGenerate },
    sulphur: sulphurRuntimeConfig(),
    editWildcards: editWildcardConfig(root),
    sceneIntegration: await sceneIntegration.capabilities(),
    characters: {
      available: true,
      conceptualName: "Virtual Actor",
      sheetWorkflows: Object.values(CHARACTER_SHEET_WORKFLOWS),
      availableCharacters: characterStore.listCharacters().map((character) => ({
        id: character.id,
        name: character.name,
        heroUrl: character.heroUrl,
        packStatus: character.packStatus,
        referenceCount: character.references?.length || 0,
        settings: character.settings,
      })),
      legacyImport: characterStore.legacySummary({ dataDirectory: path.join(root, ".data") }),
    },
  });
});

app.get("/api/characters", (_request, response) => {
  response.json({ characters: characterStore.listCharacters() });
});

app.post("/api/characters/import-legacy", (_request, response) => {
  response.status(501).json({
    status: "not configured",
    mode: "copy only",
    legacy: characterStore.legacySummary({ dataDirectory: path.join(root, ".data") }),
    message: "Migrazione legacy preparata come endpoint manuale: non viene eseguita automaticamente e non distrugge i dati legacy originali.",
  });
});

app.post("/api/characters", (request, response, next) => {
  try {
    response.status(201).json({ character: characterStore.createCharacter(request.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:id", (request, response, next) => {
  try {
    response.json({ character: characterStore.getCharacter(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:id/check-assets", (request, response, next) => {
  try {
    response.json(characterStore.assetDiagnostics(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.put("/api/characters/:id", (request, response, next) => {
  try {
    response.json({ character: characterStore.updateCharacter(request.params.id, request.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/characters/:id", (request, response, next) => {
  try {
    response.json(characterStore.deleteCharacter(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/characters/:id/references",
  upload.array("references", 12),
  (request, response, next) => {
    try {
      const files = request.files || [];
      if (!files.length) throw new Error("Carica almeno una reference personaggio.");
      const created = [];
      let character = null;
      for (const file of files) {
        if (!file.mimetype.startsWith("image/")) throw new Error("Le reference personaggio devono essere immagini PNG, JPG o WebP.");
        validateUploadSize(file, maxUploadMb, "La reference personaggio");
        const result = characterStore.addReference(request.params.id, file, request.body || {});
        character = result.character;
        created.push(result.reference);
      }
      response.status(201).json({ character, references: created });
    } catch (error) {
      next(error);
    }
  },
);

app.put("/api/characters/:id/references/:referenceId", (request, response, next) => {
  try {
    response.json({ character: characterStore.updateReference(request.params.id, request.params.referenceId, request.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/characters/:id/references/:referenceId", (request, response, next) => {
  try {
    response.json({ character: characterStore.removeReference(request.params.id, request.params.referenceId) });
  } catch (error) {
    next(error);
  }
});

const CHARACTER_SHEET_WORKFLOWS = {
  qwenEdit: {
    id: "qwenEdit",
    label: "Qwen Image Edit",
    description: "Genera una sheet reference direttamente con Qwen Image Edit.",
  },
  qwenKreaKlein: {
    id: "qwenKreaKlein",
    label: "Qwen/Krea/Klein",
    description: "Usa il workflow combinato Qwen_Krea_Klein_API.",
  },
  kreaTriple: {
    id: "kreaTriple",
    label: "KreaTriple",
    description: "Usa Krea Triple in modalità Image to Image.",
  },
};

function characterSheetWorkflowId(value) {
  const id = String(value || "qwenEdit");
  return CHARACTER_SHEET_WORKFLOWS[id] ? id : "qwenEdit";
}

function characterSheetPrompt(character, extraPrompt = "") {
  const wardrobe = Array.isArray(character.wardrobe) && character.wardrobe.length
    ? `Recurring wardrobe: ${character.wardrobe.join(", ")}.`
    : "";
  return [
    "Create a clean multi-angle character reference sheet from the supplied reference image.",
    "Preserve the same adult character identity, face geometry, hairstyle, skin texture, body proportions and recurring style.",
    "Show front portrait, three-quarter portrait, profile view, upper body, full body front and full body three-quarter in one coherent sheet.",
    "Use neutral studio lighting, plain background, consistent scale, no extra people, no text labels, no watermark.",
    character.description,
    character.identityHints?.face ? `Face identity: ${character.identityHints.face}.` : "",
    character.identityHints?.hair ? `Hair identity: ${character.identityHints.hair}.` : "",
    character.identityHints?.body ? `Body identity: ${character.identityHints.body}.` : "",
    wardrobe,
    extraPrompt,
  ].filter(Boolean).join("\n");
}

function characterNegativePrompt(raw = {}) {
  return String(raw.negativePrompt || [
    "different person",
    "identity drift",
    "changed face",
    "changed hairstyle",
    "wrong body proportions",
    "extra people",
    "duplicate character",
    "text",
    "watermark",
    "logo",
    "blurry",
    "low quality",
  ].join(", "));
}

async function uploadCharacterAsset(reference) {
  const buffer = fs.readFileSync(reference.path);
  return comfy.uploadImage({
    buffer,
    mimetype: reference.mimeType || "image/png",
    originalname: reference.asset?.originalName || path.basename(reference.path),
    size: buffer.length,
  });
}

async function characterReferenceUploads(characterId, limit = 4) {
  const character = characterStore.getCharacter(characterId);
  const available = [];
  for (const reference of character.references || []) {
    if (reference.status === "rejected" || !reference.assetAvailable) continue;
    const match = characterStore.assetPath(characterId, reference.id);
    if (!match) continue;
    available.push({ ...match, id: reference.id, type: reference.type });
  }
  const preferred = [
    ...available.filter((item) => item.type === "hero"),
    ...available.filter((item) => item.type === "face"),
    ...available.filter((item) => item.type === "bust" || item.type === "full_body"),
    ...available.filter((item) => !["hero", "face", "bust", "full_body"].includes(item.type)),
  ];
  const unique = [...new Map(preferred.map((item) => [item.id, item])).values()].slice(0, limit);
  const uploads = [];
  for (const item of unique) uploads.push(await uploadCharacterAsset(item));
  return { character, uploads, source: uploads[0] || null, references: uploads.slice(1) };
}

async function queueCharacterSheetJob(characterId, raw = {}) {
  const workflowId = characterSheetWorkflowId(raw.workflow);
  const { character, source, references } = await characterReferenceUploads(characterId, 4);
  if (!source?.name) {
    throw new Error("Carica almeno una reference valida prima di generare la Character Sheet.");
  }
  const prompt = characterSheetPrompt(character, raw.prompt);
  const negativePrompt = characterNegativePrompt(raw);
  const seed = Number.isSafeInteger(Number(raw.seed)) && Number(raw.seed) >= 0
    ? Number(raw.seed)
    : crypto.randomInt(0, 2 ** 31);
  const base = {
    prompt,
    negativePrompt,
    seed,
    imageWidth: raw.imageWidth || 1344,
    imageHeight: raw.imageHeight || 896,
  };
  let job;
  if (workflowId === "qwenEdit") {
    job = buildImageWorkflow("qwenEdit", {
      ...base,
      imageMode: "image",
      imageModelFile: raw.imageModelFile || "",
      imageResolution: "custom",
      imageSteps: raw.imageSteps || 16,
      imageGuidance: raw.imageGuidance || 1,
      denoise: raw.denoise || 0.55,
      batchSize: 1,
      referenceUploads: references,
      outputBase: `Characters/${character.id}/sheet`,
      saveOriginal: false,
      upscaleMode: "none",
    }, source, []);
  } else {
    const studioMode = workflowId === "kreaTriple" ? "kreaTriple" : "qwenKreaKlein";
    job = buildStudioJobs(studioMode, {
      ...base,
      studioMode,
      kreaTripleOperation: "image",
      kreaTripleDenoise: raw.denoise || 0.38,
    }, {
      source,
      references,
      mask: null,
      guide: null,
    }, [])[0];
  }
  job.metadata = {
    ...job.metadata,
    workflowId: `character:sheet:${workflowId}`,
    workflowName: `Character Sheet · ${CHARACTER_SHEET_WORKFLOWS[workflowId].label}`,
    generationType: "characterSheet",
    characterId: character.id,
    characterName: character.name,
    characterSheetWorkflow: workflowId,
    prompt,
    negativePrompt,
    seed,
  };
  return queueStudioJob(job, character.id);
}

async function imageFingerprint(filePath, workingDirectory) {
  const pgmPath = path.join(workingDirectory, `${crypto.randomUUID()}.pgm`);
  await execFile("ffmpeg", [
    "-y",
    "-i", filePath,
    "-frames:v", "1",
    "-vf", "scale=96:96,format=gray",
    pgmPath,
  ], { windowsHide: true, timeout: 30_000 });
  return fingerprintFromPgm(pgmPath, 16);
}

async function runCharacterIdentityCheck(characterId) {
  const character = characterStore.getCharacter(characterId);
  const matches = (character.references || [])
    .filter((reference) => reference.status !== "rejected" && reference.assetAvailable)
    .map((reference) => ({ reference, match: characterStore.assetPath(characterId, reference.id) }))
    .filter((item) => item.match?.path);
  if (matches.length < 2) {
    const report = {
      enabled: true,
      engine: "perceptual-ffmpeg-pgm",
      status: "insufficient-reference",
      threshold: 0.62,
      referenceCount: matches.length,
      warning: "Servono almeno 2 reference valide per confrontare l'identità.",
    };
    return { character: characterStore.updateIdentityEvaluation(characterId, report), report };
  }
  const tempDirectory = fs.mkdtempSync(path.join(root, ".data", "character-identity-"));
  try {
    const fingerprints = [];
    for (const item of matches) {
      fingerprints.push({
        id: item.reference.id,
        type: item.reference.type,
        originalName: item.reference.originalName,
        fingerprint: await imageFingerprint(item.match.path, tempDirectory),
      });
    }
    const anchor = fingerprints.find((item) => item.type === "hero") || fingerprints[0];
    const comparisons = fingerprints
      .filter((item) => item.id !== anchor.id)
      .map((item) => ({
        referenceId: item.id,
        type: item.type,
        originalName: item.originalName,
        similarity: Number(cosineSimilarity(anchor.fingerprint, item.fingerprint).toFixed(4)),
      }));
    const averageSimilarity = comparisons.reduce((sum, item) => sum + item.similarity, 0) / comparisons.length;
    const minSimilarity = Math.min(...comparisons.map((item) => item.similarity));
    const threshold = 0.62;
    const report = {
      enabled: true,
      engine: "perceptual-ffmpeg-pgm",
      status: minSimilarity >= threshold ? "passed" : "review-needed",
      threshold,
      anchorReferenceId: anchor.id,
      referenceCount: matches.length,
      averageSimilarity: Number(averageSimilarity.toFixed(4)),
      minSimilarity: Number(minSimilarity.toFixed(4)),
      comparisons,
      warning: minSimilarity >= threshold
        ? null
        : "Una o più reference sembrano visivamente lontane dalla hero: controlla tag, qualità o persona.",
    };
    return { character: characterStore.updateIdentityEvaluation(characterId, report), report };
  } catch (error) {
    const report = {
      enabled: true,
      engine: "perceptual-ffmpeg-pgm",
      status: "failed",
      error: error.message,
      warning: "Identity Check locale fallito: verifica FFmpeg o i file reference.",
    };
    return { character: characterStore.updateIdentityEvaluation(characterId, report), report };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

app.post("/api/characters/:id/build-pack", (request, response, next) => {
  try {
    response.json(characterStore.buildPack(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/generate-sheet", async (request, response, next) => {
  try {
    const generation = await queueCharacterSheetJob(request.params.id, request.body || {});
    response.status(202).json({
      status: "queued",
      generation,
      workflow: characterSheetWorkflowId(request.body?.workflow),
      message: "Character Sheet inviata a ComfyUI. Al completamento verrà registrata come reference sheet.",
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/analyze", (request, response) => {
  response.status(501).json({ status: "not configured", message: "Analisi Qwen-VL/Florence/JoyCaption non configurata." });
});

app.post("/api/characters/:id/check-identity", async (request, response, next) => {
  try {
    response.json(await runCharacterIdentityCheck(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/anchor-frame", (request, response) => {
  response.status(501).json(buildCharacterAnchorFrameRequest({
    characterId: request.params.id,
    scenePrompt: request.body?.scenePrompt || request.body?.prompt || "",
    previousFrame: request.body?.previousFrame || null,
    outfit: request.body?.outfit || "",
    identityStrength: request.body?.identityStrength || "medium",
  }));
});

app.get("/api/characters/:id/assets/:referenceId", (request, response, next) => {
  try {
    const match = characterStore.assetPath(request.params.id, request.params.referenceId);
    if (!match) {
      response.status(404).json({ error: "Reference personaggio non trovata." });
      return;
    }
    streamMediaFile(request, response, match, match.asset.filename, request.query.download === "1");
  } catch (error) {
    next(error);
  }
});
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

app.get("/api/generations", (request, response) => {
  if (request.query.paged !== "1") return response.json(store.list());
  response.json(queryGenerations(store.list(), request.query));
});

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

app.post("/api/generations/cleanup/estimate", (request, response) => {
  try {
    response.json(estimateGenerationCleanup({
      items: store.list(),
      criteria: request.body || {},
      resolveMedia: generationMediaResolver,
    }));
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
  }
});

app.post("/api/generations/cleanup/run", (request, response) => {
  try {
    const mode = cleanupMode(request.body?.mode);
    const candidates = cleanupCandidates(store.list(), request.body || {});
    const before = estimateGenerationCleanup({
      items: candidates,
      criteria: { archive: "all" },
      resolveMedia: generationMediaResolver,
    });
    let media = { deleted: [], skipped: [], warning: null };
    if (!candidates.length) {
      // Nothing to do.
    } else if (mode === "archive") {
      setGenerationsArchived({
        store,
        ids: candidates.map((item) => item.id),
        archived: true,
      });
    } else {
      media = cleanupGenerationMedia(candidates);
      if (mode === "deleteFilesAndRecords") {
        store.deleteMany(candidates.map((item) => item.id));
      }
    }
    response.json({
      mode,
      generations: candidates.length,
      filesDeleted: media.deleted.length,
      filesSkipped: media.skipped,
      bytesEstimated: before.bytes,
      warning: media.warning,
    });
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

app.get("/api/video-studio/projects", (request, response) => {
  const archived = String(request.query.archived || "false");
  response.json(videoStudioStore.list()
    .filter((project) => archived === "all" || (archived === "true" ? project.archived : !project.archived))
    .map(videoStudioProjectView));
});

app.get("/api/video-studio/projects/:id", (request, response) => {
  const project = videoStudioStore.get(request.params.id);
  if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
  response.json(videoStudioProjectView(project));
});

app.get("/api/interactive-cast/capabilities", async (_request, response, next) => {
  try {
    response.json(await interactiveCast.capabilities());
  } catch (error) {
    next(error);
  }
});

app.get("/api/interactive-cast/projects", (_request, response) => {
  response.json({ projects: interactiveCast.list() });
});

app.get("/api/interactive-cast/projects/:id", (request, response, next) => {
  try {
    response.json({ project: interactiveCast.get(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/interactive-cast/projects/:id", (request, response, next) => {
  try {
    const project = interactiveCast.delete(request.params.id);
    response.json({ deleted: true, projectId: project.id });
  } catch (error) {
    next(error);
  }
});

app.get("/api/interactive-cast/projects/:id/assets/*path", (request, response, next) => {
  try {
    const relative = Array.isArray(request.params.path)
      ? request.params.path.join("/")
      : String(request.params.path || "");
    const target = interactiveCastStore.assetPath(request.params.id, relative);
    if (!target) return response.status(404).json({ error: "Artefatto Interactive Cast non trovato." });
    response.sendFile(target);
  } catch (error) {
    next(error);
  }
});

app.get("/api/interactive-cast/projects/:id/asset", (request, response, next) => {
  try {
    const relative = String(request.query.path || "");
    const target = interactiveCastStore.assetPath(request.params.id, relative);
    if (!target) return response.status(404).json({ error: "Artefatto Interactive Cast non trovato." });
    response.sendFile(target);
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects", upload.fields([
  { name: "sourceVideo", maxCount: 1 },
  { name: "temporaryActorReference", maxCount: 1 },
]), async (request, response, next) => {
  try {
    const sourceVideo = request.files?.sourceVideo?.[0] || null;
    const temporaryActorReference = request.files?.temporaryActorReference?.[0] || null;
    if (sourceVideo) validateUploadSize(sourceVideo, maxVideoUploadMb, "Il video sorgente");
    if (temporaryActorReference) validateUploadSize(temporaryActorReference, maxUploadMb, "La reference temporanea");
    const project = await interactiveCast.create({
      file: sourceVideo,
      temporaryActorReference,
      raw: request.body || {},
    });
    response.status(201).json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/plan", async (request, response, next) => {
  try {
    const project = interactiveCast.plan(request.params.id, request.body || {});
    response.json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/actors", (request, response, next) => {
  try {
    const project = interactiveCast.updateOriginalActors(request.params.id, request.body?.originalActors || []);
    response.json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/speakers", (request, response, next) => {
  try {
    const project = interactiveCast.updateSpeakerAssignments(request.params.id, request.body?.speakers || []);
    response.json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/assistant-plan", async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Il Prompt Assistant non è configurato. Imposta LM_STUDIO_MODEL." });
    }
    const project = interactiveCast.get(request.params.id);
    const execution = await gpuResourceManager.run("interactive-cast-lm-studio-plan", async () => {
      const plan = await promptAssistant.planInteractiveCast({
        brief: request.body?.brief,
        duration: project.analysis?.duration || 0,
        analysis: project.analysis,
        actors: project.actors,
      });
      const after = await releaseComfyMemoryIfIdle();
      return { plan, after };
    });
    const { plan, after } = execution.value;
    if (plan.unloadError) {
      throw new Error(`Piano Interactive Cast creato, ma LM Studio non ha scaricato il modello: ${plan.unloadError}`);
    }
    response.json({
      plan: validateInteractiveCastAssistantPlan(plan, { duration: project.analysis?.duration || 0 }),
      model: plan.model,
      modelKey: plan.modelKey,
      cleanup: {
        lmStudioModelUnloaded: true,
        comfyMemoryReleased: after.released,
        comfyMemoryReason: after.reason,
        comfyMemoryPrepared: execution.resource.comfy?.released || false,
      },
      gpu: execution.resource,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/prepare-segments", async (request, response, next) => {
  try {
    const project = await interactiveCast.prepareSegments(request.params.id);
    response.json({
      project,
      readiness: interactiveCast.spliceReadiness(project.id),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/replacement", upload.single("replacementVideo"), async (request, response, next) => {
  try {
    if (!request.file) throw new Error("Carica un segmento video sostitutivo.");
    validateUploadSize(request.file, maxVideoUploadMb, "Il segmento sostitutivo");
    const project = interactiveCast.attachReplacementSegment(request.params.id, request.params.segmentId, request.file);
    response.json({
      project,
      readiness: interactiveCast.spliceReadiness(project.id),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/generate", async (request, response, next) => {
  try {
    const result = await startInteractiveCastSegmentGeneration(
      request.params.id,
      request.params.segmentId,
      request.body || {},
    );
    response.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/dialogue/:eventId/audio", upload.single("dialogueAudio"), async (request, response, next) => {
  try {
    if (!request.file) throw new Error("Carica una battuta audio sintetizzata.");
    validateUploadSize(request.file, maxVideoUploadMb, "La battuta audio");
    const project = interactiveCast.attachDialogueAudio(request.params.id, request.params.eventId, request.file);
    response.json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/dialogue/:eventId/synthesize", async (request, response, next) => {
  try {
    const execution = await gpuResourceManager.run("interactive-cast-voice-synthesis", () =>
      interactiveCast.synthesizeDialogueAudio(request.params.id, request.params.eventId, request.body || {}));
    response.json({ project: execution.value, gpu: execution.resource });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/lipsync", async (request, response, next) => {
  try {
    const execution = await gpuResourceManager.run("interactive-cast-lipsync", () =>
      interactiveCast.applyLipSyncToSegment(request.params.id, request.params.segmentId, request.body || {}));
    response.json({ project: execution.value, gpu: execution.resource });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/composite", upload.fields([
  { name: "overlayVideo", maxCount: 1 },
  { name: "maskImage", maxCount: 1 },
]), async (request, response, next) => {
  try {
    const overlayVideo = request.files?.overlayVideo?.[0] || null;
    const maskImage = request.files?.maskImage?.[0] || null;
    if (!overlayVideo) throw new Error("Carica un overlay video per il compositing.");
    if (!maskImage) throw new Error("Carica una maschera immagine per il compositing.");
    validateUploadSize(overlayVideo, maxVideoUploadMb, "L'overlay video");
    validateUploadSize(maskImage, maxImageUploadMb, "La maschera");
    const project = await interactiveCast.applyCompositeToSegment(request.params.id, request.params.segmentId, request.files, request.body || {});
    response.json({
      project,
      readiness: interactiveCast.spliceReadiness(project.id),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/identity-check", async (request, response, next) => {
  try {
    const project = await interactiveCast.verifySegmentIdentity(request.params.id, request.params.segmentId, request.body || {});
    response.json({
      project,
      report: project.renderPackage?.identityReports?.[request.params.segmentId] || null,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/audio-remix", async (request, response, next) => {
  try {
    const project = await interactiveCast.remixAudio(request.params.id);
    response.json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/concat", async (request, response, next) => {
  try {
    const project = await interactiveCast.concatFinal(request.params.id);
    response.json({ project });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/projects/:id/archive", (request, response, next) => {
  try {
    const project = videoStudioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
    if (videoStudioProjectIsActive(project)) {
      return response.status(409).json({ error: "Annulla o attendi il completamento prima di nascondere il progetto." });
    }
    const archived = request.body?.archived !== false;
    const updated = videoStudioStore.update(project.id, {
      archived,
      archivedAt: archived ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    });
    response.json({ project: videoStudioProjectView(updated) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/video-studio/projects/:id", (request, response, next) => {
  try {
    const project = videoStudioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
    if (videoStudioProjectIsActive(project)) {
      return response.status(409).json({ error: "Annulla o attendi il completamento prima di eliminare il progetto." });
    }
    const generations = videoStudioProjectGenerations(project);
    const media = request.query.files === "1" || request.body?.deleteFiles === true
      ? removeGeneratedMediaFiles(generations)
      : { deleted: [], skipped: [], warning: null };
    videoStudioStore.delete(project.id);
    store.deleteMany(generations.map((item) => item.id));
    response.json({
      deleted: true,
      projectId: project.id,
      generations: generations.length,
      filesDeleted: media.deleted.length,
      filesSkipped: media.skipped,
      warning: media.warning,
    });
  } catch (error) {
    next(error);
  }
});

function sequentialStoryCharacterContext(raw = {}) {
  const characterId = String(raw.characterId || "").trim();
  if (!characterId) return { character: null, promptPrefix: "", warnings: [] };
  const character = characterStore.getCharacter(characterId);
  const adapter = resolveCharacterAdapter({
    generationType: "videoStudio",
    videoStudioMode: "sequentialStory",
    character,
    options: {
      identityStrength: raw.identityStrength,
      lockFace: raw.lockFace,
      lockHair: raw.lockHair,
      lockBody: raw.lockBody,
      lockOutfit: raw.lockOutfit,
    },
  });
  return { character, promptPrefix: adapter.promptPrefix, warnings: adapter.warnings };
}

app.get("/api/video-studio/sequential-story", (_request, response) => {
  response.json({ projects: sequentialStoryStore.list() });
});

app.post("/api/video-studio/sequential-story/plan", async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Il Prompt Assistant non è configurato. Imposta LM_STUDIO_MODEL." });
    }
    const character = sequentialStoryCharacterContext(request.body || {});
    const before = await releaseComfyMemoryIfIdle();
    const plan = await sequentialStoryService.plan({
      ...request.body,
      characterContext: character.promptPrefix,
    });
    const after = await releaseComfyMemoryIfIdle();
    response.json({
      plan: validateSequentialStoryPlan(plan, {
        sceneCount: Number(request.body.sceneCount || 3),
        sceneDuration: Number(request.body.sceneDuration || 10),
      }),
      character,
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

app.post("/api/video-studio/sequential-story", upload.single("initialImage"), async (request, response, next) => {
  try {
    const payload = typeof request.body?.payload === "string" && request.body.payload.trim()
      ? JSON.parse(request.body.payload)
      : request.body || {};
    let initialFrameUpload = null;
    let initialFrameSource = null;
    if (request.file) {
      if (!request.file.mimetype.startsWith("image/")) {
        throw new Error("Il fotogramma iniziale deve essere PNG, JPG o WebP.");
      }
      validateUploadSize(request.file, maxUploadMb, "Il fotogramma iniziale");
      initialFrameUpload = await comfy.uploadImage(request.file);
      initialFrameSource = {
        filename: request.file.originalname,
        type: "sequential-story-initial-frame",
        mimeType: request.file.mimetype,
        size: request.file.size,
      };
    }
    const settings = {
      ...(payload.settings || payload),
      initialFrameUpload,
      initialFrameSource,
    };
    if (settings.inputMode === "image" && !initialFrameUpload?.name) {
      throw new Error("Carica un fotogramma iniziale per creare una Storia Continua Immagine → Video.");
    }
    const character = sequentialStoryCharacterContext(settings);
    const project = sequentialStoryService.create({
      ...payload,
      settings,
      initialFrameUpload,
      initialFrameSource,
    });
    const withCharacter = sequentialStoryStore.update(project.id, {
      character: character.character
        ? {
            id: character.character.id,
            name: character.character.name,
            packStatus: character.character.packStatus,
            warnings: character.warnings,
          }
        : null,
      characterPrompt: character.promptPrefix,
    });
    response.status(201).json({ project: withCharacter });
  } catch (error) {
    next(error);
  }
});

app.get("/api/video-studio/sequential-story/:id", (request, response, next) => {
  try {
    response.json({ project: sequentialStoryStore.require(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.put("/api/video-studio/sequential-story/:id", (request, response, next) => {
  try {
    response.json({ project: sequentialStoryService.update(request.params.id, request.body || {}) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/sequential-story/:id/start", async (request, response, next) => {
  try {
    if (!outputDirectory) throw new Error("OUTPUT_DIRECTORY non configurata: impossibile verificare clip e concatenazione.");
    response.status(202).json({ project: await sequentialStoryService.start(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/sequential-story/:id/pause", (request, response, next) => {
  try {
    response.json({ project: sequentialStoryService.pause(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/sequential-story/:id/resume", async (request, response, next) => {
  try {
    if (!outputDirectory) throw new Error("OUTPUT_DIRECTORY non configurata: impossibile verificare clip e concatenazione.");
    response.status(202).json({ project: await sequentialStoryService.start(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/sequential-story/:id/cancel", (request, response, next) => {
  try {
    response.json({ project: sequentialStoryService.cancel(request.params.id) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/video-studio/sequential-story/:id", (request, response, next) => {
  try {
    response.json(sequentialStoryService.delete(request.params.id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/sequential-story/:id/scenes/:sceneId/retry", (request, response, next) => {
  try {
    response.json({ project: sequentialStoryService.retryScene(request.params.id, request.params.sceneId) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/sequential-story/:id/scenes/:sceneId/regenerate-plan", async (request, response, next) => {
  try {
    const project = sequentialStoryStore.require(request.params.id);
    const scene = project.scenes.find((item) => item.id === request.params.sceneId);
    if (!scene) throw new Error("Scena Sequential Story non trovata.");
    const plan = await sequentialStoryService.plan({
      description: `${project.title}. Rewrite only scene ${scene.index}: ${request.body?.description || scene.prompt}`,
      sceneCount: 1,
      sceneDuration: scene.duration,
      globalStyle: Object.values(project.globalContinuity || {}).filter(Boolean).join(". "),
      characterContext: project.characterPrompt || "",
    });
    response.json({ scene: validateSequentialStoryPlan(plan, { sceneCount: 1, sceneDuration: scene.duration }).scenes[0] });
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/projects", upload.any(), async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const config = await videoStudioRuntimeConfig();
    const selectedLoras = parseLoras(request.body.loras);
    if (selectedLoras.length) validateLoras(selectedLoras, config.ltxLoras);
    const uploaded = await uploadVideoStudioFiles(request.files || []);
    const characterSelection = await uploadCharacterSelection(
      request.body,
      {
        generationType: "videoStudio",
        videoStudioMode: request.body.videoStudioMode,
      },
      2,
    );
    if (characterSelection) request.body = withCharacterPrompt(request.body, characterSelection.adapter);
    if (characterSelection?.uploads[0]) {
      if (!uploaded.identityImage) uploaded.identityImage = characterSelection.uploads[0];
      if (!uploaded.referenceSheet) uploaded.referenceSheet = characterSelection.uploads[1] || characterSelection.uploads[0];
    }
    let job = buildVideoStudioInitialJob(
      request.body.videoStudioMode,
      request.body,
      uploaded,
      selectedLoras,
      config,
    );
    if (characterSelection) {
      job.metadata = {
        ...job.metadata,
        character: {
          id: characterSelection.character.id,
          name: characterSelection.character.name,
          capability: characterSelection.adapter.capability,
          referenceIds: characterSelection.adapter.references.map((item) => item.id),
          warnings: characterSelection.adapter.warnings,
        },
      };
    }
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
    const characterSelection = await uploadCharacterSelection(
      request.body,
      {
        generationType: "studio",
        studioMode: request.body.studioMode,
      },
      4,
    );
    if (characterSelection) request.body = withCharacterPrompt(request.body, characterSelection.adapter);
    if (characterSelection?.uploads.length) {
      if (!uploaded.source?.name && ["bible", "qwenKreaKlein", "kreaTriple"].includes(request.body.studioMode)) {
        uploaded.source = characterSelection.uploads[0];
        uploaded.references = [...characterSelection.uploads.slice(1), ...(uploaded.references || [])].slice(0, 3);
      } else {
        uploaded.references = [...characterSelection.uploads, ...(uploaded.references || [])].slice(0, 3);
      }
    }
    let jobs = buildStudioJobs(request.body.studioMode, request.body, uploaded, selectedLoras);
    if (request.body.studioMode === "guidedEdit") {
      const definitions = await workflowPreflight.definitions();
      let placement = null;
      let sceneProfile = {};
      try {
        placement = request.body.placement ? JSON.parse(request.body.placement) : null;
      } catch {
        placement = null;
      }
      try {
        const sceneRequest = JSON.parse(request.body.sceneIntegration || "{}");
        if (sceneRequest.profileId) sceneProfile = sceneIntegration.getProfile(sceneRequest.profileId);
      } catch {
        sceneProfile = {};
      }
      jobs = jobs.map((job) => ({
        ...job,
        metadata: {
          ...job.metadata,
          subjectInsertion: planSubjectInsertion({
            sourceFile: job.metadata?.sourceImage || uploaded.source?.name,
            operation: request.body.editAction,
            prompt: request.body.prompt,
            interaction: request.body.subjectInteraction,
            contact: request.body.contactInstruction,
            preserve: request.body.preserveInstruction,
            placement,
            placementMethod: request.body.placementMethod,
            spatialInstruction: request.body.spatialInstruction,
            depthRelation: request.body.depthRelation,
            maskFile: uploaded.mask?.name || "",
            references: (uploaded.references || []).map((item, index) => ({
              file: item.name,
              role: ["identity", "pose", "style"][index] || "appearance",
            })),
            characterId: request.body.characterId,
            subjectId: request.body.subjectId,
            subjectName: request.body.subjectName,
            modelFamily: job.metadata?.imageModelFamily,
            modelId: job.metadata?.imageModelId,
            modelFile: job.metadata?.imageModelFile,
            sceneProfile,
            sceneProfileId: sceneProfile.id,
            debugArtifacts: request.body.subjectDebugArtifacts === "on",
          }, { availableNodes: Object.keys(definitions) }),
        },
      }));
    }
    if (characterSelection) {
      jobs = jobs.map((job) => ({
        ...job,
        metadata: {
          ...job.metadata,
          character: {
            id: characterSelection.character.id,
            name: characterSelection.character.name,
            capability: characterSelection.adapter.capability,
            referenceIds: characterSelection.adapter.references.map((item) => item.id),
            warnings: characterSelection.adapter.warnings,
          },
        },
      }));
    }
    jobs = await Promise.all(jobs.map((job) => integrateSceneJob(job, request.body, {
      maskUpload: uploaded.mask || null,
      structureGuideAvailable: Boolean(uploaded.guide),
      subjectType: job.metadata?.subjectInsertion?.subjectType || null,
    })));
    await validateStudioModels(jobs);
    const project = studioStore.add({
      id: crypto.randomUUID(),
      studioMode: request.body.studioMode,
      name: String(request.body.projectName || jobs[0]?.metadata?.workflowName || "Progetto Studio").trim(),
      prompt: String(request.body.prompt || "").trim(),
      executionMode: "guided",
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
        : request.body.generationType === "ltxUpscale"
          ? "ltxUpscale"
          : request.body.generationType === "seedvr2VideoUpscale"
            ? "seedvr2VideoUpscale"
            : "video";
    const selectedLoras = ["upscale", "ltxUpscale", "seedvr2VideoUpscale"].includes(generationType)
      ? []
      : parseLoras(request.body.loras);
    if (selectedLoras.length) {
      const loraInfo = await comfy.objectInfo("LoraLoaderModelOnly");
      const installedLoras = comboOptions(loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name);
      validateLoras(selectedLoras, installedLoras);
    }
    let uploaded = null;
    let directorScenes = [];
    let availableUpscaleModels = [];
    const characterSelection = ["upscale", "ltxUpscale", "seedvr2VideoUpscale"].includes(generationType)
      ? null
      : await uploadCharacterSelection(
          request.body,
          {
            generationType,
            workflowId: request.body.workflowId,
          },
          4,
        );
    if (characterSelection) request.body = withCharacterPrompt(request.body, characterSelection.adapter);

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
        } else if (characterSelection?.uploads[0]) {
          uploaded = characterSelection.uploads[0];
        } else {
          throw new Error("Carica un'immagine PNG, JPG o WebP.");
        }
      }
      if (characterSelection?.uploads.length) {
        request.body.referenceUploads = request.body.imageMode === "text"
          ? characterSelection.uploads.slice(0, 4)
          : characterSelection.uploads.filter((item) => item.name !== uploaded?.name).slice(0, 3);
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
    
    } else if (generationType === "ltxUpscale") {
      const runtimeConfig = await (async () => {
        try {
          const [
            modelInfo,
            checkpointInfo,
            clipInfo,
            vaeInfo,
            loraInfo,
            ...nodeDefinitions
          ] = await Promise.all([
            comfy.objectInfo("UNETLoader"),
            comfy.objectInfo("CheckpointLoaderSimple"),
            comfy.objectInfo("CLIPLoader"),
            comfy.objectInfo("VAELoader"),
            comfy.objectInfo("LoraLoaderModelOnly"),
            ...LTX_UPSCALE_REQUIRED_NODES.map((name) =>
              objectDefinition(name),
            ),
          ]);

          const availableNodes =
            LTX_UPSCALE_REQUIRED_NODES.filter(
              (_name, index) => Boolean(nodeDefinitions[index]),
            );

          return ltxUpscaleConfig({
            availableNodes,

            installedCheckpoints: [
              ...comboOptions(
                modelInfo?.UNETLoader?.input?.required?.unet_name,
              ),
          ...comboOptions(
                checkpointInfo?.CheckpointLoaderSimple?.input?.required
                  ?.ckpt_name,
              ),
            ],

            installedLoras: comboOptions(
              loraInfo?.LoraLoaderModelOnly?.input?.required?.lora_name,
            ),

            installedTextEncoders: comboOptions(
              clipInfo?.CLIPLoader?.input?.required?.clip_name,
            ),

            installedVaes: comboOptions(
              vaeInfo?.VAELoader?.input?.required?.vae_name,
            ),
          });
        } catch {
          return ltxUpscaleConfig();
        }
      })();

      if (!runtimeConfig.available) {
        const details = [
          runtimeConfig.missingNodes?.length
            ? `Nodi mancanti: ${runtimeConfig.missingNodes.join(", ")}`
            : "",
          runtimeConfig.missingFiles?.length
            ? `File mancanti: ${runtimeConfig.missingFiles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

        throw new Error(
          details ||
            "La pipeline LTX 2.3 Upscale IC-LoRA non è disponibile.",
        );
      }

      const videoFile = files.find(
        (file) => file.fieldname === "video",
      );

      if (!videoFile || !videoFile.mimetype.startsWith("video/")) {
        throw new Error(
          "Carica un video MP4, WebM, MOV, MKV o AVI per Upscale LTX.",
        );
      }

      validateUploadSize(
        videoFile,
        maxVideoUploadMb,
        "Il video",
      );

      uploaded = await comfy.uploadInput(videoFile);

    } else if (generationType === "seedvr2VideoUpscale") {
      const runtimeConfig = await (async () => {
        try {
          const [
            ditInfo,
            vaeInfo,
            ...nodeDefinitions
          ] = await Promise.all([
            comfy.objectInfo("SeedVR2LoadDiTModel"),
            comfy.objectInfo("SeedVR2LoadVAEModel"),
            ...SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES.map((name) =>
              objectDefinition(name),
            ),
            objectDefinition("SeedVR2TorchCompileSettings"),
          ]);

          const requiredWithCompile = [
            ...SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES,
            "SeedVR2TorchCompileSettings",
          ];
          const availableNodes = requiredWithCompile.filter(
            (_name, index) => Boolean(nodeDefinitions[index]),
          );

          return seedvr2VideoUpscaleConfig({
            availableNodes,
            installedSeedvr2Models: comboOptions(
              ditInfo?.SeedVR2LoadDiTModel?.input?.required?.model,
            ),
            installedVaes: comboOptions(
              vaeInfo?.SeedVR2LoadVAEModel?.input?.required?.model,
            ),
          });
        } catch {
          return seedvr2VideoUpscaleConfig();
        }
      })();

      if (!runtimeConfig.available) {
        const details = [
          runtimeConfig.missingNodes?.length
            ? `Nodi mancanti: ${runtimeConfig.missingNodes.join(", ")}`
            : "",
          runtimeConfig.missingFiles?.length
            ? `File mancanti: ${runtimeConfig.missingFiles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

        throw new Error(
          details || "La pipeline SeedVR2 Video Upscale non è disponibile.",
        );
      }

      const selectedProfile = runtimeConfig.profiles?.find(
        (profile) => profile.id === request.body.seedvr2VideoPreset,
      );
      if (selectedProfile && !selectedProfile.available) {
        throw new Error(
          `Il profilo SeedVR2 selezionato non è installato: ${selectedProfile.model}`,
        );
      }

      const videoFile = files.find((file) => file.fieldname === "video");

      if (!videoFile || !videoFile.mimetype.startsWith("video/")) {
        throw new Error(
          "Carica un video MP4, WebM, MOV, MKV o AVI per SeedVR2 Video Upscale.",
        );
      }

      validateUploadSize(videoFile, maxVideoUploadMb, "Il video");
      uploaded = await comfy.uploadInput(videoFile);

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
        } else if (characterSelection?.uploads[0]) {
          uploaded = characterSelection.uploads[0];
        } else {
          throw new Error("Carica un'immagine PNG, JPG o WebP.");
        }
      }
    }

    let job = generationType === "image"
      ? buildImageWorkflow(
          request.body.imageModelId,
          request.body,
          uploaded,
          selectedLoras,
        )
      : generationType === "upscale"
        ? buildUpscaleWorkflow(
            request.body,
            uploaded,
            availableUpscaleModels,
          )
        : generationType === "ltxUpscale"
          ? buildLtxUpscaleWorkflow(
              request.body,
              uploaded,
            )
          : generationType === "seedvr2VideoUpscale"
            ? buildSeedvr2VideoUpscaleWorkflow(
                request.body,
                uploaded,
              )
            : buildWorkflow(
                request.body.workflowId,
                request.body,
                uploaded,
                directorScenes,
              selectedLoras,
            );
    if (characterSelection) {
      job.metadata = {
        ...job.metadata,
        character: {
          id: characterSelection.character.id,
          name: characterSelection.character.name,
          capability: characterSelection.adapter.capability,
          referenceIds: characterSelection.adapter.references.map((item) => item.id),
          warnings: characterSelection.adapter.warnings,
        },
      };
    }
    if (!["upscale", "ltxUpscale", "seedvr2VideoUpscale"].includes(generationType)) {
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
          const finishedAt = new Date().toISOString();
          const startedAtMs = Date.parse(item.startedAt || "");
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
              finishedAt,
              durationMs: Number.isFinite(startedAtMs)
                ? Math.max(0, Date.parse(finishedAt) - startedAtMs)
                : null,
            });
            broadcast({ type: "generation_updated", generationId: item.id, data: updated });
            await advanceInteractiveCastGeneration(updated);
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
            subjectInsertionResult: item.subjectInsertion
              ? subjectInsertionResult(item.subjectInsertion, {
                  final: primaryImage?.file || images.at(-1) || null,
                  corrections: item.sceneIntegration?.iterations || [],
                  debugArtifacts: item.sceneIntegration?.evaluationArtifacts || {},
                })
              : null,
            finishedAt,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, Date.parse(finishedAt) - startedAtMs)
              : null,
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          await advanceInteractiveCastGeneration(updated);
          const characterSheet = maybeRegisterCharacterSheet(updated, primaryImage);
          if (characterSheet) {
            const imported = store.update(updated.id, {
              characterSheetImported: true,
              characterSheetReferenceId: characterSheet.reference.id,
            });
            broadcast({ type: "generation_updated", generationId: item.id, data: imported });
            broadcast({
              type: "character_updated",
              characterId: characterSheet.character.id,
              data: characterSheet.character,
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
          const finishedAt = new Date().toISOString();
          const startedAtMs = Date.parse(item.startedAt || "");
          const updated = store.update(item.id, {
            status: "error",
            error: "ComfyUI ha completato il workflow ma non ha prodotto nessun file visualizzabile o scaricabile.",
            finishedAt,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, Date.parse(finishedAt) - startedAtMs)
              : null,
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          await advanceInteractiveCastGeneration(updated);
          scheduleIdlePurge();
        } else if (statusText === "error") {
          const finishedAt = new Date().toISOString();
          const startedAtMs = Date.parse(item.startedAt || "");
          const updated = store.update(item.id, {
            status: "error",
            error: "ComfyUI ha terminato il workflow con un errore.",
            finishedAt,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, Date.parse(finishedAt) - startedAtMs)
              : null,
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          await advanceInteractiveCastGeneration(updated);
          scheduleIdlePurge();
        }
      } catch {
        // ComfyUI può essere temporaneamente occupato o non raggiungibile.
      }
    }
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

