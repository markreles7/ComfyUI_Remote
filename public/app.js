import { enhanceDirectorPrompts, enhanceMainPrompt } from "./prompt-assistant.js";
import { consumeGuidedHandoff, guidedTokenFromLocation, setInputFile } from "./guided-handoff.js";
import { applyLoraTriggers, automaticLoraTriggers, loraMatchesFamily, loraOptionLabel } from "./lora-triggers.js?v=20260822-scalar-fix";
import { setupUploadPreviews } from "./upload-previews.js";
import { createAdaptivePoller, getAppConfig, warmAppConfig } from "./runtime-cache.js";

void warmAppConfig();

const state = {
  config: null,
  history: [],
  currentId: null,
  eventSource: null,
  historyRefreshTimer: null,
  historyRefreshInFlight: false,
  historyRefreshQueued: false,
  sceneSerial: 0,
  loraSerial: 0,
  videoModelSelections: {},
  activeSeriesId: null,
  seriesAnchor: null,
};

const $ = (selector) => document.querySelector(selector);
const form = $("#generator-form");
const workflow = $("#workflow");
const connection = $("#connection");
const toast = $("#toast");

function isImageGeneration() {
  return $("#generationType").value === "image";
}

function isUpscaleGeneration() {
  return $("#generationType").value === "upscale";
}

function isLtxUpscaleGeneration() {
  return $("#generationType").value === "ltxUpscale";
}

function isSeedvr2VideoUpscaleGeneration() {
  return $("#generationType").value === "seedvr2VideoUpscale";
}

function promptAssistantContext() {
  if (isImageGeneration()) {
    const model = state.config?.imageModels.find((item) => item.id === $("#imageModelId").value);
    const mode = $("#imageMode").value;
    return {
      target: String(model?.family || "flux2").toLowerCase(),
      mode,
      workflowName: `${model?.name || "Immagine"} · ${$("#imageModelFile").selectedOptions[0]?.textContent || ""}`,
      sourceFile: mode === "text" ? null : $("#sourceImage").files[0] || null,
    };
  }
  const selectedWorkflow = state.config?.workflows.find((item) => item.id === workflow.value);
  const edit = workflow.value === "editAnything";
  const textMode = $("#videoInputMode").value === "text";
  const sulphur = selectedWorkflow?.id === "ltxSulphur";
  const minimaxH3 = selectedWorkflow?.id === "minimaxH3";
  return {
    target: minimaxH3
      ? "minimax_h3"
      : sulphur ? (edit ? "sulphur_ltxedit" : "sulphur_ltx") : (edit ? "ltxedit" : "ltx"),
    mode: edit ? "video" : textMode ? "text" : "image",
    workflowName: `${selectedWorkflow?.name || "LTX 2.3"} · ${$("#videoModelId").selectedOptions[0]?.textContent || ""}`,
    sourceFile: !edit && !textMode ? $("#image").files[0] || null : null,
  };
}

function isSulphurPromptMode() {
  if (isImageGeneration() || isUpscaleGeneration() || isSeedvr2VideoUpscaleGeneration()) return false;
  const selectedWorkflow = state.config?.workflows.find((item) => item.id === workflow.value);
  return selectedWorkflow?.id === "ltxSulphur";
}

function updatePromptAssistantAvailability() {
  const qwenEditButton = $("#qwen-edit-prompt-button");
  const kleinButton = $("#klein-prompt-button");
  const qwenPreset = $("#qwen-prompt-preset");
  const fluxPreset = $("#flux-prompt-preset");
  const ltxPreset = $("#ltx-prompt-preset");
  const reverseButton = $("#reverse-prompt-button");
  const ltxArchitectButton = $("#ltx-architect-prompt-button");
  const ltxSceneButton = $("#ltx-scene-prompt-button");
  const sulphurPromptButton = $("#sulphur-prompt-button");
  const directorButton = $("#director-prompt-assistant-button");
  const enabled = Boolean(state.config?.promptAssistant?.enabled);
  const usable = enabled && !isUpscaleGeneration() && !$("#prompt").disabled;
  const imageUsable = usable && isImageGeneration();
  const imageTarget = imageUsable ? promptAssistantContext().target : "";
  const qwenUsable = imageUsable && imageTarget === "qwen";
  const qwenEditUsable = imageUsable && /^qwenedit/.test(imageTarget);
  const fluxUsable = imageUsable && imageTarget === "flux2";
  const isDirector = !isImageGeneration() && workflow.value === "director";
  const ltxUsable = usable && !isImageGeneration() && !isDirector;
  const sulphurUsable = ltxUsable;
  qwenEditButton.classList.toggle("hidden", !(qwenUsable || qwenEditUsable));
  qwenEditButton.textContent = qwenUsable ? "✦ Qwen Prompt" : "✦ Qwen Edit";
  qwenPreset.classList.toggle("hidden", !qwenUsable);
  kleinButton.classList.toggle("hidden", !fluxUsable);
  fluxPreset.classList.toggle("hidden", !fluxUsable);
  reverseButton.classList.toggle("hidden", !imageUsable);
  ltxArchitectButton.classList.toggle("hidden", !ltxUsable);
  ltxSceneButton.classList.toggle("hidden", !ltxUsable);
  sulphurPromptButton.classList.toggle("hidden", !sulphurUsable);
  ltxPreset.classList.toggle("hidden", !ltxUsable);
  directorButton?.classList.toggle("hidden", !enabled || !isDirector);
  if (!enabled) $("#prompt-assistant-status").textContent = "Prompt Assistant non configurato";
}

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function poseCategoryLabel(category) {
  return {
    upright: "In piedi / seduta",
    raised_arm: "Braccio alzato",
    leaning: "Appoggiata / inclinata",
    reclining: "Sdraiata / reclinata",
    partial_body: "Mezza figura / dettaglio",
  }[category] || category;
}

function updatePoseLibraryControls() {
  const panel = $("#pose-library-panel");
  const select = $("#pose-library-category");
  const button = $("#pose-library-random");
  const status = $("#pose-library-status");
  const library = state.config?.poseLibrary;
  const usable = Boolean(library?.installed) && !$("#prompt").disabled;
  panel.classList.toggle("hidden", !usable);
  select.disabled = !usable;
  button.disabled = !usable;
  if (!usable) return;
  if (select.options.length === 1) {
    for (const category of library.categories || []) {
      select.insertAdjacentHTML("beforeend", `<option value="${escapeAttribute(category)}">${escapeHtml(poseCategoryLabel(category))}</option>`);
    }
  }
  status.textContent = `${library.count} pose analizzate · aggiunge solo una direzione testuale, senza OpenPose o immagini reference.`;
}

function removePreviousPoseSuffix() {
  const previous = state.posePromptSuffix;
  if (!previous) return;
  const input = $("#prompt");
  const suffix = `, ${previous}`;
  if (input.value.trimEnd().endsWith(suffix)) input.value = input.value.trimEnd().slice(0, -suffix.length).trimEnd();
  state.posePromptSuffix = null;
}

async function insertTextualPose() {
  const button = $("#pose-library-random");
  const status = $("#pose-library-status");
  button.disabled = true;
  try {
    removePreviousPoseSuffix();
    const result = await api("/api/pose-library/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: $("#prompt").value,
        category: $("#pose-library-category").value,
      }),
    });
    const suffix = String(result.promptSuffix || "").trim();
    if (!suffix) throw new Error("La posa selezionata non contiene una descrizione testuale.");
    const input = $("#prompt");
    input.value = [input.value.trim().replace(/[,.]$/, ""), suffix].filter(Boolean).join(", ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    state.posePromptSuffix = suffix;
    status.textContent = `Inserita: ${poseCategoryLabel(result.selection.pose.category)} · ${result.selection.pose.tags.join(", ")}. Premi di nuovo il dado per sostituirla.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function escapeAttribute(text) {
  return escapeHtml(text).replaceAll('"', "&quot;");
}

function compatibleLoras() {
  if (isUpscaleGeneration() || isSeedvr2VideoUpscaleGeneration()) return [];
  if (!isImageGeneration() && workflow.value === "minimaxH3") return [];
  const all = state.config?.loras || [];
  let prefix = "LTX2.3\\";
  if (isImageGeneration()) {
    const model = state.config.imageModels.find((item) => item.id === $("#imageModelId").value);
    prefix = ["qwen", "qwenedit"].includes(model?.family)
      ? "QWEN\\"
      : model?.family === "flux2"
        ? "FLUX2\\"
      : model?.family === "zimage"
          ? "ZIMG\\"
          : ["mageflow", "mageflowedit"].includes(model?.family)
            ? "MAGEFLOW\\"
          : "FLUX\\";
  }
  const family = prefix.replace("\\", "").toLocaleUpperCase();
  return all.filter((name) => loraMatchesFamily(name, family, state.config?.loraMetadata));
}

function loraOptions(selected = "") {
  const available = compatibleLoras();
  return `<option value="">Scegli una LoRA…</option>${available.map((name) =>
    `<option value="${escapeAttribute(name)}"${name === selected ? " selected" : ""}>${escapeHtml(loraOptionLabel(name, state.config?.loraMetadata))}</option>`
  ).join("")}`;
}

function addLora(values = {}) {
  const id = `lora_${++state.loraSerial}`;
  const available = compatibleLoras();
  if (!available.length) return showToast("Nessuna LoRA compatibile trovata");
  $("#lora-list").insertAdjacentHTML("beforeend", `
    <div class="lora-row" data-lora-id="${id}">
      <div>
        <label for="${id}_name">LoRA</label>
        <select id="${id}_name" data-lora-name>${loraOptions(values.name || "")}</select>
      </div>
      <div>
        <label for="${id}_strength">Forza</label>
        <input id="${id}_strength" data-lora-strength type="number" min="-10" max="10" step="0.05" value="${Number(values.strength ?? 1)}">
      </div>
      <button type="button" data-remove-lora title="Rimuovi LoRA">×</button>
    </div>`);
  syncLoras();
}

function syncLoras() {
  const values = selectedLoras();
  $("#loras").value = JSON.stringify(values);
  $("#lora-count").textContent = `${values.length} ${values.length === 1 ? "attiva" : "attive"}`;
  $("#lora-empty-hint").classList.toggle("hidden", document.querySelectorAll(".lora-row").length > 0);
}

function selectedLoras() {
  return [...document.querySelectorAll(".lora-row")].map((row) => ({
    name: row.querySelector("[data-lora-name]").value,
    strength: Number(row.querySelector("[data-lora-strength]").value),
  })).filter((item) => item.name);
}

function selectedPromptTriggers() {
  return automaticLoraTriggers(selectedLoras(), state.config?.loraMetadata || {});
}

function imageSeriesMode() {
  return isImageGeneration() ? $("#imageSeriesMode")?.value || "off" : "off";
}

function selectedImageModel() {
  return state.config?.imageModels?.find((item) => item.id === $("#imageModelId").value) || null;
}

function imageSeriesCompatibleLoras() {
  return compatibleLoras();
}

function populateSeriesLoras() {
  const select = $("#seriesCharacterLora");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = [
    '<option value="">Nessuna Character LoRA</option>',
    ...imageSeriesCompatibleLoras().map((name) =>
      `<option value="${escapeAttribute(name)}">${escapeHtml(loraOptionLabel(name, state.config?.loraMetadata))}</option>`),
  ].join("");
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  syncSeriesTrigger();
}

function syncSeriesTrigger() {
  const name = $("#seriesCharacterLora")?.value || "";
  const metadata = state.config?.loraMetadata?.[name] || {};
  const triggers = metadata.triggers || metadata.trigger || [];
  const values = Array.isArray(triggers) ? triggers : [triggers];
  $("#seriesCharacterTrigger").value = values.filter(Boolean).join(", ");
  const consistency = $("#characterConsistency");
  if (consistency && name && consistency.value === "off") consistency.value = "lora";
}

function seriesLoras() {
  const name = $("#seriesCharacterLora")?.value || "";
  if (!name) return selectedLoras();
  const item = { name, strength: Number($("#seriesLoraStrength").value || 1) };
  return [item, ...selectedLoras().filter((lora) => lora.name !== name)];
}

function setRangeOutput(input) {
  const output = document.querySelector(`output[for="${input.id}"]`);
  if (output) output.value = input.value;
}

function applySceneLockPreset() {
  const presets = {
    high: [95, 95, 95, 90, 25],
    medium: [80, 85, 85, 70, 45],
    low: [60, 70, 70, 50, 65],
  };
  const values = presets[$("#sceneLock").value] || presets.high;
  ["preserveLocation", "preserveOutfit", "preserveLighting", "preserveFraming", "variationStrength"]
    .forEach((id, index) => {
      const input = $(`#${id}`);
      input.value = values[index];
      setRangeOutput(input);
    });
}

