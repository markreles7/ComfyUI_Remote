import { saveGuidedHandoff } from "./guided-handoff.js";
import { setupUploadPreviews } from "./upload-previews.js";
import { getAppConfig, warmAppConfig } from "./runtime-cache.js";

void warmAppConfig();

const $ = (selector) => document.querySelector(selector);
const state = {
  config: null,
  step: 0,
  sourceVideo: null,
  temporaryReference: null,
  characterId: "",
  actorName: "Marco",
  start: 2,
  end: 7,
  entryAction: "enters from the left, walks naturally into the room, approaches the table and turns his face toward the camera",
  dialogue: "",
  reaction: "the original actors briefly turn and look toward the added actor",
  anchorWorkflow: "qwen-image-edit",
  quality: "preview",
  busy: false,
};

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = String(value ?? "");
  return node.innerHTML;
}

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 2800);
}

function message(role, html) {
  const node = document.createElement("article");
  node.className = `guided-message ${role}`;
  node.innerHTML = role === "assistant"
    ? `<span class="guided-avatar">IC</span><div>${html}</div>`
    : `<div>${html}</div>`;
  $("#cast-guide-messages").append(node);
  node.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function selectedCharacterName() {
  return (state.config?.characters?.availableCharacters || [])
    .find((character) => character.id === state.characterId)?.name || "Reference temporanea";
}

function renderSummary() {
  const items = [
    ["Clip", state.sourceVideo?.name || "Da caricare"],
    ["Nuovo attore", state.actorName || "Da definire"],
    ["Identità", selectedCharacterName()],
    ["Finestra", `${state.start.toFixed(1)}-${state.end.toFixed(1)} s`],
    ["Anchor", {
      "qwen-image-edit": "Qwen Image Edit 2511",
      "qwen-krea-klein": "Qwen / Krea / Klein",
      "krea-triple": "Krea Triple",
    }[state.anchorWorkflow]],
    ["Qualità", state.quality === "max" ? "Massima" : "Anteprima"],
  ];
  $("#cast-guide-summary").innerHTML = items.map(([label, value]) =>
    `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`
  ).join("");
  const identityReady = Boolean(state.characterId || state.temporaryReference);
  const ready = Boolean(state.sourceVideo && identityReady && state.actorName && state.end > state.start);
  $("#cast-guide-readiness").innerHTML = `<span class="${ready ? "ready" : "pending"}"></span>${ready ? "Piano pronto per Video Studio" : "Completa clip, identità e tempi"}`;
  $("#cast-guide-open").disabled = !ready || state.busy;
}

function setComposer(html) {
  $("#cast-guide-composer").innerHTML = html;
  setupUploadPreviews($("#cast-guide-composer"));
}

function askSource() {
  state.step = 1;
  $("#cast-guide-step").textContent = "1 · Scena sorgente";
  message("assistant", "<b>Partiamo dalla regia originale.</b><p>Carica uno shot continuo. Tutto ciò che non appartiene alla finestra di ingresso resterà originale.</p>");
  setComposer(`
    <label class="dropzone guided-upload">
      <input id="cast-guide-source" type="file" accept="video/*">
      <span class="upload-icon">▶</span><strong>Carica il video originale</strong><small>MP4, WebM, MOV, MKV o AVI</small>
    </label>
    <button id="cast-source-next" class="primary-action" type="button" disabled>Continua</button>
  `);
  $("#cast-guide-source").addEventListener("change", (event) => {
    state.sourceVideo = event.currentTarget.files?.[0] || null;
    $("#cast-source-next").disabled = !state.sourceVideo;
    renderSummary();
  });
  $("#cast-source-next").addEventListener("click", () => {
    message("user", escapeHtml(state.sourceVideo.name));
    askIdentity();
  });
}

function askIdentity() {
  state.step = 2;
  $("#cast-guide-step").textContent = "2 · Identità";
  const characters = state.config?.characters?.availableCharacters || [];
  message("assistant", "<b>Chi deve entrare?</b><p>Puoi usare un Character Pack oppure una reference temporanea. Per il volto è preferibile una foto pulita, frontale o a tre quarti.</p>");
  setComposer(`
    <label class="guided-field"><span>Character Pack</span><select id="cast-guide-character">
      <option value="">Reference temporanea</option>
      ${characters.map((character) => `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`).join("")}
    </select></label>
    <label class="dropzone guided-upload">
      <input id="cast-guide-reference" type="file" accept="image/png,image/jpeg,image/webp">
      <span class="upload-icon">↗</span><strong>Carica reference temporanea</strong><small>Necessaria se non scegli un Character Pack</small>
    </label>
    <label class="guided-field"><span>Nome in scena</span><input id="cast-guide-name" value="${escapeHtml(state.actorName)}" placeholder="Es. Marco"></label>
    <button id="cast-identity-next" class="primary-action" type="button">Continua</button>
  `);
  $("#cast-guide-character").value = state.characterId;
  $("#cast-guide-character").addEventListener("change", (event) => {
    state.characterId = event.currentTarget.value;
    renderSummary();
  });
  $("#cast-guide-reference").addEventListener("change", (event) => {
    state.temporaryReference = event.currentTarget.files?.[0] || null;
    renderSummary();
  });
  $("#cast-identity-next").addEventListener("click", () => {
    state.actorName = $("#cast-guide-name").value.trim();
    if (!state.actorName) return toast("Inserisci il nome del nuovo attore.");
    if (!state.characterId && !state.temporaryReference) return toast("Scegli un Character Pack o carica una reference.");
    message("user", `${escapeHtml(state.actorName)} · ${escapeHtml(selectedCharacterName())}`);
    renderSummary();
    askTiming();
  });
}

function askTiming() {
  state.step = 3;
  $("#cast-guide-step").textContent = "3 · Ingresso e battuta";
  message("assistant", "<b>Definiamo una sola azione leggibile.</b><p>La finestra deve includere ingresso, avvicinamento e reazione. Una scena semplice conserva meglio il corso del video originale.</p>");
  setComposer(`
    <div class="guided-field-grid">
      <label class="guided-field"><span>Inizio (secondi)</span><input id="cast-guide-start" type="number" min="0" step=".1" value="${state.start}"></label>
      <label class="guided-field"><span>Fine (secondi)</span><input id="cast-guide-end" type="number" min=".1" step=".1" value="${state.end}"></label>
    </div>
    <label class="guided-field"><span>Azione del nuovo attore</span><textarea id="cast-guide-action" rows="3">${escapeHtml(state.entryAction)}</textarea></label>
    <label class="guided-field"><span>Battuta esatta, facoltativa</span><input id="cast-guide-dialogue" value="${escapeHtml(state.dialogue)}" placeholder="Es. Questo sì che è strano."></label>
    <label class="guided-field"><span>Reazione degli attori originali</span><input id="cast-guide-reaction" value="${escapeHtml(state.reaction)}"></label>
    <button id="cast-timing-next" class="primary-action" type="button">Continua</button>
  `);
  $("#cast-timing-next").addEventListener("click", () => {
    state.start = Number($("#cast-guide-start").value);
    state.end = Number($("#cast-guide-end").value);
    state.entryAction = $("#cast-guide-action").value.trim();
    state.dialogue = $("#cast-guide-dialogue").value.trim();
    state.reaction = $("#cast-guide-reaction").value.trim();
    if (!Number.isFinite(state.start) || !Number.isFinite(state.end) || state.end <= state.start) return toast("La fine deve essere successiva all'inizio.");
    if (!state.entryAction) return toast("Descrivi un'azione visiva semplice.");
    message("user", `${state.start.toFixed(1)}-${state.end.toFixed(1)} s · ${escapeHtml(state.entryAction)}`);
    renderSummary();
    askRender();
  });
}

function askRender() {
  state.step = 4;
  $("#cast-guide-step").textContent = "4 · Anchor e prova";
  message("assistant", "<b>Come prepariamo il frame ponte?</b><p>Qwen Image Edit 2511 è il percorso diretto. Gli altri workflow aggiungono rifinitura, ma richiedono più tempo.</p>");
  setComposer(`
    <label class="guided-field"><span>Workflow anchor</span><select id="cast-guide-anchor">
      <option value="qwen-image-edit">Qwen Image Edit 2511</option>
      <option value="qwen-krea-klein">Qwen / Krea / Klein</option>
      <option value="krea-triple">Krea Triple</option>
    </select></label>
    <label class="guided-field"><span>Qualità segmento</span><select id="cast-guide-quality">
      <option value="preview">Anteprima rapida</option>
      <option value="max">Massima</option>
    </select></label>
    <div class="guided-checkpoint"><b>Ordine di produzione</b><p>1. Analisi e piano. 2. Preparazione segmenti. 3. Generazione anchor. 4. Approvazione manuale anchor. 5. Union Control guidato dal video. 6. Ripristino audio e ricomposizione.</p></div>
    <button id="cast-render-next" class="primary-action" type="button">Prepara il passaggio</button>
  `);
  $("#cast-guide-anchor").value = state.anchorWorkflow;
  $("#cast-guide-quality").value = state.quality;
  $("#cast-render-next").addEventListener("click", () => {
    state.anchorWorkflow = $("#cast-guide-anchor").value;
    state.quality = $("#cast-guide-quality").value;
    message("user", `${escapeHtml($("#cast-guide-anchor").selectedOptions[0].textContent)} · ${escapeHtml($("#cast-guide-quality").selectedOptions[0].textContent)}`);
    $("#cast-guide-step").textContent = "Pronto";
    message("assistant", "<b>Il piano è pronto.</b><p>In Video Studio controlla la timeline, poi usa <strong>Analizza video e crea piano</strong>. La generazione non parte automaticamente.</p>");
    setComposer("<p class=\"hint\">Puoi aprire il piano dal riepilogo a destra.</p>");
    renderSummary();
  });
}

function buildHandoff() {
  const dialogueClause = state.dialogue ? ` says in Italian, \"${state.dialogue}\"` : "";
  const brief = [
    `From ${state.start.toFixed(1)} to ${state.end.toFixed(1)} seconds, ${state.actorName} ${state.entryAction}${dialogueClause}.`,
    `${state.reaction}.`,
    "Keep the source camera, timing, performances, dialogue, ambience and music unchanged outside the insertion.",
    "Do not create a new shot, alter the original actors, add subtitles or change the original storyline.",
  ].join(" ");
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    routeId: "interactiveCastGuided",
    title: `Interactive Cast · ${state.actorName}`,
    fields: {
      videoStudioMode: "interactiveCast",
      interactiveCastNewActorName: state.actorName,
      interactiveCastCharacterId: state.characterId,
      interactiveCastAnchorWorkflow: state.anchorWorkflow,
      interactiveCastBrief: brief,
      interactiveCastEvents: [
        {
          speaker: state.actorName,
          start: state.start,
          end: state.end,
          dialogue: state.dialogue,
          action: state.entryAction,
          reaction: "none",
          mode: "generative",
          audioMode: "ltxNative",
        },
        {
          speaker: "Original Actor 1",
          start: Math.max(state.start, state.end - 1.5),
          end: state.end,
          dialogue: "",
          action: state.reaction,
          reaction: "look",
          mode: "composite",
          audioMode: "external",
        },
      ],
      quality: state.quality,
    },
  };
}

