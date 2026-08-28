import { enhanceMainPrompt } from "./prompt-assistant.js?v=20260827-h3-character-context";
import { consumeGuidedHandoff, guidedTokenFromLocation, setInputFile } from "./guided-handoff.js";
import { applyH3LoraTriggers, applyLoraTriggers, automaticLoraTriggers, loraOptionLabel, uniquePromptTriggers } from "./lora-triggers.js?v=20260824-h3-fields";
import { setupUploadPreviews } from "./upload-previews.js";
import { createAdaptivePoller, getAppConfig, warmAppConfig } from "./runtime-cache.js";
import { attachFormDraft } from "./form-draft.js";

void warmAppConfig();

const state = {
  config: null,
  projects: [],
  dialogue: [
    { speaker: "John", line: "", delivery: "con tono naturale" },
    { speaker: "Attore 1", line: "", delivery: "risponde guardando John" },
  ],
  loras: [],
  sequentialStories: [],
  interactiveCastProjects: [],
  interactiveCastView: "config",
  interactiveCastActiveProjectId: "",
  interactiveCastPreferredQuality: "preview",
  interactiveCastEvents: [
    { speaker: "New Actor", start: 3, end: 5, dialogue: "", action: "enters the scene", reaction: "none", mode: "", audioMode: "ltxNative" },
    { speaker: "Original Actor 1", start: 5, end: 7, dialogue: "", action: "turns and answers", reaction: "speak", mode: "", audioMode: "external" },
  ],
  sequentialPlan: null,
  actorFrame: null,
  actorMask: null,
  actorDrawing: false,
  comfyOnline: null,
  configRefreshInFlight: false,
  projectsRenderKey: "",
  readiness: { ready: true, title: "", detail: "" },
};

const $ = (selector) => document.querySelector(selector);

const H3_SCENE_PRESETS = Object.freeze({
  fantasyVerite: {
    hint: "Fantasy vérité: I2V verticale 8 s, handheld, Realism People 0,70. L'anteprima 0,4 MP è già utilizzabile; KJ Lanczos è la finitura conservativa consigliata.",
    mode: "image", duration: "8", aspect: "9:16 (Portrait Widescreen)", look: "amateurHandheld", lora: "realism", strength: 0.7,
    starter: "The same adult adventurer walks slowly along the existing forest path toward the edge of a small lived-in medieval fantasy hamlet, holding the consumer camera at arm's length. Her gaze alternates briefly between the path and lens; she blinks, breathes, gives one restrained half-smile and brushes one loose curl away without posing. Preserve the source identity, wardrobe, props, close portrait framing, practical forest light and location. Continuous diegetic sound only: footsteps on dry earth, leather creak, cloth, birds, wind and distant village activity. No dialogue, no music, no cuts.",
  },
  urbanPhoneDiary: {
    hint: "Diario urbano: I2V verticale 8 s, selfie smartphone autentico e Realism People 0,65; dialogo e audio nativo restano nel prompt.",
    mode: "image", duration: "8", aspect: "9:16 (Portrait Widescreen)", look: "phoneSelfie", lora: "realism", strength: 0.65,
    starter: "The same adult woman records one continuous arm's-length phone selfie while walking at an ordinary pace through a lived-in city street. She speaks naturally in Italian with small pauses, glances briefly at the path, then returns her eyes to the lens. Preserve her identity, clothes and surroundings. Practical street light, minor wrist corrections, brief phone autofocus and exposure adaptation, natural footsteps, traffic and distant voices. No beauty filter, no cuts, no music, no subtitles.",
  },
  documentaryPortrait: {
    hint: "Ritratto documentario: 8 s, attività semplice e non recitata, Realism People 0,70, luce disponibile e camera osservativa.",
    mode: "image", duration: "8", aspect: "16:9 (Widescreen)", look: "documentary", lora: "realism", strength: 0.7,
    starter: "The same adult subject performs one simple everyday task in a single observational take. Preserve exact identity, anatomy, wardrobe, props and location. The subject breathes, blinks and makes small unplanned gaze shifts while the camera operator holds a restrained imperfect frame. Practical available light, natural room tone and object sounds, normal motion blur and subtle sensor texture. No posing, no beauty retouching, no cuts, no music.",
  },
  dynamicTracking: {
    hint: "Tracking dinamico: Motion Booster 0,60 con trigger dynv2; azione continua, inerzia leggibile e camera energica ma plausibile.",
    mode: "image", duration: "6", aspect: "16:9 (Widescreen)", look: "amateurHandheld", lora: "motion", strength: 0.6,
    starter: "The same adult subject moves quickly through the existing environment in one continuous tracking shot. Preserve exact identity, outfit, props and location. Show readable acceleration, planted footsteps, balance, inertia and a stable ending while the camera operator follows a fraction late and makes small corrective reframes. Coherent parallax, natural motion blur, cloth and hair response, synchronized footsteps and ambience. No speed ramp, no random shake, no cuts, no morphing.",
  },
  smoothHumanMotion: {
    hint: "Movimento umano fluido: Better Motion 0,55, Turbo disattivata, 0,9 MP diretto. Ideale per camminate, gesti e interazioni naturali.",
    mode: "image", duration: "8", aspect: "16:9 (Widescreen)", look: "documentary", lora: "betterMotion", strength: 0.55, final: true,
    starter: "The same adult subject performs one clear continuous action with grounded foot placement, natural acceleration and deceleration, small balance corrections, breathing, blinking and physically plausible cloth and hair inertia. Keep the motion description short and explicit. Preserve identity, anatomy, wardrobe and location. One continuous observational take, available light, natural room tone, no cuts, no speed ramp, no synthetic camera shake.",
  },
  zeroTwoDance: {
    hint: "Zero Two Dance: coreografia dedicata 0,75, verticale 6 s. Il trigger doing the zero-two dance viene inserito automaticamente.",
    mode: "image", duration: "6", aspect: "9:16 (Portrait Widescreen)", look: "phoneSelfie", lora: "zeroTwo", strength: 0.75,
    starter: "The same adult subject performs the Zero Two dance in one readable full-body take, keeping planted feet, stable anatomy, rhythmic weight transfer and coherent arm arcs. The handheld phone operator makes only small corrective reframes. Preserve identity, outfit and location. Synchronized footsteps and clothing rustle, no cuts, no duplicated limbs, no morphing.",
  },
  whisperedDialogue: {
    hint: "Dialogo sussurrato: Whispering 0,70 + Realism 0,55. Scrivi la battuta con il formato H3 <d>[Italian] ...</d>.",
    mode: "image", duration: "8", aspect: "9:16 (Portrait Widescreen)", look: "phoneSelfie", lora: "whisper", strength: 0.7, extraLoras: [{ type: "realism", strength: 0.55 }],
    starter: "The same adult woman records a close handheld phone selfie and leans slightly toward the microphone. (S1) whispers: <d>[Italian] Inserisci qui la battuta in italiano</d>. Her lips, breath and tiny pauses remain synchronized and restrained. Preserve identity, skin texture, wardrobe and room. Quiet diegetic ambience only, no music, no cuts.",
  },
  droneFlyover: {
    hint: "Drone Flyover: Drone Shot 0,70, 16:9 e 8 s. Trigger dr0nesh0t automatico; niente Motion Booster per evitare conflitti.",
    mode: "text", duration: "8", aspect: "16:9 (Widescreen)", look: "documentary", lora: "drone", strength: 0.7,
    starter: "A single continuous low-altitude drone shot advances over the environment, then rises gradually while yawing just enough to reveal the wider geography. Stable horizon, coherent parallax, plausible inertia, subtle wind buffeting and realistic exposure adaptation. Preserve spatial continuity and scale. Natural environmental sound only, no cuts, no impossible acceleration, no random orbit.",
  },
});

const ACTION_H3_PRESETS = Object.freeze({
  custom: {
    hint: "Personalizzato: mantiene parametri e stack LoRA ACTION correnti.",
    loras: [],
  },
  streetBrawlVerite: {
    hint: "Rissa realistica vérité: scontri ravvicinati, camera umana e impatti credibili. Combat 0,75 · Realism 0,65 · Motion 0,30 · diretto 0,9 MP.",
    duration: "6", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.75, quality: "direct09", look: "amateurHandheld",
    loras: [{ type: "realism", strength: 0.65 }, { type: "motion", strength: 0.3 }],
  },
  fantasyMelee: {
    hint: "Mischia fantasy realistica: peso di armi, cuoio, fango e collisioni ambientali senza effetto CGI. Combat 0,80 · Realism 0,55 · Motion 0,35 · diretto 0,9 MP.",
    duration: "8", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.8, quality: "direct09", look: "documentary",
    loras: [{ type: "realism", strength: 0.55 }, { type: "motion", strength: 0.35 }],
  },
  cinematicOneTake: {
    hint: "Duello cinematografico one-take: regia motivata, silhouette leggibili e nessun taglio inventato. Combat 0,70 · Realism 0,50 · Motion 0,35 · 0,4 → 1,0 MP.",
    duration: "8", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.7, quality: "twoPass04", look: "documentary",
    loras: [{ type: "realism", strength: 0.5 }, { type: "motion", strength: 0.35 }],
  },
  brutalFinisher: {
    hint: "Finisher brutale: escalation breve e un solo colpo conclusivo enfatizzato, con reazione e recupero completi. Combat 0,90 · Realism 0,60 · Motion 0,25 · diretto 0,9 MP.",
    duration: "6", aspect: "16:9 (Widescreen)", trigger: "prfight2, prfin1", combatStrength: 0.9, quality: "direct09", look: "amateurHandheld",
    loras: [{ type: "realism", strength: 0.6 }, { type: "motion", strength: 0.25 }],
  },
  readableGroupFight: {
    hint: "Combattimento di gruppo leggibile: un protagonista, attacchi scaglionati e geografia stabile. Combat 0,80 · Realism 0,55 · Motion 0,45 · diretto 0,9 MP.",
    duration: "6", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.8, quality: "direct09", look: "amateurHandheld",
    loras: [{ type: "realism", strength: 0.55 }, { type: "motion", strength: 0.45 }],
  },
  smoothChoreography: {
    hint: "Coreografia fluida: Combat 0,75 · Better Motion 0,45 · Realism 0,50 · Turbo OFF · 0,9 MP. Evita Motion Booster e privilegia contatti leggibili.",
    duration: "8", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.75, quality: "direct09", look: "documentary", turbo: false,
    loras: [{ type: "betterMotion", strength: 0.45 }, { type: "realism", strength: 0.5 }],
  },
  fantasyBattleVerite: {
    hint: "Battaglia fantasy vérité: Combat 0,80 · Better Motion 0,45 · Realism 0,55 · camera fisica, 0,9 MP e Turbo OFF.",
    duration: "8", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.8, quality: "direct09", look: "amateurHandheld", turbo: false,
    loras: [{ type: "betterMotion", strength: 0.45 }, { type: "realism", strength: 0.55 }],
  },
  aerialAction: {
    hint: "Azione aerea: Combat 0,65 · Drone 0,60 · Realism 0,45. Per inseguimenti o battaglie leggibili dall’alto, senza Motion Booster.",
    duration: "8", aspect: "16:9 (Widescreen)", trigger: "prfight2", combatStrength: 0.65, quality: "direct09", look: "documentary", turbo: false,
    loras: [{ type: "drone", strength: 0.6 }, { type: "realism", strength: 0.45 }],
  },
});

const LTX25_LORA_PRESETS = Object.freeze({
  custom: {
    hint: "Personalizzato: lo stack LoRA corrente non viene modificato.",
    loras: [],
  },
  selfieOrganic: {
    hint: "Selfie Organic: massima aderenza al volto, contrasto meno lucido e movimento semplice. Amateur Hour 0,60.",
    loras: [{ match: /AmateurHour.*rank16/i, strength: 0.6 }],
  },
  selfieHandheld: {
    hint: "Selfie Handheld: resa amatoriale, autofocus imperfetto e movimento fisico più credibile. Amateur 0,50 · VBVR 390K 0,55 · Soft 0,20.",
    loras: [
      { match: /AmateurHour.*rank16/i, strength: 0.5 },
      { match: /VBVR-I2V-390K-R32/i, strength: 0.55 },
      { match: /Soft_Enhance/i, strength: 0.2 },
    ],
  },
  fantasyHandheld: {
    hint: "Fantasy Handheld: live-action fantasy più materico, con camera e movimento plausibili. Amateur 0,40 · Fantasy Realism 0,45 · VBVR 390K 0,50.",
    loras: [
      { match: /AmateurHour.*rank16/i, strength: 0.4 },
      { match: /Fantasy_Realism/i, strength: 0.45 },
      { match: /VBVR-I2V-390K-R32/i, strength: 0.5 },
    ],
  },
  cinematicNatural: {
    hint: "Cinematografico naturale: dettaglio controllato senza pelle eccessivamente affilata, con coerenza temporale. Crisp 0,30 · Soft 0,20 · VBVR 390K 0,45.",
    loras: [
      { match: /Crisp_Enhance/i, strength: 0.3 },
      { match: /Soft_Enhance/i, strength: 0.2 },
      { match: /VBVR-I2V-390K-R32/i, strength: 0.45 },
    ],
  },
  actionHandheld: {
    hint: "Action Handheld: combattimento crudo e fisico, camera imperfetta ma leggibile. Amateur 0,40 · Fantasy Realism 0,45 · VBVR 390K 0,50 · Crisp 0,20.",
    loras: [
      { match: /AmateurHour.*rank16/i, strength: 0.4 },
      { match: /Fantasy_Realism/i, strength: 0.45 },
      { match: /VBVR-I2V-390K-R32/i, strength: 0.5 },
      { match: /Crisp_Enhance/i, strength: 0.2 },
    ],
  },
  actionCinematic: {
    hint: "Action Cinematic: duello continuo, movimento controllato e impatti definiti senza tagli automatici. VBVR 390K 0,50 · Crisp 0,30 · Fantasy Realism 0,30.",
    loras: [
      { match: /VBVR-I2V-390K-R32/i, strength: 0.5 },
      { match: /Crisp_Enhance/i, strength: 0.3 },
      { match: /Fantasy_Realism/i, strength: 0.3 },
    ],
  },
  actionMultishot: {
    hint: "Action Multishot: montaggio d'azione con veri cambi d'inquadratura. Cinematic Hardcut 0,40 · VBVR 390K 0,45 · Crisp 0,25. Non usarlo per un piano sequenza.",
    loras: [
      { match: /Cinematic hardcut/i, strength: 0.4 },
      { match: /VBVR-I2V-390K-R32/i, strength: 0.45 },
      { match: /Crisp_Enhance/i, strength: 0.25 },
    ],
  },
});

const LTX25_PRESET_LORA_MATCHERS = Object.freeze([
  /AmateurHour.*rank16/i,
  /VBVR-I2V-390K-R32/i,
  /Soft_Enhance/i,
  /Fantasy_Realism/i,
  /Crisp_Enhance/i,
  /Cinematic hardcut/i,
]);

async function api(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
  return payload;
}

