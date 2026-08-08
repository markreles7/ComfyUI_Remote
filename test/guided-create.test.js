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
  ]) {
    assert.match(script, new RegExp(`\\b${route}: \\{`), route);
  }
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
  assert.match(page, /Identity Check/);
  assert.match(page, /characterSheetWorkflow/);
  assert.match(page, /Qwen\/Krea\/Klein/);
  assert.match(script, /generateSheet/);
  assert.match(script, /identityCheck/);
  assert.match(script, /\/api\/characters/);
  assert.match(script, /references/);
  assert.match(server, /\/api\/characters\/:id\/build-pack/);
  assert.match(server, /\/api\/characters\/:id\/generate-sheet/);
  assert.match(server, /runCharacterIdentityCheck/);
  assert.match(server, /\/api\/characters\/import-legacy/);
  assert.doesNotMatch(server, /\/api\/virtual-influencer/);
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
