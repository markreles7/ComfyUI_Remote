import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildCharacterPack,
  buildReferenceMetadata,
  safeReferenceType,
  writeReferenceFiles,
} from "./character-pack-builder.js";
import {
  blueprintDescription,
  blueprintIdentityHints,
  normalizeCharacterBlueprint,
  normalizeGenesis,
  normalizeSubjectKind,
} from "./character-genesis.js";
import { normalizeReferencePlan } from "./character-reference-factory.js";
import { normalizeIdentityEvaluation, normalizeManualReview } from "./identity-evaluation.js";

const DEFAULT_SETTINGS = {
  identityStrength: "medium",
  lockFace: true,
  lockHair: true,
  lockBody: true,
  lockOutfit: false,
};

const EMPTY_HINTS = { hair: "", face: "", body: "" };

function normalizeVoiceProfile(raw = {}) {
  return {
    language: safeText(raw.language || "auto", 40),
    speaker: safeText(raw.speaker || "", 120),
    notes: safeText(raw.notes || "", 500),
    referenceAudio: safeText(raw.referenceAudio || "", 300),
  };
}

function preferred(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function safeId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) {
    throw new Error("Character ID non valido.");
  }
  return id;
}

function safeText(value, max = 4000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

function referenceFileAvailable(characterDirectory, reference) {
  if (!characterDirectory || !reference?.path) return false;
  const fullPath = path.resolve(characterDirectory, reference.path);
  const base = path.resolve(characterDirectory);
  return fullPath.startsWith(base + path.sep) && fs.existsSync(fullPath);
}

function publicReference(characterId, reference, characterDirectory = null) {
  const available = referenceFileAvailable(characterDirectory, reference);
  return {
    ...reference,
    manualReview: normalizeManualReview(reference.manualReview),
    assetAvailable: available,
    assetMissing: !available,
    url: available
      ? `/api/characters/${encodeURIComponent(characterId)}/assets/${encodeURIComponent(reference.id)}`
      : null,
  };
}

function publicCharacter(character, characterDirectory = null) {
  const references = (character.references || []).map((reference) =>
    publicReference(character.id, reference, characterDirectory),
  );
  const heroReference = references.find((item) => item.id === character.heroImage) || references[0] || null;
  const characterPack = buildCharacterPack(character);
  const approved = references.filter((item) => item.status !== "rejected");
  const checklist = {
    hero: approved.some((item) => item.type === "hero") || Boolean(heroReference),
    face: approved.some((item) => item.type === "face"),
    body: approved.some((item) => item.type === "full_body" || item.type === "bust"),
    sheet: approved.some((item) => item.type === "sheet"),
    assets: approved.every((item) => item.assetAvailable),
  };
  return {
    ...character,
    subjectKind: normalizeSubjectKind(character.subjectKind || character.characterBlueprint?.subjectKind),
    characterBlueprint: normalizeCharacterBlueprint(character.characterBlueprint || {}, {
      sourceDescription: character.description,
    }),
    genesis: character.genesis ? normalizeGenesis(character.genesis) : null,
    identityEvaluation: normalizeIdentityEvaluation(character.identityEvaluation || {}),
    characterPack,
    readiness: characterPack.readiness,
    referencePlan: character.referencePlan
      ? normalizeReferencePlan(character.referencePlan, {
          subjectKind: character.subjectKind === "auto"
            ? character.referencePlan.subjectKind
            : character.subjectKind || character.characterBlueprint?.subjectKind,
          workflow: character.referencePlan.workflow,
          existingPlan: character.referencePlan,
        })
      : null,
    references,
    heroUrl: heroReference?.assetAvailable ? heroReference.url : null,
    faceRefs: references.filter((item) => item.type === "face"),
    bodyRefs: references.filter((item) => item.type === "full_body" || item.type === "bust"),
    otherRefs: references.filter((item) => !["hero", "face", "full_body", "bust", "sheet"].includes(item.type)),
    packStatus: characterPack.status,
    referenceCount: references.filter((item) => item.status !== "rejected").length,
    checklist,
    assetWarnings: references
      .filter((item) => item.assetMissing)
      .map((item) => `${item.originalName || item.id}: file mancante`),
    voiceReferenceAvailable: Boolean(character.voiceProfile?.referenceAudio && characterDirectory
      && fs.existsSync(path.resolve(characterDirectory, character.voiceProfile.referenceAudio))),
  };
}

function referenceLists(references) {
  return {
    faceRefs: references.filter((item) => item.type === "face").map((item) => item.id),
    bodyRefs: references.filter((item) => item.type === "full_body" || item.type === "bust").map((item) => item.id),
    otherRefs: references.filter((item) => !["hero", "face", "full_body", "bust", "sheet"].includes(item.type)).map((item) => item.id),
  };
}

export class CharacterStore {
  constructor({ dataDirectory }) {
    this.root = path.join(dataDirectory, "characters");
    ensureDirectory(this.root);
  }

  characterDirectory(id) {
    const safe = safeId(id);
    const directory = path.resolve(this.root, safe);
    const root = path.resolve(this.root);
    if (!directory.startsWith(root + path.sep)) throw new Error("Character path non valido.");
    return directory;
  }

  metaPath(id) {
    return path.join(this.characterDirectory(id), "meta.json");
  }

  listCharacters() {
    ensureDirectory(this.root);
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        try {
          return this.getCharacter(entry.name);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getCharacter(id) {
    const file = this.metaPath(id);
    if (!fs.existsSync(file)) throw new Error("Personaggio non trovato.");
    const character = JSON.parse(fs.readFileSync(file, "utf8"));
    return publicCharacter(character, this.characterDirectory(character.id));
  }

  readRaw(id) {
    const file = this.metaPath(id);
    if (!fs.existsSync(file)) throw new Error("Personaggio non trovato.");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  writeRaw(character) {
    const directory = this.characterDirectory(character.id);
    ensureDirectory(directory);
    fs.writeFileSync(
      path.join(directory, "meta.json"),
      `${JSON.stringify(character, null, 2)}\n`,
    );
    return publicCharacter(character, directory);
  }

  createCharacter(raw = {}) {
    const id = safeId(raw.id || crypto.randomUUID());
    const now = new Date().toISOString();
    const directory = this.characterDirectory(id);
    if (fs.existsSync(path.join(directory, "meta.json"))) {
      throw new Error("Esiste gia' un personaggio con questo ID.");
    }
    for (const child of ["hero", "refs", "face", "body", "sheet", "masks", "derived", "voice"]) {
      ensureDirectory(path.join(directory, child));
    }
    const characterBlueprint = normalizeCharacterBlueprint(raw.characterBlueprint || {}, {
      sourceDescription: raw.description,
    });
    const blueprintHints = blueprintIdentityHints(characterBlueprint);
    const character = {
      id,
      name: safeText(raw.name || "Nuovo personaggio", 120),
      heroImage: null,
      sheet: null,
      faceRefs: [],
      bodyRefs: [],
      otherRefs: [],
      references: [],
      description: safeText(raw.description || blueprintDescription(characterBlueprint)),
      subjectKind: normalizeSubjectKind(raw.subjectKind || characterBlueprint.subjectKind),
      characterBlueprint,
      genesis: raw.genesis ? normalizeGenesis(raw.genesis) : null,
      referencePlan: raw.referencePlan
        ? normalizeReferencePlan(raw.referencePlan, {
            subjectKind: normalizeSubjectKind(raw.subjectKind || characterBlueprint.subjectKind) === "auto"
              ? raw.referencePlan.subjectKind
              : raw.subjectKind || characterBlueprint.subjectKind,
            workflow: raw.referencePlan.workflow,
          })
        : null,
      wardrobe: normalizeArray(raw.wardrobe),
      voiceProfile: normalizeVoiceProfile(raw.voiceProfile),
      preferredImagePreset: preferred(raw.preferredImagePreset, ["fast", "balanced", "max"], "balanced"),
      preferredVideoPreset: preferred(raw.preferredVideoPreset, ["original", "improved", "quality"], "improved"),
      preferredVideoEngine: safeText(raw.preferredVideoEngine || "auto", 80),
      identityHints: {
        hair: safeText(raw.identityHints?.hair || raw.hair || blueprintHints.hair, 500),
        face: safeText(raw.identityHints?.face || raw.face || blueprintHints.face, 500),
        body: safeText(raw.identityHints?.body || raw.body || blueprintHints.body, 500),
      },
      settings: {
        ...DEFAULT_SETTINGS,
        ...(raw.settings || {}),
      },
      identityEvaluation: normalizeIdentityEvaluation(),
      characterPack: buildCharacterPack({ id, references: [] }),
      createdAt: now,
      updatedAt: now,
    };
    for (const key of ["lockFace", "lockHair", "lockBody", "lockOutfit"]) {
      character.settings[key] = booleanValue(character.settings[key], DEFAULT_SETTINGS[key]);
    }
    character.settings.identityStrength = ["low", "medium", "high"].includes(character.settings.identityStrength)
      ? character.settings.identityStrength
      : "medium";
    character.characterPack = buildCharacterPack(character);
    return this.writeRaw(character);
  }

  updateCharacter(id, raw = {}) {
    const character = this.readRaw(id);
    const settings = raw.settings || {};
    const characterBlueprint = raw.characterBlueprint === undefined
      ? normalizeCharacterBlueprint(character.characterBlueprint || {}, { sourceDescription: character.description })
      : normalizeCharacterBlueprint(raw.characterBlueprint, { sourceDescription: raw.description || character.description });
    const nextSubjectKind = raw.subjectKind === undefined
      ? normalizeSubjectKind(character.subjectKind || characterBlueprint.subjectKind)
      : normalizeSubjectKind(raw.subjectKind);
    const referencePlanKindChanged = Boolean(
      character.referencePlan
      && nextSubjectKind !== "auto"
      && character.referencePlan.subjectKind !== nextSubjectKind,
    );
    const updated = {
      ...character,
      name: raw.name === undefined ? character.name : safeText(raw.name, 120),
      description: raw.description === undefined ? character.description : safeText(raw.description),
      wardrobe: raw.wardrobe === undefined ? character.wardrobe : normalizeArray(raw.wardrobe),
      voiceProfile: raw.voiceProfile === undefined
        ? normalizeVoiceProfile(character.voiceProfile)
        : normalizeVoiceProfile({ ...character.voiceProfile, ...raw.voiceProfile }),
      preferredImagePreset: raw.preferredImagePreset === undefined
        ? preferred(character.preferredImagePreset, ["fast", "balanced", "max"], "balanced")
        : preferred(raw.preferredImagePreset, ["fast", "balanced", "max"], "balanced"),
      preferredVideoPreset: raw.preferredVideoPreset === undefined
        ? preferred(character.preferredVideoPreset, ["original", "improved", "quality"], "improved")
        : preferred(raw.preferredVideoPreset, ["original", "improved", "quality"], "improved"),
      preferredVideoEngine: raw.preferredVideoEngine === undefined
        ? safeText(character.preferredVideoEngine || "auto", 80)
        : safeText(raw.preferredVideoEngine || "auto", 80),
      subjectKind: nextSubjectKind,
      characterBlueprint,
      genesis: raw.genesis === undefined
        ? (character.genesis ? normalizeGenesis(character.genesis) : null)
        : (raw.genesis ? normalizeGenesis(raw.genesis, character.genesis || {}) : null),
      referencePlan: raw.referencePlan === undefined
        ? (character.referencePlan && !referencePlanKindChanged ? normalizeReferencePlan(character.referencePlan, {
            subjectKind: normalizeSubjectKind(raw.subjectKind || character.subjectKind || characterBlueprint.subjectKind) === "auto"
              ? character.referencePlan.subjectKind
              : raw.subjectKind || character.subjectKind || characterBlueprint.subjectKind,
            workflow: character.referencePlan.workflow,
            existingPlan: character.referencePlan,
          }) : null)
        : (raw.referencePlan ? normalizeReferencePlan(raw.referencePlan, {
            subjectKind: normalizeSubjectKind(raw.subjectKind || character.subjectKind || characterBlueprint.subjectKind) === "auto"
              ? raw.referencePlan.subjectKind
              : raw.subjectKind || character.subjectKind || characterBlueprint.subjectKind,
            workflow: raw.referencePlan.workflow,
            existingPlan: character.referencePlan,
          }) : null),
      identityHints: {
        ...EMPTY_HINTS,
        ...(character.identityHints || {}),
        ...(raw.identityHints || {}),
      },
      settings: {
        ...DEFAULT_SETTINGS,
        ...(character.settings || {}),
        ...settings,
      },
      updatedAt: new Date().toISOString(),
    };
    updated.identityHints = {
      hair: safeText(updated.identityHints.hair, 500),
      face: safeText(updated.identityHints.face, 500),
      body: safeText(updated.identityHints.body, 500),
    };
    updated.settings.identityStrength = ["low", "medium", "high"].includes(updated.settings.identityStrength)
      ? updated.settings.identityStrength
      : "medium";
    for (const key of ["lockFace", "lockHair", "lockBody", "lockOutfit"]) {
      updated.settings[key] = booleanValue(updated.settings[key], DEFAULT_SETTINGS[key]);
    }
    updated.characterPack = buildCharacterPack(updated);
    return this.writeRaw(updated);
  }

  deleteCharacter(id) {
    const character = this.getCharacter(id);
    fs.rmSync(this.characterDirectory(id), { recursive: true, force: true });
    return { deleted: true, character };
  }

  addReference(id, file, raw = {}) {
    if (!file?.buffer) throw new Error("Carica una reference personaggio.");
    const character = this.readRaw(id);
    const reference = writeReferenceFiles({
      characterDirectory: this.characterDirectory(id),
      reference: buildReferenceMetadata(file, raw),
      file,
    });
    const references = [...(character.references || []), reference];
    const heroImage = reference.type === "hero" || !character.heroImage
      ? reference.id
      : character.heroImage;
    const sheet = reference.type === "sheet" ? reference.id : character.sheet;
    const updated = {
      ...character,
      heroImage,
      sheet,
      references,
      ...referenceLists(references),
      updatedAt: new Date().toISOString(),
    };
    updated.characterPack = buildCharacterPack(updated);
    return {
      character: this.writeRaw(updated),
      reference: publicReference(updated.id, reference, this.characterDirectory(id)),
    };
  }

  addReferenceFromPath(id, filePath, raw = {}) {
    const buffer = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const mimetype = extension === ".jpg" || extension === ".jpeg"
      ? "image/jpeg"
      : extension === ".webp"
        ? "image/webp"
        : "image/png";
    return this.addReference(id, {
      buffer,
      mimetype,
      originalname: path.basename(filePath),
      size: buffer.length,
    }, raw);
  }

  setVoiceReference(id, file) {
    const character = this.readRaw(id);
    if (!file?.buffer || !["audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"].includes(file.mimetype)) {
      throw new Error("Reference voce non valida: usa WAV, MP3 o M4A.");
    }
    const extension = ({ "audio/wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a" })[file.mimetype];
    const relative = path.join("voice", `reference-${crypto.randomUUID()}${extension}`);
    const target = path.resolve(this.characterDirectory(id), relative);
    ensureDirectory(path.dirname(target));
    fs.writeFileSync(target, file.buffer);
    const previous = character.voiceProfile?.referenceAudio;
    if (previous) {
      const previousPath = path.resolve(this.characterDirectory(id), previous);
      if (previousPath.startsWith(`${this.characterDirectory(id)}${path.sep}`) && fs.existsSync(previousPath)) fs.rmSync(previousPath);
    }
    return this.writeRaw({
      ...character,
      voiceProfile: { ...normalizeVoiceProfile(character.voiceProfile), referenceAudio: relative.replaceAll(path.sep, "/") },
      updatedAt: new Date().toISOString(),
    });
  }

  voiceReferencePath(id) {
    const character = this.readRaw(id);
    const relative = character.voiceProfile?.referenceAudio;
    if (!relative) return null;
    const base = this.characterDirectory(id);
    const target = path.resolve(base, relative);
    return target.startsWith(`${base}${path.sep}`) && fs.existsSync(target) ? target : null;
  }

  updateIdentityEvaluation(id, report = {}) {
    const character = this.readRaw(id);
    const updated = {
      ...character,
      identityEvaluation: normalizeIdentityEvaluation({
        ...report,
        evaluatedAt: report.evaluatedAt || new Date().toISOString(),
      }),
      updatedAt: new Date().toISOString(),
    };
    updated.characterPack = buildCharacterPack(updated);
    return this.writeRaw(updated);
  }

  updateReferencePlan(id, referencePlan) {
    const character = this.readRaw(id);
    const updated = {
      ...character,
      referencePlan: normalizeReferencePlan(referencePlan, {
        subjectKind: character.subjectKind === "auto"
          ? referencePlan?.subjectKind
          : character.subjectKind || character.characterBlueprint?.subjectKind,
        workflow: referencePlan?.workflow,
        existingPlan: character.referencePlan,
      }),
      updatedAt: new Date().toISOString(),
    };
    updated.characterPack = buildCharacterPack(updated);
    return this.writeRaw(updated);
  }

  assetDiagnostics(id) {
    const character = this.getCharacter(id);
    return {
      characterId: character.id,
      ok: character.assetWarnings.length === 0,
      references: character.references.map((reference) => ({
        id: reference.id,
        type: reference.type,
        originalName: reference.originalName,
        assetAvailable: reference.assetAvailable,
        path: reference.path,
      })),
      warnings: character.assetWarnings,
    };
  }

  updateReference(id, referenceId, raw = {}) {
    const character = this.readRaw(id);
    const references = (character.references || []).map((reference) => {
      if (reference.id !== referenceId) return reference;
      return {
        ...reference,
        type: safeReferenceType(raw.type || raw.referenceType || reference.type),
        status: raw.status ? safeText(raw.status, 40) : reference.status,
        tags: raw.tags === undefined ? reference.tags : normalizeArray(raw.tags),
        manualReview: raw.manualReview === undefined
          ? normalizeManualReview(reference.manualReview)
          : normalizeManualReview(raw.manualReview),
        updatedAt: new Date().toISOString(),
      };
    });
    if (!references.some((reference) => reference.id === referenceId)) {
      throw new Error("Reference personaggio non trovata.");
    }
    const updated = {
      ...character,
      references,
      heroImage: references.some((item) => item.id === character.heroImage) ? character.heroImage : references[0]?.id || null,
      sheet: references.some((item) => item.id === character.sheet) ? character.sheet : references.find((item) => item.type === "sheet")?.id || null,
      ...referenceLists(references),
      updatedAt: new Date().toISOString(),
    };
    updated.characterPack = buildCharacterPack(updated);
    return this.writeRaw(updated);
  }

  removeReference(id, referenceId) {
    const character = this.readRaw(id);
    const reference = (character.references || []).find((item) => item.id === referenceId);
    if (!reference) throw new Error("Reference personaggio non trovata.");
    const references = character.references.filter((item) => item.id !== referenceId);
    for (const relative of [reference.path, reference.preprocessing?.workflowImage]) {
      if (!relative) continue;
      const target = path.resolve(this.characterDirectory(id), relative);
      if (target.startsWith(this.characterDirectory(id) + path.sep)) {
        fs.rmSync(target, { force: true });
      }
    }
    const updated = {
      ...character,
      references,
      heroImage: character.heroImage === referenceId ? references[0]?.id || null : character.heroImage,
      sheet: character.sheet === referenceId ? references.find((item) => item.type === "sheet")?.id || null : character.sheet,
      ...referenceLists(references),
      updatedAt: new Date().toISOString(),
    };
    updated.characterPack = buildCharacterPack(updated);
    return this.writeRaw(updated);
  }

  buildPack(id) {
    const character = this.readRaw(id);
    const updated = {
      ...character,
      characterPack: buildCharacterPack(character),
      updatedAt: new Date().toISOString(),
    };
    return { character: this.writeRaw(updated), pack: updated.characterPack };
  }

  assetPath(id, referenceId) {
    const character = this.readRaw(id);
    const reference = (character.references || []).find((item) => item.id === referenceId);
    if (!reference?.path) return null;
    const fullPath = path.resolve(this.characterDirectory(id), reference.path);
    if (!fullPath.startsWith(this.characterDirectory(id) + path.sep) || !fs.existsSync(fullPath)) {
      return null;
    }
    return {
      path: fullPath,
      asset: reference,
      mimeType: reference.mimeType || "image/png",
      stats: fs.statSync(fullPath),
    };
  }

  legacySummary({ dataDirectory }) {
    const file = path.join(dataDirectory, "virtual-influencers.json");
    const assetDirectory = path.join(dataDirectory, "virtual-influencer-assets");
    return {
      available: fs.existsSync(file),
      sourceFile: fs.existsSync(file) ? "virtual-influencers.json" : null,
      assetDirectory: fs.existsSync(assetDirectory),
      mode: "copy only",
      endpoint: "/api/characters/import-legacy",
    };
  }
}
