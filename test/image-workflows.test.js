import assert from "node:assert/strict";
import test from "node:test";
import { extractImages, extractVideos } from "../src/comfy-client.js";
import {
  buildImageWorkflow,
  imageModelConfig,
  qwenEdit2511Lightning8Preset,
} from "../src/image-workflows.js";

const base = {
  imageMode: "text",
  prompt: "A cinematic portrait in natural window light.",
  negativePrompt: "artifacts",
  imageResolution: "portrait",
  batchSize: "2",
  imageSteps: "24",
  imageGuidance: "4",
  seed: "1234",
};
const upload = { name: "reference.png", subfolder: "remote", type: "input" };

test("costruisce Klein 9B con reference editing nativo", () => {
  const { workflow } = buildImageWorkflow("fluxKlein9b", {
    ...base,
    imageMode: "image",
  }, upload);
  assert.equal(workflow["1"].inputs.unet_name, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(workflow["23"].class_type, "ReferenceLatent");
  assert.equal(workflow["24"].class_type, "ReferenceLatent");
  assert.deepEqual(workflow["13"].inputs.positive, ["23", 0]);
});

test("BigLove Klein INT8 ConvRot usa il loader per i metadati legacy", () => {
  const { workflow } = buildImageWorkflow("flux2", {
    ...base,
    imageModelFile: "FLUX2\\BigLoveKlein4_int8_convrot.safetensors",
  }, null);
  assert.equal(workflow["1"].class_type, "RemoteUNETLoaderConvRotINT8");
  assert.equal(workflow["1"].inputs.unet_name, "FLUX2\\BigLoveKlein4_int8_convrot.safetensors");
});

test("costruisce Z-Image Turbo Text to Image", () => {
  const { workflow } = buildImageWorkflow("zImage", {
    ...base,
    imageSteps: "8",
    imageGuidance: "1",
  }, null);
  assert.equal(workflow["1"].inputs.unet_name, "Z-IMG\\z_image_turbo_bf16.safetensors");
  assert.equal(workflow["4"].class_type, "ModelSamplingAuraFlow");
  assert.equal(workflow["8"].class_type, "KSampler");
  assert.equal(workflow["8"].inputs.denoise, 1);
});

test("costruisce Qwen Image 2512 Text to Image con componenti ufficiali", () => {
  const { workflow, metadata } = buildImageWorkflow("qwenImage", {
    ...base,
    batchSize: "1",
    imageModelFile: "QWEN\\qwen_image_2512_fp8_e4m3fn.safetensors",
    imageSteps: "50",
    imageGuidance: "4",
  }, null);
  assert.equal(workflow["1"].inputs.unet_name, "QWEN\\qwen_image_2512_fp8_e4m3fn.safetensors");
  assert.equal(workflow["2"].inputs.clip_name, "qwen_2.5_vl_7b_fp8_scaled.safetensors");
  assert.equal(workflow["2"].inputs.type, "qwen_image");
  assert.equal(workflow["3"].inputs.vae_name, "qwen_image_vae.safetensors");
  assert.equal(workflow["4"].inputs.shift, 3.1);
  assert.equal(workflow["8"].inputs.steps, 50);
  assert.equal(metadata.imageModelFamily, "qwenImage");
});

test("costruisce Qwen Image Edit 2511 con editing nativo e reference opzionali", () => {
  const { workflow, metadata } = buildImageWorkflow("qwenEdit", {
    ...base,
    batchSize: "1",
    imageMode: "image",
    imageModelFile: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
    referenceUploads: [
      { name: "persona.png", subfolder: "remote" },
      { name: "stile.png", subfolder: "remote" },
    ],
  }, upload);
  assert.equal(workflow["12"].class_type, "CFGNorm");
  assert.equal(workflow["20"].inputs.image, "remote/reference.png");
  assert.equal(workflow["21"].class_type, "ImageScaleToTotalPixels");
  assert.equal(workflow["21"].inputs.megapixels, 1.5);
  assert.equal(workflow["5"].class_type, "TextEncodeQwenImageEditPlus");
  assert.deepEqual(workflow["5"].inputs.image1, ["21", 0]);
  assert.deepEqual(workflow["5"].inputs.image2, ["22", 0]);
  assert.deepEqual(workflow["5"].inputs.image3, ["23", 0]);
  assert.equal(workflow["13"].inputs.reference_latents_method, "index_timestep_zero");
  assert.equal(workflow["8"].inputs.denoise, 1);
  assert.equal(metadata.imageSettings.denoise, 1);
});

test("preset Character accelera solo Qwen Image Edit 2511 con Lightning 8-step e CFG 1", () => {
  const preset = qwenEdit2511Lightning8Preset("QWEN\\qwen_image_edit_2511_bf16.safetensors");
  assert.equal(preset.steps, 8);
  assert.equal(preset.guidance, 1);
  assert.equal(preset.samplingProfile, "lightning-8");
  assert.deepEqual(preset.loras, [{
    name: "QWEN\\Qwen-Image-Edit-2511-Lightning-8steps-V1.0-bf16.safetensors",
    strength: 1,
  }]);
  assert.equal(qwenEdit2511Lightning8Preset("QWEN\\Qwen-Rapid-AIO-NSFW-v23.safetensors"), null);
});

test("abilita Qwen Rapid AIO NSFW v23 sia per testo sia per image editing", () => {
  const modelFile = "QWEN\\Qwen-Rapid-AIO-NSFW-v23.safetensors";
  const text = buildImageWorkflow("qwenImage", {
    ...base,
    batchSize: "1",
    imageMode: "text",
    imageModelFile: modelFile,
    imageSteps: "8",
    imageGuidance: "1",
  }, null);
  assert.equal(text.workflow["1"].inputs.unet_name, modelFile);
  assert.equal(text.workflow["8"].inputs.steps, 8);
  assert.equal(text.metadata.imageModelFamily, "qwenImage");

  const edit = buildImageWorkflow("qwenEdit", {
    ...base,
    batchSize: "1",
    imageMode: "image",
    imageModelFile: modelFile,
    imageSteps: "8",
    imageGuidance: "1",
  }, upload);
  assert.equal(edit.workflow["1"].inputs.unet_name, modelFile);
  assert.equal(edit.workflow["8"].inputs.steps, 8);
  assert.equal(edit.metadata.imageModelFamily, "qwenEdit");

  const ready = imageModelConfig([modelFile], {
    clips: ["qwen_2.5_vl_7b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  assert.equal(ready.find((item) => item.id === "qwenImage").models[0].name, "Qwen Rapid AIO NSFW v23");
  assert.equal(ready.find((item) => item.id === "qwenEdit").models[0].name, "Qwen Rapid AIO NSFW v23");

  const nested = imageModelConfig([`DiffusionModels\\${modelFile}`], {
    clips: ["qwen_2.5_vl_7b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  assert.equal(nested.find((item) => item.id === "qwenImage").available, true);
  assert.equal(nested.find((item) => item.id === "qwenEdit").available, true);
});

test("costruisce SDXL Realistic Photo Image to Image con CheckpointLoaderSimple", () => {
  const { workflow, metadata } = buildImageWorkflow("sdxlReal", {
    ...base,
    imageMode: "image",
    imageModelFile: "RealVisXL_V5.0.safetensors",
    imageSteps: "28",
    imageGuidance: "5.5",
    denoise: "0.42",
  }, upload);
  assert.equal(workflow["1"].class_type, "CheckpointLoaderSimple");
  assert.equal(workflow["1"].inputs.ckpt_name, "RealVisXL_V5.0.safetensors");
  assert.equal(workflow["7"].class_type, "VAEEncode");
  assert.equal(workflow["8"].inputs.sampler_name, "dpmpp_2m_sde");
  assert.equal(workflow["8"].inputs.scheduler, "karras");
  assert.equal(workflow["8"].inputs.denoise, 0.42);
  assert.equal(metadata.imageModelFamily, "sdxlReal");
  assert.equal(metadata.imageSettings.guidance, 5.5);
});

test("rileva checkpoint SDXL realistici dalla lista CheckpointLoaderSimple", () => {
  const config = imageModelConfig([], {
    checkpoints: [
      "RealVisXL_V5.0_fp16.safetensors",
      "Juggernaut-XI-v11.safetensors",
    ],
  });
  const sdxl = config.find((item) => item.id === "sdxlReal");
  assert.equal(sdxl.available, true);
  assert.equal(sdxl.models.length, 2);
  assert.equal(sdxl.defaultModelFile, "RealVisXL_V5.0_fp16.safetensors");
  assert.equal(sdxl.models.find((item) => item.file === "Juggernaut-XI-v11.safetensors").name, "Juggernaut XI v11");
});

test("segnala i modelli immagine non installati", () => {
  const config = imageModelConfig([
    "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors",
    "FLUX2\\flux2Klein_9bBase.safetensors",
  ], {
    clips: ["qwen3vl_4b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  assert.equal(config.find((item) => item.id === "fluxKrea2").available, true);
  assert.equal(config.find((item) => item.id === "flux2").available, true);
  assert.equal(config.find((item) => item.id === "zImage").available, false);
});

test("rileva la cartella FluxKrea2 e usa il workflow Krea2 nativo", () => {
  const darkBeast = "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors";
  const moody = "FluxKrea2\\moodyKrea2Mix_v50.safetensors";
  const config = imageModelConfig([
    darkBeast,
    moody,
  ], {
    clips: ["qwen3vl_4b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  const krea2 = config.find((item) => item.id === "fluxKrea2");
  assert.equal(krea2.available, true);
  assert.deepEqual(new Set(krea2.models.map((item) => item.file)), new Set([darkBeast, moody]));
  assert.equal(krea2.defaultModelFile, darkBeast);

  const { workflow, metadata } = buildImageWorkflow("fluxKrea2", {
    ...base,
    imageModelFile: darkBeast,
    imageSteps: "8",
    imageGuidance: "1",
  }, null);
  assert.equal(workflow["1"].inputs.unet_name, darkBeast);
  assert.equal(workflow["2"].class_type, "CLIPLoader");
  assert.equal(workflow["2"].inputs.type, "krea2");
  assert.equal(workflow["3"].inputs.vae_name, "qwen_image_vae.safetensors");
  assert.equal(workflow["7"].class_type, "EmptyLatentImage");
  assert.equal(workflow["8"].class_type, "KSampler");
  assert.equal(metadata.imageModelFamily, "fluxKrea2");
});

test("rileva separatamente checkpoint e dipendenze Qwen", () => {
  const models = [
    "qwen_image_2512_fp8_e4m3fn.safetensors",
    "QWEN\\qwen_image_edit_2511_bf16.safetensors",
  ];
  const missing = imageModelConfig(models, { clips: [], vaes: [] });
  assert.equal(missing.find((item) => item.id === "qwenImage").available, false);
  assert.equal(missing.find((item) => item.id === "qwenImage").missingRequirements.length, 2);

  const ready = imageModelConfig(models, {
    clips: ["qwen_2.5_vl_7b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  assert.equal(ready.find((item) => item.id === "qwenImage").available, true);
  assert.equal(ready.find((item) => item.id === "qwenEdit").available, true);
  assert.equal(ready.find((item) => item.id === "qwenEdit").models.length, 1);
});

test("mantiene Qwen Image Edit 2511 come primario e Qwen Rapid come variante", () => {
  const ready = imageModelConfig([
    "QWEN\\Qwen-Rapid-AIO-NSFW-v23.safetensors",
  ], {
    clips: ["qwen_2.5_vl_7b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  const qwenEdit = ready.find((item) => item.id === "qwenEdit");
  const qwenText = ready.find((item) => item.id === "qwenImage");
  assert.equal(qwenText.available, true);
  assert.equal(qwenText.models.length, 1);
  assert.equal(qwenEdit.available, true);
  assert.equal(qwenEdit.models.length, 1);
  assert.equal(qwenEdit.primaryAvailable, false);
  assert.equal(qwenEdit.defaultModelFile, "QWEN\\qwen_image_edit_2511_bf16.safetensors");
});

test("preferisce il checkpoint ufficiale Qwen Image Edit 2511 quando installato", () => {
  const ready = imageModelConfig([
    "QWEN\\Qwen-Rapid-AIO-NSFW-v23.safetensors",
    "QWEN\\qwen_image_edit_2511_bf16.safetensors",
  ], {
    clips: ["qwen_2.5_vl_7b_fp8_scaled.safetensors"],
    vaes: ["qwen_image_vae.safetensors"],
  });
  const qwenEdit = ready.find((item) => item.id === "qwenEdit");
  assert.equal(qwenEdit.primaryAvailable, true);
  assert.equal(qwenEdit.defaultModelFile, "QWEN\\qwen_image_edit_2511_bf16.safetensors");
  assert.equal(qwenEdit.modelFile, "QWEN\\qwen_image_edit_2511_bf16.safetensors");
});

test("permette di scegliere checkpoint diversi nella stessa famiglia", () => {
  const variants = [
    ["fluxKrea2", "FluxKrea2\\moodyKrea2Mix_v50.safetensors", "8"],
    ["flux2", "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors", "13"],
    ["zImage", "Z-IMG\\moodyProMix_zitV13.safetensors", "4"],
  ];
  for (const [family, modelFile, consumer] of variants) {
    const { workflow, metadata } = buildImageWorkflow(family, {
      ...base,
      imageModelFile: modelFile,
    }, null);
    assert.equal(workflow["1"].inputs.unet_name, modelFile);
    assert.equal(metadata.imageModelFile, modelFile);
    assert.equal(metadata.imageModelFamily, family);
    assert.ok(workflow[consumer]);
  }
});

test("impedisce di usare un checkpoint appartenente a un'altra famiglia", () => {
  assert.throws(() => buildImageWorkflow("fluxKrea2", {
    ...base,
    imageModelFile: "Z-IMG\\z_image_turbo_bf16.safetensors",
  }, null), /non è compatibile/);
  assert.throws(() => buildImageWorkflow("qwenEdit", {
    ...base,
    batchSize: "1",
    imageMode: "image",
    imageModelFile: "QWEN\\qwen_image_2512_fp8_e4m3fn.safetensors",
  }, upload), /non è compatibile/);
});

test("Flux.2 concatena fino a quattro reference indipendenti", () => {
  const references = [
    { name: "persona.png", subfolder: "remote" },
    { name: "posa.png", subfolder: "remote" },
    { name: "stile.png", subfolder: "remote" },
  ];
  const { workflow, metadata } = buildImageWorkflow("flux2", {
    imageModelFile: "FLUX2\\flux2Klein_9bBase.safetensors",
    imageMode: "image",
    imageResolution: "custom",
    imageWidth: 1600,
    imageHeight: 900,
    prompt: "Componi le immagini mantenendo identità, posa e stile.",
    referenceUploads: references,
  }, { name: "principale.png", subfolder: "remote" });

  assert.equal(workflow["20"].inputs.image, "remote/principale.png");
  assert.equal(workflow["25"].inputs.image, "remote/persona.png");
  assert.equal(workflow["30"].inputs.image, "remote/posa.png");
  assert.equal(workflow["35"].inputs.image, "remote/stile.png");
  assert.equal(workflow["21"].class_type, "ImageScaleToTotalPixels");
  assert.equal(workflow["21"].inputs.megapixels, 1.5);
  assert.equal(workflow["26"].inputs.megapixels, 1);
  assert.deepEqual(workflow["13"].inputs.positive, ["38", 0]);
  assert.deepEqual(workflow["13"].inputs.negative, ["39", 0]);
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 896);
  assert.equal(metadata.referenceImages.length, 3);
});

test("PornMaster Flux2 Klein v4Turbo usa il profilo nativo 4 step CFG 1", () => {
  const config = imageModelConfig([
    "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors",
  ]);
  const model = config.find((item) => item.id === "flux2").models[0];
  assert.deepEqual(model.defaults, { steps: 4, guidance: 1 });
});

test("PornMaster Flux2 Klein v4 Base BF16 usa il profilo qualità 12 step CFG 2", () => {
  const config = imageModelConfig([
    "FLUX2\\pornmasterFlux2Klein_v4BaseBf16.safetensors",
  ]);
  const model = config.find((item) => item.id === "flux2").models[0];
  assert.equal(model.name, "PornMaster Flux2 Klein v4 Base · BF16");
  assert.deepEqual(model.defaults, { steps: 12, guidance: 2 });
});

test("estrae le immagini prodotte dalla history ComfyUI", () => {
  const images = extractImages({
    outputs: {
      "14": {
        images: [
          { filename: "result_00001_.png", subfolder: "images", type: "output" },
          { filename: "result_00002_.png", subfolder: "images", type: "output" },
        ],
      },
    },
  });
  assert.equal(images.length, 2);
  assert.equal(images[0].filename, "result_00001_.png");
});

test("mostra prima l'immagine finale o enhanced quando ci sono più output", () => {
  const images = extractImages({
    outputs: {
      "16": {
        images: [
          { filename: "Remote_bigLoveQwenEdit_00067_.png", subfolder: "", type: "output" },
        ],
      },
      "940001": {
        images: [
          { filename: "Remote_qwenEdit_enhanced_00017_.png", subfolder: "", type: "output" },
        ],
      },
    },
  });
  assert.equal(images.length, 2);
  assert.equal(images[0].filename, "Remote_qwenEdit_enhanced_00017_.png");
});

test("mantiene il master finale prima delle bozze Studio", () => {
  const images = extractImages({
    outputs: {
      "10": { images: [{ filename: "Studio/perfect/01_bozza_00001_.png", type: "output" }] },
      "99": { images: [{ filename: "Studio/perfect/08_finale_00001_.png", type: "output" }] },
    },
  });
  assert.equal(images[0].filename, "Studio/perfect/08_finale_00001_.png");
});

test("mostra solo il video finale quando ComfyUI produce anche file temporanei", () => {
  const videos = extractVideos({
    outputs: {
      "189": {
        gifs: [
          { filename: "clip_00001-audio.mp4", subfolder: "video", type: "output" },
        ],
      },
      "226": {
        gifs: [
          { filename: "clip_00001.mp4", subfolder: "video", type: "temp" },
        ],
      },
    },
  });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].filename, "clip_00001-audio.mp4");
  assert.equal(videos[0].type, "output");
});

test("mantiene i video temporanei solo se sono l'unico risultato disponibile", () => {
  const videos = extractVideos({
    outputs: {
      "226": {
        gifs: [
          { filename: "clip_00001.mp4", subfolder: "video", type: "temp" },
        ],
      },
    },
  });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].type, "temp");
});

test("inserisce più LoRA in tutte le famiglie di modello immagine", () => {
  const loras = [
    { name: "family\\one.safetensors", strength: 0.6 },
    { name: "family\\two.safetensors", strength: -0.2 },
  ];
  const variants = [
    ["fluxKrea", "8", base, null],
    ["fluxKlein9b", "13", base, null],
    ["zImage", "4", base, null],
    ["qwenImage", "4", { ...base, batchSize: "1" }, null],
    ["qwenEdit", "4", { ...base, batchSize: "1", imageMode: "image" }, upload],
  ];
  for (const [model, consumer, options, source] of variants) {
    const { workflow, metadata } = buildImageWorkflow(model, options, source, loras);
    const second = workflow[workflow[consumer].inputs.model[0]];
    const first = workflow[second.inputs.model[0]];
    assert.equal(second.inputs.lora_name, loras[1].name);
    assert.equal(first.inputs.lora_name, loras[0].name);
    assert.deepEqual(first.inputs.model, ["1", 0]);
    assert.deepEqual(metadata.loras, loras);
  }
});

test("aggiunge Highres Fix ai sampler Krea2, Flux2 e Z-Image", () => {
  const highres = {
    ...base,
    batchSize: "1",
    highresEnabled: "on",
    highresScale: "1.5",
    highresSteps: "10",
    highresDenoise: "0.25",
    saveOriginal: "on",
  };
  const krea2 = buildImageWorkflow("fluxKrea", highres, null);
  const klein = buildImageWorkflow("fluxKlein9b", highres, null);
  const zimage = buildImageWorkflow("zImage", { ...highres, imageSteps: "8", imageGuidance: "1" }, null);

  assert.equal(krea2.workflow["910005"].class_type, "KSampler");
  assert.equal(klein.workflow["910004"].class_type, "Flux2Scheduler");
  assert.equal(klein.workflow["910005"].class_type, "SplitSigmas");
  assert.equal(zimage.workflow["910005"].class_type, "KSampler");
  assert.equal(krea2.workflow["940001"].class_type, "SaveImage");
  assert.ok(krea2.workflow["10"]);
  assert.equal(krea2.metadata.imageSettings.finalWidth, 1344);
  assert.equal(krea2.metadata.imageSettings.finalHeight, 1728);
});

test("aggiunge RealESRGAN 2x con purge pass-through e può salvare solo il risultato finale", () => {
  const { workflow, metadata } = buildImageWorkflow("fluxKlein9b", {
    ...base,
    batchSize: "1",
    upscaleMode: "fast",
    autoPurge: "on",
  }, null);
  assert.equal(workflow["920001"].class_type, "VRAM_Debug");
  assert.equal(workflow["920001"].inputs.unload_all_models, true);
  assert.equal(workflow["920002"].inputs.model_name, "RealESRGAN_x2.pth");
  assert.equal(workflow["920003"].inputs.per_batch, 1);
  assert.equal(workflow["939999"].class_type, "RemoteImageTensorNormalize");
  assert.deepEqual(workflow["939999"].inputs.image, ["920003", 0]);
  assert.equal(workflow["16"], undefined);
  assert.deepEqual(workflow["940001"].inputs.images, ["939999", 0]);
  assert.equal(metadata.imageSettings.finalWidth, 1792);
  assert.equal(metadata.imageSettings.finalHeight, 2304);
});

test("aggiunge SeedVR2 massimo tiled e con offload CPU", () => {
  const { workflow, metadata } = buildImageWorkflow("zImage", {
    ...base,
    batchSize: "1",
    imageSteps: "8",
    imageGuidance: "1",
    upscaleMode: "seedvr2",
    seedvrProfile: "maximum",
    seedvrResolution: "1792",
    autoPurge: "on",
    saveOriginal: "on",
  }, null);
  assert.equal(workflow["920002"].inputs.model, "seedvr2_ema_7b_fp16.safetensors");
  assert.equal(workflow["920002"].inputs.blocks_to_swap, 32);
  assert.equal(workflow["920002"].inputs.offload_device, "cpu");
  assert.equal(workflow["920003"].inputs.encode_tiled, true);
  assert.equal(workflow["920004"].inputs.batch_size, 1);
  assert.equal(workflow["920004"].inputs.color_correction, "lab");
  assert.equal(workflow["920005"].class_type, "RemoteImageTensorNormalize");
  assert.equal(workflow["939999"].class_type, "RemoteImageTensorNormalize");
  assert.deepEqual(workflow["939999"].inputs.image, ["920005", 0]);
  assert.deepEqual(workflow["940001"].inputs.images, ["939999", 0]);
  assert.equal(metadata.imageSettings.seedvrProfile, "maximum");
  assert.equal(metadata.imageSettings.finalWidth, 1792);
  assert.equal(metadata.imageSettings.finalHeight, 2304);
});

test("aggiunge RTX VSR con purge automatico alla pipeline immagine", () => {
  const { workflow, metadata } = buildImageWorkflow("fluxKrea", {
    ...base,
    batchSize: "1",
    upscaleMode: "rtx",
    rtxQuality: "Ultra",
    autoPurge: "on",
  }, null);
  assert.equal(workflow["920001"].class_type, "VRAM_Debug");
  assert.equal(workflow["920002"].class_type, "DaSiWa_RTX_UpscalerRefiner");
  assert.equal(workflow["920002"].inputs.upscale_quality, "Ultra");
  assert.equal(metadata.imageSettings.upscaleMode, "rtx");
});

test("impedisce batch multipli con Highres Fix o SeedVR2", () => {
  assert.throws(() => buildImageWorkflow("fluxKrea", {
    ...base,
    highresEnabled: "on",
  }, null), /Numero immagini = 1/);
  assert.throws(() => buildImageWorkflow("zImage", {
    ...base,
    upscaleMode: "seedvr2",
  }, null), /Numero immagini = 1/);
});

test("il master Krea2 applica detailer volto e mani prima di Highres Fix", () => {
  const { workflow, metadata } = buildImageWorkflow("fluxKrea", {
    ...base,
    imageMode: "image",
    batchSize: "1",
    faceDetailer: "on",
    handDetailer: "on",
    faceDetailerDenoise: "0.2",
    handDetailerDenoise: "0.27",
    highresEnabled: "on",
  }, { name: "master.png" });
  assert.equal(workflow["905011"].inputs.model_name, "bbox/face_yolov8n.pt");
  assert.equal(workflow["905021"].inputs.model_name, "bbox/hand_yolov8s.pt");
  assert.deepEqual(workflow["905022"].inputs.optional_image, ["905013", 1]);
  assert.deepEqual(workflow["910001"].inputs.image, ["905023", 1]);
  assert.equal(metadata.imageSettings.faceDetailer, true);
  assert.equal(metadata.imageSettings.handDetailer, true);
});

test("Face Detailer universale rifinisce Qwen 2511 prima di Highres e SeedVR2", () => {
  const { workflow, metadata } = buildImageWorkflow("qwenEdit", {
    ...base,
    batchSize: "1",
    imageMode: "image",
    imageModelFile: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
    faceDetailer: "on",
    faceDetailerDenoise: "0.18",
    highresEnabled: "on",
  }, upload);
  assert.equal(workflow["905000"].inputs.unet_name, "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors");
  assert.equal(workflow["905007"].class_type, "easy samLoaderPipe");
  assert.equal(workflow["905011"].inputs.model_name, "bbox/face_yolov8n.pt");
  assert.deepEqual(workflow["905012"].inputs.optional_image, ["9", 0]);
  assert.deepEqual(workflow["905012"].inputs.sam_pipe, ["905007", 0]);
  assert.deepEqual(workflow["910001"].inputs.image, ["905013", 1]);
  assert.equal(metadata.imageSettings.faceDetailer, true);
});

test("Face Detailer universale rifinisce Flux.2 Klein senza cambiare il generatore principale", () => {
  const { workflow } = buildImageWorkflow("fluxKlein9b", {
    ...base,
    batchSize: "1",
    faceDetailer: "on",
    faceDetailerDenoise: "0.18",
  }, null);
  assert.equal(workflow["1"].inputs.unet_name, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(workflow["905000"].inputs.unet_name, "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors");
  assert.deepEqual(workflow["905012"].inputs.optional_image, ["15", 0]);
  assert.deepEqual(workflow["939999"].inputs.image, ["905013", 1]);
});
