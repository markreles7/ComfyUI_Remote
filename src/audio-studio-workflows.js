import crypto from "node:crypto";
import { buildLtx25Workflow } from "./ltx25-workflows.js";

function numberValue(value, fallback, min, max, integer = false, label = "Valore") {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${label} non valido.`);
  }
  return parsed;
}

function seedValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return crypto.randomInt(0, 2 ** 31);
  return numberValue(text, 0, 0, Number.MAX_SAFE_INTEGER, true, "Seed");
}

function options(definition, inputName) {
  const specification = definition?.input?.required?.[inputName];
  return Array.isArray(specification?.[0]) ? specification[0] : [];
}

export function audioStudioConfig(videoConfig = {}, definitions = {}) {
  const h3Definition = definitions.MiniMaxH3MusicStudio;
  const h3Files = videoConfig.h3?.files || {};
  const h3Required = ["fl2va", "clip", "videoVae", "audioVae"];
  const h3MissingModels = h3Required.filter((key) => !h3Files[key]);
  const h3MissingNodes = ["MiniMaxH3MusicStudio", "SaveAudioAdvanced"]
    .filter((name) => !definitions[name]);
  const ltxMode = videoConfig.ltx25?.modes?.textAudio;
  return {
    engines: [
      {
        id: "minimaxH3",
        name: "MiniMax H3 Music Studio",
        description: "Brani cantati o strumentali H3, con struttura musicale e durata fino a 60 secondi.",
        available: h3MissingModels.length === 0 && h3MissingNodes.length === 0,
        reason: h3MissingNodes.length
          ? `Nodi mancanti: ${h3MissingNodes.join(", ")}`
          : h3MissingModels.length ? `Pesi H3 mancanti: ${h3MissingModels.join(", ")}` : null,
      },
      {
        id: "ltx25",
        name: "LTX 2.5 Text to Audio",
        description: "Workflow audio-only ufficiale LTX 2.5 per musica, soundscape ed effetti sonori.",
        available: Boolean(ltxMode?.available),
        reason: ltxMode?.reason || (ltxMode?.available ? null : "Workflow LTX 2.5 Text to Audio non disponibile."),
      },
    ],
    h3: {
      presets: options(h3Definition, "preset"),
      samplers: options(h3Definition, "sampler"),
      schedulers: options(h3Definition, "scheduler"),
      files: h3Files,
    },
  };
}

export function buildAudioStudioWorkflow(raw = {}, config = {}) {
  const engine = String(raw.audioEngine || "minimaxH3");
  const prompt = String(raw.prompt || "").trim();
  if (!prompt) throw new Error("Descrivi la musica o il suono da creare.");
  const seed = seedValue(raw.seed);

  if (engine === "ltx25") {
    const job = buildLtx25Workflow({
      ltx25Mode: "textAudio",
      ltx25Profile: ["preview", "balanced", "final", "maximum"].includes(raw.quality)
        ? raw.quality : "balanced",
      ltx25ModelProfile: "standard",
      ltx25Aspect: "16:9",
      ltx25Fps: 24,
      duration: numberValue(raw.duration, 10, 2, 20, false, "Durata LTX 2.5"),
      seed,
      prompt,
      negativePrompt: String(raw.negativePrompt || "distorted audio, clipping, harsh noise, abrupt cutoff").trim(),
    }, {}, [], config.videoStudio || {});
    return {
      ...job,
      metadata: {
        ...job.metadata,
        workflowId: "audioStudio:ltx25:textAudio",
        workflowName: "Audio Studio · LTX 2.5 Text to Audio",
        generationType: "audioStudio",
        mediaType: "audio",
        audioEngine: "ltx25",
        audioMode: "textAudio",
        quality: raw.quality || "balanced",
      },
    };
  }

  if (engine !== "minimaxH3") throw new Error("Motore Audio Studio non riconosciuto.");
  const capability = config.audioStudio?.engines?.find((item) => item.id === "minimaxH3");
  if (capability && !capability.available) throw new Error(capability.reason || "MiniMax H3 Music Studio non disponibile.");
  const h3 = config.audioStudio?.h3 || {};
  const files = h3.files || {};
  const mode = raw.audioMode === "song" ? "song" : "instrumental";
  const lyrics = String(raw.lyrics || "").trim();
  if (mode === "song" && !lyrics) throw new Error("Per una canzone inserisci il testo, usando sezioni come [Verse] e [Chorus].");
  const duration = numberValue(raw.duration, 20, 5, 60, false, "Durata MiniMax H3");
  const steps = numberValue(raw.steps, 20, 10, 50, true, "Step MiniMax H3");
  const preset = h3.presets?.includes(raw.musicPreset) ? raw.musicPreset : "Custom";
  const sampler = h3.samplers?.includes(raw.sampler) ? raw.sampler : "res_multistep";
  const scheduler = h3.schedulers?.includes(raw.scheduler) ? raw.scheduler : "simple";
  const workflow = {
    "1": {
      class_type: "MiniMaxH3MusicStudio",
      inputs: {
        mode,
        preset,
        duration_seconds: duration,
        steps,
        seed,
        style_notes: prompt,
        instrumentation_notes: String(raw.instrumentation || "").trim(),
        vocalist_notes: String(raw.vocalist || "one expressive adult singer with clear natural diction").trim(),
        lyrics,
        scene: String(raw.recordingScene || "a controlled studio recording captured in one continuous take").trim(),
        soundscape: String(raw.soundscape || "clean studio ambience, no spoken introduction, no audience").trim(),
        language: String(raw.language || "Italian").trim(),
        resolution: ["32", "64", "128"].includes(String(raw.audioCanvas)) ? String(raw.audioCanvas) : "32",
        sampler,
        scheduler,
        unet_name: files.fl2va,
        clip_name: files.clip,
        video_vae_name: files.videoVae,
        audio_vae_name: files.audioVae,
        duration_mode: raw.durationMode === "auto" ? "auto" : "manual",
        prompt_profile: "natural_song_sheet_v2",
      },
      _meta: { title: "Audio Studio · MiniMax H3 Music Studio" },
    },
    "2": {
      class_type: "SaveAudioAdvanced",
      inputs: {
        audio: ["1", 0],
        filename_prefix: "AudioStudio/MiniMaxH3/music",
        format: "mp3",
        "format.quality": "320k",
      },
      _meta: { title: "Audio Studio · salva MP3 320 kbps" },
    },
  };
  return {
    workflow,
    metadata: {
      workflowId: "audioStudio:minimaxH3:music",
      workflowName: `Audio Studio · MiniMax H3 · ${mode === "song" ? "Canzone" : "Strumentale"}`,
      generationType: "audioStudio",
      mediaType: "audio",
      audioEngine: "minimaxH3",
      audioMode: mode,
      musicPreset: preset,
      prompt,
      lyrics,
      duration,
      steps,
      seed,
      sampler,
      scheduler,
      quality: raw.quality || "balanced",
    },
  };
}
