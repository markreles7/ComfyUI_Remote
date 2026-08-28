import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("la Crea guidata è raggiungibile da tutte le schermate principali", async () => {
  const pages = [
    "public/index.html",
    "public/studio.html",
    "public/video-studio.html",
    "public/characters.html",
    "public/generations.html",
    "public/workflow-guide.html",
  ];
  for (const page of pages) {
    assert.match(await source(page), /href="\/guided-create\.html"/, page);
  }
});

test("la conversazione copre immagini, editing, animazione, video, storyboard e finishing", async () => {
  const script = await source("public/guided-create.js");
  for (const intent of ["photo", "edit", "animate", "video", "character", "finish"]) {
    assert.match(script, new RegExp(`id: "${intent}"`), intent);
  }
  for (const route of [
    "textImage", "multiPerson", "add", "replace", "imageVideo", "firstLast",
    "director", "textVideo", "videoEdit", "actorReplace", "actorAdd", "storyboard",
    "bible", "upscale", "temporal", "hdr",
    "sequentialStory",
    "minimaxH3",
    "actionH3",
  ]) {
    assert.match(script, new RegExp(`\\b${route}: \\{`), route);
  }
});

test("le guide contestuali aprono direttamente Editor, Director e tutti i workflow Video Studio richiesti", async () => {
  const guide = await source("public/guided-create.js");
  const studio = await source("public/studio.html");
  const studioScript = await source("public/studio.js");
  const video = await source("public/video-studio.html");
  const videoScript = await source("public/video-studio.js");
  const generate = await source("public/index.html");
  assert.match(guide, /DIRECT_WORKFLOWS/);
  for (const route of ["editorGuided", "storyboardDirector", "director", "actorReplacement", "interactiveScene", "sceneTransform", "retake", "extend", "hdr", "sequentialStory", "minimaxH3", "actionH3"]) {
    assert.match(guide, new RegExp(`${route}:`), route);
  }
  assert.match(studio, /studio-guided-workflow/);
  assert.match(studioScript, /storyboardDirector/);
  assert.match(video, /video-studio-guided-workflow/);
  assert.match(videoScript, /updateWorkflowGuideLink/);
  assert.match(generate, /guided-create\.html\?workflow=director/);
});

test("il prompt può essere italiano ottimizzato, inglese manuale o guidato", async () => {
  const script = await source("public/guided-create.js");
  assert.match(script, /id: "natural"/);
  assert.match(script, /id: "manual"/);
  assert.match(script, /id: "guided"/);
  assert.match(script, /qwen_image_edit_architect/);
  assert.match(script, /flux2_klein_architect/);
  assert.match(script, /\/api\/prompt-assistant\/director/);
});

test("l'handoff conserva file e configurazione senza avviare automaticamente una generazione", async () => {
  const handoff = await source("public/guided-handoff.js");
  const guide = await source("public/guided-create.js");
  assert.match(handoff, /indexedDB\.open/);
  assert.match(handoff, /DataTransfer/);
  assert.match(guide, /saveGuidedHandoff/);
  assert.doesNotMatch(guide, /generator-form.*submit|studio-form.*submit|video-studio-form.*submit/s);
  for (const receiver of ["public/app.js", "public/studio.js", "public/video-studio.js"]) {
    const code = await source(receiver);
    assert.match(code, /consumeGuidedHandoff/);
    assert.match(code, /setInputFile/);
  }
});

test("Director trasferisce continuità globale e ogni scena separatamente", async () => {
  const guide = await source("public/guided-create.js");
  const generator = await source("public/app.js");
  assert.match(guide, /directorSceneCount/);
  assert.match(guide, /directorScenes/);
  assert.match(guide, /globalPrompt/);
  assert.match(generator, /fields\.directorScenes/);
  assert.match(generator, /directorGlobalPrompt/);
  assert.match(generator, /\[data-scene-prompt\]/);
  assert.match(generator, /\[data-scene-duration\]/);
});

