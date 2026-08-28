import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const loraRoot = process.env.LORA_AUDIT_ROOT || "E:\\ComfyUI\\Data\\Models\\Lora";
const requestedFamilies = new Set(
  String(process.env.LORA_AUDIT_FAMILIES || "FLUX,FLUX2,QWEN,LTX2.3,H3,Z-IMAGE")
    .split(",")
    .map((value) => value.trim().toLocaleUpperCase())
    .filter(Boolean),
);
const concurrency = Math.max(1, Math.min(6, Number(process.env.LORA_AUDIT_CONCURRENCY || 3)));
const outputMode = String(process.env.LORA_AUDIT_OUTPUT || "full").toLocaleLowerCase();

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function sha256(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filename);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function safetensorsMetadata(filename) {
  const descriptor = fs.openSync(filename, "r");
  try {
    const size = Buffer.alloc(8);
    fs.readSync(descriptor, size, 0, 8, 0);
    const headerLength = Number(size.readBigUInt64LE());
    if (!Number.isSafeInteger(headerLength) || headerLength <= 0 || headerLength > 64 * 1024 * 1024) return {};
    const header = Buffer.alloc(headerLength);
    fs.readSync(descriptor, header, 0, headerLength, 8);
    return JSON.parse(header.toString("utf8")).__metadata__ || {};
  } catch {
    return {};
  } finally {
    fs.closeSync(descriptor);
  }
}

async function civitaiVersion(hash) {
  for (const domain of ["civitai.com", "civitai.red"]) {
    const response = await fetch(`https://${domain}/api/v1/model-versions/by-hash/${hash}`, {
      headers: { "user-agent": "LTX-Remote-Studio/1.0" },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (!response || response.status === 404) continue;
    if (!response.ok) throw new Error(`${domain}: HTTP ${response.status}`);
    const payload = await response.json();
    return {
      domain,
      versionId: payload.id,
      modelId: payload.modelId,
      modelName: payload.model?.name || null,
      versionName: payload.name || null,
      baseModel: payload.baseModel || null,
      trainedWords: Array.isArray(payload.trainedWords) ? payload.trainedWords.filter(Boolean) : [],
      url: payload.modelId ? `https://${domain}/models/${payload.modelId}?modelVersionId=${payload.id}` : null,
    };
  }
  return null;
}

const files = walk(loraRoot)
  .filter((filename) => filename.toLocaleLowerCase().endsWith(".safetensors"))
  .map((filename) => ({
    filename,
    relativeName: path.relative(loraRoot, filename).replaceAll("/", "\\"),
  }))
  .filter(({ relativeName }) => requestedFamilies.has(relativeName.split("\\")[0].toLocaleUpperCase()));

let cursor = 0;
const results = [];

async function worker() {
  while (cursor < files.length) {
    const index = cursor++;
    const item = files[index];
    const metadata = safetensorsMetadata(item.filename);
    try {
      const hash = await sha256(item.filename);
      const civitai = await civitaiVersion(hash);
      results[index] = {
        localName: item.relativeName,
        size: fs.statSync(item.filename).size,
        sha256: hash,
        civitai,
        embeddedTrigger: metadata["modelspec.trigger_word"] || metadata.trigger_word || null,
      };
      process.stderr.write(`[${index + 1}/${files.length}] ${item.relativeName} · ${civitai ? "Civitai" : "non risolta"}\n`);
    } catch (error) {
      results[index] = { localName: item.relativeName, error: error.message };
      process.stderr.write(`[${index + 1}/${files.length}] ${item.relativeName} · ERRORE ${error.message}\n`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const resolved = results.filter((item) => item?.civitai);
const withTriggers = resolved.filter((item) => item.civitai.trainedWords.length);
const outputRecords = outputMode === "triggers"
  ? withTriggers.map((item) => ({
    localName: item.localName,
    sha256: item.sha256,
    modelId: item.civitai.modelId,
    versionId: item.civitai.versionId,
    modelName: item.civitai.modelName,
    versionName: item.civitai.versionName,
    baseModel: item.civitai.baseModel,
    trainedWords: item.civitai.trainedWords,
    url: item.civitai.url,
  }))
  : results;
if (outputMode === "lines") {
  console.log(`TOTALS\t${results.length}\t${resolved.length}\t${withTriggers.length}\t${results.length - resolved.length}`);
  for (const item of withTriggers) {
    const words = item.civitai.trainedWords.map((word) => {
      const normalized = String(word).replace(/\s+/g, " ").trim();
      return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized;
    });
    console.log([
      item.localName,
      item.civitai.modelId,
      item.civitai.versionId,
      item.civitai.modelName,
      words.join(" || "),
    ].join("\t"));
  }
  process.exit(0);
}
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  root: loraRoot,
  totals: {
    files: results.length,
    resolved: resolved.length,
    withTriggers: withTriggers.length,
    unresolved: results.length - resolved.length,
    errors: results.filter((item) => item?.error).length,
  },
  records: outputRecords,
}, null, 2));
