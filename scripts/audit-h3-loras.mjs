import fs from "node:fs";
import path from "node:path";
import { loraTriggerMetadata } from "../src/lora-trigger-catalog.js";
import { H3_SFW_PRESETS } from "../public/h3-sfw-presets.js";
import { PLAGUEKIND_LORA_PRESETS, findPlaguekindPresetLora } from "../public/plaguekind-lora-presets.js";
import { H3_LEGACY_PRESET_FILES, resolveH3LoraFile } from "../public/h3-lora-files.js";

// Read-only model inspection; optionally write a JSON report to the second argument.
const directory = path.resolve(process.argv[2] || "E:/ComfyUI/Data/Models/Lora/H3");
const files = fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".safetensors"))
  .map((entry) => `H3/${entry.name}`).sort();
const metadata = loraTriggerMetadata(files);
const presets = [
  ...Object.entries(H3_SFW_PRESETS).map(([id, preset]) => ({ id, files: [resolveH3LoraFile(files, preset.file)] })),
  ...Object.entries(PLAGUEKIND_LORA_PRESETS).map(([id, preset]) => ({ id,
    files: [{ type: preset.lora }, ...(preset.extraLoras || [])].map(({ type }) => findPlaguekindPresetLora(type, files)),
  })),
  ...Object.entries(H3_LEGACY_PRESET_FILES).map(([id, file]) => ({ id, files: [resolveH3LoraFile(files, file)] })),
];
const report = {
  directory, checkedAt: new Date().toISOString(), fileCount: files.length,
  cataloguedCount: Object.keys(metadata).length,
  prefixAliasesRecovered: files.filter((name) => metadata[name]?.matchedBy === "category-prefix"),
  filesWithoutVerifiedCatalogMetadata: files.filter((name) => !metadata[name]),
  missingPresetFiles: presets.filter((preset) => preset.files.some((file) => !file)).map((preset) => preset.id),
  presets,
};
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[3]) fs.writeFileSync(path.resolve(process.argv[3]), json);
console.log(process.argv[3] ? JSON.stringify({ fileCount: report.fileCount, cataloguedCount: report.cataloguedCount,
  prefixAliasesRecovered: report.prefixAliasesRecovered, missingPresetFiles: report.missingPresetFiles,
  reportPath: path.resolve(process.argv[3]) }, null, 2) : json);