function jsonApi(url, body, options = {}) {
  return api(url, {
    ...options,
    method: options.method || "POST",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: JSON.stringify(body || {}),
  });
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function interactiveCastChatGptAnchorPrompt(project, segment, task) {
  const actor = task?.actorReferences?.[0] || {};
  const actorName = actor.name || "the added adult actor";
  const requestedChange = String(segment?.reason || task?.anchorRequirement || "insert the added actor naturally into the scene")
    .replace(/\s+/g, " ")
    .trim();
  const identityDetails = [
    actor.identityHints?.face ? `face: ${actor.identityHints.face}` : "",
    actor.identityHints?.hair ? `hair: ${actor.identityHints.hair}` : "",
    actor.identityHints?.body ? `body: ${actor.identityHints.body}` : "",
  ].filter(Boolean).join("; ");

  return [
    "Edit IMAGE 1 using IMAGE 2 only as the visual identity reference for the new person.",
    "IMAGE 1 is the authoritative source frame. Preserve its exact aspect ratio, framing, camera position, lens, perspective, background, set, lighting, color grade, grain, depth of field, and every original person.",
    `Add exactly one adult person matching IMAGE 2: ${actorName}.`,
    identityDetails ? `Identity details to preserve: ${identityDetails}.` : "Preserve the face, hair, body proportions, age, and recognizable identity shown in IMAGE 2.",
    `Requested scene change: ${requestedChange}.`,
    "Create one believable static movie frame from the early part of that action, with the added person already clearly visible and naturally integrated. Show the face clearly enough to verify identity. Match scale, eyeline, pose, occlusion, contact shadows, reflected light, sharpness, motion blur, and film grain to IMAGE 1.",
    "Do not replace, move, duplicate, restyle, or alter the original people. Do not import the background, layout, text, borders, or composition of IMAGE 2. Do not create a collage, split screen, character sheet, inset, frame-within-a-frame, or before/after comparison.",
    "Do not add subtitles, captions, labels, watermarks, or visible dialogue. Output only the final edited image at the same dimensions as IMAGE 1.",
  ].join("\n\n");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function selectedCharacter() {
  const id = $("#videoCharacterId")?.value;
  if (!id) return null;
  return (state.config?.characters?.availableCharacters || []).find((character) => character.id === id) || null;
}

function syncCharacterFields() {
  const character = selectedCharacter();
  const settings = character?.settings || {};
  $("#videoCharacterIdentityStrength").value = settings.identityStrength || "medium";
  $("#videoCharacterLockFace").value = String(settings.lockFace ?? true);
  $("#videoCharacterLockHair").value = String(settings.lockHair ?? true);
  $("#videoCharacterLockBody").value = String(settings.lockBody ?? true);
  $("#videoCharacterLockOutfit").value = String(settings.lockOutfit ?? false);
  $("#videoCharacterPromptEnhanced").value = "";
  $("#video-character-hint").textContent = character
    ? "Per i video il Character Pack prepara reference e futuro anchor frame; se il workflow non supporta conditioning verra' dichiarato come fallback."
    : "Usa il Character Pack come identita, reference sheet o base futura per anchor frame.";
}

function mode() {
  return document.querySelector("[name=videoStudioMode]:checked")?.value || "actorReplacement";
}

function setConnection(online) {
  const connection = $("#connection");
  connection.className = `connection ${online ? "online" : "offline"}`;
  connection.innerHTML = `<span></span>${online ? "ComfyUI online" : "ComfyUI offline"}`;
}

async function checkHealth() {
  try {
    await api("/api/health");
    const shouldRefreshCapabilities = state.comfyOnline !== true || !state.readiness.ready;
    state.comfyOnline = true;
    setConnection(true);
    if (shouldRefreshCapabilities && state.config && !state.configRefreshInFlight) {
      state.configRefreshInFlight = true;
      try {
        state.config = await getAppConfig({ force: true });
        updateReadiness();
      } finally {
        state.configRefreshInFlight = false;
      }
    }
  } catch {
    state.comfyOnline = false;
    setConnection(false);
  }
}

function renderDialogue() {
  $("#dialogue-list").innerHTML = state.dialogue.map((row, index) => `
    <div class="dialogue-row" data-dialogue="${index}">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <input class="dialogue-speaker" aria-label="Personaggio battuta ${index + 1}" value="${escapeHtml(row.speaker)}" placeholder="Personaggio">
      <input class="dialogue-line" aria-label="Testo battuta ${index + 1}" value="${escapeHtml(row.line)}" placeholder="Battuta…">
      <input class="dialogue-delivery" aria-label="Recitazione battuta ${index + 1}" value="${escapeHtml(row.delivery)}" placeholder="tono / sguardo">
      <button type="button" aria-label="Rimuovi battuta ${index + 1}" data-remove-dialogue="${index}">×</button>
    </div>
  `).join("");
  syncDialogue();
}

function syncDialogue() {
  state.dialogue = [...document.querySelectorAll("#dialogue-list .dialogue-row")].map((row) => ({
    speaker: row.querySelector(".dialogue-speaker").value.trim(),
    line: row.querySelector(".dialogue-line").value.trim(),
    delivery: row.querySelector(".dialogue-delivery").value.trim(),
  }));
  $("#dialogue-json").value = JSON.stringify(state.dialogue);
}

function videoLoraChoices(selectedMode = mode()) {
  const h3ModeActive = ["minimaxH3", "actionH3", "seedHunterH3"].includes(selectedMode);
  const choices = h3ModeActive
    ? state.config?.videoStudio?.h3Loras || []
    : state.config?.videoStudio?.ltxLoras || [];
  return choices.filter((name) => selectedMode !== "actionH3" || name !== state.config?.videoStudio?.h3?.files?.combat);
}

function renderLoraPicker() {
  const picker = $("#video-lora-picker");
  const addButton = $("#video-add-lora");
  if (!picker || !addButton) return;
  const metadata = state.config?.loraMetadata || state.config?.videoStudio?.h3LoraMetadata;
  const selectedNames = new Set(state.loras.map((item) => item.name));
  const choices = videoLoraChoices().filter((name) => !selectedNames.has(name));
  picker.innerHTML = choices.length
    ? choices.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(loraOptionLabel(name, metadata))}</option>`).join("")
    : '<option value="">Nessuna altra LoRA disponibile</option>';
  picker.disabled = choices.length === 0;
  addButton.disabled = choices.length === 0;
}

function renderLoras() {
  const choices = videoLoraChoices();
  $("#video-loras").innerHTML = state.loras.map((row, index) => `
    <div class="studio-lora-row" data-video-lora="${index}">
      <select aria-label="LoRA Video Studio ${index + 1}">
        ${choices.map((name) => {
          const label = loraOptionLabel(name, state.config?.loraMetadata || state.config?.videoStudio?.h3LoraMetadata);
          return `<option value="${escapeHtml(name)}" ${name === row.name ? "selected" : ""}>${escapeHtml(label)}</option>`;
        }).join("")}
      </select>
      <input aria-label="Forza LoRA Video Studio ${index + 1}" type="number" min="-2" max="2" step=".05" value="${Number(row.strength ?? .8)}">
      <button type="button" data-remove-lora="${index}" aria-label="Rimuovi LoRA ${index + 1}">×</button>
    </div>
  `).join("");
  syncLoras();
  renderLoraPicker();
}

function ltx25LoraBasename(name) {
  return String(name || "").split(/[\\/]/).pop() || "";
}

function updateLtx25LoraPresetHint() {
  const preset = LTX25_LORA_PRESETS[$("#ltx25LoraPreset")?.value] || LTX25_LORA_PRESETS.custom;
  const hint = $("#ltx25-lora-preset-hint");
  if (hint) hint.textContent = preset.hint;
}

function applyLtx25LoraPreset() {
  const presetId = $("#ltx25LoraPreset")?.value || "custom";
  const preset = LTX25_LORA_PRESETS[presetId] || LTX25_LORA_PRESETS.custom;
  updateLtx25LoraPresetHint();
  if (presetId === "custom") return showToast("Stack LoRA LTX 2.5 lasciato invariato.");

  const available = videoLoraChoices("ltx25Aio");
  const managed = (name) => LTX25_PRESET_LORA_MATCHERS.some((matcher) => matcher.test(ltx25LoraBasename(name)));
  const preserved = state.loras.filter((item) => !managed(item.name));
  const missing = [];
  const selected = preset.loras.flatMap((entry) => {
    const name = available.find((candidate) => entry.match.test(ltx25LoraBasename(candidate)));
    if (!name) {
      missing.push(String(entry.match).replaceAll("/", ""));
      return [];
    }
    return [{ name, strength: entry.strength }];
  });
  state.loras = [...preserved, ...selected];
  renderLoras();
  showToast(missing.length
    ? `Preset applicato parzialmente: ${missing.length} LoRA non trovate.`
    : `Preset applicato: ${preset.hint.split(":")[0]}.`);
}

function syncLoras() {
  state.loras = [...document.querySelectorAll("[data-video-lora]")].map((row) => ({
    name: row.querySelector("select").value,
    strength: Number(row.querySelector("input").value),
  })).filter((row) => row.name);
  $("#video-loras-json").value = JSON.stringify(state.loras);
}

function findH3RealismPeopleLora() {
  return (state.config?.videoStudio?.h3Loras || []).find((name) => /(?:^|[\\/])STY_Realism_People\.safetensors$/i.test(name)) || "";
}

function findH3MotionBoosterLora() {
  return (state.config?.videoStudio?.h3Loras || []).find((name) => /(?:^|[\\/])STY_Motion_Booster\.safetensors$/i.test(name)) || "";
}

function findH3PresetLora(type) {
  const matchers = {
    realism: /STY_Realism_People\.safetensors$/i,
    motion: /STY_Motion_Booster\.safetensors$/i,
    betterMotion: /MOT_Better_Motion\.safetensors$/i,
    zeroTwo: /MOT_Zero_Two_Dance\.safetensors$/i,
    whisper: /AUD_Whispering\.safetensors$/i,
    drone: /CAM_Drone_Shot\.safetensors$/i,
  };
  return (state.config?.videoStudio?.h3Loras || []).find((name) => matchers[type]?.test(name)) || "";
}

function updateActionH3PresetHint() {
  const preset = ACTION_H3_PRESETS[$("#actionH3Preset")?.value] || ACTION_H3_PRESETS.custom;
  const hint = $("#action-h3-preset-hint");
  if (hint) hint.textContent = preset.hint;
}

function applyActionH3Preset() {
  const presetId = $("#actionH3Preset")?.value || "custom";
  const preset = ACTION_H3_PRESETS[presetId] || ACTION_H3_PRESETS.custom;
  updateActionH3PresetHint();
  if (presetId === "custom") return showToast("Parametri ACTION H3 lasciati invariati.");

  $("#actionH3Duration").value = preset.duration;
  $("#actionH3AspectRatio").value = preset.aspect;
  $("#actionH3RunProfile").value = "preview";
  $("#actionH3Trigger").value = preset.trigger;
  $("#actionH3CombatStrength").value = String(preset.combatStrength);
  $("#actionH3Quality").value = preset.quality;
  $("#h3LookPreset").value = preset.look;
  $("#h3ScenePreset").value = "none";
  if (typeof preset.turbo === "boolean") $("#h3UseTurbo").checked = preset.turbo;

  const installedByType = {
    realism: findH3RealismPeopleLora(),
    motion: findH3MotionBoosterLora(),
    betterMotion: findH3PresetLora("betterMotion"),
    drone: findH3PresetLora("drone"),
  };
  const managedNames = Object.values(installedByType).filter(Boolean);
  state.loras = state.loras.filter((item) => !managedNames.includes(item.name));
  const missing = [];
  for (const entry of preset.loras) {
    const name = installedByType[entry.type];
    if (name) state.loras.push({ name, strength: entry.strength });
    else missing.push(entry.type);
  }
  renderLoras();
  updateActionH3Fields();
  $("#actionH3Prompt")?.dispatchEvent(new Event("input", { bubbles: true }));
  showToast(missing.length
    ? `Preset ACTION applicato parzialmente: LoRA ${missing.join(", ")} non trovata.`
    : `Preset ACTION applicato: ${preset.hint.split(":")[0]}.`);
}

function updateH3ScenePresetHint() {
  const selected = $("#h3ScenePreset")?.value;
  const hint = $("#h3-scene-preset-hint");
  if (!hint) return;
  hint.textContent = H3_SCENE_PRESETS[selected]?.hint
    || "Personalizzata: nessun vincolo scena aggiuntivo; i singoli controlli restano interamente manuali.";
}

function applyH3ScenePreset() {
  const preset = H3_SCENE_PRESETS[$("#h3ScenePreset")?.value];
  if (!preset) {
    updateH3ScenePresetHint();
    return showToast("Seleziona una ricetta H3 per applicarla.");
  }
  $("#h3Mode").value = preset.mode;
  $("#h3Duration").value = preset.duration;
  $("#h3AspectRatio").value = preset.aspect;
  $("#h3LookPreset").value = preset.look;
  $("#h3RunProfile").value = preset.final ? "nativeFinal" : "preview";
  $("#h3FirstMegapixels").value = preset.final ? "0.9" : "0.4";
  $("#h3RefineMode").value = "direct";
  $("#h3AttentionBackend").value = "memoryEfficient";
  $("#h3UseTurbo").checked = false;
  $("#h3PurgeBetween").checked = true;
  $("#h3PurgeAfter").checked = true;
  $("#h3ReferenceSize").value = "match";
  if (!$("#h3Prompt").value.trim()) $("#h3Prompt").value = preset.starter;

  const managedLoras = ["realism", "motion", "betterMotion", "zeroTwo", "whisper", "drone"].map(findH3PresetLora).filter(Boolean);
  state.loras = state.loras.filter((item) => !managedLoras.includes(item.name));
  const selectedLora = findH3PresetLora(preset.lora);
  if (selectedLora) {
    state.loras.push({ name: selectedLora, strength: preset.strength });
  }
  for (const entry of preset.extraLoras || []) {
    const name = findH3PresetLora(entry.type);
    if (name) state.loras.push({ name, strength: entry.strength });
  }
  renderLoras();
  updateH3Fields();
  updateH3ScenePresetHint();
  $("#h3Prompt").dispatchEvent(new Event("input", { bubbles: true }));
  showToast(selectedLora
    ? `Preset H3 applicato con ${preset.lora} ${preset.strength.toFixed(2).replace(".", ",")}.`
    : "Preset applicato; la LoRA consigliata non è installata, quindi la ricetta prosegue senza LoRA.");
}

function selectedVideoPromptTriggers(selectedMode) {
  const metadata = state.config?.loraMetadata || state.config?.videoStudio?.h3LoraMetadata || {};
  const triggers = automaticLoraTriggers(state.loras, metadata);
  if (selectedMode === "actionH3") {
    triggers.unshift($("#actionH3Trigger")?.value || "");
  }
  return uniquePromptTriggers(triggers);
}

function h3LoraPromptContract(triggers = []) {
  const selected = uniquePromptTriggers(triggers);
  if (!selected.length) return "No verified LoRA activation word is required.";
  const directions = selected.map((trigger) => {
    const key = trigger.toLocaleLowerCase();
    if (key === "r34l1sm") return "r34l1sm: favor natural human appearance, skin texture, restrained performance and physically ordinary imperfections; avoid polished AI gloss.";
    if (key === "dynv2") return "dynv2: describe one readable continuous motion path with acceleration, inertia, camera response and a stable ending; do not replace choreography with vague dynamic language.";
    if (key === "hmmotion") return "hmmotion: describe contact, body mechanics and temporal motion precisely, but only for actions explicitly requested by the user.";
    if (key === "prfight2") return "prfight2: intensify coherent combat motion, impacts and cumulative reactions while preserving anatomy and readable staging.";
    if (key === "prfin1") return "prfin1: reserve the strongest emphasis for the requested decisive final action and its complete physical recovery or fall.";
    return `${trigger}: preserve this verified activation word exactly and adapt the scene only to the LoRA purpose implied by the selected LoRA and the user's request.`;
  });
  return `Selected H3 LoRA behavior is active. Do not copy activation words into the rewritten output; the application inserts them after LM Studio finishes. LoRA-specific direction: ${directions.join(" ")}`;
}

function applyVideoPromptTriggers(input, selectedMode, triggers = selectedVideoPromptTriggers(selectedMode)) {
  if (["minimaxH3", "actionH3", "seedHunterH3"].includes(selectedMode)) {
    return applyH3LoraTriggers(input, triggers);
  }
  return applyLoraTriggers(input, triggers);
}

function capabilityBlockDetail(capability, fallback) {
  if (!capability) return fallback;
  const problems = [];
  if (capability.modelReady === false) problems.push("modello/LoRA richiesto non rilevato");
  if (capability.commonReady === false) problems.push("checkpoint LTX 2.3 o text encoder non rilevato");
  if (capability.nodesReady === false && capability.missingNodes?.length) {
    problems.push(`nodi ComfyUI mancanti: ${capability.missingNodes.join(", ")}`);
  }
  return problems.length ? problems.join(" · ") : fallback;
}

function updateReadiness() {
  const videoConfig = state.config.videoStudio;
  const selectedMode = mode();
  const readiness = $("#video-studio-readiness");
  let ready;
  let title;
  let detail;

  if (selectedMode === "ltx25Aio") {
    ready = Boolean(videoConfig.ltx25?.available);
    title = ready ? "LTX 2.5 AIO INT8 pronto" : "LTX 2.5 AIO non disponibile";
    const selectedLtx25Mode = $("#ltx25Mode")?.value || "text";
    const selectedCapability = videoConfig.ltx25?.modes?.[selectedLtx25Mode];
    if (ready && selectedCapability?.available === false) {
      ready = false;
      title = `${$("#ltx25Mode")?.selectedOptions?.[0]?.textContent || selectedLtx25Mode} non installato`;
      detail = selectedCapability.reason || "Manca una dipendenza opzionale per questa modalità.";
    } else {
      detail = ready
        ? "Transformer e Gemma INT8, VAE audio/video e purge multi-fase rilevati. Conv VAE tiled consigliato per 12 GB."
        : videoConfig.ltx25?.reason || "Controlla modelli LTX 2.5 e nodi ComfyUI-LTXVideo.";
    }
  } else if (selectedMode === "minimaxH3") {
    ready = Boolean(videoConfig.h3?.available);
    title = ready ? "MiniMax H3 INT8 pronto" : "MiniMax H3 non disponibile";
    detail = ready
      ? `${videoConfig.h3Loras.length} LoRA H3 rilevate · FL2VA e Ref2VA pronti · doppio sampling con purge disponibile.`
      : videoConfig.h3?.reason || "Controlla modelli, VAE, Qwen3-VL e nodi H3.";
  } else if (selectedMode === "seedHunterH3") {
    ready = Boolean(videoConfig.h3?.available && videoConfig.h3?.seedHunter?.available);
    title = ready ? "Seed Hunter H3 pronto · 3 job" : "Seed Hunter H3 non disponibile";
    detail = ready
      ? "Tre sampling separati a 0,25 MP, seed consecutivi e selezione individuale; nessun SaveLatent su NestedTensor AV."
      : videoConfig.h3?.reason || "Controlla modelli e nodi MiniMax H3.";
  } else if (selectedMode === "actionH3") {
    ready = Boolean(videoConfig.h3?.actionAvailable);
    title = ready ? "ACTION H3 pronto" : "ACTION H3 non disponibile";
    detail = ready
      ? `FL2VA INT8 · ${videoConfig.h3.files.combat} · res_multistep + simple · nessun modello aggiuntivo.`
      : videoConfig.h3?.actionReason || videoConfig.h3?.reason || "Controlla FL2VA e Combat Base V2.";
  } else if (selectedMode === "sequentialStory") {
    ready = Boolean(state.config.promptAssistant?.enabled);
    title = ready ? "Storia continua pronta" : "Storia continua richiede LM Studio";
    detail = ready
      ? "LM Studio pianifica le scene; Node genera una clip alla volta, estrae continuity frame, fa purge e concatena."
      : "Configura il Prompt Assistant locale per generare la scaletta JSON prima del render.";
  } else if (selectedMode === "interactiveScene") {
    const capability = videoConfig.capabilities.ingredients;
    ready = capability.available;
    title = ready ? "Interactive Scene pronto" : "Interactive Scene non disponibile";
    detail = ready
      ? `Ingredients installato${videoConfig.capabilities.lipdub.available ? " · LipDub disponibile" : " · LipDub mancante"}`
      : capabilityBlockDetail(capability, "Manca la IC-LoRA Ingredients oppure uno dei nodi LTX richiesti.");
  } else if (selectedMode === "interactiveCast") {
    const cast = state.config.interactiveCast;
    ready = Boolean(cast?.matrix?.videoAnalysis && cast?.matrix?.temporalSplice);
    title = ready ? "Interactive Cast pronto" : "Interactive Cast richiede FFmpeg/FFprobe";
    detail = ready
      ? `Pipeline ibrida pronta: tracking, timeline, anchor e segmenti LTX automatici${cast?.matrix?.voiceClone ? " · voce locale" : ""}${cast?.matrix?.lipSync ? " · lip-sync locale" : ""}. Le capability opzionali sono indicate nella matrice.`
      : "Installa FFmpeg/FFprobe nel PATH prima di creare progetti Interactive Cast.";
  } else if (selectedMode === "sceneTransform") {
    const capability = videoConfig.capabilities.unionControl;
    ready = capability.available;
    title = ready ? "Scene Transform Union Control pronto" : "Union Control non disponibile";
    detail = ready
      ? "Usa il video come guida temporale e il frame/reference come destinazione visiva."
      : capabilityBlockDetail(capability, "Installa la IC-LoRA Union Control e i nodi Canny/DW Pose LTX 2.3.");
  } else if (selectedMode === "actorReplacement") {
    const engine = $("#actorEngine").value;
    ready = engine === "unionControl"
      ? videoConfig.capabilities.unionControl.available
      : engine === "trackedInpaint"
        ? videoConfig.capabilities.inpaint.available
          && ($("#selectionMode").value === "manual" || videoConfig.capabilities.autoMask.available)
        : true;
    title = engine === "unionControl"
        ? (ready ? "Union Control corpo completo pronto" : "Union Control non disponibile")
        : engine === "trackedInpaint"
        ? (ready ? "LTX 2.3 Actor Replace pronto" : "Actor Replace richiede modello o maschera")
        : "Fallback Edit Anything pronto";
    detail = engine === "unionControl"
        ? "Consigliato per sostituire l'intero personaggio seguendo ballo, posa e camera del video."
        : engine === "trackedInpaint"
        ? (ready
            ? $("#selectionMode").value === "manual"
              ? "Userà il video maschera caricato manualmente."
              : "SAM3 traccia la zona scelta; LTX sostituisce viso, testa o corpo in quella regione."
            : "Installa la IC-LoRA In/Outpainting e SAM3, oppure usa una maschera video manuale.")
        : "Richiede una Identity LoRA personale; la reference fotografica da sola non codifica l’identità.";
  } else {
    const capabilityId = {
      hdr: "hdr",
      temporalUpscale: "temporalUpscale",
    }[selectedMode];
    const capability = capabilityId ? videoConfig.capabilities[capabilityId] : null;
    ready = capability ? capability.available : true;
    title = {
      hdr: ready ? "HDR IC-LoRA pronto" : "HDR in attesa del modello ufficiale",
      retake: "Retake con LTX 2.3",
      extend: "Extend con LTX 2.3",
      temporalUpscale: "Temporal Upscaler 2×",
    }[selectedMode];
    detail = ready
      ? {
          hdr: "Usa la pipeline IC-LoRA ufficiale, separata dai workflow LTX 2.3 Sulphur.",
          retake: "Video-to-video generativo con audio sorgente conservato.",
          extend: "Estrae l’ultimo frame, genera la continuazione e accoda video e audio.",
          temporalUpscale: "Raddoppia i frame nello spazio latente; può mantenere durata o creare slow motion.",
        }[selectedMode]
      : capability?.modelReady
        ? `Mancano nodi ComfyUI: ${(capability.missingNodes || []).join(", ")}`
        : selectedMode === "hdr"
          ? "La IC-LoRA HDR ufficiale è gated: occorre accettare la licenza Lightricks e installarla."
          : "Manca il modello richiesto nell’istanza ComfyUI attiva.";
  }
  readiness.className = `video-readiness ${ready ? "ready" : "blocked"}`;
  readiness.innerHTML = `<span>${ready ? "✓" : "!"}</span><div><b>${escapeHtml(title)}</b><p>${escapeHtml(detail)}</p></div>`;
  state.readiness = { ready, title, detail };
  const submit = $("#video-studio-submit");
  submit.disabled = false;
  submit.dataset.preflightBlocked = ready ? "false" : "true";
  submit.setAttribute("aria-disabled", String(!ready));
  submit.title = ready ? "" : `${title}: ${detail}`;
  return state.readiness;
}

function updateWorkflowGuideLink() {
  const routes = {
    actorReplacement: "actorReplacement",
    interactiveScene: "interactiveScene",
    sceneTransform: "sceneTransform",
    retake: "retake",
    extend: "extend",
    hdr: "hdr",
    sequentialStory: "sequentialStory",
    minimaxH3: "minimaxH3",
    actionH3: "actionH3",
  };
  const link = $("#video-studio-guided-workflow");
  const route = routes[mode()];
  link?.classList.toggle("hidden", !route);
  if (link && route) link.href = `/guided-create.html?workflow=${route}`;
}

function castStatusClass(status) {
  const text = String(status || "NOT CONFIGURED").toUpperCase();
  if (text.includes("READY") || text.includes("WORKING")) return "ready";
  if (text.includes("FALLBACK")) return "fallback";
  return "not-configured";
}

function renderInteractiveCastCapabilities() {
  const host = $("#interactive-cast-capabilities");
  if (!host) return;
  const cast = state.config?.interactiveCast || {};
  const statuses = cast.statuses || {};
  const matrix = cast.matrix || {};
  const rows = [
    ["Video analysis", statuses.videoAnalysis, matrix.videoAnalysis],
    ["Actor tracking", statuses.personTracking, matrix.actorTracking],
    ["Scene segmentation", statuses.sceneSegmentation, true],
    ["Audio extraction", statuses.audioExtraction, matrix.audioSeparation],
    ["Source separation", statuses.sourceSeparation, matrix.audioSeparation],
    ["Speaker diarization", statuses.speakerDiarization, matrix.diarization],
    ["Voice cloning", statuses.voiceCloning, matrix.voiceClone],
    ["Lip-sync", statuses.lipSync, matrix.lipSync],
    ["Character insertion", statuses.ltxSegmentGeneration, matrix.characterInsertion],
    ["Identity check", statuses.identityCheck, matrix.identityCheck],
    ["Masked compositing", statuses.maskedCompositing || statuses.compositing, matrix.maskedCompositing],
    ["Audio remix", statuses.audioRemix, matrix.audioSeparation],
    ["Temporal splice", statuses.temporalSplice || (matrix.temporalSplice ? "READY" : "NOT CONFIGURED"), matrix.temporalSplice],
    ["Final encode", statuses.finalEncode || (matrix.finalEncode ? "READY" : "NOT CONFIGURED"), matrix.finalEncode],
  ];
  const gpu = cast.hardware?.gpu;
  const disk = cast.hardware?.disk;
  const comfyTorch = cast.runtimes?.comfyPython?.torch;
  host.innerHTML = `
    <div class="interactive-cast-capability-grid">
      ${rows.map(([label, status, available]) => {
        const displayStatus = status || (available ? "READY" : "NOT CONFIGURED");
        return `<span class="cast-capability ${castStatusClass(displayStatus)}"><b>${escapeHtml(label)}</b><em>${escapeHtml(displayStatus)}</em></span>`;
      }).join("")}
    </div>
    <div class="interactive-cast-runtime-strip">
      <small><b>GPU</b> ${escapeHtml(gpu?.available ? `${gpu.name || "NVIDIA"} · ${gpu.vramMb || "?"} MB VRAM` : "NOT CONFIGURED")}</small>
      <small><b>Disco tool</b> ${escapeHtml(disk?.available ? `${disk.freeGb} GB liberi` : "n/d")}</small>
      <small><b>Comfy Torch</b> ${escapeHtml(comfyTorch?.cudaAvailable ? `${comfyTorch.torch} · CUDA ${comfyTorch.cudaVersion}` : "NOT CONFIGURED")}</small>
    </div>
  `;
}

async function refreshInteractiveCastCapabilities(button = null, { silent = false } = {}) {
  if (button) {
    button.disabled = true;
    button.textContent = "Aggiorno...";
  }
  try {
    state.config.interactiveCast = await api("/api/interactive-cast/capabilities");
    renderInteractiveCastCapabilities();
    updateReadiness();
    if (button && !silent) showToast("Capability Interactive Cast aggiornate.");
  } catch (error) {
    if (!silent) showToast(error.message);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Aggiorna capability";
    }
  }
}

