import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la guida Interactive Cast prepara clip, identita, timeline e handoff senza generare", async () => {
  const page = await source("public/interactive-cast-guided.html");
  const script = await source("public/interactive-cast-guided.js");
  assert.match(page, /Regia Interactive Cast/);
  assert.match(page, /interactive-cast-guided\.js/);
  assert.match(script, /saveGuidedHandoff/);
  assert.match(script, /interactiveCastSourceVideo/);
  assert.match(script, /temporaryActorReference/);
  assert.match(script, /interactiveCastEvents/);
  assert.match(script, /interactiveCastAnchorWorkflow/);
  assert.match(script, /mode: "generative"/);
  assert.match(script, /source camera, timing, performances, dialogue, ambience and music unchanged/);
  assert.doesNotMatch(script, /\/api\/interactive-cast\/projects/);
});

test("Video Studio espone la guida e applica i campi Interactive Cast ricevuti", async () => {
  const page = await source("public/video-studio.html");
  const script = await source("public/video-studio.js");
  assert.match(page, /href="\/interactive-cast-guided\.html"/);
  assert.match(script, /fields\.interactiveCastNewActorName/);
  assert.match(script, /fields\.interactiveCastCharacterId/);
  assert.match(script, /fields\.interactiveCastEvents/);
});
