import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCharacterReadiness } from "../src/character-readiness.js";
import { CharacterStore } from "../src/characters.js";
import {
  IDENTITY_STATUSES,
  IdentityEvaluationService,
  mapIdentityScore,
  normalizeIdentityEvaluation,
} from "../src/identity-evaluation.js";

function provider({ available = true, scores = [] } = {}) {
  return {
    id: "insightface-buffalo-l",
    async capabilities() {
      return {
        id: this.id,
        engine: "InsightFace buffalo_l",
        available,
        subjectKindsSupported: ["human"],
        thresholds: { pass: 0.32, warning: 0.22 },
        warnings: available ? [] : ["onnxruntime non disponibile"],
      };
    },
    async evaluate({ references }) {
      return references.map((reference, index) => ({ referenceId: reference.id, score: scores[index] }));
    },
  };
}

const references = [
  { id: "reference-a", path: "a.png" },
  { id: "reference-b", path: "b.png" },
];

test("Human con engine disponibile usa veri score provider e threshold mapping", async () => {
  const service = new IdentityEvaluationService({ providers: [provider({ scores: [0.54, 0.27] })] });
  const result = await service.evaluate({ subjectKind: "human", hero: { path: "hero.png" }, references });
  assert.equal(result.enabled, true);
  assert.equal(result.engine, "InsightFace buffalo_l");
  assert.equal(result.evaluations[0].status, IDENTITY_STATUSES.PASS);
  assert.equal(result.evaluations[1].status, IDENTITY_STATUSES.WARNING);
  assert.equal(result.status, IDENTITY_STATUSES.WARNING);
});
test("Human con engine non disponibile non produce score inventati", async () => {
  const service = new IdentityEvaluationService({ providers: [provider({ available: false })] });
  const result = await service.evaluate({ subjectKind: "human", hero: { path: "hero.png" }, references });
  assert.equal(result.enabled, false);
  assert.equal(result.status, IDENTITY_STATUSES.ENGINE_UNAVAILABLE);
  assert.ok(result.evaluations.every((item) => item.score === null));
  assert.ok(result.evaluations.every((item) => item.status === IDENTITY_STATUSES.ENGINE_UNAVAILABLE));
});

test("Animal con engine human-only richiede revisione manuale", async () => {
  const service = new IdentityEvaluationService({ providers: [provider({ available: true, scores: [0.99, 0.99] })] });
  const result = await service.evaluate({ subjectKind: "animal", hero: { path: "dog.png" }, references });
  assert.equal(result.status, IDENTITY_STATUSES.UNSUPPORTED_SUBJECT);
  assert.ok(result.evaluations.every((item) => item.score === null));
  assert.ok(result.evaluations.every((item) => item.status === IDENTITY_STATUSES.UNSUPPORTED_SUBJECT));
});

test("threshold mapping distingue PASS WARNING FAIL e rifiuta configurazioni invalide", () => {
  const thresholds = { pass: 0.32, warning: 0.22 };
  assert.equal(mapIdentityScore(0.32, thresholds), IDENTITY_STATUSES.PASS);
  assert.equal(mapIdentityScore(0.25, thresholds), IDENTITY_STATUSES.WARNING);
  assert.equal(mapIdentityScore(0.10, thresholds), IDENTITY_STATUSES.FAIL);
  assert.equal(mapIdentityScore(null, thresholds), IDENTITY_STATUSES.NOT_EVALUATED);
  assert.throws(() => mapIdentityScore(0.5, { pass: 0.2, warning: 0.4 }), /Threshold/);
});

