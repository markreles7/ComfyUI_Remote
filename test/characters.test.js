import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCharacterAdapter } from "../src/character-adapters.js";
import { CharacterStore } from "../src/characters.js";

function tempStore() {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "characters-"));
  return {
    dataDirectory,
    store: new CharacterStore({ dataDirectory }),
  };
}

function imageFile(overrides = {}) {
  return {
    buffer: Buffer.from("fake-image"),
    mimetype: "image/png",
    originalname: "reference.png",
    size: 10,
    ...overrides,
  };
}

test("crea, lista, aggiorna, persiste ed elimina un personaggio", () => {
  const { dataDirectory, store } = tempStore();
  const created = store.createCharacter({ name: "Selly" });
  assert.equal(created.name, "Selly");
  assert.equal(created.packStatus, "Needs references");
  assert.equal(store.listCharacters().length, 1);

  const updated = store.updateCharacter(created.id, {
    name: "Selly Prime",
    wardrobe: "dress, bikini",
    identityHints: { hair: "long dark hair" },
    settings: { identityStrength: "high", lockOutfit: "false" },
  });
  assert.equal(updated.name, "Selly Prime");
  assert.deepEqual(updated.wardrobe, ["dress", "bikini"]);
  assert.equal(updated.settings.lockOutfit, false);

  const persisted = JSON.parse(fs.readFileSync(path.join(dataDirectory, "characters", created.id, "meta.json"), "utf8"));
  assert.equal(persisted.name, "Selly Prime");

  const removed = store.deleteCharacter(created.id);
  assert.equal(removed.deleted, true);
  assert.equal(store.listCharacters().length, 0);
});

test("carica reference, aggiorna tipo, crea pack e rimuove asset senza esporre path assoluti", () => {
  const { store } = tempStore();
  const character = store.createCharacter({ name: "Actor" });
  const { reference } = store.addReference(character.id, imageFile(), { type: "hero", tags: "front,soft light" });
  assert.equal(reference.type, "hero");
  assert.equal(reference.assetAvailable, true);
  assert.match(reference.url, /^\/api\/characters\//);
  assert.doesNotMatch(reference.url, /^[A-Z]:\\/i);

  const retagged = store.updateReference(character.id, reference.id, { type: "face" });
  assert.equal(retagged.references[0].type, "face");
  const built = store.buildPack(character.id);
  assert.equal(built.pack.status, "Incomplete");

  const asset = store.assetPath(character.id, reference.id);
  assert.ok(asset.path.endsWith(".png"));
  const afterRemoval = store.removeReference(character.id, reference.id);
  assert.equal(afterRemoval.references.length, 0);
});

test("segnala reference con file mancante senza rompere il personaggio", () => {
  const { store } = tempStore();
  const character = store.createCharacter({ name: "Broken" });
  const { reference } = store.addReference(character.id, imageFile(), { type: "hero" });
  fs.rmSync(store.assetPath(character.id, reference.id).path, { force: true });

  const reloaded = store.getCharacter(character.id);
  assert.equal(reloaded.references[0].assetAvailable, false);
  assert.equal(reloaded.references[0].url, null);
  assert.ok(reloaded.assetWarnings.some((warning) => warning.includes("file mancante")));
  assert.equal(store.assetDiagnostics(character.id).ok, false);
});

test("salva report identity evaluation nel Character Pack", () => {
  const { store } = tempStore();
  const character = store.createCharacter({ name: "Identity" });
  const updated = store.updateIdentityEvaluation(character.id, {
    enabled: true,
    engine: "perceptual-ffmpeg-pgm",
    status: "passed",
    averageSimilarity: 0.91,
    minSimilarity: 0.88,
  });
  assert.equal(updated.identityEvaluation.status, "passed");
  assert.equal(updated.characterPack.identityEvaluation.status, "passed");
});

test("rifiuta traversal, mime non valido e personaggi mancanti", () => {
  const { store } = tempStore();
  assert.throws(() => store.createCharacter({ id: "../bad", name: "Bad" }), /Character ID non valido/);
  assert.throws(() => store.getCharacter("missing"), /Personaggio non trovato/);
  const character = store.createCharacter({ name: "Safe" });
  assert.throws(
    () => store.addReference(character.id, imageFile({ mimetype: "text/plain", originalname: "../bad.txt" })),
    /Formato immagine non supportato/,
  );
});

test("adapter Character Pack usa fallback dichiarato quando il workflow non supporta conditioning", () => {
  const { store } = tempStore();
  const character = store.createCharacter({
    name: "Actor",
    description: "adult fictional performer",
    settings: { identityStrength: "medium", lockFace: true, lockHair: true, lockBody: true, lockOutfit: false },
  });
  const adapter = resolveCharacterAdapter({
    generationType: "upscale",
    workflowId: "seedvr2",
    character,
    options: { lockOutfit: "false" },
  });
  assert.equal(adapter.conditioning.type, "prompt-only");
  assert.equal(adapter.conditioning.locks.outfit, false);
  assert.match(adapter.promptPrefix, /Virtual Actor: Actor/);
  assert.ok(adapter.warnings.some((warning) => warning.includes("prompt identitario")));
});
