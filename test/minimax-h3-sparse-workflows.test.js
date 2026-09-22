import test from "node:test";
import assert from "node:assert/strict";
import { buildMiniMaxH3SparseV9Workflow } from "../src/minimax-h3-sparse-workflows.js";

const config = {
  h3: {
    sparseV9: {
      available: true,
      modelOptions: [
        "minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors",
        "minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors",
        "minimaxH3INT8INT4_fl2vaINT8Pruned.safetensors",
        "minimaxH3INT8INT4_ref2vaINT8Pruned.safetensors",
        "h3ErosMax_beta3.safetensors",
        "pinkcherryMMH3Fl2va_06Beta.safetensors",
      ],
      files: {
        hybrid: "minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors",
        parasyteTurbo: "H3\\turbo\\test\\H3-PK-Parasyte-Turbo.safetensors",
        fast6Turbo: "H3\\turbo\\test\\fasth3_6step.safetensors",
        clip: "qwen3vl_32b_minimax_h3_int8_convrot.safetensors",
        videoVae: "minimax_h3_video_vae_int8_convrot.safetensors",
        audioVae: "minimax_h3_audio_vae_fp32.safetensors",
        latentUpscaler: "minimax_h3_latent_upscaler_3d_bf16.safetensors",
        film: "film_net_fp16.safetensors",
      },
    },
  },
};

const firstFrame = { name: "first.png", subfolder: "remote", type: "input" };

test("Sparse V9 conserva il sampling originale, forza Low VRAM e bypassa la finitura", () => {
  const job = buildMiniMaxH3SparseV9Workflow({ prompt: "A timed cinematic scene." }, { h3FirstFrame: firstFrame }, [], config);
  assert.equal(job.workflow["1"].inputs.unet_name, config.h3.sparseV9.files.hybrid);
  assert.equal(job.workflow["5"].inputs.sparsity_ratio, 0.7);
  assert.equal(job.workflow["5"].inputs.dense_steps, "1");
  assert.equal(job.workflow["5"].inputs.engine, "comfy_kitchen");
  assert.equal(job.workflow["5"].inputs.protect_audio, false);
  assert.equal(job.workflow["5"].inputs.stabilize_motion, false);
  assert.equal(job.workflow["5"].inputs.use_int8_qk, true);
  assert.equal(job.workflow["7"].class_type, "MiniMaxLowVRAMAttention");
  assert.equal(job.workflow["8"].class_type, "MiniMaxChunkFeedForward");
  assert.equal(job.workflow["23"].class_type, "RemoteUnloadCLIP");
  assert.deepEqual(job.workflow["23"].inputs.conditioning, ["20", 0]);
  assert.deepEqual(job.workflow["23"].inputs.clip, ["4", 0]);
  assert.deepEqual(job.workflow["31"].inputs.conditioning, ["23", 0]);
  assert.equal(job.metadata.lowVramEnabled, true);
  assert.equal(job.workflow["32"].class_type, "SamplerER_SDE");
  assert.deepEqual(job.workflow["32"].inputs, { solver_type: "ODE", max_stage: 3, eta: 0, s_noise: 1 });
  assert.equal(job.workflow["33"].inputs.scheduler, "beta57");
  assert.equal(job.workflow["33"].inputs.steps, 8);
  assert.equal(job.workflow["11"].inputs.mode, "strip");
  assert.match(job.workflow["11"]._meta.title, /Windows safe/);
  assert.equal(job.metadata.adalnMode, "strip");
  assert.equal(job.metadata.frames, 192);
  assert.deepEqual(job.metadata.stages, {
    latentUpscale: false, upscaleWidth: 1152, upscaleHeight: 864,
    temporalChunks: false, spatialTiling: false, film: false, rtx: false, sharpen: false,
  });
  assert.equal(job.workflow["44"], undefined);
  assert.equal(job.workflow["53"], undefined);
  assert.equal(job.workflow["54"], undefined);
  assert.equal(job.workflow["55"], undefined);
});

test("Sparse V9 forza Low VRAM in ogni modalità anche con una bozza UI obsoleta", () => {
  const imageJob = buildMiniMaxH3SparseV9Workflow({
    prompt: "An image scene.", h3SparseLowVram: false,
  }, { h3FirstFrame: firstFrame }, [], config);
  assert.equal(imageJob.workflow["7"].class_type, "MiniMaxLowVRAMAttention");
  assert.equal(imageJob.workflow["8"].class_type, "MiniMaxChunkFeedForward");
  assert.equal(imageJob.metadata.lowVramEnabled, true);
  const job = buildMiniMaxH3SparseV9Workflow({
    prompt: "A timed reference scene.", h3SparseMode: "references", h3SparseLowVram: false,
  }, { h3ReferenceImages: [firstFrame] }, [], config);
  assert.equal(job.workflow["7"].class_type, "MiniMaxLowVRAMAttention");
  assert.equal(job.workflow["8"].class_type, "MiniMaxChunkFeedForward");
  assert.equal(job.metadata.lowVramEnabled, true);
});

