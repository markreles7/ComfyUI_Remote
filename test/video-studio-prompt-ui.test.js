import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/video-studio.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const assistant = fs.readFileSync(new URL("../public/prompt-assistant.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

const expectedModes = [
  "actorReplacement",
  "interactiveScene",
  "sceneTransform",
  "retake",
  "extend",
];

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
  assert.match(script, /target,\s*\n\s*mode: config\.mode\(\),/);
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
  assert.match(script, /Negative prompt/);
  assert.match(script, /Reference nuovo attore/);
  assert.match(script, /actorReferences/);
  assert.match(script, /referenceRequirement/);
  assert.match(script, /outputRequirement/);
  assert.match(script, /data-cast-replacement-file/);
  assert.match(script, /data-interactive-cast-generate/);
  assert.match(script, /generateInteractiveCastSegment/);
  assert.match(script, /Anteprima rapida/);
  assert.match(script, /Risoluzione LTX/);
  assert.match(script, /refreshInteractiveCastProjects, 3500/);
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

test("enhanceMainPrompt puo limitare loading e disabled al gruppo corrente", () => {
  assert.match(assistant, /buttonScope = null/);
  assert.match(assistant, /\(buttonScope \|\| document\)\.querySelectorAll\("\.prompt-assistant-button"\)/);
});
