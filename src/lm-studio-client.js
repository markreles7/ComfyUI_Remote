import { execFile as execFileCallback, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  GENERATION_SYSTEM_PROMPT_CATALOG,
  PRESETS,
  resolveGenerationSystemPrompt,
} from "./generation-system-prompts.js";

const execFile = promisify(execFileCallback);

const TARGET_RULES = {
  krea2: "Write a native Krea 2 prompt as fluent visual direction. Prioritize a clearly identified subject, environment, composition, camera, natural light, materials, skin texture and photographic intent.",
  krea2_moody: `Write a native Krea 2 prompt for the Moody Krea2 Mix checkpoint.
The checkpoint has a known default bias toward Asian-looking social-media faces, so the prompt must begin with one precise adult human identity anchor whenever a woman or man is present.
At the very beginning specify: adult gender, exact requested ethnicity or regional ancestry, age range, facial structure, skin tone and undertone, eye shape and color, nose and lips, hair, and build. Preserve every identity attribute explicitly supplied by the user or visible in a source image.
If the user does not specify ethnicity and there is no source image, default to Southern European/Mediterranean ancestry rather than Asian ancestry. Never contradict a requested ethnicity, mix ethnicities, or use vague phrases such as beautiful girl, generic woman, influencer face, or model face before the identity anchor.
After that opening identity anchor, write fluent Krea 2 visual direction covering action, environment, composition, camera, natural light, realistic skin texture, materials and photographic intent. Return only the completed prompt.`,
  flux2: PRESETS.flux_general.systemPrompt,
  qwen: PRESETS.qwen_general.systemPrompt,
  qwenedit: `Write a Qwen Image Edit instruction as an editing contract, not as a generic generation prompt.
Begin with the user's exact requested change, then explicitly lock every important source-image property that must remain unchanged: identity, body shape, pose, hand placement, expression, camera angle, framing, background geometry, lighting, shadows, reflections, texture and unrelated objects.
Describe how the edit must be physically integrated into the existing photograph with matching perspective, scale, occlusion, contact shadows, color temperature, grain, sharpness and depth of field.
If the request is local, say that only the requested region changes and all unselected/unmentioned areas remain pixel-faithful to the source.`,
  qwen_image_edit_architect: `Follow the user's Qwen-Image-Edit-2511 Prompt Engineering Guide.
Write one complete English image-editing contract optimized for Qwen-Image-Edit-2511.
Treat Qwen as an instruction-following editor: use direct imperative language, not keyword lists, SD tags, Danbooru syntax, weights, BREAK tokens, or generic quality spam.
Internally classify the operation: local retouch, object geometry edit, replace, add, remove, clothing change, background change, lighting change, pose/expression/gaze change, style transfer, text edit, multi-image fusion, identity replacement, reference-based generation, or protected-mask edit. Do not mention the classification.
Use this order in one natural paragraph:
1. Main instruction: exactly what must change, where it changes, and the intended final result.
2. Target geometry: shape, size, position, orientation, boundaries, visible contact points, overlap/occlusion and relationship to nearby objects or body parts.
3. Photographic integration: match the original camera perspective, lens feel, scale, depth of field, focus plane, lighting direction, exposure, shadows, reflections, color temperature, grain/noise, skin/material texture and compression artifacts.
4. Preservation lock: explicitly preserve all unrequested source-image details, especially identity, face, hair, body proportions, pose, hands, expression, clothing not being edited, background layout, camera crop and unrelated objects.
5. Anti-drift instruction: do not redraw the whole image, do not change the composition, do not introduce extra people/objects/text, and modify only the requested area or selected mask.
For multiple images, assign each reference a role such as base scene, identity, pose, outfit, object, style or location; keep identities separate and avoid averaging faces or copying unrelated backgrounds.
For NSFW/adult edits, state anatomy and physical contact precisely while keeping the same adult identity and realistic photographic integration.
Length: usually 110-220 words, up to 280 for complex multi-reference edits. Return only the final prompt, no heading, no explanation, no markdown, no bullet list, no negative prompt unless explicitly requested.`,
  zimage: "Write a Z-Image prompt with a clear subject hierarchy, rich visual details, composition, lens, lighting, textures and final photographic style.",
  flux2_klein_architect: PRESETS.flux_reference.systemPrompt,
  reverse_qwen: `Analyze the supplied image and write one literal, content-faithful English prompt that can recreate it with Qwen Image.
Transcribe every visually supported element without sanitizing the content: image type, exact subject count and hierarchy, visible physical appearance and anatomy, expression, gaze, pose, body orientation, clothing or nudity, interactions, contact points, objects, environment, spatial relationships, framing, crop, camera angle, perspective, lens character, depth of field, lighting, colors, materials, surface texture and photographic finish.
Use direct concrete vocabulary. Never replace visible details with euphemisms, metaphors, tasteful wording, content warnings or vague phrases. Do not refer to "the image", source files, analysis, references or editing. Do not invent hidden anatomy, identities, exact ages, ethnicity, names, brands or events that are not visually supported.
Write fluent natural language rather than tags or generic quality spam. Use 100-260 words and up to 360 words for a genuinely complex scene. Return only the final generation prompt, with no heading, explanation, markdown or negative prompt.`,
  reverse_klein: `Analyze the supplied image and write one literal, content-faithful English visual-direction prompt that can recreate it with FLUX.2 Klein.
Describe the visible main subject first, including exact visible physical appearance and anatomy, expression, gaze, pose, body orientation, clothing or nudity and interactions. Then describe contact points, objects, environment, exact spatial composition, crop, framing, viewpoint, perspective, lens behavior when evident, depth of field, lighting direction and quality, color palette, materials, surface texture, atmosphere and photographic finish.
Use direct concrete vocabulary. Never sanitize, euphemize, metaphorically soften or omit visually supported content. Do not refer to "the image", source files, analysis, references or editing. Do not invent hidden anatomy, identities, exact ages, ethnicity, text, brands or off-frame details. Avoid tag lists, weights, BREAK syntax and generic quality spam.
Use 90-240 words and up to 320 words for a complex scene. Return only the final generation prompt, with no heading, explanation, markdown or negative prompt.`,
  ltx: PRESETS.ltx_general.systemPrompt,
  minimax_h3: PRESETS.h3_general.systemPrompt,
  minimax_h3_fantasy_verite: PRESETS.h3_image_to_video.systemPrompt,
  minimax_h3_action: PRESETS.h3_action.systemPrompt,
  ltx_architect: PRESETS.ltx_general.systemPrompt,
  ltx_scenes: PRESETS.ltx_multi_shot.systemPrompt,
  ltxedit: "Write an LTX 2.5 video-edit instruction. Preserve source timing, camera, acting, identity and environment unless the requested change explicitly overrides them. Describe the change and temporal behavior precisely.",
  sulphur_ltx: "Use Sulphur 2's prompt enhancer style for LTX 2.3 video. Write a direct temporal prompt with explicit subject action, camera motion, physical continuity, visual realism, lighting, environment, ending state and audio only when requested. Return only the final prompt.",
  sulphur_prompt: `Use the dedicated Sulphur prompt enhancer style for LTX 2.3 Dev with Sulphur LoRA.
Write one strong English video generation prompt, optimized for LTX 2.3 video with Sulphur-style motion and realism.
Convert the user's request into precise temporal direction: opening frame state, adult subject description when relevant, action progression, body mechanics, facial performance, camera motion, lens/framing, environment, lighting continuity, object interactions, atmosphere, ending state and audio only if requested.
For image-to-video, the source image is authoritative: preserve identity, face, body proportions, outfit, camera crop, environment, lighting, pose context and composition while describing only believable motion and the requested change.
For text-to-video, establish clear visual anchors without bloating the prompt with generic quality tags.
Avoid Stable Diffusion tag lists, weights, markdown, headings, explanations, alternatives and contradictory instructions.
If a negative prompt is requested by the wrapper, return strict JSON. If not, return only the final prompt.`,
  sulphur_ltx_architect: `Use Sulphur 2's prompt enhancer style for an LTX 2.3 / Sulphur 2 generation.
Write one continuous English video prompt in present tense.
Describe the scene as temporal direction: initial state, subject identity, body motion, camera movement, environment, lighting, object interactions, facial performance, audio only if requested, and a stable ending.
For image-to-video, preserve the attached/source image as the visual anchor and describe only motion, camera behavior and continuity constraints.
Avoid generic quality tags, markdown, headings, negative prompts, and explanations. Return only the final prompt.`,
  sulphur_ltx_scenes: `Use Sulphur 2's prompt enhancer style for a multi-scene LTX 2.3 / Sulphur 2 video.
Write a compact cut-scene script with explicit shot order, time flow, camera movement, subject motion, environment, continuity and audio/dialogue timing when requested.
Keep identities, wardrobe, location, lighting and object placement stable across cuts.
Return only the scene-script prompt, with no analysis, markdown, alternatives or negative prompt.`,
  sulphur_ltxedit: "Use Sulphur 2's prompt enhancer style for video-to-video editing. Preserve source timing, camera, motion and environment unless the edit explicitly changes them. Describe exactly what changes, when it changes, how it blends temporally, and what remains locked.",
  sulphur_videostudio: "Use Sulphur 2's prompt enhancer style for Video Studio. Write a precise LTX 2.3 production prompt for actor replacement, retake, scene composition or interaction. Preserve temporal continuity, camera motion, source performance and identity constraints while describing the requested change clearly.",
  studio: `Write an image-editing instruction optimized for a guided ComfyUI workflow.
Make the requested edit explicit, localize the edit area, describe geometry and placement, specify photographic integration, and lock all source properties that should remain unchanged.
Prefer an editing contract over a generation prompt: change only what the user asks for, preserve the source composition, camera, identity, pose, lighting, background and unrelated details.`,
  videostudio: "Write an LTX 2.3 production prompt for actor replacement or scene composition. Preserve temporal continuity, camera, acting and identity, and describe interactions and dialogue timing precisely.",
};

