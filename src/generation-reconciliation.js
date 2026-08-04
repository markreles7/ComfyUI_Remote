export const DEFAULT_STALE_GENERATION_GRACE_MS = 60_000;

function promptIds(entries) {
  return new Set((entries || [])
    .map((entry) => Array.isArray(entry) ? entry[1] : entry?.prompt_id)
    .filter((value) => typeof value === "string" && value));
}

export function comfyQueuePromptIds(queue) {
  return {
    running: promptIds(queue?.queue_running),
    pending: promptIds(queue?.queue_pending),
  };
}

export function missingGenerationPatch(item, {
  running,
  pending,
  now = Date.now(),
  graceMs = DEFAULT_STALE_GENERATION_GRACE_MS,
} = {}) {
  if (!item || !["queued", "running"].includes(item.status)) return null;
  if (running?.has(item.promptId)) {
    return item.status === "running" ? null : { status: "running" };
  }
  if (pending?.has(item.promptId)) {
    return item.status === "queued" ? null : { status: "queued" };
  }
  if (!(running instanceof Set) || !(pending instanceof Set)) return null;
  const createdAt = Date.parse(item.createdAt || "");
  if (Number.isFinite(createdAt) && now - createdAt < graceMs) return null;
  return {
    status: "interrupted",
    error: "La generazione non è più presente nella coda o nella cronologia di ComfyUI. È stata chiusa automaticamente.",
    finishedAt: new Date(now).toISOString(),
  };
}
