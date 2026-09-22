import assert from "node:assert/strict";
import test from "node:test";
import { audioStudioConfig, buildAudioStudioWorkflow } from "../src/audio-studio-workflows.js";

const videoStudio = {
  h3: { files: { fl2va: "h3.safetensors", clip: "qwen.safetensors", videoVae: "video.safetensors", audioVae: "audio.safetensors" } },
  ltx25: { modes: { textAudio: { available: true } } },
};
const definitions = {
  MiniMaxH3MusicStudio: { input: { required: { preset: [["Custom", "Cinematic · Anime opening"]], sampler: [["res_multistep"]], scheduler: [["simple"]] } } },
  SaveAudioAdvanced: {},
};

test("Audio Studio espone MiniMax H3 Music e LTX 2.5 audio-only", () => {
  const config = audioStudioConfig(videoStudio, definitions);
  assert.deepEqual(config.engines.map((item) => [item.id, item.available]), [["minimaxH3", true], ["ltx25", true]]);
  assert.ok(config.h3.presets.includes("Cinematic · Anime opening"));
});

test("MiniMax H3 Music Studio salva un MP3 audio-only con i modelli installati", () => {
  const audioStudio = audioStudioConfig(videoStudio, definitions);
  const job = buildAudioStudioWorkflow({
    audioEngine: "minimaxH3", audioMode: "song", prompt: "cinematic synth pop",
    lyrics: "[Verse]\nA new beginning\n[Chorus]\nWe rise", duration: 20, steps: 24,
    musicPreset: "Cinematic · Anime opening", seed: 12,
  }, { audioStudio, videoStudio });
  assert.equal(job.workflow["1"].class_type, "MiniMaxH3MusicStudio");
  assert.equal(job.workflow["1"].inputs.unet_name, "h3.safetensors");
  assert.equal(job.workflow["2"].class_type, "SaveAudioAdvanced");
  assert.deepEqual(job.workflow["2"].inputs.audio, ["1", 0]);
  assert.equal(job.metadata.mediaType, "audio");
});