function applySamePlaceModel() {
  const id = $("#samePlaceModel").value;
  $("#imageModelId").value = id;
  imageOptionsChanged(true);
  const model = selectedImageModel();
  if (id === "flux2") {
    const turbo = model?.models?.find((item) => /pornmaster.*flux2.*klein.*v4.*turbo/i.test(item.file));
    if (turbo) {
      $("#imageModelFile").value = turbo.file;
      $("#imageSteps").value = turbo.defaults.steps;
      $("#imageGuidance").value = turbo.defaults.guidance;
    }
  }
  $("#imageMode").value = id === "qwenImage" ? "text" : "image";
  imageOptionsChanged();
}

function updateImageSeriesOptions() {
  const panel = $("#image-series-panel");
  if (!panel) return;
  const image = isImageGeneration();
  panel.classList.toggle("hidden", !image);
  if (!image) return;
  const mode = imageSeriesMode();
  $("#influencer-series-options").classList.toggle("hidden", mode !== "influencer");
  $("#same-place-series-options").classList.toggle("hidden", mode !== "samePlace");
  populateSeriesLoras();
  const model = selectedImageModel();
  $("#prompt").required = mode === "off"
    || (mode === "influencer" && $("#influencerPromptMode").value === "manual");
  if (mode === "samePlace") {
    $("#sourceImage").required = false;
    $("#source-image-field").classList.add("hidden");
  }
  const file = $("#imageModelFile").value;
  const eligible = ["qwen", "qwenedit", "flux2"].includes(model?.family);
  $("#influencer-model-status").textContent = eligible
    ? `${model.name} · ${$("#imageModelFile").selectedOptions[0]?.textContent || file}`
    : "Seleziona Qwen 2512, Qwen Edit 2511 o Flux.2 Klein";
  const pulid = state.config?.imageSeries?.pulidFlux2 || {};
  for (const option of $("#characterConsistency").options) {
    if (["pulid", "loraPulid"].includes(option.value)) option.disabled = !pulid.available;
  }
  if ($("#characterConsistency").selectedOptions[0]?.disabled) $("#characterConsistency").value = $("#seriesCharacterLora").value ? "lora" : "off";
  const pulidSelected = ["pulid", "loraPulid"].includes($("#characterConsistency").value);
  $("#pulidStrength").disabled = !pulidSelected;
  $("#pulidReference").disabled = !pulidSelected;
  $("#pulid-reference-dropzone").classList.toggle("disabled", !pulidSelected);
  $("#pulid-capability-message").textContent = pulid.available
    ? `PuLID pronto · ${[...(pulid.pulidNodes || []), ...(pulid.insightFaceNodes || [])].join(", ")}`
    : pulid.reason || "PuLID Flux.2 non disponibile; Flux standard e Character LoRA restano utilizzabili.";
  const sameId = $("#samePlaceModel").value;
  $("#same-place-model-message").textContent = sameId === "qwenEdit"
    ? "Modalità principale: l’anchor originale viene inviata a ogni job Qwen Edit 2511."
    : sameId === "qwenImage"
      ? "Supporto secondario: Qwen 2512 usa Character LoRA e contesto testuale; non dispone di conditioning anchor nativo nel workflow attuale."
      : "Best effort Flux.2: usa la reference latent nativa. PuLID resta disabilitato finché i nodi non compaiono in /object_info.";
}

function anchorImageUrl(item, index = 0) {
  return `/api/image/${encodeURIComponent(item.id)}/${index}`;
}

function selectSeriesAnchor(item, index = 0) {
  state.seriesAnchor = {
    generationId: item.id,
    imageIndex: index,
    url: anchorImageUrl(item, index),
    prompt: item.prompt || "",
    seed: item.seed,
    model: item.imageModelName || item.workflowName,
  };
  $("#selected-series-anchor").innerHTML = `
    <img src="${state.seriesAnchor.url}" alt="Anchor selezionata">
    <div><b>Anchor dalla cronologia</b><span>${escapeHtml(item.seriesLabel || item.workflowName)} · seed ${escapeHtml(item.seed)}</span></div>
    <button type="button" data-clear-series-anchor aria-label="Rimuovi anchor">×</button>`;
  $("#same-place-anchor-preview").src = state.seriesAnchor.url;
  $("#same-place-anchor-dropzone").classList.add("has-image");
  $("#imageSeriesMode").value = "samePlace";
  applySamePlaceModel();
  updateImageSeriesOptions();
  $("#image-series-panel").open = true;
  $("#image-series-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  showToast("Immagine impostata come Same Place Series Anchor");
}

function clearSeriesAnchor() {
  state.seriesAnchor = null;
  $("#selected-series-anchor").innerHTML = "<span>Nessuna anchor selezionata</span>";
  if (!$("#samePlaceAnchor").files[0]) {
    $("#same-place-anchor-preview").removeAttribute("src");
    $("#same-place-anchor-dropzone").classList.remove("has-image");
  }
}

async function selectedAnchorFile() {
  const upload = $("#samePlaceAnchor").files[0];
  if (upload) return upload;
  if (!state.seriesAnchor?.url) return null;
  const response = await fetch(state.seriesAnchor.url);
  if (!response.ok) throw new Error("Impossibile caricare l’anchor selezionata dalla cronologia.");
  const blob = await response.blob();
  return new File([blob], `series-anchor-${state.seriesAnchor.generationId}.png`, { type: blob.type || "image/png" });
}

function seriesAnchorContext() {
  return {
    subjectIdentity: $("#seriesCharacterTrigger").value.trim(),
    environmentSummary: state.seriesAnchor?.prompt || $("#prompt").value.trim(),
    outfitSummary: "",
    lightingSummary: "",
    framingSummary: "",
  };
}

async function requestSeriesPlan() {
  const mode = imageSeriesMode();
  const seed = $("#imageSeed").value.trim();
  if (mode === "influencer") {
    return api("/api/image-series/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "influencer",
        characterTrigger: $("#seriesCharacterTrigger").value.trim(),
        count: Number($("#influencerCount").value),
        promptMode: $("#influencerPromptMode").value,
        manualPrompt: $("#prompt").value.trim(),
        seedMode: $("#influencerSeedMode").value,
        seed,
      }),
    });
  }
  const requestedSeedMode = $("#samePlaceSeedMode").value;
  const anchorSeed = state.seriesAnchor?.seed;
  const seedMode = requestedSeedMode === "anchor" && !anchorSeed ? "fixed" : requestedSeedMode;
  const fallbackSeed = seed || String(Math.floor(Math.random() * 2147483647));
  return api("/api/image-series/plan", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "samePlace",
      count: Number($("#samePlaceCount").value),
      anchorContext: seriesAnchorContext(),
      seedMode,
      seed: seedMode === "fixed" ? fallbackSeed : seed,
      anchorSeed,
      preserveLocation: Number($("#preserveLocation").value),
      preserveOutfit: Number($("#preserveOutfit").value),
      preserveLighting: Number($("#preserveLighting").value),
      preserveFraming: Number($("#preserveFraming").value),
      variationStrength: Number($("#variationStrength").value),
      allowPoseChanges: $("#allowPoseChanges").checked,
      allowExpressionChanges: $("#allowExpressionChanges").checked,
      allowSmallAngleChanges: $("#allowSmallAngleChanges").checked,
      allowHandReposition: $("#allowHandReposition").checked,
      allowGazeChanges: $("#allowGazeChanges").checked,
    }),
  });
}

async function submitImageSeries() {
  const mode = imageSeriesMode();
  const model = selectedImageModel();
  if (!["qwen", "qwenedit", "flux2"].includes(model?.family)) {
    throw new Error("La modalità serie richiede Qwen Image 2512, Qwen Image Edit 2511 o Flux.2 Klein.");
  }
  if (mode === "influencer" && !$("#seriesCharacterLora").value) {
    throw new Error("Seleziona una Character LoRA per mantenere la stessa identità nella serie Influencer.");
  }
  const file = $("#imageModelFile").value;
  const consistency = $("#characterConsistency").value;
  if (["pulid", "loraPulid"].includes(consistency)) {
    throw new Error(state.config?.imageSeries?.pulidFlux2?.reason || "PuLID Flux.2 non disponibile.");
  }
  if (consistency === "lora" && !$("#seriesCharacterLora").value) {
    throw new Error("Seleziona una Character LoRA oppure imposta Character Consistency su Off.");
  }
  let anchor = null;
  if (mode === "samePlace") {
    anchor = await selectedAnchorFile();
    if (!anchor) throw new Error("Carica o seleziona una Anchor Image per Same Place Series.");
  } else if (model.family === "qwenedit") {
    anchor = $("#sourceImage").files[0];
    if (!anchor) throw new Error("Qwen Image Edit 2511 richiede l’immagine input/reference.");
  }
  const plan = await requestSeriesPlan();
  const seriesId = crypto.randomUUID();
  state.activeSeriesId = seriesId;
  const anchorContext = seriesAnchorContext();
  const queued = [];
  for (const item of plan.items) {
    const data = new FormData(form);
    data.set("generationType", "image");
    data.set("batchSize", "1");
    data.set("prompt", item.prompt);
    data.set("seed", String(item.seed));
    data.set("loras", JSON.stringify(seriesLoras()));
    data.set("seriesId", seriesId);
    data.set("seriesType", mode);
    data.set("seriesIndex", String(item.index));
    data.set("seriesCount", String(plan.count));
    data.set("seriesLabel", item.label);
    data.set("seriesVariation", item.variation || "");
    data.set("seriesSeedMode", mode === "samePlace" ? $("#samePlaceSeedMode").value : $("#influencerSeedMode").value);
    data.set("seriesRevision", "0");
    data.set("anchorGenerationId", state.seriesAnchor?.generationId || "");
    data.set("anchorImageIndex", String(state.seriesAnchor?.imageIndex ?? ""));
    data.set("anchorContext", JSON.stringify(anchorContext));
    data.set("sceneLock", mode === "samePlace" ? $("#sceneLock").value : "");
    data.set("characterLora", $("#seriesCharacterLora").value);
    data.set("characterLoraStrength", $("#seriesLoraStrength").value);
    data.set("characterTrigger", $("#seriesCharacterTrigger").value.trim());
    data.set("characterConsistency", consistency);
    data.set("pulidStrength", $("#pulidStrength").value);
    if (mode === "samePlace") {
      data.set("imageModelId", $("#samePlaceModel").value);
      data.set("imageMode", $("#samePlaceModel").value === "qwenImage" ? "text" : "image");
      if ($("#samePlaceModel").value === "qwenImage") data.delete("sourceImage");
      else data.set("sourceImage", anchor, anchor.name);
    } else if (anchor) {
      data.set("sourceImage", anchor, anchor.name);
    }
    if (model.family === "flux2" && !/pornmaster.*flux2.*klein.*v4.*turbo/i.test(file)) {
      data.set("characterConsistency", $("#seriesCharacterLora").value ? "lora" : "off");
    }
    const generation = await api("/api/generations", { method: "POST", body: data });
    queued.push(generation);
    state.history = [generation, ...state.history.filter((entry) => entry.id !== generation.id)];
    renderHistory();
  }
  renderSeriesResults();
  showToast(`${queued.length} job indipendenti aggiunti alla coda`);
  return queued;
}

