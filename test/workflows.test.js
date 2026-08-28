import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildFirstLastWorkflow, buildWorkflow, videoModelConfig } from "../src/workflows.js";

const upload = { name: "frame.png", subfolder: "remote", type: "input" };
const base = {
  prompt: "Camera pushes in.",
  negativePrompt: "artifacts",
  resolution: "480p",
  orientation: "portrait",
  duration: "8",
  quality: "preview",
  seed: "1234",
};

test("configura il workflow standard", () => {
  const { workflow, metadata } = buildWorkflow("standard", base, upload);
  assert.equal(workflow["436"].inputs.image, "remote/frame.png");
  assert.equal(workflow["121"].inputs.text, base.prompt);
  assert.equal(workflow["110"].inputs.text, base.negativePrompt);
  assert.equal(workflow["292"].inputs.value, 480);
  assert.equal(workflow["293"].inputs.value, 832);
  assert.equal(workflow["458"].inputs.value, 24);
  assert.equal(workflow["439"].inputs.seed, 1234);
  assert.equal(workflow["550"].inputs.sage_attention, "auto");
  assert.equal(workflow["544"].class_type, "DualCLIPLoader");
  assert.equal(workflow["445"].inputs.length, 193);
  assert.equal(workflow["450"].inputs.frames_number, 193);
  assert.equal(metadata.duration, 8);
});

test("configura 1Work Text-to-Video senza richiedere un'immagine", () => {
  const { workflow, metadata } = buildWorkflow("standard", {
    ...base,
    videoInputMode: "text",
  }, null);
  assert.equal(workflow["445"].inputs.width, 480);
  assert.equal(workflow["445"].inputs.height, 832);
  assert.equal(workflow["558"].inputs["num_images.image_1"], undefined);
  assert.equal(workflow["560"].inputs["num_images.image_1"], undefined);
  assert.equal(metadata.inputMode, "text");
  assert.equal(metadata.sourceImage, null);
});

test("la lista modelli video non espone piu' Sulphur full model", () => {
  const config = videoModelConfig([]);
  assert.equal(config.some((item) => item.id === "sulphur"), false);
});

test("configura Dev FP8 mantenendo lo stesso seed nei due passaggi", () => {
  const { workflow } = buildWorkflow("devfp8", { ...base, quality: "max" }, upload);
  assert.equal(workflow["114"].inputs.noise_seed, 1234);
  assert.equal(workflow["115"].inputs.noise_seed, 1234);
  assert.equal(workflow["463"].inputs.modalita, "QUALITA MASSIMA • FINALE");
  assert.equal(workflow["289"].inputs.sage_attention, "auto");
  assert.equal(workflow["108"].inputs.length, 193);
  assert.equal(workflow["171"].inputs.frames_number, 193);
  assert.equal(workflow["135"].inputs.sampler_name, "euler");
  assert.equal(workflow["136"].inputs.sampler_name, "euler");
  assert.equal(workflow["128"].inputs.cfg, 1);
  assert.equal(workflow["103"].inputs.cfg, 1);
});

test("configura MiniMax H3 INT8 con una reference e due passaggi audio-video", () => {
  const { workflow, metadata } = buildWorkflow("minimaxH3", base, upload);
  assert.equal(workflow["83"].inputs.value, base.prompt);
  assert.equal(workflow["84"].inputs.value, 8);
  assert.equal(workflow["97"].inputs.image, "remote/frame.png");
  assert.equal(workflow["108"].inputs.width, 480);
  assert.equal(workflow["108"].inputs.height, 832);
  assert.equal(workflow["108"].inputs.ref_image_size, "match");
  assert.deepEqual(workflow["108"].inputs["ref_images.ref_image_0"], ["99", 0]);
  assert.equal(workflow["108"].inputs["ref_images.ref_image_1"], undefined);
  assert.equal(workflow["243"].inputs.noise_seed, 1234);
  assert.equal(workflow["300"].inputs.noise_seed, 1234);
  assert.equal(workflow["291"].inputs.width, 480);
  assert.equal(workflow["291"].inputs.height, 832);
  assert.equal(workflow["293"].class_type, "LTXVConcatAVLatent");
  assert.equal(workflow["101"], undefined);
  assert.equal(metadata.workflowId, "minimaxH3");
  assert.equal(metadata.videoModelId, "minimax-h3-int8");
  assert.equal(metadata.sourceImage, "remote/frame.png");
  assert.deepEqual(metadata.loras, [{
    name: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    strength: 1,
  }]);
});

