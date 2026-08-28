import { loraMatchesFamily, loraOptionLabel } from "./lora-triggers.js?v=20260822-scalar-fix";
import { getAppConfig, warmAppConfig } from "./runtime-cache.js";

void warmAppConfig();

const mode = document.body.dataset.seriesPage === "samePlace" ? "samePlace" : "influencer";
const state = {
  config: null,
  generations: [],
  seriesId: null,
  anchorGeneration: null,
  pollTimer: null,
};
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 2800);
}

function clientSeriesId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const random = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(random);
  else for (let index = 0; index < random.length; index += 1) random[index] = Math.floor(Math.random() * 256);
  random[6] = (random[6] & 0x0f) | 0x40;
  random[8] = (random[8] & 0x3f) | 0x80;
  const hex = [...random].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function seriesMarkup() {
  const influencer = mode === "influencer";
  return `
    <div class="series-focus-layout">
      <form id="series-form" class="panel series-focus-form">
        <div class="section-heading"><span>01</span><div><h2>${influencer ? "Nuova serie Influencer" : "Nuova Same Place Series"}</h2><p>Un solo workflow, senza impostazioni estranee</p></div></div>
        <div class="field-grid">
          <div class="field"><label for="seriesModelId">Motore</label><select id="seriesModelId"></select></div>
          <div class="field"><label for="seriesModelFile">Modello installato</label><select id="seriesModelFile"></select></div>
          <div class="field"><label for="seriesCount">Numero immagini</label><select id="seriesCount">${(influencer ? [1, 2, 4, 6, 9] : [2, 4, 6, 8]).map((count) => `<option value="${count}"${count === 2 ? " selected" : ""}>${count}</option>`).join("")}</select></div>
          <div class="field"><label for="seriesResolution">Formato</label><select id="seriesResolution"><option value="portrait" selected>Ritratto · 896×1152</option><option value="square">Quadrato · 1024×1024</option><option value="vertical">Verticale · 768×1344</option><option value="landscape">Orizzontale · 1152×896</option></select></div>
        </div>

        <section class="series-options standalone-series-options">
          <div class="series-heading"><div><p class="eyebrow">IDENTITÀ E STILE</p><h3>LoRA e consistenza</h3></div><span id="modelStatus"></span></div>
          <div class="field-grid">
            <div class="field"><label for="characterLora">Character / Style LoRA</label><select id="characterLora"></select></div>
            <div class="field"><label for="loraStrength">LoRA weight</label><input id="loraStrength" type="number" min="-10" max="10" step="0.05" value="0.8"></div>
            <div class="field"><label for="characterTrigger">Trigger word</label><input id="characterTrigger" type="text" placeholder="Nessuna trigger dichiarata"></div>
            <div class="field"><label for="characterConsistency">Character Consistency</label><select id="characterConsistency"><option value="lora">Character LoRA</option><option value="off">Off</option><option value="pulid">PuLID Reference</option><option value="loraPulid">LoRA + PuLID</option></select></div>
          </div>
          <p id="triggerStatus" class="hint"></p>
          <div id="pulidFields" class="pulid-focus-fields hidden">
            <div class="field"><label for="pulidStrength">PuLID strength</label><input id="pulidStrength" type="number" min="0" max="2" step="0.05" value="1.4"></div>
            <label class="dropzone compact-dropzone"><input id="pulidReference" type="file" accept="image/png,image/jpeg,image/webp"><img id="pulid-reference-preview" alt=""><span class="upload-icon">↗</span><strong>Reference volto PuLID</strong><small>${influencer ? "Obbligatoria per PuLID" : "Se vuota, usa la stessa anchor"}</small></label>
          </div>
          <p id="pulidStatus" class="hint"></p>
        </section>

        ${influencer ? `
          <section class="series-options standalone-series-options">
            <div class="series-heading"><div><p class="eyebrow">RANDOM INFLUENCER</p><h3>Scene social amatoriali</h3></div><span>Prompt e seed indipendenti</span></div>
            <div class="field-grid">
              <div class="field"><label for="promptMode">Modalità prompt</label><select id="promptMode"><option value="random">Random Influencer</option><option value="manual">Idea manuale + variazioni</option></select></div>
              <div class="field"><label for="seedMode">Seed</label><select id="seedMode"><option value="random">Random indipendenti</option><option value="fixed">Derivati dal seed</option></select></div>
              <div class="field"><label for="seriesSeed">Seed base</label><input id="seriesSeed" inputmode="numeric" placeholder="Random"></div>
            </div>
            <div class="field"><label for="manualPrompt">Idea manuale <span class="optional">usata solo in modalità manuale</span></label><textarea id="manualPrompt" rows="5">amateur smartphone selfie of an adult woman, natural everyday appearance, casual home setting, imperfect arm's-length framing, realistic skin texture, available daylight, unfiltered social media photo</textarea></div>
          </section>` : `
          <section class="series-options standalone-series-options">
            <div class="series-heading"><div><p class="eyebrow">ANCHOR ORIGINALE</p><h3>Stessa scena, nuove micro-variazioni</h3></div><span>Qwen Edit o Flux.2 Klein</span></div>
            <div class="same-place-anchor-grid">
              <label id="anchorDropzone" class="dropzone compact-dropzone"><input id="anchorImage" type="file" accept="image/png,image/jpeg,image/webp"><img id="anchorPreview" alt=""><span class="upload-icon">↗</span><strong>Carica Anchor Image</strong><small>Oppure arriva da Random Influencer</small></label>
              <div id="selectedAnchor" class="selected-series-anchor"><span>Nessuna anchor selezionata</span></div>
            </div>
            <div class="field-grid"><div class="field"><label for="seedMode">Seed</label><select id="seedMode"><option value="random">Random indipendenti</option><option value="fixed">Derivati dal seed</option><option value="anchor">Derivati dalla anchor</option></select></div><div class="field"><label for="seriesSeed">Seed base</label><input id="seriesSeed" inputmode="numeric" placeholder="Random"></div><div class="field"><label for="sceneLock">Scene Lock</label><select id="sceneLock"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div></div>
            <div class="series-sliders"><label>Preserva luogo <output for="preserveLocation">95</output><input id="preserveLocation" type="range" min="0" max="100" value="95"></label><label>Preserva outfit <output for="preserveOutfit">95</output><input id="preserveOutfit" type="range" min="0" max="100" value="95"></label><label>Preserva luce <output for="preserveLighting">95</output><input id="preserveLighting" type="range" min="0" max="100" value="95"></label><label>Preserva framing <output for="preserveFraming">72</output><input id="preserveFraming" type="range" min="0" max="100" value="72"></label><label>Forza variazione <output for="variationStrength">42</output><input id="variationStrength" type="range" min="0" max="100" value="42"></label></div>
            <div class="series-toggles"><label><input id="allowPoseChanges" type="checkbox" checked><span>Pose</span></label><label><input id="allowExpressionChanges" type="checkbox" checked><span>Espressioni</span></label><label><input id="allowSmallAngleChanges" type="checkbox" checked><span>Inquadratura</span></label><label><input id="allowHandReposition" type="checkbox" checked><span>Mani</span></label><label><input id="allowGazeChanges" type="checkbox" checked><span>Sguardo</span></label></div>
          </section>`}

        <details class="advanced-settings"><summary>Sampling <span>Parametri del modello selezionato</span></summary><div class="advanced-settings-body"><div class="field-grid"><div class="field"><label for="imageSteps">Steps</label><input id="imageSteps" type="number" min="1" max="50"></div><div class="field"><label for="imageGuidance">Guidance / CFG</label><input id="imageGuidance" type="number" min="0" max="20" step="0.1"></div></div></div></details>
        <button id="seriesSubmit" class="generate-button" type="submit"><span>${influencer ? "Genera serie Influencer" : "Genera Same Place Series"}</span><b>→</b></button>
        <p id="seriesError" class="form-error" role="alert"></p>
      </form>
      <aside class="panel series-focus-summary"><div class="section-heading compact"><span>02</span><div><h2>Workflow</h2><p>Riepilogo operativo</p></div></div><div id="workflowSummary" class="series-workflow-summary"></div></aside>
    </div>
    <section id="seriesResults" class="panel image-series-results hidden"><div class="section-heading compact"><span>03</span><div><h2>Risultati</h2><p>Ogni card è un job ComfyUI indipendente</p></div></div><div id="seriesResultsHeading" class="series-results-heading"></div><div id="seriesGrid" class="image-series-grid"></div></section>`;
}

