import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MAX_PROMPT_BATCH, parsePromptBatch, promptBatchSummary } from "../public/prompt-batch.js";

test("Elenco scene interpreta liste numerate e conserva prompt multilinea", () => {
  assert.deepEqual(parsePromptBatch(`
1. Una donna entra nella biblioteca.
Luce calda, campo medio.

2. L'uomo chiude la porta.
Camera alle sue spalle.
  `), [
    "Una donna entra nella biblioteca.\nLuce calda, campo medio.",
    "L'uomo chiude la porta.\nCamera alle sue spalle.",
  ]);
});

test("Elenco scene accetta separatori, righe e array JSON senza deduplicare", () => {
  assert.deepEqual(parsePromptBatch("primo prompt\n---\nsecondo\nprompt"), ["primo prompt", "secondo\nprompt"]);
  assert.deepEqual(parsePromptBatch("primo prompt\nsecondo prompt"), ["primo prompt", "secondo prompt"]);
  assert.deepEqual(parsePromptBatch('["stessa scena", "stessa scena"]'), ["stessa scena", "stessa scena"]);
});

test("Elenco scene segnala il limite prima dell'invio", () => {
  const summary = promptBatchSummary(Array.from({ length: MAX_PROMPT_BATCH + 1 }, (_, index) => `scena ${index}`).join("\n"), true);
  assert.equal(summary.count, MAX_PROMPT_BATCH + 1);
  assert.equal(summary.exceedsLimit, true);
});

test("Image Studio invia un solo upload e il server espande ogni prompt nello stesso workflow", () => {
  const html = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(html, /id="studioPromptMode"[\s\S]*Elenco scene · generazione automatica/);
  assert.match(client, /formData\.set\("promptBatch", JSON\.stringify\(prompts\)\)/);
  assert.match(server, /sceneBodies\.flatMap[\s\S]*buildStudioJobs\(body\.studioMode, body, uploaded, selectedLoras\)/);
  assert.match(server, /promptBatchItem: "true"[\s\S]*alternatives: "1"[\s\S]*animaOutputs: "1"/);
  assert.match(server, /batchSceneIndex[\s\S]*batchSceneCount/);
  assert.match(server, /generation\.batchPrompt \|\| project\.prompt/);
});
