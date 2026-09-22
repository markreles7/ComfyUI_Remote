import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticComfyCleanupFamily,
  shouldAutomaticallyCleanComfy,
} from "../src/automatic-comfy-cleanup.js";

test("abilita la pulizia automatica per tutte le varianti MiniMax H3", () => {
  const generations = [
    { workflowId: "minimaxH3" },
    { workflowId: "videoStudio:minimaxH3Fast" },
    { workflowId: "videoStudio:h3SparseV9" },
    { workflowId: "videoStudio:actionH3" },
    { workflowName: "Character Video Master · MiniMax H3" },
  ];

  for (const generation of generations) {
    assert.equal(automaticComfyCleanupFamily(generation), "minimax-h3");
  }
});

test("abilita la pulizia automatica per LTX 2.5", () => {
  assert.equal(automaticComfyCleanupFamily({ workflowId: "videoStudio:ltx25:image" }), "ltx25");
  assert.equal(automaticComfyCleanupFamily({ workflowId: "audioStudio:ltx25:textAudio" }), "ltx25");
  assert.equal(automaticComfyCleanupFamily({ workflowName: "LTX 2.5 AIO · Text to Video" }), "ltx25");
});

test("non pulisce automaticamente LTX 2.3 o gli altri workflow", () => {
  const generations = [
    { workflowId: "standard", workflowName: "LTX 2.3 1Work" },
    { workflowId: "ltxSulphur", workflowName: "LTX 2.3 Sulphur" },
    { workflowId: "qwenEdit", workflowName: "Qwen Image Edit" },
    { workflowId: "seedvr2" },
    {},
  ];

  for (const generation of generations) {
    assert.equal(shouldAutomaticallyCleanComfy(generation), false);
  }
});
