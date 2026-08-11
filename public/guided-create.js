import { enhanceMainPrompt } from "./prompt-assistant.js";
import { saveGuidedHandoff } from "./guided-handoff.js";
import { setupUploadPreviews } from "./upload-previews.js";

const $ = (selector) => document.querySelector(selector);

const state = {
  config: null,
  route: null,
  answers: {},
  files: {},
  step: 0,
  busy: false,
};

const INTENTS = [
  { id: "photo", icon: "◆", title: "Creare una foto", description: "Da testo, reference o più persone" },
  { id: "edit", icon: "✦", title: "Modificare una foto", description: "Aggiungi, rimuovi, sostituisci o cambia stile" },
  { id: "animate", icon: "▶", title: "Animare una foto", description: "Da una foto o due frame" },
  { id: "video", icon: "◉", title: "Creare o modificare un video", description: "Testo, video editing, retake o continuazione" },
  { id: "character", icon: "◎", title: "Personaggi e storyboard", description: "Coerenza, viste e sequenze collegate" },
  { id: "finish", icon: "↗", title: "Migliorare un risultato", description: "Upscale, dettagli, FPS o HDR" },
];

const BRANCHES = {
  photo: [
    { id: "textImage", title: "Foto da una descrizione", description: "Text to Image" },
    { id: "referenceImage", title: "Foto da una reference", description: "Mantieni identità o stile iniziale" },
    { id: "multiPerson", title: "Unire 2–3 persone/reference", description: "Multi-image editing ad alta fedeltà" },
  ],
  edit: [
    { id: "add", title: "Aggiungere qualcosa", description: "Persona, animale o oggetto" },
    { id: "replace", title: "Sostituire qualcosa", description: "Persona, abito, oggetto o sfondo" },
    { id: "remove", title: "Rimuovere un elemento", description: "Ricostruzione naturale dello sfondo" },
    { id: "modify", title: "Cambiare un dettaglio", description: "Aspetto, posa, luce, colore o espressione" },
    { id: "style", title: "Cambiare stile o atmosfera", description: "Stile, relighting, ora o meteo" },
  ],
  animate: [
    { id: "imageVideo", title: "Animare una sola foto", description: "Image to Video LTX 2.3" },
    { id: "firstLast", title: "Passare da una foto a un’altra", description: "First / Last Frame" },
    { id: "director", title: "Creare scene consecutive", description: "Director con 1–3 scene e continuità" },
  ],
  video: [
    { id: "textVideo", title: "Video da una descrizione", description: "Text to Video LTX 2.3" },
    { id: "videoEdit", title: "Modificare un video esistente", description: "Scene Transform V2V con Union Control" },
    { id: "actorReplace", title: "Sostituire un attore", description: "Viso, testa o corpo" },
    { id: "actorAdd", title: "Aggiungere un personaggio", description: "Azioni, dialoghi e risposte" },
    { id: "retake", title: "Rigenerare una clip", description: "Mantiene struttura e audio" },
    { id: "extend", title: "Continuare un video", description: "Prosegue dal frame finale" },
  ],
  character: [
    { id: "storyboard", title: "Storyboard di 2–4 immagini", description: "Shot coerenti dalle stesse reference" },
    { id: "bible", title: "Scheda personaggio o location", description: "Viste coerenti e riutilizzabili" },
    { id: "multiPerson", title: "Foto con più persone precise", description: "Reference separate e identità conservate" },
    { id: "director", title: "Storyboard già animato", description: "Timeline Director LTX 2.3" },
  ],
  finish: [
    { id: "upscale", title: "Ingrandire e rifinire una foto", description: "SeedVR2, AI classico o RTX" },
    { id: "temporal", title: "Raddoppiare gli FPS", description: "Temporal Upscaler 2×" },
    { id: "hdr", title: "Recuperare luci e ombre", description: "HDR IC-LoRA" },
  ],
};

