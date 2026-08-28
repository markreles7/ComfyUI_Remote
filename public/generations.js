import { createAdaptivePoller } from "./runtime-cache.js";

const state = {
  history: [],
  total: 0,
  hasMore: false,
  pageSize: 50,
  stats: { total: 0, completed: 0, active: 0, archived: 0 },
  workflows: [],
  eventSource: null,
  historyRefreshTimer: null,
  historyRefreshInFlight: false,
  historyRefreshQueued: false,
  selectedIds: new Set(),
  cleanupEstimate: null,
};

const $ = (selector) => document.querySelector(selector);

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setConnection(online) {
  const connection = $("#connection");
  connection.className = `connection ${online ? "online" : "offline"}`;
  connection.innerHTML = `<span></span>${online ? "ComfyUI online" : "ComfyUI offline"}`;
}

async function checkHealth() {
  try {
    await api("/api/health");
    setConnection(true);
  } catch {
    setConnection(false);
  }
}

function statusLabel(item) {
  return {
    queued: "In coda",
    running: "In lavorazione",
    completed: "Completata",
    error: "Errore",
    interrupted: "Annullata",
  }[item.status] || item.status;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function compactText(value, maxLength = 150) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function displayImageEntries(item) {
  const entries = (item.images || []).map((image, index) => ({ image, index }));
  if (item.workflowId !== "studio:kreaTriple" && item.studioMode !== "kreaTriple") return entries;
  const finals = entries.filter(({ image }) => {
    const name = `${image.subfolder || ""}/${image.filename || ""}`.toLowerCase();
    return /(?:^|[/\\_-])08[_-]finale|(?:^|[/\\_-])finale|(?:^|[/\\_-])final(?:[_\-.]|$)/.test(name);
  });
  return finals.length ? [finals.at(-1)] : entries.length ? [entries.at(-1)] : [];
}

function currentFilters() {
  return {
    search: $("#history-search").value.trim(),
    workflowId: $("#history-workflow").value,
    status: $("#history-status").value,
    archive: $("#history-archive").value,
    mediaType: $("#history-media-type").value,
    dateFrom: $("#history-date-from").value,
    dateTo: $("#history-date-to").value,
  };
}

function generationQuery(offset = 0) {
  const params = new URLSearchParams({
    paged: "1",
    limit: String(state.pageSize),
    offset: String(offset),
  });
  for (const [key, value] of Object.entries(currentFilters())) {
    if (value) params.set(key, value);
  }
  return params;
}

function promptMarkup(item) {
  if (!item.prompt) return "";
  return `
    <details class="generation-details generation-prompt-details">
      <summary>
        <span>Prompt usato</span>
        <em>${escapeHtml(compactText(item.prompt))}</em>
      </summary>
      <p>${escapeHtml(item.prompt)}</p>
    </details>
  `;
}

function sceneFallbackInfo(rawValue) {
  const value = String(rawValue || "");
  const lower = value.toLocaleLowerCase();
  if (lower.includes("posizionamento automatico")) {
    return {
      title: "Posizionamento automatico saltato",
      text: "La scena e il modello non esponevano una guida strutturale compatibile, quindi la posizione non è stata corretta automaticamente.",
    };
  }
  if (lower.includes("relighting")) {
    return {
      title: "Relighting dedicato non disponibile",
      text: "La luce è stata armonizzata con prompt, colore e finishing, senza un nodo fisico dedicato.",
    };
  }
  if (lower.includes("generatore non ha un adapter")) {
    return {
      title: "Adapter specifico assente",
      text: "Scene Integration ha usato controlli generici e finishing verificati invece di nodi specializzati per quel generatore.",
    };
  }
  if (lower.includes("color")) {
    return {
      title: "Color matching parziale",
      text: "Il colore è stato gestito con i passaggi disponibili, ma non tutti i controlli cromatici erano applicabili.",
    };
  }
  return {
    title: "Controllo non applicato",
    text: "Un controllo richiesto non era disponibile per questa combinazione di workflow, modello e input.",
  };
}

function sceneFallbackMarkup(fallbacks = []) {
  if (!fallbacks.length) return "";
  const items = fallbacks.map((value) => ({ ...sceneFallbackInfo(value), raw: value }));
  return `
    <details class="scene-result-fallbacks">
      <summary>
        <span>${items.length} avvisi non bloccanti</span>
        <em>Scene Integration ha usato fallback sicuri</em>
      </summary>
      <div class="scene-fallback-list">
        ${items.map((item) => `
          <article>
            <b>${escapeHtml(item.title)}</b>
            <p>${escapeHtml(item.text)}</p>
            <small>${escapeHtml(item.raw)}</small>
          </article>
        `).join("")}
      </div>
    </details>
  `;
}

function sceneIntegrationMarkup(item) {
  const integration = item.sceneIntegration;
  if (!integration?.enabled) return "";
  const evaluation = integration.evaluation;
  const categories = evaluation?.categories
    ? Object.entries(evaluation.categories)
    : [];
  const evaluationArtifacts = Object.entries(integration.evaluationArtifacts || {});
  return `
    <details class="generation-details scene-result-details"${evaluation ? "" : " open"}>
      <summary>
        <span>Scene Integration · ${escapeHtml(integration.preset || "balanced")}</span>
        <em>${evaluation ? `${escapeHtml(evaluation.overallScore)}/100` : integration.evaluationInProgress ? "valutazione…" : "profilo applicato"}</em>
      </summary>
      <div class="scene-result-summary">
        <p><b>Adapter</b><span>${escapeHtml(integration.adapterReport?.adapterName || "—")}</span></p>
        <p><b>Profilo</b><span>${escapeHtml(integration.profileId)}</span></p>
        <p><b>Iterazioni</b><span>${escapeHtml(integration.iterations?.length || 0)} / ${escapeHtml(integration.settings?.correctionIterations ?? 0)}</span></p>
        ${integration.adapterReport?.appliedParameters?.selectedCorrections?.length
          ? `<p><b>Correzioni selettive</b><span>${integration.adapterReport.appliedParameters.selectedCorrections.map(escapeHtml).join(", ")}</span></p>`
          : ""}
      </div>
      ${categories.length ? `
        <div class="scene-score-grid">
          ${categories.map(([name, result]) => `
            <div class="${result.measured ? "" : "unmeasured"}">
              <span>${escapeHtml(name)}</span>
              <b>${escapeHtml(result.score)}/100</b>
              <small>conf. ${Math.round(Number(result.confidence || 0) * 100)}%${result.measured ? "" : " · proxy non disponibile"}</small>
            </div>`).join("")}
        </div>` : ""}
      ${sceneFallbackMarkup(integration.adapterReport?.fallbacks)}
      ${evaluationArtifacts.length ? `
        <div class="scene-evaluation-artifacts">
          <figure>
            <img loading="lazy" src="/api/scene-integration/profiles/${encodeURIComponent(integration.profileId)}/source" alt="Scena originale">
            <figcaption>Prima · scena originale</figcaption>
          </figure>
          ${item.mediaType === "image" && item.images?.length ? `
            <figure>
              <img loading="lazy" src="/api/image/${encodeURIComponent(item.id)}/0" alt="Risultato integrato">
              <figcaption>Dopo · risultato</figcaption>
            </figure>` : ""}
          ${evaluationArtifacts.map(([key, filename]) => `
            <figure>
              <img loading="lazy" src="/api/scene-integration/artifacts/${encodeURIComponent(integration.profileId)}/${encodeURIComponent(filename)}" alt="${escapeHtml(key)}">
              <figcaption>${escapeHtml(key === "evaluationMask" ? "Maschera valutazione" : "Mappa differenze")}</figcaption>
            </figure>`).join("")}
        </div>` : ""}
      ${integration.evaluationError ? `<p class="form-error">${escapeHtml(integration.evaluationError)}</p>` : ""}
      <a class="chip-button" href="/api/scene-integration/profiles/${encodeURIComponent(integration.profileId)}/export">Esporta Scene Profile</a>
    </details>
  `;
}

function videoModeLabel(inputMode) {
  return {
    text: "Testo → Video",
    image: "Immagine → Video",
    video: "Video → Video",
  }[inputMode] || "";
}

function formatSettings(item) {
  const requestedDimensions = item.width && item.height
    ? `${item.width}×${item.height}`
    : item.resolution;
  const actualDimensions = item.outputWidth && item.outputHeight
    ? `${item.outputWidth}×${item.outputHeight}`
    : null;
  const entries = [
    [actualDimensions ? "Output richiesto" : "Output", requestedDimensions],
    ["Seed", item.seed],
  ];
  if (actualDimensions) entries.splice(1, 0, ["Output reale", actualDimensions]);
  if (item.imageModelName) entries.push(["Modello", item.imageModelName]);
  if (item.videoModelName) entries.push(["Modello", item.videoModelName]);
  if (item.mediaType === "image") {
    entries.push(["Immagini", displayImageEntries(item).length || 1]);
  } else {
    if (videoModeLabel(item.inputMode)) {
      entries.push(["Modalità", videoModeLabel(item.inputMode)]);
    }

    if (Number.isFinite(Number(item.duration))) {
      entries.push(["Durata", `${item.duration}s`]);
    }

    if (Number.isFinite(Number(item.fps))) {
      entries.push(["FPS", item.fps]);
    }
  }
  if (item.quality) entries.push(["Qualità", item.quality === "preview" ? "Anteprima" : "Massima"]);
  if (item.sceneCount > 1) entries.push(["Scene", item.sceneCount]);
  if (item.loras?.length) entries.push(["LoRA", item.loras.length]);
  if (item.editSettings) {
    entries.push(
      ["Step", item.editSettings.steps],
      ["CFG", item.editSettings.cfg],
      ["NAG", item.editSettings.nagScale],
      ["Edit strength", item.editSettings.editStrength],
      ["Prompt enhancer", item.editSettings.promptEnhancer ? "Sì" : "No"],
      ["Audio sorgente", item.editSettings.useInputAudio ? "Sì" : "No"],
    );
  }
  if (item.imageSettings) {
    entries.push(
      ["Step", item.imageSettings.steps],
      ["Guidance", item.imageSettings.guidance],
    );
    if (item.imageSettings.denoise != null) entries.push(["Denoise", item.imageSettings.denoise]);
    if (item.imageSettings.referenceStrength != null) {
      entries.push(["Reference", item.imageSettings.referenceStrength]);
    }
    if (item.imageSettings.highresEnabled) {
      entries.push(
        ["Highres Fix", `${item.imageSettings.highresScale}× · ${item.imageSettings.highresSteps} step`],
        ["Highres denoise", item.imageSettings.highresDenoise],
      );
    }
    if (item.imageSettings.upscaleMode === "fast") entries.push(["Upscale", "RealESRGAN 2×"]);
    if (item.imageSettings.upscaleMode === "rtx") {
      entries.push(["Upscale", `RTX VSR ${item.imageSettings.rtxQuality || "High"} 2×`]);
    }
    if (item.imageSettings.upscaleMode === "seedvr2") {
      entries.push(
        ["Upscale", item.imageSettings.seedvrProfile === "realistic"
          ? "SeedVR2 Massimo · 7B FP16"
          : "SeedVR2 Leggero · 3B FP8"],
        ["Lato corto", `${item.imageSettings.seedvrResolution}px`],
      );
    }
    if (item.imageSettings.enhanced) {
      entries.push(["Output finale", `${item.imageSettings.finalWidth}×${item.imageSettings.finalHeight}`]);
    }
    if (item.imageSettings.faceEnhance) entries.push(["Volti", `Restauro ${item.imageSettings.faceStrength}`]);
    if (item.imageSettings.faceDetailer) entries.push(["Detailer volto", item.imageSettings.faceDetailerDenoise]);
    if (item.imageSettings.handDetailer) entries.push(["Detailer mani", item.imageSettings.handDetailerDenoise]);
    if (item.imageSettings.autoPurge) entries.push(["Purge VRAM", "Automatico"]);
  }
  if (item.upscaleSettings) {
    const ltxUpscale = item.generationType === "ltxUpscale";

    const engineName = item.upscaleSettings.engineName ||
      (ltxUpscale ? "LTX 2.3 IC-LoRA" : "");

    const presetName = item.upscaleSettings.presetName ||
      (ltxUpscale
        ? `${item.upscaleSettings.steps || "—"} step · CRF ${item.upscaleSettings.crf ?? "—"}`
        : "");

    if (engineName) entries.push(["Motore", engineName]);
    if (presetName) entries.push(["Preset", presetName]);
    if (item.upscaleSettings.model) entries.push(["Modello", item.upscaleSettings.model]);
    if (item.upscaleSettings.scale) entries.push(["Ingrandimento", `${item.upscaleSettings.scale}×`]);
    if (item.upscaleSettings.targetShortEdge) {
      entries.push(["Lato corto", `${item.upscaleSettings.targetShortEdge}px`]);
    }
    if (item.upscaleSettings.autoPurge) entries.push(["Purge VRAM", "Prima dell’upscale"]);
  }
  return entries.map(([label, value]) =>
    `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`
  ).join("");
}

function mediaMarkup(item) {
  if (item.videos?.length) {
    return item.videos.map((video, index) => `
      <div class="generation-video" data-lazy-video="/api/media/${item.id}/${index}">
        <button class="video-lazy-button" type="button" data-load-video>
          <span>▶</span>
          <b>Apri video</b>
          <small>${escapeHtml(video.filename || `Video ${index + 1}`)}</small>
        </button>
        <a class="download" href="/api/media/${item.id}/${index}?download=1" download>
          Download${item.videos.length > 1 ? ` ${index + 1}` : ""} ↓
        </a>
      </div>
    `).join("");
  }
  const displayImages = displayImageEntries(item);
  if (!displayImages.length) {
    const progress = item.status === "running" ? ` · ${item.progress || 0}%` : "";
    return `
      <div class="generation-placeholder status-${escapeHtml(item.status)}">
        <div class="orbit"><i></i></div>
        <b>${escapeHtml(statusLabel(item))}${progress}</b>
        ${item.error ? `<small>${escapeHtml(item.error)}</small>` : ""}
      </div>`;
  }
  return `<div class="generation-images">${displayImages.map(({ image, index }) => `
    <figure class="generation-image">
      <a href="/api/image/${item.id}/${index}" target="_blank" rel="noopener">
        <img loading="lazy" src="/api/image/${item.id}/${index}" alt="Risultato ${index + 1}">
      </a>
      <a class="download" href="/api/image/${item.id}/${index}?download=1" download>
        Download ↓
      </a>
    </figure>
  `).join("")}</div>`;
}

function filteredHistory() {
  return state.history;
}

function renderArchiveActions() {
  const selected = state.history.filter((item) => state.selectedIds.has(item.id));
  const archivable = selected.filter((item) =>
    !item.archived && !["queued", "running"].includes(item.status)
  );
  const restorable = selected.filter((item) => item.archived);
  $("#archive-selected-count").textContent = selected.length;
  $("#clear-history-selection").disabled = selected.length === 0;
  $("#archive-selected-history").disabled = archivable.length === 0;
  $("#restore-selected-history").disabled = restorable.length === 0;
}

function render() {
  $("#stat-total").textContent = state.stats.total;
  $("#stat-completed").textContent = state.stats.completed;
  $("#stat-active").textContent = state.stats.active;
  $("#stat-archived").textContent = state.stats.archived;
  $("#history-empty").classList.toggle("hidden", state.stats.total > 0);
  $("#history-no-results").classList.toggle("hidden", state.stats.total === 0 || state.total > 0);
  $("#history-load-more").classList.toggle("hidden", !state.hasMore);
  $("#history").innerHTML = state.history.map((item) => `
    <article class="generation-card" data-generation-id="${escapeHtml(item.id)}">
      <div class="generation-card-media">${mediaMarkup(item)}</div>
      <div class="generation-card-content">
        <div class="generation-card-heading">
          <div>
            <span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item))}</span>
            ${item.archived ? `<span class="archive-pill">Archiviata</span>` : ""}
            <h2>${escapeHtml(item.workflowName || item.prompt || "Generazione")}</h2>
            <p>${escapeHtml(item.workflowName)} · ${escapeHtml(formatDate(item.createdAt))}</p>
            ${item.projectId ? `<p>Progetto Studio · ${escapeHtml(item.studioStage || "output")} · ${escapeHtml(item.studioLabel || "")}</p>` : ""}
          </div>
          <div class="generation-card-actions">
            ${!["queued", "running"].includes(item.status) ? `
              <label class="generation-select">
                <input type="checkbox" data-select-generation="${escapeHtml(item.id)}"${state.selectedIds.has(item.id) ? " checked" : ""}>
                <span>Seleziona</span>
              </label>
              <button class="${item.archived ? "ghost-button" : "archive-button"} compact" type="button"
                data-archive-job="${escapeHtml(item.id)}" data-archive-value="${item.archived ? "false" : "true"}">
                ${item.archived ? "Ripristina" : "Archivia"}
              </button>
            ` : `
              <button class="cancel-generation-button" type="button" data-cancel-job="${escapeHtml(item.id)}">Annulla</button>
            `}
          </div>
        </div>
        ${promptMarkup(item)}
        <div class="generation-settings">${formatSettings(item)}</div>
        ${sceneIntegrationMarkup(item)}
        ${item.negativePrompt ? `
          <details class="generation-details">
            <summary>Prompt negativo</summary>
            <p>${escapeHtml(item.negativePrompt)}</p>
          </details>` : ""}
        ${item.loras?.length ? `
          <details class="generation-details">
            <summary>LoRA applicate (${item.loras.length})</summary>
            <div class="generation-loras">${item.loras.map((lora) =>
              `<p><b>${escapeHtml(lora.name)}</b><span>forza ${escapeHtml(lora.strength)}</span></p>`
            ).join("")}</div>
          </details>` : ""}
        ${item.globalPrompt ? `
          <details class="generation-details">
            <summary>Continuità globale</summary>
            <p>${escapeHtml(item.globalPrompt)}</p>
          </details>` : ""}
        ${item.dimensionWarning ? `
          <details class="generation-details" open>
            <summary>Avviso dimensioni</summary>
            <p>${escapeHtml(item.dimensionWarning)}</p>
          </details>` : ""}
      </div>
    </article>
  `).join("");
  renderArchiveActions();
}

function renderWorkflowOptions() {
  const selected = $("#history-workflow").value;
  $("#history-workflow").innerHTML = `<option value="">Tutti i workflow</option>${state.workflows.map((workflow) =>
    `<option value="${escapeHtml(workflow.id)}">${escapeHtml(workflow.name)}</option>`
  ).join("")}`;
  $("#history-workflow").value = state.workflows.some((workflow) => workflow.id === selected) ? selected : "";
}

async function loadHistory({ append = false } = {}) {
  const offset = append ? state.history.length : 0;
  const payload = await api(`/api/generations?${generationQuery(offset)}`);
  state.history = append ? [...state.history, ...(payload.items || [])] : (payload.items || []);
  state.total = Number(payload.total || 0);
  state.hasMore = Boolean(payload.hasMore);
  state.stats = payload.stats || state.stats;
  state.workflows = payload.workflows || state.workflows;
  const availableIds = new Set(state.history.map((item) => item.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => availableIds.has(id)));
  renderWorkflowOptions();
  render();
}

function queueHistoryRefresh(delay = 120) {
  clearTimeout(state.historyRefreshTimer);
  state.historyRefreshTimer = setTimeout(async () => {
    if (state.historyRefreshInFlight) {
      state.historyRefreshQueued = true;
      return;
    }
    state.historyRefreshInFlight = true;
    try {
      await loadHistory();
    } catch (error) {
      showToast(error.message);
    } finally {
      state.historyRefreshInFlight = false;
      if (state.historyRefreshQueued) {
        state.historyRefreshQueued = false;
        queueHistoryRefresh();
      }
    }
  }, delay);
}

function applyLiveGenerationEvent(message) {
  const item = state.history.find((entry) => entry.id === message.generationId);
  if (!item) return;
  if (message.type === "progress") {
    const value = Number(message.data?.value || 0);
    const max = Number(message.data?.max || 1);
    item.progress = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
    item.status = "running";
  } else if (message.type === "executing" && message.data?.node) {
    item.status = "running";
  }

  const card = [...document.querySelectorAll("[data-generation-id]")]
    .find((element) => element.dataset.generationId === item.id);
  if (!card) return;
  const pill = card.querySelector(".status-pill");
  if (pill) {
    pill.className = `status-pill status-${item.status}`;
    pill.textContent = statusLabel(item);
  }
  const placeholder = card.querySelector(".generation-placeholder");
  if (placeholder) {
    placeholder.className = `generation-placeholder status-${item.status}`;
    const label = placeholder.querySelector("b");
    if (label) label.textContent = `${statusLabel(item)}${item.status === "running" ? ` · ${item.progress || 0}%` : ""}`;
  }
}

function connectEvents() {
  state.eventSource?.close();
  state.eventSource = new EventSource("/api/events");
  state.eventSource.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "connection") setConnection(message.connected);
    if (message.generationId && ["progress", "executing"].includes(message.type)) {
      applyLiveGenerationEvent(message);
    } else if (message.generationId || message.type === "generation_created") {
      queueHistoryRefresh();
    }
  };
}

