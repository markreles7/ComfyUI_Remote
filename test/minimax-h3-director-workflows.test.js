import test from "node:test";
import { parseDirectorNaturalSegments } from "../src/h3-director-prompt.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildMiniMaxH3DirectorWorkflow } from "../src/minimax-h3-director-workflows.js";

const config = { h3LoraMetadata: { "H3\\STY_Anime.safetensors": { trigger: "anime_style" } }, h3: { director: { available: true }, files: {
  fl2va: "fl2va.safetensors", ref2va: "ref2va.safetensors", clip: "qwen.safetensors",
  videoVae: "video-vae.safetensors", audioVae: "audio-vae.safetensors",
  turbo: "turbo.safetensors", latentUpscaler: "latent-3d.safetensors",
  hybridB25: "hybrid-b25-49.safetensors", combat: "combat-v2.safetensors", weaponCombat: "weapon-bunny.safetensors",
} } };

test("AllInOne ACTION SCENE usa Hybrid b25-49 e sceglie una sola LoRA d'azione", () => {
  const combat = buildMiniMaxH3DirectorWorkflow({
    prompt: "Il combattente para e contrattacca",
    directorMode: "t2v",
    directorPreset: "actionScene",
    directorActionLora: "combat",
    directorActionStrength: 0.85,
  }, {}, [], config);
  const combatTimeline = JSON.parse(combat.workflow["40"].inputs.timeline_data);
  assert.equal(combat.workflow["1"].inputs.unet_name, "hybrid-b25-49.safetensors");
  assert.equal(combat.workflow["11"].inputs.lora_name, "combat-v2.safetensors");
  assert.equal(combat.workflow["11"].inputs.strength_model, 0.85);
  assert.match(combatTimeline.segments[0].prompt, /^prfight2\./);
  assert.equal(combat.metadata.directorPreset, "actionScene");
  assert.equal(combat.metadata.samplerName, "res_multistep");
  assert.equal(combat.metadata.schedulerName, "simple");

  const weapon = buildMiniMaxH3DirectorWorkflow({
    prompt: "La spadaccina esegue una parata",
    directorMode: "t2v",
    directorPreset: "actionScene",
    directorActionLora: "weapon",
  }, {}, [], config);
  const weaponTimeline = JSON.parse(weapon.workflow["40"].inputs.timeline_data);
  assert.equal(weapon.workflow["11"].inputs.lora_name, "weapon-bunny.safetensors");
  assert.match(weaponTimeline.segments[0].prompt, /^BUNNY\./);
});

test("AllInOne ACTION SCENE applica direttiva, trigger e forza del preset Weapon", () => {
  const job = buildMiniMaxH3DirectorWorkflow({
    prompt: "La spadaccina para e contrattacca\n---\nLa spadaccina conclude il duello",
    directorSegmentCount: 2,
    directorMode: "t2v",
    directorPreset: "actionScene",
    directorActionLora: "weapon",
    directorActionPreset: "swordDuel",
    directorUseTurbo: false,
  }, {}, [], config);
  const timeline = JSON.parse(job.workflow["40"].inputs.timeline_data);
  assert.equal(job.workflow["10"].inputs.lora_name, "weapon-bunny.safetensors");
  assert.equal(job.workflow["10"].inputs.strength_model, 0.8);
  assert.match(timeline.segments[0].prompt, /^BUNNY\./);
  assert.match(timeline.segments[0].prompt, /Readable sword duel/);
  assert.match(timeline.segments[1].prompt, /never merge, duplicate or teleport weapons/);
  assert.equal(job.metadata.actionPreset, "swordDuel");
  assert.equal(job.metadata.steps, 25);
});

test("AllInOne crea segmenti Director continui e 25 step reali senza Turbo", () => {
  const job = buildMiniMaxH3DirectorWorkflow({
    prompt: "Prima scena\n---\nSeconda scena", duration: 5, directorMode: "t2v",
    directorUseTurbo: false, directorContinuity: true, directorContinuityFrames: 22,
  }, {}, [], config);
  const timeline = JSON.parse(job.workflow["40"].inputs.timeline_data);
  assert.equal(timeline.segments.length, 2);
  assert.equal(timeline.segments[1].continuityFromPrev, true);
  assert.equal(job.metadata.duration, 10);
  assert.equal(job.metadata.segmentCount, 2);
  assert.equal(timeline.totalFrames, timeline.segments[0].frameCount * 2);
  assert.equal(job.workflow["40"].inputs.steps, 25);
  assert.equal(job.metadata.megapixels, 0.9);
  assert.ok(!Object.values(job.workflow).some((entry) => entry._meta?.title?.includes("Turbo 8 step")));
});