function refreshLoraOptions() {
  for (const select of document.querySelectorAll("[data-lora-name]")) {
    const selected = select.value;
    select.innerHTML = loraOptions(selected);
    if (![...select.options].some((option) => option.value === selected)) select.value = "";
  }
  $("#add-lora").disabled = compatibleLoras().length === 0;
  syncLoras();
}

function selectedCharacter() {
  const id = $("#characterId")?.value;
  if (!id) return null;
  return (state.config?.characters?.availableCharacters || []).find((character) => character.id === id) || null;
}

function syncCharacterFields() {
  const character = selectedCharacter();
  const settings = character?.settings || {};
  $("#characterIdentityStrength").value = settings.identityStrength || "medium";
  $("#characterLockFace").value = String(settings.lockFace ?? true);
  $("#characterLockHair").value = String(settings.lockHair ?? true);
  $("#characterLockBody").value = String(settings.lockBody ?? true);
  $("#characterLockOutfit").value = String(settings.lockOutfit ?? false);
  $("#character-hint").textContent = character
    ? "Il Character Pack verra' risolto dall'adapter del workflow; se non supportato verra' usato come prompt fallback."
    : "Usa un Virtual Actor persistente come identita/reference automatica.";
  if (!character) return;
  if (isImageGeneration() && $("#imageMode").value !== "text") {
    $("#sourceImage").required = false;
  }
  if (!isImageGeneration() && workflow.value !== "editAnything" && $("#videoInputMode").value !== "text") {
    $("#image").required = false;
  }
}

function renderSulphurPanel(active) {
  const panel = $("#sulphur-base-panel");
  panel.classList.toggle("hidden", !active);
  if (!active) return;
  const config = state.config?.sulphur || {};
  $("#sulphur-model-file").textContent = config.modelFile || "ltx-2.3-22b-dev-fp8.safetensors";
  $("#sulphur-enhancer-model").textContent = config.dedicatedEnhancerConfigured
    ? config.enhancerModel
    : `${config.enhancerModel || "LM Studio fallback"} · fallback`;
  $("#sulphur-summary").textContent =
    "Usa LTX 2.3 Dev con LoRA ceil72 + Sulphur rank 768. T2V e I2V hanno template API separati.";
  const files = config.files || [];
  $("#sulphur-file-list").innerHTML = files.map((file) => `
    <li>
      <span class="sulphur-file-status ${file.installed ? "" : "missing"}">${file.installed ? "Presente" : "Manca"}</span>
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <span>${escapeHtml(file.repositoryPath)} · ${Number(file.sizeGb || 0).toFixed(2)} GB</span>
      </div>
    </li>
  `).join("");
  $("#sulphur-install-note").textContent =
    `Prompt enhancer: scarica i file dal repo SulphurAI/Sulphur-2-base e mettili in ${config.lmStudioDirectory || "LM Studio/Sulphur/promptenhancer"}.`;
}

function workflowChanged() {
  if (isImageGeneration()) return;
  $("#regular-scene-fields").classList.remove("hidden");
  const item = state.config.workflows.find((entry) => entry.id === workflow.value);
  $("#workflow-description").textContent = item?.description || "";
  const isDirector = workflow.value === "director";
  const isEdit = workflow.value === "editAnything";
  const isLtxSulphur = workflow.value === "ltxSulphur";
  const supportsTextToVideo = Boolean(item?.supportsTextToVideo);
  const supportsVideoModels = Boolean(item?.supportsVideoModelSelection);
  const videoModelSelect = $("#videoModelId");
  if (supportsVideoModels) {
    const selected = state.videoModelSelections[item.id] || item.defaultVideoModelId || "normal";
    videoModelSelect.value = selected;
    if (videoModelSelect.selectedOptions[0]?.disabled) {
      const fallback = [...videoModelSelect.options].find((option) => !option.disabled);
      if (fallback) videoModelSelect.value = fallback.value;
    }
    state.videoModelSelections[item.id] = videoModelSelect.value;
  }
  const selectedVideoModel = state.config.videoModels?.find((model) => model.id === videoModelSelect.value);
  $("#video-model-field").classList.toggle("hidden", !supportsVideoModels);
  videoModelSelect.disabled = !supportsVideoModels;
  $("#video-model-description").textContent = supportsVideoModels ? selectedVideoModel?.description || "" : "";
  $("#video-model-warning").textContent = selectedVideoModel?.available === false
    ? `Modello non installato: ${selectedVideoModel.file}`
    : "";
  $("#video-model-warning").classList.toggle("hidden", !supportsVideoModels || selectedVideoModel?.available !== false);
  renderSulphurPanel(isLtxSulphur);
  const isTextToVideo = supportsTextToVideo && $("#videoInputMode").value === "text";
  $("#video-input-mode-field").classList.toggle("hidden", !supportsTextToVideo);
  $("#videoInputMode").disabled = !supportsTextToVideo;
  $("#video-input-mode-hint").textContent = isTextToVideo
    ? "Genera il video da zero usando soltanto il prompt, senza un fotogramma iniziale."
    : "Usa una foto come primo fotogramma e guidane il movimento con il prompt.";
  $("#quality-field").classList.toggle("hidden", !item?.supportsQuality);
  $("#regular-scene-fields").classList.toggle("hidden", isDirector);
  $("#source-image-field").classList.add("hidden");
  $("#image-input-field").classList.toggle("hidden", isEdit || isTextToVideo);
  $("#video-input-field").classList.toggle("hidden", !isEdit);
  $("#resolution-field").classList.toggle("hidden", isEdit);
  $("#orientation-field").classList.toggle("hidden", isEdit);
  $("#director-storyboard").classList.toggle("hidden", !isDirector);
  $("#edit-settings").classList.toggle("hidden", !isEdit);
  $("#image").disabled = isDirector || isEdit || isTextToVideo;
  $("#image").required = !isDirector && !isEdit && !isTextToVideo;
  $("#video").disabled = !isEdit;
  $("#video").required = isEdit;
  $("#prompt").disabled = isDirector;
  $("#prompt").required = !isDirector;
  $("#duration").disabled = isDirector;
  $("#resolution").disabled = isEdit;
  $("#orientation").disabled = isEdit;
  $("#prompt-label").textContent = isEdit ? "Istruzione di modifica" : "Prompt positivo";
  $("#prompt").placeholder = isEdit
    ? "Es. Replace the red car with a futuristic silver vehicle…"
    : "Descrivi scena, movimento, camera, luce e atmosfera…";
  $("#duration-label").textContent = isEdit ? "Durata massima" : "Durata";
  for (const input of document.querySelectorAll("#director-storyboard input, #director-storyboard textarea")) {
    input.disabled = !isDirector;
  }
  for (const input of document.querySelectorAll("#edit-settings input, #edit-settings select")) {
    input.disabled = !isEdit;
  }
  if (isDirector && !$("#storyboard-scenes").children.length) {
    addStoryboardScene({ duration: Number($("#duration").value) || 10 });
  }
  updateStoryboard();
  refreshLoraOptions();
  updatePromptAssistantAvailability();
  syncCharacterFields();
}

function upscaleOptionsChanged() {
  const active = isUpscaleGeneration();
  const config = state.config?.upscaling || { engines: [], models: [] };
  const engine = config.engines.find((item) => item.id === $("#upscaleEngine").value);
  const modelEngine = engine?.id === "model";
  const detailers = config.detailers || {};
  const detailerReady = active && detailers.available;
  $("#upscale-engine-description").textContent = engine?.description || "";
  $("#upscale-model-field").classList.toggle("hidden", !modelEngine);
  $("#upscaleModel").disabled = !active || !modelEngine;
  $("#upscaleAutoPurge").disabled = !active || engine?.id === "lanczos";
  for (const id of ["#upscaleFaceDetailer", "#upscaleEyeDetailer", "#upscaleHandDetailer", "#upscaleSkinDetailer"]) {
    $(id).disabled = !detailerReady;
  }
  $("#upscaleNsfwDetailer").disabled = !detailerReady || !detailers.nsfw;
  $("#upscaleFaceDenoise").disabled = !detailerReady || !$("#upscaleFaceDetailer").checked;
  $("#upscaleEyeDenoise").disabled = !detailerReady || !$("#upscaleEyeDetailer").checked;
  $("#upscaleHandDenoise").disabled = !detailerReady || !$("#upscaleHandDetailer").checked;
  $("#upscaleSkinDenoise").disabled = !detailerReady || !$("#upscaleSkinDetailer").checked;
  $("#upscaleNsfwDenoise").disabled = !detailerReady || !detailers.nsfw || !$("#upscaleNsfwDetailer").checked;
  for (const input of document.querySelectorAll('#upscale-presets input[name="upscalePreset"]')) {
    input.disabled = !active;
  }
  const warnings = [];
  if (engine && !engine.available) warnings.push(`${engine.name} non è disponibile nell’istanza ComfyUI attiva.`);
  if (active && !detailers.available) warnings.push("Pre-detailer volto/occhi/mani/pelle non disponibile: manca Impact Pack, SAM o un nodo Flux/detailer richiesto.");
  if (active && detailers.available && !detailers.nsfw) warnings.push("Pre-detailer NSFW non disponibile: manca almeno un detector anatomico Ultralytics.");
  if (engine?.id === "rtx") warnings.push("RTX Qualità MAX usa VSR High Bitrate, denoise e deblur Ultra a 4×.");
  if (engine?.id === "model" && /(?:^|[^0-9])8x/i.test($("#upscaleModel").value)) {
    warnings.push("Il modello selezionato produce un output 8×: può richiedere molta RAM e spazio su disco.");
  }
  $("#upscale-warning").textContent = warnings.join(" ");
  $("#upscale-warning").classList.toggle("hidden", warnings.length === 0);
}

