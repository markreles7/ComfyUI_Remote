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
    "public/virtual-influencer.html",
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

test("Virtual Influencer espone generazione foto, review ed export", async () => {
  const page = await source("public/virtual-influencer.html");
  const script = await source("public/virtual-influencer.js");
  const server = await source("src/server.js");
  assert.match(page, /Generate Photo/);
  assert.match(page, /Review Queue & Export/);
  assert.match(script, /\/photos/);
  assert.match(script, /generated-assets/);
  assert.match(script, /Correggi|Rigenera|Confronta versioni/);
  assert.match(script, /compare-versions/);
  assert.match(server, /\/api\/virtual-influencer\/profiles\/:id\/photos/);
  assert.match(server, /\/generated-assets\/:assetId\/export/);
  assert.match(server, /generated-assets\/:assetId\/compare-versions/);
});

test("Virtual Influencer espone generazione video LTX", async () => {
  const page = await source("public/virtual-influencer.html");
  const script = await source("public/virtual-influencer.js");
  const server = await source("src/server.js");
  assert.match(page, /Generate Video/);
  assert.match(page, /Influencer Video LTX 2\.3/);
  assert.match(script, /\/videos/);
  assert.match(script, /<video controls muted playsinline/);
  assert.match(server, /\/api\/virtual-influencer\/profiles\/:id\/videos/);
  assert.match(server, /buildVideoPlan/);
});

test("Virtual Influencer espone librerie outfit/location e batch generation", async () => {
  const page = await source("public/virtual-influencer.html");
  const script = await source("public/virtual-influencer.js");
  const server = await source("src/server.js");
  assert.match(page, /Outfits & Locations/);
  assert.match(page, /Batch Generation/);
  assert.match(script, /\/outfits/);
  assert.match(script, /\/locations/);
  assert.match(script, /\/batches/);
  assert.match(server, /profiles\/:id\/outfits/);
  assert.match(server, /profiles\/:id\/locations/);
  assert.match(server, /profiles\/:id\/batches/);
});

test("Virtual Influencer espone contenuti, disclosure, voice e analytics", async () => {
  const page = await source("public/virtual-influencer.html");
  const script = await source("public/virtual-influencer.js");
  const server = await source("src/server.js");
  assert.match(page, /Caption Engine/);
  assert.match(page, /Disclosure & Voice/);
  assert.match(page, /Content Projects/);
  assert.match(page, /Analytics/);
  assert.match(page, /Importa CSV/);
  assert.match(script, /\/captions/);
  assert.match(script, /\/voice/);
  assert.match(script, /\/content-projects/);
  assert.match(script, /\/analytics/);
  assert.match(script, /import-csv/);
  assert.match(server, /profiles\/:id\/captions/);
  assert.match(server, /profiles\/:id\/voice/);
  assert.match(server, /content-projects\/:projectId\/analytics/);
  assert.match(server, /analytics\/import-csv/);
});

test("Virtual Influencer Milestone 6 espone settings, debug e golden UI sintetico", async () => {
  const page = await source("public/virtual-influencer.html");
  const script = await source("public/virtual-influencer.js");
  const server = await source("src/server.js");
  const store = await source("src/virtual-influencer/store.js");
  const fixture = JSON.parse(await source("test/fixtures/virtual-influencer-golden.json"));
  for (const section of fixture.requiredSections) {
    assert.match(page, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), section);
  }
  for (const action of fixture.requiredActions) {
    assert.match(page, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), action);
  }
  assert.match(script, /debug-report/);
  assert.match(script, /cache\/invalidate/);
  assert.match(server, /profiles\/:id\/debug-report/);
  assert.match(server, /profiles\/:id\/cache\/invalidate/);
  assert.match(store, /milestone: 6/);
});
