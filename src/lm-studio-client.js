import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const TARGET_RULES = {
  flux1: "Write a FLUX.1 prompt as fluent natural language. Prioritize subject, environment, composition, camera, light, materials and photographic intent.",
  flux2: "Write a Flux 2 / Klein prompt with precise spatial relationships, realistic materials, camera language and an explicit description of the intended result.",
  qwen: "Write a Qwen Image prompt with unambiguous subjects, attributes, placement, composition, lighting and style.",
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
  flux2_klein_architect: `Follow the user's FLUX.2 Klein 9B Prompt Engineering Guide.
Write one complete English prompt optimized for FLUX.2 Klein 9B.
Do not use Stable Diffusion tag lists, Danbooru tags, syntax weights, embeddings, BREAK tokens, or generic quality spam. The prompt must read like visual direction or a clear editing instruction.
Infer the mode from the request and references: text-to-image, single-image editing, or multi-reference. Do not mention the mode.
For text-to-image, describe the image type, main subject, action, environment, spatial arrangement, framing, camera angle, lens behavior only if useful, lighting, materials, atmosphere, style and essential restrictions.
For image editing, write a direct editing contract: state exactly what changes, where it changes, the final geometry and physical relationship to the source, what must stay unchanged, and how the edit matches the original camera, perspective, scale, lighting, shadows, reflections, focus, depth of field, material texture, grain and color grading.
For local edits, explicitly say to preserve the source composition and modify only the requested area/mask; do not redraw the whole image, alter the identity, change pose, change camera crop, or add unrelated elements.
For multi-reference, assign each image a precise role: identity, base scene, pose, clothing, object, style or location. Preserve separate identities and avoid averaging faces or copying unrelated backgrounds.
Length: 90-180 words for normal prompts, up to 240 words for complex multi-reference scenes. Return only the final prompt, no heading, no explanation, no markdown, no negative prompt unless explicitly requested.`,
  reverse_qwen: `Analyze the supplied image and write one compact English prompt that can recreate it with Qwen Image.
Describe only visible evidence. Preserve the image type, subject count and hierarchy, recognizable appearance, expressions, pose, clothing, objects, environment, spatial relationships, framing, camera angle, perspective, lens character, depth of field, lighting, colors, materials, texture and photographic style.
Do not refer to "the image", source files, analysis, references or editing. Do not invent hidden details, names, brands or events that are not visually supported.
Write fluent natural language rather than tags or generic quality spam. Use 55-140 words, up to 180 only for a genuinely complex scene. Return only the final generation prompt, with no heading, explanation, markdown or negative prompt.`,
  reverse_klein: `Analyze the supplied image and write one compact English visual-direction prompt that can recreate it with FLUX.2 Klein.
Describe the visible main subject first, then action or expression, environment, exact spatial composition, framing, viewpoint, perspective, lens behavior when evident, lighting direction and quality, color palette, materials, texture, atmosphere and photographic finish.
Do not refer to "the image", source files, analysis, references or editing. Do not invent identities, text, brands or off-frame details. Avoid tag lists, weights, BREAK syntax and generic quality spam.
Use 45-120 words, up to 160 only for a complex scene. Return only the final generation prompt, with no heading, explanation, markdown or negative prompt.`,
  ltx: "Write an LTX 2.3 video prompt as one continuous temporal description. Include initial state, subject and camera motion, physical continuity, environment, lighting, ending state and audio or dialogue only when requested.",
  ltx_architect: `Follow the user's LTX 2.3 Video Prompt Architect document.
Write exactly one English LTX 2.3 generation prompt as a single continuous paragraph in present tense.
First infer whether the request is text-to-video, image-to-video, dialogue, one-take, or multi-shot, but do not mention the classification.
For image-to-video, treat the source image as authoritative for identity, wardrobe, composition, environment, lighting, perspective, materials and style; describe only the motion, camera behavior, audio and stability constraints needed for the scene.
For text-to-video, define only the essential subject, wardrobe, environment and visual anchors needed to keep continuity.
Prioritize physical and temporal credibility, source preservation, connected body mechanics, subtle facial performance, one dominant camera behavior, natural acceleration and deceleration, synchronized environmental audio, and a natural ending.
Never invent new people, objects, garments, facial features, light sources, captions, subtitles, music or dialogue unless the user asks for them.
If dialogue is requested, preserve the user's spoken words exactly in their original language, specify language, vocal delivery and precise lip synchronization, without quotation marks around the dialogue.
Use cinematic direction, not a checklist. Return only the completed prompt: no heading, no markdown, no explanation, no bullets, no negative prompt.`,
  ltx_scenes: `Follow the user's PROMPT A SCENE document.
Transform the user's idea into an English cut-scene script prompt for LTX 2.3 with explicit shots.
Use a structured script format with a short overall description, then Shot/Scene sections with hard cuts or the requested transition.
For each scene include timecode or shot number, visual description, character dialogue when requested, camera movement, and environmental audio.
Preserve character continuity, wardrobe, proportions, colors, environment, lighting, object placement and lip synchronization across scenes.
Keep each shot focused on one main composition, one main action and one compatible camera movement.
If the user provides dialogue, keep the exact text and original language. If no dialogue is requested, write No dialogue.
Include practical video settings only when useful or provided by the user, such as total duration, aspect ratio, camera style, depth of field, transitions and audio design.
Avoid sudden face changes, clothing changes, malformed hands, unnatural motion, unsynchronized dialogue, extra characters, appearing or disappearing objects, incoherent lighting, subtitles and rushed camera moves.
Return only the final scene-script prompt, with no analysis, no alternatives and no code block.`,
  ltxedit: "Write an LTX 2.3 video-edit instruction. Preserve source timing, camera, acting, identity and environment unless the requested change explicitly overrides them. Describe the change and temporal behavior precisely.",
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

const DEFAULT_INSTRUCTIONS = `You are the local prompt director for ComfyUI Remote.
Convert the user's short idea into one production-ready English generation prompt for the requested model.
Use the supplied image as visual evidence when present. Do not invent a conflicting camera angle, subject identity, layout or background.
For editing, distinguish the requested change from the elements that must remain unchanged.
Return only the final prompt. Do not add headings, markdown, quotes, explanations, analysis, negative prompts or alternatives.`;

const NEGATIVE_PROMPT_SCHEMA_RULE = `Return only strict JSON with this exact schema:
{"prompt":"...","negativePrompt":"..."}
The prompt value is the final positive prompt for the requested workflow.
The negativePrompt value must describe what must not change and what artifacts to avoid. Include preservation locks for identity, face, hair, body proportions, pose, hands, expression, clothing not being edited, camera angle, framing, background geometry, lighting, shadows, reflections, texture, unrelated objects and all unselected/unmentioned areas.
For source-based or masked edits, explicitly include: do not modify outside the selected/requested area, do not redraw the whole image, do not change composition, do not introduce extra people, extra objects, text or watermark, avoid identity drift and unrealistic integration.
Keep negativePrompt as a comma-separated English instruction list, 35-90 words. No markdown, no headings, no explanations.`;

const VIDEO_NEGATIVE_PROMPT_SCHEMA_RULE = `Return only strict JSON with this exact schema:
{"prompt":"...","negativePrompt":"..."}
The prompt value is the final positive prompt for the requested LTX/Sulphur video workflow.
The negativePrompt value must be video-safe: brief temporal stability constraints, not an over-restrictive image-editing lock.
For image-to-video, preserve source identity, face consistency, body proportions, outfit continuity, camera continuity, lighting continuity, environment continuity and stable motion while still allowing the requested action.
For video-to-video or actor replacement, also preserve source timing, camera motion, motion rhythm, scene layout and unedited performers unless the user explicitly changes them.
Avoid identity drift, face morphing, flicker, temporal inconsistency, unstable camera, sudden scene cuts, extra people, duplicated limbs, warped anatomy, disappearing objects, changing outfit, changed background, subtitles, text, watermark and low quality motion.
Keep negativePrompt as a comma-separated English list, 25-65 words. No markdown, no headings, no explanations.`;

function isVideoTarget(target) {
  return /^(?:sulphur_)?(?:ltx|ltx_|ltxedit|videostudio)|^sulphur_prompt$/.test(String(target || ""));
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
    ? "do not modify outside the selected or requested area, do not redraw the whole image, preserve the original source composition, "
    : "";
  return `${sourceLock}preserve identity, face, hair, body proportions, pose, hands, expression, camera angle, framing, background geometry, lighting, shadows, reflections, texture and unrelated objects, avoid identity drift, changed anatomy, extra people, extra objects, text, watermark, artifacts, blur, distortion and unrealistic integration`;
}

function videoNegativePromptFallback({ mode = "text" } = {}) {
  const sourceLock = mode !== "text"
    ? "preserve source identity, face consistency, body proportions, outfit continuity, camera continuity, lighting continuity, environment continuity, source timing and motion rhythm, "
    : "preserve identity consistency, body proportions, outfit continuity, camera continuity, lighting continuity, environment continuity, ";
  return `${sourceLock}stable motion, temporal coherence, avoid identity drift, face morphing, flicker, temporal inconsistency, unstable camera, sudden scene cuts, extra people, duplicated limbs, warped anatomy, disappearing objects, changing outfit, changed background, subtitles, text, watermark and low quality motion`;
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
    maxTokens = 700,
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
    this.maxTokens = Number(maxTokens) || 1400;
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

  async loadModel(needsVision, modelName = this.model, { allowFallback = false } = {}) {
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
    const existing = available.loaded_instances?.[0];
    if (existing?.id) return { instanceId: existing.id, model: available, loadedNow: false, fallbackFrom };
    const loaded = await this.request("/api/v1/models/load", {
      method: "POST",
      body: JSON.stringify({
        model: available.key,
        context_length: this.contextLength,
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

  async enhance({ text, target, mode = "text", image = null, workflowName = "", model = "", includeNegative = false }) {
    const idea = String(text || "").trim();
    if (!idea) throw new Error("Scrivi prima una frase o una richiesta di modifica.");
    const targetRule = TARGET_RULES[target] || TARGET_RULES.studio;
    const needsVision = Boolean(image);
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
      loaded = await this.loadModel(needsVision, model || this.model, { allowFallback: Boolean(model) });
      const userText = [
        `Target workflow: ${workflowName || target}.`,
        `Mode: ${mode === "text" ? "text-to-image/video" : "source-based editing or animation"}.`,
        needsVision ? "Inspect the attached source image before writing the prompt." : "",
        `User request: ${idea}`,
      ].filter(Boolean).join("\n");
      const userContent = needsVision
        ? [
            { type: "text", content: userText },
            { type: "image", data_url: `data:${image.mimetype};base64,${image.buffer.toString("base64")}` },
          ]
        : userText;
      const videoTarget = isVideoTarget(target);
      const systemPrompt = [
        this.instructions,
        "Model-specific direction:",
        targetRule,
        includeNegative ? (videoTarget ? VIDEO_NEGATIVE_PROMPT_SCHEMA_RULE : NEGATIVE_PROMPT_SCHEMA_RULE) : "",
      ].filter(Boolean).join("\n\n");
      const payload = await this.request("/api/v1/chat", {
        method: "POST",
        body: JSON.stringify({
          model: loaded.instanceId,
          system_prompt: systemPrompt,
          input: userContent,
          reasoning: "off",
          temperature: this.temperature,
          max_output_tokens: this.maxTokens,
          stream: false,
          store: false,
        }),
      }, this.inferenceTimeoutMs);
      const parsed = includeNegative ? parsePromptCompletion(payload) : null;
      const prompt = includeNegative ? cleanOutput(parsed?.prompt) : completionText(payload);
      if (!prompt) throw new Error("LM Studio non ha restituito un prompt utilizzabile.");
      return {
        prompt,
        negativePrompt: includeNegative
          ? cleanOutput(parsed?.negativePrompt) || (videoTarget
            ? videoNegativePromptFallback({ mode })
            : negativePromptFallback({ mode, image }))
          : "",
        model: loaded.model.display_name || loaded.model.key,
        modelKey: loaded.model.key,
        modelFallbackFrom: loaded.fallbackFrom || "",
        usedVision: needsVision,
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
}

export { DEFAULT_INSTRUCTIONS, TARGET_RULES, cleanOutput, parseJsonCompletion };
