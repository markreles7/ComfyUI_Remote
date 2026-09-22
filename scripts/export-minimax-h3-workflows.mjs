import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildH3DeRopeWorkflow } from "../src/h3-derope-workflows.js";
import { buildH3PreviewFinishingWorkflow } from "../src/h3-preview-workflows.js";
import { buildLtx25Workflow } from "../src/ltx25-workflows.js";
import { buildMiniMaxH3DirectorWorkflow } from "../src/minimax-h3-director-workflows.js";
import { buildMiniMaxH3FastWorkflow, buildMiniMaxH3Workflow } from "../src/minimax-h3-workflows.js";
import { buildOrbitSheetWorkflow } from "../src/orbit-sheets-workflows.js";
import { buildVideoStudioInitialJob } from "../src/video-studio-workflows.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "exports", "MiniMax_H3_Workflows_COMPLETE_2026-09-09");
const workflowRoot = path.join(outputRoot, "workflows_api");
const originalsRoot = path.join(outputRoot, "originals");
fs.mkdirSync(workflowRoot, { recursive: true });
fs.mkdirSync(originalsRoot, { recursive: true });

const appConfig = await fetch("http://100.77.122.74:3000/api/config").then((response) => {
  if (!response.ok) throw new Error(`Impossibile leggere /api/config: HTTP ${response.status}`);
  return response.json();
});
const config = appConfig.videoStudio;
const image = { name: "PLACEHOLDER_FIRST_FRAME.png", subfolder: "input" };
const lastImage = { name: "PLACEHOLDER_LAST_FRAME.png", subfolder: "input" };
const refImage = { name: "PLACEHOLDER_REFERENCE_1.png", subfolder: "input" };
const video = { name: "PLACEHOLDER_SOURCE_VIDEO.mp4", subfolder: "input" };
const audio = { name: "PLACEHOLDER_REFERENCE_AUDIO.wav", subfolder: "input" };
const prompt = "A cinematic scene with coherent physical motion, stable identity, intentional camera movement and synchronized native audio.";

const exports = [];
function add(filename, description, job, requirements = []) {
  const file = path.join(workflowRoot, `${filename}.json`);
  fs.writeFileSync(file, `${JSON.stringify(job.workflow, null, 2)}\n`, "utf8");
  exports.push({
    file: `workflows_api/${path.basename(file)}`,
    description,
    workflowId: job.metadata?.workflowId || null,
    modelFile: job.metadata?.modelFile || null,
    requirements,
  });
}

const h3 = (mode, raw = {}, uploads = {}, loras = []) => buildMiniMaxH3Workflow({
  h3Mode: mode,
  h3ModelProfile: "base",
  h3RunProfile: "nativeFinal",
  h3RefineMode: "direct",
  h3UseTurbo: true,
  h3FirstMegapixels: 0.9,
  h3AspectRatio: "16:9 (Widescreen)",
  duration: 5,
  seed: 123456,
  prompt,
  ...raw,
}, uploads, loras, config);

