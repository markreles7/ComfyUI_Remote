import fs from "node:fs";
import path from "node:path";
import { compositeVideoWithMask, concatVideoSegments, cutVideoSegment, extractFrame } from "./ffmpeg.js";

export function compositingPlanFallback(plan) {
  return {
    status: "FALLBACK",
    method: "ffmpeg-splice-plan",
    steps: (plan.editWindows || []).map((window, index) => ({
      index,
      start: window.start,
      end: window.end,
      mode: window.mode,
      action: window.mode === "original"
        ? "copy original segment"
        : "requires generated/lipsynced segment before final splice",
    })),
  };
}

function safeSegmentName(index, mode) {
  return `${String(index + 1).padStart(3, "0")}-${String(mode || "segment").replace(/[^\w-]+/g, "_")}.mp4`;
}

export function segmentManifest({ editWindows = [], segmentDirectory, sourceVideo }) {
  return editWindows.map((window, index) => {
    const mode = String(window.mode || "original");
    const requiresVideoReplacement = !["original", "audioOnly"].includes(mode);
    const requiredGenerated = requiresVideoReplacement;
    const filename = safeSegmentName(index, window.mode);
    const sourceClipPath = requiredGenerated ? path.join(segmentDirectory, `source-${filename}`) : null;
    return {
      id: `segment-${index + 1}`,
      index,
      start: window.start,
      end: window.end,
      mode,
      reason: window.reason,
      source: requiredGenerated ? "source-clip-plus-replacement" : "original",
      status: requiredGenerated ? "waiting_for_ai_segment" : "ready",
      requiredGenerated,
      requiresVideoReplacement,
      path: requiredGenerated ? null : path.join(segmentDirectory, filename),
      relativePath: requiredGenerated ? null : `segments/${filename}`,
      sourceClipPath,
      sourceClipRelativePath: sourceClipPath ? `segments/source-${filename}` : null,
      replacementPath: null,
      sourceVideo,
    };
  });
}

export function finalSpliceReadiness(segments = []) {
  const missing = segments.filter((segment) =>
    (segment.requiresVideoReplacement ?? segment.requiredGenerated) && !segment.replacementPath
  );
  return {
    ready: missing.length === 0 && segments.length > 0,
    missing: missing.map((segment) => ({
      id: segment.id,
      mode: segment.mode,
      start: segment.start,
      end: segment.end,
      reason: segment.reason,
      sourceClipRelativePath: segment.sourceClipRelativePath || null,
    })),
  };
}

function actorReferenceLines(actorReferences = []) {
  return actorReferences.map((actor, index) => {
    const hints = actor.identityHints || {};
    const locks = actor.locks || {};
    return [
      `Added actor ${index + 1}: ${actor.name || actor.actorId || "New Actor"} (${actor.type || "reference"}).`,
      actor.description ? `Persistent identity: ${actor.description}` : "",
      hints.face ? `Face: ${hints.face}` : "",
      hints.hair ? `Hair: ${hints.hair}` : "",
      hints.body ? `Body/proportions: ${hints.body}` : "",
      Array.isArray(actor.wardrobe) && actor.wardrobe.length ? `Wardrobe cues: ${actor.wardrobe.join(", ")}` : "",
      actor.reference?.relativePath ? `Use temporary reference image: ${actor.reference.relativePath}` : "",
      actor.characterPack?.status ? `Character Pack status: ${actor.characterPack.status}; references: ${actor.characterPack.referenceCount || 0}.` : "",
      Object.values(locks).some(Boolean)
        ? `Locked identity traits: ${Object.entries(locks).filter(([, value]) => value).map(([key]) => key).join(", ")}.`
        : "",
    ].filter(Boolean).join(" ");
  }).filter(Boolean);
}

