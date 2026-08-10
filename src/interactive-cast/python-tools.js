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

export function interactiveCastPython({ root, toolDirectory, environment = "base" } = {}) {
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
    const text = String(stdout || "").trim();
    if (!text) {
      return { ok: false, error: stderr || "Lo script Python non ha prodotto JSON.", script };
    }
    return { ok: true, data: JSON.parse(text), stderr: String(stderr || ""), script };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      script,
    };
  }
}
