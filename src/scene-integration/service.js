import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeSceneFile, compareSceneImages, verifyAnalysisRuntime } from "./analysis-runner.js";
import { sceneCacheKey, SceneProfileCache } from "./cache.js";
import {
  DEFAULT_SCENE_INTEGRATION_SETTINGS,
  SCENE_INTEGRATION_PRESETS,
  sceneIntegrationSettings,
} from "./defaults.js";
import { SceneProfileStore } from "./profile-store.js";
import { assertSceneProfile, normalizeSceneProfile, validateSceneProfile } from "./schema.js";

function safeExtension(filename, mediaType) {
  const extension = path.extname(filename || "").toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(extension)) return extension;
  return mediaType === "video" ? ".mp4" : ".png";
}

export class SceneIntegrationService {
  constructor({ root, dataDirectory, enabled = false, python }) {
    this.root = root;
    this.enabled = enabled;
    this.python = python;
    this.baseDirectory = path.join(dataDirectory, "scene-integration");
    this.profileStore = new SceneProfileStore(path.join(this.baseDirectory, "profiles"));
    this.cache = new SceneProfileCache(path.join(this.baseDirectory, "cache"));
    this.artifactDirectory = path.join(this.baseDirectory, "artifacts");
    this.sourceDirectory = path.join(this.baseDirectory, "sources");
    fs.mkdirSync(this.artifactDirectory, { recursive: true });
    fs.mkdirSync(this.sourceDirectory, { recursive: true });
  }

  async capabilities() {
    const runtime = await verifyAnalysisRuntime(this.root, this.python);
    return {
      enabled: this.enabled,
      experimental: true,
      runtime,
      presets: Object.values(SCENE_INTEGRATION_PRESETS),
      defaults: DEFAULT_SCENE_INTEGRATION_SETTINGS,
      optionalDependencies: [
        {
          id: "insightface-buffalo_sc",
          installed: fs.existsSync(path.join(
            os.homedir(),
            ".insightface",
            "models",
            "buffalo_sc",
            "w600k_mbf.onnx",
          )),
          required: false,
          description: "Embedding facciali locali per la metrica di conservazione identità.",
        },
        {
          id: "raft-unimatch",
          installed: false,
          required: false,
          description: "Optical flow neurale; Farneback resta il fallback locale.",
        },
        {
          id: "dedicated-relighting",
          installed: false,
          required: false,
          description: "Relighting fisico; il fallback usa armonizzazione locale.",
        },
      ],
    };
  }

  requireEnabled() {
    if (!this.enabled) {
      const error = new Error("Scene Integration non è abilitato sul server.");
      error.statusCode = 503;
      throw error;
    }
  }

