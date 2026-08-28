import test from "node:test";
import assert from "node:assert/strict";

import {
  buildImageWorkflow,
  imageModelConfig,
  imageModelSelection,
} from "../src/image-workflows.js";

const MODEL = "mage_flow_bf16.safetensors";
const EDIT_MODEL = "mage_flow_edit_bf16.safetensors";
const CLIP = "qwen3vl_4b_bf16.safetensors";
const VAE = "mage_flow_vae_bf16.safetensors";

test("Mage-Flow BF16 is detected only when every required component is installed", () => {
  const [available] = imageModelConfig([MODEL], { clips: [CLIP], vaes: [VAE] })
    .filter((item) => item.id === "mageFlow");
  assert.equal(available.available, true);
  assert.deepEqual(available.missingRequirements, []);

  const [missingClip] = imageModelConfig([MODEL], { clips: [], vaes: [VAE] })
    .filter((item) => item.id === "mageFlow");
  assert.equal(missingClip.available, false);
  assert.deepEqual(missingClip.missingRequirements, [`CLIP: ${CLIP}`]);
});

test("Mage-Flow BF16 builds the native ComfyUI text-to-image graph", () => {
  const result = buildImageWorkflow("mageFlow", {
    imageModelFile: MODEL,
    imageMode: "text",
    imageResolution: "square",
    prompt: "A red fox in a snowy forest",
    negativePrompt: "blurry",
    imageSteps: 20,
    imageGuidance: 5,
    batchSize: 1,
    seed: 123,
  });

  assert.equal(result.workflow["1"].class_type, "UNETLoader");
  assert.equal(result.workflow["1"].inputs.unet_name, MODEL);
  assert.deepEqual(result.workflow["2"].inputs, {
    clip_name: CLIP,
    type: "mage",
    device: "default",
  });
  assert.equal(result.workflow["3"].inputs.vae_name, VAE);
  assert.equal(result.workflow["5"].class_type, "TextEncodeMageFlowEdit");
  assert.deepEqual(result.workflow["5"].inputs.images, {});
  assert.equal(result.workflow["5"].inputs.width, 1024);
  assert.deepEqual(result.workflow["8"].inputs.latent_image, ["5", 2]);
  assert.equal(result.workflow["8"].inputs.steps, 20);
  assert.equal(result.workflow["8"].inputs.cfg, 5);
  assert.equal(result.metadata.imageModelFamily, "mageFlow");
});

test("Mage-Flow rejects edit mode and unrelated Mage checkpoints", () => {
  assert.throws(
    () => imageModelSelection("mageFlow", "mage_flow_edit_bf16.safetensors"),
    /non è compatibile/,
  );
  assert.throws(
    () => buildImageWorkflow("mageFlow", {
      imageModelFile: MODEL,
      imageMode: "image",
      prompt: "edit",
    }, { name: "source.png", subfolder: "" }),
    /Modalità non supportata/,
  );
});

test("Mage-Flow Edit BF16 is exposed separately and builds native instruction editing", () => {
  const edit = imageModelConfig([MODEL, EDIT_MODEL], { clips: [CLIP], vaes: [VAE] })
    .find((item) => item.id === "mageFlowEdit");
  assert.equal(edit.available, true);
  assert.deepEqual(edit.modes, ["image"]);
  assert.equal(edit.defaults.steps, 30);

  const result = buildImageWorkflow("mageFlowEdit", {
    imageModelFile: EDIT_MODEL,
    imageMode: "image",
    imageResolution: "landscape",
    prompt: "Replace the summer sky with dramatic storm clouds",
    negativePrompt: "artifacts",
    imageSteps: 30,
    imageGuidance: 5,
    batchSize: 1,
    seed: 456,
    referenceUploads: [
      { name: "clouds.png", subfolder: "remote" },
      { name: "lighting.png", subfolder: "remote" },
    ],
  }, { name: "source.png", subfolder: "remote" });

  assert.equal(result.workflow["1"].inputs.unet_name, EDIT_MODEL);
  assert.equal(result.workflow["20"].class_type, "LoadImage");
  assert.equal(result.workflow["5"].class_type, "TextEncodeMageFlowEdit");
  assert.deepEqual(result.workflow["5"].inputs.images, {
    image_1: ["20", 0],
    image_2: ["21", 0],
    image_3: ["22", 0],
  });
  assert.equal(result.workflow["5"].inputs.width, 1152);
  assert.equal(result.workflow["5"].inputs.height, 896);
  assert.equal(result.workflow["8"].inputs.steps, 30);
  assert.equal(result.workflow["8"].inputs.denoise, 1);
  assert.equal(result.metadata.imageModelFamily, "mageFlowEdit");
  assert.equal(result.metadata.imageSettings.denoise, 1);
});

test("Mage-Flow Edit requires its edit checkpoint, an input image and a single output", () => {
  assert.throws(
    () => imageModelSelection("mageFlowEdit", MODEL),
    /non è compatibile/,
  );
  assert.throws(
    () => buildImageWorkflow("mageFlowEdit", {
      imageModelFile: EDIT_MODEL,
      imageMode: "image",
      prompt: "edit",
    }),
    /Carica un'immagine/,
  );
  assert.throws(
    () => buildImageWorkflow("mageFlowEdit", {
      imageModelFile: EDIT_MODEL,
      imageMode: "image",
      prompt: "edit",
      batchSize: 2,
    }, { name: "source.png", subfolder: "" }),
    /Numero immagini = 1/,
  );
});
