import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInteractiveCastUnionJob,
  buildVideoStudioInitialJob,
  buildVideoStudioLipdubJob,
  videoStudioConfig,
  videoStudioTemplateClasses,
} from "../src/video-studio-workflows.js";

const installed = {
  installedLoras: [
    "LTX2.3\\ltx-2.3-22b-distilled-lora-384-1.1.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-in-outpainting-0.9.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-lipdub-0.9.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors",
    "LTX2.3\\ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors",
    "LTX2.3\\my_identity.safetensors",
  ],
  installedCheckpoints: [
    "ltx-2.3-22b-dev-fp8.safetensors",
    "Sam3\\sam3.1_multiplex_fp16.safetensors",
  ],
  installedTextEncoders: ["gemma_3_12B_it_fp8_scaled.safetensors"],
  availableNodes: [
    "LTXVInpaintPreprocess",
    "LTXVDilateVideoMask",
    "LTXAddVideoICLoRAGuideAdvanced",
    "LTXICLoRALoaderModelOnly",
    "LTXVSetAudioRefTokens",
    "LTXAddVideoICLoRAGuide",
    "RepeatImageBatch",
    "LTXVSparseTrackEditor",
    "LTXVDrawTracks",
    "CannyEdgePreprocessor",
    "DWPreprocessor",
    "RemoteFaceSelectionPoint",
    "SAM3_Detect",
    "SAM3_VideoTrack",
    "SAM3_TrackToMask",
    "SAM3_TrackPreview",
    "ImageFromBatch",
    "ImageToMask",
    "CheckpointLoaderSimple",
    "LoadVideo",
    "GetVideoComponents",
    "LoadImage",
    "CreateVideo",
    "SaveVideo",
  ],
};

const config = videoStudioConfig(installed);
const sourceVideo = { name: "scene.mp4", subfolder: "remote", type: "input" };
const maskVideo = { name: "mask.mp4", subfolder: "remote", type: "input" };
const identityImage = { name: "identity.jpg", subfolder: "remote", type: "input" };
const identityLora = [{ name: "LTX2.3\\my_identity.safetensors", strength: 0.85 }];

test("rileva separatamente le dipendenze degli stadi Video Studio attivi", () => {
  assert.equal(config.capabilities.inpaint.available, true);
  assert.equal(config.capabilities.lipdub.available, true);
  assert.equal(config.capabilities.ingredients.available, true);
  assert.equal(config.capabilities.motionTrack.available, true);
  assert.equal(config.capabilities.unionControl.available, true);
  assert.equal(config.capabilities.autoMask.available, true);
  assert.equal(Object.keys(videoStudioTemplateClasses()).length, 6);
});

test("Actor Replacement solo viso usa LTX 2.3 tracked inpaint", () => {
  const job = buildVideoStudioInitialJob("actorReplacement", {
    actorEngine: "trackedInpaint",
    replacementScope: "face",
    selectionMode: "click",
    targetPointX: 0.72,
    targetPointY: 0.31,
    prompt: "Sostituisci soltanto il viso.",
  }, { sourceVideo, identityImage }, [], config);

  assert.equal(job.workflow["990302"].class_type, "RemoteFaceSelectionPoint");
  assert.equal(job.workflow["990302"].inputs.target_x, 0.72);
  assert.equal(job.workflow["5377"].class_type, "SAM3_TrackToMask");
  assert.match(job.workflow["2483"].inputs.text, /Only rebuild the face inside the tracked mask/i);
  assert.equal(job.metadata.engine, "trackedInpaint");
  assert.equal(job.metadata.replacementScope, "face");
});