  async analyzeBuffer(file, rawSettings = {}) {
    this.requireEnabled();
    if (!file?.buffer?.length) {
      const error = new Error("Carica un’immagine o un video da analizzare.");
      error.statusCode = 400;
      throw error;
    }
    const mediaType = file.mimetype?.startsWith("video/") ? "video" : "image";
    const settings = sceneIntegrationSettings({ ...rawSettings, enabled: true });
    const cacheKey = sceneCacheKey(file.buffer, {
      mediaType,
      ...settings,
    });
    if (settings.reuseAnalysis) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        const profile = assertSceneProfile(cached);
        const extension = profile.sourceMetadata?.storedExtension
          || safeExtension(file.originalname, mediaType);
        const sourceFile = path.join(this.sourceDirectory, `${profile.id}${extension}`);
        if (!fs.existsSync(sourceFile)) fs.writeFileSync(sourceFile, file.buffer);
        return { profile, cached: true };
      }
    }

    const id = crypto.randomUUID();
    const artifactDirectory = path.join(this.artifactDirectory, id);
    const tempFile = path.join(
      os.tmpdir(),
      `comfy-remote-source-${id}${safeExtension(file.originalname, mediaType)}`,
    );
    fs.writeFileSync(tempFile, file.buffer);
    try {
      const analysis = await analyzeSceneFile({
        root: this.root,
        sourceFile: tempFile,
        mediaType,
        settings,
        artifactDirectory: settings.debugArtifacts ? artifactDirectory : null,
        python: this.python,
      });
      const profile = normalizeSceneProfile({
        ...analysis,
        id,
        cacheKey,
        version: "1.0.0",
        mediaType,
        createdAt: new Date().toISOString(),
        sourceMetadata: {
          ...(analysis.sourceMetadata || {}),
          originalName: file.originalname,
          mimeType: file.mimetype,
          byteLength: file.buffer.length,
          sha256: crypto.createHash("sha256").update(file.buffer).digest("hex"),
          storedExtension: safeExtension(file.originalname, mediaType),
        },
        analysisSettings: settings,
      }, { id, cacheKey });
      this.profileStore.save(profile);
      this.cache.put(cacheKey, profile);
      fs.writeFileSync(
        path.join(this.sourceDirectory, `${id}${profile.sourceMetadata.storedExtension}`),
        file.buffer,
      );
      return { profile, cached: false };
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Best effort.
      }
    }
  }

  sourceFile(profileId) {
    const profile = this.getProfile(profileId);
    const extension = profile.sourceMetadata?.storedExtension;
    if (!extension) return null;
    const file = path.join(this.sourceDirectory, `${profile.id}${extension}`);
    return fs.existsSync(file) ? file : null;
  }

  async evaluateImage(profileId, resultFile, maskFile = null) {
    const profile = this.getProfile(profileId);
    const source = this.sourceFile(profileId);
    if (!source) throw new Error("La sorgente originale del Scene Profile non è più disponibile.");
    return compareSceneImages({
      root: this.root,
      sourceFile: source,
      resultFile,
      maskFile,
      artifactDirectory: profile.analysisSettings?.debugArtifacts
        ? path.join(this.artifactDirectory, profileId)
        : null,
      python: this.python,
    });
  }

  async analyzeResultFile(profileId, resultFile) {
    const sourceProfile = this.getProfile(profileId);
    const settings = sceneIntegrationSettings({
      ...sourceProfile.analysisSettings,
      enabled: true,
      reuseAnalysis: false,
      debugArtifacts: false,
    });
    const analysis = await analyzeSceneFile({
      root: this.root,
      sourceFile: resultFile,
      mediaType: sourceProfile.mediaType,
      settings,
      artifactDirectory: null,
      python: this.python,
    });
    const resultProfile = normalizeSceneProfile({
      ...analysis,
      id: `result-${crypto.randomUUID()}`,
      mediaType: sourceProfile.mediaType,
      version: sourceProfile.version,
      createdAt: new Date().toISOString(),
      analysisSettings: settings,
    });
    let comparison = { metrics: {} };
    if (sourceProfile.mediaType === "image") {
      comparison = await this.evaluateImage(profileId, resultFile);
    } else {
      const sourceMotion = sourceProfile.temporalProfile?.cameraMotion?.value;
      const resultMotion = resultProfile.temporalProfile?.cameraMotion?.value;
      if (sourceMotion && resultMotion) {
        const difference = Math.hypot(
          Number(sourceMotion.x || 0) - Number(resultMotion.x || 0),
          Number(sourceMotion.y || 0) - Number(resultMotion.y || 0),
        );
        comparison.metrics.temporalConsistency = {
          score: Math.max(0, Math.min(100, 100 - difference * 8)),
          confidence: Math.min(
            sourceProfile.temporalProfile?.cameraMotion?.confidence || 0,
            resultProfile.temporalProfile?.cameraMotion?.confidence || 0,
          ),
          method: "sampled-camera-flow-difference",
        };
      }
    }
    return {
      sourceProfile,
      resultProfile,
      suppliedMetrics: comparison.metrics,
      evaluationArtifacts: comparison.artifacts || {},
    };
  }

  getProfile(id) {
    this.requireEnabled();
    const profile = this.profileStore.get(id);
    if (!profile) {
      const error = new Error("Scene Profile non trovato.");
      error.statusCode = 404;
      throw error;
    }
    return profile;
  }

  importProfile(raw) {
    this.requireEnabled();
    const issues = validateSceneProfile(raw);
    if (issues.length) {
      const error = new Error(`Scene Profile importato non valido: ${issues.join(" ")}`);
      error.statusCode = 400;
      throw error;
    }
    return this.profileStore.import(raw, crypto.randomUUID());
  }

  updateProfile(profile) {
    const saved = this.profileStore.save(profile);
    if (saved.cacheKey) this.cache.put(saved.cacheKey, saved);
    return saved;
  }

  attachArtifact(profileId, key, buffer, filename, patch = {}) {
    const profile = this.getProfile(profileId);
    const extension = safeExtension(filename, "image");
    const directory = path.join(this.artifactDirectory, profileId);
    fs.mkdirSync(directory, { recursive: true });
    const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, "_");
    const artifactName = `${safeKey}${extension}`;
    fs.writeFileSync(path.join(directory, artifactName), buffer);
    const next = normalizeSceneProfile({
      ...profile,
      artifacts: {
        ...profile.artifacts,
        [key]: artifactName,
      },
      ...patch,
    });
    return this.updateProfile(next);
  }

  artifact(profileId, name) {
    this.requireEnabled();
    if (!/^[a-zA-Z0-9._-]+$/.test(String(name))) return null;
    const directory = path.resolve(this.artifactDirectory, String(profileId));
    const file = path.resolve(directory, String(name));
    if (!file.startsWith(`${directory}${path.sep}`) || !fs.existsSync(file)) return null;
    return file;
  }

  artifactFile(profileId, key) {
    const profile = this.getProfile(profileId);
    const name = profile.artifacts?.[key];
    return name ? this.artifact(profileId, name) : null;
  }
}
