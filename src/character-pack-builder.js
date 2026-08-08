import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CHARACTER_REFERENCE_TYPES = new Set([
  "hero",
  "face",
  "bust",
  "full_body",
  "profile",
  "sheet",
  "generic",
]);

const MIME_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

export function safeReferenceType(value, fallback = "generic") {
  const type = String(value || "").trim().toLowerCase().replaceAll("-", "_");
  return CHARACTER_REFERENCE_TYPES.has(type) ? type : fallback;
}

export function imageExtension(mimeType) {
  const extension = MIME_EXTENSIONS.get(String(mimeType || "").toLowerCase());
  if (!extension) throw new Error("Formato immagine non supportato per Character Library.");
  return extension;
}

export function buildReferenceMetadata(file, raw = {}) {
  const now = new Date().toISOString();
  const type = safeReferenceType(raw.type || raw.referenceType || raw.kind);
  const id = crypto.randomUUID();
  const extension = imageExtension(file.mimetype);
  const originalName = path.basename(String(file.originalname || `reference${extension}`));
  return {
    id,
    type,
    role: type,
    originalName,
    filename: `${id}${extension}`,
    mimeType: file.mimetype,
    size: file.size,
    status: String(raw.status || "approved"),
    tags: String(raw.tags || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    createdAt: now,
    updatedAt: now,
    preprocessing: {
      orientation: "preserved",
      normalizedFormat: extension.slice(1),
      thumbnail: null,
      workflowImage: null,
      classification: type,
      capabilities: {
        exifOrientation: "fallback",
        resize: "fallback",
        faceDetection: "not configured",
        segmentation: "not configured",
        identityEmbedding: "not configured",
      },
      warnings: [
        "Preprocessing MVP: immagine copiata senza correzione EXIF o crop AI; i derivative avanzati sono not configured.",
      ],
    },
  };
}

export function writeReferenceFiles({ characterDirectory, reference, file }) {
  const typeDirectory = {
    hero: "hero",
    face: "face",
    bust: "refs",
    full_body: "body",
    profile: "refs",
    sheet: "sheet",
    generic: "refs",
  }[reference.type] || "refs";
  const targetDirectory = path.join(characterDirectory, typeDirectory);
  const derivedDirectory = path.join(characterDirectory, "derived");
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.mkdirSync(derivedDirectory, { recursive: true });

  const relativePath = `${typeDirectory}/${reference.filename}`;
  const targetPath = path.join(characterDirectory, relativePath);
  fs.writeFileSync(targetPath, file.buffer);

  const workflowFilename = `${reference.id}-workflow${path.extname(reference.filename)}`;
  const workflowRelative = `derived/${workflowFilename}`;
  fs.copyFileSync(targetPath, path.join(characterDirectory, workflowRelative));

  return {
    ...reference,
    path: relativePath.replaceAll("\\", "/"),
    url: null,
    preprocessing: {
      ...reference.preprocessing,
      workflowImage: workflowRelative.replaceAll("\\", "/"),
    },
  };
}

export function buildCharacterPack(character) {
  const references = Array.isArray(character.references) ? character.references : [];
  const approved = references.filter((item) => item.status !== "rejected");
  const byType = (type) => approved.filter((item) => item.type === type);
  const hero = character.heroImage
    || byType("hero")[0]?.id
    || approved[0]?.id
    || null;
  const faceRefs = byType("face");
  const bodyRefs = [
    ...byType("full_body"),
    ...byType("bust"),
  ];
  const sheet = character.sheet || byType("sheet")[0]?.id || null;
  const readiness = approved.length >= 3 && hero
    ? "Ready"
    : approved.length > 0
      ? "Incomplete"
      : "Needs references";
  return {
    characterId: character.id,
    builtAt: new Date().toISOString(),
    status: readiness,
    heroImage: hero,
    sheet,
    references: approved.map((item) => item.id),
    faceRefs: faceRefs.map((item) => item.id),
    bodyRefs: bodyRefs.map((item) => item.id),
    workflowRefs: approved
      .map((item) => item.preprocessing?.workflowImage || item.path)
      .filter(Boolean),
    identityEvaluation: character.identityEvaluation || {
      enabled: false,
      engine: null,
      referenceEmbedding: null,
      threshold: null,
    },
    capabilities: {
      promptIdentity: "working",
      imageReferenceConditioning: approved.length ? "fallback" : "not configured",
      anchorFrame: "not configured",
      identityCheck: "not configured",
      characterSheetGeneration: "not configured",
    },
    warnings: readiness === "Ready"
      ? []
      : ["Aggiungi una hero image e piu' reference approvate per rendere il Character Pack piu' stabile."],
  };
}
