import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupCandidates,
  cleanupMode,
  estimateGenerationCleanup,
  queryGenerations,
} from "../src/generation-library.js";

const items = [
  {
    id: "one",
    createdAt: "2026-08-08T10:00:00.000Z",
    status: "completed",
    workflowId: "qwen",
    workflowName: "Qwen",
    prompt: "pool portrait",
    images: [{ filename: "one.png" }],
  },
  {
    id: "two",
    createdAt: "2026-08-07T10:00:00.000Z",
    status: "error",
    workflowId: "ltx",
    workflowName: "LTX",
    prompt: "dance video",
    videos: [{ filename: "two.mp4" }],
    archived: true,
  },
  {
    id: "three",
    createdAt: "2026-08-06T10:00:00.000Z",
    status: "running",
    workflowId: "ltx",
    workflowName: "LTX",
    prompt: "active video",
    videos: [{ filename: "three.mp4" }],
  },
];

test("queryGenerations applica filtri server-side e paginazione", () => {
  const first = queryGenerations(items, { paged: "1", archive: "visible", limit: "1", offset: "0" });
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].id, "one");
  assert.equal(first.total, 2);
  assert.equal(first.hasMore, true);
  assert.equal(first.stats.total, 3);
  assert.equal(first.stats.archived, 1);

  const videos = queryGenerations(items, { archive: "all", mediaType: "video", workflowId: "ltx" });
  assert.deepEqual(videos.items.map((item) => item.id), ["two", "three"]);
});

test("cleanup stima solo candidati non attivi e somma file unici", () => {
  const estimate = estimateGenerationCleanup({
    items,
    criteria: { archive: "all", mediaType: "video" },
    resolveMedia: (media) => ({
      path: `C:/out/${media.filename}`,
      stats: { size: media.filename === "two.mp4" ? 2048 : 9999 },
    }),
  });

  assert.equal(estimate.generations, 1);
  assert.equal(estimate.videos, 1);
  assert.equal(estimate.files, 1);
  assert.equal(estimate.bytes, 2048);
  assert.deepEqual(estimate.ids, ["two"]);
});

test("cleanupCandidates e cleanupMode restano conservativi", () => {
  assert.deepEqual(cleanupCandidates(items, { archive: "all" }).map((item) => item.id), ["one", "two"]);
  assert.equal(cleanupMode("deleteFilesKeepRecords"), "deleteFilesKeepRecords");
  assert.equal(cleanupMode("unknown"), "archive");
});
