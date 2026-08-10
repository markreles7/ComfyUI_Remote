const ACTIVE_STATUSES = new Set(["queued", "running"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function clean(value) {
  return String(value ?? "").trim();
}

function parseDate(value, endOfDay = false) {
  const raw = clean(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (endOfDay) date.setHours(23, 59, 59, 999);
    else date.setHours(0, 0, 0, 0);
  }
  return date;
}

function dateTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function matchesGeneration(item, filters = {}) {
  const search = clean(filters.search).toLocaleLowerCase("it");
  const workflowId = clean(filters.workflowId);
  const status = clean(filters.status);
  const archive = clean(filters.archive || "visible");
  const mediaType = clean(filters.mediaType);
  const dateFrom = parseDate(filters.dateFrom);
  const dateTo = parseDate(filters.dateTo, true);
  const createdAt = new Date(item.createdAt || 0);

  if (search) {
    const searchable = `${item.prompt || ""} ${item.workflowName || ""} ${item.workflowId || ""}`.toLocaleLowerCase("it");
    if (!searchable.includes(search)) return false;
  }
  if (workflowId && item.workflowId !== workflowId) return false;
  if (status && item.status !== status) return false;
  if (archive !== "all") {
    if (archive === "archived" && !item.archived) return false;
    if (archive !== "archived" && item.archived) return false;
  }
  if (mediaType === "image" && !(item.images || []).length) return false;
  if (mediaType === "video" && !(item.videos || []).length) return false;
  if (dateFrom && createdAt < dateFrom) return false;
  if (dateTo && createdAt > dateTo) return false;
  return true;
}

function statsFor(items) {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    active: items.filter((item) => ACTIVE_STATUSES.has(item.status)).length,
    archived: items.filter((item) => item.archived).length,
  };
}

function workflowsFor(items) {
  return [...new Map(items
    .filter((item) => item.workflowId)
    .map((item) => [item.workflowId, item.workflowName || item.workflowId])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "it"));
}

export function queryGenerations(items, query = {}) {
  const sorted = [...items].sort((left, right) => dateTime(right.createdAt) - dateTime(left.createdAt));
  const filtered = sorted.filter((item) => matchesGeneration(item, query));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0);
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
    stats: statsFor(sorted),
    filteredStats: statsFor(filtered),
    workflows: workflowsFor(sorted),
  };
}

export function cleanupCandidates(items, criteria = {}) {
  return [...items]
    .filter((item) => !ACTIVE_STATUSES.has(item.status))
    .filter((item) => matchesGeneration(item, criteria));
}

export function estimateGenerationCleanup({ items = [], criteria = {}, resolveMedia = () => null } = {}) {
  const candidates = cleanupCandidates(items, criteria);
  const seen = new Set();
  const files = [];
  for (const item of candidates) {
    for (const media of [...(item.images || []), ...(item.videos || [])]) {
      const match = resolveMedia(media, item);
      if (!match?.path || seen.has(match.path)) continue;
      seen.add(match.path);
      files.push({
        path: match.path,
        bytes: Number(match.stats?.size || 0),
        generationId: item.id,
      });
    }
  }
  return {
    generations: candidates.length,
    images: candidates.reduce((sum, item) => sum + (item.images || []).length, 0),
    videos: candidates.reduce((sum, item) => sum + (item.videos || []).length, 0),
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    ids: candidates.map((item) => item.id),
    filePaths: files.map((file) => file.path),
  };
}

export function cleanupMode(value) {
  const mode = clean(value || "archive");
  return ["archive", "deleteFilesKeepRecords", "deleteFilesAndRecords"].includes(mode) ? mode : "archive";
}
