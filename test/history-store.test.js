import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HistoryStore } from "../src/history-store.js";

test("gli aggiornamenti live restano in memoria senza scrivere la cronologia a ogni progresso", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-history-"));
  const file = path.join(directory, "history.json");
  try {
    const store = new HistoryStore(file);
    store.add({ id: "job-1", status: "queued", progress: 0, createdAt: new Date().toISOString() });
    store.update("job-1", { status: "running", progress: 42 }, { persist: false });

    assert.equal(store.get("job-1").progress, 42);
    assert.equal(new HistoryStore(file).get("job-1").status, "queued");

    store.update("job-1", { status: "completed", progress: 100 });
    const reloaded = new HistoryStore(file).get("job-1");
    assert.equal(reloaded.status, "completed");
    assert.equal(reloaded.progress, 100);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("archivia e ripristina più generazioni con una sola scrittura persistente", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-history-"));
  const file = path.join(directory, "history.json");
  try {
    const store = new HistoryStore(file);
    store.add({ id: "job-1", status: "completed", createdAt: "2026-07-27T18:00:00.000Z" });
    store.add({ id: "job-2", status: "error", createdAt: "2026-07-27T19:00:00.000Z" });

    const archived = store.updateMany(["job-1", "job-2"], {
      archived: true,
      archivedAt: "2026-07-28T10:00:00.000Z",
    });
    assert.equal(archived.length, 2);
    assert.equal(new HistoryStore(file).get("job-1").archived, true);

    store.updateMany(["job-1"], { archived: false, archivedAt: null });
    const reloaded = new HistoryStore(file);
    assert.equal(reloaded.get("job-1").archived, false);
    assert.equal(reloaded.get("job-2").archived, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("applica patch diverse a più record in una sola operazione", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-history-"));
  const file = path.join(directory, "history.json");
  try {
    const store = new HistoryStore(file);
    const first = store.add({ id: "one", createdAt: "2026-01-01", status: "completed" });
    const second = store.add({ id: "two", createdAt: "2026-01-02", status: "completed" });
    const updated = store.patchMany(new Map([
      [first.id, { outputWidth: 1024, outputHeight: 768 }],
      [second.id, { status: "error", error: "dimensioni non valide" }],
    ]));
    assert.equal(updated.length, 2);
    assert.equal(store.get("one").outputWidth, 1024);
    assert.equal(store.get("two").status, "error");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
