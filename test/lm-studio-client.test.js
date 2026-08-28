import assert from "node:assert/strict";
import test from "node:test";
import {
  LM_STUDIO_SYSTEM_PROMPT_CATALOG,
  LmStudioClient,
  TARGET_RULES,
  cleanOutput,
  h3TimelineEndSeconds,
  normalizeMiniMaxH3Prompt,
  parseJsonCompletion,
  parseReferencePlanCompletion,
} from "../src/lm-studio-client.js";
import { PRESETS, resolveGenerationSystemPrompt } from "../src/generation-system-prompts.js";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "Test error",
    async json() {
      return payload;
    },
  };
}

test("ripulisce reasoning e delimitatori dal prompt locale", () => {
  assert.equal(cleanOutput("<think>hidden</think>\nPrompt: \"A cinematic pool scene.\""), "A cinematic pool scene.");
});

test("Moody Krea richiede a LM Studio un'identità iniziale precisa", () => {
  assert.match(TARGET_RULES.krea2_moody, /must begin with one precise adult human identity anchor/i);
  assert.match(TARGET_RULES.krea2_moody, /Southern European\/Mediterranean ancestry/i);
  assert.doesNotMatch(TARGET_RULES.krea2, /default to Southern European/i);
});

test("carica, usa la vision e scarica sempre il modello", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") {
        return response({ model_instance_id: "prompt-assistant", load_time_seconds: 2, status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.reasoning, "off");
        assert.match(body.system_prompt, /MANDATORY OUTPUT LANGUAGE/);
        assert.match(body.system_prompt, /Write every enhanced prompt/);
        assert.match(body.system_prompt, /Translate the user's request into English/);
        assert.match(body.system_prompt, /more than 5,000 characters/);
        assert.match(body.system_prompt, /ADULT EXPLICIT VOCABULARY/);
        assert.match(body.system_prompt, /blowjob, deep throat, sex, anal sex, vaginal sex, cock sucking/i);
        assert.match(body.system_prompt, /unambiguously an adult/i);
        assert.equal(body.max_output_tokens, 2048);
        assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
        return response({ output: [{ type: "message", content: "A precise edited pool photograph." }] });
      }
      if (path === "/api/v1/models/unload") return response({ instance_id: "prompt-assistant" });
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "Aggiungi una persona in piscina",
    target: "qwenedit",
    mode: "image",
    image: { mimetype: "image/png", buffer: Buffer.from("image") },
  });

  assert.equal(result.prompt, "A precise edited pool photograph.");
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/v1/models",
    "/api/v1/models/load",
    "/api/v1/chat",
    "/api/v1/models/unload",
  ]);
});

