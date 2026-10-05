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

test("Generazioni carica i media solo quando viene richiesta un'anteprima", () => {
  assert.match(script, /<video controls preload="none" playsinline data-preview-src="\/api\/media/);
  assert.match(script, /<audio controls preload="none" data-preview-src="\/api\/audio/);
  assert.match(script, /<img loading="lazy" decoding="async" data-preview-src="\/api\/image/);
  assert.doesNotMatch(script, /<(?:video|audio|img)\b[^>]*\ssrc=/);
  assert.match(script, /data-load-preview/);
  assert.match(script, /media\.src = media\.dataset\.previewSrc/);
});

test("Generazioni chiama stima ed esecuzione cleanup", () => {
  assert.match(script, /\/api\/generations\/cleanup\/estimate/);
  assert.match(script, /\/api\/generations\/cleanup\/run/);
  assert.match(html, /deleteFilesKeepRecords/);
  assert.match(html, /deleteFilesAndRecords/);
});

test("Krea Triple mostra soltanto il master 08_finale mantenendo il suo indice API", () => {
  assert.match(html, /generations\.js\?v=20261005-h3-downloads/);
  assert.match(script, /function displayImageEntries/);
  assert.match(script, /studio:kreaTriple/);
  assert.match(script, /08\[_-\]finale/);
  assert.match(script, /displayImages\.map\(\(\{ image, index \}\)/);
});
