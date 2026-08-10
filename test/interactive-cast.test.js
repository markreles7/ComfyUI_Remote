import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInteractiveCastPlan,
  eventEditMode,
  normalizeDialogueEvents,
  planEditWindows,
  validateInteractiveCastAssistantPlan,
} from "../src/interactive-cast/planner.js";
import { finalSpliceReadiness, prepareMissingSegmentTasks, segmentManifest } from "../src/interactive-cast/compositor.js";
import {
  audioTaskReadiness,
  prepareDialogueAudioTasks,
  selectVoiceReferenceWindow,
} from "../src/interactive-cast/audio-remix.js";
import { audioAnalysisFallback, speakerDiarizationFallback } from "../src/interactive-cast/audio-analysis.js";
import { detectActorTracks } from "../src/interactive-cast/actor-tracking.js";
import {
  LipSyncEngineNotConfiguredError,
  lipsyncCapabilities,
  lipSyncTaskReadiness,
  prepareLipSyncTasks,
} from "../src/interactive-cast/lipsync-engine.js";
import { InteractiveCastOrchestrator } from "../src/interactive-cast/orchestrator.js";
import { interactiveCastCapabilities } from "../src/interactive-cast/capabilities.js";
import { interactiveCastPython, interactiveCastScript } from "../src/interactive-cast/python-tools.js";
import { cacheKey, renderPackageCacheKey, stableJson, stageStatus } from "../src/interactive-cast/pipeline-state.js";
import { InteractiveCastProjectStore } from "../src/interactive-cast/project-store.js";
import { parseSceneDetectLog, referenceFrameTimes, sceneWindowsFromCuts } from "../src/interactive-cast/video-analysis.js";
import { voiceEngineCapabilities, VoiceEngineNotConfiguredError } from "../src/interactive-cast/voice-engine.js";
import { verifySegmentIdentity } from "../src/interactive-cast/identity-check.js";
import { GpuResourceBusyError, GpuResourceManager } from "../src/gpu-resource-manager.js";

test("interactive cast normalizes dialogue events and preserves original windows", () => {
  const events = normalizeDialogueEvents([
    { speaker: "New Actor", start: 3, end: 5, dialogue: "I thought you had already left.", action: "enters" },
    { speaker: "Original Actor 2", start: 5, end: 7, dialogue: "Not yet.", reaction: "speak" },
  ], 10);

  const windows = planEditWindows({ duration: 10, dialogueEvents: events });

  assert.equal(events.length, 2);
  assert.equal(windows[0].mode, "original");
  assert.equal(windows.some((window) => window.mode === "generative"), true);
  assert.equal(windows.some((window) => window.mode === "lipSyncOnly"), true);
  assert.equal(windows.at(-1).mode, "original");
});

test("interactive cast planner respects explicit edit modes and merges overlapping windows", () => {
  const events = normalizeDialogueEvents([
    { speaker: "Original Actor 1", start: 1, end: 2, dialogue: "voice only", preserveFace: false },
    { speaker: "Original Actor 2", start: 1.8, end: 3, action: "turns head toward the door", visualMode: "regional" },
    { speaker: "New Actor", start: 2.8, end: 4, dialogue: "I am here", visualMode: "full" },
  ], 6);
  const windows = planEditWindows({ duration: 6, dialogueEvents: events });

  assert.equal(eventEditMode(events[0]), "audioOnly");
  assert.equal(eventEditMode(events[1]), "composite");
  assert.equal(eventEditMode(events[2]), "generative");
  assert.deepEqual(windows.map((window) => window.mode), ["original", "generative", "original"]);
  assert.match(windows[1].reason, /voice only/);
  assert.match(windows[1].reason, /turns head/);
  assert.match(windows[1].reason, /I am here/);
});

test("interactive cast planner keeps pure original actor dialogue as lip-sync only", () => {
  const events = normalizeDialogueEvents([
    { speaker: "Original Actor 1", start: 2, end: 3, dialogue: "Not yet. We were waiting for you.", reaction: "speak" },
  ], 5);
  const windows = planEditWindows({ duration: 5, dialogueEvents: events });

  assert.equal(windows[1].mode, "lipSyncOnly");
  assert.equal(windows[0].mode, "original");
  assert.equal(windows[2].mode, "original");
});

