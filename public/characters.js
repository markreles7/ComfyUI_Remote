import { setupUploadPreviews } from "./upload-previews.js";

const state = {
  characters: [],
  selectedId: null,
  genesisCandidates: [],
  genesisPollTimer: null,
  referenceGenerations: new Map(),
  referencePollTimer: null,
  referenceCharacterId: null,
  photoPlan: null,
  photoConfig: null,
  photoSetRunning: false,
  photoSetPreparing: false,
  photoSetPreparation: null,
  referenceConfig: null,
  referenceEngineSelections: new Map(),
  photoCharacterId: null,
  photoGenerationId: null,
  photoPipelineTimer: null,
  videoConfig: null,
  videoPlan: null,
  videoAnchorGenerationId: null,
  videoAnchorTimer: null,
  videoPipelineGenerationId: null,
  videoPipelineTimer: null,
};

const $ = (selector) => document.querySelector(selector);

async function api(url, options = {}) {
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

function selectedCharacter() {
  return state.characters.find((character) => character.id === state.selectedId) || null;
}

function packClass(status) {
  return String(status || "").toLowerCase().replace(/\s+/g, "-");
}

function yesNoBadge(ok, label) {
  return `<span class="status-pill ${ok ? "ok" : "warn"}">${ok ? "OK" : "Manca"} · ${escapeHtml(label)}</span>`;
}

function renderPackChecklist(character) {
  const readiness = character.readiness || character.characterPack?.readiness;
  const warnings = character.assetWarnings || [];
  if (readiness) {
    $("#character-pack-checklist").innerHTML = `
      <div class="character-readiness-heading"><b>CHARACTER READINESS</b><span class="status-pill ${readiness.status === "Ready" ? "ok" : "warn"}">${escapeHtml(readiness.status)}</span></div>
      <div class="character-readiness-grid">
        ${(readiness.rows || []).map((row) => `<div><span>${escapeHtml(row.label)}</span><b>${row.id === "additional" ? `${Number(row.count || 0)}/${Number(row.target || 0)}` : row.approved ? "✓" : "○"}</b></div>`).join("")}
      </div>
      <p class="hint"><b>Identità:</b> ${escapeHtml(readiness.identity?.status || "Non valutata")}</p>
      ${warnings.length ? `<p class="form-error">${warnings.map(escapeHtml).join("<br>")}</p>` : ""}`;
    return;
  }
  const checklist = character.checklist || {};
  $("#character-pack-checklist").innerHTML = `
    <div class="mini-status-grid">
      ${yesNoBadge(checklist.hero, "hero")}
      ${yesNoBadge(checklist.face, "face")}
      ${yesNoBadge(checklist.body, "body/bust")}
      ${yesNoBadge(checklist.sheet, "sheet")}
      ${yesNoBadge(checklist.assets !== false, "file asset")}
    </div>
    ${warnings.length ? `<p class="form-error">${warnings.map(escapeHtml).join("<br>")}</p>` : ""}
  `;
}

function renderIdentityReport(character) {
  const report = character.identityEvaluation || {};
  const readiness = character.readiness || character.characterPack?.readiness;
  const label = readiness?.identity?.status || "Non valutata";
  $("#identity-report").innerHTML = `
    <p class="hint"><b>Identità:</b> ${escapeHtml(label)}</p>
    <p class="hint">${report.engine ? `Provider: ${escapeHtml(report.engine)}` : "Nessun provider automatico compatibile attivo · usa la revisione manuale."}</p>
    ${(report.warnings || []).length ? `<p class="form-error">${report.warnings.map(escapeHtml).join("<br>")}</p>` : ""}`;
  const evaluations = Array.isArray(report.evaluations) ? report.evaluations : [];
  $("#identity-advanced-details").innerHTML = `
    <p class="hint"><b>Identity provider:</b> ${escapeHtml(report.engine || "non disponibile")}</p>
    ${report.thresholds ? `<p class="hint">Threshold PASS ${escapeHtml(report.thresholds.pass)} · WARNING ${escapeHtml(report.thresholds.warning)}</p>` : ""}
    ${evaluations.length ? `<div class="identity-evaluation-list">${evaluations.map((item) => {
      const reference = (character.references || []).find((entry) => entry.id === item.referenceId);
      return `<p><b>${escapeHtml(reference?.referenceRole || reference?.originalName || item.referenceId)}</b><span>${escapeHtml(item.status)}${item.score == null ? "" : ` · score ${Number(item.score).toFixed(4)}`}</span></p>`;
    }).join("")}</div>` : `<p class="hint">Nessuna evaluation automatica disponibile.</p>`}`;
}

function referenceIdentityState(character, reference) {
  const manual = reference?.manualReview?.status || "PENDING";
  if (manual === "APPROVED") return { icon: "✓", label: "Coerente", className: "ok" };
  if (manual === "REJECTED" || reference?.status === "rejected") return { icon: "✕", label: "Non coerente", className: "danger" };
  const evaluation = (character.identityEvaluation?.evaluations || []).find((item) => item.referenceId === reference?.id);
  if (evaluation?.status === "PASS") return { icon: "✓", label: "Coerente", className: "ok" };
  if (["WARNING", "FAIL"].includes(evaluation?.status)) return { icon: "⚠", label: "Da verificare", className: "warn" };
  return { icon: "○", label: "Non analizzata automaticamente", className: "muted" };
}

function renderList() {
  $("#character-list").innerHTML = state.characters.length
    ? state.characters.map((character) => `
      <button class="character-list-item ${character.id === state.selectedId ? "active" : ""}" type="button" data-character="${escapeHtml(character.id)}">
        ${character.heroUrl ? `<img src="${escapeHtml(character.heroUrl)}" alt="">` : "<span></span>"}
        <b>${escapeHtml(character.name)}</b>
        <small>${escapeHtml(character.packStatus)} · ${Number(character.referenceCount || character.references?.length || 0)} reference</small>
      </button>
    `).join("")
    : `<p class="muted">Nessun Virtual Actor salvato.</p>`;
}

function fillEditor(character) {
  $("#empty-character-panel").classList.toggle("hidden", Boolean(character));
  $("#character-form").classList.toggle("hidden", !character);
  if (!character) return;
  if (state.photoSetPreparation?.characterId !== character.id) invalidatePhotoSetPreparation();

  $("#editor-title").textContent = character.name;
  $("#pack-status").textContent = `Character Pack: ${character.packStatus}`;
  $("#pack-status").className = `pack-status ${packClass(character.packStatus)}`;
  $("#characterName").value = character.name || "";
  $("#characterDescription").value = character.description || "";
  $("#identityStrength").value = character.settings?.identityStrength || "medium";
  $("#subjectKind").value = character.subjectKind || character.characterBlueprint?.subjectKind || "auto";
  $("#hintFace").value = character.identityHints?.face || "";
  $("#hintHair").value = character.identityHints?.hair || "";
  $("#hintBody").value = character.identityHints?.body || "";
  $("#wardrobe").value = Array.isArray(character.wardrobe) ? character.wardrobe.join(", ") : "";
  $("#lockFace").checked = character.settings?.lockFace !== false;
  $("#lockHair").checked = character.settings?.lockHair !== false;
  $("#lockBody").checked = character.settings?.lockBody !== false;
  $("#lockOutfit").checked = character.settings?.lockOutfit === true;
  $("#genesisTechnicalPrompt").value = character.genesis?.technicalPrompt || "";
  $("#genesisTechnicalNegativePrompt").value = character.genesis?.technicalNegativePrompt || "";
  $("#genesisModel").value = character.genesis?.model || "";
  $("#genesisSeed").value = character.genesis?.seed ?? "";
  $("#voiceLanguage").value = character.voiceProfile?.language || "auto";
  $("#voiceSpeaker").value = character.voiceProfile?.speaker || "";
  $("#voiceNotes").value = character.voiceProfile?.notes || "";
  $("#voice-reference-status").textContent = character.voiceReferenceAvailable ? "Reference voce pronta." : "Necessaria per TTS esterno Chatterbox.";
  $("#preferredImagePreset").value = character.preferredImagePreset || "balanced";
  $("#preferredVideoPreset").value = character.preferredVideoPreset || "improved";
  $("#preferredVideoEngine").value = character.preferredVideoEngine || "auto";

  $("#character-hero-image").classList.toggle("hidden", !character.heroUrl);
  $("#character-hero-placeholder").classList.toggle("hidden", Boolean(character.heroUrl));
  if (character.heroUrl) $("#character-hero-image").src = character.heroUrl;
  $("#create-photo-button").disabled = !character.heroUrl;
  $("#create-video-button").disabled = !character.heroUrl;
  configureCharacterPhoto(character);
  configureCharacterVideo(character);

  renderPackChecklist(character);
  renderIdentityReport(character);
  renderReferences(character);
  renderReferenceFactory(character);
  loadReferenceFactoryConfig(character).catch((error) => {
    $("#reference-engine-note").textContent = error.message;
  });
  loadReferenceFactoryGenerations(character).catch((error) => {
    $("#reference-factory-status").textContent = error.message;
  });
  loadCharacterMedia(character).catch(() => {});
}

async function loadReferenceFactoryConfig(character) {
  const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/reference-config`);
  if (state.selectedId !== character.id) return;
  state.referenceConfig = payload;
  const engines = payload.engines || [];
  const select = $("#referenceEngine");
  const plannedEngine = character.referencePlan?.workflow?.engineId;
  const explicitSelection = state.referenceEngineSelections.get(character.id);
  const previous = explicitSelection || plannedEngine || select.value || payload.defaultEngine;
  select.innerHTML = engines.length
    ? engines.map((engine) => `<option value="${escapeHtml(engine.id)}">${escapeHtml(engine.name)} · ${escapeHtml(engine.steps)} step / CFG ${escapeHtml(engine.guidance)}</option>`).join("")
    : `<option value="">Nessun motore disponibile</option>`;
  select.value = engines.some((engine) => engine.id === previous) ? previous : (payload.defaultEngine || "");
  state.referenceEngineSelections.set(character.id, select.value);
  select.disabled = !engines.length;
  $("#prepare-reference-plan-button").disabled = !character.heroUrl || !engines.length;
  $("#reference-engine-note").textContent = plannedEngine
    ? `Il piano attuale usa ${character.referencePlan.workflow.name}. Cambiando motore e preparando di nuovo il piano, tutte le nuove reference useranno il nuovo motore.`
    : "Qwen è ideale per Hero Qwen; PornMaster v4Turbo mantiene più coerenti le Hero nate con PornMaster.";
}

async function loadCharacterMedia(character) {
  const media = await api(`/api/characters/${encodeURIComponent(character.id)}/media`);
  $("#character-generated-photos").innerHTML = media.photos?.length
    ? media.photos.map((item) => `<article data-generated-photo="${escapeHtml(item.id)}"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.label)}"><b>${escapeHtml(item.label)}</b>${item.generationPurpose === "character_photo" ? `<button type="button" data-approve-generated-photo="${escapeHtml(item.id)}" ${item.approvedAsReference ? "disabled" : ""}>${item.approvedAsReference ? "✓ Reference approvata" : "Usa come reference"}</button>` : ""}</article>`).join("")
    : `<p class="hint">Nessuna foto generata.</p>`;
  $("#character-generated-videos").innerHTML = media.videos?.length
    ? media.videos.map((item) => `<article><video src="${escapeHtml(item.videoUrl)}" controls preload="metadata"></video><b>${escapeHtml(item.label)}</b></article>`).join("")
    : `<p class="hint">Nessun video generato.</p>`;
}

