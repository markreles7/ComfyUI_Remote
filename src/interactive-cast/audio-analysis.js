import fs from "node:fs";
import path from "node:path";
import { filterAudioWav } from "./ffmpeg.js";

export function audioAnalysisFallback(analysis, extra = {}) {
  return {
    configured: false,
    extractionReady: Boolean((analysis?.audioStreams || []).length),
    sourceSeparation: extra.sourceSeparation || "NOT CONFIGURED",
    diarization: extra.diarization || "NOT CONFIGURED",
    speakers: extra.speakers || [],
    voiceReferences: [],
    stems: extra.stems || [],
    warnings: [
      ...(extra.warnings || []),
      "Speaker diarization and voice reference extraction require a local audio stack in .tools/interactive-cast.",
    ],
  };
}

export function speakerDiarizationFallback(analysis) {
  const duration = Number(analysis?.duration || 0);
  if (!duration || !(analysis?.audioStreams || []).length) {
    return {
      diarization: "NOT CONFIGURED",
      speakers: [],
      warnings: ["Nessun audio disponibile per creare segmenti speaker fallback."],
    };
  }
  return {
    diarization: "FALLBACK",
    speakers: [{
      speaker: "SPEAKER_00",
      label: "Speaker 00",
      assignedActorId: "",
      start: 0,
      end: duration,
      confidence: 0,
      method: "manual-speaker-window",
      editable: true,
    }],
    warnings: ["Diarization neurale non configurata: creato segmento speaker fallback correggibile manualmente."],
  };
}

const fallbackStemProfiles = [
  {
    role: "dialogueCandidate",
    filename: "dialogue-candidate.wav",
    filter: "highpass=f=160,lowpass=f=4500,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=2.5:attack=12:release=120",
    note: "Speech-band candidate; not AI source separation.",
  },
  {
    role: "ambienceCandidate",
    filename: "ambience-candidate.wav",
    filter: "lowpass=f=9000,volume=0.65",
    note: "Room tone / ambience candidate derived from original mix.",
  },
  {
    role: "musicBedCandidate",
    filename: "music-bed-candidate.wav",
    filter: "highpass=f=80,lowpass=f=14000,volume=0.75",
    note: "Broad music/effects bed candidate derived from original mix.",
  },
];

export async function createFallbackAudioStems({ sourceAudio, projectDirectory }) {
  if (!sourceAudio?.path) {
    return {
      sourceSeparation: "NOT CONFIGURED",
      stems: [],
      warnings: ["Nessun audio sorgente disponibile per creare stem fallback."],
    };
  }
  const stemDirectory = path.join(projectDirectory, "audio-stems");
  fs.mkdirSync(stemDirectory, { recursive: true });
  const stems = [];
  const warnings = [
    "Source separation AI non configurata: stem creati con filtri FFmpeg conservativi.",
  ];
  for (const profile of fallbackStemProfiles) {
    const target = path.join(stemDirectory, profile.filename);
    try {
      await filterAudioWav({
        input: sourceAudio.path,
        output: target,
        filter: profile.filter,
      });
      stems.push({
        role: profile.role,
        method: "ffmpeg-filter-fallback",
        filename: profile.filename,
        path: target,
        relativePath: `audio-stems/${profile.filename}`,
        mimeType: "audio/wav",
        note: profile.note,
      });
    } catch (error) {
      stems.push({
        role: profile.role,
        method: "ffmpeg-filter-fallback",
        error: error.message,
        note: profile.note,
      });
      warnings.push(`Stem ${profile.role} non creato: ${error.message}`);
    }
  }
  return {
    sourceSeparation: stems.some((stem) => stem.relativePath) ? "FALLBACK" : "NOT CONFIGURED",
    stems,
    warnings,
  };
}

export async function buildAudioAnalysis({ analysis, sourceAudio, projectDirectory }) {
  const stems = await createFallbackAudioStems({ sourceAudio, projectDirectory });
  const diarization = speakerDiarizationFallback(analysis);
  return audioAnalysisFallback(analysis, {
    ...stems,
    diarization: diarization.diarization,
    speakers: diarization.speakers,
    warnings: [
      ...(stems.warnings || []),
      ...(diarization.warnings || []),
    ],
  });
}