test("interactive cast maps an added actor name to a generative window", () => {
  const plan = buildInteractiveCastPlan({
    project: {
      id: "cast-marco",
      analysis: { duration: 10 },
      actors: {
        original: [{ actorId: "original-1", label: "Original Actor 1" }],
        added: [{ actorId: "new-actor-marco", name: "Marco" }],
      },
      dialogueEvents: [{
        id: "event-marco",
        speaker: "Marco",
        start: 3,
        end: 5,
        dialogue: "Il demone di questa casa si chiama Valak.",
        action: "enters the scene",
      }],
    },
  });

  assert.equal(plan.dialogueEvents[0].actorId, "new-actor-marco");
  assert.equal(plan.dialogueEvents[0].isNewActor, true);
  assert.equal(plan.editWindows.some((window) => window.mode === "generative"), true);
});

test("interactive cast parses ffmpeg scene detect times into source windows", () => {
  const times = parseSceneDetectLog([
    "[Parsed_showinfo_1 @ 000] n: 12 pts: 46080 pts_time:1.92000 pos: -1",
    "[Parsed_showinfo_1 @ 000] n: 44 pts: 168960 pts_time:7.04000 pos: -1",
  ].join("\n"));
  const windows = sceneWindowsFromCuts(times, 10);

  assert.deepEqual(times, [1.92, 7.04]);
  assert.deepEqual(windows.map((window) => [window.start, window.end]), [
    [0, 1.92],
    [1.92, 7.04],
    [7.04, 10],
  ]);
});

test("interactive cast samples stable reference frame times", () => {
  assert.deepEqual(referenceFrameTimes(10).map((time) => Number(time.toFixed(2))), [0.05, 5, 9.75]);
  assert.deepEqual(referenceFrameTimes(0), [0]);
});

test("interactive cast assistant plan validation clamps and derives edit windows", () => {
  const plan = validateInteractiveCastAssistantPlan({
    actors: {
      original: [{ actorId: "original-1", label: "Man on the left" }],
      added: [{ name: "Sarah", entranceTime: 3.2 }],
    },
    dialogueEvents: [
      { speaker: "New Actor", start: 3.2, end: 5, dialogue: "Pensavo foste già andati via.", action: "enters" },
    ],
  }, { duration: 10 });

  assert.equal(plan.actors.original[0].label, "Man on the left");
  assert.equal(plan.actors.added[0].name, "Sarah");
  assert.equal(plan.dialogueEvents[0].dialogue, "Pensavo foste già andati via.");
  assert.equal(plan.editWindows.some((window) => window.mode === "generative"), true);
});

test("interactive cast segment manifest marks only AI windows as missing", () => {
  const segments = segmentManifest({
    sourceVideo: "source.mp4",
    segmentDirectory: "segments",
    editWindows: [
      { start: 0, end: 3, mode: "original", reason: "preserve" },
      { start: 3, end: 7, mode: "generative", reason: "new actor enters" },
      { start: 7, end: 10, mode: "original", reason: "preserve" },
    ],
  });
  const readiness = finalSpliceReadiness(segments);

  assert.equal(segments[0].status, "ready");
  assert.equal(segments[1].status, "waiting_for_ai_segment");
  assert.equal(segments[2].status, "ready");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing.length, 1);

  const withReplacement = segments.map((segment) => segment.id === "segment-2"
    ? { ...segment, replacementPath: "replacement.mp4", status: "ready" }
    : segment);
  assert.equal(finalSpliceReadiness(withReplacement).ready, true);
});

test("interactive cast segment manifest preserves audio-only and source clips for lip-sync", () => {
  const segments = segmentManifest({
    sourceVideo: "source.mp4",
    segmentDirectory: "segments",
    editWindows: [
      { start: 0, end: 2, mode: "audioOnly", reason: "replace dialogue only" },
      { start: 2, end: 4, mode: "lipSyncOnly", reason: "new line for original actor" },
    ],
  });
  const readiness = finalSpliceReadiness(segments);

  assert.equal(segments[0].status, "ready");
  assert.equal(segments[0].requiredGenerated, false);
  assert.equal(segments[1].status, "waiting_for_ai_segment");
  assert.equal(segments[1].sourceClipRelativePath, "segments/source-002-lipSyncOnly.mp4");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.missing[0].sourceClipRelativePath, "segments/source-002-lipSyncOnly.mp4");
});