function imageOptionsChanged(updateDefaults = false) {
  const model = state.config.imageModels.find((item) => item.id === $("#imageModelId").value);
  if (!model) return;
  const modelFileSelect = $("#imageModelFile");
  const previousModelFile = modelFileSelect.value;
  modelFileSelect.innerHTML = model.models.map((item) =>
    `<option value="${escapeAttribute(item.file)}">${escapeHtml(item.name)}</option>`
  ).join("");
  const selectedModel = model.models.find((item) => item.file === previousModelFile)
    || model.models.find((item) => item.file === model.defaultModelFile)
    || model.models[0];
  if (selectedModel) modelFileSelect.value = selectedModel.file;
  const modeSelect = $("#imageMode");
  const previousMode = modeSelect.value;
  const labels = {
    text: "Text to Image",
    image: model.family === "mageflowedit"
      ? "Image Edit · Mage-Flow"
      : model.family === "qwenedit"
      ? "Image Edit 2511"
      : model.family === "flux2"
        ? "Image Edit / Reference"
        : "Image to Image",
    reference: "Reference Image · Flux Redux",
  };
  modeSelect.innerHTML = model.modes.map((mode) =>
    `<option value="${mode}">${labels[mode]}</option>`
  ).join("");
  modeSelect.value = model.modes.includes(previousMode) ? previousMode : model.modes[0];
  $("#image-model-description").textContent = selectedModel
    ? `${model.description} Selezionato: ${selectedModel.name}.`
    : model.description;
  $("#image-model-warning").classList.toggle("hidden", model.available);
  const modelWarnings = [];
  if (!model.models.length) {
    modelWarnings.push(`Nessun modello ${model.name} è installato nella cartella ${model.modelPrefix}`);
  }
  if (model.missingRequirements?.length) {
    modelWarnings.push(`Componenti richiesti mancanti: ${model.missingRequirements.join(", ")}`);
  }
  $("#image-model-warning").textContent = model.available ? "" : `${modelWarnings.join(". ")}.`;
  if (updateDefaults) {
    $("#imageSteps").value = selectedModel?.defaults.steps ?? model.defaults.steps;
    $("#imageGuidance").value = selectedModel?.defaults.guidance ?? model.defaults.guidance;
  }
  const mode = modeSelect.value;
  const needsImage = mode !== "text";
  const singleImageModel = ["qwenedit", "mageflow", "mageflowedit"].includes(model.family);
  $("#batchSize").max = singleImageModel ? "1" : "4";
  if (singleImageModel) $("#batchSize").value = "1";
  $("#source-image-field").classList.toggle("hidden", !needsImage);
  $("#sourceImage").disabled = !needsImage;
  $("#sourceImage").required = needsImage;
  $("#source-image-label").textContent = mode === "reference" ? "Immagine di riferimento" : "Immagine iniziale";
  $("#source-image-copy").textContent = mode === "reference"
    ? "Carica l’immagine di riferimento"
    : "Carica l’immagine da modificare";
  const nativeInstructionEdit = ["flux2", "qwenedit", "mageflowedit"].includes(model.family);
  $("#denoise-field").classList.toggle("hidden", mode !== "image" || nativeInstructionEdit);
  $("#denoise").disabled = mode !== "image" || nativeInstructionEdit;
  $("#reference-strength-field").classList.toggle("hidden", mode !== "reference");
  $("#referenceStrength").disabled = mode !== "reference";
  $("#prompt-label").textContent = mode === "text" ? "Prompt positivo" : "Istruzione / prompt";
  $("#prompt").placeholder = mode === "text"
    ? "Descrivi soggetto, scena, stile, luce e composizione…"
    : "Descrivi la modifica o il risultato desiderato…";
  updateEnhancementOptions();
  refreshLoraOptions();
  updateImageSeriesOptions();
  updatePromptAssistantAvailability();
  syncCharacterFields();
}

function updateEnhancementOptions(enforceSafeBatch = false) {
  const image = isImageGeneration();
  const capabilities = state.config?.imageEnhancements || {};
  const highres = image && $("#highresEnabled").checked;
  const upscaleMode = image ? $("#upscaleMode").value : "none";
  const seedvr = upscaleMode === "seedvr2";
  const faceAvailable = Boolean(state.config?.upscaling?.detailers?.available);
  const face = image && faceAvailable && $("#faceEnhance").checked;
  const enhanced = highres || upscaleMode !== "none" || face;

  $("#image-enhancements").classList.toggle("hidden", !image);
  for (const input of document.querySelectorAll("#highres-settings input, #highres-settings select")) {
    input.disabled = !highres;
  }
  $("#seedvr-profile-field").classList.toggle("hidden", !seedvr);
  $("#seedvr-resolution-field").classList.toggle("hidden", !seedvr);
  $("#seedvrProfile").disabled = !seedvr;
  $("#seedvrResolution").disabled = !seedvr;
  $("#faceEnhance").disabled = !image || !faceAvailable;
  $("#face-strength-field").classList.toggle("hidden", !face);
  $("#faceStrength").disabled = !face;
  $("#autoPurge").disabled = !image || upscaleMode === "none";
  $("#saveOriginal").disabled = !image || !enhanced;

  const warnings = [];
  if (!capabilities.fastUpscale) warnings.push("RealESRGAN 2× non è installato.");
  if (!capabilities.seedvr2) warnings.push("SeedVR2 non è disponibile.");
  if (!faceAvailable) {
    warnings.push(
      "Face Detailer non disponibile: manca Impact Pack, SAM, il detector volto o il modello Flux di rifinitura.",
    );
  }
  if (!capabilities.phasePurge) warnings.push("VRAM Debug non è installato: purge tra generazione e upscale non disponibile.");
  $("#enhancement-warning").textContent = warnings.join(" ");
  $("#enhancement-warning").classList.toggle("hidden", warnings.length === 0);

  for (const option of $("#upscaleMode").options) {
    if (option.value === "fast") option.disabled = !capabilities.fastUpscale;
    if (option.value === "seedvr2") option.disabled = !capabilities.seedvr2;
  }
  if (($("#upscaleMode").selectedOptions[0]?.disabled)) {
    $("#upscaleMode").value = "none";
  }
  if (enforceSafeBatch && (highres || seedvr || face) && Number($("#batchSize").value) > 1) {
    $("#batchSize").value = "1";
    showToast("Numero immagini impostato a 1 per proteggere la VRAM");
  }
}