function selectedModel() {
  return state.config.imageModels.find((item) => item.id === $("#seriesModelId").value);
}

function selectedModelVariant() {
  return selectedModel()?.models?.find((item) => item.file === $("#seriesModelFile").value);
}

function preferredModelFile(model) {
  if (model.id === "qwenImage") return model.models.find((item) => /qwen_image_2512/i.test(item.file))?.file;
  if (model.id === "qwenEdit") return model.models.find((item) => /qwen_image_edit_2511/i.test(item.file))?.file;
  return model.models.find((item) => /pornmaster.*flux2.*klein.*v4.*turbo/i.test(item.file))?.file;
}

function compatibleLoras() {
  const family = selectedModel()?.family === "flux2" ? "FLUX2" : "QWEN";
  return state.config.loras.filter((name) => loraMatchesFamily(name, family, state.config.loraMetadata));
}

function preferredLora() {
  const names = compatibleLoras();
  return selectedModel()?.family === "flux2"
    ? names.find((name) => /STY_1nfl43nc3r\.safetensors$/i.test(name)) || names.find((name) => /influencer/i.test(name)) || ""
    : names.find((name) => /influencer2\.safetensors$/i.test(name)) || "";
}

function updateLoraFields(reset = false) {
  const select = $("#characterLora");
  const previous = reset ? preferredLora() : select.value;
  select.innerHTML = ['<option value="">Nessuna LoRA</option>', ...compatibleLoras().map((name) => `<option value="${escapeAttribute(name)}">${escapeHtml(loraOptionLabel(name, state.config.loraMetadata))}</option>`)].join("");
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  const metadata = state.config.loraMetadata?.[select.value] || {};
  const triggers = metadata.triggers || metadata.trigger || [];
  const values = (Array.isArray(triggers) ? triggers : [triggers]).filter(Boolean);
  $("#characterTrigger").value = values.join(", ");
  if (reset) $("#loraStrength").value = metadata.recommendedStrength || (selectedModel()?.family === "flux2" ? 0.8 : 0.8);
  $("#triggerStatus").textContent = values.length
    ? `Trigger automatica verificata: ${values.join(", ")}`
    : select.value ? "Questa versione non dichiara activation token: il soggetto e lo stile vanno descritti nel prompt." : "Nessuna LoRA selezionata.";
}

