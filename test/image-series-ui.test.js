import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const influencerHtml = fs.readFileSync(new URL("../public/random-influencer.html", import.meta.url), "utf8");
const samePlaceHtml = fs.readFileSync(new URL("../public/same-place.html", import.meta.url), "utf8");
const seriesApp = fs.readFileSync(new URL("../public/image-series-page.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Genera non espone più i due generatori serie", () => {
  assert.doesNotMatch(html, /<details id="image-series-panel"/);
  assert.doesNotMatch(html, /<section id="image-series-results"/);
  assert.doesNotMatch(html, /legacy-image-series|imageSeriesMode|seriesCharacterLora/);
  assert.doesNotMatch(app, /imageSeriesMode|submitImageSeries|renderSeriesResults|selectSeriesAnchor/);
  assert.doesNotMatch(app, /Usa come Series Anchor/);
  assert.match(html, /href="\/random-influencer\.html"/);
  assert.match(html, /href="\/same-place\.html"/);
});

test("Random Influencer e Same Place sono pagine focalizzate separate", () => {
  assert.match(influencerHtml, /data-series-page="influencer"/);
  assert.match(samePlaceHtml, /data-series-page="samePlace"/);
  assert.match(influencerHtml, /id="series-app"/);
  assert.match(samePlaceHtml, /id="series-app"/);
  for (const id of ["seriesModelId", "seriesModelFile", "performancePreset", "seriesCount", "characterLora", "characterTrigger", "characterConsistency", "seriesGrid"]) {
    assert.match(seriesApp, new RegExp(`id=\\"${id}\\"`));
  }
  assert.match(seriesApp, /\[1, 2, 4, 6, 9\]/);
  assert.match(seriesApp, /\[2, 4, 6, 8\]/);
});

test("client crea job separati e supporta rigenerazione card e nuova anchor", () => {
  assert.match(seriesApp, /for \(const item of plan\.items\)/);
  assert.match(seriesApp, /data\.set\("batchSize", "1"\)/);
  assert.match(seriesApp, /data\.set\("prompt", item\.prompt\)/);
  assert.match(seriesApp, /data\.set\("seed", String\(item\.seed\)\)/);
  assert.match(seriesApp, /data\.set\("pulidReference", pulidReference, pulidReference\.name\)/);
  assert.match(seriesApp, /\/api\/image-series\/\$\{encodeURIComponent\(card\.dataset\.generationId\)\}\/regenerate/);
  assert.match(seriesApp, /same-place\.html\?anchorGenerationId=/);
});

test("server pianifica le serie, rileva PuLID da object_info e rigenera una sola card", () => {
  assert.match(server, /app\.post\("\/api\/image-series\/plan"/);
  assert.match(server, /detectImageSeriesCapabilities\(info\)/);
  assert.match(server, /request\.body\.pulidReferenceUpload = pulidUploaded/);
  assert.match(server, /app\.post\("\/api\/image-series\/:generationId\/regenerate"/);
  assert.match(server, /seriesSupersededBy/);
});

test("griglia risultati rispetta 2x2, 3x2 e 3x3", () => {
  assert.match(styles, /count-4[^}]*repeat\(2/);
  assert.match(styles, /count-6[^}]*repeat\(3/);
  assert.match(styles, /count-9[^}]*repeat\(3/);
});