function generationTypeChanged(type) {
  const image = type === "image";
  const upscale = type === "upscale";
  const ltxUpscale = type === "ltxUpscale";
  const seedvr2VideoUpscale = type === "seedvr2VideoUpscale";
  const video = type === "video";

  $("#generationType").value = type;

  for (const button of document.querySelectorAll("[data-generation-type]")) {
    button.classList.toggle(
      "active",
      button.dataset.generationType === type,
    );
  }

  $("#video-workflow-field").classList.toggle("hidden", !video);

  if (!video) {
    $("#video-input-mode-field").classList.add("hidden");
    $("#video-model-field").classList.add("hidden");
    $("#sulphur-base-panel").classList.add("hidden");
  }

  $("#image-options").classList.toggle("hidden", !image);
  $("#upscale-options").classList.toggle("hidden", !upscale);
  $("#ltx-upscale-options").classList.toggle("hidden", !ltxUpscale);
  $("#seedvr2-video-upscale-options").classList.toggle("hidden", !seedvr2VideoUpscale);

  $("#character-field").classList.toggle(
    "hidden",
    upscale || ltxUpscale || seedvr2VideoUpscale,
  );

  $("#video-settings-grid").classList.toggle("hidden", !video);
  $("#image-settings-grid").classList.toggle("hidden", !image);
  $("#image-enhancements").classList.toggle("hidden", !image);

  $("#negative-prompt-field").classList.toggle(
    "hidden",
    upscale || ltxUpscale || seedvr2VideoUpscale,
  );

  $("#lora-settings").classList.toggle(
    "hidden",
    upscale || ltxUpscale || seedvr2VideoUpscale,
  );

  $("#negativePrompt").disabled = upscale || ltxUpscale || seedvr2VideoUpscale;

  workflow.disabled = !video;
  $("#videoInputMode").disabled = !video;
  $("#videoModelId").disabled = !video;

  $("#imageModelId").disabled = !image;
  $("#imageModelFile").disabled = !image;
  $("#imageMode").disabled = !image;

  $("#characterId").disabled = upscale || ltxUpscale || seedvr2VideoUpscale;

  $("#seed").disabled = !video;
  $("#imageSeed").disabled = !image;

  for (const input of document.querySelectorAll(
    "#image-settings-grid input, #image-settings-grid select",
  )) {
    input.disabled = !image;
  }

  for (const input of document.querySelectorAll(
    "#image-enhancements input, #image-enhancements select",
  )) {
    input.disabled = !image;
  }

  for (const input of document.querySelectorAll(
    "#upscale-options input, #upscale-options select",
  )) {
    input.disabled = !upscale;
  }

  for (const input of document.querySelectorAll(
    "#ltx-upscale-options input, " +
    "#ltx-upscale-options select, " +
    "#ltx-upscale-options textarea, " +
    "#ltx-upscale-options button",
  )) {
    input.disabled = !ltxUpscale;
  }

  for (const input of document.querySelectorAll(
    "#seedvr2-video-upscale-options input, " +
    "#seedvr2-video-upscale-options select, " +
    "#seedvr2-video-upscale-options textarea, " +
    "#seedvr2-video-upscale-options button",
  )) {
    input.disabled = !seedvr2VideoUpscale;
  }

  if (image) {
    $("#regular-scene-fields").classList.remove("hidden");

    $("#image-input-field").classList.add("hidden");
    $("#video-input-field").classList.add("hidden");

    $("#image").disabled = true;
    $("#video").disabled = true;

    $("#director-storyboard").classList.add("hidden");
    $("#edit-settings").classList.add("hidden");
    $("#quality-field").classList.add("hidden");

    $("#duration").disabled = true;
    $("#resolution").disabled = true;
    $("#orientation").disabled = true;

    $("#prompt").disabled = false;
    $("#prompt").required = true;

    $("#upscaleImage").required = false;
    $("#ltxUpscaleVideo").required = false;
    $("#seedvr2VideoUpscaleVideo").required = false;

    for (const input of document.querySelectorAll(
      "#director-storyboard input, " +
      "#director-storyboard textarea, " +
      "#edit-settings input, " +
      "#edit-settings select",
    )) {
      input.disabled = true;
    }

    imageOptionsChanged(true);
  } else if (video) {
    $("#regular-scene-fields").classList.remove("hidden");

    $("#source-image-field").classList.add("hidden");
    $("#sourceImage").disabled = true;

    $("#imageModelId").disabled = true;
    $("#imageModelFile").disabled = true;
    $("#imageMode").disabled = true;
    $("#imageSeed").disabled = true;

    $("#upscaleImage").required = false;
    $("#ltxUpscaleVideo").required = false;
    $("#seedvr2VideoUpscaleVideo").required = false;

    workflowChanged();
  } else if (upscale) {
    $("#regular-scene-fields").classList.add("hidden");

    $("#source-image-field").classList.add("hidden");
    $("#image-input-field").classList.add("hidden");
    $("#video-input-field").classList.add("hidden");

    $("#director-storyboard").classList.add("hidden");
    $("#edit-settings").classList.add("hidden");
    $("#quality-field").classList.add("hidden");

    $("#image").disabled = true;
    $("#video").disabled = true;
    $("#sourceImage").disabled = true;

    $("#prompt").disabled = true;
    $("#prompt").required = false;
    $("#negativePrompt").disabled = true;

    $("#upscaleImage").disabled = false;
    $("#upscaleImage").required = true;

    $("#ltxUpscaleVideo").required = false;
    $("#seedvr2VideoUpscaleVideo").required = false;

    for (const input of document.querySelectorAll(
      "#director-storyboard input, " +
      "#director-storyboard textarea, " +
      "#edit-settings input, " +
      "#edit-settings select",
    )) {
      input.disabled = true;
    }

    upscaleOptionsChanged();
  } else if (ltxUpscale) {
    $("#regular-scene-fields").classList.add("hidden");

    $("#source-image-field").classList.add("hidden");
    $("#image-input-field").classList.add("hidden");
    $("#video-input-field").classList.add("hidden");

    $("#director-storyboard").classList.add("hidden");
    $("#edit-settings").classList.add("hidden");
    $("#quality-field").classList.add("hidden");

    $("#image").disabled = true;
    $("#video").disabled = true;
    $("#sourceImage").disabled = true;

    $("#prompt").disabled = true;
    $("#prompt").required = false;
    $("#negativePrompt").disabled = true;

    $("#upscaleImage").disabled = true;
    $("#upscaleImage").required = false;

    $("#ltxUpscaleVideo").disabled = false;
    $("#ltxUpscaleVideo").required = true;
    $("#seedvr2VideoUpscaleVideo").disabled = true;
    $("#seedvr2VideoUpscaleVideo").required = false;

    const config = state.config?.ltxUpscale;

    $("#ltx-upscale-warning").textContent =
      config?.available === false
        ? [
            config.missingNodes?.length
              ? `Nodi mancanti: ${config.missingNodes.join(", ")}`
              : "",
            config.missingFiles?.length
              ? `File mancanti: ${config.missingFiles.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";

    $("#ltx-upscale-warning").classList.toggle(
      "hidden",
      config?.available !== false,
    );

    for (const input of document.querySelectorAll(
      "#director-storyboard input, " +
      "#director-storyboard textarea, " +
      "#edit-settings input, " +
      "#edit-settings select",
    )) {
      input.disabled = true;
    }
  } else if (seedvr2VideoUpscale) {
    $("#regular-scene-fields").classList.add("hidden");

    $("#source-image-field").classList.add("hidden");
    $("#image-input-field").classList.add("hidden");
    $("#video-input-field").classList.add("hidden");

    $("#director-storyboard").classList.add("hidden");
    $("#edit-settings").classList.add("hidden");
    $("#quality-field").classList.add("hidden");

    $("#image").disabled = true;
    $("#video").disabled = true;
    $("#sourceImage").disabled = true;

    $("#prompt").disabled = true;
    $("#prompt").required = false;
    $("#negativePrompt").disabled = true;

    $("#upscaleImage").disabled = true;
    $("#upscaleImage").required = false;

    $("#ltxUpscaleVideo").disabled = true;
    $("#ltxUpscaleVideo").required = false;

    $("#seedvr2VideoUpscaleVideo").disabled = false;
    $("#seedvr2VideoUpscaleVideo").required = true;

    const config = state.config?.seedvr2VideoUpscale;

    $("#seedvr2-video-upscale-warning").textContent =
      config?.available === false
        ? [
            config.missingNodes?.length
              ? `Nodi mancanti: ${config.missingNodes.join(", ")}`
              : "",
            config.missingFiles?.length
              ? `File mancanti: ${config.missingFiles.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join(" · ")
        : "";

    $("#seedvr2-video-upscale-warning").classList.toggle(
      "hidden",
      config?.available !== false,
    );

    for (const input of document.querySelectorAll(
      "#director-storyboard input, " +
      "#director-storyboard textarea, " +
      "#edit-settings input, " +
      "#edit-settings select",
    )) {
      input.disabled = true;
    }
  }

  $("#upscaleImage").required = upscale;
  $("#ltxUpscaleVideo").required = ltxUpscale;
  $("#seedvr2VideoUpscaleVideo").required = seedvr2VideoUpscale;

  $("#generate-button span").textContent = upscale
    ? "Avvia upscaling"
    : ltxUpscale
      ? "Avvia Upscale LTX"
      : seedvr2VideoUpscale
        ? "Avvia SeedVR2 Video"
        : "Avvia generazione";

  updateEnhancementOptions();
  refreshLoraOptions();
  updateImageSeriesOptions();
  updatePromptAssistantAvailability();
  updatePoseLibraryControls();
}

async function applyGuidedCreation() {
  const token = guidedTokenFromLocation();
  if (!token) return;
  const handoff = await consumeGuidedHandoff(token);
  if (!handoff?.payload?.fields) return;
  const { fields } = handoff.payload;
  const type = fields.generationType || "video";
  generationTypeChanged(type);

  if (type === "video") {
    if (fields.workflowId && state.config.workflows.some((item) => item.id === fields.workflowId)) {
      workflow.value = fields.workflowId;
    }
    workflowChanged();
    if (fields.videoInputMode && !$("#videoInputMode").disabled) {
      $("#videoInputMode").value = fields.videoInputMode;
      workflowChanged();
    }
    if (fields.engine === "sulphur" && state.config.workflows.some((entry) => entry.id === "ltxSulphur")) {
      workflow.value = "ltxSulphur";
      workflowChanged();
    }
    const quality = fields.quality === "speed" ? "preview" : "max";
    const qualityInput = document.querySelector(`[name="quality"][value="${quality}"]`);
    if (qualityInput) qualityInput.checked = true;
  } else if (type === "image") {
    if (fields.imageMode) $("#imageMode").value = fields.imageMode;
    const requestedFamily = fields.engine;
    if (requestedFamily && requestedFamily !== "auto") {
      const option = state.config.imageModels.find((model) => model.id === requestedFamily && model.available);
      if (option) $("#imageModelId").value = option.id;
    } else if (fields.imageMode !== "text") {
      const qwenEdit = state.config.imageModels.find((model) => model.id === "qwenEdit" && model.available);
      if (qwenEdit) $("#imageModelId").value = qwenEdit.id;
    }
    imageOptionsChanged(true);
    if (fields.quality === "max") {
      $("#highresEnabled").checked = true;
      if ([...$("#upscaleMode").options].some((option) => option.value === "seedvr2" && !option.disabled)) {
        $("#upscaleMode").value = "seedvr2";
      }
      updateEnhancementOptions(true);
    }
  } else {
    const preset = fields.quality || "quality";
    const presetInput = document.querySelector(`[name="upscalePreset"][value="${preset}"]`);
    if (presetInput) presetInput.checked = true;
    upscaleOptionsChanged();
  }

  const promptTarget = fields.workflowId === "director" ? $("#directorGlobalPrompt") : $("#prompt");
  if (promptTarget && fields.prompt) {
    promptTarget.value = fields.prompt;
    promptTarget.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (fields.workflowId === "director" && Array.isArray(fields.directorScenes)) {
    while (document.querySelectorAll(".scene-card").length < fields.directorScenes.length) {
      addStoryboardScene({ duration: fields.directorScenes[document.querySelectorAll(".scene-card").length]?.duration || 5 });
    }
    [...document.querySelectorAll(".scene-card")].forEach((card, index) => {
      const scene = fields.directorScenes[index];
      if (!scene) {
        card.remove();
        return;
      }
      card.querySelector("[data-scene-prompt]").value = scene.prompt || "";
      card.querySelector("[data-scene-duration]").value = Number(scene.duration) || 5;
      const file = handoff.files?.[`directorScene${index}`];
      if (file) setInputFile(card.querySelector('input[type="file"]'), file);
    });
    updateStoryboard();
  }
  for (const [name, file] of Object.entries(handoff.files || {})) {
    if (name.startsWith("directorScene")) continue;
    setInputFile(document.querySelector(`[name="${CSS.escape(name)}"]`), file);
  }
  history.replaceState({}, "", location.pathname);
  showToast("Configurazione della guida applicata. Controlla i dettagli e genera quando vuoi.");
}

function sceneCardTemplate(scene) {
  return `
    <article class="scene-card" data-scene-id="${scene.id}">
      <div class="scene-card-header">
        <div class="scene-title"><i>1</i><span>Scena 1</span><small class="scene-range">0–${scene.duration}s</small></div>
        <div class="scene-actions">
          <button type="button" data-scene-action="up" title="Sposta prima">↑</button>
          <button type="button" data-scene-action="down" title="Sposta dopo">↓</button>
          <button type="button" data-scene-action="remove" title="Rimuovi">×</button>
        </div>
      </div>
      <div class="scene-card-body">
        <label class="scene-image">
          <input type="file" name="sceneImage_${scene.id}" accept="image/png,image/jpeg,image/webp">
          <img alt="">
          <span class="scene-upload-copy"><b>＋</b>Foto guida<br>opzionale</span>
        </label>
        <div class="scene-fields">
          <textarea data-scene-prompt rows="4" placeholder="Azione, movimento camera, inquadratura e suono della scena…" required>${escapeHtml(scene.prompt || "")}</textarea>
          <div class="scene-meta">
            <div class="scene-duration">
              <label>Durata scena</label>
              <div class="input-suffix"><input data-scene-duration type="number" min="1" max="30" value="${scene.duration}" required><span>sec</span></div>
            </div>
            <div class="scene-hint">La foto viene inserita all’inizio di questa scena.</div>
          </div>
        </div>
      </div>
    </article>`;
}

function addStoryboardScene(values = {}) {
  const cards = document.querySelectorAll(".scene-card");
  if (cards.length >= 8) return showToast("Puoi inserire al massimo 8 scene");
  const id = `s${Date.now()}_${++state.sceneSerial}`;
  $("#storyboard-scenes").insertAdjacentHTML("beforeend", sceneCardTemplate({
    id,
    prompt: values.prompt || "",
    duration: Number(values.duration) || 4,
  }));
  setupUploadPreviews($("#storyboard-scenes"));
  updateStoryboard();
}

function storyboardData() {
  return [...document.querySelectorAll(".scene-card")].map((card) => ({
    id: card.dataset.sceneId,
    prompt: card.querySelector("[data-scene-prompt]").value.trim(),
    duration: Number(card.querySelector("[data-scene-duration]").value),
  }));
}

function storyboardAssistantData() {
  return [...document.querySelectorAll(".scene-card")].slice(0, 3).map((card) => {
    const fileInput = card.querySelector('input[type="file"]');
    return {
      id: card.dataset.sceneId,
      duration: Number(card.querySelector("[data-scene-duration]").value),
      promptInput: card.querySelector("[data-scene-prompt]"),
      file: fileInput?.files?.[0] || null,
    };
  });
}

function updateStoryboard() {
  const cards = [...document.querySelectorAll(".scene-card")];
  let cursor = 0;
  cards.forEach((card, index) => {
    const duration = Math.max(0, Number(card.querySelector("[data-scene-duration]").value) || 0);
    card.querySelector(".scene-title i").textContent = index + 1;
    card.querySelector(".scene-title span").textContent = `Scena ${index + 1}`;
    card.querySelector(".scene-range").textContent = `${cursor}–${cursor + duration}s`;
    card.querySelector('[data-scene-action="up"]').disabled = index === 0;
    card.querySelector('[data-scene-action="down"]').disabled = index === cards.length - 1;
    card.querySelector('[data-scene-action="remove"]').disabled = cards.length === 1;
    cursor += duration;
  });
  $("#storyboard-total").textContent = `${cursor}s`;
  $("#add-scene").disabled = cards.length >= 8 || cursor >= 60;
  $("#storyboard-total").style.color = cursor > 60 ? "var(--danger)" : "";
}

function setConnection(online) {
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
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function videoModeLabel(inputMode) {
  return {
    text: "Testo → Video",
    image: "Immagine → Video",
    video: "Video → Video",
  }[inputMode] || "";
}

function renderCurrent() {
  const active = state.history.find((item) => ["queued", "running"].includes(item.status));
  state.currentId = active?.id || null;
  $("#current-empty").classList.toggle("hidden", Boolean(active));
  const current = $("#current-job");
  current.classList.toggle("hidden", !active);
  if (!active) return;
  const dimensions = active.width && active.height
    ? `${active.width}×${active.height}`
    : active.resolution;
  const timing = active.mediaType === "image"
    ? `${active.batchSize || 1} ${active.batchSize === 1 ? "immagine" : "immagini"}`
    : `${active.duration}s`;
  const inputMode = videoModeLabel(active.inputMode);
  current.innerHTML = `
    <h3>${escapeHtml(active.workflowName)}</h3>
    <div class="job-meta">${inputMode ? `${escapeHtml(inputMode)} · ` : ""}${escapeHtml(dimensions)} · ${timing} · seed ${active.seed}</div>
    <div class="progress-row">
      <div class="progress-track"><i style="width:${active.progress || 2}%"></i></div>
      <b>${active.progress || 0}%</b>
    </div>
    <button class="stop-button" data-stop="${active.id}">Annulla generazione</button>
  `;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function renderHistory() {
  const container = $("#history");
  if (!container) {
    renderCurrent();
    renderSeriesResults();
    return;
  }
  $("#history-empty").classList.toggle("hidden", state.history.length > 0);
  container.innerHTML = state.history.map((item) => {
    const media = item.videos?.length
      ? `<video controls preload="metadata" playsinline src="/api/media/${item.id}/0"></video>
         <a class="download" href="/api/media/${item.id}/0?download=1" download>Download ↓</a>`
      : item.images?.length
        ? `<img src="${anchorImageUrl(item, 0)}" alt="${escapeHtml(item.seriesLabel || item.workflowName)}" loading="lazy">
           <div class="history-image-actions">
             <a class="download" href="${anchorImageUrl(item, 0)}?download=1" download>Download ↓</a>
             <button type="button" data-use-series-anchor="${item.id}" data-image-index="0">Usa come Series Anchor</button>
           </div>`
      : `<span class="status">${escapeHtml(statusLabel(item))}${item.status === "running" ? ` · ${item.progress || 0}%` : ""}</span>`;
    return `
      <article class="history-card">
        <div class="history-media">${media}</div>
        <div class="history-info">
          <h3 title="${escapeHtml(item.prompt)}">${escapeHtml(item.prompt || item.workflowName)}</h3>
          <p>${escapeHtml(item.workflowName)}${videoModeLabel(item.inputMode) ? ` · ${escapeHtml(videoModeLabel(item.inputMode))}` : ""}${item.sceneCount > 1 ? ` · ${item.sceneCount} scene` : ""} · ${item.resolution} · ${formatDate(item.createdAt)}</p>
        </div>
      </article>`;
  }).join("");
  renderCurrent();
  renderSeriesResults();
}

function latestSeriesItems(seriesId) {
  const byIndex = new Map();
  for (const item of state.history.filter((entry) => entry.seriesId === seriesId)) {
    const index = Number(item.seriesIndex || 0);
    const current = byIndex.get(index);
    if (!current || Number(item.seriesRevision || 0) > Number(current.seriesRevision || 0)
      || (Number(item.seriesRevision || 0) === Number(current.seriesRevision || 0)
        && new Date(item.createdAt) > new Date(current.createdAt))) {
      byIndex.set(index, item);
    }
  }
  return [...byIndex.values()].sort((a, b) => Number(a.seriesIndex) - Number(b.seriesIndex));
}

function renderSeriesResults() {
  const panel = $("#image-series-results");
  if (!panel) return;
  const availableIds = [...new Set(state.history.filter((item) => item.seriesId).map((item) => item.seriesId))];
  if (!state.activeSeriesId || !availableIds.includes(state.activeSeriesId)) state.activeSeriesId = availableIds[0] || null;
  const items = state.activeSeriesId ? latestSeriesItems(state.activeSeriesId) : [];
  panel.classList.toggle("hidden", items.length === 0);
  if (!items.length) return;
  const first = items[0];
  $("#image-series-results-heading").innerHTML = `
    <div><b>${first.seriesType === "samePlace" ? "Same Place Series" : "Random Influencer"}</b><span>${items.length}/${first.seriesCount || items.length} card · job ComfyUI indipendenti</span></div>
    <code>${escapeHtml(first.seriesId)}</code>`;
  const count = Number(first.seriesCount || items.length);
  $("#image-series-grid").className = `image-series-grid count-${count}`;
  $("#image-series-grid").innerHTML = items.map((item) => {
    const ready = item.status === "completed" && item.images?.length;
    const image = ready
      ? `<img src="${anchorImageUrl(item, 0)}" alt="${escapeHtml(item.seriesLabel)}" loading="lazy">`
      : `<div class="series-card-placeholder"><span>${escapeHtml(statusLabel(item))}</span><b>${item.progress || 0}%</b></div>`;
    return `
      <article class="image-series-card" data-series-generation="${item.id}">
        <div class="series-card-media">${image}<span>${Number(item.seriesIndex) + 1}</span></div>
        <div class="series-card-body">
          <div class="series-card-title"><b>${escapeHtml(item.seriesLabel || `Foto ${Number(item.seriesIndex) + 1}`)}</b><code>seed ${escapeHtml(item.seed)}</code></div>
          ${item.seriesVariation ? `<p>${escapeHtml(item.seriesVariation)}</p>` : ""}
          <textarea data-series-card-prompt rows="4">${escapeHtml(item.prompt || "")}</textarea>
          <div class="series-card-actions">
            ${ready ? `<a href="${anchorImageUrl(item, 0)}?download=1" download>Download</a>` : ""}
            <button type="button" data-regenerate-series="same" ${ready ? "" : "disabled"}>Rigenera · stesso seed</button>
            <button type="button" data-regenerate-series="new" ${ready ? "" : "disabled"}>Nuovo seed</button>
            <button type="button" data-use-series-anchor="${item.id}" data-image-index="0" ${ready ? "" : "disabled"}>Usa come nuova anchor</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

async function regenerateSeriesCard(button) {
  const card = button.closest("[data-series-generation]");
  const generationId = card.dataset.seriesGeneration;
  button.disabled = true;
  try {
    const item = await api(`/api/image-series/${encodeURIComponent(generationId)}/regenerate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seedMode: button.dataset.regenerateSeries,
        prompt: card.querySelector("[data-series-card-prompt]").value.trim(),
      }),
    });
    state.activeSeriesId = item.seriesId;
    state.history = [item, ...state.history];
    renderHistory();
    showToast(button.dataset.regenerateSeries === "same" ? "Card rigenerata con lo stesso seed" : "Variante accodata con un nuovo seed");
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

async function loadHistory() {
  const payload = await api("/api/generations?paged=1&limit=24&offset=0&archive=active");
  state.history = payload.items || [];
  renderHistory();
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
  renderCurrent();
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#form-error").textContent = "";
  const button = $("#generate-button");
  button.disabled = true;
  button.querySelector("span").textContent = "Invio a ComfyUI…";
  try {
    syncLoras();
    if (isImageGeneration() && imageSeriesMode() !== "off") {
      button.querySelector("span").textContent = "Creo i job della serie…";
      await submitImageSeries();
      return;
    }
    applyLoraTriggers($("#prompt"), selectedPromptTriggers());
    const data = new FormData(form);

    if (isLtxUpscaleGeneration()) {
      const config = state.config?.ltxUpscale;

      if (config?.available === false) {
        const details = [
          config.missingNodes?.length
            ? `Nodi mancanti: ${config.missingNodes.join(", ")}`
            : "",
          config.missingFiles?.length
            ? `File mancanti: ${config.missingFiles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

        throw new Error(
          details || "La pipeline Upscale LTX non è disponibile.",
        );
      }

      const sourceVideo = $("#ltxUpscaleVideo").files[0];

      if (!sourceVideo) {
        throw new Error(
          "Carica il video da elaborare con Upscale LTX.",
        );
      }

      if (
        state.config?.maxVideoUploadMb &&
        sourceVideo.size >
          state.config.maxVideoUploadMb * 1024 * 1024
      ) {
        throw new Error(
          `Il video supera il limite di ${state.config.maxVideoUploadMb} MB.`,
        );
      }

      /*
       * Il server usa già il campo multipart "video".
       * Rimuoviamo quindi il nome specifico della UI e riutilizziamo
       * il campo video accettato dalla route esistente.
       */
      data.delete("ltxUpscaleVideo");
      data.set("video", sourceVideo, sourceVideo.name);

      const sourceDuration = Number(
         $("#ltx-upscale-preview").dataset.duration,
       );

      if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
        data.set(
          "ltxUpscaleSourceDuration",
          String(sourceDuration),
        );
      }

      /*
       * Il builder usa i nomi generici prompt, negativePrompt e seed.
       */
      data.set(
        "prompt",
        $("#ltxUpscalePrompt").value.trim() || "upscale",
      );

      data.set(
        "negativePrompt",
        $("#ltxUpscaleNegativePrompt").value.trim(),
      );

      const ltxSeed = $("#ltxUpscaleSeed").value.trim();

      if (ltxSeed) {
        data.set("seed", ltxSeed);
      } else {
        data.delete("seed");
      }

      /*
       * Una checkbox non selezionata normalmente sparisce dal FormData.
       * La inviamo esplicitamente per permettere davvero di togliere
       * l'audio.
       */
      data.set(
        "ltxUpscaleKeepAudio",
        String($("#ltxUpscaleKeepAudio").checked),
      );
    }

    if (isSeedvr2VideoUpscaleGeneration()) {
      const config = state.config?.seedvr2VideoUpscale;

      if (config?.available === false) {
        const details = [
          config.missingNodes?.length
            ? `Nodi mancanti: ${config.missingNodes.join(", ")}`
            : "",
          config.missingFiles?.length
            ? `File mancanti: ${config.missingFiles.join(", ")}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");

        throw new Error(
          details || "La pipeline SeedVR2 Video Upscale non è disponibile.",
        );
      }

      const selectedProfile = config?.profiles?.find(
        (profile) => profile.id === $("#seedvr2VideoPreset").value,
      );

      if (selectedProfile && !selectedProfile.available) {
        throw new Error(
          `Il profilo SeedVR2 selezionato non è installato: ${selectedProfile.model}`,
        );
      }

      const sourceVideo = $("#seedvr2VideoUpscaleVideo").files[0];

      if (!sourceVideo) {
        throw new Error(
          "Carica il video da elaborare con SeedVR2 Video Upscale.",
        );
      }

      if (
        state.config?.maxVideoUploadMb &&
        sourceVideo.size >
          state.config.maxVideoUploadMb * 1024 * 1024
      ) {
        throw new Error(
          `Il video supera il limite di ${state.config.maxVideoUploadMb} MB.`,
        );
      }

      data.delete("seedvr2VideoUpscaleVideo");
      data.set("video", sourceVideo, sourceVideo.name);

      const sourceDuration = Number(
        $("#seedvr2-video-upscale-preview").dataset.duration,
      );

      if (Number.isFinite(sourceDuration) && sourceDuration > 0) {
        data.set(
          "seedvr2VideoSourceDuration",
          String(sourceDuration),
        );
      }

      const seedvr2Seed = $("#seedvr2VideoSeed").value.trim();

      if (seedvr2Seed) {
        data.set("seed", seedvr2Seed);
      } else {
        data.delete("seed");
      }

      data.set(
        "seedvr2VideoKeepAudio",
        String($("#seedvr2VideoKeepAudio").checked),
      );
    }

    if (!isImageGeneration() && workflow.value === "director") {
      const scenes = storyboardData();
      const total = scenes.reduce((sum, scene) => sum + scene.duration, 0);
      if (scenes.some((scene) => !scene.prompt)) throw new Error("Inserisci il prompt in ogni scena.");
      if (scenes.some((scene) => !Number.isInteger(scene.duration) || scene.duration < 1 || scene.duration > 30)) {
        throw new Error("Ogni scena deve durare da 1 a 30 secondi.");
      }
      if (total > 60) throw new Error("Lo storyboard non può superare 60 secondi.");
      data.set("storyboard", JSON.stringify(scenes));
    }
    if (!data.get("seed")) data.delete("seed");
    const item = await api("/api/generations", { method: "POST", body: data });
    state.history = [item, ...state.history.filter((entry) => entry.id !== item.id)];
    renderHistory();
    showToast("Generazione aggiunta alla coda");
  } catch (error) {
    $("#form-error").textContent = error.message;
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent =
      isUpscaleGeneration()
        ? "Avvia upscaling"
        : isLtxUpscaleGeneration()
          ? "Avvia Upscale LTX"
          : isSeedvr2VideoUpscaleGeneration()
            ? "Avvia SeedVR2 Video"
            : "Avvia generazione";
  }
});

document.addEventListener("click", async (event) => {
  const typeButton = event.target.closest("[data-generation-type]");
  if (typeButton) generationTypeChanged(typeButton.dataset.generationType);
  const anchorButton = event.target.closest("[data-use-series-anchor]");
  if (anchorButton && !anchorButton.disabled) {
    const item = state.history.find((entry) => entry.id === anchorButton.dataset.useSeriesAnchor);
    if (item) selectSeriesAnchor(item, Number(anchorButton.dataset.imageIndex || 0));
  }
  const clearAnchor = event.target.closest("[data-clear-series-anchor]");
  if (clearAnchor) clearSeriesAnchor();
  const regenerateCard = event.target.closest("[data-regenerate-series]");
  if (regenerateCard && !regenerateCard.disabled) regenerateSeriesCard(regenerateCard);
  const removeLora = event.target.closest("[data-remove-lora]");
  if (removeLora) {
    removeLora.closest(".lora-row").remove();
    syncLoras();
  }
  const sceneAction = event.target.closest("[data-scene-action]");
  if (sceneAction) {
    const card = sceneAction.closest(".scene-card");
    const action = sceneAction.dataset.sceneAction;
    if (action === "remove" && document.querySelectorAll(".scene-card").length > 1) card.remove();
    if (action === "up" && card.previousElementSibling) card.parentElement.insertBefore(card, card.previousElementSibling);
    if (action === "down" && card.nextElementSibling) card.parentElement.insertBefore(card.nextElementSibling, card);
    updateStoryboard();
  }
  const systemButton = event.target.closest("[data-system]");
  if (systemButton) {
    systemButton.disabled = true;
    $("#system-message").textContent = "Operazione in corso…";
    try {
      await api(`/api/system/${systemButton.dataset.system}`, { method: "POST" });
      $("#system-message").textContent = "Operazione completata.";
      showToast("Memoria ComfyUI liberata");
    } catch (error) {
      $("#system-message").textContent = error.message;
    } finally {
      systemButton.disabled = false;
    }
  }
  const stopButton = event.target.closest("[data-stop]");
  if (stopButton) {
    if (!confirm("Vuoi annullare questa generazione?")) return;
    stopButton.disabled = true;
    try {
      await api(`/api/generations/${stopButton.dataset.stop}/cancel`, { method: "POST" });
      await loadHistory();
      showToast("Generazione annullata");
    } catch (error) {
      stopButton.disabled = false;
      showToast(error.message);
    }
  }
});

$("#storyboard-scenes").addEventListener("input", updateStoryboard);
$("#lora-list").addEventListener("input", syncLoras);
$("#lora-list").addEventListener("change", syncLoras);
$("#storyboard-scenes").addEventListener("change", (event) => {
  if (event.target.type !== "file") return;
  const image = event.target.closest(".scene-image");
  const file = event.target.files[0];
  if (!file) {
    image.classList.remove("has-image");
    image.querySelector("img").removeAttribute("src");
    return;
  }
  image.querySelector("img").src = URL.createObjectURL(file);
  image.classList.add("has-image");
});

$("#image").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  $("#image-preview").src = URL.createObjectURL(file);
  $("#dropzone").classList.add("has-image");
});

$("#sourceImage").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const preview = $("#source-image-preview");
  if (!file) {
    $("#source-image-dropzone").classList.remove("has-image");
    preview.removeAttribute("src");
    return;
  }
  preview.src = URL.createObjectURL(file);
  $("#source-image-dropzone").classList.add("has-image");
});