function updateModel(resetLora = true) {
  const model = selectedModel();
  const preferred = preferredModelFile(model) || model.defaultModelFile || model.models[0]?.file;
  $("#seriesModelFile").innerHTML = model.models.map((item) => `<option value="${escapeAttribute(item.file)}">${escapeHtml(item.name)}</option>`).join("");
  if (preferred) $("#seriesModelFile").value = preferred;
  updateSampling();
  updateLoraFields(resetLora);
  updateConsistency();
}

function updateSampling() {
  const variant = selectedModelVariant();
  if (!variant) return;
  $("#imageSteps").value = variant.defaults.steps;
  $("#imageGuidance").value = variant.defaults.guidance;
  updateSummary();
}

function updateConsistency() {
  const flux = selectedModel()?.family === "flux2";
  const capability = state.config.imageSeries?.pulidFlux2 || {};
  for (const option of $("#characterConsistency").options) {
    if (["pulid", "loraPulid"].includes(option.value)) option.disabled = !flux || !capability.available;
  }
  if ($("#characterConsistency").selectedOptions[0]?.disabled) $("#characterConsistency").value = $("#characterLora").value ? "lora" : "off";
  const pulid = ["pulid", "loraPulid"].includes($("#characterConsistency").value);
  $("#pulidFields").classList.toggle("hidden", !pulid);
  $("#pulidStatus").textContent = flux
    ? capability.available ? "PuLID Flux.2 disponibile con InsightFace CUDA e peso Klein v2." : capability.reason
    : "PuLID non viene applicato ai modelli Qwen.";
  updateSummary();
}

function updateSummary() {
  const summary = $("#workflowSummary");
  if (!summary || !selectedModel()) return;
  summary.innerHTML = `<dl><div><dt>Serie</dt><dd>${mode === "influencer" ? "Random Influencer" : "Same Place"}</dd></div><div><dt>Motore</dt><dd>${escapeHtml(selectedModel().name)}</dd></div><div><dt>Checkpoint</dt><dd>${escapeHtml(selectedModelVariant()?.name || "—")}</dd></div><div><dt>LoRA</dt><dd>${escapeHtml($("#characterLora")?.value || "Nessuna")}</dd></div><div><dt>Consistenza</dt><dd>${escapeHtml($("#characterConsistency")?.selectedOptions[0]?.textContent || "—")}</dd></div><div><dt>Output</dt><dd>${escapeHtml($("#seriesCount")?.value || "2")} job indipendenti</dd></div></dl>`;
}