function segmentPrompt(segment, actorReferences = []) {
  const base = [
    `Create only the replacement video segment from ${Number(segment.start || 0).toFixed(2)}s to ${Number(segment.end || 0).toFixed(2)}s.`,
    `Mode: ${segment.mode}.`,
    `Required change: ${segment.reason || "perform the planned Interactive Cast edit"}.`,
    "Preserve the source video's camera angle, lens, lighting, background layout, original actors, clothing continuity, motion rhythm and ambience unless the segment reason explicitly changes them.",
  ];
  const references = actorReferenceLines(actorReferences);
  if (references.length) {
    base.push("Use these added actor references as hard identity guidance for any new character introduced in this window.");
    base.push(...references);
  }
  if (segment.mode === "generative") {
    base.push("Use the anchor frame as the visual starting point and add or modify only the planned character/action inside this time window.");
  } else if (segment.mode === "lipSyncOnly") {
    base.push("Keep the original frame and performance stable; change only the mouth/face region required for the new dialogue.");
  } else if (segment.mode === "composite") {
    base.push("Generate only the foreground/action layer needed for the planned change. The final segment will be composited over the preserved source clip with a feathered mask.");
  } else if (segment.mode === "audioOnly") {
    base.push("No visual regeneration should be needed; prepare or replace only the dialogue/audio layer for this time window.");
  }
  return base.join(" ");
}

function segmentNegativePrompt(segment) {
  return [
    "identity drift",
    "face morphing",
    "changed camera",
    "changed background",
    "changed clothing",
    "extra people",
    "temporal flicker",
    "warped anatomy",
    "unsynchronized lips",
    "subtitles",
    "watermark",
    `do not alter content outside ${Number(segment.start || 0).toFixed(2)}-${Number(segment.end || 0).toFixed(2)} seconds`,
  ].join(", ");
}

const ANCHOR_WORKFLOWS = new Map([
  ["qwen-image-edit", {
    id: "qwen-image-edit",
    label: "Qwen Image Edit",
    capability: "image-edit-anchor",
    requirement: "Use Qwen Image Edit with the extracted anchor frame as source image and the Character Pack/reference images as visual guidance.",
  }],
  ["qwen-krea-klein", {
    id: "qwen-krea-klein",
    label: "Qwen/Krea/Klein",
    capability: "combined-image-anchor",
    requirement: "Use the Qwen/Krea/Klein combined Image Studio workflow: Qwen for the actor insertion edit, Krea for primary refinement, Klein for secondary refinement.",
  }],
  ["krea-triple", {
    id: "krea-triple",
    label: "Krea Triple",
    capability: "krea-triple-anchor",
    requirement: "Use Krea Triple Studio as the anchor still workflow and keep the extracted source frame geometry unchanged.",
  }],
]);

function anchorWorkflowInfo(anchorWorkflowId = "qwen-image-edit") {
  const id = String(anchorWorkflowId || "qwen-image-edit").trim().toLowerCase();
  return ANCHOR_WORKFLOWS.get(id) || ANCHOR_WORKFLOWS.get("qwen-image-edit");
}