async function openVideoStudio() {
  if (!state.sourceVideo || (!state.characterId && !state.temporaryReference)) return toast("Completa prima clip e identità.");
  state.busy = true;
  renderSummary();
  try {
    const token = await saveGuidedHandoff(buildHandoff(), {
      interactiveCastSourceVideo: state.sourceVideo,
      temporaryActorReference: state.temporaryReference,
    });
    location.href = `/video-studio.html?workflow=interactiveCast&guided=${encodeURIComponent(token)}#interactive-cast/config`;
  } catch (error) {
    state.busy = false;
    renderSummary();
    toast(error.message);
  }
}

function reset() {
  Object.assign(state, {
    step: 0,
    sourceVideo: null,
    temporaryReference: null,
    characterId: "",
    actorName: "Marco",
    start: 2,
    end: 7,
    dialogue: "",
    anchorWorkflow: "qwen-image-edit",
    quality: "preview",
    busy: false,
  });
  $("#cast-guide-messages").innerHTML = "";
  renderSummary();
  askSource();
}

async function start() {
  state.config = await getAppConfig();
  $("#connection").className = "connection online";
  $("#connection").innerHTML = "<span></span>COMFYUI ONLINE";
  reset();
}

$("#cast-guide-reset").addEventListener("click", reset);
$("#cast-guide-open").addEventListener("click", openVideoStudio);
start().catch((error) => {
  $("#connection").className = "connection offline";
  $("#connection").innerHTML = "<span></span>COMFYUI OFFLINE";
  message("assistant", `<b>Guida non disponibile.</b><p>${escapeHtml(error.message)}</p>`);
});
