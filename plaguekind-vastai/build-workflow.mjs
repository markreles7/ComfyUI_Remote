import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "..", "exports", "PlagueKind_H3_Sparse_V9_2026-09-15", "PlagueKind_H3_Sparse_V9_LowVRAM_QwenUnload_ComfyUI.json");
const workflow = JSON.parse(fs.readFileSync(source, "utf8"));
const node = (nodes, id) => {
  const result = nodes.find((entry) => entry.id === id);
  if (!result) throw new Error(`Nodo ${id} non trovato`);
  return result;
};
const sampler = workflow.definitions.subgraphs.find((entry) => entry.name === "Conditioning - Sampler");
if (!sampler) throw new Error("Subgraph Conditioning - Sampler mancante");

// The exposed Boolean drives both conditioning and latent switches.
node(sampler.nodes, 5545).widgets_values = [true];
node(sampler.nodes, 5534).widgets_values = [true];
node(sampler.nodes, 5535).widgets_values = [true];
for (const id of [5545, 5534, 5535]) node(sampler.nodes, id).mode = 0;
// RES4LYF registers this scheduler as "beta57" (without an underscore).
node(workflow.nodes, 5479).widgets_values[6] = "beta57";
node(sampler.nodes, 5471).widgets_values[0] = "beta57";
node(sampler.nodes, 5528).widgets_values[0] = "[reference generation]\n<Picture 1> identifies the main subject. <Picture 2> defines the setting or second subject. Preserve their identity and visual details while generating a new coherent action.\n\n[0s-2s] Establish the scene and movement.\n[2s-5s] Continue the action with stable anatomy and camera motion.\n\noverall_soundscape: Natural synchronized scene audio.";
const referenceNode = node(sampler.nodes, 5528);
const extras = workflow.definitions.subgraphs.find((entry) => entry.name === "Extra References Set Inside ->");
if (!extras) throw new Error("Subgraph Extra References mancante");
let nextNode = workflow.last_node_id;
let nextLink = workflow.last_link_id;
const newNodeId = () => ++nextNode;
const newLinkId = () => ++nextLink;
const addLink = (group, origin, originSlot, target, targetSlot, type) => {
  const id = newLinkId();
  group.links.push({ id, origin_id: origin.id, origin_slot: originSlot, target_id: target.id, target_slot: targetSlot, type });
  origin.outputs[originSlot].links ??= [];
  origin.outputs[originSlot].links.push(id);
  target.inputs[targetSlot].link = id;
  return id;
};
const cloneLoader = (templateId, title, filename, x, y) => {
  const template = node(extras.nodes, templateId);
  const created = structuredClone(template);
  created.id = newNodeId();
  created.title = title;
  created.pos = [x, y];
  created.mode = 0;
  if (Array.isArray(created.widgets_values) && filename) created.widgets_values[0] = filename;
  for (const input of created.inputs || []) input.link = null;
  for (const output of created.outputs || []) output.links = [];
  extras.nodes.push(created);
  return created;
};
const bundle = node(extras.nodes, 5570);
const connectBundle = (sourceNode, sourceSlot, bundleSlot, type) =>
  addLink(extras, sourceNode, sourceSlot, bundle, bundleSlot - 1, type);

// Existing optional media in the original export: two more images, one video,
// two standalone audios. The first two images remain on the main canvas.
for (const id of [5581, 5624, 5574, 5576, 5615, 5571, 5572, 5594, 5595, 5622, 5623]) {
  node(extras.nodes, id).mode = 0;
}
node(extras.nodes, 5581).widgets_values[0] = "reference_3.png";
node(extras.nodes, 5624).widgets_values[0] = "reference_4.png";
node(extras.nodes, 5574).widgets_values[0] = "reference_video_1.mp4";
node(extras.nodes, 5571).widgets_values[0] = "reference_audio_1.wav";
node(extras.nodes, 5594).widgets_values[0] = "reference_audio_2.wav";
for (let picture = 5; picture <= 9; picture++) {
  const image = cloneLoader(5581, `Picture ${picture}`, `reference_${picture}.png`, -2500, 1800 + picture * 160);
  connectBundle(image, 0, picture, "IMAGE");
}
// Video components must be frame tensors, with the paired soundtrack in the
// corresponding ref_video_audio input.
connectBundle(node(extras.nodes, 5576), 1, 11, "AUDIO");
connectBundle(node(extras.nodes, 5594), 0, 17, "AUDIO");
for (let videoIndex = 2; videoIndex <= 3; videoIndex++) {
  const video = cloneLoader(5574, `Video ${videoIndex}`, `reference_video_${videoIndex}.mp4`, -2050, 2100 + videoIndex * 310);
  const components = cloneLoader(5576, `Video ${videoIndex} · components`, "", -1700, 2100 + videoIndex * 310);
  const resize = cloneLoader(5615, `Video ${videoIndex} · resize`, "", -1370, 2100 + videoIndex * 310);
  addLink(extras, video, 0, components, 0, "VIDEO");
  addLink(extras, components, 0, resize, 0, "IMAGE");
  connectBundle(resize, 0, 10 + (videoIndex - 1) * 2, "IMAGE");
  connectBundle(components, 1, 11 + (videoIndex - 1) * 2, "AUDIO");
}
const audio3 = cloneLoader(5594, "Audio 3", "reference_audio_3.wav", -1700, 3400);
connectBundle(audio3, 0, 18, "AUDIO");