for (const selector of [
  "#history-search",
  "#history-workflow",
  "#history-status",
  "#history-archive",
  "#history-media-type",
  "#history-date-from",
  "#history-date-to",
]) {
  $(selector).addEventListener(selector === "#history-search" ? "input" : "change", () => {
    loadHistory().catch((error) => showToast(error.message));
  });
}
$("#history-load-more").addEventListener("click", () => {
  loadHistory({ append: true }).catch((error) => showToast(error.message));
});
$("#refresh-history").addEventListener("click", () =>
  loadHistory().then(() => showToast("Archivio aggiornato")).catch((error) => showToast(error.message))
);

async function setArchived(ids, archived) {
  if (!ids.length) return;
  if (archived && !confirm(
    `Archiviare ${ids.length === 1 ? "questa generazione" : `le ${ids.length} generazioni selezionate`}? I file non verranno cancellati.`
  )) return;
  const result = await api("/api/generations/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, archived }),
  });
  for (const item of result.generations) state.selectedIds.delete(item.id);
  await loadHistory();
  showToast(archived
    ? `${result.generations.length === 1 ? "Generazione archiviata" : "Generazioni archiviate"}`
    : `${result.generations.length === 1 ? "Generazione ripristinata" : "Generazioni ripristinate"}`);
}

