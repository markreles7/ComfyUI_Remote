import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { readImageDimensions } from "../src/media-files.js";

dotenv.config();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = process.env.OUTPUT_DIRECTORY || "";
if (!outputDirectory || !fs.existsSync(outputDirectory)) {
  throw new Error("OUTPUT_DIRECTORY non configurata o non accessibile.");
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const files = [];
const stack = [path.resolve(outputDirectory)];
while (stack.length) {
  const directory = stack.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) stack.push(fullPath);
    else if (imageExtensions.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }
}

const invalid = [];
const unreadable = [];
for (const file of files) {
  const dimensions = readImageDimensions(file);
  if (!dimensions) {
    unreadable.push(path.relative(outputDirectory, file));
    continue;
  }
  if (dimensions.width < 8 || dimensions.height < 8
    || dimensions.width > 32_768 || dimensions.height > 32_768) {
    invalid.push({
      file: path.relative(outputDirectory, file),
      ...dimensions,
      modifiedAt: fs.statSync(file).mtime.toISOString(),
    });
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  outputDirectory,
  images: files.length,
  invalid,
  unreadable,
};
const reportFile = path.join(root, ".data", "media-audit.json");
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Immagini controllate: ${files.length}`);
console.log(`Dimensioni non valide: ${invalid.length}`);
console.log(`Header non leggibili: ${unreadable.length}`);
console.log(`Report: ${reportFile}`);
