import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMiniMaxH3SparseV9Workflow } from "../src/minimax-h3-sparse-workflows.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "exports", "PlagueKind_H3_Sparse_V9_2026-09-15");
const originalPath = "C:/Users/JohnWick7/Downloads/plaguekindMinimaxH3SparseAttention_h3V9.json";
const apiPath = path.join(outputRoot, "PlagueKind_H3_Sparse_V9_LowVRAM_QwenUnload_API.json");
const comfyPath = path.join(outputRoot, "PlagueKind_H3_Sparse_V9_LowVRAM_QwenUnload_ComfyUI.json");

fs.mkdirSync(outputRoot, { recursive: true });

const response = await fetch("http://100.77.122.74:3000/api/config");
if (!response.ok) throw new Error(`Impossibile leggere /api/config: HTTP ${response.status}`);
const appConfig = await response.json();
const config = appConfig.videoStudio;
const placeholder = { name: "PLACEHOLDER_FIRST_FRAME.png", subfolder: "", type: "input" };
const prompt = "A cinematic continuous scene with coherent physical motion, stable identity, intentional camera movement and synchronized native audio.";

const job = buildMiniMaxH3SparseV9Workflow({
  h3SparseMode: "image",
  h3SparseAspectRatio: "4:3 (Standard)",
  h3SparseMegapixels: 0.98,
  h3SparseSparsity: 0.7,
  h3SparseSteps: 8,
  h3SparseCache: false,
  h3SparseLowVram: true,
  h3SparseLatentUpscale: false,
  duration: 8,
  seed: 123456,
  prompt,
}, { h3FirstFrame: placeholder }, [], config);

fs.writeFileSync(apiPath, `${JSON.stringify(job.workflow, null, 2)}\n`, "utf8");

const comfy = JSON.parse(fs.readFileSync(originalPath, "utf8"));
const loaderGroup = comfy.definitions.subgraphs.find((graph) => graph.name === "Main Model Loader");
const samplerGroup = comfy.definitions.subgraphs.find((graph) => graph.name === "Conditioning - Sampler");
if (!loaderGroup || !samplerGroup) throw new Error("Il workflow grafico PlagueKind non contiene i gruppi attesi.");

// Force the Low-VRAM branch both at the exposed group widget and internally.
const loaderNode = comfy.nodes.find((node) => node.id === 5310);
loaderNode.widgets_values[15] = true;
const lowVramPrimitive = loaderGroup.nodes.find((node) => node.id === 5618);
lowVramPrimitive.widgets_values = [true];
lowVramPrimitive.widgets_values_named = { value: true };
const lowVramSwitch = loaderGroup.nodes.find((node) => node.id === 5617);
lowVramSwitch.widgets_values = [true];
lowVramSwitch.widgets_values_named = { switch: true };

// Match the stable production path: dedicated ER-SDE ODE and AdaLN strip.
const samplerNode = comfy.nodes.find((node) => node.id === 5479);
samplerNode.widgets_values[4] = true;
const samplerPrimitive = samplerGroup.nodes.find((node) => node.id === 5621);
samplerPrimitive.widgets_values = [true];
samplerPrimitive.widgets_values_named = { value: true };
const samplerSwitch = samplerGroup.nodes.find((node) => node.id === 5620);
samplerSwitch.widgets_values = [true];
samplerSwitch.widgets_values_named = { switch: true };
const adaln = samplerGroup.nodes.find((node) => node.id === 5599);
adaln.widgets_values = ["strip"];
adaln.widgets_values_named = { mode: "strip" };

// Insert an explicit dependency boundary after the I2V/R2V conditioning
// switch. It releases only Qwen/CLIP before the sampler starts.
const unloadNodeId = Math.max(comfy.last_node_id, ...comfy.definitions.subgraphs.flatMap((graph) => graph.nodes.map((node) => Number(node.id) || 0))) + 1;
const allLinks = [
  ...(comfy.links || []),
  ...comfy.definitions.subgraphs.flatMap((graph) => graph.links || []),
];
const conditioningInputLink = Math.max(comfy.last_link_id, ...allLinks.map((link) => Number(link.id ?? link[0]) || 0)) + 1;
const clipInputLink = conditioningInputLink + 1;
const oldConditioningLink = samplerGroup.links.find((link) => link.id === 15013);
oldConditioningLink.origin_id = unloadNodeId;
oldConditioningLink.origin_slot = 0;
const conditioningSwitch = samplerGroup.nodes.find((node) => node.id === 5534);
conditioningSwitch.outputs[0].links = conditioningSwitch.outputs[0].links
  .filter((id) => id !== 15013)
  .concat(conditioningInputLink);
