import fs from "node:fs";
import path from "node:path";
import { cutAudioSegmentWav, mixAudioOverlays } from "./ffmpeg.js";

function safeId(value) {
  return String(value || "event").replace(/[^\w-]+/g, "_");
}

function isNewActorEvent(event = {}) {
  return event.isNewActor === true
    || /new actor|nuovo|character:|temporaryReference|new-/i.test(String(event.speaker || event.actorId || ""));
}

export function selectVoiceReferenceWindow(event, speakers = []) {
  const speakerId = String(event?.speaker || "").trim();
  const matches = speakers
    .filter((speaker) => String(speaker?.assignedActorId || "").trim() === speakerId)
    .map((speaker) => ({
      start: Math.max(0, Number(speaker.start) || 0),
      end: Math.max(0, Number(speaker.end) || 0),
      speaker: String(speaker.speaker || ""),
    }))
    .filter((window) => window.end > window.start)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start));
  if (!matches.length) return null;
  const selected = matches[0];
  return {
    ...selected,
    end: Math.min(selected.end, selected.start + 12),
    method: "assigned-speaker-window",
  };
}

export function audioTaskReadiness(tasks = []) {
  const missing = tasks.filter((task) => task.requiresDialogueAudio && !task.replacementPath);
  return {
    ready: missing.length === 0,
    missing: missing.map((task) => ({
      eventId: task.eventId,
      speaker: task.speaker,
      start: task.start,
      end: task.end,
      dialogue: task.dialogue,
    })),
  };
}

export async function prepareDialogueAudioTasks({
  sourceAudio,
  dialogueEvents = [],
  speakers = [],
  projectDirectory,
}) {
  const taskDirectory = path.join(projectDirectory, "dialogue-audio-tasks");
  fs.mkdirSync(taskDirectory, { recursive: true });
  const tasks = [];

  for (const event of dialogueEvents) {
    if (!event.dialogue) continue;
    const eventId = safeId(event.id);
    const start = Math.max(0, Number(event.start) || 0);
    const end = Math.max(start + 0.05, Number(event.end) || start + 1.5);
    const speakerIsNew = isNewActorEvent(event);
    const assignedVoiceWindow = selectVoiceReferenceWindow(event, speakers);
    let referenceAudio = null;

    if (!speakerIsNew && sourceAudio?.path) {
      const referenceFilename = `${eventId}-reference.wav`;
      const referencePath = path.join(taskDirectory, referenceFilename);
      try {
        await cutAudioSegmentWav({
          input: sourceAudio.path,
          output: referencePath,
          start: assignedVoiceWindow?.start ?? start,
          end: assignedVoiceWindow?.end ?? end,
        });
        referenceAudio = {
          path: referencePath,
          relativePath: `dialogue-audio-tasks/${referenceFilename}`,
          filename: referenceFilename,
          mimeType: "audio/wav",
          start: assignedVoiceWindow?.start ?? start,
          end: assignedVoiceWindow?.end ?? end,
          method: assignedVoiceWindow?.method || "event-window-fallback",
          sourceSpeaker: assignedVoiceWindow?.speaker || null,
        };
      } catch (error) {
        referenceAudio = {
          error: error.message,
          start,
          end,
        };
      }
    }

    tasks.push({
      eventId,
      sourceEventId: event.id,
      speaker: event.speaker,
      actorId: event.actorId || null,
      isNewActor: speakerIsNew,
      start,
      end,
      duration: Math.max(0.05, end - start),
      dialogue: event.dialogue,
      action: event.action,
      preserveVoice: event.preserveVoice !== false,
      requiresDialogueAudio: true,
      requiredEngine: speakerIsNew
        ? "New actor dialogue TTS / uploaded voice line"
        : "Reference-conditioned voice clone / uploaded voice line",
      status: "waiting_for_dialogue_audio",
      referenceAudio,
      replacementPath: null,
      replacementRelativePath: null,
      outputRequirement: "Upload a WAV/MP3/M4A dialogue line matching this event. The original ambience will be preserved and this line can be mixed at the event timestamp.",
      mix: {
        strategy: "duck-original-bed",
        dialogueVolume: 1,
        duckVolume: 0.45,
        fadeIn: 0.035,
        fadeOut: 0.05,
      },
    });
  }

  return {
    taskDirectory,
    tasks,
    readiness: audioTaskReadiness(tasks),
    generatedAt: new Date().toISOString(),
  };
}

export async function mixDialogueAudioTasks({ sourceAudio, tasks = [], projectDirectory }) {
  if (!sourceAudio?.path) {
    throw new Error("Audio sorgente non disponibile per il remix.");
  }
  const readiness = audioTaskReadiness(tasks);
  if (!readiness.ready) {
    const error = new Error("Il remix audio richiede ancora battute sintetizzate/caricate.");
    error.missing = readiness.missing;
    throw error;
  }
  const outputDirectory = path.join(projectDirectory, "audio-remix");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const outputPath = path.join(outputDirectory, "dialogue-remix.wav");
  await mixAudioOverlays({
    baseAudio: sourceAudio.path,
    overlays: tasks
      .filter((task) => task.replacementPath)
      .map((task) => ({
        input: task.replacementPath,
        start: task.start,
        end: task.end,
        duration: task.duration,
        volume: task.mix?.dialogueVolume ?? 1,
        duckVolume: task.mix?.duckVolume ?? 0.45,
        fadeIn: task.mix?.fadeIn ?? 0.035,
        fadeOut: task.mix?.fadeOut ?? 0.05,
      })),
    output: outputPath,
  });
  return {
    path: outputPath,
    relativePath: "audio-remix/dialogue-remix.wav",
    filename: "dialogue-remix.wav",
    mimeType: "audio/wav",
    mixStrategy: "duck-original-bed-with-dialogue-overlays",
    overlayCount: tasks.filter((task) => task.replacementPath).length,
    createdAt: new Date().toISOString(),
  };
}
