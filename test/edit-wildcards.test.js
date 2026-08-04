import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { editWildcardConfig, pickEditWildcardPrompt } from "../src/edit-wildcards.js";

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ltx-wildcards-"));
  const folder = path.join(root, ".data", "edit-wildcards");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "Gwen_edit_prompts.txt"), "gwen prompt one\n\ngwen prompt two\n", "utf8");
  fs.writeFileSync(path.join(folder, "Klein_edit_prompts.txt"), "klein prompt one\nklein prompt two\n", "utf8");
  return root;
}

test("espone conteggi wildcard per Gwen/Qwen e Klein", () => {
  const config = editWildcardConfig(fixtureRoot());
  assert.equal(config.gwen.installed, true);
  assert.equal(config.gwen.count, 2);
  assert.equal(config.klein.installed, true);
  assert.equal(config.klein.count, 2);
});

test("pesca un prompt wildcard e può combinarlo con l'idea utente", () => {
  const root = fixtureRoot();
  const result = pickEditWildcardPrompt(root, {
    family: "klein",
    mode: "append",
    base: "my source photo stays recognizable",
    seed: 1,
  });
  assert.equal(result.family, "klein");
  assert.equal(result.prompt, "my source photo stays recognizable\n\nklein prompt two");
});

test("il mix pesca da entrambi i pool", () => {
  const root = fixtureRoot();
  assert.equal(pickEditWildcardPrompt(root, { family: "mix", seed: 0 }).family, "gwen");
  assert.equal(pickEditWildcardPrompt(root, { family: "mix", seed: 3 }).family, "klein");
});
