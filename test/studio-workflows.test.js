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
      "storyboard",
      "firstLast",
      "bible",
      "qwenKreaKlein",
      "animeToReal",
      "kreaTriple",
    ],
  );
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
  assert.equal(job.workflow["413"].inputs.unet_name, "FLUX1D\\moodyKrea2Mix_v50.safetensors");
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
  assert.equal(job.workflow["2"].inputs.unet_name, "FLUX1D\\darkBeast30BF16INT8_darkBeastKREA2FP8.safetensors");
  assert.equal(job.metadata.imageSettings.kreaModelId, "darkBeast");
  assert.equal(job.workflow["5"].inputs.text, "Realistic editorial poolside portrait.");
  assert.equal(job.workflow["15"].inputs.text, "Realistic editorial poolside portrait.");
  assert.equal(job.workflow["59"].inputs.text, "Realistic editorial poolside portrait.");
  assert.equal(job.workflow["8"].inputs.seed, 123);
  assert.equal(job.workflow["17"].inputs.seed, 124);
  assert.equal(job.workflow["29"].inputs.noise_seed, 125);
  assert.equal(job.workflow["99"].inputs.cache_model, true);
  assert.equal(job.workflow["99"].inputs.attention_mode, "sdpa");
  assert.equal(job.workflow["23"].inputs.use_custom_resolution, true);
});

test("Krea Triple permette Moody e registra l'ancoraggio prompt dedicato", () => {
  const moody = "FLUX1D\\moodyKrea2Mix_v50.safetensors";
  const [job] = buildStudioJobs("kreaTriple", {
    kreaTripleOperation: "text",
    kreaTripleModel: moody,
    prompt: "A woman walking through a fantasy village.",
    seed: 7,
    imageWidth: 1152,
    imageHeight: 896,
  }, { references: [] });
  assert.equal(job.workflow["2"].inputs.unet_name, moody);
  assert.equal(job.metadata.imageSettings.kreaModelId, "moodyKrea");
  assert.equal(job.metadata.imageSettings.moodyPromptAnchor, true);
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
    guidedKleinModel: "FLUX2\\BigLoveKlein4_bf16.safetensors",
    editAction: "addPerson",
    prompt: "Aggiungi una persona adulta vicino al soggetto principale.",
    structureGuide: "none",
    alternatives: 2,
    imageWidth: 1024,
    imageHeight: 1024,
  }, { source, mask, references: [{ name: "identity.png" }] });

  assert.equal(job.metadata.imageModelFamily, "flux2");
  assert.equal(job.metadata.imageModelFile, "FLUX2\\BigLoveKlein4_bf16.safetensors");
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
    job.metadata.imageModelFile === "FLUX2\\BigLoveKlein4_bf16.safetensors"
  ));
  assert.ok(jobs.every((job) => job.metadata.storyboardModelProfile === "quality"));
  assert.match(jobs[1].metadata.prompt, /standalone full-resolution cinematic frame/i);
});

test("Storyboard usa sempre i modelli qualità di BigLove Klein e BigLove Gwen", () => {
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
  const [gwen] = buildStudioJobs("storyboard", {
    ...base,
    storyboardFamily: "gwen",
  }, { source, references: [] });
  assert.equal(klein.metadata.imageModelFile, "FLUX2\\BigLoveKlein4_bf16.safetensors");
  assert.equal(klein.workflow["1"].class_type, "UNETLoader");
  assert.equal(gwen.metadata.imageModelFile, "QWEN\\BigLoveGwen2_mxfp8.safetensors");
  assert.equal(gwen.workflow["1"].class_type, "UNETLoader");
  assert.equal(gwen.metadata.imageModelFamily, "qwenEdit");
});

test("il master Smartphone ricompone il refine Flux.1 sull'immagine selezionata", () => {
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
