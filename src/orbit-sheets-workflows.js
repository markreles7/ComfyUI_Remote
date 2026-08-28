import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "workflows");

function template(kind) {
  const file = kind === "location" ? "OrbitSheets_Location_H3_API.json" : "OrbitSheets_Character_H3_API.json";
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

export const ORBIT_SHEETS_NODES = [
  "OrbitSheetsCharacterPrompt", "OrbitSheetsLocationPrompt", "OrbitSheetsFrameSelect",
  "OrbitSheetsContactSheet", "OrbitSheetsAttentionBackend",
];

export function buildOrbitSheetWorkflow(raw = {}, source, config = {}) {
  if (!source?.name) throw new Error("OrbitSheets richiede una Hero image.");
  const h3 = config.h3;
  if (!h3?.available) throw new Error(h3?.reason || "MiniMax H3 non disponibile.");
  const kind = raw.kind === "location" ? "location" : "character";
  const workflow = template(kind);
  const description = String(raw.description || "the exact subject shown in the supplied Hero image").trim();
  const seed = Number.isSafeInteger(Number(raw.seed)) && Number(raw.seed) >= 0 ? Number(raw.seed) : 0;

  for (const id of ["20", "21", "22", "25", "26", "27", "28", "80"]) delete workflow[id];
  workflow["10"].inputs.value = description;
  if (kind === "character") workflow["30"].inputs.visual_style = String(raw.visualStyle || "photorealistic natural reference photography");
  workflow["29"] = { class_type: "LoadImage", inputs: { image: source.subfolder ? `${source.subfolder}/${source.name}` : source.name }, _meta: { title: "OrbitSheets · Hero autorevole" } };
  workflow["40"].inputs.unet_name = h3.files.fl2va;
  workflow["41"].inputs.clip_name = h3.files.clip;
  workflow["41"].inputs.device = "default";
  workflow["42"].inputs.vae_name = h3.files.videoVae;
  workflow["39"].inputs.lora_name = h3.files.turbo;
  delete workflow["73"];
  workflow["74"].inputs.model = ["39", 0];
  workflow["74"].inputs.attention = "comfy kitchen (int8)";
  workflow["45"].inputs.noise_seed = seed;
  workflow["60"].inputs.clip = ["41", 0];
  workflow["60"].inputs.llm_url = "";
  workflow["70"].inputs.filename_prefix = `CharacterLibrary/OrbitSheets/${kind}_sheet`;
  workflow["78"] = { class_type: "SaveImage", inputs: { images: ["60", 0], filename_prefix: `CharacterLibrary/OrbitSheets/${kind}_views` }, _meta: { title: "OrbitSheets · salva viste individuali" } };
  workflow["77"].inputs.filename_prefix = `CharacterLibrary/OrbitSheets/${kind}_turnaround`;
  if (workflow["51"]) workflow["51"].inputs.vae_name = h3.files.audioVae;
  if (workflow["72"]) workflow["72"].inputs.filename_prefix = "CharacterLibrary/OrbitSheets/voice";
  workflow["90"] = { class_type: "LayerUtility: PurgeVRAM", inputs: { anything: ["60", 0], purge_cache: true, purge_models: true }, _meta: { title: "OrbitSheets · purge finale" } };

  return {
    workflow,
    metadata: {
      workflowId: `character:orbitSheets:${kind}`,
      workflowName: `Character Library · OrbitSheets · ${kind}`,
      generationPurpose: "character_reference",
      referenceRole: kind === "location" ? "location_orbit" : "character_turnaround",
      seed,
      orbitSheetKind: kind,
      prompt: description,
    },
  };
}
