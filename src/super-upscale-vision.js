// The ComfyUI caption node owns the GPU handoff. Never call /free here:
// it would race the currently executing ComfyUI workflow.
export async function unloadSuperUpscaleVision(client) {
  const payload = await client.models();
  for (const model of payload.models || []) {
    for (const instance of model.loaded_instances || []) await client.unload(instance.id);
  }
  const remaining = await client.models();
  if ((remaining.models || []).some((model) => model.loaded_instances?.length)) {
    throw new Error("LM Studio non ha scaricato tutti i modelli: rifinitura sospesa.");
  }
}

export async function captionSuperUpscaleTile(client, body) {
  if (!client.publicConfig().enabled) throw new Error("LM Studio Vision non è abilitato.");
  if (client.active) throw new Error("LM Studio è occupato. Riprova quando è libero.");
  if (!Array.isArray(body.images) || body.images.length !== 3) {
    throw new Error("Servono originale, ritaglio originale e ritaglio da rifinire.");
  }
  const images = body.images.map((value, index) => {
    if (typeof value !== "string" || value.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      throw new Error("Ritaglio Vision non valido.");
    }
    const buffer = Buffer.from(value, "base64");
    if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error("I ritagli Vision devono essere PNG.");
    }
    return { buffer, mimetype: "image/png", originalname: `tile-reference-${index}.png` };
  });
  await client.ensureServer();
  await unloadSuperUpscaleVision(client);
  try {
    const result = await client.enhance({
      target: "super_upscale_tile", mode: "image", images,
      workflowName: "SUPER UPSCALE · rifinitura locale",
      text: [
        "Image 1: original full composition, for context only.",
        "Image 2: original crop, authoritative for objects, structure, material and depth of field.",
        "Image 3: corresponding upscaled crop to refine. Do not endorse invented details in this crop.",
        "Describe ONLY the visible content of this crop, then the restrained material-specific detail to restore.",
        "Keep smooth or defocused surfaces smooth. Preserve geometry, object counts, perspective, lighting and colors.",
        `Global context (not a list of objects to insert): ${String(body.globalPrompt || "").slice(0, 4000)}`,
      ].join("\n"),
    });
    if (result.unloadError) throw new Error(`Scaricamento LM Studio fallito: ${result.unloadError}`);
    if (!result.usedVision || !String(result.prompt || "").trim()) throw new Error("LM Studio non ha prodotto una descrizione Vision valida.");
    return { prompt: result.prompt, model: result.model, unloaded: true };
  } finally {
    // Verify the handoff even if generation, loading or unloading failed.
    await unloadSuperUpscaleVision(client);
  }
}
