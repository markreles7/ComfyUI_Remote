import fs from "node:fs";
import path from "node:path";

const MIME_TYPES = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function existingFile(candidate) {
  try {
    const stats = fs.statSync(candidate);
    return stats.isFile() ? { path: candidate, stats } : null;
  } catch {
    return null;
  }
}

export function resolveMediaFile(outputDirectory, file) {
  if (!outputDirectory || !file?.filename) return null;

  const base = path.resolve(outputDirectory);
  const parent = path.dirname(base);
  const rawFilename = String(file.filename).replaceAll("/", path.sep);
  const filename = path.basename(rawFilename);
  const filenameSubfolder = path.dirname(rawFilename) === "." ? "" : path.dirname(rawFilename);
  const rawSubfolder = String(file.subfolder || filenameSubfolder).replaceAll("/", path.sep);
  const safeSubfolder = rawSubfolder
    .split(path.sep)
    .filter((part) => part && part !== "." && part !== "..")
    .join(path.sep);

  // Supporta sia ...\output sia la configurazione storica ...\output\video.
  const candidates = [
    path.join(base, safeSubfolder, filename),
    path.join(base, filename),
    path.join(parent, safeSubfolder, filename),
  ];

  for (const candidate of [...new Set(candidates)]) {
    const match = existingFile(candidate);
    if (match) return match;
  }
  return null;
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
    };
  }
  if (chunk === "VP8 " && buffer.length >= 30
    && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

export function readImageDimensions(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "r");
    const stats = fs.fstatSync(descriptor);
    const buffer = Buffer.alloc(Math.min(stats.size, 1024 * 1024));
    fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    if (buffer.length >= 24 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    return jpegDimensions(buffer) || webpDimensions(buffer);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function inspectImageFiles(outputDirectory, files) {
  return (files || []).map((file) => {
    const match = resolveMediaFile(outputDirectory, file);
    const dimensions = match ? readImageDimensions(match.path) : null;
    return { file, path: match?.path || null, ...dimensions };
  });
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return false;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return false;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return false;
  }
  return { start, end: Math.min(end, size - 1) };
}

function disposition(filename, download) {
  const basename = path.basename(filename);
  const fallback = basename.replace(/[^\x20-\x7E]/g, "_").replaceAll('"', "");
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(basename)}`;
}

export function streamMediaFile(request, response, match, filename, download = false) {
  const size = match.stats.size;
  const range = parseRange(request.headers.range, size);
  if (range === false) {
    response.setHeader("content-range", `bytes */${size}`);
    response.status(416).end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  response.status(range ? 206 : 200);
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("content-type", MIME_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream");
  response.setHeader("content-length", String(end - start + 1));
  response.setHeader("content-disposition", disposition(filename, download));
  response.setHeader("cache-control", "private, max-age=3600");
  if (range) response.setHeader("content-range", `bytes ${start}-${end}/${size}`);

  const stream = fs.createReadStream(match.path, { start, end });
  stream.on("error", (error) => {
    if (!response.headersSent) response.status(500).json({ error: error.message });
    else response.destroy(error);
  });
  response.on("close", () => stream.destroy());
  stream.pipe(response);
}

export function mediaContentDisposition(filename, download = false) {
  return disposition(filename, download);
}
