import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStudioContinuation,
  buildStudioJobs,
  resolveGuidedCompositionPolicy,
  studioConfig,
} from "../src/studio-workflows.js";

const source = { name: "pool.jpg", subfolder: "remote" };
const mask = { name: "mask.png", subfolder: "remote" };

test("espone soltanto i workflow Studio distinti", () => {
  assert.deepEqual(
    studioConfig().modes.map((item) => item.id),
    [
      "guidedEdit",
      "duoScene",
      "anima",
      "storyboard",
      "firstLast",
      "bible",
      "qwenKreaKlein",
      "animeToReal",
      "kreaTriple",
      "kreaRawMaster",
    ],
  );
});

test("Krea 2 RAW Master replica il workflow FameGrid originale", () => {
  const [job] = buildStudioJobs("kreaRawMaster", {
    prompt: "Editorial portrait with natural skin texture.",
    negativePrompt: "waxy skin",
    imageWidth: 1200,
    imageHeight: 1600,
    kreaRawAspectRatio: "9:16 (Portrait Widescreen)",
    kreaRawMegapixels: 1.2,
    seed: 42,
  }, {}, []);
  assert.equal(job.workflow["316"].inputs.unet_name, "FluxKrea2\\krea2_raw_bf16.safetensors");
  assert.equal(job.workflow["317"].inputs.clip_name, "qwen3vl_4b_bf16.safetensors");
  assert.equal(job.workflow["210"].inputs.vae_name, "wan_2.1_vae.safetensors");
  assert.deepEqual(job.workflow["154"].inputs.model, ["316", 0]);
  assert.equal(job.workflow["154"].inputs.strength_model, 0.6);
  assert.deepEqual(job.workflow["155"].inputs.model, ["154", 0]);
  assert.equal(job.workflow["155"].inputs.strength_model, 1);
  assert.deepEqual(job.workflow["128"].inputs.model, ["155", 0]);
  assert.equal(job.workflow["128"].inputs.strength_model, 1);
  assert.match(job.workflow["48"].inputs.value, /^famegrid,\n/);
  assert.match(job.workflow["271"].inputs.value, /AI artifacts, uncanny valley, waxy skin$/);
  assert.deepEqual(job.workflow["265"].inputs.model, ["128", 0]);
  assert.equal(job.workflow["265"].class_type, "ClownsharKSampler_Beta");
  assert.equal(job.workflow["265"].inputs.sampler_name, "multistep/res_2m");
  assert.equal(job.workflow["265"].inputs.scheduler, "beta57");
  assert.equal(job.workflow["265"].inputs.steps, 6);
  assert.equal(job.workflow["265"].inputs.denoise, 1);
  assert.deepEqual(job.workflow["265"].inputs.cfg, ["282", 0]);
  assert.deepEqual(job.workflow["274"].inputs.latent_image, ["265", 0]);
  assert.equal(job.workflow["274"].inputs.sampler_name, "multistep/deis_3m");
  assert.equal(job.workflow["274"].inputs.scheduler, "bong_tangent");
  assert.equal(job.workflow["274"].inputs.steps, 2);
  assert.equal(job.workflow["274"].inputs.denoise, 0.2);
  assert.equal(job.workflow["282"].inputs.value, 1);
  assert.equal(job.workflow["341"].class_type, "ResolutionSelector");
  assert.equal(job.workflow["341"].inputs.aspect_ratio, "9:16 (Portrait Widescreen)");
  assert.equal(job.workflow["341"].inputs.megapixels, 1.2);
  assert.equal(job.workflow["341"].inputs.multiple, 8);
  assert.deepEqual(job.workflow["232"].inputs.width, ["341", 0]);
  assert.deepEqual(job.workflow["232"].inputs.height, ["341", 1]);
  assert.deepEqual(job.workflow["8"].inputs.samples, ["274", 0]);
  assert.equal(job.workflow["340"].inputs.color_strength, 1);
  assert.equal(job.workflow["340"].inputs.sharpen_strength, 0.2);
  assert.equal(job.metadata.width, 824);
  assert.equal(job.metadata.height, 1464);
  assert.deepEqual(job.workflow["213"].inputs.images, ["340", 0]);
  assert.equal(job.metadata.imageSettings.faithfulOriginal, true);
  assert.equal(job.metadata.imageSettings.upscale, "manual");
});

test("ANIMA usa la pipeline nativa e il profilo specifico di ciascun checkpoint", () => {
  const [turbo] = buildStudioJobs("anima", {
    prompt: "Cinematic anime heroine on a rainy neon rooftop.",
    negativePrompt: "low quality",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
    animaSeed: 42,
    imageWidth: 1024,
    imageHeight: 1024,
  }, {});
  assert.equal(turbo.workflow["1"].class_type, "UNETLoader");
  assert.equal(turbo.workflow["1"].inputs.unet_name, "ANIMA\\anima_turboV11.safetensors");
  assert.deepEqual(turbo.workflow["2"].inputs, {
    clip_name: "qwen_3_06b_base.safetensors",
    type: "stable_diffusion",
    device: "default",
  });
  assert.equal(turbo.workflow["3"].inputs.vae_name, "qwen_image_vae.safetensors");
  assert.equal(turbo.workflow["7"].inputs.steps, 8);
  assert.equal(turbo.workflow["7"].inputs.cfg, 1);
  assert.equal(turbo.workflow["7"].inputs.sampler_name, "euler");
  assert.equal(turbo.workflow["7"].inputs.scheduler, "simple");
  assert.equal(turbo.metadata.imageModelFamily, "anima");

  const variants = buildStudioJobs("anima", {
    prompt: "Expressive painterly anime portrait.",
    animaModel: "ANIMA\\animij_s1.safetensors",
    animaOutputs: 2,
    animaSeed: 100,
    imageWidth: 896,
    imageHeight: 1152,
  }, {});
  assert.equal(variants.length, 2);
  assert.deepEqual(variants.map((job) => job.workflow["7"].inputs.seed), [100, 101]);
  assert.equal(variants[0].workflow["7"].inputs.steps, 32);
  assert.equal(variants[0].workflow["7"].inputs.cfg, 6);
});