test("Sparse V9 conserva solo il latent upscale interno e rinvia FILM RTX RCAS al finishing manuale", () => {
  const job = buildMiniMaxH3SparseV9Workflow({
    prompt: "A timed cinematic scene.", h3SparseLatentUpscale: true,
    h3SparseTemporalChunks: true, h3SparseSpatialTiling: true,
    h3SparseFilm: true, h3SparseRtx: true, h3SparseSharpen: true,
  }, { h3FirstFrame: firstFrame }, [], config);
  assert.equal(job.workflow["41"].inputs.width, 1152);
  assert.equal(job.workflow["41"].inputs.height, 864);
  assert.equal(job.workflow["42"].inputs.chunk_length, 102);
  assert.equal(job.workflow["43"].inputs.token_budget, 70000);
  assert.equal(job.workflow["53"], undefined);
  assert.equal(job.workflow["54"], undefined);
  assert.equal(job.workflow["55"], undefined);
  assert.equal(job.workflow["56"].inputs.fps, 24);
});

test("Sparse V9 mantiene Parasyte interno e aggiunge le LoRA utente nello stesso loader", () => {
  const job = buildMiniMaxH3SparseV9Workflow({ prompt: "A timed cinematic scene." }, { h3FirstFrame: firstFrame }, [
    { name: "H3\\NSFW_PlagueKind-tiddies-realismslider.safetensors", strength: 1.1 },
  ], config);
  const stack = JSON.parse(job.workflow["9"].inputs.stack_data);
  assert.deepEqual(stack.slice(0, 2).map((item) => [item.on, item.str]), [[true, 1.5], [false, 0.5]]);
  assert.equal(stack[2].lora, "H3\\NSFW_PlagueKind-tiddies-realismslider.safetensors");
  assert.equal(stack[2].str, 1.1);
});

test("Sparse V9 concatena più sequenze con una sola immagine iniziale e lo stack PlagueKind intatto", () => {
  const job = buildMiniMaxH3SparseV9Workflow({
    prompt: "Prima sequenza completa.\n---\nSeconda sequenza causale.\n---\nTerza sequenza causale.",
    h3SparseMode: "image",
    h3SparseMultiSequence: true,
    h3SparseSegmentCount: 3,
    h3SparseContinuityFrames: 39,
    duration: 5,
  }, { h3FirstFrame: firstFrame }, [], config);
  assert.equal(job.workflow["20"].class_type, "MiniMaxH3Director");
  assert.deepEqual(job.workflow["20"].inputs.model, ["11", 0]);
  assert.equal(job.workflow["20"].inputs.sampler, "er_sde");
  assert.equal(job.workflow["20"].inputs.scheduler, "beta57");
  assert.equal(job.workflow["20"].inputs.steps, 8);
  const timeline = JSON.parse(job.workflow["20"].inputs.timeline_data);
  assert.equal(timeline.preconditionAllSegments, true);
  assert.equal(timeline.unloadClipAfterConditioning, true);
  assert.equal(timeline.keepModelWarmBetweenSegments, false);
  assert.equal(timeline.segments.length, 3);
  assert.equal(timeline.output.continuityOverlapFrames, 39);
  assert.equal(timeline.segments[0].startImage.imageFile, "remote/first.png");
  assert.equal(timeline.segments[1].startImage, null);
  assert.equal(timeline.segments[1].continuityFromPrev, true);
  assert.match(timeline.segments[0].taskType, /^i2v/u);
  assert.match(timeline.segments[1].taskType, /^t2v/u);
  assert.deepEqual(job.workflow["56"].inputs.audio, ["20", 1]);
  assert.equal(job.workflow["59"].class_type, "DisTorchPurgeVRAMV2");
  assert.deepEqual(job.workflow["59"].inputs.anything, ["20", 0]);
  assert.equal(job.metadata.segmentCount, 3);
  assert.equal(job.metadata.duration, 15);
  assert.equal(job.metadata.startImageStrategy, "first-image-then-previous-segment");
});