test("corregge automaticamente la prosa non inglese prima di restituire il prompt", async () => {
  let chatCalls = 0;
  const client = new LmStudioClient({
    model: "text-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "text-model", display_name: "Text Model", capabilities: {}, loaded_instances: [] }] });
      }
      if (path === "/api/v1/models/load") return response({ model_instance_id: "prompt-assistant", status: "loaded" });
      if (path === "/api/v1/chat") {
        chatCalls += 1;
        if (chatCalls === 1) return response({ output: [{ type: "message", content: "Una donna cammina mentre la fotocamera segue la ragazza." }] });
        assert.match(body.system_prompt, /LANGUAGE REPAIR TASK/);
        return response({ output: [{ type: "message", content: "An adult woman walks naturally while the handheld camera follows her through the city." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({ text: "Una donna cammina in città", target: "flux1" });
  assert.equal(chatCalls, 2);
  assert.match(result.prompt, /^An adult woman/);
  assert.doesNotMatch(result.prompt, /\b(?:una|donna|mentre|fotocamera|ragazza)\b/i);
});

test("Character Genesis restituisce blueprint e prompt Krea strutturati", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "vision-model", display_name: "Vision Model", capabilities: { vision: true }, loaded_instances: [{ id: "loaded" }] }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /Character Genesis planner/);
        assert.match(body.system_prompt, /subjectKind/);
        assert.match(body.system_prompt, /technicalNegativePrompt/);
        return response({ output: [{ type: "message", content: JSON.stringify({
          name: "Milo",
          subjectKind: "animal",
          identity: {
            appearance: "A medium-sized dog",
            head: "alert ears",
            body: "compact body",
            hairOrCoat: "light-brown coat",
            distinctiveFeatures: ["white chest patch"],
            colors: ["brown", "white"],
            proportions: "medium size",
          },
          technicalPrompt: "A clean realistic hero portrait of one medium-sized dog.",
          technicalNegativePrompt: "duplicate animal, malformed anatomy, text, watermark",
        }) }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.createCharacterGenesis({ description: "Un cane marrone." });
  assert.equal(result.subjectKind, "animal");
  assert.match(result.technicalPrompt, /hero portrait/);
  assert.equal(result.model, "Vision Model");
});

test("Adaptive Reference Factory usa Hero vision e restituisce soli ruoli strutturati", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "vision-model", display_name: "Vision Model", capabilities: { vision: true }, loaded_instances: [{ id: "loaded" }] }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /Adaptive Reference Factory planner/);
        assert.match(body.system_prompt, /contact sheets/);
        assert.match(body.system_prompt, /exactly 4 distinct useful roles/);
        assert.equal(body.max_output_tokens, 2048);
        assert.match(body.input[0].content, /Allowed role catalog/);
        assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
        return response({ output: [{ type: "message", content: JSON.stringify({ subjectKind: "animal", items: [
          {
            referenceRole: "head_front",
            angle: "front",
            pose: "head portrait",
            expression: "neutral",
            technicalPrompt: "Preserve the same dog, coat and markings; change only to a centered front head view.",
            technicalNegativePrompt: "changed coat, changed markings, extra animals, text, watermark",
          },
        ] }) }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.planCharacterReferences({
    character: { id: "dog-1", name: "Milo", subjectKind: "auto", characterBlueprint: {} },
    image: { mimetype: "image/png", buffer: Buffer.from("hero") },
    workflow: { id: "qwenEdit", name: "Qwen Image Edit 2511" },
    allowedRoles: [{ referenceRole: "head_front", type: "face", angle: "front", pose: "head portrait", expression: "neutral" }],
  });
  assert.equal(result.items[0].referenceRole, "head_front");
  assert.equal(result.subjectKind, "animal");
  assert.match(result.items[0].technicalPrompt, /same dog/);
  assert.equal(result.usedVision, true);
});

test("Adaptive Reference Factory recupera gli elementi completi da un array JSON troncato", () => {
  const item = (role) => JSON.stringify({
    referenceRole: role,
    angle: "front",
    pose: "neutral",
    expression: "neutral",
    technicalPrompt: `Preserve the same identity and create the ${role} reference.`,
    technicalNegativePrompt: "identity drift, duplicate subject, text, watermark",
  });
  const malformed = `{"subjectKind":"human","items":[${item("head_front")} ${item("head_left")},${item("head_right")},${item("full_body")},{"referenceRole":"truncated"`;
  const parsed = parseReferencePlanCompletion({
    output: [{ type: "message", content: malformed }],
  });
  assert.equal(parsed.subjectKind, "human");
  assert.deepEqual(parsed.items.map((entry) => entry.referenceRole), ["head_front", "head_left", "head_right", "full_body"]);
});

test("Scene Architect trasforma una frase italiana in blueprint e prompt tecnico strutturati", async () => {
  const client = new LmStudioClient({
    model: "text-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "text-model", display_name: "Text Model", capabilities: {}, loaded_instances: [{ id: "loaded" }] }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /Scene Architect and Prompt Assistant/);
        assert.match(body.system_prompt, /sceneBlueprint/);
        assert.match(body.input, /Al mare di sera mentre cammina/);
        assert.match(body.input, /head_3q_left/);
        return response({ output: [{ type: "message", content: JSON.stringify({
          sceneBlueprint: {
            location: "a quiet beach",
            action: "walking along the shoreline",
            camera: "natural eye-level camera",
            framing: "full body",
            lighting: "soft sunset light",
            time: "evening",
            mood: "serene",
            outfit: "preserve the original outfit",
            subjectInteraction: "feet meeting the wet sand",
            userIntent: "An evening beach walk",
          },
          technicalPrompt: "Place the same character walking naturally along a quiet evening beach, preserving identity and using the Hero and three-quarter reference.",
          technicalNegativePrompt: "identity drift, duplicate subject, malformed anatomy, text, watermark",
        }) }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.planCharacterPhoto({
    character: { id: "emma", name: "Emma", subjectKind: "human", characterBlueprint: {} },
    userIntent: "Al mare di sera mentre cammina.",
    choices: { outfitMode: "keep" },
    selectedReferences: [{ id: "hero", type: "hero" }, { id: "three-quarter", referenceRole: "head_3q_left" }],
    workflow: { id: "qwenEdit", name: "Qwen Image Edit" },
  });
  assert.equal(result.sceneBlueprint.location, "a quiet beach");
  assert.match(result.technicalPrompt, /same character/);
  assert.equal(result.model, "Text Model");
});

test("ogni refine del Character Master usa blueprint, modello target e immagine precedente", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") return response({ models: [{ key: "vision-model", display_name: "Vision Model", capabilities: { vision: true }, loaded_instances: [{ id: "loaded" }] }] });
      if (path === "/api/v1/chat") {
        assert.match(body.input[0].content, /Pipeline stage: krea/);
        assert.match(body.input[0].content, /Character Blueprint:.*silver hair/);
        assert.match(body.input[0].content, /Scene Blueprint:.*rooftop/);
        assert.match(body.input[0].content, /Krea conservative refine/);
        assert.match(body.input[0].content, /hero/);
        assert.match(body.input[0].content, /scene-42/);
        assert.match(body.input[0].content, /Preserve the exact same human identity/);
        assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
        return response({ output: [{ type: "message", content: JSON.stringify({ prompt: "Conservatively refine the same subject.", negativePrompt: "identity drift, changed pose" }) }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.planCharacterPhotoStage({
    character: { id: "char-1", characterBlueprint: { identity: { hair: "silver hair" } } },
    sceneBlueprint: { location: "rooftop" },
    selectedReferences: [{ id: "hero", type: "hero" }],
    previousStage: { generationId: "scene-42" },
    targetModel: { name: "Krea conservative refine" },
    stage: "krea",
    objective: "photographic realism",
    identityProtection: "Preserve the exact same human identity.",
    image: { mimetype: "image/png", buffer: Buffer.from("previous") },
  });
  assert.equal(result.prompt, "Conservatively refine the same subject.");
  assert.equal(result.usedVision, true);
});

test("Character Video Architect restituisce Video Blueprint e Motion Prompt inglese per il target reale", async () => {
  const client = new LmStudioClient({
    model: "text-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") return response({ models: [{ key: "text-model", display_name: "Text Model", capabilities: {}, loaded_instances: [{ id: "loaded" }] }] });
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /guided Character Video Architect and Motion Prompt Builder/);
        assert.match(body.system_prompt, /videoBlueprint/);
        assert.match(body.system_prompt, /production-ready English LTX 2\.3/);
        assert.match(body.input, /Cammina sulla spiaggia/);
        assert.match(body.input, /LTX 2\.3/);
        assert.match(body.input, /Identity stability/);
        return response({ output: [{ type: "message", content: JSON.stringify({
          videoBlueprint: {
            scene: "sunset beach", subjectMotion: "walks along the shore", cameraMotion: "slow tracking",
            framing: "medium full shot", environmentMotion: "gentle waves", facialPerformance: "occasional glances",
            duration: 5, dialogue: "Ciao", emotion: "warm", audioMode: "native",
          },
          scenePrompt: "A cinematic sunset beach with the same adult character in the established wardrobe.",
          motionPrompt: "The same character walks naturally along the sunset shore while the camera tracks smoothly.",
          audioPrompt: "Generate clean native dialogue audio synchronized to the performance.",
          dialogueInstructions: "Speak the supplied dialogue verbatim with natural timing.",
          emotionInstructions: "Use a warm, restrained facial and vocal performance.",
        }) }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.planCharacterVideo({
    character: { id: "char-1", name: "Emma", subjectKind: "human", characterBlueprint: {} },
    videoIntent: "Cammina sulla spiaggia",
    filmingStyle: "cinematic",
    duration: 5,
    dialogue: "Ciao",
    audioMode: "native",
    engine: { id: "ltx23", name: "LTX 2.3", capabilities: { imageToVideo: true, dialogue: true, nativeAudio: true } },
    motionContract: ["Identity stability: preserve the exact same human identity."],
  });
  assert.equal(result.videoBlueprint.audioMode, "native");
  assert.match(result.motionPrompt, /same character/);
  assert.match(result.scenePrompt, /sunset beach/);
  assert.match(result.audioPrompt, /native dialogue/);
});

test("i nuovi preset generativi restano isolati dalle istruzioni custom precedenti", async () => {
  const client = new LmStudioClient({
    model: "text-model",
    instructions: "Custom local instruction.",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "text-model", loaded_instances: [{ id: "loaded-text" }] }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /FLUX\.2 \[klein\]/);
        assert.match(body.system_prompt, /MAIN SUBJECT → KEY ACTION OR POSE/);
        assert.doesNotMatch(body.system_prompt, /Custom local instruction/);
        assert.doesNotMatch(body.system_prompt, /MANDATORY OUTPUT LANGUAGE/);
        return response({ output: [{ type: "message", content: "A fully English optimized prompt." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({ text: "scrivi in italiano", target: "flux2" });
  assert.equal(result.prompt, "A fully English optimized prompt.");
});

test("può restituire anche il prompt negativo per editing source-based", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") {
        return response({ model_instance_id: "prompt-assistant", status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /"negativePrompt"/);
        assert.match(body.system_prompt, /do not modify outside/i);
        return response({
          output: [{
            type: "message",
            content: JSON.stringify({
              prompt: "Extend only the selected object while preserving the original photograph.",
              negativePrompt: "do not modify outside the selected area, preserve identity, camera angle, lighting and background, avoid full redraw, extra objects, text, watermark and unrealistic integration",
            }),
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "Allunga solo l'oggetto selezionato",
    target: "qwen_image_edit_architect",
    mode: "image",
    image: { mimetype: "image/png", buffer: Buffer.from("image") },
    includeNegative: true,
  });

  assert.equal(result.prompt, "Extend only the selected object while preserving the original photograph.");
  assert.match(result.negativePrompt, /do not modify outside/);
  assert.match(result.negativePrompt, /avoid full redraw/);
  assert.ok(result.negativePrompt.length < 320);
  assert.doesNotMatch(result.negativePrompt, /camera angle, lighting and background/);
});

test("usa un prompt negativo video-safe per LTX e Sulphur", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") {
        return response({ model_instance_id: "prompt-assistant", status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /video-safe/i);
        assert.match(body.system_prompt, /temporal stability/i);
        assert.doesNotMatch(body.system_prompt, /do not redraw the whole image/i);
        return response({
          output: [{
            type: "message",
            content: JSON.stringify({
              prompt: "The source photo animates into a stable cinematic poolside moment with coherent motion.",
              negativePrompt: "preserve source identity, face consistency, body proportions, outfit continuity, camera continuity, lighting continuity, stable motion, temporal coherence, avoid identity drift, flicker, warped anatomy, subtitles, text and watermark",
            }),
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "La coppia in piscina si muove lentamente",
    target: "sulphur_ltx_architect",
    mode: "image",
    image: { mimetype: "image/png", buffer: Buffer.from("image") },
    includeNegative: true,
  });

  assert.match(result.prompt, /poolside/);
  assert.match(result.negativePrompt, /temporal coherence/);
  assert.doesNotMatch(result.negativePrompt, /redraw the whole image/);
  assert.ok(result.negativePrompt.length < 320);
  assert.ok(result.negativePrompt.split(",").length <= 24);
});

test("scarica il modello anche quando l'inferenza fallisce", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          capabilities: { vision: true },
          loaded_instances: [{ id: "already-loaded" }],
        }] });
      }
      if (path === "/api/v1/chat") return response({ error: "failed" }, 500);
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  await assert.rejects(() => client.enhance({ text: "idea", target: "flux2" }), /LM Studio 500/);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
});

test("può usare un modello LM Studio dedicato per Sulphur", async () => {
  const loadedModels = [];
  const client = new LmStudioClient({
    model: "default-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [
          { key: "default-model", display_name: "Default", loaded_instances: [] },
          { key: "sulphur-enhancer", display_name: "Sulphur Enhancer", loaded_instances: [] },
        ] });
      }
      if (path === "/api/v1/models/load") {
        loadedModels.push(body.model);
        return response({ model_instance_id: body.model, status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.model, "sulphur-enhancer");
        assert.match(body.system_prompt, /Sulphur 2/i);
        return response({ output: [{ type: "message", content: "A Sulphur optimized video prompt." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "cinematic video",
    target: "sulphur_ltx_architect",
    model: "sulphur-enhancer",
  });
  assert.equal(result.prompt, "A Sulphur optimized video prompt.");
  assert.deepEqual(loadedModels, ["sulphur-enhancer"]);
});

test("planSequentialStory chiede JSON strutturato e scarica il modello", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "planner-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "planner-model", display_name: "Planner", loaded_instances: [] }] });
      }
      if (path === "/api/v1/models/load") return response({ model_instance_id: "planner-model", status: "loaded" });
      if (path === "/api/v1/chat") {
        assert.equal(body.reasoning, "off");
        assert.match(body.system_prompt, /Sequential Story/);
        assert.match(body.system_prompt, /MANDATORY OUTPUT LANGUAGE/);
        assert.match(body.system_prompt, /planning field in English/);
        assert.match(body.system_prompt, /one independent ComfyUI job per scene/);
        assert.match(body.input, /Requested scene count: 2/);
        return response({
          output: [{
            type: "message",
            content: JSON.stringify({
              title: "Two scene story",
              globalContinuity: {
                character: "same woman",
                face: "",
                hair: "",
                body: "",
                outfit: "",
                location: "",
                lighting: "",
                cameraStyle: "",
                visualStyle: "",
                temporalRules: "",
              },
              scenes: [
                { id: "scene-1", index: 1, title: "One", duration: 8, prompt: "First clip", negativePrompt: "flicker", continuityNotes: "", startState: "", endState: "standing" },
                { id: "scene-2", index: 2, title: "Two", duration: 8, prompt: "Second clip", negativePrompt: "flicker", continuityNotes: "", startState: "standing", endState: "sitting" },
              ],
            }),
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.planSequentialStory({
    description: "two clips",
    sceneCount: 2,
    sceneDuration: 8,
    characterContext: "Character pack prompt",
  });
  assert.equal(result.scenes.length, 2);
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/v1/models",
    "/api/v1/models/load",
    "/api/v1/chat",
    "/api/v1/models/unload",
  ]);
});

test("Sulphur Prompt accetta risposta non JSON e compila il negativo in fallback", async () => {
  const client = new LmStudioClient({
    model: "sulphur-enhancer",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "sulphur-enhancer",
          display_name: "Sulphur Enhancer",
          loaded_instances: [{ id: "loaded-sulphur" }],
        }] });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.model, "loaded-sulphur");
        assert.match(body.system_prompt, /dedicated Sulphur prompt enhancer/i);
        assert.match(body.system_prompt, /strict JSON/i);
        return response({
          output: [{
            type: "message",
            content: "A realistic handheld poolside video begins from the source frame, preserving the couple, lighting and camera crop while the subjects lean closer with stable motion.",
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "La coppia in piscina si avvicina",
    target: "sulphur_prompt",
    mode: "image",
    includeNegative: true,
  });

  assert.match(result.prompt, /poolside video/);
  assert.match(result.negativePrompt, /preserve source identity/);
  assert.match(result.negativePrompt, /temporal coherence/);
});

test("se il modello LM Studio dedicato Sulphur non esiste usa il modello prompt generale", async () => {
  const loadedModels = [];
  const client = new LmStudioClient({
    model: "default-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [
          { key: "default-model", display_name: "Default", loaded_instances: [] },
        ] });
      }
      if (path === "/api/v1/models/load") {
        loadedModels.push(body.model);
        return response({ model_instance_id: body.model, status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.model, "default-model");
        assert.match(body.system_prompt, /Sulphur 2/i);
        return response({ output: [{ type: "message", content: "A Sulphur optimized video prompt with the default assistant model." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "cinematic video",
    target: "sulphur_ltx_architect",
    model: "sulphur-prompt-enhancer",
  });
  assert.equal(result.prompt, "A Sulphur optimized video prompt with the default assistant model.");
  assert.equal(result.modelFallbackFrom, "sulphur-prompt-enhancer");
  assert.deepEqual(loadedModels, ["default-model"]);
});

test("blocca richieste concorrenti e libera il lock a fine prompt", async () => {
  let releaseChat;
  let chatStarted;
  let chatCalls = 0;
  const chatStartedPromise = new Promise((resolve) => { chatStarted = resolve; });
  const client = new LmStudioClient({
    model: "text-model",
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "text-model",
          capabilities: { vision: false },
          loaded_instances: [{ id: "loaded-text" }],
        }] });
      }
      if (path === "/api/v1/chat") {
        chatCalls += 1;
        chatStarted();
        if (chatCalls === 1) await new Promise((resolve) => { releaseChat = resolve; });
        return response({ output: [{ type: "message", content: "A clean LTX scene prompt." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const first = client.enhance({ text: "idea", target: "ltx_scenes" });
  await chatStartedPromise;
  await assert.rejects(
    () => client.enhance({ text: "seconda idea", target: "ltx_scenes" }),
    /sta già scrivendo un prompt/,
  );
  releaseChat();
  assert.equal((await first).prompt, "A clean LTX scene prompt.");
  const second = await client.enhance({ text: "seconda idea", target: "ltx_scenes" });
  assert.equal(second.prompt, "A clean LTX scene prompt.");
});

test("LTX Scene usa il preset Multi-shot senza wrapper JSON o prompt negativo", async () => {
  const client = new LmStudioClient({
    model: "text-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "text-model",
          capabilities: { vision: false },
          loaded_instances: [{ id: "loaded-text" }],
        }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /native multi-shot generation/i);
        assert.doesNotMatch(body.system_prompt, /strict JSON/i);
        return response({ output: [{
          type: "message",
          content: "A hard cut transitions to the second view while the camera follows.",
        }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "idea",
    target: "ltx_scenes",
    includeNegative: true,
  });

  assert.equal(result.prompt, "A hard cut transitions to the second view while the camera follows.");
  assert.equal(result.negativePrompt, "");
  assert.equal(result.promptPreset, "ltx_multi_shot");
});

test("Qwen/Klein accettano JSON non valido e mantengono un prompt utilizzabile", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [{ id: "loaded-vision" }],
        }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /strict JSON/i);
        return response({ output: [{
          type: "message",
          content: "{\"prompt\":\"Change only the selected object, extend its geometry naturally, preserve the original photo, camera angle and lighting",
        }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "Allunga solo l'oggetto selezionato",
    target: "qwen_image_edit_architect",
    mode: "image",
    image: { mimetype: "image/png", buffer: Buffer.from("image") },
    includeNegative: true,
  });

  assert.match(result.prompt, /Change only the selected object/);
  assert.match(result.prompt, /preserve the original photo/);
  assert.match(result.negativePrompt, /do not modify outside/);
  assert.match(result.negativePrompt, /avoid identity drift/);
});

test("Klein image editing usa il preset Reference/Edit senza schema negativo", async () => {
  const client = new LmStudioClient({
    model: "text-model",
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "text-model",
          display_name: "Text Model",
          loaded_instances: [{ id: "loaded-text" }],
        }] });
      }
      if (path === "/api/v1/chat") {
        return response({ output: [{
          type: "message",
          content: "Modify only the requested region, keep the source composition locked, match perspective, shadows, grain and focus.",
        }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhance({
    text: "Sostituisci lo sfondo mantenendo il soggetto",
    target: "flux2_klein_architect",
    mode: "image",
    includeNegative: true,
  });

  assert.match(result.prompt, /Modify only the requested region/);
  assert.equal(result.negativePrompt, "");
  assert.equal(result.promptPreset, "flux_reference");
});

test("estrae JSON Director anche da risposta fenced", () => {
  const parsed = parseJsonCompletion({
    output: [{ type: "message", content: "```json\n{\"globalPrompt\":\"A\",\"scenes\":[{\"prompt\":\"B\"}]}\n```" }],
  });
  assert.deepEqual(parsed, { globalPrompt: "A", scenes: [{ prompt: "B" }] });
});

test("crea prompt strutturati per LTX Director con più immagini", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") {
        return response({ model_instance_id: "director-assistant", status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /strict JSON/);
        assert.match(body.system_prompt, /MANDATORY OUTPUT LANGUAGE/);
        assert.match(body.system_prompt, /globalPrompt, scene prompt and planning field in English/);
        assert.equal(body.input.filter((item) => item.type === "image").length, 2);
        return response({
          output: [{
            type: "message",
            content: JSON.stringify({
              globalPrompt: "Preserve the same adult characters, office lighting and handheld realistic continuity.",
              scenes: [
                { prompt: "Scene one begins from the first reference image with a slow handheld push-in." },
                { prompt: "Scene two continues from the second reference image with a calm pan toward the desk." },
              ],
            }),
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhanceDirectorStoryboard({
    text: "Crea una scena continua in ufficio.",
    scenes: [
      { duration: 6, image: { mimetype: "image/png", buffer: Buffer.from("one") } },
      { duration: 5, image: { mimetype: "image/png", buffer: Buffer.from("two") } },
    ],
  });
  assert.match(result.globalPrompt, /office lighting/);
  assert.equal(result.scenes.length, 2);
  assert.equal(calls.at(-1).path, "/api/v1/models/unload");
});

test("completa il Director con fallback quando LM Studio restituisce scene parziali", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") {
        return response({ model_instance_id: "director-assistant", status: "loaded" });
      }
      if (path === "/api/v1/chat") {
        return response({
          output: [{
            type: "message",
            content: JSON.stringify({
              globalPrompt: "Consistent car interior, daylight, handheld POV continuity.",
              scenes: [{ prompt: "Scene one follows the first image with a slow approach." }],
            }),
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhanceDirectorStoryboard({
    text: "Una persona entra in auto e si siede.",
    scenes: [
      { duration: 5, image: { mimetype: "image/png", buffer: Buffer.from("one") } },
      { duration: 5, prompt: "Existing scene two prompt." },
    ],
  });
  assert.equal(result.partial, true);
  assert.equal(result.scenes.length, 2);
  assert.equal(result.scenes[0].completedFromFallback, false);
  assert.equal(result.scenes[1].prompt, "Existing scene two prompt.");
  assert.equal(result.scenes[1].completedFromFallback, true);
});

test("il fallback Director per una scena vuota continua dalla scena precedente", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision Model",
          capabilities: { vision: true },
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") return response({ model_instance_id: "director-assistant" });
      if (path === "/api/v1/chat") {
        return response({
          output: [{
            type: "message",
            content: JSON.stringify({
              globalPrompt: "A sunny car interior with stable handheld POV continuity.",
              scenes: [{ prompt: "The woman leans into the open passenger window and smiles toward camera." }],
            }),
          }],
        });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.enhanceDirectorStoryboard({
    text: "La ragazza entra nell'auto e si siede.",
    scenes: [
      { duration: 10, image: { mimetype: "image/png", buffer: Buffer.from("one") } },
      { duration: 5, image: { mimetype: "image/png", buffer: Buffer.from("two") } },
    ],
  });
  assert.equal(result.partial, true);
  assert.match(result.scenes[1].prompt, /Continue directly from the previous scene/i);
  assert.match(result.scenes[1].prompt, /attached image as the visual anchor and endpoint/i);
  assert.doesNotMatch(result.scenes[1].prompt, /Describe a clear starting state/i);
  assert.doesNotMatch(result.scenes[1].prompt, /Scene 2 continues the global idea/i);
});

test("planInteractiveCast chiede mode conservativo per ogni evento", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "planner-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "planner-model",
          display_name: "Planner Model",
          capabilities: {},
          loaded_instances: [],
        }] });
      }
      if (path === "/api/v1/models/load") return response({ model_instance_id: "planner-instance" });
      if (path === "/api/v1/chat") {
        assert.match(body.system_prompt, /"mode":"generative"/);
        assert.match(body.system_prompt, /Use mode values only from: audioOnly, lipSyncOnly, composite, generative/);
        assert.match(body.system_prompt, /Choose the least destructive mode/);
        return response({ output: [{ type: "message", content: JSON.stringify({
          actors: { original: [], added: [] },
          dialogueEvents: [{
            speaker: "Original Actor 1",
            start: 1,
            end: 2,
            dialogue: "Not yet.",
            action: "answers",
            preserveVoice: true,
            preserveFace: true,
            reaction: "speak",
            mode: "lipSyncOnly",
          }],
          notes: [],
        }) }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });

  const result = await client.planInteractiveCast({
    brief: "At second 1 John answers.",
    duration: 5,
    analysis: { width: 640, height: 360, fps: 24, codec: "h264", audioStreams: [{}] },
    actors: { original: [{ actorId: "original-1", label: "John" }], added: [] },
  });

  assert.equal(result.dialogueEvents[0].mode, "lipSyncOnly");
  assert.deepEqual(calls.map((item) => item.path), [
    "/api/v1/models",
    "/api/v1/models/load",
    "/api/v1/chat",
    "/api/v1/models/unload",
  ]);
});

test("espone i preset puliti per ciascuna famiglia generativa e il contratto Eros Max", () => {
  assert.deepEqual(LM_STUDIO_SYSTEM_PROMPT_CATALOG.map((profile) => profile.family), ["minimax_h3", "ltx", "qwen", "flux"]);
  assert.equal(LM_STUDIO_SYSTEM_PROMPT_CATALOG.flatMap((profile) => profile.presets).length, 17);
  assert.deepEqual(Object.keys(PRESETS), [
    "h3_general", "h3_image_to_video", "h3_eros_max", "h3_action", "h3_dialogue",
    "ltx_general", "ltx_image_to_video", "ltx_multi_shot", "ltx_dialogue",
    "qwen_general", "qwen_human", "qwen_cinematic", "qwen_text",
    "flux_general", "flux_photo", "flux_json", "flux_reference",
  ]);
  assert.match(resolveGenerationSystemPrompt({ target: "ltx", workflowName: "LTX 2.3" }).systemPrompt, /LTX-2\.3/);
  assert.match(resolveGenerationSystemPrompt({ target: "ltx_architect", workflowName: "LTX 2.5 AIO" }).systemPrompt, /LTX-2\.5/);
  assert.equal(resolveGenerationSystemPrompt({
    target: "minimax_h3",
    preset: "h3_general",
    mode: "image",
  }).id, "h3_image_to_video");
  assert.match(PRESETS.h3_dialogue.systemPrompt, /<d>\[Italian\]/);
  assert.match(PRESETS.h3_eros_max.systemPrompt, /single uploaded image is always <Picture 1>/);
  assert.match(PRESETS.h3_eros_max.systemPrompt, /six fields/);
  assert.match(PRESETS.flux_json.systemPrompt, /Return ONLY valid JSON/);
});

test("normalizza i tre campi H3 quando LM Studio omette le parentesi di chiusura", () => {
  const malformed = "integrated_multimodal_description[0-4s: dolly in.\noverall_soundscape[Footsteps and wind.\nnon_diegetic_music[N/A]";
  assert.equal(normalizeMiniMaxH3Prompt(malformed), [
    "integrated_multimodal_description: [Shot 1] 0-4s: dolly in.",
    "",
    "overall_soundscape: Footsteps and wind.",
    "",
    "non_diegetic_music: N/A",
  ].join("\n"));
});

test("MiniMax H3 corregge il dialogo italiano narrativo e separa realmente l'audio", () => {
  const result = normalizeMiniMaxH3Prompt([
    "Integrated Multimodal Description: She speaks in Italian with a calm voice: “Fa caldo in città.”",
    "Overall Soundscape: Distant traffic, footsteps and light clothing rustle.",
    "Non Diegetic Music: N/A",
  ].join("\n"));
  assert.match(result, /\(S1\) says: <d>\[Italian\] Fa caldo in città\.<\/d>/);
  assert.match(result, /overall_soundscape: Distant traffic, footsteps and light clothing rustle\./);
  assert.equal((result.match(/overall_soundscape:/g) || []).length, 1);
});

test("MiniMax H3 ripara Shot 1 duplicato e recupera il soundscape incorporato nel campo visivo", () => {
  const malformed = [
    "integrated_multimodal_description: hmmotion. [Shot 1] Shot 1] Shot 1 — 00:00–00:08] At 00:00.000, an adult woman stands on a seaside promenade. Camera and visual behavior Single continuous handheld smartphone-style shot. Overall soundscape Continuous seaside ambience, ocean waves, wind and a muted phone impact.",
    "overall_soundscape: N/A",
    "non_diegetic_music: None.",
  ].join(" ");
  const result = normalizeMiniMaxH3Prompt(malformed);
  assert.equal((result.match(/\[Shot 1\]/g) || []).length, 1);
  assert.doesNotMatch(result, /(?<!\[)Shot 1\]|Shot 1 — 00:00|Camera and visual behavior/i);
  assert.match(result, /^integrated_multimodal_description: hmmotion\. \[Shot 1\] At 00:00\.000,/);
  assert.match(result, /overall_soundscape: Continuous seaside ambience, ocean waves, wind and a muted phone impact\./);
  assert.match(result, /non_diegetic_music: N\/A$/);
});

test("MiniMax H3 emette fuori dai campi gli allineamenti I2VA e FL2VA ufficiali", () => {
  const raw = [
    "integrated_multimodal_description: [Shot 1] Live-action, the subject walks forward.",
    "overall_soundscape: Footsteps.",
    "non_diegetic_music: N/A",
  ].join("\n\n");
  const i2v = normalizeMiniMaxH3Prompt(raw, { mode: "image", duration: 8 });
  assert.match(i2v, /^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.\n\nintegrated_multimodal_description:/);
  const fl2v = normalizeMiniMaxH3Prompt(raw, { mode: "firstLast", duration: 8 });
  assert.match(fl2v, /^How the reference pictures align with the target video — Picture 1 \(from Shot 1\) aligns with the 0\.00-second mark of the target video; Picture 2 \(from Shot 1\) aligns with the 8\.00-second mark of the target video\.\n\nintegrated_multimodal_description:/);
  assert.equal((fl2v.match(/reference pictures align/giu) || []).length, 1);
});

test("MiniMax H3 Ref2VA conserva il contratto ufficiale a sei sezioni", () => {
  const result = normalizeMiniMaxH3Prompt([
    "subject_definitions: <Subject 1> is the adult woman from <Picture 1>.",
    "summary: [reference generation] A short walking shot.",
    "retention_analysis: <Picture 1>: fully_preserved.",
    "detailed_description: [Shot 1] <Subject 1> walks toward the camera.",
    "overall_soundscape: Footsteps and street ambience.",
    "non_diegetic_music: N/A",
  ].join("\n"), { fullReference: true });
  assert.match(result, /^subject_definitions:/);
  assert.match(result, /\ndetailed_description: \[Shot 1\]/);
  assert.equal((result.match(/^[a-z_]+:/gm) || []).length, 6);
});

test("Eros Max ripara l'output I2V escapato e Shot 1 duplicato trasformandolo in Ref2VA", () => {
  const broken = String.raw`For the target video, at 0.00 seconds into the target video, \<Picture 1> (from [Shot 1]) is fully referenced.

integrated\_multimodal\_description: [Shot 1] Shot 1] Shot 1] An adult woman sits in the back seat of a moving car and says: <d>[Italian] Ciao</d>.

overall\_soundscape: Soft ambient hum of the moving car and subtle fabric rustle.

non\_diegetic\_music: N/A`;
  const prompt = normalizeMiniMaxH3Prompt(broken, {
    fullReference: true,
    mode: "references",
    duration: 5,
  });
  assert.match(prompt, /^subject_definitions:/);
  assert.match(prompt, /detailed_description: \[Shot 1\] An adult woman/);
  assert.equal((prompt.match(/\[Shot 1\]/g) || []).length, 1);
  assert.doesNotMatch(prompt, /For the target video/);
  assert.doesNotMatch(prompt, /\\_/);
  assert.equal((prompt.match(/^[a-z_]+:/gm) || []).length, 6);
});

test("H3 base Single Image ripara escape e Shot 1 duplicato conservando un solo allineamento I2VA", () => {
  const broken = String.raw`For the target video, at 0.00 seconds into the target video, \<Picture 1> (from [Shot 1]) is fully referenced.

integrated\_multimodal\_description: [Shot 1] Shot 1] At 00:00.000, an adult woman sits inside a moving car.

overall\_soundscape: Low car engine hum and fabric rustle.

non\_diegetic\_music: N/A`;
  const prompt = normalizeMiniMaxH3Prompt(broken, { mode: "image", duration: 8 });
  assert.match(prompt, /^For the target video, at 0\.00 seconds/);
  assert.match(prompt, /integrated_multimodal_description: \[Shot 1\] At 00:00\.000/);
  assert.equal((prompt.match(/integrated_multimodal_description:/g) || []).length, 1);
  assert.equal((prompt.match(/\[Shot 1\] Shot 1\]/g) || []).length, 0);
  assert.doesNotMatch(prompt, /\\[<_]/);
});

test("MiniMax H3 misura la fine reale della timeline", () => {
  assert.equal(h3TimelineEndSeconds("At 00:01.500 she moves. At 00:03.000 she pauses."), 3);
  assert.equal(h3TimelineEndSeconds("From 0-5s the camera tracks; by 7.6 seconds it settles."), 7.6);
});

test("MiniMax H3 riscrive automaticamente un prompt da 8 secondi fermo a 3 secondi", async () => {
  let chatCalls = 0;
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") return response({ models: [{ key: "vision-model", display_name: "Vision", capabilities: { vision: true }, loaded_instances: [] }] });
      if (path === "/api/v1/models/load") return response({ model_instance_id: "h3-duration" });
      if (path === "/api/v1/chat") {
        chatCalls += 1;
        if (chatCalls === 1) {
          return response({ output: [{ type: "message", content: "integrated_multimodal_description: [Shot 1] At 00:00.000 the adult subject begins moving. At 00:03.000 she pauses.\n\noverall_soundscape: Car hum.\n\nnon_diegetic_music: N/A" }] });
        }
        assert.match(body.system_prompt, /TIMELINE COMPLETION REPAIR/);
        assert.match(body.system_prompt, /final 10%/);
        assert.equal(body.input.length, 2);
        assert.match(body.input[0].content, /Target duration: 8\.00 seconds/);
        return response({ output: [{ type: "message", content: "integrated_multimodal_description: [Shot 1] At 00:00.000 the adult subject begins moving. From 00:03.000 to 00:07.400 the action develops continuously. At 00:07.800 she reaches a stable ending pose.\n\noverall_soundscape: Car hum and fabric movement.\n\nnon_diegetic_music: N/A" }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.enhance({
    text: "Animate the adult subject through the full clip.",
    target: "minimax_h3",
    promptPreset: "h3_image_to_video",
    mode: "image",
    duration: 8,
    image: { mimetype: "image/png", buffer: Buffer.from("image") },
  });
  assert.equal(chatCalls, 2);
  assert.equal(result.timelineRepairApplied, true);
  assert.match(result.prompt, /00:07\.800/);
});

test("MiniMax H3 invia fino a nove reference vision a LM Studio nell'ordine Picture N", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === "/api/v1/models") return response({ models: [{ key: "vision-model", display_name: "Vision", capabilities: { vision: true }, loaded_instances: [] }] });
      if (path === "/api/v1/models/load") {
        assert.equal(body.context_length, 16384);
        return response({ model_instance_id: "h3-prompt" });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.input.length, 4);
        assert.equal(body.input[0].content, "Tre frame cinematografici");
        assert.match(body.input[1].data_url, /base64,b25l/);
        assert.match(body.input[3].data_url, /base64,dGhyZWU=/);
        assert.match(body.system_prompt, /integrated_multimodal_description:/i);
        assert.doesNotMatch(body.system_prompt, /strict JSON/i);
        assert.doesNotMatch(body.system_prompt, /4,500-6,500 characters/i);
        assert.match(body.system_prompt, /Focus primarily on what CHANGES after the first frame/i);
        assert.doesNotMatch(body.system_prompt, /binding action contract/i);
        assert.equal(body.temperature, 0.15);
        return response({ output: [{ type: "message", content: "integrated_multimodal_description[0-5s: truck right.]\noverall_soundscape[Footsteps.]\nnon_diegetic_music[N/A]" }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.enhance({
    text: "Tre frame cinematografici",
    target: "minimax_h3",
    images: ["one", "two", "three"].map((value) => ({ mimetype: "image/png", buffer: Buffer.from(value) })),
    includeNegative: true,
  });
  assert.equal(result.usedVision, true);
  assert.equal(result.usedImageCount, 3);
  assert.equal(result.negativePrompt, "");
  assert.match(result.prompt, /^integrated_multimodal_description:/);
});

test("MiniMax H3 ricarica a 16K un'istanza Vision preesistente a 8K", async () => {
  const calls = [];
  const client = new LmStudioClient({
    model: "vision-model",
    contextLength: 8192,
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, body });
      if (path === "/api/v1/models") {
        return response({ models: [{
          key: "vision-model",
          display_name: "Vision",
          max_context_length: 262144,
          capabilities: { vision: true },
          loaded_instances: [{ id: "old-8k", config: { context_length: 8192 } }],
        }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      if (path === "/api/v1/models/load") {
        assert.equal(body.context_length, 16384);
        return response({ model_instance_id: "new-16k" });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.model, "new-16k");
        return response({ output: [{ type: "message", content: "integrated_multimodal_description[0-5s: pan left.]\noverall_soundscape[Wind.]\nnon_diegetic_music[N/A]" }] });
      }
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.enhance({
    text: "Usa la reference",
    target: "minimax_h3",
    images: [{ mimetype: "image/png", buffer: Buffer.from("one") }],
  });
  assert.match(result.prompt, /^integrated_multimodal_description/);
  assert.deepEqual(calls.map(({ path }) => path), [
    "/api/v1/models",
    "/api/v1/models/unload",
    "/api/v1/models/load",
    "/api/v1/chat",
    "/api/v1/models/unload",
  ]);
});

test("espone preset LM Studio distinti per image editing Qwen e Klein", () => {
  assert.match(TARGET_RULES.qwen_image_edit_architect, /Qwen-Image-Edit-2511/i);
  assert.match(TARGET_RULES.qwen_image_edit_architect, /editing contract/i);
  assert.match(TARGET_RULES.qwen_image_edit_architect, /modify only the requested area/i);
  assert.match(TARGET_RULES.qwen_image_edit_architect, /110-220 words/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /multi-reference and image-editing prompt writer/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /purpose of each reference/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /maximum of four image references/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /Do not use negative prompting/i);
});

test("espone Reverse Prompt vision distinti per Qwen e Klein", () => {
  assert.match(TARGET_RULES.reverse_qwen, /recreate it with Qwen Image/i);
  assert.match(TARGET_RULES.reverse_qwen, /Do not refer to "the image"/i);
  assert.match(TARGET_RULES.reverse_qwen, /Never replace visible details with euphemisms/i);
  assert.match(TARGET_RULES.reverse_qwen, /visible physical appearance and anatomy/i);
  assert.match(TARGET_RULES.reverse_klein, /FLUX\.2 Klein/i);
  assert.match(TARGET_RULES.reverse_klein, /visual-direction prompt/i);
  assert.match(TARGET_RULES.reverse_klein, /Never sanitize, euphemize/i);
});

test("Reverse Prompt usa fedeltà letterale, terminologia adulta diretta e temperatura bassa", async () => {
  const client = new LmStudioClient({
    model: "vision-model",
    temperature: 0.35,
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "vision-model", capabilities: { vision: true }, loaded_instances: [{ id: "loaded" }] }] });
      }
      if (path === "/api/v1/chat") {
        assert.equal(body.temperature, 0.15);
        assert.match(body.system_prompt, /Perform a literal visual transcription/i);
        assert.match(body.system_prompt, /Do not censor, sanitize, euphemize/i);
        assert.match(body.system_prompt, /clearly an adult/i);
        assert.match(body.system_prompt, /breasts, nipples, buttocks, genitals/i);
        assert.match(body.system_prompt, /ass, anus, vagina, breasts, breast, tits, cock, penis, busty/i);
        assert.match(body.system_prompt, /do not produce a sexualized reconstruction/i);
        return response({ output: [{ type: "message", content: "A literal generation prompt." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.enhance({
    text: "Transcribe literally.",
    target: "reverse_qwen",
    mode: "reverse",
    image: { mimetype: "image/png", buffer: Buffer.from("image") },
  });
  assert.equal(result.prompt, "A literal generation prompt.");
  assert.equal(result.usedVision, true);
});

test("Reverse Prompt converte WebP in PNG prima di inviarlo alla Vision di LM Studio", async () => {
  const onePixelWebp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==", "base64");
  const client = new LmStudioClient({
    model: "vision-model",
    fetchImpl: async (url, options = {}) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      if (path === "/api/v1/models") {
        return response({ models: [{ key: "vision-model", capabilities: { vision: true }, loaded_instances: [{ id: "loaded" }] }] });
      }
      if (path === "/api/v1/chat") {
        assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
        const encoded = body.input[1].data_url.split(",", 2)[1];
        assert.equal(Buffer.from(encoded, "base64").subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        return response({ output: [{ type: "message", content: "A literal prompt from the visible pixels." }] });
      }
      if (path === "/api/v1/models/unload") return response({});
      throw new Error(`Unexpected path ${path}`);
    },
  });
  const result = await client.enhance({
    text: "Transcribe literally.",
    target: "reverse_qwen",
    mode: "reverse",
    image: { mimetype: "image/webp", buffer: onePixelWebp },
  });
  assert.equal(result.visionTranscodedCount, 1);
  assert.deepEqual(result.visionInputFormats, ["image/png"]);
});
