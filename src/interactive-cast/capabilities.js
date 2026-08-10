import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { commandVersion } from "./ffmpeg.js";
import { interactiveCastPython, interactiveCastScript } from "./python-tools.js";
import { lipsyncCapabilities } from "./lipsync-engine.js";
import { voiceEngineCapabilities } from "./voice-engine.js";

const execFile = promisify(execFileCallback);

async function execText(command, args, timeout = 15_000) {
  try {
    const { stdout } = await execFile(command, args, { timeout, windowsHide: true });
    return { ok: true, text: String(stdout || "").trim() };
  } catch (error) {
    if (process.platform === "win32" && !/\.(?:cmd|exe)$/i.test(command)) {
      try {
        const { stdout } = await execFile(`${command}.cmd`, args, { timeout, windowsHide: true });
        return { ok: true, text: String(stdout || "").trim() };
      } catch {
        try {
          const { stdout } = await execFile("cmd.exe", ["/d", "/s", "/c", command, ...args], {
            timeout,
            windowsHide: true,
          });
          return { ok: true, text: String(stdout || "").trim() };
        } catch {
          // Return the original error because it names the requested tool.
        }
      }
    }
    return { ok: false, text: "", error: error.message };
  }
}

async function gpuInfo() {
  const result = await execText("nvidia-smi", [
    "--query-gpu=name,memory.total,driver_version",
    "--format=csv,noheader",
  ]);
  if (!result.ok) return { available: false, error: result.error };
  const [name = "", memory = "", driver = ""] = result.text.split(",").map((item) => item.trim());
  return {
    available: true,
    name,
    vramMb: Number(String(memory).replace(/[^\d.]/g, "")) || null,
    driver,
  };
}

async function runtimeVersion(command, args = ["--version"]) {
  const result = await execText(command, args);
  return result.ok
    ? { available: true, version: result.text.split(/\r?\n/)[0] }
    : { available: false, error: result.error };
}

async function diskInfo(directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
    const stats = await fs.promises.statfs(directory);
    const freeGb = Math.round((Number(stats.bavail || 0) * Number(stats.bsize || 0)) / 1024 ** 3);
    const totalGb = Math.round((Number(stats.blocks || 0) * Number(stats.bsize || 0)) / 1024 ** 3);
    return { available: true, path: directory, freeGb, totalGb };
  } catch (error) {
    return { available: false, path: directory, error: error.message };
  }
}

function comfyPythonCandidates(root) {
  const candidates = [
    process.env.COMFYUI_PYTHON,
    process.env.COMFYUI_PYTHON_EXE,
    process.env.COMFYUI_ROOT ? path.join(process.env.COMFYUI_ROOT, "venv", "Scripts", "python.exe") : null,
    process.env.COMFYUI_ROOT ? path.join(process.env.COMFYUI_ROOT, "python_embeded", "python.exe") : null,
    path.join(root || process.cwd(), "venv", "Scripts", "python.exe"),
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI LTX\\venv\\Scripts\\python.exe",
    "E:\\ComfyUI\\Data\\Packages\\ComfyUI\\venv\\Scripts\\python.exe",
    "E:\\ComfyUI\\python_embeded\\python.exe",
  ].filter(Boolean);
  return [...new Set(candidates.map((item) => path.resolve(String(item))))];
}

async function comfyPythonInfo(root) {
  const python = comfyPythonCandidates(root).find((candidate) => fs.existsSync(candidate));
  if (!python) {
    return {
      available: false,
      status: "NOT CONFIGURED",
      checked: comfyPythonCandidates(root),
      reason: "Python ComfyUI non trovato nei path noti o nelle variabili COMFYUI_PYTHON/COMFYUI_ROOT.",
    };
  }
  const version = await execText(python, ["--version"]);
  const torch = await execText(python, [
    "-c",
    "import json; import torch; print(json.dumps({'torch': torch.__version__, 'cudaAvailable': torch.cuda.is_available(), 'cudaVersion': torch.version.cuda, 'deviceCount': torch.cuda.device_count()}))",
  ], 30_000);
  let torchInfo = { available: false, status: "NOT CONFIGURED" };
  if (torch.ok) {
    try {
      torchInfo = { available: true, status: "READY", ...JSON.parse(torch.text) };
    } catch (error) {
      torchInfo = { available: false, status: "FALLBACK", error: `Torch probe JSON non valido: ${error.message}` };
    }
  } else {
    torchInfo = { available: false, status: "NOT CONFIGURED", error: torch.error };
  }
  return {
    available: true,
    status: "READY",
    python,
    version: version.ok ? version.text.split(/\r?\n/)[0] : null,
    torch: torchInfo,
  };
}

async function opencvCapability({ root, toolDirectory } = {}) {
  const script = interactiveCastScript({ root, toolDirectory, scriptName: "track.py" });
  const python = interactiveCastPython({ root, toolDirectory });
  if (!fs.existsSync(script)) {
    return { ready: false, status: "NOT CONFIGURED", script, reason: "track.py mancante" };
  }
  const result = await execText(python, ["-c", "import cv2; print(cv2.__version__)"], 20_000);
  if (!result.ok) {
    return { ready: false, status: "FALLBACK", script, python, reason: result.error };
  }
  return { ready: true, status: "READY", script, python, version: result.text };
}