function updateH3Fields() {
  updateH3ScenePresetHint();
  const active = mode() === "minimaxH3";
  const modelSelect = $("#h3ModelProfile");
  const erosCapability = state.config?.videoStudio?.h3?.modelProfiles?.erosMax;
  const erosOption = [...(modelSelect?.options || [])].find((option) => option.value === "erosMax");
  if (erosOption) {
    erosOption.disabled = erosCapability?.available === false;
    erosOption.title = erosOption.disabled ? "h3ErosMax_beta3.safetensors non è installato." : "Turbo integrato · 6 step er_sde/simple";
  }
  if (modelSelect?.selectedOptions[0]?.disabled) modelSelect.value = "base";
  const erosMax = modelSelect?.value === "erosMax";
  const firstLastOption = [...($("#h3Mode")?.options || [])].find((option) => option.value === "firstLast");
  if (firstLastOption) {
    firstLastOption.disabled = erosMax;
    firstLastOption.title = erosMax ? "Eros Max usa T2VA o reference; First/Last non è supportato." : "";
  }
  if (erosMax && $("#h3Mode")?.value === "firstLast") $("#h3Mode").value = "text";
  const h3Mode = $("#h3Mode")?.value || "text";
  const promptPreset = $("#h3PromptPreset");
  if (erosMax && promptPreset) {
    promptPreset.value = "h3_eros_max";
  } else if (["image", "firstLast"].includes(h3Mode) && promptPreset?.value === "h3_general") {
    promptPreset.value = "h3_image_to_video";
  } else if (h3Mode === "text" && promptPreset?.value === "h3_image_to_video") {
    promptPreset.value = "h3_general";
  }
  const modelHint = $("#h3-model-hint");
  if (modelHint) modelHint.textContent = erosMax
    ? "Eros Max beta3: T2V usa T2VA; Single Image viene inviata come Picture 1 Ref2VA. Turbo è già incorporato: 6 step er_sde/simple."
    : "Il profilo base usa i checkpoint FL2VA e Ref2VA standard.";
  const turboToggle = $("#h3UseTurbo");
  if (turboToggle) turboToggle.disabled = !active || erosMax;
  if ($("#h3-turbo-text")) $("#h3-turbo-text").textContent = erosMax ? "Turbo integrato nel checkpoint · 6 step" : "Turbo LoRA 8 step";
  const firstFrame = $("#h3-first-frame-field");
  const lastFrame = $("#h3-last-frame-field");
  const references = $("#h3-reference-fields");
  const showFirst = active && ["image", "firstLast"].includes(h3Mode);
  const showLast = active && h3Mode === "firstLast";
  const showReferences = active && h3Mode === "references";
  firstFrame?.classList.toggle("hidden", !showFirst);
  lastFrame?.classList.toggle("hidden", !showLast);
  references?.classList.toggle("hidden", !showReferences);
  firstFrame?.querySelectorAll("input").forEach((input) => { input.disabled = !showFirst; });
  lastFrame?.querySelectorAll("input").forEach((input) => { input.disabled = !showLast; });
  references?.querySelectorAll("input, select").forEach((input) => { input.disabled = !showReferences; });

  const refineSelect = $("#h3RefineMode");
  const refineAvailability = state.config?.videoStudio?.h3?.refineAvailability || {};
  for (const option of refineSelect?.options || []) {
    if (["latentLearned", "seedvr2", "rtx"].includes(option.value)) {
      option.disabled = refineAvailability[option.value] === false;
      option.title = option.disabled ? "Nodo ComfyUI non disponibile: riavvia o reinstalla il refine selezionato." : "";
    }
  }
  if (refineSelect?.selectedOptions[0]?.disabled) {
    refineSelect.value = refineAvailability.seedvr2 !== false ? "seedvr2" : "h3Balanced";
  }
  const attentionSelect = $("#h3AttentionBackend");
  const attentionAvailability = state.config?.videoStudio?.h3?.attentionAvailability || {};
  for (const option of attentionSelect?.options || []) {
    option.disabled = attentionAvailability[option.value] === false;
  }
  if (attentionSelect?.selectedOptions[0]?.disabled) attentionSelect.value = "memoryEfficient";
  const refineMode = refineSelect?.value || "rtx";
  const hasRefine = active && refineMode !== "direct";
  $("#h3SecondMegapixels").disabled = !active || !["latentLearned", "h3Maximum"].includes(refineMode);
  $("#h3SeedvrResolution").disabled = !active || refineMode !== "seedvr2";
  $("#h3PurgeBetween").disabled = !hasRefine;
  if (active && !hasRefine) {
    $("#h3FirstMegapixels").value = "0.9";
  } else if (active && hasRefine && $("#h3FirstMegapixels").value === "0.9") {
    $("#h3FirstMegapixels").value = "0.6";
  }
  const hint = $("#h3-sampling-hint");
  const firstMp = $("#h3FirstMegapixels").value.replace(".", ",");
  const hints = {
    latentLearned: `Learned Latent 3D: ${firstMp} MP → upscaler neurale temporale → ${$("#h3SecondMegapixels").value.replace(".", ",")} MP → 3 step a sigmas manuali. Più rapido del decode/upscale/re-encode e conserva meglio il moto.`,
    h3Balanced: `H3 bilanciato: ${firstMp} MP → purge forte → 0,9 MP, 3 step e denoise 0,15. Ripete la diffusione H3 ed è lento: usalo solo su clip brevi.`,
    h3Maximum: `H3 massimo: ${firstMp} MP → purge forte → ${$("#h3SecondMegapixels").value.replace(".", ",")} MP, 4 step e denoise 0,20. Ripete H3 ad alta risoluzione: può richiedere ore.`,
    seedvr2: `SeedVR2 3B FP8: ${firstMp} MP → purge forte → restauro temporale a ${$("#h3SeedvrResolution").value} px. Più dettaglio senza ripetere H3.`,
    rtx: `RTX VSR: ${firstMp} MP → purge forte → deblur leggero e upscale hardware. È il refine predefinito e più rapido; nei look realistici conserva grana e imperfezioni.`,
    direct: "Sampling H3 diretto a 0,9 MP: nessun refine intermedio; resta attivo soltanto il purge finale.",
  };
  if (hint) {
    const h3RunProfile = $("#h3RunProfile")?.value;
    hint.textContent = h3RunProfile === "preview"
      ? `ANTEPRIMA: H3 usa temporaneamente 0,4 MP, ${erosMax ? "Turbo Eros integrato a 6 step" : "Turbo 8 step"} e nessun refine. Impostazioni finale salvate: ${hints[refineMode] || hints.h3Balanced}`
      : hints[refineMode] || hints.h3Balanced;
  }
  const loraHint = $("#video-lora-hint");
  if (loraHint) loraHint.textContent = active
    ? "Mostra esclusivamente le LoRA presenti in H3. Se una LoRA ha un trigger univoco verificato, viene aggiunto automaticamente all'inizio del prompt dopo LM Studio."
    : "Puoi concatenare più LoRA LTX 2.3 con forza indipendente.";
}

function updateActionH3Fields() {
  const active = mode() === "actionH3";
  const actionMode = $("#actionH3Mode")?.value || "text";
  const firstFrame = $("#action-h3-first-frame-field");
  const lastFrame = $("#action-h3-last-frame-field");
  const showFirst = active && ["image", "firstLast"].includes(actionMode);
  const showLast = active && actionMode === "firstLast";
  firstFrame?.classList.toggle("hidden", !showFirst);
  lastFrame?.classList.toggle("hidden", !showLast);
  firstFrame?.querySelectorAll("input").forEach((input) => { input.disabled = !showFirst; });
  lastFrame?.querySelectorAll("input").forEach((input) => { input.disabled = !showLast; });
  const loraHint = $("#video-lora-hint");
  if (active && loraHint) {
    loraHint.textContent = "Combat Base V2 viene applicata automaticamente a 0,8 con il trigger scelto sopra; le eventuali LoRA H3 supplementari aggiungono il proprio trigger verificato dopo LM Studio.";
  }
  const actionRunProfile = $("#actionH3RunProfile")?.value;
  const preview = actionRunProfile === "preview";
  const runHint = $("#action-h3-run-hint");
  if (runHint) {
    runHint.textContent = preview
        ? "ANTEPRIMA: 0,4 MP, Combat V2, Turbo 8 step e res_multistep/simple; nessun secondo sampling. La qualità finale resta salvata per la rigenerazione nativa."
        : "FINALE NATIVO: applica il profilo qualità ACTION selezionato con lo stesso stack Combat V2.";
  }
  updateActionH3PresetHint();
}

function updateSeedHunterH3Fields() {
  const active = mode() === "seedHunterH3";
  const selected = $("#seedHunterH3Mode")?.value || "text";
  const showFirst = active && ["image", "firstLast"].includes(selected);
  const showLast = active && selected === "firstLast";
  for (const [selector, show] of [
    ["#seed-hunter-h3-first-frame-field", showFirst],
    ["#seed-hunter-h3-last-frame-field", showLast],
  ]) {
    const field = $(selector);
    field?.classList.toggle("hidden", !show);
    field?.querySelectorAll("input").forEach((input) => { input.disabled = !show; });
  }
  const preset = $("#seedHunterH3PromptPreset");
  if (preset && ["image", "firstLast"].includes(selected) && preset.value === "h3_general") preset.value = "h3_image_to_video";
  if (preset && selected === "text" && preset.value === "h3_image_to_video") preset.value = "h3_general";
}

const LTX25_MODE_HINTS = Object.freeze({
  text: "Text to Video: genera immagine e audio nativo dal prompt.",
  multishot: "Native Multishot: usa SHOT e CUT nel prompt per più inquadrature coerenti in una sola generazione.",
  image: "Image to Video: l’immagine caricata diventa l’ancora iniziale della clip.",
  firstLast: "First/Last: interpola fra due immagini con guide esatte ai frame estremi; usa single-stage per stabilità.",
  keyframes: "Keyframe multipli: primo, immagini intermedie e ultimo frame vengono distribuiti sulla timeline.",
  audio: "Audio to Video: dialogo, ritmo e soundscape del file audio guidano il video; il primo frame è opzionale.",
  textAudio: "Text to Audio: genera soltanto audio nativo LTX 2.5 dal prompt.",
  referenceSheet: "Ingredients: una tavola descrive personaggi, abiti, oggetti e luogo; indica chiaramente le posizioni nel prompt.",
  unionControl: "V2V Union: usa il video come guida temporale Canny o Pose e mantiene il movimento di base. Depth resta opzionale finché non è installato il relativo preprocessore.",
  inpaint: "Inpainting: rigenera soltanto la regione bianca della maschera video.",
  outpaint: "Outpainting: estende il canvas del video verso il formato selezionato.",
  motionTrack: "Motion Track: l’immagine iniziale e le traiettorie preconfigurate guidano il movimento degli elementi.",
  v2vDeblur: "V2V Deblur: rifinisce un video mantenendo struttura e audio; richiede la IC-LoRA Deblur.",
  multiReferenceMsr: "True Multi-Reference: fino a cinque soggetti separati; richiede plugin e LoRA Licon MSR.",
});

function updateLtx25Fields() {
  const active = mode() === "ltx25Aio";
  const selected = $("#ltx25Mode")?.value || "text";
  const first = ["image", "firstLast", "keyframes", "audio", "motionTrack"].includes(selected);
  const last = ["firstLast", "keyframes"].includes(selected);
  const keyframes = selected === "keyframes";
  const reference = selected === "referenceSheet";
  const msr = selected === "multiReferenceMsr";
  const sourceVideo = ["unionControl", "inpaint", "outpaint", "v2vDeblur"].includes(selected);
  const maskVideo = selected === "inpaint";
  const audio = selected === "audio";
  const visibility = {
    "#ltx25-first-frame-field": first,
    "#ltx25-last-frame-field": last,
    "#ltx25-keyframes-field": keyframes,
    "#ltx25-reference-sheet-field": reference,
    "#ltx25-msr-field": msr,
    "#ltx25-source-video-field": sourceVideo,
    "#ltx25-mask-video-field": maskVideo,
    "#ltx25-audio-field": audio,
    "#ltx25-union-options": selected === "unionControl",
    "#ltx25-motion-options": selected === "motionTrack",
  };
  for (const [selector, show] of Object.entries(visibility)) {
    const section = $(selector);
    section?.classList.toggle("hidden", !(active && show));
    section?.querySelectorAll("input, select, textarea").forEach((input) => { input.disabled = !(active && show); });
  }
  const hint = $("#ltx25-mode-hint");
  if (hint) hint.textContent = LTX25_MODE_HINTS[selected] || "Modalità LTX 2.5.";
  const profile = $("#ltx25Profile")?.value || "preview";
  const profileHint = $("#ltx25-profile-hint");
  if (profileHint) {
    profileHint.textContent = selected === "multiReferenceMsr"
      ? "MSR usa single-stage nativo con encode tiled delle reference, crop degli slot prima del decode e purge finale; Finale/Massimo aumentano direttamente la risoluzione."
      : ["referenceSheet", "unionControl", "inpaint", "outpaint", "motionTrack", "v2vDeblur", "audio", "textAudio"].includes(selected)
        ? "Questa modalità usa il workflow ufficiale dedicato; i purge sono inseriti nei confini disponibili senza alterare il controllo IC-LoRA."
      : ["firstLast", "keyframes"].includes(selected) && ["final", "maximum"].includes(profile)
      ? "First/Last e keyframe usano il workflow ufficiale single-stage: il profilo aumenta la risoluzione senza secondo sampling."
      : ["final", "maximum"].includes(profile)
        ? "Two-stage: Stage 1 → purge Transformer → upscaler latente ×2 → purge upscaler → refine 3 step."
        : "Single-stage: più rapido; il seed rimane ripetibile per una successiva generazione finale.";
  }
  const loraHint = $("#video-lora-hint");
  if (active && loraHint) {
    loraHint.textContent = "Mostra le LoRA LTX compatibili; dopo LM Studio i trigger verificati vengono anteposti automaticamente al prompt.";
  }
  updateLtx25LoraPresetHint();
}

function updateMode() {
  const selected = mode();
  const sections = {
    actorReplacement: "#actor-replacement-fields",
    interactiveScene: "#interactive-scene-fields",
    interactiveCast: "#interactive-cast-fields",
    sceneTransform: "#scene-transform-fields",
    retake: "#retake-fields",
    extend: "#extend-fields",
    hdr: "#hdr-fields",
    temporalUpscale: "#temporal-fields",
    sequentialStory: "#sequential-story-fields",
    minimaxH3: "#minimax-h3-fields",
    seedHunterH3: "#seed-hunter-h3-fields",
    actionH3: "#action-h3-fields",
    ltx25Aio: "#ltx25-aio-fields",
  };
  for (const [id, selector] of Object.entries(sections)) {
    const active = id === selected;
    const section = $(selector);
    section.classList.toggle("hidden", !active);
    section.querySelectorAll("input, select, textarea").forEach((control) => {
      control.disabled = !active;
    });
  }
  const generative = ["retake", "extend", "sequentialStory"].includes(selected);
  $("#ltx-generative-settings").classList.toggle("hidden", !generative);
  $("#ltx-generative-settings").querySelectorAll("input, select").forEach((control) => {
    control.disabled = !generative;
  });
  $("#video-studio-submit").classList.toggle("hidden", selected === "sequentialStory");
  $("#video-studio-submit").classList.toggle("hidden", ["sequentialStory", "interactiveCast"].includes(selected));
  updateH3Fields();
  updateSeedHunterH3Fields();
  updateActionH3Fields();
  updateLtx25Fields();
  const submitLabel = $("#video-studio-submit span");
  if (submitLabel) {
    const h3Preview = selected === "minimaxH3" && $("#h3RunProfile")?.value === "preview";
    const actionPreview = selected === "actionH3" && $("#actionH3RunProfile")?.value === "preview";
    submitLabel.textContent = selected === "seedHunterH3"
      ? "Genera 3 candidati Seed Hunter"
      : h3Preview
      ? "Crea anteprima MiniMax H3"
      : actionPreview
        ? "Crea anteprima ACTION H3"
        : selected === "ltx25Aio" && $("#ltx25Profile")?.value === "preview"
          ? "Crea anteprima LTX 2.5 AIO"
          : "Crea progetto Video Studio";
  }
  const loraChoices = videoLoraChoices(selected);
  state.loras = state.loras.filter((item) => loraChoices.includes(item.name));
  renderLoras();
  syncInteractiveCastWorkspace();
  renderInteractiveCastCapabilities();
  updateWorkflowGuideLink();
  updateReadiness();
}

function interactiveCastRoute() {
  const match = String(location.hash || "").match(/^#interactive-cast\/(config|production)(?:\/([^/]+))?$/);
  return match
    ? { view: match[1], projectId: match[2] ? decodeURIComponent(match[2]) : "" }
    : null;
}

function renderInteractiveCastWorkspaceControls() {
  const nav = $("#interactive-cast-workspace-nav");
  if (!nav) return;
  const castMode = mode() === "interactiveCast";
  nav.classList.toggle("hidden", !castMode);
  nav.querySelectorAll("[data-interactive-cast-view]").forEach((button) => {
    const active = button.dataset.interactiveCastView === state.interactiveCastView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.disabled = button.dataset.interactiveCastView === "production" && !state.interactiveCastProjects.length;
  });
  const picker = $("#interactive-cast-active-project");
  const pickerLabel = picker?.closest(".interactive-cast-project-picker");
  if (!picker || !pickerLabel) return;
  pickerLabel.classList.toggle("hidden", state.interactiveCastView !== "production" || !state.interactiveCastProjects.length);
  picker.innerHTML = state.interactiveCastProjects.map((project) =>
    `<option value="${escapeHtml(project.id)}" ${project.id === state.interactiveCastActiveProjectId ? "selected" : ""}>${escapeHtml(project.title)} · ${escapeHtml(project.status)}</option>`
  ).join("");
}

function setInteractiveCastView(view, { projectId = "", updateHash = true, scroll = false } = {}) {
  const nextView = view === "production" && state.interactiveCastProjects.length ? "production" : "config";
  const availableIds = new Set(state.interactiveCastProjects.map((project) => project.id));
  const preferredId = projectId || state.interactiveCastActiveProjectId;
  state.interactiveCastView = nextView;
  state.interactiveCastActiveProjectId = availableIds.has(preferredId)
    ? preferredId
    : state.interactiveCastProjects[0]?.id || "";
  const layout = document.querySelector(".video-studio-layout");
  layout?.classList.toggle("interactive-cast-workspace", mode() === "interactiveCast");
  layout?.classList.toggle("cast-view-config", mode() === "interactiveCast" && nextView === "config");
  layout?.classList.toggle("cast-view-production", mode() === "interactiveCast" && nextView === "production");
  renderInteractiveCastWorkspaceControls();
  if (updateHash && mode() === "interactiveCast") {
    const suffix = nextView === "production" && state.interactiveCastActiveProjectId
      ? `/${encodeURIComponent(state.interactiveCastActiveProjectId)}`
      : "";
    history.replaceState({}, "", `${location.pathname}${location.search}#interactive-cast/${nextView}${suffix}`);
  }
  if (scroll) {
    $("#interactive-cast-workspace-nav")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function syncInteractiveCastWorkspace() {
  const layout = document.querySelector(".video-studio-layout");
  const castMode = mode() === "interactiveCast";
  if (!castMode) {
    layout?.classList.remove("interactive-cast-workspace", "cast-view-config", "cast-view-production");
    if (interactiveCastRoute()) {
      history.replaceState({}, "", `${location.pathname}${location.search}`);
    }
    renderInteractiveCastWorkspaceControls();
    return;
  }
  const route = interactiveCastRoute();
  setInteractiveCastView(route?.view || state.interactiveCastView, {
    projectId: route?.projectId || state.interactiveCastActiveProjectId,
    updateHash: !route,
  });
}

function updateEngine() {
  let engine = $("#actorEngine").value;
  const scope = $("#replacementScope").value;
  if (scope === "body") {
    const unionOption = [...$("#actorEngine").options].find((option) =>
      option.value === "unionControl" && !option.disabled
    );
    if (unionOption && $("#actorEngine").value === "trackedInpaint") {
      $("#actorEngine").value = "unionControl";
      engine = "unionControl";
      showToast("Per corpo completo uso Union Control: segue posa e movimento della clip.");
    }
  }
  const tracked = engine === "trackedInpaint";
  const selectionMode = $("#selectionMode").value;
  $("#actor-selection-panel").classList.toggle("hidden", !tracked);
  const currentSelection = $("#selectionMode").value;
  $("#mask-video-field").classList.toggle("hidden", !(tracked && currentSelection === "manual"));
  $("#paint-tools").classList.toggle("hidden", !(tracked && currentSelection === "paint"));
  $("#target-face-index-field").classList.toggle("hidden", currentSelection !== "auto");
  $("#actor-selection-stage").classList.toggle("hidden", currentSelection === "manual");
  $("#identity-reference-hint").textContent = tracked
      ? "Guida l’identità che LTX ricostruirà nella zona seguita da SAM3."
      : engine === "unionControl"
        ? "Guida il nuovo performer nel motion transfer Union Control."
      : "Il fallback richiede una Identity LoRA; la sola foto non codifica un’identità precisa.";
  $("#maskDilation").value = scope === "body" ? 22 : scope === "head" ? 16 : 10;
  drawActorSelection();
  updateReadiness();
}

function ensureActorCanvases(width, height) {
  if (!width || !height) return;
  const canvas = $("#actor-selection-canvas");
  canvas.width = width;
  canvas.height = height;
  if (!state.actorFrame || state.actorFrame.width !== width || state.actorFrame.height !== height) {
    state.actorFrame = document.createElement("canvas");
    state.actorFrame.width = width;
    state.actorFrame.height = height;
  }
  if (!state.actorMask || state.actorMask.width !== width || state.actorMask.height !== height) {
    state.actorMask = document.createElement("canvas");
    state.actorMask.width = width;
    state.actorMask.height = height;
    const mask = state.actorMask.getContext("2d");
    mask.fillStyle = "#000";
    mask.fillRect(0, 0, width, height);
  }
}

function drawActorSelection() {
  const canvas = $("#actor-selection-canvas");
  if (!state.actorFrame || !canvas.width) return;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.actorFrame, 0, 0);
  if ($("#selectionMode").value === "paint" && state.actorMask) {
    context.save();
    context.globalAlpha = 0.48;
    context.drawImage(state.actorMask, 0, 0);
    context.restore();
  }
  $("#actor-selection-stage").classList.add("ready");
}

function actorCanvasPoint(event) {
  const canvas = $("#actor-selection-canvas");
  const rect = canvas.getBoundingClientRect();
  const x = Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width));
  const y = Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height));
  return { x, y, nx: x / canvas.width, ny: y / canvas.height, rect };
}

function selectActorPoint(event) {
  const point = actorCanvasPoint(event);
  $("#targetPointX").value = point.nx.toFixed(6);
  $("#targetPointY").value = point.ny.toFixed(6);
  const marker = $("#actor-selection-marker");
  const stageRect = $("#actor-selection-stage").getBoundingClientRect();
  marker.style.left = `${point.rect.left - stageRect.left + point.nx * point.rect.width}px`;
  marker.style.top = `${point.rect.top - stageRect.top + point.ny * point.rect.height}px`;
  marker.classList.remove("hidden");
}

function paintActorMask(event) {
  if (!state.actorMask) return;
  const point = actorCanvasPoint(event);
  const context = state.actorMask.getContext("2d");
  const scale = state.actorMask.width / Math.max(1, point.rect.width);
  context.fillStyle = "#fff";
  context.beginPath();
  context.arc(point.x, point.y, Number($("#maskBrushSize").value) * scale / 2, 0, Math.PI * 2);
  context.fill();
  drawActorSelection();
}

function clearActorMask() {
  if (!state.actorMask) return;
  const context = state.actorMask.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, state.actorMask.width, state.actorMask.height);
  drawActorSelection();
}

function maskBlob() {
  return new Promise((resolve, reject) => {
    if (!state.actorMask) return reject(new Error("Carica prima il video e disegna la persona."));
    state.actorMask.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Impossibile creare la maschera.")), "image/png");
  });
}

function setupPreview(inputSelector, targetSelector, className) {
  $(inputSelector).addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const target = $(targetSelector);
    target.src = URL.createObjectURL(file);
    target.parentElement.classList.add(className);
  });
}

function generationMedia(generation) {
  if (generation.videos?.length) {
    const index = generation.videos.length - 1;
    return `<video controls preload="metadata" src="/api/media/${generation.id}/${index}"></video>`;
  }
  return `<div class="video-stage-placeholder">${generation.status === "error" ? "Errore" : `${generation.progress || 0}%`}</div>`;
}

