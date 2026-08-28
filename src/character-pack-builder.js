import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildCharacterReadiness } from "./character-readiness.js";
import { normalizeIdentityEvaluation, normalizeManualReview } from "./identity-evaluation.js";

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
    referenceRole: String(raw.referenceRole || "").slice(0, 80) || null,
    angle: String(raw.angle || "").slice(0, 160) || null,
    pose: String(raw.pose || "").slice(0, 240) || null,
    expression: String(raw.expression || "").slice(0, 160) || null,
    sourceHero: String(raw.sourceHero || "").slice(0, 100) || null,
    subjectKind: String(raw.subjectKind || "auto").slice(0, 20),
    technicalPrompt: String(raw.technicalPrompt || raw.provenance?.technicalPrompt || "").slice(0, 8000),
    seed: Number.isSafeInteger(Number(raw.seed ?? raw.provenance?.seed))
      ? Number(raw.seed ?? raw.provenance?.seed)
      : null,
    manualReview: normalizeManualReview(raw.manualReview),
    provenance: raw.provenance && typeof raw.provenance === "object" ? {
      sourceType: String(raw.provenance.sourceType || "").slice(0, 40),
      generationId: String(raw.provenance.generationId || "").slice(0, 100) || null,
      generator: String(raw.provenance.generator || "").slice(0, 120),
      model: String(raw.provenance.model || "").slice(0, 300),
      seed: Number.isSafeInteger(Number(raw.provenance.seed)) ? Number(raw.provenance.seed) : null,
      technicalPrompt: String(raw.provenance.technicalPrompt || "").slice(0, 8000),
    } : null,
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
  const readiness = buildCharacterReadiness({ ...character, references });
  return {
    characterId: character.id,
    subjectKind: character.subjectKind || character.characterBlueprint?.subjectKind || "auto",
    characterBlueprint: character.characterBlueprint || null,
    genesis: character.genesis || null,
    referencePlan: character.referencePlan || null,
    builtAt: new Date().toISOString(),
    status: readiness.status,
    readiness,
    heroImage: hero,
    sheet,
    references: approved.map((item) => item.id),
    faceRefs: faceRefs.map((item) => item.id),
    bodyRefs: bodyRefs.map((item) => item.id),
    workflowRefs: approved
      .map((item) => item.preprocessing?.workflowImage || item.path)
      .filter(Boolean),
    referenceViews: approved.map((item) => ({
      referenceId: item.id,
      referenceRole: item.referenceRole || null,
      type: item.type,
      angle: item.angle || null,
      pose: item.pose || null,
      expression: item.expression || null,
      subjectKind: item.subjectKind || character.subjectKind || "auto",
      sourceHero: item.sourceHero || null,
    })),
    identityEvaluation: normalizeIdentityEvaluation(character.identityEvaluation || {}),
    capabilities: {
      promptIdentity: "working",
      imageReferenceConditioning: approved.length ? "fallback" : "not configured",
      anchorFrame: "not configured",
      identityCheck: character.identityEvaluation?.engine ? "provider" : "manual review",
      characterSheetGeneration: "not configured",
    },
    warnings: readiness.status === "Ready"
      ? []
      : [readiness.status === "Needs Hero"
          ? "Aggiungi una Hero identitaria."
          : readiness.status === "Incomplete"
            ? "Completa la copertura minima dell'Adaptive Reference Plan."
            : readiness.status === "Identity Warning"
              ? "Una o più reference richiedono una decisione sull'identità."
              : "Completa la revisione manuale delle reference non valutate automaticamente."],
  };
}