test("interactive cast segment tasks carry added actor references into prompts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-actor-reference-"));
  const tasks = await prepareMissingSegmentTasks({
    sourceVideo: path.join(root, "missing-source.mp4"),
    projectDirectory: root,
    segments: [{
      id: "segment-1",
      start: 3,
      end: 5,
      mode: "generative",
      reason: "Sarah enters the scene and speaks",
      requiredGenerated: true,
    }],
    actorReferences: [{
      actorId: "character:selly",
      type: "characterPack",
      name: "Selly",
      description: "confident recurring virtual actor",
      identityHints: {
        face: "oval face and direct gaze",
        hair: "long dark hair",
        body: "curvy athletic silhouette",
      },
      wardrobe: ["black dress"],
      locks: { face: true, hair: true, body: true },
      characterPack: { status: "Ready", referenceCount: 4 },
    }],
    anchorWorkflowId: "qwen-krea-klein",
  });

  assert.equal(tasks.tasks.length, 1);
  assert.equal(tasks.tasks[0].actorReferences[0].name, "Selly");
  assert.equal(tasks.tasks[0].anchorWorkflow.label, "Qwen/Krea/Klein");
  assert.match(tasks.tasks[0].anchorRequirement, /Qwen\/Krea\/Klein combined Image Studio workflow/);
  assert.match(tasks.tasks[0].prompt, /Use these added actor references/);
  assert.match(tasks.tasks[0].prompt, /Selly/);
  assert.match(tasks.tasks[0].prompt, /oval face and direct gaze/);
  assert.match(tasks.tasks[0].referenceRequirement, /Character Pack or temporary actor reference/);
});

test("interactive cast asset store blocks path traversal", () => {
const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-store-"));
  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory: path.join(root, "assets"),
  });
  const projectId = "project-1";
  const directory = store.projectAssetDirectory(projectId);
  fs.mkdirSync(path.join(directory, "frames"), { recursive: true });
  fs.writeFileSync(path.join(directory, "frames", "start.jpg"), "x");
  fs.writeFileSync(path.join(root, "outside.txt"), "x");

  assert.equal(store.assetPath(projectId, "frames/start.jpg"), path.join(directory, "frames", "start.jpg"));
  assert.equal(store.assetPath(projectId, "../outside.txt"), null);
  assert.equal(store.assetPath("../escape", "outside.txt"), null);

  const reference = store.writeTemporaryActorReference(projectId, {
    originalname: "actor.png",
    mimetype: "image/png",
    buffer: Buffer.from("image"),
    size: 5,
  });
  assert.equal(reference.relativePath.startsWith("temporary-actor-reference/"), true);
  assert.equal(fs.existsSync(reference.path), true);
});

test("interactive cast project delete removes record and only its asset directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-delete-"));
  const assetDirectory = path.join(root, "assets");
  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory,
  });
  store.add({ id: "cast-delete", createdAt: new Date().toISOString(), title: "Delete me" });
  const projectDirectory = store.projectAssetDirectory("cast-delete");
  fs.writeFileSync(path.join(projectDirectory, "asset.txt"), "test");
  const sibling = path.join(assetDirectory, "keep.txt");
  fs.writeFileSync(sibling, "keep");
  const orchestrator = new InteractiveCastOrchestrator({ root, store, characterStore: null });

  const removed = orchestrator.delete("cast-delete");

  assert.equal(removed.id, "cast-delete");
  assert.equal(store.get("cast-delete"), undefined);
  assert.equal(fs.existsSync(projectDirectory), false);
  assert.equal(fs.readFileSync(sibling, "utf8"), "keep");
});

test("interactive cast final encode uses dialogue remix when available", () => {
  const source = fs.readFileSync(new URL("../src/interactive-cast/orchestrator.js", import.meta.url), "utf8");

  assert.match(source, /project\.outputs\?\.dialogueRemix\?\.path/);
  assert.match(source, /muxAudioIntoVideo/);
  assert.match(source, /audioSource:\s*remixAudio \? "dialogueRemix" : "segmentAudio"/);
});

