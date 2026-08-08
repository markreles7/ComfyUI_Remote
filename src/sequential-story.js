import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { extractVideos } from "./comfy-client.js";
import { resolveMediaFile } from "./media-files.js";

const execFile = promisify(execFileCallback);

const PROJECT_STATUSES = new Set(["planned", "running", "paused", "failed", "completed", "cancelled"]);
const SCENE_STATUSES = new Set(["pending", "running", "completed", "failed", "skipped", "stale"]);
const DEFAULT_NEGATIVE = "identity drift, face morphing, temporal flicker, sudden camera jump, changed outfit, changed lighting, duplicated limbs, warped anatomy, disappearing objects, subtitles, text, watermark, low quality motion";

function now() {
  return new Date().toISOString();
}

function safeText(value, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function safeId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,100}$/.test(id)) throw new Error("Sequential Story ID non valido.");
  return id;
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

function numberValue(value, fallback, min, max, integer = false) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error("Impostazione Sequential Story non valida.");
  }
  return parsed;
}

function normalizeDuration(value, fallback = 10) {
  return numberValue(value, fallback, 1, 30, true);
}

function normalizeScene(scene, index, defaultDuration) {
  const id = safeText(scene?.id || `scene-${index + 1}`, 80).replace(/[^\w-]/g, "-") || `scene-${index + 1}`;
  return {
    id,
    index: index + 1,
    title: safeText(scene?.title || `Scena ${index + 1}`, 160),
    duration: normalizeDuration(scene?.duration, defaultDuration),
    prompt: safeText(scene?.prompt),
    negativePrompt: safeText(scene?.negativePrompt || DEFAULT_NEGATIVE, 1200),
    continuityNotes: safeText(scene?.continuityNotes || scene?.continuity || "", 1200),
    startState: safeText(scene?.startState || "", 1000),
    endState: safeText(scene?.endState || "", 1000),
    status: SCENE_STATUSES.has(scene?.status) ? scene.status : "pending",
    enabled: scene?.enabled !== false,
    seed: Number.isSafeInteger(Number(scene?.seed)) ? Number(scene.seed) : null,
    comfyPromptId: scene?.comfyPromptId || null,
    generationId: scene?.generationId || null,
    outputVideo: scene?.outputVideo || null,
    continuityFrame: scene?.continuityFrame || null,
    anchorFrame: scene?.anchorFrame || null,
    anchorStatus: scene?.anchorStatus || "no anchor generator configured",
    identityReport: scene?.identityReport || null,
    stale: Boolean(scene?.stale),
    error: scene?.error || null,
    updatedAt: scene?.updatedAt || now(),
  };
}

function normalizeSettings(raw = {}) {
  const sceneDuration = normalizeDuration(raw.sceneDuration, 10);
  const sceneCount = numberValue(raw.sceneCount, 3, 1, 12, true);
  const transition = ["cut", "crossfade"].includes(raw.transition) ? raw.transition : "cut";
  const audioMode = ["per-scene", "mute", "future-global"].includes(raw.audioMode) ? raw.audioMode : "per-scene";
  const seedMode = ["random", "sequence", "manual"].includes(raw.seedMode) ? raw.seedMode : "random";
  const frameOffsetMode = ["0.25", "0.5", "automatic"].includes(String(raw.frameOffsetMode))
    ? String(raw.frameOffsetMode)
    : "0.5";
  const bestFrameSelector = ["offset", "smart"].includes(raw.bestFrameSelector)
    ? raw.bestFrameSelector
    : frameOffsetMode === "automatic" ? "smart" : "offset";
  const anchorFrameMode = ["disabled", "qwen-image-edit"].includes(raw.anchorFrameMode)
    ? raw.anchorFrameMode
    : "disabled";
  const identityVerification = ["disabled", "perceptual"].includes(raw.identityVerification)
    ? raw.identityVerification
    : "disabled";
  return {
    workflowId: ["standard", "devfp8", "ltxSulphur"].includes(raw.workflowId) ? raw.workflowId : "standard",
    quality: raw.quality === "preview" ? "preview" : "max",
    resolution: raw.resolution || "480p",
    orientation: raw.orientation || "landscape",
    fps: numberValue(raw.fps, 24, 1, 120, true),
    sceneCount,
    sceneDuration,
    pauseAfterEachScene: booleanValue(raw.pauseAfterEachScene, false),
    useContinuityFrame: booleanValue(raw.useContinuityFrame, true),
    purgeBetweenScenes: booleanValue(raw.purgeBetweenScenes, true),
    audioMode,
    concatEnabled: booleanValue(raw.concatEnabled, true),
    transition,
    frameOffsetMode,
    frameOffsetSeconds: frameOffsetMode === "0.25" ? 0.25 : 0.5,
    bestFrameSelector,
    bestFrameSampleCount: numberValue(raw.bestFrameSampleCount, 18, 4, 36, true),
    bestFrameWindowSeconds: numberValue(raw.bestFrameWindowSeconds, 1.25, 0.25, 4),
    anchorFrameMode,
    anchorImageModelId: raw.anchorImageModelId || "qwenEdit",
    anchorImageModelFile: raw.anchorImageModelFile || "",
    identityVerification,
    identitySampleCount: numberValue(raw.identitySampleCount, 6, 1, 24, true),
    identityThreshold: numberValue(raw.identityThreshold, 0.58, 0, 1),
    seedMode,
    baseSeed: Number.isSafeInteger(Number(raw.baseSeed)) ? Number(raw.baseSeed) : null,
    manualSeed: Number.isSafeInteger(Number(raw.manualSeed)) ? Number(raw.manualSeed) : null,
    videoModelId: raw.videoModelId || "normal",
    characterId: safeText(raw.characterId || "", 100),
    identityStrength: raw.identityStrength || "medium",
    lockFace: booleanValue(raw.lockFace, true),
    lockHair: booleanValue(raw.lockHair, true),
    lockBody: booleanValue(raw.lockBody, true),
    lockOutfit: booleanValue(raw.lockOutfit, false),
  };
}

