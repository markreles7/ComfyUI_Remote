import { enhanceMainPrompt } from "./prompt-assistant.js";
import { consumeGuidedHandoff, guidedTokenFromLocation, setInputFile } from "./guided-handoff.js";
import { setupUploadPreviews } from "./upload-previews.js";

const state = {
  config: null,
  projects: [],
  dialogue: [
    { speaker: "John", line: "", delivery: "con tono naturale" },
    { speaker: "Attore 1", line: "", delivery: "risponde guardando John" },
  ],
  loras: [],
  sequentialStories: [],
  interactiveCastProjects: [],
  interactiveCastEvents: [
    { speaker: "New Actor", start: 3, end: 5, dialogue: "", action: "enters the scene", reaction: "none", mode: "" },
    { speaker: "Original Actor 1", start: 5, end: 7, dialogue: "", action: "turns and answers", reaction: "speak", mode: "" },
  ],
  sequentialPlan: null,
  actorFrame: null,
  actorMask: null,
  actorDrawing: false,
  projectsRenderKey: "",
};

const $ = (selector) => document.querySelector(selector);

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function jsonApi(url, body, options = {}) {
  return api(url, {
    ...options,
    method: options.method || "POST",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify(body || {}),
  });
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

function selectedCharacter() {
  const id = $("#videoCharacterId")?.value;
  if (!id) return null;
  return (state.config?.characters?.availableCharacters || []).find((character) => character.id === id) || null;
}

function syncCharacterFields() {
  const character = selectedCharacter();
  const settings = character?.settings || {};
  $("#videoCharacterIdentityStrength").value = settings.identityStrength || "medium";
  $("#videoCharacterLockFace").value = String(settings.lockFace ?? true);
  $("#videoCharacterLockHair").value = String(settings.lockHair ?? true);
  $("#videoCharacterLockBody").value = String(settings.lockBody ?? true);
  $("#videoCharacterLockOutfit").value = String(settings.lockOutfit ?? false);
  $("#video-character-hint").textContent = character
    ? "Per i video il Character Pack prepara reference e futuro anchor frame; se il workflow non supporta conditioning verra' dichiarato come fallback."
    : "Usa il Character Pack come identita, reference sheet o base futura per anchor frame.";
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

  if (selectedMode === "sequentialStory") {
    ready = Boolean(state.config.promptAssistant?.enabled);
    title = ready ? "Storia continua pronta" : "Storia continua richiede LM Studio";
    detail = ready
      ? "LM Studio pianifica le scene; Node genera una clip alla volta, estrae continuity frame, fa purge e concatena."
      : "Configura il Prompt Assistant locale per generare la scaletta JSON prima del render.";
  } else if (selectedMode === "interactiveScene") {
    ready = videoConfig.capabilities.ingredients.available;
    title = ready ? "Interactive Scene pronto" : "Interactive Scene non disponibile";
    detail = ready
      ? `Ingredients installato${videoConfig.capabilities.lipdub.available ? " · LipDub disponibile" : " · LipDub mancante"}`
      : "Manca la IC-LoRA Ingredients oppure uno dei nodi LTX richiesti.";
  } else if (selectedMode === "interactiveCast") {
    const cast = state.config.interactiveCast;
    ready = Boolean(cast?.matrix?.videoAnalysis && cast?.matrix?.temporalSplice);
    title = ready ? "Interactive Cast pronto" : "Interactive Cast richiede FFmpeg/FFprobe";
    detail = ready
      ? `Pipeline ibrida pronta: tracking, timeline, anchor e segmenti LTX automatici${cast?.matrix?.voiceClone ? " · voce locale" : ""}${cast?.matrix?.lipSync ? " · lip-sync locale" : ""}. Le capability opzionali sono indicate nella matrice.`
      : "Installa FFmpeg/FFprobe nel PATH prima di creare progetti Interactive Cast.";
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

function castStatusClass(status) {
  const text = String(status || "NOT CONFIGURED").toUpperCase();
  if (text.includes("READY") || text.includes("WORKING")) return "ready";
  if (text.includes("FALLBACK")) return "fallback";
  return "not-configured";
}

function renderInteractiveCastCapabilities() {
  const host = $("#interactive-cast-capabilities");
  if (!host) return;
  const cast = state.config?.interactiveCast || {};
  const statuses = cast.statuses || {};
  const matrix = cast.matrix || {};
  const rows = [
    ["Video analysis", statuses.videoAnalysis, matrix.videoAnalysis],
    ["Actor tracking", statuses.personTracking, matrix.actorTracking],
    ["Scene segmentation", statuses.sceneSegmentation, true],
    ["Audio extraction", statuses.audioExtraction, matrix.audioSeparation],
    ["Source separation", statuses.sourceSeparation, matrix.audioSeparation],
    ["Speaker diarization", statuses.speakerDiarization, matrix.diarization],
    ["Voice cloning", statuses.voiceCloning, matrix.voiceClone],
    ["Lip-sync", statuses.lipSync, matrix.lipSync],
    ["Character insertion", statuses.ltxSegmentGeneration, matrix.characterInsertion],
    ["Identity check", statuses.identityCheck, matrix.identityCheck],
    ["Masked compositing", statuses.maskedCompositing || statuses.compositing, matrix.maskedCompositing],
    ["Audio remix", statuses.audioRemix, matrix.audioSeparation],
    ["Temporal splice", statuses.temporalSplice || (matrix.temporalSplice ? "READY" : "NOT CONFIGURED"), matrix.temporalSplice],
    ["Final encode", statuses.finalEncode || (matrix.finalEncode ? "READY" : "NOT CONFIGURED"), matrix.finalEncode],
  ];
  const gpu = cast.hardware?.gpu;
  const disk = cast.hardware?.disk;
  const comfyTorch = cast.runtimes?.comfyPython?.torch;
  host.innerHTML = `
    <div class="interactive-cast-capability-grid">
      ${rows.map(([label, status, available]) => {
        const displayStatus = status || (available ? "READY" : "NOT CONFIGURED");
        return `<span class="cast-capability ${castStatusClass(displayStatus)}"><b>${escapeHtml(label)}</b><em>${escapeHtml(displayStatus)}</em></span>`;
      }).join("")}
    </div>
    <div class="interactive-cast-runtime-strip">
      <small><b>GPU</b> ${escapeHtml(gpu?.available ? `${gpu.name || "NVIDIA"} · ${gpu.vramMb || "?"} MB VRAM` : "NOT CONFIGURED")}</small>
      <small><b>Disco tool</b> ${escapeHtml(disk?.available ? `${disk.freeGb} GB liberi` : "n/d")}</small>
      <small><b>Comfy Torch</b> ${escapeHtml(comfyTorch?.cudaAvailable ? `${comfyTorch.torch} · CUDA ${comfyTorch.cudaVersion}` : "NOT CONFIGURED")}</small>
    </div>
  `;
}

async function refreshInteractiveCastCapabilities(button = null) {
  if (button) {
    button.disabled = true;
    button.textContent = "Aggiorno...";
  }
  try {
    state.config.interactiveCast = await api("/api/interactive-cast/capabilities");
    renderInteractiveCastCapabilities();
    updateReadiness();
    if (button) showToast("Capability Interactive Cast aggiornate.");
  } catch (error) {
    showToast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Aggiorna capability";
    }
  }
}

function updateMode() {
  const selected = mode();
  const sections = {
    actorReplacement: "#actor-replacement-fields",
    interactiveScene: "#interactive-scene-fields",
    interactiveCast: "#interactive-cast-fields",
    sceneTransform: "#scene-transform-fields",
    retake: "#retake-fields",
    extend: "#extend-fields",
    hdr: "#hdr-fields",
    temporalUpscale: "#temporal-fields",
    sequentialStory: "#sequential-story-fields",
  };
  for (const [id, selector] of Object.entries(sections)) {
    const active = id === selected;
    const section = $(selector);
    section.classList.toggle("hidden", !active);
    section.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !active;
    });
  }
  const generative = ["retake", "extend", "sequentialStory"].includes(selected);
  $("#ltx-generative-settings").classList.toggle("hidden", !generative);
  $("#ltx-generative-settings").querySelectorAll("input, select").forEach((control) => {
    control.disabled = !generative;
  });
  $("#video-studio-submit").classList.toggle("hidden", selected === "sequentialStory");
  $("#video-studio-submit").classList.toggle("hidden", ["sequentialStory", "interactiveCast"].includes(selected));
  renderInteractiveCastCapabilities();
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

function projectsRenderKey(projects) {
  return JSON.stringify((projects || []).map((project) => ({
    id: project.id,
    status: project.status,
    archived: Boolean(project.archived),
    updatedAt: project.updatedAt || "",
    generations: (project.generations || []).map((generation) => ({
      id: generation.id,
      status: generation.status,
      progress: generation.progress || 0,
      error: generation.error || "",
      videos: (generation.videos || []).map((file) => `${file.type || ""}/${file.subfolder || ""}/${file.filename || ""}`),
    })),
  })));
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
  const renderKey = projectsRenderKey(state.projects);
  if (renderKey === state.projectsRenderKey) return;
  state.projectsRenderKey = renderKey;
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
          <div class="video-project-card-actions">
            <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(statusLabel(project.status))}</span>
            <button class="chip-button danger-action compact" type="button"
              data-video-project-delete="${escapeHtml(project.id)}"
              ${active ? 'disabled title="Annulla prima le generazioni attive"' : 'title="Elimina progetto e file collegati"'}>
              Elimina
            </button>
          </div>
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
        <div class="video-project-actions">
          ${!active ? `<button class="chip-button" type="button" data-video-project-archive="${escapeHtml(project.id)}">Nascondi</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function sequentialSettings() {
  return {
    inputMode: $("#sequentialInputMode").value,
    workflowId: $("#sequentialWorkflowId").value,
    quality: $("#sequentialQuality").value,
    resolution: $("#studioResolution").value,
    orientation: $("#studioOrientation").value,
    fps: Number($("#sequentialFps").value || 24),
    sceneCount: Number($("#sequentialSceneCount").value || 3),
    sceneDuration: Number($("#sequentialSceneDuration").value || 10),
    pauseAfterEachScene: $("#sequentialPauseAfterEach").checked,
    useContinuityFrame: $("#sequentialContinuity").checked,
    purgeBetweenScenes: $("#sequentialPurge").checked,
    concatEnabled: $("#sequentialConcat").checked,
    audioMode: $("#sequentialAudioMode").value,
    transition: $("#sequentialTransition").value,
    frameOffsetMode: $("#sequentialFrameOffset").value,
    bestFrameSelector: $("#sequentialBestFrame").value,
    bestFrameSampleCount: Number($("#sequentialBestFrameSamples").value || 18),
    anchorFrameMode: $("#sequentialAnchorMode").value,
    identityVerification: $("#sequentialIdentityVerification").value,
    identityThreshold: Number($("#sequentialIdentityThreshold").value || 0.58),
    seedMode: $("#sequentialSeedMode").value,
    baseSeed: $("#sequentialBaseSeed").value,
    manualSeed: $("#sequentialManualSeed").value,
    videoModelId: $("#studioVideoModel").value,
    characterId: $("#videoCharacterId").value,
    identityStrength: $("#videoCharacterIdentityStrength").value,
    lockFace: $("#videoCharacterLockFace").value,
    lockHair: $("#videoCharacterLockHair").value,
    lockBody: $("#videoCharacterLockBody").value,
    lockOutfit: $("#videoCharacterLockOutfit").value,
  };
}

function syncSequentialInputMode() {
  const imageMode = $("#sequentialInputMode")?.value === "image";
  $("#sequential-initial-image-field")?.classList.toggle("hidden", !imageMode);
}

function sceneStatusLabel(status) {
  return {
    pending: "Pending",
    running: "Rendering",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
    stale: "Da rigenerare",
  }[status] || status || "Pending";
}

function renderSequentialScenes() {
  const scenes = state.sequentialPlan?.scenes || [];
  $("#sequential-start-button").disabled = !scenes.some((scene) => scene.enabled !== false);
  $("#sequential-scenes").innerHTML = scenes.map((scene, index) => `
    <article class="sequential-scene-card" data-sequential-scene="${index}">
      <header>
        <span>${String(index + 1).padStart(2, "0")}</span>
        <input class="sequential-scene-title" value="${escapeHtml(scene.title)}" aria-label="Titolo scena ${index + 1}">
        <label class="inline-check"><input class="sequential-scene-enabled" type="checkbox" ${scene.enabled === false ? "" : "checked"}> Abilitata</label>
      </header>
      <div class="field-grid">
        <div class="field"><label>Durata</label><input class="sequential-scene-duration" type="number" min="1" max="30" value="${Number(scene.duration || 10)}"></div>
        <div class="field"><label>Stato</label><input value="${escapeHtml(sceneStatusLabel(scene.status))}" disabled></div>
      </div>
      <div class="field"><label>Prompt scena</label><textarea class="sequential-scene-prompt" rows="4">${escapeHtml(scene.prompt)}</textarea></div>
      <div class="field"><label>Prompt negativo</label><textarea class="sequential-scene-negative" rows="2">${escapeHtml(scene.negativePrompt || "")}</textarea></div>
      <div class="field"><label>Continuity notes</label><textarea class="sequential-scene-continuity" rows="2">${escapeHtml(scene.continuityNotes || "")}</textarea></div>
      <div class="sequential-actions compact-row">
        <button class="chip-button" type="button" data-scene-move="up" ${index === 0 ? "disabled" : ""}>Su</button>
        <button class="chip-button" type="button" data-scene-move="down" ${index === scenes.length - 1 ? "disabled" : ""}>Giu</button>
        <button class="chip-button" type="button" data-scene-duplicate>Duplica</button>
        <button class="chip-button" type="button" data-scene-regenerate>Rigenera</button>
        <button class="chip-button" type="button" data-scene-delete>Elimina</button>
      </div>
    </article>
  `).join("");
}

function syncSequentialScenes() {
  if (!state.sequentialPlan) return;
  state.sequentialPlan.scenes = [...document.querySelectorAll("[data-sequential-scene]")].map((card, index) => ({
    ...(state.sequentialPlan.scenes[index] || {}),
    id: state.sequentialPlan.scenes[index]?.id || `scene-${index + 1}`,
    index: index + 1,
    title: card.querySelector(".sequential-scene-title").value.trim() || `Scena ${index + 1}`,
    duration: Number(card.querySelector(".sequential-scene-duration").value || 10),
    prompt: card.querySelector(".sequential-scene-prompt").value.trim(),
    negativePrompt: card.querySelector(".sequential-scene-negative").value.trim(),
    continuityNotes: card.querySelector(".sequential-scene-continuity").value.trim(),
    enabled: card.querySelector(".sequential-scene-enabled").checked,
  }));
}

async function generateSequentialPlan() {
  const status = $("#sequential-story-status");
  const button = $("#sequential-plan-button");
  button.disabled = true;
  status.textContent = "LM Studio sta creando la scaletta JSON...";
  try {
    const payload = await jsonApi("/api/video-studio/sequential-story/plan", {
      description: $("#sequentialDescription").value,
      globalStyle: $("#sequentialGlobalStyle").value,
      ...sequentialSettings(),
    });
    state.sequentialPlan = payload.plan;
    $("#videoProjectName").value ||= payload.plan.title || "Storia continua";
    renderSequentialScenes();
    status.textContent = "Scaletta pronta: puoi modificare le scene prima del render.";
    showToast("Scaletta Sequential Story generata.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function regenerateSequentialScene(index) {
  syncSequentialScenes();
  const scene = state.sequentialPlan?.scenes?.[index];
  if (!scene) return;
  const status = $("#sequential-story-status");
  status.textContent = `Rigenero la scena ${index + 1} con LM Studio...`;
  try {
    const payload = await jsonApi("/api/video-studio/sequential-story/plan", {
      description: `Riscrivi solo questa scena mantenendo la storia globale: ${scene.prompt}`,
      globalStyle: $("#sequentialGlobalStyle").value,
      ...sequentialSettings(),
      sceneCount: 1,
      sceneDuration: scene.duration,
    });
    state.sequentialPlan.scenes[index] = {
      ...scene,
      ...payload.plan.scenes[0],
      id: scene.id,
      index: index + 1,
      status: "pending",
      stale: false,
    };
    renderSequentialScenes();
    status.textContent = `Scena ${index + 1} rigenerata.`;
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  }
}

async function startSequentialStory() {
  syncSequentialScenes();
  const status = $("#sequential-story-status");
  if (!state.sequentialPlan?.scenes?.length) {
    status.textContent = "Genera o inserisci una scaletta prima di avviare.";
    return;
  }
  const settings = sequentialSettings();
  const initialImage = $("#sequentialInitialImage")?.files?.[0] || null;
  if (settings.inputMode === "image" && !initialImage) {
    status.textContent = "Carica un fotogramma iniziale per usare Immagine → Video.";
    showToast("Carica il fotogramma iniziale.");
    return;
  }
  const button = $("#sequential-start-button");
  button.disabled = true;
  status.textContent = "Creo il progetto persistente e avvio la sequenza...";
  try {
    let create;
    const body = {
      title: $("#videoProjectName").value || state.sequentialPlan.title || "Storia continua",
      plan: state.sequentialPlan,
      settings,
    };
    if (initialImage) {
      const form = new FormData();
      form.set("payload", JSON.stringify(body));
      form.set("initialImage", initialImage);
      create = await api("/api/video-studio/sequential-story", {
        method: "POST",
        body: form,
      });
    } else {
      create = await jsonApi("/api/video-studio/sequential-story", body);
    }
    const started = await api(`/api/video-studio/sequential-story/${create.project.id}/start`, { method: "POST" });
    state.sequentialStories = [started.project, ...state.sequentialStories.filter((item) => item.id !== started.project.id)];
    renderSequentialStories();
    status.textContent = "Sequenza avviata. Il progresso appare nella colonna progetti.";
    showToast("Storia continua avviata.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

function sequentialSceneMedia(scene) {
  if (scene.generationId && scene.outputVideo) {
    return `<video controls preload="metadata" src="/api/media/${escapeHtml(scene.generationId)}/0"></video>`;
  }
  return `<div class="video-stage-placeholder">${escapeHtml(sceneStatusLabel(scene.status))}</div>`;
}

function renderSequentialStories() {
  $("#sequential-story-empty").classList.toggle("hidden", state.sequentialStories.length > 0);
  $("#sequential-story-projects").innerHTML = state.sequentialStories.map((project) => {
    const scenes = project.scenes || [];
    const completed = scenes.filter((scene) => scene.status === "completed").length;
    const progress = Math.round(Number(project.progress || (completed / Math.max(1, scenes.length)) * 100));
    const finalMedia = project.finalGenerationId && project.finalVideo
      ? `<video controls preload="metadata" src="/api/media/${escapeHtml(project.finalGenerationId)}/0"></video>`
      : "";
    return `
      <article class="video-project-card sequential-project-card" data-sequential-project="${escapeHtml(project.id)}">
        <header>
          <div><h3>${escapeHtml(project.title)}</h3><small>Sequential Story · ${completed}/${scenes.length} scene</small></div>
          <div class="video-project-card-actions">
            <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(project.status)}</span>
            ${project.status === "running" ? `<button class="chip-button compact" type="button" data-sequential-action="cancel">Annulla</button>` : ""}
            <button class="chip-button danger-action compact" type="button" data-sequential-action="delete"
              ${project.status === "running" ? 'disabled title="Annulla la sequenza prima di eliminarla"' : 'title="Elimina il progetto dal pannello"'}>
              Elimina
            </button>
          </div>
        </header>
        <div class="sequential-progress"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>
        ${project.error ? `<p class="video-stage-error">${escapeHtml(project.error)}</p>` : ""}
        <div class="sequential-project-controls">
          ${project.status === "running" ? `<button class="chip-button" type="button" data-sequential-action="pause">Pausa</button>` : ""}
          ${["planned", "paused", "failed"].includes(project.status) ? `<button class="chip-button" type="button" data-sequential-action="resume">Continua</button>` : ""}
          ${["paused", "failed", "planned"].includes(project.status) ? `<button class="chip-button" type="button" data-sequential-action="cancel">Annulla</button>` : ""}
        </div>
        <div class="video-project-stages">
          ${scenes.map((scene) => `
            <section class="${scene.stale ? "is-stale" : ""}">
              <div class="studio-result-label"><span>${escapeHtml(scene.index)} · ${escapeHtml(scene.title)}</span><b>${escapeHtml(sceneStatusLabel(scene.status))}</b></div>
              ${sequentialSceneMedia(scene)}
              <p>${escapeHtml(scene.prompt || "")}</p>
              <small>Seed ${escapeHtml(scene.seed ?? "random")} · anchor ${escapeHtml(scene.anchorStatus || "no anchor generator configured")}</small>
              ${scene.continuityFrame ? `<small>Continuity frame: ${escapeHtml(scene.continuityFrame.filename || "estratto")}</small>` : ""}
              ${scene.identityReport ? `<small>Identity: ${escapeHtml(scene.identityReport.status)} · avg ${escapeHtml(scene.identityReport.averageSimilarity ?? "n/d")}</small>` : ""}
              ${scene.error ? `<p class="video-stage-error">${escapeHtml(scene.error)}</p>` : ""}
              ${["failed", "completed", "stale"].includes(scene.status) ? `<button class="chip-button" type="button" data-sequential-scene-retry="${escapeHtml(scene.id)}">Rigenera scena</button>` : ""}
            </section>
          `).join("")}
        </div>
        ${finalMedia}
        ${project.concatWarning ? `<p class="hint">${escapeHtml(project.concatWarning)}</p>` : ""}
      </article>
    `;
  }).join("");
}

function renderInteractiveCastEvents() {
  $("#interactive-cast-events").innerHTML = state.interactiveCastEvents.map((event, index) => `
    <div class="dialogue-row interactive-cast-event" data-interactive-cast-event="${index}">
      <span class="cast-event-index">${String(index + 1).padStart(2, "0")}</span>
      <label class="cast-event-field cast-event-speaker">
        <span>Personaggio</span>
        <input class="cast-speaker" aria-label="Personaggio ${index + 1}" value="${escapeHtml(event.speaker)}" placeholder="New Actor / original-1">
      </label>
      <label class="cast-event-field cast-event-start">
        <span>Da (sec)</span>
        <input class="cast-start" aria-label="Inizio ${index + 1}" type="number" min="0" step=".1" value="${Number(event.start ?? 0)}">
      </label>
      <label class="cast-event-field cast-event-end">
        <span>A (sec)</span>
        <input class="cast-end" aria-label="Fine ${index + 1}" type="number" min="0" step=".1" value="${Number(event.end ?? 2)}">
      </label>
      <label class="cast-event-field cast-event-dialogue">
        <span>Battuta esatta</span>
        <input class="cast-dialogue" aria-label="Battuta ${index + 1}" value="${escapeHtml(event.dialogue)}" placeholder="Testo esatto da pronunciare">
      </label>
      <label class="cast-event-field cast-event-action">
        <span>Azione visiva</span>
        <input class="cast-action" aria-label="Azione ${index + 1}" value="${escapeHtml(event.action)}" placeholder="Enters from the right, turns, exits...">
      </label>
      <label class="cast-event-field cast-event-reaction">
        <span>Reazione</span>
        <select class="cast-reaction" aria-label="Reazione ${index + 1}">
          ${[
            ["none", "Nessuna"],
            ["look", "Guarda"],
            ["speak", "Parla"],
            ["move", "Movimento"],
          ].map(([value, label]) => `<option value="${value}" ${value === event.reaction ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <label class="cast-event-field cast-event-mode">
        <span>Modalità</span>
        <select class="cast-mode" aria-label="Modalità edit ${index + 1}">
          ${[
            ["", "Auto"],
            ["audioOnly", "Solo audio"],
            ["lipSyncOnly", "Lip-sync"],
            ["composite", "Compositing"],
            ["generative", "Generativa"],
          ].map(([value, label]) => `<option value="${value}" ${value === (event.mode || "") ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <button class="cast-event-remove" type="button" title="Rimuovi intervento" aria-label="Rimuovi evento ${index + 1}" data-remove-cast-event="${index}">×</button>
    </div>
  `).join("");
}

function syncInteractiveCastEvents() {
  state.interactiveCastEvents = [...document.querySelectorAll("[data-interactive-cast-event]")].map((row) => ({
    speaker: row.querySelector(".cast-speaker").value.trim(),
    start: Number(row.querySelector(".cast-start").value || 0),
    end: Number(row.querySelector(".cast-end").value || 0),
    dialogue: row.querySelector(".cast-dialogue").value.trim(),
    action: row.querySelector(".cast-action").value.trim(),
    reaction: row.querySelector(".cast-reaction").value,
    mode: row.querySelector(".cast-mode").value,
    preserveVoice: true,
    preserveFace: true,
  }));
}

function renderInteractiveCastProjects() {
  const assetUrl = (project, relativePath) =>
    `/api/interactive-cast/projects/${encodeURIComponent(project.id)}/assets/${String(relativePath || "").split("/").map(encodeURIComponent).join("/")}`;
  const taskForSegment = (project, segmentId) =>
    (project.renderPackage?.segmentTasks?.tasks || []).find((task) => task.segmentId === segmentId) || null;
  $("#interactive-cast-empty").classList.toggle("hidden", state.interactiveCastProjects.length > 0);
  $("#interactive-cast-projects").innerHTML = state.interactiveCastProjects.map((project) => `
    <article class="video-project-card interactive-cast-card">
      <header>
        <div><h3>${escapeHtml(project.title)}</h3><small>Interactive Cast · ${escapeHtml(project.status)}</small></div>
        <div class="video-project-card-actions">
          <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(project.status)}</span>
          <button class="chip-button danger-action" type="button" data-interactive-cast-delete="${escapeHtml(project.id)}">Elimina</button>
        </div>
      </header>
      <p>${escapeHtml(project.sourceVideo?.originalName || "video sorgente")}</p>
      <div class="cast-metrics">
        <span>${escapeHtml(project.analysis?.width || 0)}×${escapeHtml(project.analysis?.height || 0)}</span>
        <span>${Number(project.analysis?.duration || 0).toFixed(1)}s</span>
        <span>${Number(project.analysis?.fps || 0).toFixed(2)} fps</span>
        <span>${escapeHtml(project.analysis?.codec || "codec n/d")}</span>
      </div>
      ${project.stages ? `
        <div class="interactive-cast-stages">
          ${Object.entries(project.stages).map(([stage, info]) => `
            <span class="interactive-cast-stage stage-${escapeHtml(info.status || "unknown")}">
              <b>${escapeHtml(stage)}</b>
              ${escapeHtml(info.status || "unknown")}
              ${info.error ? `<em>${escapeHtml(info.error)}</em>` : ""}
            </span>
          `).join("")}
        </div>
      ` : ""}
      ${(project.actors?.original || []).length ? `
        <div class="interactive-cast-actors">
          <small><b>Attori originali</b> assegna nomi interni alla clip</small>
          ${(project.actors.original || []).map((actor) => `
            <div class="interactive-cast-actor-row" data-cast-actor="${escapeHtml(project.id)}:${escapeHtml(actor.actorId)}">
              <span>${escapeHtml(actor.actorId)}</span>
              <input data-cast-actor-label value="${escapeHtml(actor.label || actor.actorId)}" placeholder="Nome attore">
              <input data-cast-actor-role value="${escapeHtml(actor.role || "")}" placeholder="Ruolo/note brevi">
            </div>
          `).join("")}
          <button class="chip-button compact" type="button" data-interactive-cast-actors="${escapeHtml(project.id)}">Salva attori</button>
        </div>
      ` : ""}
      ${(project.actors?.added || []).some((actor) => actor.reference?.relativePath) ? `
        <div class="interactive-cast-frames">
          ${(project.actors.added || []).filter((actor) => actor.reference?.relativePath).map((actor) => `
            <figure>
              <img src="${assetUrl(project, actor.reference.relativePath)}" alt="${escapeHtml(actor.name || "New Actor")} reference">
              <figcaption>${escapeHtml(actor.name || "New Actor")} · reference temporanea</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : ""}
      ${(project.artifacts?.frames || []).some((frame) => frame.relativePath) ? `
        <div class="interactive-cast-frames">
          ${(project.artifacts.frames || []).filter((frame) => frame.relativePath).map((frame) => `
            <figure>
              <img src="${assetUrl(project, frame.relativePath)}" alt="${escapeHtml(frame.role)} frame">
              <figcaption>${escapeHtml(frame.role)} · ${Number(frame.time || 0).toFixed(2)}s</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : ""}
      ${project.artifacts?.audio?.relativePath ? `
        <audio class="interactive-cast-audio" controls preload="metadata" src="${assetUrl(project, project.artifacts.audio.relativePath)}"></audio>
      ` : ""}
      ${(project.audioAnalysis?.stems || []).some((stem) => stem.relativePath) ? `
        <div class="interactive-cast-audio-tasks">
          <small><b>Audio stems fallback</b> ${escapeHtml(project.audioAnalysis.sourceSeparation || "FALLBACK")}</small>
          ${(project.audioAnalysis.stems || []).filter((stem) => stem.relativePath).map((stem) => `
            <div class="interactive-cast-audio-task ready">
              <small><b>${escapeHtml(stem.role)}</b> ${escapeHtml(stem.method || "ffmpeg")}</small>
              <audio controls preload="metadata" src="${assetUrl(project, stem.relativePath)}"></audio>
              <em>${escapeHtml(stem.note || "Stem fallback")}</em>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${(project.audioAnalysis?.speakers || []).length ? `
        <div class="interactive-cast-speakers">
          <small><b>Speaker diarization</b> ${escapeHtml(project.audioAnalysis.diarization || "FALLBACK")} · correggibile</small>
          ${(project.audioAnalysis.speakers || []).map((speaker, index) => `
            <div class="interactive-cast-speaker-row" data-cast-speaker="${escapeHtml(project.id)}:${index}">
              <input data-cast-speaker-id value="${escapeHtml(speaker.speaker || `SPEAKER_${String(index).padStart(2, "0")}`)}" aria-label="Speaker ${index + 1}">
              <input data-cast-speaker-start type="number" step=".1" min="0" value="${Number(speaker.start || 0)}" aria-label="Start speaker ${index + 1}">
              <input data-cast-speaker-end type="number" step=".1" min="0" value="${Number(speaker.end || 0)}" aria-label="End speaker ${index + 1}">
              <select data-cast-speaker-actor aria-label="Attore speaker ${index + 1}">
                <option value="">Non assegnato</option>
                ${(project.actors?.original || []).map((actor) =>
                  `<option value="${escapeHtml(actor.actorId)}" ${actor.actorId === speaker.assignedActorId ? "selected" : ""}>${escapeHtml(actor.label || actor.actorId)}</option>`
                ).join("")}
              </select>
            </div>
          `).join("")}
          <button class="chip-button compact" type="button" data-interactive-cast-speakers="${escapeHtml(project.id)}">Salva speaker</button>
        </div>
      ` : ""}
      ${(project.sceneCuts?.cuts || []).length ? `
        <div class="cast-window-list">
          ${(project.sceneCuts.cuts || []).map((cut) => `<small><b>Scene</b> ${Number(cut.start || 0).toFixed(2)}-${Number(cut.end || 0).toFixed(2)} · ${escapeHtml(cut.reason)}</small>`).join("")}
        </div>
      ` : ""}
      ${(project.editWindows || []).length ? `
        <div class="cast-window-list">
          ${project.editWindows.map((window) => `<small><b>${window.start.toFixed(2)}-${window.end.toFixed(2)}</b> ${escapeHtml(window.mode)} · ${escapeHtml(window.reason)}</small>`).join("")}
        </div>
      ` : `<p class="hint">Analisi pronta. Aggiungi interventi per creare il piano edit windows.</p>`}
      ${project.renderPackage ? `
        <div class="cast-window-list">
          <small><b>Render package</b> ${escapeHtml(project.renderPackage.status)} · ${Number(project.renderPackage.segments?.length || 0)} segmenti</small>
          ${(project.renderPackage.segments || []).filter((segment) => segment.requiredGenerated).map((segment) => {
            const task = taskForSegment(project, segment.id);
            const anchor = task?.anchorFrame?.relativePath ? task.anchorFrame : null;
            const identityReport = project.renderPackage.identityReports?.[segment.id] || null;
            return `
              <div class="interactive-cast-segment-slot ${segment.status === "ready" ? "ready" : ""}">
                <small><b>${segment.status === "ready" ? "AI ready" : "Missing AI"}</b> ${Number(segment.start || 0).toFixed(2)}-${Number(segment.end || 0).toFixed(2)} · ${escapeHtml(segment.mode)} · ${escapeHtml(segment.reason)}</small>
                ${anchor ? `
                  <figure class="interactive-cast-task-anchor">
                    <img src="${assetUrl(project, anchor.relativePath)}" alt="Anchor ${escapeHtml(segment.id)}">
                    <figcaption>Anchor ${Number(anchor.time || 0).toFixed(2)}s</figcaption>
                  </figure>
                ` : ""}
                ${task ? `
                  <details class="interactive-cast-task">
                    <summary>Task ${escapeHtml(task.requiredEngine)}</summary>
                    ${task.anchorWorkflow ? `<p><b>Anchor workflow</b> ${escapeHtml(task.anchorWorkflow.label || task.anchorWorkflow.id)}</p>` : ""}
                    ${task.anchorRequirement ? `<p>${escapeHtml(task.anchorRequirement)}</p>` : ""}
                    <label>Prompt segmento<textarea readonly rows="4">${escapeHtml(task.prompt)}</textarea></label>
                    <label>Negative prompt<textarea readonly rows="3">${escapeHtml(task.negativePrompt)}</textarea></label>
                    ${(task.actorReferences || []).length ? `
                      <div class="interactive-cast-actor-references">
                        <small><b>Reference nuovo attore</b> ${Number(task.actorReferences.length)} allegata/e al task</small>
                        ${task.actorReferences.map((actor) => `
                          <div class="interactive-cast-actor-reference">
                            <b>${escapeHtml(actor.name || actor.actorId || "New Actor")}</b>
                            <span>${escapeHtml(actor.type || "reference")} · ${escapeHtml(actor.characterPack?.status || actor.reference?.originalName || "identity prompt")}</span>
                            ${actor.description ? `<em>${escapeHtml(actor.description)}</em>` : ""}
                            ${actor.identityHints?.face ? `<small>Face: ${escapeHtml(actor.identityHints.face)}</small>` : ""}
                            ${actor.identityHints?.hair ? `<small>Hair: ${escapeHtml(actor.identityHints.hair)}</small>` : ""}
                            ${actor.identityHints?.body ? `<small>Body: ${escapeHtml(actor.identityHints.body)}</small>` : ""}
                          </div>
                        `).join("")}
                      </div>
                    ` : ""}
                    <p>${escapeHtml(task.referenceRequirement || "")}</p>
                    <p>${escapeHtml(task.outputRequirement)}</p>
                  </details>
                ` : ""}
                ${task && segment.mode === "generative" && segment.status !== "ready" ? `
                  <div class="interactive-cast-generate-controls">
                    <label class="compact-field">Qualità
                      <select data-cast-generate-quality="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                        <option value="preview">Anteprima rapida</option>
                        <option value="max">Massima</option>
                      </select>
                    </label>
                    <label class="compact-field">Risoluzione LTX
                      <select data-cast-generate-resolution="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                        <option value="source">Automatica dalla sorgente</option>
                        <option value="360p">360p</option>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                      </select>
                    </label>
                    <button class="chip-button compact" type="button"
                      data-interactive-cast-generate="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"
                      ${["queued", "running"].includes(task.generation?.status) ? "disabled" : ""}>
                      ${["queued", "running"].includes(task.generation?.status)
                        ? `In esecuzione · ${escapeHtml(task.generation?.phase || "anchor")}`
                        : task.generation?.status === "failed" ? "Riprova generazione" : "Genera automaticamente"}
                    </button>
                  </div>
                  ${task.generation?.generationId ? `<small><b>Job</b> ${escapeHtml(task.generation.generationId)} · ${escapeHtml(task.generation.status || "queued")}</small>` : ""}
                  ${task.generation?.error ? `<em class="video-stage-error">${escapeHtml(task.generation.error)}</em>` : ""}
                ` : ""}
                ${segment.status === "ready" && segment.replacementRelativePath
                  ? `<video controls preload="metadata" src="${assetUrl(project, segment.replacementRelativePath)}"></video>
                     <button class="chip-button compact" type="button" data-interactive-cast-identity="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Identity check</button>`
                  : segment.mode === "composite"
                    ? `<div class="interactive-cast-composite-inputs">
                         <label class="compact-file"><input type="file" accept="video/*" data-cast-composite-overlay-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Overlay video</span></label>
                         <label class="compact-file"><input type="file" accept="image/png,image/jpeg,image/webp" data-cast-composite-mask-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Maschera B/N</span></label>
                         <label class="compact-field">Feather<input type="number" min="0" max="40" step="1" value="7" data-cast-composite-feather="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"></label>
                       </div>
                       <button class="chip-button compact" type="button" data-interactive-cast-composite="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Composita</button>
                       <label class="compact-file"><input type="file" accept="video/*" data-cast-replacement-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Oppure carica segmento finale</span></label>
                       <button class="chip-button compact" type="button" data-interactive-cast-replacement="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Aggancia finale</button>`
                    : `<label class="compact-file"><input type="file" accept="video/*" data-cast-replacement-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Carica segmento</span></label>
                       <button class="chip-button compact" type="button" data-interactive-cast-replacement="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Aggancia</button>`}
                ${identityReport ? `
                  <div class="interactive-cast-identity-report status-${escapeHtml(identityReport.status || "unknown")}">
                    <small><b>Identity</b> ${escapeHtml(identityReport.status || "unknown")} · avg ${escapeHtml(identityReport.averageSimilarity ?? "n/d")} · min ${escapeHtml(identityReport.minSimilarity ?? "n/d")}</small>
                    ${identityReport.warning ? `<em>${escapeHtml(identityReport.warning)}</em>` : ""}
                  </div>
                ` : ""}
              </div>
            `;
          }).join("")}
          ${(project.renderPackage.lipSyncTasks?.tasks || []).length ? `
            <div class="interactive-cast-audio-tasks interactive-cast-lipsync-tasks">
              <small><b>Lip-sync tasks</b> ${Number(project.renderPackage.lipSyncTasks.readiness?.missing?.length || 0)} clip mancanti</small>
              ${(project.renderPackage.lipSyncTasks.tasks || []).map((task) => `
                <div class="interactive-cast-audio-task ${task.status === "ready" ? "ready" : ""}">
                  <small><b>${task.status === "ready" ? "Lip-sync ready" : "Missing lip-sync"}</b> ${Number(task.start || 0).toFixed(2)}-${Number(task.end || 0).toFixed(2)} · ${escapeHtml(task.speaker)}</small>
                  ${task.sourceClipRelativePath ? `
                    <label>Source clip preservata<video controls preload="metadata" src="${assetUrl(project, task.sourceClipRelativePath)}"></video></label>
                  ` : ""}
                  ${task.dialogueAudioRelativePath ? `
                    <label>Audio guida<audio controls preload="metadata" src="${assetUrl(project, task.dialogueAudioRelativePath)}"></audio></label>
                  ` : ""}
                  ${task.status === "ready"
                    ? ""
                    : `<button class="chip-button compact" type="button" data-interactive-cast-lipsync="${escapeHtml(project.id)}:${escapeHtml(task.segmentId)}">Applica lip-sync</button>`}
                  ${task.synthesis?.error ? `<em class="video-stage-error">${escapeHtml(task.synthesis.error)}</em>` : ""}
                  <em>${escapeHtml(task.instructions || task.outputRequirement || "Upload the finished lip-sync MP4 into the segment slot.")}</em>
                </div>
              `).join("")}
            </div>
          ` : ""}
          ${(project.renderPackage.audioTasks?.tasks || []).length ? `
            <div class="interactive-cast-audio-tasks">
              <small><b>Dialogue audio</b> ${Number(project.renderPackage.audioTasks.readiness?.missing?.length || 0)} battute mancanti</small>
              ${(project.renderPackage.audioTasks.tasks || []).map((task) => `
                <div class="interactive-cast-audio-task ${task.status === "ready" ? "ready" : ""}">
                  <small><b>${task.status === "ready" ? "Voice ready" : "Missing voice"}</b> ${Number(task.start || 0).toFixed(2)}-${Number(task.end || 0).toFixed(2)} · ${escapeHtml(task.speaker)}</small>
                  <p>${escapeHtml(task.dialogue)}</p>
                  ${task.referenceAudio?.relativePath ? `
                    <label>Reference voce<audio controls preload="metadata" src="${assetUrl(project, task.referenceAudio.relativePath)}"></audio></label>
                  ` : ""}
                  ${task.replacementRelativePath
                    ? `<label>Battuta pronta<audio controls preload="metadata" src="${assetUrl(project, task.replacementRelativePath)}"></audio></label>`
                    : `<label class="compact-file"><input type="file" accept="audio/*" data-cast-dialogue-audio-file="${escapeHtml(project.id)}:${escapeHtml(task.eventId)}"><span>Carica battuta audio</span></label>
                       <button class="chip-button compact" type="button" data-interactive-cast-dialogue-audio="${escapeHtml(project.id)}:${escapeHtml(task.eventId)}">Aggancia audio</button>
                       <button class="chip-button compact" type="button" data-interactive-cast-dialogue-synthesize="${escapeHtml(project.id)}:${escapeHtml(task.eventId)}">Sintetizza voce</button>`}
                  ${task.synthesis?.error ? `<em class="video-stage-error">${escapeHtml(task.synthesis.error)}</em>` : ""}
                  <em>${escapeHtml(task.outputRequirement)}</em>
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>
      ` : ""}
      ${(project.editWindows || []).length && !project.renderPackage ? `
        <button class="chip-button" type="button" data-interactive-cast-segments="${escapeHtml(project.id)}">Prepara segmenti</button>
      ` : ""}
      ${project.renderPackage?.audioTasks?.readiness?.ready && !project.outputs?.dialogueRemix ? `
        <button class="chip-button" type="button" data-interactive-cast-audio-remix="${escapeHtml(project.id)}">Crea audio remix</button>
      ` : ""}
      ${project.outputs?.dialogueRemix?.relativePath ? `
        <audio class="interactive-cast-audio" controls preload="metadata" src="${assetUrl(project, project.outputs.dialogueRemix.relativePath)}"></audio>
      ` : ""}
      ${project.renderPackage?.readiness?.ready && !project.outputs?.finalVideo ? `
        <button class="chip-button" type="button" data-interactive-cast-concat="${escapeHtml(project.id)}">Ricomponi MP4 finale</button>
      ` : ""}
      ${project.outputs?.finalVideo?.relativePath ? `
        <video class="interactive-cast-final" controls preload="metadata" src="${assetUrl(project, project.outputs.finalVideo.relativePath)}"></video>
      ` : ""}
      ${(project.warnings || []).map((warning) => `<p class="hint">${escapeHtml(warning)}</p>`).join("")}
    </article>
  `).join("");
  setupUploadPreviews($("#interactive-cast-projects"));
}

async function refreshInteractiveCastProjects() {
  try {
    const payload = await api("/api/interactive-cast/projects");
    state.interactiveCastProjects = payload.projects || [];
    renderInteractiveCastProjects();
  } catch {
    // Poll non necessario: riproverà al prossimo caricamento.
  }
}

async function createInteractiveCastProject() {
  syncInteractiveCastEvents();
  const status = $("#interactive-cast-status");
  const sourceVideo = $("#interactiveCastSourceVideo").files[0];
  if (!sourceVideo) {
    status.textContent = "Carica prima il video originale.";
    showToast("Carica il video originale.");
    return;
  }
  const button = $("#interactive-cast-create-button");
  button.disabled = true;
  status.textContent = "Analizzo video e preparo la timeline...";
  try {
    const form = new FormData();
    form.set("sourceVideo", sourceVideo);
    form.set("title", $("#videoProjectName").value || "Interactive Cast");
    form.set("newActorName", $("#interactiveCastNewActorName").value || "New Actor");
    const temporaryReference = $("#interactiveCastTemporaryReference").files?.[0] || null;
    if (temporaryReference) form.set("temporaryActorReference", temporaryReference);
    const created = await api("/api/interactive-cast/projects", { method: "POST", body: form });
    let events = state.interactiveCastEvents;
    const brief = $("#interactiveCastBrief").value.trim();
    if (brief && state.config.promptAssistant?.enabled) {
      status.textContent = "LM Studio sta trasformando il brief in eventi timeline...";
      try {
        const assistant = await jsonApi(`/api/interactive-cast/projects/${created.project.id}/assistant-plan`, {
          brief,
        });
        events = assistant.plan.dialogueEvents || events;
        state.interactiveCastEvents = events;
        renderInteractiveCastEvents();
      } catch (error) {
        status.textContent = `LM Studio non ha creato la timeline (${error.message}); uso gli eventi manuali.`;
      }
    }
    const planned = await jsonApi(`/api/interactive-cast/projects/${created.project.id}/plan`, {
      brief,
      addedCharacterId: $("#interactiveCastNewActor").value,
      newActorName: $("#interactiveCastNewActorName").value,
      anchorWorkflowId: $("#interactiveCastAnchorWorkflow").value,
      originalActors: created.project.actors?.original || [],
      dialogueEvents: events,
      preserveAmbience: true,
      preserveMusic: true,
    });
    state.interactiveCastProjects = [
      planned.project,
      ...state.interactiveCastProjects.filter((item) => item.id !== planned.project.id),
    ];
    renderInteractiveCastProjects();
    status.textContent = "Piano Interactive Cast creato. I motori non configurati sono indicati nei fallback.";
    showToast("Interactive Cast: piano creato.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function prepareInteractiveCastSegments(button) {
  const projectId = button.dataset.interactiveCastSegments;
  button.disabled = true;
  button.textContent = "Preparo...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/prepare-segments`, { method: "POST" });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.readiness?.ready
      ? "Segmenti pronti per la ricomposizione."
      : `Segmenti originali pronti; mancano ${payload.readiness?.missing?.length || 0} slot AI.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Prepara segmenti";
    showToast(error.message);
  }
}

async function generateInteractiveCastSegment(button) {
  const [projectId, segmentId] = button.dataset.interactiveCastGenerate.split(":");
  const key = `${projectId}:${segmentId}`;
  const quality = document.querySelector(`[data-cast-generate-quality="${CSS.escape(key)}"]`)?.value || "preview";
  const resolution = document.querySelector(`[data-cast-generate-resolution="${CSS.escape(key)}"]`)?.value || "source";
  button.disabled = true;
  button.textContent = "Accodo anchor...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/generate`, {
      quality,
      resolution,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Anchor Interactive Cast in coda; LTX partirà automaticamente dopo la rifinitura.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Riprova generazione";
    showToast(error.message);
  }
}

async function deleteInteractiveCastProject(button) {
  const projectId = button.dataset.interactiveCastDelete;
  const project = state.interactiveCastProjects.find((item) => item.id === projectId);
  if (!project || !window.confirm(`Eliminare il progetto "${project.title}" e i suoi asset temporanei?`)) return;
  button.disabled = true;
  try {
    await api(`/api/interactive-cast/projects/${projectId}`, { method: "DELETE" });
    state.interactiveCastProjects = state.interactiveCastProjects.filter((item) => item.id !== projectId);
    renderInteractiveCastProjects();
    showToast("Progetto Interactive Cast eliminato.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

function replacementInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-replacement-file="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function compositeOverlayInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-composite-overlay-file="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function compositeMaskInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-composite-mask-file="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function compositeFeatherInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-composite-feather="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function collectInteractiveCastActors(projectId) {
  return [...document.querySelectorAll("[data-cast-actor]")]
    .filter((row) => String(row.dataset.castActor || "").startsWith(`${projectId}:`))
    .map((row) => ({
    actorId: String(row.dataset.castActor || "").split(":").slice(1).join(":"),
    label: row.querySelector("[data-cast-actor-label]")?.value?.trim() || "",
    role: row.querySelector("[data-cast-actor-role]")?.value?.trim() || "",
  }));
}

async function saveInteractiveCastActors(button) {
  const projectId = button.dataset.interactiveCastActors;
  button.disabled = true;
  button.textContent = "Salvo...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/actors`, {
      originalActors: collectInteractiveCastActors(projectId),
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Attori originali aggiornati.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Salva attori";
    showToast(error.message);
  }
}

function collectInteractiveCastSpeakers(projectId) {
  return [...document.querySelectorAll("[data-cast-speaker]")]
    .filter((row) => String(row.dataset.castSpeaker || "").startsWith(`${projectId}:`))
    .map((row) => ({
      speaker: row.querySelector("[data-cast-speaker-id]")?.value?.trim() || "",
      start: Number(row.querySelector("[data-cast-speaker-start]")?.value || 0),
      end: Number(row.querySelector("[data-cast-speaker-end]")?.value || 0),
      assignedActorId: row.querySelector("[data-cast-speaker-actor]")?.value || "",
    }));
}

async function saveInteractiveCastSpeakers(button) {
  const projectId = button.dataset.interactiveCastSpeakers;
  button.disabled = true;
  button.textContent = "Salvo...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/speakers`, {
      speakers: collectInteractiveCastSpeakers(projectId),
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Speaker aggiornati.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Salva speaker";
    showToast(error.message);
  }
}

function dialogueAudioInput(projectId, eventId) {
  return document.querySelector(`[data-cast-dialogue-audio-file="${CSS.escape(`${projectId}:${eventId}`)}"]`);
}

async function attachInteractiveCastReplacement(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastReplacement || "").split(":");
  const file = replacementInput(projectId, segmentId)?.files?.[0] || null;
  if (!file) return showToast("Scegli prima il segmento video sostitutivo.");
  button.disabled = true;
  button.textContent = "Aggancio...";
  try {
    const form = new FormData();
    form.set("replacementVideo", file);
    const payload = await api(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/replacement`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.readiness?.ready ? "Tutti i segmenti sono pronti." : "Segmento agganciato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Aggancia";
    showToast(error.message);
  }
}

async function applyInteractiveCastComposite(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastComposite || "").split(":");
  const overlay = compositeOverlayInput(projectId, segmentId)?.files?.[0] || null;
  const mask = compositeMaskInput(projectId, segmentId)?.files?.[0] || null;
  if (!overlay) return showToast("Scegli prima l'overlay video.");
  if (!mask) return showToast("Scegli prima la maschera B/N.");
  button.disabled = true;
  button.textContent = "Composito...";
  try {
    const form = new FormData();
    form.set("overlayVideo", overlay);
    form.set("maskImage", mask);
    form.set("feather", compositeFeatherInput(projectId, segmentId)?.value || "7");
    const payload = await api(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/composite`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.readiness?.ready ? "Compositing completato: segmenti pronti." : "Compositing completato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Composita";
    showToast(error.message);
  }
}

async function attachInteractiveCastDialogueAudio(button) {
  const [projectId, eventId] = String(button.dataset.interactiveCastDialogueAudio || "").split(":");
  const file = dialogueAudioInput(projectId, eventId)?.files?.[0] || null;
  if (!file) return showToast("Scegli prima la battuta audio sintetizzata.");
  button.disabled = true;
  button.textContent = "Aggancio audio...";
  try {
    const form = new FormData();
    form.set("dialogueAudio", file);
    const payload = await api(`/api/interactive-cast/projects/${projectId}/dialogue/${eventId}/audio`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Battuta audio agganciata.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Aggancia audio";
    showToast(error.message);
  }
}

async function synthesizeInteractiveCastDialogue(button) {
  const [projectId, eventId] = String(button.dataset.interactiveCastDialogueSynthesize || "").split(":");
  button.disabled = true;
  button.textContent = "Sintesi...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/dialogue/${eventId}/synthesize`, {});
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Battuta sintetizzata e agganciata.");
  } catch (error) {
    await refreshInteractiveCastProjects();
    showToast(error.message);
  }
}

async function applyInteractiveCastLipSync(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastLipsync || "").split(":");
  button.disabled = true;
  button.textContent = "Lip-sync...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/lipsync`, {});
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Segmento lip-sync generato e agganciato.");
  } catch (error) {
    await refreshInteractiveCastProjects();
    showToast(error.message);
  }
}

async function runInteractiveCastIdentityCheck(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastIdentity || "").split(":");
  button.disabled = true;
  button.textContent = "Controllo...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/identity-check`, {});
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.report?.status === "drift-detected"
      ? "Identity drift possibile: controlla il segmento."
      : "Identity check completato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Identity check";
    showToast(error.message);
  }
}

async function remixInteractiveCastAudio(button) {
  const projectId = button.dataset.interactiveCastAudioRemix;
  button.disabled = true;
  button.textContent = "Remix...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/audio-remix`, { method: "POST" });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Audio remix Interactive Cast creato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Crea audio remix";
    showToast(error.message);
  }
}

