import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoStudioInitialJob, videoStudioConfig } from "../src/video-studio-workflows.js";

const baseNodes = [
  "UNETLoader", "CLIPLoader", "VAELoader", "CLIPTextEncode", "LTXVConditioning",
  "EmptyLTXVLatentVideo", "LTXVEmptyLatentAudio", "LTXVConcatAVLatent", "RandomNoise",
  "CFGGuider", "KSamplerSelect", "ManualSigmas", "SamplerCustomAdvanced", "LTXVSeparateAVLatent",
  "LTXVAudioVAEDecode", "VAEDecodeTiled", "CreateVideo", "SaveVideo", "DisTorchPurgeVRAMV2",
  "LayerUtility: PurgeVRAM", "LTXVAddGuideMulti", "LoadAudio", "LTXVInpaintPreprocess",
  "LTXVDilateVideoMask", "LTXAddVideoICLoRAGuideAdvanced", "LTXICLoRALoaderModelOnly",
  "RepeatImageBatch", "LTXAddVideoICLoRAGuide", "LTXVSparseTrackEditor", "LTXVDrawTracks",
  "CannyEdgePreprocessor", "DWPreprocessor",
  "ComfyUILTX25MSRICLoRALoader", "ComfyUILTX25MSRMultiReferenceGuide", "LTXVCropGuides",
];

const config = videoStudioConfig({
  installedLoras: [
    "LTX2.3\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-deblur-0.9.safetensors",
    "LTX2.5\\LTX-2.5-Licon-MSR-V1.safetensors",
  ],
  installedDiffusionModels: [
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    "redgraftLTX25Fast2K_ltx25RedgraftNSFW.safetensors",
  ],
  installedClips: ["gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"],
  installedVaes: [
    "ltx-2.5-video-vae-bf16.safetensors", "ltx-2.5-video-vae-conv-bf16.safetensors",
    "ltx-2.5-audio-vae-bf16.safetensors",
  ],
  installedLatentUpscalers: ["ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors"],
  availableNodes: baseNodes,
});

const uploads = {
  ltx25FirstFrame: { name: "first.png", subfolder: "remote" },
  ltx25LastFrame: { name: "last.png", subfolder: "remote" },
  ltx25Keyframes: [{ name: "middle.png", subfolder: "remote" }],
  ltx25ReferenceSheet: { name: "references.png", subfolder: "remote" },
  ltx25SourceVideo: { name: "source.mp4", subfolder: "remote" },
  ltx25MaskVideo: { name: "mask.mp4", subfolder: "remote" },
  ltx25Audio: { name: "dialogue.wav", subfolder: "remote" },
  ltx25MsrReferences: [
    { name: "subject-1.png", subfolder: "remote" },
    { name: "subject-2.png", subfolder: "remote" },
    { name: "background.png", subfolder: "remote" },
  ],
};

function build(mode, raw = {}) {
  return buildVideoStudioInitialJob("ltx25Aio", {
    ltx25Mode: mode, ltx25Profile: "final", prompt: "Natural handheld footage with synchronized ambient audio.",
    duration: 5, seed: 4242, ...raw,
  }, uploads, [], config);
}

test("LTX 2.5 AIO rileva i pesi INT8 e le modalità IC-LoRA già installate", () => {
  assert.equal(config.ltx25.available, true);
  for (const mode of ["text", "image", "firstLast", "keyframes", "audio", "textAudio", "referenceSheet", "unionControl", "inpaint", "outpaint", "motionTrack"]) {
    assert.equal(config.ltx25.modes[mode].available, true, mode);
  }
  assert.equal(config.ltx25.modes.v2vDeblur.available, true);
  assert.equal(config.ltx25.modes.multiReferenceMsr.available, true);
});

test("T2V finale usa due sampling, INT8 locale e purge fra ogni stadio", () => {
  const job = build("text");
  assert.equal(job.metadata.twoStage, true);
  assert.equal(job.metadata.seed, 4242);
  assert.ok(job.metadata.purgePlan.length >= 5);
  assert.ok(Object.values(job.workflow).some((node) => node.class_type === "LTXVLatentUpsampler"));
  assert.ok(Object.values(job.workflow).some((node) => node.class_type === "LayerUtility: PurgeVRAM"));
  assert.ok(Object.values(job.workflow).some((node) => node.class_type === "UNETLoader" && node.inputs.unet_name.includes("int8-convrot")));
});

test("REDGraft è un secondo checkpoint LTX 2.5 selezionabile senza sostituire il Distilled standard", () => {
  assert.equal(config.ltx25.modelProfiles.standard.available, true);
  assert.equal(config.ltx25.modelProfiles.redGraft.available, true);
  const job = build("text", { ltx25ModelProfile: "redGraft" });
  const loader = Object.values(job.workflow).find((node) => node.class_type === "UNETLoader");
  assert.equal(loader.inputs.unet_name, "redgraftLTX25Fast2K_ltx25RedgraftNSFW.safetensors");
  assert.equal(job.metadata.ltx25ModelProfile, "redGraft");
  assert.equal(job.metadata.modelFile, "redgraftLTX25Fast2K_ltx25RedgraftNSFW.safetensors");
});