export function parseSequentialStoryJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("LM Studio non ha restituito JSON valido per la Storia continua.");
    return JSON.parse(match[0]);
  }
}

export function validateSequentialStoryPlan(raw, { sceneCount = 3, sceneDuration = 10 } = {}) {
  const parsed = typeof raw === "string" ? parseSequentialStoryJson(raw) : raw;
  const scenes = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  if (!scenes.length) throw new Error("La scaletta Sequential Story non contiene scene.");
  const normalizedScenes = scenes.slice(0, sceneCount).map((scene, index) =>
    normalizeScene(scene, index, sceneDuration),
  );
  if (normalizedScenes.some((scene) => !scene.prompt)) {
    throw new Error("Ogni scena della Storia continua deve avere un prompt.");
  }
  return {
    title: safeText(parsed?.title || "Storia continua", 160),
    globalContinuity: {
      character: safeText(parsed?.globalContinuity?.character, 700),
      face: safeText(parsed?.globalContinuity?.face, 700),
      hair: safeText(parsed?.globalContinuity?.hair, 700),
      body: safeText(parsed?.globalContinuity?.body, 700),
      outfit: safeText(parsed?.globalContinuity?.outfit, 700),
      location: safeText(parsed?.globalContinuity?.location, 700),
      lighting: safeText(parsed?.globalContinuity?.lighting, 700),
      cameraStyle: safeText(parsed?.globalContinuity?.cameraStyle, 700),
      visualStyle: safeText(parsed?.globalContinuity?.visualStyle, 700),
      temporalRules: safeText(parsed?.globalContinuity?.temporalRules, 700),
    },
    scenes: normalizedScenes,
  };
}

