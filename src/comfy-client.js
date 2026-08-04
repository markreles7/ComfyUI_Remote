import { WebSocket } from "ws";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

export class ComfyClient {
  constructor({ httpUrl, wsUrl, clientId, onEvent }) {
    this.httpUrl = httpUrl.replace(/\/$/, "");
    this.wsUrl = wsUrl.replace(/\/$/, "");
    this.clientId = clientId;
    this.onEvent = onEvent;
    this.socket = null;
    this.reconnectTimer = null;
  }

  async request(endpoint, options = {}) {
    const { timeoutMs = 30000, ...fetchOptions } = options;
    const response = await fetch(`${this.httpUrl}${endpoint}`, {
      ...fetchOptions,
      signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ComfyUI ${response.status}: ${detail || response.statusText}`);
    }
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response;
  }

  connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.socket = new WebSocket(`${this.wsUrl}/ws?clientId=${this.clientId}`);
    this.socket.on("open", () => this.onEvent({ type: "connection", connected: true }));
    this.socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        this.onEvent(JSON.parse(data.toString()));
      } catch {
        // Ignora messaggi non JSON.
      }
    });
    this.socket.on("close", () => {
      this.onEvent({ type: "connection", connected: false });
      this.reconnectTimer = setTimeout(() => this.connect(), 2500);
    });
    this.socket.on("error", () => this.socket?.close());
  }

  async health() {
    return this.request("/system_stats", { timeoutMs: 10000 });
  }

  async objectInfo(nodeName = null) {
    return this.request(nodeName
      ? `/object_info/${encodeURIComponent(nodeName)}`
      : "/object_info"
    );
  }

  async uploadInput(file) {
    const body = new FormData();
    body.set("image", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
    body.set("type", "input");
    body.set("overwrite", "true");
    return this.request("/upload/image", { method: "POST", body, timeoutMs: 600000 });
  }

  async uploadImage(file) {
    return this.uploadInput(file);
  }

  async reuseOutputImage(file, fallbackName = "studio-selected.png") {
    return this.reuseOutputFile(file, fallbackName, "image/png");
  }

  async reuseOutputFile(file, fallbackName = "selected-output.bin", fallbackType = "application/octet-stream") {
    const response = await fetch(this.mediaUrl(file), {
      signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) throw new Error(`Impossibile recuperare il risultato selezionato (${response.status}).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    return this.uploadInput({
      buffer,
      mimetype: response.headers.get("content-type") || fallbackType,
      originalname: file.filename || fallbackName,
    });
  }

  async queue(workflow) {
    return this.request("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
      timeoutMs: 60000,
    });
  }

  async history(promptId) {
    return this.request(`/history/${encodeURIComponent(promptId)}`, { timeoutMs: 20000 });
  }

  async queueStatus() {
    return this.request("/queue", { timeoutMs: 10000 });
  }

  async cancelJob(promptId) {
    return this.request(`/api/jobs/${encodeURIComponent(promptId)}/cancel`, {
      method: "POST",
      timeoutMs: 15000,
    });
  }

  async interrupt() {
    return this.request("/interrupt", { method: "POST" });
  }

  async free({ unloadModels = false, freeMemory = false }) {
    return this.request("/free", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ unload_models: unloadModels, free_memory: freeMemory }),
    });
  }

  mediaUrl(file) {
    const params = new URLSearchParams({
      filename: file.filename,
      type: file.type || "output",
    });
    if (file.subfolder) params.set("subfolder", file.subfolder);
    return `${this.httpUrl}/view?${params}`;
  }
}

function walk(value, found, extensions) {
  if (!value || typeof value !== "object") return;
  if (typeof value.filename === "string") {
    const extension = value.filename.slice(value.filename.lastIndexOf(".")).toLowerCase();
    if (extensions.has(extension)) {
      found.push({
        filename: value.filename,
        subfolder: value.subfolder || "",
        type: value.type || "output",
      });
    }
  }
  for (const child of Object.values(value)) walk(child, found, extensions);
}

function extractFiles(historyEntry, extensions) {
  const files = [];
  walk(historyEntry?.outputs, files, extensions);
  return files.filter((item, index, array) =>
    index === array.findIndex((other) =>
      other.filename === item.filename &&
      other.subfolder === item.subfolder &&
      other.type === item.type
    )
  );
}

export function extractVideos(historyEntry) {
  return preferFinalVideos(extractFiles(historyEntry, VIDEO_EXTENSIONS));
}

export function extractImages(historyEntry) {
  return preferFinalImages(extractFiles(historyEntry, IMAGE_EXTENSIONS));
}

function preferFinalImages(files) {
  if (files.length <= 1) return files;
  return [...files].sort((left, right) => finalImageScore(right) - finalImageScore(left));
}

function finalImageScore(file) {
  const name = `${file.subfolder || ""}/${file.filename || ""}`.toLowerCase();
  if (/(?:^|[/_-])08[_-]finale|(?:^|[/_-])finale|(?:^|[/_-])final(?:[_\-.]|$)|enhanced/.test(name)) return 30;
  if (/refine|quality|master/.test(name)) return 20;
  return 0;
}

function preferFinalVideos(files) {
  if (files.length <= 1) return files;

  const outputFiles = files.filter((file) => (file.type || "output") === "output");
  if (outputFiles.length) {
    const withAudio = outputFiles.filter((file) => /(?:^|[-_])audio\.[^.]+$/i.test(file.filename));
    return withAudio.length ? withAudio : outputFiles;
  }

  return files;
}