function anchorUrl(item, index = 0) {
  return `/api/image/${encodeURIComponent(item.id)}/${index}`;
}

async function anchorFile() {
  const upload = $("#anchorImage")?.files[0];
  if (upload) return upload;
  if (!state.anchorGeneration) return null;
  const response = await fetch(anchorUrl(state.anchorGeneration));
  if (!response.ok) throw new Error("Impossibile recuperare l’anchor scelta.");
  const blob = await response.blob();
  return new File([blob], `anchor-${state.anchorGeneration.id}.png`, { type: blob.type || "image/png" });
}

function renderAnchor() {
  if (mode !== "samePlace") return;
  if (!state.anchorGeneration) {
    $("#selectedAnchor").innerHTML = "<span>Nessuna anchor selezionata</span>";
    return;
  }
  $("#anchorPreview").src = anchorUrl(state.anchorGeneration);
  $("#anchorDropzone").classList.add("has-image");
  $("#selectedAnchor").innerHTML = `<img src="${anchorUrl(state.anchorGeneration)}" alt="Anchor selezionata"><div><b>Anchor dalla cronologia</b><span>${escapeHtml(state.anchorGeneration.workflowName)} · seed ${escapeHtml(state.anchorGeneration.seed)}</span></div><button type="button" id="clearAnchor" aria-label="Rimuovi anchor">×</button>`;
  $("#clearAnchor").addEventListener("click", () => { state.anchorGeneration = null; $("#anchorPreview").removeAttribute("src"); $("#anchorDropzone").classList.remove("has-image"); renderAnchor(); });
}