test("ANIMA compone fino a tre identità e un ambiente prima del render nativo", () => {
  const source = { name: "hero-sheet.png", subfolder: "remote" };
  const references = [
    { name: "woman-profile.png", subfolder: "remote" },
    { name: "friend-sheet.png", subfolder: "remote" },
    { name: "rooftop.png", subfolder: "remote" },
  ];
  const [job] = buildStudioJobs("anima", {
    prompt: "I tre personaggi osservano la città sotto la pioggia.",
    animaInputMode: "references",
    animaHasCharacter2: "true",
    animaHasCharacter3: "true",
    animaHasEnvironment: "true",
    animaCharacter1Direction: "a sinistra, in primo piano",
    animaCharacter2Direction: "al centro",
    animaCharacter3Direction: "a destra",
    animaReferenceStrength: 0.35,
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
    animaSeed: 42,
    imageWidth: 1216,
    imageHeight: 832,
  }, { source, references });

  assert.equal(job.workflow["1"].inputs.unet_name, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(job.workflow["20"].inputs.image, "remote/hero-sheet.png");
  assert.equal(job.workflow["25"].inputs.image, "remote/woman-profile.png");
  assert.equal(job.workflow["30"].inputs.image, "remote/friend-sheet.png");
  assert.equal(job.workflow["35"].inputs.image, "remote/rooftop.png");
  assert.equal(job.workflow["970002"].inputs.unet_name, "ANIMA\\anima_turboV11.safetensors");
  assert.deepEqual(job.workflow["970007"].inputs.pixels, ["970001", 0]);
  assert.equal(job.workflow["970008"].inputs.denoise, 0.35);
  assert.deepEqual(job.workflow["970010"].inputs.images, ["970009", 0]);
  assert.equal(job.workflow["16"], undefined);
  assert.equal(job.metadata.referenceCount, 4);
  assert.deepEqual(job.metadata.referenceRoles.map((item) => item.role), [
    "character1", "character2", "character3", "environment",
  ]);
  assert.match(job.metadata.effectivePrompt, /never reproduce the sheet layout/i);
  assert.match(job.metadata.effectivePrompt, /Keep every identity separate/i);
  assert.equal(job.metadata.imageSettings.identityComposer, "FLUX2\\flux2Klein_9bBase.safetensors");
});

test("ANIMA reference richiede il personaggio principale e slot coerenti", () => {
  const raw = {
    prompt: "Una scena anime.",
    animaInputMode: "references",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
  };
  assert.throws(() => buildStudioJobs("anima", raw, {}), /personaggio principale/i);
  assert.throws(() => buildStudioJobs("anima", {
    ...raw,
    animaHasCharacter2: "true",
  }, { source: { name: "hero.png" }, references: [] }), /reference ANIMA/i);
});

test("ANIMA applica in catena soltanto le LoRA della propria famiglia", () => {
  const selectedLoras = [
    { name: "ANIMA\\expressive_anime.safetensors", strength: 0.75 },
    { name: "QWEN\\STY_qwen_image_2512_anime01.safetensors", strength: 1 },
  ];
  const [textJob] = buildStudioJobs("anima", {
    prompt: "Anime portrait.",
    animaInputMode: "text",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
  }, {}, selectedLoras);
  const textLora = Object.values(textJob.workflow).find((node) => node.class_type === "LoraLoaderModelOnly");
  assert.equal(textLora.inputs.lora_name, "ANIMA\\expressive_anime.safetensors");
  assert.equal(textLora.inputs.strength_model, 0.75);
  assert.deepEqual(textJob.workflow["7"].inputs.model, [
    Object.entries(textJob.workflow).find(([, node]) => node === textLora)[0], 0,
  ]);
  assert.deepEqual(textJob.metadata.loras, [selectedLoras[0]]);

  const [referenceJob] = buildStudioJobs("anima", {
    prompt: "Two anime characters.",
    animaInputMode: "references",
    animaHasCharacter2: "true",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
  }, {
    source: { name: "one.png" },
    references: [{ name: "two.png" }],
  }, selectedLoras);
  const referenceLoraEntry = Object.entries(referenceJob.workflow)
    .find(([, node]) => node.class_type === "LoraLoaderModelOnly");
  assert.deepEqual(referenceJob.workflow["970008"].inputs.model, [referenceLoraEntry[0], 0]);
  assert.deepEqual(referenceLoraEntry[1].inputs.model, ["970002", 0]);
});

test("ANIMA FAST, BALANCED e MAX concatenano uno, due o tre sampler con denoise decrescente", () => {
  const base = {
    prompt: "Detailed anime key visual.",
    animaInputMode: "text",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
    animaSeed: 50,
  };
  const [fast] = buildStudioJobs("anima", { ...base, animaQuality: "fast" }, {});
  const [balanced] = buildStudioJobs("anima", { ...base, animaQuality: "balanced" }, {});
  const [max] = buildStudioJobs("anima", { ...base, animaQuality: "max" }, {});

  assert.equal(fast.workflow["7101"], undefined);
  assert.deepEqual(fast.workflow["8"].inputs.samples, ["7", 0]);
  assert.equal(fast.metadata.imageSettings.samplerCount, 1);

  assert.equal(balanced.workflow["7101"].class_type, "KSampler");
  assert.deepEqual(balanced.workflow["7101"].inputs.latent_image, ["7", 0]);
  assert.equal(balanced.workflow["7101"].inputs.denoise, 0.24);
  assert.deepEqual(balanced.workflow["8"].inputs.samples, ["7101", 0]);
  assert.equal(balanced.metadata.imageSettings.samplerCount, 2);

  assert.equal(max.workflow["7102"].class_type, "KSampler");
  assert.deepEqual(max.workflow["7102"].inputs.latent_image, ["7101", 0]);
  assert.equal(max.workflow["7102"].inputs.denoise, 0.12);
  assert.deepEqual(max.workflow["8"].inputs.samples, ["7102", 0]);
  assert.deepEqual(max.metadata.imageSettings.samplingPasses.map((pass) => pass.denoise), [1, 0.24, 0.12]);
  assert.equal(max.metadata.imageSettings.samplerCount, 3);
});

test("ANIMA MAX con reference riduce il denoise senza ricomporre la scena", () => {
  const [job] = buildStudioJobs("anima", {
    prompt: "Two characters in a quiet café.",
    animaInputMode: "references",
    animaHasCharacter2: "true",
    animaReferenceStrength: 0.35,
    animaQuality: "max",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
  }, {
    source: { name: "one.png" },
    references: [{ name: "two.png" }],
  });
  assert.deepEqual(job.metadata.imageSettings.samplingPasses.map((pass) => pass.denoise), [0.35, 0.17, 0.09]);
  assert.deepEqual(job.workflow["970011"].inputs.latent_image, ["970008", 0]);
  assert.deepEqual(job.workflow["970012"].inputs.latent_image, ["970011", 0]);
  assert.deepEqual(job.workflow["970009"].inputs.samples, ["970012", 0]);
});

test("DUO SCENE mantiene due identità distinte e assegna ambiente e stile a quattro reference Flux.2", () => {
  const man = { name: "man.png", subfolder: "remote" };
  const references = [
    { name: "woman.png", subfolder: "remote" },
    { name: "garden.png", subfolder: "remote" },
    { name: "anime-style.png", subfolder: "remote" },
  ];
  const [job] = buildStudioJobs("duoScene", {
    prompt: "I due personaggi passeggiano insieme al tramonto.",
    duoHasFemale: "true",
    duoHasEnvironment: "true",
    duoHasStyle: "true",
    duoStylePreset: "romantic",
    duoMalePlacement: "a sinistra, guarda la donna",
    duoFemalePlacement: "a destra, gli tiene il braccio",
    editPreset: "conservative",
    alternatives: 2,
    imageWidth: 1216,
    imageHeight: 832,
  }, { source: man, references });

  assert.equal(job.metadata.imageModelFile, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(job.metadata.referenceCount, 4);
  assert.deepEqual(job.metadata.referenceRoles.map((item) => item.role), [
    "maleIdentity", "femaleIdentity", "environment", "style",
  ]);
  assert.equal(job.workflow["20"].inputs.image, "remote/man.png");
  assert.equal(job.workflow["25"].inputs.image, "remote/woman.png");
  assert.equal(job.workflow["30"].inputs.image, "remote/garden.png");
  assert.equal(job.workflow["35"].inputs.image, "remote/anime-style.png");
  assert.match(job.metadata.prompt, /Keep the two identities completely distinct/i);
  assert.match(job.metadata.prompt, /Image 3 defines the environment/i);
  assert.match(job.metadata.prompt, /Image 4 defines visual anime language/i);
});

test("DUO SCENE accetta due sole identità e impedisce reference incomplete", () => {
  const raw = {
    prompt: "Una scena anime in un caffè.",
    duoHasFemale: "true",
    duoHasEnvironment: "false",
    duoHasStyle: "false",
    alternatives: 2,
    imageWidth: 1024,
    imageHeight: 1024,
  };
  const [job] = buildStudioJobs("duoScene", raw, {
    source: { name: "man.png" },
    references: [{ name: "woman.png" }],
  });
  assert.equal(job.metadata.referenceCount, 2);
  assert.equal(job.workflow["25"].inputs.image, "woman.png");
  assert.equal(job.workflow["30"], undefined);
  assert.throws(() => buildStudioJobs("duoScene", raw, {
    source: { name: "man.png" },
    references: [],
  }), /reference DUO SCENE/i);
});

test("DUO SCENE finalizza con AnimeSharp senza refine fotografico", () => {
  const final = buildStudioContinuation("finalize", {
    studioMode: "duoScene",
    prompt: "Mantieni la scena anime approvata.",
    imageWidth: 1216,
    imageHeight: 832,
    finalOutput: "animeSharp",
  }, { name: "duo-approved.png", subfolder: "remote" });
  assert.equal(final.workflow["10"].class_type, "UpscaleModelLoader");
  assert.equal(final.workflow["10"].inputs.model_name, "4x-AnimeSharp.pth");
  assert.equal(final.metadata.studioMode, "duoScene");
  assert.match(final.metadata.workflowName, /Master anime/);
  assert.ok(!Object.values(final.workflow).some((node) =>
    node.inputs?.unet_name === "FluxKrea2\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors"
  ));
});

test("DUO SCENE conserva entrambe le reference identità nel refine qualità", () => {
  const quality = buildStudioContinuation("quality", {
    studioMode: "duoScene",
    prompt: "Mantieni identità e composizione della scena anime.",
    imageWidth: 1216,
    imageHeight: 832,
    referenceUploads: [
      { name: "original-man.png" },
      { name: "original-woman.png" },
      { name: "environment.png" },
    ],
  }, { name: "selected-duo.png" });
  assert.equal(quality.workflow["20"].inputs.image, "selected-duo.png");
  assert.equal(quality.workflow["25"].inputs.image, "original-man.png");
  assert.equal(quality.workflow["30"].inputs.image, "original-woman.png");
  assert.equal(quality.workflow["35"].inputs.image, "environment.png");
  assert.equal(quality.metadata.identityReferenceCount, 4);
});

test("Anime to Real rimuove Qwen-VL e usa prompt LM Studio con asset locali", () => {
  const prompt = "Ultra realistic live-action photograph preserving pose, costume and composition.";
  const [job] = buildStudioJobs("animeToReal", {
    prompt,
    seed: 777,
    imageWidth: 1024,
    imageHeight: 1024,
  }, { source, references: [] });

  assert.equal(job.metadata.workflowId, "studio:animeToReal");
  assert.equal(job.metadata.imageSettings.qwenVlRemoved, true);
  assert.equal(job.workflow["22"].inputs.image, "remote/pool.jpg");
  assert.equal(job.workflow["147"].inputs.prompt, prompt);
  assert.equal(job.workflow["269"].inputs.text, prompt);
  assert.equal(job.workflow["271"], undefined);
  assert.ok(!Object.values(job.workflow).some((node) => node.class_type === "Qwen3_VQA"));
  assert.equal(job.workflow["122"].class_type, "KSampler");
  assert.equal(job.workflow["268"].class_type, "BasicScheduler");
  assert.equal(job.workflow["98"].inputs.unet_name, "QWEN\\qwen_image_edit_2511_bf16.safetensors");
  assert.equal(job.workflow["158"].inputs.lora_name, "QWEN\\Anime2Real_v4-22.safetensors");
  assert.equal(job.workflow["284"].inputs.unet_name, "Z-IMG\\moodyProMix_zitV13.safetensors");
  assert.equal(job.workflow["261"].inputs.vae_name, "ae.safetensors");
  assert.equal(job.workflow["256"].inputs.filename_prefix, "Studio/anime_to_real/08_finale");
  assert.equal(job.workflow["940200"].class_type, "RemoteImageTensorNormalize");
  assert.deepEqual(job.workflow["940200"].inputs.image, ["257", 0]);
  assert.deepEqual(job.workflow["256"].inputs.images, ["940200", 0]);
});

test("Qwen Krea Klein usa il workflow API statico con input runtime", () => {
  const [job] = buildStudioJobs("qwenKreaKlein", {
    prompt: "Transform the provided image into a realistic live-action photo.",
    seed: 12345,
    imageWidth: 1400,
    imageHeight: 1800,
  }, { source, references: [] });

  assert.equal(job.metadata.workflowId, "studio:qwenKreaKlein");
  assert.equal(job.metadata.studioStage, "final");
  assert.equal(job.metadata.sourceImage, "remote/pool.jpg");
  assert.equal(job.workflow["78"].inputs.image, "remote/pool.jpg");
  assert.equal(job.workflow["110"].inputs.prompt, "Transform the provided image into a realistic live-action photo.");
  assert.equal(job.workflow["413"].inputs.unet_name, "FluxKrea2\\krea2_raw_bf16.safetensors");
  assert.equal(job.workflow["499"].inputs.steps, 52);
  assert.equal(job.workflow["499"].inputs.cfg, 3.5);
  assert.equal(job.workflow["499"].inputs.start_at_step, 42);
  assert.equal(job.workflow["396"].class_type, "CLIPTextEncode");
  assert.equal(job.workflow["396"].inputs.text, "");
  assert.deepEqual(job.workflow["396"].inputs.clip, ["414", 0]);
  assert.equal(job.workflow["415"].inputs.vae_name, "qwen_image_vae.safetensors");
  assert.equal(job.workflow["940101"].class_type, "Krea2ModelSampling");
  assert.equal(job.workflow["940101"].inputs.sampling_mode, "raw_dynamic");
  assert.deepEqual(job.workflow["499"].inputs.model, ["940101", 0]);
  assert.equal(job.workflow["499"].inputs.return_with_leftover_noise, "disable");
  assert.equal(job.workflow["484"].inputs.unet_name, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(job.workflow["492"].class_type, "SeedVR2VideoUpscaler");
  assert.equal(job.workflow["939999"].class_type, "RemoteImageTensorNormalize");
  assert.deepEqual(job.workflow["527"].inputs.images, ["939999", 0]);
  assert.equal(job.workflow["522"].inputs.seed, 12345);
  assert.equal(job.workflow["527"].inputs.filename_prefix, "Studio/qwen_krea_klein/08_finale");
  assert.equal(job.metadata.imageSettings.staticWorkflow, "Qwen_Krea_Klein_API.json");
});

test("Krea Triple Text to Image usa il template T2I e normalizza SeedVR2", () => {
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    prompt: "Realistic editorial poolside portrait.",
    negativePrompt: "avoid blur",
    seed: 123,
    imageWidth: 960,
    imageHeight: 1280,
  }, { references: [] });

  assert.equal(job.metadata.workflowId, "studio:kreaTriple");
  assert.equal(job.metadata.imageSettings.operation, "text");
  assert.equal(job.metadata.imageSettings.staticWorkflow, "KreaTriple_T2I_API.json");
  assert.equal(job.workflow["2"].inputs.unet_name, "FluxKrea2\\krea2_raw_bf16.safetensors");
  assert.equal(job.workflow["970090"].class_type, "Krea2ModelSampling");
  assert.equal(job.workflow["970090"].inputs.sampling_mode, "raw_dynamic");
  assert.equal(job.workflow["970090"].inputs.width, 864);
  assert.equal(job.workflow["970090"].inputs.height, 1152);
  assert.deepEqual(job.workflow["8"].inputs.model, ["970090", 0]);
  assert.equal(job.workflow["8"].inputs.steps, 52);
  assert.equal(job.workflow["8"].inputs.cfg, 3.5);
  assert.equal(job.metadata.imageSettings.kreaModelId, "rawBf16");
  assert.equal(job.workflow["5"].inputs.text, "Realistic editorial poolside portrait.");
  assert.equal(job.workflow["15"].inputs.text, "Realistic editorial poolside portrait.");
  assert.equal(job.workflow["59"].inputs.text, "Realistic editorial poolside portrait.");
  assert.equal(job.workflow["8"].inputs.seed, 123);
  assert.equal(job.workflow["17"].inputs.seed, 123);
  assert.equal(job.workflow["17"].inputs.denoise, 0.12);
  assert.equal(job.workflow["29"].inputs.noise_seed, 125);
  assert.equal(job.workflow["99"].inputs.cache_model, true);
  assert.equal(job.workflow["99"].inputs.attention_mode, "sdpa");
  assert.equal(job.workflow["23"].inputs.use_custom_resolution, true);
  assert.equal(job.workflow["23"].inputs.custom_width, 864);
  assert.equal(job.workflow["23"].inputs.custom_height, 1152);
  assert.equal(job.workflow["6"].class_type, "CLIPTextEncode");
  assert.equal(job.workflow["6"].inputs.text, "avoid blur");
  assert.equal(job.workflow["25"].class_type, "PreviewImage");
  assert.equal(job.workflow["38"].class_type, "PreviewImage");
});

test("Krea Triple codifica realmente anche il negative prompt vuoto", () => {
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    prompt: "A clean portrait.",
    seed: 12,
  }, { references: [] });
  for (const id of ["6", "16", "37"]) {
    assert.equal(job.workflow[id].class_type, "CLIPTextEncode");
    assert.equal(job.workflow[id].inputs.text, "");
  }
});

