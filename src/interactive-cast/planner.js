function number(value, fallback, min = 0, max = 3600) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function text(value, max = 2000) {
  return String(value || "").trim().slice(0, max);
}

const WINDOW_MODES = new Set(["original", "audioOnly", "lipSyncOnly", "composite", "generative"]);
const MODE_PRIORITY = new Map([
  ["original", 0],
  ["audioOnly", 1],
  ["lipSyncOnly", 2],
  ["composite", 3],
  ["generative", 4],
]);

function normalizedWindowMode(value) {
  const mode = String(value || "").trim();
  if (WINDOW_MODES.has(mode)) return mode;
  const lowered = mode.toLowerCase();
  if (["audio", "audio-only", "none", "no-visual", "offscreen"].includes(lowered)) return "audioOnly";
  if (["mouth", "face", "lips", "lip-sync", "lipsync"].includes(lowered)) return "lipSyncOnly";
  if (["regional", "region", "foreground", "overlay", "masked", "mask"].includes(lowered)) return "composite";
  if (["full", "scene", "body", "actor", "insert", "generative"].includes(lowered)) return "generative";
  return null;
}

function isNewActorEvent(event = {}) {
  return event.isNewActor === true
    || /new actor|nuovo|character:|temporaryReference|new-/i.test(String(event.speaker || event.actorId || ""));
}

function normalizedAudioMode(event = {}, visualMode = null) {
  const requested = String(event.audioMode || "").trim();
  if (["ltxNative", "external"].includes(requested)) return requested;
  return visualMode === "generative" || isNewActorEvent(event) ? "ltxNative" : "external";
}

export function eventEditMode(event = {}) {
  const explicitMode = normalizedWindowMode(event.mode || event.windowMode || event.visualMode || event.visualImpact);
  if (explicitMode && explicitMode !== "original") return explicitMode;
  if (isNewActorEvent(event)) return event.visualMode === "composite" ? "composite" : "generative";
  if (event.dialogue) {
    return event.preserveFace === false ? "audioOnly" : "lipSyncOnly";
  }
  if (["look", "move"].includes(event.reaction) || event.action) return "composite";
  return "audioOnly";
}

function priorityMode(a, b) {
  return (MODE_PRIORITY.get(a) || 0) >= (MODE_PRIORITY.get(b) || 0) ? a : b;
}

function mergeChangeWindows(changes = []) {
  const sorted = changes
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start || (MODE_PRIORITY.get(b.mode) || 0) - (MODE_PRIORITY.get(a.mode) || 0));
  const merged = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (!last) {
      merged.push({ ...window, reasons: [window.reason].filter(Boolean) });
      continue;
    }
    const coreOverlaps = Number(window.coreStart ?? window.start) < Number(last.coreEnd ?? last.end);
    if (!coreOverlaps) {
      merged.push({ ...window, reasons: [window.reason].filter(Boolean) });
      continue;
    }
    last.end = Math.max(last.end, window.end);
    last.coreEnd = Math.max(Number(last.coreEnd ?? last.end), Number(window.coreEnd ?? window.end));
    last.mode = priorityMode(last.mode, window.mode);
    if (window.reason) last.reasons.push(window.reason);
  }
  return merged.map((window) => ({
    start: window.start,
    end: window.end,
    mode: window.mode,
    reason: [...new Set(window.reasons)].join(" | ").slice(0, 360),
  }));
}

export function normalizeDialogueEvents(rawEvents = [], duration = 0) {
  const events = Array.isArray(rawEvents) ? rawEvents : [];
  return events.map((event, index) => {
    const start = number(event.start, index * 2, 0, duration || 3600);
    const end = number(event.end, Math.min((duration || start + 2), start + 2), start, duration || 3600);
    const mode = normalizedWindowMode(event.mode || event.windowMode || event.visualMode || event.visualImpact);
    return {
      id: event.id || `event-${index + 1}`,
      speaker: text(event.speaker, 120) || "New Actor",
      actorId: text(event.actorId, 120),
      isNewActor: event.isNewActor === true,
      start,
      end,
      dialogue: text(event.dialogue, 800),
      action: text(event.action, 800),
      preserveVoice: event.preserveVoice !== false,
      preserveFace: event.preserveFace !== false,
      mode,
      audioMode: normalizedAudioMode(event, mode),
      reaction: ["none", "look", "speak", "move"].includes(event.reaction) ? event.reaction : "none",
    };
  }).filter((event) => event.dialogue || event.action);
}

