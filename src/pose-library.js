import fs from "node:fs";
import path from "node:path";

const sceneRules = [
  { match: /\b(sun\s*lounger|lettino|sdraio)\b/i, categories: ["reclining"] },
  { match: /\b(pool|piscina|beach|spiaggia)\b/i, categories: ["reclining", "leaning"] },
  { match: /\b(standing|in piedi|walk|cammina)\b/i, categories: ["upright", "raised_arm"] },
  { match: /\b(seated|sitting|seduta|chair|sedia)\b/i, categories: ["upright", "leaning"] },
];

function readCatalog(root) {
  const file = path.join(root, "data", "pose-library", "catalog.json");
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

export function poseLibraryConfig(root) {
  const catalog = readCatalog(root);
  const entries = catalog?.entries || [];
  return {
    installed: entries.length > 0,
    count: entries.length,
    categories: [...new Set(entries.map((entry) => entry.pose?.category).filter(Boolean))].sort(),
  };
}

export function selectPose(root, { prompt = "", category = "auto", seed = null } = {}) {
  const catalog = readCatalog(root);
  if (!catalog?.entries?.length) throw new Error("Pose Library non disponibile. Esegui scripts/build-pose-library.py prima di selezionare una posa.");
  const entries = catalog.entries.filter((entry) => entry.pose?.prompt);
  let candidates = entries;
  if (category && category !== "auto") candidates = entries.filter((entry) => entry.pose.category === category);
  if (category === "auto") {
    const rule = sceneRules.find((item) => item.match.test(String(prompt)));
    if (rule) {
      const matched = entries.filter((entry) => rule.categories.includes(entry.pose.category));
      if (matched.length) candidates = matched;
    }
  }
  if (!candidates.length) candidates = entries;
  const numericSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 31);
  const selected = candidates[Math.abs(numericSeed) % candidates.length];
  return {
    seed: numericSeed,
    selection: selected,
    promptSuffix: selected.pose.prompt,
    prompt: [String(prompt).trim(), selected.pose.prompt].filter(Boolean).join(", "),
    controlNet: { preprocessor: "DWPreprocessor", poseMap: `/api/pose-library/assets/${encodeURIComponent(selected.pose_map)}` },
  };
}
