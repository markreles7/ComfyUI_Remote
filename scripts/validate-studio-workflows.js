import { buildStudioContinuation, buildStudioJobs } from "../src/studio-workflows.js";
import { validateWorkflow } from "../src/workflow-validator.js";

const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";
const response = await fetch(`${comfyUrl}/object_info`);
if (!response.ok) throw new Error(`ComfyUI object_info: HTTP ${response.status}`);
const definitions = await response.json();

const source = { name: "source.png", subfolder: "validation" };
const mask = { name: "mask.png", subfolder: "validation" };
const references = [{ name: "person.png" }, { name: "pose.png" }, { name: "style.png" }];
const base = {
  prompt: "Validation prompt for an adult subject in a photographic scene.",
  imageWidth: 1152,
  imageHeight: 896,
  alternatives: 2,
};
const cases = [
  ["smartphone", { ...base }, { source, mask, references }],
  ["smartEditor", { ...base, editScope: "global" }, { source, references }],
  ["inpaint", { ...base, maskTarget: "water", autoMaskEngine: "florence" }, { source, references }],
  ["multiReference", base, { source, references }],
  ["storyboard", {
    ...base,
    shots: JSON.stringify([
      { title: "One", prompt: "Wide view." },
      { title: "Two", prompt: "Close view." },
    ]),
  }, { source, references }],
  ["firstLast", { ...base, duration: 3 }, { firstFrame: source, lastFrame: mask }],
  ["bible", base, { source, references }],
  ["camera", base, { source, references }],
  ["relight", base, { source }],
  ["perfect", base, { source: null, references }],
];

const workflows = [];
for (const [mode, raw, uploads] of cases) {
  for (const job of buildStudioJobs(mode, raw, uploads, [])) {
    workflows.push([`${mode}:${job.metadata.studioLabel}`, job.workflow]);
  }
}
const final = buildStudioContinuation("finalize", {
  ...base,
  studioMode: "perfect",
  highresEnabled: true,
  upscaleMode: "rtx",
  autoPurge: true,
}, source, []);
workflows.push(["perfect:final", final.workflow]);
const localFinal = buildStudioContinuation("finalize", {
  ...base,
  studioMode: "smartphone",
  maskUpload: mask,
  highresEnabled: true,
  upscaleMode: "seedvr2",
  autoPurge: true,
}, source, []);
workflows.push(["smartphone:final", localFinal.workflow]);
const speedFinal = buildStudioContinuation("finalize", {
  ...base,
  studioMode: "perfect",
  studioPreset: "speed",
  finalOutput: "rtx",
}, source, []);
workflows.push(["perfect:speed-final", speedFinal.workflow]);

const errors = workflows.flatMap(([name, workflow]) =>
  validateWorkflow(workflow, definitions, { label: name }).map((issue) => `${name} · ${issue}`)
);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validati ${workflows.length} workflow Studio contro ${Object.keys(definitions).length} nodi ComfyUI.`);
}
