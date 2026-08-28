export const CHARACTER_VIDEO_STAGE_STATUSES = Object.freeze(["requested", "running", "completed", "failed", "skipped"]);

const DEFINITIONS = Object.freeze([
  { id: "anchor", label: "Video Anchor" },
  { id: "audio", label: "Dialogue / Audio" },
  { id: "video", label: "Raw Video" },
  { id: "lipSync", label: "Talking Performance" },
  { id: "refine", label: "Video Refine" },
  { id: "master", label: "Master Video" },
]);

function initial(status, reason = null) {
  return { status, reason, generationId: null, output: [], error: null, startedAt: null, finishedAt: null };
}

export function createCharacterVideoPipeline({ anchorGenerationId = null, anchorImage = null, audioMode = "none", refinePreset = "improved", capabilities = {} } = {}) {
  const externalAudio = ["externalTts", "existing"].includes(audioMode);
  const stages = DEFINITIONS.map((definition) => {
    if (definition.id === "anchor") return { ...definition, ...initial("completed"), generationId: anchorGenerationId, output: anchorImage ? [anchorImage] : [], finishedAt: new Date().toISOString() };
    if (definition.id === "audio") {
      if (audioMode === "none") return { ...definition, ...initial("skipped", "Il Character non deve parlare.") };
      if (audioMode === "native") return { ...definition, ...initial("completed", "Audio nativo affidato al Video Engine."), finishedAt: new Date().toISOString() };
      return { ...definition, ...initial("requested") };
    }
    if (definition.id === "video") return { ...definition, ...initial("requested") };
    if (definition.id === "lipSync") return externalAudio
      ? { ...definition, ...initial(capabilities.lipSync ? "requested" : "skipped", capabilities.lipSync ? null : "Lip-sync non disponibile.") }
      : { ...definition, ...initial("skipped", "Non richiesto dalla modalità audio.") };
    if (definition.id === "refine") return refinePreset !== "original"
      ? { ...definition, ...initial(capabilities.videoRefine ? "requested" : "skipped", capabilities.videoRefine ? null : "Video Refine non disponibile.") }
      : { ...definition, ...initial("skipped", "Preset Originale: Raw Video conservato.") };
    return { ...definition, ...initial("requested") };
  });
  return {
    version: 1,
    status: "running",
    audioMode,
    refinePreset,
    stages,
    lastValidVideoGenerationId: null,
    masterGenerationId: null,
    audioAsset: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function updateCharacterVideoStage(pipeline, stageId, patch = {}) {
  if (patch.status && !CHARACTER_VIDEO_STAGE_STATUSES.includes(patch.status)) throw new Error(`Stato Video Pipeline non valido: ${patch.status}`);
  if (!pipeline?.stages?.some((stage) => stage.id === stageId)) throw new Error(`Stage Video Pipeline sconosciuto: ${stageId}`);
  return { ...pipeline, stages: pipeline.stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage), updatedAt: new Date().toISOString() };
}

export function characterVideoStage(pipeline, stageId) {
  return pipeline?.stages?.find((stage) => stage.id === stageId) || null;
}

export function finishCharacterVideoPipeline(pipeline, masterGenerationId) {
  return {
    ...pipeline,
    status: pipeline.stages.some((stage) => stage.status === "failed") ? "completed_with_warnings" : "completed",
    masterGenerationId: masterGenerationId || pipeline.lastValidVideoGenerationId,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