test("non espone più Keyframe, Control Studio o il vecchio Face Swap", () => {
  assert.equal(config.capabilities.faceSwap, undefined);
  assert.equal(config.modes.some((item) => item.id === "controlStudio"), false);
  assert.equal(config.modes.some((item) => item.id === "keyframeInterpolation"), false);
  assert.equal(config.modes.some((item) => item.id === "sceneTransform"), true);
  assert.equal(config.engines.some((item) => item.id === "faceSwap"), false);
  assert.throws(
    () => buildVideoStudioInitialJob("controlStudio", {}, {}, [], config),
    /non riconosciuto/,
  );
  assert.throws(
    () => buildVideoStudioInitialJob("keyframeInterpolation", {}, {}, [], config),
    /non riconosciuto/,
  );
  assert.throws(
    () => buildVideoStudioInitialJob("actorReplacement", { actorEngine: "faceSwap" }, { sourceVideo, identityImage }, [], config),
    /vecchio Face Swap|Solo viso/i,
  );
});

test("Tracked Inpaint genera e propaga automaticamente la maschera con SAM3", () => {
  const job = buildVideoStudioInitialJob("actorReplacement", {
    actorEngine: "trackedInpaint",
    replacementScope: "head",
    selectionMode: "auto",
    targetFaceIndex: 2,
    prompt: "Sostituisci testa e capelli.",
  }, { sourceVideo, identityImage }, [], config);

  assert.equal(job.workflow["990300"].inputs.ckpt_name, "Sam3\\sam3.1_multiplex_fp16.safetensors");
  assert.equal(job.workflow["990302"].class_type, "RemoteFaceSelectionPoint");
  assert.equal(job.workflow["990302"].inputs.target_face_index, 2);
  assert.equal(job.workflow["990304"].class_type, "SAM3_VideoTrack");
  assert.equal(job.workflow["5377"].class_type, "SAM3_TrackToMask");
  assert.equal(job.workflow["5375"], undefined);
  assert.equal(job.metadata.maskMode, "auto");
});

test("Actor Replacement corpo completo usa Union Control per seguire posa e movimento", () => {
  const job = buildVideoStudioInitialJob("actorReplacement", {
    actorEngine: "unionControl",
    replacementScope: "body",
    controlType: "pose",
    prompt: "Sostituisci l'intera ballerina con la persona della reference.",
    seed: 77,
  }, { sourceVideo, identityImage }, [], config);

  assert.equal(job.workflow["5001"].inputs.file, "remote/scene.mp4");
  assert.equal(job.workflow["2004"].inputs.image, "remote/identity.jpg");
  assert.equal(job.workflow["5011"].inputs.lora_name, "LTX2.3\\ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors");
  assert.deepEqual(job.workflow["5028"].inputs.input, ["4986", 0]);
  assert.match(job.workflow["2483"].inputs.text, /motion and pose control/i);
  assert.equal(job.metadata.engine, "unionControl");
  assert.equal(job.metadata.replacementScope, "body");
});

test("Scene Transform V2V usa Union Control con video guida e frame target", () => {
  const job = buildVideoStudioInitialJob("sceneTransform", {
    prompt: "Sostituisci il muro dietro la piscina con una vista Bahamas.",
    controlType: "edges",
    editUseCase: "background",
    seed: 88,
  }, { guideVideo: sourceVideo, referenceSheet: identityImage }, [], config);

  assert.equal(job.workflow["5001"].inputs.file, "remote/scene.mp4");
  assert.equal(job.workflow["2004"].inputs.image, "remote/identity.jpg");
  assert.deepEqual(job.workflow["5028"].inputs.input, ["4991", 0]);
  assert.match(job.workflow["2483"].inputs.text, /Bahamas/);
  assert.equal(job.metadata.videoStudioMode, "sceneTransform");
  assert.equal(job.metadata.engine, "unionControl");
});