test("configura Dev FP8 Text-to-Video bypassando entrambe le guide immagine", () => {
  const { workflow, metadata } = buildWorkflow("devfp8", {
    ...base,
    videoInputMode: "text",
  }, null);
  assert.equal(workflow["239"].inputs.value, true);
  assert.equal(workflow["153"].inputs.bypass, true);
  assert.equal(workflow["154"].inputs.bypass, true);
  assert.deepEqual(workflow["153"].inputs.image, ["111", 0]);
  assert.deepEqual(workflow["154"].inputs.image, ["111", 0]);
  assert.equal(metadata.inputMode, "text");
});

test("costruisce LTX 2.3 Sulphur Text-to-Video dedicato", () => {
  const { workflow, metadata } = buildWorkflow("ltxSulphur", {
    ...base,
    videoInputMode: "text",
  }, null);
  assert.equal(workflow["44"].class_type, "CheckpointLoaderSimple");
  assert.equal(workflow["44"].inputs.ckpt_name, "ltx-2.3-22b-dev-fp8.safetensors");
  assert.equal(workflow["990410"], undefined);
  assert.equal(workflow["29"].inputs.value, base.prompt);
  assert.equal(workflow["30"].inputs.text, base.prompt);
  assert.equal(workflow["41"].inputs.text, base.negativePrompt);
  assert.equal(workflow["49"].inputs.lora_name, "LTX2.3\\ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors");
  assert.equal(workflow["49"].inputs.strength_model, 0.5);
  assert.deepEqual(workflow["59"].inputs.model, ["49", 0]);
  assert.equal(workflow["59"].inputs.lora_name, "LTX2.3\\sulphur_lora_rank_768.safetensors");
  assert.equal(workflow["59"].inputs.strength_model, 1);
  assert.equal(workflow["27"].inputs.value, 193);
  assert.equal(workflow["40"].inputs.value, 480);
  assert.equal(workflow["25"].inputs.value, 832);
  assert.equal(workflow["18"].class_type, "PrimitiveInt");
  assert.equal(workflow["18"].inputs.value, 240);
  assert.equal(workflow["20"].class_type, "PrimitiveInt");
  assert.equal(workflow["20"].inputs.value, 416);
  assert.equal(workflow["24"].class_type, "PrimitiveFloat");
  assert.equal(workflow["24"].inputs.value, 24);
  assert.equal(workflow["47"].inputs.steps, 12);
  assert.deepEqual(workflow["21"].inputs.width, ["18", 0]);
  assert.deepEqual(workflow["21"].inputs.height, ["20", 0]);
  assert.deepEqual(workflow["33"].inputs.frame_rate, ["24", 0]);
  assert.equal(workflow["1"].inputs.noise_seed, 1234);
  assert.equal(workflow["2"].inputs.noise_seed, 1234);
  assert.deepEqual(workflow["8"].inputs.model, ["59", 0]);
  assert.deepEqual(workflow["42"].inputs.model, ["59", 0]);
  assert.deepEqual(workflow["43"].inputs.samples, ["35", 0]);
  assert.deepEqual(workflow["23"].inputs.samples, ["35", 1]);
  assert.deepEqual(workflow["13"].inputs.vae, ["44", 2]);
  assert.deepEqual(workflow["43"].inputs.vae, ["63", 0]);
  assert.equal(workflow["28"].inputs.value, true);
  assert.equal(workflow["990411"].class_type, "EmptyImage");
  assert.equal(metadata.workflowId, "ltxSulphur");
  assert.equal(metadata.videoModelId, "ltx23-sulphur");
  assert.equal(metadata.inputMode, "text");
  assert.equal(metadata.quality, "preview");
  assert.deepEqual(metadata.loras, [
    {
      name: "LTX2.3\\ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
      strength: 0.5,
    },
    {
      name: "LTX2.3\\sulphur_lora_rank_768.safetensors",
      strength: 1,
    },
  ]);
});