function cleanupCriteria() {
  const olderThan = $("#cleanup-older-than").value;
  if (olderThan === "current") return currentFilters();
  const dateTo = new Date();
  dateTo.setDate(dateTo.getDate() - Number(olderThan));
  return {
    archive: "all",
    dateTo: dateTo.toISOString().slice(0, 10),
  };
}

function cleanupSummary(estimate) {
  return `${estimate.generations || 0} generazioni · ${estimate.images || 0} immagini · ${estimate.videos || 0} video · ${estimate.files || 0} file · ${formatBytes(estimate.bytes || 0)} stimati`;
}

async function estimateCleanup() {
  const estimate = await api("/api/generations/cleanup/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cleanupCriteria()),
  });
  state.cleanupEstimate = estimate;
  $("#cleanup-result").textContent = cleanupSummary(estimate);
  $("#cleanup-run").disabled = !estimate.generations;
}

async function runCleanup() {
  if (!state.cleanupEstimate?.generations) return;
  const mode = $("#cleanup-mode").value;
  const destructive = mode !== "archive";
  const message = destructive
    ? `${cleanupSummary(state.cleanupEstimate)}. Procedere? I file cancellati non saranno recuperabili dalla webapp.`
    : `${cleanupSummary(state.cleanupEstimate)}. Procedere con l'archiviazione?`;
  if (!confirm(message)) return;
  const result = await api("/api/generations/cleanup/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...cleanupCriteria(), mode }),
  });
  state.selectedIds.clear();
  state.cleanupEstimate = null;
  $("#cleanup-run").disabled = true;
  $("#cleanup-result").textContent = `Pulizia completata: ${result.generations || 0} generazioni, ${result.filesDeleted || 0} file eliminati.`;
  await loadHistory();
}

