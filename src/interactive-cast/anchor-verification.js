import fs from "node:fs";
import path from "node:path";
import { runPythonJson } from "./python-tools.js";

const SLOT_REGIONS = {
  left: { x: 0.04, y: 0.12, width: 0.30, height: 0.76, label: "left" },
  center: { x: 0.35, y: 0.12, width: 0.25, height: 0.76, label: "center" },
  right: { x: 0.66, y: 0.12, width: 0.30, height: 0.76, label: "right" },
};

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function intersectionArea(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function personAreaFromFace(face = {}) {
  const [x, y, width, height] = face.normalizedBox || [];
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x: clamp(x - width * 1.15),
    y: clamp(y - height * 0.55),
    width: clamp(width * 3.3, 0.08, 0.48),
    height: clamp(height * 5.0, 0.30, 0.90),
  };
}

function requestedSide(instruction = "") {
  const value = String(instruction).toLowerCase();
  if (/\bfrom the right\b|\bda destra\b|\bsul lato destro\b/.test(value)) return "right";
  if (/\bfrom the left\b|\bda sinistra\b|\bsul lato sinistro\b/.test(value)) return "left";
  return "center";
}

export function selectAnchorPlacement({ faces = [], instruction = "", attempt = 1 } = {}) {
  const occupied = faces.map(personAreaFromFace).filter(Boolean);
  const preferred = requestedSide(instruction);
  const scored = Object.entries(SLOT_REGIONS).map(([name, region]) => {
    const area = region.width * region.height;
    const occupancy = occupied.reduce((sum, item) => sum + intersectionArea(region, item), 0) / area;
    const preferencePenalty = name === preferred ? 0 : 0.08;
    return { name, region: { ...region }, occupancy, score: occupancy + preferencePenalty };
  }).sort((a, b) => a.score - b.score);
  const index = Math.min(Math.max(0, Number(attempt || 1) - 1), scored.length - 1);
  const selected = scored[index];
  return {
    ...selected.region,
    label: `${selected.name}-safe`,
    requested: preferred,
    occupancy: Number(selected.occupancy.toFixed(4)),
    overridden: selected.name !== preferred,
    candidates: scored.map((item) => ({
      label: item.name,
      occupancy: Number(item.occupancy.toFixed(4)),
    })),
  };
}

export function insightFaceModelRoot(outputDirectory = "") {
  const configured = String(process.env.INTERACTIVE_CAST_INSIGHTFACE_ROOT || "").trim();
  const candidates = [
    configured,
    outputDirectory ? path.resolve(outputDirectory, "..", "..", "..", "Models", "insightface") : "",
    "E:\\ComfyUI\\Data\\Models\\insightface",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "models", "buffalo_l", "w600k_r50.onnx"))) || "";
}

async function runAnchorTool({ root, outputDirectory, mode, sourcePath, candidatePath, referencePaths = [], region }) {
  const modelRoot = insightFaceModelRoot(outputDirectory);
  if (!modelRoot) {
    return { status: "failed", error: "Modelli InsightFace buffalo_l non trovati per validare l'anchor." };
  }
  const args = [mode, "--source", sourcePath, "--model-root", modelRoot];
  if (candidatePath) args.push("--candidate", candidatePath);
  for (const referencePath of referencePaths) args.push("--reference", referencePath);
  if (region) args.push("--region", [region.x, region.y, region.width, region.height].join(","));
  const result = await runPythonJson({
    root,
    environment: "scene",
    scriptName: "verify-anchor.py",
    args,
    timeout: 180_000,
  });
  return result.ok ? result.data : { status: "failed", error: result.error };
}

export async function planAnchorPlacement({ root, outputDirectory, sourcePath, instruction, attempt = 1 }) {
  const analysis = await runAnchorTool({ root, outputDirectory, mode: "analyze", sourcePath });
  return {
    analysis,
    region: selectAnchorPlacement({ faces: analysis.faces || [], instruction, attempt }),
  };
}

export async function verifyAnchorCandidate({ root, outputDirectory, sourcePath, candidatePath, referencePaths, region }) {
  return runAnchorTool({
    root,
    outputDirectory,
    mode: "verify",
    sourcePath,
    candidatePath,
    referencePaths,
    region,
  });
}
