import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("Genera contiene i pannelli completi Random Influencer e Same Place", () => {
  for (const id of [
    "imageSeriesMode", "seriesCharacterLora", "seriesLoraStrength", "seriesCharacterTrigger",
    "influencerCount", "influencerPromptMode", "influencerSeedMode", "characterConsistency",
    "pulidReference", "pulidStrength", "samePlaceModel", "samePlaceAnchor", "samePlaceCount",
    "samePlaceSeedMode", "sceneLock", "preserveLocation", "preserveOutfit", "preserveLighting",
    "preserveFraming", "variationStrength", "allowPoseChanges", "allowExpressionChanges",
    "allowSmallAngleChanges", "allowHandReposition", "allowGazeChanges", "image-series-grid",
  ]) assert.match(html, new RegExp(`id="${id}"`));
});

test("client crea job separati e supporta rigenerazione card e nuova anchor", () => {
  assert.match(app, /for \(const item of plan\.items\)/);
  assert.match(app, /data\.set\("batchSize", "1"\)/);
  assert.match(app, /data\.set\("prompt", item\.prompt\)/);
  assert.match(app, /data\.set\("seed", String\(item\.seed\)\)/);
  assert.match(app, /\/api\/image-series\/\$\{encodeURIComponent\(generationId\)\}\/regenerate/);
  assert.match(app, /data-use-series-anchor/);
  assert.match(app, /seriesAnchor\?\.url/);
});

test("server pianifica le serie, rileva PuLID da object_info e rigenera una sola card", () => {
  assert.match(server, /app\.post\("\/api\/image-series\/plan"/);
  assert.match(server, /detectImageSeriesCapabilities\(info\)/);
  assert.match(server, /app\.post\("\/api\/image-series\/:generationId\/regenerate"/);
  assert.match(server, /seriesSupersededBy/);
});

test("griglia risultati rispetta 2x2, 3x2 e 3x3", () => {
  assert.match(styles, /count-4[^}]*repeat\(2/);
  assert.match(styles, /count-6[^}]*repeat\(3/);
  assert.match(styles, /count-9[^}]*repeat\(3/);
});