test("Sparse V9 applica il purge estremo tra sequenze di 8, 10 o 12 secondi", () => {
  for (const duration of [8, 10, 12]) {
    const job = buildMiniMaxH3SparseV9Workflow({
      prompt: "Prima sequenza.\n---\nSeconda sequenza.",
      h3SparseMode: "image",
      h3SparseMultiSequence: true,
      h3SparseSegmentCount: 2,
      duration,
    }, { h3FirstFrame: firstFrame }, [], config);
    const director = job.workflow["20"];
    const timeline = JSON.parse(director.inputs.timeline_data);

    assert.equal(director.inputs.clear_vram_between_segments, true, `${duration}s`);
    assert.equal(timeline.keepModelWarmBetweenSegments, false, `${duration}s`);
    assert.deepEqual(timeline.segments.map((segment) => segment.durationSec), [duration, duration]);
  }
});

test("Sparse V9 ignora le vecchie opzioni salvate di finishing durante la generazione", () => {
  const job = buildMiniMaxH3SparseV9Workflow({
    prompt: "Prima sequenza.\n---\nSeconda sequenza.",
    h3SparseMode: "image", h3SparseMultiSequence: true,
    h3SparseSegmentCount: 2, h3SparseSharpen: true,
  }, { h3FirstFrame: firstFrame }, [], config);
  assert.equal(job.workflow["53"], undefined);
  assert.equal(job.workflow["54"], undefined);
  assert.equal(job.workflow["55"], undefined);
  assert.deepEqual(job.metadata.stages, {
    latentUpscale: false, upscaleWidth: 1152, upscaleHeight: 864,
    temporalChunks: false, spatialTiling: false, film: false, rtx: false, sharpen: false,
  });
});

test("Sparse V9 condivide le reference lungo tutta la catena continuativa", () => {
  const job = buildMiniMaxH3SparseV9Workflow({
    prompt: "Prima sequenza.\n---\nSeconda sequenza.",
    h3SparseMode: "references",
    h3SparseMultiSequence: true,
    h3SparseSegmentCount: 2,
  }, { h3ReferenceImages: [firstFrame] }, [], config);
  const timeline = JSON.parse(job.workflow["20"].inputs.timeline_data);
  assert.match(timeline.global.taskType, /^r2v/u);
  assert.equal(timeline.segments[0].refs[0].imageFile, "remote/first.png");
  assert.equal(timeline.segments[1].refs[0].imageFile, "remote/first.png");
  assert.equal(job.metadata.lowVramEnabled, true);
});

test("Sparse V9 blocca concatenazioni ambigue e latent upscale per singola clip", () => {
  assert.throws(() => buildMiniMaxH3SparseV9Workflow({
    prompt: "Un solo prompt", h3SparseMultiSequence: true,
  }, { h3FirstFrame: firstFrame }, [], config), /da 2 a 8 prompt/u);
  assert.throws(() => buildMiniMaxH3SparseV9Workflow({
    prompt: "Prima.\n---\nSeconda.", h3SparseMultiSequence: true,
    h3SparseSegmentCount: 2, h3SparseLatentUpscale: true,
  }, { h3FirstFrame: firstFrame }, [], config), /latent upscale MMH3/u);
  assert.throws(() => buildMiniMaxH3SparseV9Workflow({
    prompt: "Prima.\n---\nSeconda.", h3SparseMode: "firstLast", h3SparseMultiSequence: true,
  }, { h3FirstFrame: firstFrame, h3LastFrame: firstFrame }, [], config), /First \/ Last Frame/u);
});

test("Sparse V9 permette di scegliere qualsiasi modello H3 installato e verifica la modalità", () => {
  const b25 = "minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors";
  const job = buildMiniMaxH3SparseV9Workflow({
    prompt: "A coherent action shot.", h3SparseModel: b25,
  }, { h3FirstFrame: firstFrame }, [], config);
  assert.equal(job.workflow["1"].inputs.unet_name, b25);
  assert.equal(job.metadata.modelFile, b25);
  assert.throws(() => buildMiniMaxH3SparseV9Workflow({
    prompt: "Reference shot.", h3SparseMode: "references",
    h3SparseModel: "minimaxH3INT8INT4_fl2vaINT8Pruned.safetensors",
  }, { h3ReferenceImages: [firstFrame] }, [], config), /non supporta la modalità references/u);
  assert.throws(() => buildMiniMaxH3SparseV9Workflow({
    prompt: "Shot.", h3SparseModel: "missing-h3.safetensors",
  }, { h3FirstFrame: firstFrame }, [], config), /non è installato/u);
});
