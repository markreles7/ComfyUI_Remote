import { existsSync, readFileSync } from "node:fs";

const profileFile = new URL("../config/lm-studio-h3-inference.json", import.meta.url);
const samplerNames = ["temperature", "top_p", "top_k", "min_p", "repeat_penalty"];

export function validateH3InferenceProfile(profile) {
  if (!profile?.modelKey || !profile.quantization) throw new Error("Il profilo H3 richiede modello e quantizzazione.");
  const sampling = profile.sampling;
  if (!sampling || Object.keys(sampling).some((key) => !samplerNames.includes(key))
    || samplerNames.some((key) => !Number.isFinite(sampling[key]))) {
    throw new Error("Il profilo H3 deve contenere soltanto i cinque sampler supportati da /api/v1/chat.");
  }
  if (["temperature", "top_p", "min_p"].some((key) => sampling[key] < 0 || sampling[key] > 1)
    || !Number.isInteger(sampling.top_k) || sampling.top_k < 1 || sampling.repeat_penalty <= 0) {
    throw new Error("Valori sampler H3 non validi; l'API nativa richiede top_k >= 1.");
  }
  for (const key of ["contextLength", "complexContextLength", "maxOutputTokens", "finalMaxOutputTokens"]) {
    if (!Number.isInteger(profile[key]) || profile[key] <= 0) throw new Error(`Il profilo H3 richiede ${key} intero positivo.`);
  }
  if (profile.maxOutputTokens >= profile.contextLength || profile.finalMaxOutputTokens >= profile.complexContextLength) {
    throw new Error("Il budget H3 deve lasciare contesto per le istruzioni e l'input.");
  }
  return profile;
}

export function readH3InferenceProfile() {
  return existsSync(profileFile) ? validateH3InferenceProfile(JSON.parse(readFileSync(profileFile, "utf8"))) : null;
}

export function matchingH3InferenceProfile(profile, model) {
  return profile && model?.key === profile.modelKey && model?.quantization?.name === profile.quantization ? profile : null;
}
