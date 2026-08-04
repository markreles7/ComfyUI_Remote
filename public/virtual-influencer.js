const $ = (selector) => document.querySelector(selector);

const state = {
  config: null,
  profiles: [],
  selectedId: null,
};

const lockLabels = {
  face: "Volto",
  eyes: "Occhi",
  hair: "Capelli",
  skinTone: "Carnagione",
  bodyShape: "Corporatura",
  height: "Altezza",
  proportions: "Proporzioni",
  distinctiveMarks: "Segni distintivi",
  tattoos: "Tatuaggi",
  apparentAge: "Età apparente",
  makeupStyle: "Stile trucco",
};

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Richiesta non riuscita.");
  return data;
}

function connection(status, text) {
  const node = $("#connection");
  node.className = `connection ${status}`;
  node.innerHTML = `<span></span>${text}`;
}

function profile() {
  return state.profiles.find((item) => item.id === state.selectedId) || null;
}

function formValue(form, name) {
  return String(new FormData(form).get(name) || "").trim();
}

function listText(values) {
  return Array.isArray(values) ? values.join("\n") : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectedBiblePayload() {
  const form = $("#bible-form");
  const current = profile();
  return {
    changeLog: formValue(form, "changeLog") || "Aggiornamento Character Bible.",
    identity: {
      stageName: current.displayName,
      declaredAge: current.identityProfile.declaredAge,
      fictionalNationality: formValue(form, "fictionalNationality"),
      fictionalCity: formValue(form, "fictionalCity"),
      language: current.identityProfile.language,
      narrativeProfession: formValue(form, "narrativeProfession"),
      shortBio: current.identityProfile.shortBio,
      personalHistory: formValue(form, "personalHistory"),
      interests: formValue(form, "interests"),
      values: formValue(form, "values"),
      habits: formValue(form, "habits"),
      personalityTraits: formValue(form, "personalityTraits"),
      communicationTone: formValue(form, "communicationTone"),
      typicalLexicon: formValue(form, "typicalLexicon"),
      recurringPhrases: formValue(form, "recurringPhrases"),
      avoidedTopics: formValue(form, "avoidedTopics"),
    },
    appearance: {
      faceShape: formValue(form, "faceShape"),
      eyeColorAndShape: formValue(form, "eyeColorAndShape"),
      hair: formValue(form, "hair"),
      skinTone: formValue(form, "skinTone"),
      bodyShape: formValue(form, "bodyShape"),
      approximateHeight: formValue(form, "approximateHeight"),
      bodyProportions: formValue(form, "bodyProportions"),
      distinctiveMarks: formValue(form, "distinctiveMarks"),
      makeup: formValue(form, "makeup"),
      aestheticStyle: formValue(form, "aestheticStyle"),
      recurringAccessories: formValue(form, "recurringAccessories"),
      tattoosEnabled: Boolean($("#tattoosEnabled")?.checked),
      tattoos: formValue(form, "tattoos"),
      immutableElements: formValue(form, "immutableElements"),
    },
    identityLocks: Object.fromEntries((state.config.identityLocks || []).map((key) => [key, {
      enabled: Boolean($(`[data-lock-enabled="${key}"]`)?.checked),
      strength: Number($(`[data-lock-strength="${key}"]`)?.value || 0.75),
      tolerance: Number($(`[data-lock-tolerance="${key}"]`)?.value || 0.25),
      validationThreshold: Number($(`[data-lock-threshold="${key}"]`)?.value || 0.7),
      referenceSet: String($(`[data-lock-reference="${key}"]`)?.value || ""),
    }])),
  };
}

function renderLocks(current) {
  $("#identity-locks").innerHTML = (state.config.identityLocks || []).map((key) => {
    const lock = current?.identityLocks?.[key] || {};
    return `
      <div class="identity-lock-row">
        <label class="checkline"><input data-lock-enabled="${key}" type="checkbox" ${lock.enabled ? "checked" : ""}> ${lockLabels[key] || key}</label>
        <input data-lock-strength="${key}" type="number" min="0" max="1" step="0.05" value="${lock.strength ?? 0.75}" title="Strength">
        <input data-lock-tolerance="${key}" type="number" min="0" max="1" step="0.05" value="${lock.tolerance ?? 0.25}" title="Tolerance">
        <input data-lock-threshold="${key}" type="number" min="0" max="1" step="0.05" value="${lock.validationThreshold ?? 0.7}" title="Validation threshold">
        <input data-lock-reference="${key}" value="${(lock.referenceSet || []).join(", ")}" placeholder="reference set">
      </div>
    `;
  }).join("");
}

function fillBible(current) {
  const identity = current?.identityProfile || {};
  const appearance = current?.appearanceProfile || {};
  for (const [id, value] of Object.entries({
    fictionalNationality: identity.fictionalNationality,
    fictionalCity: identity.fictionalCity,
    narrativeProfession: identity.narrativeProfession,
    communicationTone: identity.communicationTone,
    personalHistory: identity.personalHistory,
    interests: listText(identity.interests),
    values: listText(identity.values),
    habits: listText(identity.habits),
    personalityTraits: listText(identity.personalityTraits),
    typicalLexicon: listText(identity.typicalLexicon),
    recurringPhrases: listText(identity.recurringPhrases),
    avoidedTopics: listText(identity.avoidedTopics),
    faceShape: appearance.faceShape,
    eyeColorAndShape: appearance.eyeColorAndShape,
    hair: appearance.hair,
    skinTone: appearance.skinTone,
    bodyShape: appearance.bodyShape,
    approximateHeight: appearance.approximateHeight,
    bodyProportions: appearance.bodyProportions,
    distinctiveMarks: appearance.distinctiveMarks,
    makeup: appearance.makeup,
    aestheticStyle: appearance.aestheticStyle,
    recurringAccessories: listText(appearance.recurringAccessories),
    tattoos: appearance.tattoos,
    immutableElements: listText(appearance.immutableElements),
    changeLog: "",
  })) {
    const node = $(`#${id}`);
    if (node) node.value = value || "";
  }
  const tattoosEnabled = $("#tattoosEnabled");
  if (tattoosEnabled) tattoosEnabled.checked = Boolean(appearance.tattoosEnabled);
  renderLocks(current);
}

function renderProfileList() {
  $("#profile-list").innerHTML = state.profiles.map((item) => `
    <button class="virtual-profile-card ${item.id === state.selectedId ? "active" : ""}" type="button" data-profile="${item.id}">
      <strong>${escapeHtml(item.displayName)}</strong>
      <span>${item.identityProfile.declaredAge} anni · ${escapeHtml(item.status)}</span>
      <small>${item.identityDatasetReadiness.score}/100 readiness</small>
    </button>
  `).join("") || `<p class="hint">Nessun profilo creato.</p>`;
}

function renderDashboard(current) {
  const readiness = current?.identityDatasetReadiness || {};
  $("#selected-name").textContent = current?.displayName || "Nessun profilo selezionato";
  $("#selected-meta").textContent = current
    ? `${current.identityProfile.declaredAge} anni · ${current.disclosureSettings.defaultText}`
    : "Crea o seleziona un personaggio";
  $("#readiness-score").textContent = readiness.score || 0;
  $("#reference-count").textContent = readiness.approvedCount || 0;
  $("#version-count").textContent = current?.versions?.length || 0;
  $("#dataset-warnings").innerHTML = (readiness.warnings || []).map((warning) => `<p>${warning}</p>`).join("")
    || `<p>Dataset in attesa di reference canoniche approvate.</p>`;
}

function renderReferences(current) {
  $("#reference-grid").innerHTML = (current?.referenceAssets || []).map((asset) => `
    <article class="virtual-reference">
      <img src="/api/virtual-influencer/assets/${current.id}/${asset.id}" alt="${escapeHtml(asset.originalName)}">
      <div>
        <strong>${escapeHtml(asset.originalName)}</strong>
        <span>#${asset.sortOrder ?? 0} · ${asset.width || "?"}x${asset.height || "?"} · ${escapeHtml(asset.status)}${asset.canonical ? " · canonica" : ""}</span>
        <small>${escapeHtml((asset.categories || []).join(", "))}</small>
        <small>Confronto: ${asset.comparison?.score ?? "n/d"}/100 · ${escapeHtml((asset.comparison?.warnings || []).join(" "))}</small>
        <small>${escapeHtml((asset.quality?.warnings || []).concat(asset.multiPersonCheck?.warning || []).join(" "))}</small>
      </div>
      <div class="reference-actions">
        <button type="button" data-reference-action="approve" data-asset="${asset.id}">Approva</button>
        <button type="button" data-reference-action="canonical" data-asset="${asset.id}">Canonica</button>
        <button type="button" data-reference-action="reject" data-asset="${asset.id}">Rifiuta</button>
        <button type="button" data-reference-action="order" data-asset="${asset.id}">Ordina</button>
        <button type="button" data-reference-action="remove" data-asset="${asset.id}">Rimuovi</button>
      </div>
    </article>
  `).join("") || `<p class="hint">Carica reference sintetiche originali per costruire il dataset identitario.</p>`;
}

function renderVersions(current) {
  $("#versions-list").innerHTML = (current?.versions || []).slice().reverse().map((version) => `
    <article class="virtual-version">
      <strong>v${version.versionNumber}</strong>
      <span>${escapeHtml(version.changeLog)}</span>
      <small>${new Date(version.createdAt).toLocaleString("it-IT")} · ${version.approvedReferences.length} reference</small>
    </article>
  `).join("") || `<p class="hint">Le versioni appariranno qui.</p>`;
}

function optionMarkup(items, labelKey = "name") {
  return items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item[labelKey])}</option>`).join("");
}

function renderLibraries(current) {
  const outfits = current?.outfitLibrary || [];
  const locations = current?.locationLibrary || [];
  const outfitOptions = `<option value="">Manuale</option>${optionMarkup(outfits)}`;
  const locationOptions = `<option value="">Manuale</option>${optionMarkup(locations)}`;
  $("#photoOutfitId").innerHTML = outfitOptions;
  $("#videoOutfitId").innerHTML = outfitOptions.replace("Manuale", "Nessuno");
  $("#photoLocationId").innerHTML = locationOptions;
  $("#videoLocationId").innerHTML = locationOptions.replace("Manuale", "Nessuna");
  $("#library-list").innerHTML = `
    <div>
      <h3>Outfit</h3>
      ${outfits.map((item) => `<p><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.category)} · livello ${item.sensualityLevel} · ${escapeHtml(item.id)}</span></p>`).join("") || `<p class="hint">Nessun outfit salvato.</p>`}
    </div>
    <div>
      <h3>Locations</h3>
      ${locations.map((item) => `<p><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.type)} · ${escapeHtml(item.lightingPreset || "luce manuale")} · ${escapeHtml(item.id)}</span></p>`).join("") || `<p class="hint">Nessuna location salvata.</p>`}
    </div>
  `;
}

function renderBatchQueues(current) {
  $("#batch-list").innerHTML = (current?.batchQueues || []).slice().reverse().map((queue) => `
    <article class="virtual-batch-card">
      <strong>${escapeHtml(queue.status)} · ${queue.totalOutputs} output</strong>
      <span>${escapeHtml(queue.estimates.timeMinutes)} min stimati · VRAM ${escapeHtml(queue.estimates.vram)} · ${escapeHtml(queue.estimates.diskMb)} MB</span>
      <small>Modelli: ${escapeHtml((queue.estimates.models || []).join(", "))}</small>
      <div class="reference-actions">
        <button type="button" data-batch-action="start" data-queue="${queue.id}">Pronta</button>
        <button type="button" data-batch-action="pause" data-queue="${queue.id}">Pausa</button>
        <button type="button" data-batch-action="resume" data-queue="${queue.id}">Riprendi</button>
        <button type="button" data-batch-action="cancel" data-queue="${queue.id}">Annulla</button>
      </div>
    </article>
  `).join("") || `<p class="hint">Prepara un batch per vedere stime, combinazioni e controlli.</p>`;
}

function renderContentTools(current) {
  const projects = current?.contentProjects || [];
  const projectOptions = `<option value="">Nessuno</option>${optionMarkup(projects, "title")}`;
  $("#captionProjectId").innerHTML = projectOptions;
  $("#analyticsProjectId").innerHTML = `<option value="">Seleziona</option>${optionMarkup(projects, "title")}`;
  $("#analyticsCsvProjectId").innerHTML = `<option value="">Seleziona</option>${optionMarkup(projects, "title")}`;
  $("#caption-list").innerHTML = (current?.captionDrafts || []).slice().reverse().map((draft) => `
    <article class="virtual-content-card">
      <strong>${escapeHtml(draft.platform)} · ${escapeHtml(draft.status)}</strong>
      <p>${escapeHtml(draft.caption)}</p>
      <small>${escapeHtml((draft.hashtags || []).join(" "))}</small>
      <small>${escapeHtml((draft.warnings || []).join(" "))}</small>
    </article>
  `).join("") || `<p class="hint">Le bozze caption appariranno qui.</p>`;
  $("#content-project-list").innerHTML = projects.slice().reverse().map((project) => `
    <article class="virtual-content-card">
      <strong>${escapeHtml(project.title)} · ${escapeHtml(project.status)}</strong>
      <span>${escapeHtml(project.platform)} · ${escapeHtml(project.contentType)} · ${escapeHtml(project.scheduledAt || "non programmato")}</span>
      <p>${escapeHtml(project.brief || project.campaign || "")}</p>
      <small>Caption ${project.captions?.length || 0} · Asset approvati ${project.approvedAssets?.length || 0} · Analytics ${project.analytics?.length || 0}</small>
      <div class="reference-actions">
        <button type="button" data-project-action="approve" data-project="${project.id}">Approva</button>
        <button type="button" data-project-action="schedule" data-project="${project.id}">Schedule</button>
        <button type="button" data-project-action="publish" data-project="${project.id}">Pubblica</button>
        <button type="button" data-project-action="archive" data-project="${project.id}">Archivia</button>
      </div>
    </article>
  `).join("") || `<p class="hint">Crea un progetto contenuto per pianificare caption, asset e metriche.</p>`;
  $("#analytics-list").innerHTML = (current?.analyticsEntries || []).slice().reverse().map((item) => `
    <article class="virtual-content-card">
      <strong>${escapeHtml(item.platform || "manual")} · ${item.views} views</strong>
      <span>${item.likes} like · ${item.comments} commenti · ${item.shares} share · ${item.saves} save</span>
      <small>Completion ${Math.round((item.completionRate || 0) * 100)}% · click ${item.clicks} · ${new Date(item.recordedAt).toLocaleString("it-IT")}</small>
    </article>
  `).join("") || `<p class="hint">Nessun dato analytics registrato.</p>`;
}

function fillContentSettings(current) {
  const disclosure = current?.disclosureSettings || {};
  const voice = current?.voiceProfile || {};
  for (const [id, value] of Object.entries({
    disclosureText: disclosure.defaultText,
    disclosureLabel: disclosure.label,
    captionTemplate: disclosure.captionTemplate,
    voiceProvider: voice.provider,
    voiceId: voice.voiceId,
    voiceLanguage: voice.language || current?.identityProfile?.language,
    voiceStyle: voice.style,
    captionTone: current?.personalityProfile?.tone,
    captionLanguage: current?.identityProfile?.language,
  })) {
    const node = $(`#${id}`);
    if (node) node.value = value || "";
  }
  const watermark = $("#watermarkEnabled");
  if (watermark) watermark.checked = Boolean(disclosure.watermarkEnabled);
  const voiceEnabled = $("#voiceEnabled");
  if (voiceEnabled) voiceEnabled.checked = Boolean(voice.enabled);
}

