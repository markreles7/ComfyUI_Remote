import assert from "node:assert/strict";
import test from "node:test";
import {
  comfyHistoryError,
  comfyOfflineGenerationPatch,
  comfyQueuePromptIds,
  missingGenerationPatch,
} from "../src/generation-reconciliation.js";

test("estrae gli ID dalle code ComfyUI", () => {
  const ids = comfyQueuePromptIds({
    queue_running: [[1, "running-id", {}, {}]],
    queue_pending: [[2, "pending-id", {}, {}]],
  });
  assert.deepEqual([...ids.running], ["running-id"]);
  assert.deepEqual([...ids.pending], ["pending-id"]);
});

test("allinea queued e running con la coda reale", () => {
  const queues = {
    running: new Set(["a"]),
    pending: new Set(["b"]),
  };
  assert.deepEqual(missingGenerationPatch({ status: "queued", promptId: "a" }, queues), {
    status: "running",
  });
  assert.deepEqual(missingGenerationPatch({ status: "running", promptId: "b" }, queues), {
    status: "queued",
  });
});

test("chiude un job vecchio scomparso da coda e history", () => {
  const patch = missingGenerationPatch({
    status: "queued",
    promptId: "missing",
    createdAt: "2026-07-27T10:00:00.000Z",
  }, {
    running: new Set(),
    pending: new Set(),
    now: Date.parse("2026-07-28T10:00:00.000Z"),
  });
  assert.equal(patch.status, "interrupted");
  assert.match(patch.error, /non è più presente/i);
  assert.equal(patch.finishedAt, "2026-07-28T10:00:00.000Z");
});

test("conserva un job appena creato e non decide senza lo stato della coda", () => {
  const item = {
    status: "queued",
    promptId: "new",
    createdAt: "2026-07-28T09:59:30.000Z",
  };
  assert.equal(missingGenerationPatch(item, {
    running: new Set(),
    pending: new Set(),
    now: Date.parse("2026-07-28T10:00:00.000Z"),
  }), null);
  assert.equal(missingGenerationPatch(item, {
    running: null,
    pending: null,
    now: Date.parse("2026-07-28T12:00:00.000Z"),
  }), null);
});

test("chiude un job attivo quando ComfyUI resta offline oltre la soglia", () => {
  const item = { status: "running", promptId: "crashed" };
  assert.equal(comfyOfflineGenerationPatch(item, {
    unavailableSince: Date.parse("2026-09-11T20:00:00.000Z"),
    now: Date.parse("2026-09-11T20:00:20.000Z"),
  }), null);
  const patch = comfyOfflineGenerationPatch(item, {
    unavailableSince: Date.parse("2026-09-11T20:00:00.000Z"),
    now: Date.parse("2026-09-11T20:00:31.000Z"),
  });
  assert.equal(patch.status, "error");
  assert.match(patch.error, /arrestato|non è raggiungibile/i);
  assert.equal(patch.finishedAt, "2026-09-11T20:00:31.000Z");
});

test("estrae il messaggio reale dalla cronologia ComfyUI", () => {
  assert.equal(comfyHistoryError({
    status: {
      messages: [
        ["execution_start", { prompt_id: "x" }],
        ["execution_error", { exception_type: "RuntimeError", exception_message: "aimdo memory compile error: could not start recording\n" }],
      ],
    },
  }), "aimdo memory compile error: could not start recording");
  assert.match(comfyHistoryError({ status: { messages: [] } }), /ComfyUI ha terminato/);
});
