import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoStudioInitialJob, videoStudioConfig } from "../src/video-studio-workflows.js";

const h3Nodes = [
  "CLIPLoader", "VAELoader", "UNETLoader", "LoraLoaderModelOnly",
  "MiniMaxH3MemoryEfficientSageAttentionPatch", "ModelAttentionBackend", "MiniMaxH3ImageToVideo",
  "MiniMaxH3ReferenceToVideo", "ResolutionSelector", "RandomNoise", "BasicGuider",
  "BasicScheduler", "KSamplerSelect", "SamplerCustomAdvanced", "VAEDecode",
  "VAEDecodeAudio", "VHS_VideoCombine", "VHS_LoadVideo", "LoadAudio",
  "DisTorchPurgeVRAMV2", "LayerUtility: PurgeVRAM", "ImageResizeKJv2", "VAEEncode", "VAEEncodeAudio",
  "LTXVConcatAVLatent",
  "SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler",
  "DaSiWa_RTX_UpscalerRefiner",
];

const h3Lora = "H3\\STY_Motion_Booster.safetensors";
const combatLora = "H3\\STY_Combat.safetensors";
const realismLora = "H3\\STY_Realism_People.safetensors";
const galaxyLora = "H3\\STY_GalaxyAce.safetensors";
const config = videoStudioConfig({
  installedLoras: [
    "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    h3Lora,
    combatLora,
    realismLora,
    galaxyLora,
    "LTX2.3\\not_h3.safetensors",
  ],
  installedDiffusionModels: [
    "minimaxH3INT8INT4_fl2vaINT8Pruned.safetensors",
    "minimaxH3INT8INT4_ref2vaINT8Pruned.safetensors",
    "h3ErosMax_beta3.safetensors",
  ],
  installedClips: ["qwen3vl_32b_minimax_h3_int8_convrot.safetensors"],
  installedVaes: [
    "minimax_h3_video_vae_int8_convrot.safetensors",
    "minimax_h3_audio_vae_fp32.safetensors",
  ],
  availableNodes: h3Nodes,
});

const image = { name: "first.png", subfolder: "remote", type: "input" };
const last = { name: "last.png", subfolder: "remote", type: "input" };
const video = { name: "reference.mp4", subfolder: "remote", type: "input" };
const audio = { name: "voice.wav", subfolder: "remote", type: "input" };

function build(h3Mode, raw = {}, uploads = {}, loras = []) {
  return buildVideoStudioInitialJob("minimaxH3", {
    h3Mode,
    prompt: "A cinematic shot with coherent motion and native audio.",
    duration: 5,
    h3AspectRatio: "16:9 (Widescreen)",
    ...raw,
  }, uploads, loras, config);
}

test("rileva pesi INT8, nodi e sole LoRA della cartella H3", () => {
  assert.equal(config.h3.available, true);
  assert.equal(config.capabilities.minimaxH3.available, true);
  assert.deepEqual(config.h3Loras, [h3Lora, combatLora, realismLora]);
  assert.deepEqual(config.disabledH3Loras, [{
    name: galaxyLora,
    reason: "Incompatibile con MiniMax H3 INT8 ConvRot: pesi AdaLN con forma non valida.",
  }]);
  assert.equal(config.h3LoraMetadata[h3Lora].trigger, "dynv2");
  assert.equal(config.h3LoraMetadata[realismLora].trigger, "r34l1sm");
  assert.deepEqual(config.h3LoraMetadata[combatLora].triggerOptions, ["prfight2", "prfin1"]);
  assert.equal(config.h3LoraMetadata[combatLora].automatic, false);
  assert.equal(config.h3.actionAvailable, true);
  assert.equal(config.h3.refineAvailability.seedvr2, true);
  assert.equal(config.h3.refineAvailability.rtx, true);
  assert.equal(config.h3.attentionAvailability.comfyKitchen, true);
  assert.equal(config.h3.files.fl2va, "minimaxH3INT8INT4_fl2vaINT8Pruned.safetensors");
  assert.equal(config.h3.files.ref2va, "minimaxH3INT8INT4_ref2vaINT8Pruned.safetensors");
  assert.equal(config.h3.files.erosMax, "h3ErosMax_beta3.safetensors");
  assert.equal(config.h3.modelProfiles.erosMax.available, true);
});

test("Comfy-Kitchen sostituisce SageAttention senza concatenare i due backend", () => {
  const job = build("text", { h3AttentionBackend: "comfyKitchen", h3RefineMode: "direct" });
  assert.equal(job.workflow["5"].class_type, "ModelAttentionBackend");
  assert.equal(job.workflow["5"].inputs.attention, "comfy kitchen attention");
  assert.equal(job.metadata.attentionBackend, "comfyKitchen");
});