function renderPerformanceStatus(current) {
  const settings = current?.performanceSettings || {};
  const runtime = current?.runtimeStatus || {};
  $("#performance-status").innerHTML = current ? `
    <article class="virtual-content-card">
      <strong>Milestone ${escapeHtml(state.config?.milestone || "?")} · cache ${runtime.cache?.entries || 0}/${settings.cacheMaxEntries || state.config?.performance?.cacheMaxEntries || 0}</strong>
      <span>Lazy loading ${settings.lazyLoadPreviews ? "on" : "off"} · VRAM release ${settings.releaseVramBeforeGeneration ? "on" : "off"} · fallback ${escapeHtml(settings.fallbackOnLowVram || "fastPreview")}</span>
      <small>Progress e cancellazione usano la coda condivisa delle generazioni; clip lunghe oltre 10s restano pianificate via chunking.</small>
    </article>
  ` : `<p class="hint">Seleziona un profilo per leggere cache e debug.</p>`;
}

function outputPreview(asset) {
  const generationId = asset.generationIds?.[0];
  if (!generationId || !asset.outputFiles?.length) return "";
  if (asset.type === "video") {
    return `<video controls muted playsinline src="/api/media/${encodeURIComponent(generationId)}/0"></video>`;
  }
  return `<img src="/api/image/${encodeURIComponent(generationId)}/0" alt="Output ${escapeHtml(asset.type)}">`;
}

