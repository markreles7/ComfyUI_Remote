import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildAudioAnalysis } from "./audio-analysis.js";
import {
  audioTaskReadiness,
  mixDialogueAudioTasks,
  prepareDialogueAudioTasks,
} from "./audio-remix.js";
import { buildOriginalActorReferencePack, detectActorTracks } from "./actor-tracking.js";
import { interactiveCastCapabilities } from "./capabilities.js";
import {
  concatReadySegments,
  applyMaskedCompositeSegment,
  compositingPlanFallback,
  finalSpliceReadiness,
  prepareMissingSegmentTasks,
  prepareOriginalSegments,
} from "./compositor.js";
import {
  applyLipSync,
  LipSyncEngineNotConfiguredError,
  lipSyncTaskReadiness,
  prepareLipSyncTasks,
} from "./lipsync-engine.js";
import { verifySegmentIdentity } from "./identity-check.js";
import { cutVideoSegment, muxAudioIntoVideo } from "./ffmpeg.js";
import { renderPackageCacheKey, stageStatus } from "./pipeline-state.js";
import { buildInteractiveCastPlan } from "./planner.js";
import { detectSceneCuts, extractVideoArtifacts, probeVideo } from "./video-analysis.js";
import { synthesizeDialogue, VoiceEngineNotConfiguredError } from "./voice-engine.js";

function renderPackageFilesExist(renderPackage = {}) {
  const originalSegmentsReady = (renderPackage.segments || [])
    .filter((segment) => !segment.requiredGenerated)
    .every((segment) => segment.path && fs.existsSync(segment.path));
  const sourceClipsReady = (renderPackage.segments || [])
    .filter((segment) => segment.requiredGenerated && segment.sourceClipPath)
    .every((segment) => fs.existsSync(segment.sourceClipPath));
  const anchorsReady = (renderPackage.segmentTasks?.tasks || [])
    .filter((task) => task.anchorFrame?.path)
    .every((task) => fs.existsSync(task.anchorFrame.path));
  return originalSegmentsReady && sourceClipsReady && anchorsReady;
}

function characterPackReferenceSummary({ actor = {}, character = null }) {
  if (!character) {
    return {
      actorId: actor.actorId,
      type: actor.type || "characterPack",
      name: actor.name || "New Actor",
      unavailable: true,
      warning: "Character Pack non trovato nel Character Store.",
    };
  }
  const references = Array.isArray(character.references)
    ? character.references.filter((reference) => reference.status !== "rejected")
    : [];
  const pack = character.characterPack || {};
  const settings = character.settings || {};
  return {
    actorId: actor.actorId || `character:${character.id}`,
    characterId: character.id,
    type: "characterPack",
    name: character.name || actor.name || "New Actor",
    description: character.description || "",
    identityHints: {
      face: character.identityHints?.face || "",
      hair: character.identityHints?.hair || "",
      body: character.identityHints?.body || "",
    },
    wardrobe: Array.isArray(character.wardrobe) ? character.wardrobe : [],
    locks: {
      face: Boolean(settings.lockFace),
      hair: Boolean(settings.lockHair),
      body: Boolean(settings.lockBody),
      outfit: Boolean(settings.lockOutfit),
    },
    identityStrength: settings.identityStrength || "medium",
    characterPack: {
      status: pack.status || "Needs references",
      heroImage: pack.heroImage || character.heroImage || null,
      sheet: pack.sheet || character.sheet || null,
      referenceCount: references.length,
      workflowRefs: Array.isArray(pack.workflowRefs) ? pack.workflowRefs.slice(0, 6) : [],
      faceRefs: Array.isArray(pack.faceRefs) ? pack.faceRefs.slice(0, 6) : [],
      bodyRefs: Array.isArray(pack.bodyRefs) ? pack.bodyRefs.slice(0, 6) : [],
    },
  };
}

function temporaryActorReferenceSummary(actor = {}) {
  return {
    actorId: actor.actorId || "new-actor-1",
    type: "temporaryReference",
    name: actor.name || "New Actor",
    reference: actor.reference
      ? {
          filename: actor.reference.filename || actor.reference.originalName || "reference",
          originalName: actor.reference.originalName || actor.reference.filename || "reference",
          relativePath: actor.reference.relativePath || null,
          mimeType: actor.reference.mimeType || actor.reference.mimetype || "image/*",
          size: actor.reference.size || 0,
        }
      : null,
    description: "Temporary project-only actor reference. Use it as the visual identity for the inserted actor.",
    identityHints: {},
    wardrobe: [],
    locks: {
      face: true,
      hair: true,
      body: true,
      outfit: false,
    },
    identityStrength: "medium",
  };
}

function normalizeAnchorWorkflowId(value) {
  const id = String(value || "").trim();
  return ["qwen-image-edit", "qwen-krea-klein", "krea-triple"].includes(id)
    ? id
    : "qwen-image-edit";
}

export class InteractiveCastOrchestrator {
  constructor({ root, store, characterStore }) {
    this.root = root;
    this.store = store;
    this.characterStore = characterStore;
  }

  capabilities() {
    return interactiveCastCapabilities({ root: this.root });
  }

  list() {
    return this.store.list();
  }

  get(id) {
    const project = this.store.get(id);
    if (!project) throw new Error("Progetto Interactive Cast non trovato.");
    return project;
  }

