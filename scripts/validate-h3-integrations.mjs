import { buildMiniMaxH3Workflow } from "../src/minimax-h3-workflows.js";
import { buildOrbitSheetWorkflow } from "../src/orbit-sheets-workflows.js";
import { buildH3DeRopeWorkflow } from "../src/h3-derope-workflows.js";
import { buildLtx25Workflow } from "../src/ltx25-workflows.js";

const app = await fetch("http://100.77.122.74:3000/api/config").then((response) => response.json());
const objectInfo = await fetch("http://127.0.0.1:8188/object_info").then((response) => response.json());
const config = app.videoStudio;
const upload = { name: "validation-placeholder.mp4", subfolder: "remote" };
const image = { name: "validation-placeholder.png", subfolder: "remote" };

const jobs = [
  buildMiniMaxH3Workflow({ prompt: "integrated_multimodal_description: [Shot 1] A person walks.\n\noverall_soundscape: footsteps\n\nnon_diegetic_music: N/A", h3Mode: "text", h3RunProfile: "seedHunter", duration: 4, seed: 10 }, {}, [], config),
  buildMiniMaxH3Workflow({ prompt: "integrated_multimodal_description: [Shot 1] A person walks.\n\noverall_soundscape: footsteps\n\nnon_diegetic_music: N/A", h3Mode: "text", h3RunProfile: "nativeFinal", h3RefineMode: "latentLearned", h3FirstMegapixels: 0.6, h3SecondMegapixels: 1, duration: 4, seed: 10 }, {}, [], config),
  buildOrbitSheetWorkflow({ kind: "character", description: "adult adventurer", seed: 10 }, image, config),
  buildOrbitSheetWorkflow({ kind: "location", description: "medieval village square", seed: 10 }, image, config),
  buildH3DeRopeWorkflow({ profile: "balanced", seed: 10 }, upload, config),
  buildLtx25Workflow({ ltx25Mode: "h3Ltx2k", ltx25Profile: "maximum", ltx25Aspect: "16:9", ltx25Fps: 24, duration: 4, seed: 10, prompt: "A person walks naturally." }, { ltx25SourceVideo: upload }, [], config),
];

let failures = 0;
for (const job of jobs) {
  for (const [id, node] of Object.entries(job.workflow)) {
    const schema = objectInfo[node.class_type];
    if (!schema) {
      console.error(`${job.metadata.workflowId}: node ${id} non disponibile: ${node.class_type}`);
      failures += 1;
      continue;
    }
    const required = Object.keys(schema.input?.required || {});
    const missing = required.filter((name) => !Object.hasOwn(node.inputs || {}, name));
    if (missing.length) {
      console.error(`${job.metadata.workflowId}: node ${id} ${node.class_type}, input mancanti: ${missing.join(", ")}`);
      failures += 1;
    }
  }
  console.log(`${job.metadata.workflowId}: ${Object.keys(job.workflow).length} nodi controllati`);
}
if (failures) process.exitCode = 1;
