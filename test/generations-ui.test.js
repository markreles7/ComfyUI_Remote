import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/generations.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/generations.js", import.meta.url), "utf8");

test("Generazioni espone filtri server-side e pulizia guidata", () => {
  assert.match(html, /history-date-from/);
  assert.match(html, /history-date-to/);
  assert.match(html, /history-media-type/);
  assert.match(html, /cleanup-panel/);
  assert.match(html, /Pulizia guidata/);
  assert.match(html, /Stima spazio/);
});

test("Generazioni usa paginazione backend e Carica altri", () => {
  assert.match(script, /pageSize:\s*50/);
  assert.match(script, /paged:\s*"1"/);
  assert.match(script, /limit:\s*String\(state\.pageSize\)/);
  assert.match(script, /loadHistory\(\{ append: true \}\)/);
});

test("Generazioni carica video solo al click", () => {
  assert.match(script, /data-lazy-video/);
  assert.match(script, /data-load-video/);
  assert.match(script, /document\.createElement\("video"\)/);
  assert.doesNotMatch(script, /<video controls preload="metadata" playsinline src="\/api\/media/);
});

test("Generazioni chiama stima ed esecuzione cleanup", () => {
  assert.match(script, /\/api\/generations\/cleanup\/estimate/);
  assert.match(script, /\/api\/generations\/cleanup\/run/);
  assert.match(html, /deleteFilesKeepRecords/);
  assert.match(html, /deleteFilesAndRecords/);
});