test("costruisce LTX 2.3 Sulphur Image-to-Video dedicato", () => {
  const { workflow, metadata } = buildWorkflow("ltxSulphur", base, upload);
  assert.equal(workflow["67"].inputs.image, "remote/frame.png");
  assert.equal(workflow["68"].class_type, "ImageResizeKJv2");
  assert.equal(workflow["68"].inputs.width, 240);
  assert.equal(workflow["68"].inputs.height, 416);
  assert.equal(workflow["14"].inputs.bypass, false);
  assert.equal(workflow["22"].inputs.bypass, false);
  assert.equal(metadata.sourceImage, "remote/frame.png");
  assert.equal(metadata.videoModelName, "LTX 2.3 Dev + Sulphur LoRA");
});

test("configura storyboard Director con immagini e prompt in sequenza", () => {
  const secondUpload = { name: "frame-2.png", subfolder: "remote", type: "input" };
  const scenes = [
    { prompt: "Camera pushes in.", duration: 4, upload },
    { prompt: "The subject turns toward the window.", duration: 3, upload: null },
    { prompt: "Wide closing shot.", duration: 5, upload: secondUpload },
  ];
  const { workflow, metadata } = buildWorkflow(
    "director",
    { ...base, directorGlobalPrompt: "Same character and cinematic lighting." },
    null,
    scenes,
  );
  const timeline = JSON.parse(workflow["672"].inputs.timeline_data);
  assert.equal(timeline.segments[0].imageFile, "remote/frame.png");
  assert.equal(timeline.segments[0].start, 0);
  assert.equal(timeline.segments[0].length, 96);
  assert.equal(timeline.segments[1].type, "text");
  assert.equal(timeline.segments[1].start, 96);
  assert.equal(timeline.segments[1].length, 72);
  assert.equal(timeline.segments[2].imageFile, "remote/frame-2.png");
  assert.equal(timeline.segments[2].start, 168);
  assert.equal(timeline.global_prompt, "Same character and cinematic lighting.");
  assert.equal(workflow["672"].inputs.local_prompts, scenes.map((scene) => scene.prompt).join(" | "));
  assert.equal(workflow["672"].inputs.segment_lengths, "96,72,120");
  assert.equal(workflow["672"].inputs.duration_frames, 288);
  assert.equal(workflow["672"].inputs.guide_strength, "1.00,1.00");
  assert.equal(workflow["672"].inputs.frame_rate, 24);
  assert.equal(workflow["726"], undefined);
  assert.equal(workflow["900002"].inputs.value, 480);
  assert.equal(workflow["900003"].inputs.value, 832);
  assert.deepEqual(workflow["672"].inputs.custom_width, ["900002", 0]);
  assert.deepEqual(workflow["672"].inputs.custom_height, ["900003", 0]);
  assert.equal(workflow["654"].inputs.noise_seed, 1234);
  assert.equal(workflow["900001"].inputs.text, base.negativePrompt);
  assert.equal(metadata.duration, 12);
  assert.equal(metadata.sceneCount, 3);
  assert.equal(metadata.inputMode, "image");
});

test("LTX 2.3 Sulphur Massima conserva risoluzione e usa il profilo a 24 step", () => {
  const { workflow, metadata } = buildWorkflow("ltxSulphur", {
    ...base,
    quality: "max",
    resolution: "720p",
    orientation: "landscape",
  }, upload);
  assert.equal(workflow["40"].inputs.value, 1280);
  assert.equal(workflow["25"].inputs.value, 704);
  assert.equal(workflow["1"].inputs.noise_seed, 1234);
  assert.equal(workflow["2"].inputs.noise_seed, 1234);
  assert.equal(workflow["47"].inputs.steps, 24);
  assert.deepEqual(workflow["43"].inputs.samples, ["37", 0]);
  assert.deepEqual(workflow["23"].inputs.samples, ["37", 1]);
  assert.equal(metadata.quality, "max");
});