function projectsRenderKey(projects) {
  return JSON.stringify((projects || []).map((project) => ({
    id: project.id,
    status: project.status,
    archived: Boolean(project.archived),
    updatedAt: project.updatedAt || "",
    sceneRecipeSeed: project.sceneRecipe?.seed ?? null,
    generations: (project.generations || []).map((generation) => ({
      id: generation.id,
      status: generation.status,
      progress: generation.progress || 0,
      error: generation.error || "",
      h3Stage: generation.h3Stage || "",
      seed: generation.seed ?? null,
      candidateIndex: generation.candidateIndex ?? null,
      videos: (generation.videos || []).map((file) => `${file.type || ""}/${file.subfolder || ""}/${file.filename || ""}`),
    })),
  })));
}

function statusLabel(status) {
  return {
    queued: "In coda",
    running: "In esecuzione",
    completed: "Completato",
    error: "Errore",
    interrupted: "Annullato",
  }[status] || status;
}

function renderProjects() {
  const renderKey = projectsRenderKey(state.projects);
  if (renderKey === state.projectsRenderKey) return;
  state.projectsRenderKey = renderKey;
  $("#video-studio-empty").classList.toggle("hidden", state.projects.length > 0);
  $("#video-studio-projects").innerHTML = state.projects.map((project) => {
    const completedVideo = [...(project.generations || [])].reverse().find((item) =>
      item.status === "completed" && item.videos?.length
    );
    const active = (project.generations || []).some((item) => ["queued", "running"].includes(item.status));
    const completedPreview = [...(project.generations || [])].reverse().find((item) =>
      item.status === "completed" && item.h3Stage === "preview" && item.videos?.length
    );
    const h3RecipeReady = ["minimaxH3", "actionH3"].includes(project.videoStudioMode) && project.sceneRecipe && completedPreview;
    const h3ProjectName = project.videoStudioMode === "actionH3" ? "ACTION H3" : "MiniMax H3";
    const finishing = state.config.videoStudio.h3?.previewFinishing;
    const modeName = state.config.videoStudio.modes.find((item) => item.id === project.videoStudioMode)?.name || project.videoStudioMode;
    return `
      <article class="video-project-card">
        <header>
          <div><h3>${escapeHtml(project.name)}</h3><small>${escapeHtml(modeName)}</small></div>
          <div class="video-project-card-actions">
            <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(statusLabel(project.status))}</span>
            <button class="chip-button danger-action compact" type="button"
              data-video-project-delete="${escapeHtml(project.id)}"
              ${active ? 'disabled title="Annulla prima le generazioni attive"' : 'title="Elimina progetto e file collegati"'}>
              Elimina
            </button>
          </div>
        </header>
        <p>${escapeHtml(project.prompt || "Progetto guidato Video Studio")}</p>
        ${project.sceneRecipe ? `<div class="h3-scene-recipe"><b>Ricetta scena salvata</b><span>Seed ${escapeHtml(project.sceneRecipe.seed)} · ${escapeHtml(project.sceneRecipe.h3Mode)} · ${escapeHtml(project.sceneRecipe.aspectRatio)}</span></div>` : ""}
        <div class="video-project-stages">
          ${(project.generations || []).map((generation) => `
            <section>
              <div class="studio-result-label"><span>${escapeHtml(generation.videoStudioLabel || generation.workflowName)}</span><b>${escapeHtml(statusLabel(generation.status))}</b></div>
              ${generationMedia(generation)}
              ${generation.error ? `<p class="video-stage-error">${escapeHtml(generation.error)}</p>` : ""}
              ${project.videoStudioMode === "seedHunterH3" && generation.status === "completed" && generation.h3Stage === "seedCandidate" && generation.videos?.length && !active
                ? `<button class="chip-button" type="button" data-h3-seed-promote="${escapeHtml(project.id)}" data-generation="${escapeHtml(generation.id)}" data-seed="${escapeHtml(generation.seed)}">Scegli candidato ${escapeHtml(generation.candidateIndex || "")} · seed ${escapeHtml(generation.seed)}</button>`
                : ""}
              ${["queued", "running"].includes(generation.status)
                ? `<button class="cancel-generation-button compact" type="button" data-cancel-job="${generation.id}">Annulla generazione</button>`
                : ""}
            </section>
          `).join("")}
        </div>
        ${completedVideo && ["actorReplacement", "interactiveScene"].includes(project.videoStudioMode) && state.config.videoStudio.capabilities.lipdub.available && !active ? `
          <button class="chip-button video-lipdub-action" type="button" data-lipdub="${project.id}" data-generation="${completedVideo.id}">
            Applica / correggi dialogo e LipDub
          </button>
        ` : ""}
        <div class="video-project-actions">
          ${completedVideo && ["minimaxH3", "actionH3"].includes(project.videoStudioMode) && !active ? `
            <button class="chip-button" type="button" data-h3-derope="${escapeHtml(project.id)}" data-generation="${escapeHtml(completedVideo.id)}"
              ${state.config.videoStudio.h3?.temporalDeRope?.available === false ? 'disabled title="MAINodes non ancora caricato: riavvia ComfyUI"' : ""}>
              Temporal De-Rope · bilanciato
            </button>
            <button class="chip-button" type="button" data-h3-ltx2k="${escapeHtml(project.id)}" data-generation="${escapeHtml(completedVideo.id)}"
              ${state.config.videoStudio.ltx25?.modes?.h3Ltx2k?.available === false ? `disabled title="${escapeHtml(state.config.videoStudio.ltx25.modes.h3Ltx2k.reason || "IC-LoRA mancante")}"` : ""}>
              H3 → LTX 2.5 IC · 2K
            </button>
          ` : ""}
          ${h3RecipeReady && !active ? `
            <button class="chip-button h3-promote-action" type="button" data-h3-promote="${escapeHtml(project.id)}" data-finishing="kjLanczos" data-generation="${escapeHtml(completedPreview.id)}">
              KJ Lanczos · conserva il look
            </button>
            <button class="chip-button h3-promote-action" type="button" data-h3-promote="${escapeHtml(project.id)}" data-finishing="rtx" data-generation="${escapeHtml(completedPreview.id)}"
              ${finishing?.available === false ? `disabled title="Nodi mancanti: ${escapeHtml((finishing.missingNodes || []).join(", "))}"` : ""}>
              RTX · FILM ×2 → VSR → RCAS
            </button>
            <button class="chip-button" type="button" data-h3-native="${escapeHtml(project.id)}" data-generation="${escapeHtml(completedPreview.id)}">
              Rigenera ${h3ProjectName} nativo · stesso seed
            </button>
          ` : ""}
          ${!active ? `<button class="chip-button" type="button" data-video-project-archive="${escapeHtml(project.id)}">Nascondi</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function sequentialSettings() {
  return {
    inputMode: $("#sequentialInputMode").value,
    workflowId: $("#sequentialWorkflowId").value,
    quality: $("#sequentialQuality").value,
    resolution: $("#studioResolution").value,
    orientation: $("#studioOrientation").value,
    fps: Number($("#sequentialFps").value || 24),
    sceneCount: Number($("#sequentialSceneCount").value || 3),
    sceneDuration: Number($("#sequentialSceneDuration").value || 10),
    pauseAfterEachScene: $("#sequentialPauseAfterEach").checked,
    useContinuityFrame: $("#sequentialContinuity").checked,
    purgeBetweenScenes: $("#sequentialPurge").checked,
    concatEnabled: $("#sequentialConcat").checked,
    audioMode: $("#sequentialAudioMode").value,
    transition: $("#sequentialTransition").value,
    frameOffsetMode: $("#sequentialFrameOffset").value,
    bestFrameSelector: $("#sequentialBestFrame").value,
    bestFrameSampleCount: Number($("#sequentialBestFrameSamples").value || 18),
    anchorFrameMode: $("#sequentialAnchorMode").value,
    identityVerification: $("#sequentialIdentityVerification").value,
    identityThreshold: Number($("#sequentialIdentityThreshold").value || 0.58),
    seedMode: $("#sequentialSeedMode").value,
    baseSeed: $("#sequentialBaseSeed").value,
    manualSeed: $("#sequentialManualSeed").value,
    videoModelId: $("#studioVideoModel").value,
    characterId: $("#videoCharacterId").value,
    identityStrength: $("#videoCharacterIdentityStrength").value,
    lockFace: $("#videoCharacterLockFace").value,
    lockHair: $("#videoCharacterLockHair").value,
    lockBody: $("#videoCharacterLockBody").value,
    lockOutfit: $("#videoCharacterLockOutfit").value,
  };
}

function syncSequentialInputMode() {
  const imageMode = $("#sequentialInputMode")?.value === "image";
  $("#sequential-initial-image-field")?.classList.toggle("hidden", !imageMode);
}

function sceneStatusLabel(status) {
  return {
    pending: "Pending",
    running: "Rendering",
    completed: "Completed",
    failed: "Failed",
    skipped: "Skipped",
    stale: "Da rigenerare",
  }[status] || status || "Pending";
}

function renderSequentialScenes() {
  const scenes = state.sequentialPlan?.scenes || [];
  $("#sequential-start-button").disabled = !scenes.some((scene) => scene.enabled !== false);
  $("#sequential-scenes").innerHTML = scenes.map((scene, index) => `
    <article class="sequential-scene-card" data-sequential-scene="${index}">
      <header>
        <span>${String(index + 1).padStart(2, "0")}</span>
        <input class="sequential-scene-title" value="${escapeHtml(scene.title)}" aria-label="Titolo scena ${index + 1}">
        <label class="inline-check"><input class="sequential-scene-enabled" type="checkbox" ${scene.enabled === false ? "" : "checked"}> Abilitata</label>
      </header>
      <div class="field-grid">
        <div class="field"><label>Durata</label><input class="sequential-scene-duration" type="number" min="1" max="30" value="${Number(scene.duration || 10)}"></div>
        <div class="field"><label>Stato</label><input value="${escapeHtml(sceneStatusLabel(scene.status))}" disabled></div>
      </div>
      <div class="field"><label>Prompt scena</label><textarea class="sequential-scene-prompt" rows="4">${escapeHtml(scene.prompt)}</textarea></div>
      <div class="field"><label>Prompt negativo</label><textarea class="sequential-scene-negative" rows="2">${escapeHtml(scene.negativePrompt || "")}</textarea></div>
      <div class="field"><label>Continuity notes</label><textarea class="sequential-scene-continuity" rows="2">${escapeHtml(scene.continuityNotes || "")}</textarea></div>
      <div class="sequential-actions compact-row">
        <button class="chip-button" type="button" data-scene-move="up" ${index === 0 ? "disabled" : ""}>Su</button>
        <button class="chip-button" type="button" data-scene-move="down" ${index === scenes.length - 1 ? "disabled" : ""}>Giu</button>
        <button class="chip-button" type="button" data-scene-duplicate>Duplica</button>
        <button class="chip-button" type="button" data-scene-regenerate>Rigenera</button>
        <button class="chip-button" type="button" data-scene-delete>Elimina</button>
      </div>
    </article>
  `).join("");
}

function syncSequentialScenes() {
  if (!state.sequentialPlan) return;
  state.sequentialPlan.scenes = [...document.querySelectorAll("[data-sequential-scene]")].map((card, index) => ({
    ...(state.sequentialPlan.scenes[index] || {}),
    id: state.sequentialPlan.scenes[index]?.id || `scene-${index + 1}`,
    index: index + 1,
    title: card.querySelector(".sequential-scene-title").value.trim() || `Scena ${index + 1}`,
    duration: Number(card.querySelector(".sequential-scene-duration").value || 10),
    prompt: card.querySelector(".sequential-scene-prompt").value.trim(),
    negativePrompt: card.querySelector(".sequential-scene-negative").value.trim(),
    continuityNotes: card.querySelector(".sequential-scene-continuity").value.trim(),
    enabled: card.querySelector(".sequential-scene-enabled").checked,
  }));
}

async function generateSequentialPlan() {
  const status = $("#sequential-story-status");
  const button = $("#sequential-plan-button");
  button.disabled = true;
  status.textContent = "LM Studio sta creando la scaletta JSON...";
  try {
    const payload = await jsonApi("/api/video-studio/sequential-story/plan", {
      description: $("#sequentialDescription").value,
      globalStyle: $("#sequentialGlobalStyle").value,
      ...sequentialSettings(),
    });
    state.sequentialPlan = payload.plan;
    $("#videoProjectName").value ||= payload.plan.title || "Storia continua";
    renderSequentialScenes();
    status.textContent = "Scaletta pronta: puoi modificare le scene prima del render.";
    showToast("Scaletta Sequential Story generata.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function regenerateSequentialScene(index) {
  syncSequentialScenes();
  const scene = state.sequentialPlan?.scenes?.[index];
  if (!scene) return;
  const status = $("#sequential-story-status");
  status.textContent = `Rigenero la scena ${index + 1} con LM Studio...`;
  try {
    const payload = await jsonApi("/api/video-studio/sequential-story/plan", {
      description: `Riscrivi solo questa scena mantenendo la storia globale: ${scene.prompt}`,
      globalStyle: $("#sequentialGlobalStyle").value,
      ...sequentialSettings(),
      sceneCount: 1,
      sceneDuration: scene.duration,
    });
    state.sequentialPlan.scenes[index] = {
      ...scene,
      ...payload.plan.scenes[0],
      id: scene.id,
      index: index + 1,
      status: "pending",
      stale: false,
    };
    renderSequentialScenes();
    status.textContent = `Scena ${index + 1} rigenerata.`;
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  }
}

async function startSequentialStory() {
  syncSequentialScenes();
  const status = $("#sequential-story-status");
  if (!state.sequentialPlan?.scenes?.length) {
    status.textContent = "Genera o inserisci una scaletta prima di avviare.";
    return;
  }
  const settings = sequentialSettings();
  const initialImage = $("#sequentialInitialImage")?.files?.[0] || null;
  if (settings.inputMode === "image" && !initialImage) {
    status.textContent = "Carica un fotogramma iniziale per usare Immagine → Video.";
    showToast("Carica il fotogramma iniziale.");
    return;
  }
  const button = $("#sequential-start-button");
  button.disabled = true;
  status.textContent = "Creo il progetto persistente e avvio la sequenza...";
  try {
    let create;
    const body = {
      title: $("#videoProjectName").value || state.sequentialPlan.title || "Storia continua",
      plan: state.sequentialPlan,
      settings,
    };
    if (initialImage) {
      const form = new FormData();
      form.set("payload", JSON.stringify(body));
      form.set("initialImage", initialImage);
      create = await api("/api/video-studio/sequential-story", {
        method: "POST",
        body: form,
      });
    } else {
      create = await jsonApi("/api/video-studio/sequential-story", body);
    }
    const started = await api(`/api/video-studio/sequential-story/${create.project.id}/start`, { method: "POST" });
    state.sequentialStories = [started.project, ...state.sequentialStories.filter((item) => item.id !== started.project.id)];
    renderSequentialStories();
    status.textContent = "Sequenza avviata. Il progresso appare nella colonna progetti.";
    showToast("Storia continua avviata.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

function sequentialSceneMedia(scene) {
  if (scene.generationId && scene.outputVideo) {
    return `<video controls preload="metadata" src="/api/media/${escapeHtml(scene.generationId)}/0"></video>`;
  }
  return `<div class="video-stage-placeholder">${escapeHtml(sceneStatusLabel(scene.status))}</div>`;
}

function renderSequentialStories() {
  $("#sequential-story-empty").classList.toggle("hidden", state.sequentialStories.length > 0);
  $("#sequential-story-projects").innerHTML = state.sequentialStories.map((project) => {
    const scenes = project.scenes || [];
    const completed = scenes.filter((scene) => scene.status === "completed").length;
    const progress = Math.round(Number(project.progress || (completed / Math.max(1, scenes.length)) * 100));
    const finalMedia = project.finalGenerationId && project.finalVideo
      ? `<video controls preload="metadata" src="/api/media/${escapeHtml(project.finalGenerationId)}/0"></video>`
      : "";
    return `
      <article class="video-project-card sequential-project-card" data-sequential-project="${escapeHtml(project.id)}">
        <header>
          <div><h3>${escapeHtml(project.title)}</h3><small>Sequential Story · ${completed}/${scenes.length} scene</small></div>
          <div class="video-project-card-actions">
            <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(project.status)}</span>
            ${project.status === "running" ? `<button class="chip-button compact" type="button" data-sequential-action="cancel">Annulla</button>` : ""}
            <button class="chip-button danger-action compact" type="button" data-sequential-action="delete"
              ${project.status === "running" ? 'disabled title="Annulla la sequenza prima di eliminarla"' : 'title="Elimina il progetto dal pannello"'}>
              Elimina
            </button>
          </div>
        </header>
        <div class="sequential-progress"><span style="width:${Math.max(0, Math.min(100, progress))}%"></span></div>
        ${project.error ? `<p class="video-stage-error">${escapeHtml(project.error)}</p>` : ""}
        <div class="sequential-project-controls">
          ${project.status === "running" ? `<button class="chip-button" type="button" data-sequential-action="pause">Pausa</button>` : ""}
          ${["planned", "paused", "failed"].includes(project.status) ? `<button class="chip-button" type="button" data-sequential-action="resume">Continua</button>` : ""}
          ${["paused", "failed", "planned"].includes(project.status) ? `<button class="chip-button" type="button" data-sequential-action="cancel">Annulla</button>` : ""}
        </div>
        <div class="video-project-stages">
          ${scenes.map((scene) => `
            <section class="${scene.stale ? "is-stale" : ""}">
              <div class="studio-result-label"><span>${escapeHtml(scene.index)} · ${escapeHtml(scene.title)}</span><b>${escapeHtml(sceneStatusLabel(scene.status))}</b></div>
              ${sequentialSceneMedia(scene)}
              <p>${escapeHtml(scene.prompt || "")}</p>
              <small>Seed ${escapeHtml(scene.seed ?? "random")} · anchor ${escapeHtml(scene.anchorStatus || "no anchor generator configured")}</small>
              ${scene.continuityFrame ? `<small>Continuity frame: ${escapeHtml(scene.continuityFrame.filename || "estratto")}</small>` : ""}
              ${scene.identityReport ? `<small>Identity: ${escapeHtml(scene.identityReport.status)} · avg ${escapeHtml(scene.identityReport.averageSimilarity ?? "n/d")}</small>` : ""}
              ${scene.error ? `<p class="video-stage-error">${escapeHtml(scene.error)}</p>` : ""}
              ${["failed", "completed", "stale"].includes(scene.status) ? `<button class="chip-button" type="button" data-sequential-scene-retry="${escapeHtml(scene.id)}">Rigenera scena</button>` : ""}
            </section>
          `).join("")}
        </div>
        ${finalMedia}
        ${project.concatWarning ? `<p class="hint">${escapeHtml(project.concatWarning)}</p>` : ""}
      </article>
    `;
  }).join("");
}

function renderInteractiveCastEvents() {
  $("#interactive-cast-events").innerHTML = state.interactiveCastEvents.map((event, index) => `
    <div class="dialogue-row interactive-cast-event" data-interactive-cast-event="${index}">
      <span class="cast-event-index">${String(index + 1).padStart(2, "0")}</span>
      <label class="cast-event-field cast-event-speaker">
        <span>Personaggio</span>
        <input class="cast-speaker" aria-label="Personaggio ${index + 1}" value="${escapeHtml(event.speaker)}" placeholder="New Actor / original-1">
      </label>
      <label class="cast-event-field cast-event-start">
        <span>Da (sec)</span>
        <input class="cast-start" aria-label="Inizio ${index + 1}" type="number" min="0" step=".1" value="${Number(event.start ?? 0)}">
      </label>
      <label class="cast-event-field cast-event-end">
        <span>A (sec)</span>
        <input class="cast-end" aria-label="Fine ${index + 1}" type="number" min="0" step=".1" value="${Number(event.end ?? 2)}">
      </label>
      <label class="cast-event-field cast-event-dialogue">
        <span>Battuta esatta</span>
        <input class="cast-dialogue" aria-label="Battuta ${index + 1}" value="${escapeHtml(event.dialogue)}" placeholder="Testo esatto da pronunciare">
      </label>
      <label class="cast-event-field cast-event-action">
        <span>Azione visiva</span>
        <input class="cast-action" aria-label="Azione ${index + 1}" value="${escapeHtml(event.action)}" placeholder="Enters from the right, turns, exits...">
      </label>
      <label class="cast-event-field cast-event-reaction">
        <span>Reazione</span>
        <select class="cast-reaction" aria-label="Reazione ${index + 1}">
          ${[
            ["none", "Nessuna"],
            ["look", "Guarda"],
            ["speak", "Parla"],
            ["move", "Movimento"],
          ].map(([value, label]) => `<option value="${value}" ${value === event.reaction ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <label class="cast-event-field cast-event-mode">
        <span>Modalità</span>
        <select class="cast-mode" aria-label="Modalità edit ${index + 1}">
          ${[
            ["", "Auto"],
            ["audioOnly", "Solo audio"],
            ["lipSyncOnly", "Lip-sync"],
            ["composite", "Compositing"],
            ["generative", "Generativa"],
          ].map(([value, label]) => `<option value="${value}" ${value === (event.mode || "") ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <label class="cast-event-field cast-event-audio-mode">
        <span>Voce</span>
        <select class="cast-audio-mode" aria-label="Voce evento ${index + 1}">
          ${[
            ["ltxNative", "Audio nativo LTX"],
            ["external", "Voce esterna / clone"],
          ].map(([value, label]) => `<option value="${value}" ${value === (event.audioMode || "ltxNative") ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
      <button class="cast-event-remove" type="button" title="Rimuovi intervento" aria-label="Rimuovi evento ${index + 1}" data-remove-cast-event="${index}">×</button>
    </div>
  `).join("");
}

function syncInteractiveCastEvents() {
  state.interactiveCastEvents = [...document.querySelectorAll("[data-interactive-cast-event]")].map((row) => ({
    speaker: row.querySelector(".cast-speaker").value.trim(),
    start: Number(row.querySelector(".cast-start").value || 0),
    end: Number(row.querySelector(".cast-end").value || 0),
    dialogue: row.querySelector(".cast-dialogue").value.trim(),
    action: row.querySelector(".cast-action").value.trim(),
    reaction: row.querySelector(".cast-reaction").value,
    mode: row.querySelector(".cast-mode").value,
    audioMode: row.querySelector(".cast-audio-mode").value,
    preserveVoice: true,
    preserveFace: true,
  }));
}

function interactiveCastProductionGuide(project) {
  const renderPackage = project.renderPackage || null;
  const requiredSegments = (renderPackage?.segments || []).filter((segment) => segment.requiredGenerated);
  const tasks = renderPackage?.segmentTasks?.tasks || [];
  const taskFor = (segment) => tasks.find((task) => task.segmentId === segment.id) || null;
  const pendingSegment = requiredSegments.find((segment) => segment.status !== "ready") || null;
  const pendingTask = pendingSegment ? taskFor(pendingSegment) : null;
  const generatedReady = requiredSegments.length > 0 && requiredSegments.every((segment) => segment.status === "ready");
  const identityReports = renderPackage?.identityReports || {};
  const identityChecked = generatedReady && requiredSegments.every((segment) => Boolean(identityReports[segment.id]));
  const finalReady = Boolean(project.outputs?.finalVideo?.relativePath);
  const steps = [
    { label: "Analisi e piano", done: Boolean((project.editWindows || []).length) },
    { label: "Segmenti preparati", done: Boolean(renderPackage) },
    { label: "Anchor e clip LTX", done: generatedReady },
    { label: "Controllo identità", done: identityChecked, optional: true },
    { label: "Video finale", done: finalReady },
  ];

  let action = null;
  let title = "Produzione completata";
  let description = "Il video finale è pronto: controlla immagine, continuità e audio prima del download.";
  if (!(project.editWindows || []).length) {
    title = "Torna alla Configurazione";
    description = "Manca ancora il piano degli interventi. Completa l'analisi e crea il piano prima di produrre.";
    action = { label: "Apri Configurazione", attrs: 'data-interactive-cast-guide-config="true"' };
  } else if (!renderPackage) {
    title = "Prepara le clip di lavoro";
    description = "Divide il video in parti originali e parti da generare. È il primo passo della Produzione.";
    action = { label: "Prepara segmenti", attrs: `data-interactive-cast-segments="${escapeHtml(project.id)}"` };
  } else if (pendingSegment && !pendingTask) {
    title = "Rigenera il pacchetto di produzione";
    description = "Il segmento richiesto non ha ancora un task associato. Preparalo di nuovo prima di continuare.";
    action = { label: "Prepara segmenti", attrs: `data-interactive-cast-segments="${escapeHtml(project.id)}"` };
  } else if (pendingSegment && pendingTask) {
    const generationStatus = pendingTask.generation?.status || "idle";
    const verification = pendingTask.generation?.anchorVerification;
    if (["queued", "running", "anchorValidated"].includes(generationStatus)) {
      title = generationStatus === "anchorValidated" ? "Anchor valida, preparazione LTX" : "Generazione in corso";
      description = "Non serve premere altro: lo stato si aggiorna automaticamente. Attendi il completamento del passaggio corrente.";
    } else if (generationStatus === "anchorReady" && verification?.status === "passed") {
      title = "Controlla e approva l'anchor";
      description = "Verifica presenza, volto, scala, prospettiva e luce. L'approvazione avvia la clip LTX mantenendo il video originale come guida.";
      action = { label: "Approva anchor e genera LTX", attrs: `data-interactive-cast-approve-anchor="${escapeHtml(project.id)}:${escapeHtml(pendingSegment.id)}"` };
    } else if (pendingSegment.mode === "generative") {
      title = generationStatus === "failed" || generationStatus === "anchorRejected"
        ? "Correggi l'anchor rifiutata"
        : "Genera l'anchor del nuovo soggetto";
      description = "Crea l'immagine ponte che integra il nuovo soggetto nella scena. Dopo la verifica potrai approvarla e avviare LTX.";
      action = { label: generationStatus === "idle" ? "Genera anchor" : "Rigenera anchor", attrs: `data-interactive-cast-generate="${escapeHtml(project.id)}:${escapeHtml(pendingSegment.id)}"` };
    } else {
      title = "Completa il segmento evidenziato";
      description = "Questo segmento richiede compositing o un file sostitutivo. Usa i controlli nel riquadro del segmento.";
      action = { label: "Vai al segmento", attrs: `data-interactive-cast-guide-target="${escapeHtml(pendingSegment.id)}"` };
    }
  } else if (!finalReady) {
    title = identityChecked ? "Ricomponi il video finale" : "Controlla l'identità, poi ricomponi";
    description = identityChecked
      ? "Tutte le clip obbligatorie sono pronte. Ricomponi le parti mantenendo l'audio disponibile."
      : "Le clip sono pronte. L'Identity Check è consigliato ma non bloccante; puoi controllare i segmenti oppure creare subito il finale.";
    action = { label: "Ricomponi MP4 finale", attrs: `data-interactive-cast-concat="${escapeHtml(project.id)}"` };
  }

  return `
    <section class="interactive-cast-production-guide" aria-label="Guida produzione Interactive Cast">
      <div class="interactive-cast-guide-heading">
        <div><small>ASSISTENTE PRODUZIONE</small><h4>${escapeHtml(title)}</h4></div>
        <span>${steps.filter((step) => step.done).length}/${steps.length}</span>
      </div>
      <div class="interactive-cast-guide-steps">
        ${steps.map((step) => `<span class="${step.done ? "done" : ""} ${step.optional ? "optional" : ""}">${step.done ? "OK" : step.optional ? "OPZ" : ""} ${escapeHtml(step.label)}</span>`).join("")}
      </div>
      <p>${escapeHtml(description)}</p>
      ${action ? `<button class="primary-button compact" type="button" ${action.attrs}>${escapeHtml(action.label)}</button>` : ""}
      <details>
        <summary>Cosa devo controllare e cosa posso ignorare?</summary>
        <div class="interactive-cast-guide-notes">
          <p><b>Attori originali:</b> assegna i nomi solo se devi indirizzare reazioni o battute a persone precise.</p>
          <p><b>Frame e audio stems fallback:</b> sono anteprime diagnostiche; non richiedono modifiche per una semplice entrata in scena.</p>
          <p><b>Speaker diarization:</b> lasciala non assegnata se non devi sostituire o sincronizzare le voci originali.</p>
          <p><b>Anchor:</b> è il controllo decisivo. Non approvarla se il soggetto non è già credibile dentro luce, scala e prospettiva della scena.</p>
          <p><b>Dopo l'anchor:</b> approva, attendi LTX, esegui facoltativamente Identity Check, quindi ricomponi l'MP4 finale.</p>
        </div>
      </details>
    </section>
  `;
}

function renderInteractiveCastProjects() {
  const assetUrl = (project, relativePath) =>
    `/api/interactive-cast/projects/${encodeURIComponent(project.id)}/asset?path=${encodeURIComponent(String(relativePath || ""))}`;
  const taskForSegment = (project, segmentId) =>
    (project.renderPackage?.segmentTasks?.tasks || []).find((task) => task.segmentId === segmentId) || null;
  if (!state.interactiveCastProjects.some((project) => project.id === state.interactiveCastActiveProjectId)) {
    state.interactiveCastActiveProjectId = state.interactiveCastProjects[0]?.id || "";
  }
  const productionView = mode() === "interactiveCast" && state.interactiveCastView === "production";
  const visibleProjects = productionView && state.interactiveCastActiveProjectId
    ? state.interactiveCastProjects.filter((project) => project.id === state.interactiveCastActiveProjectId)
    : state.interactiveCastProjects;
  $("#interactive-cast-empty").classList.toggle("hidden", state.interactiveCastProjects.length > 0);
  $("#interactive-cast-projects").innerHTML = visibleProjects.map((project) => `
    <article class="video-project-card interactive-cast-card" data-interactive-cast-project="${escapeHtml(project.id)}">
      <header>
        <div><h3>${escapeHtml(project.title)}</h3><small>Interactive Cast · ${escapeHtml(project.status)}</small></div>
        <div class="video-project-card-actions">
          <span class="status-pill status-${escapeHtml(project.status)}">${escapeHtml(project.status)}</span>
          <button class="chip-button danger-action" type="button" data-interactive-cast-delete="${escapeHtml(project.id)}">Elimina</button>
        </div>
      </header>
      <p>${escapeHtml(project.sourceVideo?.originalName || "video sorgente")}</p>
      <div class="cast-metrics">
        <span>${escapeHtml(project.analysis?.width || 0)}×${escapeHtml(project.analysis?.height || 0)}</span>
        <span>${Number(project.analysis?.duration || 0).toFixed(1)}s</span>
        <span>${Number(project.analysis?.fps || 0).toFixed(2)} fps</span>
        <span>${escapeHtml(project.analysis?.codec || "codec n/d")}</span>
      </div>
      ${productionView ? interactiveCastProductionGuide(project) : ""}
      ${project.stages ? `
        <div class="interactive-cast-stages">
          ${Object.entries(project.stages).map(([stage, info]) => `
            <span class="interactive-cast-stage stage-${escapeHtml(info.status || "unknown")}">
              <b>${escapeHtml(stage)}</b>
              ${escapeHtml(info.status || "unknown")}
              ${info.error ? `<em>${escapeHtml(info.error)}</em>` : ""}
            </span>
          `).join("")}
        </div>
      ` : ""}
      ${(project.actors?.original || []).length ? `
        <div class="interactive-cast-actors">
          <small><b>Attori originali</b> assegna nomi interni alla clip</small>
          ${(project.actors.original || []).map((actor) => `
            <div class="interactive-cast-actor-row" data-cast-actor="${escapeHtml(project.id)}:${escapeHtml(actor.actorId)}">
              <span>${escapeHtml(actor.actorId)}</span>
              <input data-cast-actor-label value="${escapeHtml(actor.label || actor.actorId)}" placeholder="Nome attore">
              <input data-cast-actor-role value="${escapeHtml(actor.role || "")}" placeholder="Ruolo/note brevi">
            </div>
          `).join("")}
          <button class="chip-button compact" type="button" data-interactive-cast-actors="${escapeHtml(project.id)}">Salva attori</button>
        </div>
      ` : ""}
      ${(project.actors?.added || []).some((actor) => actor.reference?.relativePath) ? `
        <div class="interactive-cast-frames">
          ${(project.actors.added || []).filter((actor) => actor.reference?.relativePath).map((actor) => `
            <figure>
              <img src="${assetUrl(project, actor.reference.relativePath)}" alt="${escapeHtml(actor.name || "New Actor")} reference">
              <figcaption>${escapeHtml(actor.name || "New Actor")} · reference temporanea</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : ""}
      ${(project.artifacts?.frames || []).some((frame) => frame.relativePath) ? `
        <div class="interactive-cast-frames">
          ${(project.artifacts.frames || []).filter((frame) => frame.relativePath).map((frame) => `
            <figure>
              <img src="${assetUrl(project, frame.relativePath)}" alt="${escapeHtml(frame.role)} frame">
              <figcaption>${escapeHtml(frame.role)} · ${Number(frame.time || 0).toFixed(2)}s</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : ""}
      ${project.artifacts?.audio?.relativePath ? `
        <audio class="interactive-cast-audio" controls preload="metadata" src="${assetUrl(project, project.artifacts.audio.relativePath)}"></audio>
      ` : ""}
      ${(project.audioAnalysis?.stems || []).some((stem) => stem.relativePath) ? `
        <div class="interactive-cast-audio-tasks">
          <small><b>Audio stems fallback</b> ${escapeHtml(project.audioAnalysis.sourceSeparation || "FALLBACK")}</small>
          ${(project.audioAnalysis.stems || []).filter((stem) => stem.relativePath).map((stem) => `
            <div class="interactive-cast-audio-task ready">
              <small><b>${escapeHtml(stem.role)}</b> ${escapeHtml(stem.method || "ffmpeg")}</small>
              <audio controls preload="metadata" src="${assetUrl(project, stem.relativePath)}"></audio>
              <em>${escapeHtml(stem.note || "Stem fallback")}</em>
            </div>
          `).join("")}
        </div>
      ` : ""}
      ${(project.audioAnalysis?.speakers || []).length ? `
        <div class="interactive-cast-speakers">
          <div class="interactive-cast-speaker-heading">
            <small><b>Speaker diarization</b> ${escapeHtml(project.audioAnalysis.diarization || "FALLBACK")} · correggibile</small>
            <button class="chip-button compact" type="button" data-interactive-cast-speaker-add="${escapeHtml(project.id)}">+ Segmento speaker</button>
          </div>
          ${(project.audioAnalysis.speakers || []).map((speaker, index) => `
            <div class="interactive-cast-speaker-row" data-cast-speaker="${escapeHtml(project.id)}:${index}">
              <input data-cast-speaker-id value="${escapeHtml(speaker.speaker || `SPEAKER_${String(index).padStart(2, "0")}`)}" aria-label="Speaker ${index + 1}">
              <input data-cast-speaker-start type="number" step=".1" min="0" value="${Number(speaker.start || 0)}" aria-label="Start speaker ${index + 1}">
              <input data-cast-speaker-end type="number" step=".1" min="0" value="${Number(speaker.end || 0)}" aria-label="End speaker ${index + 1}">
              <select data-cast-speaker-actor aria-label="Attore speaker ${index + 1}">
                <option value="">Non assegnato</option>
                ${(project.actors?.original || []).map((actor) =>
                  `<option value="${escapeHtml(actor.actorId)}" ${actor.actorId === speaker.assignedActorId ? "selected" : ""}>${escapeHtml(actor.label || actor.actorId)}</option>`
                ).join("")}
              </select>
              <button class="icon-button danger" type="button" title="Rimuovi segmento speaker" aria-label="Rimuovi segmento speaker ${index + 1}" data-interactive-cast-speaker-remove="${escapeHtml(project.id)}:${index}">×</button>
            </div>
          `).join("")}
          <button class="chip-button compact" type="button" data-interactive-cast-speakers="${escapeHtml(project.id)}">Salva speaker</button>
        </div>
      ` : ""}
      ${(project.sceneCuts?.cuts || []).length ? `
        <div class="cast-window-list">
          ${(project.sceneCuts.cuts || []).map((cut) => `<small><b>Scene</b> ${Number(cut.start || 0).toFixed(2)}-${Number(cut.end || 0).toFixed(2)} · ${escapeHtml(cut.reason)}</small>`).join("")}
        </div>
      ` : ""}
      ${(project.editWindows || []).length ? `
        <div class="cast-window-list">
          ${project.editWindows.map((window) => `<small><b>${window.start.toFixed(2)}-${window.end.toFixed(2)}</b> ${escapeHtml(window.mode)} · ${escapeHtml(window.reason)}</small>`).join("")}
        </div>
      ` : `<p class="hint">Analisi pronta. Aggiungi interventi per creare il piano edit windows.</p>`}
      ${project.renderPackage ? `
        <div class="cast-window-list">
          <small><b>Render package</b> ${escapeHtml(project.renderPackage.status)} · ${Number(project.renderPackage.segments?.length || 0)} segmenti</small>
          ${(project.renderPackage.segments || []).filter((segment) => segment.requiredGenerated).map((segment) => {
            const task = taskForSegment(project, segment.id);
            const anchor = task?.anchorFrame?.relativePath ? task.anchorFrame : null;
            const identityReport = project.renderPackage.identityReports?.[segment.id] || null;
            const anchorVerification = task?.generation?.anchorVerification || null;
            const anchorCandidate = task?.generation?.anchorCandidate?.relativePath
              ? task.generation.anchorCandidate
              : null;
            const chatGptAnchorPrompt = task
              ? interactiveCastChatGptAnchorPrompt(project, segment, task)
              : "";
            return `
              <div class="interactive-cast-segment-slot ${segment.status === "ready" ? "ready" : ""}" data-interactive-cast-segment="${escapeHtml(segment.id)}">
                <small><b>${segment.status === "ready" ? "AI ready" : "Missing AI"}</b> ${Number(segment.start || 0).toFixed(2)}-${Number(segment.end || 0).toFixed(2)} · ${escapeHtml(segment.mode)} · ${escapeHtml(segment.reason)}</small>
                ${anchor ? `
                  <figure class="interactive-cast-task-anchor">
                    <img src="${assetUrl(project, anchor.relativePath)}" alt="Anchor ${escapeHtml(segment.id)}">
                    <figcaption>Anchor ${Number(anchor.time || 0).toFixed(2)}s</figcaption>
                  </figure>
                ` : ""}
                ${task ? `
                  <details class="interactive-cast-task">
                    <summary>Task ${escapeHtml(task.requiredEngine)}</summary>
                    ${task.anchorWorkflow ? `<p><b>Anchor workflow</b> ${escapeHtml(task.anchorWorkflow.label || task.anchorWorkflow.id)}</p>` : ""}
                    ${task.anchorRequirement ? `<p>${escapeHtml(task.anchorRequirement)}</p>` : ""}
                    <label>Prompt segmento<textarea readonly rows="4">${escapeHtml(task.prompt)}</textarea></label>
                    <label>Negative prompt<textarea readonly rows="3">${escapeHtml(task.negativePrompt)}</textarea></label>
                    ${(task.actorReferences || []).length ? `
                      <div class="interactive-cast-actor-references">
                        <small><b>Reference nuovo attore</b> ${Number(task.actorReferences.length)} allegata/e al task</small>
                        ${task.actorReferences.map((actor) => `
                          <div class="interactive-cast-actor-reference">
                            <b>${escapeHtml(actor.name || actor.actorId || "New Actor")}</b>
                            <span>${escapeHtml(actor.type || "reference")} · ${escapeHtml(actor.characterPack?.status || actor.reference?.originalName || "identity prompt")}</span>
                            ${actor.description ? `<em>${escapeHtml(actor.description)}</em>` : ""}
                            ${actor.identityHints?.face ? `<small>Face: ${escapeHtml(actor.identityHints.face)}</small>` : ""}
                            ${actor.identityHints?.hair ? `<small>Hair: ${escapeHtml(actor.identityHints.hair)}</small>` : ""}
                            ${actor.identityHints?.body ? `<small>Body: ${escapeHtml(actor.identityHints.body)}</small>` : ""}
                          </div>
                        `).join("")}
                      </div>
                    ` : ""}
                    <p>${escapeHtml(task.referenceRequirement || "")}</p>
                    <p>${escapeHtml(task.outputRequirement)}</p>
                  </details>
                ` : ""}
                ${task && segment.mode === "generative" && segment.status !== "ready" ? `
                  ${anchorCandidate ? `
                    <figure class="interactive-cast-anchor-candidate">
                      <img src="${assetUrl(project, anchorCandidate.relativePath)}" alt="Anteprima anchor composta ${escapeHtml(segment.id)}">
                      <figcaption>
                        <b>Anchor composta · tentativo ${Number(anchorCandidate.attempt || task.generation?.anchorAttempt || 1)}</b>
                        <span>Controlla presenza, identità, scala, prospettiva e luce prima di avviare LTX.</span>
                      </figcaption>
                    </figure>
                  ` : ""}
                  <div class="interactive-cast-generate-controls">
                    <label class="compact-field">Qualità
                      <select data-cast-generate-quality="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                        <option value="preview" ${state.interactiveCastPreferredQuality === "preview" ? "selected" : ""}>Anteprima rapida</option>
                        <option value="max" ${state.interactiveCastPreferredQuality === "max" ? "selected" : ""}>Massima</option>
                      </select>
                    </label>
                    <label class="compact-field">Risoluzione LTX
                      <select data-cast-generate-resolution="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                        <option value="source">Automatica dalla sorgente</option>
                        <option value="360p">360p</option>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                      </select>
                    </label>
                    <button class="chip-button compact" type="button"
                      data-interactive-cast-generate="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"
                      ${["queued", "running"].includes(task.generation?.status) ? "disabled" : ""}>
                      ${["queued", "running"].includes(task.generation?.status)
                        ? `In esecuzione · ${escapeHtml(task.generation?.phase || "anchor")}`
                        : task.generation?.status === "anchorReady" ? "Rigenera anchor"
                          : task.generation?.status === "failed" ? "Riprova anchor" : "Genera anchor"}
                    </button>
                    ${task.generation?.status === "anchorReady" && anchorVerification?.status === "passed" ? `
                      <button class="primary-button compact" type="button"
                        data-interactive-cast-approve-anchor="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                        Approva anchor e genera LTX
                      </button>
                    ` : ""}
                  </div>
                  <div class="interactive-cast-external-anchor">
                    <div class="interactive-cast-chatgpt-prompt">
                      <div>
                        <b>Prompt per ChatGPT Image</b>
                        <small>Allega prima il frame sorgente come IMAGE 1, poi la reference del nuovo attore come IMAGE 2.</small>
                      </div>
                      <textarea readonly rows="10"
                        data-cast-chatgpt-anchor-prompt="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">${escapeHtml(chatGptAnchorPrompt)}</textarea>
                      <button class="chip-button compact" type="button"
                        data-interactive-cast-copy-anchor-prompt="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                        Copia prompt
                      </button>
                    </div>
                    <label class="compact-file">
                      <input type="file" accept="image/png,image/jpeg,image/webp"
                        data-cast-external-anchor-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                      <span>Carica anchor esterno</span>
                    </label>
                    <button class="chip-button compact" type="button"
                      data-interactive-cast-external-anchor="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">
                      Verifica anchor esterno
                    </button>
                    <small>Per immagini create con ChatGPT Image o un altro editor: devono contenere il nuovo attore e preservare gli attori originali.</small>
                  </div>
                  ${task.generation?.generationId ? `<small><b>Job</b> ${escapeHtml(task.generation.generationId)} · ${escapeHtml(task.generation.status || "queued")}</small>` : ""}
                  ${task.generation?.anchorAttempt ? `<small><b>Anchor</b> tentativo ${Number(task.generation.anchorAttempt)} / ${Number(task.generation.anchorMaxAttempts || 3)} · ${escapeHtml(anchorVerification?.status || task.generation.status || "in attesa")}</small>` : ""}
                  ${anchorVerification ? `
                    <div class="interactive-cast-anchor-verification ${anchorVerification.status === "passed" ? "ready" : "warning"}">
                      <small><b>Identity gate</b> ${escapeHtml(anchorVerification.status)} · volti ${Number(anchorVerification.sourceFaceCount || 0)} → ${Number(anchorVerification.candidateFaceCount || 0)} · similarità reference ${Number(anchorVerification.bestIdentitySimilarity || 0).toFixed(2)}</small>
                      ${(anchorVerification.failures || []).length ? `<em>${escapeHtml(anchorVerification.failures.join(", "))}</em>` : ""}
                      <button class="chip-button compact" type="button"
                        data-interactive-cast-identity="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"
                        data-identity-scope="anchor">Identity check anchor</button>
                    </div>
                  ` : ""}
                  ${task.generation?.error ? `<em class="video-stage-error">${escapeHtml(task.generation.error)}</em>` : ""}
                ` : ""}
                ${segment.status === "ready" && segment.replacementRelativePath
                  ? `<video controls preload="metadata" src="${assetUrl(project, segment.replacementRelativePath)}"></video>
                     <button class="chip-button compact" type="button" data-interactive-cast-identity="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Identity check</button>`
                  : segment.mode === "composite"
                    ? `<div class="interactive-cast-composite-inputs">
                         <label class="compact-file"><input type="file" accept="video/*" data-cast-composite-overlay-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Overlay video</span></label>
                         <label class="compact-file"><input type="file" accept="image/png,image/jpeg,image/webp" data-cast-composite-mask-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Maschera B/N</span></label>
                         <label class="compact-field">Feather<input type="number" min="0" max="40" step="1" value="7" data-cast-composite-feather="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"></label>
                       </div>
                       <button class="chip-button compact" type="button" data-interactive-cast-composite="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Composita</button>
                       <label class="compact-file"><input type="file" accept="video/*" data-cast-replacement-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Oppure carica segmento finale</span></label>
                       <button class="chip-button compact" type="button" data-interactive-cast-replacement="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Aggancia finale</button>`
                    : `<label class="compact-file"><input type="file" accept="video/*" data-cast-replacement-file="${escapeHtml(project.id)}:${escapeHtml(segment.id)}"><span>Carica segmento</span></label>
                       <button class="chip-button compact" type="button" data-interactive-cast-replacement="${escapeHtml(project.id)}:${escapeHtml(segment.id)}">Aggancia</button>`}
                ${identityReport ? `
                  <div class="interactive-cast-identity-report status-${escapeHtml(identityReport.status || "unknown")}">
                    <small><b>Identity ${identityReport.scope === "anchor" ? "anchor" : "video"}</b> ${escapeHtml(identityReport.status || "unknown")} · avg ${escapeHtml(identityReport.averageSimilarity ?? "n/d")} · min ${escapeHtml(identityReport.minSimilarity ?? "n/d")}</small>
                    ${identityReport.warning ? `<em>${escapeHtml(identityReport.warning)}</em>` : ""}
                  </div>
                ` : ""}
              </div>
            `;
          }).join("")}
          ${(project.renderPackage.lipSyncTasks?.tasks || []).length ? `
            <div class="interactive-cast-audio-tasks interactive-cast-lipsync-tasks">
              <small><b>Lip-sync tasks</b> ${Number(project.renderPackage.lipSyncTasks.readiness?.missing?.length || 0)} clip mancanti</small>
              ${(project.renderPackage.lipSyncTasks.tasks || []).map((task) => `
                <div class="interactive-cast-audio-task ${task.status === "ready" ? "ready" : ""}">
                  <small><b>${task.status === "ready" ? "Lip-sync ready" : "Missing lip-sync"}</b> ${Number(task.start || 0).toFixed(2)}-${Number(task.end || 0).toFixed(2)} · ${escapeHtml(task.speaker)}</small>
                  ${task.sourceClipRelativePath ? `
                    <label>Source clip preservata<video controls preload="metadata" src="${assetUrl(project, task.sourceClipRelativePath)}"></video></label>
                  ` : ""}
                  ${task.dialogueAudioRelativePath ? `
                    <label>Audio guida<audio controls preload="metadata" src="${assetUrl(project, task.dialogueAudioRelativePath)}"></audio></label>
                  ` : ""}
                  ${task.status === "ready"
                    ? ""
                    : `<button class="chip-button compact" type="button" data-interactive-cast-lipsync="${escapeHtml(project.id)}:${escapeHtml(task.segmentId)}">Applica lip-sync</button>`}
                  ${task.synthesis?.error ? `<em class="video-stage-error">${escapeHtml(task.synthesis.error)}</em>` : ""}
                  <em>${escapeHtml(task.instructions || task.outputRequirement || "Upload the finished lip-sync MP4 into the segment slot.")}</em>
                </div>
              `).join("")}
            </div>
          ` : ""}
          ${(project.renderPackage.audioTasks?.tasks || []).length ? `
            <div class="interactive-cast-audio-tasks">
              <small><b>Dialogue audio</b> ${Number(project.renderPackage.audioTasks.readiness?.missing?.length || 0)} battute mancanti</small>
              ${(project.renderPackage.audioTasks.tasks || []).map((task) => `
                <div class="interactive-cast-audio-task ${task.status === "ready" ? "ready" : ""}">
                  <small><b>${task.status === "ready" ? "Voice ready" : "Missing voice"}</b> ${Number(task.start || 0).toFixed(2)}-${Number(task.end || 0).toFixed(2)} · ${escapeHtml(task.speaker)}</small>
                  <p>${escapeHtml(task.dialogue)}</p>
                  ${task.referenceAudio?.relativePath ? `
                    <label>Reference voce<audio controls preload="metadata" src="${assetUrl(project, task.referenceAudio.relativePath)}"></audio></label>
                  ` : ""}
                  ${task.replacementRelativePath
                    ? `<label>Battuta pronta<audio controls preload="metadata" src="${assetUrl(project, task.replacementRelativePath)}"></audio></label>`
                    : `<label class="compact-file"><input type="file" accept="audio/*" data-cast-dialogue-audio-file="${escapeHtml(project.id)}:${escapeHtml(task.eventId)}"><span>Carica battuta audio</span></label>
                       <button class="chip-button compact" type="button" data-interactive-cast-dialogue-audio="${escapeHtml(project.id)}:${escapeHtml(task.eventId)}">Aggancia audio</button>
                       <button class="chip-button compact" type="button" data-interactive-cast-dialogue-synthesize="${escapeHtml(project.id)}:${escapeHtml(task.eventId)}">Sintetizza voce</button>`}
                  ${task.synthesis?.error ? `<em class="video-stage-error">${escapeHtml(task.synthesis.error)}</em>` : ""}
                  <em>${escapeHtml(task.outputRequirement)}</em>
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>
      ` : ""}
      ${(project.editWindows || []).length && !project.renderPackage ? `
        <button class="chip-button" type="button" data-interactive-cast-segments="${escapeHtml(project.id)}">Prepara segmenti</button>
      ` : ""}
      ${project.renderPackage?.audioTasks?.readiness?.ready && !project.outputs?.dialogueRemix ? `
        <button class="chip-button" type="button" data-interactive-cast-audio-remix="${escapeHtml(project.id)}">Crea audio remix</button>
      ` : ""}
      ${project.outputs?.dialogueRemix?.relativePath ? `
        <audio class="interactive-cast-audio" controls preload="metadata" src="${assetUrl(project, project.outputs.dialogueRemix.relativePath)}"></audio>
      ` : ""}
      ${project.renderPackage?.readiness?.ready && !project.outputs?.finalVideo ? `
        <button class="chip-button" type="button" data-interactive-cast-concat="${escapeHtml(project.id)}">Ricomponi MP4 finale</button>
      ` : ""}
      ${project.outputs?.finalVideo?.relativePath ? `
        <video class="interactive-cast-final" controls preload="metadata" src="${assetUrl(project, project.outputs.finalVideo.relativePath)}"></video>
      ` : ""}
      ${(project.warnings || []).map((warning) => `<p class="hint">${escapeHtml(warning)}</p>`).join("")}
    </article>
  `).join("");
  renderInteractiveCastWorkspaceControls();
  setupUploadPreviews($("#interactive-cast-projects"));
}

async function refreshInteractiveCastProjects() {
  try {
    const payload = await api("/api/interactive-cast/projects?limit=12");
    const nextProjects = payload.projects || [];
    const changed = JSON.stringify(nextProjects) !== JSON.stringify(state.interactiveCastProjects);
    state.interactiveCastProjects = nextProjects;
    if (changed) renderInteractiveCastProjects();
  } catch {
    // Poll non necessario: riproverà al prossimo caricamento.
  }
}

async function createInteractiveCastProject() {
  syncInteractiveCastEvents();
  const status = $("#interactive-cast-status");
  const sourceVideo = $("#interactiveCastSourceVideo").files[0];
  if (!sourceVideo) {
    status.textContent = "Carica prima il video originale.";
    showToast("Carica il video originale.");
    return;
  }
  const button = $("#interactive-cast-create-button");
  button.disabled = true;
  status.textContent = "Analizzo video e preparo la timeline...";
  try {
    const form = new FormData();
    form.set("sourceVideo", sourceVideo);
    form.set("title", $("#videoProjectName").value || "Interactive Cast");
    form.set("newActorName", $("#interactiveCastNewActorName").value || "New Actor");
    const temporaryReference = $("#interactiveCastTemporaryReference").files?.[0] || null;
    if (temporaryReference) form.set("temporaryActorReference", temporaryReference);
    const created = await api("/api/interactive-cast/projects", { method: "POST", body: form });
    let events = state.interactiveCastEvents;
    const brief = $("#interactiveCastBrief").value.trim();
    if (brief && state.config.promptAssistant?.enabled) {
      status.textContent = "LM Studio sta trasformando il brief in eventi timeline...";
      try {
        const assistant = await jsonApi(`/api/interactive-cast/projects/${created.project.id}/assistant-plan`, {
          brief,
        });
        events = assistant.plan.dialogueEvents || events;
        state.interactiveCastEvents = events;
        renderInteractiveCastEvents();
      } catch (error) {
        status.textContent = `LM Studio non ha creato la timeline (${error.message}); uso gli eventi manuali.`;
      }
    }
    const planned = await jsonApi(`/api/interactive-cast/projects/${created.project.id}/plan`, {
      brief,
      addedCharacterId: $("#interactiveCastNewActor").value,
      newActorName: $("#interactiveCastNewActorName").value,
      anchorWorkflowId: $("#interactiveCastAnchorWorkflow").value,
      originalActors: created.project.actors?.original || [],
      dialogueEvents: events,
      preserveAmbience: true,
      preserveMusic: true,
    });
    state.interactiveCastProjects = [
      planned.project,
      ...state.interactiveCastProjects.filter((item) => item.id !== planned.project.id),
    ];
    status.textContent = "Piano Interactive Cast creato. I motori non configurati sono indicati nei fallback.";
    setInteractiveCastView("production", { projectId: planned.project.id, scroll: true });
    renderInteractiveCastProjects();
    showToast("Interactive Cast: piano creato.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function prepareInteractiveCastSegments(button) {
  const projectId = button.dataset.interactiveCastSegments;
  button.disabled = true;
  button.textContent = "Preparo...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/prepare-segments`, { method: "POST" });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.readiness?.ready
      ? "Segmenti pronti per la ricomposizione."
      : `Segmenti originali pronti; mancano ${payload.readiness?.missing?.length || 0} slot AI.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Prepara segmenti";
    showToast(error.message);
  }
}

async function generateInteractiveCastSegment(button) {
  const [projectId, segmentId] = button.dataset.interactiveCastGenerate.split(":");
  const key = `${projectId}:${segmentId}`;
  const quality = document.querySelector(`[data-cast-generate-quality="${CSS.escape(key)}"]`)?.value || "preview";
  const resolution = document.querySelector(`[data-cast-generate-resolution="${CSS.escape(key)}"]`)?.value || "source";
  button.disabled = true;
  button.textContent = "Accodo anchor...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/generate`, {
      quality,
      resolution,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Anchor Interactive Cast in coda. LTX resterà bloccato fino alla tua approvazione.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Riprova generazione";
    showToast(error.message);
  }
}

async function approveInteractiveCastAnchor(button) {
  const [projectId, segmentId] = button.dataset.interactiveCastApproveAnchor.split(":");
  button.disabled = true;
  button.textContent = "Avvio LTX...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/approve-anchor`, {
      method: "POST",
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Anchor approvata. Il segmento LTX è stato accodato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Approva anchor e genera LTX";
    showToast(error.message);
  }
}

async function importInteractiveCastExternalAnchor(button) {
  const [projectId, segmentId] = button.dataset.interactiveCastExternalAnchor.split(":");
  const key = `${projectId}:${segmentId}`;
  const input = document.querySelector(`[data-cast-external-anchor-file="${CSS.escape(key)}"]`);
  const file = input?.files?.[0] || null;
  if (!file) {
    showToast("Scegli prima l'immagine anchor esterna.");
    return;
  }
  button.disabled = true;
  button.textContent = "Verifico...";
  try {
    const form = new FormData();
    form.set("anchorImage", file);
    const payload = await api(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/external-anchor`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.verification?.status === "passed"
      ? "Anchor esterno verificato: ora puoi approvarlo e avviare LTX."
      : "Anchor esterno rifiutato: controlla identity gate e presenza attore.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Verifica anchor esterno";
    showToast(error.message);
  }
}

async function copyInteractiveCastAnchorPrompt(button) {
  const key = button.dataset.interactiveCastCopyAnchorPrompt;
  const textarea = document.querySelector(`[data-cast-chatgpt-anchor-prompt="${CSS.escape(key)}"]`);
  const prompt = textarea?.value?.trim() || "";
  if (!prompt) {
    showToast("Prompt ChatGPT non disponibile per questo segmento.");
    return;
  }
  try {
    await navigator.clipboard.writeText(prompt);
    showToast("Prompt per ChatGPT Image copiato.");
  } catch {
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    textarea.setSelectionRange(0, 0);
    showToast("Prompt per ChatGPT Image copiato.");
  }
}

async function deleteInteractiveCastProject(button) {
  const projectId = button.dataset.interactiveCastDelete;
  const project = state.interactiveCastProjects.find((item) => item.id === projectId);
  if (!project || !window.confirm(`Eliminare il progetto "${project.title}" e i suoi asset temporanei?`)) return;
  button.disabled = true;
  try {
    await api(`/api/interactive-cast/projects/${projectId}`, { method: "DELETE" });
    state.interactiveCastProjects = state.interactiveCastProjects.filter((item) => item.id !== projectId);
    if (state.interactiveCastActiveProjectId === projectId) {
      state.interactiveCastActiveProjectId = state.interactiveCastProjects[0]?.id || "";
    }
    if (!state.interactiveCastProjects.length && mode() === "interactiveCast") {
      setInteractiveCastView("config");
    }
    renderInteractiveCastProjects();
    showToast("Progetto Interactive Cast eliminato.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

function replacementInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-replacement-file="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function compositeOverlayInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-composite-overlay-file="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function compositeMaskInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-composite-mask-file="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function compositeFeatherInput(projectId, segmentId) {
  return document.querySelector(`[data-cast-composite-feather="${CSS.escape(`${projectId}:${segmentId}`)}"]`);
}

function collectInteractiveCastActors(projectId) {
  return [...document.querySelectorAll("[data-cast-actor]")]
    .filter((row) => String(row.dataset.castActor || "").startsWith(`${projectId}:`))
    .map((row) => ({
    actorId: String(row.dataset.castActor || "").split(":").slice(1).join(":"),
    label: row.querySelector("[data-cast-actor-label]")?.value?.trim() || "",
    role: row.querySelector("[data-cast-actor-role]")?.value?.trim() || "",
  }));
}

async function saveInteractiveCastActors(button) {
  const projectId = button.dataset.interactiveCastActors;
  button.disabled = true;
  button.textContent = "Salvo...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/actors`, {
      originalActors: collectInteractiveCastActors(projectId),
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Attori originali aggiornati.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Salva attori";
    showToast(error.message);
  }
}

function collectInteractiveCastSpeakers(projectId) {
  return [...document.querySelectorAll("[data-cast-speaker]")]
    .filter((row) => String(row.dataset.castSpeaker || "").startsWith(`${projectId}:`))
    .map((row) => ({
      speaker: row.querySelector("[data-cast-speaker-id]")?.value?.trim() || "",
      start: Number(row.querySelector("[data-cast-speaker-start]")?.value || 0),
      end: Number(row.querySelector("[data-cast-speaker-end]")?.value || 0),
      assignedActorId: row.querySelector("[data-cast-speaker-actor]")?.value || "",
    }));
}

async function persistInteractiveCastSpeakers(projectId, speakers, message = "Speaker aggiornati.") {
  const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/speakers`, { speakers });
  state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
    item.id === payload.project.id ? payload.project : item
  );
  renderInteractiveCastProjects();
  showToast(message);
}

async function saveInteractiveCastSpeakers(button) {
  const projectId = button.dataset.interactiveCastSpeakers;
  button.disabled = true;
  button.textContent = "Salvo...";
  try {
    await persistInteractiveCastSpeakers(projectId, collectInteractiveCastSpeakers(projectId));
  } catch (error) {
    button.disabled = false;
    button.textContent = "Salva speaker";
    showToast(error.message);
  }
}

async function addInteractiveCastSpeaker(button) {
  const projectId = button.dataset.interactiveCastSpeakerAdd;
  const project = state.interactiveCastProjects.find((item) => item.id === projectId);
  const speakers = collectInteractiveCastSpeakers(projectId);
  const duration = Math.max(0.1, Number(project?.analysis?.duration || 0));
  if (!speakers.length) {
    speakers.push({ speaker: "SPEAKER_00", start: 0, end: duration, assignedActorId: "" });
  } else {
    const longestIndex = speakers.reduce((best, item, index, source) =>
      item.end - item.start > source[best].end - source[best].start ? index : best, 0);
    const longest = speakers[longestIndex];
    const originalEnd = longest.end;
    const midpoint = Number(((longest.start + longest.end) / 2).toFixed(2));
    longest.end = midpoint;
    speakers.splice(longestIndex + 1, 0, {
      speaker: `SPEAKER_${String(speakers.length).padStart(2, "0")}`,
      start: midpoint,
      end: Math.max(midpoint + 0.1, originalEnd),
      assignedActorId: "",
    });
  }
  try {
    await persistInteractiveCastSpeakers(projectId, speakers, "Segmento speaker aggiunto: regola tempi e attore.");
  } catch (error) {
    showToast(error.message);
  }
}

async function removeInteractiveCastSpeaker(button) {
  const [projectId, rawIndex] = String(button.dataset.interactiveCastSpeakerRemove || "").split(":");
  const speakers = collectInteractiveCastSpeakers(projectId);
  if (speakers.length <= 1) return showToast("Mantieni almeno un segmento speaker.");
  speakers.splice(Number(rawIndex), 1);
  try {
    await persistInteractiveCastSpeakers(projectId, speakers, "Segmento speaker rimosso.");
  } catch (error) {
    showToast(error.message);
  }
}

function dialogueAudioInput(projectId, eventId) {
  return document.querySelector(`[data-cast-dialogue-audio-file="${CSS.escape(`${projectId}:${eventId}`)}"]`);
}

async function attachInteractiveCastReplacement(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastReplacement || "").split(":");
  const file = replacementInput(projectId, segmentId)?.files?.[0] || null;
  if (!file) return showToast("Scegli prima il segmento video sostitutivo.");
  button.disabled = true;
  button.textContent = "Aggancio...";
  try {
    const form = new FormData();
    form.set("replacementVideo", file);
    const payload = await api(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/replacement`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.readiness?.ready ? "Tutti i segmenti sono pronti." : "Segmento agganciato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Aggancia";
    showToast(error.message);
  }
}

async function applyInteractiveCastComposite(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastComposite || "").split(":");
  const overlay = compositeOverlayInput(projectId, segmentId)?.files?.[0] || null;
  const mask = compositeMaskInput(projectId, segmentId)?.files?.[0] || null;
  if (!overlay) return showToast("Scegli prima l'overlay video.");
  if (!mask) return showToast("Scegli prima la maschera B/N.");
  button.disabled = true;
  button.textContent = "Composito...";
  try {
    const form = new FormData();
    form.set("overlayVideo", overlay);
    form.set("maskImage", mask);
    form.set("feather", compositeFeatherInput(projectId, segmentId)?.value || "7");
    const payload = await api(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/composite`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.readiness?.ready ? "Compositing completato: segmenti pronti." : "Compositing completato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Composita";
    showToast(error.message);
  }
}

async function attachInteractiveCastDialogueAudio(button) {
  const [projectId, eventId] = String(button.dataset.interactiveCastDialogueAudio || "").split(":");
  const file = dialogueAudioInput(projectId, eventId)?.files?.[0] || null;
  if (!file) return showToast("Scegli prima la battuta audio sintetizzata.");
  button.disabled = true;
  button.textContent = "Aggancio audio...";
  try {
    const form = new FormData();
    form.set("dialogueAudio", file);
    const payload = await api(`/api/interactive-cast/projects/${projectId}/dialogue/${eventId}/audio`, {
      method: "POST",
      body: form,
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Battuta audio agganciata.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Aggancia audio";
    showToast(error.message);
  }
}

async function synthesizeInteractiveCastDialogue(button) {
  const [projectId, eventId] = String(button.dataset.interactiveCastDialogueSynthesize || "").split(":");
  button.disabled = true;
  button.textContent = "Sintesi...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/dialogue/${eventId}/synthesize`, {});
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Battuta sintetizzata e agganciata.");
  } catch (error) {
    await refreshInteractiveCastProjects();
    showToast(error.message);
  }
}

async function applyInteractiveCastLipSync(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastLipsync || "").split(":");
  button.disabled = true;
  button.textContent = "Lip-sync...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/lipsync`, {});
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Segmento lip-sync generato e agganciato.");
  } catch (error) {
    await refreshInteractiveCastProjects();
    showToast(error.message);
  }
}

async function runInteractiveCastIdentityCheck(button) {
  const [projectId, segmentId] = String(button.dataset.interactiveCastIdentity || "").split(":");
  button.disabled = true;
  button.textContent = "Controllo...";
  try {
    const payload = await jsonApi(`/api/interactive-cast/projects/${projectId}/segments/${segmentId}/identity-check`, {
      scope: button.dataset.identityScope || "auto",
    });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast(payload.report?.status === "drift-detected"
      ? `Identity ${payload.report?.scope === "anchor" ? "anchor" : "video"} da rivedere.`
      : `Identity check ${payload.report?.scope === "anchor" ? "anchor" : "video"} completato.`);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Identity check";
    showToast(error.message);
  }
}

async function remixInteractiveCastAudio(button) {
  const projectId = button.dataset.interactiveCastAudioRemix;
  button.disabled = true;
  button.textContent = "Remix...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/audio-remix`, { method: "POST" });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("Audio remix Interactive Cast creato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Crea audio remix";
    showToast(error.message);
  }
}

async function concatInteractiveCastFinal(button) {
  const projectId = button.dataset.interactiveCastConcat;
  button.disabled = true;
  button.textContent = "Ricomposizione...";
  try {
    const payload = await api(`/api/interactive-cast/projects/${projectId}/concat`, { method: "POST" });
    state.interactiveCastProjects = state.interactiveCastProjects.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    renderInteractiveCastProjects();
    showToast("MP4 finale Interactive Cast creato.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Ricomponi MP4 finale";
    showToast(error.message);
  }
}

function populateInteractiveCastCharacters() {
  const characters = state.config?.characters?.availableCharacters || [];
  $("#interactiveCastNewActor").innerHTML = [
    `<option value="">Reference temporanea / non ancora assegnata</option>`,
    ...characters.map((character) =>
      `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`
    ),
  ].join("");
}

async function refreshSequentialStories() {
  try {
    const payload = await api("/api/video-studio/sequential-story?limit=12");
    state.sequentialStories = payload.projects || [];
    renderSequentialStories();
  } catch {
    // Poll silenzioso: il prossimo giro riprova.
  }
}

async function refreshProjects() {
  try {
    state.projects = await api("/api/video-studio/projects?limit=20");
    renderProjects();
  } catch {
    // Il polling riprova senza bloccare il form.
  }
}

async function submitProject(event) {
  event.preventDefault();
  const readiness = updateReadiness();
  if (!readiness.ready) {
    const message = `${readiness.title}. ${readiness.detail}`;
    $("#video-studio-status").textContent = message;
    showToast(message);
    return;
  }
  syncDialogue();
  syncLoras();
  const selectedMode = mode();
  const promptByMode = {
    actorReplacement: "#actorPrompt",
    interactiveScene: "#interactivePrompt",
    sceneTransform: "#sceneTransformPrompt",
    retake: "#retakePrompt",
    extend: "#extendPrompt",
    hdr: "#hdrPrompt",
    minimaxH3: "#h3Prompt",
    seedHunterH3: "#seedHunterH3Prompt",
    actionH3: "#actionH3Prompt",
    ltx25Aio: "#ltx25Prompt",
  };
  const promptInput = promptByMode[selectedMode] ? $(promptByMode[selectedMode]) : null;
  applyVideoPromptTriggers(promptInput, selectedMode);
  const button = $("#video-studio-submit");
  const status = $("#video-studio-status");
  const form = new FormData(event.currentTarget);
  const durationByMode = {
    actorReplacement: "#duration",
    interactiveScene: "#interactiveDuration",
    sceneTransform: "#duration",
    retake: "#retakeDuration",
    minimaxH3: "#h3Duration",
    seedHunterH3: "#seedHunterH3Duration",
    actionH3: "#actionH3Duration",
    ltx25Aio: "#ltx25Duration",
  };
  form.set("videoStudioMode", selectedMode);
  form.set("prompt", promptByMode[selectedMode] ? $(promptByMode[selectedMode]).value : "Temporal interpolation");
  if (durationByMode[selectedMode]) form.set("duration", $(durationByMode[selectedMode]).value);
  const seedByMode = {
    minimaxH3: "#videoSeed",
    seedHunterH3: "#seedHunterH3Seed",
    actionH3: "#actionH3Seed",
    ltx25Aio: "#ltx25Seed",
  };
  if (seedByMode[selectedMode]) form.set("seed", $(seedByMode[selectedMode])?.value || "");
  if (["minimaxH3", "actionH3"].includes(selectedMode)) {
    for (const name of ["h3UseTurbo", "h3PurgeBetween", "h3PurgeAfter"]) {
      form.set(name, String($(`#${name}`)?.checked));
    }
    form.set("h3SecondPass", String(["latentLearned", "h3Balanced", "h3Maximum"].includes($("#h3RefineMode").value)));
  }
  form.set("dialogue", $("#dialogue-json").value);
  form.set("loras", $("#video-loras-json").value);
  button.disabled = true;
  status.textContent = "Upload e preflight del workflow…";
  try {
    if (selectedMode === "actorReplacement"
        && $("#actorEngine").value === "trackedInpaint"
        && $("#selectionMode").value === "paint") {
      const blob = await maskBlob();
      form.set("initialMaskImage", new File([blob], "actor-initial-mask.png", { type: "image/png" }));
    }
    const project = await api("/api/video-studio/projects", { method: "POST", body: form });
    state.projects.unshift(project);
    renderProjects();
    const isH3Preview = (selectedMode === "minimaxH3" && form.get("h3RunProfile") === "preview")
      || (selectedMode === "actionH3" && form.get("actionH3RunProfile") === "preview");
    const isSeedHunter = selectedMode === "seedHunterH3";
    const isLtx25Preview = selectedMode === "ltx25Aio" && form.get("ltx25Profile") === "preview";
    status.textContent = isH3Preview
      ? `Anteprima aggiunta alla coda. La ricetta e il seed ${project.sceneRecipe?.seed ?? "effettivo"} sono stati salvati.`
      : isSeedHunter ? "Tre candidati Seed Hunter aggiunti come job separati. Attendi il completamento e scegline uno." : isLtx25Preview ? "Anteprima LTX 2.5 aggiunta alla coda con purge VRAM automatico." : "Progetto aggiunto alla coda.";
    showToast(isH3Preview
      ? `${selectedMode === "actionH3" ? "ACTION H3" : "MiniMax H3"}: anteprima e ricetta create.`
      : isSeedHunter ? "Seed Hunter H3: tre candidati creati." : "Video Studio: progetto creato.");
  } catch (error) {
    status.textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false;
    updateReadiness();
  }
}

async function applyLipdub(button) {
  button.disabled = true;
  try {
    const project = await api(`/api/video-studio/projects/${button.dataset.lipdub}/lipdub`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: button.dataset.generation }),
    });
    state.projects = state.projects.map((item) => item.id === project.id ? project : item);
    renderProjects();
    showToast("LipDub aggiunto alla coda.");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function promoteH3Preview(button) {
  button.disabled = true;
  const finishingMode = button.dataset.finishing || "rtx";
  button.textContent = "Preparazione finishing…";
  try {
    const project = await api(`/api/video-studio/projects/${button.dataset.h3Promote}/promote-preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: button.dataset.generation, finishingMode, rcasStrength: 0.35 }),
    });
    state.projects = state.projects.map((item) => item.id === project.id ? project : item);
    renderProjects();
    showToast(finishingMode === "kjLanczos"
      ? "Finitura KJ Lanczos conservativa aggiunta alla coda."
      : "Finishing FILM → RTX ×2 → RCAS aggiunto alla coda.");
  } catch (error) {
    button.disabled = false;
    button.textContent = finishingMode === "kjLanczos" ? "KJ Lanczos · conserva il look" : "RTX · FILM ×2 → VSR → RCAS";
    showToast(error.message);
  }
}

async function regenerateH3Native(button) {
  button.disabled = true;
  button.textContent = "Preparazione finale H3…";
  try {
    const project = await api(`/api/video-studio/projects/${button.dataset.h3Native}/regenerate-native`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: button.dataset.generation, seed: button.dataset.seed || undefined }),
    });
    state.projects = state.projects.map((item) => item.id === project.id ? project : item);
    renderProjects();
    showToast(button.dataset.seed
      ? `Candidato seed ${button.dataset.seed} scelto: finale H3 aggiunto alla coda.`
      : "Finale H3 nativo con lo stesso seed aggiunto alla coda.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Rigenera H3 nativo · stesso seed";
    showToast(error.message);
  }
}

async function promoteH3ToLtx2k(button) {
  button.disabled = true;
  button.textContent = "Preparazione LTX 2.5 IC…";
  try {
    const project = await api(`/api/video-studio/projects/${button.dataset.h3Ltx2k}/h3-ltx2k`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: button.dataset.generation }),
    });
    state.projects = state.projects.map((item) => item.id === project.id ? project : item);
    renderProjects();
    showToast("Refine H3 → LTX 2.5 IC 2K aggiunto alla coda con purge dedicati.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "H3 → LTX 2.5 IC · 2K";
    showToast(error.message);
  }
}

async function repairH3TemporalMotion(button) {
  button.disabled = true;
  button.textContent = "Analisi jerk e riparazione…";
  try {
    const project = await api(`/api/video-studio/projects/${button.dataset.h3Derope}/temporal-derope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ generationId: button.dataset.generation, profile: "balanced" }),
    });
    state.projects = state.projects.map((item) => item.id === project.id ? project : item);
    renderProjects();
    showToast("Temporal De-Rope bilanciato aggiunto alla coda; interviene solo sui segmenti veloci rilevati.");
  } catch (error) {
    button.disabled = false;
    button.textContent = "Temporal De-Rope · bilanciato";
    showToast(error.message);
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

async function archiveVideoProject(button) {
  const projectId = button.dataset.videoProjectArchive;
  if (!confirm("Nascondere questo progetto dal pannello laterale? I file non verranno cancellati.")) return;
  button.disabled = true;
  try {
    await jsonApi(`/api/video-studio/projects/${projectId}/archive`, { archived: true });
    state.projects = state.projects.filter((item) => item.id !== projectId);
    renderProjects();
    showToast("Progetto nascosto");
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function deleteVideoProject(button) {
  const projectId = button.dataset.videoProjectDelete;
  if (!confirm("Eliminare questo progetto e i video generati collegati? L'azione non puo essere annullata.")) return;
  button.disabled = true;
  try {
    const result = await api(`/api/video-studio/projects/${projectId}?files=1`, { method: "DELETE" });
    state.projects = state.projects.filter((item) => item.id !== projectId);
    renderProjects();
    showToast(`Progetto eliminato. File rimossi: ${result.filesDeleted || 0}`);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

async function start() {
  const [config, projects, sequentialPayload, interactivePayload] = await Promise.all([
    getAppConfig(),
    api("/api/video-studio/projects?limit=20"),
    api("/api/video-studio/sequential-story?limit=12").catch(() => ({ projects: [] })),
    api("/api/interactive-cast/projects?limit=12").catch(() => ({ projects: [] })),
  ]);
  state.config = config;
  state.projects = projects;
  state.sequentialStories = sequentialPayload.projects || [];
  state.interactiveCastProjects = interactivePayload.projects || [];
  const engines = state.config.videoStudio.engines;
  $("#actorEngine").innerHTML = engines.map((engine) =>
    `<option value="${engine.id}" ${engine.available ? "" : "disabled"}>${escapeHtml(engine.name)}${engine.available ? "" : " · non installato"}</option>`
  ).join("");
  const preferred = engines.find((engine) => engine.id === "trackedInpaint" && engine.available)
    || engines.find((engine) => engine.available);
  $("#actorEngine").value = preferred?.id || "editAnything";
  $("#studioVideoModel").innerHTML = (state.config.videoModels || [])
    .filter((model) => model.available !== false)
    .map((model) => `<option value="${escapeHtml(model.id)}" ${model.id === "normal" ? "selected" : ""}>${escapeHtml(model.name)}</option>`)
    .join("");
  const characters = state.config.characters?.availableCharacters || [];
  $("#videoCharacterId").innerHTML = [
    `<option value="">Nessuna</option>`,
    ...characters.map((character) =>
      `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)} · ${Number(character.referenceCount || 0)} reference</option>`
    ),
  ].join("");
  populateInteractiveCastCharacters();
  syncCharacterFields();
  const requestedWorkflow = new URLSearchParams(location.search).get("workflow");
  if (state.config.videoStudio.modes.some((item) => item.id === requestedWorkflow)) {
    const requested = document.querySelector(`[name=videoStudioMode][value="${requestedWorkflow}"]`);
    if (requested) requested.checked = true;
  } else if (interactiveCastRoute()) {
    const interactiveCastInput = document.querySelector('[name=videoStudioMode][value="interactiveCast"]');
    if (interactiveCastInput) interactiveCastInput.checked = true;
  }
  renderDialogue();
  renderLoras();
  updateMode();
  attachFormDraft($("#video-studio-form"), {
    key: "ltx-remote:video-studio-draft:v1",
    onRestore: () => {
      try {
        state.dialogue = JSON.parse($("#dialogue-json").value || "[]");
        state.loras = JSON.parse($("#video-loras-json").value || "[]");
      } catch {
        // I singoli campi della bozza restano comunque validi.
      }
      renderDialogue();
      renderLoras();
      updateMode();
      syncCharacterFields();
    },
  });
  await applyGuidedCreation();
  updateEngine();
  for (const tools of document.querySelectorAll("[data-ltx-prompt-tools]")) {
    tools.classList.toggle("hidden", !state.config.promptAssistant?.enabled);
  }
  renderProjects();
  renderSequentialStories();
  renderInteractiveCastEvents();
  renderInteractiveCastProjects();
  void refreshInteractiveCastCapabilities(null, { silent: true });
  setupUploadPreviews();
  checkHealth();
  createAdaptivePoller(checkHealth, { idleMs: 15_000, hiddenMs: 60_000 });
  createAdaptivePoller(async () => {
    await Promise.all([
      refreshProjects(),
      refreshSequentialStories(),
      refreshInteractiveCastProjects(),
    ]);
  }, {
    active: () => state.projects.some((project) => (project.generations || []).some((item) => ["queued", "running"].includes(item.status)))
      || state.sequentialStories.some((project) => ["queued", "running", "generating"].includes(project.status))
      || state.interactiveCastProjects.some((project) => ["queued", "running"].includes(project.status)),
  });
}

function promptInputForMode(selectedMode) {
  return {
    actorReplacement: $("#actorPrompt"),
    interactiveScene: $("#interactivePrompt"),
    sceneTransform: $("#sceneTransformPrompt"),
    retake: $("#retakePrompt"),
    extend: $("#extendPrompt"),
    hdr: $("#hdrPrompt"),
    minimaxH3: $("#h3Prompt"),
    seedHunterH3: $("#seedHunterH3Prompt"),
    actionH3: $("#actionH3Prompt"),
    ltx25Aio: $("#ltx25Prompt"),
  }[selectedMode] || null;
}

function ltxPromptConfigForMode(selectedMode) {
  return {
    actorReplacement: {
      input: $("#actorPrompt"),
      status: $("#actor-prompt-assistant-status"),
      workflowName: "Video Studio · Actor Replacement · sostituzione personaggio",
      sourceFile: () => document.querySelector('[name="identityImage"]')?.files[0] || null,
      mode: () => document.querySelector('[name="identityImage"]')?.files[0] ? "image" : "video",
      toast: "Prompt Actor Replacement creato; clicca Crea progetto quando vuoi.",
    },
    interactiveScene: {
      input: $("#interactivePrompt"),
      status: $("#interactive-prompt-assistant-status"),
      workflowName: "Video Studio · Interactive Scene · scena interattiva",
      sourceFile: () => $("#reference-sheet").files[0] || null,
      mode: () => $("#reference-sheet").files[0] ? "image" : "video",
      toast: "Prompt Interactive Scene creato; clicca Crea progetto quando vuoi.",
    },
    sceneTransform: {
      input: $("#sceneTransformPrompt"),
      status: $("#scene-transform-prompt-assistant-status"),
      workflowName: "Video Studio · Scene Transform V2V · trasformazione video",
      sourceFile: () => document.querySelector('#scene-transform-fields [name="referenceSheet"]')?.files[0] || null,
      mode: () => document.querySelector('#scene-transform-fields [name="referenceSheet"]')?.files[0] ? "image" : "video",
      toast: "Prompt Scene Transform creato; clicca Crea progetto quando vuoi.",
    },
    retake: {
      input: $("#retakePrompt"),
      status: $("#retake-prompt-assistant-status"),
      workflowName: "Video Studio · Retake · rigenerazione clip",
      sourceFile: () => null,
      mode: () => "video",
      toast: "Prompt Retake creato; clicca Crea progetto quando vuoi.",
    },
    extend: {
      input: $("#extendPrompt"),
      status: $("#extend-prompt-assistant-status"),
      workflowName: "Video Studio · Extend · continuazione video",
      sourceFile: () => null,
      mode: () => "video",
      toast: "Prompt Extend creato; clicca Crea progetto quando vuoi.",
    },
    minimaxH3: {
      input: $("#h3Prompt"),
      status: $("#h3-prompt-assistant-status"),
      workflowName: "Video Studio · MiniMax H3",
      sourceFile: () => null,
      sourceFiles: () => {
        const h3Mode = $("#h3Mode")?.value;
        if (h3Mode === "image") return [$("#h3FirstFrame")?.files[0]].filter(Boolean);
        if (h3Mode === "firstLast") return [$("#h3FirstFrame")?.files[0], $("#h3LastFrame")?.files[0]].filter(Boolean);
        if (h3Mode === "references") return [...($("#h3ReferenceImages")?.files || [])].slice(0, 9);
        return [];
      },
      mode: () => {
        const h3Mode = $("#h3Mode")?.value;
        if ($("#h3ModelProfile")?.value === "erosMax" && h3Mode === "image") return "references";
        if (h3Mode === "references") return "references";
        if (h3Mode === "firstLast") return "firstLast";
        if (h3Mode === "image") return "image";
        return "text";
      },
      promptPreset: () => {
        if ($("#h3ModelProfile")?.value === "erosMax") return "h3_eros_max";
        const selected = $("#h3PromptPreset")?.value || "h3_general";
        return ["image", "firstLast"].includes($("#h3Mode")?.value) && selected === "h3_general"
          ? "h3_image_to_video"
          : selected;
      },
      duration: () => $("#h3Duration")?.value || "",
      text: (triggers = []) => {
        const h3Mode = $("#h3Mode")?.value || "text";
        const erosMax = $("#h3ModelProfile")?.value === "erosMax";
        const modeName = erosMax && h3Mode === "image"
          ? "Eros Single Reference (Ref2VA with <Picture 1>, never first-frame I2VA)"
          : { text: "T2VA", image: "I2VA", firstLast: "FL2VA", references: "Ref2VA" }[h3Mode];
        const referenceCounts = h3Mode === "references"
          ? ` Supplied references: ${Math.min(9, $("#h3ReferenceImages")?.files?.length || 0)} pictures, ${Math.min(3, $("#h3ReferenceVideos")?.files?.length || 0)} videos, ${Math.min(3, $("#h3ReferenceAudios")?.files?.length || 0)} separate audio files.`
          : "";
        const sceneHint = H3_SCENE_PRESETS[$("#h3ScenePreset")?.value]?.hint || "";
        return `H3 input mode: ${modeName}. Target duration: ${$("#h3Duration")?.value || 5} seconds.${referenceCounts} ${h3LoraPromptContract(triggers)}${sceneHint ? ` Scene preset: ${sceneHint}` : ""} User request: ${$("#h3Prompt").value}`;
      },
      toast: "Prompt MiniMax H3 creato; controlla i tag reference e avvia quando vuoi.",
    },
    seedHunterH3: {
      input: $("#seedHunterH3Prompt"),
      status: $("#seed-hunter-h3-prompt-assistant-status"),
      workflowName: "Video Studio · Seed Hunter H3 · tre candidati",
      sourceFile: () => null,
      sourceFiles: () => {
        const selected = $("#seedHunterH3Mode")?.value || "text";
        if (selected === "image") return [$("#seedHunterH3FirstFrame")?.files[0]].filter(Boolean);
        if (selected === "firstLast") return [$("#seedHunterH3FirstFrame")?.files[0], $("#seedHunterH3LastFrame")?.files[0]].filter(Boolean);
        return [];
      },
      mode: () => {
        const selected = $("#seedHunterH3Mode")?.value || "text";
        return selected === "firstLast" ? "firstLast" : selected === "image" ? "image" : "text";
      },
      promptPreset: () => $("#seedHunterH3PromptPreset")?.value || "h3_general",
      duration: () => $("#seedHunterH3Duration")?.value || "",
      text: (triggers = []) => `H3 Seed Hunter input mode: ${$("#seedHunterH3Mode")?.value || "text"}. Target duration: ${$("#seedHunterH3Duration")?.value || 5} seconds. The identical complete timeline will be tested with three consecutive seeds. ${h3LoraPromptContract(triggers)} User request: ${$("#seedHunterH3Prompt").value}`,
      toast: "Prompt Seed Hunter H3 creato; verrà applicato identico ai tre candidati.",
    },
    actionH3: {
      input: $("#actionH3Prompt"),
      status: $("#action-h3-prompt-assistant-status"),
      workflowName: "Video Studio · ACTION H3 · FL2VA Combat V2",
      sourceFile: () => null,
      sourceFiles: () => {
        const actionMode = $("#actionH3Mode")?.value;
        if (actionMode === "image") return [$("#actionH3FirstFrame")?.files[0]].filter(Boolean);
        if (actionMode === "firstLast") return [$("#actionH3FirstFrame")?.files[0], $("#actionH3LastFrame")?.files[0]].filter(Boolean);
        return [];
      },
      mode: () => {
        const actionMode = $("#actionH3Mode")?.value || "text";
        return actionMode === "firstLast" ? "firstLast" : actionMode === "image" ? "image" : "text";
      },
      promptPreset: () => $("#actionH3PromptPreset")?.value || "h3_action",
      duration: () => $("#actionH3Duration")?.value || "",
      text: (triggers = []) => {
        const actionMode = $("#actionH3Mode")?.value || "text";
        const modeName = { text: "T2VA", image: "I2VA", firstLast: "FL2VA" }[actionMode];
        const trigger = $("#actionH3Trigger")?.value || "no trigger";
        const preset = ACTION_H3_PRESETS[$("#actionH3Preset")?.value] || ACTION_H3_PRESETS.custom;
        return `H3 input mode: ${modeName}. Target duration: ${$("#actionH3Duration")?.value || 5} seconds. ${h3LoraPromptContract(triggers)} Combat Base V2 trigger: ${trigger}. ACTION preset direction: ${preset.hint} Complete every action beat before dialogue. User request: ${$("#actionH3Prompt").value}`;
      },
      toast: "Coreografia ACTION H3 creata; verifica impatti, reazioni e ordine temporale.",
    },
    ltx25Aio: {
      input: $("#ltx25Prompt"),
      status: $("#ltx25-prompt-assistant-status"),
      workflowName: "Video Studio · LTX 2.5 AIO",
      sourceFile: () => $("#ltx25ReferenceSheet")?.files[0] || $("#ltx25MsrReferences")?.files[0] || $("#ltx25FirstFrame")?.files[0] || null,
      sourceFiles: () => [
        $("#ltx25FirstFrame")?.files[0],
        ...([...($("#ltx25Keyframes")?.files || [])]),
        $("#ltx25LastFrame")?.files[0],
        $("#ltx25ReferenceSheet")?.files[0],
        ...([...($("#ltx25MsrReferences")?.files || [])]),
      ].filter(Boolean).slice(0, 8),
      mode: () => ["text", "multishot", "textAudio"].includes($("#ltx25Mode")?.value) ? "text" : "image",
      promptPreset: () => $("#ltx25PromptPreset")?.value || "ltx_general",
      duration: () => $("#ltx25Duration")?.value || "",
      text: (triggers = []) => {
        const selected = $("#ltx25Mode")?.value || "text";
        const triggerContract = triggers.length
          ? `Put these verified LoRA activation words exactly once at the very beginning: ${triggers.join(", ")}. `
          : "";
        if (selected === "v2vDeblur") {
          return `${triggerContract}Rewrite the user request for the official LTX IC-LoRA Deblur convention. Output one concise prompt in this exact semantic order: Reference shows <accurate source scene description>, heavily out of focus with soft defocused blur and no fine detail. Edited shows the same scene in sharp focus with crisp detail and clean edges. DEBLUR <the same scene description>. Subject identity, framing, background geometry, motion and timing are identical to the reference; only focus and sharpness differ. Do not invent scene changes. User request: ${$("#ltx25Prompt").value}`;
        }
        if (selected === "multiReferenceMsr") {
          const count = Math.min(5, $("#ltx25MsrReferences")?.files?.length || 0);
          return `${triggerContract}Create a production-ready LTX 2.5 Multiple Subject Reference prompt for ${count || "1-5"} ordered images. Refer to every supplied source explicitly as Image 1, Image 2, Image 3, Image 4 and Image 5 only when present; Image 5 is the optional environment/background. Assign each subject a stable role, appearance and spatial position, then describe chronological interaction, camera, synchronized dialogue and diegetic audio without merging identities. User request: ${$("#ltx25Prompt").value}`;
        }
        return `${triggerContract}Create a production-ready LTX 2.5 ${selected} prompt. Respect the requested duration, chronological action, camera, synchronized dialogue and diegetic audio. User request: ${$("#ltx25Prompt").value}`;
      },
      toast: "Prompt LTX 2.5 creato; controlla timeline, audio e trigger prima di avviare.",
    },
  }[selectedMode] || null;
}

function ltxPromptLabel(target) {
  return {
    ltx_architect: "LTX Prompt",
    ltx_scenes: "LTX Scene",
    sulphur_prompt: "LTX Sulphur",
    minimax_h3: "H3 Prompt",
    minimax_h3_fantasy_verite: "H3 Fantasy vérité",
    minimax_h3_action: "ACTION Prompt",
  }[target] || "LTX Prompt";
}

async function runVideoStudioLtxPrompt(button) {
  const tools = button.closest("[data-ltx-prompt-tools]");
  const selectedMode = tools?.dataset.ltxPromptTools || mode();
  const config = ltxPromptConfigForMode(selectedMode);
  if (!config?.input) return;
  let target = button.dataset.ltxPrompt;
  if (selectedMode === "minimaxH3" && $("#h3ScenePreset")?.value === "fantasyVerite") {
    target = "minimax_h3_fantasy_verite";
  }
  syncLoras();
  const selectedPromptTriggers = selectedVideoPromptTriggers(selectedMode);
  try {
    const enhanced = await enhanceMainPrompt({
      input: config.input,
      button,
      status: config.status,
      target,
      promptPreset: config.promptPreset?.() || "",
      duration: config.duration?.() || "",
      mode: config.mode(),
      workflowName: `${config.workflowName} · ${ltxPromptLabel(target)}`,
      sourceFile: config.sourceFile(),
      sourceFiles: config.sourceFiles?.() || [],
      text: config.promptPreset ? config.input.value : config.text?.(selectedPromptTriggers),
      negativeInput: $("#videoNegativePrompt"),
      includeNegative: !["minimaxH3", "actionH3", "seedHunterH3"].includes(selectedMode),
      buttonScope: tools,
      fields: {
        characterId: $("#videoCharacterId")?.value || "",
        identityStrength: $("#videoCharacterIdentityStrength")?.value || "medium",
        lockFace: $("#videoCharacterLockFace")?.value || "true",
        lockHair: $("#videoCharacterLockHair")?.value || "true",
        lockBody: $("#videoCharacterLockBody")?.value || "true",
        lockOutfit: $("#videoCharacterLockOutfit")?.value || "false",
        videoStudioMode: selectedMode,
      },
    });
    $("#videoCharacterPromptEnhanced").value = enhanced?.character?.id || "";
    applyVideoPromptTriggers(config.input, selectedMode, selectedPromptTriggers);
    const triggerNotice = selectedPromptTriggers.length
      ? ` Trigger applicato: ${selectedPromptTriggers.join(", ")}.`
      : "";
    showToast(`${config.toast}${triggerNotice}`);
  } catch {
    // Stato mostrato accanto al prompt; il testo originale resta nel textarea.
  }
}

async function applyGuidedCreation() {
  const token = guidedTokenFromLocation();
  if (!token) return;
  const handoff = await consumeGuidedHandoff(token);
  if (!handoff?.payload?.fields) return;
  const { fields } = handoff.payload;
  const selectedMode = fields.videoStudioMode;
  const modeInput = selectedMode
    ? document.querySelector(`[name="videoStudioMode"][value="${CSS.escape(selectedMode)}"]`)
    : null;
  if (modeInput) modeInput.checked = true;
  updateMode();
  if (selectedMode === "interactiveCast") {
    if (fields.interactiveCastNewActorName) {
      $("#interactiveCastNewActorName").value = fields.interactiveCastNewActorName;
    }
    if (fields.interactiveCastCharacterId !== undefined) {
      $("#interactiveCastNewActor").value = fields.interactiveCastCharacterId || "";
    }
    if (fields.interactiveCastAnchorWorkflow) {
      $("#interactiveCastAnchorWorkflow").value = fields.interactiveCastAnchorWorkflow;
    }
    if (fields.interactiveCastBrief) {
      $("#interactiveCastBrief").value = fields.interactiveCastBrief;
    }
    if (Array.isArray(fields.interactiveCastEvents) && fields.interactiveCastEvents.length) {
      state.interactiveCastEvents = fields.interactiveCastEvents;
      renderInteractiveCastEvents();
    }
    state.interactiveCastPreferredQuality = fields.quality === "max" ? "max" : "preview";
  }
  if (["normal", "sulphur"].includes(fields.engine)) {
    const option = [...$("#studioVideoModel").options].find((item) => item.value === fields.engine && !item.disabled);
    if (option) $("#studioVideoModel").value = fields.engine;
  }
  if (mode() === "actorReplacement" && fields.engine) {
    const actorOption = [...$("#actorEngine").options].find((item) => item.value === fields.engine && !item.disabled);
    if (actorOption) $("#actorEngine").value = fields.engine;
  }
  if (["retake", "extend"].includes(mode())) {
    $("#studioResolution").value = fields.quality === "speed"
      ? "360p"
      : fields.quality === "max"
        ? "720p"
        : "480p";
  }
  const promptInput = promptInputForMode(mode());
  if (promptInput && fields.prompt) {
    promptInput.value = fields.prompt;
    promptInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (mode() === "sequentialStory" && fields.prompt) {
    $("#sequentialDescription").value = fields.prompt;
  }
  const transferredFields = {
    referenceDescription: "#referenceDescription",
    duration: mode() === "interactiveScene" ? "#interactiveDuration" : mode() === "retake" ? "#retakeDuration" : null,
    cameraMotion: "#cameraMotion",
    editUseCase: "#editUseCase",
    controlType: "#sceneControlType",
    controlStrength: "#sceneControlStrength",
    extendDuration: "#extendDuration",
    hdrExposure: "#hdrExposure",
    sequentialSceneCount: "#sequentialSceneCount",
    sequentialSceneDuration: "#sequentialSceneDuration",
    sequentialGlobalStyle: "#sequentialGlobalStyle",
  };
  for (const [field, selector] of Object.entries(transferredFields)) {
    if (!selector || fields[field] === undefined || fields[field] === "") continue;
    const input = $(selector);
    if (input) input.value = fields[field];
  }
  if (mode() === "sequentialStory" && handoff.files?.sequentialInitialImage) {
    $("#sequentialInputMode").value = "image";
    syncSequentialInputMode();
  }
  for (const [name, file] of Object.entries(handoff.files || {})) {
    const input = document.querySelector(`[name="${CSS.escape(name)}"]:not([disabled])`)
      || document.querySelector(`[name="${CSS.escape(name)}"]`);
    setInputFile(input, file);
  }
  history.replaceState({}, "", location.pathname);
  showToast("Workflow video preparato dalla guida. Controlla i dettagli prima di generare.");
}

document.querySelectorAll("[name=videoStudioMode]").forEach((input) => input.addEventListener("change", updateMode));
$("#h3Mode").addEventListener("change", () => {
  const selectedMode = $("#h3Mode")?.value || "text";
  if ($("#h3ModelProfile")?.value === "erosMax") {
    $("#h3PromptPreset").value = "h3_eros_max";
  } else if (["image", "firstLast"].includes(selectedMode) && $("#h3PromptPreset").value === "h3_general") {
    $("#h3PromptPreset").value = "h3_image_to_video";
  } else if (selectedMode === "text" && $("#h3PromptPreset").value === "h3_image_to_video") {
    $("#h3PromptPreset").value = "h3_general";
  }
  updateH3Fields();
  updateReadiness();
});
$("#h3ModelProfile")?.addEventListener("change", () => {
  const erosMax = $("#h3ModelProfile").value === "erosMax";
  $("#h3PromptPreset").value = erosMax
    ? "h3_eros_max"
    : $("#h3Mode").value === "image" ? "h3_image_to_video" : "h3_general";
  updateH3Fields();
  updateReadiness();
});
$("#actionH3Mode").addEventListener("change", () => {
  updateActionH3Fields();
  updateReadiness();
});
$("#seedHunterH3Mode")?.addEventListener("change", () => {
  updateSeedHunterH3Fields();
  updateReadiness();
});
$("#ltx25Mode").addEventListener("change", () => {
  updateLtx25Fields();
  updateReadiness();
});
$("#ltx25Profile").addEventListener("change", () => {
  updateLtx25Fields();
  updateMode();
});
$("#ltx25LoraPreset").addEventListener("change", updateLtx25LoraPresetHint);
$("#ltx25-apply-lora-preset").addEventListener("click", applyLtx25LoraPreset);
for (const selector of ["#h3RefineMode", "#h3FirstMegapixels", "#h3SecondMegapixels", "#h3SeedvrResolution"]) {
  $(selector).addEventListener("change", updateH3Fields);
}
$("#h3RunProfile").addEventListener("change", updateMode);
$("#h3ScenePreset").addEventListener("change", updateH3ScenePresetHint);
$("#h3ApplyScenePreset").addEventListener("click", applyH3ScenePreset);
$("#actionH3RunProfile").addEventListener("change", updateMode);
$("#actionH3Preset").addEventListener("change", updateActionH3PresetHint);
$("#action-h3-apply-preset").addEventListener("click", applyActionH3Preset);
$("#interactive-cast-workspace-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-interactive-cast-view]");
  if (!button) return;
  setInteractiveCastView(button.dataset.interactiveCastView, { scroll: true });
  renderInteractiveCastProjects();
});
$("#interactive-cast-active-project").addEventListener("change", (event) => {
  setInteractiveCastView("production", { projectId: event.currentTarget.value });
  renderInteractiveCastProjects();
});
window.addEventListener("hashchange", () => {
  if (mode() !== "interactiveCast") return;
  const route = interactiveCastRoute();
  if (!route) return;
  setInteractiveCastView(route.view, { projectId: route.projectId, updateHash: false });
  renderInteractiveCastProjects();
});
$("#videoCharacterId").addEventListener("change", syncCharacterFields);
$("#actorEngine").addEventListener("change", updateEngine);
$("#replacementScope").addEventListener("change", updateEngine);
$("#selectionMode").addEventListener("change", updateEngine);
$("#targetFaceIndex").addEventListener("change", () => {
  $("#actor-selection-marker").classList.add("hidden");
});
$("#actor-selection-canvas").addEventListener("pointerdown", (event) => {
  const selectionMode = $("#selectionMode").value;
  if (selectionMode === "click") {
    selectActorPoint(event);
    return;
  }
  if (selectionMode === "paint") {
    state.actorDrawing = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    paintActorMask(event);
  }
});
$("#actor-selection-canvas").addEventListener("pointermove", (event) => {
  if (state.actorDrawing && $("#selectionMode").value === "paint") paintActorMask(event);
});
$("#actor-selection-canvas").addEventListener("pointerup", () => {
  state.actorDrawing = false;
});
$("#actor-selection-canvas").addEventListener("pointercancel", () => {
  state.actorDrawing = false;
});
$("#clear-actor-mask").addEventListener("click", clearActorMask);
$("#add-dialogue").addEventListener("click", () => {
  syncDialogue();
  state.dialogue.push({ speaker: "", line: "", delivery: "" });
  renderDialogue();
});
$("#dialogue-list").addEventListener("input", syncDialogue);
$("#dialogue-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-dialogue]");
  if (!button) return;
  syncDialogue();
  state.dialogue.splice(Number(button.dataset.removeDialogue), 1);
  renderDialogue();
});
$("#video-add-lora").addEventListener("click", () => {
  syncLoras();
  const h3Active = ["minimaxH3", "actionH3", "seedHunterH3"].includes(mode());
  const selected = $("#video-lora-picker")?.value;
  if (!selected) return showToast(`Nessuna altra LoRA ${h3Active ? "MiniMax H3" : "LTX 2.3"} disponibile.`);
  state.loras.push({ name: selected, strength: .8 });
  renderLoras();
  showToast(`LoRA aggiunta: ${selected.split(/[\\/]/).pop()}`);
});
$("#video-loras").addEventListener("input", syncLoras);
$("#video-loras").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-lora]");
  if (!button) return;
  syncLoras();
  state.loras.splice(Number(button.dataset.removeLora), 1);
  renderLoras();
});
$("#video-studio-projects").addEventListener("click", (event) => {
  const promote = event.target.closest("[data-h3-promote]");
  if (promote) {
    promoteH3Preview(promote);
    return;
  }
  const native = event.target.closest("[data-h3-native]");
  if (native) {
    regenerateH3Native(native);
    return;
  }
  const seedPromote = event.target.closest("[data-h3-seed-promote]");
  if (seedPromote) {
    seedPromote.dataset.h3Native = seedPromote.dataset.h3SeedPromote;
    regenerateH3Native(seedPromote);
    return;
  }
  const ltx2k = event.target.closest("[data-h3-ltx2k]");
  if (ltx2k) {
    promoteH3ToLtx2k(ltx2k);
    return;
  }
  const derope = event.target.closest("[data-h3-derope]");
  if (derope) {
    repairH3TemporalMotion(derope);
    return;
  }
  const cancel = event.target.closest("[data-cancel-job]");
  if (cancel) {
    cancelProjectGeneration(cancel);
    return;
  }
  const archive = event.target.closest("[data-video-project-archive]");
  if (archive) {
    archiveVideoProject(archive);
    return;
  }
  const remove = event.target.closest("[data-video-project-delete]");
  if (remove) {
    deleteVideoProject(remove);
    return;
  }
  const button = event.target.closest("[data-lipdub]");
  if (button) applyLipdub(button);
});
$("#sequential-plan-button").addEventListener("click", generateSequentialPlan);
$("#sequential-start-button").addEventListener("click", startSequentialStory);
$("#interactive-cast-create-button").addEventListener("click", createInteractiveCastProject);
$("#interactive-cast-refresh-capabilities").addEventListener("click", (event) => {
  refreshInteractiveCastCapabilities(event.currentTarget);
});
$("#interactive-cast-add-event").addEventListener("click", () => {
  syncInteractiveCastEvents();
  state.interactiveCastEvents.push({ speaker: "New Actor", start: 0, end: 2, dialogue: "", action: "", reaction: "none", mode: "", audioMode: "ltxNative" });
  renderInteractiveCastEvents();
});
$("#interactive-cast-events").addEventListener("input", syncInteractiveCastEvents);
$("#interactive-cast-events").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-cast-event]");
  if (!button) return;
  syncInteractiveCastEvents();
  state.interactiveCastEvents.splice(Number(button.dataset.removeCastEvent), 1);
  renderInteractiveCastEvents();
});
$("#interactive-cast-projects").addEventListener("click", (event) => {
  const configGuide = event.target.closest("[data-interactive-cast-guide-config]");
  if (configGuide) {
    setInteractiveCastView("config", { updateHash: true, scroll: true });
    return;
  }
  const targetGuide = event.target.closest("[data-interactive-cast-guide-target]");
  if (targetGuide) {
    const projectCard = targetGuide.closest("[data-interactive-cast-project]");
    const segment = projectCard?.querySelector(`[data-interactive-cast-segment="${CSS.escape(targetGuide.dataset.interactiveCastGuideTarget)}"]`);
    segment?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const remove = event.target.closest("[data-interactive-cast-delete]");
  if (remove) {
    deleteInteractiveCastProject(remove);
    return;
  }
  const actors = event.target.closest("[data-interactive-cast-actors]");
  if (actors) {
    saveInteractiveCastActors(actors);
    return;
  }
  const addSpeaker = event.target.closest("[data-interactive-cast-speaker-add]");
  if (addSpeaker) {
    addInteractiveCastSpeaker(addSpeaker);
    return;
  }
  const removeSpeaker = event.target.closest("[data-interactive-cast-speaker-remove]");
  if (removeSpeaker) {
    removeInteractiveCastSpeaker(removeSpeaker);
    return;
  }
  const speakers = event.target.closest("[data-interactive-cast-speakers]");
  if (speakers) {
    saveInteractiveCastSpeakers(speakers);
    return;
  }
  const button = event.target.closest("[data-interactive-cast-segments]");
  if (button) {
    prepareInteractiveCastSegments(button);
    return;
  }
  const replacement = event.target.closest("[data-interactive-cast-replacement]");
  if (replacement) {
    attachInteractiveCastReplacement(replacement);
    return;
  }
  const generate = event.target.closest("[data-interactive-cast-generate]");
  if (generate) {
    generateInteractiveCastSegment(generate);
    return;
  }
  const approveAnchor = event.target.closest("[data-interactive-cast-approve-anchor]");
  if (approveAnchor) {
    approveInteractiveCastAnchor(approveAnchor);
    return;
  }
  const externalAnchor = event.target.closest("[data-interactive-cast-external-anchor]");
  if (externalAnchor) {
    importInteractiveCastExternalAnchor(externalAnchor);
    return;
  }
  const copyAnchorPrompt = event.target.closest("[data-interactive-cast-copy-anchor-prompt]");
  if (copyAnchorPrompt) {
    copyInteractiveCastAnchorPrompt(copyAnchorPrompt);
    return;
  }
  const composite = event.target.closest("[data-interactive-cast-composite]");
  if (composite) {
    applyInteractiveCastComposite(composite);
    return;
  }
  const dialogueAudio = event.target.closest("[data-interactive-cast-dialogue-audio]");
  if (dialogueAudio) {
    attachInteractiveCastDialogueAudio(dialogueAudio);
    return;
  }
  const synthesizeDialogue = event.target.closest("[data-interactive-cast-dialogue-synthesize]");
  if (synthesizeDialogue) {
    synthesizeInteractiveCastDialogue(synthesizeDialogue);
    return;
  }
  const lipsync = event.target.closest("[data-interactive-cast-lipsync]");
  if (lipsync) {
    applyInteractiveCastLipSync(lipsync);
    return;
  }
  const identity = event.target.closest("[data-interactive-cast-identity]");
  if (identity) {
    runInteractiveCastIdentityCheck(identity);
    return;
  }
  const audioRemix = event.target.closest("[data-interactive-cast-audio-remix]");
  if (audioRemix) {
    remixInteractiveCastAudio(audioRemix);
    return;
  }
  const concat = event.target.closest("[data-interactive-cast-concat]");
  if (concat) concatInteractiveCastFinal(concat);
});
$("#sequentialInputMode").addEventListener("change", syncSequentialInputMode);
$("#sequential-scenes").addEventListener("input", syncSequentialScenes);
$("#sequential-scenes").addEventListener("click", (event) => {
  const card = event.target.closest("[data-sequential-scene]");
  if (!card || !state.sequentialPlan) return;
  syncSequentialScenes();
  const index = Number(card.dataset.sequentialScene);
  if (event.target.closest("[data-scene-move='up']") && index > 0) {
    const scenes = state.sequentialPlan.scenes;
    [scenes[index - 1], scenes[index]] = [scenes[index], scenes[index - 1]];
  } else if (event.target.closest("[data-scene-move='down']") && index < state.sequentialPlan.scenes.length - 1) {
    const scenes = state.sequentialPlan.scenes;
    [scenes[index + 1], scenes[index]] = [scenes[index], scenes[index + 1]];
  } else if (event.target.closest("[data-scene-duplicate]")) {
    const duplicate = {
      ...state.sequentialPlan.scenes[index],
      id: `scene-${Date.now().toString(36)}`,
      title: `${state.sequentialPlan.scenes[index].title} · copia`,
      status: "pending",
      stale: false,
    };
    state.sequentialPlan.scenes.splice(index + 1, 0, duplicate);
  } else if (event.target.closest("[data-scene-delete]")) {
    state.sequentialPlan.scenes.splice(index, 1);
  } else if (event.target.closest("[data-scene-regenerate]")) {
    regenerateSequentialScene(index);
    return;
  } else {
    return;
  }
  state.sequentialPlan.scenes = state.sequentialPlan.scenes.map((scene, sceneIndex) => ({
    ...scene,
    index: sceneIndex + 1,
  }));
  renderSequentialScenes();
});
$("#sequential-story-projects").addEventListener("click", async (event) => {
  const projectCard = event.target.closest("[data-sequential-project]");
  if (!projectCard) return;
  const projectId = projectCard.dataset.sequentialProject;
  const action = event.target.closest("[data-sequential-action]")?.dataset.sequentialAction;
  const retryScene = event.target.closest("[data-sequential-scene-retry]")?.dataset.sequentialSceneRetry;
  try {
    let payload = null;
    if (retryScene) {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/scenes/${retryScene}/retry`, { method: "POST" });
    } else if (action === "pause") {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/pause`, { method: "POST" });
    } else if (action === "resume") {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/resume`, { method: "POST" });
    } else if (action === "cancel") {
      payload = await api(`/api/video-studio/sequential-story/${projectId}/cancel`, { method: "POST" });
    } else if (action === "delete") {
      if (!confirm("Eliminare questa Storia continua? Le generazioni finalizzate restano nella cronologia.")) return;
      await api(`/api/video-studio/sequential-story/${projectId}`, { method: "DELETE" });
      state.sequentialStories = state.sequentialStories.filter((item) => item.id !== projectId);
      renderSequentialStories();
      showToast("Storia continua eliminata; generazioni preservate.");
      return;
    }
    if (!payload?.project) return;
    state.sequentialStories = state.sequentialStories.map((item) =>
      item.id === payload.project.id ? payload.project : item
    );
    if (!state.sequentialStories.some((item) => item.id === payload.project.id)) {
      state.sequentialStories.unshift(payload.project);
    }
    renderSequentialStories();
    showToast("Storia continua aggiornata.");
  } catch (error) {
    showToast(error.message);
  }
});
$("#video-studio-form").addEventListener("submit", submitProject);
$("#video-studio-form").addEventListener("click", (event) => {
  const button = event.target.closest("[data-ltx-prompt]");
  if (!button) return;
  runVideoStudioLtxPrompt(button);
});
setupPreview("#actor-source-video", "#actor-video-preview", "has-video");
setupPreview("#reference-sheet", "#reference-sheet-preview", "has-image");
$("#actor-video-preview").addEventListener("loadedmetadata", (event) => {
  const video = event.currentTarget;
  video.currentTime = Math.min(0.08, Math.max(0, (video.duration || 0) / 100));
});
$("#actor-video-preview").addEventListener("seeked", (event) => {
  const video = event.currentTarget;
  ensureActorCanvases(video.videoWidth, video.videoHeight);
  const context = state.actorFrame.getContext("2d");
  context.drawImage(video, 0, 0, state.actorFrame.width, state.actorFrame.height);
  $("#actor-selection-marker").classList.add("hidden");
  drawActorSelection();
});

start().catch((error) => {
  $("#video-studio-status").textContent = error.message;
  setConnection(false);
});
