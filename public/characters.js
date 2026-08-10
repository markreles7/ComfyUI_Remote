import { setupUploadPreviews } from "./upload-previews.js";

const state = {
  characters: [],
  selectedId: null,
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
  const checklist = character.checklist || {};
  const warnings = character.assetWarnings || [];
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
  if (!report.status) {
    $("#identity-report").innerHTML = `<p class="hint">Identity Check non ancora eseguito.</p>`;
    return;
  }
  const score = report.averageSimilarity == null
    ? ""
    : ` · avg ${Number(report.averageSimilarity).toFixed(3)} · min ${Number(report.minSimilarity).toFixed(3)}`;
  $("#identity-report").innerHTML = `
    <p class="hint"><b>Identity:</b> ${escapeHtml(report.status)}${escapeHtml(score)}</p>
    ${report.warning ? `<p class="form-error">${escapeHtml(report.warning)}</p>` : ""}
  `;
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

  $("#editor-title").textContent = character.name;
  $("#pack-status").textContent = `Character Pack: ${character.packStatus}`;
  $("#pack-status").className = `pack-status ${packClass(character.packStatus)}`;
  $("#characterName").value = character.name || "";
  $("#characterDescription").value = character.description || "";
  $("#identityStrength").value = character.settings?.identityStrength || "medium";
  $("#hintFace").value = character.identityHints?.face || "";
  $("#hintHair").value = character.identityHints?.hair || "";
  $("#hintBody").value = character.identityHints?.body || "";
  $("#wardrobe").value = Array.isArray(character.wardrobe) ? character.wardrobe.join(", ") : "";
  $("#lockFace").checked = character.settings?.lockFace !== false;
  $("#lockHair").checked = character.settings?.lockHair !== false;
  $("#lockBody").checked = character.settings?.lockBody !== false;
  $("#lockOutfit").checked = character.settings?.lockOutfit === true;

  $("#character-hero-image").classList.toggle("hidden", !character.heroUrl);
  $("#character-hero-placeholder").classList.toggle("hidden", Boolean(character.heroUrl));
  if (character.heroUrl) $("#character-hero-image").src = character.heroUrl;

  renderPackChecklist(character);
  renderIdentityReport(character);
  renderReferences(character);
}

function renderReferences(character) {
  const references = character.references || [];
  $("#reference-grid").innerHTML = references.length
    ? references.map((reference) => `
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
        <small>${escapeHtml(reference.originalName)} · ${reference.assetAvailable ? escapeHtml(reference.preprocessing?.capabilities?.faceDetection || "fallback") : "asset missing"}</small>
      </article>
    `).join("")
    : `<p class="muted">Carica hero image, character sheet o reference da piu' angolazioni.</p>`;
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
  return {
    name: $("#characterName").value,
    description: $("#characterDescription").value,
    wardrobe: $("#wardrobe").value,
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
  };
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

$("#create-character-form").addEventListener("submit", createCharacter);
$("#character-form").addEventListener("submit", saveCharacter);
$("#delete-character-button").addEventListener("click", deleteCharacter);
$("#build-pack-button").addEventListener("click", buildPack);
$("#generate-sheet-button").addEventListener("click", generateSheet);
$("#identity-check-button").addEventListener("click", identityCheck);
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
  if (card && event.target.matches("[data-delete-reference]")) deleteReference(card).catch((error) => showToast(error.message));
});

checkHealth();
setupUploadPreviews();
refreshCharacters().catch((error) => {
  $("#character-status").textContent = error.message;
});
