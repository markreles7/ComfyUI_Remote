import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const basePath = path.join(here, "PlagueKind_H3_V9_Continuous_R2V_ComfyUI.json");
const profilePath = path.join(here, "PlagueKind_H3_V9_Reference_ComfyUI.json");
const refineExamplePath = path.join(here, "..", "tmp_director_repo", "example_workflows", "minimax_h3_director_二采_加速.json");
const workflow = JSON.parse(fs.readFileSync(basePath, "utf8"));
const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
const refineExample = JSON.parse(fs.readFileSync(refineExamplePath, "utf8"));

const find = (nodes, id) => {
  const node = nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Nodo ${id} mancante`);
  return node;
};
const byType = (nodes, type) => {
  const node = nodes.find((item) => item.type === type);
  if (!node) throw new Error(`Nodo ${type} mancante`);
  return node;
};
const clone = (source, id, title, pos) => {
  const node = structuredClone(source);
  node.id = id;
  node.title = title;
  node.pos = pos;
  node.mode = 0;
  node.order = id;
  for (const input of node.inputs || []) input.link = null;
  for (const output of node.outputs || []) output.links = [];
  return node;
};
const connect = (origin, originSlot, target, targetSlot, type) => {
  const id = ++workflow.last_link_id;
  workflow.links.push([id, origin.id, originSlot, target.id, targetSlot, type]);
  origin.outputs[originSlot].links ??= [];
  origin.outputs[originSlot].links.push(id);
  target.inputs[targetSlot].link = id;
};
const disconnectInput = (node, inputIndex) => {
  const oldId = node.inputs[inputIndex]?.link;
  if (oldId == null) return;
  const old = workflow.links.find((link) => link[0] === oldId);
  if (old) {
    const origin = find(workflow.nodes, old[1]);
    origin.outputs[old[2]].links = (origin.outputs[old[2]].links || []).filter((id) => id !== oldId);
  }
  workflow.links = workflow.links.filter((link) => link[0] !== oldId);
  node.inputs[inputIndex].link = null;
};

const director = byType(workflow.nodes, "MiniMaxH3Director");
const createVideo = byType(workflow.nodes, "CreateVideo");
const modelGroup = profile.definitions.subgraphs.find((group) => group.name === "Main Model Loader");
const samplerGroup = profile.definitions.subgraphs.find((group) => group.name === "Conditioning - Sampler");
const enhancementGroup = profile.definitions.subgraphs.find((group) => group.name === "Enhancements");

// The packaged base was exported before these optional Director sockets were
// serialized. Current Director versions expose them before the widget inputs.
if (!director.inputs.some((input) => input.name === "refine")) {
  director.inputs.splice(4, 0,
    { name: "i2v_groups", type: "MMX_I2V_GROUPS", shape: 7, link: null },
    { name: "r2v_groups", type: "MMX_R2V_GROUPS", shape: 7, link: null },
    { name: "semantic_bridge", type: "MMX_DIR_SEMANTIC_BRIDGE", shape: 7, link: null },
    { name: "selflift", type: "MMX_DIR_SELFLIFT", shape: 7, link: null },
    { name: "refine", type: "MMX_DIR_REFINE", shape: 7, link: null },
    { name: "face_refine", type: "MMX_DIR_FACE_REFINE", shape: 7, link: null },
    { name: "sigmas", type: "SIGMAS", shape: 7, link: null },
  );
}

// Use a clean, patched H3 branch for the high-resolution second pass.
const chunk = find(workflow.nodes, 14);
const cleanFix = clone(find(samplerGroup.nodes, 5599), 18, "UHD refine · clean AdaLN model", [1420, 560]);
const scheduler = clone(byType(refineExample.nodes, "BasicScheduler"), 19, "UHD refine · 3 steps / denoise 0.20", [1740, 560]);
scheduler.widgets_values = ["beta", 3, 0.2];
scheduler.widgets_values_named = { scheduler: "beta", steps: 3, denoise: 0.2 };
const refine = clone(byType(refineExample.nodes, "MiniMaxH3DirectorRefine"), 20, "Director H3 latent upscale + refine AUTO · 1920×1088", [2040, 500]);
// Keep the serialized sockets aligned with the current Director node. The
// upstream example predates the last five optional widgets: cloning its stale
// socket list can shift the checkbox values when ComfyUI reconstructs the node.
refine.inputs = [
  { localized_name: "refine_model", name: "refine_model", shape: 7, type: "MODEL", link: null },
  { localized_name: "sigmas", name: "sigmas", shape: 7, type: "SIGMAS", link: null },
  { localized_name: "upscale_model", name: "upscale_model", shape: 7, type: "UPSCALE_MODEL", link: null },
  ...[
    ["mode", "COMBO"],
    ["upscale_method", "COMBO"],
    ["latent_upscale_model", "COMBO"],
    ["sampler", "COMBO"],
    ["passes", "INT"],
    ["seed_mode", "COMBO"],
    ["aspect_ratio", "COMBO"],
    ["megapixels", "FLOAT"],
    ["width", "INT"],
    ["height", "INT"],
    ["skip_fl2v", "BOOLEAN"],
    ["confirm_first_pass", "BOOLEAN"],
    ["enable_latent_chunking", "BOOLEAN"],
    ["enable_tiling", "BOOLEAN"],
    ["tile_count", "INT"],
    ["tile_overlap", "INT"],
  ].map(([name, type]) => ({ localized_name: name, name, shape: 7, type, widget: { name }, link: null })),
];
refine.widgets_values = [
  "upscale", "h3_latent", "minimax_h3_latent_upscaler_3d_bf16.safetensors",
  "euler", 1, "inherit", "16:9 (Widescreen)", 2.0, 1920, 1088, true,
  false, true, true, 2, 128,
];
refine.widgets_values_named = {
  mode: "upscale",
  upscale_method: "h3_latent",
  latent_upscale_model: "minimax_h3_latent_upscaler_3d_bf16.safetensors",
  sampler: "euler",
  passes: 1,
  seed_mode: "inherit",
  aspect_ratio: "16:9 (Widescreen)",
  megapixels: 2.0,
  width: 1920,
  height: 1088,
  skip_fl2v: true,
  confirm_first_pass: false,
  enable_latent_chunking: true,
  enable_tiling: true,
  tile_count: 2,
  tile_overlap: 128,
};
workflow.nodes.push(cleanFix, scheduler, refine);
connect(chunk, 0, cleanFix, 0, "MODEL");
connect(cleanFix, 0, scheduler, 0, "MODEL");
connect(cleanFix, 0, refine, 0, "MODEL");
connect(scheduler, 0, refine, 1, "SIGMAS");
const refineInput = director.inputs.findIndex((input) => input.name === "refine");
if (refineInput < 0) throw new Error("Ingresso refine del Director mancante");
connect(refine, 0, director, refineInput, "MMX_DIR_REFINE");

// Pixel-space finish: exact UHD with conservative RCAS sharpening.
const rtxSource = find(enhancementGroup.nodes, 5844);
const rtx = clone(rtxSource, 21, "UHD · RTX Video Super Resolution 3840×2160", [2920, 60]);
rtx.inputs = [
  { localized_name: "images", name: "images", type: "IMAGE", link: null },
  { localized_name: "resize_type", name: "resize_type", type: "COMFY_DYNAMICCOMBO_V3", widget: { name: "resize_type" }, link: null },
  { localized_name: "width", name: "resize_type.width", type: "INT", widget: { name: "resize_type.width" }, link: null },
  { localized_name: "height", name: "resize_type.height", type: "INT", widget: { name: "resize_type.height" }, link: null },
  { localized_name: "quality", name: "quality", type: "COMBO", widget: { name: "quality" }, link: null },
];
rtx.widgets_values = ["target dimensions", 3840, 2160, "HIGH"];
rtx.widgets_values_named = {
  resize_type: "target dimensions",
  "resize_type.width": 3840,
  "resize_type.height": 2160,
  quality: "HIGH",
};
const sharpen = clone(find(enhancementGroup.nodes, 5845), 22, "UHD · RCAS sharpening 0.20", [3260, 60]);
sharpen.widgets_values = ["rcas", 0.2];
sharpen.widgets_values_named = { method: "rcas", "method.strength": 0.2 };
workflow.nodes.push(rtx, sharpen);
disconnectInput(createVideo, 0);
connect(director, 0, rtx, 0, "IMAGE");
connect(rtx, 0, sharpen, 0, "IMAGE");
connect(sharpen, 0, createVideo, 0, "IMAGE");

createVideo.pos = [3580, 60];
const saveVideo = byType(workflow.nodes, "SaveVideo");
saveVideo.pos = [3930, 60];
saveVideo.widgets_values[0] = "video/PlagueKindH3SparseV9_Continuous_UHD";
for (const node of workflow.nodes.filter((item) => [8, 9, 10].includes(item.id))) node.pos[0] = 3580;

// UHD preset: two 12-second shots, native first pass at about 1 MP, 2 MP latent refine.
const timelineIndex = 11;
const timeline = JSON.parse(director.widgets_values[timelineIndex]);
const frames = 294;
timeline.frameRate = 24;
timeline.width = 1344;
timeline.height = 768;
timeline.refMaxSize = 1344;
timeline.totalFrames = frames * 2;
timeline.durationSec = 24;
timeline.output.aspectRatio = "16:9 (Widescreen)";
timeline.output.megapixels = 0.98;
timeline.output.longEdge = 1344;
timeline.output.width = 1344;
timeline.output.height = 768;
timeline.gen.defaultFrameCount = frames;
timeline.segments.forEach((segment, index) => {
  segment.start = index * frames;
  segment.length = frames;
  segment.frameCount = frames;
  segment.durationSec = 12;
});
director.widgets_values[7] = 1344;
director.widgets_values[8] = 768;
director.widgets_values[9] = 1344;
director.widgets_values[10] = frames * 2;
director.widgets_values[timelineIndex] = JSON.stringify(timeline);
director.title = "PlagueKind H3 V9 · Director R2V UHD continuativo";

const note = byType(workflow.nodes, "MarkdownNote");
note.widgets_values = ["PLAGUEKIND H3 V9 · CONTINUOUS UHD\n\nTwo 12-second R2V asset groups produce one continuous video. Shared params are prepended to every asset prompt; From prev and 22 context frames preserve the handoff.\n\nQuality path: 1344×768 first pass → H3 learned latent upscale and 3-step refine at 1920×1088 → RTX VSR exact 3840×2160 HIGH → RCAS 0.20 → one UHD file with native audio.\n\nFor a quick draft, bypass RTX VSR and RCAS and disconnect the Refine input. Keep FILM interpolation off for cinematic 24 fps."];
note.pos = [2040, 1460];
note.size = [1050, 360];
workflow.groups = [
  { id: 1, title: "PlagueKind V9 model and memory stack", bounding: [-780, 20, 2520, 460], color: "#3f789e", flags: {} },
  { id: 2, title: "Director · references, two continuous assets and H3 refine", bounding: [1760, 20, 1130, 1820], color: "#8A8", flags: {} },
  { id: 3, title: "UHD finish · RTX VSR + RCAS", bounding: [2880, 20, 1500, 900], color: "#b58", flags: {} },
];
workflow.last_node_id = 22;
workflow.extra = {
  ...(workflow.extra || {}),
  plagueKindContinuousR2VUHD: true,
  plagueKindAutoRefineSingleQueue: true,
};

const output = path.join(here, "PlagueKind_H3_V9_Continuous_R2V_UHD_ComfyUI.json");
fs.writeFileSync(output, JSON.stringify(workflow, null, 2) + "\n");
console.log(output);
