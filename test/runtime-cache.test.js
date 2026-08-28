import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeCache = fs.readFileSync(path.join(root, "public", "runtime-cache.js"), "utf8");
const server = fs.readFileSync(path.join(root, "src", "server.js"), "utf8");

test("bootstrap web riusa configurazione e polling senza richieste sovrapposte", () => {
  assert.match(runtimeCache, /localStorage\.getItem/);
  assert.match(runtimeCache, /if \(configPromise\) return configPromise/);
  assert.match(runtimeCache, /if \(stopped \|\| running\)/);
  assert.match(runtimeCache, /document\.hidden \? hiddenMs/);
  assert.match(runtimeCache, /function capabilitySignature/);
  assert.match(runtimeCache, /function publishConfigUpdate/);
  assert.match(runtimeCache, /capabilitySignature\(value\) === capabilitySignature\(previousValue\)/);
  assert.doesNotMatch(runtimeCache, /location\?\.reload/);
});

test("backend configura una sola lettura ComfyUI e conserva una snapshot", () => {
  assert.match(server, /const APP_CONFIG_CACHE_FILE/);
  assert.match(server, /const info = infoOverride \|\| await comfy\.objectInfo\(\)/);
  assert.match(server, /function persistAppConfigSnapshot/);
  assert.match(server, /void refreshAppConfig\(\)\.catch/);
  assert.doesNotMatch(server, /const \[info, interactiveCastCapabilities/);
  assert.match(server, /const info = infoOverride \?\? await comfy\.objectInfo\(\)/);
  assert.doesNotMatch(server, /await comfy\.objectInfo\(\)\.catch\(\(\) => \(\{\}\)\)/);
});

test("cold start non resta bloccato se ComfyUI risponde lentamente", () => {
  assert.match(server, /APP_CONFIG_BOOTSTRAP_WAIT_MS/);
  assert.match(server, /Promise\.race\(\[/);
  assert.match(server, /buildAppConfig\(\{\}\)/);
  assert.match(server, /source: "bootstrap"/);
  assert.match(server, /\.catch\(\(\) => null\)/);
  assert.match(server, /cache\?\.bootstrap/);
  assert.match(runtimeCache, /scheduleConfigRefresh/);
  assert.match(runtimeCache, /cache\?\.stale/);
  assert.match(runtimeCache, /payload\.cache\?\.bootstrap \? payload : storeConfig\(payload\)/);
  assert.match(server, /comfyOffline: true/);
  assert.match(runtimeCache, /ltx-remote:config-updated/);
});
