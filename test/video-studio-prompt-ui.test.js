import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/video-studio.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const assistant = fs.readFileSync(new URL("../public/prompt-assistant.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const guides = fs.readFileSync(new URL("../public/workflow-guides.js", import.meta.url), "utf8");
const actionPresets = fs.readFileSync(new URL("../src/h3-action-presets.js", import.meta.url), "utf8");

const expectedModes = [
  "actorReplacement",
  "interactiveScene",
  "sceneTransform",
  "retake",
  "extend",
];

test("Video Studio espone MiniMax H3 con quattro modalità, reference multimodali e profili sampling", () => {
  assert.match(html, /value="minimaxH3"/);
  assert.match(html, /id="h3ModelProfile"[\s\S]*H3 Eros Max beta3/);
  assert.match(html, /value="h3_general">H3 Reference Generation/);
  assert.doesNotMatch(html, /value="h3_eros_max"/);
  for (const h3Mode of ["text", "image", "firstLast", "references"]) {
    assert.match(html, new RegExp(`option value="${h3Mode}"`));
  }
  assert.match(html, /h3ReferenceImages[\s\S]*multiple/);
  assert.match(html, /h3ReferenceVideos[\s\S]*multiple/);
  assert.match(html, /h3ReferenceAudios[\s\S]*multiple/);
  assert.match(html, /0,4 MP[\s\S]*0,6 MP[\s\S]*0,9 MP/);
  assert.match(html, /1,0 MP/);
  assert.match(html, /Purge VRAM fra i due sampling/);
  assert.match(html, /id="h3LookPreset"/);
  assert.match(html, /Amatoriale handheld realistico/);
  assert.match(html, /id="h3ScenePreset"/);
  assert.match(html, /Fantasy vérité · avventuriera amatoriale/);
  assert.match(html, /NSFW realistico generale · AIO/);
  assert.match(html, /Anime NSFW moderno · 2D stabile/);
  assert.match(html, /POV Breast Play Pro · GalaxyAce \+ VBVR/);
  assert.match(html, /id="h3ApplyScenePreset"/);
  assert.match(script, /h3Loras/);
  assert.match(script, /minimax_h3: "H3 Prompt"/);
  assert.match(script, /sourceFiles: \(\) =>/);
  assert.match(script, /Eros Single Reference \(Ref2VA with <Picture 1>/);
  assert.match(script, /promptPreset: \(\) => "h3_general"/);
  assert.match(script, /h3ModelProfile"\)\?\.value === "erosMax" && h3Mode === "image"\) return "references"/);
  assert.match(script, /Turbo Eros integrato a 6 step/);
  assert.match(assistant, /data\.append\("sourceImages"/);
  assert.match(server, /"minimax_h3"/);
  assert.match(guides, /id: "videoMiniMaxH3"/);
  assert.match(guides, /0,4 o 0,6 MP/);
});

test("il comando Crea progetto resta cliccabile e recupera le capability H3 online", () => {
  assert.match(html, /id="video-studio-submit"[^>]*type="submit"/);
  assert.match(html, /video-studio\.js\?v=20260918-plague-scene-loras/);
  assert.match(html, /styles\.css\?v=20260917-video-mode-groups/);
  assert.match(script, /submit\.disabled = false/);
  assert.match(script, /state\.config = await getAppConfig\(\{ force: true \}\)/);
  assert.match(script, /shouldRefreshCapabilities/);
  assert.match(script, /document\.querySelectorAll\("#dialogue-list \.dialogue-row"\)/);
  assert.doesNotMatch(script, /document\.querySelectorAll\("\.dialogue-row"\)/);
  assert.match(styles, /#video-studio-submit \{/);
  assert.match(styles, /#video-studio-submit:hover:not\(:disabled\)/);
});

test("i preset H3 preparano anteprima, LoRA compatibili e finitura conservativa", () => {
  assert.match(script, /function applyH3ScenePreset/);
  assert.match(script, /fantasyVerite/);
  assert.match(script, /urbanPhoneDiary/);
  assert.match(script, /documentaryPortrait/);
  assert.match(script, /dynamicTracking/);
  assert.match(script, /adultRealisticGeneral/);
  assert.match(script, /adultStableMotion/);
  assert.match(script, /adultAnime/);
  assert.match(script, /adultBreastPlayReasoning/);
  assert.match(script, /breastPlay.*0\.75[\s\S]*galaxyAce.*0\.55[\s\S]*vbvrPro.*0\.8[\s\S]*bounceFl2va.*0\.6/);
  assert.match(script, /preserveTurbo: true/);
  assert.match(script, /sampler: "res_2s", scheduler: "beta57"/);
  assert.match(script, /selectedMode === "minimaxH3"[\s\S]*forcedTriggers/);
  assert.match(script, /H3_SCENE_MANAGED_LORA_TYPES/);
  assert.match(script, /forcedTriggers: \["her breast is bouncing up and down"\]/);
  assert.match(script, /h3UseTurbo"\)\.checked = false/);
  assert.match(script, /STY_Realism_People/);
  assert.match(script, /STY_Motion_Booster/);
  assert.match(script, /strength: 0\.7/);
  assert.match(script, /kjLanczos/);
  assert.match(script, /minimax_h3_fantasy_verite/);
  assert.match(server, /"minimax_h3_fantasy_verite"/);
});

test("il selettore LoRA MiniMax H3 sceglie esplicitamente la LoRA prima di aggiungerla", () => {
  assert.match(html, /id="video-lora-picker"/);
  assert.match(html, /id="video-add-lora"[\s\S]*Aggiungi LoRA/);
  assert.match(script, /function videoLoraChoices/);
  assert.match(html, /id="ltx25LoraPreset"[\s\S]*Selfie Organic[\s\S]*Selfie Handheld in movimento[\s\S]*Fantasy Handheld Realism[\s\S]*Cinematografico naturale[\s\S]*Action Handheld[\s\S]*Action Cinematic[\s\S]*Action Multishot/);
  assert.match(script, /const LTX25_LORA_PRESETS[\s\S]*AmateurHour[\s\S]*VBVR-I2V-390K-R32[\s\S]*Fantasy_Realism[\s\S]*Crisp_Enhance[\s\S]*actionHandheld[\s\S]*actionCinematic[\s\S]*actionMultishot[\s\S]*Cinematic hardcut/);
  assert.match(script, /function applyLtx25LoraPreset/);
  assert.match(script, /function renderLoraPicker/);
  assert.match(script, /const selected = \$\("#video-lora-picker"\)\?\.value/);
  assert.match(script, /const metadata = state\.config\?\.loraMetadata\?\.\[selected\]/);
  assert.match(script, /state\.loras\.push\(\{ name: selected, strength: Number\(metadata\?\.recommendedStrength \?\? \.8\) \}\)/);
});

test("LTX 2.5 permette di scegliere Distilled standard o REDGraft Fast 2K", () => {
  assert.match(html, /id="ltx25ModelProfile"[\s\S]*LTX 2\.5 Distilled INT8 ConvRot[\s\S]*REDGraft Fast 2K/);
  assert.match(script, /modelSelect\.value = modelProfiles\.standard\?\.available === false \? "redGraft" : "standard"/);
  assert.match(script, /REDGraft Fast 2K: port Sulphur2 LTX 2\.5 INT8/);
});

test("i trigger verificati delle LoRA Video vengono aggiunti dopo LM Studio e garantiti all'invio", () => {
  assert.match(script, /h3LoraMetadata/);
  assert.match(script, /automaticLoraTriggers/);
  assert.match(script, /await enhanceMainPrompt\([\s\S]*applyVideoPromptTriggers\(config\.input, selectedMode, selectedPromptTriggers\)/);
  assert.match(script, /async function submitProject[\s\S]*applyVideoPromptTriggers\(promptInput, selectedMode\)[\s\S]*new FormData/);
  assert.match(script, /Trigger applicato:/);
  assert.match(script, /applyH3LoraTriggers/);
  assert.match(script, /function h3LoraPromptContract/);
  assert.match(script, /r34l1sm: favor natural human appearance/);
  assert.match(script, /dynv2: describe one readable continuous motion path/);
  assert.match(script, /config\.text\?\.\(selectedPromptTriggers\)/);
  assert.match(script, /includeNegative: !\["minimaxH3", "minimaxH3Fast", "minimaxH3AllInOne", "h3SparseV9", "h3SeamlessChain", "actionH3", "weaponCombatH3", "seedHunterH3"\]\.includes\(selectedMode\)/);
});

test("Minimax H3 Fast espone il workflow I2V sigma-split dedicato", () => {
  assert.match(html, /value="minimaxH3Fast"/);
  assert.match(html, /id="minimax-h3-fast-fields"/);
  assert.match(html, /Dual Clock T8 12 step/);
  assert.match(html, /id="h3FastFirstFrame"/);
  assert.match(script, /Minimax H3 Fast pronto/);
  assert.match(script, /minimaxH3Fast: "#minimax-h3-fast-fields"/);
});

test("PlagueKind Sparse V9 espone sequenze continuative con handoff automatico", () => {
  assert.match(html, /id="h3SparseModel"/);
  assert.match(script, /function renderH3SparseModels/);
  assert.match(html, /id="h3SparseMultiSequence"/);
  assert.match(html, /id="h3SparseContinuityFrames"[\s\S]*22 frame · bilanciato/);
  assert.match(html, /id="h3-sparse-sequence-summary"/);
  assert.match(html, /id="h3SparseLowVram"[^>]*checked disabled/);
  assert.match(html, /Qwen viene scaricato dopo il conditioning/);
  assert.match(script, /lowVram\.checked = true;[\s\S]*lowVram\.disabled = true;/);
  assert.match(script, /PlagueKind continuativo richiede da 2 a 8 prompt/);
  assert.match(script, /form\.set\("h3SparseSegmentCount"/);
  assert.match(script, /selectedMode === "h3SparseV9"[\s\S]*target = "minimax_h3_director_sequence"/);
});

test("Seed Hunter H3 è un workflow autonomo con tre candidati selezionabili", () => {
  assert.match(html, /value="seedHunterH3"/);
  assert.match(html, /id="seed-hunter-h3-fields"/);
  assert.doesNotMatch(html, /<option value="seedHunter">/);
  assert.match(script, /h3Stage === "seedCandidate"/);
  assert.match(script, /data-h3-seed-promote/);
});

test("Video Studio condivide i preset Combat e Weapon tra ACTION H3 e AllInOne", () => {
  assert.match(html, /value="actionH3"/);
  assert.match(html, /id="action-h3-fields"/);
  assert.match(html, /Combat Base V2 automatica/);
  assert.match(html, /res_multistep \+ simple/);
  assert.match(html, /id="actionH3RunProfile"/);
  assert.match(html, /id="actionH3PrimaryLora"[\s\S]*Combat Base V2[\s\S]*Weapon Combat BUNNY/);
  assert.match(html, /id="directorActionPreset"/);
  assert.match(script, /function renderH3ActionPresetSelect/);
  assert.match(script, /function applyDirectorActionPreset/);
  for (const preset of ["streetBrawlVerite", "fantasyMelee", "cinematicOneTake", "brutalFinisher", "readableGroupFight", "smoothChoreography", "impactCloseUp", "technicalCounter", "animeCombat", "swordDuel", "katanaHighSpeed", "parryCounter", "tacticalGunfight", "gunFuClose", "animeSwordFight"]) {
    assert.match(actionPresets, new RegExp(`id: "${preset}"`));
  }
  assert.match(script, /function applyActionH3Preset/);
  assert.match(html, /Anteprima rapida · 0,4 MP \/ stesso seed/);
  assert.match(html, /MAX · 0,9 MP · 25 step · Turbo OFF/);
  assert.match(script, /actionH3Quality.*max25/);
  assert.match(html, /actionH3Mode[\s\S]*Text to Video[\s\S]*Single Image[\s\S]*First \/ Last Frame[\s\S]*Reference Images to Video/);
  assert.match(html, /id="actionH3ReferenceImages"[\s\S]*name="h3ReferenceImages"[\s\S]*multiple/);
  assert.match(html, /&lt;Picture 1&gt;[\s\S]*&lt;Picture 2&gt;[\s\S]*&lt;Picture 3&gt;/);
  assert.match(script, /actionMode === "references"[\s\S]*actionH3ReferenceImages/);
  assert.doesNotMatch(html.match(/<section id="action-h3-fields"[\s\S]*?<section id="retake-fields"/)?.[0] || "", /Multi Reference/);
  assert.match(script, /selectedMode === "actionH3"/);
  assert.match(script, /minimax_h3_action: "ACTION Prompt"/);
  assert.match(script, /Crea anteprima ACTION H3/);
  assert.match(script, /data-h3-promote/);
  assert.match(script, /data-h3-native/);
  assert.match(server, /promote-preview/);
  assert.match(script, /H3 Latent Upscale \+ Refine · stesso seed/);
  assert.match(script, /Solo RTX Super Resolution ×2/);
  assert.match(script, /Solo RCAS · 0,30/);
  assert.match(script, /Solo FILM ×2/);
  assert.match(script, /Migliora finale · FILM ×2 → RTX VSR → RCAS/);
  assert.match(server, /project\.videoStudioMode === "h3SparseV9"/);
  assert.match(server, /h3SparseLatentUpscale: true/);
  assert.match(server, /regenerate-native/);
  assert.match(server, /"minimax_h3_action"/);
});

test("Video Studio espone Weapon Combat, Motion Repair e Seamless Chain", () => {
  assert.match(html, /value="weaponCombatH3"/);
  assert.match(html, /id="weaponCombatStrength"[\s\S]*value="0\.8"/);
  assert.match(html, /id="actionH3MotionRepair"[\s\S]*bunny_crisp_motion/);
  assert.match(html, /value="h3SeamlessChain"/);
  assert.match(html, /id="h3ChainPrompt"/);
  assert.match(script, /H3 Seamless Chain richiede da 2 a 8 prompt/);
});

test("Video Studio espone i tre prompt LTX nei cinque pannelli richiesti", () => {
  assert.doesNotMatch(html, /IA \+ Genera/);
  for (const mode of expectedModes) {
    const groupMatch = html.match(new RegExp(`data-ltx-prompt-tools="${mode}"[\\s\\S]*?</div>`));
    assert.ok(groupMatch, `manca gruppo prompt ${mode}`);
    assert.match(groupMatch[0], /data-ltx-prompt="ltx_architect"[\s\S]*LTX Prompt/);
    assert.match(groupMatch[0], /data-ltx-prompt="ltx_scenes"[\s\S]*LTX Scene/);
    assert.match(groupMatch[0], /data-ltx-prompt="sulphur_prompt"[\s\S]*LTX Sulphur/);
  }
});

test("i prompt LTX del Video Studio usano textarea locali e non avviano generazione", () => {
  for (const mode of expectedModes) {
    assert.match(script, new RegExp(`${mode}: \\{[\\s\\S]*?input: \\$\\("#(?:actorPrompt|interactivePrompt|sceneTransformPrompt|retakePrompt|extendPrompt)"\\)`));
  }
  assert.match(script, /target,\s*\n\s*promptPreset: config\.promptPreset\?\.\(\) \|\| "",\s*\n\s*duration: config\.duration\?\.\(\) \|\| "",\s*\n\s*mode: config\.mode\(\),/);
  assert.match(script, /text: config\.promptPreset \? config\.input\.value : config\.text\?\.\(selectedPromptTriggers\)/);
  assert.match(script, /buttonScope: tools/);
  assert.doesNotMatch(script, /requestSubmit\(\)/);
});

test("Video Studio espone Storia continua con planner, editor e API dedicate", () => {
  assert.match(html, /value="sequentialStory"/);
  assert.match(html, /Descrizione storia/);
  assert.match(html, /Genera scaletta/);
  assert.match(html, /Avvia sequenza/);
  assert.match(html, /Modalità iniziale/);
  assert.match(html, /Immagine → Video/);
  assert.match(html, /sequentialInitialImage/);
  assert.match(html, /Best-frame selector/);
  assert.match(html, /Anchor frame/);
  assert.match(html, /Identity verification/);
  assert.match(html, /Pause|Pausa|pausa/i);
  assert.match(script, /\/api\/video-studio\/sequential-story\/plan/);
  assert.match(script, /\/api\/video-studio\/sequential-story/);
  assert.match(script, /FormData/);
  assert.match(script, /initialImage/);
  assert.match(script, /data-scene-regenerate/);
  assert.match(script, /data-sequential-scene-retry/);
  assert.match(script, /Annulla la sequenza prima di eliminarla/);
  assert.match(script, /data-sequential-action="delete"/);
  assert.match(script, /data-sequential-action="cancel"/);
});

test("il pannello progetti Video Studio ha azioni di pulizia e render stabile", () => {
  assert.match(script, /projectsRenderKey/);
  assert.match(script, /data-video-project-archive/);
  assert.match(script, /data-video-project-delete/);
  assert.match(script, /Annulla prima le generazioni attive/);
  assert.match(script, /video-project-card-actions/);
  assert.match(script, /\/api\/video-studio\/projects\/\$\{projectId\}\/archive/);
  assert.match(script, /\/api\/video-studio\/projects\/\$\{projectId\}\?files=1/);
  assert.match(script, /Elimina progetto e file collegati/);
  assert.match(styles, /video-project-card-actions/);
});

test("Interactive Cast mostra task package per segmenti AI mancanti", () => {
  assert.match(html, /interactive-cast-workspace-nav/);
  assert.match(html, /data-interactive-cast-view="config"/);
  assert.match(html, /data-interactive-cast-view="production"/);
  assert.match(html, /interactive-cast-active-project/);
  assert.match(script, /setInteractiveCastView\("production"/);
  assert.match(script, /interactiveCastActiveProjectId/);
  assert.match(script, /JSON\.stringify\(nextProjects\) !== JSON\.stringify\(state\.interactiveCastProjects\)/);
  assert.match(styles, /cast-view-production \.video-studio-form/);
  assert.match(styles, /cast-view-production \.studio-projects-panel/);
  assert.match(html, /interactiveCastTemporaryReference/);
  assert.match(html, /Reference temporanea nuovo attore/);
  assert.match(html, /interactiveCastAnchorWorkflow/);
  assert.match(html, /Qwen Image Edit/);
  assert.match(html, /Qwen\/Krea\/Klein/);
  assert.match(html, /Krea Triple/);
  assert.match(script, /taskForSegment/);
  assert.match(script, /temporaryActorReference/);
  assert.match(script, /anchorWorkflowId/);
  assert.match(script, /anchorRequirement/);
  assert.match(script, /cast-mode/);
  assert.match(script, /Personaggio/);
  assert.match(script, /Da \(sec\)/);
  assert.match(script, /A \(sec\)/);
  assert.match(script, /Battuta esatta/);
  assert.match(script, /Azione visiva/);
  assert.match(script, /Reazione/);
  assert.match(script, /Modalità/);
  assert.match(script, /lipSyncOnly/);
  assert.match(script, /composite/);
  assert.match(script, /data-interactive-cast-actors/);
  assert.match(script, /collectInteractiveCastActors/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/actors/);
  assert.match(script, /interactive-cast-stages/);
  assert.match(script, /stage-\$\{escapeHtml\(info\.status/);
  assert.match(script, /Speaker diarization/);
  assert.match(script, /data-interactive-cast-speakers/);
  assert.match(script, /collectInteractiveCastSpeakers/);
  assert.match(script, /data-interactive-cast-speaker-add/);
  assert.match(script, /data-interactive-cast-speaker-remove/);
  assert.match(script, /addInteractiveCastSpeaker/);
  assert.match(script, /removeInteractiveCastSpeaker/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/speakers/);
  assert.match(script, /\/asset\?path=/);
  assert.match(script, /interactive-cast-task-anchor/);
  assert.match(script, /Anchor workflow/);
  assert.match(script, /Prompt segmento/);
  assert.match(script, /Prompt per ChatGPT Image/);
  assert.match(script, /interactiveCastChatGptAnchorPrompt/);
  assert.match(script, /data-interactive-cast-copy-anchor-prompt/);
  assert.match(script, /Identity check anchor/);
  assert.match(script, /Negative prompt/);
  assert.match(script, /Reference nuovo attore/);
  assert.match(script, /actorReferences/);
  assert.match(script, /referenceRequirement/);
  assert.match(script, /outputRequirement/);
  assert.match(script, /data-cast-replacement-file/);
  assert.match(script, /data-interactive-cast-generate/);
  assert.match(script, /interactiveCastProductionGuide/);
  assert.match(script, /ASSISTENTE PRODUZIONE/);
  assert.match(script, /data-interactive-cast-guide-config/);
  assert.match(script, /Dopo l'anchor/);
  assert.match(styles, /interactive-cast-production-guide/);
  assert.match(script, /generateInteractiveCastSegment/);
  assert.match(script, /Anteprima rapida/);
  assert.match(script, /Risoluzione LTX/);
  assert.match(script, /createAdaptivePoller/);
  assert.match(script, /refreshInteractiveCastProjects\(\)/);
  assert.match(server, /segments\/:segmentId\/generate/);
  assert.match(server, /startInteractiveCastSegmentGeneration/);
  assert.match(server, /queueInteractiveCastAnchorRefine/);
  assert.match(server, /queueInteractiveCastLtxSegment/);
  assert.match(server, /advanceInteractiveCastGeneration/);
  assert.match(script, /interactive-cast-audio-tasks/);
  assert.match(script, /Audio stems fallback/);
  assert.match(script, /audioAnalysis\.stems/);
  assert.match(script, /data-cast-dialogue-audio-file/);
  assert.match(script, /data-interactive-cast-dialogue-synthesize/);
  assert.match(script, /synthesizeInteractiveCastDialogue/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/dialogue\/\$\{eventId\}\/synthesize/);
  assert.match(script, /Lip-sync tasks/);
  assert.match(script, /lipSyncTasks/);
  assert.match(script, /sourceClipRelativePath/);
  assert.match(script, /dialogueAudioRelativePath/);
  assert.match(script, /data-interactive-cast-lipsync/);
  assert.match(script, /applyInteractiveCastLipSync/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/segments\/\$\{segmentId\}\/lipsync/);
  assert.match(script, /data-interactive-cast-identity/);
  assert.match(script, /runInteractiveCastIdentityCheck/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/segments\/\$\{segmentId\}\/identity-check/);
  assert.match(script, /data-interactive-cast-audio-remix/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/dialogue\/\$\{eventId\}\/audio/);
  assert.match(script, /\/api\/interactive-cast\/projects\/\$\{projectId\}\/audio-remix/);
  assert.match(html, /interactive-cast-capabilities/);
  assert.match(html, /Capability matrix/);
  assert.match(script, /renderInteractiveCastCapabilities/);
  assert.match(script, /refreshInteractiveCastCapabilities/);
  assert.match(script, /\/api\/interactive-cast\/capabilities/);
  assert.match(script, /Voice cloning/);
  assert.match(script, /Lip-sync/);
  assert.match(script, /NOT CONFIGURED/);
  assert.match(styles, /cast-capability\.fallback/);
  assert.match(styles, /interactive-cast-event/);
  assert.match(styles, /grid-template-columns: 28px repeat\(12, minmax\(0, 1fr\)\) 34px/);
  assert.match(styles, /cast-event-dialogue \{ grid-column: 2 \/ 8; grid-row: 2; \}/);
  assert.match(styles, /interactive-cast-event \.cast-event-remove/);
  assert.match(styles, /interactive-cast-actor-reference/);
});

test("la guida pubblica documenta il processo completo Interactive Cast", () => {
  assert.match(guides, /id: "videoInteractiveCast"/);
  assert.match(guides, /Qwen Image Edit 2511 BF16/);
  assert.match(guides, /Audio nativo LTX/);
  assert.match(guides, /Analizza video e crea piano/);
  assert.match(guides, /Prepara segmenti/);
  assert.match(guides, /Genera automaticamente/);
  assert.match(guides, /Ricomponi MP4 finale/);
});

test("enhanceMainPrompt puo limitare loading e disabled al gruppo corrente", () => {
  assert.match(assistant, /buttonScope = null/);
  assert.match(assistant, /\(buttonScope \|\| document\)\.querySelectorAll\("\.prompt-assistant-button"\)/);
});

test("Interactive Scene e Scene Transform espongono il preflight senza pulsanti morti", () => {
  assert.match(script, /capabilityBlockDetail/);
  assert.match(script, /nodi ComfyUI mancanti/);
  assert.match(script, /state\.readiness = \{ ready, title, detail \}/);
  assert.match(script, /submit\.disabled = false/);
  assert.match(script, /if \(!readiness\.ready\)/);
  assert.match(script, /showToast\(message\)/);
});