test("Text to Video usa FL2VA e il doppio sampling 0,6 → 1,0 con purge", () => {
  const job = build("text", { h3FirstMegapixels: 0.6, h3SecondMegapixels: 1 });
  assert.equal(job.workflow["25"].class_type, "MiniMaxH3ImageToVideo");
  assert.equal(job.workflow["20"].inputs.megapixels, 0.6);
  assert.equal(job.workflow["40"].inputs.megapixels, 1);
  assert.equal(job.workflow["48"].inputs.steps, 4);
  assert.equal(job.workflow["48"].inputs.denoise, 0.2);
  assert.equal(job.workflow["37"].class_type, "DisTorchPurgeVRAMV2");
  assert.equal(job.workflow["38"].class_type, "DisTorchPurgeVRAMV2");
  assert.equal(job.workflow["37"].inputs.purge_models, true);
  assert.equal(job.workflow["38"].inputs.purge_qwen3vl_models, true);
  assert.equal(job.workflow["55"].class_type, "DisTorchPurgeVRAMV2");
  assert.equal(job.workflow["53"].class_type, "LayerUtility: PurgeVRAM");
  assert.equal(job.metadata.frames, 124);
});

test("Single Image e First / Last collegano correttamente i frame a FL2VA", () => {
  const single = build("image", {}, { h3FirstFrame: image });
  assert.deepEqual(single.workflow["25"].inputs.first_frame, ["21", 0]);
  assert.equal(single.workflow["25"].inputs.last_frame, undefined);
  assert.match(single.workflow["25"].inputs.prompt, /at 0\.00 seconds.*<Picture 1>/);

  const firstLast = build("firstLast", {}, { h3FirstFrame: image, h3LastFrame: last });
  assert.deepEqual(firstLast.workflow["25"].inputs.first_frame, ["21", 0]);
  assert.deepEqual(firstLast.workflow["25"].inputs.last_frame, ["22", 0]);
  assert.match(firstLast.workflow["25"].inputs.prompt, /^How the reference pictures align with the target video.*Picture 2 \(from Shot 1\) aligns with the 5\.13-second mark/);
  assert.match(firstLast.workflow["25"].inputs.prompt, /\n\nintegrated_multimodal_description:/);
});

