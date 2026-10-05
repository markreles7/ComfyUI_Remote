import test from "node:test";
import assert from "node:assert/strict";
import { buildMiniMaxH3SparseV9Workflow } from "../src/minimax-h3-sparse-workflows.js";
import { buildVideoStudioInitialJob } from "../src/video-studio-workflows.js";
import { buildPlaguekind2TestWorkflow, PLAGUEKIND2_MODE, PLAGUEKIND2_TAIL_NODE } from "../src/plaguekind2-test-workflows.js";
import { planPlaguekind2TestSequences, plaguekind2TestJobInput, splitPlaguekind2History, uploadPlaguekind2Continuity } from "../src/plaguekind2-test-sequences.js";
import { extractImages, extractVideos } from "../src/comfy-client.js";

const config = { h3: { sparseV9: { available: true, files: {
  hybrid: "minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors",
  parasyteTurbo: "parasyte.safetensors", fast6Turbo: "fast6.safetensors",
  clip: "qwen.safetensors", videoVae: "video.safetensors", audioVae: "audio.safetensors",
  latentUpscaler: "upscaler.safetensors",
} } } };
const raw = { videoStudioMode: PLAGUEKIND2_MODE, prompt: "Two hikers approach a cabin.",
  h3SparseMode: "references", duration: 8, seed: 42, h3SparseLatentUpscale: true,
  h3SparseLatentScale: 1.5, h3SparsePostRcas: true, h3SparseContinuityFrames: 22 };
const uploads = { h3ReferenceImages: [{ name: "cabin.png", referenceIndex: 0 }, { name: "hikers.png", referenceIndex: 2 }] };
const guides = (count) => Array.from({ length: count }, (_, i) => ({ name: `frame-${i}.png`, subfolder: "test" }));
const files = (count) => Array.from({ length: count }, (_, i) => ({ filename: `base_${i}.png`, type: "output", subfolder: "VideoStudio/PlagueKind2Test/continuity" }));

test("test graph keeps original sampling and finishing while extracting pre-upscale PNGs", () => {
  const before = buildMiniMaxH3SparseV9Workflow(raw, uploads, [], config);
  const job = buildVideoStudioInitialJob(PLAGUEKIND2_MODE, raw, uploads, [], config);
  assert.deepEqual(job.workflow["34"], before.workflow["34"]);
  assert.deepEqual(job.workflow["44"], before.workflow["44"]);
  assert.deepEqual(job.workflow["55"], before.workflow["55"]);
  assert.deepEqual(job.workflow["9200"].inputs.samples, ["34", 0]);
  assert.deepEqual(job.workflow["9201"].inputs, { image: ["9200", 0], batch_index: 170, length: 22 });
  assert.equal(job.workflow[PLAGUEKIND2_TAIL_NODE].class_type, "SaveImage");
  assert.match(job.workflow["57"].inputs.filename_prefix, /PlagueKind2Test/);
  assert.equal(job.metadata.continuitySource, "base-png");
  assert.deepEqual(buildMiniMaxH3SparseV9Workflow(raw, uploads, [], config), before);
});

test("second sequence preserves reference slots and connects ordered base frames to the guide", () => {
  const input = { ...raw, h3SparseMultiSequence: true, h3SparseSegmentCount: 2, prompt: "Approach the cabin.\n---\nOpen the door." };
  const plan = planPlaguekind2TestSequences(input);
  const prepared = plaguekind2TestJobInput(input, plan, 1, uploads, guides(22));
  const job = buildPlaguekind2TestWorkflow(prepared.raw, prepared.uploads, [], config);
  assert.equal(prepared.raw.prompt, "Open the door.");
  assert.equal(prepared.raw.seed, 43);
  assert.deepEqual(prepared.uploads.h3ReferenceImages, uploads.h3ReferenceImages);
  assert.equal(prepared.uploads.h3ContinuityClip, undefined);
  assert.equal(job.workflow["20"].inputs["ref_images.ref_image_2"][0], "102");
  assert.deepEqual(job.workflow["23"].inputs.conditioning, ["24", 0]);
  assert.deepEqual(job.workflow["44"].inputs.conditioning, ["23", 0]);
  const names = [];
  const walkBatch = ([id]) => {
    const n = job.workflow[id];
    if (n.class_type === "LoadImage") names.push(n.inputs.image);
    else { walkBatch(n.inputs.image1); walkBatch(n.inputs.image2); }
  };
  walkBatch(job.workflow["24"].inputs.image);
  assert.deepEqual(names, guides(22).map((f) => `${f.subfolder}/${f.name}`));
  assert.equal(Object.values(job.workflow).some((n) => n.class_type === "LoadVideo"), false);
});

test("no upscale reuses the base decode and all supported context lengths fit", () => {
  for (const count of [5, 22, 39, 56]) {
    const job = buildPlaguekind2TestWorkflow({ ...raw, h3SparseLatentUpscale: false, h3SparseContinuityFrames: count }, uploads, [], config);
    assert.equal(job.workflow["9200"], undefined);
    assert.deepEqual(job.workflow["50"].inputs.samples, ["34", 0]);
    assert.deepEqual(job.workflow["9201"].inputs.image, ["50", 0]);
    assert.equal(job.workflow["9201"].inputs.batch_index + count, job.metadata.frames);
  }
});