const ROUTES = {
  textImage: { page: "/", generationType: "image", imageMode: "text", target: "qwen", title: "Foto da testo" },
  referenceImage: { page: "/", generationType: "image", imageMode: "image", target: "qwenedit", title: "Foto da reference", uploads: [{ key: "sourceImage", label: "Carica la foto di riferimento", accept: "image/*" }] },
  multiPerson: { page: "/studio.html", studioMode: "guidedEdit", editAction: "addPerson", target: "qwenedit", title: "Inserimento multi-reference ad alta fedeltà", uploads: [
    { key: "sourceImage", label: "Carica la prima persona o la scena base", accept: "image/*" },
    { key: "reference1", label: "Carica la seconda persona/reference", accept: "image/*" },
    { key: "reference2", label: "Terza reference facoltativa", accept: "image/*", optional: true },
  ] },
  add: { page: "/studio.html", studioMode: "guidedEdit", editAction: "addPerson", target: "qwenedit", title: "Aggiunta guidata", uploads: [{ key: "sourceImage", label: "Carica la foto da modificare", accept: "image/*" }, { key: "reference1", label: "Reference dell’elemento da aggiungere (facoltativa)", accept: "image/*", optional: true }] },
  replace: { page: "/studio.html", studioMode: "guidedEdit", editAction: "replace", target: "qwenedit", title: "Sostituzione guidata", uploads: [{ key: "sourceImage", label: "Carica la foto da modificare", accept: "image/*" }, { key: "reference1", label: "Reference sostitutiva (facoltativa)", accept: "image/*", optional: true }] },
  remove: { page: "/studio.html", studioMode: "guidedEdit", editAction: "remove", target: "qwenedit", title: "Rimozione guidata", uploads: [{ key: "sourceImage", label: "Carica la foto da modificare", accept: "image/*" }] },
  modify: { page: "/studio.html", studioMode: "guidedEdit", editAction: "modify", target: "qwenedit", title: "Modifica guidata", uploads: [{ key: "sourceImage", label: "Carica la foto da modificare", accept: "image/*" }] },
  style: { page: "/studio.html", studioMode: "guidedEdit", editAction: "style", target: "qwenedit", title: "Stile e atmosfera", uploads: [{ key: "sourceImage", label: "Carica la foto da trasformare", accept: "image/*" }] },
  imageVideo: { page: "/", generationType: "video", workflowId: "standard", videoInputMode: "image", target: "ltx_architect", title: "Foto → Video", uploads: [{ key: "image", label: "Carica la foto da animare", accept: "image/*" }] },
  firstLast: { page: "/studio.html", studioMode: "firstLast", target: "ltx_architect", title: "First / Last Frame", uploads: [{ key: "firstFrame", label: "Carica il frame iniziale", accept: "image/*" }, { key: "lastFrame", label: "Carica il frame finale", accept: "image/*" }] },
  director: { page: "/", generationType: "video", workflowId: "director", target: "ltx_director", title: "LTX 2.3 Director", director: true },
  textVideo: { page: "/", generationType: "video", workflowId: "standard", videoInputMode: "text", target: "ltx_architect", title: "Testo → Video" },
  videoEdit: { page: "/video-studio.html", videoStudioMode: "sceneTransform", target: "videostudio", title: "Scene Transform V2V", uploads: [{ key: "guideVideo", label: "Carica il video da modificare", accept: "video/*" }, { key: "referenceSheet", label: "Carica un frame editato o reference target", accept: "image/*" }] },
  actorReplace: { page: "/video-studio.html", videoStudioMode: "actorReplacement", target: "videostudio", title: "Sostituzione attore", uploads: [{ key: "sourceVideo", label: "Carica lo spezzone originale", accept: "video/*" }, { key: "identityImage", label: "Carica la nuova identità", accept: "image/*" }] },
  actorAdd: { page: "/video-studio.html", videoStudioMode: "interactiveScene", target: "videostudio", title: "Nuovo personaggio nella scena", uploads: [{ key: "referenceSheet", label: "Carica il keyframe con il nuovo personaggio già posizionato", accept: "image/*" }] },
  retake: { page: "/video-studio.html", videoStudioMode: "retake", target: "videostudio", title: "Retake", uploads: [{ key: "sourceVideo", label: "Carica la clip da rigenerare", accept: "video/*" }] },
  extend: { page: "/video-studio.html", videoStudioMode: "extend", target: "videostudio", title: "Continua / Estendi video", uploads: [{ key: "sourceVideo", label: "Carica il video da continuare", accept: "video/*" }] },
  storyboard: { page: "/studio.html", studioMode: "storyboard", target: "studio", title: "Storyboard Director", uploads: [{ key: "sourceImage", label: "Carica la reference master", accept: "image/*" }, { key: "reference1", label: "Seconda reference facoltativa", accept: "image/*", optional: true }] },
  bible: { page: "/studio.html", studioMode: "bible", target: "studio", title: "Character & Location Bible", uploads: [{ key: "sourceImage", label: "Carica il personaggio o la location", accept: "image/*" }] },
  upscale: { page: "/", generationType: "upscale", target: null, title: "Upscaling e detailer", uploads: [{ key: "upscaleImage", label: "Carica la foto da migliorare", accept: "image/*" }] },
  temporal: { page: "/video-studio.html", videoStudioMode: "temporalUpscale", target: null, title: "Temporal Upscaler 2×", uploads: [{ key: "sourceVideo", label: "Carica il video", accept: "video/*" }] },
  hdr: { page: "/video-studio.html", videoStudioMode: "hdr", target: "videostudio", title: "HDR Studio", uploads: [{ key: "sourceVideo", label: "Carica il video da correggere", accept: "video/*" }] },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showToast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $("#toast").classList.remove("visible"), 2800);
}