  delete(id) {
    const project = this.get(id);
    const base = path.resolve(this.store.assetDirectory);
    const projectDirectory = path.resolve(base, String(id));
    if (!projectDirectory.startsWith(`${base}${path.sep}`)) {
      throw new Error("Interactive Cast asset path non valido.");
    }
    this.store.delete(id);
    fs.rmSync(projectDirectory, { recursive: true, force: true });
    return project;
  }

  actorReferenceSummaries(project) {
    return (project.actors?.added || []).map((actor) => {
      if (actor.type === "characterPack") {
        const characterId = String(actor.actorId || "").replace(/^character:/, "");
        let character = null;
        try {
          character = this.characterStore?.getCharacter(characterId) || null;
        } catch {
          character = null;
        }
        return characterPackReferenceSummary({ actor, character });
      }
      return temporaryActorReferenceSummary(actor);
    });
  }

  async create({ file, temporaryActorReference = null, raw = {} }) {
    if (!file?.mimetype?.startsWith("video/")) throw new Error("Interactive Cast richiede un video sorgente.");
    if (temporaryActorReference && !temporaryActorReference.mimetype?.startsWith("image/")) {
      throw new Error("La reference temporanea del nuovo attore deve essere un'immagine.");
    }
    const id = crypto.randomUUID();
    const sourceVideo = this.store.writeUpload(id, file, "sourceVideo");
    const newActorReference = temporaryActorReference
      ? this.store.writeTemporaryActorReference(id, temporaryActorReference)
      : null;
    const analysis = await probeVideo(sourceVideo.path);
    const assetDirectory = this.store.projectAssetDirectory(id);
    const [sceneCuts, artifacts] = await Promise.all([
      detectSceneCuts(sourceVideo.path, analysis),
      extractVideoArtifacts({
        input: sourceVideo.path,
        analysis,
        directory: assetDirectory,
      }),
    ]);
    const tracks = await detectActorTracks({
      root: this.root,
      videoPath: sourceVideo.path,
      analysis,
      outputDirectory: path.join(assetDirectory, "originalActors"),
    });
    const originalActors = tracks.actors.map((actor) => ({
      ...actor,
      referencePack: buildOriginalActorReferencePack({
        actor,
        frames: artifacts.frames,
      }),
    }));
    const audioAnalysis = await buildAudioAnalysis({
      analysis,
      sourceAudio: artifacts.audio,
      projectDirectory: assetDirectory,
    });
    const project = {
      id,
      type: "interactiveCast",
      title: String(raw.title || raw.projectName || "Interactive Cast").trim(),
      status: "analyzed",
      sourceVideo,
      analysis,
      sceneCuts,
      artifacts,
      actors: {
        original: originalActors,
        added: newActorReference ? [{
          actorId: "new-actor-1",
          type: "temporaryReference",
          name: String(raw.newActorName || "New Actor").trim(),
          reference: newActorReference,
        }] : [],
      },
      audioAnalysis,
      dialogueEvents: [],
      editWindows: [],
      outputs: {},
      stages: {
        analysis: { status: "completed", updatedAt: new Date().toISOString() },
        tracking: {
          status: tracks.configured ? "completed" : "fallback",
          updatedAt: new Date().toISOString(),
          engine: tracks.engine,
          actorCount: tracks.actors.length,
        },
        audioExtraction: {
          status: artifacts.audio?.error ? "failed" : "completed",
          updatedAt: new Date().toISOString(),
          error: artifacts.audio?.error || null,
        },
        sourceSeparation: {
          status: audioAnalysis.sourceSeparation === "FALLBACK" ? "fallback" : "notConfigured",
          updatedAt: new Date().toISOString(),
          method: audioAnalysis.sourceSeparation,
        },
      },
      warnings: [
        ...tracks.warnings,
        ...(audioAnalysis.warnings || []),
        ...(artifacts.audio?.error ? [`Audio extraction failed: ${artifacts.audio.error}`] : []),
        ...artifacts.frames.filter((frame) => frame.error).map((frame) => `Frame extraction failed at ${frame.time}s: ${frame.error}`),
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.store.add(project);
  }

  plan(id, raw = {}) {
    const project = this.get(id);
    const addedCharacterId = String(raw.addedCharacterId || "").trim();
    const originalLabels = Array.isArray(raw.originalActors)
      ? raw.originalActors
      : [];
    const originalActors = (project.actors?.original || []).map((actor, index) => {
      const override = originalLabels.find((item) => item.actorId === actor.actorId) || originalLabels[index] || {};
      return {
        ...actor,
        label: String(override.label || override.name || actor.label || `Original Actor ${index + 1}`).trim(),
        role: String(override.role || actor.role || "").trim(),
      };
    });
    const added = addedCharacterId
      ? [{
          actorId: `character:${addedCharacterId}`,
          type: "characterPack",
          name: this.characterStore?.getCharacter(addedCharacterId)?.name || "New Actor",
        }]
      : (project.actors?.added?.length ? project.actors.added : [{
          actorId: "new-actor-1",
          type: "temporaryReference",
          name: String(raw.newActorName || "New Actor").trim(),
        }]).map((actor) => ({
          ...actor,
          name: String(raw.newActorName || actor.name || "New Actor").trim(),
        }));
    const planned = {
      ...project,
      actors: {
        ...(project.actors || {}),
        original: originalActors,
        added,
      },
      dialogueEvents: raw.dialogueEvents || project.dialogueEvents || [],
    };
    const scenePlan = buildInteractiveCastPlan({ project: planned, raw });
    const compositing = compositingPlanFallback(scenePlan);
    const updated = this.store.update(id, {
      settings: {
        ...(project.settings || {}),
        anchorWorkflowId: normalizeAnchorWorkflowId(raw.anchorWorkflowId || project.settings?.anchorWorkflowId),
      },
      actors: scenePlan.actors,
      dialogueEvents: scenePlan.dialogueEvents,
      editWindows: scenePlan.editWindows,
      compositing,
      scenePlan,
      stages: stageStatus(project, "planning", "completed", {
        editWindowCount: scenePlan.editWindows.length,
        dialogueEventCount: scenePlan.dialogueEvents.length,
      }),
      status: "planned",
      updatedAt: new Date().toISOString(),
    });
    return updated;
  }

  updateOriginalActors(id, rawActors = []) {
    const project = this.get(id);
    const updates = Array.isArray(rawActors) ? rawActors : [];
    const original = (project.actors?.original || []).map((actor, index) => {
      const update = updates.find((item) => item.actorId === actor.actorId) || updates[index] || {};
      return {
        ...actor,
        label: String(update.label || update.name || actor.label || `Original Actor ${index + 1}`).trim(),
        role: String(update.role || actor.role || "").trim(),
        notes: String(update.notes || actor.notes || "").trim(),
      };
    });
    return this.store.update(id, {
      actors: {
        ...(project.actors || {}),
        original,
      },
      updatedAt: new Date().toISOString(),
    });
  }

  updateSpeakerAssignments(id, rawSpeakers = []) {
    const project = this.get(id);
    const updates = Array.isArray(rawSpeakers) ? rawSpeakers : [];
    const duration = Number(project.analysis?.duration || 0) || 3600;
    const speakers = updates.map((speaker, index) => {
      const start = Math.max(0, Math.min(duration, Number(speaker.start) || 0));
      const end = Math.max(start, Math.min(duration, Number(speaker.end) || duration));
      return {
        speaker: String(speaker.speaker || `SPEAKER_${String(index).padStart(2, "0")}`).trim(),
        label: String(speaker.label || speaker.speaker || `Speaker ${index + 1}`).trim(),
        assignedActorId: String(speaker.assignedActorId || "").trim(),
        start,
        end,
        confidence: Number.isFinite(Number(speaker.confidence)) ? Number(speaker.confidence) : 0,
        method: speaker.method || "manual-speaker-window",
        editable: true,
      };
    }).filter((speaker) => speaker.end > speaker.start);
    return this.store.update(id, {
      audioAnalysis: {
        ...(project.audioAnalysis || {}),
        diarization: speakers.length ? "FALLBACK" : project.audioAnalysis?.diarization || "NOT CONFIGURED",
        speakers,
      },
      stages: stageStatus(project, "speakerDiarization", speakers.length ? "fallback" : "notConfigured", {
        speakerCount: speakers.length,
      }),
      updatedAt: new Date().toISOString(),
    });
  }

  async prepareSegments(id) {
    const project = this.get(id);
    if (!project.editWindows?.length) {
      throw new Error("Crea prima il piano Interactive Cast con gli interventi timeline.");
    }
    const actorReferences = this.actorReferenceSummaries(project);
    const cacheKey = renderPackageCacheKey(project, { actorReferences });
    if (project.renderPackage?.cacheKey === cacheKey && renderPackageFilesExist(project.renderPackage)) {
      return this.store.update(id, {
        stages: stageStatus(project, "segmentPreparation", "cached", {
          cacheKey,
          segmentCount: project.renderPackage.segments?.length || 0,
        }),
        updatedAt: new Date().toISOString(),
      });
    }
    this.store.update(id, {
      stages: stageStatus(project, "segmentPreparation", "running", { cacheKey }),
      updatedAt: new Date().toISOString(),
    });
    const projectDirectory = this.store.projectAssetDirectory(id);
    try {
      const prepared = await prepareOriginalSegments({
        sourceVideo: project.sourceVideo.path,
        editWindows: project.editWindows,
        projectDirectory,
      });
      const segmentTasks = await prepareMissingSegmentTasks({
        sourceVideo: project.sourceVideo.path,
        segments: prepared.segments,
        projectDirectory,
        actorReferences,
        anchorWorkflowId: project.settings?.anchorWorkflowId,
      });
      const audioTasks = await prepareDialogueAudioTasks({
        sourceAudio: project.artifacts?.audio,
        dialogueEvents: project.dialogueEvents || [],
        speakers: project.audioAnalysis?.speakers || [],
        projectDirectory,
      });
      const lipSyncTasks = prepareLipSyncTasks({
        segments: prepared.segments,
        dialogueEvents: project.dialogueEvents || [],
        audioTasks: audioTasks.tasks,
      });
      const renderPackage = {
        status: prepared.readiness.ready ? "readyToConcat" : "waitingForAiSegments",
        cacheKey,
        segmentDirectory: prepared.segmentDirectory,
        segments: prepared.segments,
        readiness: prepared.readiness,
        segmentTasks,
        audioTasks,
        lipSyncTasks,
        preparedAt: new Date().toISOString(),
      };
      const latest = this.get(id);
      return this.store.update(id, {
        renderPackage,
        stages: stageStatus(latest, "segmentPreparation", "completed", {
          cacheKey,
          segmentCount: prepared.segments.length,
          missingSegmentCount: prepared.readiness.missing.length,
        }),
        status: prepared.readiness.ready ? "segmentsReady" : "segmentsPrepared",
        outputs: {
          ...(project.outputs || {}),
          renderPackage: {
            status: renderPackage.status,
            segmentCount: prepared.segments.length,
            missingSegmentCount: prepared.readiness.missing.length,
            missingAudioCount: audioTasks.readiness.missing.length,
            missingLipSyncCount: lipSyncTasks.readiness.missing.length,
          },
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.get(id);
      this.store.update(id, {
        stages: stageStatus(latest, "segmentPreparation", "failed", {
          cacheKey,
          error: error.message,
        }),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  spliceReadiness(id) {
    const project = this.get(id);
    return finalSpliceReadiness(project.renderPackage?.segments || []);
  }

  updateSegmentGeneration(id, segmentId, generation = {}) {
    const project = this.get(id);
    const tasks = project.renderPackage?.segmentTasks?.tasks || [];
    if (!tasks.some((task) => task.segmentId === segmentId)) {
      throw new Error("Task generativo Interactive Cast non trovato.");
    }
    const nextTasks = tasks.map((task) => task.segmentId === segmentId
      ? {
          ...task,
          generation: {
            ...(task.generation || {}),
            ...generation,
            updatedAt: new Date().toISOString(),
          },
        }
      : task);
    const latestStatus = generation.status === "failed" ? "failed" : "running";
    return this.store.update(id, {
      renderPackage: {
        ...project.renderPackage,
        segmentTasks: {
          ...project.renderPackage.segmentTasks,
          tasks: nextTasks,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date().toISOString(),
      },
      stages: stageStatus(project, "segmentGeneration", latestStatus, {
        segmentId,
        phase: generation.phase || null,
        generationId: generation.generationId || null,
        error: generation.error || null,
      }),
      updatedAt: new Date().toISOString(),
    });
  }

  async attachGeneratedSegment(id, segmentId, generated = {}) {
    if (!generated.path || !fs.existsSync(generated.path)) {
      throw new Error("Output LTX del segmento Interactive Cast non trovato.");
    }
    const project = this.get(id);
    const segment = (project.renderPackage?.segments || []).find((item) => item.id === segmentId);
    if (!segment?.requiredGenerated) throw new Error("Finestra generativa Interactive Cast non valida.");
    const duration = Math.max(0.04, Number(segment.end || 0) - Number(segment.start || 0));
    const normalizedDirectory = path.join(this.store.projectAssetDirectory(id), "generated-normalized");
    fs.mkdirSync(normalizedDirectory, { recursive: true });
    const normalizedPath = path.join(normalizedDirectory, `${segmentId.replace(/[^\w-]+/g, "_")}.mp4`);
    await cutVideoSegment({
      input: generated.path,
      output: normalizedPath,
      start: 0,
      end: duration,
    });
    const file = {
      buffer: fs.readFileSync(normalizedPath),
      originalname: generated.originalName || `${segmentId}-ltx.mp4`,
      mimetype: generated.mimeType || "video/mp4",
    };
    file.size = file.buffer.length;
    this.attachReplacementSegment(id, segmentId, file);
    const latest = this.get(id);
    const tasks = latest.renderPackage?.segmentTasks?.tasks || [];
    const nextTasks = tasks.map((task) => task.segmentId === segmentId
      ? {
          ...task,
          generation: {
            ...(task.generation || {}),
            status: "completed",
            phase: "video",
            generationId: generated.generationId || task.generation?.generationId || null,
            engine: "LTX 2.3 I2V",
            updatedAt: new Date().toISOString(),
          },
        }
      : task);
    return this.store.update(id, {
      renderPackage: {
        ...latest.renderPackage,
        segmentTasks: {
          ...latest.renderPackage.segmentTasks,
          tasks: nextTasks,
          updatedAt: new Date().toISOString(),
        },
      },
      stages: stageStatus(latest, "segmentGeneration", "completed", {
        segmentId,
        generationId: generated.generationId || null,
      }),
      updatedAt: new Date().toISOString(),
    });
  }

  attachReplacementSegment(id, segmentId, file) {
    if (!file?.mimetype?.startsWith("video/")) {
      throw new Error("Il segmento sostitutivo deve essere un video.");
    }
    const project = this.get(id);
    const segments = project.renderPackage?.segments || [];
    if (!segments.length) throw new Error("Prepara prima i segmenti Interactive Cast.");
    const index = segments.findIndex((segment) => segment.id === segmentId);
    if (index < 0) throw new Error("Segmento Interactive Cast non trovato.");
    if (!segments[index].requiredGenerated) {
      throw new Error("Questo segmento è originale e non richiede un sostituto AI.");
    }
    const replacement = this.store.writeSegmentReplacement(id, segmentId, file);
    const nextSegments = segments.map((segment, segmentIndex) => segmentIndex === index
      ? {
          ...segment,
          replacementPath: replacement.path,
          replacementRelativePath: replacement.relativePath,
          replacement,
          source: "replacement-upload",
          status: "ready",
        }
      : segment);
    const readiness = finalSpliceReadiness(nextSegments);
    const lipSyncTasks = project.renderPackage?.lipSyncTasks
      ? {
          ...project.renderPackage.lipSyncTasks,
          tasks: (project.renderPackage.lipSyncTasks.tasks || []).map((task) => task.segmentId === segmentId
            ? {
                ...task,
                status: "ready",
                replacementPath: replacement.path,
                replacementRelativePath: replacement.relativePath,
              }
            : task),
          updatedAt: new Date().toISOString(),
        }
      : null;
    if (lipSyncTasks) {
      lipSyncTasks.readiness = lipSyncTaskReadiness(lipSyncTasks.tasks);
      lipSyncTasks.status = lipSyncTasks.readiness.ready ? "ready" : "waitingForLipSyncSegments";
    }
    const renderPackage = {
      ...project.renderPackage,
      segments: nextSegments,
      readiness,
      ...(lipSyncTasks ? { lipSyncTasks } : {}),
      status: readiness.ready ? "readyToConcat" : "waitingForAiSegments",
      updatedAt: new Date().toISOString(),
    };
    return this.store.update(id, {
      renderPackage,
      status: readiness.ready ? "segmentsReady" : "segmentsPrepared",
      outputs: {
        ...(project.outputs || {}),
        renderPackage: {
          status: renderPackage.status,
          segmentCount: nextSegments.length,
          missingSegmentCount: readiness.missing.length,
          missingAudioCount: project.renderPackage?.audioTasks?.readiness?.missing?.length || 0,
          missingLipSyncCount: lipSyncTasks?.readiness?.missing?.length || project.renderPackage?.lipSyncTasks?.readiness?.missing?.length || 0,
        },
      },
      updatedAt: new Date().toISOString(),
    });
  }

  attachDialogueAudio(id, eventId, file) {
    if (!file?.mimetype?.startsWith("audio/")) {
      throw new Error("La battuta sintetizzata deve essere un file audio.");
    }
    const project = this.get(id);
    const tasks = project.renderPackage?.audioTasks?.tasks || [];
    if (!tasks.length) throw new Error("Prepara prima i segmenti Interactive Cast.");
    const index = tasks.findIndex((task) => task.eventId === eventId || task.sourceEventId === eventId);
    if (index < 0) throw new Error("Task audio Interactive Cast non trovato.");
    const replacement = this.store.writeDialogueAudio(id, eventId, file);
    const nextTasks = tasks.map((task, taskIndex) => taskIndex === index
      ? {
          ...task,
          replacementPath: replacement.path,
          replacementRelativePath: replacement.relativePath,
          replacement,
          status: "ready",
        }
      : task);
    const audioReadiness = audioTaskReadiness(nextTasks);
    const lipSyncTasks = project.renderPackage?.lipSyncTasks
      ? {
          ...project.renderPackage.lipSyncTasks,
          tasks: (project.renderPackage.lipSyncTasks.tasks || []).map((task) =>
            task.eventId === eventId || task.sourceEventId === eventId
              ? {
                  ...task,
                  dialogueAudioPath: replacement.path,
                  dialogueAudioRelativePath: replacement.relativePath,
                }
              : task
          ),
          updatedAt: new Date().toISOString(),
        }
      : null;
    if (lipSyncTasks) {
      lipSyncTasks.readiness = lipSyncTaskReadiness(lipSyncTasks.tasks);
      lipSyncTasks.status = lipSyncTasks.readiness.ready ? "ready" : "waitingForLipSyncSegments";
    }
    const renderPackage = {
      ...project.renderPackage,
      audioTasks: {
        ...project.renderPackage.audioTasks,
        tasks: nextTasks,
        readiness: audioReadiness,
        updatedAt: new Date().toISOString(),
      },
      ...(lipSyncTasks ? { lipSyncTasks } : {}),
      updatedAt: new Date().toISOString(),
    };
    return this.store.update(id, {
      renderPackage,
      outputs: {
        ...(project.outputs || {}),
        renderPackage: {
          status: renderPackage.status,
          segmentCount: renderPackage.segments?.length || 0,
          missingSegmentCount: renderPackage.readiness?.missing?.length || 0,
          missingAudioCount: audioReadiness.missing.length,
          missingLipSyncCount: lipSyncTasks?.readiness?.missing?.length || renderPackage.lipSyncTasks?.readiness?.missing?.length || 0,
        },
      },
      updatedAt: new Date().toISOString(),
    });
  }

  async synthesizeDialogueAudio(id, eventId, raw = {}) {
    const project = this.get(id);
    const tasks = project.renderPackage?.audioTasks?.tasks || [];
    if (!tasks.length) throw new Error("Prepara prima i segmenti Interactive Cast.");
    const index = tasks.findIndex((task) => task.eventId === eventId || task.sourceEventId === eventId);
    if (index < 0) throw new Error("Task audio Interactive Cast non trovato.");
    const task = tasks[index];
    const projectDirectory = this.store.projectAssetDirectory(id);
    this.store.update(id, {
      stages: stageStatus(project, "voiceSynthesis", "running", {
        eventId,
        speaker: task.speaker,
      }),
      updatedAt: new Date().toISOString(),
    });
    try {
      const generated = await synthesizeDialogue({
        root: this.root,
        referenceAudio: task.referenceAudio,
        text: raw.text || task.dialogue,
        language: raw.language || task.language || "en",
        speaker: task.speaker,
        eventId,
        outputDirectory: `${projectDirectory}/voice-synthesis`,
        options: {
          requireReference: task.isNewActor ? false : true,
        },
      });
      const replacement = this.store.writeGeneratedDialogueAudio(id, eventId, generated);
      const latest = this.get(id);
      const currentTasks = latest.renderPackage?.audioTasks?.tasks || tasks;
      const nextTasks = currentTasks.map((item, taskIndex) => taskIndex === index || item.eventId === eventId || item.sourceEventId === eventId
        ? {
            ...item,
            replacementPath: replacement.path,
            replacementRelativePath: replacement.relativePath,
            replacement,
            status: "ready",
            synthesis: {
              status: "completed",
              engine: generated.engine,
              metadata: generated.metadata || {},
              updatedAt: new Date().toISOString(),
            },
          }
        : item);
      const audioReadiness = audioTaskReadiness(nextTasks);
      const lipSyncTasks = latest.renderPackage?.lipSyncTasks
        ? {
            ...latest.renderPackage.lipSyncTasks,
            tasks: (latest.renderPackage.lipSyncTasks.tasks || []).map((lipTask) =>
              lipTask.eventId === eventId || lipTask.sourceEventId === eventId
                ? {
                    ...lipTask,
                    dialogueAudioPath: replacement.path,
                    dialogueAudioRelativePath: replacement.relativePath,
                  }
                : lipTask
            ),
            updatedAt: new Date().toISOString(),
          }
        : null;
      if (lipSyncTasks) {
        lipSyncTasks.readiness = lipSyncTaskReadiness(lipSyncTasks.tasks);
        lipSyncTasks.status = lipSyncTasks.readiness.ready ? "ready" : "waitingForLipSyncSegments";
      }
      const renderPackage = {
        ...latest.renderPackage,
        audioTasks: {
          ...latest.renderPackage.audioTasks,
          tasks: nextTasks,
          readiness: audioReadiness,
          updatedAt: new Date().toISOString(),
        },
        ...(lipSyncTasks ? { lipSyncTasks } : {}),
        updatedAt: new Date().toISOString(),
      };
      return this.store.update(id, {
        renderPackage,
        stages: stageStatus(latest, "voiceSynthesis", "completed", {
          eventId,
          engine: generated.engine,
        }),
        outputs: {
          ...(latest.outputs || {}),
          renderPackage: {
            status: renderPackage.status,
            segmentCount: renderPackage.segments?.length || 0,
            missingSegmentCount: renderPackage.readiness?.missing?.length || 0,
            missingAudioCount: audioReadiness.missing.length,
            missingLipSyncCount: lipSyncTasks?.readiness?.missing?.length || renderPackage.lipSyncTasks?.readiness?.missing?.length || 0,
          },
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.get(id);
      const status = error instanceof VoiceEngineNotConfiguredError ? "notConfigured" : "failed";
      const currentTasks = latest.renderPackage?.audioTasks?.tasks || tasks;
      const nextTasks = currentTasks.map((item) => item.eventId === eventId || item.sourceEventId === eventId
        ? {
            ...item,
            synthesis: {
              status,
              code: error.code || null,
              error: error.message,
              updatedAt: new Date().toISOString(),
            },
          }
        : item);
      this.store.update(id, {
        renderPackage: {
          ...latest.renderPackage,
          audioTasks: {
            ...latest.renderPackage.audioTasks,
            tasks: nextTasks,
            readiness: audioTaskReadiness(nextTasks),
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        },
        stages: stageStatus(latest, "voiceSynthesis", status, {
          eventId,
          error: error.message,
          code: error.code || null,
        }),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async applyLipSyncToSegment(id, segmentId, raw = {}) {
    const project = this.get(id);
    const lipSyncTasks = project.renderPackage?.lipSyncTasks?.tasks || [];
    if (!lipSyncTasks.length) throw new Error("Prepara prima i task lip-sync Interactive Cast.");
    const taskIndex = lipSyncTasks.findIndex((task) => task.segmentId === segmentId || task.taskId === segmentId);
    if (taskIndex < 0) throw new Error("Task lip-sync Interactive Cast non trovato.");
    const task = lipSyncTasks[taskIndex];
    const projectDirectory = this.store.projectAssetDirectory(id);
    this.store.update(id, {
      stages: stageStatus(project, "lipSync", "running", {
        segmentId,
        eventId: task.eventId || null,
      }),
      updatedAt: new Date().toISOString(),
    });
    try {
      const generated = await applyLipSync({
        root: this.root,
        video: { path: task.sourceClipPath },
        audio: { path: task.dialogueAudioPath },
        segmentId,
        start: task.start,
        end: task.end,
        outputDirectory: `${projectDirectory}/lipsync`,
        options: raw,
      });
      const replacement = this.store.writeGeneratedSegmentReplacement(id, segmentId, generated);
      const latest = this.get(id);
      const nextSegments = (latest.renderPackage?.segments || []).map((segment) => segment.id === segmentId
        ? {
            ...segment,
            replacementPath: replacement.path,
            replacementRelativePath: replacement.relativePath,
            replacement,
            source: "lipsync-engine",
            status: "ready",
          }
        : segment);
      const readiness = finalSpliceReadiness(nextSegments);
      const nextLipTasks = (latest.renderPackage?.lipSyncTasks?.tasks || lipSyncTasks).map((item) =>
        item.segmentId === segmentId || item.taskId === segmentId
          ? {
              ...item,
              status: "ready",
              replacementPath: replacement.path,
              replacementRelativePath: replacement.relativePath,
              replacement,
              synthesis: {
                status: "completed",
                engine: generated.engine,
                metadata: generated.metadata || {},
                updatedAt: new Date().toISOString(),
              },
            }
          : item
      );
      const nextLipReadiness = lipSyncTaskReadiness(nextLipTasks);
      const renderPackage = {
        ...latest.renderPackage,
        segments: nextSegments,
        readiness,
        lipSyncTasks: {
          ...latest.renderPackage.lipSyncTasks,
          tasks: nextLipTasks,
          readiness: nextLipReadiness,
          status: nextLipReadiness.ready ? "ready" : "waitingForLipSyncSegments",
          updatedAt: new Date().toISOString(),
        },
        status: readiness.ready ? "readyToConcat" : "waitingForAiSegments",
        updatedAt: new Date().toISOString(),
      };
      return this.store.update(id, {
        renderPackage,
        status: readiness.ready ? "segmentsReady" : "segmentsPrepared",
        stages: stageStatus(latest, "lipSync", "completed", {
          segmentId,
          engine: generated.engine,
        }),
        outputs: {
          ...(latest.outputs || {}),
          renderPackage: {
            status: renderPackage.status,
            segmentCount: nextSegments.length,
            missingSegmentCount: readiness.missing.length,
            missingAudioCount: renderPackage.audioTasks?.readiness?.missing?.length || 0,
            missingLipSyncCount: nextLipReadiness.missing.length,
          },
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.get(id);
      const status = error instanceof LipSyncEngineNotConfiguredError ? "notConfigured" : "failed";
      const nextLipTasks = (latest.renderPackage?.lipSyncTasks?.tasks || lipSyncTasks).map((item) =>
        item.segmentId === segmentId || item.taskId === segmentId
          ? {
              ...item,
              synthesis: {
                status,
                code: error.code || null,
                error: error.message,
                updatedAt: new Date().toISOString(),
              },
            }
          : item
      );
      this.store.update(id, {
        renderPackage: {
          ...latest.renderPackage,
          lipSyncTasks: {
            ...latest.renderPackage.lipSyncTasks,
            tasks: nextLipTasks,
            readiness: lipSyncTaskReadiness(nextLipTasks),
            status: "waitingForLipSyncSegments",
            updatedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        },
        stages: stageStatus(latest, "lipSync", status, {
          segmentId,
          error: error.message,
          code: error.code || null,
        }),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async applyCompositeToSegment(id, segmentId, files = {}, raw = {}) {
    const overlayFile = Array.isArray(files.overlayVideo) ? files.overlayVideo[0] : files.overlayVideo;
    const maskFile = Array.isArray(files.maskImage) ? files.maskImage[0] : files.maskImage;
    if (!overlayFile?.mimetype?.startsWith("video/")) {
      throw new Error("Carica un overlay video per il compositing.");
    }
    if (!maskFile?.mimetype?.startsWith("image/")) {
      throw new Error("Carica una maschera immagine per il compositing.");
    }
    const project = this.get(id);
    const segments = project.renderPackage?.segments || [];
    const index = segments.findIndex((segment) => segment.id === segmentId);
    if (index < 0) throw new Error("Segmento Interactive Cast non trovato.");
    const segment = segments[index];
    if (segment.mode !== "composite") {
      throw new Error("Il compositing mascherato è disponibile solo per segmenti mode=composite.");
    }
    if (!segment.sourceClipPath) {
      throw new Error("Prepara prima la source clip del segmento composite.");
    }
    const projectDirectory = this.store.projectAssetDirectory(id);
    this.store.update(id, {
      stages: stageStatus(project, "compositing", "running", { segmentId }),
      updatedAt: new Date().toISOString(),
    });
    try {
      const overlay = this.store.writeUpload(id, overlayFile, `composite-overlay-${segmentId}`);
      const mask = this.store.writeUpload(id, maskFile, `composite-mask-${segmentId}`);
      const outputPath = `${projectDirectory}/composites/${segmentId}-composite.mp4`;
      const generated = await applyMaskedCompositeSegment({
        segment,
        overlayVideo: overlay.path,
        maskImage: mask.path,
        outputPath,
        feather: raw.feather,
      });
      const replacement = this.store.writeGeneratedSegmentReplacement(id, segmentId, generated);
      const latest = this.get(id);
      const nextSegments = (latest.renderPackage?.segments || segments).map((item) => item.id === segmentId
        ? {
            ...item,
            replacementPath: replacement.path,
            replacementRelativePath: replacement.relativePath,
            replacement,
            composite: {
              status: "completed",
              engine: generated.engine,
              feather: generated.feather,
              overlay: { path: overlay.path, filename: overlay.filename, mimeType: overlay.mimeType },
              mask: { path: mask.path, filename: mask.filename, mimeType: mask.mimeType },
              updatedAt: new Date().toISOString(),
            },
            source: "masked-composite",
            status: "ready",
          }
        : item);
      const readiness = finalSpliceReadiness(nextSegments);
      const renderPackage = {
        ...latest.renderPackage,
        segments: nextSegments,
        readiness,
        status: readiness.ready ? "readyToConcat" : "waitingForAiSegments",
        updatedAt: new Date().toISOString(),
      };
      return this.store.update(id, {
        renderPackage,
        status: readiness.ready ? "segmentsReady" : "segmentsPrepared",
        stages: stageStatus(latest, "compositing", "completed", {
          segmentId,
          engine: generated.engine,
          feather: generated.feather,
        }),
        outputs: {
          ...(latest.outputs || {}),
          renderPackage: {
            status: renderPackage.status,
            segmentCount: renderPackage.segments?.length || 0,
            missingSegmentCount: readiness.missing.length,
            missingAudioCount: renderPackage.audioTasks?.readiness?.missing?.length || 0,
            missingLipSyncCount: renderPackage.lipSyncTasks?.readiness?.missing?.length || 0,
          },
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.get(id);
      this.store.update(id, {
        stages: stageStatus(latest, "compositing", "failed", { segmentId, error: error.message }),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async verifySegmentIdentity(id, segmentId, raw = {}) {
    const project = this.get(id);
    const segments = project.renderPackage?.segments || [];
    if (!segments.length) throw new Error("Prepara prima i segmenti Interactive Cast.");
    const segment = segments.find((item) => item.id === segmentId);
    if (!segment) throw new Error("Segmento Interactive Cast non trovato.");
    const task = (project.renderPackage?.segmentTasks?.tasks || [])
      .find((item) => item.segmentId === segmentId) || null;
    const projectDirectory = this.store.projectAssetDirectory(id);
    this.store.update(id, {
      stages: stageStatus(project, "identityCheck", "running", { segmentId }),
      updatedAt: new Date().toISOString(),
    });
    const report = await verifySegmentIdentity({
      segment,
      referenceFrame: task?.anchorFrame?.path ? task.anchorFrame : null,
      replacementPath: segment.replacementPath,
      projectDirectory,
      threshold: Number(raw.threshold || 0.58),
      sampleCount: Number(raw.sampleCount || 6),
    });
    const latest = this.get(id);
    const identityReports = {
      ...(latest.renderPackage?.identityReports || {}),
      [segmentId]: report,
    };
    const status = report.status === "failed" ? "failed" : report.status === "drift-detected" ? "reviewNeeded" : "completed";
    return this.store.update(id, {
      renderPackage: {
        ...latest.renderPackage,
        identityReports,
        updatedAt: new Date().toISOString(),
      },
      stages: stageStatus(latest, "identityCheck", status, {
        segmentId,
        reportStatus: report.status,
        averageSimilarity: report.averageSimilarity ?? null,
        minSimilarity: report.minSimilarity ?? null,
      }),
      updatedAt: new Date().toISOString(),
    });
  }

  async remixAudio(id) {
    const project = this.get(id);
    const tasks = project.renderPackage?.audioTasks?.tasks || [];
    const projectDirectory = this.store.projectAssetDirectory(id);
    this.store.update(id, {
      stages: stageStatus(project, "audioRemix", "running"),
      updatedAt: new Date().toISOString(),
    });
    try {
      const dialogueRemix = await mixDialogueAudioTasks({
        sourceAudio: project.artifacts?.audio,
        tasks,
        projectDirectory,
      });
      const latest = this.get(id);
      return this.store.update(id, {
        stages: stageStatus(latest, "audioRemix", "completed"),
        outputs: {
          ...(latest.outputs || {}),
          dialogueRemix,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.get(id);
      this.store.update(id, {
        stages: stageStatus(latest, "audioRemix", "failed", { error: error.message }),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async concatFinal(id) {
    const project = this.get(id);
    const segments = project.renderPackage?.segments || [];
    const readiness = finalSpliceReadiness(segments);
    if (!readiness.ready) {
      const error = new Error("Prima carica o genera tutti i segmenti AI/lip-sync mancanti.");
      error.missing = readiness.missing;
      throw error;
    }
    const projectDirectory = this.store.projectAssetDirectory(id);
    const outputDirectory = `${projectDirectory}/final`;
    fs.mkdirSync(outputDirectory, { recursive: true });
    const manifestPath = `${outputDirectory}/concat.txt`;
    const outputPath = `${outputDirectory}/interactive-cast-final.mp4`;
    const remixAudio = project.outputs?.dialogueRemix?.path && fs.existsSync(project.outputs.dialogueRemix.path)
      ? project.outputs.dialogueRemix
      : null;
    const spliceOutputPath = remixAudio
      ? `${outputDirectory}/interactive-cast-video-track.mp4`
      : outputPath;
    this.store.update(id, {
      stages: stageStatus(project, "finalEncode", "running"),
      updatedAt: new Date().toISOString(),
    });
    try {
      await concatReadySegments({ segments, manifestPath, outputPath: spliceOutputPath });
      if (remixAudio) {
        await muxAudioIntoVideo({
          video: spliceOutputPath,
          audio: remixAudio.path,
          output: outputPath,
        });
      }
      const finalVideo = {
        path: outputPath,
        relativePath: "final/interactive-cast-final.mp4",
        filename: "interactive-cast-final.mp4",
        mimeType: "video/mp4",
        audioSource: remixAudio ? "dialogueRemix" : "segmentAudio",
        videoTrackPath: remixAudio ? spliceOutputPath : outputPath,
        createdAt: new Date().toISOString(),
      };
      const latest = this.get(id);
      return this.store.update(id, {
        stages: stageStatus(latest, "finalEncode", "completed"),
        status: "completed",
        outputs: {
          ...(latest.outputs || {}),
          finalVideo,
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.get(id);
      this.store.update(id, {
        stages: stageStatus(latest, "finalEncode", "failed", { error: error.message }),
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  }
}