test("Krea Triple rifiuta i vecchi checkpoint e accetta soltanto RAW BF16", () => {
  assert.throws(() => buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    kreaTripleModel: "FluxKrea2\\moodyKrea2Mix_v50.safetensors",
    prompt: "A woman walking through a fantasy village.",
    seed: 7,
    imageWidth: 1152,
    imageHeight: 896,
  }, { references: [] }), /non riconosciuto/);
});

test("Krea Triple bypassa SeedVR2 e salva direttamente l'output Klein", () => {
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    prompt: "Natural editorial portrait.",
    kreaTripleUseZImage: "true",
    kreaTripleUseKlein: "true",
    kreaTripleUseSeedVR2: "false",
    seed: 44,
  }, { references: [] });

  assert.deepEqual(job.workflow["49"].inputs.images, ["67", 0]);
  assert.equal(job.workflow["69"], undefined);
  assert.equal(job.workflow["99"], undefined);
  assert.deepEqual(job.metadata.imageSettings.stages, {
    krea: true,
    zImage: true,
    klein: true,
    seedvr2: false,
  });
  assert.equal(job.metadata.imageSettings.finalStage, "klein");
});

test("Krea Triple può saltare Z-Image e alimentare Klein direttamente da Krea RAW", () => {
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    prompt: "Clean fashion photograph.",
    kreaTripleUseZImage: "false",
    kreaTripleUseKlein: "true",
    kreaTripleUseSeedVR2: "false",
    seed: 45,
  }, { references: [] });

  assert.equal(job.workflow["13"], undefined);
  assert.equal(job.workflow["17"], undefined);
  assert.deepEqual(job.workflow["33"].inputs.image, ["9", 0]);
  assert.deepEqual(job.workflow["67"].inputs.image_ref, ["9", 0]);
  assert.deepEqual(job.workflow["49"].inputs.images, ["67", 0]);
});

