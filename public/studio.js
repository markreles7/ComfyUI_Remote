import { WORKFLOW_GUIDE_BY_ID } from "./workflow-guides.js";
import { enhanceMainPrompt } from "./prompt-assistant.js";
import { consumeGuidedHandoff, guidedTokenFromLocation, setInputFile } from "./guided-handoff.js";
import { setupUploadPreviews } from "./upload-previews.js";

const state = {
  config: null,
  projects: [],
  maskTouched: false,
  drawing: false,
  erase: false,
  maskTool: "draw",
  rectangleStart: null,
  rectangleSnapshot: null,
  sourceImage: null,
  renderKey: "",
  editWildcardSeed: null,
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
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function selectedCharacter() {
  const id = $("#studioCharacterId")?.value;
  if (!id) return null;
  return (state.config?.characters?.availableCharacters || []).find((character) => character.id === id) || null;
}

function syncCharacterFields() {
  const character = selectedCharacter();
  const settings = character?.settings || {};
  $("#studioCharacterIdentityStrength").value = settings.identityStrength || "medium";
  $("#studioCharacterLockFace").value = String(settings.lockFace ?? true);
  $("#studioCharacterLockHair").value = String(settings.lockHair ?? true);
  $("#studioCharacterLockBody").value = String(settings.lockBody ?? true);
  $("#studioCharacterLockOutfit").value = String(settings.lockOutfit ?? false);
  $("#studio-character-hint").textContent = character
    ? "Il Character Pack verra' passato all'adapter dello Studio; i workflow senza reference usano un prompt fallback."
    : "Usa un Virtual Actor persistente come identita/reference automatica.";
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

function studioMode() {
  return state.config?.studio?.modes.find((item) => item.id === $("#studioMode").value);
}

function guideList(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderQuickGuide(guide) {
  if (!guide) return;
  $("#workflow-guide-category").textContent = `${guide.category} / ${guide.level}`;
  $("#workflow-guide-title").textContent = guide.name;
  $("#workflow-guide-content").innerHTML = `
    <p class="guide-summary">${escapeHtml(guide.summary)}</p>
    <div class="guide-modal-grid">
      <section>
        <h3>Ideale per</h3>
        ${guideList(guide.bestFor)}
      </section>
      <section>
        <h3>Cosa preparare</h3>
        ${guideList(guide.inputs)}
      </section>
    </div>
    <section>
      <h3>Procedura consigliata</h3>
      <ol class="guide-steps">
        ${guide.steps.map(([title, text]) => `
          <li><div><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div></li>
        `).join("")}
      </ol>
    </section>
    <aside class="guide-example">
      <span>Esempio prompt</span>
      <p>${escapeHtml(guide.example)}</p>
    </aside>
  `;
  $("#full-workflow-guide").href = `/workflow-guide.html#${encodeURIComponent(guide.id)}`;
  $("#open-workflow-guide").setAttribute("aria-label", `Apri la guida di ${guide.name}`);
}

function openQuickGuide() {
  const guide = WORKFLOW_GUIDE_BY_ID[$("#studioMode").value];
  if (!guide) return;
  renderQuickGuide(guide);
  const dialog = $("#workflow-guide-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function toggle(selector, visible) {
  $(selector)?.classList.toggle("hidden", !visible);
}

function updateEditWildcardDefaults() {
  const mode = $("#studioMode").value;
  if (mode === "guidedEdit") {
    $("#editWildcardFamily").value = $("#guidedModelFamily").value === "klein" ? "klein" : "gwen";
  } else if (mode === "perfect") {
    $("#editWildcardFamily").value = $("#perfectFamily").value === "klein" ? "klein" : "gwen";
  } else if (mode === "storyboard") {
    $("#editWildcardFamily").value = $("#storyboardFamily").value === "klein" ? "klein" : "gwen";
  }
  const wildcards = state.config?.editWildcards || {};
  const gwen = wildcards.gwen;
  const klein = wildcards.klein;
  const ready = Boolean(gwen?.installed || klein?.installed);
  $("#edit-wildcard-panel").classList.toggle("hidden", !ready);
  const parts = [];
  if (gwen?.installed) parts.push(`Gwen/Qwen ${gwen.count}`);
  if (klein?.installed) parts.push(`Klein ${klein.count}`);
  $("#edit-wildcard-status").textContent = ready
    ? `Wildcard installate: ${parts.join(" · ")}. Ideali per image2image: carichi una foto e peschi una scena.`
    : "Wildcard BigLove non installate.";
}

function updateMode() {
  const mode = studioMode();
  if (!mode) return;
  const staticQwenKreaKlein = mode.id === "qwenKreaKlein";
  const kreaTriple = mode.id === "kreaTriple";
  const kreaTripleOperation = $("#kreaTripleOperation")?.value || "text";
  $("#studio-description").textContent = mode.description;
  renderQuickGuide(WORKFLOW_GUIDE_BY_ID[mode.id]);
  toggle("#source-section", mode.input !== "firstLast" && !(kreaTriple && kreaTripleOperation === "text"));
  toggle("#qwen-krea-klein-section", staticQwenKreaKlein);
  toggle("#krea-triple-section", kreaTriple);
  toggle("#krea-triple-denoise-field", kreaTriple && kreaTripleOperation !== "text");
  toggle("#guided-edit-section", mode.id === "guidedEdit");
  toggle("#guided-zone-heading", mode.id === "guidedEdit");
  toggle("#first-last-section", mode.input === "firstLast");
  toggle("#mask-section", mode.supportsMask && !staticQwenKreaKlein && (!kreaTriple || kreaTripleOperation === "selective"));
  toggle("#reference-section", mode.supportsReferences && !staticQwenKreaKlein && !kreaTriple);
  toggle("#storyboard-section", mode.id === "storyboard");
  toggle("#bible-section", mode.id === "bible");
  toggle("#camera-section", mode.id === "camera");
  toggle("#relight-section", mode.id === "relight");
  toggle("#perfect-section", mode.id === "perfect");
  toggle("#common-settings", mode.input !== "firstLast" && !staticQwenKreaKlein);
  toggle("#editing-controls", mode.input !== "firstLast" && !staticQwenKreaKlein && !kreaTriple);
  toggle("#studio-models", mode.input !== "firstLast"
    && mode.id !== "storyboard"
    && mode.id !== "perfect"
    && !kreaTriple
    && !staticQwenKreaKlein);
  toggle("#final-output-section", mode.input !== "firstLast" && !staticQwenKreaKlein && !kreaTriple);
  toggle("#studio-lora-section", !staticQwenKreaKlein && !kreaTriple);
  toggle("#guided-model-family-field", mode.id === "guidedEdit");
  for (const selector of [
    "#qwen-edit-model-field",
    "#guided-klein-model-field",
    "#flux2-turbo-model-field",
    "#flux2-base-model-field",
    "#zimage-model-field",
    "#flux1-refine-model-field",
  ]) {
    toggle(selector, mode.id !== "guidedEdit");
  }
  $("#studio-prompt").required = mode.id !== "firstLast";
  if (staticQwenKreaKlein) {
    $("#studio-prompt").placeholder = "Istruzione Qwen Image Editing da applicare alla foto sorgente...";
    $("#edit-wildcard-panel").classList.add("hidden");
  } else if (kreaTriple) {
    $("#studio-prompt").placeholder = kreaTripleOperation === "text"
      ? "Descrivi il soggetto, scena, luce, camera e look fotografico per Krea Triple..."
      : "Descrivi la modifica o il risultato da ottenere mantenendo coerenza fotografica...";
    $("#edit-wildcard-panel").classList.add("hidden");
  }

  if (mode.id === "smartphone" || mode.id === "inpaint" || mode.id === "guidedEdit") {
    $("#editScope").value = "local";
    $("#editScope").disabled = true;
  } else {
    $("#editScope").disabled = false;
  }
  if (mode.id === "storyboard") {
    renderShotFields();
    updateStoryboardModel();
  }
  if (mode.id === "perfect") updatePerfectModel();
  if (mode.id === "bible") updateBibleDefaults();
  if (mode.id === "guidedEdit") updateGuidedAction();
  updateGuidedModel();
  if (!staticQwenKreaKlein && !kreaTriple) updateEditWildcardDefaults();
  updateMaskMode();
  renderLoras();
}

function guidedAction() {
  return document.querySelector('input[name="editAction"]:checked')?.value || "modify";
}

function updateGuidedAction() {
  if ($("#studioMode").value !== "guidedEdit") return;
  const action = guidedAction();
  const global = ["style", "relight", "background"].includes(action);
  $("#editScope").value = global ? "global" : "local";
  $("#maskMode").value = global ? "none" : "manual";
  toggle("#mask-section", !global);
  const examples = {
    addPerson: "Descrivi la persona, abbigliamento, posa e rapporto con chi è già nella foto…",
    addAnimal: "Descrivi animale, dimensione, posizione, posa e interazione con la scena…",
    addObject: "Descrivi oggetto, materiale, dimensione, orientamento e punto di appoggio…",
    replace: "Spiega cosa sostituire e con quale risultato…",
    remove: "Descrivi cosa deve apparire naturalmente dietro l’elemento rimosso…",
    modify: "Descrivi esattamente il dettaglio da cambiare e ciò che deve restare invariato…",
    background: "Descrivi il nuovo ambiente mantenendo identici i soggetti principali…",
    style: "Descrivi stile, resa, palette e materiale fotografico desiderati…",
    relight: "Descrivi ora, meteo, direzione, colore e durezza della nuova luce…",
  };
  $("#studio-prompt").placeholder = examples[action];
  updateMaskMode();
}

function updateGuidedModel() {
  if ($("#studioMode").value !== "guidedEdit") return;
  const family = $("#guidedModelFamily").value;
  toggle("#qwen-edit-model-field", family === "qwen");
  toggle("#guided-klein-model-field", family === "klein");
  $("#guidedSteps").value = family === "klein" ? "20" : "6";
  $("#guidedGuidance").value = family === "klein" ? "5" : "1";
  updateEditWildcardDefaults();
  renderLoras();
}

function updateStructureGuide() {
  const type = $("#structureGuide").value;
  toggle("#guide-image-field", ["canny", "sketch", "depth"].includes(type));
  const messages = {
    automatic: "Senza guida separata Qwen usa foto, maschera e reference; caricando una guida verranno estratti i contorni.",
    canny: "Conserva o impone contorni. Puoi usare una foto di posa o una composizione abbozzata.",
    sketch: "Disegna sagoma e postura su fondo semplice: le linee verranno ripulite automaticamente.",
    depth: "La profondità viene stimata automaticamente dalla foto. Puoi caricare una mappa Depth separata per sostituirla.",
    none: "La posizione viene guidata da riquadro, maschera, reference e istruzione testuale.",
  };
  $("#structure-guide-status").textContent = messages[type] || "";
}

function updateMaskMode() {
  const manual = $("#maskMode").value === "manual";
  const automatic = $("#maskMode").value === "automatic";
  toggle("#mask-editor", manual);
  toggle("#mask-target-field", automatic);
}

function renderShotFields() {
  const count = Number($("#shotCount").value);
  const defaults = [
    ["Establishing shot", "Campo largo che introduce personaggio e location."],
    ["Medium shot", "Inquadratura media che sviluppa l’azione."],
    ["Close-up", "Primo piano del momento principale."],
    ["Ending shot", "Fotogramma conclusivo utile come ultimo frame."],
  ];
  const existing = [...document.querySelectorAll(".shot-row")].map((row) => ({
    title: row.querySelector(".shot-title")?.value,
    prompt: row.querySelector(".shot-prompt")?.value,
  }));
  $("#shot-fields").innerHTML = Array.from({ length: count }, (_, index) => {
    const values = existing[index] || { title: defaults[index][0], prompt: defaults[index][1] };
    return `
      <div class="shot-row" data-shot="${index + 1}">
        <div class="field"><label>Shot ${index + 1} · titolo</label><input class="shot-title" value="${escapeHtml(values.title)}"></div>
        <div class="field"><label>Descrizione</label><textarea class="shot-prompt" rows="2">${escapeHtml(values.prompt)}</textarea></div>
      </div>
    `;
  }).join("");
}

function updateStoryboardModel() {
  const familyId = $("#storyboardFamily").value;
  const family = state.config?.studio?.storyboardModels?.find((item) => item.id === familyId);
  if (!family) return;
  const modelFile = family.quality;
  const installed = (state.config?.imageModels || [])
    .flatMap((item) => item.models || [])
    .some((model) => model.file.toLowerCase() === modelFile.toLowerCase());
  $("#storyboard-model-status").textContent = installed
    ? `Modello selezionato: ${family.name} · qualità unica.`
    : `Modello non rilevato: ${modelFile}`;
  $("#studio-submit").disabled = !installed;
  renderLoras();
}

function updatePerfectModel() {
  const familyId = $("#perfectFamily").value;
  const family = state.config?.studio?.storyboardModels?.find((item) => item.id === familyId);
  if (!family) return;
  const qwenMode = familyId !== "klein";
  toggle("#perfect-qwen-model-field", qwenMode);
  toggle("#perfect-klein-model-field", !qwenMode);
  const recipeSelect = $("#perfectRecipe");
  const currentRecipe = recipeSelect.value;
  const recipes = familyId === "klein"
    ? [
      ["runninghub", "RunningHub Klein 4B Accelerated · consigliato"],
      ["standard", "Standard webapp · compatibilità"],
    ]
    : [
      ["runninghub", "RunningHub Qwen Multi-Reference · consigliato"],
      ["runninghubSeedvr", "RunningHub Qwen + SeedVR finale · MAX"],
      ["standard", "Standard webapp · compatibilità"],
    ];
  recipeSelect.innerHTML = recipes
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  recipeSelect.value = recipes.some(([value]) => value === currentRecipe) ? currentRecipe : "runninghub";
  const installedFiles = new Set(
    (state.config?.imageModels || [])
      .flatMap((item) => item.models || [])
      .map((model) => model.file.toLowerCase())
  );
  const selectedModel = qwenMode ? $("#perfectQwenModel").value : $("#perfectKleinModel").value;
  const qualityReady = Boolean(selectedModel) && installedFiles.has(selectedModel.toLowerCase());
  const profiles = familyId === "qwen2511"
    ? "Qwen Image Edit 2511 / Qwen compatibile · reference-first"
    : familyId === "gwen"
    ? "Qwen / BigLove Gwen · qualità unica"
    : "Flux.2 / BigLove Klein · qualità unica";
  $("#perfect-model-status").textContent = qualityReady
    ? `${profiles}. Modello selezionato: ${selectedModel}.`
    : `Modello non rilevato o non selezionato: ${selectedModel || "nessuno"}`;
  $("#perfect-recipe-status").textContent = familyId === "klein"
    ? (recipeSelect.value === "runninghub"
      ? "Usa la ricetta RunningHub Klein: prima immagine come latent base + reference multiple."
      : "Usa il builder Klein standard della webapp.")
    : (recipeSelect.value === "runninghubSeedvr"
      ? "Usa la ricetta Qwen multi-reference e applica SeedVR2 finale nella stessa coda."
      : recipeSelect.value === "runninghub"
        ? "Usa la ricetta Qwen multi-reference stile RunningHub."
        : "Usa il builder Qwen standard della webapp.");
  $("#studio-submit").disabled = !qualityReady;
  updateEditWildcardDefaults();
  renderLoras();
}

function updateBibleDefaults() {
  const character = $("#bibleType").value === "character";
  $("#bibleViewsText").value = (character
    ? ["close-up portrait", "full body front view", "left profile", "three-quarter view", "rear view", "expressions sheet"]
    : ["wide establishing view", "opposite side view", "architectural details", "day version", "night version", "simplified 360-degree environment reference"]
  ).join("\n");
}

function loadSource(file) {
  if (!file) return;
  const image = new Image();
  image.onload = () => {
    state.sourceImage = image;
    $("#imageWidth").value = image.naturalWidth;
    $("#imageHeight").value = image.naturalHeight;
    const preview = $("#studio-source-preview");
    preview.src = image.src;
    preview.parentElement.classList.add("has-image");
    prepareMaskCanvas(image);
  };
  image.src = URL.createObjectURL(file);
}

function prepareMaskCanvas(image) {
  const scale = Math.min(1, 1200 / image.naturalWidth, 800 / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const photo = $("#mask-photo");
  const mask = $("#mask-canvas");
  photo.width = mask.width = width;
  photo.height = mask.height = height;
  photo.getContext("2d").drawImage(image, 0, 0, width, height);
  mask.getContext("2d").clearRect(0, 0, width, height);
  state.maskTouched = false;
  state.rectangleStart = null;
  state.rectangleSnapshot = null;
  $("#placement").value = "";
  $("#mask-placeholder").classList.add("hidden");
}

function maskPoint(event) {
  const canvas = $("#mask-canvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * canvas.width / rect.width,
    y: (event.clientY - rect.top) * canvas.height / rect.height,
  };
}

function beginMask(event) {
  if (!state.sourceImage) return;
  state.drawing = true;
  const point = maskPoint(event);
  const context = $("#mask-canvas").getContext("2d");
  if (state.maskTool === "rectangle") {
    state.rectangleStart = point;
    state.rectangleSnapshot = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    return;
  }
  context.beginPath();
  context.moveTo(point.x, point.y);
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function drawMask(event) {
  if (!state.drawing) return;
  const canvas = $("#mask-canvas");
  const context = canvas.getContext("2d");
  const point = maskPoint(event);
  if (state.maskTool === "rectangle" && state.rectangleStart) {
    context.putImageData(state.rectangleSnapshot, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(255, 32, 32, .72)";
    context.fillRect(
      state.rectangleStart.x,
      state.rectangleStart.y,
      point.x - state.rectangleStart.x,
      point.y - state.rectangleStart.y,
    );
    return;
  }
  context.globalCompositeOperation = state.erase ? "destination-out" : "source-over";
  context.strokeStyle = "#ff0000";
  context.lineWidth = Number($("#mask-brush").value);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineTo(point.x, point.y);
  context.stroke();
  state.maskTouched = true;
}

function endMask(event) {
  if (state.drawing && state.maskTool === "rectangle" && state.rectangleStart) {
    const end = maskPoint(event);
    const canvas = $("#mask-canvas");
    const left = Math.max(0, Math.min(state.rectangleStart.x, end.x));
    const top = Math.max(0, Math.min(state.rectangleStart.y, end.y));
    const right = Math.min(canvas.width, Math.max(state.rectangleStart.x, end.x));
    const bottom = Math.min(canvas.height, Math.max(state.rectangleStart.y, end.y));
    if (right - left > 4 && bottom - top > 4) {
      $("#placement").value = JSON.stringify({
        x: left / canvas.width,
        y: top / canvas.height,
        width: (right - left) / canvas.width,
        height: (bottom - top) / canvas.height,
      });
      state.maskTouched = true;
    }
  }
  state.drawing = false;
  state.rectangleStart = null;
  state.rectangleSnapshot = null;
}

function clearMask() {
  const canvas = $("#mask-canvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  state.maskTouched = false;
  $("#placement").value = "";
}

function maskBlob() {
  return new Promise((resolve) => $("#mask-canvas").toBlob(resolve, "image/png"));
}

function compatibleLoras() {
  const mode = $("#studioMode").value;
  return (state.config?.loras || []).filter((name) =>
    mode === "guidedEdit"
      ? String(name).toUpperCase().startsWith(
        $("#guidedModelFamily").value === "klein" ? "FLUX2\\" : "QWEN\\"
      )
      : mode === "storyboard"
        ? String(name).toUpperCase().startsWith(
          $("#storyboardFamily").value === "gwen" ? "QWEN\\" : "FLUX2\\"
        )
      : mode === "perfect"
        ? String(name).toUpperCase().startsWith(
          ["gwen", "qwen2511"].includes($("#perfectFamily").value) ? "QWEN\\" : "FLUX2\\"
        )
      : (mode === "firstLast"
      ? String(name).toUpperCase().startsWith("LTX2.3\\")
      : /^(FLUX2|FLUX|ZIMG)\\/i.test(name))
  );
}

function renderLoras() {
  const choices = compatibleLoras();
  document.querySelectorAll(".studio-lora-row select").forEach((select) => {
    const current = select.value;
    select.innerHTML = choices.map((name) =>
      `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
    ).join("");
    if (choices.includes(current)) select.value = current;
  });
  syncLoras();
}

function addLora() {
  const choices = compatibleLoras();
  if (!choices.length) return showToast("Nessuna LoRA compatibile rilevata.");
  const row = document.createElement("div");
  row.className = "studio-lora-row";
  row.innerHTML = `
    <select>${choices.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}</select>
    <input type="number" min="-2" max="2" step=".05" value="1" aria-label="Forza LoRA">
    <button type="button" aria-label="Rimuovi LoRA">×</button>
  `;
  row.addEventListener("input", syncLoras);
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    syncLoras();
  });
  $("#studio-loras").append(row);
  syncLoras();
}

function syncLoras() {
  const loras = [...document.querySelectorAll(".studio-lora-row")].map((row) => ({
    name: row.querySelector("select").value,
    strength: Number(row.querySelector("input").value),
  })).filter((item) => item.name);
  $("#studio-loras-json").value = JSON.stringify(loras);
}

function syncStructuredFields() {
  const shots = [...document.querySelectorAll(".shot-row")].map((row) => ({
    title: row.querySelector(".shot-title").value.trim(),
    prompt: row.querySelector(".shot-prompt").value.trim(),
  }));
  $("#shots").value = JSON.stringify(shots);
  $("#bibleViews").value = JSON.stringify(
    $("#bibleViewsText").value.split("\n").map((value) => value.trim()).filter(Boolean),
  );
  if ($("#maskMode").value !== "automatic") $("#maskTarget").value = "";
}

async function submitProject(event) {
  event.preventDefault();
  const button = $("#studio-submit");
  const status = $("#studio-form-status");
  try {
    syncStructuredFields();
    const formData = new FormData(event.currentTarget);
    if ($("#maskMode").value === "manual" && !$("#mask-section").classList.contains("hidden")) {
      if (!state.maskTouched) throw new Error("Disegna la zona da modificare oppure usa la maschera automatica.");
      const blob = await maskBlob();
      formData.set("maskImage", blob, "studio-mask.png");
    }
    button.disabled = true;
    status.textContent = "Caricamento e creazione dei workflow…";
    const project = await api("/api/studio/projects", { method: "POST", body: formData });
    state.projects.unshift(project);
    renderProjects();
    status.textContent = `${project.generations.length} lavoro/i aggiunti alla coda.`;
    showToast("Progetto Studio creato.");
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function statusLabel(status) {
  return {
    queued: "In coda",
    running: "In lavorazione",
    completed: "Completato",
    error: "Errore",
    interrupted: "Annullato",
  }[status] || status;
}

function imageButtons(project, generation) {
  if (!generation.images?.length) {
    return `<div class="studio-progress"><span style="width:${generation.progress || 0}%"></span></div>`;
  }
  return `<div class="studio-result-images">${generation.images.map((image, index) => {
    const before = generation.includesBeforeAfter && (
      generation.beforeAfterTail
        ? index === generation.images.length - 2
        : index === 0
    );
    return `
      <figure>
        <a href="/api/image/${generation.id}/${index}" target="_blank" rel="noopener">
          <img loading="lazy" src="/api/image/${generation.id}/${index}" alt="${before ? "Prima" : "Risultato"}">
        </a>
        ${before ? "" : `<button type="button" data-project="${project.id}" data-generation="${generation.id}" data-image="${index}">Usa questo risultato</button>`}
      </figure>
    `;
  }).join("")}</div>`;
}

function stageActions(project, generation) {
  if (project.executionMode === "automatic") return "";
  if (generation.status !== "completed" || !generation.images?.length || generation.mediaType !== "image") return "";
  const index = generation.images.length - 1;
  const actions = [];
  if (["drafts", "variations"].includes(generation.studioStage)) {
    actions.push(["variation", "Nuova variante"]);
    if (project.settings?.studioPreset === "speed") {
      actions.push(["finalize", "Master veloce"]);
    } else {
      const family = generation.perfectModelFamily || project.settings?.perfectFamily;
      actions.push(["quality", family === "klein" ? "Refine qualità Klein" : "Refine qualità"]);
    }
  }
  if (generation.studioStage === "quality") {
    actions.push(["finalize", "Master finale / Upscale"]);
  }
  if (!actions.length) return "";
  return `<div class="studio-actions">${actions.map(([action, label]) =>
    `<button class="chip-button" type="button" data-continue="${action}" data-project="${project.id}" data-generation="${generation.id}" data-image="${index}">${label}</button>`
  ).join("")}</div>`;
}

function projectMarkup(project) {
  const stages = new Map();
  for (const generation of project.generations || []) {
    const stage = generation.studioStage || "output";
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage).push(generation);
  }
  return `
    <article class="studio-project-card" data-project-card="${project.id}">
      <div class="studio-project-head">
        <h3>${escapeHtml(project.name)}</h3>
        <small>${escapeHtml(statusLabel(project.status))}</small>
      </div>
      <p>${escapeHtml(project.prompt || project.studioMode)}</p>
      ${project.executionMode === "automatic"
        ? `<p class="hint">Pipeline automatica · ${escapeHtml(project.autoState || "in preparazione")}${project.autoError ? ` · ${escapeHtml(project.autoError)}` : ""}</p>`
        : ""}
      ${[...stages.entries()].map(([stage, generations]) => `
        <section class="studio-stage">
          <h4>${escapeHtml(stage)}</h4>
          ${generations.map((generation) => `
            <div class="studio-result">
              <div class="studio-result-label"><span>${escapeHtml(generation.studioLabel || generation.workflowName)}</span><span>${escapeHtml(statusLabel(generation.status))}</span></div>
              ${imageButtons(project, generation)}
              ${generation.error ? `<p class="model-warning">${escapeHtml(generation.error)}</p>` : ""}
              ${["queued", "running"].includes(generation.status)
                ? `<button class="cancel-generation-button compact" type="button" data-cancel-job="${generation.id}">Annulla generazione</button>`
                : ""}
              ${stageActions(project, generation)}
            </div>
          `).join("")}
        </section>
      `).join("")}
      ${project.studioMode === "storyboard" ? `<button class="chip-button studio-animate" type="button" data-animate="${project.id}">Anima tutte le coppie con LTX 2.3</button>` : ""}
    </article>
  `;
}

function renderProjects() {
  const renderKey = JSON.stringify(state.projects.map((project) => ({
    id: project.id,
    status: project.status,
    autoState: project.autoState,
    autoError: project.autoError,
    generations: (project.generations || []).map((generation) => ({
      id: generation.id,
      status: generation.status,
      error: generation.error,
      images: generation.images?.map((image) => image.filename),
      videos: generation.videos?.map((video) => video.filename),
    })),
  })));
  if (renderKey === state.renderKey) return;
  state.renderKey = renderKey;
  $("#studio-empty").classList.toggle("hidden", state.projects.length > 0);
  $("#studio-projects").innerHTML = state.projects.map(projectMarkup).join("");
}

async function continueProject(button) {
  const project = state.projects.find((item) => item.id === button.dataset.project);
  const generation = project?.generations.find((item) => item.id === button.dataset.generation);
  if (!project || !generation) return;
  button.disabled = true;
  try {
    const action = button.dataset.continue || "quality";
    const settings = project.settings || {};
    const studioPreset = settings.studioPreset || "quality";
    const finalOutput = settings.finalOutput || (studioPreset === "max" ? "seed7" : "seed3");
    const upscaleMode = {
      none: "none",
      seed3: "seedvr2",
      seed7: "seedvr2",
      rtx: "rtx",
      realesrgan: "fast",
    }[finalOutput] || "seedvr2";
    const payload = {
      action,
      generationId: generation.id,
      imageIndex: Number(button.dataset.image),
      prompt: project.prompt,
      imageWidth: generation.width,
      imageHeight: generation.height,
      seed: action === "variation" ? "" : settings.seed,
      studioPreset,
      finalOutput,
      refineDenoise: studioPreset === "max" ? 0.24 : 0.18,
      highresEnabled: action === "finalize" && studioPreset !== "speed",
      highresScale: studioPreset === "max" ? 1.5 : 1.25,
      highresSteps: studioPreset === "max" ? 12 : 8,
      highresDenoise: studioPreset === "max" ? 0.25 : 0.2,
      upscaleMode: action === "finalize" ? upscaleMode : "none",
      rtxQuality: studioPreset === "max" ? "Ultra" : "High",
      seedvrProfile: finalOutput === "seed7" ? "realistic" : "balanced",
      seedvrResolution: finalOutput === "seed7" ? 2656 : 2048,
      autoPurge: true,
      saveOriginal: true,
      faceDetailer: true,
      handDetailer: true,
      faceDetailerDenoise: 0.22,
      handDetailerDenoise: 0.28,
      flux2BaseModel: settings.flux2BaseModel,
      flux2TurboModel: settings.flux2TurboModel,
      flux1RefineModel: settings.flux1RefineModel,
      perfectFamily: settings.perfectFamily,
      perfectRecipe: settings.perfectRecipe,
      perfectQwenModel: settings.perfectQwenModel,
      perfectKleinModel: settings.perfectKleinModel,
      loras: JSON.stringify(project.loras || []),
    };
    const updated = await api(`/api/studio/projects/${project.id}/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.projects = state.projects.map((item) => item.id === updated.id ? updated : item);
    renderProjects();
    showToast("Stadio successivo aggiunto alla coda.");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

async function animateStoryboard(projectId) {
  try {
    const updated = await api(`/api/studio/projects/${projectId}/animate-storyboard`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        duration: 5,
        resolution: "480p",
        orientation: "landscape",
        cameraMotion: "dolly in",
        motionIntensity: "medium",
        audioMode: "generated",
        loras: "[]",
      }),
    });
    state.projects = state.projects.map((item) => item.id === updated.id ? updated : item);
    renderProjects();
    showToast("Transizioni LTX aggiunte alla coda.");
  } catch (error) {
    showToast(error.message);
  }
}

async function refreshProjects() {
  try {
    state.projects = await api("/api/studio/projects");
    renderProjects();
  } catch {
    // Il polling riproverà senza bloccare la pagina.
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
    api("/api/studio/projects"),
  ]);
  $("#studioMode").innerHTML = state.config.studio.modes.map((mode) =>
    `<option value="${mode.id}">${escapeHtml(mode.name)}</option>`
  ).join("");
  const requestedWorkflow = new URLSearchParams(location.search).get("workflow");
  if (state.config.studio.modes.some((mode) => mode.id === requestedWorkflow)) {
    $("#studioMode").value = requestedWorkflow;
  }
  const characters = state.config.characters?.availableCharacters || [];
  $("#studioCharacterId").innerHTML = [
    `<option value="">Nessuna</option>`,
    ...characters.map((character) =>
      `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`
    ),
  ].join("");
  syncCharacterFields();
  $("#firstLastVideoModel").innerHTML = (state.config.videoModels || [])
    .filter((model) => model.available !== false)
    .map((model) =>
      `<option value="${escapeHtml(model.id)}" ${model.id === "normal" ? "selected" : ""}>${escapeHtml(model.name)}</option>`
    ).join("");
  const populateModels = (selector, familyId, preferred) => {
    const family = state.config.imageModels.find((item) => item.id === familyId);
    const models = family?.models || [];
    $(selector).innerHTML = models.map((model) =>
      `<option value="${escapeHtml(model.file)}">${escapeHtml(model.name)}</option>`
    ).join("");
    if (models.some((model) => model.file === preferred)) $(selector).value = preferred;
  };
  populateModels("#flux2TurboModel", "flux2", state.config.studio.defaults.flux2Turbo);
  populateModels("#flux2BaseModel", "flux2", state.config.studio.defaults.flux2Base);
  populateModels("#zImageModel", "zImage", state.config.studio.defaults.zImageTurbo);
  populateModels("#flux1RefineModel", "flux1", state.config.studio.defaults.flux1Realistic);
  populateModels("#qwenEditModel", "qwenEdit", state.config.studio.defaults.qwenEdit);
  populateModels("#guidedKleinModel", "flux2", state.config.studio.defaults.guidedKlein);
  populateModels("#perfectQwenModel", "qwenEdit", state.config.studio.defaults.perfectQwen);
  populateModels("#perfectKleinModel", "flux2", state.config.studio.defaults.perfectKlein);
  const guideAvailability = new Map(
    (state.config.studio.structureGuides || []).map((guide) => [guide.id, guide]),
  );
  for (const option of $("#structureGuide").options) {
    const guide = guideAvailability.get(option.value);
    if (guide && !guide.available) {
      option.disabled = true;
      option.textContent = `${guide.name} · componenti mancanti`;
    } else if (guide?.name) {
      option.textContent = guide.name;
    }
  }
  updateMode();
  setupUploadPreviews();
  await applyGuidedCreation();
  setupUploadPreviews();
  updateStructureGuide();
  $("#studio-prompt-assistant").classList.toggle("hidden", !state.config.promptAssistant?.enabled);
  $("#studio-qwen-edit-prompt").classList.toggle("hidden", !state.config.promptAssistant?.enabled);
  $("#studio-klein-prompt").classList.toggle("hidden", !state.config.promptAssistant?.enabled);
  renderProjects();
  checkHealth();
  setInterval(checkHealth, 15000);
  setInterval(refreshProjects, 3500);
}

async function applyGuidedCreation() {
  const token = guidedTokenFromLocation();
  if (!token) return;
  const handoff = await consumeGuidedHandoff(token);
  if (!handoff?.payload?.fields) return;
  const { fields } = handoff.payload;
  if (fields.studioMode && state.config.studio.modes.some((mode) => mode.id === fields.studioMode)) {
    $("#studioMode").value = fields.studioMode;
  }
  updateMode();
  if (fields.editAction) {
    const action = document.querySelector(`[name="editAction"][value="${CSS.escape(fields.editAction)}"]`);
    if (action) {
      action.checked = true;
      updateGuidedAction();
    }
  }
  if (fields.engine && fields.engine !== "auto") {
    const qwen = ["qwenImage", "qwenEdit"].includes(fields.engine);
    const klein = fields.engine === "flux2";
    if ($("#studioMode").value === "perfect") {
      $("#perfectFamily").value = klein ? "klein" : qwen ? "gwen" : $("#perfectFamily").value;
      updatePerfectModel();
    } else if ($("#studioMode").value === "guidedEdit") {
      $("#guidedModelFamily").value = klein ? "klein" : "qwen";
      updateGuidedModel();
    } else if ($("#studioMode").value === "storyboard") {
      $("#storyboardFamily").value = klein ? "klein" : "gwen";
      updateStoryboardModel();
    } else if ($("#studioMode").value === "firstLast") {
      const videoModel = [...$("#firstLastVideoModel").options].find((option) =>
        option.value === fields.engine && !option.disabled
      );
      if (videoModel) $("#firstLastVideoModel").value = fields.engine;
    }
  }
  const preset = document.querySelector(`[name="studioPreset"][value="${CSS.escape(fields.quality || "quality")}"]`);
  if (preset) preset.checked = true;
  if ($("#studioMode").value === "firstLast") {
    $("#resolution").value = fields.quality === "speed"
      ? "360p"
      : fields.quality === "max"
        ? "720p"
        : "480p";
  }
  if (fields.prompt) {
    $("#studio-prompt").value = fields.prompt;
    $("#studio-prompt").dispatchEvent(new Event("input", { bubbles: true }));
  }
  for (const [name, file] of Object.entries(handoff.files || {})) {
    setInputFile(document.querySelector(`[name="${CSS.escape(name)}"]`), file);
  }
  history.replaceState({}, "", location.pathname);
  showToast("Progetto preparato dalla Crea guidata. Controlla i dettagli prima di avviarlo.");
}

$("#studioMode").addEventListener("change", updateMode);
$("#studioCharacterId").addEventListener("change", syncCharacterFields);
$("#kreaTripleOperation").addEventListener("change", updateMode);
$("#open-workflow-guide").addEventListener("click", openQuickGuide);
$("#close-workflow-guide").addEventListener("click", () => $("#workflow-guide-dialog").close());
$("#workflow-guide-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
$("#maskMode").addEventListener("change", updateMaskMode);
document.querySelectorAll('input[name="editAction"]').forEach((input) =>
  input.addEventListener("change", updateGuidedAction)
);
$("#structureGuide").addEventListener("change", updateStructureGuide);
$("#structureStrength").addEventListener("input", (event) => {
  $("#structure-strength-value").textContent = Number(event.target.value).toLocaleString("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
});
$("#shotCount").addEventListener("change", renderShotFields);
$("#storyboardFamily").addEventListener("change", updateStoryboardModel);
$("#guidedModelFamily").addEventListener("change", updateGuidedModel);
$("#qwenEditModel").addEventListener("change", renderLoras);
$("#guidedKleinModel").addEventListener("change", renderLoras);
$("#perfectFamily").addEventListener("change", updatePerfectModel);
$("#perfectRecipe").addEventListener("change", updatePerfectModel);
$("#perfectQwenModel").addEventListener("change", updatePerfectModel);
$("#perfectKleinModel").addEventListener("change", updatePerfectModel);
$("#bibleType").addEventListener("change", updateBibleDefaults);
$("#studio-source").addEventListener("change", (event) => loadSource(event.target.files[0]));
function studioPromptAssistantSource() {
  return $("#studio-source").files[0]
    || document.querySelector('[name="firstFrame"]')?.files[0]
    || null;
}

$("#studio-prompt-assistant").addEventListener("click", async () => {
  const source = studioPromptAssistantSource();
  const target = $("#studioMode").value === "firstLast"
    ? "ltx"
    : $("#studioMode").value === "qwenKreaKlein"
      ? "qwen_image_edit_architect"
    : $("#studioMode").value === "guidedEdit"
      ? "qwenedit"
      : $("#studioMode").value === "storyboard"
        ? ($("#storyboardFamily").value === "gwen"
          ? (source ? "qwenedit" : "qwen")
          : "flux2")
        : $("#studioMode").value === "perfect"
          ? ($("#perfectFamily").value === "gwen"
            ? (source ? "qwenedit" : "qwen")
            : "flux2")
          : "studio";
  try {
    await enhanceMainPrompt({
      input: $("#studio-prompt"),
      button: $("#studio-prompt-assistant"),
      status: $("#studio-prompt-assistant-status"),
      target,
      mode: source ? "image" : "text",
      workflowName: studioMode()?.name || "Image Studio",
      sourceFile: source,
      negativeInput: $("#studio-negative"),
      includeNegative: Boolean(source) && $("#studioMode").value !== "firstLast",
    });
    showToast("Prompt Studio creato; modello LM Studio scaricato.");
    if (state.config.promptAssistant?.autoGenerate) $("#studio-form").requestSubmit();
  } catch {
    // Il dettaglio resta vicino al prompt.
  }
});

async function runStudioImagePromptPreset(target, button, successMessage) {
  const source = studioPromptAssistantSource();
  try {
    await enhanceMainPrompt({
      input: $("#studio-prompt"),
      button,
      status: $("#studio-prompt-assistant-status"),
      target,
      mode: source ? "image" : "text",
      workflowName: `${studioMode()?.name || "Image Studio"} · ${target === "qwen_image_edit_architect" ? "Qwen Edit Prompt" : "Klein Prompt"}`,
      sourceFile: source,
      negativeInput: $("#studio-negative"),
      includeNegative: Boolean(source) || target.includes("edit") || target.includes("klein"),
    });
    showToast(successMessage);
  } catch {
    // Il dettaglio resta vicino al prompt.
  }
}

async function insertRandomEditWildcard({ reroll = false } = {}) {
  const button = reroll ? $("#edit-wildcard-reroll") : $("#edit-wildcard-random");
  const status = $("#edit-wildcard-status");
  button.disabled = true;
  status.classList.remove("prompt-assistant-error");
  status.textContent = "Pesco un prompt random dal pool locale…";
  try {
    const seed = reroll ? Math.floor(Math.random() * 2 ** 31) : (state.editWildcardSeed ?? Math.floor(Math.random() * 2 ** 31));
    const result = await api("/api/edit-wildcards/random", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        family: $("#editWildcardFamily").value,
        mode: $("#editWildcardMode").value,
        base: $("#studio-prompt").value,
        seed,
        maxLength: 1400,
      }),
    });
    state.editWildcardSeed = result.seed;
    $("#studio-prompt").value = result.prompt;
    $("#studio-prompt-count").textContent = result.prompt.length;
    $("#studio-prompt").dispatchEvent(new Event("input", { bubbles: true }));
    status.textContent = `${result.label} · seed ${result.seed}${result.truncated ? " · prompt accorciato" : ""}. Controlla/modifica e poi genera quando vuoi.`;
    showToast("Prompt random inserito.");
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("prompt-assistant-error");
  } finally {
    button.disabled = false;
  }
}

$("#studio-qwen-edit-prompt").addEventListener("click", () => {
  runStudioImagePromptPreset(
    "qwen_image_edit_architect",
    $("#studio-qwen-edit-prompt"),
    "Prompt Qwen Edit creato; clicca Crea progetto quando vuoi."
  );
});

$("#studio-klein-prompt").addEventListener("click", () => {
  runStudioImagePromptPreset(
    "flux2_klein_architect",
    $("#studio-klein-prompt"),
    "Prompt Klein creato; clicca Crea progetto quando vuoi."
  );
});

$("#edit-wildcard-random").addEventListener("click", () => insertRandomEditWildcard());
$("#edit-wildcard-reroll").addEventListener("click", () => insertRandomEditWildcard({ reroll: true }));
$("#editWildcardFamily").addEventListener("change", () => {
  state.editWildcardSeed = null;
});

$("#studio-prompt").addEventListener("input", (event) => {
  $("#studio-prompt-count").textContent = event.target.value.length;
});
$("#mask-draw").addEventListener("click", () => {
  state.erase = false;
  state.maskTool = "draw";
  $("#mask-draw").classList.add("active");
  $("#mask-erase").classList.remove("active");
  $("#mask-rectangle").classList.remove("active");
});
$("#mask-rectangle").addEventListener("click", () => {
  state.erase = false;
  state.maskTool = "rectangle";
  $("#mask-rectangle").classList.add("active");
  $("#mask-draw").classList.remove("active");
  $("#mask-erase").classList.remove("active");
});
$("#mask-erase").addEventListener("click", () => {
  state.erase = true;
  state.maskTool = "erase";
  $("#mask-erase").classList.add("active");
  $("#mask-draw").classList.remove("active");
  $("#mask-rectangle").classList.remove("active");
});
$("#mask-clear").addEventListener("click", clearMask);
$("#mask-canvas").addEventListener("pointerdown", beginMask);
$("#mask-canvas").addEventListener("pointermove", drawMask);
$("#mask-canvas").addEventListener("pointerup", endMask);
$("#mask-canvas").addEventListener("pointercancel", endMask);
$("#studio-add-lora").addEventListener("click", addLora);
$("#studio-form").addEventListener("submit", submitProject);
$("#studio-projects").addEventListener("click", (event) => {
  const cancel = event.target.closest("[data-cancel-job]");
  if (cancel) {
    cancelProjectGeneration(cancel);
    return;
  }
  const continuation = event.target.closest("[data-continue], [data-generation]");
  if (continuation) continueProject(continuation);
  const animate = event.target.closest("[data-animate]");
  if (animate) animateStoryboard(animate.dataset.animate);
});

start().catch((error) => {
  $("#studio-form-status").textContent = error.message;
  setConnection(false);
});