test("interactive cast exposes masked composite route and orchestrator method", () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const orchestrator = fs.readFileSync(new URL("../src/interactive-cast/orchestrator.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");

  assert.match(server, /segments\/:segmentId\/composite/);
  assert.match(orchestrator, /applyCompositeToSegment/);
  assert.match(orchestrator, /applyMaskedCompositeSegment/);
  assert.match(ui, /data-interactive-cast-composite/);
  assert.match(ui, /data-cast-composite-mask-file/);
});

test("interactive cast capability report includes disk, ComfyUI Python and masked compositing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-capability-report-"));
  const report = await interactiveCastCapabilities({ root });

  assert.equal(report.paths.reportPath.endsWith("interactive-cast-capabilities.json"), true);
  assert.equal(fs.existsSync(report.paths.reportPath), true);
  assert.equal(typeof report.hardware.disk.available, "boolean");
  assert.equal("comfyPython" in report.runtimes, true);
  assert.equal("maskedCompositing" in report.matrix, true);
  assert.equal("maskedCompositing" in report.statuses, true);
  assert.equal("comfyTorchCuda" in report.statuses, true);
});

test("interactive cast prepares dialogue audio tasks without claiming voice clone is configured", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-audio-"));
  const tasks = await prepareDialogueAudioTasks({
    sourceAudio: null,
    projectDirectory: root,
    dialogueEvents: [
      {
        id: "event-1",
        speaker: "Original Actor 1",
        start: 1,
        end: 2,
        dialogue: "Not yet. We were waiting for you.",
        preserveVoice: true,
      },
      {
        id: "event-2",
        speaker: "New Actor",
        start: 2,
        end: 3,
        dialogue: "I thought you had already left.",
      },
    ],
  });

  assert.equal(tasks.tasks.length, 2);
  assert.equal(tasks.tasks[0].requiredEngine, "Reference-conditioned voice clone / uploaded voice line");
  assert.equal(tasks.tasks[1].requiredEngine, "New actor dialogue TTS / uploaded voice line");
  assert.equal(tasks.tasks[1].isNewActor, true);
  assert.equal(tasks.tasks[0].mix.strategy, "duck-original-bed");
  assert.equal(tasks.tasks[0].mix.duckVolume, 0.45);
  assert.equal(tasks.readiness.ready, false);
  assert.equal(audioTaskReadiness(tasks.tasks.map((task) => ({ ...task, replacementPath: "line.wav" }))).ready, true);
});

test("voice reference selection prefers the longest window assigned to the event actor", () => {
  const selected = selectVoiceReferenceWindow({ speaker: "original-2" }, [
    { speaker: "SPEAKER_00", assignedActorId: "original-2", start: 1, end: 3 },
    { speaker: "SPEAKER_01", assignedActorId: "original-1", start: 0, end: 8 },
    { speaker: "SPEAKER_02", assignedActorId: "original-2", start: 4, end: 20 },
  ]);
  assert.deepEqual(selected, {
    speaker: "SPEAKER_02",
    start: 4,
    end: 16,
    method: "assigned-speaker-window",
  });
});

test("interactive cast audio mixer builds ducking and fade metadata", () => {
  const ffmpegSource = fs.readFileSync(new URL("../src/interactive-cast/ffmpeg.js", import.meta.url), "utf8");
  const remixSource = fs.readFileSync(new URL("../src/interactive-cast/audio-remix.js", import.meta.url), "utf8");

  assert.match(ffmpegSource, /duckVolume/);
  assert.match(ffmpegSource, /enable='between/);
  assert.match(ffmpegSource, /afade=t=in/);
  assert.match(ffmpegSource, /dynaudnorm/);
  assert.match(remixSource, /duck-original-bed-with-dialogue-overlays/);
});

test("interactive cast voice engine reports not configured without synthesize adapter", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-no-voice-"));
  const capabilities = voiceEngineCapabilities({ root });

  assert.equal(capabilities.status, "NOT CONFIGURED");
  assert.equal(capabilities.synthesizeDialogue, false);
  assert.match(capabilities.script, /synthesize\.py$/);
});

