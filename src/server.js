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
import { poseLibraryConfig, selectPose } from "./pose-library.js";
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
  qwenEdit2511Lightning8Preset,
} from "./image-workflows.js";
import { parseLoras, validateLoras } from "./loras.js";
import { loraTriggerMetadata } from "./lora-trigger-catalog.js";
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
  buildInteractiveCastUnionJob,
  buildVideoStudioInitialJob,
  buildVideoStudioLipdubJob,
  videoStudioConfig,
} from "./video-studio-workflows.js";
import {
  buildH3PreviewFinishingWorkflow,
  buildH3SceneRecipe,
} from "./h3-preview-workflows.js";
import { buildOrbitSheetWorkflow } from "./orbit-sheets-workflows.js";
import { buildH3DeRopeWorkflow } from "./h3-derope-workflows.js";
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
import { validateWorkflow, WorkflowPreflight } from "./workflow-validator.js";
import { sceneIntegrationSettings } from "./scene-integration/defaults.js";
import { buildComfySceneAnalysisWorkflow } from "./scene-integration/comfy-analysis-workflows.js";
import { buildSceneCorrectionWorkflow } from "./scene-integration/correction-workflow.js";
import { evaluateAndPlanCorrection, prepareSceneIntegratedWorkflow } from "./scene-integration/pipeline.js";
import { SceneIntegrationService } from "./scene-integration/service.js";
import { planSubjectInsertion, subjectInsertionResult } from "./subject-insertion/index.js";
import { CharacterStore } from "./characters.js";
import {
  blueprintDescription,
  blueprintIdentityHints,
  normalizeCharacterBlueprint,
  normalizeGenesis,
  normalizeSubjectKind,
} from "./character-genesis.js";
import {
  buildCharacterReferenceJob,
  missingReferenceItems,
  normalizeReferencePlan,
  patchReferencePlanItem,
  referenceRoleCatalog,
  selectReferenceWorkflow,
} from "./character-reference-factory.js";
import {
  characterPhotoEngineCatalog,
  characterPhotoGenerationMetadata,
  normalizeSceneBlueprint,
  routeCharacterPhotoWorkflow,
  sceneBlueprintSummary,
  selectCharacterPhotoReferences,
  surpriseSceneSeed,
} from "./character-photo.js";
import {
  createCharacterMasterPipeline,
  finishCharacterMasterPipeline,
  identityProtectionContract,
  nextMasterPipelineStage,
  seedVr2PresetForQuality,
  updateMasterPipelineStage,
} from "./character-master-pipeline.js";
import {
  characterVideoHistoryMetadata,
  createCharacterVideoRouter,
  motionPromptSections,
  normalizeVideoBlueprint,
  routeCharacterVideo,
  videoRequirements,
} from "./character-video.js";
import {
  characterVideoStage,
  createCharacterVideoPipeline,
  finishCharacterVideoPipeline,
  updateCharacterVideoStage,
} from "./character-video-pipeline.js";
import { synthesizeDialogue, voiceEngineCapabilities } from "./interactive-cast/voice-engine.js";
import { applyLipSync, lipsyncCapabilities } from "./interactive-cast/lipsync-engine.js";
import {
  buildCharacterAnchorFrameRequest,
  resolveCharacterAdapter,
  uploadCharacterReferences,
  withCharacterPrompt,
} from "./character-adapters.js";
import {
  SequentialStoryService,
  SequentialStoryStore,
  validateSequentialStoryPlan,
} from "./sequential-story.js";
import {
  InteractiveCastOrchestrator,
  InteractiveCastProjectStore,
  validateInteractiveCastAssistantPlan,
} from "./interactive-cast/index.js";
import {
  planAnchorPlacement,
  verifyAnchorCandidate,
} from "./interactive-cast/anchor-verification.js";
import { GpuResourceManager } from "./gpu-resource-manager.js";
import {
  IdentityEvaluationService,
  InsightFaceBuffaloLProvider,
} from "./identity-evaluation.js";

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

function reconcileOrphanStudioProjects() {
  const patches = new Map();
  const recoveredAt = new Date().toISOString();
  for (const project of studioStore.list()) {
    if (project.status !== "queued" || (project.generationIds || []).length) continue;
    patches.set(project.id, {
      status: "error",
      error: "Creazione interrotta dal riavvio del server prima dell'invio a ComfyUI. Riprova la generazione.",
      recoveredAt,
      updatedAt: recoveredAt,
    });
  }
  return studioStore.patchMany(patches);
}