function matchAddedActors(dialogueEvents = [], addedActors = []) {
  const actors = addedActors.map((actor) => ({
    actorId: text(actor.actorId, 120),
    aliases: [actor.actorId, actor.name, actor.label]
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .filter(Boolean),
  }));
  return dialogueEvents.map((event) => {
    const speaker = String(event.speaker || event.actorId || "").trim().toLocaleLowerCase();
    const actor = actors.find((item) => item.aliases.includes(speaker));
    if (!actor && !isNewActorEvent(event)) return event;
    return {
      ...event,
      actorId: actor?.actorId || event.actorId || "new-actor-1",
      isNewActor: true,
    };
  });
}

export function planEditWindows({ duration = 0, dialogueEvents = [] } = {}) {
  const windows = [];
  let cursor = 0;
  const totalDuration = duration || Math.max(0, ...dialogueEvents.map((event) => Number(event.end || 0))) || 0;
  const changes = mergeChangeWindows(dialogueEvents.map((event) => {
    const pad = eventEditMode(event) === "audioOnly" ? 0.08 : 0.35;
    return {
      start: Math.max(0, event.start - pad),
      end: Math.min(totalDuration || event.end + pad, event.end + pad),
      coreStart: event.start,
      coreEnd: event.end,
      mode: eventEditMode(event),
      reason: `${event.speaker}: ${event.action || event.dialogue}`.slice(0, 240),
    };
  }));
  for (const change of changes) {
    const start = Math.max(cursor, change.start);
    const end = Math.max(start, change.end);
    if (start > cursor) {
      windows.push({ start: cursor, end: start, mode: "original", reason: "no requested change" });
    }
    windows.push({ start, end, mode: change.mode, reason: change.reason });
    cursor = Math.max(cursor, end);
  }
  if (totalDuration > cursor) {
    windows.push({ start: cursor, end: totalDuration, mode: "original", reason: "preserve source footage" });
  }
  return windows.filter((window) => window.end > window.start);
}

export function buildInteractiveCastPlan({ project, raw = {} }) {
  const normalizedEvents = normalizeDialogueEvents(raw.dialogueEvents || project.dialogueEvents, project.analysis?.duration || 0);
  const dialogueEvents = matchAddedActors(normalizedEvents, project.actors?.added || []);
  const editWindows = planEditWindows({ duration: project.analysis?.duration || 0, dialogueEvents });
  return {
    projectId: project.id,
    type: "interactiveCast",
    sourceVideo: project.sourceVideo,
    actors: {
      original: project.actors?.original || [],
      added: project.actors?.added || [],
    },
    dialogueEvents,
    editWindows,
    audio: {
      preserveAmbience: raw.preserveAmbience !== false,
      preserveMusic: raw.preserveMusic !== false,
    },
    outputs: {},
    status: "planned",
  };
}

export function validateInteractiveCastAssistantPlan(plan = {}, { duration = 0 } = {}) {
  const dialogueEvents = normalizeDialogueEvents(plan.dialogueEvents || [], duration);
  return {
    actors: {
      original: Array.isArray(plan.actors?.original) ? plan.actors.original.slice(0, 12).map((actor, index) => ({
        actorId: text(actor.actorId, 80) || `original-${index + 1}`,
        label: text(actor.label || actor.name, 120) || `Original Actor ${index + 1}`,
        notes: text(actor.notes, 500),
      })) : [],
      added: Array.isArray(plan.actors?.added) ? plan.actors.added.slice(0, 8).map((actor, index) => ({
        actorId: text(actor.actorId, 80) || `new-${index + 1}`,
        name: text(actor.name, 120) || `New Actor ${index + 1}`,
        entranceTime: number(actor.entranceTime, 0, 0, duration || 3600),
        description: text(actor.description, 800),
      })) : [],
    },
    dialogueEvents,
    editWindows: planEditWindows({ duration, dialogueEvents }),
    notes: Array.isArray(plan.notes)
      ? plan.notes.map((item) => text(item, 500)).filter(Boolean).slice(0, 8)
      : [],
  };
}