test("Multi Reference collega immagini, video, audio incorporato e audio separato a Ref2VA", () => {
  const job = build("references", {}, {
    h3ReferenceImages: [image],
    h3ReferenceVideos: [video],
    h3ReferenceAudios: [audio],
  });
  assert.equal(job.workflow["25"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.deepEqual(job.workflow["25"].inputs["ref_images.ref_image_0"], ["60", 0]);
  assert.deepEqual(job.workflow["25"].inputs["ref_videos.ref_video_0"], ["70", 0]);
  assert.deepEqual(job.workflow["25"].inputs["ref_video_audios.ref_video_audio_0"], ["70", 2]);
  assert.deepEqual(job.workflow["25"].inputs["ref_audios.ref_audio_0"], ["80", 0]);
  assert.match(job.workflow["25"].inputs.prompt, /^subject_definitions:/);
  assert.match(job.workflow["25"].inputs.prompt, /\ndetailed_description: \[Shot 1\]/);
  assert.equal((job.workflow["25"].inputs.prompt.match(/^[a-z_]+:/gm) || []).length, 6);
});

test("Eros Max T2VA usa il checkpoint ibrido e Turbo integrato a 6 step senza LoRA esterna", () => {
  const job = build("text", { h3ModelProfile: "erosMax", h3UseTurbo: true, h3RefineMode: "direct" });
  assert.equal(job.workflow["4"].inputs.unet_name, "h3ErosMax_beta3.safetensors");
  assert.equal(job.workflow["25"].class_type, "MiniMaxH3ImageToVideo");
  assert.equal(job.workflow["10"], undefined);
  assert.equal(job.workflow["32"].inputs.sampler_name, "er_sde");
  assert.equal(job.workflow["33"].inputs.scheduler, "simple");
  assert.equal(job.workflow["33"].inputs.steps, 6);
  assert.equal(job.metadata.h3ModelProfile, "erosMax");
  assert.equal(job.metadata.integratedTurbo, true);
  assert.equal(job.metadata.externalTurbo, false);
});

test("Eros Max Single Image converte l'immagine in Picture 1 Ref2VA e blocca First Last", () => {
  const job = build("image", {
    h3ModelProfile: "erosMax",
    h3RefineMode: "direct",
    prompt: "subject_definitions: <Picture 1> is the adult subject.\n\nsummary: [reference generation] The subject moves naturally.\n\nretention_analysis: Preserve identity and clothing.\n\ndetailed_description: [Shot 1] <Picture 1> walks toward the camera.\n\noverall_soundscape: Footsteps.\n\nnon_diegetic_music: N/A",
  }, { h3FirstFrame: image });
  assert.equal(job.workflow["25"].class_type, "MiniMaxH3ReferenceToVideo");
  assert.deepEqual(job.workflow["25"].inputs["ref_images.ref_image_0"], ["60", 0]);
  assert.equal(job.workflow["25"].inputs.first_frame, undefined);
  assert.match(job.workflow["25"].inputs.prompt, /^subject_definitions: <Picture 1>/);
  assert.match(job.workflow["25"].inputs.prompt, /detailed_description: \[Shot 1\] <Picture 1>/);
  assert.equal(job.metadata.modelFamily, "ref2va");
  assert.deepEqual(job.metadata.references.images, ["remote/first.png"]);

  assert.throws(() => build("firstLast", {
    h3ModelProfile: "erosMax",
  }, { h3FirstFrame: image, h3LastFrame: last }), /non supporta First \/ Last Frame/);
});

test("sampling diretto 0,9 salta refine e purge intermedio, ma conserva quello finale", () => {
  const job = build("text", {
    h3SecondPass: false,
    h3FirstMegapixels: 0.9,
    h3PurgeBetween: false,
  });
  assert.equal(job.workflow["40"], undefined);
  assert.equal(job.workflow["49"], undefined);
  assert.equal(job.workflow["37"], undefined);
  assert.equal(job.workflow["55"].inputs.purge_qwen3vl_models, true);
  assert.equal(job.workflow["53"].class_type, "LayerUtility: PurgeVRAM");
  assert.equal(job.metadata.secondPass, false);
});

test("anteprima H3 forza 0,4 MP, conserva seed e salta ogni refine pesante", () => {
  const job = build("text", {
    h3RunProfile: "preview",
    h3FirstMegapixels: 0.9,
    h3RefineMode: "h3Maximum",
    seed: 987654,
  });
  assert.equal(job.workflow["20"].inputs.megapixels, 0.4);
  assert.equal(job.workflow["40"], undefined);
  assert.equal(job.workflow["41"], undefined);
  assert.equal(job.metadata.h3RunProfile, "preview");
  assert.equal(job.metadata.h3Stage, "preview");
  assert.equal(job.metadata.seed, 987654);
  assert.match(job.workflow["52"].inputs.filename_prefix, /preview/);
});

test("Seed Hunter H3 costruisce un solo candidato per job senza SaveLatent sul NestedTensor AV", () => {
  const job = buildVideoStudioInitialJob("seedHunterH3", {
    seedHunterH3Mode: "text",
    seedHunterH3AspectRatio: "16:9 (Widescreen)",
    prompt: "A complete five-second action with synchronized ambient audio.",
    duration: 5,
    seed: 700,
    h3CandidateIndex: 2,
  }, {}, [], config);
  const classes = Object.values(job.workflow).map((item) => item.class_type);
  assert.equal(job.workflow["20"].inputs.megapixels, 0.25);
  assert.equal(classes.filter((name) => name === "SamplerCustomAdvanced").length, 1);
  assert.equal(classes.includes("SaveLatent"), false);
  assert.equal(job.metadata.videoStudioMode, "seedHunterH3");
  assert.equal(job.metadata.h3Stage, "seedCandidate");
  assert.equal(job.metadata.candidateIndex, 2);
  assert.equal(job.metadata.seed, 700);
  assert.match(job.workflow["52"].inputs.filename_prefix, /candidate_2_seed_700/);
});

test("anteprima Fantasy verite usa Turbo solo temporaneamente e conserva il finale senza Turbo", () => {
  const job = build("image", {
    h3RunProfile: "preview",
    h3ScenePreset: "fantasyVerite",
    h3LookPreset: "amateurHandheld",
    h3UseTurbo: false,
    h3RefineMode: "rtx",
    seed: 24680,
  }, { h3FirstFrame: image }, [{ name: realismLora, strength: 0.7 }]);
  assert.equal(job.workflow["20"].inputs.megapixels, 0.4);
  assert.equal(job.workflow["10"].inputs.lora_name, config.h3.files.turbo);
  assert.equal(job.workflow["33"].inputs.steps, 8);
  assert.equal(job.metadata.useTurbo, true);
  assert.equal(job.metadata.nativeUseTurbo, false);
  assert.equal(job.metadata.scenePreset, "fantasyVerite");
  assert.match(job.workflow["25"].inputs.prompt, /Naturalistic fantasy-verite footage/);
  assert.match(job.workflow["25"].inputs.prompt, /source frame as authoritative/);
});

test("profilo H3 bilanciato usa 0,9 MP, 3 step e denoise 0,15", () => {
  const job = build("text", { h3RefineMode: "h3Balanced", h3FirstMegapixels: 0.6 });
  assert.equal(job.workflow["40"].inputs.megapixels, 0.9);
  assert.equal(job.workflow["48"].inputs.steps, 3);
  assert.equal(job.workflow["48"].inputs.denoise, 0.15);
  assert.equal(job.metadata.refineMode, "h3Balanced");
});

test("look amatoriale aggiunge imperfezioni organiche senza spostare il trigger LoRA", () => {
  const job = build("text", {
    h3RefineMode: "direct",
    h3LookPreset: "amateurHandheld",
    prompt: "r34l1sm. A woman crosses a small kitchen.",
  });
  assert.match(job.workflow["25"].inputs.prompt, /^integrated_multimodal_description: r34l1sm\. \[Shot 1\]/);
  assert.match(job.workflow["25"].inputs.prompt, /\noverall_soundscape: N\/A\n\nnon_diegetic_music: N\/A$/);
  assert.match(job.workflow["25"].inputs.prompt, /autofocus correction/);
  assert.match(job.workflow["25"].inputs.prompt, /auto-exposure breathing/);
  assert.match(job.workflow["25"].inputs.prompt, /Avoid polished advertising light/);
  assert.equal(job.metadata.lookPreset, "amateurHandheld");
});

test("SeedVR2 e RTX VSR sostituiscono il secondo sampling H3", () => {
  const seedvr = build("text", { h3RefineMode: "seedvr2", h3SeedvrResolution: 768 });
  assert.equal(seedvr.workflow["40"].class_type, "SeedVR2LoadDiTModel");
  assert.equal(seedvr.workflow["42"].class_type, "SeedVR2VideoUpscaler");
  assert.equal(seedvr.workflow["42"].inputs.resolution, 768);
  assert.equal(seedvr.workflow["55"].inputs.purge_seedvr2_models, true);
  assert.equal(seedvr.workflow["48"], undefined);
  assert.equal(seedvr.metadata.secondPass, false);

  const rtx = build("text", { h3RefineMode: "rtx" });
  assert.equal(rtx.workflow["41"].class_type, "DaSiWa_RTX_UpscalerRefiner");
  assert.equal(rtx.workflow["41"].inputs.upscale, "VSR");
  assert.equal(rtx.workflow["41"].inputs.denoise, true);
  assert.equal(rtx.workflow["48"], undefined);

  const organicRtx = build("text", { h3RefineMode: "rtx", h3LookPreset: "amateurHandheld" });
  assert.equal(organicRtx.workflow["41"].inputs.denoise, false);
  assert.equal(organicRtx.workflow["41"].inputs.deblur, true);
});

test("concatena Turbo e LoRA H3 sul modello della modalità", () => {
  const job = build("references", {}, { h3ReferenceImages: [image] }, [{ name: h3Lora, strength: 0.7 }]);
  assert.equal(job.workflow["10"].inputs.lora_name, config.h3.files.turbo);
  assert.equal(job.workflow["11"].inputs.lora_name, h3Lora);
  assert.deepEqual(job.workflow["11"].inputs.model, ["10", 0]);
  assert.deepEqual(job.workflow["31"].inputs.model, ["11", 0]);
});

test("ACTION H3 usa FL2VA, Combat V2 automatica e res_multistep + simple", () => {
  const job = buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "text",
    prompt: "Two adult fighters exchange a short, physically coherent combination.",
    duration: 5,
    actionH3AspectRatio: "16:9 (Widescreen)",
    actionH3Quality: "twoPass06",
    actionH3Trigger: "prfight2",
    actionH3CombatStrength: 0.8,
  }, {}, [], config);
  assert.equal(job.workflow["4"].inputs.unet_name, config.h3.files.fl2va);
  assert.equal(job.workflow["10"].inputs.lora_name, config.h3.files.turbo);
  assert.equal(job.workflow["11"].inputs.lora_name, combatLora);
  assert.equal(job.workflow["11"].inputs.strength_model, 0.8);
  assert.equal(job.workflow["32"].inputs.sampler_name, "res_multistep");
  assert.equal(job.workflow["33"].inputs.scheduler, "simple");
  assert.equal(job.workflow["47"].inputs.sampler_name, "res_multistep");
  assert.equal(job.workflow["48"].inputs.scheduler, "simple");
  assert.match(job.workflow["25"].inputs.prompt, /^integrated_multimodal_description: prfight2\. \[Shot 1\]/);
  assert.equal(job.metadata.videoStudioMode, "actionH3");
  assert.equal(job.metadata.h3Profile, "action");
  assert.match(job.workflow["52"].inputs.filename_prefix, /ActionH3/);
});

