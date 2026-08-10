import crypto from "node:crypto";

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cacheKey(parts = {}) {
  return crypto.createHash("sha256").update(stableJson(parts)).digest("hex");
}

export function stageStatus(project = {}, stage, status, extra = {}) {
  return {
    ...(project.stages || {}),
    [stage]: {
      status,
      updatedAt: new Date().toISOString(),
      ...extra,
    },
  };
}

export function renderPackageCacheKey(project = {}, extra = {}) {
  return cacheKey({
    source: project.sourceVideo?.sha256 || project.sourceVideo?.path || "",
    editWindows: project.editWindows || [],
    dialogueEvents: project.dialogueEvents || [],
    addedActors: project.actors?.added || [],
    settings: {
      anchorWorkflowId: project.settings?.anchorWorkflowId || "qwen-image-edit",
    },
    ...extra,
  });
}