$("#select-visible-history").addEventListener("click", () => {
  for (const item of filteredHistory()) {
    if (!["queued", "running"].includes(item.status)) state.selectedIds.add(item.id);
  }
  render();
});
$("#clear-history-selection").addEventListener("click", () => {
  state.selectedIds.clear();
  render();
});
$("#archive-selected-history").addEventListener("click", () => {
  const ids = state.history
    .filter((item) => state.selectedIds.has(item.id)
      && !item.archived
      && !["queued", "running"].includes(item.status))
    .map((item) => item.id);
  setArchived(ids, true).catch((error) => showToast(error.message));
});
$("#restore-selected-history").addEventListener("click", () => {
  const ids = state.history
    .filter((item) => state.selectedIds.has(item.id) && item.archived)
    .map((item) => item.id);
  setArchived(ids, false).catch((error) => showToast(error.message));
});
$("#cleanup-open").addEventListener("click", () => {
  $("#cleanup-panel").classList.remove("hidden");
});
$("#cleanup-close").addEventListener("click", () => {
  $("#cleanup-panel").classList.add("hidden");
});
$("#cleanup-estimate").addEventListener("click", () =>
  estimateCleanup().catch((error) => showToast(error.message))
);
$("#cleanup-run").addEventListener("click", () =>
  runCleanup().catch((error) => showToast(error.message))
);
for (const selector of ["#cleanup-older-than", "#cleanup-mode"]) {
  $(selector).addEventListener("change", () => {
    state.cleanupEstimate = null;
    $("#cleanup-run").disabled = true;
    $("#cleanup-result").textContent = "Stima da aggiornare.";
  });
}

