const mounts = [...document.querySelectorAll("[data-scene-integration]")];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore HTTP ${response.status}`);
  return payload;
}

function metric(profile, path, fallback = "—") {
  let value = profile;
  for (const key of path.split(".")) value = value?.[key];
  if (value && typeof value === "object" && "value" in value) value = value.value;
  if (value == null) return fallback;
  if (typeof value === "number") return Number(value.toFixed(3));
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function confidence(profile, section) {
  const value = profile?.confidenceScores?.[section];
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function findSourceFile(form) {
  const preferred = [
    "sourceImage", "image", "video", "sourceVideo", "retakeVideo",
    "extendVideo", "temporalVideo", "interpolationVideo", "firstFrame",
  ];
  for (const name of preferred) {
    const inputs = [...form.querySelectorAll(`input[type="file"][name="${name}"]`)];
    const selected = inputs.find((input) => input.files?.[0] && !input.disabled);
    if (selected) return selected.files[0];
  }
  return [...form.querySelectorAll('input[type="file"]')]
    .find((input) => input.files?.[0] && !input.disabled)?.files?.[0] || null;
}

function settingsFrom(root, profileId) {
  const value = (name) => root.querySelector(`[data-si="${name}"]`);
  return {
    enabled: value("enabled").checked,
    profileId,
    preset: value("preset").value,
    reuseAnalysis: value("reuse").checked,
    autoPlacement: value("placement").checked,
    autoRelighting: value("relighting").checked,
    matchColor: value("color").checked,
    matchBlur: value("blur").checked,
    grainMode: value("grain").value,
    customGrain: Number(value("customGrain").value),
    preserveBackground: value("background").checked,
    temporalConsistency: value("temporal").checked,
    occlusionHandling: value("occlusion").checked,
    contactShadows: value("shadow").checked,
    correctionIterations: Number(value("iterations").value),
    debugArtifacts: value("debug").checked,
  };
}

function renderProfile(root, profile) {
  const target = root.querySelector("[data-si-profile]");
  if (!profile) {
    target.innerHTML = '<p class="hint">Nessuna scena analizzata.</p>';
    return;
  }
  const rows = [
    ["Luce", `${metric(profile, "lightingProfile.mainDirection")} · conf. ${confidence(profile, "lighting")}`],
    ["Colore", `${metric(profile, "colorProfile.temperature")} K · sat. ${metric(profile, "colorProfile.meanSaturation")}`],
    ["Camera", `nitidezza ${metric(profile, "cameraProfile.apparentSharpness")} · orizzonte ${metric(profile, "cameraProfile.horizonPosition")}`],
    ["Profondità", `${metric(profile, "spatialProfile.depthMap")} · conf. ${confidence(profile, "spatial")}`],
    ["Movimento", profile.mediaType === "video"
      ? `${metric(profile, "temporalProfile.cameraMotion")} · conf. ${confidence(profile, "temporal")}`
      : "Fotografia statica"],
    ["Grana", `${metric(profile, "textureProfile.grainAmount")} · conf. ${confidence(profile, "texture")}`],
    ["Confidenza", `${Math.round(Number(profile.confidenceScores?.overall || 0) * 100)}%`],
  ];
  const artifacts = Object.entries(profile.artifacts || {});
  target.innerHTML = `
    <div class="scene-profile-header">
      <div><b>Scene Profile ${escapeHtml(profile.version)}</b><small>${escapeHtml(profile.mediaType)} · ${escapeHtml(profile.sourceMetadata?.width)}×${escapeHtml(profile.sourceMetadata?.height)}${profile.analysisStatus?.state ? ` · ${escapeHtml(profile.analysisStatus.state)}` : ""}</small></div>
      <a class="chip-button" href="/api/scene-integration/profiles/${encodeURIComponent(profile.id)}/export">Esporta JSON</a>
    </div>
    <div class="scene-profile-grid">
      ${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join("")}
    </div>
    ${profile.analysisWarnings?.length ? `
      <details class="scene-warnings"><summary>${profile.analysisWarnings.length} avvisi di analisi</summary>
        <ul>${profile.analysisWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
      </details>` : ""}
    ${artifacts.length ? `
      <div class="scene-debug-grid">
        ${artifacts.map(([label, file]) => `
          <figure><img src="/api/scene-integration/artifacts/${encodeURIComponent(profile.id)}/${encodeURIComponent(file)}" alt="${escapeHtml(label)}">
          <figcaption>${escapeHtml(label)}</figcaption></figure>`).join("")}
      </div>` : ""}
  `;
}

function template() {
  return `
    <div class="scene-integration-panel">
      <header class="scene-integration-heading">
        <div>
          <p class="eyebrow">SCENE INTEGRATION</p>
          <h3>Integra soggetto e scena</h3>
          <p>Analizza luce, colore, camera, profondità, movimento e texture prima della generazione.</p>
        </div>
        <label class="scene-master-toggle"><input data-si="enabled" type="checkbox"><span>Abilita</span></label>
      </header>
      <input data-si-payload name="sceneIntegration" type="hidden" value='{"enabled":false}'>
      <div class="scene-integration-body hidden" data-si-body>
        <div class="scene-analysis-actions">
          <label>Preset
            <select data-si="preset">
              <option value="preview">Fast Preview</option>
              <option value="balanced" selected>Balanced</option>
              <option value="maximum">Maximum Integration</option>
            </select>
          </label>
          <button class="primary-action compact" data-si-analyze type="button">Analizza scena</button>
          <label class="chip-button scene-import">Importa profilo<input data-si-import type="file" accept="application/json,.json"></label>
        </div>
        <label class="scene-inline-check"><input data-si="reuse" type="checkbox" checked> Riutilizza l’analisi memorizzata</label>
        <p class="scene-integration-status" data-si-status></p>
        <div class="scene-profile-summary" data-si-profile><p class="hint">Nessuna scena analizzata.</p></div>
        <div class="scene-control-grid">
          <label><input data-si="placement" type="checkbox" checked><span><b>Auto placement</b><small>Scala, piano e contatto stimati</small></span></label>
          <label><input data-si="relighting" type="checkbox" checked><span><b>Auto relighting</b><small>Solo se supportato dall’adapter</small></span></label>
          <label><input data-si="color" type="checkbox" checked><span><b>Match color</b><small>Armonizzazione LAB finale</small></span></label>
          <label><input data-si="blur" type="checkbox"><span><b>Match blur</b><small>Solo video; sulle foto resta nitida</small></span></label>
          <label><input data-si="background" type="checkbox" checked><span><b>Preserva sfondo</b><small>Pixel esterni alla maschera invariati</small></span></label>
          <label><input data-si="temporal" type="checkbox" checked><span><b>Coerenza temporale</b><small>Per video e tracking</small></span></label>
          <label><input data-si="occlusion" type="checkbox" checked><span><b>Occlusioni</b><small>Richiede mask/depth affidabile</small></span></label>
          <label><input data-si="shadow" type="checkbox" checked><span><b>Contact shadow</b><small>Applicata solo con zona definita</small></span></label>
        </div>
        <details class="advanced-settings scene-advanced">
          <summary>Controlli avanzati <span>Finishing, iterazioni e debug</span></summary>
          <div class="advanced-settings-body field-grid">
            <div class="field"><label>Film grain</label><select data-si="grain"><option value="off">Off</option><option value="match" selected>Match source</option><option value="custom">Custom</option></select></div>
            <div class="field"><label>Grana custom</label><input data-si="customGrain" type="number" min="0.001" max="0.25" step="0.001" value="0.04"></div>
            <div class="field"><label>Iterazioni correzione</label><input data-si="iterations" type="number" min="0" max="3" step="1" value="2"></div>
            <label class="scene-inline-check"><input data-si="debug" type="checkbox"> Salva depth proxy, bordi, istogrammi e optical flow</label>
          </div>
        </details>
      </div>
    </div>
  `;
}

async function mountSceneIntegration(mount) {
  const form = mount.closest("form");
  if (!form) return;
  mount.innerHTML = template();
  const root = mount;
  const enabled = root.querySelector('[data-si="enabled"]');
  const body = root.querySelector("[data-si-body]");
  const payload = root.querySelector("[data-si-payload]");
  const status = root.querySelector("[data-si-status]");
  const preset = root.querySelector('[data-si="preset"]');
  const iterations = root.querySelector('[data-si="iterations"]');
  let profile = null;
  let profilePollToken = 0;

  const pollProfile = async (profileId) => {
    const token = ++profilePollToken;
    for (let attempt = 0; attempt < 600 && token === profilePollToken; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const current = await api(`/api/scene-integration/profiles/${encodeURIComponent(profileId)}`);
      profile = current;
      renderProfile(root, profile);
      sync();
      if (current.analysisStatus?.state === "completed") {
        status.textContent = "Depth, segmentazione e Scene Profile completati.";
        status.dataset.state = "ok";
        return;
      }
      if (current.analysisStatus?.state === "error") {
        status.textContent = current.analysisStatus.error || "Analisi ComfyUI non riuscita.";
        status.dataset.state = "error";
        return;
      }
      status.textContent = `Scene Profile pronto; depth/segmentazione ${current.analysisStatus?.state || "in coda"} in ComfyUI…`;
      status.dataset.state = "busy";
    }
  };

  const sync = () => {
    body.classList.toggle("hidden", !enabled.checked);
    payload.value = JSON.stringify(settingsFrom(root, profile?.id || null));
  };
  root.addEventListener("change", (event) => {
    if (event.target === preset) {
      iterations.value = { preview: 1, balanced: 2, maximum: 3 }[preset.value] || 2;
    }
    sync();
  });
  enabled.addEventListener("change", sync);

  root.querySelector("[data-si-analyze]").addEventListener("click", async () => {
    const file = findSourceFile(form);
    if (!file) {
      status.textContent = "Carica prima l’immagine o il video originale nel workflow.";
      status.dataset.state = "error";
      return;
    }
    status.textContent = "Analisi in corso… per i video può richiedere qualche minuto.";
    status.dataset.state = "busy";
    const data = new FormData();
    data.set("sceneSource", file, file.name);
    data.set("settings", JSON.stringify(settingsFrom(root, null)));
    try {
      const result = await api("/api/scene-integration/analyze", { method: "POST", body: data });
      profile = result.profile;
      renderProfile(root, profile);
      status.textContent = result.cached ? "Scene Profile recuperato dalla cache." : "Analisi completata.";
      status.dataset.state = "ok";
      sync();
      if (result.analysisPending) {
        status.textContent = "Scene Profile base pronto; depth e segmentazione sono in coda ComfyUI.";
        status.dataset.state = "busy";
        void pollProfile(profile.id).catch((error) => {
          status.textContent = error.message;
          status.dataset.state = "error";
        });
      }
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
    }
  });

  root.querySelector("[data-si-import]").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      profile = await api("/api/scene-integration/profiles/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: imported }),
      });
      renderProfile(root, profile);
      status.textContent = "Scene Profile importato.";
      status.dataset.state = "ok";
      enabled.checked = true;
      sync();
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = "error";
    }
  });

  form.addEventListener("submit", sync, { capture: true });
  try {
    const config = await api("/api/scene-integration/config");
    if (!config.enabled || !config.runtime?.available) {
      enabled.disabled = true;
      status.textContent = config.runtime?.reason || "Scene Integration disabilitato dal server.";
      status.dataset.state = "error";
    }
  } catch (error) {
    enabled.disabled = true;
    status.textContent = error.message;
    status.dataset.state = "error";
  }
  sync();
}

mounts.forEach((mount) => mountSceneIntegration(mount));