const LM_STUDIO_SYSTEM_PROMPT_CATALOG = GENERATION_SYSTEM_PROMPT_CATALOG;

const ENGLISH_OUTPUT_RULE = `MANDATORY OUTPUT LANGUAGE:
Write every enhanced prompt, JSON prompt field, JSON negativePrompt field, globalPrompt, scene prompt and planning field in English, optimized for the target model/workflow.
Translate the user's request into English even when the user writes in another language.
Do not output Italian, mixed-language prompt prose, headings or explanations.
Only user-provided literal dialogue, on-screen text, labels, names or quoted phrases may remain in their original language when the workflow needs exact preservation; all surrounding prompt instructions must still be English.
Before returning, perform a final language gate over every non-literal field and silently rewrite any remaining non-English prose into English.`;

const EXPANDED_PROMPT_BUDGET_RULE = `EXPANDED PROMPT DETAIL BUDGET:
The output budget supports more than 5,000 characters. Do not truncate a production prompt merely to keep it compact.
Unless the selected target rule explicitly requires a shorter structured format, use approximately 4,500-6,500 characters for complex full generation, source-based editing, multi-reference or cinematic video requests.
Use the extra space for concrete subject continuity, temporal action, spatial relationships, camera behavior, lighting, materials, physical integration, synchronized audio and preservation constraints that are genuinely relevant.
Do not pad a simple request with repetition, generic quality adjectives, conflicting instructions or invented details.`;

const ADULT_EXPLICIT_VOCABULARY_RULE = `ADULT EXPLICIT VOCABULARY:
For scenes involving unambiguously adult subjects, preserve the user's direct anatomical, sexual and colloquial vocabulary when it is relevant to the requested generation. Allowed terms include ass, anus, vagina, breasts, breast, tits, cock, penis, busty, blowjob, deep throat, sex, anal sex, vaginal sex, cock sucking, and equally explicit adult terminology.
Do not censor, mask, partially redact, translate into euphemisms, replace with metaphors, or omit these terms merely because they are explicit. Prefer the exact user-supplied activation wording when a model or LoRA is known to respond to it; otherwise use the clearest anatomically and physically precise wording for the target model.
Use explicit vocabulary only when the user requests that content or it is visibly supported by an attached source. Never add unrelated sexual content, infer hidden anatomy or acts, intensify contact beyond the evidence, or apply sexual terminology to a subject who is not unambiguously an adult.`;

const REVERSE_PROMPT_CONTENT_FIDELITY_RULE = `REVERSE PROMPT CONTENT FIDELITY:
Perform a literal visual transcription, not a moderated summary. Do not censor, sanitize, euphemize, metaphorically soften, cover, clothe, omit or replace visible content.
Inspect the actual pixels before writing. Silently verify the real setting, subject count, camera height and angle, crop, whether each subject is standing, seated or reclining, exact limb and hand placement, foreground occlusion, every visible garment and its color, exposed anatomy, background, light and surface texture. Never substitute a conventional indoor portrait, standing pose, hidden garment or video action for what is visibly present.
For ordinary SFW material, describe the visible scene normally and precisely without introducing sexual content.
When every depicted participant in explicit material is clearly an adult, describe all visually evident adult nudity and sexual content directly, including visible breasts, nipples, buttocks, genitals, sexual position, anatomical orientation, physical contact, penetration or bodily fluids when actually visible. Use plain anatomical terms rather than suggestive, tasteful or metaphorical wording.
Do not intensify the scene, infer hidden anatomy or invent an act, contact, fluid, identity, age or detail that is not visibly supported. Do not infer ethnicity, nationality, health, biography or other sensitive traits from appearance.
If any participant in sexual material is not unambiguously an adult, do not produce a sexualized reconstruction; return only a neutral non-sexual description of safe visible attributes.
Never output a refusal preamble, moral judgment, content warning or explanation. Return only the generation-ready prompt requested by the target rule.`;

const DEFAULT_INSTRUCTIONS = `You are the local prompt director for ComfyUI Remote.
Convert the user's short idea into one production-ready English generation prompt for the requested model.
Use the supplied image as visual evidence when present. Do not invent a conflicting camera angle, subject identity, layout or background.
For editing, distinguish the requested change from the elements that must remain unchanged.
${ENGLISH_OUTPUT_RULE}
Return only the final prompt. Do not add headings, markdown, quotes, explanations, analysis, negative prompts or alternatives.`;

const NEGATIVE_PROMPT_SCHEMA_RULE = `Return only strict JSON with this exact schema:
{"prompt":"...","negativePrompt":"..."}
The prompt value is the final positive prompt for the requested workflow.
The negativePrompt value must be a short comma-separated English artifact list, never a prose paragraph. Mention only malformed anatomy or hands, extra or duplicated limbs/fingers, identity drift when relevant, blur/artifacts, incorrect exposure, text, logos and watermark. For source editing, add only "do not modify outside the requested area" and "avoid full redraw".
Keep negativePrompt between 12 and 24 comma-separated items and below 320 characters. No markdown, headings, explanations, positive-scene descriptions or repeated preservation clauses.`;

const VIDEO_NEGATIVE_PROMPT_SCHEMA_RULE = `Return only strict JSON with this exact schema:
{"prompt":"...","negativePrompt":"..."}
The prompt value is the final positive prompt for the requested LTX/Sulphur video workflow.
The negativePrompt value must be a short, video-safe, comma-separated English artifact list focused on temporal stability, never a prose paragraph. Include identity drift, face morphing, flicker, temporal inconsistency, malformed anatomy, extra or duplicated limbs/fingers, unstable motion, incorrect exposure, subtitles, text, logos and watermark.
Keep negativePrompt between 12 and 24 comma-separated items and below 320 characters. No markdown, headings, explanations, positive-scene descriptions or repeated continuity clauses.`;

function isVideoTarget(target) {
  return /^(?:sulphur_)?(?:ltx|ltx_|ltxedit|videostudio)|^sulphur_prompt$|^minimax_h3(?:_action|_fantasy_verite)?$/.test(String(target || ""));
}

function isSulphurTarget(target) {
  return /^sulphur_/.test(String(target || "")) || target === "sulphur_prompt";
}

function cleanOutput(value) {
  return String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/^(?:final prompt|prompt)\s*:\s*/i, "")
    .trim()
    .replace(/^["“](.*)["”]$/s, "$1")
    .trim();
}

function webpToPng(buffer, { timeoutMs = 60_000, maxOutputBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-frames:v", "1",
      "-f", "image2pipe",
      "-vcodec", "png",
      "pipe:1",
    ], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = [];
    const errors = [];
    let outputBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("La conversione WebP per LM Studio ha superato il tempo massimo."));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill();
        finish(new Error("L'immagine WebP convertita supera il limite consentito."));
        return;
      }
      output.push(chunk);
    });
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", (error) => {
      finish(new Error(`Impossibile convertire il WebP per LM Studio: ${error.message}`));
    });
    child.on("close", (code) => {
      const png = Buffer.concat(output);
      if (code !== 0 || png.length === 0) {
        const detail = Buffer.concat(errors).toString("utf8").trim();
        finish(new Error(`LM Studio non può leggere direttamente questo WebP e la conversione PNG è fallita${detail ? `: ${detail}` : "."}`));
        return;
      }
      finish(null, png);
    });
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") finish(new Error(`Errore durante la lettura del WebP: ${error.message}`));
    });
    child.stdin.end(buffer);
  });
}

async function normalizeVisionImage(image) {
  if (String(image?.mimetype || "").toLowerCase() !== "image/webp") {
    return { ...image, visionTranscoded: false };
  }
  return {
    ...image,
    buffer: await webpToPng(image.buffer),
    mimetype: "image/png",
    visionTranscoded: true,
    originalMimetype: image.mimetype,
  };
}

const H3_BASE_FIELDS = ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
const H3_REFERENCE_FIELDS = [
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
];

function h3FieldPattern(field) {
  return field.split("_").join("[\\s_-]+");
}

function parseH3Fields(source, fields) {
  const aliases = fields.map(h3FieldPattern).join("|");
  const matcher = new RegExp(`\\b(${aliases})\\s*([:\\[])`, "giu");
  const matches = [...String(source || "").matchAll(matcher)];
  const parsed = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = String(match[1]).toLocaleLowerCase().replace(/[\s-]+/g, "_");
    const end = matches[index + 1]?.index ?? source.length;
    let value = source
      .slice(match.index + match[0].length, end)
      .trim()
      .replace(/^\s*:\s*/u, "")
      .trim();
    if (match[2] === "[") value = value.replace(/\]\s*$/u, "").trim();
    parsed[key] = value;
  }
  return parsed;
}