async function concatInteractiveCastFinal(button) {
  const projectId = button.dataset.interactiveCastConcat;
  button.disabled = true;
  button.textContent = "Ricomposizione...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/concat`, { method: "POST" });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("MP4 finale Interactive Cast creato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Ricomponi MP4 finale";
    showToast(error.message);
  }
}

function populateInteractiveCastCharacters() {
  const characters = state.config?.characters?.availableCharacters || [];
  $("#interactiveCastNewActor").innerHTML = [
    `<option value="">Reference temporanea / non ancora assegnata</option>`,
    ...characters.map((character) =>
      `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`
    ),
  ].join("");
}

async function refreshSequentialStories() {
  try {
    const payload = await api("/api/video-studio/sequential-story");
    state.sequentialStories = payload.projects || [];
    renderSequentialStories();
  } catch {
    // Poll silenzioso: il prossimo giro riprova.
  }
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

async function archiveVideoProject(button) {
  const projectId = button.dataset.videoProjectArchive;
  if (!confirm("Nascondere questo progetto dal pannello laterale? I file non verranno cancellati.")) return;
  button.disabled = true;
  try {
    await jsonApi(`/api/video-studio/projects/${projectId}/archive`, { archived: true });
    state.projects = state.projects.filter((item) => item.id !== projectId);
    renderProjects();
    showToast("Progetto nascosto");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function deleteVideoProject(button) {
  const projectId = button.dataset.videoProjectDelete;
  if (!confirm("Eliminare questo progetto e i video generati collegati? L'azione non puo essere annullata.")) return;
  button.disabled = true;
  try {
    const result = await api(`/api/video-studio/projects/${projectId}?files=1`, { method: "DELETE" });
    state.projects = state.projects.filter((item) => item.id !== projectId);
    renderProjects();
    showToast(`Progetto eliminato. File rimossi: ${result.filesDeleted || 0}`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function start() {
  const sequentialPayloadPromise = api("/api/video-studio/sequential-story").catch(() => ({ projects: [] }));
  [state.config, state.projects, state.sequentialStories] = await Promise.all([
    api("/api/config"),
    api("/api/video-studio/projects"),
    sequentialPayloadPromise.then((payload) => payload.projects || []),
  ]);
  await refreshInteractiveCastProjects();
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
  const characters = state.config.characters?.availableCharacters || [];
  $("#videoCharacterId").innerHTML = [
    `<option value="">Nessuna</option>`,
    ...characters.map((character) =>
      `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`
    ),
  ].join("");
  populateInteractiveCastCharacters();
  syncCharacterFields();
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
  for (const tools of document.querySelectorAll("[data-ltx-prompt-tools]")) {
    tools.classList.toggle("hidden", !state.config.promptAssistant?.enabled);
  }
  renderProjects();
  renderSequentialStories();
  renderInteractiveCastEvents();
  renderInteractiveCastProjects();
  setupUploadPreviews();
  checkHealth();
  setInterval(checkHealth, 15000);
  setInterval(refreshProjects, 3500);
  setInterval(refreshSequentialStories, 3500);
  setInterval(refreshInteractiveCastProjects, 3500);
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

function ltxPromptConfigForMode(selectedMode) {
  return {
    actorReplacement: {
      input: $("#actorPrompt"),
      status: $("#actor-prompt-assistant-status"),
      workflowName: "Video Studio · Actor Replacement · sostituzione personaggio",
      sourceFile: () => document.querySelector('[name="identityImage"]')?.files[0] || null,
      mode: () => document.querySelector('[name="identityImage"]')?.files[0] ? "image" : "video",
      toast: "Prompt Actor Replacement creato; clicca Crea progetto quando vuoi.",
    },
    interactiveScene: {
      input: $("#interactivePrompt"),
      status: $("#interactive-prompt-assistant-status"),
      workflowName: "Video Studio · Interactive Scene · scena interattiva",
      sourceFile: () => $("#reference-sheet").files[0] || null,
      mode: () => $("#reference-sheet").files[0] ? "image" : "video",
      toast: "Prompt Interactive Scene creato; clicca Crea progetto quando vuoi.",
    },
    sceneTransform: {
      input: $("#sceneTransformPrompt"),
      status: $("#scene-transform-prompt-assistant-status"),
      workflowName: "Video Studio · Scene Transform V2V · trasformazione video",
      sourceFile: () => document.querySelector('#scene-transform-fields [name="referenceSheet"]')?.files[0] || null,
      mode: () => document.querySelector('#scene-transform-fields [name="referenceSheet"]')?.files[0] ? "image" : "video",
      toast: "Prompt Scene Transform creato; clicca Crea progetto quando vuoi.",
    },
    retake: {
      input: $("#retakePrompt"),
      status: $("#retake-prompt-assistant-status"),
      workflowName: "Video Studio · Retake · rigenerazione clip",
      sourceFile: () => null,
      mode: () => "video",
      toast: "Prompt Retake creato; clicca Crea progetto quando vuoi.",
    },
    extend: {
      input: $("#extendPrompt"),
      status: $("#extend-prompt-assistant-status"),
      workflowName: "Video Studio · Extend · continuazione video",
      sourceFile: () => null,
      mode: () => "video",
      toast: "Prompt Extend creato; clicca Crea progetto quando vuoi.",
    },
  }[selectedMode] || null;
}

function ltxPromptLabel(target) {
  return {
    ltx_architect: "LTX Prompt",
    ltx_scenes: "LTX Scene",
    sulphur_prompt: "LTX Sulphur",
  }[target] || "LTX Prompt";
}

async function runVideoStudioLtxPrompt(button) {
  const tools = button.closest("[data-ltx-prompt-tools]");
  const selectedMode = tools?.dataset.ltxPromptTools || mode();
  const config = ltxPromptConfigForMode(selectedMode);
  if (!config?.input) return;
  const target = button.dataset.ltxPrompt;
  try {
    await enhanceMainPrompt({
      input: config.input,
      button,
      status: config.status,
      target,
      mode: config.mode(),
      workflowName: `${config.workflowName} · ${ltxPromptLabel(target)}`,
      sourceFile: config.sourceFile(),
      negativeInput: $("#videoNegativePrompt"),
      includeNegative: true,
      buttonScope: tools,
    });
    showToast(config.toast);
  } catch {
    // Stato mostrato accanto al prompt; il testo originale resta nel textarea.
  }
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
$("#videoCharacterId").addEventListener("change", syncCharacterFields);
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
  const archive = event.target.closest("[data-video-project-archive]");
  if (archive) {
    archiveVideoProject(archive);
    return;
  }
  const remove = event.target.closest("[data-video-project-delete]");
  if (remove) {
    deleteVideoProject(remove);
    return;
  }
  const button = event.target.closest("[data-lipdub]");
  if (button) applyLipdub(button);
});
$("#sequential-plan-button").addEventListener("click", generateSequentialPlan);
$("#sequential-start-button").addEventListener("click", startSequentialStory);
$("#interactive-cast-create-button").addEventListener("click", createInteractiveCastProject);
$("#interactive-cast-refresh-capabilities").addEventListener("click", (event) => {
  refreshInteractiveCastCapabilities(event.currentTarget);
});
$("#interactive-cast-add-event").addEventListener("click", () => {
  syncInteractiveCastEvents();
  state.interactiveCastEvents.push({ speaker: "New Actor", start: 0, end: 2, dialogue: "", action: "", reaction: "none", mode: "" });
  renderInteractiveCastEvents();
});
$("#interactive-cast-events").addEventListener("input", syncInteractiveCastEvents);
$("#interactive-cast-events").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-cast-event]");
  if (!button) return;
  syncInteractiveCastEvents();
  state.interactiveCastEvents.splice(Number(button.dataset.removeCastEvent), 1);
  renderInteractiveCastEvents();
});
$("#interactive-cast-projects").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-interactive-cast-delete]");
  if (remove) {
    deleteInteractiveCastProject(remove);
    return;
  }
  const actors = event.target.closest("[data-interactive-cast-actors]");
  if (actors) {
    saveInteractiveCastActors(actors);
    return;
  }
  const speakers = event.target.closest("[data-interactive-cast-speakers]");
  if (speakers) {
    saveInteractiveCastSpeakers(speakers);
    return;
  }
  const button = event.target.closest("[data-interactive-cast-segments]");
  if (button) {
    prepareInteractiveCastSegments(button);
    return;
  }
  const replacement = event.target.closest("[data-interactive-cast-replacement]");
  if (replacement) {
    attachInteractiveCastReplacement(replacement);
    return;
  }
  const generate = event.target.closest("[data-interactive-cast-generate]");
  if (generate) {
    generateInteractiveCastSegment(generate);
    return;
  }
  const composite = event.target.closest("[data-interactive-cast-composite]");
  if (composite) {
    applyInteractiveCastComposite(composite);
    return;
  }
  const dialogueAudio = event.target.closest("[data-interactive-cast-dialogue-audio]");
  if (dialogueAudio) {
    attachInteractiveCastDialogueAudio(dialogueAudio);
    return;
  }
  const synthesizeDialogue = event.target.closest("[data-interactive-cast-dialogue-synthesize]");
  if (synthesizeDialogue) {
    synthesizeInteractiveCastDialogue(synthesizeDialogue);
    return;
  }
  const lipsync = event.target.closest("[data-interactive-cast-lipsync]");
  if (lipsync) {
    applyInteractiveCastLipSync(lipsync);
    return;
  }
  const identity = event.target.closest("[data-interactive-cast-identity]");
  if (identity) {
    runInteractiveCastIdentityCheck(identity);
    return;
  }
  const audioRemix = event.target.closest("[data-interactive-cast-audio-remix]");
  if (audioRemix) {
    remixInteractiveCastAudio(audioRemix);
    return;
  }
  const concat = event.target.closest("[data-interactive-cast-concat]");
  if (concat) concatInteractiveCastFinal(concat);
});
$("#sequentialInputMode").addEventListener("change", syncSequentialInputMode);
$("#sequential-scenes").addEventListener("input", syncSequentialScenes);
$("#sequential-scenes").addEventListener("click", (event) => {
  const card = event.target.closest("[data-sequential-scene]");
  if (!card || !state.sequentialPlan) return;
  syncSequentialScenes();
  const index = Number(card.dataset.sequentialScene);
  if (event.target.closest("[data-scene-move='up']") && index > 0) {
    const scenes = state.sequentialPlan.scenes;
    [scenes[index - 1], scenes[index]] = [scenes[index], scenes[index - 1]];
  } else if (event.target.closest("[data-scene-move='down']") && index < state.sequentialPlan.scenes.length - 1) {
    const scenes = state.sequentialPlan.scenes;
    [scenes[index + 1], scenes[index]] = [scenes[index], scenes[index + 1]];
  } else if (event.target.closest("[data-scene-duplicate]")) {
    const duplicate = {
      ...state.sequentialPlan.scenes[index],
      id: `scene-${Date.now().toString(36)}`,
      title: `${state.sequentialPlan.scenes[index].title} · copia`,
      status: "pending",
      stale: false,
    };
    state.sequentialPlan.scenes.splice(index + 1, 0, duplicate);
  } else if (event.target.closest("[data-scene-delete]")) {
    state.sequentialPlan.scenes.splice(index, 1);
  } else if (event.target.closest("[data-scene-regenerate]")) {
    regenerateSequentialScene(index);
    return;
  } else {
    return;
  }
  state.sequentialPlan.scenes = state.sequentialPlan.scenes.map((scene, sceneIndex) => ({
    ...scene,
    index: sceneIndex + 1,
  }));
  renderSequentialScenes();
});
$("#sequential-story-projects").addEventListener("click", async (event) => {
  const projectCard = event.target.closest("[data-sequential-project]");
  if (!projectCard) return;
  const projectId = projectCard.dataset.sequentialProject;
  const action = event.target.closest("[data-sequential-action]")?.dataset.sequentialAction;
  const retryScene = event.target.closest("[data-sequential-scene-retry]")?.dataset.sequentialSceneRetry;
  try {
    let payload = null;
    if (retryScene) {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/scenes/${retryScene}/retry`, { method: "POST" });
    } else if (action === "pause") {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/pause`, { method: "POST" });
    } else if (action === "resume") {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/resume`, { method: "POST" });
    } else if (action === "cancel") {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/cancel`, { method: "POST" });
    } else if (action === "delete") {
      if (!confirm("Eliminare questa Storia continua? Le generazioni finalizzate restano nella cronologia.")) return;
      await api(`/api/video-studio/sequential-story/${projectId}`, { method: "DELETE" });
      state.sequentialStories = state.sequentialStories.filter((item) => item.id !== projectId);
      renderSequentialStories();
      showToast("Storia continua eliminata; generazioni preservate.");
      return;
    }
    if (!payload?.project) return;
    state.sequentialStories = state.sequentialStories.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    if (!state.sequentialStories.some((item) => item.id === payload.project.id)) {
      state.sequentialStories.unshift(payload.project);
    }
    renderSequentialStories();
    showToast("Storia continua aggiornata.");
  } catch (error) {
    showToast(error.message);
  }
});
$("#video-studio-form").addEventListener("submit", submitProject);
$("#video-studio-form").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ltx-prompt]");
  if (!button) return;
  runVideoStudioLtxPrompt(button);
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