function renderReferences(character) {
  const references = character.references || [];
  $("#reference-grid").innerHTML = references.length
    ? references.map((reference) => {
      const identity = referenceIdentityState(character, reference);
      return `
      <article class="character-reference-card" data-reference="${escapeHtml(reference.id)}">
        ${reference.url
          ? `<img src="${escapeHtml(reference.url)}" alt="${escapeHtml(reference.originalName)}">`
          : `<div class="missing-reference-preview">File mancante</div>`}
        <div>
          <select data-reference-type>
            ${["hero", "face", "bust", "full_body", "profile", "sheet", "generic"].map((type) =>
              `<option value="${type}" ${reference.type === type ? "selected" : ""}>${type}</option>`
            ).join("")}
          </select>
          <button type="button" data-delete-reference>Rimuovi</button>
        </div>
        <small>${reference.referenceRole ? `${escapeHtml(reference.referenceRole)} · ` : ""}${escapeHtml(reference.originalName)} · ${reference.assetAvailable ? escapeHtml(reference.preprocessing?.capabilities?.faceDetection || "fallback") : "asset missing"}</small>
        <p class="reference-identity-state identity-${escapeHtml(identity.className)}"><b>Identità:</b> ${identity.icon} ${escapeHtml(identity.label)}</p>
        ${reference.id !== character.heroImage ? `<div class="reference-manual-actions"><button type="button" data-identity-approve>Approva identità</button><button type="button" data-identity-reject>Rifiuta identità</button></div>` : ""}
      </article>
    `; }).join("")
    : `<p class="muted">Carica hero image, character sheet o reference da piu' angolazioni.</p>`;
}

function readableRole(role) {
  return String(role || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function referenceItemView(character, item) {
  const generation = item.candidateGenerationId
    ? state.referenceGenerations.get(item.candidateGenerationId)
    : null;
  const approved = (character.references || []).find((reference) => reference.id === item.approvedReferenceId);
  const status = generation?.status === "completed"
    ? "ready"
    : ["queued", "running"].includes(generation?.status)
      ? generation.status
      : generation?.status === "error" ? "error" : item.status;
  return { generation, approved, status };
}

function referenceStatusLabel(status) {
  return {
    approved: "Approvata",
    ready: "Pronta da verificare",
    queued: "In coda",
    running: "In generazione",
    regenerating: "Rigenerazione in corso",
    rejected: "Rifiutata · da creare",
    error: "Errore · da rigenerare",
    missing: "Da creare",
  }[status] || status || "Da creare";
}

function renderReferenceFactory(character) {
  if (!character) return;
  if (state.referenceCharacterId !== character.id) {
    clearTimeout(state.referencePollTimer);
    state.referenceCharacterId = character.id;
    state.referenceGenerations = new Map();
  }
  const plan = character.referencePlan;
  const heroReady = Boolean(character.heroUrl);
  $("#prepare-reference-plan-button").disabled = !heroReady;
  $("#generate-missing-references-button").classList.toggle("hidden", !plan);
  if (!plan) {
    $("#reference-factory-progress-bar").style.width = heroReady ? "8%" : "0%";
    $("#reference-factory-progress-label").textContent = heroReady
      ? "Hero pronta · prepara il piano adattivo"
      : "Aggiungi prima una Hero al Character";
    $("#reference-factory-content").innerHTML = `
      <div class="reference-plan-empty">
        <span class="status-pill ${heroReady ? "ok" : "warn"}">Hero ${heroReady ? "✓" : "mancante"}</span>
        <p>${heroReady ? "LM Studio analizzerà Hero e Blueprint, poi proporrà soltanto ruoli consentiti per questo soggetto." : "La Reference Factory parte sempre dalla Hero identitaria."}</p>
      </div>`;
    return;
  }
  const approvedCount = plan.items.filter((item) => item.approvedReferenceId).length;
  const total = plan.items.length + 1;
  const completed = approvedCount + (heroReady ? 1 : 0);
  $("#reference-factory-progress-bar").style.width = `${Math.round((completed / total) * 100)}%`;
  $("#reference-factory-progress-label").textContent = `${completed}/${total} reference approvate · ${plan.workflow?.name || "Image Edit"}`;
  $("#reference-factory-content").innerHTML = `
    <article class="reference-plan-row reference-approved">
      ${character.heroUrl ? `<img src="${escapeHtml(character.heroUrl)}" alt="Hero">` : "<span>◇</span>"}
      <div><b>Hero</b><small>Reference identitaria primaria</small></div><span class="status-pill ok">✓</span>
    </article>
    ${plan.items.map((item) => {
      const { generation, approved, status } = referenceItemView(character, item);
      const preview = generation?.status === "completed" && generation.images?.length
        ? `/api/image/${encodeURIComponent(generation.id)}/0`
        : approved?.url || "";
      const ready = generation?.status === "completed" && generation.images?.length;
      const identity = approved ? referenceIdentityState(character, approved) : null;
      return `<article class="reference-plan-row reference-${escapeHtml(status)}" data-reference-role="${escapeHtml(item.referenceRole)}">
        ${preview ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(readableRole(item.referenceRole))}">` : `<span>${["queued", "running", "regenerating"].includes(status) ? "…" : "◇"}</span>`}
        <div class="reference-plan-copy">
          <b>${escapeHtml(readableRole(item.referenceRole))}</b>
          <small>${escapeHtml([item.angle, item.pose, item.expression !== "not applicable" ? item.expression : ""].filter(Boolean).join(" · "))}</small>
          <em>${escapeHtml(referenceStatusLabel(status))}${generation?.seed != null ? ` · seed ${escapeHtml(generation.seed)}` : ""}</em>
          ${identity ? `<em class="reference-identity-state identity-${escapeHtml(identity.className)}">Identità: ${identity.icon} ${escapeHtml(identity.label)}</em>` : ""}
        </div>
        <div class="reference-plan-actions">
          ${ready ? `<button type="button" data-reference-approve="${escapeHtml(item.referenceRole)}" data-generation-id="${escapeHtml(generation.id)}">Approva</button>` : ""}
          <button type="button" data-reference-regenerate="${escapeHtml(item.referenceRole)}" ${["queued", "running"].includes(generation?.status) ? "disabled" : ""}>Rigenera</button>
          ${ready ? `<button type="button" data-reference-reject="${escapeHtml(item.referenceRole)}" data-generation-id="${escapeHtml(generation.id)}">Rifiuta</button>` : ""}
          ${approved && !ready ? `<button type="button" data-identity-approve-reference="${escapeHtml(approved.id)}">Approva</button><button type="button" data-identity-reject-reference="${escapeHtml(approved.id)}">Rifiuta</button>` : ""}
        </div>
        <details class="reference-advanced"><summary>Dettagli avanzati</summary><p>${escapeHtml(item.technicalPrompt)}</p><small>${escapeHtml(plan.workflow?.model || "")} ${item.lastSeed != null ? `· seed ${escapeHtml(item.lastSeed)}` : ""}</small></details>
      </article>`;
    }).join("")}`;
}

async function loadReferenceFactoryGenerations(character, { poll = true } = {}) {
  clearTimeout(state.referencePollTimer);
  if (!character?.referencePlan || state.referenceCharacterId !== character.id) return;
  const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/reference-plan`);
  state.referenceGenerations = new Map((payload.generations || []).map((generation) => [generation.id, generation]));
  const current = state.characters.find((item) => item.id === character.id);
  if (current && payload.character) Object.assign(current, payload.character);
  renderReferenceFactory(current || payload.character);
  if (poll && [...state.referenceGenerations.values()].some((generation) => ["queued", "running"].includes(generation.status))) {
    state.referencePollTimer = setTimeout(() => loadReferenceFactoryGenerations(current || payload.character).catch(() => {}), 3000);
  }
}

async function prepareReferencePlan() {
  const character = selectedCharacter();
  if (!character) return;
  const button = $("#prepare-reference-plan-button");
  button.disabled = true;
  $("#reference-factory-status").textContent = "LM Studio sta analizzando Hero, Blueprint e capacità del workflow…";
  try {
    await api(`/api/characters/${encodeURIComponent(character.id)}/reference-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: selectedReferenceEngine() }),
    });
    await refreshCharacters();
    $("#reference-factory-status").textContent = "Piano adattivo pronto. Puoi generare soltanto le viste mancanti.";
  } catch (error) {
    $("#reference-factory-status").textContent = error.message;
    $("#reference-factory-status").classList.add("prompt-assistant-error");
  } finally {
    button.disabled = false;
  }
}