$("#history").addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-select-generation]");
  if (!checkbox) return;
  if (checkbox.checked) state.selectedIds.add(checkbox.dataset.selectGeneration);
  else state.selectedIds.delete(checkbox.dataset.selectGeneration);
  renderArchiveActions();
});

$("#history").addEventListener("click", async (event) => {
  const lazyVideo = event.target.closest("[data-load-video]");
  if (lazyVideo) {
    const wrapper = lazyVideo.closest("[data-lazy-video]");
    const src = wrapper?.dataset.lazyVideo;
    if (!src || wrapper.querySelector("video")) return;
    lazyVideo.replaceWith(Object.assign(document.createElement("video"), {
      controls: true,
      playsInline: true,
      preload: "metadata",
      src,
    }));
    return;
  }
  const archiveButton = event.target.closest("[data-archive-job]");
  if (archiveButton) {
    archiveButton.disabled = true;
    try {
      await setArchived(
        [archiveButton.dataset.archiveJob],
        archiveButton.dataset.archiveValue === "true",
      );
    } catch (error) {
      archiveButton.disabled = false;
      showToast(error.message);
    }
    return;
  }
  const button = event.target.closest("[data-cancel-job]");
  if (!button || !confirm("Vuoi annullare questa generazione?")) return;
  button.disabled = true;
  button.textContent = "Annullamento…";
  try {
    await api(`/api/generations/${button.dataset.cancelJob}/cancel`, { method: "POST" });
    await loadHistory();
    showToast("Generazione annullata");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Annulla";
    showToast(error.message);
  }
});

async function start() {
  try {
    await Promise.all([checkHealth(), loadHistory()]);
    connectEvents();
    createAdaptivePoller(checkHealth, { idleMs: 15_000, hiddenMs: 60_000 });
  } catch (error) {
    showToast(error.message);
  }
}

start();