test("interactive cast voice synthesis retry records not configured state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-voice-retry-"));
  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory: path.join(root, "assets"),
  });
  store.add({
    id: "cast-1",
    renderPackage: {
      audioTasks: {
        tasks: [{
          eventId: "event-1",
          speaker: "Original Actor 1",
          dialogue: "Not yet.",
          referenceAudio: { path: path.join(root, "missing-reference.wav") },
          status: "waiting_for_voice_audio",
        }],
        readiness: { ready: false, missing: [{ eventId: "event-1" }] },
      },
    },
    stages: {},
  });
  const orchestrator = new InteractiveCastOrchestrator({ root, store, characterStore: null });

  await assert.rejects(
    () => orchestrator.synthesizeDialogueAudio("cast-1", "event-1"),
    VoiceEngineNotConfiguredError
  );
  const updated = store.get("cast-1");
  assert.equal(updated.stages.voiceSynthesis.status, "notConfigured");
  assert.equal(updated.renderPackage.audioTasks.tasks[0].synthesis.status, "notConfigured");
  assert.match(updated.renderPackage.audioTasks.tasks[0].synthesis.error, /Voice cloning locale non configurato/);
});

test("interactive cast prepares explicit lip-sync tasks from source clip and dialogue audio", () => {
  const tasks = prepareLipSyncTasks({
    segments: [
      {
        id: "segment-2",
        start: 2,
        end: 4,
        mode: "lipSyncOnly",
        reason: "original actor answers with new line",
        sourceClipPath: "segments/source-002-lipSyncOnly.mp4",
        sourceClipRelativePath: "segments/source-002-lipSyncOnly.mp4",
      },
    ],
    dialogueEvents: [
      {
        id: "event-1",
        speaker: "Original Actor 1",
        start: 2.1,
        end: 3.8,
        dialogue: "Not yet. We were waiting for you.",
      },
    ],
    audioTasks: [
      {
        eventId: "event-1",
        speaker: "Original Actor 1",
        start: 2.1,
        end: 3.8,
        replacementPath: "dialogue/event-1.wav",
        replacementRelativePath: "dialogue/event-1.wav",
      },
    ],
  });

  assert.equal(tasks.tasks.length, 1);
  assert.equal(tasks.tasks[0].eventId, "event-1");
  assert.equal(tasks.tasks[0].dialogueAudioRelativePath, "dialogue/event-1.wav");
  assert.match(tasks.tasks[0].instructions, /Modify only the mouth/);
  assert.equal(lipSyncTaskReadiness(tasks.tasks).ready, false);
  assert.equal(lipSyncTaskReadiness([{ ...tasks.tasks[0], replacementPath: "segment.mp4" }]).ready, true);
});

test("interactive cast lip-sync engine reports not configured without adapter", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-no-lipsync-"));
  const capabilities = lipsyncCapabilities({ root });

  assert.equal(capabilities.status, "NOT CONFIGURED");
  assert.equal(capabilities.applyLipSync, false);
  assert.match(capabilities.script, /lipsync\.py$/);
});

test("interactive cast lip-sync retry records not configured state", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-lipsync-retry-"));
  const sourceClip = path.join(root, "source.mp4");
  const dialogueAudio = path.join(root, "line.wav");
  fs.writeFileSync(sourceClip, "video");
  fs.writeFileSync(dialogueAudio, "audio");
  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory: path.join(root, "assets"),
  });
  store.add({
    id: "cast-1",
    renderPackage: {
      segments: [{
        id: "segment-1",
        mode: "lipSyncOnly",
        requiredGenerated: true,
        sourceClipPath: sourceClip,
        start: 0,
        end: 1,
        status: "waiting_for_ai_segment",
      }],
      readiness: { ready: false, missing: [{ id: "segment-1" }] },
      lipSyncTasks: {
        tasks: [{
          taskId: "lipsync-segment-1",
          segmentId: "segment-1",
          eventId: "event-1",
          sourceClipPath: sourceClip,
          dialogueAudioPath: dialogueAudio,
          status: "waiting_for_lipsync_video",
        }],
        readiness: { ready: false, missing: [{ segmentId: "segment-1" }] },
      },
    },
    stages: {},
  });
  const orchestrator = new InteractiveCastOrchestrator({ root, store, characterStore: null });

  await assert.rejects(
    () => orchestrator.applyLipSyncToSegment("cast-1", "segment-1"),
    LipSyncEngineNotConfiguredError
  );
  const updated = store.get("cast-1");
  assert.equal(updated.stages.lipSync.status, "notConfigured");
  assert.equal(updated.renderPackage.lipSyncTasks.tasks[0].synthesis.status, "notConfigured");
  assert.match(updated.renderPackage.lipSyncTasks.tasks[0].synthesis.error, /Lip-sync locale non configurato/);
});

