import { enhanceMainPrompt } from "./prompt-assistant.js";
import { createAdaptivePoller } from "./runtime-cache.js";

const $ = (selector) => document.querySelector(selector);
const state = { config: null, generations: [], eventSource: null };

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}
function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML; }
function toast(message) { const node = $("#toast"); node.textContent = message; node.classList.add("visible"); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove("visible"), 2800); }
function engine() { return document.querySelector('[name="audioEngine"]:checked')?.value || "minimaxH3"; }
function capability() { return state.config?.engines?.find((item) => item.id === engine()); }
function optionMarkup(values) { return (values || []).map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join(""); }

function updateMode() {
  const h3 = engine() === "minimaxH3";
  const song = h3 && $("#audioMode").value === "song";
  $("#h3-audio-fields").classList.toggle("hidden", !h3);
  $("#h3-song-fields").classList.toggle("hidden", !song);
  $("#h3-detail-fields").classList.toggle("hidden", !h3);
  $("#h3-steps-field").classList.toggle("hidden", !h3);
  $("#h3-advanced-fields").classList.toggle("hidden", !h3);
  $("#audioDuration").min = h3 ? "5" : "2";
  $("#audioDuration").max = h3 ? "60" : "20";
  if (Number($("#audioDuration").value) > Number($("#audioDuration").max)) $("#audioDuration").value = h3 ? "20" : "10";
  $("#audio-duration-hint").textContent = h3 ? "5–60 secondi" : "2–20 secondi";
  $("#audio-readiness").className = `video-readiness ${capability()?.available ? "ready" : "missing"}`;
  $("#audio-readiness").textContent = capability()?.available ? `${capability().name} pronto` : capability()?.reason || "Motore non disponibile";
  $("#audio-submit").disabled = !capability()?.available;
}

function formatDate(value) { return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function statusLabel(value) { return ({ queued: "In coda", running: "In lavorazione", completed: "Completata", error: "Errore", interrupted: "Annullata" })[value] || value; }
function render() {
  const container = $("#audio-results");
  if (!state.generations.length) { container.innerHTML = '<p class="empty-state">Le tracce generate compariranno qui.</p>'; return; }
  container.innerHTML = state.generations.map((item) => `
    <article class="audio-result-card">
      <div class="audio-result-heading"><div><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}${item.status === "running" ? ` · ${item.progress || 0}%` : ""}</span><h3>${escapeHtml(item.workflowName)}</h3><small>${escapeHtml(formatDate(item.createdAt))} · ${escapeHtml(item.duration || "—")} s · seed ${escapeHtml(item.seed ?? "—")}</small></div>${["queued", "running"].includes(item.status) ? `<button class="ghost-button compact" data-cancel="${item.id}" type="button">Annulla</button>` : ""}</div>
      <p>${escapeHtml(item.prompt || "")}</p>
      ${(item.audios || []).map((audio, index) => `<audio controls preload="metadata" src="/api/audio/${item.id}/${index}"></audio><a class="download" href="/api/audio/${item.id}/${index}?download=1" download>Download ${escapeHtml(audio.filename)} ↓</a>`).join("")}
      ${item.error ? `<p class="form-error">${escapeHtml(item.error)}</p>` : ""}
    </article>`).join("");
}

async function loadGenerations() { state.generations = await api("/api/audio-studio/generations?limit=30"); render(); }
async function loadConfig() {
  state.config = await api("/api/audio-studio/config");
  $("#audio-ready-count").textContent = `${state.config.engines.filter((item) => item.available).length}/${state.config.engines.length}`;
  $("#musicPreset").innerHTML = optionMarkup(state.config.h3.presets);
  $("#audioSampler").innerHTML = optionMarkup(state.config.h3.samplers);
  $("#audioScheduler").innerHTML = optionMarkup(state.config.h3.schedulers);
  for (const radio of document.querySelectorAll('[name="audioEngine"]')) {
    const item = state.config.engines.find((candidate) => candidate.id === radio.value);
    radio.disabled = !item?.available;
  }
  const selected = document.querySelector('[name="audioEngine"]:checked');
  if (selected?.disabled) document.querySelector('[name="audioEngine"]:not(:disabled)')?.click();
  updateMode();
}

$("#audio-studio-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#audio-submit"); const error = $("#audio-form-error");
  button.disabled = true; error.textContent = "";
  try {
    const body = Object.fromEntries(new FormData(event.currentTarget));
    const result = await api("/api/audio-studio/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    state.generations.unshift(result); render(); toast("Generazione audio accodata");
  } catch (failure) { error.textContent = failure.message; }
  finally { button.disabled = !capability()?.available; }
});

$("#audio-prompt-assistant").addEventListener("click", () => enhanceMainPrompt({
  input: $("#audioPrompt"), button: $("#audio-prompt-assistant"), status: $("#audio-prompt-status"),
  target: "audio_music", workflowName: engine() === "minimaxH3" ? "MiniMax H3 Music Studio" : "LTX 2.5 Text to Audio",
  mode: "text", duration: $("#audioDuration").value,
  text: `Engine: ${engine()}. Output type: ${engine() === "minimaxH3" ? $("#audioMode").value : "text-to-audio"}. Music preset: ${$("#musicPreset").value}. Target duration: ${$("#audioDuration").value} seconds. User request: ${$("#audioPrompt").value}`,
}).then(() => toast("Prompt audio preparato; premi Genera audio quando vuoi.")).catch(() => {}));

$("#audio-results").addEventListener("click", async (event) => { const button = event.target.closest("[data-cancel]"); if (!button) return; button.disabled = true; try { await api(`/api/generations/${button.dataset.cancel}/cancel`, { method: "POST" }); await loadGenerations(); } catch (error) { toast(error.message); } });
document.querySelectorAll('[name="audioEngine"]').forEach((node) => node.addEventListener("change", updateMode));
$("#audioMode").addEventListener("change", updateMode);
$("#audioQuality").addEventListener("change", () => {
  const preset = {
    preview: { steps: 14, canvas: "32" },
    balanced: { steps: 20, canvas: "32" },
    final: { steps: 30, canvas: "64" },
  }[$("#audioQuality").value];
  if (preset && engine() === "minimaxH3") {
    $("#audioSteps").value = String(preset.steps);
    $("#audioCanvas").value = preset.canvas;
  }
});

function connectEvents() { state.eventSource?.close(); state.eventSource = new EventSource("/api/events"); state.eventSource.onmessage = (event) => { let message; try { message = JSON.parse(event.data); } catch { return; } if (message.type === "connection") { $("#connection").className = `connection ${message.connected ? "online" : "offline"}`; $("#connection").innerHTML = `<span></span>${message.connected ? "ComfyUI online" : "ComfyUI offline"}`; } if (message.generationId) loadGenerations().catch(() => {}); }; }

Promise.all([loadConfig(), loadGenerations()]).then(() => { connectEvents(); createAdaptivePoller(loadGenerations, { idleMs: 8000, hiddenMs: 30000 }); }).catch((error) => { $("#audio-form-error").textContent = error.message; });
