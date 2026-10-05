import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "upstream_director_r2v.json");
const profileSource = path.join(here, "PlagueKind_H3_V9_Reference_ComfyUI.json");
const workflow = JSON.parse(fs.readFileSync(source, "utf8"));
const profile = JSON.parse(fs.readFileSync(profileSource, "utf8"));
const find = (nodes, id) => {
  const result = nodes.find((node) => node.id === id);
  if (!result) throw new Error(`Nodo ${id} mancante`);
  return result;
};
const director = find(workflow.nodes, 5);
const modelGroup = profile.definitions.subgraphs.find((group) => group.name === "Main Model Loader");
const samplerGroup = profile.definitions.subgraphs.find((group) => group.name === "Conditioning - Sampler");
const clone = (sourceNode, id, title, pos) => {
  const result = structuredClone(sourceNode);
  result.id = id;
  result.title = title;
  result.pos = pos;
  result.mode = 0;
  result.order = id;
  for (const input of result.inputs || []) input.link = null;
  for (const output of result.outputs || []) output.links = [];
  return result;
};
const connect = (origin, originSlot, target, targetSlot, type) => {
  const id = ++workflow.last_link_id;
  workflow.links.push([id, origin.id, originSlot, target.id, targetSlot, type]);
  origin.outputs[originSlot].links ??= [];
  origin.outputs[originSlot].links.push(id);
  target.inputs[targetSlot].link = id;
  return id;
};

// Exact PlagueKind V9 model files already installed by this package.
find(workflow.nodes, 1).widgets_values = ["video/minimax_h3_hybrid_fl2va_ref2va_b30-49-int8.safetensors", "default"];
find(workflow.nodes, 2).widgets_values = ["qwen3vl_32b_minimax_h3_int8_convrot.safetensors", "minimax", "default"];
find(workflow.nodes, 3).widgets_values = ["minimax_h3_video_vae_int8_convrot.safetensors"];
find(workflow.nodes, 4).widgets_values = ["minimax_h3_audio_vae_fp32.safetensors"];
// Use the current ComfyUI CreateVideo/SaveVideo schemas from the V9 export.
const enhancementGroup = profile.definitions.subgraphs.find((group) => group.name === "Enhancements");
const oldCreate = find(workflow.nodes, 6);
const oldSave = find(workflow.nodes, 7);
const createVideo = clone(find(enhancementGroup.nodes, 5839), 6, "PlagueKind V9 · continuous master", oldCreate.pos);
const saveVideo = clone(find(profile.nodes, 5480), 7, "PlagueKind V9 · save continuous video", oldSave.pos);
createVideo.widgets_values = [24, 8, "sRGB"];
saveVideo.widgets_values = ["video/PlagueKindH3SparseV9_Continuous", "auto", "h264", "re-encode", 10, "auto"];
workflow.nodes[workflow.nodes.indexOf(oldCreate)] = createVideo;
workflow.nodes[workflow.nodes.indexOf(oldSave)] = saveVideo;
const link5 = workflow.links.find((link) => link[0] === 5);
const link6 = workflow.links.find((link) => link[0] === 6);
const link7 = workflow.links.find((link) => link[0] === 7);
const link9 = workflow.links.find((link) => link[0] === 9);
link5[4] = 0; createVideo.inputs[0].link = 5;
link6[4] = 1; createVideo.inputs[1].link = 6;
link7[4] = 2; createVideo.inputs[2].link = 7;
createVideo.outputs[0].links = [9];
link9[1] = 6; link9[2] = 0; link9[3] = 7; link9[4] = 0;
saveVideo.inputs[0].link = 9;

// Replace direct UNET -> Director with the stable V9 patch stack.
workflow.links = workflow.links.filter((link) => link[0] !== 1);
find(workflow.nodes, 1).outputs[0].links = [];
director.inputs[0].link = null;
const sla = clone(find(modelGroup.nodes, 5603), 12, "PlagueKind V9 · SLA Sparse Attention 0.70", [-310, 60]);
sla.widgets_values = [0.7, "32", 12288, 0, false, true, "1", "comfy_kitchen", true, false, "Off", false, true, "comfy_kitchen"];
const low = clone(find(modelGroup.nodes, 5604), 13, "PlagueKind V9 · Low VRAM Attention", [-10, 60]);
low.widgets_values = [4];
const chunk = clone(find(modelGroup.nodes, 5616), 14, "PlagueKind V9 · Chunk Feed Forward", [290, 60]);
chunk.widgets_values = [2, 4096];
const lora = clone(find(profile.nodes, 5511), 15, "PlagueKind V9 · Parasyte Turbo 1.5", [590, 60]);
const preview = clone(find(profile.nodes, 5626), 16, "PlagueKind V9 · TAE Preview", [1010, 60]);
preview.size = [360, 330];
const adaln = clone(find(samplerGroup.nodes, 5599), 17, "PlagueKind V9 · AdaLN strip", [1390, 60]);
workflow.nodes.push(sla, low, chunk, lora, preview, adaln);
workflow.last_node_id = 17;
connect(find(workflow.nodes, 1), 0, sla, 0, "MODEL");
connect(sla, 0, low, 0, "MODEL");
connect(low, 0, chunk, 0, "MODEL");
connect(chunk, 0, lora, 0, "MODEL");
connect(lora, 0, preview, 0, "MODEL");
connect(preview, 0, adaln, 0, "MODEL");
connect(adaln, 0, director, 0, "MODEL");

