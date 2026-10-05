import assert from "node:assert/strict";
import { buildVideoStudioInitialJob } from "../src/video-studio-workflows.js";
import { validateWorkflow } from "../src/workflow-validator.js";
import { planPlaguekind2TestSequences, plaguekind2TestJobInput } from "../src/plaguekind2-test-sequences.js";

const appUrl = process.env.APP_URL || "http://100.77.122.74:3000";
const comfyUrl = process.env.COMFY_URL || "http://127.0.0.1:8188";
const [appResponse, definitionsResponse] = await Promise.all([
  fetch(`${appUrl}/api/config`), fetch(`${comfyUrl}/object_info`),
]);
if (!appResponse.ok || !definitionsResponse.ok) throw new Error("Webapp o ComfyUI non disponibili.");
const config = (await appResponse.json()).videoStudio;
const definitions = await definitionsResponse.json();
const uploads = { h3ReferenceImages: [{ name: "validation-cabin.png", referenceIndex: 0 }, { name: "validation-hikers.png", referenceIndex: 1 }] };
for (const upscale of [false, true]) {
  for (const count of [5, 22, 39, 56]) {
    const raw = { videoStudioMode: "plagueKind2Test", h3SparseMode: "references",
      prompt: "Two hikers approach a cabin.\n---\nThe hikers open the door.",
      h3SparseMultiSequence: true, h3SparseSegmentCount: 2, duration: 8, seed: 123,
      h3SparseLatentUpscale: upscale, h3SparseLatentScale: 1.5, h3SparsePostRcas: upscale,
      h3SparseContinuityFrames: count };
    const plan = planPlaguekind2TestSequences(raw);
    for (const index of [0, 1]) {
      const guides = index ? Array.from({ length: count }, (_, i) => ({ name: `base-${i}.png` })) : null;
      const prepared = plaguekind2TestJobInput(raw, plan, index, uploads, guides);
      const job = buildVideoStudioInitialJob("plagueKind2Test", prepared.raw, prepared.uploads, [], config);
      const issues = validateWorkflow(job.workflow, definitions);
      assert.deepEqual(issues, [], `upscale=${upscale}, context=${count}, sequence=${index + 1}`);
    }
  }
}
console.log("16 grafi PlagueKind2Test validati sui nodi ComfyUI installati; nessuna generazione avviata.");
