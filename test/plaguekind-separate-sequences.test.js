import test from "node:test";
import assert from "node:assert/strict";
import { planPlaguekindSeparateSequences, plaguekindSeparateJobInput } from "../src/plaguekind-separate-sequences.js";

const raw = {
  videoStudioMode: "h3SparseV9", h3SparseMultiSequence: "true", h3SparseSegmentCount: "2",
  h3SparseMode: "image", h3SparseModel: "h3ErosMax_beta3.safetensors", duration: "12",
  h3SparseContinuityFrames: "22", prompt: "First 12-second prompt.\n---\nSecond 12-second prompt.",
};
const firstFrame = { name: "first.png", subfolder: "remote" };
const tail = { name: "tail.mp4", subfolder: "" };

test("PlagueKind plans separate jobs and preserves the selected 22-frame context", () => {
  const plan = planPlaguekindSeparateSequences(raw);
  assert.deepEqual(plan, {
    count: 2, duration: 12, contextFrames: 22,
    prompts: ["First 12-second prompt.", "Second 12-second prompt."],
  });
  const first = plaguekindSeparateJobInput(raw, plan, 0, { h3FirstFrame: firstFrame });
  assert.equal(first.raw.prompt, plan.prompts[0]);
  assert.equal(first.raw.h3SparseMode, "image");
  assert.equal(first.raw.h3SparseMultiSequence, false);
  const second = plaguekindSeparateJobInput(raw, plan, 1, { h3FirstFrame: firstFrame }, tail);
  assert.equal(second.raw.prompt, plan.prompts[1]);
  assert.equal(second.raw.h3SparseMode, "references");
  assert.deepEqual(second.uploads.h3ReferenceImages[0], { ...firstFrame, referenceIndex: 0 });
  assert.deepEqual(second.uploads.h3ContinuityClip, tail);
});

test("PlagueKind never starts a later job without the previous video tail", () => {
  const plan = planPlaguekindSeparateSequences(raw);
  assert.throws(() => plaguekindSeparateJobInput(raw, plan, 1, { h3FirstFrame: firstFrame }), /Manca la coda video/u);
  assert.throws(() => planPlaguekindSeparateSequences({ ...raw, h3SparseSegmentCount: "3" }), /ha ricevuto 2 prompt/u);
  assert.equal(planPlaguekindSeparateSequences({ ...raw, h3SparseMultiSequence: "false" }), null);
});