add("01_H3_Studio_T2V_Turbo8", "H3 Studio Text-to-Video, Turbo 8-step, 0.9 MP direct", h3("text"), ["turbo8"]);
add("02_H3_Studio_I2V_Turbo8", "H3 Studio Image-to-Video, Turbo 8-step", h3("image", {}, { h3FirstFrame: image }), ["turbo8"]);
add("03_H3_Studio_FirstLast_Turbo8", "H3 Studio First/Last Frame, Turbo 8-step", h3("firstLast", {}, { h3FirstFrame: image, h3LastFrame: lastImage }), ["turbo8"]);
add("04_H3_Studio_Ref2VA_Multimodal", "H3 Studio Ref2VA con reference immagine, video e audio", h3("references", {}, { h3ReferenceImages: [refImage], h3ReferenceVideos: [video], h3ReferenceAudios: [audio] }), ["turbo8"]);
add("05_H3_Studio_T2V_Native25_NoTurbo", "H3 Studio nativo 0.9 MP, 25 step, nessuna Turbo", h3("text", { h3UseTurbo: false }));
add("06_H3_Studio_Balanced_2Pass", "H3 Studio 0.6 MP Turbo 8-step, refine H3 0.9 MP/3-step", h3("text", { h3RefineMode: "h3Balanced", h3FirstMegapixels: 0.6 }), ["turbo8"]);
add("07_H3_Studio_Maximum_2Pass", "H3 Studio 0.6 MP Turbo 8-step, refine H3 1.0 MP/4-step", h3("text", { h3RefineMode: "h3Maximum", h3FirstMegapixels: 0.6, h3SecondMegapixels: 1 }), ["turbo8"]);
add("08_H3_Studio_LearnedLatent_2Pass", "H3 Studio con learned latent upscaler 3D e refine 3-step", h3("text", { h3RefineMode: "latentLearned", h3FirstMegapixels: 0.6, h3SecondMegapixels: 1 }), ["turbo8"]);
add("09_H3_Studio_SeedVR2_PostRefine", "H3 Studio con post-refine SeedVR2", h3("text", { h3RefineMode: "seedvr2", h3FirstMegapixels: 0.6 }), ["turbo8"]);
add("10_H3_Studio_RTX_VSR_PostRefine", "H3 Studio con post-refine RTX VSR", h3("text", { h3RefineMode: "rtx", h3FirstMegapixels: 0.6 }), ["turbo8"]);
add("11_H3_ErosMax_T2V_Integrated6", "H3 Eros Max T2V, Turbo integrato 6-step", h3("text", { h3ModelProfile: "erosMax", h3UseTurbo: false }));
add("12_H3_ErosMax_I2V_RefPicture", "H3 Eros Max I2V come Picture 1 Ref2VA", h3("image", { h3ModelProfile: "erosMax", h3UseTurbo: false }, { h3FirstFrame: image }));
add("13_H3_PinkCherry_I2V_Native25", "PinkCherry FL2VA I2V nativo 25-step senza Turbo", h3("image", { h3ModelProfile: "pinkCherry", h3UseTurbo: false }, { h3FirstFrame: image }));

const fast = (mode, useTurbo, uploads = {}) => buildMiniMaxH3FastWorkflow({
  h3FastMode: mode,
  h3FastUseTurbo: useTurbo,
  h3FastAspectRatio: "16:9 (Widescreen)",
  h3FastFirstMegapixels: 0.2,
  h3FastTargetMegapixels: 0.98,
  h3FastSplitStep: 6,
  h3FastTurboStrength: 0.75,
  duration: 5,
  seed: 123456,
  prompt,
}, uploads, [], config);
add("14_H3_Fast_T2V_Turbo_SigmaSplit", "H3 Fast T2V, Turbo 4-step, Dual Clock/sigma-split", fast("text", true), ["turbo4fast"]);
add("15_H3_Fast_I2V_Turbo_SigmaSplit", "H3 Fast I2V, Turbo 4-step, Dual Clock/sigma-split", fast("image", true, { h3FirstFrame: image }), ["turbo4fast"]);
add("16_H3_Fast_T2V_Native25_NoTurbo", "H3 Fast T2V nativo 0.9 MP/25-step", fast("text", false));
add("17_H3_Fast_I2V_Native25_NoTurbo", "H3 Fast I2V nativo 0.9 MP/25-step", fast("image", false, { h3FirstFrame: image }));

const seedHunter = (useTurbo) => buildVideoStudioInitialJob("seedHunterH3", {
  seedHunterH3Mode: "text",
  seedHunterH3UseTurbo: useTurbo,
  seedHunterH3AspectRatio: "16:9 (Widescreen)",
  duration: 5,
  seed: 123456,
  h3CandidateIndex: 1,
  prompt,
}, {}, [], config);
add("18_H3_SeedHunter_Candidate_Turbo8", "Uno dei tre job candidato Seed Hunter, 0.25 MP/8-step", seedHunter(true), ["turbo8"]);
add("19_H3_SeedHunter_Candidate_Native25", "Uno dei tre job candidato Seed Hunter, 0.9 MP/25-step senza Turbo", seedHunter(false));