test("Character Library sostituisce la vecchia sezione con CRUD e reference pack", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  assert.match(page, /Character Library/);
  assert.match(page, /Virtual Actor/);
  assert.match(page, /Build Character Pack/);
  assert.match(page, /Generate Character Sheet/);
  assert.match(page, /Verifica identità/);
  assert.match(page, /characterSheetWorkflow/);
  assert.match(page, /Qwen\/Krea\/Klein/);
  assert.match(script, /generateSheet/);
  assert.match(script, /identityCheck/);
  assert.match(script, /\/api\/characters/);
  assert.match(script, /references/);
  assert.match(server, /\/api\/characters\/:id\/build-pack/);
  assert.match(server, /\/api\/characters\/:id\/generate-sheet/);
  assert.match(server, /runCharacterIdentityCheck/);
  assert.match(server, /identity-providers/);
  assert.match(server, /identity-review/);
  assert.ok(server.indexOf('/api/characters/identity-providers') < server.indexOf('/api/characters/:id"'));
  assert.match(script, /CHARACTER READINESS/);
  assert.doesNotMatch(server, /perceptual-ffmpeg-pgm|averageSimilarity|minSimilarity/);
  assert.match(server, /\/api\/characters\/import-legacy/);
  assert.doesNotMatch(server, /\/api\/virtual-influencer/);
});

test("Character Studio guida description/photo, candidate Hero e dettagli avanzati", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  assert.match(page, /Cosa vuoi fare\?/);
  assert.match(page, /Crea un nuovo Character/);
  assert.match(page, /Usa un Character esistente/);
  assert.match(page, /Dettagli avanzati \/ Advanced/);
  assert.match(page, /subjectKind/);
  assert.match(script, /Da una descrizione/);
  assert.match(script, /Da una foto/);
  assert.match(script, /Genera 4 candidate Hero/);
  assert.match(script, /Usa come Hero/);
  assert.match(script, /\/api\/characters\/genesis/);
  assert.match(script, /genesis-candidates/);
  assert.match(script, /select-hero/);
  assert.match(server, /createCharacterGenesis/);
  assert.match(server, /KreaTriple_T2I_API\.json/);
  assert.match(server, /characterGenesisCandidate/);
});

test("Adaptive Reference Factory espone piano, recovery e decisioni guidate", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  const factory = await source("src/character-reference-factory.js");
  assert.match(page, /Completiamo le reference/);
  assert.match(page, /Genera mancanti/);
  assert.match(script, /data-reference-approve/);
  assert.match(script, /data-reference-regenerate/);
  assert.match(script, /data-reference-reject/);
  assert.match(script, /reference-factory-progress/);
  assert.match(server, /reference-plan\/generate-missing/);
  assert.match(server, /reference-config/);
  assert.match(page, /id="referenceEngine"/);
  assert.match(script, /body: JSON\.stringify\(\{ engine: selectedReferenceEngine\(\) \}\)/);
  assert.match(script, /action === "regenerate" \? \{ engine: selectedReferenceEngine\(\) \}/);
  assert.match(server, /preferredEngine: requestedWorkflow\.engineId/);
  assert.match(server, /engineChanged/);
  assert.match(server, /reference-plan\/:role\/approve/);
  assert.match(server, /reference-plan\/:role\/reject/);
  assert.match(server, /reference-plan\/:role\/regenerate/);
  assert.match(factory, /generationPurpose: "character_reference"/);
  assert.match(server, /buildCharacterReferenceJob/);
  assert.doesNotMatch(script, /name="technicalPrompt"/);
});

test("Generate, Image Studio e Video Studio inviano il selector Character Library", async () => {
  const generate = await source("public/index.html");
  const generateScript = await source("public/app.js");
  const studio = await source("public/studio.html");
  const studioScript = await source("public/studio.js");
  const video = await source("public/video-studio.html");
  const videoScript = await source("public/video-studio.js");
  for (const page of [generate, studio, video]) {
    assert.match(page, /name="characterId"/);
    assert.match(page, /name="identityStrength"/);
    assert.match(page, /name="lockFace"/);
    assert.match(page, /name="lockHair"/);
    assert.match(page, /name="lockBody"/);
    assert.match(page, /name="lockOutfit"/);
  }
  for (const script of [generateScript, studioScript, videoScript]) {
    assert.match(script, /state\.config\.characters\?\.availableCharacters/);
    assert.doesNotMatch(script, /virtualInfluencer/);
  }
});