export function finalScenePrompt({ project, scene, previousScene = null, characterPrompt = "" } = {}) {
  const continuity = project.globalContinuity || {};
  const globalLines = Object.entries(continuity)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${key}: ${value}`);
  return [
    "GLOBAL CONTINUITY:",
    characterPrompt,
    ...globalLines,
    previousScene?.endState ? `PREVIOUS SCENE END STATE: ${previousScene.endState}` : "",
    previousScene?.continuityNotes ? `PREVIOUS CONTINUITY NOTES: ${previousScene.continuityNotes}` : "",
    scene.continuityNotes ? `CURRENT CONTINUITY NOTES: ${scene.continuityNotes}` : "",
    "CURRENT SCENE:",
    scene.prompt,
    scene.endState ? `End this scene with: ${scene.endState}` : "",
  ].filter(Boolean).join("\n");
}

function seedForScene(settings, scene, index) {
  if (Number.isSafeInteger(Number(scene.seed))) return Number(scene.seed);
  if (settings.seedMode === "manual" && settings.manualSeed != null) return settings.manualSeed + index;
  if (settings.seedMode === "sequence" && settings.baseSeed != null) return settings.baseSeed + index;
  return crypto.randomInt(0, 2 ** 31);
}

function terminal(status) {
  return ["completed", "failed", "skipped", "stale"].includes(status);
}

export function selectBestContinuityFrame({ frames = [], criteria = {} } = {}) {
  const candidates = Array.isArray(frames) ? frames.filter(Boolean) : [];
  if (!candidates.length) return null;
  if (criteria.sharpness) {
    return [...candidates].sort((left, right) =>
      Number(right.sharpness || right.score || 0) - Number(left.sharpness || left.score || 0)
    )[0];
  }
  return candidates[0];
}

function parsePgm(buffer) {
  const text = buffer.toString("ascii", 0, Math.min(buffer.length, 256));
  if (!text.startsWith("P5")) throw new Error("Formato frame non supportato.");
  let offset = 2;
  const tokens = [];
  while (tokens.length < 3 && offset < buffer.length) {
    while (/\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
    if (buffer[offset] === 35) {
      while (offset < buffer.length && buffer[offset] !== 10) offset += 1;
      continue;
    }
    const start = offset;
    while (offset < buffer.length && !/\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
    tokens.push(buffer.toString("ascii", start, offset));
  }
  while (/\s/.test(String.fromCharCode(buffer[offset]))) offset += 1;
  const [width, height, maxValue] = tokens.map(Number);
  if (!width || !height || maxValue <= 0) throw new Error("Header PGM non valido.");
  const pixels = buffer.subarray(offset, offset + width * height);
  if (pixels.length < width * height) throw new Error("Frame PGM incompleto.");
  return { width, height, pixels };
}

function frameMetrics(filePath) {
  const { width, height, pixels } = parsePgm(fs.readFileSync(filePath));
  let sum = 0;
  let sumSq = 0;
  for (const value of pixels) {
    sum += value;
    sumSq += value * value;
  }
  const count = pixels.length;
  const mean = sum / count;
  const contrast = Math.sqrt(Math.max(0, sumSq / count - mean * mean));
  let lapSum = 0;
  let lapSq = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const lap = (pixels[index] * 4)
        - pixels[index - 1]
        - pixels[index + 1]
        - pixels[index - width]
        - pixels[index + width];
      lapSum += lap;
      lapSq += lap * lap;
      lapCount += 1;
    }
  }
  const lapMean = lapCount ? lapSum / lapCount : 0;
  const sharpness = lapCount ? Math.max(0, lapSq / lapCount - lapMean * lapMean) : 0;
  const exposurePenalty = Math.abs(mean - 128) / 128;
  const score = (Math.log1p(sharpness) * 0.72)
    + (Math.min(contrast, 80) / 80 * 0.22)
    + ((1 - exposurePenalty) * 0.06);
  return {
    width,
    height,
    sharpness,
    contrast,
    brightness: mean,
    exposurePenalty,
    score,
  };
}

export function fingerprintFromPgm(filePath, size = 16) {
  const { width, height, pixels } = parsePgm(fs.readFileSync(filePath));
  const values = [];
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) * height / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) * width / size));
      values.push(pixels[sourceY * width + sourceX] / 255);
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const centered = values.map((value) => value - mean);
  const norm = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0)) || 1;
  return centered.map((value) => value / norm);
}

export function cosineSimilarity(left, right) {
  const length = Math.min(left?.length || 0, right?.length || 0);
  if (!length) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += left[index] * right[index];
  return Math.max(0, Math.min(1, (sum + 1) / 2));
}

export class SequentialStoryStore {
  constructor({ file, assetDirectory }) {
    this.file = file;
    this.assetDirectory = assetDirectory || path.join(path.dirname(file), "sequential-story-assets");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(this.assetDirectory, { recursive: true });
    this.items = this.#read();
  }

  #read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  #write() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(this.items, null, 2)}\n`);
    fs.renameSync(temp, this.file);
  }

  list() {
    return [...this.items].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  get(id) {
    return this.items.find((item) => item.id === id) || null;
  }

  require(id) {
    const project = this.get(safeId(id));
    if (!project) throw new Error("Sequential Story non trovata.");
    return project;
  }

  add(project) {
    this.items.push(project);
    this.#write();
    return project;
  }

  update(id, patch) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Sequential Story non trovata.");
    this.items[index] = { ...this.items[index], ...patch, updatedAt: now() };
    this.#write();
    return this.items[index];
  }

  projectAssetDirectory(projectId, { create = true } = {}) {
    const directory = path.resolve(this.assetDirectory, safeId(projectId));
    const root = path.resolve(this.assetDirectory);
    if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("Path Sequential Story non valido.");
    if (create) fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  sceneAssetDirectory(projectId) {
    const directory = this.projectAssetDirectory(projectId);
    fs.mkdirSync(path.join(directory, "frames"), { recursive: true });
    fs.mkdirSync(path.join(directory, "concat"), { recursive: true });
    return directory;
  }

  delete(id) {
    const safeProjectId = safeId(id);
    const index = this.items.findIndex((item) => item.id === safeProjectId);
    if (index < 0) throw new Error("Sequential Story non trovata.");
    const [removed] = this.items.splice(index, 1);
    this.#write();
    return removed;
  }

  deleteAssets(projectId) {
    const directory = this.projectAssetDirectory(projectId, { create: false });
    const root = path.resolve(this.assetDirectory);
    if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("Path Sequential Story non valido.");
    if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  }
}

export class SequentialStoryService {
  constructor({
    store,
    promptAssistant,
    buildWorkflow,
    queueJob,
    generationStore,
    comfy,
    outputDirectory,
    broadcast = () => {},
    recordFinalVideo = null,
    anchorFrameGenerator = null,
    identityVerifier = null,
    execFileImpl = execFile,
    generationTimeoutMs = 30 * 60_000,
  }) {
    this.store = store;
    this.promptAssistant = promptAssistant;
    this.buildWorkflow = buildWorkflow;
    this.queueJob = queueJob;
    this.generationStore = generationStore;
    this.comfy = comfy;
    this.outputDirectory = outputDirectory;
    this.broadcast = broadcast;
    this.recordFinalVideo = recordFinalVideo;
    this.anchorFrameGenerator = anchorFrameGenerator;
    this.identityVerifier = identityVerifier;
    this.execFile = execFileImpl;
    this.generationTimeoutMs = generationTimeoutMs;
    this.running = new Set();
  }

  async plan(args = {}) {
    if (!this.promptAssistant?.planSequentialStory) {
      throw new Error("LM Studio Sequential Story planner non configurato.");
    }
    const settings = normalizeSettings(args);
    return this.promptAssistant.planSequentialStory({
      description: safeText(args.description, 4000),
      sceneCount: settings.sceneCount,
      sceneDuration: settings.sceneDuration,
      globalStyle: safeText(args.globalStyle || args.style, 1200),
      characterContext: safeText(args.characterContext, 1200),
    });
  }

  create(raw = {}) {
    const settings = normalizeSettings(raw.settings || raw);
    const plan = validateSequentialStoryPlan(raw.plan || raw, {
      sceneCount: settings.sceneCount,
      sceneDuration: settings.sceneDuration,
    });
    const id = crypto.randomUUID();
    const project = {
      id,
      type: "sequentialStory",
      title: safeText(raw.title || plan.title || "Storia continua", 160),
      status: "planned",
      currentSceneIndex: 0,
      progress: 0,
      globalContinuity: plan.globalContinuity,
      settings,
      scenes: plan.scenes,
      generationIds: [],
      finalVideo: null,
      totalDuration: 0,
      numberOfScenes: plan.scenes.filter((scene) => scene.enabled !== false).length,
      concatMode: null,
      purgeLog: [],
      error: null,
      createdAt: now(),
      updatedAt: now(),
    };
    this.store.sceneAssetDirectory(id);
    return this.store.add(project);
  }

