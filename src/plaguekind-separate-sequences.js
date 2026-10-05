export function planPlaguekindSeparateSequences(raw = {}) {
  if (raw.videoStudioMode !== "h3SparseV9" || ![true, "true", "1", "on"].includes(raw.h3SparseMultiSequence)) return null;
  const prompts = String(raw.prompt || "").split(/^\s*---\s*$/mu).map((part) => part.trim()).filter(Boolean);
  if (prompts.length < 2 || prompts.length > 8) throw new Error("PlagueKind richiede da 2 a 8 prompt separati da --- su una riga.");
  if (Number(raw.h3SparseSegmentCount) !== prompts.length) throw new Error(`PlagueKind ha ricevuto ${prompts.length} prompt, ma l’interfaccia ne attende ${raw.h3SparseSegmentCount}.`);
  if (raw.h3SparseMode === "firstLast") throw new Error("First / Last Frame resta disponibile per una singola sequenza.");
  const contextFrames = Number(raw.h3SparseContinuityFrames || 22);
  if (![5, 22, 39, 56].includes(contextFrames)) throw new Error("Contesto fra sequenze non valido.");
  return { count: prompts.length, duration: Number(raw.duration), contextFrames, prompts };
}

export function plaguekindSeparateJobInput(raw, plan, index, uploads, continuityClip = null) {
  if (!plan || index < 0 || index >= plan.count) throw new Error("Indice di sequenza PlagueKind non valido.");
  const originalMode = String(raw.h3SparseMode || "image");
  const nextUploads = { ...uploads };
  let mode = originalMode;
  if (index > 0) {
    if (!continuityClip?.name) throw new Error("Manca la coda video necessaria alla continuità della sequenza successiva.");
    nextUploads.h3ContinuityClip = continuityClip;
    if (originalMode === "image") {
      const model = String(raw.h3SparseModel || "").toLowerCase();
      const supportsReferences = !model || model.includes("hybrid") || model.includes("eros") || (model.includes("ref2va") && !model.includes("fl2va"));
      if (supportsReferences && uploads.h3FirstFrame?.name) {
        mode = "references";
        nextUploads.h3ReferenceImages = [{ ...uploads.h3FirstFrame, referenceIndex: 0 }];
      } else {
        mode = "text";
      }
    }
  }
  return {
    raw: {
      ...raw,
      prompt: plan.prompts[index],
      h3SparseMode: mode,
      h3SparseMultiSequence: false,
      h3SparseSegmentCount: 1,
      ...(Number.isSafeInteger(Number(raw.seed)) && String(raw.seed).trim() !== ""
        ? { seed: Number(raw.seed) + index } : {}),
    },
    uploads: nextUploads,
  };
}
