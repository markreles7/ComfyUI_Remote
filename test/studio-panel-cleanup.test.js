import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { compactFormData } from "../public/form-data-utils.js";

test("Image Studio elimina dal multipart gli input file vuoti", () => {
  const original = new FormData();
  original.append("prompt", "Una scena anime");
  original.append("unusedUpload", new File([], "", { type: "application/octet-stream" }));
  original.append("reference1", new File(["image"], "reference.png", { type: "image/png" }));

  const compact = compactFormData(original);

  assert.equal(compact.get("prompt"), "Una scena anime");
  assert.equal(compact.has("unusedUpload"), false);
  assert.equal(compact.get("reference1").name, "reference.png");
});

test("Image Studio espone pulizia persistente e archiviazione senza cancellazione file", () => {
  const html = fs.readFileSync(new URL("../public/studio.html", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

  assert.match(html, /id="studio-archive-completed"[\s\S]*id="studio-clear-projects"/);
  assert.match(client, /compactFormData\(new FormData\(event\.currentTarget\)\)/);
  assert.match(client, /\/api\/studio\/projects\/cleanup/);
  assert.match(server, /app\.post\("\/api\/studio\/projects\/cleanup"/);
  assert.match(server, /studioStore\.deleteMany/);
  assert.doesNotMatch(server.match(/app\.post\("\/api\/studio\/projects\/cleanup"[\s\S]*?\n\}\);/)?.[0] || "", /removeGeneratedMediaFiles/);
});
