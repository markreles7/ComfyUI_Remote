import assert from "node:assert/strict";
import test from "node:test";
import { resolveSeriesPerformance } from "../public/image-series-performance.js";

test("Qwen Edit BF16 usa profili prudenti e segnala il possibile offload", () => {
  const fast = resolveSeriesPerformance({ family: "qwenedit", file: "QWEN/qwen_image_edit_2511_bf16.safetensors", preset: "fast" });
  const balanced = resolveSeriesPerformance({ family: "qwenedit", file: "QWEN/qwen_image_edit_2511_bf16.safetensors", preset: "balanced" });
  const quality = resolveSeriesPerformance({ family: "qwenedit", file: "QWEN/qwen_image_edit_2511_bf16.safetensors", preset: "quality" });
  assert.deepEqual([fast.steps, balanced.steps, quality.steps], [8, 16, 28]);
  assert.match(balanced.warning, /CPU offload.*12 GB/i);
});

test("Flux.2 Turbo non riceve sampling da modello base", () => {
  const fast = resolveSeriesPerformance({ family: "flux2", file: "FLUX2/PornMaster_Turbo_FP8.safetensors", preset: "fast" });
  const balanced = resolveSeriesPerformance({ family: "flux2", file: "FLUX2/PornMaster_Turbo_FP8.safetensors", preset: "balanced" });
  const quality = resolveSeriesPerformance({ family: "flux2", file: "FLUX2/PornMaster_Turbo_FP8.safetensors", preset: "quality" });
  assert.deepEqual([fast.steps, balanced.steps, quality.steps], [4, 6, 8]);
  assert.equal(balanced.guidance, 1);
});

test("il profilo personalizzato conserva i valori manuali", () => {
  const profile = resolveSeriesPerformance({ family: "qwen", preset: "custom", defaults: { steps: 17, guidance: 3.5 } });
  assert.equal(profile.steps, 17);
  assert.equal(profile.guidance, 3.5);
});
