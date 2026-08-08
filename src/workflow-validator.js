const LINK_PATTERN = /^[^\s]+$/;
const DEFAULT_FORBIDDEN_NODES = new Map([
  [
    "Restore Face (mtb)",
    "Il nodo Restore Face (mtb) altera il layout delle immagini in questa installazione e può produrre file larghi 3 px.",
  ],
]);

const SEEDVR2_SAFE_IMAGE_HANDOFF_NODES = new Set([
  "RemoteImageTensorNormalize",
  "ImageResize+",
  "TTP_Image_Assy",
]);

function isSeedVrSafeImageHandoffNode(node) {
  return SEEDVR2_SAFE_IMAGE_HANDOFF_NODES.has(node?.class_type);
}

export class WorkflowValidationError extends Error {
  constructor(label, issues) {
    super(`Workflow "${label}" non valido:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "WorkflowValidationError";
    this.statusCode = 400;
    this.issues = issues;
  }
}

export function isWorkflowLink(value) {
  return Array.isArray(value)
    && value.length === 2
    && (typeof value[0] === "string" || Number.isInteger(value[0]))
    && Number.isInteger(value[1])
    && value[1] >= 0;
}

export function comboOptions(specification) {
  if (!Array.isArray(specification)) return [];
  if (Array.isArray(specification[0])) return specification[0];
  if (specification[0] === "COMBO" && Array.isArray(specification[1]?.options)) {
    return specification[1].options;
  }
  return [];
}

function expectedType(specification) {
  if (!Array.isArray(specification) || Array.isArray(specification[0])) return null;
  return typeof specification[0] === "string" ? specification[0] : null;
}

function linkedTypeCompatible(actual, expected) {
  if (!actual || !expected || actual === "*" || expected === "*") return true;
  if (actual === "COMFY_MATCHTYPE_V3" || expected === "COMFY_MATCHTYPE_V3") return true;
  if (actual === "INT" && expected === "FLOAT") return true;
  const actualTypes = String(actual).split(",").map((value) => value.trim());
  const expectedTypes = String(expected).split(",").map((value) => value.trim());
  return actualTypes.some((value) => expectedTypes.includes(value));
}

function validateNumber(value, specification, path, issues) {
  const config = specification?.[1];
  if (!config || typeof config !== "object" || typeof value !== "number") return;
  if (!Number.isFinite(value)) {
    issues.push(`${path}: numero non finito`);
    return;
  }
  if (Number.isFinite(config.min) && value < config.min) {
    issues.push(`${path}: ${value} è minore del minimo ${config.min}`);
  }
  if (Number.isFinite(config.max) && value > config.max) {
    issues.push(`${path}: ${value} è maggiore del massimo ${config.max}`);
  }
}

function graphCycle(workflow) {
  const visiting = new Set();
  const visited = new Set();
  const trail = [];
  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      const start = trail.indexOf(nodeId);
      return [...trail.slice(start), nodeId];
    }
    if (visited.has(nodeId)) return null;
    visiting.add(nodeId);
    trail.push(nodeId);
    const node = workflow[nodeId];
    for (const value of Object.values(node?.inputs || {})) {
      if (!isWorkflowLink(value)) continue;
      const cycle = visit(String(value[0]));
      if (cycle) return cycle;
    }
    trail.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }
  for (const nodeId of Object.keys(workflow)) {
    const cycle = visit(nodeId);
    if (cycle) return cycle;
  }
  return null;
}

function validateSeedVrLayout(workflow, issues) {
  const seedNodes = Object.entries(workflow)
    .filter(([, node]) => node.class_type === "SeedVR2VideoUpscaler")
    .map(([id]) => id);
  if (!seedNodes.length) return;

  const consumers = new Map();
  for (const [nodeId, node] of Object.entries(workflow)) {
    for (const value of Object.values(node.inputs || {})) {
      if (!isWorkflowLink(value)) continue;
      const source = String(value[0]);
      if (!consumers.has(source)) consumers.set(source, []);
      consumers.get(source).push(nodeId);
    }
  }

  for (const seedId of seedNodes) {
    const queue = [{ id: seedId, normalized: false }];
    const visited = new Set();
    while (queue.length) {
      const state = queue.shift();
      const stateKey = `${state.id}:${state.normalized}`;
      if (visited.has(stateKey)) continue;
      visited.add(stateKey);
      for (const consumerId of consumers.get(state.id) || []) {
        const consumer = workflow[consumerId];
        const normalized = state.normalized || isSeedVrSafeImageHandoffNode(consumer);
        if (consumer.class_type === "SaveImage" && !normalized) {
          issues.push(`nodo ${seedId} (SeedVR2): l'output raggiunge SaveImage ${consumerId} senza normalizzazione`);
        }
        queue.push({ id: consumerId, normalized });
      }
    }
  }
}