function renderGeneratedAssets(current) {
  $("#generated-assets").innerHTML = (current?.generatedAssets || []).slice().reverse().map((asset) => `
    <article class="virtual-generated">
      ${outputPreview(asset) || `<div class="virtual-output-placeholder">In coda</div>`}
      <div>
        <strong>${escapeHtml(asset.type)} · ${escapeHtml(asset.status)}</strong>
        <span>Identity ${asset.review?.identityScore ?? "n/d"} · Anatomy ${asset.review?.anatomyScore ?? "n/d"}${asset.type === "video" ? ` · Temporal ${asset.review?.temporalIdentityScore ?? "n/d"}` : ""}</span>
        <small>${escapeHtml(asset.disclosure?.text || "")}</small>
        <small>${escapeHtml((asset.review?.detectedProblems || []).join(" "))}</small>
      </div>
      <div class="reference-actions">
        <button type="button" data-generated-action="approve" data-asset="${asset.id}">Approva</button>
        <button type="button" data-generated-action="reject" data-asset="${asset.id}">Scarta</button>
        <button type="button" data-generated-action="correct" data-asset="${asset.id}">Correggi</button>
        <button type="button" data-generated-action="regenerate" data-asset="${asset.id}">Rigenera</button>
        <button type="button" data-generated-action="compare" data-asset="${asset.id}">Confronta versioni</button>
        <button type="button" data-generated-action="export" data-preset="instagramFeed" data-asset="${asset.id}">IG Feed</button>
        <button type="button" data-generated-action="export" data-preset="instagramStory" data-asset="${asset.id}">Story</button>
        <button type="button" data-generated-action="export" data-preset="tiktok" data-asset="${asset.id}">TikTok</button>
      </div>
    </article>
  `).join("") || `<p class="hint">Le foto generate appariranno qui per review ed export.</p>`;
}

