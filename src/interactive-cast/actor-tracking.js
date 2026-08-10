import path from "node:path";
import { runPythonJson } from "./python-tools.js";

export function fallbackActorTracks(analysis) {
  return {
    configured: false,
    engine: "manual-assignment-fallback",
    actors: [
      {
        actorId: "original-1",
        label: "Original Actor 1",
        frames: [],
        boundingBoxes: [],
        confidence: 0,
        firstSeen: 0,
        lastSeen: analysis?.duration || 0,
        status: "manual-label-required",
      },
    ],
    warnings: [
      "Person tracking engine is not configured yet. Milestone 1 keeps a manual actor slot so dialogue planning can proceed.",
    ],
  };
}

function normalizeTrackedActors(payload, analysis) {
  const actors = Array.isArray(payload?.actors) ? payload.actors : [];
  return actors.map((actor, index) => ({
    actorId: actor.actorId || `original-${index + 1}`,
    label: actor.label || `Original Actor ${index + 1}`,
    frames: Array.isArray(actor.frames) ? actor.frames : [],
    boundingBoxes: Array.isArray(actor.boundingBoxes) ? actor.boundingBoxes : [],
    confidence: Number.isFinite(Number(actor.confidence)) ? Number(actor.confidence) : 0,
    firstSeen: Number.isFinite(Number(actor.firstSeen)) ? Number(actor.firstSeen) : 0,
    lastSeen: Number.isFinite(Number(actor.lastSeen)) ? Number(actor.lastSeen) : analysis?.duration || 0,
    status: actor.status || "detected",
    references: Array.isArray(actor.references) ? actor.references : [],
  }));
}

export async function detectActorTracks({ root, videoPath, analysis, outputDirectory } = {}) {
  const fallback = fallbackActorTracks(analysis);
  const result = await runPythonJson({
    root,
    scriptName: "track.py",
    args: [
      "--video", videoPath,
      "--sample-step", "0.5",
      "--max-frames", "240",
      ...(outputDirectory ? ["--output-dir", outputDirectory] : []),
    ],
    timeout: 300_000,
  });
  if (!result.ok) {
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        `Tracker OpenCV non disponibile: ${result.error}`,
      ],
    };
  }
  const actors = normalizeTrackedActors(result.data, analysis).map((actor) => ({
    ...actor,
    references: (actor.references || []).map((reference) => ({
      ...reference,
      relativePath: outputDirectory && reference.path
        ? path.relative(path.dirname(outputDirectory), reference.path).replaceAll(path.sep, "/")
        : reference.relativePath || null,
    })),
  }));
  if (!result.data?.configured || !actors.length) {
    return {
      ...fallback,
      engine: result.data?.engine || fallback.engine,
      warnings: [
        ...(result.data?.warnings || []),
        ...fallback.warnings,
      ],
    };
  }
  return {
    configured: true,
    engine: result.data.engine || "opencv-hog",
    actors,
    sampledFrames: result.data.sampledFrames || null,
    warnings: result.data.warnings || [],
  };
}

export function buildOriginalActorReferencePack({ actor, frames = [] } = {}) {
  const tracked = (actor?.references || []).filter((reference) => reference.path);
  const trackedFace = tracked.filter((reference) => reference.type === "face");
  const trackedBody = tracked.filter((reference) => reference.type === "body");
  const usable = frames.filter((frame) => frame.relativePath && !frame.error);
  return {
    actorId: actor?.actorId || "original-1",
    status: "manual-review",
    method: tracked.length ? "tracked-actor-crops" : "reference-frame-sampling",
    references: {
      face: trackedFace.length
        ? trackedFace.slice(0, 3)
        : usable.slice(0, 2).map((frame) => ({ ...frame, type: "face-candidate" })),
      body: trackedBody.length
        ? trackedBody.slice(0, 3)
        : usable.slice(1, 3).map((frame) => ({ ...frame, type: "body-candidate" })),
      generic: usable.map((frame) => ({ ...frame, type: "scene-reference" })),
    },
    warnings: [
      tracked.length
        ? "Actor-specific face/body crops selected by tracking confidence and local sharpness; manual review is still recommended."
        : "Reference pack generated from sampled frames only because no stable actor crop was available.",
    ],
  };
}
