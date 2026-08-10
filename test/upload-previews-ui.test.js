import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const helper = fs.readFileSync(new URL("../public/upload-previews.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const studio = fs.readFileSync(new URL("../public/studio.js", import.meta.url), "utf8");
const videoStudio = fs.readFileSync(new URL("../public/video-studio.js", import.meta.url), "utf8");
const characters = fs.readFileSync(new URL("../public/characters.js", import.meta.url), "utf8");
const guided = fs.readFileSync(new URL("../public/guided-create.js", import.meta.url), "utf8");

test("le pagine principali inizializzano le anteprime upload condivise", () => {
  for (const script of [app, studio, videoStudio, characters, guided]) {
    assert.match(script, /upload-previews\.js/);
    assert.match(script, /setupUploadPreviews/);
  }
});

test("upload-previews supporta immagini, video, multipli e rimozione", () => {
  assert.match(helper, /file\.type\.startsWith\("video\/"\)/);
  assert.match(helper, /file\.type\.startsWith\("audio\/"\)/);
  assert.match(helper, /upload-preview-file/);
  assert.match(helper, /files\.slice\(0, 6\)/);
  assert.match(helper, /URL\.revokeObjectURL/);
  assert.match(helper, /upload-preview-clear/);
  assert.match(helper, /input\[type="file"\]/);
  assert.match(helper, /shouldPreviewInput/);
  assert.match(helper, /file-upload-preview-host/);
  assert.match(helper, /media\.controls = true/);
  assert.match(helper, /loadedmetadata/);
  assert.match(helper, /fileKind/);
  assert.match(helper, /pagehide/);
});

test("lo stile rende cliccabile il pulsante sopra l'input invisibile", () => {
  assert.match(styles, /\.upload-preview/);
  assert.match(styles, /pointer-events: none/);
  assert.match(styles, /\.upload-preview-clear/);
  assert.match(styles, /pointer-events: auto/);
  assert.match(styles, /\.compact-file\.has-upload-preview/);
  assert.match(styles, /\.file-upload-preview-host\.has-upload-preview/);
  assert.match(styles, /\.upload-preview-item audio/);
  assert.match(styles, /\.upload-preview-item video,[\s\S]*pointer-events: auto/);
});