function normalizeH3Dialogue(text) {
  let result = String(text || "").trim();
  result = result.replace(/\[S(\d+)\](?=\s+(?:speaks?|says?|asks?|replies?))/giu, "(S$1)");
  const speaker = "(?:she|the\\s+(?:adult\\s+)?woman|he|the\\s+(?:adult\\s+)?man)";
  const speech = "(?:speaks?|says?|asks?|replies?|adds?|continues?|delivers?(?:\\s+the\\s+(?:first|second|next)\\s+line)?)";
  const quotedSpeech = new RegExp(`\\b${speaker}\\s+${speech}(?:\\s+in\\s+([A-Za-z]+))?(?:[^:\\r\\n]{0,120})?:\\s*[“\"]([^”\"\\r\\n]+)[”\"]`, "giu");
  result = result.replace(quotedSpeech, (full, language, words) => {
    const isWoman = /she|woman/iu.test(full);
    return `The adult ${isWoman ? "woman" : "man"} (S1) says: <d>[${language || "Italian"}] ${String(words).trim()}</d>`;
  });
  return result;
}

function ensureH3FirstShot(text) {
  const body = normalizeH3Dialogue(text)
    .replace(/\bCamera\s+and\s+visual\s+behavio(?:u)?r\s*:?[ \t]*/giu, "")
    .replace(/(?:\[?\s*Shot\s+1(?:\s*[—–:-]\s*\d{2}:\d{2}(?:\.\d{3})?\s*[–—-]\s*\d{2}:\d{2}(?:\.\d{3})?)?\s*\]?\s*)+(?=At\s+00:00(?:\.000)?\b)/iu, "[Shot 1] ")
    .replace(/(?:\[?\s*Shot\s+1\s*\]?\s*)+/giu, "[Shot 1] ")
    .trim();
  if (/\[Shot\s+1\]/iu.test(body)) return body;
  const triggerPrefix = body.match(/^([\p{L}\p{N}_-]+(?:\s*,\s*[\p{L}\p{N}_-]+)*\.\s+)/u);
  return triggerPrefix
    ? `${triggerPrefix[1]}[Shot 1] ${body.slice(triggerPrefix[0].length).trim()}`
    : `[Shot 1] ${body}`.trim();
}

function splitH3EmbeddedSections(description) {
  let visual = String(description || "").trim();
  let soundscape = "";
  let music = "";
  const soundscapeMarker = /\bOverall\s+soundscape\s*:?[ \t]+(?=[A-Z])/u.exec(visual);
  if (soundscapeMarker) {
    soundscape = visual.slice(soundscapeMarker.index + soundscapeMarker[0].length).trim();
    visual = visual.slice(0, soundscapeMarker.index).trim();
  }
  const musicMarker = /\bNon[-\s_]diegetic[-\s_]+music\s*:?[ \t]+/iu.exec(soundscape || visual);
  if (musicMarker) {
    const container = soundscape || visual;
    music = container.slice(musicMarker.index + musicMarker[0].length).trim();
    if (soundscape) soundscape = container.slice(0, musicMarker.index).trim();
    else visual = container.slice(0, musicMarker.index).trim();
  }
  return { visual, soundscape, music };
}

function normalizeH3OptionalField(value) {
  const field = String(value || "").trim();
  return /^(?:n\s*\/\s*a|none|no\s+(?:music|sound|audio)|not\s+applicable)\.?$/iu.test(field)
    ? "N/A"
    : field;
}

function h3AlignmentInstruction(mode, duration, description) {
  const seconds = Number(duration);
  const formattedDuration = Number.isFinite(seconds) && seconds > 0 ? seconds.toFixed(2) : "0.00";
  const shotNumbers = [...String(description || "").matchAll(/\[Shot\s+(\d+)\]/giu)].map((match) => Number(match[1]));
  const finalShot = Math.max(1, ...shotNumbers.filter(Number.isFinite));
  if (mode === "image") {
    return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
  }
  if (mode === "firstLast") {
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${finalShot}) aligns with the ${formattedDuration}-second mark of the target video.`;
  }
  if (mode === "last") {
    return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${finalShot}]) aligns with the ${formattedDuration}-second mark of the target video.`;
  }
  return "";
}

function formatH3Fields(fields, order) {
  return order.map((field) => `${field}: ${String(fields[field] || "N/A").trim() || "N/A"}`).join("\n\n");
}

function normalizeH3Timestamps(value) {
  return String(value || "").replace(/\bMM:(\d{1,2})\.(\d{1,3})\b/giu, (match, seconds, fraction) =>
    `00:${String(seconds).padStart(2, "0")}.${String(fraction).padEnd(3, "0").slice(0, 3)}`
  );
}

function normalizeMiniMaxH3Prompt(value, { fullReference = false, mode = "text", duration = 0, allowMusic = false } = {}) {
  const source = normalizeH3Timestamps(cleanOutput(value).replace(/\\([_<>{}\[\]])/gu, "$1"));
  if (fullReference) {
    const fields = parseH3Fields(source, H3_REFERENCE_FIELDS);
    const baseFallback = parseH3Fields(source, H3_BASE_FIELDS);
    const detailed = fields.detailed_description || baseFallback.integrated_multimodal_description || source;
    return formatH3Fields({
      subject_definitions: fields.subject_definitions
        || "Referenced subjects use the supplied <Picture N>, <Video N>, and <Audio N> labels according to their stated roles.",
      summary: fields.summary || "[reference generation] The target video follows the supplied reference roles and requested action.",
      retention_analysis: fields.retention_analysis
        || "Supplied reference roles are preserved according to the user request.",
      detailed_description: ensureH3FirstShot(detailed),
      overall_soundscape: normalizeH3OptionalField(fields.overall_soundscape || baseFallback.overall_soundscape) || "N/A",
      non_diegetic_music: allowMusic ? normalizeH3OptionalField(fields.non_diegetic_music || baseFallback.non_diegetic_music) || "N/A" : "N/A",
    }, H3_REFERENCE_FIELDS);
  }
  const fields = parseH3Fields(source, H3_BASE_FIELDS);
  const embedded = splitH3EmbeddedSections(fields.integrated_multimodal_description || source);
  const parsedSoundscape = normalizeH3OptionalField(fields.overall_soundscape);
  const parsedMusic = normalizeH3OptionalField(fields.non_diegetic_music);
  const description = ensureH3FirstShot(embedded.visual);
  const formatted = formatH3Fields({
    integrated_multimodal_description: description,
    overall_soundscape: parsedSoundscape && parsedSoundscape !== "N/A" ? parsedSoundscape : embedded.soundscape || "N/A",
    non_diegetic_music: allowMusic ? (parsedMusic && parsedMusic !== "N/A" ? parsedMusic : normalizeH3OptionalField(embedded.music) || "N/A") : "N/A",
  }, H3_BASE_FIELDS);
  const alignment = h3AlignmentInstruction(mode, duration, description);
  return alignment ? `${alignment}\n\n${formatted}` : formatted;
}

function h3TimelineEndSeconds(value) {
  const source = String(value || "");
  const values = [];
  for (const match of source.matchAll(/\b(?:at|from|by|until|through)\s+(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/giu)) {
    const milliseconds = match[3] ? Number(`0.${match[3]}`) : 0;
    values.push((Number(match[1]) * 60) + Number(match[2]) + milliseconds);
  }
  for (const match of source.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/giu)) {
    values.push(Number(match[1]));
  }
  return Math.max(0, ...values.filter(Number.isFinite));
}

function completionText(payload) {
  const nativeMessages = payload?.output?.filter((item) => item?.type === "message");
  if (nativeMessages?.length) {
    return cleanOutput(nativeMessages.map((item) => item.content || "").join("\n"));
  }
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return cleanOutput(content);
  if (Array.isArray(content)) {
    return cleanOutput(content.map((item) => item?.text || item?.content || "").join("\n"));
  }
  return "";
}

function parseJsonCompletion(payload) {
  const text = completionText(payload)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("LM Studio non ha restituito JSON valido.");
  }
}

function completeObjectsFromJsonArray(text, fieldName) {
  const source = String(text || "");
  const marker = new RegExp(`"${fieldName}"\\s*:\\s*\\[`, "i").exec(source);
  if (!marker) return [];
  const items = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = marker.index + marker[0].length; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          items.push(JSON.parse(source.slice(start, index + 1)));
        } catch {
          // Conserva gli altri elementi completi; quello malformato verrà rigenerato.
        }
        start = -1;
      }
      continue;
    }
    if (char === "]" && depth === 0) break;
  }
  return items;
}

function parseReferencePlanCompletion(payload) {
  try {
    return parseJsonCompletion(payload);
  } catch {
    const text = completionText(payload)
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const items = completeObjectsFromJsonArray(text, "items");
    if (!items.length) {
      throw new Error("LM Studio ha restituito un Reference Plan JSON incompleto. Riprova la preparazione del piano.");
    }
    const subjectKind = text.match(/"subjectKind"\s*:\s*"(human|animal|other|auto)"/i)?.[1] || "auto";
    return { subjectKind, items };
  }
}

