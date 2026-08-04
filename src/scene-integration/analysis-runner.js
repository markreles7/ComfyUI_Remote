import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function existing(paths) {
  return paths.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

export function resolveAnalysisPython(root, configured = process.env.SCENE_ANALYSIS_PYTHON) {
  return existing([
    configured,
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI LTX\\venv\\Scripts\\python.exe",
    path.join(root, ".venv", "Scripts", "python.exe"),
  ]) || configured || (process.platform === "win32" ? "python" : "python3");
}

function run(command, args, { timeoutMs = 15 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Analisi della scena scaduta."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Analisi scena non riuscita (${code}): ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export async function analyzeSceneFile({
  root,
  sourceFile,
  mediaType,
  settings,
  artifactDirectory,
  python = resolveAnalysisPython(root),
}) {
  const outputFile = path.join(
    os.tmpdir(),
    `comfy-remote-scene-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const script = path.join(root, "scene-integration", "python", "analyze_scene.py");
  const args = [
    script,
    "--input", sourceFile,
    "--output", outputFile,
    "--media-type", mediaType,
    "--scale", String(settings.analysisScale),
    "--max-video-frames", String(settings.maxVideoFrames),
  ];
  if (artifactDirectory) args.push("--artifacts", artifactDirectory);
  try {
    await run(python, args);
    return JSON.parse(fs.readFileSync(outputFile, "utf8"));
  } finally {
    try {
      fs.unlinkSync(outputFile);
    } catch {
      // Il file temporaneo può non essere stato creato in caso di errore precoce.
    }
  }
}

export async function verifyAnalysisRuntime(root, configuredPython) {
  const python = resolveAnalysisPython(root, configuredPython);
  try {
    await run(python, [
      "-c",
      "import cv2,numpy,scipy,skimage,PIL; print(cv2.__version__)",
    ], { timeoutMs: 30_000 });
    return { available: true, python, reason: null };
  } catch (error) {
    return { available: false, python, reason: error.message };
  }
}

export async function compareSceneImages({
  root,
  sourceFile,
  resultFile,
  maskFile,
  artifactDirectory,
  python = resolveAnalysisPython(root),
}) {
  const outputFile = path.join(
    os.tmpdir(),
    `comfy-remote-compare-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const script = path.join(root, "scene-integration", "python", "compare_scene.py");
  const args = [
    script,
    "--source", sourceFile,
    "--result", resultFile,
    "--output", outputFile,
  ];
  if (maskFile) args.push("--mask", maskFile);
  if (artifactDirectory) args.push("--artifacts", artifactDirectory);
  try {
    await run(python, args);
    return JSON.parse(fs.readFileSync(outputFile, "utf8"));
  } finally {
    try {
      fs.unlinkSync(outputFile);
    } catch {
      // Best effort.
    }
  }
}
