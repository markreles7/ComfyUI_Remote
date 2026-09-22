import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const html = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("Image Studio espone gli ingressi distinti di DUO SCENE", () => {
  assert.match(html, /id="duo-scene-section"/);
  assert.match(html, /name="duoMale"/);
  assert.match(html, /name="duoFemale"/);
  assert.match(html, /name="duoEnvironment"/);
  assert.match(html, /name="duoStyle"/);
  assert.match(html, /4x-AnimeSharp/);
});

test("client e server collegano formato, presenza degli slot e ordine delle reference", () => {
  assert.match(client, /applyDuoAspectRatio/);
  assert.match(client, /duo-has-environment/);
  assert.match(client, /duo-has-style/);
  assert.match(server, /uploaded\.references = \[uploaded\.duoFemale, uploaded\.duoEnvironment, uploaded\.duoStyle\]\.filter\(Boolean\)/);
  assert.match(server, /request\.body\.studioMode === "duoScene" \? null : await uploadCharacterSelection/);
  assert.match(server, /project\.studioMode === "duoScene"[\s\S]*project\.uploads\?\.source[\s\S]*slice\(0, 3\)/);
});