test("Director accetta anche uno storyboard solo testuale", () => {
  const { workflow } = buildWorkflow("director", base, null, [
    { prompt: "A landscape emerges from mist.", duration: 6, upload: null },
  ]);
  const timeline = JSON.parse(workflow["672"].inputs.timeline_data);
  assert.equal(timeline.segments[0].type, "text");
  assert.equal(timeline.segments[0].imageFile, undefined);
});

test("Director usa 480p se una pagina precedente non invia la risoluzione", () => {
  const { workflow, metadata } = buildWorkflow("director", {
    ...base,
    resolution: undefined,
  }, null, [
    { prompt: "A landscape emerges from mist.", duration: 6, upload: null },
  ]);
  assert.equal(metadata.resolution, "480p");
  assert.equal(workflow["900002"].inputs.value, 480);
  assert.equal(workflow["900003"].inputs.value, 832);
});

test("configura il workflow V2V Edit Anything con video e impostazioni avanzate", () => {
  const video = { name: "source video.mp4", subfolder: "remote", type: "input" };
  const { workflow, metadata } = buildWorkflow("editAnything", {
    ...base,
    videoModelId: "normal",
    maxDimension: "1280",
    steps: "12",
    cfg: "1.5",
    nagScale: "9",
    editStrength: "0.8",
    promptEnhancer: "on",
    useInputAudio: "on",
  }, video);

  assert.equal(workflow["840"].inputs.video, "remote/source video.mp4");
  assert.equal(workflow["5322"].inputs.value, base.prompt);
  assert.equal(workflow["5318"].inputs.text, base.negativePrompt);
  assert.equal(workflow["5334"].inputs.value, 8);
  assert.equal(workflow["77"].inputs.noise_seed, 1234);
  assert.equal(workflow["846"].inputs.value, 1280);
  assert.equal(workflow["94"].inputs.steps, 12);
  assert.equal(workflow["93"].inputs.cfg, 1.5);
  assert.equal(workflow["5389"].inputs.nag_scale, 9);
  assert.equal(workflow["5343"].inputs.lora_1.strength, 0.8);
  assert.equal(workflow["218"], undefined);
  assert.deepEqual(workflow["5343"].inputs.model, ["219", 0]);
  assert.equal(workflow["5324"].inputs.value, true);
  assert.equal(workflow["5414"].inputs.value, true);
  assert.equal(metadata.sourceVideo, "remote/source video.mp4");
  assert.equal(metadata.sourceImage, null);
  assert.equal(metadata.resolution, "1280px max");
  assert.equal(metadata.width, null);
  assert.equal(metadata.editSettings.steps, 12);
  assert.equal(workflow["5368"], undefined);
  assert.equal(workflow["990100"].class_type, "CreateVideo");
  assert.deepEqual(workflow["990100"].inputs.images, ["5355", 0]);
  assert.equal(workflow["990101"].class_type, "SaveVideo");
  assert.deepEqual(workflow["990101"].inputs.video, ["990100", 0]);
});

test("V2V disabilita per default la LoRA aggiuntiva specifica del template", () => {
  const video = { name: "source.mp4", subfolder: "", type: "input" };
  const { workflow } = buildWorkflow("editAnything", base, video);
  assert.equal(workflow["218"], undefined);
  assert.deepEqual(workflow["5343"].inputs.model, ["219", 0]);
  assert.equal(workflow["5324"].inputs.value, false);
  assert.equal(workflow["5414"].inputs.value, true);
});

test("V2V usa 1280 px come lato massimo predefinito", () => {
  const video = { name: "source.mp4", subfolder: "", type: "input" };
  const { workflow, metadata } = buildWorkflow("editAnything", base, video);
  assert.equal(workflow["846"].inputs.value, 1280);
  assert.equal(metadata.resolution, "1280px max");
});

