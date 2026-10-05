import test from "node:test";
import assert from "node:assert/strict";
import { setupPromptDictation } from "../public/prompt-dictation.js";

class Element extends EventTarget {
  value = "";
  textContent = "";
  hidden = false;
  disabled = false;
  attributes = {};
  setAttribute(key, value) { this.attributes[key] = value; }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}

function fixture({ secure = true, supported = true } = {}) {
  const input = new Element();
  const button = new Element();
  const status = new Element();
  const preview = new Element();
  const root = new Element();
  const host = new Element();
  const enhance = new Element();
  root.querySelectorAll = () => [enhance];
  host.isSecureContext = secure;
  const sessions = [];
  class Recognition {
    constructor() { sessions.push(this); }
    start() { this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; this.onend?.(); }
    result(results) { this.onresult({ results: results.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal })) }); }
    end() { this.onend(); }
  }
  if (supported) host.webkitSpeechRecognition = Recognition;
  const controller = setupPromptDictation({ input, button, status, preview, root, host });
  return { input, button, status, preview, root, host, enhance, sessions, controller };
}

test("dictation appends final Italian text without replacing edits or duplicating repeated results", () => {
  const f = fixture();
  f.input.value = "Una strada.";
  let inputEvents = 0;
  f.input.addEventListener("input", () => inputEvents++);
  f.button.click();
  const recognition = f.sessions[0];
  assert.equal(recognition.lang, "it-IT");
  assert.equal(f.enhance.disabled, true);
  recognition.result([["Arriva", false]]);
  assert.equal(f.input.value, "Una strada.");
  assert.equal(f.preview.textContent, "Arriva");
  recognition.result([["Arriva un'auto.", true], ["Poi", false]]);
  f.input.value += " Ripresa CCTV.";
  recognition.result([["Arriva un'auto.", true], ["Poi scompare.", true]]);
  assert.equal(f.input.value, "Una strada. Arriva un'auto. Ripresa CCTV. Poi scompare.");
  assert.equal(inputEvents, 2);
  f.button.click();
  assert.equal(recognition.stopped, true);
  recognition.end();
  assert.equal(f.controller.active, false);
  assert.equal(f.enhance.disabled, false);
  assert.equal(f.button.attributes["aria-pressed"], "false");
});

test("permission errors retain text and permit retry; late callbacks cannot change it", () => {
  const f = fixture();
  f.input.value = "Scena originale";
  f.button.click();
  const old = f.sessions[0];
  old.onerror({ error: "not-allowed" });
  assert.match(f.status.textContent, /non autorizzato/);
  assert.equal(f.controller.active, false);
  assert.equal(f.input.value, "Scena originale");
  f.button.click();
  old.result([["Testo obsoleto", true]]);
  assert.equal(f.input.value, "Scena originale");
  f.sessions[1].end();
});

test("insecure and unsupported browsers show a usable keyboard fallback without microphone access", () => {
  for (const options of [{ secure: false }, { supported: false }]) {
    const f = fixture(options);
    assert.equal(f.button.disabled, true);
    assert.match(f.status.textContent, /tastiera/);
    f.button.click();
    assert.equal(f.sessions.length, 0);
  }
});

test("leaving the page aborts recognition and restores previously disabled controls", () => {
  const f = fixture();
  f.enhance.disabled = true;
  f.button.click();
  f.root.hidden = true;
  f.root.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.sessions[0].aborted, true);
  assert.equal(f.controller.active, false);
  assert.equal(f.enhance.disabled, true);
});

test("dictation cannot start while prompt enhancement is running", () => {
  const f = fixture();
  f.host.__promptAssistantBusy = true;
  f.button.click();
  assert.equal(f.sessions.length, 0);
  assert.match(f.status.textContent, /Attendi/);
});