async function generateMissingReferences() {
  const character = selectedCharacter();
  if (!character) return;
  const button = $("#generate-missing-references-button");
  button.disabled = true;
  $("#reference-factory-status").textContent = "Creo una generazione indipendente per ogni reference mancante…";
  try {
    const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/reference-plan/generate-missing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: selectedReferenceEngine() }),
    });
    await refreshCharacters();
    $("#reference-factory-status").textContent = `${payload.generations?.length || 0} reference mancanti inviate in coda.`;
  } catch (error) {
    $("#reference-factory-status").textContent = error.message;
    $("#reference-factory-status").classList.add("prompt-assistant-error");
  } finally {
    button.disabled = false;
  }
}

async function decideReference(role, action, generationId = "") {
  const character = selectedCharacter();
  if (!character) return;
  $("#reference-factory-status").textContent = action === "regenerate"
    ? `Rigenerazione indipendente di ${readableRole(role)}…`
    : `${action === "approve" ? "Approvo" : "Rifiuto"} ${readableRole(role)}…`;
  const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/reference-plan/${encodeURIComponent(role)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(generationId ? { generationId } : {}),
      ...(action === "regenerate" ? { engine: selectedReferenceEngine() } : {}),
    }),
  });
  await refreshCharacters();
  $("#reference-factory-status").textContent = action === "approve"
    ? "Reference approvata e Character Pack aggiornato."
    : action === "reject" ? "Candidate rifiutata. La vista può essere rigenerata." : "Nuova candidate in coda; la reference approvata precedente resta intatta.";
  return payload;
}

function selectedReferenceEngine() {
  const character = selectedCharacter();
  const selected = $("#referenceEngine").value;
  if (character && selected) state.referenceEngineSelections.set(character.id, selected);
  return selected;
}

async function reviewReferenceIdentity(referenceId, decision) {
  const character = selectedCharacter();
  if (!character) return;
  const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/references/${encodeURIComponent(referenceId)}/identity-review`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  await refreshCharacters();
  showToast(decision === "approve" ? "Identità approvata manualmente" : "Reference rifiutata ed esclusa dal Character Pack");
  return payload;
}

async function refreshCharacters({ keepSelection = true } = {}) {
  const payload = await api("/api/characters");
  state.characters = payload.characters || [];
  if (!keepSelection || !state.characters.some((character) => character.id === state.selectedId)) {
    state.selectedId = state.characters[0]?.id || null;
  }
  renderList();
  fillEditor(selectedCharacter());
}

function characterPayload() {
  const character = selectedCharacter();
  const genesis = character?.genesis ? {
    ...character.genesis,
    technicalPrompt: $("#genesisTechnicalPrompt").value,
    technicalNegativePrompt: $("#genesisTechnicalNegativePrompt").value,
    model: $("#genesisModel").value,
    seed: $("#genesisSeed").value,
  } : undefined;
  return {
    name: $("#characterName").value,
    description: $("#characterDescription").value,
    wardrobe: $("#wardrobe").value,
    subjectKind: $("#subjectKind").value,
    genesis,
    identityHints: {
      face: $("#hintFace").value,
      hair: $("#hintHair").value,
      body: $("#hintBody").value,
    },
    settings: {
      identityStrength: $("#identityStrength").value,
      lockFace: $("#lockFace").checked,
      lockHair: $("#lockHair").checked,
      lockBody: $("#lockBody").checked,
      lockOutfit: $("#lockOutfit").checked,
    },
    voiceProfile: { language: $("#voiceLanguage").value, speaker: $("#voiceSpeaker").value, notes: $("#voiceNotes").value },
    preferredImagePreset: $("#preferredImagePreset").value,
    preferredVideoPreset: $("#preferredVideoPreset").value,
    preferredVideoEngine: $("#preferredVideoEngine").value,
  };
}

function setStudioHeading(step, title, subtitle) {
  $("#character-studio-step").textContent = String(step).padStart(2, "0");
  $("#character-studio-title").textContent = title;
  $("#character-studio-subtitle").textContent = subtitle;
  $("#character-studio-status").textContent = "";
  $("#character-studio-status").classList.remove("prompt-assistant-error");
}

function studioError(error) {
  $("#character-studio-status").textContent = error.message;
  $("#character-studio-status").classList.add("prompt-assistant-error");
}

function renderGenesisStart() {
  clearTimeout(state.genesisPollTimer);
  setStudioHeading(1, "Cosa vuoi fare?", "Scegli un percorso semplice. Nessun prompt tecnico è obbligatorio.");
  $("#character-studio-content").innerHTML = `
    <div class="guided-choice-grid character-studio-choices">
      <button type="button" data-genesis-action="new"><span>＋</span><b>Crea un nuovo Character</b><small>Da descrizione o fotografia</small></button>
      <button type="button" data-genesis-action="existing"><span>✓</span><b>Usa un Character esistente</b><small>Apri la Library qui sotto</small></button>
    </div>`;
}

function renderGenesisSourceChoice() {
  setStudioHeading(2, "Da dove vuoi partire?", "LM Studio costruirà automaticamente un Character Blueprint strutturato.");
  $("#character-studio-content").innerHTML = `
    <div class="guided-choice-grid character-studio-choices">
      <button type="button" data-genesis-action="description"><span>IT</span><b>Da una descrizione</b><small>Scrivi poche parole naturali in italiano</small></button>
      <button type="button" data-genesis-action="photo"><span>↗</span><b>Da una foto</b><small>La fotografia diventa la reference identitaria primaria</small></button>
    </div>
    <button class="ghost-button compact" type="button" data-genesis-action="start">← Indietro</button>`;
}

function renderExistingChoice() {
  setStudioHeading(2, "Scegli un Character esistente", "La selezione apre lo stesso Character nella Library, senza duplicarlo.");
  $("#character-studio-content").innerHTML = state.characters.length ? `
    <div class="character-existing-grid">
      ${state.characters.map((character) => `<button type="button" data-open-character="${escapeHtml(character.id)}">
        ${character.heroUrl ? `<img src="${escapeHtml(character.heroUrl)}" alt="">` : "<span>◇</span>"}
        <b>${escapeHtml(character.name)}</b><small>${escapeHtml(character.subjectKind || "auto")} · ${Number(character.referenceCount || 0)} reference</small>
      </button>`).join("")}
    </div>
    <button class="ghost-button compact" type="button" data-genesis-action="start">← Indietro</button>`
    : `<p class="muted">Non ci sono ancora Character salvati.</p><button type="button" data-genesis-action="new">Crea il primo Character</button>`;
}

function renderDescriptionForm() {
  setStudioHeading(3, "Descrivi il tuo Character", "Bastano una o due frasi in italiano. Il prompt Krea resterà nei dettagli avanzati.");
  $("#character-studio-content").innerHTML = `
    <form id="genesis-description-form" class="character-genesis-form">
      <label><span>Descrizione breve</span><textarea name="description" rows="4" required placeholder="Es. Un cane di taglia media con pelo marrone chiaro e una macchia bianca sul petto."></textarea></label>
      <label><span>Nome (facoltativo)</span><input name="name" placeholder="Es. Milo"></label>
      <button class="primary-action" type="submit">✦ Prepara il Character Blueprint →</button>
    </form>
    <button class="ghost-button compact" type="button" data-genesis-action="new">← Indietro</button>`;
}

function renderPhotoForm() {
  setStudioHeading(3, "Carica la fotografia", "Può raffigurare una persona, un animale o un altro soggetto riutilizzabile. Non devi descriverla.");
  $("#character-studio-content").innerHTML = `
    <form id="genesis-photo-form" class="character-genesis-form">
      <label class="dropzone character-genesis-drop">
        <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" required>
        <span class="upload-icon">↗</span><strong>Scegli la fotografia</strong><small>PNG, JPG o WebP</small>
      </label>
      <div id="genesis-photo-preview"></div>
      <label><span>Nome (facoltativo)</span><input name="name" placeholder="LM Studio userà un’etichetta neutra se lo lasci vuoto"></label>
      <button class="primary-action" type="submit">✦ Analizza e usa come Hero →</button>
    </form>
    <button class="ghost-button compact" type="button" data-genesis-action="new">← Indietro</button>`;
}

function blueprintMarkup(character) {
  const blueprint = character.characterBlueprint || {};
  const identity = blueprint.identity || {};
  return `
    <div class="character-blueprint-summary">
      <span class="status-pill ok">${escapeHtml(character.subjectKind || "auto")}</span>
      <h3>${escapeHtml(character.name)}</h3>
      <p>${escapeHtml(identity.appearance || character.description || "Blueprint creato")}</p>
      ${identity.distinctiveFeatures?.length ? `<p><b>Segni distintivi:</b> ${identity.distinctiveFeatures.map(escapeHtml).join(", ")}</p>` : ""}
      ${identity.colors?.length ? `<p><b>Colori:</b> ${identity.colors.map(escapeHtml).join(", ")}</p>` : ""}
    </div>`;
}

function renderGenesisReady(character, advanced, sourceType) {
  state.selectedId = character.id;
  setStudioHeading(4, sourceType === "photo" ? "Hero salvata" : "Blueprint pronto", sourceType === "photo"
    ? "La fotografia originale è già la Hero nella Character Library esistente."
    : "Conferma per generare 4 candidate Krea con seed differenti.");
  $("#character-studio-content").innerHTML = `
    ${blueprintMarkup(character)}
    ${sourceType === "description" ? `<button class="primary-action" type="button" data-generate-candidates="${escapeHtml(character.id)}">Genera 4 candidate Hero →</button>` : `<button class="primary-action" type="button" data-open-character="${escapeHtml(character.id)}">Apri il Character salvato →</button>`}
    <details class="character-genesis-advanced"><summary>Dettagli avanzati / Advanced</summary>
      <label>Prompt tecnico LM Studio<textarea id="genesis-ready-prompt" rows="5">${escapeHtml(advanced.technicalPrompt || "")}</textarea></label>
      <label>Negative prompt tecnico<textarea id="genesis-ready-negative" rows="3">${escapeHtml(advanced.technicalNegativePrompt || "")}</textarea></label>
      <p><b>Prompt model:</b> ${escapeHtml(advanced.promptModel || "")}</p><p><b>Workflow:</b> ${escapeHtml(advanced.model || advanced.generator || "")}</p>
    </details>
    <button class="ghost-button compact" type="button" data-genesis-action="start">Crea o scegli un altro Character</button>`;
  renderList();
  fillEditor(selectedCharacter());
}

async function submitGenesis(form, sourceType) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  $("#character-studio-status").textContent = sourceType === "photo" ? "LM Studio sta analizzando esclusivamente le caratteristiche visibili…" : "LM Studio sta preparando blueprint e prompt Krea…";
  try {
    const data = new FormData(form);
    const payload = await api("/api/characters/genesis", { method: "POST", body: data });
    await refreshCharacters();
    state.selectedId = payload.character.id;
    await refreshCharacters();
    renderGenesisReady(selectedCharacter(), payload.advanced || {}, sourceType);
  } catch (error) {
    studioError(error);
    button.disabled = false;
  }
}

function renderCandidates() {
  setStudioHeading(5, "Scegli la Hero", "Le candidate usano lo stesso blueprint e seed differenti. Seleziona soltanto “Usa come Hero”.");
  $("#character-studio-content").innerHTML = `
    <div class="character-candidate-grid">
      ${state.genesisCandidates.map((candidate, index) => `<article class="character-candidate-card">
        ${candidate.images?.length ? `<img src="/api/image/${escapeHtml(candidate.id)}/0" alt="Candidate Hero ${index + 1}">` : `<div class="candidate-wait"><span class="loader-orbit small-orbit"><i></i></span><b>${escapeHtml(candidate.status || "queued")}</b><small>${Number(candidate.progress || 0)}%</small></div>`}
        <div><b>Candidate ${index + 1}</b><small>Seed ${escapeHtml(candidate.seed)}</small></div>
        <button type="button" data-select-hero="${escapeHtml(candidate.id)}" ${candidate.status !== "completed" || !candidate.images?.length ? "disabled" : ""}>Usa come Hero</button>
      </article>`).join("")}
    </div>
    <details class="character-genesis-advanced"><summary>Dettagli avanzati / Advanced</summary>
      <p>Workflow reale: KreaTriple_T2I_API.json · una generazione per seed.</p>
      ${state.genesisCandidates.map((candidate) => `<p><b>${escapeHtml(candidate.seed)}</b> · ${escapeHtml(candidate.imageModelName || candidate.workflowName || "Krea 2")}</p>`).join("")}
    </details>`;
}

async function pollCandidates() {
  try {
    state.genesisCandidates = await Promise.all(state.genesisCandidates.map((candidate) => api(`/api/generations/${encodeURIComponent(candidate.id)}`)));
    renderCandidates();
    if (state.genesisCandidates.some((candidate) => ["queued", "running"].includes(candidate.status))) {
      state.genesisPollTimer = setTimeout(pollCandidates, 3000);
    }
  } catch (error) {
    studioError(error);
  }
}

async function generateCandidates(characterId) {
  $("#character-studio-status").textContent = "Invio delle 4 candidate al workflow Krea esistente…";
  const payload = await api(`/api/characters/${encodeURIComponent(characterId)}/genesis-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      count: 4,
      technicalPrompt: $("#genesis-ready-prompt")?.value || undefined,
      technicalNegativePrompt: $("#genesis-ready-negative")?.value || undefined,
    }),
  });
  state.genesisCandidates = payload.candidates || [];
  renderCandidates();
  pollCandidates();
}