function render() {
  const current = profile();
  renderProfileList();
  renderDashboard(current);
  fillBible(current);
  renderReferences(current);
  renderVersions(current);
  renderLibraries(current);
  renderGeneratedAssets(current);
  renderBatchQueues(current);
  renderContentTools(current);
  fillContentSettings(current);
  renderPerformanceStatus(current);
  const disabled = !current;
  $("#bible-form").querySelectorAll("input, textarea, button").forEach((node) => { node.disabled = disabled; });
  $("#reference-form").querySelectorAll("input, button").forEach((node) => { node.disabled = disabled; });
  $("#photo-form").querySelectorAll("input, textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#video-form").querySelectorAll("input, textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#outfit-form").querySelectorAll("input, textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#location-form").querySelectorAll("input, textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#batch-form").querySelectorAll("input, button").forEach((node) => { node.disabled = disabled; });
  $("#caption-form").querySelectorAll("input, textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#disclosure-form").querySelectorAll("input, textarea, button").forEach((node) => { node.disabled = disabled; });
  $("#voice-form").querySelectorAll("input, button").forEach((node) => { node.disabled = disabled; });
  $("#content-project-form").querySelectorAll("input, textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#analytics-form").querySelectorAll("input, select, button").forEach((node) => { node.disabled = disabled; });
  $("#analytics-csv-form").querySelectorAll("textarea, select, button").forEach((node) => { node.disabled = disabled; });
  $("#debug-report-button").disabled = disabled;
  $("#invalidate-cache-button").disabled = disabled;
  $("#manual-version").disabled = disabled;
}

