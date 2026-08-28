export async function enhanceMainPrompt({
  input,
  button,
  status,
  target,
  promptPreset = "",
  duration = "",
  mode,
  workflowName,
  sourceFile,
  sourceFiles = [],
  text,
  negativeInput,
  includeNegative = false,
  buttonScope = null,
  fields = {},
}) {
  if (window.__promptAssistantBusy) {
    status.textContent = "Prompt Assistant già in esecuzione: attendi il risultato corrente.";
    status.classList.add("prompt-assistant-error");
    return null;
  }
  const originalLabel = button.textContent;
  const assistantButtons = Array.from((buttonScope || document).querySelectorAll(".prompt-assistant-button"));
  const previousButtonStates = assistantButtons.map((item) => [item, item.disabled]);
  const data = new FormData();
  data.set("text", String(text ?? input.value).trim());
  data.set("target", target);
  if (promptPreset) data.set("promptPreset", promptPreset);
  if (duration !== "") data.set("duration", String(duration));
  data.set("mode", mode);
  data.set("workflowName", workflowName || target);
  data.set("includeNegative", includeNegative ? "true" : "false");
  for (const [name, value] of Object.entries(fields || {})) {
    if (value !== undefined && value !== null && String(value) !== "") data.set(name, String(value));
  }
  const suppliedFiles = (sourceFiles.length ? sourceFiles : sourceFile ? [sourceFile] : []).filter(Boolean).slice(0, 9);
  if (suppliedFiles.length <= 1) {
    if (suppliedFiles[0]) data.set("sourceImage", suppliedFiles[0]);
  } else {
    for (const file of suppliedFiles) data.append("sourceImages", file);
  }

  window.__promptAssistantBusy = true;
  for (const item of assistantButtons) item.disabled = true;
  button.disabled = true;
  button.textContent = suppliedFiles.length ? `Analisi ${suppliedFiles.length === 1 ? "immagine" : `${suppliedFiles.length} immagini`}…` : "Scrittura prompt…";
  status.textContent = "Avvio LM Studio e caricamento del modello locale…";
  status.classList.remove("prompt-assistant-error");
  try {
    const response = await fetch("/api/prompt-assistant/enhance", { method: "POST", body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
    input.value = payload.prompt;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (negativeInput && payload.negativePrompt) {
      negativeInput.value = payload.negativePrompt;
      negativeInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const memory = payload.cleanup?.comfyMemoryReleased
      ? "LM Studio scaricato · VRAM pronta"
      : payload.cleanup?.comfyMemoryReason === "queue-busy"
        ? "LM Studio scaricato · ComfyUI sta ancora lavorando"
        : "LM Studio scaricato";
    const vision = payload.usedVision ? ` · Vision attiva (${payload.usedImageCount || suppliedFiles.length || 1} immagini)` : "";
    const normalized = payload.visionTranscodedCount ? ` · ${payload.visionTranscodedCount} WebP normalizzato in PNG` : "";
    status.textContent = payload.partial
      ? `${payload.model}${vision}${normalized} · completato con fallback per alcune scene · ${memory}`
      : `${payload.model}${vision}${normalized} · ${memory}`;
    return payload;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("prompt-assistant-error");
    throw error;
  } finally {
    window.__promptAssistantBusy = false;
    for (const [item, disabled] of previousButtonStates) item.disabled = disabled;
    button.textContent = originalLabel;
  }
}

export async function enhanceDirectorPrompts({
  globalInput,
  scenes,
  button,
  status,
}) {
  if (window.__promptAssistantBusy) {
    status.textContent = "Prompt Assistant già in esecuzione: attendi il risultato corrente.";
    status.classList.add("prompt-assistant-error");
    return null;
  }
  const originalLabel = button.textContent;
  const assistantButtons = Array.from(document.querySelectorAll(".prompt-assistant-button"));
  const previousButtonStates = assistantButtons.map((item) => [item, item.disabled]);
  const data = new FormData();
  data.set("text", globalInput.value.trim());
  data.set("scenes", JSON.stringify(scenes.map((scene) => ({
    id: scene.id,
    duration: scene.duration,
    prompt: scene.promptInput.value.trim(),
  }))));
  for (const scene of scenes) {
    if (scene.file) data.set(`sceneImage_${scene.id}`, scene.file);
  }

  window.__promptAssistantBusy = true;
  for (const item of assistantButtons) item.disabled = true;
  button.textContent = "Scrittura Director…";
  status.textContent = "LM Studio sta analizzando storyboard e foto guida…";
  status.classList.remove("prompt-assistant-error");
  try {
    const response = await fetch("/api/prompt-assistant/director", { method: "POST", body: data });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Errore ${response.status}`);
    globalInput.value = payload.globalPrompt;
    globalInput.dispatchEvent(new Event("input", { bubbles: true }));
    payload.scenes.forEach((scene, index) => {
      const target = scenes[index]?.promptInput;
      if (!target) return;
      target.value = scene.prompt || "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const memory = payload.cleanup?.comfyMemoryReleased
      ? "LM Studio scaricato · VRAM pronta"
      : payload.cleanup?.comfyMemoryReason === "queue-busy"
        ? "LM Studio scaricato · ComfyUI sta ancora lavorando"
        : "LM Studio scaricato";
    status.textContent = `${payload.model} · ${memory}`;
    return payload;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("prompt-assistant-error");
    throw error;
  } finally {
    window.__promptAssistantBusy = false;
    for (const [item, disabled] of previousButtonStates) item.disabled = disabled;
    button.textContent = originalLabel;
  }
}
