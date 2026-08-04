import assert from "node:assert/strict";
import test from "node:test";
import { cancelGeneration } from "../src/generation-cancellation.js";

function fixture(status = "queued", cancelled = true) {
  const item = { id: "generation-1", promptId: "prompt-1", status };
  const calls = [];
  return {
    item,
    calls,
    comfy: {
      async cancelJob(promptId) {
        calls.push(promptId);
        return { cancelled };
      },
    },
    store: {
      update(id, patch) {
        calls.push({ id, patch });
        return { ...item, ...patch };
      },
    },
  };
}

test("annulla atomicamente una generazione in coda tramite prompt_id", async () => {
  const input = fixture("queued");
  const result = await cancelGeneration({
    ...input,
    now: () => "2026-07-27T18:00:00.000Z",
  });

  assert.equal(result.cancelled, true);
  assert.equal(result.generation.status, "interrupted");
  assert.equal(result.generation.cancelledByUser, true);
  assert.equal(result.generation.finishedAt, "2026-07-27T18:00:00.000Z");
  assert.equal(input.calls[0], "prompt-1");
});

test("non marca annullato un job che ComfyUI non considera più attivo", async () => {
  const input = fixture("running", false);
  const result = await cancelGeneration(input);

  assert.equal(result.cancelled, false);
  assert.equal(result.reason, "not-active");
  assert.deepEqual(input.calls, ["prompt-1"]);
});

test("l'annullamento di una generazione terminale è idempotente", async () => {
  const input = fixture("completed");
  const result = await cancelGeneration(input);

  assert.equal(result.cancelled, false);
  assert.equal(result.reason, "terminal");
  assert.deepEqual(input.calls, []);
});