test("interactive cast identity check reports insufficient output without crashing", async () => {
  const report = await verifySegmentIdentity({
    segment: { id: "segment-1", sourceClipPath: "missing-source.mp4" },
    projectDirectory: fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-identity-missing-")),
  });

  assert.equal(report.status, "insufficient-output");
  assert.equal(report.engine, "interactive-cast-perceptual-pgm");
});

test("interactive cast audio analysis preserves explicit fallback stem metadata", () => {
  const analysis = audioAnalysisFallback({ audioStreams: [{}] }, {
    sourceSeparation: "FALLBACK",
    stems: [{ role: "dialogueCandidate", relativePath: "audio-stems/dialogue.wav" }],
    warnings: ["stem warning"],
  });

  assert.equal(analysis.extractionReady, true);
  assert.equal(analysis.sourceSeparation, "FALLBACK");
  assert.equal(analysis.stems[0].role, "dialogueCandidate");
  assert.match(analysis.warnings.join("\n"), /stem warning/);
});

test("interactive cast creates editable speaker diarization fallback", () => {
  const fallback = speakerDiarizationFallback({
    duration: 6,
    audioStreams: [{ codec: "aac" }],
  });

  assert.equal(fallback.diarization, "FALLBACK");
  assert.equal(fallback.speakers[0].speaker, "SPEAKER_00");
  assert.equal(fallback.speakers[0].end, 6);
  assert.equal(fallback.speakers[0].editable, true);
});

test("interactive cast stores manual original actor labels", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-actors-"));
  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory: path.join(root, "assets"),
  });
  store.add({
    id: "cast-1",
    actors: {
      original: [
        { actorId: "original-1", label: "Original Actor 1" },
        { actorId: "original-2", label: "Original Actor 2" },
      ],
      added: [],
    },
  });
  const orchestrator = new InteractiveCastOrchestrator({ root, store, characterStore: null });
  const updated = orchestrator.updateOriginalActors("cast-1", [
    { actorId: "original-1", label: "John", role: "left speaker" },
    { actorId: "original-2", label: "Mary", role: "right speaker" },
  ]);

  assert.equal(updated.actors.original[0].label, "John");
  assert.equal(updated.actors.original[1].role, "right speaker");
});

test("interactive cast stores manual speaker assignments", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-speakers-"));
  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory: path.join(root, "assets"),
  });
  store.add({
    id: "cast-1",
    analysis: { duration: 5 },
    actors: { original: [{ actorId: "original-1" }], added: [] },
    audioAnalysis: { diarization: "FALLBACK", speakers: [] },
  });
  const orchestrator = new InteractiveCastOrchestrator({ root, store, characterStore: null });
  const updated = orchestrator.updateSpeakerAssignments("cast-1", [
    { speaker: "SPEAKER_00", start: 0.2, end: 2.5, assignedActorId: "original-1" },
  ]);

  assert.equal(updated.audioAnalysis.speakers[0].assignedActorId, "original-1");
  assert.equal(updated.audioAnalysis.speakers[0].start, 0.2);
  assert.equal(updated.stages.speakerDiarization.status, "fallback");
});

test("interactive cast pipeline state creates stable cache keys and stage records", () => {
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
  assert.equal(cacheKey({ x: ["a", "b"] }), cacheKey({ x: ["a", "b"] }));
  assert.notEqual(cacheKey({ x: ["a", "b"] }), cacheKey({ x: ["b", "a"] }));

  const project = {
    sourceVideo: { sha256: "source-hash" },
    editWindows: [{ start: 0, end: 1, mode: "original" }],
    dialogueEvents: [{ speaker: "New Actor", dialogue: "Hi" }],
    actors: { added: [{ actorId: "character:a", type: "characterPack" }] },
    settings: { anchorWorkflowId: "qwen-image-edit" },
  };
  assert.equal(renderPackageCacheKey(project), renderPackageCacheKey({ ...project }));
  assert.notEqual(
    renderPackageCacheKey(project),
    renderPackageCacheKey({ ...project, settings: { anchorWorkflowId: "krea-triple" } }),
  );
  assert.notEqual(
    renderPackageCacheKey(project, { actorReferences: [{ name: "Selly", description: "old" }] }),
    renderPackageCacheKey(project, { actorReferences: [{ name: "Selly", description: "updated" }] }),
  );
  const stages = stageStatus({ stages: { analysis: { status: "completed" } } }, "segmentPreparation", "cached", {
    cacheKey: "abc",
  });
  assert.equal(stages.analysis.status, "completed");
  assert.equal(stages.segmentPreparation.status, "cached");
  assert.equal(stages.segmentPreparation.cacheKey, "abc");
});

