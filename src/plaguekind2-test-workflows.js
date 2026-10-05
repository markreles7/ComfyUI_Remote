import { buildMiniMaxH3SparseV9Workflow } from "./minimax-h3-sparse-workflows.js";

export const PLAGUEKIND2_MODE = "plagueKind2Test";
export const PLAGUEKIND2_WORKFLOW = "videoStudio:plagueKind2Test";
export const PLAGUEKIND2_TAIL_NODE = "9202";

function node(class_type, inputs, title) {
  return { class_type, inputs, _meta: { title } };
}

// Only the main sampler output is eligible as a continuity source.
export function buildPlaguekind2TestWorkflow(raw = {}, uploads = {}, loras = [], config = {}) {
  if ([true, "true", "1", "on"].includes(raw.h3SparseMultiSequence)) {
    throw new Error("PlagueKind2Test richiede job separati: prepara prima il piano delle sequenze.");
  }
  if (uploads.h3ContinuityClip) {
    throw new Error("PlagueKind2Test usa esclusivamente i PNG base, mai il video finale come continuità.");
  }
  const contextFrames = Number(raw.h3SparseContinuityFrames || 22);
  if (![5, 22, 39, 56].includes(contextFrames)) throw new Error("Contesto PlagueKind2Test non valido.");
  const job = buildMiniMaxH3SparseV9Workflow(raw, uploads, loras, config);
  const workflow = job.workflow;
  const guides = uploads.plaguekind2ContinuityImages;
  if (guides) {
    if (guides.length !== contextFrames || guides.some((file) => !file?.name)) {
      throw new Error(`PlagueKind2Test richiede esattamente ${contextFrames} frame base di continuità.`);
    }
    let batch;
    guides.forEach((file, index) => {
      const id = String(9300 + index * 2);
      const image = file.subfolder ? `${file.subfolder}/${file.name}` : file.name;
      workflow[id] = node("LoadImage", { image }, `PlagueKind2Test · contesto base ${index + 1}`);
      if (!batch) batch = [id, 0];
      else {
        const batchId = String(9301 + index * 2);
        workflow[batchId] = node("ImageBatch", { image1: batch, image2: [id, 0] }, "PlagueKind2Test · ordine temporale PNG");
        batch = [batchId, 0];
      }
    });
    workflow["24"] = node("MiniMaxH3AddGuide", {
      positive: ["20", 0], latent: ["20", 1], vae: ["2", 0], image: batch, frame_idx: 0,
    }, "PlagueKind2Test · continuità dalla base senza rifinitura");
    workflow["23"].inputs.conditioning = ["24", 0];
    // UltimateUpscale also consumes conditioning directly, before RemoteUnloadCLIP.
    if (workflow["44"]) workflow["44"].inputs.conditioning = ["23", 0];
  }

  // Full temporal decode avoids changing VAE boundary behavior by slicing latents.
  // When there is no upscale, reuse the existing base decode.
  let baseImages = ["50", 0];
  if (job.metadata.stages.latentUpscale) {
    workflow["9200"] = node("VAEDecode", { samples: ["34", 0], vae: ["2", 0] }, "PlagueKind2Test · decode base prima dell’upscale");
    baseImages = ["9200", 0];
  }
  workflow["9201"] = node("ImageFromBatch", {
    image: baseImages, batch_index: job.metadata.frames - contextFrames, length: contextFrames,
  }, "PlagueKind2Test · ultimi frame base");
  workflow[PLAGUEKIND2_TAIL_NODE] = node("SaveImage", {
    images: ["9201", 0], filename_prefix: "VideoStudio/PlagueKind2Test/continuity/base",
  }, "PlagueKind2Test · contesto PNG senza compressione con perdita");
  workflow["57"].inputs.filename_prefix = "VideoStudio/PlagueKind2Test/PlagueKind2Test";
  job.metadata = {
    ...job.metadata,
    workflowId: PLAGUEKIND2_WORKFLOW,
    workflowName: "Video Studio · PlagueKind2Test",
    videoStudioMode: PLAGUEKIND2_MODE,
    videoStudioLabel: `PlagueKind2Test · ${job.metadata.width}×${job.metadata.height}`,
    continuitySource: "base-png",
    continuityFrames: contextFrames,
  };
  return job;
}

export function buildPlaguekindH3Workflow(raw = {}, uploads = {}, loras = [], config = {}) {
  const job = buildPlaguekind2TestWorkflow(raw, uploads, loras, config);
  job.workflow[PLAGUEKIND2_TAIL_NODE].inputs.filename_prefix = "VideoStudio/PlagueKindH3/continuity/base";
  job.workflow["57"].inputs.filename_prefix = "VideoStudio/PlagueKindH3/PlagueKindH3";
  for (const node of Object.values(job.workflow)) {
    if (node._meta?.title) node._meta.title = node._meta.title.replaceAll("PlagueKind2Test", "PlagueKind H3");
  }
  Object.assign(job.metadata, {
    workflowId: "videoStudio:h3SparseV9",
    workflowName: "Video Studio · PlagueKind H3",
    videoStudioMode: "h3SparseV9",
    videoStudioLabel: `PlagueKind H3 · ${job.metadata.width}×${job.metadata.height}`,
  });
  return job;
}
