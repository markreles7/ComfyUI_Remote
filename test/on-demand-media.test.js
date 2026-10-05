import assert from "node:assert/strict";
import test from "node:test";
import { deferMediaPreview } from "../public/on-demand-media.js";

for (const [kind, path, label] of [
  ["video", "/api/media/id/0", "Mostra video"],
  ["audio", "/api/audio/id/0", "Ascolta audio"],
  ["img", "/api/image/id/0", "Mostra immagine"],
]) {
  test(`${kind} keeps its remote URL inert until preview activation`, () => {
    const source = `<${kind} class="result" src="${path}" preload="metadata"${kind === "img" ? ' alt="Risultato"' : " controls"}>${kind === "img" ? "" : `</${kind}>`}`;
    const markup = deferMediaPreview(source);
    assert.doesNotMatch(markup, /\ssrc=/);
    assert.match(markup, new RegExp(`data-on-demand-src="${path}"`));
    assert.match(markup, /class="result"/);
    assert.match(markup, new RegExp(label));
    assert.match(markup, new RegExp(`<${kind} hidden`));
    assert.doesNotMatch(markup, /preload="metadata"/);
  });
}

test("video cannot load an automatic poster or autoplay", () => {
  const markup = deferMediaPreview('<video autoplay poster="/poster.jpg" src="/clip.mp4"></video>');
  assert.doesNotMatch(markup, /\s(?:src|poster)=|\sautoplay\b/);
  assert.match(markup, /preload="none"/);
});