const segmentFrames = 192;
const prompt1 = "[reference generation]\nSequence 1. Establish the scene using the shared Picture, Video and Audio references. Preserve every defined subject, environment, scale and visual identity. Begin a coherent action with synchronized natural audio.";
const prompt2 = "[reference generation]\nSequence 2. Continue directly from the preceding segment. Preserve the final camera placement, subject positions, poses, motion direction, lighting, environment, identity and audio ambience. Complete the next phase of the action without a reset or jump cut.";
const segment = (id, index, prompt) => ({
  id, start: index * segmentFrames, length: segmentFrames, frameCount: segmentFrames,
  durationSec: 8, prompt, negativePrompt: "", taskType: "", refs: [], refVideos: [], refAudios: [],
  genImage: { imageFile: "" }, startImage: null, endImage: null,
  continuityFromPrev: index > 0, refImageSize: "match",
});
const timeline = {
  version: 5,
  preconditionAllSegments: true,
  unloadClipAfterConditioning: true,
  keepModelWarmBetweenSegments: false,
  editMode: "segment",
  timelineMode: "prompt_batch",
  totalFrames: segmentFrames * 2,
  frameRate: 24,
  width: 1120,
  height: 832,
  refMaxSize: 1120,
  video: { fileName: "", videoFile: "", subfolder: "", type: "input", frames: [], frameMap: [], sourceFrameCount: 0, deletedSourceRanges: [] },
  videoClips: [],
  global: {
    taskType: "r2v — 参考主体生视频(Reference to Video)", prompt: "",
    refs: [], refVideos: [], refAudios: [],
    referenceVideo: { videoFile: "", fileName: "", type: "input", subfolder: "" },
    continuousReference: false, genImage: { imageFile: "" }, commonEnabled: true, commonCollapsed: false,
  },
  output: {
    mode: "fixed", aspectRatio: "4:3 (Standard)", megapixels: 0.98, multiple: 32,
    longEdge: 1120, width: 1120, height: 832, maxExportFrames: 0, exportMode: "all",
    audioMode: "generate", exportSourceImages: false, refImageSize: "match",
    continuityEnabled: true, continuityOverlapFrames: 22,
  },
  runSelectEnabled: false, runSelection: [],
  segments: [segment("plaguekind_1", 0, prompt1), segment("plaguekind_2", 1, prompt2)],
  gen: { defaultFrameCount: segmentFrames }, durationSec: 16, liveTaePreview: false, batchDetailMode: "solo",
};
director.title = "PlagueKind H3 V9 · Director R2V continuativo";
director.pos = [1800, 60];
director.size = [1050, 900];
director.widgets_values = [
  timeline.global.taskType,
  "",
  "Sampling",
  1,
  174493875427538,
  "fixed",
  24,
  1120,
  832,
  1120,
  segmentFrames * 2,
  JSON.stringify(timeline),
  "Advanced",
  8,
  "er_sde",
  "beta57",
  12,
  3,
  "Performance",
  true,
  false,
];
find(workflow.nodes, 6).pos = [2910, 60];
find(workflow.nodes, 7).pos = [3260, 60];
for (const id of [8, 9, 10]) find(workflow.nodes, id).pos[0] = 2910;
const note = find(workflow.nodes, 11);
note.pos = [1800, 1000];
note.size = [1050, 430];
note.widgets_values = ["PLAGUEKIND H3 V9 · CONTINUOUS REFERENCE GENERATION\n\nOpen the Director node. Shared parameters accepts Picture 1-9, Video 1-3 and Audio 1-3. Add or duplicate segments in the timeline (2-8 recommended). Keep Continuity enabled and Use previous segment enabled from segment 2 onward.\n\nThe included timeline starts with two 8-second R2V segments, 4:3 at 1120x832, overlap 22 frames, ER-SDE ODE, beta57 and 8 steps. Edit each segment prompt. Shared references remain available across the entire sequence.\n\nQueue Prompt saves one joined video with native audio."];
workflow.groups = [
  { id: 1, title: "PlagueKind V9 model and memory stack", bounding: [-780, 20, 2520, 460], color: "#3f789e", flags: {} },
  { id: 2, title: "Director · shared references and continuous segments", bounding: [1760, 20, 1130, 1430], color: "#8A8", flags: {} },
  { id: 3, title: "Output", bounding: [2880, 20, 900, 900], color: "#b58", flags: {} },
];
workflow.extra = { ...(workflow.extra || {}), plagueKindContinuousR2V: true };
const output = path.join(here, "PlagueKind_H3_V9_Continuous_R2V_ComfyUI.json");
fs.writeFileSync(output, JSON.stringify(workflow, null, 2) + "\n");
console.log(output);