const action = (mode, quality, uploads = {}, loras = []) => buildVideoStudioInitialJob("actionH3", {
  actionH3Mode: mode,
  actionH3Quality: quality,
  actionH3RunProfile: "nativeFinal",
  actionH3Trigger: "prfight2",
  actionH3CombatStrength: 0.8,
  actionH3AspectRatio: "16:9 (Widescreen)",
  h3MotionRepair: true,
  h3MotionRepairStrength: 0.6,
  h3MotionRepairSecondStrength: 0.25,
  duration: 5,
  seed: 123456,
  prompt: "Two adult fighters perform a readable continuous combat exchange with clear impacts, reactions and recovery.",
}, uploads, loras, config);
add("20_ACTION_H3_T2V_Turbo8_Combat", "ACTION H3 T2V con Combat V2 e Turbo 8-step", action("text", "direct09"), ["turbo8", "combatV2"]);
add("21_ACTION_H3_I2V_Turbo8_Combat", "ACTION H3 I2V con Combat V2 e Turbo 8-step", action("image", "direct09", { h3FirstFrame: image }), ["turbo8", "combatV2"]);
add("22_ACTION_H3_FirstLast_Turbo8_Combat", "ACTION H3 First/Last con Combat V2 e Turbo 8-step", action("firstLast", "direct09", { h3FirstFrame: image, h3LastFrame: lastImage }), ["turbo8", "combatV2"]);
add("23_ACTION_H3_MAX25_Combat_NoTurbo", "ACTION H3 MAX 0.9 MP/25-step, Combat V2, Turbo OFF", action("text", "max25"), ["combatV2"]);
add("24_ACTION_H3_MAX25_Combat_FlatAnime", "ACTION H3 MAX anime 2D con Combat V2 + Flat Anime, Turbo OFF", action("text", "max25", {}, [{ name: "H3\\STY_Flat_Anime_H3.safetensors", strength: 0.8 }]), ["combatV2", "flatAnime"]);
add("24B_ACTION_H3_LearnedLatent_MotionRepair", "ACTION H3 0.6 → 1.0 MP con Combat V2 e Motion Continuity Repair 0.60/0.25", action("text", "twoPass06"), ["turbo8", "combatV2", "motionRepair"]);

const weapon = (mode, quality, uploads = {}) => buildVideoStudioInitialJob("weaponCombatH3", {
  weaponCombatMode: mode,
  weaponCombatQuality: quality,
  weaponCombatStrength: 0.8,
  weaponCombatAspectRatio: "16:9 (Widescreen)",
  duration: 5,
  seed: 123456,
  prompt: "BUNNY. An adult swordswoman completes one fast readable parry, counterattack, impact and stable recovery.",
}, uploads, [], config);
add("24C_Weapon_Combat_H3_I2V_LearnedLatent", "Weapon Combat H3 I2V con BUNNY 0.8 e learned latent refine", weapon("image", "twoPass06", { h3FirstFrame: image }), ["turbo8", "weaponCombat"]);

