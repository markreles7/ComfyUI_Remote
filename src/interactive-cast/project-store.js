import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HistoryStore } from "../history-store.js";

function safeName(value) {
  return String(value || "upload").replace(/[^\w.\- ]+/g, "_").slice(0, 160);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export class InteractiveCastProjectStore extends HistoryStore {
  constructor({ file, assetDirectory }) {
    super(file);
    this.assetDirectory = assetDirectory;
    fs.mkdirSync(assetDirectory, { recursive: true });
  }

  projectAssetDirectory(projectId) {
    const directory = path.resolve(this.assetDirectory, String(projectId));
    const base = path.resolve(this.assetDirectory);
    if (!directory.startsWith(`${base}${path.sep}`)) throw new Error("Interactive Cast asset path non valido.");
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }

  writeUpload(projectId, file, role = "sourceVideo") {
    if (!file?.buffer) throw new Error("File Interactive Cast mancante.");
    const extension = path.extname(file.originalname || "") || ".bin";
    const filename = `${role}-${crypto.randomUUID()}-${safeName(file.originalname || `upload${extension}`)}`;
    const target = path.join(this.projectAssetDirectory(projectId), filename);
    fs.writeFileSync(target, file.buffer);
    return {
      role,
      path: target,
      filename,
      originalName: file.originalname || filename,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size || file.buffer.length,
      sha256: sha256(file.buffer),
    };
  }

  writeSegmentReplacement(projectId, segmentId, file) {
    if (!file?.buffer) throw new Error("Segmento Interactive Cast mancante.");
    const directory = path.join(this.projectAssetDirectory(projectId), "replacements");
    fs.mkdirSync(directory, { recursive: true });
    const extension = path.extname(file.originalname || "") || ".mp4";
    const filename = `${safeName(segmentId)}-${crypto.randomUUID()}-${safeName(file.originalname || `replacement${extension}`)}`;
    const target = path.join(directory, filename);
    fs.writeFileSync(target, file.buffer);
    return {
      path: target,
      filename,
      relativePath: `replacements/${filename}`,
      originalName: file.originalname || filename,
      mimeType: file.mimetype || "video/mp4",
      size: file.size || file.buffer.length,
      sha256: sha256(file.buffer),
    };
  }

  writeGeneratedSegmentReplacement(projectId, segmentId, generated) {
    if (!generated?.path || !fs.existsSync(generated.path)) {
      throw new Error("Segmento generato Interactive Cast mancante.");
    }
    const directory = path.join(this.projectAssetDirectory(projectId), "replacements");
    fs.mkdirSync(directory, { recursive: true });
    const extension = path.extname(generated.path) || ".mp4";
    const label = safeName(generated.engine || "generated");
    const filename = `${safeName(segmentId)}-${crypto.randomUUID()}-${label}${extension}`;
    const target = path.join(directory, filename);
    fs.copyFileSync(generated.path, target);
    const buffer = fs.readFileSync(target);
    return {
      path: target,
      filename,
      relativePath: `replacements/${filename}`,
      originalName: generated.originalName || filename,
      mimeType: generated.mimeType || "video/mp4",
      size: buffer.length,
      sha256: sha256(buffer),
      engine: generated.engine || "unknown",
      generatedAt: new Date().toISOString(),
    };
  }

  writeDialogueAudio(projectId, eventId, file) {
    if (!file?.buffer) throw new Error("Audio dialogo Interactive Cast mancante.");
    const directory = path.join(this.projectAssetDirectory(projectId), "dialogue-audio");
    fs.mkdirSync(directory, { recursive: true });
    const extension = path.extname(file.originalname || "") || ".wav";
    const filename = `${safeName(eventId)}-${crypto.randomUUID()}-${safeName(file.originalname || `dialogue${extension}`)}`;
    const target = path.join(directory, filename);
    fs.writeFileSync(target, file.buffer);
    return {
      path: target,
      filename,
      relativePath: `dialogue-audio/${filename}`,
      originalName: file.originalname || filename,
      mimeType: file.mimetype || "audio/wav",
      size: file.size || file.buffer.length,
      sha256: sha256(file.buffer),
    };
  }

  writeGeneratedDialogueAudio(projectId, eventId, generated) {
    if (!generated?.path || !fs.existsSync(generated.path)) {
      throw new Error("Audio sintetizzato Interactive Cast mancante.");
    }
    const directory = path.join(this.projectAssetDirectory(projectId), "dialogue-audio");
    fs.mkdirSync(directory, { recursive: true });
    const extension = path.extname(generated.path) || ".wav";
    const filename = `${safeName(eventId)}-${crypto.randomUUID()}-synthesized${extension}`;
    const target = path.join(directory, filename);
    fs.copyFileSync(generated.path, target);
    const buffer = fs.readFileSync(target);
    return {
      path: target,
      filename,
      relativePath: `dialogue-audio/${filename}`,
      originalName: generated.originalName || filename,
      mimeType: generated.mimeType || "audio/wav",
      size: buffer.length,
      sha256: sha256(buffer),
      engine: generated.engine || "unknown",
      generatedAt: new Date().toISOString(),
    };
  }

  writeTemporaryActorReference(projectId, file) {
    if (!file?.buffer) throw new Error("Reference temporanea Interactive Cast mancante.");
    const directory = path.join(this.projectAssetDirectory(projectId), "temporary-actor-reference");
    fs.mkdirSync(directory, { recursive: true });
    const extension = path.extname(file.originalname || "") || ".png";
    const filename = `new-actor-${crypto.randomUUID()}-${safeName(file.originalname || `reference${extension}`)}`;
    const target = path.join(directory, filename);
    fs.writeFileSync(target, file.buffer);
    return {
      path: target,
      filename,
      relativePath: `temporary-actor-reference/${filename}`,
      originalName: file.originalname || filename,
      mimeType: file.mimetype || "image/png",
      size: file.size || file.buffer.length,
      sha256: sha256(file.buffer),
    };
  }

  assetPath(projectId, relativePath) {
    let directory;
    try {
      directory = this.projectAssetDirectory(projectId);
    } catch {
      return null;
    }
    const target = path.resolve(directory, String(relativePath || ""));
    if (!target.startsWith(`${directory}${path.sep}`) || !fs.existsSync(target)) return null;
    return target;
  }
}
