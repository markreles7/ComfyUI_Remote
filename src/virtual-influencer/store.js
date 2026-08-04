import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readImageDimensions } from "../media-files.js";
import {
  CONTENT_LEVELS,
  CONTENT_PROJECT_STATUSES,
  IDENTITY_LOCK_KEYS,
  LOCATION_CATEGORIES,
  MANUAL_PLATFORM_TERMS_WARNING,
  MIN_DECLARED_AGE,
  OUTFIT_CATEGORIES,
  PLATFORM_IDS,
  REFERENCE_CATEGORIES,
  assertVoiceProfileAllowed,
  identitySignature,
  normalizeAnalyticsInput,
  normalizeCharacterBible,
  normalizeContentProjectInput,
  normalizeLocationInput,
  normalizeOutfitInput,
  normalizePlatformPolicyInput,
  normalizeProfileInput,
  normalizeVoiceProfileInput,
} from "./schema.js";
import { buildCaptionDraft, defaultPlatformPolicies, disclosureFor } from "./content-engine.js";
import { VirtualInfluencerCache, virtualInfluencerCacheKey } from "./cache.js";
import { validateAnatomyAndQuality, validateInfluencerImage } from "./validator.js";

const IMAGE_MIME_EXTENSIONS = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function safeName(value) {
  return String(value || "reference")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "reference";
}

function text(value) {
  return String(value || "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/\r?\n|,/).map(text).filter(Boolean);
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return value.split(/\r?\n|,/).map(text).filter(Boolean);
    }
  }
  return [];
}

function parseCsvRows(csvText = "") {
  return String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function csvRecords(csvText = "") {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, ""));
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function classifyReference({ originalName, width, height }) {
  const name = String(originalName || "").toLowerCase();
  const tags = [];
  const ratio = width && height ? width / height : 1;
  if (/front|frontal|frontale/.test(name)) tags.push("frontale");
  if (/left|sinistr/.test(name)) tags.push("profilo sinistro");
  if (/right|destr/.test(name)) tags.push("profilo destro");
  if (/three|quart|34|3-4/.test(name)) tags.push("tre quarti");
  if (/close|primo|portrait|face/.test(name)) tags.push("primo piano");
  if (/half|bust|mezzo/.test(name)) tags.push("mezzo busto");
  if (/full|body|intera/.test(name)) tags.push("figura intera");
  if (/smile|sorriso/.test(name)) tags.push("sorriso");
  if (/serious|seria/.test(name)) tags.push("seria");
  if (/neutral|neutra/.test(name)) tags.push("espressione neutra");
  if (/night|notte|dark/.test(name)) tags.push("luce notturna");
  if (/indoor|intern/.test(name)) tags.push("luce interna");
  if (/sun|day|natural|naturale|outdoor/.test(name)) tags.push("luce naturale");
  if (/loose|sciolt/.test(name)) tags.push("capelli sciolti");
  if (/updo|ponytail|raccolt/.test(name)) tags.push("capelli raccolti");
  if (!tags.some((tag) => ["primo piano", "mezzo busto", "figura intera"].includes(tag))) {
    tags.push(ratio < 0.85 ? "figura intera" : ratio < 1.25 ? "mezzo busto" : "primo piano");
  }
  if (!tags.some((tag) => ["frontale", "profilo sinistro", "profilo destro", "tre quarti"].includes(tag))) {
    tags.push("frontale");
  }
  if (!tags.some((tag) => ["luce naturale", "luce interna", "luce notturna"].includes(tag))) {
    tags.push("luce naturale");
  }
  if (!tags.some((tag) => ["espressione neutra", "sorriso", "seria"].includes(tag))) {
    tags.push("espressione neutra");
  }
  return uniq(tags.filter((tag) => REFERENCE_CATEGORIES.includes(tag)));
}

function referenceQuality({ size, width, height, duplicate }) {
  const warnings = [];
  if (!width || !height) warnings.push("Dimensioni immagine non rilevate.");
  if (width && height && Math.min(width, height) < 512) warnings.push("Risoluzione sotto 512 px sul lato corto.");
  if (size < 30_000) warnings.push("File molto piccolo: possibile compressione o qualità insufficiente.");
  if (duplicate) warnings.push("Possibile duplicato: hash già presente nel dataset.");
  const score = Math.max(0, 100 - warnings.length * 25);
  return { score, warnings };
}

function datasetReadiness(assets) {
  const approved = assets.filter((asset) => asset.status === "approved");
  const canonical = approved.filter((asset) => asset.canonical);
  const categories = new Set(approved.flatMap((asset) => asset.categories || []));
  const required = ["frontale", "tre quarti", "primo piano", "mezzo busto", "figura intera", "espressione neutra", "sorriso"];
  const missing = required.filter((category) => !categories.has(category));
  const balanceWarnings = [];
  if (approved.length < 4) balanceWarnings.push("Servono almeno 4 reference approvate per una base stabile.");
  if (canonical.length < 2) balanceWarnings.push("Seleziona almeno 2 immagini canoniche.");
  if (missing.length) balanceWarnings.push(`Dataset sbilanciato: mancano ${missing.join(", ")}.`);
  const score = Math.max(0, Math.min(100,
    approved.length * 12
    + canonical.length * 12
    + (required.length - missing.length) * 6
    - balanceWarnings.length * 8
  ));
  return {
    score,
    status: score >= 75 ? "ready" : score >= 45 ? "partial" : "insufficient",
    approvedCount: approved.length,
    canonicalCount: canonical.length,
    coveredCategories: [...categories].sort((a, b) => a.localeCompare(b, "it")),
    missingCategories: missing,
    warnings: balanceWarnings,
  };
}

