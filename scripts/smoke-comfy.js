import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { readImageDimensions } from "../src/media-files.js";

dotenv.config();
const comfyUrl = (process.env.COMFY_URL || "http://127.0.0.1:8188").replace(/\/$/, "");
const outputDirectory = path.resolve(process.env.OUTPUT_DIRECTORY || "");
const prefix = `Remote_refactor_smoke_${Date.now()}`;
const workflow = {
  1: {
    class_type: "EmptyImage",
    inputs: { width: 64, height: 64, batch_size: 1, color: 0 },
  },
  2: {
    class_type: "RemoteImageTensorNormalize",
    inputs: { image: ["1", 0] },
  },
  3: {
    class_type: "SaveImage",
    inputs: { images: ["2", 0], filename_prefix: prefix },
  },
};

const response = await fetch(`${comfyUrl}/prompt`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_id: "refactor-smoke", prompt: workflow }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`ComfyUI smoke test: HTTP ${response.status} ${await response.text()}`);
const queued = await response.json();
let entry = null;
for (let attempt = 0; attempt < 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const historyResponse = await fetch(`${comfyUrl}/history/${queued.prompt_id}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const history = await historyResponse.json();
  entry = history[queued.prompt_id];
  if (entry) break;
}
if (!entry) throw new Error("Il workflow diagnostico non è stato completato.");
const output = entry.outputs?.["3"]?.images?.[0];
if (!output?.filename) throw new Error("Il workflow diagnostico non ha prodotto il PNG.");
const filePath = path.resolve(outputDirectory, output.subfolder || "", output.filename);
if (!filePath.startsWith(`${outputDirectory}${path.sep}`)) {
  throw new Error("Il file diagnostico è fuori dalla directory output.");
}
const dimensions = readImageDimensions(filePath);
try {
  if (dimensions?.width !== 64 || dimensions?.height !== 64) {
    throw new Error(`Dimensioni diagnostiche errate: ${dimensions?.width}×${dimensions?.height}`);
  }
  console.log(`Smoke test ComfyUI riuscito: ${dimensions.width}×${dimensions.height}`);
  console.log(`Prompt: ${queued.prompt_id}`);
} finally {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
