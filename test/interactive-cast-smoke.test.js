import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  commandVersion,
  ffmpeg,
  ffprobeJson,
  muxAudioIntoVideo,
  normalizeGeneratedSegment,
} from "../src/interactive-cast/ffmpeg.js";
import {
  concatReadySegments,
  finalSpliceReadiness,
  applyMaskedCompositeSegment,
  prepareOriginalSegments,
} from "../src/interactive-cast/compositor.js";
import { verifySegmentIdentity } from "../src/interactive-cast/identity-check.js";
import {
  mixDialogueAudioTasks,
  prepareDialogueAudioTasks,
} from "../src/interactive-cast/audio-remix.js";
import { createFallbackAudioStems } from "../src/interactive-cast/audio-analysis.js";
import { InteractiveCastOrchestrator } from "../src/interactive-cast/orchestrator.js";
import { InteractiveCastProjectStore } from "../src/interactive-cast/project-store.js";

async function createSyntheticClip(output, color, duration = 1) {
  await ffmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=160x96:r=6:d=${duration}`,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "35",
    "-pix_fmt", "yuv420p",
    output,
  ], { timeout: 60_000 });
}

async function createSyntheticAvClip(output, color, frequency, duration = 1) {
  await ffmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=160x96:r=6:d=${duration}`,
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    "-shortest",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "35",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "96k",
    output,
  ], { timeout: 60_000 });
}

async function createTone(output, frequency, duration = 1) {
  await ffmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
    "-ac", "2",
    "-acodec", "pcm_s16le",
    output,
  ], { timeout: 60_000 });
}