test("Interactive Cast usa il segmento originale come guida e l'anchor approvato come reference", () => {
  const job = buildInteractiveCastUnionJob({
    prompt: "Marco enters from the left and approaches the table.",
    negativePrompt: "subtitles",
    projectId: "cast-1",
    segmentId: "segment-2",
    duration: 5,
    quality: "preview",
    controlType: "edges",
    controlStrength: 1.15,
    seed: 91,
  }, { guideVideo: sourceVideo, referenceSheet: identityImage }, config);

  assert.equal(job.workflow["5001"].inputs.file, "remote/scene.mp4");
  assert.equal(job.workflow["2004"].inputs.image, "remote/identity.jpg");
  assert.deepEqual(job.workflow["5028"].inputs.input, ["4991", 0]);
  assert.match(job.workflow["2483"].inputs.text, /source clip is authoritative/i);
  assert.match(job.workflow["2483"].inputs.text, /Do not invent a different shot/i);
  assert.match(job.workflow["2483"].inputs.text, /Never render captions/i);
  assert.equal(job.metadata.videoStudioMode, "interactiveCast");
  assert.equal(job.metadata.preservationMode, "source-video-authoritative");
  assert.equal(job.metadata.restoreSourceAudio, true);
});

test("costruisce Actor Replacement con video, maschera, identità e LoRA", () => {
  const job = buildVideoStudioInitialJob("actorReplacement", {
    actorEngine: "trackedInpaint",
    replacementScope: "face",
    targetActor: "l’uomo a sinistra",
    prompt: "Usa il volto della reference.",
    transcript: "Bentornato.",
    duration: 10,
    seed: 123,
  }, { sourceVideo, maskVideo, identityImage }, identityLora, config);

  assert.equal(job.workflow["5368"].inputs.file, "remote/scene.mp4");
  assert.equal(job.workflow["5375"].inputs.file, "remote/mask.mp4");
  assert.equal(job.workflow["2004"].inputs.image, "remote/identity.jpg");
  assert.equal(job.workflow["3940"].inputs.ckpt_name, "ltx-2.3-22b-dev-fp8.safetensors");
  assert.equal(job.workflow["5011"].inputs.lora_name, installed.installedLoras[1]);
  assert.equal(job.workflow["990100"].inputs.lora_name, identityLora[0].name);
  assert.match(job.workflow["2483"].inputs.text, /Only rebuild the face inside the tracked mask/i);
  assert.equal(job.metadata.videoStudioStage, "replacement");
});

test("il fallback Actor Replacement usa Edit Anything e richiede Identity LoRA", () => {
  const job = buildVideoStudioInitialJob("actorReplacement", {
    actorEngine: "editAnything",
    replacementScope: "body",
    prompt: "Sostituisci l’attore.",
    duration: 10,
  }, { sourceVideo }, identityLora, config);

  assert.equal(job.workflow["840"].inputs.video, "remote/scene.mp4");
  assert.equal(job.metadata.engine, "editAnything");
  assert.equal(job.metadata.videoStudioMode, "actorReplacement");
  assert.throws(() => buildVideoStudioInitialJob("actorReplacement", {
    actorEngine: "editAnything",
    prompt: "Sostituisci l’attore.",
    duration: 10,
  }, { sourceVideo }, [], config), /Identity LoRA/i);
});

test("costruisce Interactive Scene con copione ordinato e durata", () => {
  const job = buildVideoStudioInitialJob("interactiveScene", {
    prompt: "John entra nella conversazione e gli attori reagiscono.",
    referenceDescription: "John è al centro fra i due attori.",
    dialogue: JSON.stringify([
      { speaker: "John", line: "Posso unirmi a voi?", delivery: "con tono amichevole" },
      { speaker: "Attore 1", line: "Certamente.", delivery: "sorridendo a John" },
    ]),
    duration: 10,
    seed: 44,
  }, { referenceSheet: identityImage }, [], config);

  assert.equal(job.workflow["2004"].inputs.image, "remote/identity.jpg");
  assert.equal(job.workflow["5072"].inputs.value, 241);
  assert.match(job.workflow["2483"].inputs.text, /Only the named speaker moves their lips/i);
  assert.deepEqual(job.metadata.dialogue.map((row) => row.speaker), ["John", "Attore 1"]);
});

