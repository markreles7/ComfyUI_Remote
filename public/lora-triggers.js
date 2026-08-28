export function uniquePromptTriggers(triggers = []) {
  const values = Array.isArray(triggers) ? triggers : [triggers];
  const seen = new Set();
  return values
    .flatMap((trigger) => Array.isArray(trigger) ? trigger : [trigger])
    .map((trigger) => String(trigger || "").trim().replace(/[,.]+$/, ""))
    .filter((trigger) => {
      const key = trigger.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function automaticLoraTriggers(loras = [], metadata = {}) {
  return uniquePromptTriggers(loras.flatMap(({ name } = {}) => {
    const item = metadata[name] || {};
    if (item.automatic === false) return [];
    return item.triggers || item.trigger || [];
  }));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeTrigger(text, trigger) {
  const escaped = escapeRegExp(trigger);
  return text.replace(
    new RegExp(`(^|[\\s,.;:!—–-])${escaped}(?=$|[\\s,.;:!—–-])`, "giu"),
    "$1",
  );
}

export function promptWithTriggerPrefix(prompt, triggers, previousTriggers = []) {
  const selected = uniquePromptTriggers(triggers);
  const removable = uniquePromptTriggers([...previousTriggers, ...selected]);
  let body = String(prompt || "").trim();
  for (const trigger of removable) body = removeTrigger(body, trigger);
  body = body.replace(/^[\s,.;:!—–-]+/, "").replace(/\s{2,}/g, " ").trim();
  return selected.length
    ? `${selected.join(", ")}.${body ? ` ${body}` : ""}`
    : body;
}

export function promptWithH3IntegratedTriggers(prompt, triggers, previousTriggers = []) {
  const selected = uniquePromptTriggers(triggers);
  const removable = uniquePromptTriggers([...previousTriggers, ...selected]);
  let body = String(prompt || "").trim();
  for (const trigger of removable) body = removeTrigger(body, trigger);
  body = body.replace(/^[\s,.;:!—–-]+/, "").trim();

  const referenceFields = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
  const baseFields = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
  const isReference = /\bsubject[\s_-]+definitions\s*[:[]/iu.test(body)
    || /\bdetailed[\s_-]+description\s*[:[]/iu.test(body);
  const order = isReference ? referenceFields : baseFields;
  const aliases = order.map((field) => field.split("_").join("[\\s_-]+")).join("|");
  const matches = [...body.matchAll(new RegExp(`\\b(${aliases})\\s*([:\\[])`, "giu"))];
  const alignment = !isReference && matches[0]?.index > 0 ? body.slice(0, matches[0].index).trim() : "";
  const parsed = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = match[1].toLocaleLowerCase().replace(/[\s-]+/g, "_");
    const end = matches[index + 1]?.index ?? body.length;
    let value = body.slice(match.index + match[0].length, end).trim();
    // Only strip wrapper brackets from the legacy `field[value]` syntax.
    // A valid H3 value begins with `[Shot 1]`; removing that opening bracket
    // made submit-time LoRA insertion turn it into `[Shot 1] Shot 1]`.
    if (match[2] === "[") value = value.replace(/\]\s*$/u, "").trim();
    parsed[key] = value;
  }
  const targetField = isReference ? "detailed_description" : "integrated_multimodal_description";
  let integratedBody = (parsed[targetField] || body).trim().replace(/^[\s,.;:!—–-]+/, "");
  integratedBody = integratedBody.replace(/^(?:(?:\[\s*Shot\s+1\s*\]|Shot\s+1\])\s*)+/iu, "[Shot 1] ").trim();
  if (!/\[Shot\s+1\]/iu.test(integratedBody)) integratedBody = `[Shot 1] ${integratedBody}`.trim();
  const triggerPrefix = selected.length ? `${selected.join(", ")}.${integratedBody ? " " : ""}` : "";
  parsed[targetField] = `${triggerPrefix}${integratedBody}`;
  if (isReference) {
    parsed.subject_definitions ||= "Referenced subjects use the supplied reference labels according to their stated roles.";
    parsed.summary ||= "[reference generation] The target video follows the supplied reference roles and requested action.";
    parsed.retention_analysis ||= "Supplied reference roles are preserved according to the user request.";
  }
  const formatted = order.map((field) => `${field}: ${parsed[field] || "N/A"}`).join("\n\n");
  return alignment ? `${alignment}\n\n${formatted}` : formatted;
}

export function applyLoraTriggers(input, triggers) {
  if (!input) return [];
  let previous = [];
  try {
    previous = JSON.parse(input.dataset.autoLoraTriggers || "[]");
  } catch {
    previous = [];
  }
  const selected = uniquePromptTriggers(triggers);
  input.value = promptWithTriggerPrefix(input.value, selected, previous);
  input.dataset.autoLoraTriggers = JSON.stringify(selected);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return selected;
}

export function applyH3LoraTriggers(input, triggers) {
  if (!input) return [];
  let previous = [];
  try {
    previous = JSON.parse(input.dataset.autoLoraTriggers || "[]");
  } catch {
    previous = [];
  }
  const selected = uniquePromptTriggers(triggers);
  input.value = promptWithH3IntegratedTriggers(input.value, selected, previous);
  input.dataset.autoLoraTriggers = JSON.stringify(selected);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return selected;
}

export function loraOptionLabel(name, metadata = {}) {
  const item = metadata[name] || {};
  const automatic = uniquePromptTriggers(item.triggers || item.trigger || []);
  if (automatic.length) return `${name} · trigger: ${automatic.join(", ")}`;
  if (item.triggerOptions?.length) return `${name} · trigger variabile/manuale`;
  return name;
}

export function loraFamily(name, metadata = {}) {
  const item = metadata[name] || {};
  const baseModel = String(item.baseModel || "").toLocaleLowerCase();
  if (baseModel.includes("qwen")) return "QWEN";
  if (baseModel.includes("flux.2 klein")) return "FLUX2";
  if (baseModel.includes("krea 2") || baseModel.includes("flux.1")) return "FLUX";
  if (baseModel.includes("ltx")) return "LTX2.3";
  if (baseModel.includes("minimax h3")) return "H3";
  if (item.incompatible) return "INCOMPATIBLE";
  const folder = String(name || "").replaceAll("/", "\\").split("\\")[0].toLocaleUpperCase();
  return folder === "Z-IMAGE" ? "ZIMG" : folder;
}

export function loraMatchesFamily(name, family, metadata = {}) {
  return loraFamily(name, metadata) === String(family || "").toLocaleUpperCase();
}