async function selectHero(generationId) {
  const payload = await api(`/api/characters/${encodeURIComponent(state.selectedId)}/select-hero`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generationId }),
  });
  await refreshCharacters();
  state.selectedId = payload.character.id;
  await refreshCharacters();
  setStudioHeading(6, "Hero selezionata", "La candidate è stata salvata nella Character Library con prompt, modello e seed.");
  $("#character-studio-content").innerHTML = `${blueprintMarkup(selectedCharacter())}<button class="primary-action" type="button" data-open-character="${escapeHtml(state.selectedId)}">Apri il Character completo →</button>`;
}

async function createCharacter(event) {
  event.preventDefault();
  const name = $("#newCharacterName").value.trim();
  if (!name) return;
  const { character } = await api("/api/characters", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  $("#newCharacterName").value = "";
  state.selectedId = character.id;
  await refreshCharacters();
  showToast("Personaggio creato");
}

async function saveCharacter(event) {
  event.preventDefault();
  const character = selectedCharacter();
  if (!character) return;
  await api(`/api/characters/${encodeURIComponent(character.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(characterPayload()),
  });
  const voiceReference = $("#voiceReference").files?.[0];
  if (voiceReference) {
    const form = new FormData();
    form.set("voiceReference", voiceReference);
    await api(`/api/characters/${encodeURIComponent(character.id)}/voice-reference`, { method: "POST", body: form });
    $("#voiceReference").value = "";
  }
  await refreshCharacters();
  showToast("Personaggio salvato");
}

async function deleteCharacter() {
  const character = selectedCharacter();
  if (!character || !confirm(`Eliminare ${character.name}?`)) return;
  await api(`/api/characters/${encodeURIComponent(character.id)}`, { method: "DELETE" });
  state.selectedId = null;
  await refreshCharacters({ keepSelection: false });
  showToast("Personaggio eliminato");
}

async function uploadReferences(files) {
  const character = selectedCharacter();
  if (!character || !files.length) return;
  const form = new FormData();
  form.set("type", $("#referenceType").value);
  form.set("tags", $("#referenceTags").value);
  for (const file of files) form.append("references", file);
  await api(`/api/characters/${encodeURIComponent(character.id)}/references`, {
    method: "POST",
    body: form,
  });
  $("#referenceFiles").value = "";
  await refreshCharacters();
  showToast("Reference caricate");
}

async function updateReference(card) {
  const character = selectedCharacter();
  if (!character) return;
  await api(`/api/characters/${encodeURIComponent(character.id)}/references/${encodeURIComponent(card.dataset.reference)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: card.querySelector("[data-reference-type]").value }),
  });
  await refreshCharacters();
}

async function deleteReference(card) {
  const character = selectedCharacter();
  if (!character) return;
  await api(`/api/characters/${encodeURIComponent(character.id)}/references/${encodeURIComponent(card.dataset.reference)}`, {
    method: "DELETE",
  });
  await refreshCharacters();
}

async function buildPack() {
  const character = selectedCharacter();
  if (!character) return;
  const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/build-pack`, { method: "POST" });
  await refreshCharacters();
  showToast(`Character Pack: ${payload.pack?.status || "aggiornato"}`);
}

async function generateSheet() {
  const character = selectedCharacter();
  if (!character) return;
  try {
    const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/generate-sheet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow: $("#characterSheetWorkflow").value,
        seed: $("#characterSheetSeed").value,
        prompt: $("#characterSheetPrompt").value,
      }),
    });
    showToast(`Character Sheet in coda: ${payload.generation?.workflowName || payload.workflow}`);
  } catch (error) {
    showToast(`Character Sheet: ${error.message}`);
  }
}

async function identityCheck() {
  const character = selectedCharacter();
  if (!character) return;
  try {
    const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/check-identity`, { method: "POST" });
    await refreshCharacters();
    showToast(`Identity Check: ${payload.report?.status || "completato"}`);
  } catch (error) {
    showToast(`Identity Check: ${error.message}`);
  }
}

function configureCharacterPhoto(character) {
  const kind = character.referencePlan?.subjectKind || character.subjectKind || "other";
  const human = kind === "human";
  $("#photo-outfit-field").classList.toggle("hidden", !human);
  $("#photo-appearance-note").classList.toggle("hidden", human);
  if (!human) $("#photoOutfitMode").value = "keep";
  if (state.photoCharacterId && state.photoCharacterId !== character.id) {
    clearTimeout(state.photoPipelineTimer);
    state.photoPipelineTimer = null;
    state.photoGenerationId = null;
    state.photoPlan = null;
    $("#character-photo-panel").classList.add("hidden");
    $("#character-photo-confirmation").classList.add("hidden");
    $("#character-photo-choices").classList.remove("hidden");
  }
}

async function loadCharacterPhotoConfig(character) {
  const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/photo-config`);
  state.photoConfig = payload;
  const engines = payload.engines || [];
  $("#photoEngine").innerHTML = engines.length
    ? engines.map((engine) => `<option value="${escapeHtml(engine.id)}">${escapeHtml(engine.name)} · ${escapeHtml(engine.steps)} step / CFG ${escapeHtml(engine.guidance)}</option>`).join("")
    : `<option value="">Nessun motore disponibile</option>`;
  $("#photoEngine").disabled = !engines.length;
  $("#prepare-photo-plan-button").disabled = !engines.length;
  invalidatePhotoSetPreparation();
  $("#prepare-photo-set-button").disabled = !engines.length;
  $("#photo-engine-note").textContent = engines.length
    ? `${engines.length}/3 motori disponibili. Qwen privilegia l'editing; PornMaster Turbo privilegia la velocità; Base BF16 privilegia qualità e fedeltà LoRA.`
    : "Qwen Image Edit 2511 e i due PornMaster Flux2 Klein v4 non risultano completi.";
}

function openCharacterPhoto() {
  const character = selectedCharacter();
  if (!character?.heroUrl) return showToast("Aggiungi prima una Hero valida");
  state.photoCharacterId = character.id;
  clearTimeout(state.photoPipelineTimer);
  state.photoPipelineTimer = null;
  state.photoGenerationId = null;
  state.photoPlan = null;
  configureCharacterPhoto(character);
  $("#character-photo-panel").classList.remove("hidden");
  $("#character-photo-choices").classList.remove("hidden");
  $("#character-photo-confirmation").classList.add("hidden");
  $("#generate-character-photo-button").disabled = false;
  $("#character-photo-status").textContent = "";
  $("#character-master-progress").innerHTML = "";
  $("#character-master-preview").innerHTML = "";
  $("#character-master-preview").classList.add("hidden");
  $("#character-master-intermediates").innerHTML = "";
  $("#character-photo-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  loadCharacterPhotoConfig(character).catch((error) => {
    $("#character-photo-status").textContent = error.message;
  });
}