function message(type, html) {
  const node = document.createElement("article");
  node.className = `guided-message ${type}`;
  node.innerHTML = type === "assistant"
    ? `<span class="guided-avatar">✦</span><div>${html}</div>`
    : `<div>${html}</div>`;
  $("#guided-messages").append(node);
  node.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function choices(items, onSelect) {
  $("#guided-composer").innerHTML = `<div class="guided-choice-grid">${items.map((item) => `
    <button type="button" data-choice="${escapeHtml(item.id)}">
      ${item.icon ? `<span>${item.icon}</span>` : ""}
      <b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.description || "")}</small>
    </button>`).join("")}</div>`;
  $("#guided-composer").querySelectorAll("[data-choice]").forEach((button) => {
    button.addEventListener("click", () => onSelect(button.dataset.choice));
  });
}

function renderSummary() {
  const route = state.route;
  $("#guided-summary-title").textContent = route?.title || "Nessuna scelta";
  $("#guided-summary-description").textContent = route
    ? "Questa configurazione verrà trasferita nella schermata di generazione."
    : "Le tue risposte comporranno qui una scheda semplice e sempre modificabile.";
  const items = [];
  if (state.answers.intentTitle) items.push(["Obiettivo", state.answers.intentTitle]);
  if (route) items.push(["Workflow", route.title]);
  if (state.answers.editSubject) items.push(["Elemento", state.answers.editSubject]);
  if (state.answers.promptModeTitle) items.push(["Prompt", state.answers.promptModeTitle]);
  if (state.answers.engineTitle) items.push(["Motore", state.answers.engineTitle]);
  if (state.answers.qualityTitle) items.push(["Qualità", state.answers.qualityTitle]);
  const loaded = Object.entries(state.files).filter(([, file]) => file).length;
  if (loaded) items.push(["File pronti", String(loaded)]);
  $("#guided-summary-items").innerHTML = items.map(([label, value]) =>
    `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`
  ).join("");
  const ready = isReady();
  $("#guided-continue").disabled = !ready || state.busy;
  $("#guided-readiness").innerHTML = route
    ? `<span class="${ready ? "ready" : "pending"}"></span>${ready ? "Pronto per continuare" : "Completa i passaggi nella chat"}`
    : "";
}

function requiredUploads() {
  return (state.route?.uploads || []).filter((upload) => !upload.optional);
}

function isReady() {
  if (!state.route) return false;
  if (requiredUploads().some((upload) => !state.files[upload.key])) return false;
  if (state.route.target && !String(state.answers.prompt || "").trim()) return false;
  return Boolean(state.answers.quality);
}

function selectIntent() {
  state.step = 0;
  $("#guided-step-label").textContent = "1 · Cosa vuoi creare?";
  message("assistant", "<b>Cosa vuoi ottenere?</b><p>Scegli l’obiettivo più vicino alla tua idea. Potrai cambiare strada in qualsiasi momento.</p>");
  choices(INTENTS, (id) => {
    const intent = INTENTS.find((item) => item.id === id);
    state.answers.intent = id;
    state.answers.intentTitle = intent.title;
    message("user", escapeHtml(intent.title));
    $("#guided-step-label").textContent = "2 · Scegli il tipo di lavoro";
    message("assistant", `<b>${escapeHtml(intent.title)}: in che modo?</b>`);
    choices(BRANCHES[id], selectBranch);
    renderSummary();
  });
}

function selectBranch(id) {
  const branch = Object.values(BRANCHES).flat().find((item) => item.id === id);
  state.route = { ...ROUTES[id], id };
  state.answers.branch = id;
  message("user", escapeHtml(branch.title));
  renderSummary();
  if (state.route.director) return askDirectorSetup();
  if (id === "add") return askAddedSubject();
  askUploads();
}

