import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCharacterAdapter } from "../src/character-adapters.js";
import { normalizeCharacterBlueprint } from "../src/character-genesis.js";
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
  assert.equal(created.packStatus, "Needs Hero");
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

test("profilo voce conserva la reference locale senza esporre path assoluti", () => {
  const { store } = tempStore();
  const character = store.createCharacter({ name: "Voice Actor", voiceProfile: { language: "it", speaker: "Elsa" } });
  const updated = store.setVoiceReference(character.id, { buffer: Buffer.from("RIFF-test"), mimetype: "audio/wav", originalname: "voice.wav" });
  assert.equal(updated.voiceReferenceAvailable, true);
  assert.match(updated.voiceProfile.referenceAudio, /^voice\//);
  assert.equal(path.isAbsolute(updated.voiceProfile.referenceAudio), false);
  assert.ok(fs.existsSync(store.voiceReferencePath(character.id)));
  const saved = store.updateCharacter(character.id, { voiceProfile: { notes: "warm" } });
  assert.equal(saved.voiceProfile.referenceAudio, updated.voiceProfile.referenceAudio);
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
  assert.equal(asset.stats.isFile(), true);
  assert.ok(asset.stats.size > 0);
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
    engine: "InsightFace buffalo_l",
    status: "PASS",
    subjectKindsSupported: ["human"],
    thresholds: { pass: 0.32, warning: 0.22 },
    evaluations: [{
      referenceId: "reference-1",
      score: 0.91,
      status: "PASS",
      engine: "InsightFace buffalo_l",
      evaluatedAt: new Date().toISOString(),
      warnings: [],
    }],
  });
  assert.equal(updated.identityEvaluation.status, "PASS");
  assert.equal(updated.characterPack.identityEvaluation.status, "PASS");
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

test("Character Genesis normalizza subjectKind e identità generica mantenendo gli hint legacy", () => {
  const { store } = tempStore();
  const blueprint = normalizeCharacterBlueprint({
    subjectKind: "animal",
    identity: {
      appearance: "A medium-sized dog",
      head: "gentle muzzle and alert ears",
      body: "athletic compact body",
      hairOrCoat: "short light-brown coat",
      distinctiveFeatures: ["white chest patch"],
      colors: ["light brown", "white"],
      proportions: "medium size",
    },
  }, { sourceDescription: "Un cane marrone con macchia bianca." });
  const character = store.createCharacter({
    name: "Milo",
    subjectKind: "animal",
    characterBlueprint: blueprint,
    genesis: {
      sourceType: "description",
      generator: "kreaTriple",
      model: "moodyKrea2Mix_v50.safetensors",
      seed: 123,
      technicalPrompt: "A clean identity portrait of a medium-sized dog.",
    },
  });
  assert.equal(character.subjectKind, "animal");
  assert.equal(character.characterBlueprint.identity.hairOrCoat, "short light-brown coat");
  assert.equal(character.identityHints.face, "gentle muzzle and alert ears");
  assert.match(character.identityHints.body, /athletic compact body/);
  assert.equal(character.genesis.seed, 123);
  assert.equal(character.characterPack.subjectKind, "animal");
  assert.equal(character.characterPack.characterBlueprint.identity.hairOrCoat, "short light-brown coat");
  assert.equal(character.settings.lockFace, true);
  assert.equal(character.settings.lockHair, true);
  assert.equal(character.settings.lockBody, true);
});

test("Hero Genesis conserva provenienza generativa senza duplicare la Library", () => {
  const { store } = tempStore();
  const character = store.createCharacter({ name: "Hero", subjectKind: "other" });
  const result = store.addReference(character.id, imageFile(), {
    type: "hero",
    provenance: {
      sourceType: "description",
      generationId: "generation-123",
      generator: "kreaTriple",
      model: "moodyKrea2Mix_v50.safetensors",
      seed: 456,
      technicalPrompt: "A reusable hero subject.",
    },
  });
  assert.equal(result.character.heroImage, result.reference.id);
  assert.equal(result.reference.provenance.generationId, "generation-123");
  assert.equal(result.reference.provenance.seed, 456);
  assert.equal(store.listCharacters().length, 1);
});

test("i Character legacy senza blueprint vengono letti in modo retrocompatibile", () => {
  const { store } = tempStore();
  const created = store.createCharacter({ name: "Legacy", identityHints: { face: "oval face" } });
  const raw = store.readRaw(created.id);
  delete raw.subjectKind;
  delete raw.characterBlueprint;
  delete raw.genesis;
  store.writeRaw(raw);
  const loaded = store.getCharacter(created.id);
  assert.equal(loaded.subjectKind, "auto");
  assert.equal(loaded.identityHints.face, "oval face");
  assert.equal(loaded.characterBlueprint.version, 1);
});

test("Reference Plan e viste approvate estendono il Character Pack con type compatibili", () => {
  const { store } = tempStore();
  const character = store.createCharacter({ name: "Factory", subjectKind: "animal" });
  const hero = store.addReference(character.id, imageFile(), { type: "hero" });
  const plan = store.updateReferencePlan(character.id, {
    subjectKind: "animal",
    heroReferenceId: hero.reference.id,
    workflow: { id: "qwenEdit", name: "Qwen Image Edit 2511", model: "qwen_image_edit_2511.safetensors", mode: "image" },
    items: [
      { referenceRole: "head_front", technicalPrompt: "Preserve the animal and show the head from the front." },
      { referenceRole: "head_3q_left", technicalPrompt: "Preserve the animal and show the head from the left three-quarter view." },
      { referenceRole: "head_3q_right", technicalPrompt: "Preserve the animal and show the head from the right three-quarter view." },
      { referenceRole: "full_body_side", technicalPrompt: "Preserve the animal and show a full body side view." },
    ],
  });
  assert.equal(plan.referencePlan.subjectKind, "animal");
  const approved = store.addReference(character.id, imageFile({ originalname: "head-front.png" }), {
    type: "face",
    status: "approved",
    referenceRole: "head_front",
    angle: "front",
    pose: "head portrait",
    expression: "neutral",
    sourceHero: hero.reference.id,
    subjectKind: "animal",
    technicalPrompt: "Preserve the same coat and markings.",
    seed: 42,
  });
  const updatedPlan = {
    ...approved.character.referencePlan,
    items: approved.character.referencePlan.items.map((item) => item.referenceRole === "head_front"
      ? { ...item, status: "approved", approvedReferenceId: approved.reference.id }
      : item),
  };
  const updated = store.updateReferencePlan(character.id, updatedPlan);
  assert.equal(updated.references.find((item) => item.id === approved.reference.id).referenceRole, "head_front");
  assert.equal(updated.characterPack.referenceViews.find((item) => item.referenceRole === "head_front").type, "face");
  assert.equal(updated.characterPack.referenceViews.find((item) => item.referenceRole === "head_front").sourceHero, hero.reference.id);
  assert.ok(["hero", "face", "bust", "full_body", "profile", "sheet", "generic"].includes(approved.reference.type));
});
