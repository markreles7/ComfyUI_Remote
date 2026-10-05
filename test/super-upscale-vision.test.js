import assert from "node:assert/strict";
import test from "node:test";
import { captionSuperUpscaleTile } from "../src/super-upscale-vision.js";

const png = Buffer.from([137,80,78,71,13,10,26,10]).toString("base64");
const body = { images: [png, png, png], globalPrompt: "A villa at sunset" };
function client(overrides = {}) {
  const calls = [];
  let loaded = true;
  return {
    calls, publicConfig: () => ({ enabled: true }),
    ensureServer: async () => {},
    models: async () => ({ models: [{ loaded_instances: loaded ? [{ id: "vision" }] : [] }] }),
    unload: async (id) => { calls.push(`unload:${id}`); loaded = false; },
    enhance: async (request) => {
      calls.push("caption");
      assert.equal(request.images.length, 3);
      assert.equal(request.target, "super_upscale_tile");
      assert.match(request.text, /original crop, authoritative/);
      loaded = true;
      return { prompt: "Stone wall, preserve mortar joints", usedVision: true, model: "vision" };
    }, ...overrides,
  };
}
test("Vision unloads before and verifies unloading after the caption", async () => {
  const lm = client();
  assert.equal((await captionSuperUpscaleTile(lm, body)).unloaded, true);
  assert.deepEqual(lm.calls, ["unload:vision", "caption", "unload:vision"]);
});
test("caption failure is fatal and still cleans up", async () => {
  const lm = client({ enhance: async () => { throw new Error("vision failed"); } });
  await assert.rejects(captionSuperUpscaleTile(lm, body), /vision failed/);
});
test("refuses a handoff if unloading did not succeed", async () => {
  const lm = client({ unload: async () => {} });
  await assert.rejects(captionSuperUpscaleTile(lm, body), /non ha scaricato/);
  assert.equal(lm.calls.includes("caption"), false);
});
test("rejects unavailable vision, busy models, invalid images and text-only output", async () => {
  await assert.rejects(captionSuperUpscaleTile(client({ active: {} }), body), /occupato/);
  await assert.rejects(captionSuperUpscaleTile(client(), { images: [] }), /Servono/);
  await assert.rejects(captionSuperUpscaleTile(client(), { images: ["bad", png, png] }), /PNG/);
  await assert.rejects(captionSuperUpscaleTile(client({ enhance: async () => ({ prompt: "text", usedVision: false }) }), body), /Vision valida/);
});
