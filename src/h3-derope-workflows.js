import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const templatePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "workflows", "MiniMaxH3_Temporal_DeRope_API.json");
const PROFILES = Object.freeze({
  economy: { q: 0.85, dMax: 3, bridge: 8, inject: 0.65 },
  balanced: { q: 0.75, dMax: 4, bridge: 8, inject: 0.7 },
  maximum: { q: 0.7, dMax: 4, bridge: 8, inject: 0.7 },
});

export function buildH3DeRopeWorkflow(raw = {}, source, config = {}) {
  if (!source?.name) throw new Error("Temporal De-Rope richiede un video H3 completato.");
  const h3 = config.h3;
  if (!h3?.temporalDeRope?.available) throw new Error("Temporal De-Rope non è disponibile: riavvia ComfyUI per caricare MAINodes.");
  const workflow = JSON.parse(fs.readFileSync(templatePath, "utf8"));
  const profileId = Object.hasOwn(PROFILES, raw.profile) ? raw.profile : "balanced";
  const profile = PROFILES[profileId];
  const input = source.subfolder ? `${source.subfolder}/${source.name}` : source.name;
  const seed = Number.isSafeInteger(Number(raw.seed)) && Number(raw.seed) >= 0 ? Number(raw.seed) : 0;
  workflow["119"].inputs.vae_name = h3.files.videoVae;
  workflow["120"].inputs.vae_name = h3.files.audioVae;
  workflow["127"].inputs.unet_name = h3.files.fl2va;
  workflow["128"].inputs.clip_name = h3.files.clip;
  workflow["300"].inputs.file = input;
  workflow["305"].inputs.q = profile.q;
  workflow["305"].inputs.d_max = profile.dMax;
  workflow["305"].inputs.bridge = profile.bridge;
  workflow["309"].inputs.inject = profile.inject;
  workflow["310"].inputs.noise_seed = seed;
  workflow["311"].inputs.prompt = String(raw.prompt || "").trim() || "integrated_multimodal_description: [Shot 1] Preserve the exact source clip, identity, wardrobe, environment, camera path and action. Reconstruct only fast-motion intervals so every frame is crisp at a plausible high shutter speed, with clean limb contours and stable anatomy.\n\noverall_soundscape: Preserve the source timing and diegetic sound.\n\nnon_diegetic_music: N/A";
  workflow["319"].inputs.filename_prefix = `VideoStudio/TemporalDeRope/${profileId}`;
  for (const id of ["320", "321", "322", "323", "324", "325"]) delete workflow[id];
  workflow["326"] = { class_type: "DisTorchPurgeVRAMV2", inputs: { anything: ["304", 0], purge_cache: true, purge_models: true, purge_seedvr2_models: false, purge_qwen3vl_models: true, purge_nunchaku_models: false, HSWQ: false, Ollama: false }, _meta: { title: "De-Rope · purge prima della rigenerazione" } };
  workflow["305"].inputs.samples = ["326", 0];
  workflow["327"] = { class_type: "LayerUtility: PurgeVRAM", inputs: { anything: ["316", 0], purge_cache: true, purge_models: true }, _meta: { title: "De-Rope · purge dopo recupero" } };
  workflow["318"].inputs.images = ["327", 0];
  return {
    workflow,
    metadata: {
      workflowId: "videoStudio:h3TemporalDeRope",
      workflowName: `MiniMax H3 · Temporal De-Rope · ${profileId}`,
      videoStudioStage: "temporalRepair",
      videoStudioLabel: `Temporal De-Rope · ${profileId}`,
      h3Stage: "temporalRepair",
      seed,
      prompt: workflow["311"].inputs.prompt,
      deRopeProfile: profileId,
      deRopeSettings: profile,
      sourceVideo: input,
    },
  };
}
