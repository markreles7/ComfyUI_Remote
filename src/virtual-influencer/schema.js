export const MIN_DECLARED_AGE = 21;

export const CONTENT_LEVELS = [
  { id: 0, name: "Everyday", adultRestricted: false },
  { id: 1, name: "Glamour", adultRestricted: false },
  { id: 2, name: "Bold Fashion", adultRestricted: false },
  { id: 3, name: "Boudoir", adultRestricted: false },
  { id: 4, name: "Adult Restricted", adultRestricted: true, enabledByDefault: false },
];

export const REFERENCE_CATEGORIES = [
  "frontale",
  "profilo sinistro",
  "profilo destro",
  "tre quarti",
  "primo piano",
  "mezzo busto",
  "figura intera",
  "espressione neutra",
  "sorriso",
  "seria",
  "luce naturale",
  "luce interna",
  "luce notturna",
  "capelli sciolti",
  "capelli raccolti",
];

export const IDENTITY_LOCK_KEYS = [
  "face",
  "eyes",
  "hair",
  "skinTone",
  "bodyShape",
  "height",
  "proportions",
  "distinctiveMarks",
  "tattoos",
  "apparentAge",
  "makeupStyle",
];

export const OUTFIT_CATEGORIES = [
  "casual",
  "sportivo",
  "elegante",
  "streetwear",
  "sera",
  "spiaggia",
  "cosplay non protetto",
  "glamour",
  "lingerie",
  "custom",
];

export const LOCATION_CATEGORIES = [
  "casa",
  "camera da letto",
  "salotto",
  "palestra",
  "spiaggia",
  "città",
  "ristorante",
  "hotel",
  "piscina",
  "studio fotografico",
  "outdoor",
  "custom",
];

export const PLATFORM_IDS = [
  "instagram",
  "tiktok",
  "youtubeShorts",
  "x",
  "fanvue",
  "custom",
];

export const CONTENT_PROJECT_STATUSES = [
  "Draft",
  "Generating",
  "Review",
  "Approved",
  "Rejected",
  "Scheduled",
  "Published",
  "Archived",
];

export const MANUAL_PLATFORM_TERMS_WARNING = "Verifica manualmente i termini della piattaforma prima della pubblicazione.";

const PROHIBITED_AGE_TERMS = [
  "teen",
  "teenage",
  "schoolgirl",
  "school boy",
  "schoolboy",
  "underage",
  "minor",
  "minorenne",
  "adolescente",
  "liceale",
  "ragazzina",
  "ragazzino",
];

function text(value) {
  return String(value || "").trim();
}

function textList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/\r?\n|,/).map(text).filter(Boolean);
}

function booleanValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === "on" || value === "1";
}

function objectValue(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function numberValue(value, fallback, min, max) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error("Valore numerico non valido.");
  }
  return parsed;
}

