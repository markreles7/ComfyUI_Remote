import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("Genera sostituisce i pulsanti LTX con il Prompt Enhancer della famiglia immagine", () => {
  assert.match(app, /const imageUsable = usable && isImageGeneration\(\)/);
  assert.match(app, /const ltxUsable = usable && !isImageGeneration\(\) && !isDirector/);
  assert.match(app, /qwenEditButton\.classList\.toggle\("hidden", !\(qwenUsable \|\| qwenEditUsable\)\)/);
  assert.match(app, /kleinButton\.classList\.toggle\("hidden", !\(fluxUsable \|\| kreaUsable \|\| zImageUsable\)\)/);
  assert.match(app, /"✦ Flux Prompt"/);
  assert.match(app, /"✦ Krea Prompt"/);
  assert.match(app, /"✦ Z-Image Prompt"/);
  assert.match(app, /promptAssistantContext\(\)\.target === "qwen" \? "qwen" : "qwen_image_edit_architect"/);
});
