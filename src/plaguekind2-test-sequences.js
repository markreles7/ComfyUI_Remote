import crypto from "node:crypto";
import { planPlaguekindSeparateSequences, plaguekindSeparateJobInput } from "./plaguekind-separate-sequences.js";
import { PLAGUEKIND2_MODE, PLAGUEKIND2_TAIL_NODE } from "./plaguekind2-test-workflows.js";

export function planPlaguekind2TestSequences(raw) {
  return planPlaguekindSeparateSequences({ ...raw, videoStudioMode: "h3SparseV9" });
}

export function plaguekind2TestJobInput(raw, plan, index, uploads, continuityImages = null) {
  if (index > 0 && (!Array.isArray(continuityImages) || continuityImages.length !== plan.contextFrames)) {
    throw new Error("Mancano i PNG base per proseguire PlagueKind2Test. Nessun fallback al video rifinito.");
  }
  // Reuse reference preservation and I2V-to-reference rules without modifying V9.
  const result = plaguekindSeparateJobInput(raw, plan, index, uploads,
    index > 0 ? { name: "base-png-placeholder" } : null);
  delete result.uploads.h3ContinuityClip;
  if (index > 0) result.uploads.plaguekind2ContinuityImages = continuityImages;
  result.raw.videoStudioMode = raw.videoStudioMode === "h3SparseV9" ? "h3SparseV9" : PLAGUEKIND2_MODE;
  return result;
}

export function splitPlaguekind2History(entry, expectedFrames) {
  const continuityImages = entry.outputs?.[PLAGUEKIND2_TAIL_NODE]?.images || [];
  const keys = continuityImages.map((file) => `${file.type}/${file.subfolder}/${file.filename}`);
  if (continuityImages.length !== expectedFrames || new Set(keys).size !== expectedFrames
    || continuityImages.some((file) => file.type !== "output" || !/\.png$/iu.test(file.filename || ""))) {
    throw new Error(`PlagueKind2Test: contesto base incompleto, attesi ${expectedFrames} PNG distinti. La sequenza successiva resta bloccata.`);
  }
  const outputs = { ...entry.outputs };
  delete outputs[PLAGUEKIND2_TAIL_NODE];
  return { continuityImages, publicEntry: { ...entry, outputs } };
}

export async function uploadPlaguekind2Continuity(comfy, generation, expectedFrames) {
  const files = generation.continuityImages;
  // Validate the persisted manifest on resume as well as on first completion.
  splitPlaguekind2History({ outputs: { [PLAGUEKIND2_TAIL_NODE]: { images: files } } }, expectedFrames);
  const token = crypto.randomUUID();
  const uploaded = [];
  for (const [index, file] of files.entries()) {
    const response = await fetch(comfy.mediaUrl(file), { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Impossibile recuperare il frame base ${index + 1} (${response.status}).`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
      || buffer.readUInt32BE(16) !== generation.width || buffer.readUInt32BE(20) !== generation.height) {
      throw new Error(`Frame base ${index + 1} non valido o di risoluzione diversa dalla generazione base.`);
    }
    uploaded.push(await comfy.uploadImage({ buffer, mimetype: "image/png", size: buffer.length,
      originalname: `plaguekind2-${token}-${String(index).padStart(3, "0")}.png` }));
  }
  return uploaded;
}