add("25_H3_Preview_Finishing_FILM_RTX_RCAS", "Finishing anteprima H3: FILM 2x, RTX VSR 2x, RCAS", buildH3PreviewFinishingWorkflow(video, { finishingMode: "rtx", aspectRatio: "16:9 (Widescreen)" }));
add("26_H3_Preview_Finishing_KJ_Lanczos", "Finishing conservativo KJ Lanczos", buildH3PreviewFinishingWorkflow(video, { finishingMode: "kjLanczos", aspectRatio: "16:9 (Widescreen)" }));
add("27_H3_Temporal_DeRope_Balanced", "Riparazione Temporal De-Rope bilanciata", buildH3DeRopeWorkflow({ profile: "balanced", seed: 123456, prompt }, video, config));
add("28_H3_to_LTX25_IC_2K", "Refine MiniMax H3 verso LTX 2.5 Pixel Spatial Upscaler IC-LoRA e RTX 2K", buildLtx25Workflow({ ltx25Mode: "h3Ltx2k", ltx25Profile: "maximum", ltx25Aspect: "16:9", ltx25Fps: 24, duration: 5, seed: 123456, prompt }, { ltx25SourceVideo: video }, [], config), ["ltx25PixelUpscaler"]);
add("29_H3_OrbitSheets_Character", "OrbitSheets H3 per turnaround personaggio", buildOrbitSheetWorkflow({ kind: "character", description: "The exact adult character shown in the Hero image", seed: 123456 }, image, config), ["turbo8"]);
add("30_H3_OrbitSheets_Location", "OrbitSheets H3 per reference ambientazione", buildOrbitSheetWorkflow({ kind: "location", description: "The exact environment shown in the Hero image", seed: 123456 }, image, config), ["turbo8"]);

const directorPrompt = `${prompt}\n---\nThe same scene continues naturally in a second shot, preserving identity, environment, lighting and motion direction.`;
const director = (mode, useTurbo, uploads = {}, raw = {}) => buildMiniMaxH3DirectorWorkflow({
  directorMode: mode,
  directorUseTurbo: useTurbo,
  directorContinuity: true,
  directorContinuityFrames: 22,
  directorAspectRatio: "16:9",
  directorMegapixels: 0.4,
  directorSegmentCount: 2,
  duration: 5,
  seed: 123456,
  prompt: directorPrompt,
  ...raw,
}, uploads, [], config);
add("31_H3_AllInOne_T2V_MultiSegment_Turbo8", "AllInOne Director T2V, due sequenze continue da 5 secondi, Turbo 8-step", director("t2v", true), ["turbo8"]);
add("32_H3_AllInOne_T2V_MultiSegment_Native25", "AllInOne Director T2V nativo, due sequenze continue, 0.9 MP/25-step senza Turbo", director("t2v", false));
add("33_H3_AllInOne_I2V_SingleStart_AutoContinuity", "AllInOne Director I2V con una sola immagine iniziale; i segmenti successivi continuano dall'uscita precedente", director("i2v", true, { directorStartImages: [image] }), ["turbo8"]);
add("34_H3_AllInOne_R2V_SharedReferences", "AllInOne Director Reference-to-Video con reference immagine, video e audio condivise tra i segmenti", director("r2v", true, {
  directorReferenceImages: [refImage], directorReferenceVideos: [video], directorReferenceAudios: [audio],
}), ["turbo8"]);
add("35_H3_AllInOne_FirstLast", "AllInOne Director First/Last Frame a singolo segmento", director("fl2v", true, {
  directorStartImages: [image], directorEndImages: [lastImage],
}, { directorSegmentCount: 1, prompt }), ["turbo8"]);

add("36_H3_Multishot_SeamlessChain_OneStartImage", "H3 Multishot Seamless Chain: una sola start image e handoff automatico per i take successivi", buildVideoStudioInitialJob("h3SeamlessChain", {
  h3ChainUseTurbo: true,
  h3ChainAspectRatio: "16:9 (Widescreen)",
  duration: 5,
  seed: 123456,
  prompt: `${prompt}\n---\nThe same action continues causally from the previous take and reaches a stable resolution.`,
}, { h3FirstFrame: image }, [], config), ["turbo8", "h3MultishotNodes"]);

for (const name of [
  "Super flusso di lavoro all-in-one MiniMax H3 (uso personale)_api.json",
  "Super flusso di lavoro all-in-one MiniMax H3 (uso personale).json",
  "MiniMaxH3_Temporal_DeRope_API.json",
  "OrbitSheets_Character_H3_API.json",
  "OrbitSheets_Location_H3_API.json",
  "LTX-2-5-V2V-ICLoRA-Single-Stage-Distilled-API.json",
]) {
  fs.copyFileSync(path.join(projectRoot, "workflows", name), path.join(originalsRoot, name));
}