test("Create Photo guida scena, conferma, selector dinamico e History completa", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  const architect = await source("src/character-photo.js");
  const assistant = await source("src/lm-studio-client.js");
  assert.match(page, /CREA FOTO/);
  assert.match(page, /Dove vuoi ambientarlo\?/);
  assert.match(page, /Cosa sta facendo\?/);
  assert.match(page, /Che atmosfera vuoi\?/);
  assert.match(page, /Sorprendimi/);
  assert.match(page, /Genera/);
  assert.match(page, /Cambia idea/);
  assert.match(page, /Prompt tecnico generato/);
  assert.match(page, /character-photo-advanced/);
  assert.doesNotMatch(page, /focal length|lighting setup|camera prompt|preservation prompt/i);
  assert.match(script, /photo-plan/);
  assert.match(script, /create-photo/);
  assert.match(script, /ComfyUI non è ancora stato chiamato/);
  assert.match(server, /selectCharacterPhotoReferences/);
  assert.match(architect, /generationPurpose: "character_photo"/);
  for (const field of ["characterId", "sceneBlueprint", "selectedReferenceIds", "referenceSelectionReason", "technicalPrompt", "model", "seed", "output"]) {
    assert.match(server, new RegExp(`${field}[,:]`));
  }
  assert.match(architect, /qwenEdit[\s\S]*maxReferences: 3/);
  assert.match(assistant, /planCharacterPhoto/);
});

test("Character Photo Set limita i motori a Qwen 2511 e PornMaster v4 Turbo/Base senza training", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const influencerCatalog = await source("public/influencer-photo-prompts.md");
  const influencerPrompts = [...influencerCatalog.matchAll(/^\s*(\d{1,3})\.\s+(.+)$/gm)];
  assert.match(page, /Crea un set fotografico coerente/);
  assert.match(page, /Qwen Image Edit 2511/);
  assert.match(page, /PornMaster Flux2 Klein v4Turbo/);
  assert.match(page, /PornMaster Flux2 Klein v4 Base BF16/);
  assert.match(page, /nessun training LoRA/i);
  assert.match(script, /PHOTO_SET_SCENES/);
  assert.match(script, /influencer-photo-prompts\.md/);
  assert.match(script, /Catalogo Influencer incompleto/);
  assert.match(page, /id="prepare-photo-set-button"/);
  assert.match(page, /id="photo-set-prompt-preview"/);
  assert.match(script, /async function prepareCharacterPhotoSet/);
  assert.match(script, /state\.photoSetPreparation/);
  assert.match(script, /LM Studio non viene richiamato/);
  assert.match(script, /for \(let index = prepared\.nextIndex; index < prepared\.plans\.length/);
  assert.equal(influencerPrompts.length, 100);
  assert.equal(Number(influencerPrompts[0][1]), 1);
  assert.equal(Number(influencerPrompts.at(-1)[1]), 100);
  assert.match(influencerCatalog, /Use the provided reference image as the identity reference for the same woman\./);
  assert.match(script, /approve-reference/);
  assert.doesNotMatch(script, /train(?:ing)?[-_ ]lora/i);
});