test("Krea Triple può produrre il solo master RAW senza caricare gli altri motori", () => {
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    prompt: "A quiet landscape.",
    kreaTripleUseZImage: "false",
    kreaTripleUseKlein: "false",
    kreaTripleUseSeedVR2: "false",
    seed: 46,
  }, { references: [] });

  assert.deepEqual(job.workflow["49"].inputs.images, ["9", 0]);
  assert.equal(job.workflow["13"], undefined);
  assert.equal(job.workflow["31"], undefined);
  assert.equal(job.workflow["69"], undefined);
  assert.equal(job.metadata.imageSettings.finalStage, "krea");
});

test("Krea Triple può applicare SeedVR2 direttamente all'ultimo stadio rimasto", () => {
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    prompt: "A detailed still life.",
    kreaTripleUseZImage: "false",
    kreaTripleUseKlein: "false",
    kreaTripleUseSeedVR2: "true",
    seed: 47,
  }, { references: [] });

  assert.deepEqual(job.workflow["42"].inputs.image, ["9", 0]);
  assert.ok(job.workflow["69"]);
  assert.deepEqual(job.workflow["49"].inputs.images, ["45", 0]);
  assert.equal(job.metadata.imageSettings.finalStage, "seedvr2");
});

test("Krea Triple Image to Image richiede source e usa denoise regolabile", () => {
  assert.throws(() => buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "img2img",
    prompt: "Transform the source photo.",
  }, { references: [] }), /fotografia sorgente/);

  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "img2img",
    prompt: "Transform the source photo.",
    kreaTripleDenoise: 0.45,
    imageWidth: 1024,
    imageHeight: 1024,
  }, { source, references: [] });

  assert.equal(job.metadata.imageSettings.staticWorkflow, "KreaTriple_I2I_API.json");
  assert.equal(job.workflow["970100"].class_type, "LoadImage");
  assert.equal(job.workflow["970100"].inputs.image, "remote/pool.jpg");
  assert.equal(job.workflow["970102"].class_type, "VAEEncode");
  assert.deepEqual(job.workflow["8"].inputs.latent_image, ["970102", 0]);
  assert.equal(job.workflow["8"].inputs.denoise, 0.45);
});