function askAddedSubject() {
  $("#guided-step-label").textContent = "3 · Cosa vuoi aggiungere?";
  message("assistant", "<b>Cosa deve entrare nella fotografia?</b><p>La scelta prepara il tipo di maschera e l’istruzione dell’Editor Guidato.</p>");
  choices([
    { id: "addPerson", icon: "＋", title: "Una persona", description: "Con o senza foto di riferimento" },
    { id: "addAnimal", icon: "＋", title: "Un animale", description: "Specie, posa e interazione" },
    { id: "addObject", icon: "＋", title: "Un oggetto", description: "Dimensione, materiale e appoggio" },
  ], (editAction) => {
    const labels = { addPerson: "Persona", addAnimal: "Animale", addObject: "Oggetto" };
    state.route.editAction = editAction;
    state.answers.editSubject = labels[editAction];
    message("user", labels[editAction]);
    renderSummary();
    askUploads();
  });
}

function askDirectorSetup() {
  $("#guided-step-label").textContent = "3 · Timeline Director";
  message("assistant", "<b>Quante scene consecutive vuoi preparare?</b><p>Ogni scena avrà un prompt indipendente e una foto guida facoltativa.</p>");
  choices([
    { id: "1", icon: "1", title: "Una scena", description: "Un solo intervallo temporale" },
    { id: "2", icon: "2", title: "Due scene", description: "Continuità fra due momenti" },
    { id: "3", icon: "3", title: "Tre scene", description: "Sequenza completa breve" },
  ], (value) => {
    const count = Number(value);
    state.answers.directorSceneCount = count;
    state.answers.directorDurations = Array.from({ length: count }, () => 5);
    state.route.uploads = Array.from({ length: count }, (_, index) => ({
      key: `directorScene${index}`,
      label: `Foto guida scena ${index + 1}`,
      accept: "image/*",
      optional: true,
    }));
    message("user", `${count} ${count === 1 ? "scena" : "scene"}`);
    renderSummary();
    askUploads();
  });
}

function askUploads() {
  const uploads = state.route.uploads || [];
  if (!uploads.length) return askEngine();
  $("#guided-step-label").textContent = "3 · Carica il materiale";
  message("assistant", `<b>Prepariamo il materiale di partenza.</b><p>I file verranno passati automaticamente al workflow.</p>`);
  $("#guided-composer").innerHTML = `
    <div class="guided-upload-list">${uploads.map((upload) => `
      <label class="guided-upload ${upload.optional ? "optional" : ""}">
        <input type="file" data-upload="${escapeHtml(upload.key)}" accept="${escapeHtml(upload.accept)}">
        <span>＋</span><div><b>${escapeHtml(upload.label)}</b><small>${upload.optional ? "Facoltativo" : "Richiesto"}</small></div>
        <em data-file-name="${escapeHtml(upload.key)}">Scegli file</em>
      </label>`).join("")}</div>
    <button id="guided-files-next" class="primary-action" type="button">Continua →</button>`;
  setupUploadPreviews($("#guided-composer"));
  $("#guided-composer").querySelectorAll("[data-upload]").forEach((input) => {
    input.addEventListener("change", () => {
      state.files[input.dataset.upload] = input.files[0] || null;
      $(`[data-file-name="${input.dataset.upload}"]`).textContent = input.files[0]?.name || "Scegli file";
      renderSummary();
    });
  });
  $("#guided-files-next").addEventListener("click", () => {
    const missing = requiredUploads().find((upload) => !state.files[upload.key]);
    if (missing) return showToast(`Manca: ${missing.label}`);
    message("user", `${Object.values(state.files).filter(Boolean).length} file ${Object.values(state.files).filter(Boolean).length === 1 ? "caricato" : "caricati"}`);
    askEngine();
  });
}

function askPromptMode() {
  if (!state.route.target) return askQuality();
  $("#guided-step-label").textContent = "4 · Come vuoi scrivere il prompt?";
  message("assistant", "<b>Come vuoi descrivere il risultato?</b><p>Puoi parlare normalmente in italiano oppure usare già un prompt inglese.</p>");
  choices([
    { id: "natural", icon: "IT", title: "Scrivo in italiano", description: "LM Studio lo ottimizza per questo workflow" },
    { id: "manual", icon: "EN", title: "Prompt inglese manuale", description: "Il testo resta esattamente come lo scrivi" },
    { id: "guided", icon: "✦", title: "Fammi domande semplici", description: "Componiamo insieme posizione, azione e vincoli" },
  ], choosePromptMode);
}