const photoPresetStages = {
  fast: { krea: false, klein: false, seedvr2: false },
  balanced: { krea: true, klein: false, seedvr2: true },
  max: { krea: true, klein: true, seedvr2: true },
};

function applyPhotoQualityPreset() {
  const stages = photoPresetStages[$("#photoQuality").value] || photoPresetStages.balanced;
  $("#photoStageKrea").checked = stages.krea;
  $("#photoStageKlein").checked = stages.klein;
  $("#photoStageSeedvr2").checked = stages.seedvr2;
}

function pipelineStatusLabel(status) {
  return ({ requested: "Richiesto", running: "In corso", completed: "Completato", failed: "Fallito", skipped: "Saltato" })[status] || status;
}

function resetCharacterVideoState({ hide = false } = {}) {
  clearTimeout(state.videoAnchorTimer);
  state.videoAnchorTimer = null;
  state.videoPlan = null;
  state.videoAnchorGenerationId = null;
  clearTimeout(state.videoPipelineTimer);
  state.videoPipelineTimer = null;
  state.videoPipelineGenerationId = null;
  $("#character-video-confirmation").classList.add("hidden");
  $("#character-video-choices").classList.remove("hidden");
  $("#generate-character-video-button").disabled = true;
  $("#character-video-anchor-preview").innerHTML = "";
  $("#character-video-anchor-status").innerHTML = "";
  $("#character-video-status").textContent = "";
  $("#character-video-pipeline").innerHTML = "";
  $("#character-video-master-preview").innerHTML = "";
  if (hide) $("#character-video-panel").classList.add("hidden");
}

function configureCharacterVideo(character) {
  if (state.videoConfig?.character?.id && state.videoConfig.character.id !== character.id) {
    state.videoConfig = null;
    resetCharacterVideoState({ hide: true });
  }
}

function updateVideoSourceControls() {
  const mode = $("#videoSourceMode").value;
  $("#videoGeneratedSource").classList.toggle("hidden", mode !== "generated");
  $("#videoSourceUpload").classList.toggle("hidden", mode !== "upload");
}

function selectedVideoAnchorPreview() {
  const character = selectedCharacter();
  const mode = $("#videoSourceMode").value;
  if (mode === "hero") return character?.heroUrl || "";
  if (mode === "generated") {
    return state.videoConfig?.generatedPhotos?.find((item) => item.id === $("#videoGeneratedSource").value)?.imageUrl || "";
  }
  if (mode === "upload") {
    const file = $("#videoSourceUpload").files?.[0];
    return file ? URL.createObjectURL(file) : "";
  }
  return "";
}

function showVideoAnchorPreview(url, label = "Video Anchor") {
  $("#character-video-anchor-preview").innerHTML = url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"><small>${escapeHtml(label)}</small>`
    : `<p class="form-error">Seleziona un'immagine valida.</p>`;
  $("#generate-character-video-button").disabled = !url;
}

async function openCharacterVideo() {
  const character = selectedCharacter();
  if (!character?.heroUrl) return showToast("Aggiungi prima una Hero valida");
  resetCharacterVideoState();
  $("#character-video-panel").classList.remove("hidden");
  $("#character-video-status").textContent = "Verifico i Video Engine realmente disponibili…";
  try {
    state.videoConfig = await api(`/api/characters/${encodeURIComponent(character.id)}/video-config`);
    $("#videoEngine").innerHTML = `<option value="auto">Auto</option>${(state.videoConfig.router?.engines || [])
      .filter((engine) => engine.available)
      .map((engine) => `<option value="${escapeHtml(engine.id)}">${escapeHtml(engine.name)}</option>`).join("")}`;
    $("#videoEngine").value = state.videoConfig.preferences?.videoEngine || "auto";
    if (!$("#videoEngine").value) $("#videoEngine").value = "auto";
    const refinePresets = (state.videoConfig.refine?.presets || []).filter((preset) => preset.available);
    $("#videoRefinePreset").innerHTML = refinePresets.map((preset) => `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}</option>`).join("");
    const preferredRefine = state.videoConfig.preferences?.videoPreset || "improved";
    $("#videoRefinePreset").value = refinePresets.some((preset) => preset.id === preferredRefine) ? preferredRefine : "original";
    $("#videoAudioMode").innerHTML = (state.videoConfig.audioModes || []).filter((mode) => mode.id !== "none").map((mode) => `<option value="${escapeHtml(mode.id)}">${escapeHtml(mode.name)}</option>`).join("");
    const preferredAudio = (state.videoConfig.audioModes || []).some((mode) => mode.id === "externalTts" && mode.available) ? "externalTts" : "native";
    $("#videoAudioMode").value = preferredAudio;
    $("#video-audio-capability-note").textContent = `Audio disponibile: ${(state.videoConfig.audioModes || []).map((mode) => mode.name).join(", ") || "nessuno"}.`;
    updateVideoAudioControls();
    const photos = state.videoConfig.generatedPhotos || [];
    $("#videoGeneratedSource").innerHTML = photos.length
      ? photos.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${new Date(item.createdAt).toLocaleString("it-IT")}</option>`).join("")
      : `<option value="">Nessuna foto generata disponibile</option>`;
    const autoOption = $("#videoSourceMode option[value=auto]");
    autoOption.disabled = state.videoConfig.anchorGeneration?.available === false;
    if (autoOption.disabled && $("#videoSourceMode").value === "auto") $("#videoSourceMode").value = "hero";
    const engines = (state.videoConfig.router?.engines || []).filter((engine) => engine.available);
    $("#prepare-character-video-button").disabled = engines.length === 0;
    $("#character-video-status").textContent = engines.length
      ? `Engine disponibile: ${engines.map((engine) => engine.name).join(", ")}.`
      : "Nessun Video Engine realmente disponibile nella configurazione corrente.";
    updateVideoSourceControls();
  } catch (error) {
    $("#character-video-status").textContent = error.message;
  }
  $("#character-video-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function characterVideoRequest() {
  const dialogueEnabled = $("#videoDialogueEnabled").checked;
  return {
    sourceMode: $("#videoSourceMode").value,
    videoIntent: $("#videoIntent").value.trim(),
    filmingStyle: $("#videoFilmingStyle").value,
    aspectRatio: $("#videoAspectRatio").value,
    duration: Number($("#videoDuration").value),
    dialogueEnabled,
    dialogue: dialogueEnabled ? $("#videoDialogue").value.trim() : "",
    emotion: dialogueEnabled ? $("#videoEmotion").value : "natural",
    audioMode: dialogueEnabled ? $("#videoAudioMode").value : "none",
    quality: $("#videoQuality").value,
    refinePreset: $("#videoRefinePreset").value,
    videoEngine: $("#videoEngine").value,
    outfit: "preserve source appearance and outfit",
  };
}

async function pollVideoAnchor() {
  if (!state.videoAnchorGenerationId) return;
  try {
    const generation = await api(`/api/generations/${encodeURIComponent(state.videoAnchorGenerationId)}`);
    $("#character-video-anchor-status").innerHTML = `<div class="character-master-stage stage-${escapeHtml(generation.status)}"><span class="stage-dot"></span><b>Video Anchor</b><small>${escapeHtml(generation.status)}</small></div>`;
    if (["queued", "running"].includes(generation.status)) {
      state.videoAnchorTimer = setTimeout(pollVideoAnchor, 1800);
      return;
    }
    state.videoAnchorTimer = null;
    if (generation.status === "completed" && generation.images?.length) {
      showVideoAnchorPreview(`/api/image/${encodeURIComponent(generation.id)}/0`, "Video Anchor generato");
      $("#character-video-status").textContent = "Anchor pronto. Puoi generare il video.";
    } else {
      $("#generate-character-video-button").disabled = true;
      $("#character-video-status").textContent = generation.error || "La generazione del Video Anchor non è riuscita.";
    }
  } catch (error) {
    $("#character-video-status").textContent = `Aggiornamento Anchor: ${error.message}`;
    state.videoAnchorTimer = setTimeout(pollVideoAnchor, 3000);
  }
}

async function prepareCharacterVideo() {
  const character = selectedCharacter();
  if (!character) return;
  const request = characterVideoRequest();
  if (!request.videoIntent) return showToast("Descrivi cosa deve fare il Character");
  if (request.dialogueEnabled && !request.dialogue) return showToast("Scrivi la battuta da pronunciare");
  if (request.sourceMode === "generated" && !$("#videoGeneratedSource").value) return showToast("Non ci sono foto generate selezionabili");
  if (request.sourceMode === "upload" && !$("#videoSourceUpload").files?.[0]) return showToast("Carica prima l'immagine Video Anchor");
  const button = $("#prepare-character-video-button");
  button.disabled = true;
  $("#character-video-status").textContent = "LM Studio sta costruendo Video Blueprint e Motion Prompt…";
  try {
    const plan = await api(`/api/characters/${encodeURIComponent(character.id)}/video-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    state.videoPlan = { ...plan, request };
    $("#characterVideoMotionPrompt").value = plan.motionPrompt;
    $("#characterVideoScenePrompt").value = plan.scenePrompt;
    $("#characterVideoAudioPrompt").value = plan.audioPrompt;
    $("#characterVideoDialogueInstructions").value = plan.dialogueInstructions;
    $("#characterVideoEmotionInstructions").value = plan.emotionInstructions;
    $("#character-video-blueprint").textContent = JSON.stringify(plan.videoBlueprint, null, 2);
    $("#character-video-route").textContent = `${plan.route.engineName} · workflow ${plan.route.workflowId} · ${plan.route.quality}`;
    $("#character-video-summary").textContent = `${plan.videoBlueprint.subjectMotion} · ${plan.videoBlueprint.cameraMotion} · ${plan.videoBlueprint.duration}s${plan.videoBlueprint.dialogue ? ` · audio ${plan.videoBlueprint.audioMode}` : ""}`;
    $("#character-video-choices").classList.add("hidden");
    $("#character-video-confirmation").classList.remove("hidden");
    if (request.sourceMode === "auto") {
      $("#character-video-status").textContent = "Creo un Video Anchor conservativo reale…";
      const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/anchor-frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, videoBlueprint: plan.videoBlueprint, identityStrength: character.settings?.identityStrength || "medium" }),
      });
      state.videoAnchorGenerationId = payload.generation.id;
      $("#character-video-anchor-status").innerHTML = `<div class="character-master-stage stage-requested"><span class="stage-dot"></span><b>Video Anchor</b><small>In coda</small></div>`;
      state.videoAnchorTimer = setTimeout(pollVideoAnchor, 1000);
    } else {
      const preview = selectedVideoAnchorPreview();
      showVideoAnchorPreview(preview, request.sourceMode === "hero" ? "Hero" : request.sourceMode === "generated" ? "Foto generata" : "Immagine caricata");
      $("#character-video-status").textContent = preview ? "Anchor selezionato. Puoi generare il video." : "Seleziona un'immagine valida.";
    }
  } catch (error) {
    $("#character-video-status").textContent = error.message;
    button.disabled = false;
  }
}

