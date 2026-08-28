import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { loraTriggerMetadata } from "../src/lora-trigger-catalog.js";
import {
  automaticLoraTriggers,
  loraFamily,
  loraOptionLabel,
  promptWithH3IntegratedTriggers,
  promptWithTriggerPrefix,
  uniquePromptTriggers,
} from "../public/lora-triggers.js";

test("accetta anche un trigger singolo come stringa", () => {
  assert.deepEqual(uniquePromptTriggers("r34l1sm"), ["r34l1sm"]);
});

test("H3 mantiene tre soli campi e inserisce i trigger all'inizio della descrizione integrata", () => {
  const prompt = [
    "integrated_multimodal_description[0-4s: dolly in toward the speaker. (S1) says: <d>[Italian] Fa caldo.</d>]",
    "overall_soundscape[Footsteps and distant traffic.]",
    "non_diegetic_music[N/A]",
  ].join("\n");
  const result = promptWithH3IntegratedTriggers(prompt, ["dynv2", "r34l1sm"]);
  assert.match(result, /^integrated_multimodal_description: dynv2, r34l1sm\. \[Shot 1\]/);
  assert.equal((result.match(/dynv2/giu) || []).length, 1);
  assert.match(result, /<d>\[Italian\] Fa caldo\.<\/d>/);
  assert.match(result, /\noverall_soundscape: Footsteps and distant traffic\.\n\nnon_diegetic_music: N\/A$/);
});

test("H3 conserva la riga ufficiale di allineamento quando aggiunge un trigger LoRA", () => {
  const alignment = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
  const prompt = `${alignment}\n\nintegrated_multimodal_description: [Shot 1] The woman walks forward.\n\noverall_soundscape: Footsteps.\n\nnon_diegetic_music: N/A`;
  const result = promptWithH3IntegratedTriggers(prompt, ["hmmotion"]);
  assert.match(result, new RegExp(`^${alignment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n\\nintegrated_multimodal_description: hmmotion\\. \\[Shot 1\\]`));
  assert.equal((result.match(/fully referenced/giu) || []).length, 1);
});

test("H3 conserva un [Shot 1] già valido quando il submit inserisce trigger LoRA", () => {
  const prompt = [
    "integrated_multimodal_description: [Shot 1] An adult woman exits a pool and lies on a sun lounger.",
    "overall_soundscape: Water and wet footsteps.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
  const result = promptWithH3IntegratedTriggers(prompt, ["r34l1sm"]);
  assert.match(result, /integrated_multimodal_description: r34l1sm\. \[Shot 1\] An adult woman/);
  assert.doesNotMatch(result, /\[Shot 1\]\s+Shot 1\]/);
  assert.equal((result.match(/\[Shot 1\]/g) || []).length, 1);
});

test("H3 Ref2VA inserisce i trigger nella detailed_description senza perdere le sei sezioni", () => {
  const prompt = [
    "subject_definitions: <Subject 1> is the woman from <Picture 1>.",
    "summary: [reference generation] A walking shot.",
    "retention_analysis: <Picture 1>: fully_preserved.",
    "detailed_description: [Shot 1] <Subject 1> walks forward.",
    "overall_soundscape: Footsteps.",
    "non_diegetic_music: N/A",
  ].join("\n");
  const result = promptWithH3IntegratedTriggers(prompt, ["dynv2"]);
  assert.match(result, /detailed_description: dynv2\. \[Shot 1\]/);
  assert.equal((result.match(/^[a-z_]+:/gm) || []).length, 6);
});

test("il catalogo risolve trigger Civitai anche per nomi locali rinominati", () => {
  const installed = [
    "FLUX\\CHR_RLY-thot_shot-KREA2-irena-v1.safetensors",
    "QWEN\\Famegrid_Qwen_Lora_Standard_V1.5_RealSkinFix.safetensors",
    "LTX2.3\\LTX-2.3_DR34ML4Y.safetensors",
  ];
  const metadata = loraTriggerMetadata(installed);
  assert.equal(metadata[installed[0]].trigger, "rlyirena");
  assert.deepEqual(metadata[installed[1]].triggers, ["igmodel", "rlskn"]);
  assert.equal(metadata[installed[2]].automatic, false);
  assert.match(metadata[installed[0]].sourceUrl, /civitai\.com\/models\/2548498/);
});

