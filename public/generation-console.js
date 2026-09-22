const state = {
  open: false,
  generations: [],
  eventSource: null,
  timer: null,
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function statusLabel(status) {
  return {
    orchestrating: "Preparazione pipeline",
    queued: "In coda",
    running: "In esecuzione",
    completed: "Completata",
    error: "Errore",
    interrupted: "Interrotta",
    cancelled: "Annullata",
  }[status] || status || "Sconosciuto";
}

function elapsed(generation) {
  const start = Date.parse(generation.startedAt || generation.createdAt || "");
  const end = Date.parse(generation.finishedAt || "") || Date.now();
  if (!Number.isFinite(start)) return "—";
  const seconds = Math.max(0, Math.floor((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function shortTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function render() {
  const panel = document.querySelector("#generation-console-panel");
  const button = document.querySelector("#generation-console-toggle");
  const list = document.querySelector("#generation-console-list");
  if (!panel || !button || !list) return;
  panel.classList.toggle("open", state.open);
  panel.setAttribute("aria-hidden", String(!state.open));
  button.setAttribute("aria-expanded", String(state.open));
  const active = state.generations.filter((item) => ["orchestrating", "queued", "running"].includes(item.status));
  button.innerHTML = `<span class="generation-console-pulse"></span><span>Avanzamento</span><b>${active.length}</b>`;
  button.classList.toggle("has-active", active.length > 0);
  list.innerHTML = state.generations.length ? state.generations.map((generation) => {
    const progress = Math.max(0, Math.min(100, Math.round(Number(generation.progress || 0))));
    const node = generation.currentNodeTitle || (generation.currentNode ? `Nodo ${generation.currentNode}` : "In attesa del primo nodo");
    const queue = generation.status === "queued" && generation.queuePosition
      ? `Posizione ${generation.queuePosition} in coda`
      : generation.comfyRunning ? "GPU attiva" : statusLabel(generation.status);
    const logs = (generation.logs || []).slice(-10).reverse();
    return `<article class="generation-console-job status-${escapeHtml(generation.status)}">
      <header><div><strong>${escapeHtml(generation.workflowName)}</strong><small>${escapeHtml(queue)} · ${escapeHtml(elapsed(generation))}</small></div><b>${progress}%</b></header>
      <div class="generation-console-progress"><i style="width:${progress}%"></i></div>
      <p class="generation-console-node"><span>Nodo</span>${escapeHtml(node)}${generation.progressValue != null && generation.progressMax != null ? ` · step ${escapeHtml(generation.progressValue)}/${escapeHtml(generation.progressMax)}` : ""}</p>
      ${generation.error ? `<p class="generation-console-error">${escapeHtml(generation.error)}</p>` : ""}
      <details ${["running", "error"].includes(generation.status) ? "open" : ""}><summary>Eventi recenti</summary><ol>${logs.length
        ? logs.map((row) => `<li><time>${escapeHtml(shortTime(row.time))}</time><span>${escapeHtml(row.message)}</span></li>`).join("")
        : "<li><span>Nessun evento ricevuto in questa sessione.</span></li>"}</ol></details>
    </article>`;
  }).join("") : '<p class="generation-console-empty">Nessuna generazione recente.</p>';
}

async function refresh() {
  try {
    const response = await fetch("/api/generation-progress?limit=16", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json();
    state.generations = payload.generations || [];
    document.querySelector("#generation-console-connection")?.classList.toggle("offline", payload.connected === false);
    render();
  } catch {
    document.querySelector("#generation-console-connection")?.classList.add("offline");
  }
}

function scheduleRefresh(delay = state.open ? 1500 : 6000) {
  clearTimeout(state.timer);
  state.timer = setTimeout(async () => {
    await refresh();
    scheduleRefresh();
  }, delay);
}

function connectEvents() {
  state.eventSource?.close();
  state.eventSource = new EventSource("/api/events");
  state.eventSource.onmessage = () => {
    clearTimeout(state.timer);
    scheduleRefresh(120);
  };
  state.eventSource.onerror = () => document.querySelector("#generation-console-connection")?.classList.add("offline");
}

function mount() {
  if (document.querySelector("#generation-console-toggle")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <button id="generation-console-toggle" class="generation-console-toggle" type="button" aria-expanded="false" aria-controls="generation-console-panel"><span>Avanzamento</span><b>0</b></button>
    <aside id="generation-console-panel" class="generation-console-panel" aria-hidden="true" aria-label="Console avanzamento generazioni">
      <header class="generation-console-heading"><div><p>COMFYUI LIVE</p><h2>Avanzamento generazioni</h2></div><div><span id="generation-console-connection">Live</span><button id="generation-console-close" type="button" aria-label="Chiudi console">×</button></div></header>
      <div id="generation-console-list" class="generation-console-list"></div>
    </aside>`);
  document.querySelector("#generation-console-toggle").addEventListener("click", () => {
    state.open = !state.open;
    render();
    if (state.open) void refresh();
  });
  document.querySelector("#generation-console-close").addEventListener("click", () => {
    state.open = false;
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      state.open = false;
      render();
    }
  });
  void refresh();
  scheduleRefresh();
  connectEvents();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