const clipInput = samplerGroup.inputs.find((input) => input.name === "clip");
clipInput.linkIds = [...clipInput.linkIds, clipInputLink];
samplerGroup.links.push(
  { id: conditioningInputLink, origin_id: 5534, origin_slot: 0, target_id: unloadNodeId, target_slot: 0, type: "CONDITIONING" },
  { id: clipInputLink, origin_id: -10, origin_slot: 13, target_id: unloadNodeId, target_slot: 1, type: "CLIP" },
);
samplerGroup.nodes.push({
  id: unloadNodeId,
  type: "RemoteUnloadCLIP",
  title: "Scarica Qwen dopo conditioning",
  pos: [-3630, 2890],
  size: [330, 90],
  flags: { pinned: true },
  order: Math.max(...samplerGroup.nodes.map((node) => Number(node.order) || 0)) + 1,
  mode: 0,
  inputs: [
    { localized_name: "conditioning", name: "conditioning", type: "CONDITIONING", link: conditioningInputLink },
    { localized_name: "clip", name: "clip", type: "CLIP", link: clipInputLink },
  ],
  outputs: [
    { localized_name: "CONDITIONING", name: "CONDITIONING", type: "CONDITIONING", links: [15013] },
  ],
  properties: { "Node name for S&R": "RemoteUnloadCLIP" },
  widgets_values: [],
});

comfy.last_node_id = unloadNodeId;
comfy.last_link_id = clipInputLink;
for (const graph of comfy.definitions.subgraphs) {
  graph.state.lastNodeId = Math.max(Number(graph.state.lastNodeId) || 0, unloadNodeId);
  graph.state.lastLinkId = Math.max(Number(graph.state.lastLinkId) || 0, clipInputLink);

  // The downloaded V9 UI file contains one stale legacy wire whose source
  // node no longer exists. Remove any such orphan while preserving the two
  // virtual group endpoints (-10/-20).
  const nodeIds = new Set(graph.nodes.map((node) => node.id).concat([-10, -20]));
  const validLinks = graph.links.filter((link) => nodeIds.has(link.origin_id) && nodeIds.has(link.target_id));
  const validLinkIds = new Set(validLinks.map((link) => link.id));
  graph.links = validLinks;
  for (const node of graph.nodes) {
    for (const input of node.inputs || []) {
      if (input.link != null && !validLinkIds.has(input.link)) input.link = null;
    }
    for (const output of node.outputs || []) {
      if (Array.isArray(output.links)) output.links = output.links.filter((id) => validLinkIds.has(id));
    }
  }
  for (const socket of [...(graph.inputs || []), ...(graph.outputs || [])]) {
    if (Array.isArray(socket.linkIds)) socket.linkIds = socket.linkIds.filter((id) => validLinkIds.has(id));
  }
}
comfy.revision = (Number(comfy.revision) || 0) + 1;
comfy.extra = {
  ...(comfy.extra || {}),
  plagueKindRemoteExport: {
    exportedAt: new Date().toISOString(),
    lowVramForced: true,
    unloadQwenAfterConditioning: true,
    sampler: "ER-SDE ODE",
    scheduler: "beta57",
    steps: 8,
    adalnMode: "strip",
  },
};

fs.writeFileSync(comfyPath, `${JSON.stringify(comfy, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outputRoot,
  files: [comfyPath, apiPath],
  apiNodes: Object.keys(job.workflow).length,
  graphicalNodes: comfy.nodes.length + comfy.definitions.subgraphs.reduce((sum, graph) => sum + graph.nodes.length, 0),
}, null, 2));