test("il catalogo espone trigger e regole delle nuove LoRA H3, Qwen 2512 e Flux.2", () => {
  const installed = [
    "H3\\MiniMax_bst_v1.safetensors",
    "QWEN\\QWEN2512_Bigsloppytits_v1_copy_000003000.safetensors",
    "QWEN\\HearmemanAI_V4_Rank128_BreastsLoRA_Epoch80.safetensors",
    "QWEN\\HMFemme_V1.safetensors",
    "QWEN\\jib_qwen_fix_000002750.safetensors",
    "QWEN\\[QWEN] JTT2_5.safetensors",
    "QWEN\\breasts_rest_qwen_v1.safetensors",
    "FLUX2\\Bigsloppytits-Flux2-V1_000001200.safetensors",
  ];
  const metadata = loraTriggerMetadata(installed);

  assert.equal(metadata[installed[0]].trigger, "bigsloppytits");
  assert.equal(metadata[installed[0]].recommendedStrength, 0.85);
  assert.deepEqual(metadata[installed[1]].triggerOptions, ["huge bust", "huge breasts", "huge saggy breasts"]);
  assert.equal(metadata[installed[1]].automatic, false);
  assert.match(metadata[installed[2]].triggerOptions.join(" | "), /large sized breasts/);
  assert.equal(metadata[installed[3]].trigger, "HMFemme");
  assert.equal(metadata[installed[4]].trigger, null);
  assert.equal(metadata[installed[5]].automatic, false);
  assert.equal(metadata[installed[6]].recommendedRange[1], 1.5);
  assert.equal(metadata[installed[7]].trigger, "bigsloppytits");
  assert.equal(metadata[installed[7]].baseModel, "Flux.2 Klein 9B");
});

test("il modello base verificato corregge il routing di una LoRA rinominata o nella cartella errata", () => {
  const installed = [
    "FLUX2\\CHR_1zz33XLV2.safetensors",
    "FLUX2\\CHR_LyraK2.safetensors",
    "QWEN\\m99_dick_size_adjuster_1.safetensors",
  ];
  const metadata = loraTriggerMetadata(installed);
  assert.equal(loraFamily(installed[0], metadata), "QWEN");
  assert.equal(loraFamily(installed[1], metadata), "FLUX");
  assert.equal(loraFamily(installed[2], metadata), "INCOMPATIBLE");
});

test("applica soltanto trigger automatici e deduplica più LoRA", () => {
  const metadata = {
    a: { trigger: "dynv2" },
    b: { triggers: ["igmodel", "rlskn"] },
    c: { triggerOptions: ["one", "two"], automatic: false },
    d: { trigger: "DYNV2" },
  };
  assert.deepEqual(automaticLoraTriggers([
    { name: "a" }, { name: "b" }, { name: "c" }, { name: "d" },
  ], metadata), ["dynv2", "igmodel", "rlskn"]);
  assert.match(loraOptionLabel("c", metadata), /variabile\/manuale/);
});

test("il prefisso è idempotente e sostituisce i trigger precedenti", () => {
  const once = promptWithTriggerPrefix("A cinematic shot with dynv2 motion.", ["dynv2"]);
  const twice = promptWithTriggerPrefix(once, ["dynv2"], ["dynv2"]);
  assert.equal(twice, once);
  assert.equal((twice.match(/dynv2/giu) || []).length, 1);
  assert.equal(
    promptWithTriggerPrefix("dynv2. A cinematic shot.", ["变成真实风格"], ["dynv2"]),
    "变成真实风格. A cinematic shot.",
  );
});

test("Genera, Image Studio e Video Studio applicano i trigger dopo LM e prima dell'invio", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const studio = fs.readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
  const video = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  for (const source of [app, studio, video]) {
    assert.match(source, /applyLoraTriggers|applyVideoPromptTriggers/);
    assert.match(source, /automaticLoraTriggers/);
    assert.match(source, /new FormData/);
  }
  assert.match(server, /loraMetadata: loraTriggerMetadata\(installedLoras\)/);
});
