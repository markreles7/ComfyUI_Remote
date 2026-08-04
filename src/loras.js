function sameLink(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && String(left[0]) === String(right[0])
    && Number(left[1]) === Number(right[1]);
}

function nextNodeId(workflow) {
  const maximum = Object.keys(workflow)
    .map((id) => Number(id))
    .filter(Number.isFinite)
    .reduce((max, id) => Math.max(max, id), 0);
  return maximum + 1000;
}

export function parseLoras(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return [];
  let parsed;
  try {
    parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
  } catch {
    throw new Error("La configurazione LoRA non è valida.");
  }
  if (!Array.isArray(parsed)) throw new Error("La configurazione LoRA non è valida.");
  return parsed
    .filter((item) => item && String(item.name || "").trim())
    .map((item) => {
      const name = String(item.name).trim();
      const strength = Number(item.strength);
      if (!Number.isFinite(strength) || strength < -10 || strength > 10) {
        throw new Error(`Forza LoRA non valida per ${name}.`);
      }
      return { name, strength };
    });
}

export function validateLoras(loras, installedNames) {
  const available = new Set(installedNames.map((name) => String(name).toLowerCase()));
  for (const lora of loras) {
    if (!available.has(lora.name.toLowerCase())) {
      throw new Error(`LoRA non installata: ${lora.name}`);
    }
  }
}

export function insertModelLoras(workflow, loras, sourceLink, consumerIds = null) {
  if (!loras.length) return sourceLink;
  const consumers = consumerIds
    ? consumerIds.map(String)
    : Object.entries(workflow)
      .filter(([, item]) => sameLink(item.inputs?.model, sourceLink))
      .map(([id]) => id);
  if (!consumers.length) throw new Error("Punto di applicazione LoRA non trovato nel workflow.");

  let link = sourceLink;
  let id = nextNodeId(workflow);
  for (const [index, lora] of loras.entries()) {
    const nodeId = String(id++);
    workflow[nodeId] = {
      inputs: {
        model: link,
        lora_name: lora.name,
        strength_model: lora.strength,
      },
      class_type: "LoraLoaderModelOnly",
      _meta: { title: `LoRA Web App ${index + 1} • ${lora.name}` },
    };
    link = [nodeId, 0];
  }
  for (const consumerId of consumers) workflow[consumerId].inputs.model = link;
  return link;
}

