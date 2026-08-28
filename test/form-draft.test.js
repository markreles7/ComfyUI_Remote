import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const helper = fs.readFileSync(path.join(root, "public", "form-draft.js"), "utf8");
const videoStudio = fs.readFileSync(path.join(root, "public", "video-studio.js"), "utf8");

test("Video Studio conserva una bozza senza tentare di ripristinare i file", () => {
  assert.match(helper, /sessionStorage\.setItem/);
  assert.match(helper, /field\.type !== "file"/);
  assert.match(helper, /window\.addEventListener\("pagehide", save\)/);
  assert.match(videoStudio, /attachFormDraft/);
  assert.match(videoStudio, /ltx-remote:video-studio-draft:v1/);
});
