import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/video-studio.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");
const assistant = fs.readFileSync(new URL("../public/prompt-assistant.js", import.meta.url), "utf8");

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
  assert.match(html, /Best-frame selector/);
  assert.match(html, /Anchor frame/);
  assert.match(html, /Identity verification/);
  assert.match(html, /Pause|Pausa|pausa/i);
  assert.match(script, /\/api\/video-studio\/sequential-story\/plan/);
  assert.match(script, /\/api\/video-studio\/sequential-story/);
  assert.match(script, /data-scene-regenerate/);
  assert.match(script, /data-sequential-scene-retry/);
});

test("enhanceMainPrompt puo limitare loading e disabled al gruppo corrente", () => {
  assert.match(assistant, /buttonScope = null/);
  assert.match(assistant, /\(buttonScope \|\| document\)\.querySelectorAll\("\.prompt-assistant-button"\)/);
});
