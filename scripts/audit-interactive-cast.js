import path from "node:path";
import { fileURLToPath } from "node:url";
import { interactiveCastCapabilities } from "../src/interactive-cast/capabilities.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = await interactiveCastCapabilities({ root });
console.log(JSON.stringify({
  report: report.paths.reportPath,
  toolDirectory: report.paths.toolDirectory,
  gpu: report.hardware.gpu,
  disk: report.hardware.disk,
  comfyPython: report.runtimes.comfyPython,
  matrix: report.matrix,
}, null, 2));