test("le vecchie similarity percettive non vengono più esposte come Identity Score", () => {
  const normalized = normalizeIdentityEvaluation({
    enabled: true,
    engine: "perceptual-ffmpeg-pgm",
    averageSimilarity: 0.94,
    minSimilarity: 0.91,
  });
  assert.equal(normalized.engine, null);
  assert.equal(normalized.enabled, false);
  assert.equal(normalized.evaluations.length, 0);
  assert.equal(normalized.status, IDENTITY_STATUSES.NOT_EVALUATED);
  assert.ok(normalized.warnings.some((warning) => /non misurava l'identità/.test(warning)));
});

function imageFile(name) {
  return { buffer: Buffer.from(`fake-${name}`), mimetype: "image/png", originalname: `${name}.png`, size: 20 };
}

function readyCharacter() {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-"));
  const store = new CharacterStore({ dataDirectory });
  const created = store.createCharacter({ name: "Human", subjectKind: "human" });
  const hero = store.addReference(created.id, imageFile("hero"), { type: "hero" }).reference;
  let character = store.updateReferencePlan(created.id, {
    subjectKind: "human",
    heroReferenceId: hero.id,
    workflow: { id: "qwenEdit", name: "Qwen Image Edit 2511", model: "qwen.safetensors", mode: "image" },
    items: [
      { referenceRole: "head_front", technicalPrompt: "front" },
      { referenceRole: "head_3q_left", technicalPrompt: "three quarter" },
      { referenceRole: "profile_left", technicalPrompt: "profile" },
      { referenceRole: "full_body_front", technicalPrompt: "full body" },
    ],
  });
  const approved = [];
  for (const item of character.referencePlan.items) {
    const reference = store.addReference(created.id, imageFile(item.referenceRole), {
      type: item.type,
      referenceRole: item.referenceRole,
      status: "approved",
      sourceHero: hero.id,
      subjectKind: "human",
    }).reference;
    approved.push(reference);
  }
  character = store.getCharacter(created.id);
  character = store.updateReferencePlan(created.id, {
    ...character.referencePlan,
    items: character.referencePlan.items.map((item) => ({
      ...item,
      status: "approved",
      approvedReferenceId: approved.find((reference) => reference.referenceRole === item.referenceRole).id,
    })),
  });
  return { store, character, approved };
}

test("readiness usa il piano: coverage completa ma senza engine richiede review", () => {
  const { character } = readyCharacter();
  assert.equal(buildCharacterReadiness(character).status, "Needs Review");
  assert.deepEqual(buildCharacterReadiness(character).rows.slice(0, 5).map((row) => row.approved), [true, true, true, true, true]);
});

test("manual approval completa la readiness senza inventare score", () => {
  const { store, character, approved } = readyCharacter();
  for (const reference of approved) {
    store.updateReference(character.id, reference.id, {
      status: "approved",
      manualReview: { status: "APPROVED", reviewedAt: new Date().toISOString(), reviewedBy: "user" },
    });
  }
  const updated = store.getCharacter(character.id);
  assert.equal(updated.packStatus, "Ready");
  assert.equal(updated.readiness.identity.status, "Revisione manuale completata");
  assert.ok(updated.identityEvaluation.evaluations.every((item) => item.score == null));
});

test("manual rejection esclude la reference dal Pack e rende la coverage incompleta", () => {
  const { store, character, approved } = readyCharacter();
  const rejected = approved.find((reference) => reference.referenceRole === "profile_left");
  store.updateReference(character.id, rejected.id, {
    status: "rejected",
    manualReview: { status: "REJECTED", reviewedAt: new Date().toISOString(), reviewedBy: "user" },
  });
  const plan = store.getCharacter(character.id).referencePlan;
  store.updateReferencePlan(character.id, {
    ...plan,
    items: plan.items.map((item) => item.referenceRole === "profile_left"
      ? { ...item, status: "rejected", approvedReferenceId: null }
      : item),
  });
  const updated = store.getCharacter(character.id);
  assert.equal(updated.packStatus, "Incomplete");
  assert.ok(!updated.characterPack.references.includes(rejected.id));
  assert.ok(!updated.characterPack.referenceViews.some((item) => item.referenceId === rejected.id));
});

test("engine FAIL produce Identity Warning quando la copertura è completa", () => {
  const { store, character, approved } = readyCharacter();
  store.updateIdentityEvaluation(character.id, {
    enabled: true,
    engine: "InsightFace buffalo_l",
    subjectKindsSupported: ["human"],
    thresholds: { pass: 0.32, warning: 0.22 },
    status: "FAIL",
    evaluations: approved.map((reference, index) => ({
      referenceId: reference.id,
      score: index === 0 ? 0.1 : 0.6,
      status: index === 0 ? "FAIL" : "PASS",
      engine: "InsightFace buffalo_l",
      evaluatedAt: new Date().toISOString(),
      warnings: [],
    })),
  });
  assert.equal(store.getCharacter(character.id).packStatus, "Identity Warning");
});
