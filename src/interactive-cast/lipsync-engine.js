import fs from "node:fs";
import path from "node:path";
import { runPythonJson } from "./python-tools.js";

export function lipsyncCapabilities({ root, toolDirectory } = {}) {
  const directory = toolDirectory || path.join(root || process.cwd(), ".tools", "interactive-cast");
  const script = path.join(directory, "scripts", "lipsync.py");
  const python = process.platform === "win32"
    ? path.join(directory, ".venv-lipsync", "Scripts", "python.exe")
    : path.join(directory, ".venv-lipsync", "bin", "python");
  const engineDirectory = path.join(directory, "engines", "musetalk");
  const modelFiles = [
    path.join(engineDirectory, "models", "musetalkV15", "unet.pth"),
    path.join(engineDirectory, "models", "musetalkV15", "musetalk.json"),
    path.join(engineDirectory, "models", "whisper", "pytorch_model.bin"),
    path.join(engineDirectory, "models", "sd-vae", "diffusion_pytorch_model.bin"),
    path.join(engineDirectory, "models", "face-parse-bisent", "79999_iter.pth"),
    path.join(directory, "cache", "torch", "hub", "checkpoints", "s3fd-619a316812.pth"),
  ];
  const adapterReady = fs.existsSync(script) && fs.existsSync(python) && fs.existsSync(engineDirectory);
  const configured = adapterReady && modelFiles.every((file) => fs.existsSync(file));
  return {
    primaryEngine: adapterReady ? "musetalk-1.5" : null,
    fallbackEngine: null,
    status: configured ? "READY" : adapterReady ? "FALLBACK" : "NOT CONFIGURED",
    applyLipSync: configured,
    script,
    python,
    engineDirectory,
    modelFiles,
    reason: configured
      ? "MuseTalk 1.5 adapter, isolated Python environment and required model files are ready."
      : adapterReady
        ? "MuseTalk adapter installed, but one or more required model files are missing."
        : "No local lip-sync engine has been installed in .tools/interactive-cast.",
  };
}

export class LipSyncEngineNotConfiguredError extends Error {
  constructor(message = "Lip-sync locale non configurato.") {
    super(message);
    this.name = "LipSyncEngineNotConfiguredError";
    this.statusCode = 409;
    this.code = "LIPSYNC_ENGINE_NOT_CONFIGURED";
  }
}

export async function applyLipSync({
  root,
  toolDirectory,
  video,
  audio,
  outputDirectory,
  segmentId = "segment",
  actorMask = null,
  start = 0,
  end = 0,
  options = {},
} = {}) {
  const capabilities = lipsyncCapabilities({ root, toolDirectory });
  if (!capabilities.applyLipSync) {
    throw new LipSyncEngineNotConfiguredError(
      "Lip-sync locale non configurato: installa/collega .tools/interactive-cast/scripts/lipsync.py oppure carica manualmente un MP4 lip-sync."
    );
  }
  if (!video?.path || !fs.existsSync(video.path)) throw new Error("Source clip lip-sync mancante.");
  if (!audio?.path || !fs.existsSync(audio.path)) throw new Error("Audio guida lip-sync mancante.");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, `${String(segmentId).replace(/[^\w-]+/g, "_")}-lipsync.mp4`);
  const args = [
    "--video", video.path,
    "--audio", audio.path,
    "--output", output,
    "--start", Number(start || 0),
    "--end", Number(end || 0),
  ];
  if (actorMask?.path) args.push("--mask", actorMask.path);
  const result = await runPythonJson({
    root,
    toolDirectory,
    scriptName: "lipsync.py",
    args,
    timeout: Number(options.timeout || 900_000),
    environment: "lipsync",
  });
  if (!result.ok) {
    const error = new Error(result.error || "Lip-sync locale fallito.");
    error.statusCode = 500;
    throw error;
  }
  const generatedPath = result.data?.path || result.data?.output || output;
  if (!fs.existsSync(generatedPath)) {
    throw new Error("Il lip-sync engine ha terminato senza produrre il file MP4 richiesto.");
  }
  return {
    path: generatedPath,
    mimeType: result.data?.mimeType || "video/mp4",
    engine: result.data?.engine || capabilities.primaryEngine,
    metadata: result.data || {},
  };
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return Math.max(Number(aStart || 0), Number(bStart || 0)) < Math.min(Number(aEnd || 0), Number(bEnd || 0));
}

function eventSpeakerLabel(event = {}) {
  return String(event.speaker || event.actorId || "Original Actor").trim();
}

function audioForEvent(audioTasks = [], event = {}) {
  return audioTasks.find((task) =>
    task.eventId === event.id ||
    task.sourceEventId === event.id ||
    (
      rangesOverlap(task.start, task.end, event.start, event.end) &&
      String(task.speaker || "").trim() === eventSpeakerLabel(event)
    )
  ) || null;
}

export function lipSyncTaskReadiness(tasks = []) {
  const missing = tasks.filter((task) => !task.replacementPath && !task.segmentReplacementPath);
  return {
    ready: missing.length === 0,
    missing: missing.map((task) => ({
      taskId: task.taskId,
      segmentId: task.segmentId,
      eventId: task.eventId,
      start: task.start,
      end: task.end,
      speaker: task.speaker,
      reason: task.reason,
    })),
  };
}

export function prepareLipSyncTasks({
  segments = [],
  dialogueEvents = [],
  audioTasks = [],
} = {}) {
  const tasks = [];
  for (const segment of segments) {
    if (segment.mode !== "lipSyncOnly") continue;
    const matchingEvents = dialogueEvents.filter((event) =>
      rangesOverlap(segment.start, segment.end, event.start, event.end)
    );
    const event = matchingEvents.find((item) => !/new actor/i.test(eventSpeakerLabel(item))) || matchingEvents[0] || null;
    const audioTask = event ? audioForEvent(audioTasks, event) : null;
    const replacementPath = segment.replacementPath || null;
    tasks.push({
      taskId: `lipsync-${segment.id}`,
      segmentId: segment.id,
      eventId: event?.id || null,
      speaker: event ? eventSpeakerLabel(event) : "Original Actor",
      start: segment.start,
      end: segment.end,
      duration: Math.max(0, Number(segment.end || 0) - Number(segment.start || 0)),
      mode: segment.mode,
      reason: segment.reason,
      status: replacementPath ? "ready" : "waiting_for_lipsync_video",
      requiredEngine: "Local lip-sync engine / uploaded lip-sync segment",
      sourceClipPath: segment.sourceClipPath || null,
      sourceClipRelativePath: segment.sourceClipRelativePath || null,
      dialogueAudioPath: audioTask?.replacementPath || null,
      dialogueAudioRelativePath: audioTask?.replacementRelativePath || null,
      referenceAudio: audioTask?.referenceAudio || null,
      replacementPath,
      replacementRelativePath: segment.replacementRelativePath || null,
      instructions: [
        "Use the source clip as the video input and the dialogue audio as the driving audio.",
        "Preserve the original actor identity, body, clothing, background, camera, lighting and timing.",
        "Modify only the mouth and nearby face region needed for the new line.",
        "Return an MP4 with exactly the same duration, fps, dimensions and framing as the source clip.",
      ].join(" "),
      outputRequirement: "Upload the finished lip-sync MP4 into the same segment slot before final concat.",
    });
  }
  const readiness = lipSyncTaskReadiness(tasks);
  return {
    status: tasks.length ? (readiness.ready ? "ready" : "waitingForLipSyncSegments") : "notRequired",
    tasks,
    readiness,
    generatedAt: new Date().toISOString(),
  };
}
