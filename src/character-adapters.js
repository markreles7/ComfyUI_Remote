import fs from "node:fs";
import path from "node:path";

function pickReferences(character, limit = 4) {
  const references = Array.isArray(character.references) ? character.references : [];
  const ordered = [
    ...references.filter((item) => item.id === character.heroImage),
    ...references.filter((item) => item.type === "face"),
    ...references.filter((item) => item.type === "full_body" || item.type === "bust"),
    ...references.filter((item) => item.type === "sheet"),
    ...references.filter((item) => item.type === "generic" || item.type === "profile"),
  ];
  const seen = new Set();
  return ordered.filter((item) => {
    if (!item?.id || seen.has(item.id) || item.status === "rejected") return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
}

function booleanOption(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "on", "yes"].includes(String(value).trim().toLowerCase());
}

export function characterPromptPrefix(character, options = {}) {
  if (!character) return "";
  const hints = character.identityHints || {};
  const blueprintIdentity = character.characterBlueprint?.identity || {};
  const locks = [];
  if (booleanOption(options.lockFace, character.settings?.lockFace)) locks.push("preserve face identity");
  if (booleanOption(options.lockHair, character.settings?.lockHair)) locks.push("preserve hair");
  if (booleanOption(options.lockBody, character.settings?.lockBody)) locks.push("preserve body shape");
  if (booleanOption(options.lockOutfit, character.settings?.lockOutfit)) locks.push("preserve outfit");
  return [
    `Virtual Actor: ${character.name}`,
    character.subjectKind && character.subjectKind !== "auto" ? `subject kind: ${character.subjectKind}` : "",
    options.includeDescription === false ? "" : character.description,
    blueprintIdentity.appearance,
    blueprintIdentity.head ? `identity head: ${blueprintIdentity.head}` : "",
    blueprintIdentity.hairOrCoat ? `identity hair or coat: ${blueprintIdentity.hairOrCoat}` : "",
    blueprintIdentity.distinctiveFeatures?.length ? `distinctive features: ${blueprintIdentity.distinctiveFeatures.join(", ")}` : "",
    hints.face ? `face: ${hints.face}` : "",
    hints.hair ? `hair: ${hints.hair}` : "",
    hints.body ? `body: ${hints.body}` : "",
    locks.length ? locks.join(", ") : "",
    `identity strength: ${options.identityStrength || character.settings?.identityStrength || "medium"}`,
  ].filter(Boolean).join(". ");
}

export function resolveCharacterAdapter({
  generationType = "",
  workflowId = "",
  studioMode = "",
  videoStudioMode = "",
  character,
  options = {},
} = {}) {
  if (!character) {
    return {
      promptPrefix: "",
      references: [],
      faceReferences: [],
      bodyReferences: [],
      conditioning: null,
      warnings: [],
      capability: "not configured",
    };
  }

  const references = pickReferences(character, 4);
  const faceReferences = references.filter((item) => item.type === "face");
  const bodyReferences = references.filter((item) => item.type === "full_body" || item.type === "bust");
  const promptPrefix = characterPromptPrefix(character, options);
  const target = [generationType, workflowId, studioMode, videoStudioMode].filter(Boolean).join(":");
  const supportsReferences = /image|studio|qwen|guidedEdit|bible|qwenKreaKlein|kreaTriple/i.test(target);
  const videoAnchorMode = /video|actor|scene|extend|retake|transform/i.test(target);
  return {
    promptPrefix,
    references,
    faceReferences,
    bodyReferences,
    conditioning: {
      type: supportsReferences ? "image-reference" : "prompt-only",
      identityStrength: options.identityStrength || character.settings?.identityStrength || "medium",
      locks: {
        face: booleanOption(options.lockFace, character.settings?.lockFace),
        hair: booleanOption(options.lockHair, character.settings?.lockHair),
        body: booleanOption(options.lockBody, character.settings?.lockBody),
        outfit: booleanOption(options.lockOutfit, character.settings?.lockOutfit),
      },
    },
    warnings: [
      ...(supportsReferences ? [] : ["Questo workflow non espone reference conditioning: applico solo prompt identitario persistente."]),
      ...(videoAnchorMode ? ["Anchor frame automatico per Virtual Actor: not configured; uso reference come input quando il workflow la supporta."] : []),
    ],
    capability: supportsReferences ? "fallback" : "not configured",
  };
}

export async function uploadCharacterReferences({ characterStore, comfy, characterId, limit = 4 } = {}) {
  if (!characterId) return null;
  const character = characterStore.getCharacter(characterId);
  const adapter = resolveCharacterAdapter({ character, options: character.settings, generationType: "upload" });
  const uploads = [];
  for (const reference of adapter.references.slice(0, limit)) {
    const resolved = characterStore.assetPath(character.id, reference.id);
    if (!resolved?.path) continue;
    const buffer = fs.readFileSync(resolved.path);
    uploads.push(await comfy.uploadImage({
      buffer,
      mimetype: reference.mimeType || resolved.mimeType || "image/png",
      originalname: path.basename(reference.filename || reference.originalName || `${reference.id}.png`),
      size: buffer.length,
    }));
  }
  return {
    character,
    adapter,
    uploads,
  };
}

export function withCharacterPrompt(raw, adapter) {
  if (!adapter?.promptPrefix) return raw;
  return {
    ...raw,
    prompt: [adapter.promptPrefix, String(raw.prompt || "").trim()].filter(Boolean).join(". "),
    characterWarnings: adapter.warnings || [],
  };
}

export function buildCharacterAnchorFrameRequest({
  characterId,
  sceneBlueprint = {},
  videoIntent = "",
  outfit = "",
  aspectRatio = "9:16",
  videoEngine = "auto",
  identityStrength = "medium",
} = {}) {
  if (!characterId) throw new Error("Character richiesto per il Video Anchor.");
  const ratio = ["9:16", "16:9", "1:1"].includes(aspectRatio) ? aspectRatio : "9:16";
  const scene = String(sceneBlueprint.scene || sceneBlueprint.location || "a natural coherent setting").trim();
  const framing = String(sceneBlueprint.framing || "medium full shot").trim();
  const intent = String(videoIntent || sceneBlueprint.subjectMotion || "natural poised starting pose").trim();
  const wardrobe = String(outfit || sceneBlueprint.outfit || "preserve the original appearance and outfit").trim();
  return {
    status: "ready",
    characterId,
    sceneBlueprint,
    videoIntent: intent,
    outfit: wardrobe,
    aspectRatio: ratio,
    videoEngine: String(videoEngine || "auto"),
    identityStrength,
    prompt: [
      "Create one conservative photorealistic video anchor frame of the exact same character.",
      `Scene: ${scene}.`,
      `Starting action and pose: ${intent}.`,
      `Framing: ${framing}; aspect ratio ${ratio}.`,
      `Appearance: ${wardrobe}.`,
      "This is the stable first frame for image-to-video: clear anatomy or morphology, balanced stance, coherent lighting, sharp identity-bearing details, no motion blur.",
      "Preserve face or head geometry, hair or coat, body proportions, markings, colors and all distinctive features. Do not redesign the subject.",
    ].join(" "),
    negativePrompt: "identity drift, changed face, changed morphology, changed markings, changed colors, duplicate subject, extra limbs, malformed anatomy, motion blur, text, logo, watermark",
    conservative: true,
    denoise: identityStrength === "high" ? 0.42 : identityStrength === "low" ? 0.62 : 0.5,
  };
}