function choosePromptMode(mode) {
  state.answers.promptMode = mode;
  state.answers.promptModeTitle = mode === "natural" ? "Italiano → prompt IA" : mode === "manual" ? "Inglese manuale" : "Composizione guidata";
  message("user", escapeHtml(state.answers.promptModeTitle));
  if (state.route.director) return directorPromptComposer(mode);
  if (mode === "guided") return guidedPromptQuestions();
  const natural = mode === "natural";
  message("assistant", natural
    ? "<b>Descrivi liberamente ciò che vuoi.</b><p>La IA locale userà anche la prima immagine allegata e produrrà un prompt breve, specifico per il modello.</p>"
    : "<b>Inserisci il prompt inglese.</b><p>Non verrà riscritto né alterato.</p>");
  $("#guided-composer").innerHTML = `
    <textarea id="guided-prompt-input" rows="6" placeholder="${natural ? "Es. Voglio aggiungere una ragazza dentro la piscina alla mia destra, immersa fino alla vita…" : "Write the final English prompt…"}"></textarea>
    <button id="guided-prompt-next" class="primary-action" type="button">${natural ? "✦ Ottimizza con LM Studio" : "Usa questo prompt"} →</button>
    <p id="guided-prompt-status" class="prompt-assistant-status"></p>`;
  $("#guided-prompt-next").addEventListener("click", () => processPrompt(natural));
}

function directorPromptComposer(mode) {
  const count = state.answers.directorSceneCount || 1;
  if (mode === "manual") {
    message("assistant", "<b>Inserisci continuità globale e prompt di ogni scena.</b><p>I testi inglesi resteranno invariati.</p>");
    $("#guided-composer").innerHTML = `
      <div class="guided-question-form">
        <label><span>Continuità globale</span><textarea id="guided-director-global" rows="4" placeholder="Character, environment, lighting and style continuity…"></textarea></label>
        ${Array.from({ length: count }, (_, index) => `<label><span>Scena ${index + 1}</span><textarea data-director-manual-scene="${index}" rows="4" placeholder="Action, camera, sound and ending state…"></textarea></label>`).join("")}
      </div>
      <button id="guided-director-manual-next" class="primary-action" type="button">Usa questi prompt →</button>`;
    $("#guided-director-manual-next").addEventListener("click", () => {
      const globalPrompt = $("#guided-director-global").value.trim();
      const scenes = [...document.querySelectorAll("[data-director-manual-scene]")].map((input, index) => ({
        prompt: input.value.trim(),
        duration: state.answers.directorDurations[index] || 5,
      }));
      if (!globalPrompt || scenes.some((scene) => !scene.prompt)) return showToast("Compila il prompt globale e tutte le scene.");
      state.answers.prompt = globalPrompt;
      state.answers.directorScenes = scenes;
      message("user", "Prompt Director manuali compilati");
      renderSummary();
      askQuality();
    });
    return;
  }
  const guided = mode === "guided";
  message("assistant", guided
    ? "<b>Descrivi la storia e la continuità.</b><p>Puoi indicare cosa accade in ordine; LM Studio dividerà correttamente il movimento fra le scene.</p>"
    : "<b>Descrivi in italiano la sequenza completa.</b><p>LM Studio analizzerà anche le foto allegate e compilerà continuità globale e tutte le scene.</p>");
  $("#guided-composer").innerHTML = `
    <textarea id="guided-director-idea" rows="6" placeholder="Es. Siamo dentro un’auto. Nella prima scena la ragazza si avvicina al finestrino; nella seconda entra e si siede mantenendo la stessa luce…"></textarea>
    <div class="guided-director-durations">
      ${Array.from({ length: count }, (_, index) => `<label>Scena ${index + 1}<span><input data-director-duration="${index}" type="number" min="1" max="30" value="5"> sec</span></label>`).join("")}
    </div>
    <button id="guided-director-ai" class="primary-action" type="button">✦ Compila tutti i prompt Director →</button>
    <p id="guided-prompt-status" class="prompt-assistant-status"></p>`;
  $("#guided-director-ai").addEventListener("click", processDirectorPrompt);
}