$("#video").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const preview = $("#video-preview");
  if (!file) {
    $("#video-dropzone").classList.remove("has-video");
    preview.removeAttribute("src");
    $("#video-file-info").textContent = "";
    return;
  }
  preview.src = URL.createObjectURL(file);
  $("#video-dropzone").classList.add("has-video");
  $("#video-file-info").textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
});


function applyLtxUpscalePreset() {
  const preset = $("#ltxUpscalePreset").value;

  const values = {
    balanced: {
      steps: 12,
      distilledStrength: 0.6,
      loraStrength: 1,
      guideStrength: 1,
      crf: 13,
    },
    quality: {
      steps: 16,
      distilledStrength: 0.65,
      loraStrength: 1,
      guideStrength: 1,
      crf: 10,
    },
    max: {
      steps: 20,
      distilledStrength: 0.7,
      loraStrength: 1.05,
      guideStrength: 1,
      crf: 8,
    },
  }[preset];

  if (!values) return;

  $("#ltxUpscaleSteps").value = String(values.steps);
  $("#ltxUpscaleDistilledStrength").value =
    String(values.distilledStrength);
  $("#ltxUpscaleLoraStrength").value =
    String(values.loraStrength);
  $("#ltxUpscaleGuideStrength").value =
    String(values.guideStrength);
  $("#ltxUpscaleCrf").value = String(values.crf);
}

