const ACTIVE_STATUSES = new Set(["queued", "running"]);

export function setGenerationsArchived({
  store,
  ids,
  archived,
  now = () => new Date().toISOString(),
}) {
  const uniqueIds = [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => String(id || "").trim())
      .filter(Boolean),
  )];
  if (!uniqueIds.length) {
    const error = new Error("Seleziona almeno una generazione.");
    error.statusCode = 400;
    throw error;
  }
  if (uniqueIds.length > 500) {
    const error = new Error("Puoi modificare al massimo 500 generazioni per volta.");
    error.statusCode = 400;
    throw error;
  }

  const items = uniqueIds.map((id) => store.get(id));
  if (items.some((item) => !item)) {
    const error = new Error("Una o più generazioni non sono state trovate.");
    error.statusCode = 404;
    throw error;
  }
  if (archived && items.some((item) => ACTIVE_STATUSES.has(item.status))) {
    const error = new Error("Non puoi archiviare una generazione in coda o in esecuzione.");
    error.statusCode = 409;
    throw error;
  }

  return store.updateMany(uniqueIds, {
    archived: Boolean(archived),
    archivedAt: archived ? now() : null,
  });
}