async function processDirectorPrompt() {
  const idea = $("#guided-director-idea").value.trim();
  if (!idea) return showToast("Descrivi prima la sequenza.");
  const durations = [...document.querySelectorAll("[data-director-duration]")].map((input) => Number(input.value) || 5);
  const button = $("#guided-director-ai");
  const status = $("#guided-prompt-status");
  const original = button.textContent;
  const data = new FormData();
  data.set("text", idea);
  data.set("scenes", JSON.stringify(durations.map((duration, index) => ({
    id: `guided-${index + 1}`,
    duration,
    prompt: "",
  }))));
  durations.forEach((_duration, index) => {
    if (state.files[`directorScene${index}`]) {
      data.set(`sceneImage_guided-${index + 1}`, state.files[`directorScene${index}`]);
    }
  });
  state.busy = true;
  button.disabled = true;
  button.textContent = "Analisi timeline…";
  status.textContent = "LM Studio sta preparando continuità e prompt scena per scena…";
  renderSummary();
  try {
    const response = await fetch("/api/prompt-assistant/director", { method: "POST", body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
    if (!payload.globalPrompt || !Array.isArray(payload.scenes) || payload.scenes.length < durations.length) {
      throw new Error("LM Studio ha restituito una struttura Director incompleta.");
    }
    state.answers.prompt = payload.globalPrompt;
    state.answers.directorScenes = durations.map((duration, index) => ({
      duration,
      prompt: payload.scenes[index]?.prompt || "",
    }));
    if (state.answers.directorScenes.some((scene) => !scene.prompt)) {
      throw new Error("Manca il prompt di almeno una scena Director.");
    }
    status.textContent = `${payload.model} · timeline completa · LM Studio scaricato`;
    message("assistant", `<b>Timeline Director compilata.</b><p>${durations.length} ${durations.length === 1 ? "scena pronta" : "scene pronte"}, ciascuna con azione, camera, suono e continuità.</p>`);
    renderSummary();
    askQuality();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("prompt-assistant-error");
  } finally {
    state.busy = false;
    button.disabled = false;
    button.textContent = original;
    renderSummary();
  }
}

function guidedPromptQuestions() {
  message("assistant", "<b>Rispondi con parole normali.</b><p>Se qualcosa non è importante puoi lasciarlo vuoto.</p>");
  $("#guided-composer").innerHTML = `
    <div class="guided-question-form">
      <label><span>Cosa deve accadere o cambiare?</span><textarea id="guided-goal" rows="3" placeholder="Es. aggiungi la ragazza della seconda foto accanto a me"></textarea></label>
      <label><span>Dove e in quale posizione?</span><input id="guided-placement" placeholder="Es. alla mia destra, stessa profondità, seduta"></label>
      <label><span>Che azione o espressione?</span><input id="guided-action" placeholder="Es. sorride verso la camera e mi abbraccia"></label>
      <label><span>Cosa deve restare invariato?</span><input id="guided-preserve" placeholder="Es. i due volti, sfondo, luce e inquadratura"></label>
      <label><span>Look desiderato</span><input id="guided-look" placeholder="Es. selfie amatoriale realistico, luce naturale"></label>
    </div>
    <button id="guided-compose-prompt" class="primary-action" type="button">✦ Componi il prompt con LM Studio →</button>
    <p id="guided-prompt-status" class="prompt-assistant-status"></p>`;
  $("#guided-compose-prompt").addEventListener("click", () => {
    const parts = [
      $("#guided-goal").value,
      $("#guided-placement").value && `Posizione: ${$("#guided-placement").value}.`,
      $("#guided-action").value && `Azione: ${$("#guided-action").value}.`,
      $("#guided-preserve").value && `Mantieni invariato: ${$("#guided-preserve").value}.`,
      $("#guided-look").value && `Aspetto finale: ${$("#guided-look").value}.`,
    ].filter(Boolean);
    if (!parts.length) return showToast("Descrivi almeno cosa deve accadere.");
    const hidden = document.createElement("textarea");
    hidden.id = "guided-prompt-input";
    hidden.value = parts.join(" ");
    $("#guided-composer").append(hidden);
    processPrompt(true);
  });
}

async function processPrompt(useAssistant) {
  const input = $("#guided-prompt-input");
  if (!input?.value.trim()) return showToast("Scrivi prima la tua richiesta.");
  if (!useAssistant) {
    state.answers.prompt = input.value.trim();
    message("user", escapeHtml(state.answers.prompt));
    renderSummary();
    return askQuality();
  }
  const button = $("#guided-prompt-next") || $("#guided-compose-prompt");
  const status = $("#guided-prompt-status");
  state.busy = true;
  renderSummary();
  try {
    const sourceFile = Object.values(state.files).find((file) => file?.type?.startsWith("image/")) || null;
    const result = await enhanceMainPrompt({
      input,
      button,
      status,
      target: promptTarget(),
      mode: sourceFile ? "image" : "text",
      workflowName: state.route.title,
      sourceFile,
    });
    if (!result) return;
    state.answers.prompt = result.prompt;
    message("assistant", `<b>Prompt ottimizzato.</b><details><summary>Leggi il prompt</summary><p>${escapeHtml(result.prompt)}</p></details>`);
    askQuality();
  } catch {
    // L'errore è già visibile accanto al pulsante.
  } finally {
    state.busy = false;
    renderSummary();
  }
}

function promptTarget() {
  const engine = state.answers.engine;
  if (engine === "flux2") return "flux2_klein_architect";
  if (engine === "qwenEdit") return "qwen_image_edit_architect";
  if (engine === "qwenImage") return state.route.imageMode === "text" ? "qwen" : "qwen_image_edit_architect";
  if (engine === "flux1") return "flux1";
  if (engine === "zImage") return "zimage";
  return state.route.target;
}

function availableImageFamilies() {
  const desiredMode = state.route?.generationType === "image"
    ? state.route.imageMode
    : "image";
  const studioFamilies = state.route?.page === "/studio.html"
    ? new Set(["flux2", "qwenEdit"])
    : null;
  const available = (state.config?.imageModels || []).filter((model) =>
    model.available && (model.modes || []).includes(desiredMode)
      && (!studioFamilies || studioFamilies.has(model.id))
  );
  return [
    { id: "auto", title: "Scegli tu · consigliato", description: "La webapp usa il motore più adatto" },
    ...available.map((model) => ({ id: model.id, title: model.name, description: model.family === "qwenedit" ? "Editing e multi-reference" : model.family === "flux2" ? "Realismo e composizione" : "Generazione immagine" })),
  ];
}

function recommendedEngine() {
  if (state.route.generationType === "image") {
    return state.route.imageMode === "text" ? "qwenImage" : "qwenEdit";
  }
  if (state.route.page === "/studio.html" && state.route.studioMode !== "firstLast") return "qwenEdit";
  if (state.route.generationType === "video" || state.route.studioMode === "firstLast") return "normal";
  return "auto";
}

function askEngine() {
  if (!state.route.target) return askQuality();
  if (state.route.videoStudioMode === "actorReplacement") {
    const options = (state.config?.videoStudio?.engines || [])
      .filter((engine) => engine.available)
      .map((engine) => ({ id: engine.id, title: engine.name, description: engine.description || "Motore disponibile" }));
    if (!options.length) return askPromptMode();
    $("#guided-step-label").textContent = "5 · Motore sostituzione";
    message("assistant", "<b>Come vuoi sostituire l’attore?</b><p>Mostro soltanto i motori disponibili nella tua istanza ComfyUI.</p>");
    choices(options, (id) => {
      const selected = options.find((item) => item.id === id);
      state.answers.engine = id;
      state.answers.engineTitle = selected.title;
      message("user", escapeHtml(selected.title));
      renderSummary();
      askPromptMode();
    });
    return;
  }
  if (["interactiveScene", "hdr"].includes(state.route.videoStudioMode)) {
    state.answers.engine = "auto";
    state.answers.engineTitle = "Motore del workflow";
    renderSummary();
    return askPromptMode();
  }
  const firstLast = state.route.studioMode === "firstLast";
  const imageRoute = (state.route.page === "/studio.html" && !firstLast) || state.route.generationType === "image";
  const videoRoute = firstLast || state.route.generationType === "video" || state.route.page === "/video-studio.html";
  if (!imageRoute && !videoRoute) return state.route.target ? askPromptMode() : askQuality();
  $("#guided-step-label").textContent = "5 · Motore";
  message("assistant", imageRoute
    ? "<b>Vuoi scegliere il modello?</b><p>“Scegli tu” mantiene il percorso più semplice; potrai comunque cambiarlo nel form finale.</p>"
    : "<b>Quale famiglia LTX vuoi usare?</b><p>Il modello normale è la scelta più prevedibile; LTX 2.3 Sulphur usa il Dev con LoRA Sulphur e prompt enhancer dedicato.</p>");
  const options = imageRoute
    ? availableImageFamilies()
    : [
        { id: "normal", title: "LTX 2.3 normale · consigliato", description: "Più prevedibile nei workflow guidati" },
        { id: "sulphur", title: "LTX 2.3 Sulphur", description: "LTX Dev con LoRA Sulphur per T2V/I2V dedicati" },
      ];
  choices(options, (id) => {
    const selected = options.find((item) => item.id === id);
    const resolvedId = id === "auto" ? recommendedEngine() : id;
    state.answers.engine = resolvedId;
    state.answers.engineTitle = id === "auto"
      ? `${selected.title} (${options.find((item) => item.id === resolvedId)?.title || resolvedId})`
      : selected.title;
    message("user", escapeHtml(state.answers.engineTitle));
    renderSummary();
    if (state.route.target) askPromptMode();
    else askQuality();
  });
}

function askQuality() {
  $("#guided-step-label").textContent = "6 · Qualità e velocità";
  message("assistant", "<b>Quanto vuoi spingere la qualità?</b><p>Ti mostro termini semplici; i valori tecnici saranno già impostati.</p>");
  choices([
    { id: "speed", icon: "1", title: "Veloce", description: "Per prove e composizione" },
    { id: "quality", icon: "2", title: "Qualità · consigliata", description: "Equilibrio tra dettaglio e tempo" },
    { id: "max", icon: "3", title: "Massima", description: "Più lenta e impegnativa per la VRAM" },
  ], (id) => {
    const titles = { speed: "Veloce", quality: "Qualità", max: "Massima" };
    state.answers.quality = id;
    state.answers.qualityTitle = titles[id];
    message("user", titles[id]);
    renderSummary();
    finishConversation();
  });
}

function finishConversation() {
  $("#guided-step-label").textContent = "Pronto";
  message("assistant", `<b>Perfetto, il progetto è pronto.</b><p>Aprirò <strong>${escapeHtml(state.route.title)}</strong> con materiale, prompt e preferenze già inseriti. Nessuna generazione partirà automaticamente.</p>`);
  $("#guided-composer").innerHTML = `<button id="guided-inline-continue" class="primary-action" type="button">Apri il workflow preparato →</button>`;
  $("#guided-inline-continue").addEventListener("click", continueToWorkflow);
  renderSummary();
}

function buildHandoff() {
  const route = state.route;
  const fields = {
    generationType: route.generationType,
    workflowId: route.workflowId,
    videoInputMode: route.videoInputMode,
    imageMode: route.imageMode,
    studioMode: route.studioMode,
    videoStudioMode: route.videoStudioMode,
    editAction: route.editAction,
    prompt: state.answers.prompt || "",
    quality: state.answers.quality,
    engine: state.answers.engine || "auto",
    directorScenes: state.answers.directorScenes || null,
  };
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    routeId: route.id,
    title: route.title,
    fields,
  };
}

async function continueToWorkflow() {
  if (!isReady()) return showToast("Completa prima i passaggi richiesti.");
  state.busy = true;
  renderSummary();
  try {
    const token = await saveGuidedHandoff(buildHandoff(), state.files);
    const separator = state.route.page.includes("?") ? "&" : "?";
    location.href = `${state.route.page}${separator}guided=${encodeURIComponent(token)}`;
  } catch (error) {
    state.busy = false;
    renderSummary();
    showToast(`Impossibile preparare il passaggio: ${error.message}`);
  }
}

function reset() {
  state.route = null;
  state.answers = {};
  state.files = {};
  state.step = 0;
  state.busy = false;
  $("#guided-messages").innerHTML = "";
  $("#guided-composer").innerHTML = "";
  renderSummary();
  selectIntent();
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error();
    $("#connection").className = "connection online";
    $("#connection").innerHTML = "<span></span>COMFYUI ONLINE";
  } catch {
    $("#connection").className = "connection offline";
    $("#connection").innerHTML = "<span></span>COMFYUI OFFLINE";
  }
}

async function start() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error(`Configurazione non disponibile (${response.status})`);
    state.config = await response.json();
    reset();
    checkHealth();
    setInterval(checkHealth, 15000);
  } catch (error) {
    message("assistant", `<b>Impossibile avviare la guida.</b><p>${escapeHtml(error.message)}</p>`);
  }
}

$("#guided-reset").addEventListener("click", reset);
$("#guided-continue").addEventListener("click", continueToWorkflow);
start();