async function isolatedRuntimeProbe({ root, toolDirectory, environment, imports }) {
  const python = interactiveCastPython({ root, toolDirectory, environment });
  if (!fs.existsSync(python)) {
    return { ready: false, status: "NOT CONFIGURED", python, reason: "Isolated Python environment missing." };
  }
  const statements = [
    ...imports.map((name) => `import ${name}`),
    "import json, torch",
    "print(json.dumps({'torch': torch.__version__, 'cuda': torch.cuda.is_available(), 'cudaVersion': torch.version.cuda}))",
  ];
  const result = await execText(python, ["-c", statements.join("; ")], 60_000);
  if (!result.ok) return { ready: false, status: "FALLBACK", python, reason: result.error };
  try {
    return { ready: true, status: "READY", python, ...JSON.parse(result.text) };
  } catch (error) {
    return { ready: false, status: "FALLBACK", python, reason: `Runtime probe JSON invalid: ${error.message}` };
  }
}

export async function interactiveCastCapabilities({ root, toolDirectory } = {}) {
  const directory = toolDirectory || path.join(root || process.cwd(), ".tools", "interactive-cast");
  const modelsDirectory = path.join(directory, "models");
  const manifestPath = path.join(directory, "models-manifest.json");
  let manifest = { models: [] };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = { models: [] };
  }
  const reportPath = path.join(directory, "interactive-cast-capabilities.json");
  const [
    gpu,
    node,
    npm,
    python,
    ffmpeg,
    ffprobe,
    opencvTracking,
    comfyPython,
    disk,
    voiceRuntime,
    lipSyncRuntime,
  ] = await Promise.all([
    gpuInfo(),
    runtimeVersion("node"),
    runtimeVersion("npm", ["--version"]),
    runtimeVersion("python"),
    commandVersion("ffmpeg"),
    commandVersion("ffprobe"),
    opencvCapability({ root, toolDirectory: directory }),
    comfyPythonInfo(root),
    diskInfo(directory),
    isolatedRuntimeProbe({
      root,
      toolDirectory: directory,
      environment: "voice",
      imports: ["chatterbox"],
    }),
    isolatedRuntimeProbe({
      root,
      toolDirectory: directory,
      environment: "lipsync",
      imports: ["mmcv._ext", "mmpose"],
    }),
  ]);
  const voiceEngine = voiceEngineCapabilities({ root, toolDirectory: directory });
  const lipSyncEngine = lipsyncCapabilities({ root, toolDirectory: directory });
  const voiceReady = voiceEngine.synthesizeDialogue && voiceRuntime.ready;
  const lipSyncReady = lipSyncEngine.applyLipSync && lipSyncRuntime.ready;
  const report = {
    generatedAt: new Date().toISOString(),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuCount: os.cpus()?.length || null,
      totalRamGb: Math.round(os.totalmem() / 1024 ** 3),
    },
    hardware: { gpu, disk },
    runtimes: { node, npm, python, ffmpeg, ffprobe, comfyPython },
    paths: {
      toolDirectory: directory,
      modelsDirectory,
      manifestPath,
      reportPath,
    },
    tools: {
      opencvTracking,
      voiceEngine: { ...voiceEngine, runtime: voiceRuntime },
      lipSyncEngine: { ...lipSyncEngine, runtime: lipSyncRuntime },
    },
    matrix: {
      videoAnalysis: ffprobe.available,
      actorTracking: opencvTracking.ready,
      audioSeparation: false,
      diarization: false,
      voiceClone: voiceReady,
      lipSync: lipSyncReady,
      characterInsertion: true,
      identityCheck: ffmpeg.available,
      maskedCompositing: ffmpeg.available,
      temporalSplice: ffmpeg.available,
      finalEncode: ffmpeg.available,
    },
    statuses: {
      videoAnalysis: ffprobe.available ? "READY" : "NOT CONFIGURED",
      personTracking: opencvTracking.status,
      sceneSegmentation: "FALLBACK",
      audioExtraction: ffmpeg.available ? "READY" : "NOT CONFIGURED",
      sourceSeparation: ffmpeg.available ? "FALLBACK" : "NOT CONFIGURED",
      speakerDiarization: "FALLBACK",
      voiceCloning: voiceReady ? "READY" : voiceEngine.status === "READY" ? "FALLBACK" : voiceEngine.status,
      lipSync: lipSyncReady ? "READY" : lipSyncEngine.applyLipSync ? "FALLBACK" : "FALLBACK TASK / NOT CONFIGURED ENGINE",
      anchorFrame: "READY VIA QWEN / OPTIONAL REFINER",
      identityCheck: ffmpeg.available ? "FALLBACK" : "NOT CONFIGURED",
      ltxSegmentGeneration: "READY VIA AUTOMATIC COMFYUI CHAIN",
      comfyPython: comfyPython.status,
      comfyTorchCuda: comfyPython.torch?.cudaAvailable ? "READY" : comfyPython.torch?.status || "NOT CONFIGURED",
      compositing: ffmpeg.available ? "READY" : "NOT CONFIGURED",
      maskedCompositing: ffmpeg.available ? "READY" : "NOT CONFIGURED",
      audioRemix: ffmpeg.available ? "READY" : "NOT CONFIGURED",
    },
    models: manifest.models || [],
    notes: [
      "FFmpeg/FFprobe provide the deterministic fallback path for analysis, minimal-window splice, compositing and final encode.",
      voiceReady
        ? `Voice cloning is configured with ${voiceEngine.primaryEngine} on ${voiceEngine.device || "the isolated runtime"}.`
        : "Voice cloning remains NOT CONFIGURED; dialogue audio can still be uploaded manually.",
      lipSyncReady
        ? `Neural lip-sync is configured with ${lipSyncEngine.primaryEngine}.`
        : "Lip-sync task preparation remains available, but the neural engine is NOT CONFIGURED.",
      "No ComfyUI Python packages are modified by this capability probe.",
      "Neural source separation and neural speaker diarization remain unavailable; editable FFmpeg/manual fallbacks are exposed instead of false READY states.",
    ],
  };
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