function changeCharacterVideoIdea() {
  clearTimeout(state.videoAnchorTimer);
  state.videoAnchorTimer = null;
  state.videoPlan = null;
  state.videoAnchorGenerationId = null;
  $("#character-video-confirmation").classList.add("hidden");
  $("#character-video-choices").classList.remove("hidden");
  $("#prepare-character-video-button").disabled = false;
  $("#character-video-status").textContent = "Modifica le scelte e prepara di nuovo il video.";
}

async function generateCharacterVideo() {
  const character = selectedCharacter();
  if (!character || !state.videoPlan) return;
  const button = $("#generate-character-video-button");
  const request = state.videoPlan.request;
  const form = new FormData();
  form.set("sourceMode", request.sourceMode);
  form.set("sourceGenerationId", $("#videoGeneratedSource").value);
  form.set("anchorGenerationId", state.videoAnchorGenerationId || "");
  form.set("videoBlueprint", JSON.stringify(state.videoPlan.videoBlueprint));
  form.set("motionPrompt", $("#characterVideoMotionPrompt").value);
  form.set("scenePrompt", $("#characterVideoScenePrompt").value);
  form.set("audioPrompt", $("#characterVideoAudioPrompt").value);
  form.set("dialogueInstructions", $("#characterVideoDialogueInstructions").value);
  form.set("emotionInstructions", $("#characterVideoEmotionInstructions").value);
  form.set("quality", request.quality);
  form.set("videoEngine", request.videoEngine);
  form.set("aspectRatio", request.aspectRatio);
  form.set("seed", $("#characterVideoSeed").value);
  form.set("refinePreset", request.refinePreset);
  if (request.audioMode === "existing") {
    const audio = $("#videoDialogueAudio").files?.[0];
    if (!audio) { button.disabled = false; return showToast("Carica il file audio della battuta"); }
    form.set("dialogueAudio", audio);
  }
  if (request.sourceMode === "upload" && $("#videoSourceUpload").files?.[0]) form.set("videoSource", $("#videoSourceUpload").files[0]);
  button.disabled = true;
  $("#character-video-status").textContent = "Invio il Character Video alla coda ComfyUI…";
  try {
    const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/create-video`, { method: "POST", body: form });
    state.videoPipelineGenerationId = payload.generation.id;
    $("#character-video-status").textContent = `Video Master in lavorazione · ${payload.generation.workflowName}`;
    renderCharacterVideoPipeline(payload.generation);
    state.videoPipelineTimer = setTimeout(pollCharacterVideoPipeline, 1500);
    showToast("Character Video inviato alla coda");
  } catch (error) {
    $("#character-video-status").textContent = error.message;
    button.disabled = false;
  }
}

function updateVideoAudioControls() {
  $("#video-existing-audio-field").classList.toggle("hidden", $("#videoAudioMode").value !== "existing");
}

function renderCharacterVideoPipeline(generation) {
  const pipeline = generation?.characterVideoPipeline;
  if (!pipeline) return;
  $("#character-video-pipeline").innerHTML = `<div class="character-master-heading"><b>Video Master Pipeline</b><span>${escapeHtml(pipeline.status)}</span></div><div class="character-master-stage-list">${(pipeline.stages || []).map((stage) => `<div class="character-master-stage stage-${escapeHtml(stage.status)}"><span class="stage-dot"></span><b>${escapeHtml(stage.label)}</b><small>${escapeHtml(pipelineStatusLabel(stage.status))}${stage.error ? ` · ${escapeHtml(stage.error)}` : ""}</small></div>`).join("")}</div>`;
  if (generation.videos?.length) $("#character-video-master-preview").innerHTML = `<p class="subpanel-title">Master Video</p><video src="/api/media/${encodeURIComponent(generation.id)}/0" controls preload="metadata"></video>`;
}

async function pollCharacterVideoPipeline() {
  if (!state.videoPipelineGenerationId) return;
  try {
    const generation = await api(`/api/generations/${encodeURIComponent(state.videoPipelineGenerationId)}`);
    renderCharacterVideoPipeline(generation);
    if (["orchestrating", "queued", "running"].includes(generation.status)) {
      state.videoPipelineTimer = setTimeout(pollCharacterVideoPipeline, 1800);
      return;
    }
    state.videoPipelineTimer = null;
    $("#character-video-status").textContent = generation.status === "completed" ? "Master Video completato." : generation.error || "Video Pipeline non completata.";
    $("#generate-character-video-button").disabled = false;
    if (generation.status === "completed") loadCharacterMedia(selectedCharacter()).catch(() => {});
  } catch (error) {
    $("#character-video-status").textContent = error.message;
    state.videoPipelineTimer = setTimeout(pollCharacterVideoPipeline, 3000);
  }
}

function renderCharacterMasterPipeline(generation) {
  const pipeline = generation?.characterMasterPipeline;
  if (!pipeline) return;
  $("#character-master-progress").innerHTML = `
    <div class="character-master-heading"><b>Master pipeline · ${escapeHtml(pipeline.presetLabel || pipeline.preset)}</b><span>${escapeHtml(pipeline.status)}</span></div>
    <div class="character-master-stage-list">${(pipeline.stages || []).map((stage) => `
      <div class="character-master-stage stage-${escapeHtml(stage.status)}">
        <span class="stage-dot" aria-hidden="true"></span>
        <b>${escapeHtml(stage.label)}</b>
        <small>${escapeHtml(pipelineStatusLabel(stage.status))}${stage.error ? ` · ${escapeHtml(stage.error)}` : ""}</small>
      </div>`).join("")}</div>`;

  const intermediates = (pipeline.stages || []).filter((stage) =>
    stage.id !== "seedvr2" && stage.status === "completed" && stage.generationId && stage.output?.length);
  $("#character-master-intermediates").innerHTML = intermediates.length
    ? `<p class="subpanel-title">Output intermedi</p><div class="character-master-intermediate-grid">${intermediates.map((stage) => `
      <article><img src="/api/image/${encodeURIComponent(stage.generationId)}/0" alt="${escapeHtml(stage.label)}"><b>${escapeHtml(stage.label)}</b><small>${escapeHtml(stage.model || "modello scena")}</small></article>`).join("")}</div>`
    : `<p class="hint">Gli output intermedi compariranno qui durante la pipeline.</p>`;

  const done = ["completed", "completed_with_warnings"].includes(pipeline.status);
  const preview = $("#character-master-preview");
  preview.classList.toggle("hidden", !done || !generation.images?.length);
  preview.innerHTML = done && generation.images?.length
    ? `<p class="subpanel-title">Master</p><img src="/api/image/${encodeURIComponent(generation.id)}/0" alt="Master finale">${pipeline.identityValidation ? `<p class="hint">Identity validation: ${escapeHtml(pipeline.identityValidation.status || "NOT_EVALUATED")}</p>` : ""}`
    : "";
  $("#character-photo-status").textContent = done
    ? `Master completato${pipeline.status === "completed_with_warnings" ? " con avvisi" : ""}.`
    : "Pipeline Master in esecuzione…";
  $("#generate-character-photo-button").disabled = !done;
}

async function pollCharacterMasterPipeline() {
  if (!state.photoGenerationId) return;
  try {
    const payload = await api(`/api/generations/${encodeURIComponent(state.photoGenerationId)}`);
    const generation = payload.generation || payload;
    renderCharacterMasterPipeline(generation);
    if (generation.characterMasterPipeline?.status === "running") {
      state.photoPipelineTimer = setTimeout(pollCharacterMasterPipeline, 1800);
    } else {
      state.photoPipelineTimer = null;
    }
  } catch (error) {
    $("#character-photo-status").textContent = `Aggiornamento pipeline: ${error.message}`;
    state.photoPipelineTimer = setTimeout(pollCharacterMasterPipeline, 3000);
  }
}

function photoPlanRequest(overrides = {}) {
  const location = $("#photoLocation").value;
  return {
    engine: $("#photoEngine").value,
    location,
    action: $("#photoAction").value,
    mood: $("#photoMood").value,
    outfitMode: $("#photoOutfitMode").value,
    outfit: $("#photoOutfit").value,
    userIntent: $("#photoIntent").value,
    surprise: location === "surprise",
    ...overrides,
  };
}

const PHOTO_SET_SCENES = Object.freeze({
  lifestyle: [
    "A natural morning portrait by a window while drinking coffee.", "A candid grocery-shopping photo in a real supermarket aisle.",
    "A relaxed photo reading on a sofa in a lived-in apartment.", "A spontaneous outdoor walk in a local park.",
    "A casual lunch photo at a neighborhood restaurant.", "A rainy-day street portrait under an umbrella.",
    "A realistic train-platform travel snapshot.", "A quiet evening balcony portrait with available light.",
  ],
  fashion: [
    "A clean editorial head-and-shoulders portrait with restrained styling and visible skin texture.", "A full-body fashion street photograph with natural proportions and real fabric folds.",
    "A three-quarter studio portrait with one soft key light and subtle shadow falloff.", "A seated editorial pose in a minimal concrete interior.",
    "A candid backstage fashion photograph with mixed practical lighting.", "A low-key evening editorial portrait without beauty-filter smoothing.",
    "A daylight architecture-and-fashion composition with realistic lens perspective.", "A close detail portrait emphasizing natural hair, skin and fabric texture.",
  ],
  fantasy: [
    "A documentary-style portrait walking along a muddy road in a grounded medieval fantasy village.", "A candid tavern interior photo lit by firelight and practical candles.",
    "A full-body travel portrait beside a weathered wooden wagon, realistic leather and cloth equipment.", "A quiet forest-camp portrait in overcast natural light.",
    "A marketplace snapshot among believable villagers and worn timber stalls.", "A windswept portrait on an old stone bridge at dawn.",
    "A practical adventurer portrait checking equipment beside a stable.", "A rainy village-street portrait with mud, wet fabric and imperfect documentary exposure.",
  ],
});

let influencerPromptCatalogPromise;

async function influencerPromptCatalog() {
  if (!influencerPromptCatalogPromise) {
    influencerPromptCatalogPromise = fetch("/influencer-photo-prompts.md")
      .then((response) => {
        if (!response.ok) throw new Error("Catalogo prompt Influencer non disponibile.");
        return response.text();
      })
      .then((text) => {
        const prompts = [...text.matchAll(/^\s*(\d{1,3})\.\s+(.+)$/gm)]
          .map((match) => ({ number: Number(match[1]), prompt: match[2].trim() }))
          .filter((item) => item.number >= 1 && item.number <= 100 && item.prompt);
        if (prompts.length !== 100) throw new Error(`Catalogo Influencer incompleto: ${prompts.length}/100 prompt.`);
        const identityContract = text.match(/Use the provided reference image[\s\S]*?obvious AI-generated image\./i)?.[0]?.replace(/\s+/g, " ").trim();
        if (!identityContract) throw new Error("Contratto identitario Influencer mancante.");
        return {
          identityContract,
          amateur: prompts.filter((item) => item.number <= 50).map((item) => item.prompt),
          professional: prompts.filter((item) => item.number > 50).map((item) => item.prompt),
        };
      })
      .catch((error) => {
        influencerPromptCatalogPromise = null;
        throw error;
      });
  }
  return influencerPromptCatalogPromise;
}

function randomPromptSelection(prompts, count) {
  const shuffled = [...prompts];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    globalThis.crypto?.getRandomValues?.(random);
    const swap = Number(random[0] || Math.floor(Math.random() * 2 ** 32)) % (index + 1);
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function photoSetSignature(character) {
  return JSON.stringify({
    characterId: character?.id || "",
    engine: $("#photoEngine").value,
    preset: $("#photoSetPreset").value,
    count: Number($("#photoSetCount").value) || 6,
    qualityPreset: $("#photoSetQuality").value,
    outfitMode: $("#photoOutfitMode").value,
    custom: $("#photoIntent").value.trim(),
  });
}

function renderPhotoSetPreparation() {
  const prepared = state.photoSetPreparation;
  const preview = $("#photo-set-prompt-preview");
  preview.classList.toggle("hidden", !prepared);
  preview.innerHTML = prepared ? `
    <div class="photo-set-prompt-heading"><b>${prepared.plans.length} prompt pronti</b><small>LM Studio ha terminato ed è stato scaricato prima di usare ComfyUI.</small></div>
    <ol>${prepared.plans.map((item, index) => `<li><b>Foto ${index + 1}</b><span>${escapeHtml(item.plan?.technicalPrompt || item.scene)}</span></li>`).join("")}</ol>
  ` : "";
  $("#create-photo-set-button").disabled = !prepared
    || state.photoSetRunning
    || prepared.nextIndex >= prepared.plans.length;
}

function invalidatePhotoSetPreparation() {
  state.photoSetPreparation = null;
  const preview = $("#photo-set-prompt-preview");
  if (preview) renderPhotoSetPreparation();
}

async function prepareCharacterPhotoSet() {
  const character = selectedCharacter();
  if (!character || state.photoSetRunning || state.photoSetPreparing) return;
  const engine = $("#photoEngine").value;
  if (!engine) return showToast("Nessun motore Photo Set disponibile");
  const preset = $("#photoSetPreset").value;
  const count = Number($("#photoSetCount").value) || 6;
  const qualityPreset = $("#photoSetQuality").value;
  const custom = $("#photoIntent").value.trim();
  if (preset === "custom" && !custom) return showToast("Scrivi prima la frase su cui basare il set");
  let scenes;
  try {
    if (preset.startsWith("influencer-")) {
      const catalog = await influencerPromptCatalog();
      const pool = preset === "influencer-amateur" ? catalog.amateur
        : preset === "influencer-professional" ? catalog.professional
          : catalog.amateur.flatMap((prompt, index) => [prompt, catalog.professional[index]]);
      scenes = randomPromptSelection(pool, count).map((prompt) => `${catalog.identityContract} ${prompt}`);
    } else {
      scenes = preset === "custom"
        ? Array.from({ length: count }, (_, index) => `${custom} Create variation ${index + 1} with a distinct camera distance, natural pose and location detail while preserving exact identity.`)
        : PHOTO_SET_SCENES[preset].slice(0, count);
    }
  } catch (error) {
    $("#photo-set-status").textContent = error.message;
    return;
  }
  const button = $("#prepare-photo-set-button");
  state.photoSetPreparing = true;
  invalidatePhotoSetPreparation();
  button.disabled = true;
  const plans = [];
  try {
    for (let index = 0; index < scenes.length; index += 1) {
      $("#photo-set-status").textContent = `LM Studio prepara il prompt ${index + 1}/${scenes.length}… Nessuna immagine è ancora in coda.`;
      const planned = await api(`/api/characters/${encodeURIComponent(character.id)}/photo-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(photoPlanRequest({
          engine,
          location: "automatic",
          action: "automatic",
          mood: preset === "fashion" ? "cinematic" : "natural",
          userIntent: scenes[index],
          surprise: false,
        })),
      });
      plans.push({ scene: scenes[index], plan: planned.plan });
    }
    state.photoSetPreparation = {
      signature: photoSetSignature(character),
      characterId: character.id,
      engine,
      preset,
      qualityPreset,
      outfitMode: $("#photoOutfitMode").value,
      photoSetId: globalThis.crypto?.randomUUID?.() || `photo-set-${Date.now()}`,
      plans,
      nextIndex: 0,
    };
    renderPhotoSetPreparation();
    $("#photo-set-status").textContent = `${plans.length} prompt preparati. LM Studio ha finito: controllali, poi avvia tutte le immagini.`;
  } catch (error) {
    $("#photo-set-status").textContent = `Preparazione prompt interrotta dopo ${plans.length}/${scenes.length}: ${error.message}`;
  } finally {
    state.photoSetPreparing = false;
    button.disabled = false;
  }
}