$("#ltxUpscalePreset").addEventListener(
  "change",
  applyLtxUpscalePreset,
);

$("#random-ltx-upscale-seed").addEventListener(
  "click",
  () => {
    $("#ltxUpscaleSeed").value = String(
      Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    );
  },
);

$("#ltxUpscaleVideo").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const preview = $("#ltx-upscale-preview");
  const dropzone = $("#ltx-upscale-dropzone");
  const info = $("#ltx-upscale-file-info");

  if (!file) {
    dropzone.classList.remove("has-video");
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    info.textContent = "";
    delete preview.dataset.duration;
    return;
  }

  const objectUrl = URL.createObjectURL(file);

  preview.src = objectUrl;
  dropzone.classList.add("has-video");

  const sizeMb = (file.size / 1024 / 1024).toFixed(1);

  info.textContent = `${file.name} · ${sizeMb} MB`;

  preview.onloadedmetadata = () => {
    const duration = Number.isFinite(preview.duration)
      ? preview.duration
      : 0;
      preview.dataset.duration = String(duration);

    const minutes = Math.floor(duration / 60);
    const seconds = Math.floor(duration % 60);
    const durationLabel = minutes
      ? `${minutes}:${String(seconds).padStart(2, "0")}`
      : `${seconds}s`;

    info.textContent =
      `${file.name} · ${sizeMb} MB · ${durationLabel}`;

    URL.revokeObjectURL(objectUrl);
  };

  preview.onerror = () => {
    info.textContent =
      `${file.name} · ${sizeMb} MB · anteprima non disponibile`;
  };
});

function applySeedvr2VideoPreset() {
  const preset = $("#seedvr2VideoPreset").value;

  const values = {
    preview: {
      resolution: "720",
      frameLoadCap: "121",
    },
    quality: {
      resolution: "1080",
      frameLoadCap: "121",
    },
    max: {
      resolution: "1440",
      frameLoadCap: "121",
    },
  }[preset];

  if (!values) return;

  $("#seedvr2VideoResolution").value = values.resolution;
  $("#seedvr2VideoFrameLoadCap").value = values.frameLoadCap;
}

$("#seedvr2VideoPreset").addEventListener(
  "change",
  applySeedvr2VideoPreset,
);

$("#random-seedvr2-video-seed").addEventListener(
  "click",
  () => {
    $("#seedvr2VideoSeed").value = String(
      Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    );
  },
);

$("#seedvr2VideoUpscaleVideo").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const preview = $("#seedvr2-video-upscale-preview");
  const dropzone = $("#seedvr2-video-upscale-dropzone");
  const info = $("#seedvr2-video-upscale-file-info");

  if (!file) {
    dropzone.classList.remove("has-video");
    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    info.textContent = "";
    delete preview.dataset.duration;
    return;
  }

  preview.src = URL.createObjectURL(file);
  dropzone.classList.add("has-video");

  const sizeMb = (file.size / 1024 / 1024).toFixed(1);
  info.textContent = `${file.name} · ${sizeMb} MB`;

  preview.onloadedmetadata = () => {
    const duration = Number.isFinite(preview.duration)
      ? preview.duration
      : 0;
    if (duration > 0) {
      preview.dataset.duration = String(duration);
      info.textContent = `${file.name} · ${sizeMb} MB · ${duration.toFixed(1)}s`;
    }
  };
});

$("#upscaleImage").addEventListener("change", (event) => {
  const file = event.target.files[0];
  const preview = $("#upscale-preview");
  if (!file) {
    $("#upscale-dropzone").classList.remove("has-image");
    preview.removeAttribute("src");
    return;
  }
  preview.src = URL.createObjectURL(file);
  preview.onload = () => {
    $("#upscaleSourceWidth").value = String(preview.naturalWidth || "");
    $("#upscaleSourceHeight").value = String(preview.naturalHeight || "");
  };
  $("#upscale-dropzone").classList.add("has-image");
});

for (const name of ["prompt", "negativePrompt"]) {
  $(`#${name}`).addEventListener("input", (event) => {
    $(`#${name === "prompt" ? "prompt" : "negative"}-count`).textContent = event.target.value.length;
  });
}

for (const eventName of ["dragenter", "dragover"]) {
  $("#dropzone").addEventListener(
    eventName,
    () => $("#dropzone").classList.add("dragging"),
  );

  $("#video-dropzone").addEventListener(
    eventName,
    () => $("#video-dropzone").classList.add("dragging"),
  );

  $("#source-image-dropzone").addEventListener(
    eventName,
    () => $("#source-image-dropzone").classList.add("dragging"),
  );

  $("#upscale-dropzone").addEventListener(
    eventName,
    () => $("#upscale-dropzone").classList.add("dragging"),
  );

  $("#ltx-upscale-dropzone").addEventListener(
    eventName,
    () => $("#ltx-upscale-dropzone").classList.add("dragging"),
  );
}
for (const eventName of ["dragleave", "drop"]) {
  $("#dropzone").addEventListener(
    eventName,
    () => $("#dropzone").classList.remove("dragging"),
  );

  $("#video-dropzone").addEventListener(
    eventName,
    () => $("#video-dropzone").classList.remove("dragging"),
  );

  $("#source-image-dropzone").addEventListener(
    eventName,
    () => $("#source-image-dropzone").classList.remove("dragging"),
  );

  $("#upscale-dropzone").addEventListener(
    eventName,
    () => $("#upscale-dropzone").classList.remove("dragging"),
  );

  $("#ltx-upscale-dropzone").addEventListener(
    eventName,
    () => $("#ltx-upscale-dropzone").classList.remove("dragging"),
  );
}

$("#random-seed").addEventListener("click", () => {
  $("#seed").value = String(Math.floor(Math.random() * 2_147_483_647));
});
$("#random-image-seed").addEventListener("click", () => {
  $("#imageSeed").value = String(Math.floor(Math.random() * 2_147_483_647));
});
$("#add-scene").addEventListener("click", () => addStoryboardScene());
$("#add-lora").addEventListener("click", () => addLora());
async function runImagePromptPreset(target, button, successMessage) {
  const context = promptAssistantContext();
  if (context.mode === "image" && !context.sourceFile) {
    $("#prompt-assistant-status").textContent = "Carica prima l’immagine che il modello deve analizzare.";
    $("#prompt-assistant-status").classList.add("prompt-assistant-error");
    return;
  }
  const triggers = selectedPromptTriggers();
  try {
    await enhanceMainPrompt({
      input: $("#prompt"),
      button,
      status: $("#prompt-assistant-status"),
      ...context,
      target,
      promptPreset: target.startsWith("qwen") ? $("#qwen-prompt-preset").value : $("#flux-prompt-preset").value,
      workflowName: `${context.workflowName} · ${target === "qwen_image_edit_architect" ? "Qwen Edit Prompt" : "Klein Prompt"}`,
      negativeInput: $("#negativePrompt"),
      includeNegative: isImageGeneration() && (context.mode !== "text" || target.includes("edit") || target.includes("klein")),
    });
    applyLoraTriggers($("#prompt"), triggers);
    showToast(`${successMessage}${triggers.length ? ` Trigger: ${triggers.join(", ")}.` : ""}`);
  } catch {
    // Il dettaglio resta visibile accanto al prompt.
  }
}

$("#qwen-edit-prompt-button").addEventListener("click", () => {
  const target = promptAssistantContext().target === "qwen" ? "qwen" : "qwen_image_edit_architect";
  runImagePromptPreset(
    target,
    $("#qwen-edit-prompt-button"),
    "Prompt Qwen Edit creato; clicca Genera quando vuoi."
  );
});

$("#klein-prompt-button").addEventListener("click", () => {
  runImagePromptPreset(
    "flux2_klein_architect",
    $("#klein-prompt-button"),
    "Prompt Klein creato; clicca Genera quando vuoi."
  );
});

const reversePromptDialog = $("#reverse-prompt-dialog");
const reversePromptImage = $("#reversePromptImage");

