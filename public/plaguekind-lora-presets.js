// Version-specific Civitai metadata checked 2026-09-29. No render validation.
import { resolveH3LoraFile } from "./h3-lora-files.js";
export const PLAGUEKIND_LORA_PRESETS = Object.freeze({
  plagueGalaxyAce: {
    label: "Stile · GalaxyAce smartphone",
    file: "STY_GalaxyAce.safetensors", lora: "plagueGalaxyAce", strength: 1,
    sourceUrl: "https://civitai.com/models/2200329?modelVersionId=3201619",
    hint: "GalaxyAce H3: resa da smartphone dei primi anni 2010. Peso 1,00 e nessun trigger; l’autore suggerisce 0,70 se il parlato perde sincronizzazione. Preset singolo, resa con Hybrid PlagueKind da verificare con rendering.",
    promptDirection: "Describe the scene, chronological action, real light sources and requested audio. Let the LoRA supply the phone look; do not add low-quality, grain or compression tags. Preserve the user's camera direction and exact dialogue.",
  },
  plagueContinuityRepair: {
    label: "Movimento · Continuity Repair",
    file: "MOT_Continuity_Repair_H3_trigger-bunny_crisp_motion.safetensors", lora: "plagueContinuityRepair", strength: 0.6,
    sourceUrl: "https://civitai.com/models/2890788?modelVersionId=3268186",
    hint: "Motion Continuity Repair: peso 0,60, nel range 0,50–0,70 indicato per la prima passata. Trigger bunny_crisp_motion. Utile per brevi interruzioni o movimenti incoerenti; non garantisce un miglioramento se il movimento è già corretto. Nessuna seconda passata aggiunta.",
    promptDirection: "Keep the requested action order, physical contacts, trajectories and real-time motion continuous. Describe complete motion arcs with readable transitions and a stable ending. Do not invent additional action, combat, or slow motion.",
  },
  plagueHandheld: {
    label: "Camera · Shaky Handheld H3",
    file: "STY_handheld_h3_100.safetensors",
    aliases: ["handheld_h3_100.safetensors"],
    lora: "plagueHandheld", strength: 1,
    sourceUrl: "https://civitai.com/models/2592748?modelVersionId=3343481",
    hint: "Shaky Handheld H3: oscillazioni da ripresa a mano su inquadrature ferme o in movimento. Peso iniziale sperimentale 1,00; riducilo se il tremolio è eccessivo. Nessun trigger H3 dichiarato. Le indicazioni high-noise e peso 1,7 della descrizione condivisa non sono una raccomandazione verificata per H3.",
    promptDirection: "Use readable handheld micro-jitter and organic operator corrections, preserving subject identity and coherent motion. Do not add a visible camera prop. Do not override an explicitly requested locked-off or CCTV shot.",
  },
  plagueCinemaGrade: {
    label: "Stile · CinemaGrade ep50",
    file: "STY_cinemagrade_style_h3_ep50.safetensors",
    aliases: ["cinemagrade_style_h3_ep50.safetensors"],
    lora: "plagueCinemaGrade", strength: 1,
    sourceUrl: "https://civitai.com/models/2927223?modelVersionId=3312531",
    hint: "CinemaGrade ep50: color grading cinematografico e resa fotorealistica. Peso 1,00 consigliato dall’autore; trigger cinemagradestyle. Versione ep50 più marcata della ep35. LoRA sperimentale addestrata su H3 FL2VA: resa con Hybrid PlagueKind non ancora verificata con rendering.",
    promptDirection: "Use cinematic color grading and a photoreal finish while preserving the requested subjects, identities, props and action. Treat this as visual style, not a character replacement. A photographic source frame may constrain the strength of the new look.",
  },
  plagueHandheldCinemaGrade: {
    label: "Camera + stile · Handheld / CinemaGrade",
    lora: "plagueHandheld", strength: 0.6,
    extraLoras: [{ type: "plagueCinemaGrade", strength: 0.8 }],
    hint: "Handheld 0,60 + CinemaGrade ep50 0,80: combinazione sperimentale più leggera, non una ricetta dell’autore. Trigger: cinemagradestyle. Conserva la richiesta e non aggiunge altre LoRA. Per una ripresa CCTV fissa preferisci CinemaGrade da sola.",
    promptDirection: "Combine restrained handheld micro-jitter with cinematic color grading; preserve reference identities and the requested scene. Do not invent camera props. If the user explicitly requests CCTV or a locked-off shot, preserve the fixed viewpoint rather than adding shake.",
  },
});

export function findPlaguekindPresetLora(type, installed = []) {
  const preset = PLAGUEKIND_LORA_PRESETS[type];
  return resolveH3LoraFile(installed, [preset?.file, ...(preset?.aliases || [])]);
}
