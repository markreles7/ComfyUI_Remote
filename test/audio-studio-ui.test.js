import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../public/audio-studio.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("../public/audio-studio.js", import.meta.url), "utf8");

test("Audio Studio contiene i due motori, lyrics, player e prompt assistant non automatico", () => {
  assert.match(html, /MiniMax H3 Music/);
  assert.match(html, /LTX 2\.5 Audio/);
  assert.match(html, /id="audioLyrics"/);
  assert.match(script, /audio_music/);
  assert.match(script, /\/api\/audio\//);
  assert.doesNotMatch(script, /audio-prompt-assistant[\s\S]{0,300}requestSubmit/);
});

test("AllInOne usa il planner LLM di timeline causale", () => {
  const videoHtml = fs.readFileSync(new URL("../public/video-studio.html", import.meta.url), "utf8");
  const client = fs.readFileSync(new URL("../src/lm-studio-client.js", import.meta.url), "utf8");
  assert.match(videoHtml, /minimax_h3_director_sequence/);
  assert.match(videoHtml, /Crea sequenze coerenti/);
  assert.match(client, /exact prior ending state|previous segment's ending state/);
  assert.match(client, /standalone --- line/);
  const server = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /MANDATORY USER EVENT TO COMPLETE IN THIS CLIP/);
  assert.match(server, /directorNaturalSegments/);
});