test("Krea Triple Selective richiede maschera e protegge il fuori maschera", () => {
  assert.throws(() => buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "selective",
    prompt: "Modify only the selected area.",
  }, { source, references: [] }), /maschera manuale/);

  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "selective",
    prompt: "Modify only the selected area.",
    kreaTripleDenoise: 0.3,
    maskGrow: 12,
    maskFeather: 8,
    imageWidth: 1024,
    imageHeight: 1024,
  }, { source, mask, references: [] });

  assert.equal(job.metadata.imageSettings.staticWorkflow, "KreaTriple_Masked_API.json");
  assert.equal(job.workflow["970110"].inputs.image, "remote/mask.png");
  assert.equal(job.workflow["970126"].class_type, "ImageCompositeMasked");
  assert.deepEqual(job.workflow["970126"].inputs.destination, ["970121", 0]);
  assert.deepEqual(job.workflow["970126"].inputs.source, ["45", 0]);
  assert.deepEqual(job.workflow["49"].inputs.images, ["970126", 0]);
  assert.equal(job.metadata.maskImage, "remote/mask.png");
  assert.equal(job.metadata.imageSettings.denoise, 0.3);
});

test("Editor Guidato unifica inserimento, posizione, reference e maschera protetta", () => {
  const references = [
    { name: "identity.png" },
    { name: "pose.png" },
  ];
  const [job] = buildStudioJobs("guidedEdit", {
    editAction: "addPerson",
    prompt: "Donna adulta in costume rosso.",
    spatialInstruction: "alla mia destra dentro la piscina",
    subjectInteraction: "mi guarda con una mano sulla mia spalla",
    depthRelation: "beside the principal subject at the same depth",
    contactInstruction: "immersa fino alla vita con riflessi e increspature",
    preserveInstruction: "il mio volto, corpo, posa e lo sfondo",
    placement: JSON.stringify({ x: 0.56, y: 0.25, width: 0.28, height: 0.6 }),
    structureGuide: "none",
    alternatives: 2,
    imageWidth: 1600,
    imageHeight: 900,
  }, { source, mask, references });

  assert.equal(job.workflow["1"].inputs.unet_name, "QWEN\\qwen_image_edit_2511_bf16.safetensors");
  assert.equal(job.metadata.guidedSamplingProfile, "native-quality");
  assert.equal(job.metadata.imageSettings.steps, 28);
  assert.equal(job.metadata.imageSettings.guidance, 4);
  assert.equal(job.metadata.editAction, "addPerson");
  assert.equal(job.metadata.referenceCount, 2);
  assert.deepEqual(job.metadata.placement, { x: 0.56, y: 0.25, width: 0.28, height: 0.6 });
  assert.match(job.metadata.prompt, /Target box.+left 56%/);
  assert.match(job.metadata.prompt, /immersa fino alla vita/i);
  assert.equal(job.workflow["949900"].class_type, "ImageBlur");
  assert.equal(job.workflow["949901"].class_type, "ImageBlend");
  assert.deepEqual(job.workflow["21"].inputs.image, ["949901", 0]);
  assert.equal(
    Object.values(job.workflow).some((node) => node.class_type === "DaSiWa_RTX_UpscalerRefiner"),
    false,
  );
  assert.equal(job.workflow["950110"].class_type, "ImageCompositeMasked");
  assert.deepEqual(job.workflow["950110"].inputs.destination, ["20", 0]);
  assert.equal(job.metadata.protectedEdit, true);
});