async function createCharacterPhotoSet() {
  const character = selectedCharacter();
  const prepared = state.photoSetPreparation;
  if (!character || state.photoSetRunning) return;
  if (!prepared || prepared.characterId !== character.id || prepared.signature !== photoSetSignature(character)) {
    invalidatePhotoSetPreparation();
    return showToast("Prepara prima tutti i prompt del Photo Set");
  }
  const button = $("#create-photo-set-button");
  const prepareButton = $("#prepare-photo-set-button");
  state.photoSetRunning = true;
  button.disabled = true;
  prepareButton.disabled = true;
  let queued = 0;
  try {
    for (let index = prepared.nextIndex; index < prepared.plans.length; index += 1) {
      $("#photo-set-status").textContent = `Invio immagine ${index + 1}/${prepared.plans.length} a ComfyUI · LM Studio non viene richiamato…`;
      await api(`/api/characters/${encodeURIComponent(character.id)}/create-photo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: prepared.plans[index].plan,
          engine: prepared.engine,
          outfitMode: prepared.outfitMode,
          qualityPreset: prepared.qualityPreset,
          photoSetId: prepared.photoSetId,
          photoSetPreset: prepared.preset,
          photoSetIndex: index,
          advancedStages: prepared.qualityPreset === "fast" ? { krea: false, klein: false, seedvr2: false } : { krea: true, klein: false, seedvr2: true },
        }),
      });
      queued += 1;
      prepared.nextIndex = index + 1;
    }
    $("#photo-set-status").textContent = `${prepared.nextIndex} foto indipendenti in coda. I prompt restano visibili; prepara un nuovo set per una nuova coda.`;
    showToast(`Photo Set: ${queued} nuove foto in coda`);
  } catch (error) {
    $("#photo-set-status").textContent = `Photo Set interrotto dopo ${prepared.nextIndex}/${prepared.plans.length} invii: ${error.message}. Puoi riprendere dalle rimanenti.`;
  } finally {
    state.photoSetRunning = false;
    prepareButton.disabled = false;
    renderPhotoSetPreparation();
  }
}

async function approveGeneratedPhoto(generationId) {
  const character = selectedCharacter();
  if (!character) return;
  await api(`/api/characters/${encodeURIComponent(character.id)}/photos/${encodeURIComponent(generationId)}/approve-reference`, { method: "POST" });
  await refreshCharacters();
  showToast("Foto approvata e aggiunta alle reference");
}

async function prepareCharacterPhotoPlan() {
  const character = selectedCharacter();
  if (!character) return;
  const button = $("#prepare-photo-plan-button");
  button.disabled = true;
  $("#character-photo-status").textContent = "LM Studio sta progettando la scena e scegliendo le reference…";
  try {
    const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/photo-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(photoPlanRequest()),
    });
    state.photoPlan = payload.plan;
    $("#generate-character-photo-button").disabled = false;
    $("#character-photo-summary").textContent = payload.plan.summary;
    $("#characterPhotoTechnicalPrompt").value = payload.plan.technicalPrompt || "";
    $("#characterPhotoNegativePrompt").value = payload.plan.technicalNegativePrompt || "";
    $("#character-photo-blueprint").textContent = JSON.stringify(payload.plan.sceneBlueprint, null, 2);
    $("#character-photo-reference-summary").innerHTML = `
      <b>Reference selezionate automaticamente</b>
      ${(payload.plan.referenceSelectionReason || []).map((item) => {
        const reference = (character.references || []).find((entry) => entry.id === item.referenceId);
        return `<p>✓ ${escapeHtml(reference?.referenceRole || reference?.type || item.referenceId)} <small>${escapeHtml(item.reason)}</small></p>`;
      }).join("")}`;
    $("#character-photo-choices").classList.add("hidden");
    $("#character-photo-confirmation").classList.remove("hidden");
    $("#character-photo-status").textContent = payload.cleanupWarning || "Controlla il riassunto: ComfyUI non è ancora stato chiamato.";
  } catch (error) {
    $("#character-photo-status").textContent = error.message;
    $("#character-photo-status").classList.add("prompt-assistant-error");
  } finally {
    button.disabled = false;
  }
}

function changeCharacterPhotoIdea() {
  state.photoPlan = null;
  $("#character-photo-confirmation").classList.add("hidden");
  $("#character-photo-choices").classList.remove("hidden");
  $("#character-photo-status").textContent = "Modifica le scelte oppure chiedi una nuova sorpresa.";
}

async function generateCharacterPhoto() {
  const character = selectedCharacter();
  if (!character || !state.photoPlan) return;
  const button = $("#generate-character-photo-button");
  button.disabled = true;
  const plan = {
    ...state.photoPlan,
    technicalPrompt: $("#characterPhotoTechnicalPrompt").value,
    technicalNegativePrompt: $("#characterPhotoNegativePrompt").value,
  };
  $("#character-photo-status").textContent = "Invio la fotografia confermata a ComfyUI…";
  try {
    const payload = await api(`/api/characters/${encodeURIComponent(character.id)}/create-photo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        seed: $("#characterPhotoSeed").value,
        outfitMode: $("#photoOutfitMode").value,
        qualityPreset: $("#photoQuality").value,
        advancedStages: {
          krea: $("#photoStageKrea").checked,
          klein: $("#photoStageKlein").checked,
          seedvr2: $("#photoStageSeedvr2").checked,
        },
      }),
    });
    state.photoGenerationId = payload.generation?.id;
    renderCharacterMasterPipeline(payload.generation);
    clearTimeout(state.photoPipelineTimer);
    state.photoPipelineTimer = setTimeout(pollCharacterMasterPipeline, 1000);
    $("#character-photo-status").textContent = `Pipeline in coda · ${payload.workflow?.name || payload.generation?.workflowName}`;
    showToast("Pipeline Master inviata alla coda");
  } catch (error) {
    $("#character-photo-status").textContent = error.message;
    button.disabled = false;
  }
}