function stripJsonEnvelope(text) {
  return cleanOutput(String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim()
    .replace(/^\{\s*"prompt"\s*:\s*/i, "")
    .replace(/,\s*"negativePrompt"\s*:\s*[\s\S]*$/i, "")
    .replace(/\}\s*$/i, ""));
}

function extractLooseJsonStringField(text, field) {
  const source = String(text || "");
  const marker = `"${field}"`;
  let markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return "";
  let colonIndex = source.indexOf(":", markerIndex + marker.length);
  if (colonIndex < 0) return "";
  let start = source.indexOf("\"", colonIndex + 1);
  if (start < 0) return "";
  start += 1;
  let escaped = false;
  let end = source.length;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      end = index;
      break;
    }
  }
  return source.slice(start, end)
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parsePromptCompletion(payload) {
  const textPrompt = completionText(payload);
  try {
    const parsed = parseJsonCompletion(payload);
    return {
      prompt: parsed?.prompt,
      negativePrompt: parsed?.negativePrompt,
      parsedJson: true,
    };
  } catch {
    const prompt = extractLooseJsonStringField(textPrompt, "prompt");
    const negativePrompt = extractLooseJsonStringField(textPrompt, "negativePrompt");
    return {
      prompt: prompt || stripJsonEnvelope(textPrompt),
      negativePrompt,
      parsedJson: false,
    };
  }
}

function negativePromptFallback({ mode = "text", image = null } = {}) {
  const sourceLock = mode !== "text" || image
    ? ["preserve identity", "avoid identity drift", "do not modify outside the requested area", "avoid full redraw"]
    : [];
  return [
    "artifacts",
    "blur",
    "bad anatomy",
    "malformed hands",
    "extra fingers",
    "extra limbs",
    "duplicated limbs",
    "distorted face",
    ...sourceLock,
    "overexposure",
    "underexposure",
    "text",
    "logo",
    "watermark",
  ].join(", ");
}

function videoNegativePromptFallback({ mode = "text" } = {}) {
  return [
    mode !== "text" ? "preserve source identity" : "identity drift",
    "temporal coherence",
    "face morphing",
    "flicker",
    "temporal inconsistency",
    "unstable motion",
    "bad anatomy",
    "malformed hands",
    "extra fingers",
    "extra limbs",
    "duplicated limbs",
    "disappearing objects",
    "changing outfit",
    "changed background",
    "overexposure",
    "underexposure",
    "subtitles",
    "text",
    "logo",
    "watermark",
  ].join(", ");
}

