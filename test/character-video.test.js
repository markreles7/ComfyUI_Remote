import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacterAnchorFrameRequest } from "../src/character-adapters.js";
import {
  characterVideoHistoryMetadata,
  createCharacterVideoRouter,
  motionPromptSections,
  normalizeVideoBlueprint,
  routeCharacterVideo,
  videoRequirements,
} from "../src/character-video.js";
import { createCharacterVideoPipeline, finishCharacterVideoPipeline, updateCharacterVideoStage } from "../src/character-video-pipeline.js";

const videoModels = [{ id: "normal", file: "LTX2.3\\model.safetensors", available: true }];

test("Video Blueprint valida e normalizza tutti i campi del contratto", () => {
  const blueprint = normalizeVideoBlueprint({
    scene: "beach at sunset",
    subjectMotion: "walks naturally",
    cameraMotion: "slow tracking",
    framing: "medium full shot",
    environmentMotion: "gentle waves",
    facialPerformance: "occasional glance",
    duration: 99,
    dialogue: "Ciao!",
    emotion: "happy",
    audioMode: "native",
  });
  assert.deepEqual(Object.keys(blueprint), ["scene", "subjectMotion", "cameraMotion", "framing", "environmentMotion", "facialPerformance", "dialogue", "emotion", "duration", "audioMode"]);
  assert.equal(blueprint.duration, 30);
  assert.equal(blueprint.audioMode, "native");
});

test("Video Router espone solo LTX 2.3 realmente disponibile e Auto rispetta dialogue/audio", () => {
  const router = createCharacterVideoRouter({ workflowAvailability: { standard: true, devfp8: true }, videoModels });
  assert.equal(router.engines.length, 2);
  assert.equal(router.engines[0].id, "ltx23");
  assert.equal(router.engines[0].available, true);
  assert.deepEqual(router.preparedUnavailable.map((item) => item.id), ["ltx25"]);
  const route = routeCharacterVideo({
    router,
    requestedEngine: "auto",
    quality: "max",
    requirements: videoRequirements({ sourceMode: "image", dialogue: "Ciao", audioMode: "native" }),
  });
  assert.equal(route.engine.id, "ltx23");
  assert.equal(route.workflowId, "devfp8");
});

test("Video Router espone MiniMax H3 quando il workflow live è valido", () => {
  const router = createCharacterVideoRouter({
    workflowAvailability: { standard: true, devfp8: true, minimaxH3: true },
    videoModels,
  });
  const engine = router.engines.find((item) => item.id === "minimaxH3");
  assert.equal(engine.available, true);
  assert.equal(engine.capabilities.referenceCharacter, true);
  const route = routeCharacterVideo({
    router,
    requestedEngine: "minimaxH3",
    quality: "balanced",
    requirements: videoRequirements({ sourceMode: "anchor", dialogue: "Ciao", audioMode: "native" }),
  });
  assert.equal(route.workflowId, "minimaxH3");
});

test("un modello o workflow assente non viene spacciato per operativo", () => {
  const router = createCharacterVideoRouter({ workflowAvailability: { standard: true }, videoModels: [{ id: "normal", available: false }] });
  assert.equal(router.engines[0].available, false);
  assert.throws(() => routeCharacterVideo({ router, requestedEngine: "auto", requirements: { imageToVideo: true } }), /Nessun Video Engine/);
  assert.throws(() => routeCharacterVideo({ router, requestedEngine: "ltx25" }), /Nessun workflow LTX 2.5/);
});

test("Motion Prompt Builder copre corpo, volto, camera, ambiente, secondario, identità e dialogue", () => {
  const sections = motionPromptSections({
    scene: "beach", subjectMotion: "walk", cameraMotion: "tracking", framing: "full shot",
    environmentMotion: "waves", facialPerformance: "glances", dialogue: "Ciao", emotion: "calm", audioMode: "native",
  }, "preserve exact coat markings").join("\n");
  for (const value of ["Subject motion", "Body motion", "Face", "Camera", "Environment motion", "Secondary motion", "Identity stability", "Dialogue"]) {
    assert.match(sections, new RegExp(value));
  }
});

