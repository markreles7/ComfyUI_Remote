import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflow } from "../src/workflow-validator.js";

const definitions = {
  LoadImage: {
    input: { required: { image: ["STRING", { image_upload: true }] } },
    output: ["IMAGE"],
  },
  SeedVR2VideoUpscaler: {
    input: { required: { image: ["IMAGE"] } },
    output: ["IMAGE"],
  },
  RemoteImageTensorNormalize: {
    input: { required: { image: ["IMAGE"] } },
    output: ["IMAGE"],
  },
  SaveImage: {
    input: { required: { images: ["IMAGE"], filename_prefix: ["STRING"] } },
    output: ["IMAGE"],
    output_node: true,
  },
  "Restore Face (mtb)": {
    input: { required: { image: ["IMAGE"] } },
    output: ["IMAGE"],
  },
};

test("accetta una pipeline SeedVR2 normalizzata", () => {
  const workflow = {
    1: { class_type: "LoadImage", inputs: { image: "input.png" } },
    2: { class_type: "SeedVR2VideoUpscaler", inputs: { image: ["1", 0] } },
    3: { class_type: "RemoteImageTensorNormalize", inputs: { image: ["2", 0] } },
    4: { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "result" } },
  };
  assert.deepEqual(validateWorkflow(workflow, definitions), []);
});

test("rifiuta output SeedVR2 senza normalizzazione e collegamenti inesistenti", () => {
  const workflow = {
    1: { class_type: "SeedVR2VideoUpscaler", inputs: { image: ["404", 0] } },
    2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "result" } },
  };
  const issues = validateWorkflow(workflow, definitions);
  assert.ok(issues.some((issue) => issue.includes("nodo inesistente 404")));
  assert.ok(issues.some((issue) => issue.includes("senza normalizzazione")));
});

test("blocca Restore Face MTB perché noto per corrompere il layout", () => {
  const workflow = {
    1: { class_type: "LoadImage", inputs: { image: "input.png" } },
    2: { class_type: "Restore Face (mtb)", inputs: { image: ["1", 0] } },
    3: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "result" } },
  };
  const issues = validateWorkflow(workflow, definitions);
  assert.ok(issues.some((issue) => issue.includes("3 px")));
});