test("i preset ACTION H3 aggiungono una regia dedicata e vengono salvati nei metadata", () => {
  const cinematic = buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "text",
    actionH3Preset: "cinematicOneTake",
    prompt: "Two adult fighters duel in a ruined courtyard.",
    actionH3Trigger: "prfight2",
  }, {}, [{ name: realismLora, strength: 0.5 }, { name: h3Lora, strength: 0.35 }], config);
  assert.equal(cinematic.metadata.actionPreset, "cinematicOneTake");
  assert.match(cinematic.workflow["25"].inputs.prompt, /Cinematic continuous-take duel/);
  assert.match(cinematic.workflow["25"].inputs.prompt, /Do not invent cuts/);

  const fallback = buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "text",
    actionH3Preset: "unknown",
    prompt: "A short adult fight.",
  }, {}, [], config);
  assert.equal(fallback.metadata.actionPreset, "custom");
});

test("anteprima ACTION H3 usa un solo sampling 0,4 MP e conserva lo stack combattimento", () => {
  const job = buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "text",
    actionH3RunProfile: "preview",
    prompt: "A grounded adult hand-to-hand fight with coherent impacts.",
    duration: 5,
    actionH3AspectRatio: "16:9 (Widescreen)",
    actionH3Quality: "twoPass06",
    actionH3Trigger: "prfight2",
    seed: 321654,
  }, {}, [], config);
  assert.equal(job.workflow["20"].inputs.megapixels, 0.4);
  assert.equal(job.workflow["32"].inputs.sampler_name, "res_multistep");
  assert.equal(job.workflow["33"].inputs.scheduler, "simple");
  assert.equal(job.workflow["11"].inputs.lora_name, combatLora);
  assert.equal(job.workflow["40"], undefined);
  assert.equal(job.metadata.h3Stage, "preview");
  assert.equal(job.metadata.seed, 321654);
  assert.match(job.workflow["52"].inputs.filename_prefix, /ActionH3.*preview/i);
});