test("interactive cast python tool paths stay inside isolated tool directory", () => {
  const root = path.join(os.tmpdir(), "cast-root");
  const script = interactiveCastScript({ root, scriptName: "track.py" });
  const python = interactiveCastPython({ root });

  assert.match(script, /[\\/]\.tools[\\/]interactive-cast[\\/]scripts[\\/]track\.py$/);
  assert.ok(python === "python" || /[\\/]\.tools[\\/]interactive-cast[\\/]\.venv[\\/]Scripts[\\/]python\.exe$|[\\/]\.tools[\\/]interactive-cast[\\/]\.venv[\\/]bin[\\/]python$/.test(python));
});

test("interactive cast actor tracking falls back when isolated script is unavailable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-no-tools-"));
  const result = await detectActorTracks({
    root,
    videoPath: path.join(root, "missing.mp4"),
    analysis: { duration: 4 },
  });

  assert.equal(result.configured, false);
  assert.equal(result.actors.length, 1);
  assert.equal(result.actors[0].actorId, "original-1");
  assert.match(result.warnings.join("\n"), /Tracker OpenCV non disponibile|Person tracking engine/);
});

test("interactive cast tracker keeps two spatially separate actors in distinct tracks", (t) => {
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const python = interactiveCastPython({ root });
  const script = interactiveCastScript({ root, scriptName: "track.py" });
  if (!fs.existsSync(script) || (python !== "python" && !fs.existsSync(python))) {
    t.skip("Tracker Python isolato non disponibile.");
    return;
  }
  const code = [
    "import importlib.util, json",
    `spec=importlib.util.spec_from_file_location('cast_track', ${JSON.stringify(script)})`,
    "m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
    "tracks=[]",
    "d=lambda x,t: {'time':t,'box':{'x':x,'y':10,'width':30,'height':80},'confidence':0.9,'sharpness':100}",
    "m.associate_detections(tracks,[d(10,0),d(150,0)],0)",
    "m.associate_detections(tracks,[d(14,0.5),d(146,0.5)],0.5)",
    "print(json.dumps([len(t['detections']) for t in tracks]))",
  ].join(";");
  const output = execFileSync(python, ["-c", code], { encoding: "utf8", windowsHide: true }).trim();
  assert.deepEqual(JSON.parse(output), [2, 2]);
});

test("interactive cast GPU coordinator serializes leases without cross-release", async () => {
  const calls = [];
  const manager = new GpuResourceManager({
    releaseComfyMemory: async () => ({ released: true }),
  });
  let unblockFirst;
  const first = manager.run("voice", async (lease) => {
    calls.push(`start:${lease.operation}`);
    await new Promise((resolve) => { unblockFirst = resolve; });
    calls.push(`end:${lease.operation}`);
    return "voice-ready";
  });
  await new Promise((resolve) => setImmediate(resolve));
  const activeLease = manager.active;
  assert.equal(manager.release({ id: "not-the-owner" }).reason, "lease-mismatch");
  assert.equal(manager.active.id, activeLease.id);

  const second = manager.run("lipsync", async (lease) => {
    calls.push(`start:${lease.operation}`);
    return "lipsync-ready";
  });
  assert.equal(manager.status().queued.length, 1);
  unblockFirst();

  assert.equal((await first).value, "voice-ready");
  assert.equal((await second).value, "lipsync-ready");
  assert.deepEqual(calls, ["start:voice", "end:voice", "start:lipsync"]);
  assert.equal(manager.status().active, null);
});

test("interactive cast GPU coordinator refuses external engines while ComfyUI is busy", async () => {
  const manager = new GpuResourceManager({
    releaseComfyMemory: async () => ({ released: false, reason: "queue-busy" }),
  });
  await assert.rejects(
    manager.acquire("lipsync"),
    (error) => error instanceof GpuResourceBusyError && error.statusCode === 409,
  );
  assert.equal(manager.status().active, null);
});