function slugify(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/[_\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "virtual-character";
}

function assertAdultAge(age) {
  if (!Number.isInteger(age) || age < MIN_DECLARED_AGE) {
    throw new Error(`L'età dichiarata deve essere almeno ${MIN_DECLARED_AGE} anni.`);
  }
}

function assertNoAgeAmbiguity(values) {
  const haystack = values.map(text).join(" ").toLowerCase();
  const blocked = PROHIBITED_AGE_TERMS.find((term) => haystack.includes(term));
  if (blocked) {
    throw new Error(`Termine non consentito per un personaggio adulto: ${blocked}`);
  }
}

export function validateAdultPrompt(values) {
  assertNoAgeAmbiguity(Array.isArray(values) ? values : [values]);
  return true;
}

function defaultIdentityLocks(rawLocks = {}) {
  return Object.fromEntries(IDENTITY_LOCK_KEYS.map((key) => {
    const raw = rawLocks[key] || {};
    return [key, {
      enabled: booleanValue(raw.enabled, false),
      strength: numberValue(raw.strength, 0.75, 0, 1),
      tolerance: numberValue(raw.tolerance, 0.25, 0, 1),
      referenceSet: textList(raw.referenceSet),
      validationThreshold: numberValue(raw.validationThreshold, 0.7, 0, 1),
    }];
  }));
}

export function normalizeCharacterBible(raw = {}) {
  const identity = raw.identity || raw.identityProfile || {};
  const appearance = raw.appearance || raw.appearanceProfile || {};
  const declaredAge = Math.round(numberValue(identity.declaredAge ?? raw.declaredAge, MIN_DECLARED_AGE, 0, 120));
  assertAdultAge(declaredAge);
  const bible = {
    identity: {
      stageName: text(identity.stageName || raw.displayName),
      declaredAge,
      fictionalNationality: text(identity.fictionalNationality),
      fictionalCity: text(identity.fictionalCity),
      language: text(identity.language || "Italiano"),
      narrativeProfession: text(identity.narrativeProfession),
      shortBio: text(identity.shortBio),
      personalHistory: text(identity.personalHistory),
      interests: textList(identity.interests),
      values: textList(identity.values),
      habits: textList(identity.habits),
      personalityTraits: textList(identity.personalityTraits),
      communicationTone: text(identity.communicationTone),
      typicalLexicon: textList(identity.typicalLexicon),
      recurringPhrases: textList(identity.recurringPhrases),
      avoidedTopics: textList(identity.avoidedTopics),
    },
    appearance: {
      faceShape: text(appearance.faceShape),
      eyeColorAndShape: text(appearance.eyeColorAndShape),
      hair: text(appearance.hair),
      skinTone: text(appearance.skinTone),
      bodyShape: text(appearance.bodyShape),
      approximateHeight: text(appearance.approximateHeight),
      bodyProportions: text(appearance.bodyProportions),
      distinctiveMarks: text(appearance.distinctiveMarks),
      makeup: text(appearance.makeup),
      aestheticStyle: text(appearance.aestheticStyle),
      recurringAccessories: textList(appearance.recurringAccessories),
      tattoos: booleanValue(appearance.tattoosEnabled)
        ? text(appearance.tattoos)
        : "",
      immutableElements: textList(appearance.immutableElements),
      tattoosEnabled: booleanValue(appearance.tattoosEnabled),
    },
    identityLocks: defaultIdentityLocks(raw.identityLocks),
  };
  assertNoAgeAmbiguity([
    bible.identity.stageName,
    bible.identity.shortBio,
    bible.identity.personalHistory,
    bible.identity.narrativeProfession,
    bible.appearance.aestheticStyle,
    ...bible.appearance.immutableElements,
  ]);
  return bible;
}

export function normalizeProfileInput(raw = {}) {
  const displayName = text(raw.displayName || raw.stageName);
  if (!displayName) throw new Error("Inserisci il nome artistico del personaggio.");
  const bible = normalizeCharacterBible({
    ...raw,
    identity: {
      ...(raw.identity || {}),
      stageName: raw.identity?.stageName || displayName,
      declaredAge: raw.identity?.declaredAge ?? raw.declaredAge,
    },
  });
  const synthetic = booleanValue(raw.synthetic, true);
  if (!synthetic) throw new Error("Il profilo deve essere contrassegnato come personaggio virtuale o sintetico.");
  const imitatesRealPerson = booleanValue(raw.imitatesRealPerson);
  if (imitatesRealPerson) {
    throw new Error("Non sono supportati personaggi che imitano intenzionalmente persone reali senza autorizzazione.");
  }
  return {
    displayName,
    slug: slugify(raw.slug || displayName),
    status: ["draft", "active", "archived"].includes(raw.status) ? raw.status : "draft",
    ownerId: text(raw.ownerId || "local-user"),
    disclosureSettings: {
      synthetic,
      required: true,
      label: text(raw.disclosureSettings?.label || "AI-generated fictional adult character"),
      defaultText: text(raw.disclosureSettings?.defaultText || "Virtual creator - AI-generated fictional adult character."),
      watermarkEnabled: booleanValue(raw.disclosureSettings?.watermarkEnabled),
      badgeEnabled: booleanValue(raw.disclosureSettings?.badgeEnabled, true),
      metadataEnabled: booleanValue(raw.disclosureSettings?.metadataEnabled, true),
      bioTemplate: text(raw.disclosureSettings?.bioTemplate || "Virtual creator - AI-generated fictional adult character."),
      captionTemplate: text(raw.disclosureSettings?.captionTemplate || "{caption}\n\nVirtual creator - AI-generated fictional adult character."),
      history: Array.isArray(raw.disclosureSettings?.history) ? raw.disclosureSettings.history : [],
    },
    identityProfile: bible.identity,
    appearanceProfile: bible.appearance,
    bodyProfile: raw.bodyProfile && typeof raw.bodyProfile === "object" ? raw.bodyProfile : {},
    voiceProfile: normalizeVoiceProfileInput({
      language: bible.identity.language,
      ...(raw.voiceProfile && typeof raw.voiceProfile === "object" ? raw.voiceProfile : {}),
    }),
    personalityProfile: {
      traits: bible.identity.personalityTraits,
      tone: bible.identity.communicationTone,
      lexicon: bible.identity.typicalLexicon,
      recurringPhrases: bible.identity.recurringPhrases,
      avoidedTopics: bible.identity.avoidedTopics,
    },
    wardrobeProfile: raw.wardrobeProfile && typeof raw.wardrobeProfile === "object" ? raw.wardrobeProfile : {},
    outfitLibrary: [],
    locationLibrary: [],
    batchQueues: [],
    contentRules: {
      maxContentLevel: Math.min(3, Math.max(0, Number(raw.contentRules?.maxContentLevel ?? 2))),
      adultRestrictedEnabled: false,
      prohibitedTerms: PROHIBITED_AGE_TERMS,
      noRealPersonImitation: true,
      noUnauthorizedFaceSwap: true,
    },
    platformRules: raw.platformRules && typeof raw.platformRules === "object" ? raw.platformRules : {},
    referenceAssets: [],
    trainedAssets: [],
    generatedAssets: [],
    captionDrafts: [],
    contentProjects: [],
    analyticsEntries: [],
    generationDefaults: raw.generationDefaults && typeof raw.generationDefaults === "object" ? raw.generationDefaults : {
      imageModelFamily: "flux2",
      editModelFamily: "qwenEdit",
      videoModelFamily: "ltx23",
      qualityPreset: "fastPreview",
    },
    moderationSettings: {
      minDeclaredAge: MIN_DECLARED_AGE,
      blockAgeAmbiguousPrompts: true,
      requireSyntheticDisclosure: true,
      humanApprovalRequired: true,
    },
    metadata: {
      schemaVersion: 1,
      featureFlag: "virtualInfluencerStudio",
      ...(raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}),
    },
    identityLocks: bible.identityLocks,
  };
}

