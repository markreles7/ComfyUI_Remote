import test from "node:test";
import assert from "node:assert/strict";
import { PLAGUEKIND_LORA_PRESETS as presets, findPlaguekindPresetLora } from "../public/plaguekind-lora-presets.js";
import { loraTriggerMetadata } from "../src/lora-trigger-catalog.js";
import { automaticLoraTriggers, promptWithH3IntegratedTriggers } from "../public/lora-triggers.js";
import { h3LoraIdentity, resolveH3LoraFile } from "../public/h3-lora-files.js";

const installed = ["H3\\STY_handheld_h3_100.safetensors", "H3\\STY_cinemagrade_style_h3_ep50.safetensors"];

test("PlagueKind resolves the two installed files and their upstream filenames without confusing other versions", () => {
  assert.equal(findPlaguekindPresetLora("plagueHandheld", installed), installed[0]);
  assert.equal(findPlaguekindPresetLora("plagueCinemaGrade", installed), installed[1]);
  assert.equal(findPlaguekindPresetLora("plagueCinemaGrade", ["H3/STY_cinemagrade_style_h3_ep35.safetensors"]), "");
  assert.equal(findPlaguekindPresetLora("plagueHandheld", ["H3/handheld_h3_100.safetensors"]), "H3/handheld_h3_100.safetensors");
});

test("Civitai H3 version metadata activates only CinemaGrade, not the Wan handheld trigger", () => {
  const metadata = loraTriggerMetadata(installed);
  assert.equal(metadata[installed[0]].versionId, 3343481);
  assert.equal(metadata[installed[0]].trigger, null);
  assert.equal(metadata[installed[1]].versionId, 3312531);
  assert.equal(metadata[installed[1]].recommendedStrength, 1);
  assert.equal(loraTriggerMetadata(["H3/cinemagrade_style_h3_ep50.safetensors"])["H3/cinemagrade_style_h3_ep50.safetensors"].trigger, "cinemagradestyle");
  assert.deepEqual(automaticLoraTriggers(installed.map((name) => ({ name })), metadata), ["cinemagradestyle"]);
});

test("single presets use one LoRA; the optional combination uses documented experimental strengths", () => {
  assert.equal(presets.plagueCinemaGrade.strength, 1);
  assert.equal(presets.plagueHandheld.strength, 1);
  assert.match(presets.plagueHandheld.hint, /sperimentale/);
  assert.equal(presets.plagueHandheldCinemaGrade.strength, 0.6);
  assert.deepEqual(presets.plagueHandheldCinemaGrade.extraLoras, [{ type: "plagueCinemaGrade", strength: 0.8 }]);
  for (const preset of Object.values(presets)) {
    assert.equal(preset.forcedTriggers, undefined);
    assert.equal(preset.turbo, undefined);
    assert.equal(preset.mode, undefined);
  }
});

test("CinemaGrade trigger survives six-section prompt formatting once per independent clip", () => {
  const prompt = 'subject_definitions: A driver.\nsummary: A road scene.\nretention_analysis: Preserve identity only.\ndetailed_description: [Shot 1] cinemagradestyle. A car passes.\noverall_soundscape: Engine.\nnon_diegetic_music: N/A';
  const output = promptWithH3IntegratedTriggers(`${prompt}\n---\n${prompt}`, ["cinemagradestyle"]);
  assert.equal((output.match(/cinemagradestyle/gu) || []).length, 2);
  assert.equal((output.match(/detailed_description: cinemagradestyle\. \[Shot 1\]/gu) || []).length, 2);
  assert.equal((output.match(/^---$/gmu) || []).length, 1);
});

test("renaming classification prefixes preserves model identity and exact version", () => {
  assert.equal(h3LoraIdentity("H3\\POV_NSFW_ Example_v2.safetensors"), "example_v2.safetensors");
  assert.equal(resolveH3LoraFile(["H3/CAM_handheld_h3_100.safetensors"], "STY_handheld_h3_100.safetensors"), "H3/CAM_handheld_h3_100.safetensors");
  assert.equal(findPlaguekindPresetLora("plagueCinemaGrade", ["H3/cinemagrade_style_h3_ep35.safetensors"]), "");
  assert.equal(resolveH3LoraFile(["H3/NSFW-AIO-V2.5.safetensors"], "NSFW_AIO.safetensors"), "");
});

test("exact names win; ambiguous renamed files do not select an arbitrary model", () => {
  const names = ["H3/CAM_handheld_h3_100.safetensors", "H3/MOT_handheld_h3_100.safetensors"];
  assert.equal(resolveH3LoraFile(names, "STY_handheld_h3_100.safetensors"), "");
  assert.equal(resolveH3LoraFile(names, "CAM_handheld_h3_100.safetensors"), names[0]);
});

test("catalog metadata survives classification renames only in the H3 namespace", () => {
  const names = ["H3/CAM_handheld_h3_100.safetensors", "H3/MOT_cinemagrade_style_h3_ep50.safetensors", "Other/MOT_cinemagrade_style_h3_ep50.safetensors"];
  const metadata = loraTriggerMetadata(names);
  assert.equal(metadata[names[0]].versionId, 3343481);
  assert.equal(metadata[names[1]].trigger, "cinemagradestyle");
  assert.equal(metadata[names[1]].matchedBy, "category-prefix");
  assert.equal(metadata[names[2]], undefined);
});

test("new standalone presets have verified catalogue weights and resolve renamed files", () => {
  const files = ["H3/MOT_GalaxyAce.safetensors", "H3/STY_Continuity_Repair_H3_trigger-bunny_crisp_motion.safetensors"];
  assert.equal(findPlaguekindPresetLora("plagueGalaxyAce", files), files[0]);
  assert.equal(findPlaguekindPresetLora("plagueContinuityRepair", files), files[1]);
  assert.equal(presets.plagueGalaxyAce.strength, 1);
  assert.equal(presets.plagueContinuityRepair.strength, 0.6);
  assert.deepEqual(automaticLoraTriggers(files.map((name) => ({ name })), loraTriggerMetadata(files)), ["bunny_crisp_motion"]);
});