export function validateWorkflow(workflow, definitions, {
  label = "workflow",
  requireOutput = true,
  forbiddenNodes = DEFAULT_FORBIDDEN_NODES,
} = {}) {
  const issues = [];
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return ["il grafo non è un oggetto API ComfyUI"];
  }
  if (!definitions || typeof definitions !== "object") {
    return ["le definizioni dei nodi ComfyUI non sono disponibili"];
  }

  let outputNodes = 0;
  for (const [rawNodeId, node] of Object.entries(workflow)) {
    const nodeId = String(rawNodeId);
    const path = `nodo ${nodeId}`;
    if (!LINK_PATTERN.test(nodeId)) issues.push(`${path}: ID non valido`);
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      issues.push(`${path}: definizione non valida`);
      continue;
    }
    if (typeof node.class_type !== "string" || !node.class_type) {
      issues.push(`${path}: class_type mancante`);
      continue;
    }
    if (!node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
      issues.push(`${path} (${node.class_type}): inputs mancanti`);
      continue;
    }
    if (forbiddenNodes?.has(node.class_type)) {
      issues.push(`${path} (${node.class_type}): ${forbiddenNodes.get(node.class_type)}`);
    }
    const definition = definitions[node.class_type];
    if (!definition) {
      issues.push(`${path}: nodo "${node.class_type}" non installato`);
      continue;
    }
    if (definition.output_node === true || ["SaveImage", "SaveVideo", "VHS_VideoCombine"].includes(node.class_type)) {
      outputNodes += 1;
    }

    const knownInputs = {
      ...(definition.input?.required || {}),
      ...(definition.input?.optional || {}),
    };
    for (const [inputName, specification] of Object.entries(definition.input?.required || {})) {
      if (!(inputName in node.inputs)) {
        issues.push(`${path} (${node.class_type}): input obbligatorio "${inputName}" mancante`);
      }
    }
    for (const [inputName, value] of Object.entries(node.inputs)) {
      const inputPath = `${path} (${node.class_type}).${inputName}`;
      const specification = knownInputs[inputName];
      // Gli input dinamici sono comuni nei nodi stack/calculator e non vanno rifiutati.
      if (!specification) continue;
      if (isWorkflowLink(value)) {
        const sourceId = String(value[0]);
        const source = workflow[sourceId];
        if (!source) {
          issues.push(`${inputPath}: collegamento al nodo inesistente ${sourceId}`);
          continue;
        }
        const sourceDefinition = definitions[source.class_type];
        if (!sourceDefinition) continue;
        if (value[1] >= (sourceDefinition.output?.length || 0)) {
          issues.push(`${inputPath}: output ${value[1]} inesistente sul nodo ${sourceId} (${source.class_type})`);
          continue;
        }
        const actual = sourceDefinition.output?.[value[1]];
        const expected = expectedType(specification);
        if (!linkedTypeCompatible(actual, expected)) {
          issues.push(`${inputPath}: tipo ${actual} da ${sourceId}[${value[1]}], atteso ${expected}`);
        }
        continue;
      }
      const choices = comboOptions(specification);
      const uploadInput = specification?.[1]?.image_upload === true
        || specification?.[1]?.video_upload === true
        || (node.class_type === "VHS_LoadVideoFFmpeg" && inputName === "video");
      if (!uploadInput && choices.length && !choices.includes(value)) {
        issues.push(`${inputPath}: valore "${value}" non presente fra le opzioni installate`);
      }
      validateNumber(value, specification, inputPath, issues);
    }
  }

  const cycle = graphCycle(workflow);
  if (cycle) issues.push(`il grafo contiene un ciclo: ${cycle.join(" → ")}`);
  if (requireOutput && outputNodes === 0) issues.push("nessun nodo di output/salvataggio presente");
  validateSeedVrLayout(workflow, issues);
  return [...new Set(issues)];
}

export function assertWorkflow(workflow, definitions, options = {}) {
  const issues = validateWorkflow(workflow, definitions, options);
  if (issues.length) throw new WorkflowValidationError(options.label || "workflow", issues);
  return workflow;
}

export class WorkflowPreflight {
  constructor(loadDefinitions, { ttlMs = 60_000 } = {}) {
    this.loadDefinitions = loadDefinitions;
    this.ttlMs = ttlMs;
    this.cached = null;
    this.loadedAt = 0;
  }

  invalidate() {
    this.cached = null;
    this.loadedAt = 0;
  }

  async definitions() {
    if (this.cached && Date.now() - this.loadedAt < this.ttlMs) return this.cached;
    this.cached = await this.loadDefinitions();
    this.loadedAt = Date.now();
    return this.cached;
  }

  async assert(workflow, options = {}) {
    return assertWorkflow(workflow, await this.definitions(), options);
  }
}