test("Edit Anything usa LTX 2.3 normale per default", () => {
  const video = { name: "source.mp4", subfolder: "", type: "input" };
  const defaultBuild = buildWorkflow("editAnything", base, video);
  assert.equal(
    defaultBuild.workflow["219"].inputs.unet_name,
    "LTX2.3\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
  );
  assert.equal(defaultBuild.workflow["216"].class_type, "DualCLIPLoader");
  assert.equal(defaultBuild.workflow["218"], undefined);
  assert.deepEqual(defaultBuild.workflow["5343"].inputs.model, ["219", 0]);
});

test("il template API Edit Anything non contiene modello o LoRA legacy", () => {
  const template = JSON.parse(fs.readFileSync(
    new URL("../workflows/LTX23_V2V_EDIT_ANYTHING_API.json", import.meta.url),
    "utf8",
  ));
  assert.equal(template["218"], undefined);
  assert.equal(
    template["219"].inputs.unet_name,
    "LTX2.3\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
  );
  assert.deepEqual(template["5343"].inputs.model, ["219", 0]);
  assert.equal(template["846"].inputs.value, 1280);
});

test("rifiuta un modello video LTX non riconosciuto", () => {
  assert.throws(
    () => buildWorkflow("standard", { ...base, videoModelId: "missing" }, upload),
    /Modello video LTX 2\.3 non valido/,
  );
});

test("inserisce più LoRA nella catena MODEL di ogni workflow video", () => {
  const loras = [
    { name: "LTX2.3\\first.safetensors", strength: 0.7 },
    { name: "LTX2.3\\second.safetensors", strength: 1.1 },
  ];
  const cases = [
    {
      id: "standard",
      upload,
      scenes: [],
      consumers: ["547", "548"],
      source: ["550", 0],
    },
    {
      id: "devfp8",
      upload,
      scenes: [],
      consumers: ["289"],
      source: ["466", 0],
    },
    {
      id: "director",
      upload: null,
      scenes: [{ prompt: "A slow push in.", duration: 4, upload }],
      consumers: ["741"],
      source: ["724", 0],
    },
    {
      id: "editAnything",
      upload: { name: "source.mp4", subfolder: "", type: "input" },
      scenes: [],
      consumers: ["198"],
      source: ["5343", 0],
    },
  ];

  for (const item of cases) {
    const { workflow, metadata } = buildWorkflow(item.id, base, item.upload, item.scenes, loras);
    const finalLink = workflow[item.consumers[0]].inputs.model;
    for (const consumer of item.consumers) assert.deepEqual(workflow[consumer].inputs.model, finalLink);
    const second = workflow[finalLink[0]];
    const first = workflow[second.inputs.model[0]];
    assert.equal(second.inputs.lora_name, loras[1].name);
    assert.equal(first.inputs.lora_name, loras[0].name);
    assert.deepEqual(first.inputs.model, item.source);
    assert.deepEqual(metadata.loras, loras);
  }
});

test("configura LTX 2.3 con primo e ultimo fotogramma", () => {
  const { workflow, metadata } = buildFirstLastWorkflow({
    prompt: "La camera avanza mentre il soggetto entra in acqua.",
    negativePrompt: "",
    resolution: "480p",
    orientation: "landscape",
    duration: 5,
    cameraMotion: "dolly in",
    motionIntensity: "low",
    audioMode: "silent",
  }, { name: "first.png" }, { name: "last.png" });

  assert.equal(workflow["436"].inputs.image, "first.png");
  assert.equal(workflow["980001"].inputs.image, "last.png");
  assert.equal(workflow["558"].inputs.num_images, "2");
  assert.deepEqual(workflow["558"].inputs["num_images.image_2"], ["980003", 0]);
  assert.equal(workflow["558"].inputs["num_images.index_2"], 120);
  assert.equal(workflow["560"].inputs["num_images.index_2"], 120);
  assert.equal(workflow["492"].inputs.audio, undefined);
  assert.equal(metadata.workflowId, "firstLast");
  assert.equal(metadata.lastFrame, "last.png");
});