// Gates live before the bundle so even when one extra reference is enabled,
// unused LoadImage/LoadVideo/LoadAudio nodes remain unevaluated.
for (let bundleIndex = 1; bundleIndex <= 18; bundleIndex++) {
  const input = bundle.inputs[bundleIndex - 1];
  const type = bundleIndex <= 9 || (bundleIndex <= 15 && bundleIndex % 2 === 0) ? "IMAGE" : "AUDIO";
  const oldLink = extras.links.find((link) => link.id === input.link);
  if (!oldLink) throw new Error(`Link mancante per ${input.name}`);
  const gateId = newNodeId();
  const gate = {
    id: gateId,
    type: type === "AUDIO" ? "PlagueKindOptionalAudio" : "PlagueKindOptionalImage",
    title: `${bundleIndex <= 9 ? `Picture ${bundleIndex}` : bundleIndex <= 15 ? `Video ${Math.ceil((bundleIndex - 9) / 2)}${bundleIndex % 2 ? ' audio' : ''}` : `Audio ${bundleIndex - 15}`} · enable when used`,
    pos: [-900, 1800 + bundleIndex * 115], size: [290, 90], flags: {}, order: 80 + bundleIndex, mode: 0,
    inputs: [
      { name: "enabled", type: "BOOLEAN", widget: { name: "enabled" }, link: null },
      { name: type === "AUDIO" ? "audio" : "image", type, shape: 7, link: oldLink.id },
    ],
    outputs: [{ name: type, type, links: [] }],
    properties: { "Node name for S&R": type === "AUDIO" ? "PlagueKindOptionalAudio" : "PlagueKindOptionalImage" },
    widgets_values: [bundleIndex <= 2],
  };
  oldLink.target_id = gateId;
  oldLink.target_slot = 1;
  extras.nodes.push(gate);
  addLink(extras, gate, 0, bundle, bundleIndex - 1, type);
}
node(workflow.nodes, 5479).widgets_values[12] = node(sampler.nodes, 5528).widgets_values[0];
node(workflow.nodes, 5404).widgets_values[0] = "reference_1.png";
node(workflow.nodes, 5482).widgets_values[0] = "reference_2.png";
// Keep the user's Combat and Weapon LoRAs ready in every workflow. They start
// disabled so the same graph remains suitable for scenes without combat.
const loraLoader = node(workflow.nodes, 5511);
const loraStack = JSON.parse(loraLoader.widgets_values[1]);
for (const entry of [
  { on: false, lora: "H3/STY_Combat.safetensors", str: 0.8, v: 1, a: 1, t: 1 },
  { on: false, lora: "H3/MOT_Weapon_Combat_H3_trigger-BUNNY.safetensors", str: 0.8, v: 1, a: 1, t: 1 },
]) {
  if (!loraStack.some((item) => item.lora === entry.lora)) loraStack.push(entry);
}
loraLoader.widgets_values[1] = JSON.stringify(loraStack);
if (loraLoader.widgets_values_named) loraLoader.widgets_values_named.stack_data = loraLoader.widgets_values[1];
if (loraLoader.properties) loraLoader.properties.stack_data = loraLoader.widgets_values[1];
const note = workflow.nodes.find((entry) => entry.id === 5583);
note.widgets_values[0] = "PLAGUEKIND V9 · REFERENCE GENERATION\n\nTwo images are visible on the main canvas. Open Extra References for Picture 3-9, Video 1-3 and Audio 1-3.\n\nEvery reference has an Optional Reference gate in that same group. Picture 1 and 2 start enabled; all other media start disabled. Set enabled=true only for media you loaded. Keep unused slots false: their loaders will not run. Video soundtracks have independent gates.\n\nUse <Picture 1>..<Picture 9>, <Video 1>..<Video 3>, <Audio 1>..<Audio 3> in the prompt for enabled media.\n\nThe reference image is subject conditioning, not automatically the first frame.";
workflow.last_node_id = nextNode;
workflow.last_link_id = nextLink;
for (const group of workflow.definitions.subgraphs) {
  group.state.lastNodeId = nextNode;
  group.state.lastLinkId = nextLink;
}
workflow.extra = { ...workflow.extra, plagueKindReferencePackage: true };
const output = path.join(here, "PlagueKind_H3_V9_Reference_ComfyUI.json");
fs.writeFileSync(output, JSON.stringify(workflow, null, 2) + "\n");
console.log(output);