test("Editor Guidato ricompone il gruppo quando il nuovo soggetto va tra due persone", () => {
  assert.equal(resolveGuidedCompositionPolicy({
    editAction: "addPerson",
    spatialInstruction: "at the center of the two characters",
  }), "recomposeGroup");
  const [job] = buildStudioJobs("guidedEdit", {
    editAction: "addPerson",
    prompt: "Insert Marco between the two original adults.",
    subjectName: "Marco",
    spatialInstruction: "at the center of the two characters",
    placement: JSON.stringify({ x: 0.38, y: 0.12, width: 0.24, height: 0.78 }),
    compositionPolicy: "auto",
    structureGuide: "none",
    alternatives: 2,
    imageWidth: 1280,
    imageHeight: 720,
  }, { source, mask, references: [{ name: "identity-front.png" }, { name: "identity-face.png" }] });

  assert.equal(job.metadata.compositionPolicy, "recomposeGroup");
  assert.equal(job.metadata.protectedEdit, false);
  assert.equal(job.workflow["950110"], undefined);
  assert.match(job.metadata.prompt, /RECOMPOSE THE GROUP/i);
  assert.match(job.metadata.prompt, /overrides generic instructions/i);
  assert.doesNotMatch(job.metadata.negativePrompt, /change the composition/i);
});