async function createSolidImage(output, color = "white") {
  await ffmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${color}:s=160x96`,
    "-frames:v", "1",
    output,
  ], { timeout: 60_000 });
}

test("interactive cast smoke: prepare original segments and concat replacement", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-smoke-"));
  const sourceVideo = path.join(root, "source.mp4");
  const replacement = path.join(root, "replacement.mp4");
  const finalVideo = path.join(root, "final.mp4");
  const manifest = path.join(root, "concat.txt");

  await createSyntheticClip(sourceVideo, "black", 3);
  await createSyntheticClip(replacement, "blue", 1);

  const prepared = await prepareOriginalSegments({
    sourceVideo,
    editWindows: [
      { start: 0, end: 1, mode: "original", reason: "preserve opening" },
      { start: 1, end: 2, mode: "generative", reason: "insert new actor" },
      { start: 2, end: 3, mode: "original", reason: "preserve ending" },
    ],
    projectDirectory: root,
  });
  const segments = prepared.segments.map((segment) => segment.requiredGenerated
    ? { ...segment, replacementPath: replacement, status: "ready" }
    : segment);

  assert.equal(prepared.readiness.ready, false);
  assert.equal(finalSpliceReadiness(segments).ready, true);
  await concatReadySegments({ segments, manifestPath: manifest, outputPath: finalVideo });

  const probe = await ffprobeJson(finalVideo);
  const duration = Number(probe.format?.duration || 0);
  assert.equal(fs.existsSync(finalVideo), true);
  assert.ok(duration > 2.4, `durata finale troppo breve: ${duration}`);
});

test("interactive cast smoke: normalizza il segmento LTX e ripristina l'audio sorgente", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-normalize-smoke-"));
  const source = path.join(root, "source-with-audio.mp4");
  const generated = path.join(root, "generated.mp4");
  const output = path.join(root, "normalized.mp4");
  await createSyntheticAvClip(source, "black", 440, 1);
  await createSyntheticClip(generated, "blue", 1);

  const result = await normalizeGeneratedSegment({
    generatedVideo: generated,
    sourceClip: source,
    output,
    duration: 1,
  });
  const probe = await ffprobeJson(output);
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");

  assert.equal(result.audioSource, "original-segment");
  assert.equal(video.width, 160);
  assert.equal(video.height, 96);
  assert.equal((probe.streams || []).some((stream) => stream.codec_type === "audio"), true);
});

test("interactive cast smoke: limita l'audio nativo LTX alla finestra della nuova battuta", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-native-dialogue-smoke-"));
  const source = path.join(root, "source.mp4");
  const generated = path.join(root, "generated.mp4");
  const output = path.join(root, "mixed.mp4");
  await createSyntheticAvClip(source, "black", 220, 1);
  await createSyntheticAvClip(generated, "blue", 880, 1);

  const result = await normalizeGeneratedSegment({
    generatedVideo: generated,
    sourceClip: source,
    output,
    duration: 1,
    nativeDialogueWindows: [{ start: 0.25, end: 0.75 }],
  });
  const probe = await ffprobeJson(output);

  assert.equal(result.audioSource, "original-segment+ltx-native-dialogue");
  assert.deepEqual(result.nativeDialogueWindows, [{ start: 0.25, end: 0.75 }]);
  assert.equal((probe.streams || []).some((stream) => stream.codec_type === "audio"), true);
});

test("interactive cast smoke: applies feathered mask composite replacement", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-composite-smoke-"));
  const sourceClip = path.join(root, "source.mp4");
  const overlay = path.join(root, "overlay.mp4");
  const mask = path.join(root, "mask.png");
  const output = path.join(root, "composites", "segment-1.mp4");
  await createSyntheticClip(sourceClip, "black", 1);
  await createSyntheticClip(overlay, "blue", 1);
  await createSolidImage(mask, "white");

  const result = await applyMaskedCompositeSegment({
    segment: { id: "segment-1", sourceClipPath: sourceClip },
    overlayVideo: overlay,
    maskImage: mask,
    outputPath: output,
    feather: 5,
  });
  const probe = await ffprobeJson(result.path);

  assert.equal(result.engine, "ffmpeg-mask-composite");
  assert.equal(fs.existsSync(result.path), true);
  assert.equal((probe.streams || []).some((stream) => stream.codec_type === "video"), true);
});

test("interactive cast smoke: cuts source clip for lip-sync windows", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-lipsync-smoke-"));
  const sourceVideo = path.join(root, "source.mp4");
  await createSyntheticClip(sourceVideo, "green", 2);

  const prepared = await prepareOriginalSegments({
    sourceVideo,
    editWindows: [
      { start: 0, end: 1, mode: "lipSyncOnly", reason: "new original actor line" },
      { start: 1, end: 2, mode: "audioOnly", reason: "dialogue overlay only" },
    ],
    projectDirectory: root,
  });

  assert.equal(fs.existsSync(prepared.segments[0].sourceClipPath), true);
  assert.equal(fs.existsSync(prepared.segments[1].path), true);
  assert.equal(prepared.readiness.ready, false);
  assert.equal(prepared.readiness.missing[0].mode, "lipSyncOnly");
});

test("interactive cast smoke: perceptual identity check passes on matching clips", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  if (!ffmpegStatus.available) {
    t.skip("FFmpeg non disponibile nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-identity-smoke-"));
  const sourceVideo = path.join(root, "source.mp4");
  const replacement = path.join(root, "replacement.mp4");
  await createSyntheticClip(sourceVideo, "purple", 1);
  await createSyntheticClip(replacement, "purple", 1);

  const report = await verifySegmentIdentity({
    segment: {
      id: "segment-1",
      sourceClipPath: sourceVideo,
      sourceClipRelativePath: "segments/source.mp4",
      replacementPath: replacement,
      start: 0,
      end: 1,
    },
    projectDirectory: root,
    threshold: 0.9,
    sampleCount: 2,
  });

  assert.equal(report.status, "passed");
  assert.ok(report.averageSimilarity >= 0.9);
  assert.equal(report.sampledFrames > 0, true);
});

test("interactive cast smoke: prepare dialogue audio task and mix overlay", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-audio-smoke-"));
  const baseAudio = path.join(root, "base.wav");
  const lineAudio = path.join(root, "line.wav");
  await createTone(baseAudio, 220, 2);
  await createTone(lineAudio, 880, 0.4);

  const prepared = await prepareDialogueAudioTasks({
    sourceAudio: { path: baseAudio },
    projectDirectory: root,
    dialogueEvents: [
      { id: "event-1", speaker: "Original Actor 1", start: 0.5, end: 1, dialogue: "New line." },
    ],
  });
  const tasks = prepared.tasks.map((task) => ({ ...task, replacementPath: lineAudio, status: "ready" }));
  const remix = await mixDialogueAudioTasks({
    sourceAudio: { path: baseAudio },
    tasks,
    projectDirectory: root,
  });
  const probe = await ffprobeJson(remix.path);

  assert.equal(fs.existsSync(remix.path), true);
  assert.ok(Number(probe.format?.duration || 0) >= 1.9);
  assert.equal(remix.mixStrategy, "duck-original-bed-with-dialogue-overlays");
  assert.equal(remix.overlayCount, 1);
});

test("interactive cast smoke: muxes dialogue remix audio into final mp4", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-mux-smoke-"));
  const video = path.join(root, "video.mp4");
  const audio = path.join(root, "dialogue-remix.wav");
  const output = path.join(root, "final.mp4");
  await createSyntheticClip(video, "orange", 1);
  await createTone(audio, 660, 1);

  await muxAudioIntoVideo({ video, audio, output });
  const probe = await ffprobeJson(output);
  const streams = probe.streams || [];

  assert.equal(fs.existsSync(output), true);
  assert.equal(streams.some((stream) => stream.codec_type === "video"), true);
  assert.equal(streams.some((stream) => stream.codec_type === "audio"), true);
});

test("interactive cast smoke: create FFmpeg fallback audio stems", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  if (!ffmpegStatus.available) {
    t.skip("FFmpeg non disponibile nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-stems-"));
  const sourceAudio = path.join(root, "source.wav");
  await createTone(sourceAudio, 440, 1);

  const result = await createFallbackAudioStems({
    sourceAudio: { path: sourceAudio },
    projectDirectory: root,
  });

  assert.equal(result.sourceSeparation, "FALLBACK");
  assert.equal(result.stems.filter((stem) => stem.relativePath).length, 3);
  for (const stem of result.stems) {
    if (stem.path) assert.equal(fs.existsSync(stem.path), true);
  }
});

test("interactive cast smoke: orchestrates analyze, minimal edit, remix and final MP4", async (t) => {
  const ffmpegStatus = await commandVersion("ffmpeg");
  const ffprobeStatus = await commandVersion("ffprobe");
  if (!ffmpegStatus.available || !ffprobeStatus.available) {
    t.skip("FFmpeg/FFprobe non disponibili nello smoke environment.");
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interactive-cast-e2e-"));
  const sourceVideo = path.join(root, "source.mp4");
  const replacementVideo = path.join(root, "replacement.mp4");
  const dialogueAudio = path.join(root, "new-actor-line.wav");
  const actorReference = path.join(root, "new-actor.png");
  await createSyntheticAvClip(sourceVideo, "black", 220, 3);
  await createSolidImage(actorReference, "yellow");

  const store = new InteractiveCastProjectStore({
    file: path.join(root, "projects.json"),
    assetDirectory: path.join(root, "projects"),
  });
  const orchestrator = new InteractiveCastOrchestrator({
    root,
    store,
    characterStore: null,
  });
  const sourceBuffer = fs.readFileSync(sourceVideo);
  const referenceBuffer = fs.readFileSync(actorReference);
  const created = await orchestrator.create({
    file: {
      originalname: "source.mp4",
      mimetype: "video/mp4",
      buffer: sourceBuffer,
      size: sourceBuffer.length,
    },
    temporaryActorReference: {
      originalname: "new-actor.png",
      mimetype: "image/png",
      buffer: referenceBuffer,
      size: referenceBuffer.length,
    },
    raw: {
      title: "Controlled Interactive Cast smoke",
      newActorName: "Sarah",
    },
  });

  const planned = orchestrator.plan(created.id, {
    anchorWorkflowId: "qwen-image-edit",
    newActorName: "Sarah",
    dialogueEvents: [{
      id: "new-actor-line",
      speaker: "New Actor",
      start: 1.2,
      end: 1.8,
      dialogue: "I thought you had already left.",
      action: "Sarah enters the scene and speaks.",
      mode: "generative",
      audioMode: "external",
      preserveVoice: true,
      preserveFace: true,
    }],
  });
  assert.deepEqual(
    planned.editWindows.map((window) => window.mode),
    ["original", "generative", "original"],
  );

  const prepared = await orchestrator.prepareSegments(created.id);
  const generatedSegment = prepared.renderPackage.segments.find((segment) => segment.requiredGenerated);
  assert.ok(generatedSegment, "la finestra generativa deve produrre un task segmento");
  assert.equal(prepared.renderPackage.segmentTasks.tasks[0].actorReferences[0].name, "Sarah");
  assert.equal(prepared.renderPackage.segmentTasks.tasks[0].anchorWorkflow.id, "qwen-image-edit");

  const generatedDuration = generatedSegment.end - generatedSegment.start;
  await createSyntheticAvClip(replacementVideo, "blue", 440, generatedDuration + 0.7);
  const attached = await orchestrator.attachGeneratedSegment(created.id, generatedSegment.id, {
    path: replacementVideo,
    originalName: "replacement-ltx.mp4",
    mimeType: "video/mp4",
    generationId: "controlled-ltx-job",
  });
  const attachedSegment = attached.renderPackage.segments.find((segment) => segment.id === generatedSegment.id);
  const attachedProbe = await ffprobeJson(attachedSegment.replacementPath);
  assert.ok(Number(attachedProbe.format?.duration || 0) <= generatedDuration + 0.2);
  assert.equal(attached.renderPackage.segmentTasks.tasks[0].generation.status, "completed");

  await createTone(dialogueAudio, 880, generatedDuration);
  const dialogueBuffer = fs.readFileSync(dialogueAudio);
  orchestrator.attachDialogueAudio(created.id, "new-actor-line", {
    originalname: "new-actor-line.wav",
    mimetype: "audio/wav",
    buffer: dialogueBuffer,
    size: dialogueBuffer.length,
  });

  const remixed = await orchestrator.remixAudio(created.id);
  assert.equal(remixed.outputs.dialogueRemix.overlayCount, 1);
  const completed = await orchestrator.concatFinal(created.id);
  const finalPath = completed.outputs.finalVideo.path;
  const probe = await ffprobeJson(finalPath);
  const streams = probe.streams || [];

  assert.equal(completed.status, "completed");
  assert.equal(completed.outputs.finalVideo.audioSource, "dialogueRemix");
  assert.equal(fs.existsSync(finalPath), true);
  assert.equal(streams.some((stream) => stream.codec_type === "video"), true);
  assert.equal(streams.some((stream) => stream.codec_type === "audio"), true);
  assert.ok(Number(probe.format?.duration || 0) > 2.5);
});