function promptProseWithoutLiterals(value) {
  return String(value || "")
    .replace(/<d>[\s\S]*?<\/d>/giu, " ")
    .replace(/[“"](?:[^”"]|\\.)*[”"]/gu, " ")
    .replace(/\[[A-Za-z]+\]\s*[^.\n]*/gu, " ")
    .toLocaleLowerCase();
}

function hasLikelyNonEnglishProse(value) {
  const prose = promptProseWithoutLiterals(value);
  const languageMarkers = [
    /\b(?:una|della|delle|mentre|ragazza|donna|uomo|indossa|cammina|fotocamera|inquadratura|sfondo|luce)\b/giu,
    /\b(?:una|del|mientras|mujer|hombre|lleva|camina|cámara|encuadre|fondo|iluminación)\b/giu,
    /\b(?:une|des|pendant|femme|homme|porte|marche|caméra|cadrage|arrière-plan|éclairage)\b/giu,
    /\b(?:eine|einer|während|frau|mann|trägt|geht|kamera|bildausschnitt|hintergrund|beleuchtung)\b/giu,
    /\b(?:uma|das|enquanto|mulher|homem|veste|caminha|câmera|enquadramento|fundo|iluminação)\b/giu,
  ];
  return languageMarkers.some((pattern) => (prose.match(pattern) || []).length >= 3);
}

function directorFallbackPrompt({ idea, scene, index, previousPrompt, globalPrompt }) {
  const first = index === 0;
  return [
    first
      ? `Begin from the visual state implied by the global idea: ${idea}.`
      : "Continue directly from the previous scene without a jump cut, preserving the same car interior, daylight, camera position, subject identity, gaze direction and motion continuity.",
    !first && previousPrompt && `Carry forward the previous action and emotional state: ${previousPrompt}`,
    scene.hasImage
      ? "Use this scene's attached image as the visual anchor and endpoint for the interval, matching its framing, object placement, lighting, perspective and character position."
      : `Use the global continuity as the visual anchor for this interval: ${globalPrompt}.`,
    `Across this ${scene.duration}s interval, show one clear physical progression, restrained handheld micro-movement, believable expression changes, subtle environmental audio and a clean ending state that prepares the next scene.`,
    "Keep all unrequested details stable and write as a compact cinematic Director prompt.",
  ].filter(Boolean).join(" ");
}

export class LmStudioClient {
  constructor({
    baseUrl = "http://127.0.0.1:1234",
    model,
    apiToken = "",
    contextLength = 8192,
    maxTokens = 2048,
    temperature = 0.35,
    startServer = true,
    lmsCommand = "lms",
    instructions = DEFAULT_INSTRUCTIONS,
    fetchImpl = globalThis.fetch,
    execFileImpl = execFile,
    startupTimeoutMs = 300000,
    inferenceTimeoutMs = 300000,
  } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.model = String(model || "").trim();
    this.apiToken = String(apiToken || "").trim();
    this.contextLength = Number(contextLength) || 8192;
    this.maxTokens = Number(maxTokens) || 2048;
    this.temperature = Number(temperature);
    this.startServer = Boolean(startServer);
    this.lmsCommand = lmsCommand;
    this.instructions = String(instructions || DEFAULT_INSTRUCTIONS).trim();
    this.fetch = fetchImpl;
    this.execFile = execFileImpl;
    this.startupTimeoutMs = startupTimeoutMs;
    this.inferenceTimeoutMs = inferenceTimeoutMs;
    this.active = null;
    this.lockTimeoutMs = Math.max(60000, this.startupTimeoutMs + this.inferenceTimeoutMs + 90000);
  }

  publicConfig() {
    return {
      enabled: Boolean(this.model),
      model: this.model,
      endpoint: this.baseUrl,
      vision: true,
      unloadAfterPrompt: true,
      systemPromptProfiles: LM_STUDIO_SYSTEM_PROMPT_CATALOG,
    };
  }

  headers(json = false) {
    return {
      ...(json ? { "content-type": "application/json" } : {}),
      ...(this.apiToken ? { authorization: `Bearer ${this.apiToken}` } : {}),
    };
  }

  async request(path, options = {}, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { ...this.headers(Boolean(options.body)), ...(options.headers || {}) },
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = payload?.error?.message || payload?.error || payload?.message || response.statusText;
        throw new Error(`LM Studio ${response.status}: ${detail}`);
      }
      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        const seconds = Math.max(1, Math.round(timeoutMs / 1000));
        throw new Error(`LM Studio non ha completato la risposta entro ${seconds} secondi. Riduci la complessità o riprova quando la GPU è libera.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async models() {
    return this.request("/api/v1/models", {}, 10000);
  }

  async ensureServer() {
    try {
      return await this.models();
    } catch (initialError) {
      if (!this.startServer) throw initialError;
      const port = new URL(this.baseUrl).port || "1234";
      await this.execFile(this.lmsCommand, ["server", "start", "--port", port], {
        windowsHide: true,
        timeout: this.startupTimeoutMs,
      });
      const deadline = Date.now() + this.startupTimeoutMs;
      let lastError = initialError;
      while (Date.now() < deadline) {
        try {
          return await this.models();
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      throw new Error(`Impossibile avviare il server LM Studio: ${lastError.message}`);
    }
  }

  findModel(modelsPayload, modelName = this.model) {
    const target = String(modelName || "").toLocaleLowerCase();
    return (modelsPayload?.models || []).find((item) =>
      [item.key, item.display_name].some((value) => String(value || "").toLocaleLowerCase() === target)
    );
  }

  async loadModel(needsVision, modelName = this.model, { allowFallback = false, contextLength = this.contextLength } = {}) {
    const requestedModel = String(modelName || this.model || "").trim();
    if (!requestedModel) throw new Error("LM_STUDIO_MODEL non è configurato.");
    const modelsPayload = await this.ensureServer();
    let available = this.findModel(modelsPayload, requestedModel);
    let fallbackFrom = "";
    if (!available && allowFallback && requestedModel !== this.model) {
      available = this.findModel(modelsPayload, this.model);
      fallbackFrom = requestedModel;
    }
    if (!available) throw new Error(`Modello LM Studio non trovato: ${requestedModel}`);
    if (needsVision && available.capabilities?.vision === false) {
      throw new Error(`Il modello LM Studio selezionato non supporta immagini: ${available.display_name || available.key}`);
    }
    const requestedContextLength = Math.min(
      Math.max(2048, Number(contextLength) || this.contextLength),
      Number(available.max_context_length) || Number.MAX_SAFE_INTEGER,
    );
    const existing = available.loaded_instances?.[0];
    if (existing?.id) {
      const existingContextLength = Number(existing.config?.context_length || existing.context_length || 0);
      const requiresVerifiedLargerContext = requestedContextLength > this.contextLength;
      if (!requiresVerifiedLargerContext || existingContextLength >= requestedContextLength) {
        return { instanceId: existing.id, model: available, loadedNow: false, fallbackFrom };
      }
      // Le istanze aperte manualmente da LM Studio possono restare a 8K.
      // H3 Vision deve ricaricarle con il contesto adattivo realmente richiesto.
      await this.unload(existing.id);
    }
    const loaded = await this.request("/api/v1/models/load", {
      method: "POST",
      body: JSON.stringify({
        model: available.key,
        context_length: requestedContextLength,
        flash_attention: true,
        echo_load_config: true,
      }),
    }, this.startupTimeoutMs);
    return {
      instanceId: loaded.model_instance_id || loaded.instance_id || loaded.id || available.key,
      model: available,
      loadedNow: true,
      loadTimeSeconds: loaded.load_time_seconds,
      fallbackFrom,
    };
  }

  async unload(instanceId) {
    if (!instanceId) return;
    await this.request("/api/v1/models/unload", {
      method: "POST",
      body: JSON.stringify({ instance_id: instanceId }),
    }, 60000);
  }

  async unloadConfiguredModelInstances() {
    const payload = await this.models();
    const configured = this.findModel(payload);
    for (const instance of configured?.loaded_instances || []) {
      await this.unload(instance.id);
    }
  }

  async enhance({ text, target, promptPreset = "", duration = 0, mode = "text", image = null, images = [], workflowName = "", model = "", includeNegative = false }) {
    const idea = String(text || "").trim();
    if (!idea) throw new Error("Scrivi prima una frase o una richiesta di modifica.");
    const targetRule = TARGET_RULES[target] || TARGET_RULES.studio;
    const rawSuppliedImages = (Array.isArray(images) && images.length ? images : image ? [image] : []).filter(Boolean).slice(0, 9);
    const suppliedImages = await Promise.all(rawSuppliedImages.map((source) => normalizeVisionImage(source)));
    const visionTranscodedCount = suppliedImages.filter((source) => source.visionTranscoded).length;
    const needsVision = suppliedImages.length > 0;
    const h3Target = ["minimax_h3", "minimax_h3_fantasy_verite", "minimax_h3_action"].includes(target);
    const generationPreset = resolveGenerationSystemPrompt({
      target,
      preset: promptPreset,
      mode,
      workflowName,
      hasImages: needsVision,
    });
    const h3VisionContextLength = h3Target && needsVision
      ? Math.max(this.contextLength, suppliedImages.length > 4 ? 32768 : 16384)
      : this.contextLength;
    const now = Date.now();
    if (this.active) {
      const elapsed = now - this.active.startedAt;
      if (elapsed < this.lockTimeoutMs) {
        const seconds = Math.max(1, Math.round(elapsed / 1000));
        throw new Error(`Il Prompt Assistant locale sta già scrivendo un prompt (${seconds}s). Attendi il risultato oppure riprova tra poco.`);
      }
    }
    const lock = {
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      startedAt: now,
      target,
    };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(needsVision, model || this.model, {
        allowFallback: Boolean(model),
        contextLength: h3VisionContextLength,
      });
      const h3MusicRequested = h3Target
        && /\b(?:music|musica|soundtrack|score|song|canzone|melody|melodia)\b/iu.test(idea)
        && !/\b(?:no|senza|without)\s+(?:music|musica|soundtrack|score|song|canzone|melody|melodia)\b/iu.test(idea);
      const userText = generationPreset
        ? h3Target && Number(duration) > 0
          ? [
              `Target duration: ${Number(duration)} seconds.`,
              `H3 input mode: ${mode}.`,
              h3MusicRequested
                ? "Non-diegetic music was explicitly requested; describe only that requested soundtrack."
                : "No non-diegetic music was requested. The non_diegetic_music field must be N/A.",
              idea,
            ].join("\n")
          : idea
        : [
        `Target workflow: ${workflowName || target}.`,
        `Mode: ${mode === "text" ? "text-to-image/video" : mode}.`,
        needsVision
          ? `Inspect the ${suppliedImages.length} attached source image${suppliedImages.length === 1 ? "" : "s"} in order; for MiniMax H3 they map to <Picture 1> through <Picture ${suppliedImages.length}>.`
          : "",
        h3Target
          ? "H3 source-of-truth contract: preserve every explicit requested event, action, reaction, dialogue line, effect and ending state. The references define the starting visual state; they do not replace the requested timeline. Do not output a planning checklist."
          : "",
        `User request: ${idea}`,
          ].filter(Boolean).join("\n");
      const userContent = needsVision
        ? [
            { type: "text", content: userText },
            ...suppliedImages.map((source) => ({
              type: "image",
              data_url: `data:${source.mimetype};base64,${source.buffer.toString("base64")}`,
            })),
          ]
        : userText;
      const videoTarget = isVideoTarget(target);
      // H3 usa un contratto raw: tre campi nelle modalità base e sei sezioni
      // in Ref2VA. Il wrapper JSON per il negativo è quindi sempre escluso.
      const returnNegative = includeNegative && !h3Target && !generationPreset;
      // MiniMax H3 has a complete native schema and its own duration-scaled
      // budget. Generic 5K-character instructions make short H3 clips verbose
      // and can displace the actual action, so H3 receives an isolated system
      // prompt. Other model families retain the shared director contract.
      const systemPrompt = generationPreset?.systemPrompt || (h3Target
        ? [targetRule, ADULT_EXPLICIT_VOCABULARY_RULE]
        : [
            this.instructions,
            ENGLISH_OUTPUT_RULE,
            EXPANDED_PROMPT_BUDGET_RULE,
            ADULT_EXPLICIT_VOCABULARY_RULE,
            "Model-specific direction:",
            targetRule,
            target.startsWith("reverse_") ? REVERSE_PROMPT_CONTENT_FIDELITY_RULE : "",
            returnNegative ? (videoTarget ? VIDEO_NEGATIVE_PROMPT_SCHEMA_RULE : NEGATIVE_PROMPT_SCHEMA_RULE) : "",
          ]).filter(Boolean).join("\n\n");
      const requestDraft = async (input, repair = "") => this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: repair === "language"
            ? `${systemPrompt}\n\nLANGUAGE REPAIR TASK:\nThe previous draft contains non-English production prose. Rewrite the complete prompt in English now. Preserve only literal dialogue, quoted on-screen text, labels and names in their requested original language. Follow the original output schema exactly and return no explanation.`
            : repair === "timeline"
              ? `${systemPrompt}\n\nTIMELINE COMPLETION REPAIR:\nThe previous draft ends too early. Rewrite the complete prompt, preserving every requested subject, action, reference, dialogue line and output field, but distribute the physical progression across the entire target duration. The last meaningful action, reaction, camera settle or stable ending must occur within the final 10% of the requested duration. Do not add unrelated events, do not pad with repeated adjectives, and do not end the timeline early.`
              : systemPrompt,
          input,
          reasoning: "off",
          temperature: repair || h3Target || target.startsWith("reverse_") ? Math.min(this.temperature, 0.15) : this.temperature,
          max_output_tokens: this.maxTokens,
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      let payload = await requestDraft(userContent);
      let parsed = returnNegative ? parsePromptCompletion(payload) : null;
      let rawPrompt = returnNegative ? cleanOutput(parsed?.prompt) : completionText(payload);
      if (h3Target) rawPrompt = normalizeH3Timestamps(rawPrompt);
      if (hasLikelyNonEnglishProse(rawPrompt)) {
        payload = await requestDraft(`Rewrite this draft according to the language repair task:\n\n${rawPrompt}`, "language");
        parsed = returnNegative ? parsePromptCompletion(payload) : null;
        rawPrompt = returnNegative ? cleanOutput(parsed?.prompt) : completionText(payload);
      }
      if (hasLikelyNonEnglishProse(rawPrompt)) {
        throw new Error("LM Studio ha restituito prosa non inglese anche dopo la correzione automatica.");
      }
      const h3Duration = Number(duration) || Number(idea.match(/Target duration:\s*(\d+(?:\.\d+)?)\s*seconds?/iu)?.[1]) || 0;
      let timelineRepairApplied = false;
      const timelineEnd = h3TimelineEndSeconds(rawPrompt);
      if (h3Target && h3Duration >= 4 && (timelineEnd === 0 || timelineEnd < h3Duration * 0.75)) {
        const repairText = [
          `Target duration: ${h3Duration.toFixed(2)} seconds.`,
          timelineEnd > 0
            ? `The previous draft's latest explicit time is ${timelineEnd.toFixed(2)} seconds.`
            : "The previous draft contains no valid numeric timestamp proving that it covers the requested duration.",
          "Rewrite the COMPLETE prompt so its chronology reaches the target duration and its final meaningful beat occurs near the end.",
          "Use explicit numeric timestamps such as 00:00.000, 00:03.500 and 00:08.000. Never output the placeholder MM:SS.mmm or a timestamp beginning with MM:.",
          "Previous draft:",
          rawPrompt,
        ].join("\n");
        const repairContent = needsVision
          ? [
              { type: "text", content: repairText },
              ...suppliedImages.map((source) => ({
                type: "image",
                data_url: `data:${source.mimetype};base64,${source.buffer.toString("base64")}`,
              })),
            ]
          : repairText;
        payload = await requestDraft(repairContent, "timeline");
        rawPrompt = normalizeH3Timestamps(completionText(payload));
        if (hasLikelyNonEnglishProse(rawPrompt)) {
          throw new Error("LM Studio ha restituito prosa non inglese durante il completamento della timeline H3.");
        }
        const repairedEnd = h3TimelineEndSeconds(rawPrompt);
        if (repairedEnd === 0 || repairedEnd < h3Duration * 0.75) {
          throw new Error(`LM Studio ha interrotto nuovamente la timeline H3 a ${repairedEnd.toFixed(2)}s invece di coprire ${h3Duration.toFixed(2)}s.`);
        }
        timelineRepairApplied = true;
      }
      const prompt = h3Target
        ? normalizeMiniMaxH3Prompt(rawPrompt, {
            fullReference: mode === "references",
            mode,
            duration: h3Duration,
            allowMusic: h3MusicRequested,
          })
        : rawPrompt;
      if (!prompt) throw new Error("LM Studio non ha restituito un prompt utilizzabile.");
      return {
        prompt,
        negativePrompt: returnNegative
          ? (videoTarget
            ? videoNegativePromptFallback({ mode })
            : negativePromptFallback({ mode, image }))
          : "",
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        modelFallbackFrom: loaded.fallbackFrom || "",
        promptPreset: generationPreset?.id || "",
        promptPresetName: generationPreset?.name || "",
        usedVision: needsVision,
        usedImageCount: suppliedImages.length,
        visionTranscodedCount,
        visionInputFormats: suppliedImages.map((source) => source.mimetype),
        timelineRepairApplied,
        loadTimeSeconds: loaded.loadTimeSeconds || 0,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async createCharacterGenesis({ description = "", image = null } = {}) {
    const idea = String(description || "").trim();
    if (!idea && !image) throw new Error("Scrivi una breve descrizione oppure carica una fotografia.");
    const now = Date.now();
    if (this.active && now - this.active.startedAt < this.lockTimeoutMs) {
      throw new Error("LM Studio sta già elaborando un'altra richiesta. Attendi il risultato corrente.");
    }
    const lock = { id: `${now}-${Math.random().toString(36).slice(2)}`, startedAt: now, target: "character_genesis" };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(Boolean(image));
      const userText = image
        ? "Analyze the attached photograph as the primary identity reference. Record only visible evidence. The subject may be a human, animal, or another reusable subject."
        : `Create a reusable character from this user description: ${idea}`;
      const input = image
        ? [
            { type: "text", content: userText },
            { type: "image", data_url: `data:${image.mimetype};base64,${image.buffer.toString("base64")}` },
          ]
        : userText;
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

You are the Character Genesis planner for a ComfyUI application. Return only strict JSON with this exact schema:
{"name":"","subjectKind":"auto|human|animal|other","identity":{"appearance":"","head":"","body":"","hairOrCoat":"","distinctiveFeatures":[""],"colors":[""],"proportions":""},"technicalPrompt":"","technicalNegativePrompt":""}
All identity fields and technicalPrompt must be in English. name may be a short neutral Italian label when no proper name was provided.
technicalPrompt must be one production-ready English text-to-image prompt for the existing Krea 2 based workflow. It must create one clean, realistic, identity-defining hero portrait with a single subject, useful framing, visible distinctive traits, neutral uncluttered setting, coherent anatomy, natural light, no text and no watermark.
technicalNegativePrompt must be a concise English comma-separated list preventing duplicate subjects, identity drift, malformed anatomy, text, logos, watermark, blur and low quality without contradicting the requested subject.
For a description, preserve every user-specified trait without inventing conflicting details.
For a photograph, describe only visible evidence. Never invent a name, exact age, ethnicity, breed, biography, hidden anatomy, off-frame clothing or details not supported by the photograph. Use broad age ranges only when visually evident.
The subject is not necessarily human. Use hairOrCoat for human hair, animal fur/coat, feathers, surface covering or another identity-bearing texture. Use subjectKind other for reusable non-human, non-animal subjects.
No markdown, code fences, comments, explanations, negativePrompt or extra keys.`,
          input,
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.25),
          max_output_tokens: Math.max(this.maxTokens, 1200),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseJsonCompletion(payload);
      if (!parsed || typeof parsed !== "object" || !String(parsed.technicalPrompt || "").trim()) {
        throw new Error("LM Studio ha restituito un Character Blueprint incompleto.");
      }
      return {
        ...parsed,
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        usedVision: Boolean(image),
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async planCharacterReferences({ character, image, workflow, allowedRoles = [] } = {}) {
    if (!character?.id || !image?.buffer) throw new Error("Character e Hero sono richiesti per creare il Reference Plan.");
    if (!allowedRoles.length) throw new Error("Nessun ruolo reference consentito per questo tipo di soggetto.");
    const now = Date.now();
    if (this.active && now - this.active.startedAt < this.lockTimeoutMs) {
      throw new Error("LM Studio sta già elaborando un'altra richiesta. Attendi il risultato corrente.");
    }
    const lock = { id: `${now}-${Math.random().toString(36).slice(2)}`, startedAt: now, target: "character_reference_plan" };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(true);
      const roleContract = allowedRoles.map((item) => ({
        referenceRole: item.referenceRole,
        type: item.type,
        angle: item.angle,
        pose: item.pose,
        expression: item.expression,
      }));
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

You are the Adaptive Reference Factory planner for a reusable Character Library.
Inspect the attached Hero and the structured Character Blueprint. Propose the useful independent identity references for this exact subject and write the image-edit instruction for each one.
Return only strict JSON with this schema:
{"subjectKind":"human|animal|other","items":[{"referenceRole":"","angle":"","pose":"","expression":"","technicalPrompt":"","technicalNegativePrompt":""}]}
subjectKind must preserve the caller's explicit human, animal or other value. When the caller sends auto, classify only from visible Hero evidence and the Blueprint; never default to human.
referenceRole MUST be selected exactly from the caller-provided allowed role catalog. Never invent a role or type. Include exactly 4 distinct useful roles, or every allowed role when the catalog contains fewer than four. Never include duplicates.
Every technicalPrompt must be an independent concise English image-editing contract of 35-55 words optimized for the named workflow. Treat the Hero as authoritative. Preserve the same identity and modify only the requested angle, pose, expression or view. Use a neutral uncluttered background and soft coherent light when appropriate. Add no people, animals, objects, text, labels, logos or watermark unless intrinsic to the subject.
For humans, preserve face geometry, hair, body proportions, skin appearance and distinctive features. Do not change wardrobe unless needed to reveal the requested full-body view.
For animals, preserve coat or feathers, markings, pattern, colors, morphology, proportions and distinctive features. Never humanize the animal.
For other subjects, do not assume a human face, human expression, hair, hands or anatomy. Preserve shape, construction, materials, colors, scale cues and distinctive details visible in the Hero.
technicalNegativePrompt must be a concise 8-18 word English comma-separated preservation list for that role. No markdown, comments, explanations, contact sheets, collages, multi-panel layouts or extra keys.`,
          input: [
            {
              type: "text",
              content: [
                `Character name: ${character.name}`,
                `Subject kind: ${character.subjectKind || "auto"}`,
                `Character Blueprint: ${JSON.stringify(character.characterBlueprint || {})}`,
                `Target workflow: ${workflow?.name || workflow?.id || "image edit"}`,
                `Allowed role catalog: ${JSON.stringify(roleContract)}`,
              ].join("\n"),
            },
            { type: "image", data_url: `data:${image.mimetype};base64,${image.buffer.toString("base64")}` },
          ],
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.25),
          max_output_tokens: Math.max(this.maxTokens, 1400),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseReferencePlanCompletion(payload);
      const minimumItems = Math.min(4, allowedRoles.length);
      if (!Array.isArray(parsed?.items) || parsed.items.length < minimumItems) {
        throw new Error("LM Studio ha restituito un Reference Plan vuoto o non valido.");
      }
      return {
        subjectKind: String(parsed.subjectKind || character.subjectKind || "auto"),
        items: parsed.items,
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        usedVision: true,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async planCharacterPhoto({ character, userIntent = "", choices = {}, sceneSeed = {}, selectedReferences = [], workflow = {} } = {}) {
    if (!character?.id) throw new Error("Seleziona un Character prima di creare la scena fotografica.");
    const now = Date.now();
    if (this.active && now - this.active.startedAt < this.lockTimeoutMs) {
      throw new Error("LM Studio sta già elaborando un'altra richiesta. Attendi il risultato corrente.");
    }
    const lock = { id: `${now}-${Math.random().toString(36).slice(2)}`, startedAt: now, target: "character_photo" };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(false);
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

You are the Scene Architect and Prompt Assistant for guided Character photography.
Turn the user's short natural-language request and simple choices into one coherent photographic scene. Fill every missing detail conservatively and adapt it to human, animal or other subjects without assuming human anatomy, clothing or behavior.
Return only strict JSON with this exact schema:
{"sceneBlueprint":{"location":"","action":"","camera":"","framing":"","lighting":"","time":"","mood":"","outfit":"","subjectInteraction":"","userIntent":""},"technicalPrompt":"","technicalNegativePrompt":""}
Every sceneBlueprint value must be concise English visual direction. Preserve the user's intent.
technicalPrompt must be one production-ready English image-editing contract optimized for the named real workflow. The Hero is the primary identity source. Explicitly assign the listed reference roles, preserve identity-bearing traits and integrate the subject naturally into the new location, action, framing and light. Do not mention unavailable references.
technicalNegativePrompt must be a concise English comma-separated list preventing identity drift, changed morphology, duplicate subjects, malformed anatomy or geometry, unrelated objects, text, logos and watermark. Adapt constraints to the subject kind.
For outfit mode keep, preserve the original appearance and outfit. For allow-change, choose only scene-appropriate clothing for a human. For choose, honor the user's requested clothing. For animal or other, preserve identity-bearing coat, covering, materials and accessories unless explicitly requested otherwise.
No markdown, comments, explanations or extra keys.`,
          input: [
            `Character: ${character.name}`,
            `Subject kind: ${character.referencePlan?.subjectKind || character.subjectKind || "other"}`,
            `Character Blueprint: ${JSON.stringify(character.characterBlueprint || {})}`,
            `User intent: ${String(userIntent || "").trim() || "Complete the guided choices naturally."}`,
            `Guided choices: ${JSON.stringify(choices || {})}`,
            `Surprise/local seed: ${JSON.stringify(sceneSeed || {})}`,
            `Selected reference roles: ${JSON.stringify(selectedReferences.map((reference) => ({ id: reference.id, role: reference.referenceRole || reference.type })))}`,
            `Target workflow: ${workflow.name || workflow.id || "automatic image edit router"}`,
            `Outfit mode: ${choices.outfitMode || "keep"}`,
          ].join("\n"),
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.35),
          max_output_tokens: Math.max(this.maxTokens, 1800),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseJsonCompletion(payload);
      if (!parsed?.sceneBlueprint || !String(parsed.technicalPrompt || "").trim()) {
        throw new Error("LM Studio ha restituito un piano fotografico incompleto.");
      }
      return {
        ...parsed,
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async planCharacterVideo({
    character,
    videoIntent = "",
    filmingStyle = "automatic",
    duration = 5,
    dialogue = "",
    emotion = "natural",
    audioMode = "none",
    outfit = "",
    aspectRatio = "9:16",
    engine = {},
    motionContract = [],
  } = {}) {
    if (!character?.id || !String(videoIntent || "").trim()) {
      throw new Error("Character e azione video sono richiesti.");
    }
    const now = Date.now();
    if (this.active && now - this.active.startedAt < this.lockTimeoutMs) {
      throw new Error("LM Studio sta già elaborando un'altra richiesta. Attendi il risultato corrente.");
    }
    const lock = { id: `${now}-${Math.random().toString(36).slice(2)}`, startedAt: now, target: "character_video" };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(false);
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

${ENGLISH_OUTPUT_RULE}

You are the guided Character Video Architect and Motion Prompt Builder.
Turn the user's simple request into a normalized video plan for the named, genuinely available video engine.
Return only strict JSON with this exact schema:
{"videoBlueprint":{"scene":"","subjectMotion":"","cameraMotion":"","framing":"","environmentMotion":"","facialPerformance":"","duration":5,"dialogue":"","emotion":"","audioMode":"none|native|externalTts|existing"},"scenePrompt":"","motionPrompt":"","audioPrompt":"","dialogueInstructions":"","emotionInstructions":""}
Every videoBlueprint direction except dialogue must be concise English. Preserve dialogue verbatim in its original language.
scenePrompt must describe the visual scene in technical English without motion redundancy.
motionPrompt must be one production-ready English ${engine.id === "ltx23" ? "LTX 2.3" : "video"} image-to-video prompt in present tense. Treat the anchor image as authoritative for identity, appearance, wardrobe, composition and lighting.
audioPrompt must be technical English adapted to the selected audio mode. For none, request no dialogue. For native, direct the engine's native sound/dialogue. For externalTts or existing, describe timing and performance without translating or rewriting the spoken text.
dialogueInstructions and emotionInstructions must be concise technical English, while the dialogue itself remains exactly equal to the user's supplied text.
Build the prompt internally from subject motion, connected body mechanics, subtle facial performance, one coherent camera behavior, environment and secondary motion, identity stability, temporal continuity, a natural ending, and dialogue/native audio only when requested.
Do not invent dialogue, people, objects, costume changes, captions, subtitles or music. Express only capabilities supported by the target engine and selected pipeline stages.
No markdown, headings, comments, alternatives or extra keys.`,
          input: [
            `Character: ${character.name}`,
            `Subject kind: ${character.referencePlan?.subjectKind || character.subjectKind || "other"}`,
            `Character Blueprint: ${JSON.stringify(character.characterBlueprint || {})}`,
            `Video intent: ${String(videoIntent).trim()}`,
            `Filming style: ${filmingStyle}`,
            `Duration: ${duration} seconds; aspect ratio: ${aspectRatio}`,
            `Dialogue: ${String(dialogue || "").trim() || "none"}`,
            `Emotion: ${emotion}; requested audio mode: ${audioMode}`,
            `Outfit: ${outfit || "preserve source appearance"}`,
            `Target engine: ${engine.name || engine.id}; capabilities: ${JSON.stringify(engine.capabilities || {})}`,
            `Mandatory motion sections: ${JSON.stringify(motionContract)}`,
          ].join("\n"),
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.3),
          max_output_tokens: Math.max(this.maxTokens, 2200),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseJsonCompletion(payload);
      if (!parsed?.videoBlueprint || !String(parsed.scenePrompt || "").trim() || !String(parsed.motionPrompt || "").trim()
        || !String(parsed.audioPrompt || "").trim() || !String(parsed.dialogueInstructions || "").trim()
        || !String(parsed.emotionInstructions || "").trim()) {
        throw new Error("LM Studio ha restituito un Video Blueprint incompleto.");
      }
      return {
        ...parsed,
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async planCharacterPhotoStage({
    character,
    sceneBlueprint,
    selectedReferences = [],
    previousStage = {},
    targetModel = {},
    stage,
    objective,
    identityProtection,
    image,
  } = {}) {
    if (!character?.id || !stage || !objective || !image?.buffer) {
      throw new Error("Character, stage, obiettivo e risultato precedente sono richiesti per il prompt di refine.");
    }
    const target = stage === "klein" ? "flux2_klein_architect" : "krea2";
    return this.enhance({
      text: [
        `Pipeline stage: ${stage}.`,
        `Stage responsibility: ${objective}.`,
        `Target model: ${targetModel.name || targetModel.modelFile || targetModel.id || "configured model"}.`,
        `Character Blueprint: ${JSON.stringify(character.characterBlueprint || {})}.`,
        `Scene Blueprint: ${JSON.stringify(sceneBlueprint || {})}.`,
        `Selected identity references: ${JSON.stringify(selectedReferences.map((reference) => ({ id: reference.id, role: reference.referenceRole || reference.type })))}.`,
        `Previous stage result: ${JSON.stringify(previousStage)}. Inspect the attached result as authoritative visual input.`,
        identityProtection,
        "Apply only this stage responsibility conservatively. Preserve composition, pose, identity and all correct details from the previous result. Do not redesign or reinterpret the character.",
      ].filter(Boolean).join("\n"),
      target,
      mode: "image",
      image,
      workflowName: targetModel.name || targetModel.id || stage,
      includeNegative: true,
    });
  }

  async enhanceDirectorStoryboard({ text, scenes = [] }) {
    const idea = String(text || "").trim();
    if (!idea) throw new Error("Scrivi nel Prompt Globale l’idea della scena da costruire.");
    const normalizedScenes = scenes.slice(0, 3).map((scene, index) => ({
      index: index + 1,
      duration: Number(scene.duration) || 4,
      existingPrompt: String(scene.prompt || "").trim(),
      hasImage: Boolean(scene.image),
    }));
    if (!normalizedScenes.length) throw new Error("Aggiungi almeno una scena Director.");
    const now = Date.now();
    if (this.active) {
      const elapsed = now - this.active.startedAt;
      if (elapsed < this.lockTimeoutMs) {
        const seconds = Math.max(1, Math.round(elapsed / 1000));
        throw new Error(`Il Prompt Assistant locale sta già scrivendo un prompt (${seconds}s). Attendi il risultato corrente.`);
      }
    }
    const lock = {
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      startedAt: now,
      target: "ltx_director_storyboard",
    };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(scenes.some((scene) => scene.image));
      const userText = [
        "Target workflow: LTX 2.3 Director storyboard.",
        "The webapp has separate fields: globalPrompt plus one prompt for each scene.",
        `User global idea: ${idea}`,
        `Scene count: ${normalizedScenes.length}`,
        "Scene plan:",
        ...normalizedScenes.map((scene) =>
          `Scene ${scene.index}: duration ${scene.duration}s, image reference ${scene.hasImage ? "attached in this order" : "not attached"}, existing prompt: ${scene.existingPrompt || "(empty)"}`
        ),
      ].join("\n");
      const content = [{ type: "text", content: userText }];
      for (const scene of scenes.slice(0, 3)) {
        if (!scene.image) continue;
        content.push({
          type: "image",
          data_url: `data:${scene.image.mimetype};base64,${scene.image.buffer.toString("base64")}`,
        });
      }
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

${ENGLISH_OUTPUT_RULE}

Model-specific direction:
You are writing prompts for LTX 2.3 Director, not a single normal LTX prompt.
Return only strict JSON with this exact schema:
{"globalPrompt":"...","scenes":[{"prompt":"..."},{"prompt":"..."}]}
The scenes array length must exactly match the requested scene count, from 1 to 3.
Never omit a scene. If uncertain, still write a concrete cinematic prompt for that scene using the global idea and its image/reference.
globalPrompt must describe the persistent continuity shared by all scenes: subject identity, environment, style, lighting, mood, wardrobe, camera language and audio continuity. Keep it compact: 35-90 words.
Each scene prompt must describe only that scene interval: starting state, action, camera movement, physical motion, expression, environmental audio, and ending state. Keep each scene prompt compact: 45-110 words.
If scene images are attached, treat each image as the authoritative visual anchor for the corresponding scene in order. Preserve identity, framing, environment, lighting, clothing, proportions and object placement from each image unless the user explicitly asks otherwise.
Do not include a negative prompt, markdown, explanations, bullets outside JSON, code fences, comments, or extra keys.`,
          input: content,
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.35),
          max_output_tokens: Math.max(this.maxTokens, 900),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseJsonCompletion(payload);
      const prompts = Array.isArray(parsed?.scenes)
        ? parsed.scenes.map((scene) => String(scene?.prompt || "").trim())
        : [];
      const globalPrompt = String(parsed?.globalPrompt || "").trim()
        || `Maintain continuity across the full LTX 2.3 Director sequence: ${idea}`;
      const completedPrompts = normalizedScenes.map((scene, index) => {
        const generated = prompts[index];
        if (generated) return generated;
        if (scene.existingPrompt) return scene.existingPrompt;
        return directorFallbackPrompt({
          idea,
          scene,
          index,
          previousPrompt: prompts[index - 1] || normalizedScenes[index - 1]?.existingPrompt || "",
          globalPrompt,
        });
      });
      if (!globalPrompt || completedPrompts.some((prompt) => !prompt)) {
        throw new Error("LM Studio ha restituito una struttura incompleta per il Director.");
      }
      return {
        globalPrompt,
        scenes: completedPrompts.map((prompt, index) => ({
          prompt,
          completedFromFallback: !prompts[index],
        })),
        partial: prompts.length !== normalizedScenes.length || prompts.some((prompt) => !prompt) || !String(parsed?.globalPrompt || "").trim(),
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        usedVision: content.length > 1,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async planSequentialStory({
    description,
    sceneCount = 3,
    sceneDuration = 10,
    globalStyle = "",
    characterContext = "",
  } = {}) {
    const idea = String(description || "").trim();
    if (!idea) throw new Error("Scrivi la descrizione globale della Storia continua.");
    const count = Math.max(1, Math.min(12, Number(sceneCount) || 3));
    const duration = Math.max(1, Math.min(30, Number(sceneDuration) || 10));
    const now = Date.now();
    if (this.active) {
      const elapsed = now - this.active.startedAt;
      if (elapsed < this.lockTimeoutMs) {
        const seconds = Math.max(1, Math.round(elapsed / 1000));
        throw new Error(`Il Prompt Assistant locale sta già lavorando (${seconds}s). Attendi il risultato corrente.`);
      }
    }
    const lock = {
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      startedAt: now,
      target: "sequential_story_planner",
    };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(false);
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

${ENGLISH_OUTPUT_RULE}

Model-specific direction:
You are planning a Sequential Story for LTX 2.3 video.
This is not LTX Director and not Extend. The web app will generate one independent ComfyUI job per scene, purge VRAM between scenes, use a continuity frame from the previous clip, then concatenate final clips.
Return only strict JSON with this exact schema:
{"title":"...","globalContinuity":{"character":"","face":"","hair":"","body":"","outfit":"","location":"","lighting":"","cameraStyle":"","visualStyle":"","temporalRules":""},"scenes":[{"id":"scene-1","index":1,"title":"...","duration":10,"prompt":"...","negativePrompt":"...","continuityNotes":"...","startState":"...","endState":"..."}]}
The scenes array length must exactly match the requested scene count.
Each scene must be a short independent LTX prompt for a single clip, not a timeline inside one workflow.
Scene prompts must carry only the necessary continuity: subject, action, camera, environment, lighting, start state and end state.
Do not copy the entire previous scene into the next one. Use concise continuity notes.
Use durations provided by the caller unless the story clearly needs a tiny local adjustment.
negativePrompt must be video-safe and concise: avoid identity drift, flicker, sudden cuts, warped anatomy, changing outfit/location/lighting, disappearing objects, subtitles, text and watermark.
No markdown, code fences, comments, explanations or extra keys.`,
          input: [
            `User story description: ${idea}`,
            `Requested scene count: ${count}`,
            `Default scene duration: ${duration}s`,
            globalStyle ? `Global style: ${globalStyle}` : "",
            characterContext ? `Character context: ${characterContext}` : "",
          ].filter(Boolean).join("\n"),
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.35),
          max_output_tokens: Math.max(this.maxTokens, 1800),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseJsonCompletion(payload);
      if (!Array.isArray(parsed?.scenes) || parsed.scenes.length !== count) {
        throw new Error("LM Studio ha restituito una scaletta incompleta per la Storia continua.");
      }
      return {
        ...parsed,
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }

  async planInteractiveCast({
    brief,
    duration = 0,
    analysis = {},
    actors = {},
  } = {}) {
    const idea = String(brief || "").trim();
    if (!idea) throw new Error("Scrivi prima cosa deve succedere nella scena Interactive Cast.");
    const now = Date.now();
    if (this.active) {
      const elapsed = now - this.active.startedAt;
      if (elapsed < this.lockTimeoutMs) {
        const seconds = Math.max(1, Math.round(elapsed / 1000));
        throw new Error(`Il Prompt Assistant locale sta già lavorando (${seconds}s). Attendi il risultato corrente.`);
      }
    }
    const lock = {
      id: `${now}-${Math.random().toString(36).slice(2)}`,
      startedAt: now,
      target: "interactive_cast_planner",
    };
    this.active = lock;
    let loaded;
    let unloadError = null;
    try {
      loaded = await this.loadModel(false);
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: `${this.instructions}

${ENGLISH_OUTPUT_RULE}

Model-specific direction:
You are planning an Interactive Cast / Scene Dialogue Rewrite job for a hybrid Node + ComfyUI video pipeline.
The goal is to preserve the original video whenever possible and modify only necessary time windows.
Return only strict JSON with this exact schema:
{"actors":{"original":[{"actorId":"original-1","label":"...","notes":"..."}],"added":[{"actorId":"new-actor-1","name":"...","entranceTime":3.0,"description":"..."}]},"dialogueEvents":[{"speaker":"New Actor","start":3.0,"end":5.0,"dialogue":"...","action":"...","preserveVoice":true,"preserveFace":true,"reaction":"none","mode":"generative","audioMode":"ltxNative"}],"notes":["..."]}
All fields must be written in English except literal spoken dialogue, which must preserve the user's exact wording and language when provided.
Use seconds as numbers. Do not invent impossible edits outside the video duration.
For original actors, prefer preserveVoice true and preserveFace true.
Use reaction values only from: none, look, speak, move.
Use mode values only from: audioOnly, lipSyncOnly, composite, generative.
Use audioMode values only from: ltxNative, external. Use ltxNative for dialogue spoken inside a generative LTX segment. Use external only when an uploaded, cloned or separately synthesized voice must replace source audio.
Choose the least destructive mode: audioOnly for offscreen/audio-only changes, lipSyncOnly for original actor dialogue replacement, composite for regional visual reactions or foreground overlays, generative only for new actor insertion or full-scene/body changes.
Do not include markdown, code fences, comments, explanations, negative prompts or extra keys.`,
          input: [
            `Video duration: ${Number(duration || analysis.duration || 0).toFixed(2)} seconds`,
            `Video analysis: ${JSON.stringify({
              width: analysis.width,
              height: analysis.height,
              fps: analysis.fps,
              codec: analysis.codec,
              audioStreams: analysis.audioStreams?.length || 0,
            })}`,
            `Known original actors: ${JSON.stringify(actors.original || [])}`,
            `Known added actors: ${JSON.stringify(actors.added || [])}`,
            `User brief: ${idea}`,
          ].join("\n"),
          reasoning: "off",
          temperature: Math.min(this.temperature, 0.3),
          max_output_tokens: Math.max(this.maxTokens, 1200),
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = parseJsonCompletion(payload);
      return {
        ...parsed,
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        get unloadError() {
          return unloadError?.message || null;
        },
      };
    } finally {
      if (loaded?.instanceId) {
        try {
          await this.unload(loaded.instanceId);
        } catch (error) {
          unloadError = error;
        }
      } else {
        try {
          await this.unloadConfiguredModelInstances();
        } catch (error) {
          unloadError = error;
        }
      }
      if (this.active?.id === lock.id) this.active = null;
    }
  }
}

export {
  DEFAULT_INSTRUCTIONS,
  LM_STUDIO_SYSTEM_PROMPT_CATALOG,
  TARGET_RULES,
  cleanOutput,
  normalizeMiniMaxH3Prompt,
  h3TimelineEndSeconds,
  parseJsonCompletion,
  parseReferencePlanCompletion,
};