test("Qwen 2511 usa sampling nativo qualità senza Lightning e 4 step con la LoRA", () => {
  const raw = {
    editAction: "addPerson",
    prompt: "Insert one adult in the marked free space.",
    qwenEditModel: "QWEN\\qwen_image_edit_2511_bf16.safetensors",
    placement: JSON.stringify({ x: 0.4, y: 0.1, width: 0.2, height: 0.8 }),
    structureGuide: "none",
    alternatives: 2,
    imageWidth: 1280,
    imageHeight: 720,
  };
  const [native] = buildStudioJobs("guidedEdit", raw, { source, references: [{ name: "identity.png" }] });
  assert.equal(native.metadata.imageSettings.steps, 28);
  assert.equal(native.metadata.imageSettings.guidance, 4);
  assert.equal(native.metadata.guidedSamplingProfile, "native-quality");

  const [accelerated] = buildStudioJobs("guidedEdit", raw, { source, references: [{ name: "identity.png" }] }, [{
    name: "QWEN\\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
    strength: 1,
  }]);
  assert.equal(accelerated.metadata.imageSettings.steps, 4);
  assert.equal(accelerated.metadata.imageSettings.guidance, 1);
  assert.equal(accelerated.metadata.guidedSamplingProfile, "lightning-4");
});

test("Editor Guidato applica il ControlNet Canny Qwen prima del sampler", () => {
  const [job] = buildStudioJobs("guidedEdit", {
    editAction: "modify",
    prompt: "Mantieni la geometria e cambia i materiali.",
    structureGuide: "canny",
    structureStrength: 0.7,
    cannyLow: 0.2,
    cannyHigh: 0.8,
    alternatives: 2,
    imageWidth: 1024,
    imageHeight: 1024,
  }, { source, mask, guide: { name: "layout.png" }, references: [] });

  assert.equal(job.workflow["960001"].class_type, "Canny");
  assert.equal(job.workflow["960002"].inputs.name, "qwen_image_canny_diffsynth_controlnet.safetensors");
  assert.equal(job.workflow["960003"].class_type, "QwenImageDiffsynthControlnet");
  assert.deepEqual(job.workflow["8"].inputs.model, ["960003", 0]);
  assert.deepEqual(job.metadata.structureGuide, {
    type: "canny",
    strength: 0.7,
    separateImage: true,
  });
});

test("Editor Guidato può usare anche un modello Flux.2 Klein selezionato", () => {
  const [job] = buildStudioJobs("guidedEdit", {
    guidedModelFamily: "klein",
    guidedKleinModel: "FLUX2\\flux2Klein_9bBase.safetensors",
    editAction: "addPerson",
    prompt: "Aggiungi una persona adulta vicino al soggetto principale.",
    structureGuide: "none",
    alternatives: 2,
    imageWidth: 1024,
    imageHeight: 1024,
  }, { source, mask, references: [{ name: "identity.png" }] });

  assert.equal(job.metadata.imageModelFamily, "flux2");
  assert.equal(job.metadata.imageModelFile, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(job.metadata.guidedModelFamily, "flux2");
  assert.equal(job.metadata.imageSettings.steps, 20);
  assert.equal(job.metadata.imageSettings.guidance, 5);
  assert.equal(job.metadata.imageSettings.imageRecipe, "klein4b");
  assert.deepEqual(job.workflow["14"].inputs.latent_image, ["22", 0]);
  assert.equal(job.metadata.protectedEdit, true);
});

test("Smartphone Editor crea alternative protette da maschera", () => {
  const jobs = buildStudioJobs("smartphone", {
    prompt: "Inserisci una donna adulta nella piscina.",
    alternatives: 2,
    imageWidth: 4032,
    imageHeight: 3024,
    maskGrow: 32,
    maskFeather: 24,
  }, { source, mask, references: [] });

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].workflow["1"].inputs.unet_name, "FLUX2\\pornmasterFlux2Klein_v4TurboFp8.safetensors");
  assert.equal(jobs[0].workflow["950105"].class_type, "ImageCropByMaskAndResize");
  assert.equal(jobs[0].workflow["950105"].inputs.padding, 431);
  assert.deepEqual(jobs[0].workflow["22"].inputs.pixels, ["950105", 0]);
  assert.equal(jobs[0].workflow["950113"].class_type, "ImageCompositeMasked");
  assert.deepEqual(jobs[0].workflow["950113"].inputs.destination, ["20", 0]);
  assert.deepEqual(jobs[0].workflow["16"].inputs.images, ["950114", 0]);
  assert.equal(jobs[0].metadata.protectedEdit, true);
  assert.ok(jobs[0].metadata.width * jobs[0].metadata.height <= 2_050_000);
});

test("Inpainting automatico usa SAM e GroundingDINO", () => {
  const [job] = buildStudioJobs("inpaint", {
    prompt: "Cambia il colore dell'acqua.",
    maskTarget: "swimming pool water",
    alternatives: 2,
    imageWidth: 1600,
    imageHeight: 900,
  }, { source, references: [] });
  assert.equal(job.workflow["950102"].class_type, "LayerMask: SegmentAnythingUltra V2");
  assert.equal(job.workflow["950102"].inputs.prompt, "swimming pool water");
});

