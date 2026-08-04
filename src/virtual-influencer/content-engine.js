import {
  MANUAL_PLATFORM_TERMS_WARNING,
  PLATFORM_IDS,
  validateAdultPrompt,
} from "./schema.js";

function text(value) {
  return String(value || "").trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  return text(value).split(/\r?\n|,/).map(text).filter(Boolean);
}

function compact(values) {
  return values.map(text).filter(Boolean);
}

function withoutAvoidedWords(value, avoid = []) {
  let result = text(value);
  for (const word of avoid.map(text).filter(Boolean)) {
    result = result.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "").replace(/\s{2,}/g, " ").trim();
  }
  return result;
}

export function defaultPlatformPolicies() {
  return Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, {
    platform,
    label: platform === "youtubeShorts" ? "YouTube Shorts" : platform,
    aspectRatios: platform === "x" ? ["1:1", "16:9", "9:16"] : ["9:16", "4:5", "1:1"],
    maxDurationSeconds: null,
    maxSizeMb: null,
    disclosureRules: MANUAL_PLATFORM_TERMS_WARNING,
    nudityAllowed: false,
    sensualityAllowed: platform === "fanvue",
    textAllowed: true,
    watermark: false,
    prohibitedContent: [],
    automationLimits: MANUAL_PLATFORM_TERMS_WARNING,
    requiredMetadata: ["syntheticDisclosure"],
    source: "admin-editable/manual",
    sourceDate: null,
    manualVerificationWarning: MANUAL_PLATFORM_TERMS_WARNING,
  }]));
}

export function disclosureFor(profile, platform = "custom") {
  const settings = profile.disclosureSettings || {};
  return {
    platform,
    required: true,
    text: settings.defaultText || "Virtual creator - AI-generated fictional adult character.",
    label: settings.label || "AI-generated fictional adult character",
    badgeEnabled: settings.badgeEnabled !== false,
    watermarkEnabled: Boolean(settings.watermarkEnabled),
    metadataEnabled: settings.metadataEnabled !== false,
    captionTemplate: settings.captionTemplate || "{caption}\n\nVirtual creator - AI-generated fictional adult character.",
    warning: MANUAL_PLATFORM_TERMS_WARNING,
  };
}

export function buildCaptionDraft(profile, raw = {}) {
  const channel = text(raw.channel || raw.contentType || raw.messageType).toLowerCase();
  if (/(dm|direct|private|privat|messaggio privato)/.test(channel)) {
    throw new Error("Non genero messaggi privati ingannevoli: crea solo risposte pubbliche approvate.");
  }
  const language = text(raw.language || profile.identityProfile?.language || "Italiano");
  const platform = text(raw.platform || "instagram");
  const category = text(raw.contentCategory || raw.category || "editorial");
  const objective = text(raw.objective || "engagement");
  const tone = text(raw.tone || profile.personalityProfile?.tone || "caldo e trasparente");
  const length = text(raw.length || "medium");
  const avoid = [
    ...(profile.personalityProfile?.avoidedTopics || []),
    ...list(raw.wordsToAvoid),
  ];
  validateAdultPrompt([
    category,
    objective,
    tone,
    raw.brief,
    ...avoid,
  ]);
  const lexicon = profile.personalityProfile?.lexicon || [];
  const phrase = profile.personalityProfile?.recurringPhrases?.[0] || "";
  const interests = profile.identityProfile?.interests || [];
  const brief = text(raw.brief || `${category} per ${objective}`);
  const disclosure = disclosureFor(profile, platform);
  const base = withoutAvoidedWords([
    brief,
    interests.length ? `Focus: ${interests.slice(0, 3).join(", ")}.` : "",
    lexicon.length ? `Mood words: ${lexicon.slice(0, 4).join(", ")}.` : "",
    phrase,
  ].filter(Boolean).join(" "), avoid);
  const captionCore = `${base} ${objective ? `Obiettivo: ${objective}.` : ""}`.trim();
  const caption = disclosure.captionTemplate.replace("{caption}", captionCore);
  const hashtags = [
    "#VirtualCreator",
    "#AIGenerated",
    `#${platform.replace(/[^\w]+/g, "") || "Content"}`,
    category ? `#${category.replace(/[^\w]+/g, "")}` : "",
  ].filter(Boolean);
  return {
    platform,
    contentCategory: category,
    objective,
    language,
    tone,
    length,
    caption: withoutAvoidedWords(caption, avoid),
    description: withoutAvoidedWords(`${profile.displayName} in un contenuto ${category}, coerente con la sua identità sintetica adulta.`, avoid),
    bio: profile.disclosureSettings?.bioTemplate || disclosure.text,
    hashtags,
    callToAction: withoutAvoidedWords(raw.callToAction || "Dimmi cosa vuoi vedere nel prossimo contenuto pubblico.", avoid),
    publicReply: withoutAvoidedWords(`Grazie! ${disclosure.label}.`, avoid),
    videoScript: withoutAvoidedWords(`${profile.displayName} apre con uno sguardo in camera, mostra il momento chiave e chiude con una CTA pubblica.`, avoid),
    serialPlan: compact([
      `Post 1: setup ${category}`,
      `Post 2: dettaglio outfit/location`,
      `Post 3: risposta pubblica e recap`,
    ]),
    disclosure,
    approvalRequired: true,
    status: "draft",
    warnings: [MANUAL_PLATFORM_TERMS_WARNING, "Richiede approvazione umana prima della pubblicazione."],
  };
}