async function requestPlan(anchor) {
  const seed = $("#seriesSeed").value.trim();
  if (mode === "influencer") {
    return api("/api/image-series/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "influencer", characterTrigger: $("#characterTrigger").value.trim(), count: Number($("#seriesCount").value), promptMode: $("#promptMode").value, manualPrompt: $("#manualPrompt").value.trim(), seedMode: $("#seedMode").value, seed }) });
  }
  const anchorSeed = state.anchorGeneration?.seed;
  const requestedSeedMode = $("#seedMode").value;
  const seedMode = requestedSeedMode === "anchor" && !anchorSeed ? "fixed" : requestedSeedMode;
  return api("/api/image-series/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "samePlace", count: Number($("#seriesCount").value), anchorContext: { subjectIdentity: $("#characterTrigger").value.trim(), environmentSummary: state.anchorGeneration?.prompt || "the exact scene, background, outfit and lighting visible in the anchor", outfitSummary: "the same outfit visible in the anchor", lightingSummary: "the same available light", framingSummary: "amateur smartphone selfie framing" }, seedMode, seed: seed || String(Math.floor(Math.random() * 2147483647)), anchorSeed, preserveLocation: Number($("#preserveLocation").value), preserveOutfit: Number($("#preserveOutfit").value), preserveLighting: Number($("#preserveLighting").value), preserveFraming: Number($("#preserveFraming").value), variationStrength: Number($("#variationStrength").value), allowPoseChanges: $("#allowPoseChanges").checked, allowExpressionChanges: $("#allowExpressionChanges").checked, allowSmallAngleChanges: $("#allowSmallAngleChanges").checked, allowHandReposition: $("#allowHandReposition").checked, allowGazeChanges: $("#allowGazeChanges").checked }) });
}

function lorasForSubmit() {
  if (!["lora", "loraPulid"].includes($("#characterConsistency").value) || !$("#characterLora").value) return [];
  return [{ name: $("#characterLora").value, strength: Number($("#loraStrength").value) }];
}

async function submitSeries(event) {
  event.preventDefault();
  const button = $("#seriesSubmit");
  $("#seriesError").textContent = "";
  button.disabled = true;
  try {
    const consistency = $("#characterConsistency").value;
    if (["lora", "loraPulid"].includes(consistency) && !$("#characterLora").value) throw new Error("Seleziona una LoRA oppure disattiva la consistenza LoRA.");
    let anchor = null;
    if (mode === "samePlace") {
      anchor = await anchorFile();
      if (!anchor) throw new Error("Carica o seleziona un’anchor originale.");
    }
    let pulidReference = $("#pulidReference").files[0] || null;
    if (["pulid", "loraPulid"].includes(consistency) && !pulidReference) pulidReference = anchor;
    if (["pulid", "loraPulid"].includes(consistency) && !pulidReference) throw new Error("Carica una reference volto per PuLID.");
    const plan = await requestPlan(anchor);
    state.seriesId = clientSeriesId();
    state.generations = [];
    renderResults();
    for (const item of plan.items) {
      button.querySelector("span").textContent = `Accodo ${item.index + 1}/${plan.count}…`;
      const data = new FormData();
      data.set("generationType", "image");
      data.set("imageModelId", $("#seriesModelId").value);
      data.set("imageModelFile", $("#seriesModelFile").value);
      data.set("imageMode", mode === "samePlace" ? "image" : "text");
      data.set("prompt", item.prompt);
      data.set("negativePrompt", "professional studio photo, advertising campaign, beauty filter, plastic skin, overprocessed, distorted hands, distorted face, duplicate person");
      data.set("imageResolution", $("#seriesResolution").value);
      data.set("imageSteps", $("#imageSteps").value);
      data.set("imageGuidance", $("#imageGuidance").value);
      data.set("seed", String(item.seed));
      data.set("batchSize", "1");
      data.set("loras", JSON.stringify(lorasForSubmit()));
      data.set("seriesId", state.seriesId);
      data.set("seriesType", mode);
      data.set("seriesIndex", String(item.index));
      data.set("seriesCount", String(plan.count));
      data.set("seriesLabel", item.label);
      data.set("seriesVariation", item.variation || "");
      data.set("seriesSeedMode", $("#seedMode").value);
      data.set("seriesRevision", "0");
      data.set("anchorGenerationId", state.anchorGeneration?.id || "");
      data.set("anchorImageIndex", state.anchorGeneration ? "0" : "");
      data.set("anchorContext", JSON.stringify({ environmentSummary: state.anchorGeneration?.prompt || "", framingSummary: "amateur smartphone selfie" }));
      data.set("sceneLock", mode === "samePlace" ? $("#sceneLock").value : "");
      data.set("characterLora", $("#characterLora").value);
      data.set("characterLoraStrength", $("#loraStrength").value);
      data.set("characterTrigger", $("#characterTrigger").value.trim());
      data.set("characterConsistency", consistency);
      data.set("pulidStrength", $("#pulidStrength").value);
      data.set("upscaleMode", "none");
      data.set("imageRecipe", "standard");
      if (anchor) data.set("sourceImage", anchor, anchor.name);
      if (pulidReference) data.set("pulidReference", pulidReference, pulidReference.name);
      const generation = await api("/api/generations", { method: "POST", body: data });
      state.generations.push(generation);
      renderResults();
    }
    toast(`${plan.count} job indipendenti aggiunti alla coda`);
    schedulePoll(1500);
  } catch (error) {
    $("#seriesError").textContent = error.message;
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = mode === "influencer" ? "Genera serie Influencer" : "Genera Same Place Series";
  }
}

function statusLabel(item) {
  return ({ queued: "In coda", running: "In esecuzione", completed: "Completata", error: "Errore", cancelled: "Annullata" })[item.status] || item.status;
}

function renderResults() {
  const panel = $("#seriesResults");
  panel.classList.toggle("hidden", state.generations.length === 0);
  if (!state.generations.length) return;
  $("#seriesResultsHeading").innerHTML = `<div><b>${mode === "influencer" ? "Random Influencer" : "Same Place Series"}</b><span>${state.generations.length} card · serie ${escapeHtml(state.seriesId)}</span></div>`;
  $("#seriesGrid").className = `image-series-grid count-${state.generations.length}`;
  $("#seriesGrid").innerHTML = state.generations.map((item) => {
    const ready = item.status === "completed" && item.images?.length;
    return `<article class="image-series-card" data-generation-id="${item.id}"><div class="series-card-media">${ready ? `<img src="${anchorUrl(item)}" alt="${escapeAttribute(item.seriesLabel)}" loading="lazy">` : `<div class="series-card-placeholder"><span>${escapeHtml(statusLabel(item))}</span><b>${item.progress || 0}%</b></div>`}<span>${Number(item.seriesIndex) + 1}</span></div><div class="series-card-body"><div class="series-card-title"><b>${escapeHtml(item.seriesLabel)}</b><code>seed ${escapeHtml(item.seed)}</code></div>${item.seriesVariation ? `<p>${escapeHtml(item.seriesVariation)}</p>` : ""}<textarea data-card-prompt rows="4">${escapeHtml(item.prompt || "")}</textarea><div class="series-card-actions">${ready ? `<a href="${anchorUrl(item)}?download=1" download>Download</a>` : ""}<button type="button" data-regenerate="same" ${ready ? "" : "disabled"}>Rigenera</button><button type="button" data-regenerate="new" ${ready ? "" : "disabled"}>Nuovo seed</button>${ready ? `<a class="series-anchor-link" href="/same-place.html?anchorGenerationId=${encodeURIComponent(item.id)}">Usa in Same Place</a>` : ""}</div>${item.error ? `<p class="form-error">${escapeHtml(item.error)}</p>` : ""}</div></article>`;
  }).join("");
}

async function refreshGenerations() {
  state.generations = await Promise.all(state.generations.map((item) => api(`/api/generations/${encodeURIComponent(item.id)}`).catch(() => item)));
  renderResults();
  if (state.generations.some((item) => ["queued", "running"].includes(item.status))) schedulePoll(3000);
}

function schedulePoll(delay) {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(refreshGenerations, delay);
}

async function regenerate(button) {
  const card = button.closest("[data-generation-id]");
  button.disabled = true;
  try {
    const generation = await api(`/api/image-series/${encodeURIComponent(card.dataset.generationId)}/regenerate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seedMode: button.dataset.regenerate, prompt: card.querySelector("[data-card-prompt]").value.trim() }) });
    const index = state.generations.findIndex((item) => Number(item.seriesIndex) === Number(generation.seriesIndex));
    if (index >= 0) state.generations[index] = generation;
    renderResults();
    schedulePoll(1500);
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
}

function bindEvents() {
  $("#series-form").addEventListener("submit", submitSeries);
  $("#seriesModelId").addEventListener("change", () => updateModel(true));
  $("#seriesModelFile").addEventListener("change", updateSampling);
  $("#characterLora").addEventListener("change", () => { updateLoraFields(false); updateSummary(); });
  $("#characterConsistency").addEventListener("change", updateConsistency);
  $("#seriesCount").addEventListener("change", updateSummary);
  $("#seriesGrid").addEventListener("click", (event) => { const button = event.target.closest("[data-regenerate]"); if (button && !button.disabled) regenerate(button); });
  if (mode === "samePlace") {
    $("#anchorImage").addEventListener("change", () => { if ($("#anchorImage").files[0]) { state.anchorGeneration = null; $("#anchorPreview").src = URL.createObjectURL($("#anchorImage").files[0]); $("#anchorDropzone").classList.add("has-image"); renderAnchor(); } });
    for (const input of document.querySelectorAll(".series-sliders input")) input.addEventListener("input", () => { document.querySelector(`output[for=\"${input.id}\"]`).value = input.value; });
  }
}

async function loadAnchorFromQuery() {
  if (mode !== "samePlace") return;
  const id = new URLSearchParams(location.search).get("anchorGenerationId");
  if (!id) return;
  const generation = await api(`/api/generations/${encodeURIComponent(id)}`);
  if (generation.status !== "completed" || !generation.images?.length) throw new Error("La generazione scelta non contiene un’immagine completata.");
  state.anchorGeneration = generation;
  renderAnchor();
}

async function start() {
  $("#series-app").innerHTML = seriesMarkup();
  try {
    state.config = await getAppConfig();
    const ids = mode === "influencer" ? ["qwenImage", "flux2"] : ["qwenEdit", "flux2"];
    const models = state.config.imageModels.filter((item) => ids.includes(item.id) && item.available);
    $("#seriesModelId").innerHTML = models.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("");
    $("#seriesModelId").value = mode === "influencer" ? "qwenImage" : "qwenEdit";
    updateModel(true);
    bindEvents();
    await loadAnchorFromQuery();
    $("#connection").className = "connection online";
    $("#connection").innerHTML = "<span></span>ComfyUI online";
  } catch (error) {
    $("#seriesError").textContent = error.message;
    $("#connection").className = "connection offline";
    $("#connection").innerHTML = "<span></span>Errore";
  }
}

start();
