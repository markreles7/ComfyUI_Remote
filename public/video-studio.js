import { enhanceMainPrompt } from "./prompt-assistant.js";
import { consumeGuidedHandoff, guidedTokenFromLocation, setInputFile } from "./guided-handoff.js";

const state = {
  config: null,
  projects: [],
  dialogue: [
    { speaker: "John", line: "", delivery: "con tono naturale" },
    { speaker: "Attore 1", line: "", delivery: "risponde guardando John" },
  ],
  loras: [],
  actorFrame: null,
  actorMask: null,
  actorDrawing: false,
};

const $ = (selector) => document.querySelector(selector);

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function mode() {
  return document.querySelector("[name=videoStudioMode]:checked")?.value || "actorReplacement";
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

function renderDialogue() {
  $("#dialogue-list").innerHTML = state.dialogue.map((row, index) => `
    <div class="dialogue-row" data-dialogue="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <input class="dialogue-speaker" aria-label="Personaggio battuta ${index + 1}" value="${escapeHtml(row.speaker)}" placeholder="Personaggio">
      <input class="dialogue-line" aria-label="Testo battuta ${index + 1}" value="${escapeHtml(row.line)}" placeholder="Battuta…">
      <input class="dialogue-delivery" aria-label="Recitazione battuta ${index + 1}" value="${escapeHtml(row.delivery)}" placeholder="tono / sguardo">
      <button type="button" aria-label="Rimuovi battuta ${index + 1}" data-remove-dialogue="${index}">×</button>
    </div>
  `).join("");
  syncDialogue();
}

function syncDialogue() {
  state.dialogue = [...document.querySelectorAll(".dialogue-row")].map((row) => ({
    speaker: row.querySelector(".dialogue-speaker").value.trim(),
    line: row.querySelector(".dialogue-line").value.trim(),
    delivery: row.querySelector(".dialogue-delivery").value.trim(),
  }));
  $("#dialogue-json").value = JSON.stringify(state.dialogue);
}

function renderLoras() {
  const choices = state.config?.videoStudio?.ltxLoras || [];
  $("#video-loras").innerHTML = state.loras.map((row, index) => `
    <div class="studio-lora-row" data-video-lora="${index}">
      <select aria-label="LoRA Video Studio ${index + 1}">
        ${choices.map((name) => `<option value="${escapeHtml(name)}" ${name === row.name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
      </select>
      <input aria-label="Forza LoRA Video Studio ${index + 1}" type="number" min="-2" max="2" step=".05" value="${Number(row.strength ?? .8)}">
      <button type="button" data-remove-lora="${index}" aria-label="Rimuovi LoRA ${index + 1}">×</button>
    </div>
  `).join("");
  syncLoras();
}

function syncLoras() {
  state.loras = [...document.querySelectorAll("[data-video-lora]")].map((row) => ({
    name: row.querySelector("select").value,
    strength: Number(row.querySelector("input").value),
  })).filter((row) => row.name);
  $("#video-loras-json").value = JSON.stringify(state.loras);
}

function updateReadiness() {
  const videoConfig = state.config.videoStudio;
  const selectedMode = mode();
  const readiness = $("#video-studio-readiness");
  let ready;
  let title;
  let detail;

  if (selectedMode === "interactiveScene") {
    ready = videoConfig.capabilities.ingredients.available;
    title = ready ? "Interactive Scene pronto" : "Interactive Scene non disponibile";
    detail = ready
      ? `Ingredients installato${videoConfig.capabilities.lipdub.available ? " · LipDub disponibile" : " · LipDub mancante"}`
      : "Manca la IC-LoRA Ingredients oppure uno dei nodi LTX richiesti.";
  } else if (selectedMode === "sceneTransform") {
    ready = videoConfig.capabilities.unionControl.available;
    title = ready ? "Scene Transform Union Control pronto" : "Union Control non disponibile";
    detail = ready
      ? "Usa il video come guida temporale e il frame/reference come destinazione visiva."
      : "Installa la IC-LoRA Union Control e i nodi Canny/DW Pose LTX 2.3.";
  } else if (selectedMode === "actorReplacement") {
    const engine = $("#actorEngine").value;
    ready = engine === "unionControl"
      ? videoConfig.capabilities.unionControl.available
      : engine === "trackedInpaint"
        ? videoConfig.capabilities.inpaint.available
          && ($("#selectionMode").value === "manual" || videoConfig.capabilities.autoMask.available)
        : true;
    title = engine === "unionControl"
        ? (ready ? "Union Control corpo completo pronto" : "Union Control non disponibile")
        : engine === "trackedInpaint"
        ? (ready ? "LTX 2.3 Actor Replace pronto" : "Actor Replace richiede modello o maschera")
        : "Fallback Edit Anything pronto";
    detail = engine === "unionControl"
        ? "Consigliato per sostituire l'intero personaggio seguendo ballo, posa e camera del video."
        : engine === "trackedInpaint"
        ? (ready
            ? $("#selectionMode").value === "manual"
              ? "Userà il video maschera caricato manualmente."
              : "SAM3 traccia la zona scelta; LTX sostituisce viso, testa o corpo in quella regione."
            : "Installa la IC-LoRA In/Outpainting e SAM3, oppure usa una maschera video manuale.")
        : "Richiede una Identity LoRA personale; la reference fotografica da sola non codifica l’identità.";
  } else {
    const capabilityId = {
      hdr: "hdr",
      temporalUpscale: "temporalUpscale",
    }[selectedMode];
    const capability = capabilityId ? videoConfig.capabilities[capabilityId] : null;
    ready = capability ? capability.available : true;
    title = {
      hdr: ready ? "HDR IC-LoRA pronto" : "HDR in attesa del modello ufficiale",
      retake: "Retake con LTX 2.3",
      extend: "Extend con LTX 2.3",
      temporalUpscale: "Temporal Upscaler 2×",
    }[selectedMode];
    detail = ready
      ? {
          hdr: "Usa la pipeline IC-LoRA ufficiale, separata dai workflow LTX 2.3 Sulphur.",
          retake: "Video-to-video generativo con audio sorgente conservato.",
          extend: "Estrae l’ultimo frame, genera la continuazione e accoda video e audio.",
          temporalUpscale: "Raddoppia i frame nello spazio latente; può mantenere durata o creare slow motion.",
        }[selectedMode]
      : capability?.modelReady
        ? `Mancano nodi ComfyUI: ${(capability.missingNodes || []).join(", ")}`
        : selectedMode === "hdr"
          ? "La IC-LoRA HDR ufficiale è gated: occorre accettare la licenza Lightricks e installarla."
          : "Manca il modello richiesto nell’istanza ComfyUI attiva.";
  }
  readiness.className = `video-readiness ${ready ? "ready" : "blocked"}`;
  readiness.innerHTML = `<span>${ready ? "✓" : "!"}</span><div><b>${escapeHtml(title)}</b><p>${escapeHtml(detail)}</p></div>`;
  $("#video-studio-submit").disabled = !ready;
}

function updateMode() {
  const selected = mode();
  const sections = {
    actorReplacement: "#actor-replacement-fields",
    interactiveScene: "#interactive-scene-fields",
    sceneTransform: "#scene-transform-fields",
    retake: "#retake-fields",
    extend: "#extend-fields",
    hdr: "#hdr-fields",
    temporalUpscale: "#temporal-fields",
  };
  for (const [id, selector] of Object.entries(sections)) {
    const active = id === selected;
    const section = $(selector);
    section.classList.toggle("hidden", !active);
    section.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !active;
    });
  }
  const generative = ["retake", "extend"].includes(selected);
  $("#ltx-generative-settings").classList.toggle("hidden", !generative);
  $("#ltx-generative-settings").querySelectorAll("input, select").forEach((control) => {
    control.disabled = !generative;
  });
  updateReadiness();
}

function updateEngine() {
  let engine = $("#actorEngine").value;
  const scope = $("#replacementScope").value;
  if (scope === "body") {
    const unionOption = [...$("#actorEngine").options].find((option) =>
      option.value === "unionControl" && !option.disabled
    );
    if (unionOption && $("#actorEngine").value === "trackedInpaint") {
      $("#actorEngine").value = "unionControl";
      engine = "unionControl";
      showToast("Per corpo completo uso Union Control: segue posa e movimento della clip.");
    }
  }
  const tracked = engine === "trackedInpaint";
  const selectionMode = $("#selectionMode").value;
  $("#actor-selection-panel").classList.toggle("hidden", !tracked);
  const currentSelection = $("#selectionMode").value;
  $("#mask-video-field").classList.toggle("hidden", !(tracked && currentSelection === "manual"));
  $("#paint-tools").classList.toggle("hidden", !(tracked && currentSelection === "paint"));
  $("#target-face-index-field").classList.toggle("hidden", currentSelection !== "auto");
  $("#actor-selection-stage").classList.toggle("hidden", currentSelection === "manual");
  $("#identity-reference-hint").textContent = tracked
      ? "Guida l’identità che LTX ricostruirà nella zona seguita da SAM3."
      : engine === "unionControl"
        ? "Guida il nuovo performer nel motion transfer Union Control."
      : "Il fallback richiede una Identity LoRA; la sola foto non codifica un’identità precisa.";
  $("#maskDilation").value = scope === "body" ? 22 : scope === "head" ? 16 : 10;
  drawActorSelection();
  updateReadiness();
}

function ensureActorCanvases(width, height) {
  if (!width || !height) return;
  const canvas = $("#actor-selection-canvas");
  canvas.width = width;
  canvas.height = height;
  if (!state.actorFrame || state.actorFrame.width !== width || state.actorFrame.height !== height) {
    state.actorFrame = document.createElement("canvas");
    state.actorFrame.width = width;
    state.actorFrame.height = height;
  }
  if (!state.actorMask || state.actorMask.width !== width || state.actorMask.height !== height) {
    state.actorMask = document.createElement("canvas");
    state.actorMask.width = width;
    state.actorMask.height = height;
    const mask = state.actorMask.getContext("2d");
    mask.fillStyle = "#000";
    mask.fillRect(0, 0, width, height);
  }
}

function drawActorSelection() {
  const canvas = $("#actor-selection-canvas");
  if (!state.actorFrame || !canvas.width) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.actorFrame, 0, 0);
  if ($("#selectionMode").value === "paint" && state.actorMask) {
    context.save();
    context.globalAlpha = 0.48;
    context.drawImage(state.actorMask, 0, 0);
    context.restore();
  }
  $("#actor-selection-stage").classList.add("ready");
}

function actorCanvasPoint(event) {
  const canvas = $("#actor-selection-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width));
  const y = Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height));
  return { x, y, nx: x / canvas.width, ny: y / canvas.height, rect };
}

function selectActorPoint(event) {
  const point = actorCanvasPoint(event);
  $("#targetPointX").value = point.nx.toFixed(6);
  $("#targetPointY").value = point.ny.toFixed(6);
  const marker = $("#actor-selection-marker");
  const stageRect = $("#actor-selection-stage").getBoundingClientRect();
  marker.style.left = `${point.rect.left - stageRect.left + point.nx * point.rect.width}px`;
  marker.style.top = `${point.rect.top - stageRect.top + point.ny * point.rect.height}px`;
  marker.classList.remove("hidden");
}

function paintActorMask(event) {
  if (!state.actorMask) return;
  const point = actorCanvasPoint(event);
  const context = state.actorMask.getContext("2d");
  const scale = state.actorMask.width / Math.max(1, point.rect.width);
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(point.x, point.y, Number($("#maskBrushSize").value) * scale / 2, 0, Math.PI * 2);
  context.fill();
  drawActorSelection();
}

function clearActorMask() {
  if (!state.actorMask) return;
  const context = state.actorMask.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, state.actorMask.width, state.actorMask.height);
  drawActorSelection();
}

function maskBlob() {
  return new Promise((resolve, reject) => {
    if (!state.actorMask) return reject(new Error("Carica prima il video e disegna la persona."));
    state.actorMask.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Impossibile creare la maschera.")), "image/png");
  });
}

function setupPreview(inputSelector, targetSelector, className) {
  $(inputSelector).addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const target = $(targetSelector);
    target.src = URL.createObjectURL(file);
    target.parentElement.classList.add(className);
  });
}

function generationMedia(generation) {
  if (generation.videos?.length) {
    const index = generation.videos.length - 1;
    return `<video controls preload="metadata" src="/api/media/${generation.id}/${index}"></video>`;
  }
  return `<div class="video-stage-placeholder">${generation.status === "error" ? "Errore" : `${generation.progress || 0}%`}</div>`;
}

function statusLabel(status) {
  return {
    queued: "In coda",
    running: "In esecuzione",
    completed: "Completato",
    error: "Errore",
    interrupted: "Annullato",
  }[status] || status;
}

function renderProjects() {
  $("#video-studio-empty").classList.toggle("hidden", state.projects.length > 0);
  $("#video-studio-projects").innerHTML = state.projects.map((project) => {
    const completedVideo = [...(project.generations || [])].reverse().find((item) =>
      item.status === "completed" && item.videos?.length
    );
    const active = (project.generations || []).some((item) => ["queued", "running"].includes(item.status));
    const modeName = state.config.videoStudio.modes.find((item) => item.id === project.videoStudioMode)?.name || project.videoStudioMode;
    return `
      <article class="video-project-card">
        <header>
          <div><h3>${escapeHtml(project.name)}</h3><small>${escapeHtml(modeName)}</small></div>
          <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(statusLabel(project.status))}</span>
        </header>
        <p>${escapeHtml(project.prompt || "Progetto guidato Video Studio")}</p>
        <div class="video-project-stages">
          ${(project.generations || []).map((generation) => `
            <section>
              <div class="studio-result-label"><span>${escapeHtml(generation.videoStudioLabel || generation.workflowName)}</span><b>${escapeHtml(statusLabel(generation.status))}</b></div>
              ${generationMedia(generation)}
              ${generation.error ? `<p class="video-stage-error">${escapeHtml(generation.error)}</p>` : ""}
              ${["queued", "running"].includes(generation.status)
                ? `<button class="cancel-generation-button compact" type="button" data-cancel-job="${generation.id}">Annulla generazione</button>`
                : ""}
            </section>
          `).join("")}
        </div>
        ${completedVideo && ["actorReplacement", "interactiveScene"].includes(project.videoStudioMode) && state.config.videoStudio.capabilities.lipdub.available && !active ? `
          <button class="chip-button video-lipdub-action" type="button" data-lipdub="${project.id}" data-generation="${completedVideo.id}">
            Applica / correggi dialogo e LipDub
          </button>
        ` : ""}
      </article>
    `;
  }).join("");
}

async function refreshProjects() {
  try {
    state.projects = await api("/api/video-studio/projects");
    renderProjects();
  } catch {
    // Il polling riprova senza bloccare il form.
  }
}

async function submitProject(event) {
  event.preventDefault();
  syncDialogue();
  syncLoras();
  const button = $("#video-studio-submit");
  const status = $("#video-studio-status");
  const form = new FormData(event.currentTarget);
  const selectedMode = mode();
  const promptByMode = {
    actorReplacement: "#actorPrompt",
    interactiveScene: "#interactivePrompt",
    sceneTransform: "#sceneTransformPrompt",
    retake: "#retakePrompt",
    extend: "#extendPrompt",
    hdr: "#hdrPrompt",
  };
  const durationByMode = {
    actorReplacement: "#duration",
    interactiveScene: "#interactiveDuration",
    sceneTransform: "#duration",
    retake: "#retakeDuration",
  };
  form.set("videoStudioMode", selectedMode);
  form.set("prompt", promptByMode[selectedMode] ? $(promptByMode[selectedMode]).value : "Temporal interpolation");
  if (durationByMode[selectedMode]) form.set("duration", $(durationByMode[selectedMode]).value);
  form.set("dialogue", $("#dialogue-json").value);
  form.set("loras", $("#video-loras-json").value);
  button.disabled = true;
  status.textContent = "Upload e preflight del workflow…";
  try {
    if (selectedMode === "actorReplacement"
        && $("#actorEngine").value === "trackedInpaint"
        && $("#selectionMode").value === "paint") {
      const blob = await maskBlob();
      form.set("initialMaskImage", new File([blob], "actor-initial-mask.png", { type: "image/png" }));
    }
    const project = await api("/api/video-studio/projects", { method: "POST", body: form });
    state.projects.unshift(project);
    renderProjects();
    status.textContent = "Progetto aggiunto alla coda.";
    showToast("Video Studio: progetto creato.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
    updateReadiness();
  }
}

async function applyLipdub(button) {
  button.disabled = true;
  try {
    const project = await api(`/api/video-studio/projects/${button.dataset.lipdub}/lipdub`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: button.dataset.generation }),
    });
    state.projects = state.projects.map((item) => item.id === project.id ? project : item);
    renderProjects();
    showToast("LipDub aggiunto alla coda.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function cancelProjectGeneration(button) {
  if (!confirm("Vuoi annullare questa generazione?")) return;
  button.disabled = true;
  button.textContent = "Annullamento…";
  try {
    await api(`/api/generations/${button.dataset.cancelJob}/cancel`, { method: "POST" });
    await refreshProjects();
    showToast("Generazione annullata");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Annulla generazione";
    showToast(error.message);
  }
}

async function start() {
  [state.config, state.projects] = await Promise.all([
    api("/api/config"),
    api("/api/video-studio/projects"),
  ]);
  const engines = state.config.videoStudio.engines;
  $("#actorEngine").innerHTML = engines.map((engine) =>
    `<option value="${engine.id}" ${engine.available ? "" : "disabled"}>${escapeHtml(engine.name)}${engine.available ? "" : " · non installato"}</option>`
  ).join("");
  const preferred = engines.find((engine) => engine.id === "trackedInpaint" && engine.available)
    || engines.find((engine) => engine.available);
  $("#actorEngine").value = preferred?.id || "editAnything";
  $("#studioVideoModel").innerHTML = (state.config.videoModels || [])
    .filter((model) => model.available !== false)
    .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === "normal" ? "selected" : ""}>${escapeHtml(model.name)}</option>`)
    .join("");
  const influencers = state.config.virtualInfluencer?.availableProfiles || [];
  $("#videoVirtualInfluencerId").innerHTML = [
    `<option value="">Nessuna</option>`,
    ...influencers.map((profile) =>
      `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.displayName)} · ${profile.canonicalReferences} canoniche</option>`
    ),
  ].join("");
  const requestedWorkflow = new URLSearchParams(location.search).get("workflow");
  if (state.config.videoStudio.modes.some((item) => item.id === requestedWorkflow)) {
    const requested = document.querySelector(`[name=videoStudioMode][value="${requestedWorkflow}"]`);
    if (requested) requested.checked = true;
  }
  renderDialogue();
  renderLoras();
  updateMode();
  await applyGuidedCreation();
  updateEngine();
  for (const button of [$("#actor-prompt-assistant"), $("#interactive-prompt-assistant")]) {
    button.classList.toggle("hidden", !state.config.promptAssistant?.enabled);
  }
  renderProjects();
  checkHealth();
  setInterval(checkHealth, 15000);
  setInterval(refreshProjects, 3500);
}

function promptInputForMode(selectedMode) {
  return {
    actorReplacement: $("#actorPrompt"),
    interactiveScene: $("#interactivePrompt"),
    sceneTransform: $("#sceneTransformPrompt"),
    retake: $("#retakePrompt"),
    extend: $("#extendPrompt"),
    hdr: $("#hdrPrompt"),
  }[selectedMode] || null;
}

async function applyGuidedCreation() {
  const token = guidedTokenFromLocation();
  if (!token) return;
  const handoff = await consumeGuidedHandoff(token);
  if (!handoff?.payload?.fields) return;
  const { fields } = handoff.payload;
  const selectedMode = fields.videoStudioMode;
  const modeInput = selectedMode
    ? document.querySelector(`[name="videoStudioMode"][value="${CSS.escape(selectedMode)}"]`)
    : null;
  if (modeInput) modeInput.checked = true;
  updateMode();
  if (["normal", "sulphur"].includes(fields.engine)) {
    const option = [...$("#studioVideoModel").options].find((item) => item.value === fields.engine && !item.disabled);
    if (option) $("#studioVideoModel").value = fields.engine;
  }
  if (mode() === "actorReplacement" && fields.engine) {
    const actorOption = [...$("#actorEngine").options].find((item) => item.value === fields.engine && !item.disabled);
    if (actorOption) $("#actorEngine").value = fields.engine;
  }
  if (["retake", "extend"].includes(mode())) {
    $("#studioResolution").value = fields.quality === "speed"
      ? "360p"
      : fields.quality === "max"
        ? "720p"
        : "480p";
  }
  const promptInput = promptInputForMode(mode());
  if (promptInput && fields.prompt) {
    promptInput.value = fields.prompt;
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const [name, file] of Object.entries(handoff.files || {})) {
    const input = document.querySelector(`[name="${CSS.escape(name)}"]:not([disabled])`)
      || document.querySelector(`[name="${CSS.escape(name)}"]`);
    setInputFile(input, file);
  }
  history.replaceState({}, "", location.pathname);
  showToast("Workflow video preparato dalla guida. Controlla i dettagli prima di generare.");
}

document.querySelectorAll("[name=videoStudioMode]").forEach((input) => input.addEventListener("change", updateMode));
$("#actorEngine").addEventListener("change", updateEngine);
$("#replacementScope").addEventListener("change", updateEngine);
$("#selectionMode").addEventListener("change", updateEngine);
$("#targetFaceIndex").addEventListener("change", () => {
  $("#actor-selection-marker").classList.add("hidden");
});
$("#actor-selection-canvas").addEventListener("pointerdown", (event) => {
  const selectionMode = $("#selectionMode").value;
  if (selectionMode === "click") {
    selectActorPoint(event);
    return;
  }
  if (selectionMode === "paint") {
    state.actorDrawing = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    paintActorMask(event);
  }
});
$("#actor-selection-canvas").addEventListener("pointermove", (event) => {
  if (state.actorDrawing && $("#selectionMode").value === "paint") paintActorMask(event);
});
$("#actor-selection-canvas").addEventListener("pointerup", () => {
  state.actorDrawing = false;
});
$("#actor-selection-canvas").addEventListener("pointercancel", () => {
  state.actorDrawing = false;
});
$("#clear-actor-mask").addEventListener("click", clearActorMask);
$("#add-dialogue").addEventListener("click", () => {
  syncDialogue();
  state.dialogue.push({ speaker: "", line: "", delivery: "" });
  renderDialogue();
});
$("#dialogue-list").addEventListener("input", syncDialogue);
$("#dialogue-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-dialogue]");
  if (!button) return;
  syncDialogue();
  state.dialogue.splice(Number(button.dataset.removeDialogue), 1);
  renderDialogue();
});
$("#video-add-lora").addEventListener("click", () => {
  syncLoras();
  const first = state.config.videoStudio.ltxLoras[0];
  if (!first) return showToast("Nessuna LoRA LTX 2.3 installata.");
  state.loras.push({ name: first, strength: .8 });
  renderLoras();
});
$("#video-loras").addEventListener("input", syncLoras);
$("#video-loras").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-lora]");
  if (!button) return;
  syncLoras();
  state.loras.splice(Number(button.dataset.removeLora), 1);
  renderLoras();
});
$("#video-studio-projects").addEventListener("click", (event) => {
  const cancel = event.target.closest("[data-cancel-job]");
  if (cancel) {
    cancelProjectGeneration(cancel);
    return;
  }
  const button = event.target.closest("[data-lipdub]");
  if (button) applyLipdub(button);
});
$("#video-studio-form").addEventListener("submit", submitProject);
$("#actor-prompt-assistant").addEventListener("click", async () => {
  try {
    await enhanceMainPrompt({
      input: $("#actorPrompt"),
      button: $("#actor-prompt-assistant"),
      status: $("#actor-prompt-assistant-status"),
      target: "videostudio",
      mode: "image",
      workflowName: "Video Studio · Actor Replacement",
      sourceFile: document.querySelector('[name="identityImage"]')?.files[0] || null,
      negativeInput: $("#videoNegativePrompt"),
      includeNegative: true,
    });
    showToast("Prompt Actor Replacement creato; LM Studio scaricato.");
    if (state.config.promptAssistant?.autoGenerate) $("#video-studio-form").requestSubmit();
  } catch {
    // Stato mostrato accanto al prompt.
  }
});
$("#interactive-prompt-assistant").addEventListener("click", async () => {
  try {
    await enhanceMainPrompt({
      input: $("#interactivePrompt"),
      button: $("#interactive-prompt-assistant"),
      status: $("#interactive-prompt-assistant-status"),
      target: "videostudio",
      mode: "image",
      workflowName: "Video Studio · Interactive Scene",
      sourceFile: $("#reference-sheet").files[0] || null,
      negativeInput: $("#videoNegativePrompt"),
      includeNegative: true,
    });
    showToast("Prompt Interactive Scene creato; LM Studio scaricato.");
    if (state.config.promptAssistant?.autoGenerate) $("#video-studio-form").requestSubmit();
  } catch {
    // Stato mostrato accanto al prompt.
  }
});
setupPreview("#actor-source-video", "#actor-video-preview", "has-video");
setupPreview("#reference-sheet", "#reference-sheet-preview", "has-image");
$("#actor-video-preview").addEventListener("loadedmetadata", (event) => {
  const video = event.currentTarget;
  video.currentTime = Math.min(0.08, Math.max(0, (video.duration || 0) / 100));
});
$("#actor-video-preview").addEventListener("seeked", (event) => {
  const video = event.currentTarget;
  ensureActorCanvases(video.videoWidth, video.videoHeight);
  const context = state.actorFrame.getContext("2d");
  context.drawImage(video, 0, 0, state.actorFrame.width, state.actorFrame.height);
  $("#actor-selection-marker").classList.add("hidden");
  drawActorSelection();
});

start().catch((error) => {
  $("#video-studio-status").textContent = error.message;
  setConnection(false);
});