export async function prepareMissingSegmentTasks({
  sourceVideo,
  segments = [],
  projectDirectory,
  actorReferences = [],
  anchorWorkflowId = "qwen-image-edit",
}) {
  const taskDirectory = path.join(projectDirectory, "segment-tasks");
  fs.mkdirSync(taskDirectory, { recursive: true });
  const tasks = [];
  for (const segment of segments) {
    if (!segment.requiredGenerated) continue;
    const safeId = segment.id.replace(/[^\w-]+/g, "_");
    const anchorFilename = `${safeId}-anchor.jpg`;
    const anchorPath = path.join(taskDirectory, anchorFilename);
    let anchor = null;
    const anchorWorkflow = anchorWorkflowInfo(anchorWorkflowId);
    try {
      await extractFrame({ input: sourceVideo, output: anchorPath, time: segment.start });
      anchor = {
        path: anchorPath,
        relativePath: `segment-tasks/${anchorFilename}`,
        filename: anchorFilename,
        time: segment.start,
        mimeType: "image/jpeg",
        status: "source-frame-extracted",
        workflow: anchorWorkflow,
      };
    } catch (error) {
      anchor = { error: error.message, time: segment.start, workflow: anchorWorkflow };
    }
    tasks.push({
      segmentId: segment.id,
      mode: segment.mode,
      start: segment.start,
      end: segment.end,
      duration: Math.max(0, Number(segment.end || 0) - Number(segment.start || 0)),
      reason: segment.reason,
      requiredEngine: segment.mode === "generative"
        ? "LTX I2V / Interactive Cast generative segment"
        : segment.mode === "lipSyncOnly"
          ? "Lip-sync engine"
          : "Voice/audio engine",
      anchorFrame: anchor,
      anchorWorkflow,
      anchorRequirement: [
        anchorWorkflow.requirement,
        "Start from the provided source-frame anchor; preserve original actors, background, perspective, lighting and camera.",
        actorReferences.length
          ? "Insert or preserve the added actor according to actorReferences before using this still as the first frame for the video segment."
          : "If no added actor reference is present, use the segment reason only and keep the scene stable.",
      ].join(" "),
      actorReferences,
      prompt: segmentPrompt(segment, actorReferences),
      negativePrompt: segmentNegativePrompt(segment),
      referenceRequirement: actorReferences.length
        ? "Use the listed Character Pack or temporary actor reference as identity guidance; do not invent a different person for the added actor."
        : "No added actor reference is attached to this task.",
      outputRequirement: "Upload the finished MP4 back into this segment slot with the same duration, fps and framing as the source segment.",
      compositeRequirement: segment.mode === "composite"
        ? "Preferred path: upload an overlay MP4 plus a black/white mask image; Interactive Cast can feather the mask and composite it over the preserved source clip."
        : null,
    });
  }
  return {
    taskDirectory,
    tasks,
    generatedAt: new Date().toISOString(),
  };
}

export async function applyMaskedCompositeSegment({ segment, overlayVideo, maskImage, outputPath, feather = 7 }) {
  if (!segment?.sourceClipPath || !fs.existsSync(segment.sourceClipPath)) {
    throw new Error("Source clip preservata mancante per il compositing.");
  }
  if (!overlayVideo || !fs.existsSync(overlayVideo)) {
    throw new Error("Overlay video mancante per il compositing.");
  }
  if (!maskImage || !fs.existsSync(maskImage)) {
    throw new Error("Maschera immagine mancante per il compositing.");
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await compositeVideoWithMask({
    baseVideo: segment.sourceClipPath,
    overlayVideo,
    maskImage,
    output: outputPath,
    feather,
  });
  return {
    path: outputPath,
    filename: path.basename(outputPath),
    mimeType: "video/mp4",
    engine: "ffmpeg-mask-composite",
    feather: Math.max(0, Math.min(40, Number(feather) || 0)),
  };
}

export async function prepareOriginalSegments({ sourceVideo, editWindows, projectDirectory }) {
  const segmentDirectory = path.join(projectDirectory, "segments");
  fs.mkdirSync(segmentDirectory, { recursive: true });
  const segments = segmentManifest({ editWindows, segmentDirectory, sourceVideo });
  for (const segment of segments) {
    const output = segment.requiredGenerated ? segment.sourceClipPath : segment.path;
    if (!output) continue;
    await cutVideoSegment({
      input: sourceVideo,
      output,
      start: segment.start,
      end: segment.end,
    });
  }
  return {
    segmentDirectory,
    segments,
    readiness: finalSpliceReadiness(segments),
  };
}

export async function concatReadySegments({ segments, manifestPath, outputPath }) {
  const readiness = finalSpliceReadiness(segments);
  if (!readiness.ready) {
    const error = new Error("La ricomposizione finale richiede ancora segmenti AI/lip-sync mancanti.");
    error.missing = readiness.missing;
    throw error;
  }
  const lines = segments.map((segment) => {
    const file = segment.replacementPath || segment.path;
    return `file '${String(file).replaceAll("'", "'\\''")}'`;
  });
  fs.writeFileSync(manifestPath, `${lines.join("\n")}\n`);
  await concatVideoSegments({ manifest: manifestPath, output: outputPath });
  return outputPath;
}