reconcileOrphanStudioProjects();
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
const identityEvaluation = new IdentityEvaluationService({
  providers: [new InsightFaceBuffaloLProvider({ root, outputDirectory })],
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
const appConfigCache = {
  value: null,
  updatedAt: 0,
  refreshPromise: null,
};
const APP_CONFIG_TTL_MS = Math.max(15_000, Number(process.env.APP_CONFIG_TTL_SECONDS || 60) * 1000);
const APP_CONFIG_BOOTSTRAP_WAIT_MS = Math.max(
  250,
  Number(process.env.APP_CONFIG_BOOTSTRAP_WAIT_MS || 1200),
);
const APP_CONFIG_CACHE_FILE = path.join(root, ".data", "app-config-cache.json");
const interactiveCastCapabilitiesCache = {
  value: null,
  updatedAt: 0,
  refreshPromise: null,
};
const sceneCapabilitiesCache = {
  value: null,
  updatedAt: 0,
  refreshPromise: null,
};

try {
  const snapshot = JSON.parse(fs.readFileSync(APP_CONFIG_CACHE_FILE, "utf8"));
  if (snapshot?.version === 1 && snapshot.value) {
    appConfigCache.value = snapshot.value;
    interactiveCastCapabilitiesCache.value = snapshot.value.interactiveCast || null;
    sceneCapabilitiesCache.value = snapshot.value.sceneIntegration || null;
  }
} catch {
  // Il primo avvio o una cache incompleta non devono bloccare il bootstrap.
}

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
  maxTokens: Number(process.env.LM_STUDIO_MAX_TOKENS || 2048),
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

        const updated = store.update(record.id, {
          status: "error",
          error: event.data?.exception_message || "Errore durante la generazione.",
          finishedAt,
          durationMs: Number.isFinite(startedAtMs)
            ? Math.max(0, finishedAtMs - startedAtMs)
            : null,
        });
        syncCharacterReferenceGeneration(updated);
        continueCharacterMasterPipeline(updated);
        continueCharacterVideoPipeline(updated);
        if (!updated.pipelineRootGenerationId && !updated.characterMasterPipeline) scheduleIdlePurge();
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

async function videoStudioRuntimeConfig(infoOverride = null) {
  try {
    const info = infoOverride || await comfy.objectInfo();
    return videoStudioConfig({
      installedLoras: comboOptions(info?.LoraLoaderModelOnly?.input?.required?.lora_name),
      installedCheckpoints: comboOptions(info?.CheckpointLoaderSimple?.input?.required?.ckpt_name),
      installedTextEncoders: comboOptions(info?.LTXAVTextEncoderLoader?.input?.required?.text_encoder),
      installedLatentUpscalers: comboOptions(info?.LatentUpscaleModelLoader?.input?.required?.model_name),
      installedModelPatches: comboOptions(info?.ModelPatchLoader?.input?.required?.name),
      installedDiffusionModels: comboOptions(info?.UNETLoader?.input?.required?.unet_name),
      installedClips: comboOptions(info?.CLIPLoader?.input?.required?.clip_name),
      installedVaes: comboOptions(info?.VAELoader?.input?.required?.vae_name),
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

function uploadLocalVideoForComfy(filePath) {
  const buffer = fs.readFileSync(filePath);
  return comfy.uploadInput({
    buffer,
    mimetype: "video/mp4",
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
    h3FirstFrame: files.find((file) => file.fieldname === "h3FirstFrame") || null,
    h3LastFrame: files.find((file) => file.fieldname === "h3LastFrame") || null,
    ltx25FirstFrame: files.find((file) => file.fieldname === "ltx25FirstFrame") || null,
    ltx25LastFrame: files.find((file) => file.fieldname === "ltx25LastFrame") || null,
    ltx25ReferenceSheet: files.find((file) => file.fieldname === "ltx25ReferenceSheet") || null,
    ltx25SourceVideo: files.find((file) => file.fieldname === "ltx25SourceVideo") || null,
    ltx25MaskVideo: files.find((file) => file.fieldname === "ltx25MaskVideo") || null,
    ltx25Audio: files.find((file) => file.fieldname === "ltx25Audio") || null,
  };
  const uploaded = {};
  for (const [key, file] of Object.entries(roles)) {
    if (!file) continue;
    const isVideo = key.endsWith("Video");
    const isAudio = key.endsWith("Audio");
    if (isVideo && !file.mimetype.startsWith("video/")) {
      throw new Error(`${key === "maskVideo" ? "La maschera" : "La scena"} deve essere un video.`);
    }
    if (isAudio && !file.mimetype.startsWith("audio/")) {
      throw new Error("La reference audio LTX 2.5 deve essere un file audio.");
    }
    if (!isVideo && !isAudio && !file.mimetype.startsWith("image/")) {
      throw new Error("Le reference devono essere immagini PNG, JPG o WebP.");
    }
    validateUploadSize(file, isVideo || isAudio ? maxVideoUploadMb : maxUploadMb, isVideo ? "Il video" : isAudio ? "L’audio" : "L’immagine");
    uploaded[key] = isVideo || isAudio ? await comfy.uploadInput(file) : await comfy.uploadImage(file);
  }
  const referenceGroups = {
    h3ReferenceImages: files.filter((file) => file.fieldname === "h3ReferenceImages"),
    h3ReferenceVideos: files.filter((file) => file.fieldname === "h3ReferenceVideos"),
    h3ReferenceAudios: files.filter((file) => file.fieldname === "h3ReferenceAudios"),
  };
  if (referenceGroups.h3ReferenceImages.length > 9 || referenceGroups.h3ReferenceVideos.length > 3 || referenceGroups.h3ReferenceAudios.length > 3) {
    throw new Error("MiniMax H3 accetta massimo 9 immagini, 3 video e 3 audio reference.");
  }
  for (const [key, group] of Object.entries(referenceGroups)) {
    uploaded[key] = [];
    for (const file of group) {
      const isVideo = key === "h3ReferenceVideos";
      const isAudio = key === "h3ReferenceAudios";
      if (isVideo && !file.mimetype.startsWith("video/")) throw new Error("Le reference video MiniMax H3 devono essere video.");
      if (isAudio && !file.mimetype.startsWith("audio/")) throw new Error("Le reference audio MiniMax H3 devono essere file audio.");
      if (!isVideo && !isAudio && !file.mimetype.startsWith("image/")) throw new Error("Le reference immagine MiniMax H3 devono essere PNG, JPG o WebP.");
      validateUploadSize(file, isVideo || isAudio ? maxVideoUploadMb : maxUploadMb, "Una reference MiniMax H3");
      uploaded[key].push(isVideo || isAudio ? await comfy.uploadInput(file) : await comfy.uploadImage(file));
    }
  }
  const ltx25Keyframes = files.filter((file) => file.fieldname === "ltx25Keyframes");
  if (ltx25Keyframes.length > 6) throw new Error("LTX 2.5 AIO accetta massimo 6 keyframe intermedi.");
  uploaded.ltx25Keyframes = [];
  for (const file of ltx25Keyframes) {
    if (!file.mimetype.startsWith("image/")) throw new Error("I keyframe LTX 2.5 devono essere immagini.");
    validateUploadSize(file, maxUploadMb, "Un keyframe LTX 2.5");
    uploaded.ltx25Keyframes.push(await comfy.uploadImage(file));
  }
  const ltx25MsrReferences = files.filter((file) => file.fieldname === "ltx25MsrReferences");
  if (ltx25MsrReferences.length > 5) throw new Error("Multi-Reference MSR accetta massimo 5 immagini.");
  uploaded.ltx25MsrReferences = [];
  for (const file of ltx25MsrReferences) {
    if (!file.mimetype.startsWith("image/")) throw new Error("Le reference MSR devono essere immagini PNG, JPG o WebP.");
    validateUploadSize(file, maxUploadMb, "Una reference MSR");
    uploaded.ltx25MsrReferences.push(await comfy.uploadImage(file));
  }
  return uploaded;
}

async function imageEnhancementCapabilities(infoOverride = null) {
  const definitions = infoOverride
    ? [
        infoOverride.UpscaleModelLoader,
        infoOverride.SeedVR2LoadDiTModel,
        infoOverride.SeedVR2LoadVAEModel,
        infoOverride.SeedVR2VideoUpscaler,
        infoOverride.RemoteImageTensorNormalize,
        infoOverride.VRAM_Debug,
      ]
    : await Promise.all([
        objectDefinition("UpscaleModelLoader"),
        objectDefinition("SeedVR2LoadDiTModel"),
        objectDefinition("SeedVR2LoadVAEModel"),
        objectDefinition("SeedVR2VideoUpscaler"),
        objectDefinition("RemoteImageTensorNormalize"),
        objectDefinition("VRAM_Debug"),
      ]);
  const [upscale, seedDit, seedVae, seedUpscaler, seedNormalize, vramDebug] = definitions;
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

async function standaloneUpscaleCapabilities(infoOverride = null, statsOverride = undefined) {
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
  const [definitions, stats] = infoOverride
    ? [nodeNames.map((name) => infoOverride[name] || null), statsOverride ?? null]
    : await Promise.all([
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
  maxAge: "5m",
  setHeaders(response, filePath) {
    if (filePath.endsWith(".html")) {
      response.setHeader("cache-control", "no-cache");
      return;
    }
    if (/\.(?:css|js|png|jpe?g|webp|svg|woff2?)$/i.test(filePath)) {
      response.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=300");
    }
  },
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

function interactiveCastActorReferencePaths(project, limit = 2) {
  const references = [];
  for (const actor of project.actors?.added || []) {
    if (references.length >= limit) break;
    if (actor.type === "characterPack") {
      const characterId = String(actor.actorId || "").replace(/^character:/, "");
      try {
        const character = characterStore.getCharacter(characterId);
        const adapter = resolveCharacterAdapter({ character, options: character.settings, generationType: "anchor-verification" });
        for (const reference of adapter.references || []) {
          const resolved = characterStore.assetPath(character.id, reference.id);
          if (resolved?.path && fs.existsSync(resolved.path)) references.push(resolved.path);
          if (references.length >= limit) break;
        }
      } catch {
        // A missing Character Pack is reported later by the anchor gate.
      }
      continue;
    }
    const referencePath = actor.reference?.relativePath
      ? interactiveCastStore.assetPath(project.id, actor.reference.relativePath)
      : actor.reference?.path;
    if (referencePath && fs.existsSync(referencePath)) references.push(referencePath);
  }
  return references.slice(0, limit);
}

function interactiveCastVideoResolution(project, requested = "") {
  if (["360p", "480p", "720p"].includes(requested)) return requested;
  const longest = Math.max(Number(project.analysis?.width || 0), Number(project.analysis?.height || 0));
  if (longest >= 1100) return "720p";
  if (longest >= 720) return "480p";
  return "360p";
}

async function queueInteractiveCastLtxSegment({ project, task, anchorUpload, settings, sourceGenerationId }) {
  const segment = (project.renderPackage?.segments || []).find((item) => item.id === task.segmentId);
  if (!segment?.sourceClipPath || !fs.existsSync(segment.sourceClipPath)) {
    throw new Error("Source clip Interactive Cast mancante: prepara nuovamente i segmenti.");
  }
  const duration = Math.max(1, Math.min(30, Number(task.duration || 1)));
  const sourceVideoUpload = await uploadLocalVideoForComfy(segment.sourceClipPath);
  const config = await videoStudioRuntimeConfig();
  const job = buildInteractiveCastUnionJob({
    prompt: task.prompt,
    negativePrompt: `${task.negativePrompt || ""}, subtitles, captions, on-screen text, changed camera, changed original actors`,
    projectId: project.id,
    segmentId: task.segmentId,
    duration,
    quality: settings.quality === "max" ? "max" : "preview",
    seed: settings.seed,
    controlType: "edges",
    controlStrength: settings.quality === "max" ? 1.05 : 1.15,
  }, {
    guideVideo: sourceVideoUpload,
    referenceSheet: anchorUpload,
  }, config);
  job.metadata = {
    ...job.metadata,
    projectId: project.id,
    workflowId: "interactiveCast:ltx-segment",
    workflowName: `Interactive Cast · LTX segmento ${task.segmentId}`,
    interactiveCast: {
      projectId: project.id,
      segmentId: task.segmentId,
      phase: "video-union-control",
      anchorWorkflowId: settings.anchorWorkflowId,
      sourceGenerationId,
      settings,
    },
  };
  const generation = await queueStudioJob(job, project.id);
  interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
    status: "queued",
    phase: "video-union-control",
    generationId: generation.id,
    anchorGenerationId: sourceGenerationId,
    settings,
  });
  return generation;
}

async function queueInteractiveCastAnchorRefine({
  project,
  task,
  sourceUpload,
  settings,
  sourceGenerationId,
  protectedRegion,
  referencePaths,
}) {
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
      protectedRegion,
      referencePaths,
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

const INTERACTIVE_CAST_QWEN_2511_MODEL = "QWEN\\qwen_image_edit_2511_bf16.safetensors";
const INTERACTIVE_CAST_ANCHOR_MAX_ATTEMPTS = 3;

function interactiveCastAnchorInstruction(project, task) {
  const addedActorNames = new Set((project.actors?.added || [])
    .flatMap((actor) => [actor.name, actor.actorId])
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase()));
  const events = (project.dialogueEvents || []).filter((event) =>
    Number(event.end || 0) > Number(task.start || 0) && Number(event.start || 0) < Number(task.end || 0)
    && addedActorNames.has(String(event.speaker || "").trim().toLowerCase())
  );
  return events.map((event) => event.action || "").join(" ");
}

function portableGraymapMask(region, width = 512, height = 512) {
  const pixels = Buffer.alloc(width * height);
  const left = Math.max(0, Math.floor(region.x * width));
  const top = Math.max(0, Math.floor(region.y * height));
  const right = Math.min(width, Math.ceil((region.x + region.width) * width));
  const bottom = Math.min(height, Math.ceil((region.y + region.height) * height));
  for (let y = top; y < bottom; y += 1) {
    pixels.fill(255, y * width + left, y * width + right);
  }
  return Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii"), pixels]);
}

async function uploadInteractiveCastAnchorMask(project, task, region) {
  const maskWidth = 1024;
  const maskHeight = Math.max(384, Math.round(maskWidth * Number(project.analysis?.height || 1) / Number(project.analysis?.width || 1)));
  const buffer = portableGraymapMask(region, maskWidth, maskHeight);
  const upload = await comfy.uploadImage({
    buffer,
    mimetype: "image/x-portable-graymap",
    originalname: `interactive-cast-${project.id}-${task.segmentId}-${region.label}-mask.pgm`,
    size: buffer.length,
  });
  return { upload, region };
}

function interactiveCastAnchorPrompt(task, region, attempt) {
  const placement = region.overridden
    ? `The requested ${region.requested} entrance overlaps an existing person, so place the added actor in the safe ${region.label} slot.`
    : `Place the added actor inside the ${region.label} slot.`;
  return [
    task.anchorPrompt || task.anchorRequirement,
    `ANCHOR INSERTION ATTEMPT ${attempt}.`,
    placement,
    `Insertion area in normalized source-frame coordinates: x ${Number(region.x).toFixed(3)}, y ${Number(region.y).toFixed(3)}, width ${Number(region.width).toFixed(3)}, height ${Number(region.height).toFixed(3)}.`,
    "IMAGE 2 and later images are identity references only. Do not copy their backgrounds, framing, panels, borders or layouts into the source scene.",
    "The final frame must contain exactly one more adult person than IMAGE 1.",
    "The added person must be visibly distinct from every existing person and must match the identity reference face, hair, age and body proportions.",
    "Pose the added actor at the beginning of the entrance: partially inside the frame but with the full face clearly visible, looking naturally into the scene.",
    "Never transform, replace, redress, move or reuse an existing person as the added actor.",
    "Keep the added actor's face clearly visible in a natural three-quarter or frontal orientation so identity can be verified before video generation.",
  ].join(" ");
}

function comfyInputPath(upload) {
  return upload?.subfolder ? `${upload.subfolder}/${upload.name}` : upload?.name;
}

function protectInteractiveCastAnchor(workflow, maskUpload, outputBase) {
  if (!workflow?.["20"] || !workflow?.["7"] || !workflow?.["8"] || !workflow?.["9"] || !workflow?.["10"] || !maskUpload?.name) {
    throw new Error("Il workflow Qwen Image Edit 2511 non espone i nodi richiesti per l'anchor protetto.");
  }
  workflow["970100"] = {
    inputs: { image: ["20", 0] },
    class_type: "GetImageSize",
    _meta: { title: "Interactive Cast · dimensioni frame originale" },
  };
  workflow["970101"] = {
    inputs: {
      image: ["9", 0],
      upscale_method: "lanczos",
      width: ["970100", 0],
      height: ["970100", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Interactive Cast · anchor alla risoluzione sorgente" },
  };
  workflow["970102"] = {
    inputs: { image: comfyInputPath(maskUpload) },
    class_type: "LoadImage",
    _meta: { title: "Interactive Cast · maschera inserimento" },
  };
  workflow["970103"] = {
    inputs: {
      image: ["970102", 0],
      upscale_method: "nearest-exact",
      width: ["970100", 0],
      height: ["970100", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Interactive Cast · maschera alla risoluzione sorgente" },
  };
  workflow["970104"] = {
    inputs: { image: ["970103", 0], channel: "red" },
    class_type: "ImageToMask",
    _meta: { title: "Interactive Cast · maschera compositing sorgente" },
  };
  workflow["970109"] = {
    inputs: { image: ["21", 0] },
    class_type: "GetImageSize",
    _meta: { title: "Interactive Cast · dimensioni latent Qwen" },
  };
  workflow["970110"] = {
    inputs: {
      image: ["970102", 0],
      upscale_method: "nearest-exact",
      width: ["970109", 0],
      height: ["970109", 1],
      crop: "disabled",
    },
    class_type: "ImageScale",
    _meta: { title: "Interactive Cast · maschera alla risoluzione latent" },
  };
  workflow["970111"] = {
    inputs: { image: ["970110", 0], channel: "red" },
    class_type: "ImageToMask",
    _meta: { title: "Interactive Cast · noise mask Qwen" },
  };
  workflow["970108"] = {
    inputs: { samples: ["7", 0], mask: ["970111", 0] },
    class_type: "SetLatentNoiseMask",
    _meta: { title: "Interactive Cast · denoise limitato all'area inserimento" },
  };
  workflow["8"].inputs.latent_image = ["970108", 0];
  workflow["970105"] = {
    inputs: { mask: ["970104", 0], expand: 12, tapered_corners: true },
    class_type: "GrowMask",
    _meta: { title: "Interactive Cast · espansione controllata" },
  };
  workflow["970106"] = {
    inputs: { mask: ["970105", 0], left: 24, top: 24, right: 24, bottom: 24 },
    class_type: "FeatherMask",
    _meta: { title: "Interactive Cast · bordo naturale" },
  };
  workflow["970107"] = {
    inputs: {
      destination: ["20", 0],
      source: ["970101", 0],
      x: 0,
      y: 0,
      resize_source: false,
      mask: ["970106", 0],
    },
    class_type: "ImageCompositeMasked",
    _meta: { title: "Interactive Cast · ricomposizione protetta sul frame originale" },
  };
  workflow["10"].inputs.images = ["970107", 0];
  workflow["10"].inputs.filename_prefix = `${outputBase}/anchor_qwen2511_protetto`;
}

async function queueInteractiveCastAnchorBase({ project, task, settings, attempt = 1, previousAttempts = [] }) {
  const sourceUpload = await uploadLocalImageForComfy(task.anchorFrame.path);
  const actorReferenceUploads = await uploadInteractiveCastActorReferences(project, 2);
  const referencePaths = interactiveCastActorReferencePaths(project, 2);
  if (!actorReferenceUploads.length || !referencePaths.length) {
    throw new Error("Interactive Cast richiede almeno una reference identità leggibile prima di creare l'anchor.");
  }
  const placement = await planAnchorPlacement({
    root,
    outputDirectory,
    sourcePath: task.anchorFrame.path,
    instruction: interactiveCastAnchorInstruction(project, task),
    attempt,
  });
  if (placement.analysis.status !== "analyzed") {
    throw new Error(`Analisi posizione anchor fallita: ${placement.analysis.error || "InsightFace non disponibile"}`);
  }
  const anchorMask = await uploadInteractiveCastAnchorMask(project, task, placement.region);
  const referenceUploads = actorReferenceUploads;
  const outputBase = `InteractiveCast/${project.id}/${task.segmentId}/anchor-base/attempt-${attempt}`;
  const attemptSeed = (Number(settings.seed) + ((attempt - 1) * 104729)) % (2 ** 31);
  const job = buildImageWorkflow("qwenEdit", {
    imageMode: "image",
    imageModelFile: INTERACTIVE_CAST_QWEN_2511_MODEL,
    imageResolution: "custom",
    imageWidth: Math.min(4096, Math.max(256, Number(project.analysis?.width || 1152))),
    imageHeight: Math.min(4096, Math.max(256, Number(project.analysis?.height || 896))),
    imageSteps: settings.quality === "max" ? 32 : 24,
    imageGuidance: 1,
    batchSize: 1,
    prompt: interactiveCastAnchorPrompt(task, anchorMask.region, attempt),
    negativePrompt: task.anchorNegativePrompt || task.negativePrompt,
    seed: attemptSeed,
    referenceUploads,
    outputBase,
    saveOriginal: false,
    upscaleMode: "none",
  }, sourceUpload, []);
  protectInteractiveCastAnchor(job.workflow, anchorMask.upload, outputBase);
  job.metadata = {
    ...job.metadata,
    projectId: project.id,
    workflowId: "interactiveCast:anchor:qwen-image-edit",
    workflowName: `Interactive Cast · anchor Qwen ${task.segmentId} · tentativo ${attempt}`,
    interactiveCast: {
      projectId: project.id,
      segmentId: task.segmentId,
      phase: "anchor-base",
      anchorWorkflowId: settings.anchorWorkflowId,
      referenceCount: actorReferenceUploads.length,
      placementGuideIncluded: false,
      placementMaskMode: "latent-noise-mask",
      imageModelFile: INTERACTIVE_CAST_QWEN_2511_MODEL,
      promptRole: "static-anchor-only",
      protectedRegion: anchorMask.region,
      protectedOutsideRegion: true,
      anchorAttempt: attempt,
      anchorMaxAttempts: INTERACTIVE_CAST_ANCHOR_MAX_ATTEMPTS,
      referencePaths,
      settings,
    },
  };
  const generation = await queueStudioJob(job, project.id);
  const updated = interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
    status: "queued",
    phase: "anchor-base",
    generationId: generation.id,
    anchorAttempt: attempt,
    anchorMaxAttempts: INTERACTIVE_CAST_ANCHOR_MAX_ATTEMPTS,
    anchorAttempts: previousAttempts,
    anchorPlacement: anchorMask.region,
    settings,
  });
  return { project: updated, generation };
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
  return queueInteractiveCastAnchorBase({ project, task, settings, attempt: 1 });
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
    if (["video", "video-union-control"].includes(metadata.phase)) {
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
    const resolvedAnchor = resolveMediaFile(outputDirectory, image);
    if (!resolvedAnchor?.path) throw new Error("File anchor Interactive Cast non trovato su disco.");
    const referencePaths = (metadata.referencePaths || interactiveCastActorReferencePaths(project, 2))
      .filter((item) => item && fs.existsSync(item));
    const anchorVerification = await verifyAnchorCandidate({
      root,
      outputDirectory,
      sourcePath: task.anchorFrame.path,
      candidatePath: resolvedAnchor.path,
      referencePaths,
      region: metadata.protectedRegion,
    });
    const latestProject = interactiveCast.get(project.id);
    const latestTask = interactiveCastSegmentTask(latestProject, task.segmentId);
    const attempt = Number(metadata.anchorAttempt || latestTask.generation?.anchorAttempt || 1);
    const anchorCandidate = interactiveCastStore.writeAnchorCandidate(
      project.id,
      task.segmentId,
      resolvedAnchor.path,
      attempt,
    );
    const anchorAttempts = [
      ...(latestTask.generation?.anchorAttempts || []),
      {
        attempt,
        generationId: generation.id,
        status: anchorVerification.status,
        report: anchorVerification,
        image,
        candidate: anchorCandidate,
      },
    ];
    interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
      status: anchorVerification.status === "passed" ? "anchorValidated" : "anchorRejected",
      phase: metadata.phase,
      generationId: generation.id,
      anchorAttempt: attempt,
      anchorAttempts,
      anchorVerification,
      anchorImage: image,
      anchorCandidate,
      settings: metadata.settings,
    });
    if (anchorVerification.status !== "passed") {
      if (metadata.phase === "anchor-base" && attempt < Number(metadata.anchorMaxAttempts || INTERACTIVE_CAST_ANCHOR_MAX_ATTEMPTS)) {
        const retryProject = interactiveCast.get(project.id);
        const retryTask = interactiveCastSegmentTask(retryProject, task.segmentId);
        await queueInteractiveCastAnchorBase({
          project: retryProject,
          task: retryTask,
          settings: metadata.settings,
          attempt: attempt + 1,
          previousAttempts: anchorAttempts,
        });
        return;
      }
      throw new Error(
        `Anchor rifiutato prima di LTX: ${anchorVerification.failures?.join(", ") || anchorVerification.error || "identità non verificata"}.`
      );
    }
    const upload = await comfy.reuseOutputImage(image, `interactive-cast-${task.segmentId}-${metadata.phase}.png`);
    if (metadata.phase === "anchor-base" && metadata.anchorWorkflowId !== "qwen-image-edit") {
      await queueInteractiveCastAnchorRefine({
        project,
        task,
        sourceUpload: upload,
        settings: metadata.settings,
        sourceGenerationId: generation.id,
        protectedRegion: metadata.protectedRegion,
        referencePaths,
      });
      return;
    }
    if (metadata.settings?.autoApproveAnchor !== true) {
      interactiveCast.updateSegmentGeneration(project.id, task.segmentId, {
        status: "anchorReady",
        phase: "anchor-review",
        generationId: generation.id,
        anchorVerification,
        anchorCandidate,
        anchorImage: image,
        settings: metadata.settings,
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

async function approveInteractiveCastAnchor(projectId, segmentId) {
  const project = interactiveCast.get(projectId);
  const task = interactiveCastSegmentTask(project, segmentId);
  if (task.generation?.status !== "anchorReady") {
    const error = new Error("L'anchor non è in attesa di approvazione oppure il segmento è già stato accodato.");
    error.statusCode = 409;
    throw error;
  }
  const verification = task.generation?.anchorVerification;
  const candidate = task.generation?.anchorCandidate;
  if (verification?.status !== "passed") {
    throw new Error("L'anchor non ha superato identity e preservation gate.");
  }
  if (!candidate?.path || !fs.existsSync(candidate.path)) {
    throw new Error("File anchor approvabile non trovato.");
  }
  const anchorUpload = await uploadLocalImageForComfy(candidate.path);
  const generation = await queueInteractiveCastLtxSegment({
    project,
    task,
    anchorUpload,
    settings: task.generation.settings,
    sourceGenerationId: task.generation.generationId,
  });
  return { project: interactiveCast.get(projectId), generation };
}

async function importInteractiveCastAnchor(projectId, segmentId, file) {
  const project = interactiveCast.get(projectId);
  const task = interactiveCastSegmentTask(project, segmentId);
  if (task.mode !== "generative") {
    throw new Error("Un anchor esterno può essere usato soltanto per una finestra generativa.");
  }
  if (!task.anchorFrame?.path || !fs.existsSync(task.anchorFrame.path)) {
    throw new Error("Frame sorgente dell'anchor mancante: prepara nuovamente i segmenti.");
  }
  const referencePaths = interactiveCastActorReferencePaths(project, 2)
    .filter((item) => item && fs.existsSync(item));
  if (!referencePaths.length) {
    throw new Error("Manca una reference identità con cui verificare l'anchor esterno.");
  }
  let region = task.generation?.anchorPlacement;
  if (!region) {
    const placement = await planAnchorPlacement({
      root,
      outputDirectory,
      sourcePath: task.anchorFrame.path,
      instruction: interactiveCastAnchorInstruction(project, task),
      attempt: 1,
    });
    if (placement.analysis.status !== "analyzed") {
      throw new Error(`Analisi posizione anchor fallita: ${placement.analysis.error || "InsightFace non disponibile"}`);
    }
    region = placement.region;
  }
  const uploaded = interactiveCastStore.writeUpload(projectId, file, `external-anchor-${segmentId}`);
  const verification = await verifyAnchorCandidate({
    root,
    outputDirectory,
    sourcePath: task.anchorFrame.path,
    candidatePath: uploaded.path,
    referencePaths,
    region,
  });
  const blockingFailures = (verification.failures || []).filter((failure) => failure !== "outsideRegionPreserved");
  const accepted = verification.status === "passed" || (
    verification.status === "rejected" && blockingFailures.length === 0
  );
  const attempt = Number(task.generation?.anchorAttempt || 0) + 1;
  const candidate = interactiveCastStore.writeAnchorCandidate(projectId, segmentId, uploaded.path, attempt);
  const externalVerification = {
    ...verification,
    status: accepted ? "passed" : verification.status,
    failures: blockingFailures,
    warnings: verification.checks?.outsideRegionPreserved === false
      ? ["outsideRegionReconstructedByExternalEditor"]
      : [],
    externalAnchor: true,
  };
  const settings = task.generation?.settings || {
    anchorWorkflowId: "external-anchor",
    quality: "preview",
    resolution: interactiveCastVideoResolution(project),
    seed: crypto.randomInt(0, 2 ** 31),
  };
  const updated = interactiveCast.updateSegmentGeneration(projectId, segmentId, {
    status: accepted ? "anchorReady" : "anchorRejected",
    phase: "anchor-external-review",
    generationId: `external-anchor:${crypto.randomUUID()}`,
    anchorAttempt: attempt,
    anchorMaxAttempts: INTERACTIVE_CAST_ANCHOR_MAX_ATTEMPTS,
    anchorPlacement: region,
    anchorVerification: externalVerification,
    anchorCandidate: candidate,
    settings,
    error: accepted
      ? null
      : `Anchor esterno rifiutato: ${blockingFailures.join(", ") || verification.error || "verifica non superata"}.`,
  });
  return { project: updated, verification: externalVerification };
}

async function buildAppConfig(infoOverride = null) {
  // Un errore di connessione non equivale a un inventario ComfyUI vuoto.
  // Lasciamo fallire il refresh così l'ultima snapshot verificata resta valida.
  const info = infoOverride ?? await comfy.objectInfo();
  const installedImageModels = comboOptions(info.UNETLoader?.input?.required?.unet_name);
  const installedImageCheckpoints = comboOptions(info.CheckpointLoaderSimple?.input?.required?.ckpt_name);
  const installedImageClips = comboOptions(info.CLIPLoader?.input?.required?.clip_name);
  const installedImageVaes = comboOptions(info.VAELoader?.input?.required?.vae_name);
  const installedLoras = comboOptions(info.LoraLoaderModelOnly?.input?.required?.lora_name);
  const installedModelPatches = comboOptions(info.ModelPatchLoader?.input?.required?.name);
  const configuredVideoModels = videoModelConfig(installedImageModels);
  const studioPreprocessors = [
    info.Canny ? "Canny" : null,
    info.DepthAnythingV2Preprocessor ? "DepthAnythingV2Preprocessor" : null,
  ].filter(Boolean);
  const availableLtxUpscaleNodes = LTX_UPSCALE_REQUIRED_NODES.filter((name) => Boolean(info[name]));
  const seedvrNodes = [...SEEDVR2_VIDEO_UPSCALE_REQUIRED_NODES, "SeedVR2TorchCompileSettings"];
  const voiceCapabilities = voiceEngineCapabilities({ root });
  const lipSyncCapabilities = lipsyncCapabilities({ root });
  const seedvr2VideoConfig = seedvr2VideoUpscaleConfig({
    availableNodes: seedvrNodes.filter((name) => Boolean(info[name])),
    installedSeedvr2Models: comboOptions(info.SeedVR2LoadDiTModel?.input?.required?.model),
    installedVaes: comboOptions(info.SeedVR2LoadVAEModel?.input?.required?.model),
  });
  const [enhancements, upscaling, videoStudio] = await Promise.all([
    imageEnhancementCapabilities(info),
    standaloneUpscaleCapabilities(info, null),
    videoStudioRuntimeConfig(info),
  ]);
  return {
    workflows: Object.values(WORKFLOWS).map(({ file: _file, ...item }) => item),
    videoModels: configuredVideoModels,
    characterVideoRouter: createCharacterVideoRouter({
      videoModels: configuredVideoModels,
      audioCapabilities: {
        voiceTts: voiceCapabilities.synthesizeDialogue,
        lipSync: lipSyncCapabilities.applyLipSync,
      },
      workflowAvailability: Object.fromEntries(["standard", "devfp8", "minimaxH3"].map((workflowId) => {
        try {
          const candidate = buildWorkflow(workflowId, {
            prompt: "Capability validation for a stable character image-to-video shot.",
            negativePrompt: "identity drift, flicker",
            resolution: "360p",
            orientation: "portrait",
            duration: 5,
            quality: "preview",
            videoModelId: "normal",
            videoInputMode: "image",
            seed: 1,
          }, { name: "character-video-capability.png", subfolder: "capability" }, [], []);
          return [workflowId, validateWorkflow(candidate.workflow, info, { label: `Character Video · ${workflowId}` }).length === 0];
        } catch {
          return [workflowId, false];
        }
      })),
    }),
    resolutions: RESOLUTIONS,
    imageModels: imageModelConfig(installedImageModels, {
      checkpoints: installedImageCheckpoints,
      clips: installedImageClips,
      vaes: installedImageVaes,
    }),
    imageResolutions: IMAGE_RESOLUTIONS,
    loras: installedLoras,
    loraMetadata: loraTriggerMetadata(installedLoras),
    fps: 24,
    outputDirectory,
    maxUploadMb,
    maxVideoUploadMb,
    imageEnhancements: enhancements,
    upscaling,
    ltxUpscale: ltxUpscaleConfig({
      availableNodes: availableLtxUpscaleNodes,
      installedCheckpoints: [...installedImageModels, ...installedImageCheckpoints],
      installedLoras,
      installedTextEncoders: installedImageClips,
      installedVaes: installedImageVaes,
    }),
    seedvr2VideoUpscale: seedvr2VideoConfig,
    characterVideoAudio: {
      voice: voiceCapabilities,
      lipSync: lipSyncCapabilities,
      modes: [
        { id: "none", name: "Nessun audio", available: true },
        { id: "native", name: "Audio nativo del Video Engine", available: true },
        { id: "externalTts", name: "TTS esterno · Chatterbox Multilingual", available: voiceCapabilities.synthesizeDialogue && lipSyncCapabilities.applyLipSync },
        { id: "existing", name: "File audio esistente", available: lipSyncCapabilities.applyLipSync },
      ],
      refine: {
        available: seedvr2VideoConfig.available,
        presets: [
          { id: "original", name: "Originale", available: true },
          { id: "improved", name: "Migliorato", available: seedvr2VideoConfig.profiles.some((profile) => profile.id === "preview" && profile.available) },
          { id: "quality", name: "Qualità", available: seedvr2VideoConfig.profiles.some((profile) => profile.id === "quality" && profile.available) },
        ],
      },
    },
    studio: studioConfig({
      modelPatches: installedModelPatches,
      preprocessors: studioPreprocessors,
      imageModels: installedImageModels,
    }),
    videoStudio,
    interactiveCast: interactiveCastCapabilitiesCache.value
      || appConfigCache.value?.interactiveCast
      || { status: "loading", matrix: {}, statuses: {} },
    promptAssistant: { ...promptAssistant.publicConfig(), autoGenerate: promptAssistantAutoGenerate },
    sulphur: sulphurRuntimeConfig(),
    editWildcards: editWildcardConfig(root),
    poseLibrary: poseLibraryConfig(root),
    sceneIntegration: sceneCapabilitiesCache.value
      || appConfigCache.value?.sceneIntegration
      || { enabled: sceneIntegrationEnabled, available: false, status: "loading" },
    characters: {
      available: true,
      conceptualName: "Character",
      legacyConceptualName: "Virtual Actor",
      genesis: {
        guided: true,
        sourceTypes: ["description", "photo"],
        subjectKinds: ["auto", "human", "animal", "other"],
        defaultCandidateCount: 4,
        workflow: "KreaTriple_T2I_API.json",
        modes: [{ id: "krea2", label: "Krea 2 · workflow disponibile", available: true }],
        unavailableModes: ["Krea 2 Turbo", "Krea 2 RAW / Quality"],
      },
      referenceFactory: {
        guided: true,
        adaptive: true,
        preferredWorkflow: "qwenEdit",
        fallbackWorkflows: ["flux2", "mageFlowEdit"],
        decisions: ["approve", "reject", "regenerate"],
      },
      sheetWorkflows: Object.values(CHARACTER_SHEET_WORKFLOWS),
      availableCharacters: characterStore.listCharacters().map((character) => ({
        id: character.id,
        name: character.name,
        subjectKind: character.subjectKind,
        heroUrl: character.heroUrl,
        packStatus: character.packStatus,
        referenceCount: character.references?.length || 0,
        settings: character.settings,
      })),
      legacyImport: characterStore.legacySummary({ dataDirectory: path.join(root, ".data") }),
    },
    cache: { generatedAt: new Date().toISOString(), ttlMs: APP_CONFIG_TTL_MS },
  };
}

function persistAppConfigSnapshot() {
  if (!appConfigCache.value) return Promise.resolve();
  return fs.promises.mkdir(path.dirname(APP_CONFIG_CACHE_FILE), { recursive: true })
    .then(() => fs.promises.writeFile(
      APP_CONFIG_CACHE_FILE,
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), value: appConfigCache.value }),
      "utf8",
    ));
}

function refreshAppConfig() {
  if (appConfigCache.refreshPromise) return appConfigCache.refreshPromise;
  appConfigCache.refreshPromise = buildAppConfig()
    .then((value) => {
      appConfigCache.value = value;
      appConfigCache.updatedAt = Date.now();
      void persistAppConfigSnapshot().catch(() => {});
      return value;
    })
    .finally(() => {
      appConfigCache.refreshPromise = null;
    });
  return appConfigCache.refreshPromise;
}

function invalidateAppConfig() {
  if (!appConfigCache.value?.characters) {
    appConfigCache.updatedAt = 0;
    return;
  }
  appConfigCache.value.characters.availableCharacters = characterStore.listCharacters().map((character) => ({
    id: character.id,
    name: character.name,
    subjectKind: character.subjectKind,
    heroUrl: character.heroUrl,
    packStatus: character.packStatus,
    referenceCount: character.references?.length || 0,
    settings: character.settings,
  }));
  appConfigCache.updatedAt = Date.now();
  void persistAppConfigSnapshot().catch(() => {});
}

function refreshInteractiveCastCapabilities() {
  if (interactiveCastCapabilitiesCache.refreshPromise) {
    return interactiveCastCapabilitiesCache.refreshPromise;
  }
  interactiveCastCapabilitiesCache.refreshPromise = interactiveCast.capabilities()
    .then((value) => {
      interactiveCastCapabilitiesCache.value = value;
      interactiveCastCapabilitiesCache.updatedAt = Date.now();
      if (appConfigCache.value) appConfigCache.value.interactiveCast = value;
      void persistAppConfigSnapshot().catch(() => {});
      return value;
    })
    .finally(() => {
      interactiveCastCapabilitiesCache.refreshPromise = null;
    });
  return interactiveCastCapabilitiesCache.refreshPromise;
}

function refreshSceneCapabilities() {
  if (sceneCapabilitiesCache.refreshPromise) return sceneCapabilitiesCache.refreshPromise;
  sceneCapabilitiesCache.refreshPromise = sceneIntegration.capabilities()
    .then((value) => {
      sceneCapabilitiesCache.value = value;
      sceneCapabilitiesCache.updatedAt = Date.now();
      if (appConfigCache.value) appConfigCache.value.sceneIntegration = value;
      void persistAppConfigSnapshot().catch(() => {});
      return value;
    })
    .finally(() => {
      sceneCapabilitiesCache.refreshPromise = null;
    });
  return sceneCapabilitiesCache.refreshPromise;
}

app.get("/api/config", async (request, response, next) => {
  try {
    const age = Date.now() - appConfigCache.updatedAt;
    const force = request.query.refresh === "1";
    if (appConfigCache.value && !force) {
      const stale = Boolean(appConfigCache.value.cache?.bootstrap) || age > APP_CONFIG_TTL_MS;
      response.setHeader("x-config-cache", stale ? "stale" : "fresh");
      response.setHeader("cache-control", "private, max-age=15, stale-while-revalidate=300");
      if (stale) void refreshAppConfig().catch(() => {});
      return response.json(stale
        ? { ...appConfigCache.value, cache: { ...appConfigCache.value.cache, stale: true } }
        : appConfigCache.value);
    }
    const refresh = refreshAppConfig();
    let bootstrapTimer = null;
    let result = await Promise.race([
      refresh.then((value) => ({ value, source: "miss" })).catch(() => null),
      new Promise((resolve) => {
        bootstrapTimer = setTimeout(() => resolve(null), APP_CONFIG_BOOTSTRAP_WAIT_MS);
      }),
    ]);
    clearTimeout(bootstrapTimer);
    if (!result && appConfigCache.value) {
      result = {
        value: {
          ...appConfigCache.value,
          cache: { ...appConfigCache.value.cache, stale: true, comfyOffline: true },
        },
        source: "stale",
      };
    }
    if (!result) result = { value: await buildAppConfig({}), source: "bootstrap" };
    if (result.source === "bootstrap") {
      result.value = {
        ...result.value,
        cache: { ...result.value.cache, bootstrap: true },
      };
      if (!appConfigCache.value) {
        appConfigCache.value = result.value;
        appConfigCache.updatedAt = Date.now();
      }
    }
    response.setHeader("x-config-cache", result.source);
    response.setHeader("cache-control", "private, max-age=15, stale-while-revalidate=300");
    response.json(result.value);
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters", (_request, response) => {
  response.json({ characters: characterStore.listCharacters() });
});

const CHARACTER_REFERENCE_ENGINES = new Set(["qwen2511", "pornmaster-v4-turbo"]);

function characterReferenceEngineCatalog(imageModels = []) {
  return characterPhotoEngineCatalog(imageModels).filter((engine) => CHARACTER_REFERENCE_ENGINES.has(engine.engineId));
}

async function characterReferenceWorkflow(preferredEngine = "auto") {
  let config = appConfigCache.value;
  if (!config?.imageModels?.length) {
    config = await refreshAppConfig().catch(() => config);
  }
  const pickPreferred = (value) => {
    const engines = characterReferenceEngineCatalog(value?.imageModels || []);
    return preferredEngine === "auto" ? engines[0] : engines.find((engine) => engine.engineId === preferredEngine);
  };
  let preferred = pickPreferred(config);
  if (!preferred) {
    config = await refreshAppConfig().catch(() => config);
    preferred = pickPreferred(config);
  }
  if (!preferred) {
    throw new Error(preferredEngine === "auto"
      ? "Nessun motore Reference compatibile disponibile: servono Qwen Image Edit 2511 o PornMaster Flux2 Klein v4Turbo."
      : "Il motore Reference selezionato non è disponibile con tutti i componenti richiesti.");
  }
  const acceleration = qwenEdit2511Lightning8Preset(preferred.modelFile);
  return {
    id: preferred.id,
    engineId: preferred.engineId,
    name: preferred.name,
    model: preferred.modelFile,
    mode: "image",
    steps: acceleration?.steps || preferred.defaults?.steps,
    guidance: acceleration?.guidance ?? preferred.defaults?.guidance,
    samplingProfile: acceleration?.samplingProfile || preferred.samplingProfile || "model-native",
  };
}

app.get("/api/characters/:id/reference-config", async (request, response, next) => {
  try {
    characterStore.getCharacter(request.params.id);
    await refreshAppConfig();
    const engines = characterReferenceEngineCatalog(appConfigCache.value?.imageModels || []).map((engine) => {
      const acceleration = qwenEdit2511Lightning8Preset(engine.modelFile);
      return {
        id: engine.engineId,
        name: engine.name,
        model: engine.modelFile,
        steps: acceleration?.steps || engine.defaults?.steps,
        guidance: acceleration?.guidance ?? engine.defaults?.guidance,
        samplingProfile: acceleration?.samplingProfile || engine.samplingProfile || "model-native",
      };
    });
    response.json({ engines, defaultEngine: engines[0]?.id || null });
  } catch (error) {
    next(error);
  }
});

function characterHeroAsset(character) {
  if (!character.heroImage) throw new Error("Il Character deve avere una Hero prima di creare le reference.");
  const hero = characterStore.assetPath(character.id, character.heroImage);
  if (!hero?.path) throw new Error("Il file Hero del Character non è disponibile.");
  return hero;
}

function mergeApprovedReferenceRoles(plan, character) {
  const approvedByRole = new Map((character.references || [])
    .filter((reference) => reference.status !== "rejected" && reference.referenceRole)
    .map((reference) => [reference.referenceRole, reference]));
  return {
    ...plan,
    items: plan.items.map((item) => {
      const approved = approvedByRole.get(item.referenceRole);
      return approved ? {
        ...item,
        status: "approved",
        approvedReferenceId: approved.id,
      } : item;
    }),
  };
}

function referencePlanGenerations(plan) {
  const ids = new Set((plan?.items || []).flatMap((item) => item.candidateGenerationIds || []));
  return [...ids].map((id) => store.get(id)).filter(Boolean);
}

async function generationImageFile(generation, imageIndex = 0) {
  const image = generation.images?.[Number(imageIndex) || 0] || generation.images?.[0];
  if (!image) throw new Error("La generazione non contiene una candidate reference.");
  const local = resolveMediaFile(outputDirectory, image);
  if (local?.path) {
    const extension = path.extname(local.path).toLowerCase();
    return {
      buffer: fs.readFileSync(local.path),
      mimetype: extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp" ? "image/webp" : "image/png",
      originalname: image.filename,
    };
  }
  const upstream = await fetch(comfy.mediaUrl(image), { signal: AbortSignal.timeout(600000) });
  if (!upstream.ok) throw new Error(`Impossibile recuperare la reference da ComfyUI (${upstream.status}).`);
  return {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    mimetype: String(upstream.headers.get("content-type") || "image/png").split(";")[0].trim(),
    originalname: image.filename,
  };
}

async function queueCharacterReference(characterId, referenceRole, { force = false, preferredEngine = "auto" } = {}) {
  const character = characterStore.getCharacter(characterId);
  const plan = character.referencePlan;
  if (!plan) throw new Error("Prepara prima l'Adaptive Reference Plan.");
  const item = plan.items.find((entry) => entry.referenceRole === referenceRole);
  if (!item) throw new Error("Ruolo reference non presente nel piano adattivo.");
  const current = item.candidateGenerationId ? store.get(item.candidateGenerationId) : null;
  if (force && current && ["queued", "running"].includes(current.status)) {
    throw new Error(`Una rigenerazione di ${referenceRole} è già in corso.`);
  }
  if (!force && (item.approvedReferenceId || current && !["error", "interrupted"].includes(current.status))) {
    return null;
  }
  if (!item.technicalPrompt) throw new Error(`Prompt tecnico mancante per ${referenceRole}. Ricrea il Reference Plan con LM Studio.`);
  const hero = characterHeroAsset(character);
  const source = await uploadCharacterAsset(hero);
  // Il piano conserva il motore scelto dall'utente: ogni reference dello stesso
  // set deve restare sulla medesima famiglia per evitare drift identitario.
  const workflow = await characterReferenceWorkflow(preferredEngine !== "auto"
    ? preferredEngine
    : plan.workflow?.engineId || "auto");
  const seed = crypto.randomInt(0, 2 ** 31);
  const job = buildCharacterReferenceJob({
    character: { ...character, subjectKind: plan.subjectKind || character.subjectKind },
    item,
    workflow,
    source,
    seed,
  });
  const generation = await queueStudioJob(job, character.id);
  const updatedPlan = patchReferencePlanItem({
    ...plan,
    workflow,
  }, item.referenceRole, {
    status: item.approvedReferenceId ? "regenerating" : "queued",
    candidateGenerationId: generation.id,
    candidateGenerationIds: [...new Set([...(item.candidateGenerationIds || []), generation.id])],
    lastSeed: seed,
  });
  characterStore.updateReferencePlan(character.id, updatedPlan);
  invalidateAppConfig();
  return generation;
}

function syncCharacterReferenceGeneration(generation) {
  if (generation?.generationPurpose !== "character_reference" || !generation.characterId || !generation.referenceRole) return null;
  try {
    const character = characterStore.getCharacter(generation.characterId);
    const item = character.referencePlan?.items?.find((entry) => entry.referenceRole === generation.referenceRole);
    if (!item || item.candidateGenerationId !== generation.id) return null;
    const status = generation.status === "completed"
      ? "ready"
      : ["error", "interrupted"].includes(generation.status)
        ? "error"
        : item.approvedReferenceId ? "regenerating" : generation.status;
    const updated = characterStore.updateReferencePlan(character.id, patchReferencePlanItem(
      character.referencePlan,
      item.referenceRole,
      { status },
    ));
    invalidateAppConfig();
    broadcast({ type: "character_updated", characterId: updated.id, data: updated });
    return updated;
  } catch {
    return null;
  }
}

app.post("/api/characters/:id/reference-plan", async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Adaptive Reference Factory richiede LM_STUDIO_MODEL configurato." });
    }
    const character = characterStore.getCharacter(request.params.id);
    const hero = characterHeroAsset(character);
    const workflow = await characterReferenceWorkflow(request.body?.engine || "auto");
    const allowedRoles = character.subjectKind === "auto"
      ? [...new Map(["human", "animal", "other"]
          .flatMap((kind) => referenceRoleCatalog(kind))
          .map((item) => [item.referenceRole, item])).values()]
      : referenceRoleCatalog(character.subjectKind);
    const planned = await promptAssistant.planCharacterReferences({
      character,
      workflow,
      allowedRoles,
      image: {
        buffer: fs.readFileSync(hero.path),
        mimetype: hero.mimeType || "image/png",
      },
    });
    const previousApproved = (character.referencePlan?.items || [])
      .filter((item) => item.approvedReferenceId);
    const plannedSubjectKind = character.subjectKind === "auto"
      ? normalizeSubjectKind(planned.subjectKind, "other")
      : character.subjectKind;
    let plan = normalizeReferencePlan({
      items: [...planned.items, ...previousApproved],
      heroReferenceId: character.heroImage,
    }, {
      subjectKind: plannedSubjectKind,
      workflow,
      existingPlan: character.referencePlan,
    });
    if (plan.items.length < 4 || plan.items.some((item) => !item.technicalPrompt)) {
      throw new Error("LM Studio ha restituito un piano incompleto: servono almeno 4 ruoli ammessi, ciascuno con prompt tecnico.");
    }
    plan = mergeApprovedReferenceRoles(plan, character);
    const updated = characterStore.updateReferencePlan(character.id, plan);
    invalidateAppConfig();
    response.json({
      character: updated,
      referencePlan: updated.referencePlan,
      promptModel: planned.model,
      cleanupWarning: planned.unloadError || null,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/:id/reference-plan", (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    response.json({
      character,
      referencePlan: character.referencePlan,
      generations: referencePlanGenerations(character.referencePlan),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/reference-plan/generate-missing", async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    if (!character.referencePlan) throw new Error("Prepara prima l'Adaptive Reference Plan.");
    const requestedEngine = String(request.body?.engine || character.referencePlan.workflow?.engineId || "auto");
    const requestedWorkflow = await characterReferenceWorkflow(requestedEngine);
    const engineChanged = Boolean(
      character.referencePlan.workflow?.engineId
      && character.referencePlan.workflow.engineId !== requestedWorkflow.engineId,
    );
    const generations = new Map(referencePlanGenerations(character.referencePlan).map((item) => [item.id, item]));
    const requestedRoles = new Set(Array.isArray(request.body?.roles) ? request.body.roles : []);
    const missing = (engineChanged
      ? character.referencePlan.items.filter((item) => !item.approvedReferenceId)
      : missingReferenceItems(character.referencePlan, generations))
      .filter((item) => !requestedRoles.size || requestedRoles.has(item.referenceRole));
    const queued = [];
    for (const item of missing) {
      const generation = await queueCharacterReference(character.id, item.referenceRole, {
        force: engineChanged,
        preferredEngine: requestedWorkflow.engineId,
      });
      if (generation) queued.push(generation);
    }
    const updated = characterStore.getCharacter(character.id);
    response.status(202).json({
      character: updated,
      referencePlan: updated.referencePlan,
      generations: queued,
      engineChanged,
      engine: requestedWorkflow.engineId,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/reference-plan/:role/regenerate", async (request, response, next) => {
  try {
    const generation = await queueCharacterReference(request.params.id, request.params.role, {
      force: true,
      preferredEngine: String(request.body?.engine || "auto"),
    });
    response.status(202).json({ character: characterStore.getCharacter(request.params.id), generation });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/reference-plan/:role/reject", (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const item = character.referencePlan?.items?.find((entry) => entry.referenceRole === request.params.role);
    if (!item) throw new Error("Ruolo reference non presente nel piano adattivo.");
    const generationId = String(request.body?.generationId || item.candidateGenerationId || "");
    const generation = store.get(generationId);
    if (!generation || generation.characterId !== character.id || generation.referenceRole !== item.referenceRole) {
      throw new Error("Candidate reference non valida per questo ruolo.");
    }
    if (item.candidateGenerationId !== generation.id) {
      throw new Error("Questa candidate non è più quella attiva per il ruolo.");
    }
    const updatedGeneration = store.update(generation.id, {
      referenceDecision: "rejected",
      referenceDecisionAt: new Date().toISOString(),
    });
    const referencePlan = patchReferencePlanItem(character.referencePlan, item.referenceRole, {
      status: item.approvedReferenceId ? "approved" : "rejected",
      candidateGenerationId: null,
      rejectedGenerationIds: [...new Set([...(item.rejectedGenerationIds || []), generation.id])],
    });
    const updated = characterStore.updateReferencePlan(character.id, referencePlan);
    invalidateAppConfig();
    broadcast({ type: "generation_updated", generationId: generation.id, data: updatedGeneration });
    response.json({ character: updated, referencePlan: updated.referencePlan, generation: updatedGeneration });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/reference-plan/:role/approve", async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const item = character.referencePlan?.items?.find((entry) => entry.referenceRole === request.params.role);
    if (!item) throw new Error("Ruolo reference non presente nel piano adattivo.");
    const generationId = String(request.body?.generationId || item.candidateGenerationId || "");
    const generation = store.get(generationId);
    if (!generation || generation.characterId !== character.id || generation.referenceRole !== item.referenceRole
      || generation.generationPurpose !== "character_reference") {
      throw new Error("Candidate reference non valida per questo ruolo.");
    }
    const alreadyImported = (character.references || []).find((reference) =>
      reference.provenance?.generationId === generation.id && reference.status !== "rejected"
    );
    if (alreadyImported) {
      return response.json({ character, referencePlan: character.referencePlan, reference: alreadyImported, duplicate: true });
    }
    if (item.candidateGenerationId !== generation.id) {
      throw new Error("Questa candidate non è più quella attiva per il ruolo.");
    }
    if (generation.status !== "completed" || !generation.images?.length) {
      throw new Error("La candidate deve essere completata prima dell'approvazione.");
    }
    const file = await generationImageFile(generation, request.body?.imageIndex);
    const result = characterStore.addReference(character.id, {
      ...file,
      size: file.buffer.length,
    }, {
      type: item.type,
      status: "approved",
      tags: `adaptive reference,${item.referenceRole},approved`,
      referenceRole: item.referenceRole,
      angle: item.angle,
      pose: item.pose,
      expression: item.expression,
      sourceHero: character.heroImage,
      subjectKind: character.referencePlan?.subjectKind || character.subjectKind,
      technicalPrompt: generation.technicalPrompt,
      seed: generation.seed,
      provenance: {
        sourceType: "reference-factory",
        generationId: generation.id,
        generator: generation.workflowId,
        model: generation.model || generation.imageModelFile,
        seed: generation.seed,
        technicalPrompt: generation.technicalPrompt,
      },
    });
    if (item.approvedReferenceId && item.approvedReferenceId !== result.reference.id) {
      characterStore.updateReference(character.id, item.approvedReferenceId, { status: "rejected" });
    }
    const referencePlan = patchReferencePlanItem(
      characterStore.getCharacter(character.id).referencePlan,
      item.referenceRole,
      {
        status: "approved",
        approvedReferenceId: result.reference.id,
        candidateGenerationId: null,
      },
    );
    const updated = characterStore.updateReferencePlan(character.id, referencePlan);
    const updatedGeneration = store.update(generation.id, {
      referenceDecision: "approved",
      referenceDecisionAt: new Date().toISOString(),
      characterReferenceId: result.reference.id,
    });
    invalidateAppConfig();
    broadcast({ type: "generation_updated", generationId: generation.id, data: updatedGeneration });
    broadcast({ type: "character_updated", characterId: updated.id, data: updated });
    response.json({ character: updated, referencePlan: updated.referencePlan, reference: result.reference });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/genesis", upload.single("photo"), async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Character Genesis richiede LM_STUDIO_MODEL configurato." });
    }
    const photo = request.file || null;
    const sourceType = photo ? "photo" : "description";
    const sourceDescription = String(request.body?.description || "").trim();
    if (!photo && !sourceDescription) throw new Error("Scrivi una breve descrizione del Character.");
    if (photo) {
      if (!photo.mimetype.startsWith("image/")) throw new Error("Carica una fotografia PNG, JPG o WebP.");
      validateUploadSize(photo, maxUploadMb, "La fotografia");
    }
    const planned = await promptAssistant.createCharacterGenesis({
      description: sourceDescription,
      image: photo,
    });
    const characterBlueprint = normalizeCharacterBlueprint({
      ...planned,
      sourceDescription,
    }, { sourceDescription });
    const hints = blueprintIdentityHints(characterBlueprint);
    const genesis = normalizeGenesis({
      sourceType,
      sourceDescription,
      generator: photo ? "uploaded-photo" : "kreaTriple",
      model: photo ? "original uploaded photograph" : "KreaTriple_T2I_API.json",
      promptModel: planned.model,
      technicalPrompt: planned.technicalPrompt,
      technicalNegativePrompt: planned.technicalNegativePrompt,
      createdAt: new Date().toISOString(),
    });
    let character = characterStore.createCharacter({
      name: String(request.body?.name || (photo ? "Character da foto" : planned.name || "Nuovo Character")).trim(),
      description: blueprintDescription(characterBlueprint),
      subjectKind: characterBlueprint.subjectKind,
      characterBlueprint,
      identityHints: hints,
      genesis,
    });
    if (photo) {
      character = characterStore.addReference(character.id, photo, {
        type: "hero",
        tags: "character genesis,original photo,identity reference",
        provenance: {
          sourceType: "photo",
          generator: "uploaded-photo",
          model: "original uploaded photograph",
          technicalPrompt: planned.technicalPrompt,
        },
      }).character;
    }
    invalidateAppConfig();
    response.status(201).json({
      character,
      blueprint: characterBlueprint,
      advanced: {
        technicalPrompt: genesis.technicalPrompt,
        technicalNegativePrompt: genesis.technicalNegativePrompt,
        promptModel: genesis.promptModel,
        generator: genesis.generator,
        model: genesis.model,
      },
      cleanupWarning: planned.unloadError || null,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/genesis-candidates", async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    if (character.genesis?.sourceType !== "description") {
      throw new Error("Le candidate Krea sono disponibili per Character creati da descrizione.");
    }
    const prompt = String(request.body?.technicalPrompt || character.genesis?.technicalPrompt || "").trim();
    if (!prompt) throw new Error("Il prompt tecnico Character Genesis non è disponibile.");
    const technicalNegativePrompt = String(
      request.body?.technicalNegativePrompt ?? character.genesis?.technicalNegativePrompt ?? "",
    ).trim();
    const count = Math.max(1, Math.min(4, Number(request.body?.count) || 4));
    const seeds = new Set();
    while (seeds.size < count) seeds.add(crypto.randomInt(0, 2 ** 31));
    const candidates = [];
    let imageModel = "KreaTriple_T2I_API.json";
    for (const seed of seeds) {
      const job = buildStudioJobs("kreaTriple", {
        studioMode: "kreaTriple",
        kreaTripleOperation: "text",
        prompt,
        negativePrompt: technicalNegativePrompt,
        seed,
        imageWidth: request.body?.imageWidth || 1024,
        imageHeight: request.body?.imageHeight || 1024,
      }, { source: null, references: [], mask: null, guide: null }, [])[0];
      imageModel = String(job.workflow?.["1"]?.inputs?.unet_name || job.metadata?.imageModelName || imageModel);
      job.metadata = {
        ...job.metadata,
        workflowId: "character:genesis:kreaTriple",
        workflowName: "Character Genesis · Krea 2",
        generationType: "characterGenesisCandidate",
        characterId: character.id,
        characterName: character.name,
        prompt,
        negativePrompt: technicalNegativePrompt,
        seed,
        genesisSourceType: "description",
      };
      candidates.push(await queueStudioJob(job, character.id));
    }
    const genesis = normalizeGenesis({
      ...character.genesis,
      generator: "kreaTriple",
      model: imageModel,
      technicalPrompt: prompt,
      technicalNegativePrompt,
      candidateGenerationIds: candidates.map((item) => item.id),
    });
    const updated = characterStore.updateCharacter(character.id, { genesis });
    invalidateAppConfig();
    response.status(202).json({ character: updated, candidates });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/select-hero", async (request, response, next) => {
  try {
    const generationId = String(request.body?.generationId || "").trim();
    const generation = store.get(generationId);
    if (!generation || generation.characterId !== request.params.id
      || generation.generationType !== "characterGenesisCandidate") {
      return response.status(404).json({ error: "Candidate Hero non trovata per questo Character." });
    }
    if (generation.status !== "completed" || !generation.images?.length) {
      throw new Error("La candidate deve essere completata prima di usarla come Hero.");
    }
    const rawCharacter = characterStore.readRaw(request.params.id);
    const existing = (rawCharacter.references || []).find((item) =>
      item.provenance?.generationId === generationId
    );
    if (existing) {
      return response.json({ character: characterStore.getCharacter(request.params.id), reference: existing, duplicate: true });
    }
    const image = generation.images[Number(request.body?.imageIndex) || 0] || generation.images[0];
    let buffer;
    let mimetype = "image/png";
    const local = resolveMediaFile(outputDirectory, image);
    if (local?.path) {
      buffer = fs.readFileSync(local.path);
      const extension = path.extname(local.path).toLowerCase();
      mimetype = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    } else {
      const upstream = await fetch(comfy.mediaUrl(image), { signal: AbortSignal.timeout(600000) });
      if (!upstream.ok) throw new Error(`Impossibile recuperare la candidate da ComfyUI (${upstream.status}).`);
      buffer = Buffer.from(await upstream.arrayBuffer());
      mimetype = String(upstream.headers.get("content-type") || mimetype).split(";")[0].trim();
    }
    const result = characterStore.addReference(request.params.id, {
      buffer,
      mimetype,
      originalname: image.filename || `character-hero-${generation.seed}.png`,
      size: buffer.length,
    }, {
      type: "hero",
      tags: "character genesis,krea candidate,selected hero",
      provenance: {
        sourceType: "description",
        generationId,
        generator: "kreaTriple",
        model: rawCharacter.genesis?.model || generation.imageModelName,
        seed: generation.seed,
        technicalPrompt: generation.prompt,
      },
    });
    const genesis = normalizeGenesis({
      ...(rawCharacter.genesis || {}),
      seed: generation.seed,
      technicalPrompt: generation.prompt,
      selectedGenerationId: generationId,
    });
    const character = characterStore.updateCharacter(request.params.id, { genesis });
    invalidateAppConfig();
    response.json({ character, reference: result.reference, duplicate: false });
  } catch (error) {
    next(error);
  }
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
    const character = characterStore.createCharacter(request.body || {});
    invalidateAppConfig();
    response.status(201).json({ character });
  } catch (error) {
    next(error);
  }
});

app.get("/api/characters/identity-providers", async (_request, response, next) => {
  try {
    response.json({ providers: await identityEvaluation.capabilities() });
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

app.get("/api/characters/:id/media", (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const approvedGenerationIds = new Set((character.references || [])
      .map((reference) => reference.provenance?.generationId)
      .filter(Boolean));
    const records = store.list().filter((item) => item.characterId === request.params.id && item.status === "completed" && !item.archived);
    const photos = records.filter((item) => item.images?.length && !item.pipelineIntermediate).map((item) => ({
      id: item.id, label: item.workflowName || "Foto", createdAt: item.createdAt,
      imageUrl: `/api/image/${encodeURIComponent(item.id)}/0`,
      generationPurpose: item.generationPurpose,
      approvedAsReference: approvedGenerationIds.has(item.id),
    }));
    const videos = records.filter((item) => item.videos?.length).map((item) => ({
      id: item.id, label: item.masterOutputKind || item.workflowName || "Video", createdAt: item.createdAt,
      videoUrl: `/api/media/${encodeURIComponent(item.id)}/0`,
    }));
    response.json({ photos, videos });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/photos/:generationId/approve-reference", (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const generation = store.get(request.params.generationId);
    if (!generation || generation.characterId !== character.id || generation.status !== "completed" || !generation.images?.length) {
      throw new Error("La foto selezionata non è una generazione completata di questo Character.");
    }
    const existing = (character.references || []).find((reference) =>
      reference.provenance?.generationId === generation.id && reference.status !== "rejected");
    if (existing) return response.json({ character, reference: existing, alreadyApproved: true });
    const image = resolveMediaFile(outputDirectory, generation.images[0]);
    if (!image?.path) throw new Error("Il file finale della foto non è disponibile localmente.");
    const result = characterStore.addReferenceFromPath(character.id, image.path, {
      type: "generic",
      status: "approved",
      tags: `photo set,approved,${generation.photoSetPreset || "character photo"}`,
      referenceRole: generation.photoSetPreset ? `photo_set_${generation.photoSetPreset}` : "generated_photo",
      technicalPrompt: generation.technicalPrompt || generation.prompt || "",
      seed: generation.seed,
      provenance: {
        sourceType: "character_photo",
        generationId: generation.id,
        generator: generation.workflowName,
        model: generation.model,
        seed: generation.seed,
        photoSetId: generation.photoSetId || null,
      },
      manualReview: {
        status: "APPROVED",
        reviewedAt: new Date().toISOString(),
        reviewedBy: "user",
        notes: "Approvata dal Photo Set come reference riutilizzabile.",
      },
    });
    invalidateAppConfig();
    broadcast({ type: "character_updated", characterId: result.character.id, data: result.character });
    response.json(result);
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
    const character = characterStore.updateCharacter(request.params.id, request.body || {});
    invalidateAppConfig();
    response.json({ character });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/voice-reference", upload.single("voiceReference"), (request, response, next) => {
  try {
    if (!request.file) throw new Error("Carica una reference voce WAV, MP3 o M4A.");
    validateUploadSize(request.file, maxUploadMb, "La reference voce");
    response.json({ character: characterStore.setVoiceReference(request.params.id, request.file) });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/characters/:id", (request, response, next) => {
  try {
    const result = characterStore.deleteCharacter(request.params.id);
    invalidateAppConfig();
    response.json(result);
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
      invalidateAppConfig();
      response.status(201).json({ character, references: created });
    } catch (error) {
      next(error);
    }
  },
);

app.put("/api/characters/:id/references/:referenceId", (request, response, next) => {
  try {
    const character = characterStore.updateReference(request.params.id, request.params.referenceId, request.body || {});
    invalidateAppConfig();
    response.json({ character });
  } catch (error) {
    next(error);
  }
});

app.put("/api/characters/:id/references/:referenceId/identity-review", (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const reference = (character.references || []).find((item) => item.id === request.params.referenceId);
    if (!reference) throw new Error("Reference personaggio non trovata.");
    if (reference.id === character.heroImage) throw new Error("La Hero è l'ancora identitaria e non può essere rifiutata da questa revisione.");
    const decision = String(request.body?.decision || "").toLowerCase();
    if (!['approve', 'reject'].includes(decision)) throw new Error("Decisione manuale non valida.");
    const reviewedAt = new Date().toISOString();
    let updated = characterStore.updateReference(character.id, reference.id, {
      status: decision === "reject" ? "rejected" : "approved",
      manualReview: {
        status: decision === "reject" ? "REJECTED" : "APPROVED",
        reviewedAt,
        reviewedBy: "user",
        notes: request.body?.notes || "",
      },
    });
    const planItem = updated.referencePlan?.items?.find((item) =>
      item.referenceRole === reference.referenceRole || item.approvedReferenceId === reference.id
    );
    if (planItem) {
      if (decision === "approve" && planItem.approvedReferenceId && planItem.approvedReferenceId !== reference.id) {
        characterStore.updateReference(character.id, planItem.approvedReferenceId, { status: "rejected" });
      }
      const referencePlan = patchReferencePlanItem(updated.referencePlan, planItem.referenceRole, decision === "approve"
        ? { status: "approved", approvedReferenceId: reference.id }
        : { status: "rejected", approvedReferenceId: null });
      updated = characterStore.updateReferencePlan(character.id, referencePlan);
    }
    invalidateAppConfig();
    broadcast({ type: "character_updated", characterId: updated.id, data: updated });
    response.json({ character: updated, reference: updated.references.find((item) => item.id === reference.id) });
  } catch (error) {
    next(error);
  }
});

function cachedCharacterPhotoWorkflow(preferredEngine = "auto") {
  return routeCharacterPhotoWorkflow(appConfigCache.value?.imageModels || [], preferredEngine);
}

async function characterPhotoWorkflow(preferredEngine = "auto") {
  await refreshAppConfig();
  const workflow = cachedCharacterPhotoWorkflow(preferredEngine);
  if (!workflow) throw new Error(preferredEngine === "auto"
    ? "Nessun workflow Image Edit compatibile risulta realmente disponibile."
    : "Il motore fotografico selezionato non è disponibile con tutti i componenti richiesti.");
  return workflow;
}

app.get("/api/characters/:id/photo-config", async (request, response, next) => {
  try {
    characterStore.getCharacter(request.params.id);
    await refreshAppConfig();
    const engines = characterPhotoEngineCatalog(appConfigCache.value?.imageModels || []).map((engine) => ({
      ...(() => {
        const acceleration = qwenEdit2511Lightning8Preset(engine.modelFile);
        return {
          steps: acceleration?.steps || engine.defaults?.steps,
          guidance: acceleration?.guidance ?? engine.defaults?.guidance,
          samplingProfile: acceleration?.samplingProfile || engine.samplingProfile || "model-native",
        };
      })(),
      id: engine.engineId,
      name: engine.name,
      model: engine.modelFile,
      maxReferences: engine.maxReferences,
    }));
    response.json({ engines, defaultEngine: engines[0]?.id || null });
  } catch (error) {
    next(error);
  }
});

function characterMasterRuntime() {
  const imageModels = appConfigCache.value?.imageModels || [];
  const flux1 = imageModels.find((item) => item.id === "flux1" && item.available);
  const flux2 = imageModels.find((item) => item.id === "flux2" && item.available);
  const kreaModel = flux1?.models?.find((model) => /moodykrea2mix_v50/i.test(model.file))
    || flux1?.models?.find((model) => /krea/i.test(model.file));
  const kleinModel = flux2?.models?.find((model) => /flux2klein_9bbase/i.test(model.file))
    || flux2?.models?.find((model) => !/turbo/i.test(model.file))
    || flux2?.models?.[0];
  const seedProfile = appConfigCache.value?.imageEnhancements?.seedvr2Profiles
    ?.find((profile) => profile.id === "balanced" && profile.available);
  const seedEngine = appConfigCache.value?.upscaling?.engines
    ?.find((engine) => engine.id === "seedvr2" && engine.available);
  return {
    capabilities: {
      scene: true,
      krea: Boolean(kreaModel),
      klein: Boolean(kleinModel),
      seedvr2: Boolean(seedProfile && seedEngine),
    },
    models: {
      scene: cachedCharacterPhotoWorkflow()?.modelFile || null,
      krea: kreaModel?.file || null,
      klein: kleinModel?.file || null,
      seedvr2: seedProfile ? SEEDVR2_PROFILES.balanced.model : null,
    },
  };
}

function masterStageOverrides(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(["krea", "klein", "seedvr2"]
    .filter((key) => typeof source[key] === "boolean")
    .map((key) => [key, source[key]]));
}

async function characterMasterPromptImage(file) {
  const local = resolveMediaFile(outputDirectory, file);
  if (local?.path) {
    const extension = path.extname(local.path).toLowerCase();
    return {
      buffer: fs.readFileSync(local.path),
      mimetype: extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png",
    };
  }
  const result = await fetch(comfy.mediaUrl(file), { signal: AbortSignal.timeout(600000) });
  if (!result.ok) throw new Error(`Impossibile leggere il risultato dello stage precedente (${result.status}).`);
  return {
    buffer: Buffer.from(await result.arrayBuffer()),
    mimetype: String(result.headers.get("content-type") || "image/png").split(";")[0],
  };
}

async function characterMasterIdentityValidation(rootGeneration, masterGeneration) {
  const character = characterStore.getCharacter(rootGeneration.characterId);
  const hero = characterHeroAsset(character);
  const output = masterGeneration.images?.at(-1);
  const master = output ? resolveMediaFile(outputDirectory, output) : null;
  if (!master?.path) {
    return {
      enabled: false,
      engine: null,
      subjectKindsSupported: [],
      thresholds: null,
      evaluations: [],
      status: "NOT_EVALUATED",
      evaluatedAt: new Date().toISOString(),
      warnings: ["Master non disponibile localmente per la validation finale."],
      providers: [],
    };
  }
  return identityEvaluation.evaluate({
    subjectKind: character.referencePlan?.subjectKind || character.subjectKind,
    hero: { id: character.heroImage, path: hero.path },
    references: [{ id: "master", path: master.path }],
  });
}

async function finalizeCharacterMasterPipeline(rootGeneration, pipeline) {
  const masterGeneration = store.get(pipeline.lastValidGenerationId || rootGeneration.id) || rootGeneration;
  let identityValidation;
  try {
    identityValidation = await characterMasterIdentityValidation(rootGeneration, masterGeneration);
  } catch (error) {
    identityValidation = {
      enabled: false,
      engine: null,
      subjectKindsSupported: [],
      thresholds: null,
      evaluations: [],
      status: "ENGINE_UNAVAILABLE",
      evaluatedAt: new Date().toISOString(),
      warnings: [error.message],
      providers: [],
    };
  }
  const finished = finishCharacterMasterPipeline(pipeline, {
    masterGenerationId: masterGeneration.id,
    identityValidation,
  });
  const updated = store.update(rootGeneration.id, {
    workflowName: `Character Master Image · ${finished.presetLabel}`,
    characterMasterPipeline: finished,
    masterGenerationId: masterGeneration.id,
    masterOutputKind: "Master",
    images: masterGeneration.images || [],
    output: masterGeneration.images || [],
  });
  broadcast({ type: "generation_updated", generationId: updated.id, data: updated });
  scheduleIdlePurge();
  return updated;
}

async function prepareCharacterMasterStage(rootGeneration, pipeline, stage, sourceGeneration) {
  const character = characterStore.getCharacter(rootGeneration.characterId);
  const sourceFile = sourceGeneration.images?.at(-1);
  if (!sourceFile) throw new Error(`${stage.label}: lo stage precedente non contiene un'immagine valida.`);
  const sourceUpload = await comfy.reuseOutputImage(sourceFile, `character-master-${rootGeneration.id}-${stage.id}.png`);
  const stageSeed = crypto.randomInt(0, 2 ** 31);
  if (stage.id === "seedvr2") {
    const job = buildUpscaleWorkflow({
      upscaleEngine: "seedvr2",
      upscalePreset: seedVr2PresetForQuality(pipeline.preset),
      upscaleAutoPurge: false,
      seed: stageSeed,
      upscaleSourceWidth: sourceGeneration.outputWidth,
      upscaleSourceHeight: sourceGeneration.outputHeight,
    }, sourceUpload, []);
    return {
      job,
      prompt: "SeedVR2 3B restoration and final upscale; this model does not consume a text prompt.",
      negativePrompt: "",
      model: SEEDVR2_PROFILES.balanced.model,
      seed: stageSeed,
    };
  }
  const selectedReferences = (character.references || [])
    .filter((reference) => rootGeneration.selectedReferenceIds?.includes(reference.id));
  const promptImage = await characterMasterPromptImage(sourceFile);
  const targetModel = {
    id: stage.id,
    name: stage.id === "krea" ? "Krea conservative refine" : "Flux.2 Klein conservative fine refine",
    modelFile: stage.model,
  };
  const promptResult = await promptAssistant.planCharacterPhotoStage({
    character,
    sceneBlueprint: rootGeneration.sceneBlueprint,
    selectedReferences,
    previousStage: {
      id: sourceGeneration.pipelineStage || "scene",
      generationId: sourceGeneration.id,
      outputWidth: sourceGeneration.outputWidth || null,
      outputHeight: sourceGeneration.outputHeight || null,
    },
    targetModel,
    stage: stage.id,
    objective: stage.objective,
    identityProtection: identityProtectionContract(
      character.referencePlan?.subjectKind || character.subjectKind,
      character.characterBlueprint,
    ),
    image: promptImage,
  });
  if (stage.id === "krea") {
    const job = buildImageWorkflow("flux1", {
      imageMode: "image",
      imageModelFile: stage.model,
      prompt: promptResult.prompt,
      negativePrompt: promptResult.negativePrompt,
      seed: stageSeed,
      imageResolution: "custom",
      imageWidth: sourceGeneration.outputWidth || rootGeneration.width || 896,
      imageHeight: sourceGeneration.outputHeight || rootGeneration.height || 1152,
      imageSteps: pipeline.preset === "max" ? 24 : 20,
      imageGuidance: 3,
      denoise: pipeline.preset === "max" ? 0.16 : 0.2,
      batchSize: 1,
      outputBase: `Characters/${character.id}/master/krea`,
      saveOriginal: false,
      upscaleMode: "none",
      autoPurge: true,
    }, sourceUpload, []);
    return { job, prompt: promptResult.prompt, negativePrompt: promptResult.negativePrompt, model: stage.model, seed: stageSeed };
  }
  const identityUploads = [];
  for (const reference of selectedReferences.slice(0, 3)) {
    const asset = characterStore.assetPath(character.id, reference.id);
    if (asset?.path) identityUploads.push(await uploadCharacterAsset(asset));
  }
  const job = buildImageWorkflow("flux2", {
    imageMode: "image",
    imageModelFile: stage.model,
    prompt: promptResult.prompt,
    negativePrompt: promptResult.negativePrompt,
    seed: stageSeed,
    imageResolution: "custom",
    imageWidth: sourceGeneration.outputWidth || rootGeneration.width || 896,
    imageHeight: sourceGeneration.outputHeight || rootGeneration.height || 1152,
    imageSteps: pipeline.preset === "max" ? 20 : 16,
    imageGuidance: pipeline.preset === "max" ? 4 : 3,
    denoise: 1,
    batchSize: 1,
    referenceUploads: identityUploads,
    outputBase: `Characters/${character.id}/master/klein`,
    saveOriginal: false,
    upscaleMode: "none",
  }, sourceUpload, []);
  return { job, prompt: promptResult.prompt, negativePrompt: promptResult.negativePrompt, model: stage.model, seed: stageSeed };
}

async function queueNextCharacterMasterStage(rootGeneration, pipeline) {
  let current = pipeline;
  let stage = nextMasterPipelineStage(current);
  while (stage) {
    const sourceGeneration = store.get(current.lastValidGenerationId || rootGeneration.id) || rootGeneration;
    try {
      cancelIdlePurge();
      const prepared = await gpuResourceManager.run(`character-master-${stage.id}`, () =>
        prepareCharacterMasterStage(rootGeneration, current, stage, sourceGeneration));
      const job = prepared.value.job;
      job.metadata = {
        ...job.metadata,
        generationType: "characterMasterStage",
        generationPurpose: "character_master_stage",
        pipelineRootGenerationId: rootGeneration.id,
        pipelineStage: stage.id,
        pipelineOutputKind: stage.label,
        pipelineIntermediate: true,
        parentGenerationId: sourceGeneration.id,
        characterId: rootGeneration.characterId,
        characterName: rootGeneration.characterName,
        sceneBlueprint: rootGeneration.sceneBlueprint,
        selectedReferenceIds: rootGeneration.selectedReferenceIds,
        referenceSelectionReason: rootGeneration.referenceSelectionReason,
        technicalPrompt: prepared.value.prompt,
        technicalNegativePrompt: prepared.value.negativePrompt,
        model: prepared.value.model,
        seed: prepared.value.seed,
        archived: true,
      };
      const child = await queueStudioJob(job, rootGeneration.id);
      current = updateMasterPipelineStage(current, stage.id, {
        status: "running",
        generationId: child.id,
        sourceGenerationId: sourceGeneration.id,
        prompt: prepared.value.prompt,
        model: prepared.value.model,
        startedAt: new Date().toISOString(),
      });
      const updatedRoot = store.update(rootGeneration.id, { characterMasterPipeline: current });
      broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
      return child;
    } catch (error) {
      current = updateMasterPipelineStage(current, stage.id, {
        status: "failed",
        error: error.message,
        finishedAt: new Date().toISOString(),
      });
      const updatedRoot = store.update(rootGeneration.id, { characterMasterPipeline: current });
      broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
      stage = nextMasterPipelineStage(current);
    }
  }
  return finalizeCharacterMasterPipeline(rootGeneration, current);
}

async function advanceCharacterMasterPipeline(generation) {
  const rootId = generation.pipelineRootGenerationId
    || (generation.generationPurpose === "character_photo" ? generation.id : null);
  if (!rootId) return null;
  const rootGeneration = store.get(rootId);
  let pipeline = rootGeneration?.characterMasterPipeline;
  if (!rootGeneration || !pipeline || pipeline.status !== "running") return null;
  const stageId = generation.pipelineStage || "scene";
  const stage = pipeline.stages.find((item) => item.id === stageId);
  if (!stage || !["running", "requested"].includes(stage.status)) return null;
  if (generation.status === "completed" && generation.images?.length) {
    pipeline = updateMasterPipelineStage(pipeline, stageId, {
      status: "completed",
      generationId: generation.id,
      output: generation.images,
      finishedAt: generation.finishedAt || new Date().toISOString(),
    });
    pipeline = {
      ...pipeline,
      lastValidGenerationId: generation.id,
      updatedAt: new Date().toISOString(),
    };
  } else {
    pipeline = updateMasterPipelineStage(pipeline, stageId, {
      status: "failed",
      generationId: generation.id,
      error: generation.error || `${stage.label} non completato.`,
      finishedAt: generation.finishedAt || new Date().toISOString(),
    });
  }
  if (generation.id !== rootId) store.update(generation.id, { archived: true });
  const updatedRoot = store.update(rootId, { characterMasterPipeline: pipeline });
  broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
  return queueNextCharacterMasterStage(updatedRoot, pipeline);
}

function continueCharacterMasterPipeline(generation) {
  void advanceCharacterMasterPipeline(generation).catch((error) => {
    const rootId = generation.pipelineRootGenerationId || generation.id;
    const root = store.get(rootId);
    if (!root?.characterMasterPipeline) return;
    const updated = store.update(rootId, {
      characterMasterPipeline: {
        ...root.characterMasterPipeline,
        status: "completed_with_warnings",
        orchestrationError: error.message,
        updatedAt: new Date().toISOString(),
      },
    });
    broadcast({ type: "generation_updated", generationId: updated.id, data: updated });
    scheduleIdlePurge();
  });
}

async function resumeCharacterMasterPipelines() {
  for (const root of store.list().filter((item) =>
    item.generationPurpose === "character_photo" && item.characterMasterPipeline?.status === "running")) {
    const pipeline = root.characterMasterPipeline;
    const runningStage = pipeline.stages.find((stage) => stage.status === "running");
    if (runningStage?.generationId) {
      const generation = store.get(runningStage.generationId);
      if (generation && ["completed", "error", "interrupted", "cancelled"].includes(generation.status)) {
        continueCharacterMasterPipeline(generation);
      }
      continue;
    }
    if (nextMasterPipelineStage(pipeline)) {
      void queueNextCharacterMasterStage(root, pipeline).catch((error) => {
        const updated = store.update(root.id, {
          characterMasterPipeline: {
            ...pipeline,
            status: "completed_with_warnings",
            orchestrationError: error.message,
            updatedAt: new Date().toISOString(),
          },
        });
        broadcast({ type: "generation_updated", generationId: updated.id, data: updated });
      });
    }
  }
}

function characterPhotoChoices(raw = {}) {
  return {
    location: String(raw.location || "automatic").trim().slice(0, 240),
    action: String(raw.action || "automatic").trim().slice(0, 240),
    mood: String(raw.mood || "automatic").trim().slice(0, 160),
    outfitMode: ["keep", "change", "choose"].includes(raw.outfitMode) ? raw.outfitMode : "keep",
    outfit: String(raw.outfit || "").trim().slice(0, 240),
    engine: String(raw.engine || "auto").trim().slice(0, 80),
  };
}

app.post("/api/characters/:id/photo-plan", async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Create Photo richiede LM_STUDIO_MODEL configurato." });
    }
    const character = characterStore.getCharacter(request.params.id);
    characterHeroAsset(character);
    const choices = characterPhotoChoices(request.body || {});
    const subjectKind = character.referencePlan?.subjectKind || character.subjectKind;
    if (subjectKind !== "human") {
      choices.outfitMode = "keep";
      choices.outfit = "";
    }
    const userIntent = String(request.body?.userIntent || "").trim().slice(0, 1000);
    const surprise = Boolean(request.body?.surprise) || choices.location.toLowerCase() === "surprise";
    const sceneSeed = surprise
      ? surpriseSceneSeed({ subjectKind })
      : {
          location: choices.location,
          action: choices.action,
          mood: choices.mood,
          outfit: choices.outfit,
          userIntent,
        };
    const workflow = cachedCharacterPhotoWorkflow(choices.engine);
    if (!workflow) {
      const error = new Error("Le capability Image Edit non sono ancora disponibili. Aggiorna la pagina e riprova.");
      error.statusCode = 503;
      throw error;
    }
    const initialBlueprint = normalizeSceneBlueprint(sceneSeed, {
      userIntent,
      subjectKind,
      outfitMode: choices.outfitMode,
    });
    const selection = selectCharacterPhotoReferences(character, initialBlueprint, {
      maxReferences: workflow.maxReferences,
    });
    const planned = await promptAssistant.planCharacterPhoto({
      character,
      userIntent,
      choices,
      sceneSeed,
      selectedReferences: selection.references,
      workflow,
    });
    const sceneBlueprint = normalizeSceneBlueprint(planned.sceneBlueprint, {
      userIntent,
      subjectKind,
      outfitMode: choices.outfitMode,
    });
    const finalSelection = selectCharacterPhotoReferences(character, sceneBlueprint, {
      maxReferences: workflow.maxReferences,
    });
    const referenceContract = finalSelection.references
      .map((reference, index) => `Image ${index + 1}: ${index === 0 ? "primary Hero identity" : reference.referenceRole || reference.type || "supporting identity reference"}.`)
      .join(" ");
    response.json({
      plan: {
        sceneBlueprint,
        summary: sceneBlueprintSummary(sceneBlueprint, character.name),
        selectedReferenceIds: finalSelection.selectedReferenceIds,
        referenceSelectionReason: finalSelection.referenceSelectionReason,
        technicalPrompt: `${String(planned.technicalPrompt || "").trim()} ${referenceContract}`.trim(),
        technicalNegativePrompt: String(planned.technicalNegativePrompt || "").trim(),
        promptModel: planned.model,
        workflow: { id: workflow.id, engineId: workflow.engineId, name: workflow.name, model: workflow.modelFile },
        surprise,
      },
      cleanupWarning: planned.unloadError || null,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/create-photo", async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const rawPlan = request.body?.plan || {};
    const sceneBlueprint = normalizeSceneBlueprint(rawPlan.sceneBlueprint, {
      userIntent: rawPlan.sceneBlueprint?.userIntent,
      subjectKind: character.referencePlan?.subjectKind || character.subjectKind,
      outfitMode: request.body?.outfitMode,
    });
    const technicalPrompt = String(rawPlan.technicalPrompt || "").trim().slice(0, 12_000);
    if (!technicalPrompt) throw new Error("Prepara e conferma prima il piano fotografico LM Studio.");
    const workflow = await characterPhotoWorkflow(rawPlan.workflow?.engineId || request.body?.engine || "auto");
    if ((rawPlan.workflow?.id && rawPlan.workflow.id !== workflow.id)
      || (rawPlan.workflow?.model && rawPlan.workflow.model !== workflow.modelFile)) {
      throw new Error("Le capability dei modelli sono cambiate dopo l'anteprima. Usa Cambia idea per preparare di nuovo il piano.");
    }
    const selection = selectCharacterPhotoReferences(character, sceneBlueprint, {
      maxReferences: workflow.maxReferences,
    });
    const qualityPreset = ["fast", "balanced", "max"].includes(request.body?.qualityPreset)
      ? request.body.qualityPreset
      : "balanced";
    const runtime = characterMasterRuntime();
    let masterPipeline = createCharacterMasterPipeline({
      preset: qualityPreset,
      advancedStages: masterStageOverrides(request.body?.advancedStages),
      capabilities: runtime.capabilities,
      models: runtime.models,
    });
    const uploads = [];
    for (const reference of selection.references) {
      const asset = characterStore.assetPath(character.id, reference.id);
      if (!asset?.path) continue;
      uploads.push(await uploadCharacterAsset(asset));
    }
    if (!uploads.length) throw new Error("La Hero selezionata non è disponibile per la generazione.");
    const rawSeed = String(request.body?.seed ?? "").trim();
    const parsedSeed = rawSeed ? Number(rawSeed) : Number.NaN;
    const seed = Number.isSafeInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed : crypto.randomInt(0, 2 ** 31);
    const acceleration = qwenEdit2511Lightning8Preset(workflow.modelFile);
    const job = buildImageWorkflow(workflow.id, {
      imageMode: "image",
      imageModelFile: workflow.modelFile,
      prompt: technicalPrompt,
      negativePrompt: String(rawPlan.technicalNegativePrompt || "").trim(),
      seed,
      imageResolution: request.body?.imageResolution || "portrait",
      imageSteps: acceleration?.steps || workflow.defaults?.steps || 4,
      imageGuidance: acceleration?.guidance ?? workflow.defaults?.guidance ?? 1,
      denoise: 1,
      batchSize: 1,
      referenceUploads: uploads.slice(1),
      outputBase: `Characters/${character.id}/photos`,
      saveOriginal: false,
      upscaleMode: "none",
    }, uploads[0], acceleration?.loras || []);
    job.metadata = {
      ...job.metadata,
      ...characterPhotoGenerationMetadata({
        character,
        sceneBlueprint,
        selection,
        workflow,
        technicalPrompt,
        technicalNegativePrompt: String(rawPlan.technicalNegativePrompt || "").trim(),
        seed,
      }),
      workflowName: `Character Master Image · ${masterPipeline.presetLabel}`,
      pipelineStage: "scene",
      pipelineOutputKind: "Scene Draft",
      qualityPreset,
      characterMasterPipeline: masterPipeline,
      photoSetId: String(request.body?.photoSetId || "").trim().slice(0, 120) || null,
      photoSetPreset: String(request.body?.photoSetPreset || "").trim().slice(0, 80) || null,
      photoSetIndex: Number.isInteger(Number(request.body?.photoSetIndex)) ? Number(request.body.photoSetIndex) : null,
    };
    const generation = await queueStudioJob(job, character.id);
    masterPipeline = updateMasterPipelineStage(masterPipeline, "scene", {
      status: "running",
      generationId: generation.id,
      model: workflow.modelFile,
      prompt: technicalPrompt,
      startedAt: new Date().toISOString(),
    });
    masterPipeline = { ...masterPipeline, rootGenerationId: generation.id, updatedAt: new Date().toISOString() };
    const updatedGeneration = store.update(generation.id, {
      pipelineRootGenerationId: generation.id,
      characterMasterPipeline: masterPipeline,
    });
    response.status(202).json({
      generation: updatedGeneration,
      pipeline: masterPipeline,
      plan: { ...rawPlan, sceneBlueprint },
      workflow: { id: workflow.id, name: workflow.name },
    });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/characters/:id/references/:referenceId", (request, response, next) => {
  try {
    const character = characterStore.removeReference(request.params.id, request.params.referenceId);
    invalidateAppConfig();
    response.json({ character });
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
    const acceleration = qwenEdit2511Lightning8Preset(raw.imageModelFile || undefined);
    job = buildImageWorkflow("qwenEdit", {
      ...base,
      imageMode: "image",
      imageModelFile: raw.imageModelFile || "",
      imageResolution: "custom",
      imageSteps: acceleration?.steps || raw.imageSteps || 16,
      imageGuidance: acceleration?.guidance || raw.imageGuidance || 1,
      denoise: raw.denoise || 0.55,
      batchSize: 1,
      referenceUploads: references,
      outputBase: `Characters/${character.id}/sheet`,
      saveOriginal: false,
      upscaleMode: "none",
    }, source, acceleration?.loras || []);
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

async function runCharacterIdentityCheck(characterId) {
  const character = characterStore.getCharacter(characterId);
  const hero = characterHeroAsset(character);
  const references = (character.references || [])
    .filter((reference) => reference.id !== character.heroImage && reference.status !== "rejected" && reference.assetAvailable)
    .map((reference) => ({ reference, match: characterStore.assetPath(characterId, reference.id) }))
    .filter((item) => item.match?.path)
    .map((item) => ({
      id: item.reference.id,
      type: item.reference.type,
      path: item.match.path,
    }));
  const report = await identityEvaluation.evaluate({
    subjectKind: character.referencePlan?.subjectKind || character.subjectKind,
    hero: { id: character.heroImage, path: hero.path },
    references,
  });
  return { character: characterStore.updateIdentityEvaluation(characterId, report), report };
}

app.post("/api/characters/:id/build-pack", (request, response, next) => {
  try {
    const result = characterStore.buildPack(request.params.id);
    invalidateAppConfig();
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/orbit-sheet", async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const { character, source } = await characterReferenceUploads(request.params.id, 1);
    const config = await videoStudioRuntimeConfig();
    if (!config.h3.orbitSheets.available) throw new Error("OrbitSheets non è disponibile: riavvia ComfyUI per caricare il plugin installato.");
    const job = buildOrbitSheetWorkflow({
      kind: request.body?.kind,
      description: request.body?.description || [character.name, character.identityHints?.face, character.identityHints?.hair, character.identityHints?.body].filter(Boolean).join(". "),
      seed: request.body?.seed,
    }, source, config);
    job.metadata = { ...job.metadata, characterId: character.id, characterName: character.name };
    const generation = await queueStudioJob(job, character.id);
    response.status(202).json({ character, generation });
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
    const result = await runCharacterIdentityCheck(request.params.id);
    invalidateAppConfig();
    response.json(result);
  } catch (error) {
    next(error);
  }
});

function characterVideoGeneratedPhotos(characterId) {
  return store.list()
    .filter((item) => item.characterId === characterId
      && item.status === "completed"
      && item.images?.length
      && ["character_photo", "character_video_anchor"].includes(item.generationPurpose)
      && !item.pipelineIntermediate)
    .sort((left, right) => Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0))
    .slice(0, 24)
    .map((item) => ({
      id: item.id,
      label: item.masterOutputKind || item.pipelineOutputKind || item.workflowName || "Foto Character",
      createdAt: item.createdAt,
      imageUrl: `/api/image/${encodeURIComponent(item.id)}/0`,
    }));
}

async function characterVideoRouterRuntime() {
  await refreshAppConfig();
  return appConfigCache.value?.characterVideoRouter || createCharacterVideoRouter();
}

function characterVideoRoute(router, raw = {}) {
  const dialogue = String(raw.dialogue || "").trim();
  const audioMode = dialogue ? String(raw.audioMode || "native") : "none";
  return routeCharacterVideo({
    router,
    requestedEngine: raw.videoEngine || "auto",
    quality: raw.quality || "balanced",
    requirements: videoRequirements({ sourceMode: "image", dialogue, audioMode }),
  });
}

app.get("/api/characters/:id/video-config", async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const router = await characterVideoRouterRuntime();
    const anchorWorkflow = cachedCharacterPhotoWorkflow();
    const characterVideoAudio = appConfigCache.value?.characterVideoAudio || { modes: [], refine: { available: false, presets: [] } };
    response.json({
      character: { id: character.id, name: character.name, heroUrl: character.heroUrl },
      router,
      generatedPhotos: characterVideoGeneratedPhotos(character.id),
      anchorGeneration: {
        available: Boolean(anchorWorkflow),
        workflow: anchorWorkflow ? { id: anchorWorkflow.id, name: anchorWorkflow.name, model: anchorWorkflow.modelFile } : null,
        reason: anchorWorkflow ? null : "Nessun workflow Image Edit conservativo realmente disponibile.",
      },
      audioModes: characterVideoAudio.modes.filter((mode) => mode.available && (mode.id !== "externalTts" || character.voiceReferenceAvailable)),
      audioCapabilities: {
        voice: characterVideoAudio.voice,
        lipSync: characterVideoAudio.lipSync,
      },
      refine: characterVideoAudio.refine,
      preferences: {
        imagePreset: character.preferredImagePreset || "balanced",
        videoPreset: character.preferredVideoPreset || "improved",
        videoEngine: character.preferredVideoEngine || "auto",
        voiceProfile: character.voiceProfile || { language: "auto", speaker: "", notes: "" },
      },
      talkingAudio: {
        prepared: true,
        complete: Boolean(characterVideoAudio.voice?.synthesizeDialogue && characterVideoAudio.lipSync?.applyLipSync),
        message: "Audio LTX nativo, Chatterbox Multilingual, audio caricato e MuseTalk vengono mostrati solo quando realmente disponibili.",
        voiceReferenceRequired: true,
        voiceReferenceAvailable: character.voiceReferenceAvailable,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/video-plan", async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Create Video richiede LM_STUDIO_MODEL configurato." });
    }
    const character = characterStore.getCharacter(request.params.id);
    const raw = request.body || {};
    const router = await characterVideoRouterRuntime();
    const dialogue = raw.dialogueEnabled === true ? String(raw.dialogue || "").trim() : "";
    const audioMode = dialogue && ["native", "externalTts", "existing"].includes(raw.audioMode) ? raw.audioMode : "none";
    const route = characterVideoRoute(router, { ...raw, dialogue, audioMode });
    const provisional = normalizeVideoBlueprint({
      scene: raw.videoIntent,
      subjectMotion: raw.videoIntent,
      cameraMotion: raw.filmingStyle,
      framing: raw.filmingStyle,
      environmentMotion: "natural",
      facialPerformance: dialogue ? "natural synchronized speech" : "natural subtle expression",
      duration: raw.duration,
      dialogue,
      emotion: raw.emotion || "natural",
      audioMode,
    });
    const identityProtection = identityProtectionContract(
      character.referencePlan?.subjectKind || character.subjectKind,
      character.characterBlueprint,
    );
    const planned = await gpuResourceManager.run("character-video-plan", () => promptAssistant.planCharacterVideo({
      character,
      videoIntent: raw.videoIntent,
      filmingStyle: raw.filmingStyle,
      duration: provisional.duration,
      dialogue,
      emotion: provisional.emotion,
      audioMode,
      outfit: raw.outfit,
      aspectRatio: raw.aspectRatio,
      engine: route.engine,
      motionContract: motionPromptSections(provisional, identityProtection),
    }));
    const videoBlueprint = normalizeVideoBlueprint(planned.value.videoBlueprint, provisional);
    videoBlueprint.duration = provisional.duration;
    if (!dialogue) {
      videoBlueprint.dialogue = "";
      videoBlueprint.audioMode = "none";
    } else {
      videoBlueprint.dialogue = dialogue;
      videoBlueprint.audioMode = audioMode;
    }
    response.json({
      videoBlueprint,
      scenePrompt: String(planned.value.scenePrompt || "").trim().slice(0, 12_000),
      motionPrompt: String(planned.value.motionPrompt || "").trim().slice(0, 12_000),
      audioPrompt: String(planned.value.audioPrompt || "").trim().slice(0, 12_000),
      dialogueInstructions: String(planned.value.dialogueInstructions || "").trim().slice(0, 4000),
      emotionInstructions: String(planned.value.emotionInstructions || "").trim().slice(0, 4000),
      route: {
        engine: route.engine.id,
        engineName: route.engine.name,
        workflowId: route.workflowId,
        quality: route.quality,
        capabilities: route.engine.capabilities,
      },
      promptModel: planned.value.model,
      cleanupWarning: planned.value.unloadError || null,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/characters/:id/anchor-frame", async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const raw = request.body || {};
    const videoBlueprint = normalizeVideoBlueprint(raw.videoBlueprint || {});
    const router = await characterVideoRouterRuntime();
    const route = characterVideoRoute(router, {
      ...raw,
      dialogue: videoBlueprint.dialogue,
      audioMode: videoBlueprint.audioMode,
    });
    const anchorRequest = buildCharacterAnchorFrameRequest({
      characterId: character.id,
      sceneBlueprint: videoBlueprint,
      videoIntent: raw.videoIntent || videoBlueprint.subjectMotion,
      outfit: raw.outfit,
      aspectRatio: raw.aspectRatio,
      videoEngine: route.engine.id,
      identityStrength: raw.identityStrength || character.settings?.identityStrength || "medium",
    });
    const workflow = await characterPhotoWorkflow();
    const photoBlueprint = normalizeSceneBlueprint({
      location: videoBlueprint.scene,
      action: videoBlueprint.subjectMotion,
      camera: videoBlueprint.cameraMotion,
      framing: videoBlueprint.framing,
      mood: videoBlueprint.emotion,
      outfit: anchorRequest.outfit,
      subjectInteraction: "stable physically plausible starting pose",
      userIntent: raw.videoIntent,
    }, { subjectKind: character.referencePlan?.subjectKind || character.subjectKind });
    const selection = selectCharacterPhotoReferences(character, photoBlueprint, { maxReferences: workflow.maxReferences });
    const dimensions = anchorRequest.aspectRatio === "16:9"
      ? [1344, 768]
      : anchorRequest.aspectRatio === "1:1" ? [1024, 1024] : [768, 1344];
    const prepared = await gpuResourceManager.run("character-video-anchor", async () => {
      const uploads = [];
      for (const reference of selection.references) {
        const asset = characterStore.assetPath(character.id, reference.id);
        if (asset?.path) uploads.push(await uploadCharacterAsset(asset));
      }
      if (!uploads.length) throw new Error("La Hero del Character non è disponibile per creare il Video Anchor.");
      const seed = crypto.randomInt(0, 2 ** 31);
      const prompt = `${anchorRequest.prompt} ${identityProtectionContract(
        character.referencePlan?.subjectKind || character.subjectKind,
        character.characterBlueprint,
      )}`;
      const acceleration = qwenEdit2511Lightning8Preset(workflow.modelFile);
      const job = buildImageWorkflow(workflow.id, {
        imageMode: "image",
        imageModelFile: workflow.modelFile,
        prompt,
        negativePrompt: anchorRequest.negativePrompt,
        seed,
        imageResolution: "custom",
        imageWidth: dimensions[0],
        imageHeight: dimensions[1],
        imageSteps: acceleration?.steps || workflow.defaults?.steps,
        imageGuidance: acceleration?.guidance || workflow.defaults?.guidance,
        denoise: anchorRequest.denoise,
        batchSize: 1,
        referenceUploads: uploads.slice(1),
        outputBase: `Characters/${character.id}/video-anchors`,
        saveOriginal: false,
        upscaleMode: "none",
      }, uploads[0], acceleration?.loras || []);
      job.metadata = {
        ...job.metadata,
        generationPurpose: "character_video_anchor",
        workflowName: `Video Anchor · ${workflow.name}`,
        characterId: character.id,
        characterName: character.name,
        videoBlueprint,
        videoIntent: anchorRequest.videoIntent,
        videoEngine: route.engine.id,
        anchorRequest,
        selectedReferenceIds: selection.references.map((reference) => reference.id),
        referenceSelectionReason: selection.referenceSelectionReason,
        output: [],
      };
      return job;
    });
    const generation = await queueStudioJob(prepared.value, character.id);
    response.status(202).json({ generation, anchorRequest, route: { engine: route.engine.id, workflowId: route.workflowId } });
  } catch (error) {
    next(error);
  }
});

function characterVideoAssetDirectory(pipelineId) {
  if (!/^[a-f0-9-]{20,80}$/i.test(String(pipelineId || ""))) throw new Error("Video Pipeline ID non valido.");
  const base = path.resolve(root, ".data", "character-video-assets");
  const directory = path.resolve(base, pipelineId);
  if (!directory.startsWith(`${base}${path.sep}`)) throw new Error("Character Video asset path non valido.");
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function writeCharacterVideoAudio(pipelineId, file) {
  if (!file?.buffer) throw new Error("File audio esistente mancante.");
  const extension = path.extname(file.originalname || "") || ".bin";
  const filename = `dialogue-${crypto.randomUUID()}${extension}`;
  const target = path.join(characterVideoAssetDirectory(pipelineId), filename);
  fs.writeFileSync(target, file.buffer);
  return { path: target, filename, originalName: file.originalname || filename, mimeType: file.mimetype, size: file.size || file.buffer.length, source: "existing" };
}

function publishCharacterVideoFile(sourcePath, pipelineId, label = "master") {
  if (!outputDirectory || !sourcePath || !fs.existsSync(sourcePath)) throw new Error("Output locale Character Video non disponibile.");
  const subfolder = path.join("video", "Characters", pipelineId);
  const directory = path.join(outputDirectory, subfolder);
  fs.mkdirSync(directory, { recursive: true });
  const filename = `${label}-${crypto.randomUUID()}.mp4`;
  fs.copyFileSync(sourcePath, path.join(directory, filename));
  return { filename, subfolder: subfolder.replaceAll(path.sep, "/"), type: "output" };
}

async function prepareCharacterVideoAudio(rootGeneration, character, dialogueAudioFile) {
  let pipeline = rootGeneration.characterVideoPipeline;
  const stage = characterVideoStage(pipeline, "audio");
  if (!stage || ["completed", "skipped"].includes(stage.status)) return rootGeneration;
  pipeline = updateCharacterVideoStage(pipeline, "audio", { status: "running", startedAt: new Date().toISOString() });
  let rootRecord = store.update(rootGeneration.id, { characterVideoPipeline: pipeline });
  try {
    let audioAsset;
    if (pipeline.audioMode === "existing") {
      if (!dialogueAudioFile || !["audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"].includes(dialogueAudioFile.mimetype)) {
        throw new Error("Carica un file WAV, MP3 o M4A per la battuta esistente.");
      }
      validateUploadSize(dialogueAudioFile, maxUploadMb, "Il file audio");
      audioAsset = writeCharacterVideoAudio(rootGeneration.id, dialogueAudioFile);
    } else {
      const outputDir = path.join(characterVideoAssetDirectory(rootGeneration.id), "tts");
      const language = character.voiceProfile?.language && character.voiceProfile.language !== "auto" ? character.voiceProfile.language : "it";
      const referencePath = characterStore.voiceReferencePath(character.id);
      if (!referencePath) throw new Error("Aggiungi una reference voce al profilo Character prima di usare Chatterbox.");
      const generated = await gpuResourceManager.run("character-video-tts", () => synthesizeDialogue({
        root,
        referenceAudio: { path: referencePath },
        text: rootGeneration.videoBlueprint.dialogue,
        language,
        outputDirectory: outputDir,
        speaker: character.voiceProfile?.speaker || character.name,
        eventId: "character-dialogue",
        options: { requireReference: true },
      }));
      const stats = fs.statSync(generated.value.path);
      audioAsset = {
        path: generated.value.path,
        filename: path.basename(generated.value.path),
        mimeType: generated.value.mimeType,
        size: stats.size,
        source: "externalTts",
        engine: generated.value.engine,
        metadata: generated.value.metadata,
      };
    }
    pipeline = updateCharacterVideoStage(pipeline, "audio", { status: "completed", output: [{ filename: audioAsset.filename, mimeType: audioAsset.mimeType }], finishedAt: new Date().toISOString() });
    pipeline = { ...pipeline, audioAsset, updatedAt: new Date().toISOString() };
    rootRecord = store.update(rootGeneration.id, { characterVideoPipeline: pipeline, audio: audioAsset });
    broadcast({ type: "generation_updated", generationId: rootRecord.id, data: rootRecord });
    return rootRecord;
  } catch (error) {
    pipeline = updateCharacterVideoStage(pipeline, "audio", { status: "failed", error: error.message, finishedAt: new Date().toISOString() });
    pipeline = { ...pipeline, status: "failed", updatedAt: new Date().toISOString() };
    rootRecord = store.update(rootGeneration.id, { status: "error", error: error.message, characterVideoPipeline: pipeline, finishedAt: new Date().toISOString() });
    broadcast({ type: "generation_updated", generationId: rootRecord.id, data: rootRecord });
    return rootRecord;
  }
}

app.post("/api/characters/:id/create-video", upload.fields([{ name: "videoSource", maxCount: 1 }, { name: "dialogueAudio", maxCount: 1 }]), async (request, response, next) => {
  try {
    const character = characterStore.getCharacter(request.params.id);
    const raw = request.body || {};
    let videoBlueprint;
    try {
      videoBlueprint = normalizeVideoBlueprint(typeof raw.videoBlueprint === "string" ? JSON.parse(raw.videoBlueprint) : raw.videoBlueprint || {});
    } catch {
      throw new Error("Video Blueprint non valido.");
    }
    const motionPrompt = String(raw.motionPrompt || "").trim().slice(0, 12_000);
    if (!motionPrompt) throw new Error("Prepara prima il Motion Prompt con LM Studio.");
    const router = await characterVideoRouterRuntime();
    const route = characterVideoRoute(router, {
      ...raw,
      dialogue: videoBlueprint.dialogue,
      audioMode: videoBlueprint.audioMode,
    });
    const sourceMode = ["auto", "hero", "generated", "upload"].includes(raw.sourceMode) ? raw.sourceMode : "auto";
    const sourceFileUpload = request.files?.videoSource?.[0];
    const dialogueAudioFile = request.files?.dialogueAudio?.[0];
    let sourceUpload;
    let anchorGenerationId = null;
    let anchorImage = null;
    if (sourceMode === "auto" || sourceMode === "generated") {
      const sourceId = sourceMode === "auto" ? raw.anchorGenerationId : raw.sourceGenerationId;
      const sourceGeneration = store.get(sourceId);
      if (!sourceGeneration || sourceGeneration.characterId !== character.id || sourceGeneration.status !== "completed" || !sourceGeneration.images?.length) {
        throw new Error(sourceMode === "auto" ? "Il Video Anchor non è ancora pronto." : "La foto generata selezionata non è disponibile.");
      }
      const sourceFile = sourceGeneration.images[0];
      sourceUpload = await comfy.reuseOutputImage(sourceFile, `character-video-${character.id}-${sourceGeneration.id}.png`);
      anchorGenerationId = sourceGeneration.id;
      anchorImage = sourceFile;
    } else if (sourceMode === "hero") {
      const hero = characterHeroAsset(character);
      sourceUpload = await uploadCharacterAsset(hero);
      anchorImage = { referenceId: character.heroImage, type: "hero" };
    } else {
      if (!["image/png", "image/jpeg", "image/webp"].includes(sourceFileUpload?.mimetype)) throw new Error("Carica un'immagine PNG, JPG o WebP per il Video Anchor.");
      validateUploadSize(sourceFileUpload, maxUploadMb, "L'immagine Video Anchor");
      sourceUpload = await comfy.uploadImage(sourceFileUpload);
      anchorImage = { type: "upload", originalName: sourceFileUpload.originalname };
    }
    const orientation = String(raw.aspectRatio) === "16:9" ? "landscape" : "portrait";
    const resolution = route.quality === "fast" ? "360p" : route.quality === "max" ? "720p" : "480p";
    const rawSeed = String(raw.seed || "").trim();
    const parsedSeed = Number(rawSeed);
    const seed = rawSeed && Number.isSafeInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed : crypto.randomInt(0, 2 ** 31);
    const refinePreset = ["original", "improved", "quality"].includes(raw.refinePreset) ? raw.refinePreset : "improved";
    const runtimeAudio = appConfigCache.value?.characterVideoAudio || {};
    let videoPipeline = createCharacterVideoPipeline({
      anchorGenerationId,
      anchorImage,
      audioMode: videoBlueprint.audioMode,
      refinePreset,
      capabilities: {
        lipSync: Boolean(runtimeAudio.lipSync?.applyLipSync),
        videoRefine: Boolean(runtimeAudio.refine?.available),
      },
    });
    const pipelineId = crypto.randomUUID();
    let rootGeneration = store.add({
      id: pipelineId,
      promptId: null,
      projectId: character.id,
      status: "orchestrating",
      progress: 0,
      videos: [],
      images: [],
      createdAt: new Date().toISOString(),
      finishedAt: null,
      ...characterVideoHistoryMetadata({ character, videoBlueprint, anchorGenerationId, anchorImage, route, motionPrompt, sourceMode }),
      generationType: "characterVideoPipeline",
      workflowName: `Character Video Master · ${route.engine.name}`,
      characterVideoPipeline: videoPipeline,
      scenePrompt: String(raw.scenePrompt || "").trim().slice(0, 12_000),
      audioPrompt: String(raw.audioPrompt || "").trim().slice(0, 12_000),
      dialogueInstructions: String(raw.dialogueInstructions || "").trim().slice(0, 4000),
      emotionInstructions: String(raw.emotionInstructions || "").trim().slice(0, 4000),
      refinePreset,
      seed,
    });
    broadcast({ type: "generation_created", generationId: rootGeneration.id, projectId: character.id, data: rootGeneration });
    rootGeneration = await prepareCharacterVideoAudio(rootGeneration, character, dialogueAudioFile);
    if (rootGeneration.status === "error") return response.status(202).json({ generation: rootGeneration, pipeline: rootGeneration.characterVideoPipeline, route: { engine: route.engine.id, workflowId: route.workflowId, quality: route.quality } });
    videoPipeline = rootGeneration.characterVideoPipeline;
    const rawPrompt = videoBlueprint.audioMode === "native"
      ? `${motionPrompt} ${String(raw.audioPrompt || "").trim()}`.trim()
      : `${motionPrompt} The character performs the requested speech naturally with stable facial identity; final dialogue audio and mouth synchronization are applied by the external talking stage.`;
    const job = buildWorkflow(route.workflowId, {
      prompt: rawPrompt,
      negativePrompt: "identity drift, face drift, morphology drift, flicker, temporal inconsistency, malformed motion, extra subjects, captions, subtitles, watermark",
      resolution,
      orientation,
      duration: videoBlueprint.duration,
      quality: route.quality === "fast" ? "preview" : "max",
      videoModelId: "normal",
      videoInputMode: "image",
      seed,
    }, sourceUpload, [], []);
    job.metadata = {
      ...job.metadata,
      generationPurpose: "character_video_raw",
      generationType: "video",
      mediaType: "video",
      workflowName: `Raw Character Video · ${route.engine.name} · ${route.quality}`,
      pipelineRootGenerationId: rootGeneration.id,
      pipelineStage: "video",
      characterId: character.id,
      characterName: character.name,
      videoBlueprint,
      anchorGenerationId,
      anchorImage,
      videoEngine: route.engine.id,
      motionPrompt,
      audioMode: videoBlueprint.audioMode,
      archived: true,
      seed,
    };
    try {
      const rawGeneration = await queueStudioJob(job, character.id);
      videoPipeline = updateCharacterVideoStage(videoPipeline, "video", { status: "running", generationId: rawGeneration.id, startedAt: new Date().toISOString() });
      rootGeneration = store.update(rootGeneration.id, { characterVideoPipeline: videoPipeline, rawVideoGenerationId: rawGeneration.id });
      broadcast({ type: "generation_updated", generationId: rootGeneration.id, data: rootGeneration });
      response.status(202).json({ generation: rootGeneration, rawGeneration, pipeline: videoPipeline, route: { engine: route.engine.id, workflowId: route.workflowId, quality: route.quality } });
    } catch (error) {
      videoPipeline = updateCharacterVideoStage(videoPipeline, "video", { status: "failed", error: error.message, finishedAt: new Date().toISOString() });
      videoPipeline = { ...videoPipeline, status: "failed" };
      rootGeneration = store.update(rootGeneration.id, { status: "error", error: error.message, characterVideoPipeline: videoPipeline, finishedAt: new Date().toISOString() });
      broadcast({ type: "generation_updated", generationId: rootGeneration.id, data: rootGeneration });
      response.status(202).json({ generation: rootGeneration, pipeline: videoPipeline, route: { engine: route.engine.id, workflowId: route.workflowId, quality: route.quality } });
    }
  } catch (error) {
    next(error);
  }
});

function characterVideoLocalPath(generation) {
  const file = generation?.videos?.at(-1);
  if (!file) return null;
  return resolveMediaFile(outputDirectory, file)?.path || null;
}

function completeCharacterVideoPipeline(rootGeneration, pipeline) {
  const masterGeneration = store.get(pipeline.lastValidVideoGenerationId);
  if (!masterGeneration?.videos?.length) {
    const failed = updateCharacterVideoStage(pipeline, "master", {
      status: "failed",
      error: "Nessun video valido disponibile per il Master.",
      finishedAt: new Date().toISOString(),
    });
    const updated = store.update(rootGeneration.id, {
      status: "error",
      error: "Character Video Pipeline terminata senza un video valido.",
      characterVideoPipeline: { ...failed, status: "failed" },
      finishedAt: new Date().toISOString(),
    });
    broadcast({ type: "generation_updated", generationId: updated.id, data: updated });
    scheduleIdlePurge();
    return updated;
  }
  let finished = updateCharacterVideoStage(pipeline, "master", {
    status: "completed",
    generationId: masterGeneration.id,
    output: masterGeneration.videos,
    finishedAt: new Date().toISOString(),
  });
  finished = finishCharacterVideoPipeline({ ...finished, lastValidVideoGenerationId: masterGeneration.id }, masterGeneration.id);
  const updated = store.update(rootGeneration.id, {
    status: "completed",
    progress: 100,
    videos: masterGeneration.videos,
    output: masterGeneration.videos,
    masterGenerationId: masterGeneration.id,
    masterOutputKind: "Master Video",
    characterVideoPipeline: finished,
    finishedAt: new Date().toISOString(),
  });
  broadcast({ type: "generation_updated", generationId: updated.id, data: updated });
  scheduleIdlePurge();
  return updated;
}

async function queueCharacterVideoRefine(rootGeneration, pipeline, sourceGeneration) {
  const stage = characterVideoStage(pipeline, "refine");
  if (!stage || stage.status !== "requested") return completeCharacterVideoPipeline(rootGeneration, pipeline);
  let current = updateCharacterVideoStage(pipeline, "refine", { status: "running", startedAt: new Date().toISOString() });
  let updatedRoot = store.update(rootGeneration.id, { characterVideoPipeline: current });
  broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
  try {
    const sourcePath = characterVideoLocalPath(sourceGeneration);
    if (!sourcePath) throw new Error("Il video sorgente del refine non è disponibile localmente.");
    const sourceUpload = await uploadLocalVideoForComfy(sourcePath);
    const profile = current.refinePreset === "quality" ? "quality" : "preview";
    const duration = Math.max(1, Number(rootGeneration.videoBlueprint?.duration || sourceGeneration.duration || 5));
    const job = buildSeedvr2VideoUpscaleWorkflow({
      seedvr2VideoPreset: profile,
      seedvr2VideoKeepAudio: true,
      seedvr2VideoSourceDuration: duration,
      seedvr2VideoFrameLoadCap: Math.min(2000, Math.ceil(duration * 24) + 1),
      seedvr2VideoFps: 24,
      seed: rootGeneration.seed,
    }, sourceUpload);
    job.metadata = {
      ...job.metadata,
      generationPurpose: "character_video_refine",
      pipelineRootGenerationId: rootGeneration.id,
      pipelineStage: "refine",
      parentGenerationId: sourceGeneration.id,
      characterId: rootGeneration.characterId,
      characterName: rootGeneration.characterName,
      archived: true,
    };
    const child = await queueStudioJob(job, rootGeneration.characterId);
    current = updateCharacterVideoStage(current, "refine", { generationId: child.id });
    updatedRoot = store.update(rootGeneration.id, { characterVideoPipeline: current, refineGenerationId: child.id });
    broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
    return child;
  } catch (error) {
    current = updateCharacterVideoStage(current, "refine", { status: "failed", error: error.message, finishedAt: new Date().toISOString() });
    updatedRoot = store.update(rootGeneration.id, { characterVideoPipeline: current });
    broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
    return completeCharacterVideoPipeline(updatedRoot, current);
  }
}

async function runCharacterVideoLipSync(rootGeneration, pipeline, sourceGeneration) {
  const stage = characterVideoStage(pipeline, "lipSync");
  if (!stage || stage.status !== "requested") return queueCharacterVideoRefine(rootGeneration, pipeline, sourceGeneration);
  let current = updateCharacterVideoStage(pipeline, "lipSync", { status: "running", startedAt: new Date().toISOString() });
  let updatedRoot = store.update(rootGeneration.id, { characterVideoPipeline: current });
  broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
  try {
    const sourcePath = characterVideoLocalPath(sourceGeneration);
    if (!sourcePath) throw new Error("Il Raw Video non è disponibile localmente per il lip-sync.");
    const audioAsset = current.audioAsset || rootGeneration.audio;
    const generated = await gpuResourceManager.run("character-video-lipsync", () => applyLipSync({
      root,
      video: { path: sourcePath },
      audio: audioAsset,
      outputDirectory: path.join(characterVideoAssetDirectory(rootGeneration.id), "lipsync"),
      segmentId: rootGeneration.id,
      start: 0,
      end: Number(rootGeneration.videoBlueprint?.duration || 0),
    }));
    const file = publishCharacterVideoFile(generated.value.path, rootGeneration.id, "lipsync");
    const child = store.add({
      id: crypto.randomUUID(), promptId: null, projectId: rootGeneration.characterId,
      status: "completed", progress: 100, videos: [file], images: [],
      createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      generationType: "characterVideoStage", generationPurpose: "character_video_lipsync",
      workflowName: "Talking Performance · MuseTalk 1.5", pipelineRootGenerationId: rootGeneration.id,
      pipelineStage: "lipSync", parentGenerationId: sourceGeneration.id,
      characterId: rootGeneration.characterId, characterName: rootGeneration.characterName,
      lipSyncEngine: generated.value.engine, archived: true,
    });
    broadcast({ type: "generation_created", generationId: child.id, projectId: rootGeneration.characterId, data: child });
    current = updateCharacterVideoStage(current, "lipSync", { status: "completed", generationId: child.id, output: child.videos, finishedAt: new Date().toISOString() });
    current = { ...current, lastValidVideoGenerationId: child.id };
    updatedRoot = store.update(rootGeneration.id, { characterVideoPipeline: current, lipSyncGenerationId: child.id });
    broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
    return queueCharacterVideoRefine(updatedRoot, current, child);
  } catch (error) {
    current = updateCharacterVideoStage(current, "lipSync", { status: "failed", error: error.message, finishedAt: new Date().toISOString() });
    updatedRoot = store.update(rootGeneration.id, { characterVideoPipeline: current });
    broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
    return queueCharacterVideoRefine(updatedRoot, current, sourceGeneration);
  }
}

async function advanceCharacterVideoPipeline(generation) {
  const rootId = generation.pipelineRootGenerationId;
  if (!rootId || !["video", "refine"].includes(generation.pipelineStage)) return null;
  const rootGeneration = store.get(rootId);
  let pipeline = rootGeneration?.characterVideoPipeline;
  if (!rootGeneration || !pipeline || pipeline.status !== "running") return null;
  const stageId = generation.pipelineStage;
  const stage = characterVideoStage(pipeline, stageId);
  if (!stage || !["running", "requested"].includes(stage.status)) return null;
  if (generation.status === "completed" && generation.videos?.length) {
    pipeline = updateCharacterVideoStage(pipeline, stageId, { status: "completed", generationId: generation.id, output: generation.videos, finishedAt: generation.finishedAt || new Date().toISOString() });
    pipeline = { ...pipeline, lastValidVideoGenerationId: generation.id };
  } else {
    pipeline = updateCharacterVideoStage(pipeline, stageId, { status: "failed", generationId: generation.id, error: generation.error || `${stage.label} non completato.`, finishedAt: generation.finishedAt || new Date().toISOString() });
  }
  store.update(generation.id, { archived: true });
  const updatedRoot = store.update(rootId, { characterVideoPipeline: pipeline });
  broadcast({ type: "generation_updated", generationId: updatedRoot.id, data: updatedRoot });
  if (stageId === "video") {
    if (!pipeline.lastValidVideoGenerationId) return completeCharacterVideoPipeline(updatedRoot, pipeline);
    return runCharacterVideoLipSync(updatedRoot, pipeline, generation);
  }
  return completeCharacterVideoPipeline(updatedRoot, pipeline);
}

function continueCharacterVideoPipeline(generation) {
  void advanceCharacterVideoPipeline(generation).catch((error) => {
    const root = store.get(generation.pipelineRootGenerationId);
    if (!root?.characterVideoPipeline) return;
    const updated = store.update(root.id, {
      characterVideoPipeline: { ...root.characterVideoPipeline, status: "completed_with_warnings", orchestrationError: error.message },
      error: error.message,
    });
    broadcast({ type: "generation_updated", generationId: updated.id, data: updated });
  });
}

async function resumeCharacterVideoPipelines() {
  for (const rootGeneration of store.list().filter((item) => item.characterVideoPipeline?.status === "running")) {
    const running = rootGeneration.characterVideoPipeline.stages.find((stage) => stage.status === "running" && stage.generationId);
    if (!running) continue;
    const generation = store.get(running.generationId);
    if (generation && ["completed", "error", "interrupted", "cancelled"].includes(generation.status)) continueCharacterVideoPipeline(generation);
  }
}

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
app.get("/api/scene-integration/config", async (_request, response, next) => {
  try {
    const age = Date.now() - sceneCapabilitiesCache.updatedAt;
    if (sceneCapabilitiesCache.value) {
      response.setHeader("x-capability-cache", age <= APP_CONFIG_TTL_MS ? "fresh" : "stale");
      if (age > APP_CONFIG_TTL_MS) void refreshSceneCapabilities().catch(() => {});
      return response.json(sceneCapabilitiesCache.value);
    }
    response.json(await refreshSceneCapabilities());
  } catch (error) {
    next(error);
  }
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

app.post("/api/pose-library/select", (request, response, next) => {
  try {
    response.json(selectPose(root, request.body || {}));
  } catch (error) {
    next(error);
  }
});

app.get("/api/pose-library/assets/*path", (request, response, next) => {
  try {
    const relative = Array.isArray(request.params.path) ? request.params.path.join("/") : String(request.params.path || "");
    const libraryRoot = path.resolve(root, "data", "pose-library");
    const asset = path.resolve(libraryRoot, relative);
    if (!asset.startsWith(`${libraryRoot}${path.sep}`) || !fs.existsSync(asset)) {
      return response.status(404).json({ error: "Pose asset non trovato." });
    }
    response.sendFile(asset);
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
  const limit = Math.max(1, Math.min(100, Number(_request.query.limit || 30)));
  response.json(studioStore.list().slice(0, limit).map(studioProjectView));
});

app.get("/api/studio/projects/:id", (request, response) => {
  const project = studioStore.get(request.params.id);
  if (!project) return response.status(404).json({ error: "Progetto Studio non trovato." });
  response.json(studioProjectView(project));
});

app.post("/api/studio/projects/:id/retry", async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const project = studioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Studio non trovato." });
    if ((project.generationIds || []).length) {
      const error = new Error("Il progetto possiede già una generazione e non può essere accodato due volte.");
      error.statusCode = 409;
      throw error;
    }
    let jobs = buildStudioJobs(
      project.studioMode,
      project.settings || {},
      project.uploads || {},
      project.loras || [],
    );
    jobs = await Promise.all(jobs.map((job) => integrateSceneJob(job, project.settings || {}, {
      maskUpload: project.uploads?.mask || null,
      structureGuideAvailable: Boolean(project.uploads?.guide),
    })));
    await validateStudioModels(jobs);
    const created = [];
    for (const job of jobs) created.push(await queueStudioJob(job, project.id));
    const updated = studioStore.update(project.id, {
      status: "queued",
      error: null,
      generationIds: created.map((item) => item.id),
      retriedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    broadcast({ type: "studio_project_retried", projectId: project.id, data: studioProjectView(updated) });
    response.status(202).json(studioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.get("/api/video-studio/projects", (request, response) => {
  const archived = String(request.query.archived || "false");
  const limit = Math.max(1, Math.min(100, Number(request.query.limit || 30)));
  response.json(videoStudioStore.list()
    .filter((project) => archived === "all" || (archived === "true" ? project.archived : !project.archived))
    .slice(0, limit)
    .map(videoStudioProjectView));
});

app.get("/api/video-studio/projects/:id", (request, response) => {
  const project = videoStudioStore.get(request.params.id);
  if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
  response.json(videoStudioProjectView(project));
});

app.get("/api/interactive-cast/capabilities", async (_request, response, next) => {
  try {
    const age = Date.now() - interactiveCastCapabilitiesCache.updatedAt;
    if (interactiveCastCapabilitiesCache.value) {
      response.setHeader("x-capability-cache", age <= APP_CONFIG_TTL_MS ? "fresh" : "stale");
      if (age > APP_CONFIG_TTL_MS) void refreshInteractiveCastCapabilities().catch(() => {});
      return response.json(interactiveCastCapabilitiesCache.value);
    }
    response.json(await refreshInteractiveCastCapabilities());
  } catch (error) {
    next(error);
  }
});

app.get("/api/interactive-cast/projects", (request, response) => {
  const limit = Math.max(1, Math.min(100, Number(request.query.limit || 20)));
  response.json({ projects: interactiveCast.list().slice(0, limit) });
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

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/approve-anchor", async (request, response, next) => {
  try {
    const result = await approveInteractiveCastAnchor(request.params.id, request.params.segmentId);
    response.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/interactive-cast/projects/:id/segments/:segmentId/external-anchor", upload.single("anchorImage"), async (request, response, next) => {
  try {
    if (!request.file) throw new Error("Carica l'immagine anchor creata esternamente.");
    validateUploadSize(request.file, maxImageUploadMb, "L'anchor esterno");
    const result = await importInteractiveCastAnchor(
      request.params.id,
      request.params.segmentId,
      request.file,
    );
    response.json(result);
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

app.get("/api/video-studio/sequential-story", (request, response) => {
  const limit = Math.max(1, Math.min(100, Number(request.query.limit || 20)));
  response.json({ projects: sequentialStoryStore.list().slice(0, limit) });
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
    const allowedLoras = ["minimaxH3", "actionH3", "seedHunterH3"].includes(request.body.videoStudioMode) ? config.h3Loras : config.ltxLoras;
    if (selectedLoras.length) validateLoras(selectedLoras, allowedLoras);
    const uploaded = await uploadVideoStudioFiles(request.files || []);
    const characterSelection = await uploadCharacterSelection(
      request.body,
      {
        generationType: "videoStudio",
        videoStudioMode: request.body.videoStudioMode,
      },
      2,
    );
    if (characterSelection && String(request.body.characterPromptEnhanced || "") !== characterSelection.character.id) {
      request.body = withCharacterPrompt(request.body, characterSelection.adapter);
    }
    if (characterSelection?.uploads[0]) {
      if (!uploaded.identityImage) uploaded.identityImage = characterSelection.uploads[0];
      if (!uploaded.referenceSheet) uploaded.referenceSheet = characterSelection.uploads[1] || characterSelection.uploads[0];
    }
    let job = buildVideoStudioInitialJob(
      request.body.videoStudioMode,
      request.body.videoStudioMode === "seedHunterH3" ? { ...request.body, h3CandidateIndex: 1 } : request.body,
      uploaded,
      selectedLoras,
      config,
    );
    const jobs = request.body.videoStudioMode === "seedHunterH3"
      ? [job, ...[1, 2].map((offset) => buildVideoStudioInitialJob(
        "seedHunterH3",
        { ...request.body, seed: job.metadata.seed + offset, h3CandidateIndex: offset + 1 },
        uploaded,
        selectedLoras,
        config,
      ))]
      : [job];
    for (let index = 0; index < jobs.length; index += 1) {
      if (characterSelection) {
        jobs[index].metadata = {
          ...jobs[index].metadata,
          character: {
            id: characterSelection.character.id,
            name: characterSelection.character.name,
            capability: characterSelection.adapter.capability,
            referenceIds: characterSelection.adapter.references.map((item) => item.id),
            warnings: characterSelection.adapter.warnings,
          },
        };
      }
      jobs[index] = await integrateSceneJob(jobs[index], request.body, {
        trackedMask: request.body.videoStudioMode === "actorReplacement",
      });
    }
    [job] = jobs;
    const sceneRecipe = buildH3SceneRecipe(job, request.body, uploaded, selectedLoras);
    const project = videoStudioStore.add({
      id: crypto.randomUUID(),
      videoStudioMode: request.body.videoStudioMode,
      name: String(request.body.projectName || job.metadata.workflowName || "Progetto Video Studio").trim(),
      prompt: String(request.body.prompt || "").trim(),
      settings: { ...request.body, loras: undefined },
      uploads: uploaded,
      loras: selectedLoras,
      sceneRecipe: sceneRecipe ? { ...sceneRecipe, createdAt: new Date().toISOString() } : null,
      status: "queued",
      generationIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const generations = [];
    let updated = project;
    for (const candidateJob of jobs) {
      const generation = await queueStudioJob(candidateJob, project.id);
      generations.push(generation);
      updated = videoStudioStore.update(project.id, {
        generationIds: generations.map((item) => item.id),
        updatedAt: new Date().toISOString(),
      });
    }
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

app.post("/api/video-studio/projects/:id/promote-preview", async (request, response, next) => {
  try {
    cancelIdlePurge();
    const project = videoStudioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
    if (!["minimaxH3", "actionH3"].includes(project.videoStudioMode) || !project.sceneRecipe) {
      return response.status(409).json({ error: "La promozione è disponibile soltanto per un progetto MiniMax H3 o ACTION H3 con ricetta salvata." });
    }
    if (videoStudioProjectIsActive(project)) {
      return response.status(409).json({ error: "Attendi o annulla la generazione attiva prima di promuovere l’anteprima." });
    }
    const requested = request.body?.generationId ? store.get(String(request.body.generationId)) : null;
    const generations = videoStudioProjectGenerations(project);
    const generation = requested || [...generations].reverse().find((item) =>
      item.status === "completed" && item.h3Stage === "preview" && item.videos?.length
    );
    if (!generation || generation.projectId !== project.id || generation.h3Stage !== "preview" || !generation.videos?.length) {
      return response.status(409).json({ error: "Completa prima un’anteprima MiniMax H3 del progetto." });
    }
    const config = await videoStudioRuntimeConfig();
    if (!config.h3.previewFinishing.available) {
      throw new Error(`Finishing anteprima non disponibile. Nodi mancanti: ${config.h3.previewFinishing.missingNodes.join(", ")}`);
    }
    const selectedUpload = await comfy.reuseOutputFile(
      generation.videos.at(-1),
      `h3-preview-${project.id}.mp4`,
      "video/mp4",
    );
    const job = buildH3PreviewFinishingWorkflow(selectedUpload, {
      ...(request.body || {}),
      videoStudioMode: project.videoStudioMode,
      aspectRatio: project.sceneRecipe.aspectRatio,
    });
    job.metadata = {
      ...job.metadata,
      sourcePreviewGenerationId: generation.id,
      sceneRecipeSeed: project.sceneRecipe.seed,
      h3Mode: project.sceneRecipe.h3Mode,
    };
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

app.post("/api/video-studio/projects/:id/regenerate-native", async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const project = videoStudioStore.get(request.params.id);
    if (!project) return response.status(404).json({ error: "Progetto Video Studio non trovato." });
    if (!["minimaxH3", "actionH3", "seedHunterH3"].includes(project.videoStudioMode) || !project.sceneRecipe) {
      return response.status(409).json({ error: "La rigenerazione nativa richiede un progetto MiniMax H3, ACTION H3 o Seed Hunter H3 con ricetta salvata." });
    }
    if (videoStudioProjectIsActive(project)) {
      return response.status(409).json({ error: "Attendi o annulla la generazione attiva prima della rigenerazione nativa." });
    }
    const requested = request.body?.generationId ? store.get(String(request.body.generationId)) : null;
    const generations = videoStudioProjectGenerations(project);
    const preview = requested || [...generations].reverse().find((item) =>
      item.status === "completed" && ["preview", "seedCandidate"].includes(item.h3Stage) && item.videos?.length
    );
    if (!preview || preview.projectId !== project.id || !["preview", "seedCandidate"].includes(preview.h3Stage)) {
      return response.status(409).json({ error: "Completa prima un’anteprima o un Seed Hunter MiniMax H3 del progetto." });
    }
    const config = await videoStudioRuntimeConfig();
    const seedHunterSelection = project.videoStudioMode === "seedHunterH3" && preview.h3Stage === "seedCandidate";
    const raw = {
      ...project.settings,
      ...project.sceneRecipe.nativeSettings,
      prompt: project.sceneRecipe.userPrompt,
      seed: seedHunterSelection ? preview.seed : request.body?.seed ?? project.sceneRecipe.seed,
      h3RunProfile: "nativeFinal",
      actionH3RunProfile: "nativeFinal",
      ...(seedHunterSelection ? {
        h3Mode: project.settings.seedHunterH3Mode || project.sceneRecipe.h3Mode,
        h3AspectRatio: project.settings.seedHunterH3AspectRatio || project.sceneRecipe.aspectRatio,
        h3LookPreset: project.settings.seedHunterH3LookPreset || project.sceneRecipe.lookPreset,
        h3AttentionBackend: project.settings.seedHunterH3AttentionBackend || "memoryEfficient",
        h3RefineMode: project.settings.seedHunterH3FinalRefine || "h3Balanced",
        h3FirstMegapixels: 0.25,
        h3SecondMegapixels: 0.9,
        h3SecondPass: true,
        h3UseTurbo: true,
      } : {}),
    };
    const job = buildVideoStudioInitialJob(
      seedHunterSelection ? "minimaxH3" : project.videoStudioMode,
      raw,
      project.uploads || {},
      project.loras || [],
      config,
    );
    job.metadata = {
      ...job.metadata,
      videoStudioLabel: seedHunterSelection ? `Seed Hunter → finale H3 · seed ${raw.seed}` : `Finale nativo stesso seed · ${job.metadata.videoStudioLabel}`,
      sourcePreviewGenerationId: preview.id,
      sceneRecipeSeed: project.sceneRecipe.seed,
    };
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

app.post("/api/video-studio/projects/:id/h3-ltx2k", async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const project = videoStudioStore.get(request.params.id);
    if (!project || !["minimaxH3", "actionH3"].includes(project.videoStudioMode)) {
      return response.status(404).json({ error: "Progetto MiniMax H3 non trovato." });
    }
    if (videoStudioProjectIsActive(project)) throw new Error("Attendi o annulla la generazione attiva.");
    const generations = videoStudioProjectGenerations(project);
    const sourceGeneration = request.body?.generationId
      ? store.get(String(request.body.generationId))
      : [...generations].reverse().find((item) => item.status === "completed" && item.videos?.length);
    if (!sourceGeneration?.videos?.length || sourceGeneration.projectId !== project.id) throw new Error("Completa prima un video H3.");
    const source = await comfy.reuseOutputFile(sourceGeneration.videos.at(-1), `h3-ltx2k-${project.id}.mp4`, "video/mp4");
    const config = await videoStudioRuntimeConfig();
    if (!config.ltx25.modes.h3Ltx2k.available) throw new Error(config.ltx25.modes.h3Ltx2k.reason);
    const aspect = String(project.sceneRecipe?.aspectRatio || project.settings?.h3AspectRatio || "16:9").startsWith("9:16") ? "9:16" : "16:9";
    const job = buildVideoStudioInitialJob("ltx25Aio", {
      ltx25Mode: "h3Ltx2k",
      ltx25Profile: "maximum",
      ltx25Aspect: aspect,
      ltx25Fps: 24,
      duration: project.sceneRecipe?.duration || project.settings?.duration || 5,
      seed: request.body?.seed || project.sceneRecipe?.seed || project.settings?.seed,
      prompt: project.sceneRecipe?.userPrompt || project.prompt,
      negativePrompt: "identity drift, face morphing, temporal flicker, deformed anatomy, duplicated limbs, changing outfit, oversharpening, plastic skin, text, watermark",
      ltx25Decoder: "conv",
    }, { ltx25SourceVideo: source }, [], config);
    job.metadata = { ...job.metadata, workflowId: "videoStudio:h3Ltx2k", videoStudioMode: project.videoStudioMode, videoStudioLabel: "H3 → LTX 2.5 IC 2K", sourceGenerationId: sourceGeneration.id };
    const created = await queueStudioJob(job, project.id);
    const updated = videoStudioStore.update(project.id, { generationIds: [...(project.generationIds || []), created.id], updatedAt: new Date().toISOString() });
    response.status(202).json(videoStudioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/video-studio/projects/:id/temporal-derope", async (request, response, next) => {
  try {
    cancelIdlePurge();
    await comfy.health();
    const project = videoStudioStore.get(request.params.id);
    if (!project || !["minimaxH3", "actionH3"].includes(project.videoStudioMode)) return response.status(404).json({ error: "Progetto H3 non trovato." });
    if (videoStudioProjectIsActive(project)) throw new Error("Attendi o annulla la generazione attiva.");
    const generations = videoStudioProjectGenerations(project);
    const sourceGeneration = request.body?.generationId ? store.get(String(request.body.generationId)) : [...generations].reverse().find((item) => item.status === "completed" && item.videos?.length);
    if (!sourceGeneration?.videos?.length || sourceGeneration.projectId !== project.id) throw new Error("Completa prima un video H3.");
    const source = await comfy.reuseOutputFile(sourceGeneration.videos.at(-1), `h3-derope-${project.id}.mp4`, "video/mp4");
    const config = await videoStudioRuntimeConfig();
    const job = buildH3DeRopeWorkflow({
      profile: request.body?.profile || "balanced",
      seed: request.body?.seed || project.sceneRecipe?.seed || project.settings?.seed,
      prompt: project.sceneRecipe?.userPrompt || project.prompt,
    }, source, config);
    job.metadata = { ...job.metadata, videoStudioMode: project.videoStudioMode, sourceGenerationId: sourceGeneration.id };
    const created = await queueStudioJob(job, project.id);
    const updated = videoStudioStore.update(project.id, { generationIds: [...(project.generationIds || []), created.id], updatedAt: new Date().toISOString() });
    response.status(202).json(videoStudioProjectView(updated));
  } catch (error) {
    next(error);
  }
});

app.post("/api/studio/projects", upload.any(), async (request, response, next) => {
  let project = null;
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
      if (!uploaded.source?.name && ["bible", "qwenKreaKlein", "animeToReal", "kreaTriple"].includes(request.body.studioMode)) {
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
            compositionPolicy: job.metadata?.compositionPolicy || request.body.compositionPolicy,
            spatialInstruction: request.body.spatialInstruction,
            depthRelation: request.body.depthRelation,
            maskFile: job.metadata?.compositionPolicy === "recomposeGroup"
              ? ""
              : uploaded.mask?.name || "",
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
      maskUpload: job.metadata?.compositionPolicy === "recomposeGroup" ? null : uploaded.mask || null,
      structureGuideAvailable: Boolean(uploaded.guide),
      subjectType: job.metadata?.subjectInsertion?.subjectType || null,
    })));
    await validateStudioModels(jobs);
    project = studioStore.add({
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
    if (project && !(project.generationIds || []).length) {
      studioStore.update(project.id, {
        status: "error",
        error: error.message || "Creazione del workflow non completata.",
        updatedAt: new Date().toISOString(),
      });
    }
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

app.post("/api/prompt-assistant/enhance", upload.fields([
  { name: "sourceImage", maxCount: 1 },
  { name: "sourceImages", maxCount: 9 },
]), async (request, response, next) => {
  try {
    if (!promptAssistant.publicConfig().enabled) {
      return response.status(503).json({ error: "Il Prompt Assistant non è configurato. Imposta LM_STUDIO_MODEL." });
    }
    const allowedTargets = new Set([
      "flux1", "flux2", "krea2", "krea2_moody", "qwen", "qwenedit", "zimage", "mageflow", "mageflowedit", "ltx", "ltx_architect", "ltx_scenes", "ltxedit", "studio", "videostudio",
      "sulphur_ltx", "sulphur_ltx_architect", "sulphur_ltx_scenes", "sulphur_ltxedit", "sulphur_videostudio", "sulphur_prompt",
      "qwen_image_edit_architect", "flux2_klein_architect",
      "reverse_qwen", "reverse_klein",
      "minimax_h3",
      "minimax_h3_action",
      "minimax_h3_fantasy_verite",
    ]);
    const body = request.body || {};
    const target = String(body.target || "").toLowerCase();
    if (!allowedTargets.has(target)) return response.status(400).json({ error: "Workflow di destinazione non valido." });
    const sourceImages = [
      ...(request.files?.sourceImage || []),
      ...(request.files?.sourceImages || []),
    ].slice(0, 9);
    for (const sourceImage of sourceImages) {
      if (!sourceImage.mimetype.startsWith("image/")) {
        return response.status(400).json({ error: "Il Prompt Assistant vision accetta PNG, JPG o WebP." });
      }
      validateUploadSize(sourceImage, maxUploadMb, "L’immagine");
    }

    let characterContext = null;
    let enhancementText = String(body.text || "").trim();
    const characterId = String(body.characterId || "").trim();
    if (characterId) {
      const character = characterStore.getCharacter(characterId);
      const adapter = resolveCharacterAdapter({
        generationType: "promptAssistant",
        videoStudioMode: String(body.videoStudioMode || ""),
        character,
        options: {
          identityStrength: body.identityStrength,
          lockFace: body.lockFace,
          lockHair: body.lockHair,
          lockBody: body.lockBody,
          lockOutfit: body.lockOutfit,
          includeDescription: false,
        },
      });
      characterContext = { id: character.id, name: character.name };
      enhancementText = [
        "CHARACTER IDENTITY CONTEXT: The named adult character below is the subject of the requested scene. Preserve these identity traits in the rewritten prompt, integrate them naturally once, and do not treat them as additional actions or dialogue.",
        adapter.promptPrefix,
        "SCENE REQUEST TO REWRITE:",
        enhancementText,
      ].join("\n");
    }

    const before = await releaseComfyMemoryIfIdle();
    const result = await promptAssistant.enhance({
      text: enhancementText,
      target,
      promptPreset: String(body.promptPreset || ""),
      duration: Number(body.duration) || 0,
      mode: String(body.mode || "text"),
      workflowName: String(body.workflowName || ""),
      image: sourceImages[0] || null,
      images: sourceImages,
      model: (target.startsWith("sulphur_") || target === "sulphur_prompt") ? sulphurPromptAssistantModel : "",
      includeNegative: String(body.includeNegative || "").toLowerCase() === "true",
    });
    const after = await releaseComfyMemoryIfIdle();
    if (result.unloadError) {
      throw new Error(`Prompt creato, ma LM Studio non ha scaricato il modello: ${result.unloadError}`);
    }
    response.json({
      ...result,
      character: characterContext,
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
            syncCharacterReferenceGeneration(updated);
            if (patch.finishedAt) {
              continueCharacterMasterPipeline(updated);
              continueCharacterVideoPipeline(updated);
            }
            if (patch.finishedAt && !updated.pipelineRootGenerationId) scheduleIdlePurge();
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
            syncCharacterReferenceGeneration(updated);
            await advanceInteractiveCastGeneration(updated);
            continueCharacterMasterPipeline(updated);
            continueCharacterVideoPipeline(updated);
            if (!updated.pipelineRootGenerationId) scheduleIdlePurge();
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
            ...(["character_photo", "character_video_anchor"].includes(item.generationPurpose) ? { output: images }
              : item.generationPurpose === "character_video" ? { output: videos.length ? videos : images }
                : {}),
            finishedAt,
            durationMs: Number.isFinite(startedAtMs)
              ? Math.max(0, Date.parse(finishedAt) - startedAtMs)
              : null,
          });
          broadcast({ type: "generation_updated", generationId: item.id, data: updated });
          syncCharacterReferenceGeneration(updated);
          await advanceInteractiveCastGeneration(updated);
          continueCharacterMasterPipeline(updated);
          continueCharacterVideoPipeline(updated);
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
          if (!updated.pipelineRootGenerationId) scheduleIdlePurge();
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
          syncCharacterReferenceGeneration(updated);
          await advanceInteractiveCastGeneration(updated);
          continueCharacterMasterPipeline(updated);
          continueCharacterVideoPipeline(updated);
          if (!updated.pipelineRootGenerationId) scheduleIdlePurge();
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
          syncCharacterReferenceGeneration(updated);
          await advanceInteractiveCastGeneration(updated);
          continueCharacterMasterPipeline(updated);
          continueCharacterVideoPipeline(updated);
          if (!updated.pipelineRootGenerationId) scheduleIdlePurge();
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
  void refreshAppConfig().then(async () => {
    await resumeCharacterMasterPipelines();
    await resumeCharacterVideoPipelines();
  }).catch(() => {});
  void refreshInteractiveCastCapabilities().catch(() => {});
  void refreshSceneCapabilities().catch(() => {});
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