$("#character-studio-content").addEventListener("click", (event) => {
  const action = event.target.closest("[data-genesis-action]")?.dataset.genesisAction;
  if (action === "start") renderGenesisStart();
  if (action === "new") renderGenesisSourceChoice();
  if (action === "existing") renderExistingChoice();
  if (action === "description") renderDescriptionForm();
  if (action === "photo") renderPhotoForm();

  const open = event.target.closest("[data-open-character]");
  if (open) {
    state.selectedId = open.dataset.openCharacter;
    renderList();
    fillEditor(selectedCharacter());
    $("#character-form").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const generate = event.target.closest("[data-generate-candidates]");
  if (generate) {
    generate.disabled = true;
    generateCandidates(generate.dataset.generateCandidates).catch(studioError);
  }
  const hero = event.target.closest("[data-select-hero]");
  if (hero) {
    hero.disabled = true;
    selectHero(hero.dataset.selectHero).catch(studioError);
  }
});

$("#character-studio-content").addEventListener("submit", (event) => {
  if (event.target.id === "genesis-description-form") {
    event.preventDefault();
    submitGenesis(event.target, "description");
  }
  if (event.target.id === "genesis-photo-form") {
    event.preventDefault();
    submitGenesis(event.target, "photo");
  }
});

$("#character-studio-content").addEventListener("change", (event) => {
  if (event.target.matches("#genesis-photo-form input[type=file]") && event.target.files?.[0]) {
    const preview = $("#genesis-photo-preview");
    preview.innerHTML = `<img src="${URL.createObjectURL(event.target.files[0])}" alt="Anteprima fotografia">`;
  }
});

$("#create-character-form").addEventListener("submit", createCharacter);
$("#character-form").addEventListener("submit", saveCharacter);
$("#delete-character-button").addEventListener("click", deleteCharacter);
$("#build-pack-button").addEventListener("click", buildPack);
$("#generate-sheet-button").addEventListener("click", generateSheet);
$("#orbit-sheet-button").addEventListener("click", async () => {
  const character = selectedCharacter();
  if (!character) return showToast("Seleziona prima un personaggio.");
  const button = $("#orbit-sheet-button");
  button.disabled = true;
  try {
    await api(`/api/characters/${encodeURIComponent(character.id)}/orbit-sheet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "character",
        description: $("#characterSheetPrompt")?.value || "",
        seed: $("#characterSheetSeed")?.value || "",
      }),
    });
    showToast("OrbitSheets avviato: turnaround, viste individuali, contact sheet e voce verranno salvati.");
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
});
$("#identity-check-button").addEventListener("click", identityCheck);
$("#create-photo-button").addEventListener("click", openCharacterPhoto);
$("#create-video-button").addEventListener("click", openCharacterVideo);
$("#prepare-photo-plan-button").addEventListener("click", prepareCharacterPhotoPlan);
$("#change-character-photo-button").addEventListener("click", changeCharacterPhotoIdea);
$("#generate-character-photo-button").addEventListener("click", generateCharacterPhoto);
$("#prepare-photo-set-button").addEventListener("click", prepareCharacterPhotoSet);
$("#create-photo-set-button").addEventListener("click", createCharacterPhotoSet);
for (const selector of ["#photoEngine", "#photoSetPreset", "#photoSetCount", "#photoSetQuality", "#photoOutfitMode", "#photoIntent"]) {
  $(selector).addEventListener(selector === "#photoIntent" ? "input" : "change", invalidatePhotoSetPreparation);
}
$("#photoOutfitMode").addEventListener("change", (event) => {
  $("#photoOutfit").classList.toggle("hidden", event.target.value !== "choose");
});
$("#photoQuality").addEventListener("change", applyPhotoQualityPreset);
$("#videoSourceMode").addEventListener("change", updateVideoSourceControls);
$("#videoDialogueEnabled").addEventListener("change", (event) => {
  $("#video-dialogue-fields").classList.toggle("hidden", !event.target.checked);
});
$("#videoAudioMode").addEventListener("change", updateVideoAudioControls);
$("#prepare-character-video-button").addEventListener("click", prepareCharacterVideo);
$("#change-character-video-button").addEventListener("click", changeCharacterVideoIdea);
$("#generate-character-video-button").addEventListener("click", generateCharacterVideo);
$("#prepare-reference-plan-button").addEventListener("click", prepareReferencePlan);
$("#referenceEngine").addEventListener("change", (event) => {
  const character = selectedCharacter();
  if (!character) return;
  state.referenceEngineSelections.set(character.id, event.target.value);
  const engine = state.referenceConfig?.engines?.find((item) => item.id === event.target.value);
  $("#reference-engine-note").textContent = engine
    ? `Selezionato ${engine.name}. Genera mancanti e Rigenera useranno ${engine.model}.`
    : "Il motore selezionato non è disponibile.";
});
$("#generate-missing-references-button").addEventListener("click", generateMissingReferences);
$("#complete-references-button").addEventListener("click", generateMissingReferences);
$("#reference-factory-content").addEventListener("click", (event) => {
  const manualApprove = event.target.closest("[data-identity-approve-reference]");
  const manualReject = event.target.closest("[data-identity-reject-reference]");
  if (manualApprove || manualReject) {
    const button = manualApprove || manualReject;
    button.disabled = true;
    reviewReferenceIdentity(
      manualApprove?.dataset.identityApproveReference || manualReject.dataset.identityRejectReference,
      manualApprove ? "approve" : "reject",
    ).catch((error) => {
      $("#reference-factory-status").textContent = error.message;
      button.disabled = false;
    });
    return;
  }
  const approve = event.target.closest("[data-reference-approve]");
  const reject = event.target.closest("[data-reference-reject]");
  const regenerate = event.target.closest("[data-reference-regenerate]");
  const button = approve || reject || regenerate;
  if (!button) return;
  button.disabled = true;
  const role = approve?.dataset.referenceApprove || reject?.dataset.referenceReject || regenerate?.dataset.referenceRegenerate;
  const action = approve ? "approve" : reject ? "reject" : "regenerate";
  decideReference(role, action, button.dataset.generationId || "").catch((error) => {
    $("#reference-factory-status").textContent = error.message;
    $("#reference-factory-status").classList.add("prompt-assistant-error");
    button.disabled = false;
  });
});
$("#referenceFiles").addEventListener("change", (event) => uploadReferences([...event.target.files]));
$("#character-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-character]");
  if (!button) return;
  state.selectedId = button.dataset.character;
  renderList();
  fillEditor(selectedCharacter());
});
$("#reference-grid").addEventListener("change", (event) => {
  const card = event.target.closest("[data-reference]");
  if (card && event.target.matches("[data-reference-type]")) updateReference(card).catch((error) => showToast(error.message));
});
$("#reference-grid").addEventListener("click", (event) => {
  const card = event.target.closest("[data-reference]");
  if (!card) return;
  if (event.target.matches("[data-delete-reference]")) deleteReference(card).catch((error) => showToast(error.message));
  if (event.target.matches("[data-identity-approve]")) reviewReferenceIdentity(card.dataset.reference, "approve").catch((error) => showToast(error.message));
  if (event.target.matches("[data-identity-reject]")) reviewReferenceIdentity(card.dataset.reference, "reject").catch((error) => showToast(error.message));
});

$("#character-generated-photos").addEventListener("click", (event) => {
  const button = event.target.closest("[data-approve-generated-photo]");
  if (!button || button.disabled) return;
  button.disabled = true;
  approveGeneratedPhoto(button.dataset.approveGeneratedPhoto).catch((error) => {
    button.disabled = false;
    showToast(error.message);
  });
});

checkHealth();
setupUploadPreviews();
refreshCharacters().catch((error) => {
  $("#character-status").textContent = error.message;
});
