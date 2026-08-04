const ACTIVE_STATUSES = new Set(["queued", "running"]);

export async function cancelGeneration({ comfy, store, item, now = () => new Date().toISOString() }) {
  if (!ACTIVE_STATUSES.has(item.status)) {
    return { cancelled: false, generation: item, reason: "terminal" };
  }

  const result = await comfy.cancelJob(item.promptId);
  if (!result?.cancelled) {
    return { cancelled: false, generation: item, reason: "not-active" };
  }

  const cancelledAt = now();
  const generation = store.update(item.id, {
    status: "interrupted",
    cancelledByUser: true,
    cancelledAt,
    finishedAt: cancelledAt,
    error: null,
  });
  return { cancelled: true, generation };
}