export function normalizeVoiceProfileInput(raw = {}) {
  return {
    enabled: booleanValue(raw.enabled),
    provider: text(raw.provider),
    voiceId: text(raw.voiceId),
    language: text(raw.language || "Italiano"),
    accent: text(raw.accent),
    speed: numberValue(raw.speed, 1, 0.5, 2),
    pitch: numberValue(raw.pitch, 1, 0.5, 2),
    energy: numberValue(raw.energy, 0.7, 0, 1),
    style: text(raw.style),
    pronunciationRules: textList(raw.pronunciationRules),
    licensed: booleanValue(raw.licensed),
    syntheticOriginal: booleanValue(raw.syntheticOriginal),
    consentMetadata: objectValue(raw.consentMetadata, null),
  };
}

export function assertVoiceProfileAllowed(voiceProfile) {
  if (!voiceProfile.enabled) return true;
  if (!voiceProfile.provider || !voiceProfile.voiceId) {
    throw new Error("Per abilitare la voce servono provider e voiceId.");
  }
  if (!voiceProfile.syntheticOriginal && !voiceProfile.licensed && !voiceProfile.consentMetadata) {
    throw new Error("Sono supportate solo voci sintetiche originali, con licenza o consenso verificabile.");
  }
  return true;
}

export function normalizePlatformPolicyInput(raw = {}) {
  const platform = PLATFORM_IDS.includes(raw.platform) ? raw.platform : text(raw.platform || "custom") || "custom";
  return {
    platform,
    label: text(raw.label || platform),
    aspectRatios: textList(raw.aspectRatios || raw.aspectRatio),
    maxDurationSeconds: raw.maxDurationSeconds === undefined || raw.maxDurationSeconds === ""
      ? null
      : numberValue(raw.maxDurationSeconds, 0, 0, 86400),
    maxSizeMb: raw.maxSizeMb === undefined || raw.maxSizeMb === ""
      ? null
      : numberValue(raw.maxSizeMb, 0, 0, 102400),
    disclosureRules: text(raw.disclosureRules),
    nudityAllowed: booleanValue(raw.nudityAllowed),
    sensualityAllowed: booleanValue(raw.sensualityAllowed, true),
    textAllowed: booleanValue(raw.textAllowed, true),
    watermark: booleanValue(raw.watermark),
    prohibitedContent: textList(raw.prohibitedContent),
    automationLimits: text(raw.automationLimits),
    requiredMetadata: textList(raw.requiredMetadata),
    source: text(raw.source || "admin-editable/manual"),
    sourceDate: text(raw.sourceDate),
    manualVerificationWarning: MANUAL_PLATFORM_TERMS_WARNING,
    updatedBy: text(raw.updatedBy || "local-user"),
  };
}