test("ACTION H3 Single Image ricostruisce il conditioning alla risoluzione del secondo sampling", () => {
  const job = buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "image",
    prompt: "The seated fighter rises and counters an attacker.",
    duration: 8,
    actionH3AspectRatio: "9:16 (Portrait Widescreen)",
    actionH3Quality: "twoPass06",
  }, { h3FirstFrame: image }, [], config);

  assert.equal(job.workflow["54"].class_type, "MiniMaxH3ImageToVideo");
  assert.deepEqual(job.workflow["54"].inputs.width, ["40", 0]);
  assert.deepEqual(job.workflow["54"].inputs.height, ["40", 1]);
  assert.deepEqual(job.workflow["54"].inputs.first_frame, ["21", 0]);
  assert.deepEqual(job.workflow["46"].inputs.conditioning, ["54", 0]);
});

test("ACTION H3 espone soltanto T2V, I2V e First Last e non duplica Combat", () => {
  const imageJob = buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "image",
    prompt: "The adult fighter rolls under one controlled strike and regains stance.",
    actionH3Quality: "direct09",
    actionH3CombatStrength: 0.7,
  }, { h3FirstFrame: image }, [{ name: combatLora, strength: 1 }], config);
  assert.equal(Object.values(imageJob.workflow).filter((entry) => entry.inputs?.lora_name === combatLora).length, 1);
  assert.deepEqual(imageJob.workflow["25"].inputs.first_frame, ["21", 0]);
  assert.equal(imageJob.workflow["40"], undefined);
  assert.throws(() => buildVideoStudioInitialJob("actionH3", {
    actionH3Mode: "references",
    prompt: "Combat",
  }, { h3ReferenceImages: [image] }, [], config), /soltanto Text to Video|FL2VA/);
});