test("Create Photo espone la Character Master Pipeline automatica con preset e intermedi Advanced", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  const pipeline = await source("src/character-master-pipeline.js");
  for (const preset of ["fast", "balanced", "max"]) assert.match(page, new RegExp(`value="${preset}"`));
  for (const label of ["Scene Draft", "Krea Refined", "Klein Refined", "Master"]) assert.match(pipeline, new RegExp(label));
  for (const status of ["requested", "running", "completed", "failed", "skipped"]) assert.match(pipeline, new RegExp(status));
  assert.match(page, /photoStageKrea/);
  assert.match(page, /photoStageKlein/);
  assert.match(page, /photoStageSeedvr2/);
  assert.match(script, /renderCharacterMasterPipeline/);
  assert.match(script, /character-master-intermediates/);
  assert.match(script, /qualityPreset/);
  assert.match(server, /gpuResourceManager\.run\(`character-master-/);
  assert.match(server, /buildUpscaleWorkflow/);
  assert.match(server, /SEEDVR2_PROFILES\.balanced\.model/);
  assert.match(server, /upscaleAutoPurge: false/);
  assert.match(server, /planCharacterPhotoStage/);
  assert.match(server, /characterMasterIdentityValidation/);
  assert.match(server, /pipelineRootGenerationId/);
  assert.match(server, /lastValidGenerationId/);
  assert.match(server, /execution_error[\s\S]*continueCharacterMasterPipeline\(updated\)/);
});

test("Character Studio espone Create Video guidato, Anchor reale, Auto Router e History completa", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  const router = await source("src/character-video.js");
  const adapters = await source("src/character-adapters.js");
  assert.match(page, /CREA VIDEO/);
  for (const label of ["1. Da quale immagine partiamo", "2. Cosa deve fare il Character", "3. Come vuoi il video", "4. Deve parlare", "5. Qualità", "6. Anteprima Anchor", "7. Genera"]) assert.match(page, new RegExp(label.replace("?", "\\?")));
  for (const sourceMode of ["auto", "hero", "generated", "upload"]) assert.match(page, new RegExp(`value="${sourceMode}"`));
  for (const style of ["natural", "selfie", "cinematic", "dynamic", "automatic"]) assert.match(page, new RegExp(`value="${style}"`));
  assert.match(page, /character-video-advanced/);
  assert.match(script, /video-config/);
  assert.match(script, /video-plan/);
  assert.match(script, /anchor-frame/);
  assert.match(script, /create-video/);
  assert.match(script, /pollVideoAnchor/);
  assert.match(server, /promptAssistant\.planCharacterVideo/);
  assert.match(server, /buildImageWorkflow\(workflow\.id/);
  assert.match(server, /buildWorkflow\(route\.workflowId/);
  assert.match(server, /characterVideoHistoryMetadata/);
  assert.match(adapters, /status: "ready"/);
  assert.doesNotMatch(adapters, /Anchor frame automatico non configurato/);
  for (const capability of ["imageToVideo", "textToVideo", "dialogue", "nativeAudio", "externalAudio", "firstLastFrame", "referenceCharacter", "longDuration", "videoToVideo"]) assert.match(router, new RegExp(capability));
  assert.match(router, /Nessun workflow LTX 2\.5 è integrato/);
  assert.match(router, /workflow MiniMax H3 non è compatibile/);
  for (const field of ["characterId", "videoBlueprint", "anchorGenerationId", "anchorImage", "videoEngine", "workflow", "motionPrompt", "output"]) assert.match(router, new RegExp(`${field}[,:]`));
});

test("Goal 7 espone Talking Character, refine conservativo, profilo e media con tecnica solo Advanced", async () => {
  const page = await source("public/characters.html");
  const script = await source("public/characters.js");
  const server = await source("src/server.js");
  const pipeline = await source("src/character-video-pipeline.js");
  const router = await source("src/character-video.js");
  for (const mode of ["externalTts", "existing", "native", "none"]) assert.match(server, new RegExp(mode));
  for (const capability of ["supportsNativeAudio", "supportsDialogue", "supportsAudioConditioning", "supportsLipSync", "supportsExternalAudio"]) assert.match(router, new RegExp(capability));
  for (const label of ["Naturale", "Allegro", "Calmo", "Serio", "Emozionato", "Altro", "Originale", "Migliorato", "Qualità"]) assert.match(page, new RegExp(label));
  for (const stage of ["Video Anchor", "Dialogue / Audio", "Raw Video", "Talking Performance", "Video Refine", "Master Video"]) assert.match(pipeline, new RegExp(stage.replace("/", "\\/")));
  assert.match(page, /<details class="character-video-advanced">[\s\S]*characterVideoScenePrompt[\s\S]*characterVideoMotionPrompt[\s\S]*characterVideoAudioPrompt[\s\S]*characterVideoDialogueInstructions[\s\S]*characterVideoEmotionInstructions[\s\S]*<\/details>/);
  assert.match(script, /pollCharacterVideoPipeline/);
  assert.match(server, /applyLipSync/);
  assert.match(server, /buildSeedvr2VideoUpscaleWorkflow/);
  assert.match(server, /\/api\/characters\/:id\/media/);
  assert.match(page, /Completa Reference/);
  assert.match(page, /Foto generate/);
  assert.match(page, /Video generati/);
});