export function normalizeContentProjectInput(raw = {}, profile = {}) {
  const title = text(raw.title);
  if (!title) throw new Error("Inserisci il titolo del progetto contenuto.");
  const platform = text(raw.platform || "instagram");
  const status = CONTENT_PROJECT_STATUSES.includes(raw.status) ? raw.status : "Draft";
  return {
    influencerId: profile.id || text(raw.influencerId),
    title,
    campaign: text(raw.campaign),
    platform,
    contentType: text(raw.contentType || "photo"),
    status,
    brief: text(raw.brief),
    generatedAssets: textList(raw.generatedAssets),
    approvedAssets: textList(raw.approvedAssets),
    captions: textList(raw.captions),
    disclosures: textList(raw.disclosures),
    scheduledAt: text(raw.scheduledAt),
    publishedAt: text(raw.publishedAt),
    analytics: [],
  };
}

export function normalizeAnalyticsInput(raw = {}) {
  return {
    views: Math.max(0, Math.round(Number(raw.views || 0))),
    likes: Math.max(0, Math.round(Number(raw.likes || 0))),
    comments: Math.max(0, Math.round(Number(raw.comments || 0))),
    shares: Math.max(0, Math.round(Number(raw.shares || 0))),
    saves: Math.max(0, Math.round(Number(raw.saves || 0))),
    watchTimeSeconds: Math.max(0, Number(raw.watchTimeSeconds || 0)),
    completionRate: Math.max(0, Math.min(1, Number(raw.completionRate || 0))),
    clicks: Math.max(0, Math.round(Number(raw.clicks || 0))),
    followersAcquired: Math.max(0, Math.round(Number(raw.followersAcquired || 0))),
    conversions: Math.max(0, Math.round(Number(raw.conversions || 0))),
    outfitId: text(raw.outfitId),
    locationId: text(raw.locationId),
    format: text(raw.format),
    platform: text(raw.platform),
    source: text(raw.source || "manual"),
    csvImported: booleanValue(raw.csvImported),
  };
}

export function identitySignature(profile, approvedReferences = []) {
  return {
    displayName: profile.displayName,
    declaredAge: profile.identityProfile.declaredAge,
    identityProfile: profile.identityProfile,
    appearanceProfile: profile.appearanceProfile,
    identityLocks: profile.identityLocks,
    approvedReferenceIds: approvedReferences.map((item) => item.id),
  };
}

export function validateContentLevel(level, profile) {
  const parsed = Number(level);
  const definition = CONTENT_LEVELS.find((item) => item.id === parsed);
  if (!definition) throw new Error("Livello contenuto non valido.");
  assertAdultAge(profile.identityProfile.declaredAge);
  if (definition.adultRestricted && !profile.contentRules.adultRestrictedEnabled) {
    throw new Error("Adult Restricted è disabilitato per impostazione predefinita.");
  }
  return definition;
}

export function normalizeOutfitInput(raw = {}) {
  const name = text(raw.name);
  if (!name) throw new Error("Inserisci il nome dell'outfit.");
  const category = OUTFIT_CATEGORIES.includes(raw.category) ? raw.category : "custom";
  const sensualityLevel = Math.min(4, Math.max(0, Math.round(Number(raw.sensualityLevel ?? 0))));
  validateAdultPrompt([
    name,
    raw.description,
    raw.colors,
    raw.materials,
    raw.accessories,
    raw.promptFragments,
    raw.negativePromptFragments,
  ]);
  return {
    name,
    category,
    description: text(raw.description),
    referenceImages: [],
    colors: textList(raw.colors),
    materials: textList(raw.materials),
    accessories: textList(raw.accessories),
    allowedPlatforms: textList(raw.allowedPlatforms),
    sensualityLevel,
    promptFragments: textList(raw.promptFragments || raw.description),
    negativePromptFragments: textList(raw.negativePromptFragments),
  };
}

export function normalizeLocationInput(raw = {}) {
  const name = text(raw.name);
  if (!name) throw new Error("Inserisci il nome della location.");
  const type = LOCATION_CATEGORIES.includes(raw.type) ? raw.type : "custom";
  validateAdultPrompt([
    name,
    raw.description,
    raw.lightingPreset,
    raw.cameraPreset,
    raw.promptFragments,
  ]);
  return {
    name,
    description: text(raw.description),
    type,
    referenceAssets: [],
    lightingPreset: text(raw.lightingPreset),
    cameraPreset: text(raw.cameraPreset),
    sceneProfile: raw.sceneProfile && typeof raw.sceneProfile === "object" ? raw.sceneProfile : null,
    promptFragments: textList(raw.promptFragments || raw.description),
    allowedContentLevels: textList(raw.allowedContentLevels).length
      ? textList(raw.allowedContentLevels).map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 4)
      : [0, 1, 2, 3],
  };
}