test("missing base context cannot silently fall back to a final video", () => {
  assert.throws(() => buildPlaguekind2TestWorkflow(raw, { ...uploads, h3ContinuityClip: { name: "final.mp4" } }, [], config), /mai il video finale/);
  assert.throws(() => buildPlaguekind2TestWorkflow(raw, { ...uploads, plaguekind2ContinuityImages: guides(5) }, [], config), /22 frame/);
  assert.throws(() => plaguekind2TestJobInput(raw, { count: 2, contextFrames: 22 }, 1, uploads), /Nessun fallback/);
  assert.throws(() => buildPlaguekind2TestWorkflow({ ...raw, h3SparseMultiSequence: true }, uploads, [], config), /job separati/);
});

test("single image mode retains the original image as a reference on continuation", () => {
  const input = { ...raw, h3SparseMode: "image", h3SparseModel: config.h3.sparseV9.files.hybrid,
    h3SparseMultiSequence: true, h3SparseSegmentCount: 2, prompt: "One\n---\nTwo" };
  const prepared = plaguekind2TestJobInput(input, planPlaguekind2TestSequences(input), 1,
    { h3FirstFrame: { name: "first.png" } }, guides(22));
  assert.equal(prepared.raw.h3SparseMode, "references");
  assert.equal(prepared.uploads.h3ReferenceImages[0].name, "first.png");
});

test("history separates continuity PNGs from gallery outputs and preserves chronological order", () => {
  const entry = { outputs: { [PLAGUEKIND2_TAIL_NODE]: { images: files(22) },
    "57": { images: [{ filename: "final.mp4", type: "output", subfolder: "VideoStudio/PlagueKind2Test" }] } } };
  const split = splitPlaguekind2History(entry, 22);
  assert.deepEqual(split.continuityImages, files(22));
  assert.equal(extractImages(split.publicEntry).length, 0);
  assert.equal(extractVideos(split.publicEntry)[0].filename, "final.mp4");
  assert.equal(entry.outputs[PLAGUEKIND2_TAIL_NODE].images.length, 22);
  assert.throws(() => splitPlaguekind2History({ outputs: {} }, 22), /incompleto/);
  assert.throws(() => splitPlaguekind2History({ outputs: { [PLAGUEKIND2_TAIL_NODE]: { images: Array(22).fill(files(1)[0]) } } }, 22), /distinti/);
});

test("persisted context uploads byte-identical PNGs in order and rejects wrong resolution", async (t) => {
  const buffers = Array.from({ length: 5 }, (_, i) => {
    const buffer = Buffer.alloc(25);
    Buffer.from("89504e470d0a1a0a", "hex").copy(buffer);
    buffer.writeUInt32BE(640, 16); buffer.writeUInt32BE(864, 20); buffer[24] = i;
    return buffer;
  });
  t.mock.method(globalThis, "fetch", async (url) => new Response(buffers[Number(url.split("/").at(-1))]));
  const uploaded = [];
  const comfy = { mediaUrl: (file) => `http://test/${files(5).findIndex((f) => f.filename === file.filename)}`,
    uploadImage: async (file) => { uploaded.push(file); return { name: file.originalname }; } };
  const generation = { continuityImages: files(5), width: 640, height: 864 };
  await uploadPlaguekind2Continuity(comfy, generation, 5);
  assert.deepEqual(uploaded.map((file) => file.buffer), buffers);
  assert.equal(new Set(uploaded.map((file) => file.originalname)).size, 5);
  await assert.rejects(uploadPlaguekind2Continuity(comfy, { ...generation, width: 960 }, 5), /risoluzione/);
});

test("promoted PlagueKind H3 preserves its ID and uses base PNG continuity before finishing", () => {
  const input = { ...raw, videoStudioMode: "h3SparseV9", h3SparseMultiSequence: true,
    h3SparseSegmentCount: 2, prompt: "Hikers approach.\n---\nHikers enter." };
  const plan = planPlaguekind2TestSequences(input);
  const first = plaguekind2TestJobInput(input, plan, 0, uploads);
  const job = buildVideoStudioInitialJob("h3SparseV9", first.raw, first.uploads, [], config);
  assert.equal(job.metadata.workflowId, "videoStudio:h3SparseV9");
  assert.equal(job.metadata.videoStudioMode, "h3SparseV9");
  assert.equal(job.metadata.workflowName, "Video Studio · PlagueKind H3");
  assert.equal(job.metadata.continuitySource, "base-png");
  assert.deepEqual(job.workflow["9200"].inputs.samples, ["34", 0]);
  assert.match(job.workflow["9202"].inputs.filename_prefix, /PlagueKindH3\/continuity/);
  const next = plaguekind2TestJobInput(input, plan, 1, uploads, guides(22));
  assert.equal(next.raw.videoStudioMode, "h3SparseV9");
  const second = buildVideoStudioInitialJob("h3SparseV9", next.raw, next.uploads, [], config);
  assert.equal(second.workflow["24"].class_type, "MiniMaxH3AddGuide");
  assert.equal(second.workflow["9300"].inputs.image, "test/frame-0.png");
  assert.equal(second.workflow["9342"].inputs.image, "test/frame-21.png");
});