  update(id, raw = {}) {
    const current = this.store.require(id);
    if (current.status === "running") throw new Error("Ferma o metti in pausa la Storia continua prima di modificarla.");
    const settings = raw.settings ? { ...current.settings, ...normalizeSettings({ ...current.settings, ...raw.settings }) } : current.settings;
    const scenes = Array.isArray(raw.scenes)
      ? raw.scenes.map((scene, index) => normalizeScene(scene, index, settings.sceneDuration))
      : current.scenes;
    return this.store.update(current.id, {
      title: raw.title === undefined ? current.title : safeText(raw.title, 160),
      globalContinuity: raw.globalContinuity || current.globalContinuity,
      settings,
      scenes,
      status: PROJECT_STATUSES.has(raw.status) ? raw.status : current.status,
      numberOfScenes: scenes.filter((scene) => scene.enabled !== false).length,
    });
  }

  pause(id) {
    const project = this.store.require(id);
    if (project.status !== "running") return project;
    return this.store.update(project.id, { status: "paused" });
  }

  cancel(id) {
    const project = this.store.require(id);
    this.running.delete(project.id);
    return this.store.update(project.id, { status: "cancelled" });
  }

  delete(id) {
    const project = this.store.require(id);
    if (project.status === "running" || this.running.has(project.id)) {
      throw new Error("Metti in pausa o annulla la Storia continua prima di eliminarla.");
    }
    const removed = this.store.delete(project.id);
    this.store.deleteAssets(project.id);
    return {
      deleted: true,
      projectId: removed.id,
      preservedGenerations: removed.generationIds || [],
      cleaned: "temporary sequential-story assets",
    };
  }

  retryScene(id, sceneId) {
    const project = this.store.require(id);
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    if (sceneIndex < 0) throw new Error("Scena Sequential Story non trovata.");
    const scenes = project.scenes.map((scene, index) => {
      if (index < sceneIndex) return scene;
      if (index === sceneIndex) {
        return {
          ...scene,
          status: "pending",
          error: null,
          outputVideo: null,
          continuityFrame: null,
          anchorFrame: null,
          anchorStatus: "no anchor generator configured",
          identityReport: null,
          generationId: null,
          comfyPromptId: null,
          stale: false,
          updatedAt: now(),
        };
      }
      return { ...scene, status: scene.status === "completed" ? "stale" : scene.status, stale: true, updatedAt: now() };
    });
    return this.store.update(project.id, {
      status: "planned",
      currentSceneIndex: sceneIndex,
      scenes,
      finalVideo: null,
      concatMode: null,
    });
  }