function updateReversePromptPreview() {
  const file = reversePromptImage.files[0];
  const preview = $("#reverse-prompt-preview");
  if (!file) {
    preview.removeAttribute("src");
    $("#reverse-prompt-dropzone").classList.remove("has-image");
    return;
  }
  preview.src = URL.createObjectURL(file);
  $("#reverse-prompt-dropzone").classList.add("has-image");
  $("#reverse-prompt-status").textContent = `${file.name} · scegli Qwen oppure Klein`;
  $("#reverse-prompt-status").classList.remove("prompt-assistant-error");
}

$("#reverse-prompt-button").addEventListener("click", () => {
  reversePromptDialog.showModal();
});

reversePromptImage.addEventListener("change", updateReversePromptPreview);

async function runReversePrompt(target, button) {
  const file = reversePromptImage.files[0];
  const status = $("#reverse-prompt-status");
  if (!file) {
    status.textContent = "Carica prima l’immagine da analizzare.";
    status.classList.add("prompt-assistant-error");
    return;
  }
  const triggers = selectedPromptTriggers();
  try {
    const payload = await enhanceMainPrompt({
      input: $("#prompt"),
      button,
      status,
      target,
      mode: "reverse",
      workflowName: target === "reverse_qwen" ? "Reverse Prompt · Qwen" : "Reverse Prompt · FLUX.2 Klein",
      sourceFile: file,
      text: "Transcribe every visible element literally and precisely into a generation prompt. Preserve the exact SFW or clearly-adult NSFW content without omissions, euphemisms, metaphors, moral commentary or invented details.",
    });
    if (!payload) return;
    applyLoraTriggers($("#prompt"), triggers);
    reversePromptDialog.close();
    showToast(target === "reverse_qwen"
      ? "Reverse Prompt Qwen inserito."
      : "Reverse Prompt Klein inserito.");
  } catch {
    // Il dettaglio resta nel dialog.
  }
}

$("#reverse-prompt-qwen").addEventListener("click", () =>
  runReversePrompt("reverse_qwen", $("#reverse-prompt-qwen")));
$("#reverse-prompt-klein").addEventListener("click", () =>
  runReversePrompt("reverse_klein", $("#reverse-prompt-klein")));

async function runLtxPromptPreset(target, button, successMessage) {
  const context = promptAssistantContext();
  if (context.mode === "image" && !context.sourceFile) {
    $("#prompt-assistant-status").textContent = "Carica prima l’immagine che il modello deve analizzare.";
    $("#prompt-assistant-status").classList.add("prompt-assistant-error");
    return;
  }
  const resolvedTarget = isSulphurPromptMode() && !target.startsWith("sulphur_")
    ? `sulphur_${target}`
    : target;
  const triggers = selectedPromptTriggers();
  try {
    await enhanceMainPrompt({
      input: $("#prompt"),
      button,
      status: $("#prompt-assistant-status"),
      ...context,
      target: resolvedTarget,
      promptPreset: $("#ltx-prompt-preset").value,
      workflowName: `${context.workflowName} · ${target === "sulphur_prompt" ? "LTX Sulphur" : target === "ltx_scenes" ? "Prompt a scene" : "Prompt Architect"}`,
      negativeInput: $("#negativePrompt"),
      includeNegative: true,
    });
    applyLoraTriggers($("#prompt"), triggers);
    showToast(`${successMessage}${triggers.length ? ` Trigger: ${triggers.join(", ")}.` : ""}`);
  } catch {
    // Il dettaglio resta visibile accanto al prompt.
  }
}

$("#ltx-architect-prompt-button").addEventListener("click", () => {
  runLtxPromptPreset(
    "ltx_architect",
    $("#ltx-architect-prompt-button"),
    "Prompt LTX 2.3 creato; clicca Genera video quando vuoi."
  );
});

$("#ltx-scene-prompt-button").addEventListener("click", () => {
  runLtxPromptPreset(
    "ltx_scenes",
    $("#ltx-scene-prompt-button"),
    "Prompt a scene creato; clicca Genera video quando vuoi."
  );
});

$("#sulphur-prompt-button").addEventListener("click", () => {
  runLtxPromptPreset(
    "sulphur_prompt",
    $("#sulphur-prompt-button"),
    "Prompt LTX Sulphur creato; clicca Genera video quando vuoi."
  );
});

$("#director-prompt-assistant-button").addEventListener("click", async () => {
  const cards = document.querySelectorAll(".scene-card");
  const status = $("#director-prompt-assistant-status");
  if (cards.length > 3) {
    status.textContent = "IA Director compila al massimo 3 scene: rimuovi o lascia manuali le scene successive.";
    status.classList.add("prompt-assistant-error");
    return;
  }
  try {
    await enhanceDirectorPrompts({
      globalInput: $("#directorGlobalPrompt"),
      scenes: storyboardAssistantData(),
      button: $("#director-prompt-assistant-button"),
      status,
    });
    updateStoryboard();
    showToast("Prompt Director compilati; clicca Genera quando vuoi.");
  } catch {
    // Il dettaglio resta visibile nel pannello Director.
  }
});
workflow.addEventListener("change", workflowChanged);
$("#videoInputMode").addEventListener("change", workflowChanged);
$("#videoModelId").addEventListener("change", () => {
  state.videoModelSelections[workflow.value] = $("#videoModelId").value;
  workflowChanged();
});
$("#imageMode").addEventListener("change", () => imageOptionsChanged());
$("#imageModelId").addEventListener("change", () => imageOptionsChanged(true));
$("#imageModelFile").addEventListener("change", () => imageOptionsChanged(true));
$("#imageSeriesMode").addEventListener("change", () => {
  if (imageSeriesMode() === "samePlace") applySamePlaceModel();
  updateImageSeriesOptions();
});
$("#seriesCharacterLora").addEventListener("change", () => {
  syncSeriesTrigger();
  updateImageSeriesOptions();
});
$("#influencerPromptMode").addEventListener("change", updateImageSeriesOptions);
$("#characterConsistency").addEventListener("change", updateImageSeriesOptions);
$("#samePlaceModel").addEventListener("change", () => {
  applySamePlaceModel();
  updateImageSeriesOptions();
});
$("#sceneLock").addEventListener("change", applySceneLockPreset);
$("#samePlaceAnchor").addEventListener("change", () => {
  if ($("#samePlaceAnchor").files[0]) state.seriesAnchor = null;
  updateImageSeriesOptions();
});
for (const input of document.querySelectorAll(".series-sliders input[type=range]")) {
  input.addEventListener("input", () => setRangeOutput(input));
}
$("#pose-library-random").addEventListener("click", insertTextualPose);
$("#characterId").addEventListener("change", () => {
  syncCharacterFields();
  if (isImageGeneration()) imageOptionsChanged();
  else workflowChanged();
});
$("#upscaleEngine").addEventListener("change", upscaleOptionsChanged);
$("#upscaleModel").addEventListener("change", upscaleOptionsChanged);
$("#upscaleFaceDetailer").addEventListener("change", upscaleOptionsChanged);
$("#upscaleEyeDetailer").addEventListener("change", upscaleOptionsChanged);
$("#upscaleHandDetailer").addEventListener("change", upscaleOptionsChanged);
$("#upscaleSkinDetailer").addEventListener("change", upscaleOptionsChanged);
$("#upscaleNsfwDetailer").addEventListener("change", upscaleOptionsChanged);
$("#highresEnabled").addEventListener("change", () => updateEnhancementOptions(true));
$("#upscaleMode").addEventListener("change", () => updateEnhancementOptions(true));
$("#faceEnhance").addEventListener("change", () => updateEnhancementOptions());
$("#batchSize").addEventListener("change", () => updateEnhancementOptions(true));

async function start() {
  const historyPromise = loadHistory().catch((error) => showToast(error.message));
  try {
    state.config = await getAppConfig();
    workflow.innerHTML = state.config.workflows.map((item) =>
      `<option value="${item.id}">${escapeHtml(item.name)}</option>`
    ).join("");
    $("#videoModelId").innerHTML = state.config.videoModels.map((model) =>
      `<option value="${escapeAttribute(model.id)}"${model.available ? "" : " disabled"}>${escapeHtml(model.shortName)}${model.available ? "" : " · non installato"}</option>`
    ).join("");
    $("#imageModelId").innerHTML = state.config.imageModels.map((item) =>
      `<option value="${item.id}">${escapeHtml(item.name)}${item.available ? "" : " · non installato"}</option>`
    ).join("");
    updatePoseLibraryControls();
    const seedProfiles = state.config.imageEnhancements?.seedvr2Profiles || [];
    $("#seedvrProfile").innerHTML = seedProfiles.map((profile) =>
      `<option value="${escapeAttribute(profile.id)}"${profile.available ? "" : " disabled"}>${escapeHtml(profile.name)}${profile.available ? "" : " · non installato"}</option>`
    ).join("");
    const preferredSeedProfile = seedProfiles.find((profile) => profile.id === "balanced" && profile.available)
      || seedProfiles.find((profile) => profile.available);
    if (preferredSeedProfile) $("#seedvrProfile").value = preferredSeedProfile.id;
    const upscaleConfig = state.config.upscaling || { engines: [], models: [] };
    $("#upscaleEngine").innerHTML = upscaleConfig.engines.map((engine) =>
      `<option value="${escapeAttribute(engine.id)}"${engine.available ? "" : " disabled"}>${escapeHtml(engine.name)}${engine.available ? "" : " · non disponibile"}</option>`
    ).join("");
    const preferredUpscaleEngine = upscaleConfig.engines.find((engine) => engine.id === "model" && engine.available)
      || upscaleConfig.engines.find((engine) => engine.available);
    if (preferredUpscaleEngine) $("#upscaleEngine").value = preferredUpscaleEngine.id;
    $("#upscaleModel").innerHTML = upscaleConfig.models.map((name) =>
      `<option value="${escapeAttribute(name)}">${escapeHtml(name)}</option>`
    ).join("");
    const preferredUpscaleModel = upscaleConfig.models.find((name) => name === "RealESRGAN_x2.pth")
      || upscaleConfig.models[0];
    if (preferredUpscaleModel) $("#upscaleModel").value = preferredUpscaleModel;
    const seedvr2VideoConfig = state.config.seedvr2VideoUpscale || { profiles: [] };
    if (seedvr2VideoConfig.profiles.length) {
      $("#seedvr2VideoPreset").innerHTML = seedvr2VideoConfig.profiles.map((profile) =>
        `<option value="${escapeAttribute(profile.id)}"${profile.available ? "" : " disabled"}>${escapeHtml(profile.name)}${profile.available ? "" : " · non installato"}</option>`
      ).join("");
      const preferredSeedvr2VideoPreset =
        seedvr2VideoConfig.profiles.find((profile) => profile.id === "quality" && profile.available)
        || seedvr2VideoConfig.profiles.find((profile) => profile.available);
      if (preferredSeedvr2VideoPreset) $("#seedvr2VideoPreset").value = preferredSeedvr2VideoPreset.id;
    }
    $("#video-upload-hint").textContent =
      `MP4, WebM, MOV, MKV o AVI · max ${state.config.maxVideoUploadMb} MB`;
    const characters = state.config.characters?.availableCharacters || [];
    $("#characterId").innerHTML = [
      `<option value="">Nessuna</option>`,
      ...characters.map((character) =>
        `<option value="${escapeAttribute(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`
      ),
    ].join("");
    applyLtxUpscalePreset();
    applySeedvr2VideoPreset();
    generationTypeChanged("video");
    setupUploadPreviews();
    await applyGuidedCreation();
    setupUploadPreviews();
    await Promise.all([checkHealth(), historyPromise]);
    connectEvents();
    createAdaptivePoller(checkHealth, { idleMs: 15_000, hiddenMs: 60_000 });
  } catch (error) {
    $("#form-error").textContent = error.message;
  }
}

start();
