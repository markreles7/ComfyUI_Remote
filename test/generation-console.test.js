import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = (relativePath) => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("la console di avanzamento è disponibile nelle pagine operative", () => {
  const pages = [
    "public/index.html",
    "public/studio.html",
    "public/video-studio.html",
    "public/generations.html",
    "public/random-influencer.html",
    "public/same-place.html",
    "public/characters.html",
    "public/guided-create.html",
    "public/interactive-cast-guided.html",
  ];

  for (const page of pages) {
    assert.match(source(page), /generation-console\.js/, page);
  }
});

test("il pannello usa eventi live e mostra nodo, step, coda ed errori", () => {
  const client = source("public/generation-console.js");
  const styles = source("public/styles.css");

  assert.match(client, /new EventSource\("\/api\/events"\)/);
  assert.match(client, /\/api\/generation-progress\?limit=16/);
  assert.match(client, /generation\.currentNodeTitle/);
  assert.match(client, /generation\.progressValue/);
  assert.match(client, /generation\.queuePosition/);
  assert.match(client, /generation\.error/);
  assert.match(styles, /\.generation-console-toggle/);
  assert.match(styles, /\.generation-console-panel\.open/);
});

test("il server conserva la telemetria ComfyUI per ogni workflow", () => {
  const server = source("src/server.js");

  assert.match(server, /app\.get\("\/api\/generation-progress"/);
  assert.match(server, /function appendGenerationProgress/);
  assert.match(server, /"progress", "executing"/);
  assert.match(server, /currentNodeTitle/);
  assert.match(server, /nodeTitles: workflowNodeTitles\(workflow\)/);
  assert.match(server, /nodeTitles: workflowNodeTitles\(job\.workflow\)/);
});