test("AllInOne protegge i separatori anche durante il miglioramento H3", async () => {
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../public/video-studio.html", import.meta.url), "utf8");

  assert.match(server, /allInOneSegments[\s\S]*enhancedSegments[\s\S]*join\("\\n\\n---\\n\\n"\)/);
  assert.match(client, /function h3DirectorPromptSegments/);
  assert.match(client, /updateH3DirectorTimelineSummary/);
  assert.match(html, /id="director-timeline-summary"/);
});

test("AllInOne collega reference condivise e LoRA al Director", () => {
  const job = buildMiniMaxH3DirectorWorkflow({ prompt: "<Picture 1> cammina", directorMode: "r2v" }, {
    directorReferenceImages: [{ name: "hero.png", subfolder: "remote" }],
  }, [{ name: "H3\\STY_Anime.safetensors", strength: 0.7 }], config);
  const timeline = JSON.parse(job.workflow["40"].inputs.timeline_data);
  assert.equal(timeline.segments[0].refs[0].imageFile, "remote/hero.png");
  assert.match(timeline.segments[0].prompt, /^anime_style\./);
  assert.equal(job.workflow["11"].inputs.lora_name, "H3\\STY_Anime.safetensors");
  assert.deepEqual(job.workflow["40"].inputs.model, ["11", 0]);
});

test("AllInOne I2V usa una sola immagine e continua dai segmenti già generati", () => {
  const job = buildMiniMaxH3DirectorWorkflow({
    prompt: "Alpha apre il libro\n---\nAlpha alza lo sguardo\n---\nAlpha lascia la biblioteca",
    duration: 5,
    directorSegmentCount: 3,
    directorMode: "i2v",
    directorContinuity: true,
  }, {
    directorStartImages: [{ name: "alpha-start.png", subfolder: "remote" }],
  }, [], config);
  const timeline = JSON.parse(job.workflow["40"].inputs.timeline_data);

  assert.equal(timeline.segments.length, 3);
  assert.equal(timeline.segments[0].taskType, "i2v — 图生视频(Image to Video)");
  assert.equal(timeline.segments[0].genImage.imageFile, "remote/alpha-start.png");
  assert.equal(timeline.segments[1].taskType, "t2v — 文生视频(Text to Video)");
  assert.equal(timeline.segments[1].genImage.imageFile, "");
  assert.equal(timeline.segments[1].continuityFromPrev, true);
  assert.equal(timeline.segments[2].continuityFromPrev, true);
  assert.equal(timeline.global.taskType, "t2v — 文生视频(Text to Video)");
  assert.equal(job.workflow["40"].inputs.task_type, timeline.global.taskType);
  assert.equal(job.metadata.startImageStrategy, "first-image-then-previous-segment");
  assert.equal(job.metadata.duration, 15);
});

test("AllInOne I2V richiede continuità quando mancano start image successive", () => {
  assert.throws(() => buildMiniMaxH3DirectorWorkflow({
    prompt: "Scena uno\n---\nScena due",
    directorSegmentCount: 2,
    directorMode: "i2v",
    directorContinuity: false,
  }, {
    directorStartImages: [{ name: "start.png" }],
  }, [], config), /attiva Continuità automatica/u);
});

test("AllInOne First/Last emette gli shots espliciti richiesti dal Director", () => {
  const job = buildMiniMaxH3DirectorWorkflow({ prompt: "Dal primo all’ultimo frame", directorMode: "fl2v" }, {
    directorStartImages: [{ name: "start.png", subfolder: "remote" }],
    directorEndImages: [{ name: "end.png", subfolder: "remote" }],
  }, [], config);
  const timeline = JSON.parse(job.workflow["40"].inputs.timeline_data);
  assert.equal(timeline.timelineMode, "fl2v");
  assert.equal(timeline.shots[0].startImage.imageFile, "remote/start.png");
  assert.equal(timeline.shots[0].endImage.imageFile, "remote/end.png");
});

test("AllInOne blocca il render se il numero di segmenti cambia prima della coda", () => {
  assert.throws(() => buildMiniMaxH3DirectorWorkflow({
    prompt: "Prima scena soltanto",
    directorSegmentCount: 2,
    directorMode: "t2v",
  }, {}, [], config), /invece dei 2 riconosciuti.*video troncato/u);
});
test("AllInOne riconosce sequenze naturali italiane prima/seconda/terza", () => {
  assert.deepEqual(parseDirectorNaturalSegments("Voglio tre sequenze: nella prima entra nel corridoio; nella seconda raggiunge la finestra; nella terza guarda la pioggia."), [
    "entra nel corridoio",
    "raggiunge la finestra",
    "guarda la pioggia.",
  ]);
});
