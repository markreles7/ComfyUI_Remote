export const MAX_PROMPT_BATCH = 50;

function cleanPrompt(value) {
  return String(value || "")
    .trim()
    .replace(/^\s*(?:prompt|descrizione)\s*:\s*/iu, "")
    .replace(/^(["“])([\s\S]*)["”]$/u, "$2")
    .trim();
}

export function parsePromptBatch(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(cleanPrompt).filter(Boolean);
    } catch {
      // Continue with the human-readable formats below.
    }
  }

  const separated = text.split(/^\s*-{3,}\s*$/mu).map(cleanPrompt).filter(Boolean);
  if (separated.length > 1) return separated;

  const lines = text.split("\n");
  const numbered = /^\s*(?:#{1,6}\s*)?(?:(?:prompt|scena|scene)\s*)?(\d{1,3})\s*[.):\-–—]\s*(.*)$/iu;
  const markerCount = lines.filter((line) => numbered.test(line)).length;
  if (markerCount > 1) {
    const prompts = [];
    let current = [];
    for (const line of lines) {
      const match = line.match(numbered);
      if (match) {
        if (current.length) prompts.push(cleanPrompt(current.join("\n")));
        current = match[2] ? [match[2]] : [];
      } else if (current.length || line.trim()) {
        current.push(line);
      }
    }
    if (current.length) prompts.push(cleanPrompt(current.join("\n")));
    return prompts.filter(Boolean);
  }

  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  if (nonEmpty.length > 1 && nonEmpty.every((line) => /^[-*•]\s+/u.test(line))) {
    return nonEmpty.map((line) => cleanPrompt(line.replace(/^[-*•]\s+/u, ""))).filter(Boolean);
  }
  return nonEmpty.map(cleanPrompt).filter(Boolean);
}

export function promptBatchSummary(value, enabled) {
  if (!enabled) return { count: 1, prompts: [String(value || "").trim()].filter(Boolean) };
  const prompts = parsePromptBatch(value);
  return { count: prompts.length, prompts, exceedsLimit: prompts.length > MAX_PROMPT_BATCH };
}
