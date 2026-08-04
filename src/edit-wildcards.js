import fs from "node:fs";
import path from "node:path";

export const EDIT_WILDCARD_FILES = {
  gwen: {
    id: "gwen",
    label: "BigLove Gwen / Qwen",
    filename: "Gwen_edit_prompts.txt",
  },
  klein: {
    id: "klein",
    label: "BigLove Klein",
    filename: "Klein_edit_prompts.txt",
  },
};

function readPromptLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function wildcardFile(root, family) {
  const definition = EDIT_WILDCARD_FILES[family];
  if (!definition) return null;
  return path.join(root, ".data", "edit-wildcards", definition.filename);
}

export function editWildcardConfig(root) {
  return Object.fromEntries(Object.entries(EDIT_WILDCARD_FILES).map(([family, definition]) => {
    const file = wildcardFile(root, family);
    const prompts = readPromptLines(file);
    return [family, {
      id: definition.id,
      label: definition.label,
      filename: definition.filename,
      installed: prompts.length > 0,
      count: prompts.length,
    }];
  }));
}

export function pickEditWildcardPrompt(root, {
  family = "gwen",
  seed = null,
  maxLength = 1400,
  base = "",
  mode = "replace",
} = {}) {
  const pool = family === "mix" ? ["gwen", "klein"] : [family];
  const candidates = pool.flatMap((item) => {
    const file = wildcardFile(root, item);
    return readPromptLines(file).map((prompt) => ({ family: item, prompt }));
  });
  if (!candidates.length) {
    throw new Error("Wildcard prompt non installati. Copia Gwen_edit_prompts.txt e Klein_edit_prompts.txt in .data/edit-wildcards.");
  }

  const numericSeed = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 2 ** 31);
  const index = Math.abs(numericSeed) % candidates.length;
  const selected = candidates[index];
  const compactPrompt = selected.prompt.length > maxLength
    ? `${selected.prompt.slice(0, Math.max(120, maxLength)).trim()}…`
    : selected.prompt;
  const cleanBase = String(base || "").trim();
  const prompt = mode === "append" && cleanBase
    ? `${cleanBase}\n\n${compactPrompt}`
    : mode === "prepend" && cleanBase
      ? `${compactPrompt}\n\n${cleanBase}`
      : compactPrompt;

  return {
    family: selected.family,
    label: EDIT_WILDCARD_FILES[selected.family].label,
    seed: numericSeed,
    prompt,
    rawPrompt: selected.prompt,
    truncated: selected.prompt.length > compactPrompt.length,
    count: candidates.length,
  };
}