async function refresh(selectId = state.selectedId) {
  const { profiles } = await api("/api/virtual-influencer/profiles");
  state.profiles = profiles;
  state.selectedId = selectId || profiles[0]?.id || null;
  render();
}

$("#profile-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-profile]");
  if (!button) return;
  state.selectedId = button.dataset.profile;
  render();
});

$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const form = event.currentTarget;
    const payload = {
      displayName: formValue(form, "displayName"),
      declaredAge: Number(formValue(form, "declaredAge")),
      synthetic: new FormData(form).get("synthetic") === "on",
      imitatesRealPerson: new FormData(form).get("noImitation") !== "on",
      identity: {
        language: formValue(form, "language"),
        shortBio: formValue(form, "shortBio"),
      },
    };
    const { profile: created } = await api("/api/virtual-influencer/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    $("#declaredAge").value = state.config.minDeclaredAge;
    await refresh(created.id);
    connection("online", "Creato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#bible-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    await api(`/api/virtual-influencer/profiles/${state.selectedId}/bible`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selectedBiblePayload()),
    });
    await refresh(state.selectedId);
    connection("online", "Bible salvata");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#reference-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const data = new FormData(form);
    await api(`/api/virtual-influencer/profiles/${state.selectedId}/references`, {
      method: "POST",
      body: data,
    });
    form.reset();
    await refresh(state.selectedId);
    connection("online", "Reference aggiunta");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#reference-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-reference-action]");
  if (!button || !profile()) return;
  const action = button.dataset.referenceAction;
  if (action === "remove") {
    try {
      await api(`/api/virtual-influencer/profiles/${state.selectedId}/references/${button.dataset.asset}`, {
        method: "DELETE",
      });
      await refresh(state.selectedId);
      connection("online", "Reference rimossa");
    } catch (error) {
      connection("offline", error.message);
    }
    return;
  }
  const currentAsset = profile().referenceAssets.find((asset) => asset.id === button.dataset.asset);
  const body = action === "approve"
    ? { status: "approved" }
    : action === "reject"
      ? { status: "rejected", canonical: false }
      : action === "order"
        ? { sortOrder: Number(prompt("Nuova posizione nel dataset", currentAsset?.sortOrder ?? 0)) }
        : { status: "approved", canonical: true };
  if (action === "order" && !Number.isFinite(body.sortOrder)) return;
  try {
    await api(`/api/virtual-influencer/profiles/${state.selectedId}/references/${button.dataset.asset}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh(state.selectedId);
    connection("online", "Dataset aggiornato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#manual-version").addEventListener("click", async () => {
  if (!profile()) return;
  try {
    await api(`/api/virtual-influencer/profiles/${state.selectedId}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ changeLog: "Snapshot manuale dell'identità." }),
    });
    await refresh(state.selectedId);
    connection("online", "Versione creata");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#outfit-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/outfits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Outfit salvato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#location-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/locations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Location salvata");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#photo-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    if (payload.seed === "") delete payload.seed;
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/photos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Foto in coda");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#video-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    if (payload.seed === "") delete payload.seed;
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/videos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Video in coda");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#generated-assets").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-generated-action]");
  if (!button || !profile()) return;
  const action = button.dataset.generatedAction;
  try {
  const path = action === "export"
      ? `/api/virtual-influencer/profiles/${state.selectedId}/generated-assets/${button.dataset.asset}/export`
      : action === "compare"
        ? `/api/virtual-influencer/profiles/${state.selectedId}/generated-assets/${button.dataset.asset}/compare-versions`
      : `/api/virtual-influencer/profiles/${state.selectedId}/generated-assets/${button.dataset.asset}/review`;
    const body = action === "export"
      ? { preset: button.dataset.preset }
      : action === "compare"
        ? {}
      : { action };
    const result = await api(path, {
      method: action === "export" || action === "compare" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    if (result.comparison) $("#debug-report-output").textContent = JSON.stringify(result.comparison, null, 2);
    connection("online", action === "export" ? "Export salvato" : "Review aggiornata");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#batch-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Batch preparato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#batch-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-batch-action]");
  if (!button || !profile()) return;
  try {
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/batches/${button.dataset.queue}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: button.dataset.batchAction }),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Batch aggiornato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#caption-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/captions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Caption creata");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#disclosure-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.watermarkEnabled = new FormData(event.currentTarget).get("watermarkEnabled") === "on";
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/disclosure`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Disclosure salvata");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#voice-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    payload.enabled = data.get("enabled") === "on";
    payload.syntheticOriginal = data.get("syntheticOriginal") === "on";
    payload.licensed = data.get("licensed") === "on";
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/voice`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Voice profile salvato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#content-project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/content-projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    form.reset();
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Progetto creato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#content-project-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-project-action]");
  if (!button || !profile()) return;
  const statusByAction = {
    approve: "Approved",
    schedule: "Scheduled",
    publish: "Published",
    archive: "Archived",
  };
  try {
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/content-projects/${button.dataset.project}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: statusByAction[button.dataset.projectAction], humanApproved: true }),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Progetto aggiornato");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#analytics-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!payload.projectId) throw new Error("Seleziona un progetto.");
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/content-projects/${payload.projectId}/analytics`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", "Analytics registrati");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#analytics-csv-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!profile()) return;
  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (!payload.projectId) throw new Error("Seleziona un progetto.");
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/content-projects/${payload.projectId}/analytics/import-csv`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    render();
    connection("online", `${result.imported.length} righe CSV`);
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#debug-report-button").addEventListener("click", async () => {
  if (!profile()) return;
  try {
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/debug-report`);
    $("#debug-report-output").textContent = JSON.stringify(result.report, null, 2);
    connection("online", "Debug report");
  } catch (error) {
    connection("offline", error.message);
  }
});

$("#invalidate-cache-button").addEventListener("click", async () => {
  if (!profile()) return;
  try {
    const result = await api(`/api/virtual-influencer/profiles/${state.selectedId}/cache/invalidate`, {
      method: "POST",
    });
    state.profiles = state.profiles.map((item) => item.id === result.profile.id ? result.profile : item);
    $("#debug-report-output").textContent = `Cache rimossa: ${result.removed} snapshot`;
    render();
    connection("online", "Cache svuotata");
  } catch (error) {
    connection("offline", error.message);
  }
});

async function init() {
  try {
    state.config = await api("/api/virtual-influencer/config");
    $("#min-age-pill").textContent = `Età minima ${state.config.minDeclaredAge}`;
    $("#declaredAge").min = state.config.minDeclaredAge;
    $("#declaredAge").value = state.config.minDeclaredAge;
    $("#outfitCategory").innerHTML = (state.config.outfitCategories || []).map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    $("#locationType").innerHTML = (state.config.locationCategories || []).map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    const contentLevels = state.config.identityEngine?.contentLevels || [];
    const contentOptions = contentLevels.map((item) =>
      `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} ${escapeHtml(item.name)}</option>`
    ).join("");
    if (contentOptions) {
      $("#contentLevel").innerHTML = contentOptions;
      $("#videoContentLevel").innerHTML = contentOptions;
      $("#outfitSensuality").max = String(Math.max(...contentLevels.map((item) => Number(item.id)).filter(Number.isFinite)));
    }
    const platformOptions = (state.config.platforms || []).map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
    $("#captionPlatform").innerHTML = platformOptions;
    $("#projectPlatform").innerHTML = platformOptions;
    if (!state.config.enabled) throw new Error("Virtual Influencer Studio disabilitato.");
    await refresh();
    connection("online", "Pronto");
  } catch (error) {
    connection("offline", error.message);
  }
}

init();
