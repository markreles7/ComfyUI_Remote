import test from "node:test";
import assert from "node:assert/strict";
import { validateGenerationForm } from "../public/generation-form-validation.js";

function field(options = {}) {
  return {
    willValidate: true,
    validity: { valid: false },
    labels: [{ textContent: "Sampling steps" }],
    validationMessage: "Il valore deve essere maggiore o uguale a 1.",
    closest() { return null; },
    scrollIntoView() { this.scrolled = true; },
    focus() { this.focused = true; },
    reportValidity() { this.reported = true; },
    ...options,
  };
}

test("an invalid advanced setting is revealed and named instead of silently blocking submit", () => {
  const outer = { tagName: "DETAILS", open: false };
  const inner = { tagName: "DETAILS", open: false, parentElement: outer };
  const input = field({ parentElement: inner });
  const error = {};
  assert.equal(validateGenerationForm({ elements: [input] }, error), false);
  assert.equal(outer.open, true);
  assert.equal(inner.open, true);
  assert.match(error.textContent, /^Sampling steps: /);
  assert.equal(input.focused && input.scrolled && input.reported, true);
});

test("inactive workflow fields and disabled fields do not block the next generation", () => {
  const hidden = field({ closest: () => ({}) });
  const disabled = field({ willValidate: false });
  const active = field({ validity: { valid: true } });
  assert.equal(validateGenerationForm({ elements: [hidden, disabled, active] }, {}), true);
  assert.equal(hidden.focused, undefined);
});

test("correcting a field allows successive submissions and clears the previous error", () => {
  const input = field();
  const form = { elements: [input] };
  const error = {};
  assert.equal(validateGenerationForm(form, error), false);
  input.validity.valid = true;
  assert.equal(validateGenerationForm(form, error), true);
  assert.equal(error.textContent, "");
  assert.equal(validateGenerationForm(form, error), true);
});

test("required file inputs are still validated and their upload area is revealed", () => {
  const upload = { scrollIntoView() { this.scrolled = true; } };
  const input = field({
    labels: [{ textContent: "Immagine iniziale" }],
    validationMessage: "Seleziona un file.",
    closest: (selector) => selector === ".dropzone, .field" ? upload : null,
  });
  const error = {};
  assert.equal(validateGenerationForm({ elements: [input] }, error), false);
  assert.equal(error.textContent, "Immagine iniziale: Seleziona un file.");
  assert.equal(upload.scrolled, true);
});
