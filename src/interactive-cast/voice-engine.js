import fs from "node:fs";
import path from "node:path";
import { runPythonJson } from "./python-tools.js";

export function voiceEngineCapabilities({ root, toolDirectory } = {}) {
  const directory = toolDirectory || path.join(root || process.cwd(), ".tools", "interactive-cast");
  const script = path.join(directory, "scripts", "synthesize.py");
  const python = process.platform === "win32"
    ? path.join(directory, ".venv-voice", "Scripts", "python.exe")
    : path.join(directory, ".venv-voice", "bin", "python");
  const engineDirectory = path.join(directory, "engines", "chatterbox");
  const modelMarker = path.join(directory, "models", "chatterbox-multilingual", ".ready");
  const adapterReady = fs.existsSync(script) && fs.existsSync(python) && fs.existsSync(engineDirectory);
  let model = null;
  try {
    model = JSON.parse(fs.readFileSync(modelMarker, "utf8"));
  } catch {
    model = fs.existsSync(modelMarker) ? { device: "unknown" } : null;
  }
  const configured = adapterReady && Boolean(model);
  return {
    engine: "auto",
    primaryEngine: adapterReady ? "chatterbox-multilingual" : null,
    status: configured ? "READY" : adapterReady ? "FALLBACK" : "NOT CONFIGURED",
    synthesizeDialogue: configured,
    script,
    python,
    engineDirectory,
    modelMarker,
    device: model?.device || null,
    model,
    reason: configured
      ? "Chatterbox Multilingual adapter, isolated Python environment and model cache are ready."
      : adapterReady
        ? "Chatterbox adapter installed, but model prefetch has not completed."
        : "No local zero-shot voice engine has been installed in .tools/interactive-cast.",
  };
}

export class VoiceEngineNotConfiguredError extends Error {
  constructor(message = "Voice cloning locale non configurato.") {
    super(message);
    this.name = "VoiceEngineNotConfiguredError";
    this.statusCode = 409;
    this.code = "VOICE_ENGINE_NOT_CONFIGURED";
  }
}

export async function synthesizeDialogue({
  root,
  toolDirectory,
  referenceAudio,
  text,
  language = "en",
  outputDirectory,
  speaker = "speaker",
  eventId = "event",
  options = {},
} = {}) {
  const capabilities = voiceEngineCapabilities({ root, toolDirectory });
  if (!capabilities.synthesizeDialogue) {
    throw new VoiceEngineNotConfiguredError(
      "Voice cloning locale non configurato: installa/collega .tools/interactive-cast/scripts/synthesize.py oppure carica una battuta audio manuale."
    );
  }
  if (!referenceAudio?.path && options.requireReference !== false) {
    throw new Error("Reference voce mancante: impossibile sintetizzare senza usare una voce generica.");
  }
  if (!String(text || "").trim()) throw new Error("Testo battuta mancante.");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, `${String(eventId).replace(/[^\w-]+/g, "_")}-voice.wav`);
  const args = [
    "--text", text,
    "--language", language,
    "--speaker", speaker,
    "--output", output,
  ];
  if (referenceAudio?.path) args.push("--reference", referenceAudio.path);
  const result = await runPythonJson({
    root,
    toolDirectory,
    scriptName: "synthesize.py",
    args,
    timeout: Number(options.timeout || 600_000),
    environment: "voice",
  });
  if (!result.ok) {
    const error = new Error(result.error || "Sintesi voce fallita.");
    error.statusCode = 500;
    throw error;
  }
  const generatedPath = result.data?.path || result.data?.output || output;
  if (!fs.existsSync(generatedPath)) {
    throw new Error("Il voice engine ha terminato senza produrre il file audio richiesto.");
  }
  return {
    path: generatedPath,
    mimeType: result.data?.mimeType || "audio/wav",
    engine: result.data?.engine || capabilities.primaryEngine,
    metadata: result.data || {},
  };
}