  async start(id) {
    const project = this.store.require(id);
    if (this.running.has(project.id)) return project;
    this.running.add(project.id);
    const updated = this.store.update(project.id, { status: "running", error: null });
    this.broadcast({ type: "sequential_story_updated", projectId: project.id, data: updated });
    void this.#run(project.id).catch((error) => {
      const latest = this.store.get(project.id);
      if (latest) {
        const failed = this.store.update(project.id, { status: "failed", error: error.message });
        this.broadcast({ type: "sequential_story_updated", projectId: project.id, data: failed });
      }
    }).finally(() => this.running.delete(project.id));
    return updated;
  }

  async #run(projectId) {
    let project = this.store.require(projectId);
    const enabledScenes = project.scenes.filter((scene) => scene.enabled !== false);
    for (const scene of enabledScenes) {
      project = this.store.require(projectId);
      if (["paused", "cancelled"].includes(project.status)) return;
      const currentScene = project.scenes.find((item) => item.id === scene.id);
      if (!currentScene || currentScene.status === "completed" || currentScene.status === "skipped") continue;
      if (currentScene.stale) {
        project = this.store.update(project.id, {
          scenes: project.scenes.map((item) =>
            item.id === currentScene.id ? { ...item, status: "pending", stale: false, updatedAt: now() } : item
          ),
        });
      }
      console.log(`[SequentialStory] project=${project.id} scene=${currentScene.index}/${project.scenes.length} status=rendering`);
      project = await this.runSequentialScene(project.id, currentScene.id);
      console.log(`[SequentialStory] project=${project.id} scene=${currentScene.index}/${project.scenes.length} status=${project.scenes.find((item) => item.id === currentScene.id)?.status || "unknown"}`);
      if (project.status === "paused") return;
      const refreshed = this.store.require(project.id);
      const completedScene = refreshed.scenes.find((item) => item.id === currentScene.id);
      if (completedScene?.status === "failed") return;
      if (refreshed.settings.pauseAfterEachScene) {
        const paused = this.store.update(project.id, { status: "paused" });
        this.broadcast({ type: "sequential_story_updated", projectId: project.id, data: paused });
        return;
      }
    }
    project = this.store.require(projectId);
    if (project.settings.concatEnabled) {
      project = await this.concatSequentialClips(project.id);
      const totalDuration = project.scenes.reduce((sum, scene) =>
        sum + (scene.status === "completed" ? Number(scene.duration || 0) : 0), 0);
      project = this.store.update(project.id, { totalDuration });
      if (this.recordFinalVideo && project.finalVideo) {
        const finalGeneration = this.recordFinalVideo(project);
        project = this.store.update(project.id, {
          finalGenerationId: finalGeneration?.id || project.finalGenerationId || null,
          generationIds: finalGeneration?.id
            ? [...new Set([...(project.generationIds || []), finalGeneration.id])]
            : project.generationIds,
        });
      }
    }
    const complete = this.store.update(project.id, {
      status: "completed",
      progress: 100,
      totalDuration: project.totalDuration || project.scenes.reduce((sum, scene) =>
        sum + (scene.status === "completed" ? Number(scene.duration || 0) : 0), 0),
    });
    this.broadcast({ type: "sequential_story_updated", projectId, data: complete });
  }

  async runSequentialScene(projectId, sceneId) {
    let project = this.store.require(projectId);
    const sceneIndex = project.scenes.findIndex((scene) => scene.id === sceneId);
    if (sceneIndex < 0) throw new Error("Scena Sequential Story non trovata.");
    const scene = project.scenes[sceneIndex];
    const previousScene = project.scenes.slice(0, sceneIndex).reverse()
      .find((item) => item.status === "completed" && item.outputVideo);
    const seed = seedForScene(project.settings, scene, sceneIndex);
    const prompt = finalScenePrompt({
      project,
      scene,
      previousScene,
      characterPrompt: project.characterPrompt || "",
    });
    const anchor = await this.generateAnchorFrame({
      project,
      scene,
      sceneIndex,
      previousScene,
      prompt,
      seed,
    });
    const hasContinuity = Boolean(project.settings.useContinuityFrame && previousScene?.continuityFrame);
    const continuityUpload = anchor?.upload
      || (hasContinuity ? await this.#uploadContinuityFrame(previousScene.continuityFrame) : null);
    const job = this.buildWorkflow(project.settings.workflowId, {
      prompt,
      negativePrompt: scene.negativePrompt || DEFAULT_NEGATIVE,
      duration: scene.duration,
      resolution: project.settings.resolution,
      orientation: project.settings.orientation,
      quality: project.settings.quality,
      videoInputMode: continuityUpload ? "image" : "text",
      videoModelId: project.settings.videoModelId,
      seed,
    }, continuityUpload, [], []);
    job.metadata = {
      ...job.metadata,
      workflowId: "videoStudio:sequentialStory",
      workflowName: `Sequential Story · ${scene.index}/${project.scenes.length}`,
      generationType: "sequentialStoryScene",
      sequentialStoryId: project.id,
      sceneId: scene.id,
        sceneIndex: scene.index,
        sceneCount: project.scenes.length,
        anchorStatus: anchor.status,
        prompt,
      negativePrompt: scene.negativePrompt || DEFAULT_NEGATIVE,
      seed,
    };
    const queued = await this.queueJob(job, project.id);
    project = this.store.update(project.id, {
      status: "running",
      currentSceneIndex: sceneIndex,
      scenes: project.scenes.map((item) =>
        item.id === scene.id
          ? { ...item, status: "running", seed, generationId: queued.id, comfyPromptId: queued.promptId, error: null, updatedAt: now() }
          : item
      ),
      generationIds: [...new Set([...(project.generationIds || []), queued.id])],
      progress: Math.round((sceneIndex / Math.max(1, project.scenes.length)) * 100),
    });
    this.broadcast({ type: "sequential_story_updated", projectId: project.id, data: project });

    try {
      const generation = await this.#waitGeneration(queued.id);
      if (generation.status !== "completed" || !generation.videos?.length) {
        throw new Error(generation.error || "La scena non ha prodotto un video.");
      }
      const video = generation.videos.at(-1);
      const localVideo = this.#resolveOutput(video);
      if (!localVideo) throw new Error("Output video della scena non trovato su disco.");
      const continuity = await this.extractContinuityFrame(localVideo.path, {
        projectId: project.id,
        sceneIndex: scene.index,
        mode: project.settings.frameOffsetMode,
        offsetSeconds: project.settings.frameOffsetSeconds,
        bestFrameSelector: project.settings.bestFrameSelector,
        sampleCount: project.settings.bestFrameSampleCount,
        windowSeconds: project.settings.bestFrameWindowSeconds,
      });
      const identityReport = await this.verifySceneIdentity({
        project,
        scene,
        sceneIndex,
        videoPath: localVideo.path,
        anchor,
        continuity,
      });
      const purge = project.settings.purgeBetweenScenes
        ? await this.purgeComfyVram()
        : { requested: false, successful: false, method: "disabled", warning: null };
      project = this.store.require(project.id);
      const updated = this.store.update(project.id, {
        scenes: project.scenes.map((item) =>
          item.id === scene.id
            ? {
                ...item,
                status: "completed",
                outputVideo: video,
                continuityFrame: continuity.file,
                anchorFrame: anchor.file || null,
                anchorStatus: anchor.status,
                identityReport,
                error: null,
                updatedAt: now(),
              }
            : item
        ),
        purgeLog: [...(project.purgeLog || []), { sceneId: scene.id, ...purge, at: now() }],
        progress: Math.round(((sceneIndex + 1) / Math.max(1, project.scenes.length)) * 100),
      });
      this.broadcast({ type: "sequential_story_updated", projectId: project.id, data: updated });
      return updated;
    } catch (error) {
      project = this.store.require(project.id);
      const failed = this.store.update(project.id, {
        status: "failed",
        error: error.message,
        scenes: project.scenes.map((item) =>
          item.id === scene.id ? { ...item, status: "failed", error: error.message, updatedAt: now() } : item
        ),
      });
      this.broadcast({ type: "sequential_story_updated", projectId: project.id, data: failed });
      return failed;
    }
  }

  async generateAnchorFrame({ project, scene, sceneIndex, previousScene, prompt, seed }) {
    if (project.settings.anchorFrameMode === "disabled") {
      return { status: previousScene?.continuityFrame ? "continuity frame used" : "no anchor generator configured", upload: null, file: null };
    }
    if (!this.anchorFrameGenerator) {
      return { status: "anchor generator not configured", upload: null, file: null };
    }
    try {
      const result = await this.anchorFrameGenerator({
        project,
        scene,
        sceneIndex,
        previousScene,
        prompt,
        seed,
        previousFrame: previousScene?.continuityFrame || null,
        assetDirectory: this.store.sceneAssetDirectory(project.id),
      });
      if (!result?.upload) return { status: result?.status || "anchor generation unavailable", upload: null, file: result?.file || null };
      return {
        status: "anchor generated",
        upload: result.upload,
        file: result.file || null,
        generationId: result.generationId || null,
      };
    } catch (error) {
      return {
        status: "anchor generation failed; continuity frame fallback",
        upload: null,
        file: null,
        warning: error.message,
      };
    }
  }

  async verifySceneIdentity({ project, scene, sceneIndex, videoPath, anchor, continuity }) {
    if (project.settings.identityVerification === "disabled") {
      return { status: "disabled" };
    }
    if (!this.identityVerifier) {
      return this.verifyIdentityPerceptual({
        project,
        scene,
        sceneIndex,
        videoPath,
        referenceFrame: anchor?.file || continuity?.file || null,
        sampleCount: project.settings.identitySampleCount,
        threshold: project.settings.identityThreshold,
      });
    }
    try {
      return await this.identityVerifier({
        project,
        scene,
        sceneIndex,
        videoPath,
        anchor,
        continuity,
        sampleCount: project.settings.identitySampleCount,
        threshold: project.settings.identityThreshold,
        assetDirectory: this.store.sceneAssetDirectory(project.id),
      });
    } catch (error) {
      return { status: "failed", warning: error.message };
    }
  }

  async verifyIdentityPerceptual({
    project,
    sceneIndex,
    videoPath,
    referenceFrame,
    sampleCount = 6,
    threshold = 0.58,
  } = {}) {
    if (!referenceFrame?.path || !fs.existsSync(referenceFrame.path)) {
      return {
        status: "insufficient-reference",
        engine: "perceptual-pgm",
        warning: "Nessun anchor/continuity frame disponibile per verificare l'identità.",
      };
    }
    const assetDirectory = this.store.sceneAssetDirectory(project.id);
    const identityDirectory = path.join(assetDirectory, "identity", `scene-${String(sceneIndex + 1).padStart(2, "0")}`);
    fs.rmSync(identityDirectory, { recursive: true, force: true });
    fs.mkdirSync(identityDirectory, { recursive: true });
    const referencePgm = path.join(identityDirectory, "reference.pgm");
    await this.execFile("ffmpeg", [
      "-y",
      "-i", referenceFrame.path,
      "-vf", "scale=96:96:flags=bicubic,format=gray",
      referencePgm,
    ], { windowsHide: true, timeout: 60_000 });
    const samplePattern = path.join(identityDirectory, "sample-%03d.pgm");
    await this.execFile("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-vf", `fps=1,scale=96:96:flags=bicubic,format=gray`,
      "-frames:v", String(sampleCount),
      samplePattern,
    ], { windowsHide: true, timeout: 120_000 });
    const reference = fingerprintFromPgm(referencePgm);
    const samples = fs.readdirSync(identityDirectory)
      .filter((name) => /^sample-\d+\.pgm$/i.test(name))
      .sort()
      .map((name, index) => {
        const file = path.join(identityDirectory, name);
        return {
          index,
          file,
          similarity: cosineSimilarity(reference, fingerprintFromPgm(file)),
        };
      });
    if (!samples.length) {
      return {
        status: "failed",
        engine: "perceptual-pgm",
        warning: "Nessun frame campione estratto per identity verification.",
      };
    }
    const average = samples.reduce((sum, item) => sum + item.similarity, 0) / samples.length;
    const minimum = Math.min(...samples.map((item) => item.similarity));
    const driftFrames = samples.filter((item) => item.similarity < threshold).map((item) => item.index);
    return {
      status: driftFrames.length ? "drift-detected" : "passed",
      engine: "perceptual-pgm",
      threshold,
      averageSimilarity: Number(average.toFixed(4)),
      minSimilarity: Number(minimum.toFixed(4)),
      sampledFrames: samples.length,
      driftFrames,
      reference: {
        filename: referenceFrame.filename || path.basename(referenceFrame.path),
        type: referenceFrame.type || "reference",
      },
    };
  }

  async #waitGeneration(generationId) {
    const deadline = Date.now() + this.generationTimeoutMs;
    while (Date.now() < deadline) {
      const item = this.generationStore.get(generationId);
      if (item && !["queued", "running"].includes(item.status)) return item;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Timeout durante il render della scena Sequential Story.");
  }

  #resolveOutput(file) {
    return resolveMediaFile(this.outputDirectory, file);
  }

  async #uploadContinuityFrame(frame) {
    const fullPath = this.#safeAssetPath(frame.path);
    const buffer = fs.readFileSync(fullPath);
    return this.comfy.uploadImage({
      buffer,
      mimetype: "image/png",
      originalname: path.basename(fullPath),
      size: buffer.length,
    });
  }

  #safeAssetPath(filePath) {
    const base = path.resolve(this.store.assetDirectory);
    const full = path.resolve(String(filePath || ""));
    if (!full.startsWith(`${base}${path.sep}`) || !fs.existsSync(full)) {
      throw new Error("Path Sequential Story fuori storage.");
    }
    return full;
  }

  async extractContinuityFrame(videoPath, {
    projectId,
    sceneIndex,
    mode = "0.5",
    offsetSeconds = 0.5,
    bestFrameSelector = "offset",
    sampleCount = 18,
    windowSeconds = 1.25,
  } = {}) {
    const assetDirectory = this.store.sceneAssetDirectory(projectId);
    const output = path.join(assetDirectory, "frames", `scene-${String(sceneIndex).padStart(2, "0")}-continuity.png`);
    if (mode === "automatic" || bestFrameSelector === "smart") {
      const selected = await this.extractBestContinuityFrame(videoPath, {
        projectId,
        sceneIndex,
        sampleCount,
        windowSeconds,
        output,
      }).catch(() => null);
      if (selected) return selected;
    }
    const offset = mode === "0.25" ? 0.25 : offsetSeconds;
    const duration = await this.#probeDuration(videoPath).catch(() => null);
    const seek = duration ? Math.max(0, duration - offset) : 0;
    try {
      await this.execFile("ffmpeg", [
        "-y",
        "-ss", String(seek),
        "-i", videoPath,
        "-frames:v", "1",
        "-vf", "scale=iw:ih",
        output,
      ], { windowsHide: true, timeout: 120_000 });
    } catch {
      await this.execFile("ffmpeg", [
        "-y",
        "-sseof", "-0.1",
        "-i", videoPath,
        "-frames:v", "1",
        output,
      ], { windowsHide: true, timeout: 120_000 });
    }
    if (!fs.existsSync(output)) throw new Error("FFmpeg non ha estratto il continuity frame.");
    return {
      status: "working",
      mode: mode === "automatic" ? "offset-fallback" : "offset",
      offsetSeconds: offset,
      file: {
        path: output,
        filename: path.basename(output),
        type: "sequential-story-frame",
      },
    };
  }

  async extractBestContinuityFrame(videoPath, {
    projectId,
    sceneIndex,
    sampleCount = 18,
    windowSeconds = 1.25,
    output = null,
  } = {}) {
    const assetDirectory = this.store.sceneAssetDirectory(projectId);
    const framesDirectory = path.join(assetDirectory, "frames", `scene-${String(sceneIndex).padStart(2, "0")}-candidates`);
    fs.rmSync(framesDirectory, { recursive: true, force: true });
    fs.mkdirSync(framesDirectory, { recursive: true });
    const pattern = path.join(framesDirectory, "candidate-%03d.pgm");
    const fps = Math.max(1, Math.ceil(sampleCount / Math.max(0.25, windowSeconds)));
    await this.execFile("ffmpeg", [
      "-y",
      "-sseof", `-${windowSeconds}`,
      "-i", videoPath,
      "-vf", `fps=${fps},scale=320:-1:flags=bicubic,format=gray`,
      "-frames:v", String(sampleCount),
      pattern,
    ], { windowsHide: true, timeout: 120_000 });
    const candidates = fs.readdirSync(framesDirectory)
      .filter((name) => name.toLowerCase().endsWith(".pgm"))
      .sort()
      .map((name, index) => {
        const file = path.join(framesDirectory, name);
        return {
          index,
          file,
          ...frameMetrics(file),
        };
      });
    const selected = selectBestContinuityFrame({
      frames: candidates,
      criteria: { sharpness: true, faceStability: true, motionBlur: true, poseReadability: true },
    });
    if (!selected) throw new Error("Nessun candidato continuity frame valido.");
    const finalOutput = output || path.join(assetDirectory, "frames", `scene-${String(sceneIndex).padStart(2, "0")}-continuity.png`);
    await this.execFile("ffmpeg", [
      "-y",
      "-i", selected.file,
      finalOutput,
    ], { windowsHide: true, timeout: 60_000 });
    if (!fs.existsSync(finalOutput)) throw new Error("FFmpeg non ha salvato il best continuity frame.");
    return {
      status: "working",
      mode: "smart-best-frame",
      selectedIndex: selected.index,
      score: selected.score,
      metrics: {
        sharpness: selected.sharpness,
        contrast: selected.contrast,
        brightness: selected.brightness,
      },
      candidates: candidates.length,
      file: {
        path: finalOutput,
        filename: path.basename(finalOutput),
        type: "sequential-story-frame",
      },
    };
  }

  async #probeDuration(videoPath) {
    const { stdout } = await this.execFile("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ], { windowsHide: true, timeout: 60_000 });
    const duration = Number(stdout);
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  }

  async #probeMediaProfile(videoPath) {
    const { stdout } = await this.execFile("ffprobe", [
      "-v", "error",
      "-print_format", "json",
      "-show_streams",
      "-show_format",
      videoPath,
    ], { windowsHide: true, timeout: 60_000 });
    const parsed = JSON.parse(stdout || "{}");
    const video = (parsed.streams || []).find((stream) => stream.codec_type === "video") || {};
    const audio = (parsed.streams || []).find((stream) => stream.codec_type === "audio") || null;
    return {
      path: videoPath,
      width: Number(video.width || 0),
      height: Number(video.height || 0),
      fps: this.#fpsValue(video.avg_frame_rate || video.r_frame_rate),
      videoCodec: video.codec_name || "",
      pixelFormat: video.pix_fmt || "",
      hasAudio: Boolean(audio),
      audioCodec: audio?.codec_name || "",
    };
  }

  #fpsValue(value) {
    const text = String(value || "");
    if (text.includes("/")) {
      const [left, right] = text.split("/").map(Number);
      return right ? Number((left / right).toFixed(3)) : 0;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async inspectConcatClips(clips) {
    const profiles = [];
    for (const clip of clips) {
      try {
        profiles.push(await this.#probeMediaProfile(clip));
      } catch (error) {
        return {
          profiles,
          compatible: false,
          forceReencode: true,
          warning: `FFprobe non ha validato una clip: ${error.message}. Uso re-encode controllato.`,
        };
      }
    }
    const first = profiles[0];
    const compatible = profiles.every((profile) =>
      profile.width === first.width
      && profile.height === first.height
      && profile.fps === first.fps
      && profile.videoCodec === first.videoCodec
      && profile.pixelFormat === first.pixelFormat
      && profile.hasAudio === first.hasAudio
      && profile.audioCodec === first.audioCodec
    );
    return {
      profiles,
      compatible,
      forceReencode: !compatible,
      warning: compatible ? null : "Clip con width/height/fps/codec/audio diversi: uso re-encode controllato prima del finale.",
    };
  }

  async purgeComfyVram() {
    try {
      await this.comfy.free({ unloadModels: true, freeMemory: true });
      return { requested: true, successful: true, method: "ComfyUI /free unload_models+free_memory", warning: null };
    } catch (error) {
      return { requested: true, successful: false, method: "ComfyUI /free", warning: error.message };
    }
  }

  concatCommand(project, clips, output, diagnostics = {}) {
    const listFile = path.join(this.store.sceneAssetDirectory(project.id), "concat", "clips.txt");
    const listText = clips.map((clip) =>
      `file '${String(clip).replaceAll("'", "'\\''")}'`
    ).join("\n");
    fs.writeFileSync(listFile, `${listText}\n`);
    const audioMode = project.settings.audioMode || "per-scene";
    const audioArgs = audioMode === "mute" ? ["-an"] : ["-c:a", "aac"];
    const audioWarning = audioMode === "future-global"
      ? "Audio globale continuo non configurato: mantengo l'audio per scena quando disponibile."
      : null;
    if (project.settings.transition === "crossfade" || diagnostics.forceReencode) {
      return {
        listFile,
        args: ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "libx264", "-pix_fmt", "yuv420p", ...audioArgs, output],
        mode: project.settings.transition === "crossfade" ? "crossfade-fallback-reencode" : "direct-cut-reencode",
        warning: [
          project.settings.transition === "crossfade"
            ? "Crossfade video/audio avanzato non configurato: uso re-encode continuo senza transizione temporale."
            : null,
          diagnostics.warning,
          audioWarning,
        ].filter(Boolean).join(" "),
      };
    }
    return {
      listFile,
      args: audioMode === "mute"
        ? ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c:v", "copy", "-an", output]
        : ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", output],
      mode: "direct-cut",
      warning: audioWarning,
    };
  }

  async concatSequentialClips(projectId) {
    const project = this.store.require(projectId);
    const completed = project.scenes.filter((scene) => scene.status === "completed" && scene.outputVideo);
    if (!completed.length) throw new Error("Nessuna clip completata da concatenare.");
    const clips = completed.map((scene) => {
      const resolved = this.#resolveOutput(scene.outputVideo);
      if (!resolved) throw new Error(`Clip scena ${scene.index} non trovata su disco.`);
      return resolved.path;
    });
    const outputDirectory = path.join(this.outputDirectory, "SequentialStory", project.id);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const output = path.join(outputDirectory, "final.mp4");
    const diagnostics = await this.inspectConcatClips(clips);
    const command = this.concatCommand(project, clips, output, diagnostics);
    try {
      await this.execFile("ffmpeg", command.args, { windowsHide: true, timeout: 20 * 60_000 });
    } catch (error) {
      if (command.mode === "direct-cut") {
        const fallbackAudioArgs = project.settings.audioMode === "mute" ? ["-an"] : ["-c:a", "aac"];
        await this.execFile("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0", "-i", command.listFile,
          "-c:v", "libx264", "-pix_fmt", "yuv420p", ...fallbackAudioArgs, output,
        ], { windowsHide: true, timeout: 20 * 60_000 });
        command.mode = "direct-cut-reencode-fallback";
      } else {
        throw error;
      }
    }
    if (!fs.existsSync(output)) throw new Error("FFmpeg non ha creato il video finale.");
    const finalVideo = {
      filename: "final.mp4",
      subfolder: `SequentialStory/${project.id}`,
      type: "output",
    };
    return this.store.update(project.id, {
      finalVideo,
      concatMode: command.mode,
      concatWarning: command.warning || null,
    });
  }

  async reconcilePromptId(promptId) {
    const payload = await this.comfy.history(promptId);
    const entry = payload?.[promptId];
    return entry ? extractVideos(entry) : [];
  }
}