test("First/Last e keyframe multipli mantengono guide temporali esatte", () => {
  for (const mode of ["firstLast", "keyframes"]) {
    const job = build(mode);
    const guide = Object.values(job.workflow).find((node) => node.class_type === "LTXVAddGuideMulti");
    assert.ok(guide, mode);
    assert.equal(guide.inputs.frame_idx_1, 0);
    assert.equal(guide.inputs.frame_idx_3 ?? guide.inputs.frame_idx_2, job.metadata.frames - 1);
  }
});

test("modalità audio, reference, controllo e in/outpaint costruiscono grafi con purge finale", () => {
  for (const mode of ["audio", "textAudio", "referenceSheet", "unionControl", "inpaint", "outpaint", "motionTrack"]) {
    const job = build(mode);
    assert.ok(Object.keys(job.workflow).length > 10, mode);
    assert.ok(job.metadata.purgePlan.length >= 3, mode);
    assert.ok(Object.values(job.workflow).some((node) => node.class_type === "LayerUtility: PurgeVRAM"), mode);
  }
});

test("Ingredients produce un vero shot nel formato richiesto e ripulisce il negativo", () => {
  const job = build("referenceSheet", {
    ltx25Profile: "balanced",
    ltx25Aspect: "9:16",
    duration: 8,
    negativePrompt: "identity drift, frozen frame, buffer overflow, HTTP 500, duplicated limbs",
  });
  const latent = Object.values(job.workflow).find((node) => node.class_type === "EmptyLTXVLatentVideo");
  const guide = Object.values(job.workflow).find((node) => node.class_type === "LTXAddVideoICLoRAGuide");
  assert.deepEqual([latent.inputs.width, latent.inputs.height], [448, 768]);
  assert.equal(latent.inputs.length, 193);
  assert.equal(guide.inputs.strength, 0.8);
  assert.match(job.metadata.prompt, /single full-frame continuous moving shot/i);
  assert.match(job.metadata.negativePrompt, /frozen frame/i);
  assert.doesNotMatch(job.metadata.negativePrompt, /buffer overflow|HTTP 500/i);
});

test("MSR collega 1-5 reference, loader dedicato e crop prima del decode", () => {
  const job = build("multiReferenceMsr");
  const loader = Object.values(job.workflow).find((node) => node.class_type === "ComfyUILTX25MSRICLoRALoader");
  const guide = Object.values(job.workflow).find((node) => node.class_type === "ComfyUILTX25MSRMultiReferenceGuide");
  const crop = Object.values(job.workflow).find((node) => node.class_type === "LTXVCropGuides");
  const decode = Object.values(job.workflow).find((node) => node.class_type === "VAEDecodeTiled");
  assert.ok(loader);
  assert.equal(loader.inputs.lora_name, "LTX2.5\\LTX-2.5-Licon-MSR-V1.safetensors");
  assert.ok(guide.inputs.pic1 && guide.inputs.pic2 && guide.inputs.pic3);
  assert.ok(crop);
  assert.deepEqual(decode.inputs.samples, [Object.entries(job.workflow).find(([, node]) => node === crop)[0], 2]);
  assert.equal(job.metadata.twoStage, false);
});

test("blocca modalità opzionali non installate e input obbligatori mancanti", () => {
  assert.doesNotThrow(() => build("v2vDeblur"));
  assert.throws(() => buildVideoStudioInitialJob("ltx25Aio", { ltx25Mode: "image", prompt: "x" }, {}, [], config), /immagine iniziale/i);
  assert.throws(() => buildVideoStudioInitialJob("ltx25Aio", { ltx25Mode: "text", prompt: "" }, {}, [], config), /prompt/i);
});

test("seed vuoto, null o multiplo viene trasformato in un seed valido", () => {
  for (const seed of ["", null, "random", "casuale", ["", "", ""], ["", "9876", ""]]) {
    const job = build("text", { seed });
    assert.equal(Number.isInteger(job.metadata.seed), true);
    assert.ok(job.metadata.seed >= 0);
    if (Array.isArray(seed) && seed.includes("9876")) assert.equal(job.metadata.seed, 9876);
  }
});

test("registra il preset LoRA LTX 2.5 nella ricetta della generazione", () => {
  const job = build("image", { ltx25LoraPreset: "selfieHandheld" });
  assert.equal(job.metadata.ltx25LoraPreset, "selfieHandheld");
  for (const preset of ["actionHandheld", "actionCinematic", "actionMultishot"]) {
    assert.equal(build("image", { ltx25LoraPreset: preset }).metadata.ltx25LoraPreset, preset);
  }
  const fallback = build("text", { ltx25LoraPreset: "nonValido" });
  assert.equal(fallback.metadata.ltx25LoraPreset, "custom");
});
