import fs from "node:fs";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function environmentDirectory(environment = "base") {
  if (environment === "voice") return ".venv-voice";
  if (environment === "lipsync") return ".venv-lipsync";
  return ".venv";
}

function comfyUiPythonCandidates(root) {
  return [
    process.env.COMFYUI_PYTHON,
    process.env.COMFYUI_PYTHON_EXE,
    process.env.COMFYUI_ROOT ? path.join(process.env.COMFYUI_ROOT, "venv", "Scripts", "python.exe") : null,
    process.env.COMFYUI_ROOT ? path.join(process.env.COMFYUI_ROOT, "python_embeded", "python.exe") : null,
    path.join(root || process.cwd(), "venv", "Scripts", "python.exe"),
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI LTX\\venv\\Scripts\\python.exe",
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI\\venv\\Scripts\\python.exe",
    "E:\\ComfyUI\\python_embeded\\python.exe",
  ].filter(Boolean).map((candidate) => path.resolve(String(candidate)));
}

export function interactiveCastPython({ root, toolDirectory, environment = "base" } = {}) {
  if (environment === "comfyui") {
    return comfyUiPythonCandidates(root).find((candidate) => fs.existsSync(candidate)) || "python";
  }
  if (environment === "scene") {
    const configured = String(process.env.SCENE_ANALYSIS_PYTHON || "").trim();
    if (configured && fs.existsSync(configured)) return configured;
  }
  const directory = toolDirectory || path.join(root || process.cwd(), ".tools", "interactive-cast");
  const venvPython = process.platform === "win32"
    ? path.join(directory, environmentDirectory(environment), "Scripts", "python.exe")
    : path.join(directory, environmentDirectory(environment), "bin", "python");
  return fs.existsSync(venvPython) ? venvPython : "python";
}

export function interactiveCastScript({ root, scriptName, toolDirectory } = {}) {
  const directory = toolDirectory || path.join(root || process.cwd(), ".tools", "interactive-cast");
  return path.join(directory, "scripts", scriptName);
}

function outputExcerpt(value, limit = 320) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > limit ? `${text.slice(-limit)}...` : text;
}

export function parsePythonJsonOutput(stdout) {
  const text = String(stdout || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Lo script Python non ha prodotto JSON.");

  try {
    return JSON.parse(text);
  } catch {
    // Native Python dependencies can write diagnostics to stdout before the
    // script's final JSON payload. Prefer the last complete JSON line.
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep looking backwards for the script payload.
    }
  }

  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (text[index] !== "{" && text[index] !== "[") continue;
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // A later opening brace can belong to a log line; continue backwards.
    }
  }

  throw new Error(`Output Python privo di JSON valido. Ultimo output: ${outputExcerpt(text)}`);
}

export async function runPythonJson({
  root,
  scriptName,
  args = [],
  timeout = 300_000,
  toolDirectory,
  environment = "base",
}) {
  const script = interactiveCastScript({ root, scriptName, toolDirectory });
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      error: `Script Interactive Cast non trovato: ${scriptName}`,
      script,
    };
  }
  const directory = toolDirectory || path.join(root || process.cwd(), ".tools", "interactive-cast");
  const python = interactiveCastPython({ root, toolDirectory, environment });
  try {
    const { stdout, stderr } = await execFile(python, [script, ...args.map(String)], {
      timeout,
      windowsHide: true,
      env: {
        ...process.env,
        INTERACTIVE_CAST_TOOL_DIR: directory,
        HF_HOME: process.env.HF_HOME || path.join(directory, "cache", "huggingface"),
        TORCH_HOME: process.env.TORCH_HOME || path.join(directory, "cache", "torch"),
      },
    });
    const data = parsePythonJsonOutput(stdout);
    return { ok: true, data, stderr: String(stderr || ""), script };
  } catch (error) {
    const stdout = String(error.stdout || "");
    if (stdout.trim()) {
      try {
        const data = parsePythonJsonOutput(stdout);
        return {
          ok: false,
          error: data?.error || error.message,
          data,
          stderr: String(error.stderr || ""),
          script,
        };
      } catch {
        // Fall through to a bounded diagnostic below.
      }
    }
    const diagnostic = outputExcerpt(error.stderr || stdout);
    return {
      ok: false,
      error: diagnostic ? `${error.message}. Dettaglio: ${diagnostic}` : error.message,
      script,
    };
  }
}
