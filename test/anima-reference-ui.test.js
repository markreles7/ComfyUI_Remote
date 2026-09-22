import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("Image Studio ANIMA espone personaggi multipli, reference sheet e ambiente", () => {
  assert.match(html, /id="animaInputMode"/);
  assert.match(html, /name="animaCharacter1"/);
  assert.match(html, /name="animaCharacter2"/);
  assert.match(html, /name="animaCharacter3"/);
  assert.match(html, /name="animaEnvironment"/);
  assert.match(html, /reference sheet/i);
  assert.match(html, /name="animaReferenceStrength"/);
});

test("client e server collegano gli slot ANIMA nell'ordine dichiarato", () => {
  assert.match(client, /updateAnimaInputMode/);
  assert.match(client, /anima-has-character-2/);
  assert.match(client, /anima-has-character-3/);
  assert.match(client, /anima-has-environment/);
  assert.match(server, /uploaded\.source = uploaded\.animaCharacter1 \|\| null/);
  assert.match(server, /uploaded\.references = \[uploaded\.animaCharacter2, uploaded\.animaCharacter3, uploaded\.animaEnvironment\]\.filter\(Boolean\)/);
});

test("ANIMA espone il selettore LoRA e non cancella più la selezione all'invio", () => {
  assert.match(client, /mode === "anima"[\s\S]*\["ANIMA"\]/);
  assert.doesNotMatch(client, /studioMode"\)\.value === "anima"\) formData\.set\("loras", "\[\]"\)/);
  assert.match(html, /Per ANIMA usa esclusivamente LoRA nella cartella ANIMA/);
});

test("ANIMA espone i profili FAST, BALANCED e MAX con sampler progressivi", () => {
  assert.match(html, /id="animaQuality"/);
  assert.match(html, /FAST · 1 sampler/);
  assert.match(html, /BALANCED · 2 sampler/);
  assert.match(html, /MAX · 3 sampler/);
  assert.match(html, /denoise progressivamente più basso/);
});

test("Migliora prompt non avvia automaticamente la generazione", () => {
  assert.match(html, /id="studio-prompt-assistant"[^>]*>✦ Migliora prompt</);
  assert.doesNotMatch(client, /promptAssistant\?\.autoGenerate[\s\S]{0,100}requestSubmit/);
  assert.match(client, /applyLoraTriggers\(\$\("#studio-prompt"\), triggers\)/);
});