const loras = {
  turbo8: {
    requiredBy: ["H3 Studio Turbo", "Seed Hunter Turbo", "ACTION H3 Turbo", "OrbitSheets"],
    filename: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    destination: "ComfyUI/models/loras/",
    url: "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/main/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
  },
  turbo4fast: {
    requiredBy: ["Minimax H3 Fast Turbo sigma-split"],
    filename: "minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors",
    destination: "ComfyUI/models/loras/",
    url: "https://huggingface.co/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors",
  },
  combatV2: {
    requiredBy: ["ACTION H3"],
    filenameExpectedByExport: "H3/STY_Combat.safetensors",
    destination: "ComfyUI/models/loras/H3/",
    triggerOptions: ["prfight2", "prfin1"],
    url: "https://civitai.com/api/download/models/3246572",
    page: "https://civitai.com/models/2853878?modelVersionId=3246572",
    authentication: "Civitai login/API token richiesto dal server per questa versione.",
  },
  flatAnime: {
    requiredBy: ["ACTION H3 MAX Flat Anime (opzionale)"],
    filenameExpectedByExport: "H3/STY_Flat_Anime_H3.safetensors",
    destination: "ComfyUI/models/loras/H3/",
    url: "https://civitai.com/api/download/models/3225946",
    page: "https://civitai.com/models/1952560?modelVersionId=3225946",
  },
  weaponCombat: {
    requiredBy: ["Weapon Combat H3"],
    filenameExpectedByExport: "H3/MOT_Weapon_Combat_H3_trigger-BUNNY.safetensors",
    destination: "ComfyUI/models/loras/H3/",
    trigger: "BUNNY",
    recommendedStrength: "0.7-0.9",
    url: "https://huggingface.co/JOKER141/MiniMax-H3-Weapon-Combat-LoRA/resolve/main/Bunny_weapon_combatV1.safetensors",
    page: "https://civitai.com/models/2904053?modelVersionId=3283995",
  },
  motionRepair: {
    requiredBy: ["ACTION H3 opzionale"],
    filenameExpectedByExport: "H3/MOT_Continuity_Repair_H3_trigger-bunny_crisp_motion.safetensors",
    destination: "ComfyUI/models/loras/H3/",
    trigger: "bunny_crisp_motion (opzionale)",
    strengths: { firstPass: "0.5-0.7", secondPass: "0.2-0.3" },
    url: "https://huggingface.co/JOKER141/MiniMax-H3-General-Motion-Continuity-Repair/resolve/main/Motion_Repair.safetensors",
    page: "https://civitai.com/models/2890788?modelVersionId=3268186",
  },
  h3MultishotNodes: {
    requiredBy: ["H3 Multishot Seamless Chain"],
    destination: "ComfyUI/custom_nodes/",
    repositories: ["https://github.com/jlucasmcrell/ComfyUI-H3-Multishot", "https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context"],
  },
  ltx25PixelUpscaler: {
    requiredBy: ["H3 → LTX 2.5 IC 2K"],
    filename: "ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors",
    destination: "ComfyUI/models/loras/LTX2.5/",
    url: "https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Pixel-Spatial-Upscaler/resolve/main/ltx-2.5-22b-ic-lora-pixel-spatial-upscaler-x2-1.0.safetensors",
    authentication: "Repository gated: accettare la licenza Lightricks e usare un token Hugging Face.",
  },
};

fs.writeFileSync(path.join(outputRoot, "MANIFEST.json"), `${JSON.stringify({
  package: "MiniMax H3 workflows usati da ComfyUI Remote",
  generatedAt: new Date().toISOString(),
  format: "ComfyUI API prompt JSON",
  note: "Sostituire i file PLACEHOLDER_* nei nodi di caricamento prima dell'esecuzione. I JSON non contengono asset personali.",
  workflowCount: exports.length,
  workflows: exports,
}, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputRoot, "LORA_DOWNLOADS.json"), `${JSON.stringify(loras, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ outputRoot, workflowCount: exports.length }, null, 2));
