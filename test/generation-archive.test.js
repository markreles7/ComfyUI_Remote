import assert from "node:assert/strict";
import test from "node:test";
import { setGenerationsArchived } from "../src/generation-archive.js";

function storeFixture(items) {
  return {
    items,
    get(id) {
      return this.items.find((item) => item.id === id);
    },
    updateMany(ids, patch) {
      this.items = this.items.map((item) =>
        ids.includes(item.id) ? { ...item, ...patch } : item
      );
      return this.items.filter((item) => ids.includes(item.id));
    },
  };
}

test("archivia soltanto le generazioni selezionate", () => {
  const store = storeFixture([
    { id: "one", status: "completed" },
    { id: "two", status: "error" },
    { id: "three", status: "completed" },
  ]);
  const updated = setGenerationsArchived({
    store,
    ids: ["one", "three"],
    archived: true,
    now: () => "2026-07-28T12:00:00.000Z",
  });
  assert.equal(updated.length, 2);
  assert.equal(store.get("one").archived, true);
  assert.equal(store.get("two").archived, undefined);
  assert.equal(store.get("three").archivedAt, "2026-07-28T12:00:00.000Z");
});

test("ripristina una generazione senza eliminare i metadati", () => {
  const store = storeFixture([{
    id: "one",
    status: "completed",
    archived: true,
    archivedAt: "old",
    prompt: "Conservami",
  }]);
  setGenerationsArchived({ store, ids: ["one"], archived: false });
  assert.equal(store.get("one").archived, false);
  assert.equal(store.get("one").archivedAt, null);
  assert.equal(store.get("one").prompt, "Conservami");
});

test("impedisce di archiviare lavori attivi", () => {
  const store = storeFixture([{ id: "one", status: "running" }]);
  assert.throws(
    () => setGenerationsArchived({ store, ids: ["one"], archived: true }),
    /in coda o in esecuzione/,
  );
  assert.equal(store.get("one").archived, undefined);
});