function sortReferences(assets = []) {
  return [...assets].sort((a, b) => {
    const order = Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
    if (order !== 0) return order;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

function compareReference(asset, candidates = []) {
  const canonical = candidates.filter((item) => item.status === "approved" && item.canonical && item.id !== asset.id);
  if (!canonical.length) {
    return {
      method: "dataset-overlap-heuristic",
      comparedWith: [],
      score: null,
      warnings: ["Nessuna reference canonica disponibile per il confronto."],
    };
  }
  const comparisons = canonical.map((item) => {
    const categoryOverlap = (asset.categories || []).filter((category) => (item.categories || []).includes(category)).length;
    const assetPixels = Number(asset.width || 0) * Number(asset.height || 0);
    const itemPixels = Number(item.width || 0) * Number(item.height || 0);
    const sizeScore = assetPixels && itemPixels
      ? 1 - Math.min(Math.abs(assetPixels - itemPixels) / Math.max(assetPixels, itemPixels), 1)
      : 0.5;
    const score = Math.round(Math.min(100, categoryOverlap * 18 + sizeScore * 28 + (asset.sha256 === item.sha256 ? 54 : 0)));
    return { assetId: item.id, score };
  });
  const best = comparisons.reduce((winner, item) => (item.score > winner.score ? item : winner), comparisons[0]);
  return {
    method: "dataset-overlap-heuristic",
    comparedWith: comparisons,
    score: best.score,
    warnings: best.score < 45
      ? ["Reference molto diversa dalle canoniche: verifica manualmente identità, luce e inquadratura."]
      : ["Confronto euristico: confermare manualmente prima di usarla come canonica."],
  };
}

export class VirtualInfluencerStore {
  constructor({ dataDirectory, enabled = true }) {
    this.dataDirectory = dataDirectory;
    this.enabled = enabled;
    this.file = path.join(dataDirectory, "virtual-influencers.json");
    this.assetDirectory = path.join(dataDirectory, "virtual-influencer-assets");
    this.cache = new VirtualInfluencerCache(path.join(dataDirectory, "virtual-influencer-cache"));
    this.data = readJson(this.file, { schemaVersion: 1, profiles: [] });
  }

  save() {
    writeJson(this.file, this.data);
  }

  listProfiles() {
    return [...this.data.profiles]
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((profile) => this.withReadiness(profile));
  }

  getProfile(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    return this.withReadiness(profile);
  }

  withReadiness(profile) {
    return {
      captionDrafts: [],
      contentProjects: [],
      analyticsEntries: [],
      platformRules: defaultPlatformPolicies(),
      ...profile,
      referenceAssets: sortReferences(profile.referenceAssets || []),
      captionDrafts: profile.captionDrafts || [],
      contentProjects: profile.contentProjects || [],
      analyticsEntries: profile.analyticsEntries || [],
      platformRules: { ...defaultPlatformPolicies(), ...(profile.platformRules || {}) },
      performanceSettings: {
        lazyLoadPreviews: true,
        cacheIdentityPlans: true,
        cacheMaxEntries: this.cache.maxEntries,
        releaseVramBeforeGeneration: true,
        chunkLongVideoPlanned: true,
        resumeJobsPlanned: true,
        fallbackOnLowVram: "fastPreview",
        ...(profile.performanceSettings || {}),
      },
      debugSettings: {
        debugReportsEnabled: true,
        exposeSensitiveLogs: false,
        visualGoldenTests: "synthetic-only",
        ...(profile.debugSettings || {}),
      },
      runtimeStatus: {
        cache: this.cache.stats(),
      },
      identityDatasetReadiness: datasetReadiness(profile.referenceAssets || []),
    };
  }

  createProfile(raw) {
    const normalized = normalizeProfileInput(raw);
    const timestamp = now();
    const profile = {
      id: crypto.randomUUID(),
      ...normalized,
      createdAt: timestamp,
      updatedAt: timestamp,
      currentVersionId: null,
      versions: [],
    };
    const version = this.createVersionRecord(profile, {
      changeLog: "Versione iniziale del personaggio virtuale adulto.",
      createdBy: normalized.ownerId,
    });
    profile.versions.push(version);
    profile.currentVersionId = version.id;
    this.data.profiles.push(profile);
    this.save();
    return this.withReadiness(profile);
  }

  createVersionRecord(profile, raw = {}) {
    const approvedReferences = (profile.referenceAssets || [])
      .filter((asset) => asset.status === "approved" && asset.canonical);
    return {
      id: crypto.randomUUID(),
      influencerId: profile.id,
      versionNumber: (profile.versions?.length || 0) + 1,
      changeLog: text(raw.changeLog || "Aggiornamento identità."),
      identitySignature: identitySignature(profile, approvedReferences),
      approvedReferences: approvedReferences.map((asset) => asset.id),
      canonicalPrompts: {
        identity: [
          profile.identityProfile.stageName,
          `${profile.identityProfile.declaredAge} year old fictional adult virtual creator`,
          profile.appearanceProfile.faceShape,
          profile.appearanceProfile.eyeColorAndShape,
          profile.appearanceProfile.hair,
          profile.appearanceProfile.skinTone,
          profile.appearanceProfile.bodyShape,
          profile.appearanceProfile.immutableElements?.join(", "),
        ].filter(Boolean).join(", "),
      },
      negativePrompts: {
        identity: "age-ambiguous appearance, immature appearance, real person impersonation, unauthorized identity transfer",
      },
      modelSettings: raw.modelSettings && typeof raw.modelSettings === "object"
        ? raw.modelSettings
        : profile.generationDefaults,
      createdAt: now(),
      createdBy: text(raw.createdBy || profile.ownerId || "local-user"),
    };
  }

  updateBible(id, raw) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const bible = normalizeCharacterBible(raw);
    profile.identityProfile = bible.identity;
    profile.appearanceProfile = bible.appearance;
    profile.personalityProfile = {
      traits: bible.identity.personalityTraits,
      tone: bible.identity.communicationTone,
      lexicon: bible.identity.typicalLexicon,
      recurringPhrases: bible.identity.recurringPhrases,
      avoidedTopics: bible.identity.avoidedTopics,
    };
    profile.identityLocks = bible.identityLocks;
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    const version = this.createVersionRecord(profile, {
      changeLog: text(raw.changeLog || "Aggiornamento Character Bible."),
      createdBy: text(raw.createdBy || profile.ownerId),
    });
    profile.versions.push(version);
    profile.currentVersionId = version.id;
    this.save();
    return this.withReadiness(profile);
  }

  addReference(id, file, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    if (!file) throw new Error("Carica una reference identitaria.");
    if (!IMAGE_MIME_EXTENSIONS[file.mimetype]) throw new Error("Le reference devono essere PNG, JPG o WebP.");
    const hash = sha256(file.buffer);
    const duplicateAsset = (profile.referenceAssets || []).find((asset) => asset.sha256 === hash);
    if (duplicateAsset) {
      duplicateAsset.duplicate = true;
      duplicateAsset.quality = {
        ...(duplicateAsset.quality || {}),
        warnings: uniq([...(duplicateAsset.quality?.warnings || []), "Duplicato rilevato e riutilizzato: nessun nuovo file salvato."]),
      };
      duplicateAsset.updatedAt = now();
      profile.updatedAt = now();
      this.cache.invalidateByInfluencer(profile.id);
      this.save();
      return { profile: this.withReadiness(profile), asset: duplicateAsset, duplicate: true };
    }
    const assetId = crypto.randomUUID();
    const extension = IMAGE_MIME_EXTENSIONS[file.mimetype];
    const filename = `${assetId}-${safeName(file.originalname).replace(/\.[^.]+$/, "")}${extension}`;
    const directory = path.join(this.assetDirectory, profile.id);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, filename);
    fs.writeFileSync(filePath, file.buffer);
    const dimensions = readImageDimensions(filePath) || {};
    const autoCategories = classifyReference({
      originalName: file.originalname,
      width: dimensions.width,
      height: dimensions.height,
    });
    const manualCategories = list(raw.categories).filter((category) => REFERENCE_CATEGORIES.includes(category));
    const categories = uniq([...autoCategories, ...manualCategories]);
    const quality = referenceQuality({
      size: file.size,
      width: dimensions.width,
      height: dimensions.height,
      duplicate: false,
    });
    const asset = {
      id: assetId,
      influencerId: profile.id,
      originalName: file.originalname,
      filename,
      mimeType: file.mimetype,
      size: file.size,
      sha256: hash,
      width: dimensions.width || null,
      height: dimensions.height || null,
      status: raw.approved === "true" || raw.status === "approved" ? "approved" : "pending",
      canonical: raw.canonical === "true" || raw.canonical === true,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : (profile.referenceAssets || []).length + 1,
      tags: list(raw.tags),
      categories,
      autoClassification: {
        method: "filename-and-dimensions-heuristic",
        categories: autoCategories,
        warnings: ["Classificazione automatica euristica: confermare manualmente le categorie canoniche."],
      },
      quality,
      duplicate: false,
      comparison: null,
      multiPersonCheck: {
        status: "unverified",
        warning: "Milestone 1 non esegue face detection automatica: verifica manualmente che ci sia una sola identità.",
      },
      createdAt: now(),
      updatedAt: now(),
    };
    asset.comparison = compareReference(asset, profile.referenceAssets || []);
    profile.referenceAssets = [...(profile.referenceAssets || []), asset];
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  updateReference(id, assetId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const asset = (profile.referenceAssets || []).find((item) => item.id === assetId);
    if (!asset) throw new Error("Reference non trovata.");
    if (raw.status !== undefined) {
      if (!["pending", "approved", "rejected"].includes(raw.status)) throw new Error("Stato reference non valido.");
      asset.status = raw.status;
    }
    if (raw.canonical !== undefined) asset.canonical = raw.canonical === true || raw.canonical === "true";
    if (raw.sortOrder !== undefined) {
      const parsed = Number(raw.sortOrder);
      if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Ordinamento reference non valido.");
      asset.sortOrder = parsed;
    }
    if (raw.tags !== undefined) asset.tags = list(raw.tags);
    if (raw.categories !== undefined) {
      asset.categories = list(raw.categories).filter((category) => REFERENCE_CATEGORIES.includes(category));
    }
    asset.comparison = compareReference(asset, profile.referenceAssets || []);
    asset.updatedAt = now();
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  removeReference(id, assetId) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const asset = (profile.referenceAssets || []).find((item) => item.id === assetId);
    if (!asset) throw new Error("Reference non trovata.");
    profile.referenceAssets = (profile.referenceAssets || []).filter((item) => item.id !== assetId);
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    const filePath = path.join(this.assetDirectory, profile.id, asset.filename);
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // La rimozione dal dataset resta valida anche se il file era già assente.
    }
    this.save();
    return { profile: this.withReadiness(profile), removed: assetId };
  }

  createVersion(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const version = this.createVersionRecord(profile, raw);
    profile.versions.push(version);
    profile.currentVersionId = version.id;
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), version };
  }

  createOutfit(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const normalized = normalizeOutfitInput(raw);
    if (normalized.sensualityLevel > profile.contentRules.maxContentLevel) {
      throw new Error("Il livello sensualità outfit supera le regole del profilo.");
    }
    const outfit = {
      id: crypto.randomUUID(),
      ...normalized,
      createdAt: now(),
      updatedAt: now(),
    };
    profile.outfitLibrary = [...(profile.outfitLibrary || []), outfit];
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), outfit };
  }

  updateOutfit(id, outfitId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const outfit = (profile.outfitLibrary || []).find((item) => item.id === outfitId);
    if (!outfit) throw new Error("Outfit non trovato.");
    Object.assign(outfit, normalizeOutfitInput({ ...outfit, ...raw }), { updatedAt: now() });
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), outfit };
  }

  createLocation(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const location = {
      id: crypto.randomUUID(),
      ...normalizeLocationInput(raw),
      createdAt: now(),
      updatedAt: now(),
    };
    profile.locationLibrary = [...(profile.locationLibrary || []), location];
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), location };
  }

  updateLocation(id, locationId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const location = (profile.locationLibrary || []).find((item) => item.id === locationId);
    if (!location) throw new Error("Location non trovata.");
    Object.assign(location, normalizeLocationInput({ ...location, ...raw }), { updatedAt: now() });
    profile.updatedAt = now();
    this.cache.invalidateByInfluencer(profile.id);
    this.save();
    return { profile: this.withReadiness(profile), location };
  }

  enrichGenerationInput(id, raw = {}) {
    const profile = this.getProfile(id);
    const outfit = (profile.outfitLibrary || []).find((item) => item.id === raw.outfitId);
    const location = (profile.locationLibrary || []).find((item) => item.id === raw.locationId);
    return {
      ...raw,
      outfit: [
        raw.outfit,
        outfit?.name,
        outfit?.description,
        outfit?.colors?.length ? `colors ${outfit.colors.join(", ")}` : "",
        outfit?.materials?.length ? `materials ${outfit.materials.join(", ")}` : "",
        outfit?.accessories?.length ? `accessories ${outfit.accessories.join(", ")}` : "",
        outfit?.promptFragments?.join(", "),
      ].map(text).filter(Boolean).join(", "),
      location: [
        raw.location,
        location?.name,
        location?.description,
        location?.lightingPreset ? `lighting ${location.lightingPreset}` : "",
        location?.cameraPreset ? `camera ${location.cameraPreset}` : "",
        location?.promptFragments?.join(", "),
      ].map(text).filter(Boolean).join(", "),
      contentLevel: Math.max(
        Number(raw.contentLevel ?? 0),
        Number(outfit?.sensualityLevel ?? 0),
      ),
      outfitId: outfit?.id || raw.outfitId || null,
      locationId: location?.id || raw.locationId || null,
    };
  }

  createBatchQueue(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const outfitIds = arrayValue(raw.outfitIds).filter((item) => (profile.outfitLibrary || []).some((outfit) => outfit.id === item));
    const locationIds = arrayValue(raw.locationIds).filter((item) => (profile.locationLibrary || []).some((location) => location.id === item));
    const poses = arrayValue(raw.poses);
    const expressions = arrayValue(raw.expressions);
    const framings = arrayValue(raw.framings);
    const aspectRatios = arrayValue(raw.aspectRatios);
    const platforms = arrayValue(raw.platforms);
    const axes = {
      outfitIds: outfitIds.length ? outfitIds : [null],
      locationIds: locationIds.length ? locationIds : [null],
      poses: poses.length ? poses : [""],
      expressions: expressions.length ? expressions : [""],
      framings: framings.length ? framings : [""],
      aspectRatios: aspectRatios.length ? aspectRatios : ["portrait"],
      platforms: platforms.length ? platforms : ["manual-review"],
    };
    const total = Object.values(axes).reduce((count, values) => count * values.length, 1);
    const limit = Math.min(24, Math.max(1, Number(raw.maxItems || 12)));
    if (total > limit) {
      throw new Error(`Batch troppo grande: ${total} output richiesti. Limite corrente ${limit}; riduci combinazioni o aumenta consapevolmente maxItems fino a 24.`);
    }
    const items = [];
    for (const outfitId of axes.outfitIds) {
      for (const locationId of axes.locationIds) {
        for (const pose of axes.poses) {
          for (const expression of axes.expressions) {
            for (const framing of axes.framings) {
              for (const aspectRatio of axes.aspectRatios) {
                for (const platform of axes.platforms) {
                  items.push({
                    id: crypto.randomUUID(),
                    status: "pending",
                    outfitId,
                    locationId,
                    pose,
                    expression,
                    framing,
                    aspectRatio,
                    platform,
                    seed: Number(raw.seed || 0) ? Number(raw.seed) + items.length : null,
                    generationId: null,
                    assetId: null,
                    error: null,
                  });
                }
              }
            }
          }
        }
      }
    }
    const queue = {
      id: crypto.randomUUID(),
      type: "photo",
      status: "draft",
      priority: Math.min(5, Math.max(1, Number(raw.priority || 3))),
      totalOutputs: total,
      estimates: {
        cost: "local ComfyUI",
        timeMinutes: Math.max(1, Math.ceil(total * 3)),
        vram: raw.qualityPreset === "maximumConsistency" ? "high" : raw.qualityPreset === "balanced" ? "medium" : "low",
        diskMb: total * 18,
        models: [raw.model || "flux", raw.qualityPreset || "fastPreview"],
      },
      settings: {
        model: raw.model || "flux",
        qualityPreset: raw.qualityPreset || "fastPreview",
        contentLevel: raw.contentLevel ?? 0,
      },
      controls: {
        pause: true,
        resume: true,
        cancel: true,
        retry: true,
        deduplication: true,
        seedManagement: true,
      },
      items,
      createdAt: now(),
      updatedAt: now(),
    };
    profile.batchQueues = [...(profile.batchQueues || []), queue];
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), queue };
  }

  cacheKeyForPlan(id, type, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    return virtualInfluencerCacheKey(this.withReadiness(profile), type, raw);
  }

  getCachedPlan(id, type, raw = {}) {
    const key = this.cacheKeyForPlan(id, type, raw);
    const cached = this.cache.get(key);
    return cached ? { key, cached: true, ...cached } : { key, cached: false, plan: null };
  }

  putCachedPlan(id, type, raw = {}, plan) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const key = virtualInfluencerCacheKey(this.withReadiness(profile), type, raw);
    this.cache.put(key, {
      type,
      profileId: profile.id,
      plan,
      input: raw,
    }, { type, influencerId: profile.id });
    return { key, cached: false, plan };
  }

  invalidateCache(id) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const removed = this.cache.invalidateByInfluencer(profile.id);
    return { profile: this.withReadiness(profile), removed };
  }

  debugReport(id) {
    const profile = this.getProfile(id);
    const assets = profile.generatedAssets || [];
    const reviewAssets = assets.filter((asset) => asset.status === "review");
    const runningAssets = assets.filter((asset) => asset.status === "generating");
    const rejectedAssets = assets.filter((asset) => asset.status === "rejected");
    const warnings = [
      ...(profile.identityDatasetReadiness?.warnings || []),
      runningAssets.length ? `${runningAssets.length} asset ancora in generazione.` : "",
      rejectedAssets.length ? `${rejectedAssets.length} asset rifiutati da rivedere per pattern ricorrenti.` : "",
    ].filter(Boolean);
    return {
      profileId: profile.id,
      displayName: profile.displayName,
      milestone: 6,
      cache: profile.runtimeStatus.cache,
      queues: {
        review: reviewAssets.length,
        generating: runningAssets.length,
        batch: (profile.batchQueues || []).map((queue) => ({
          id: queue.id,
          status: queue.status,
          totalOutputs: queue.totalOutputs,
          estimates: queue.estimates,
        })),
      },
      performance: {
        lazyLoading: profile.performanceSettings.lazyLoadPreviews,
        vramRelease: profile.performanceSettings.releaseVramBeforeGeneration,
        batchingControlled: true,
        cancellation: true,
        progress: "SSE progress from shared generation queue",
        chunking: "planned for clips longer than 10 seconds; current clips are limited to 3-10 seconds",
        lowVramFallback: profile.performanceSettings.fallbackOnLowVram,
      },
      debugging: {
        reportsEnabled: profile.debugSettings.debugReportsEnabled,
        sensitiveLogs: false,
        unavailableMethods: [
          "real face embedding without installed/approved detector",
          "automatic platform API publishing",
          "unauthorized voice cloning",
        ],
      },
      warnings,
      generatedAt: now(),
    };
  }

  updateBatchQueue(id, queueId, action) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const queue = (profile.batchQueues || []).find((item) => item.id === queueId);
    if (!queue) throw new Error("Batch queue non trovata.");
    const transitions = {
      pause: "paused",
      resume: "draft",
      cancel: "cancelled",
      start: "ready",
    };
    if (!transitions[action]) throw new Error("Azione batch non valida.");
    if (queue.status === "cancelled") throw new Error("Batch già annullato.");
    queue.status = transitions[action];
    queue.updatedAt = now();
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), queue };
  }

  updateVoiceProfile(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const normalized = normalizeVoiceProfileInput({
      ...(profile.voiceProfile || {}),
      ...raw,
      consentMetadata: raw.consentMetadata || profile.voiceProfile?.consentMetadata || null,
    });
    assertVoiceProfileAllowed(normalized);
    profile.voiceProfile = normalized;
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), voiceProfile: normalized };
  }

  updateDisclosureSettings(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const previous = profile.disclosureSettings || {};
    const nextSettings = {
      ...previous,
      defaultText: text(raw.defaultText || previous.defaultText),
      label: text(raw.label || previous.label || "AI-generated fictional adult character"),
      watermarkEnabled: raw.watermarkEnabled === true || raw.watermarkEnabled === "true" || raw.watermarkEnabled === "on",
      badgeEnabled: raw.badgeEnabled !== false && raw.badgeEnabled !== "false",
      metadataEnabled: raw.metadataEnabled !== false && raw.metadataEnabled !== "false",
      bioTemplate: text(raw.bioTemplate || previous.bioTemplate || previous.defaultText),
      captionTemplate: text(raw.captionTemplate || previous.captionTemplate || "{caption}\n\nVirtual creator - AI-generated fictional adult character."),
      history: [
        ...(previous.history || []),
        {
          id: crypto.randomUUID(),
          text: text(raw.defaultText || previous.defaultText),
          label: text(raw.label || previous.label),
          updatedAt: now(),
          updatedBy: text(raw.updatedBy || profile.ownerId),
        },
      ],
      synthetic: true,
      required: true,
    };
    profile.disclosureSettings = nextSettings;
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), disclosure: disclosureFor(profile) };
  }

  updatePlatformPolicy(id, platformId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const platform = platformId || raw.platform || "custom";
    const normalized = normalizePlatformPolicyInput({ ...raw, platform });
    profile.platformRules = {
      ...defaultPlatformPolicies(),
      ...(profile.platformRules || {}),
      [normalized.platform]: {
        ...(profile.platformRules?.[normalized.platform] || {}),
        ...normalized,
        updatedAt: now(),
      },
    };
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), policy: profile.platformRules[normalized.platform] };
  }

  createCaptionDraft(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const draft = {
      id: crypto.randomUUID(),
      influencerId: profile.id,
      projectId: text(raw.projectId),
      ...buildCaptionDraft(this.withReadiness(profile), raw),
      createdAt: now(),
      updatedAt: now(),
      approvedAt: null,
      approvedBy: null,
    };
    profile.captionDrafts = [...(profile.captionDrafts || []), draft];
    if (draft.projectId) {
      const project = (profile.contentProjects || []).find((item) => item.id === draft.projectId);
      if (project) project.captions = [...(project.captions || []), draft.id];
    }
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), caption: draft };
  }

  createContentProject(id, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const normalized = normalizeContentProjectInput(raw, profile);
    const project = {
      id: crypto.randomUUID(),
      ...normalized,
      disclosures: normalized.disclosures.length ? normalized.disclosures : [disclosureFor(profile, normalized.platform).text],
      calendar: {
        scheduledAt: normalized.scheduledAt || null,
        publishedAt: normalized.publishedAt || null,
      },
      humanApprovalRequired: true,
      createdAt: now(),
      updatedAt: now(),
    };
    profile.contentProjects = [...(profile.contentProjects || []), project];
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), project };
  }

  updateContentProject(id, projectId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const project = (profile.contentProjects || []).find((item) => item.id === projectId);
    if (!project) throw new Error("Content project non trovato.");
    const nextStatus = raw.status || project.status;
    if (!CONTENT_PROJECT_STATUSES.includes(nextStatus)) throw new Error("Stato progetto contenuto non valido.");
    if (["Scheduled", "Published"].includes(nextStatus) && project.status !== "Approved" && raw.humanApproved !== true) {
      throw new Error("Serve approvazione umana prima di programmare o pubblicare.");
    }
    Object.assign(project, {
      title: raw.title !== undefined ? text(raw.title) : project.title,
      campaign: raw.campaign !== undefined ? text(raw.campaign) : project.campaign,
      platform: raw.platform !== undefined ? text(raw.platform) : project.platform,
      contentType: raw.contentType !== undefined ? text(raw.contentType) : project.contentType,
      brief: raw.brief !== undefined ? text(raw.brief) : project.brief,
      generatedAssets: raw.generatedAssets !== undefined ? arrayValue(raw.generatedAssets) : project.generatedAssets,
      approvedAssets: raw.approvedAssets !== undefined ? arrayValue(raw.approvedAssets) : project.approvedAssets,
      captions: raw.captions !== undefined ? arrayValue(raw.captions) : project.captions,
      disclosures: raw.disclosures !== undefined ? arrayValue(raw.disclosures) : project.disclosures,
      scheduledAt: raw.scheduledAt !== undefined ? text(raw.scheduledAt) : project.scheduledAt,
      publishedAt: raw.publishedAt !== undefined ? text(raw.publishedAt) : project.publishedAt,
      status: nextStatus,
      updatedAt: now(),
    });
    project.calendar = {
      scheduledAt: project.scheduledAt || null,
      publishedAt: project.publishedAt || null,
    };
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), project };
  }

  recordAnalytics(id, projectId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const project = (profile.contentProjects || []).find((item) => item.id === projectId);
    if (!project) throw new Error("Content project non trovato.");
    const analytics = {
      id: crypto.randomUUID(),
      influencerId: profile.id,
      projectId,
      ...normalizeAnalyticsInput({
        platform: project.platform,
        format: project.contentType,
        ...raw,
      }),
      recordedAt: now(),
    };
    project.analytics = [...(project.analytics || []), analytics];
    profile.analyticsEntries = [...(profile.analyticsEntries || []), analytics];
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), project, analytics };
  }

  importAnalyticsCsv(id, projectId, csvText = "") {
    const records = csvRecords(csvText);
    if (!records.length) throw new Error("CSV analytics vuoto o senza intestazioni.");
    const imported = records.map((record) =>
      this.recordAnalytics(id, projectId, { ...record, source: "csv", csvImported: true }).analytics
    );
    const profile = this.data.profiles.find((item) => item.id === id);
    const project = (profile?.contentProjects || []).find((item) => item.id === projectId);
    return { profile: this.withReadiness(profile), project, imported };
  }

  createPhotoAsset(id, plan, projectId, generationIds = []) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const profileView = this.withReadiness(profile);
    const validation = validateInfluencerImage({ profile: profileView, plan });
    const anatomy = validateAnatomyAndQuality({});
    const asset = {
      id: crypto.randomUUID(),
      influencerId: profile.id,
      versionId: plan.versionId,
      type: "photo",
      status: "generating",
      projectId,
      generationIds,
      outputFiles: [],
      prompt: plan.prompt,
      negativePrompt: plan.negativePrompt,
      seed: plan.seed ?? null,
      model: plan.adapter.modelFamily,
      adapter: plan.adapter.name,
      workflow: "studio:perfect",
      workflowVersion: 1,
      referenceIds: plan.references.map((item) => item.id),
      loras: [],
      strength: null,
      validationScores: {
        identity: validation,
        anatomy,
        sceneIntegration: null,
      },
      disclosure: {
        required: true,
        text: profile.disclosureSettings.defaultText,
        label: profile.disclosureSettings.label,
        watermarkEnabled: profile.disclosureSettings.watermarkEnabled,
      },
      platform: null,
      approvalStatus: "pending",
      review: {
        identityScore: validation.overallScore,
        anatomyScore: anatomy.overallScore,
        sceneIntegrationScore: null,
        platformCompatibility: "unverified",
        disclosureStatus: "preserved",
        notes: [],
      },
      metadata: {
        schemaVersion: 1,
        provenance: "Virtual Influencer Studio Influencer Photo",
        date: now(),
        user: profile.ownerId,
        fields: plan.fields,
        qualityPreset: plan.qualityPreset.id,
        contentLevel: plan.contentLevel,
        identitySignature: plan.identitySignature,
        warnings: plan.warnings,
      },
      exports: [],
      createdAt: now(),
      updatedAt: now(),
    };
    profile.generatedAssets = [...(profile.generatedAssets || []), asset];
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  createVideoAsset(id, plan, projectId, generationIds = []) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const profileView = this.withReadiness(profile);
    const validation = validateInfluencerImage({ profile: profileView, plan });
    const anatomy = validateAnatomyAndQuality({});
    validation.categoryScores.temporalIdentityConsistency = Math.max(
      45,
      Math.min(100, validation.categoryScores.faceSimilarity - (plan.duration > 6 ? 8 : 3)),
    );
    validation.overallScore = Math.round((validation.overallScore * 0.78) + (validation.categoryScores.temporalIdentityConsistency * 0.22));
    validation.methods = [...validation.methods, "short-clip-duration-proxy", "keyframe-anchor-proxy"];
    validation.unavailableMethods = [...new Set([
      ...validation.unavailableMethods,
      "optical-flow-consistency",
      "face-tracking-across-frames",
      "flicker-detection",
    ])];
    const asset = {
      id: crypto.randomUUID(),
      influencerId: profile.id,
      versionId: plan.versionId,
      type: "video",
      status: "generating",
      projectId,
      generationIds,
      outputFiles: [],
      prompt: plan.prompt,
      negativePrompt: plan.negativePrompt,
      seed: plan.seed ?? null,
      model: plan.adapter.modelFamily,
      adapter: plan.adapter.name,
      workflow: "ltx:standard",
      workflowVersion: 1,
      referenceIds: plan.references.map((item) => item.id),
      keyframeReferenceId: plan.keyframeReferenceId,
      loras: [],
      strength: null,
      duration: plan.duration,
      fps: plan.fps,
      validationScores: {
        identity: validation,
        anatomy,
        sceneIntegration: null,
      },
      disclosure: {
        required: true,
        text: profile.disclosureSettings.defaultText,
        label: profile.disclosureSettings.label,
        watermarkEnabled: profile.disclosureSettings.watermarkEnabled,
      },
      platform: null,
      approvalStatus: "pending",
      review: {
        identityScore: validation.overallScore,
        anatomyScore: anatomy.overallScore,
        temporalIdentityScore: validation.categoryScores.temporalIdentityConsistency,
        sceneIntegrationScore: null,
        platformCompatibility: "unverified",
        disclosureStatus: "preserved",
        notes: [],
      },
      metadata: {
        schemaVersion: 1,
        provenance: "Virtual Influencer Studio Influencer Video",
        date: now(),
        user: profile.ownerId,
        fields: plan.fields,
        qualityPreset: plan.qualityPreset.id,
        contentLevel: plan.contentLevel,
        identitySignature: plan.identitySignature,
        warnings: plan.warnings,
        duration: plan.duration,
        fps: plan.fps,
      },
      exports: [],
      createdAt: now(),
      updatedAt: now(),
    };
    profile.generatedAssets = [...(profile.generatedAssets || []), asset];
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  updateGeneratedAssetGenerations(id, assetId, generationIds = []) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const asset = (profile.generatedAssets || []).find((item) => item.id === assetId);
    if (!asset) throw new Error("Asset generato non trovato.");
    asset.generationIds = [...new Set([...(asset.generationIds || []), ...generationIds])];
    asset.updatedAt = now();
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  updateGeneratedAssetFromGeneration(generation) {
    const marker = generation?.virtualInfluencer;
    if (!marker?.profileId || !marker?.assetId) return null;
    const profile = this.data.profiles.find((item) => item.id === marker.profileId);
    if (!profile) return null;
    const asset = (profile.generatedAssets || []).find((item) => item.id === marker.assetId);
    if (!asset) return null;
    const plan = {
      references: (profile.referenceAssets || []).filter((item) => (asset.referenceIds || []).includes(item.id)),
      versionId: asset.versionId,
    };
    const identity = validateInfluencerImage({
      profile: this.withReadiness(profile),
      plan,
      generation,
      mediaFile: generation.images?.[0] || generation.videos?.[0] || null,
    });
    const anatomy = validateAnatomyAndQuality({ generation });
    if (asset.type === "video") {
      identity.categoryScores.temporalIdentityConsistency = Math.max(
        45,
        Math.min(100, identity.categoryScores.faceSimilarity - ((generation.duration || asset.duration || 5) > 6 ? 8 : 3)),
      );
      identity.overallScore = Math.round((identity.overallScore * 0.78) + (identity.categoryScores.temporalIdentityConsistency * 0.22));
    }
    asset.status = identity.reject ? "rejected" : "review";
    asset.approvalStatus = identity.reject ? "rejected" : "pending";
    asset.outputFiles = asset.type === "video" ? (generation.videos || []) : (generation.images || []);
    asset.generationIds = [...new Set([...(asset.generationIds || []), generation.id])];
    asset.validationScores = {
      ...asset.validationScores,
      identity,
      anatomy,
    };
    asset.review = {
      ...asset.review,
      identityScore: identity.overallScore,
      anatomyScore: anatomy.overallScore,
      temporalIdentityScore: identity.categoryScores.temporalIdentityConsistency,
      disclosureStatus: "preserved",
      recommendedAction: identity.recommendedAction,
      detectedProblems: [...identity.detectedProblems, ...anatomy.detectedProblems],
    };
    asset.metadata = {
      ...asset.metadata,
      model: generation.imageModelName || generation.videoModelName || generation.imageModelFile || generation.videoModelFile || asset.model,
      modelVersion: generation.imageModelFile || generation.videoModelFile || null,
      workflow: generation.workflowId || asset.workflow,
      workflowVersion: 1,
      validationScores: asset.validationScores,
      outputWidth: generation.outputWidth || null,
      outputHeight: generation.outputHeight || null,
      duration: generation.duration || asset.duration || null,
      fps: generation.fps || asset.fps || null,
      completedAt: generation.finishedAt || now(),
    };
    asset.updatedAt = now();
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  reviewGeneratedAsset(id, assetId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const asset = (profile.generatedAssets || []).find((item) => item.id === assetId);
    if (!asset) throw new Error("Asset generato non trovato.");
    const action = String(raw.action || "").toLowerCase();
    if (!["approve", "reject", "correct", "regenerate"].includes(action)) throw new Error("Azione review non valida.");
    const statusByAction = {
      approve: "approved",
      reject: "rejected",
      correct: "needs-correction",
      regenerate: "regenerate-requested",
    };
    const approvalByAction = {
      approve: "approved",
      reject: "rejected",
      correct: "pending",
      regenerate: "pending",
    };
    asset.status = statusByAction[action];
    asset.approvalStatus = approvalByAction[action];
    asset.review = {
      ...asset.review,
      reviewedAt: now(),
      reviewedBy: text(raw.reviewedBy || profile.ownerId),
      notes: [...(asset.review?.notes || []), text(raw.note)].filter(Boolean),
      correctionRequested: action === "correct" ? {
        requestedAt: now(),
        instruction: text(raw.instruction || raw.note || "Correggere identità/anatomia e rieseguire review."),
      } : asset.review?.correctionRequested || null,
      regenerationRequested: action === "regenerate" ? {
        requestedAt: now(),
        reason: text(raw.reason || raw.note || "Rigenerazione richiesta dalla review queue."),
      } : asset.review?.regenerationRequested || null,
    };
    asset.updatedAt = now();
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), asset };
  }

  compareGeneratedAssetVersions(id, assetId) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const asset = (profile.generatedAssets || []).find((item) => item.id === assetId);
    if (!asset) throw new Error("Asset generato non trovato.");
    const comparisons = (profile.versions || []).map((version) => {
      const referenceOverlap = (asset.referenceIds || []).filter((referenceId) =>
        (version.approvedReferences || []).includes(referenceId)
      ).length;
      const versionMatch = version.id === asset.versionId ? 35 : 0;
      const score = Math.min(100, versionMatch + referenceOverlap * 20 + Number(asset.review?.identityScore || 0) * 0.45);
      return {
        versionId: version.id,
        versionNumber: version.versionNumber,
        changeLog: version.changeLog,
        score: Math.round(score),
        referenceOverlap,
        currentAssetVersion: version.id === asset.versionId,
      };
    }).sort((a, b) => b.score - a.score);
    const report = {
      id: crypto.randomUUID(),
      assetId,
      influencerId: profile.id,
      method: "version-reference-overlap-and-identity-score",
      comparisons,
      recommendedVersionId: comparisons[0]?.versionId || asset.versionId,
      createdAt: now(),
    };
    asset.review = {
      ...asset.review,
      versionComparison: report,
    };
    asset.updatedAt = now();
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), asset, comparison: report };
  }

  exportGeneratedAsset(id, assetId, raw = {}) {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error("Profilo Virtual Influencer non trovato.");
    const asset = (profile.generatedAssets || []).find((item) => item.id === assetId);
    if (!asset) throw new Error("Asset generato non trovato.");
    const presets = {
      instagramFeed: { name: "Instagram Feed", aspectRatio: "4:5", width: 1080, height: 1350 },
      instagramStory: { name: "Instagram Story/Reel", aspectRatio: "9:16", width: 1080, height: 1920 },
      tiktok: { name: "TikTok", aspectRatio: "9:16", width: 1080, height: 1920 },
      landscape: { name: "Landscape", aspectRatio: "16:9", width: 1920, height: 1080 },
      square: { name: "Square", aspectRatio: "1:1", width: 1080, height: 1080 },
    };
    const presetId = String(raw.preset || "instagramFeed");
    const preset = presets[presetId] || presets.instagramFeed;
    const record = {
      id: crypto.randomUUID(),
      presetId: presets[presetId] ? presetId : "instagramFeed",
      ...preset,
      sourceAssetId: asset.id,
      preservesMaster: true,
      destructiveCrop: false,
      safeArea: true,
      disclosure: asset.disclosure,
      metadata: {
        influencerId: profile.id,
        versionId: asset.versionId,
        generatedAssetId: asset.id,
        prompt: asset.prompt,
        negativePrompt: asset.negativePrompt,
        seed: asset.seed,
        model: asset.model,
        workflow: asset.workflow,
        validationScores: asset.validationScores,
      },
      createdAt: now(),
    };
    asset.exports = [...(asset.exports || []), record];
    asset.updatedAt = now();
    profile.updatedAt = now();
    this.save();
    return { profile: this.withReadiness(profile), export: record };
  }

  assetPath(profileId, assetId) {
    const profile = this.getProfile(profileId);
    const asset = (profile.referenceAssets || []).find((item) => item.id === assetId);
    if (!asset) return null;
    const filePath = path.join(this.assetDirectory, profileId, asset.filename);
    try {
      const stats = fs.statSync(filePath);
      return stats.isFile() ? { path: filePath, stats, asset } : null;
    } catch {
      return null;
    }
  }

  config() {
    return {
      enabled: this.enabled,
      minDeclaredAge: MIN_DECLARED_AGE,
      referenceCategories: REFERENCE_CATEGORIES,
      identityLocks: IDENTITY_LOCK_KEYS,
      contentLevels: CONTENT_LEVELS,
      outfitCategories: OUTFIT_CATEGORIES,
      locationCategories: LOCATION_CATEGORIES,
      batchLimits: {
        maxItems: 24,
        defaultMaxItems: 12,
        accidentalGenerationGuard: true,
      },
      platforms: PLATFORM_IDS,
      contentProjectStatuses: CONTENT_PROJECT_STATUSES,
      defaultPlatformPolicies: defaultPlatformPolicies(),
      manualPlatformTermsWarning: MANUAL_PLATFORM_TERMS_WARNING,
      performance: {
        cacheIdentityPlans: true,
        cacheMaxEntries: this.cache.maxEntries,
        lazyLoading: true,
        releaseVramBeforeGeneration: true,
        controlledBatching: true,
        cancellation: true,
        progressEvents: true,
        lowVramFallback: "fastPreview",
      },
      debugging: {
        debugReports: true,
        visualGoldenTests: "synthetic-only",
        documentation: "README.md",
      },
      milestone: 6,
    };
  }
}