test("costruisce il passaggio LipDub sul video selezionato", () => {
  const job = buildVideoStudioLipdubJob({
    prompt: "Mantieni la scena.",
    transcript: "Bentornato.",
    dialogue: "[]",
    seed: 55,
  }, sourceVideo, identityLora, config);

  assert.equal(job.workflow["5002"].inputs.file, "remote/scene.mp4");
  assert.equal(job.workflow["5012"].inputs.lora_name, installed.installedLoras[2]);
  assert.equal(job.workflow["990100"].inputs.lora_name, identityLora[0].name);
  assert.equal(job.metadata.videoStudioStage, "lipdub");
});

const finishingConfig = videoStudioConfig({
  ...installed,
  installedLoras: [
    ...installed.installedLoras,
    "LTX2.3\\ltx2.3_ic_hdr_lora.safetensors",
  ],
  installedLatentUpscalers: ["ltx-2.3-temporal-upscaler-x2-1.0.safetensors"],
  availableNodes: [
    ...installed.availableNodes,
    "LTXVHDRDecodePostprocess",
    "LoadVideo",
    "GetVideoComponents",
    "LatentUpscaleModelLoader",
    "LTXVLatentUpsampler",
    "CreateVideo",
    "SaveVideo",
  ],
});

test("Retake ed Extend usano LTX normale e conservano il video sorgente", () => {
  const retake = buildVideoStudioInitialJob("retake", {
    prompt: "Cambia soltanto il cielo.",
    duration: 6,
    videoModelId: "normal",
  }, { sourceVideo }, [], finishingConfig);
  assert.equal(retake.workflow["219"].inputs.unet_name, "LTX2.3\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors");
  assert.equal(retake.workflow["216"].class_type, "DualCLIPLoader");
  assert.equal(retake.workflow["990300"].class_type, "CreateVideo");
  assert.deepEqual(retake.workflow["990300"].inputs.images, ["5355", 0]);
  assert.equal(retake.workflow["990301"].class_type, "SaveVideo");
  assert.equal(retake.workflow["990301"].inputs.filename_prefix, "VideoStudio/retake");
  assert.equal(retake.workflow["5368"], undefined);
  assert.equal(retake.metadata.videoStudioMode, "retake");

  const extend = buildVideoStudioInitialJob("extend", {
    prompt: "Continua il movimento.",
    extendDuration: 4,
    resolution: "480p",
    orientation: "landscape",
    videoModelId: "normal",
  }, { sourceVideo }, [], finishingConfig);
  assert.equal(extend.workflow["550"].inputs.model_name, "LTX2.3\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors");
  assert.equal(extend.workflow["544"].class_type, "DualCLIPLoader");
  assert.equal(extend.workflow["990200"].inputs.file, "remote/scene.mp4");
  assert.equal(extend.workflow["990207"].class_type, "SaveVideo");
});

test("HDR fallback e Temporal Upscaler 2x sono pronti e costruibili", () => {
  const hdr = buildVideoStudioInitialJob("hdr", {
    prompt: "Natural HDR.",
    hdrExposure: 6.5,
  }, { sourceVideo }, [], finishingConfig);
  assert.equal(hdr.workflow["5011"].inputs.lora_name, "LTX2.3\\ltx2.3_ic_hdr_lora.safetensors");
  assert.equal(hdr.workflow["5114"].inputs.exposure, 6.5);

  const temporal = buildVideoStudioInitialJob("temporalUpscale", {
    slowMotion: false,
  }, { sourceVideo }, [], finishingConfig);
  assert.equal(temporal.workflow["991004"].inputs.model_name, "ltx-2.3-temporal-upscaler-x2-1.0.safetensors");
  assert.equal(temporal.workflow["991007"].inputs.value, "a*2");
});
