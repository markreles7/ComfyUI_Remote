import assert from "node:assert/strict";
import test from "node:test";
import { LmStudioClient, TARGET_RULES, cleanOutput, parseJsonCompletion } from "../src/lm-studio-client.js";

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

test("LTX Scene accetta testo non JSON e compila negativo fallback", async () => {
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
        return response({ output: [{
          type: "message",
          content: "{\"prompt\":\"Scene 1: A clean LTX scene prompt.\\nScene 2: Camera follows",
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

  assert.equal(result.prompt, "Scene 1: A clean LTX scene prompt.\nScene 2: Camera follows");
  assert.match(result.negativePrompt, /temporal coherence/);
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

test("espone preset LM Studio distinti per prompt LTX semplice e a scene", () => {
  assert.match(TARGET_RULES.ltx_architect, /single continuous paragraph/i);
  assert.match(TARGET_RULES.ltx_architect, /source image as authoritative/i);
  assert.match(TARGET_RULES.ltx_scenes, /cut-scene script/i);
  assert.match(TARGET_RULES.ltx_scenes, /timecode/i);
  assert.match(TARGET_RULES.sulphur_ltx_architect, /Sulphur 2/i);
  assert.match(TARGET_RULES.sulphur_ltx_scenes, /multi-scene/i);
  assert.match(TARGET_RULES.sulphur_ltxedit, /video-to-video/i);
});

test("espone preset LM Studio distinti per image editing Qwen e Klein", () => {
  assert.match(TARGET_RULES.qwen_image_edit_architect, /Qwen-Image-Edit-2511/i);
  assert.match(TARGET_RULES.qwen_image_edit_architect, /editing contract/i);
  assert.match(TARGET_RULES.qwen_image_edit_architect, /modify only the requested area/i);
  assert.match(TARGET_RULES.qwen_image_edit_architect, /110-220 words/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /FLUX\.2 Klein 9B/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /editing contract/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /modify only the requested area/i);
  assert.match(TARGET_RULES.flux2_klein_architect, /90-180 words/i);
});

test("espone Reverse Prompt vision distinti per Qwen e Klein", () => {
  assert.match(TARGET_RULES.reverse_qwen, /recreate it with Qwen Image/i);
  assert.match(TARGET_RULES.reverse_qwen, /Do not refer to "the image"/i);
  assert.match(TARGET_RULES.reverse_klein, /FLUX\.2 Klein/i);
  assert.match(TARGET_RULES.reverse_klein, /visual-direction prompt/i);
});