test("Inpainting automatico può usare Florence 2 per la segmentazione semantica", () => {
  const [job] = buildStudioJobs("inpaint", {
    prompt: "Cambia il colore dell'acqua.",
    maskTarget: "swimming pool water",
    autoMaskEngine: "florence",
    alternatives: 2,
    imageWidth: 1600,
    imageHeight: 900,
  }, { source, references: [] });
  assert.equal(job.workflow["950090"].class_type, "LayerMask: LoadFlorence2Model");
  assert.equal(job.workflow["950102"].class_type, "LayerMask: Florence2Ultra");
  assert.equal(job.workflow["950102"].inputs.text_input, "swimming pool water");
});

test("Multi-Reference Composer concatena persona, posa e stile", () => {
  const references = [
    { name: "person.png" },
    { name: "pose.png" },
    { name: "style.png" },
  ];
  const [job] = buildStudioJobs("multiReference", {
    prompt: "Combina le reference.",
    alternatives: 2,
    imageWidth: 1152,
    imageHeight: 896,
  }, { source, references });
  assert.equal(job.metadata.referenceCount, 3);
  assert.equal(job.workflow["35"].inputs.image, "style.png");
});

test("Storyboard genera shot separati dalle stesse reference master", () => {
  const jobs = buildStudioJobs("storyboard", {
    prompt: "Una sequenza alla piscina.",
    globalStyle: "golden hour, Kodak Portra",
    shots: JSON.stringify([
      { title: "Establishing", prompt: "Campo largo." },
      { title: "Close-up", prompt: "Primo piano." },
      { title: "Ending", prompt: "Campo largo finale." },
    ]),
    imageWidth: 1344,
    imageHeight: 768,
  }, { source, references: [{ name: "character.png" }] });
  assert.equal(jobs.length, 3);
  assert.deepEqual(jobs.map((job) => job.metadata.shotIndex), [1, 2, 3]);
  assert.ok(jobs.every((job) => job.metadata.sourceImage === "remote/pool.jpg"));
  assert.ok(jobs.every((job) =>
    job.metadata.imageModelFile === "FLUX2\\flux2Klein_9bBase.safetensors"
  ));
  assert.ok(jobs.every((job) => job.metadata.storyboardModelProfile === "quality"));
  assert.match(jobs[1].metadata.prompt, /standalone full-resolution cinematic frame/i);
});

test("Storyboard usa i modelli qualità Qwen 2511 e Flux.2 Klein installati", () => {
  const base = {
    prompt: "Sequenza coerente.",
    shots: JSON.stringify([
      { title: "Shot 1", prompt: "Campo largo." },
      { title: "Shot 2", prompt: "Primo piano." },
    ]),
    imageWidth: 1152,
    imageHeight: 896,
  };
  const [klein] = buildStudioJobs("storyboard", {
    ...base,
    storyboardFamily: "klein",
  }, { source, references: [] });
  const [qwen] = buildStudioJobs("storyboard", {
    ...base,
    storyboardFamily: "qwen2511",
  }, { source, references: [] });
  assert.equal(klein.metadata.imageModelFile, "FLUX2\\flux2Klein_9bBase.safetensors");
  assert.equal(klein.workflow["1"].class_type, "UNETLoader");
  assert.equal(qwen.metadata.imageModelFile, "QWEN\\qwen_image_edit_2511_bf16.safetensors");
  assert.equal(qwen.workflow["1"].class_type, "UNETLoader");
  assert.equal(qwen.metadata.imageModelFamily, "qwenEdit");
});

test("Elenco scene produce esattamente un lavoro per prompt con ANIMA, DUO, Klein e Qwen", () => {
  const [anima] = buildStudioJobs("anima", {
    prompt: "Scena anime singola.",
    promptBatchItem: "true",
    animaInputMode: "text",
    animaModel: "ANIMA\\anima_turboV11.safetensors",
    animaOutputs: 1,
  }, {});
  assert.equal(anima.metadata.imageModelFamily, "anima");

  const duoJobs = buildStudioJobs("duoScene", {
    prompt: "I due personaggi corrono.",
    promptBatchItem: "true",
    duoHasFemale: "true",
    alternatives: 1,
  }, { source: { name: "man.png" }, references: [{ name: "woman.png" }] });
  assert.equal(duoJobs.length, 1);

  for (const family of ["klein", "qwenImage", "krea2"]) {
    const jobs = buildStudioJobs("storyboard", {
      prompt: `Scena ${family}.`,
      promptBatchItem: "true",
      storyboardFamily: family,
    }, { references: [] });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].metadata.promptBatchItem, true);
  }
});

test("il master Smartphone ricompone il refine Krea2 sull'immagine selezionata", () => {
  const final = buildStudioContinuation("finalize", {
    studioMode: "smartphone",
    prompt: "Rifinisci soltanto la persona inserita.",
    imageWidth: 1600,
    imageHeight: 900,
    maskUpload: mask,
    upscaleMode: "none",
  }, { name: "selected.png" });
  assert.equal(final.workflow["950110"].class_type, "ImageCompositeMasked");
  assert.deepEqual(final.workflow["950110"].inputs.destination, ["20", 0]);
  assert.equal(final.workflow["950112"].inputs.filename_prefix, "Studio/smartphone/08_finale_protetto");
  assert.equal(final.metadata.beforeAfterTail, true);
});