test("buildCharacterAnchorFrameRequest produce una richiesta reale e conservativa", () => {
  const request = buildCharacterAnchorFrameRequest({
    characterId: "char-1",
    sceneBlueprint: { scene: "beach", subjectMotion: "walking", framing: "full shot" },
    videoIntent: "walk toward camera",
    outfit: "preserve outfit",
    aspectRatio: "16:9",
    videoEngine: "ltx23",
    identityStrength: "high",
  });
  assert.equal(request.status, "ready");
  assert.equal(request.conservative, true);
  assert.equal(request.videoEngine, "ltx23");
  assert.match(request.prompt, /stable first frame/i);
  assert.match(request.prompt, /no motion blur/i);
  assert.doesNotMatch(JSON.stringify(request), /not configured/i);
});

test("History Character Video conserva il contratto completo senza asset binari duplicati", () => {
  const router = createCharacterVideoRouter({ workflowAvailability: { standard: true }, videoModels });
  const route = routeCharacterVideo({ router, requirements: { imageToVideo: true } });
  const metadata = characterVideoHistoryMetadata({
    character: { id: "char-1", name: "Milo" },
    videoBlueprint: { scene: "garden", subjectMotion: "runs", duration: 5 },
    anchorGenerationId: "anchor-1",
    anchorImage: { filename: "anchor.png" },
    route,
    motionPrompt: "The same dog runs naturally through the garden.",
    sourceMode: "auto",
  });
  for (const field of ["characterId", "videoBlueprint", "anchorGenerationId", "anchorImage", "videoEngine", "workflow", "motionPrompt", "output"]) assert.ok(field in metadata, field);
  assert.deepEqual(metadata.output, []);
});

test("Talking Character espone capability esatte e instrada TTS esterno soltanto con lip-sync reale", () => {
  const router = createCharacterVideoRouter({ workflowAvailability: { standard: true }, videoModels, audioCapabilities: { voiceTts: true, lipSync: true } });
  const capabilities = router.engines[0].capabilities;
  for (const field of ["supportsNativeAudio", "supportsDialogue", "supportsAudioConditioning", "supportsLipSync", "supportsExternalAudio"]) assert.ok(field in capabilities, field);
  const route = routeCharacterVideo({ router, requirements: videoRequirements({ sourceMode: "image", dialogue: "Ciao", audioMode: "externalTts" }) });
  assert.equal(route.engine.id, "ltx23");
  assert.equal(route.engine.capabilities.supportsLipSync, true);
});

test("Video Master Pipeline conserva l'ultimo video valido se refine fallisce", () => {
  let pipeline = createCharacterVideoPipeline({ audioMode: "externalTts", refinePreset: "improved", capabilities: { lipSync: true, videoRefine: true } });
  pipeline = updateCharacterVideoStage(pipeline, "video", { status: "completed", generationId: "raw-1" });
  pipeline = { ...pipeline, lastValidVideoGenerationId: "raw-1" };
  pipeline = updateCharacterVideoStage(pipeline, "lipSync", { status: "failed", error: "isolated failure" });
  pipeline = updateCharacterVideoStage(pipeline, "refine", { status: "failed", error: "OOM" });
  pipeline = updateCharacterVideoStage(pipeline, "master", { status: "completed", generationId: "raw-1" });
  pipeline = finishCharacterVideoPipeline(pipeline, "raw-1");
  assert.equal(pipeline.status, "completed_with_warnings");
  assert.equal(pipeline.masterGenerationId, "raw-1");
  assert.equal(pipeline.lastValidVideoGenerationId, "raw-1");
});

test("Originale salta il refine mentre Migliorato richiede SeedVR2", () => {
  const original = createCharacterVideoPipeline({ refinePreset: "original", capabilities: { videoRefine: true } });
  const improved = createCharacterVideoPipeline({ refinePreset: "improved", capabilities: { videoRefine: true } });
  assert.equal(original.stages.find((stage) => stage.id === "refine").status, "skipped");
  assert.equal(improved.stages.find((stage) => stage.id === "refine").status, "requested");
});
