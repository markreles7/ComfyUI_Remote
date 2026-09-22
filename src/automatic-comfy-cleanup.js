function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

/**
 * Returns the model family that is allowed to trigger the destructive ComfyUI
 * post-generation cleanup.  Keep this deliberately opt-in: older LTX releases
 * and image workflows must retain their loaded models/cache.
 */
export function automaticComfyCleanupFamily(generation = {}) {
  const workflowId = normalized(generation.workflowId);
  const workflowName = normalized(generation.workflowName);
  const videoStudioMode = normalized(generation.videoStudioMode);
  const modelFamily = normalized(generation.modelFamily);

  const isLtx25 = workflowId.includes("ltx25")
    || videoStudioMode.includes("ltx25")
    || Boolean(generation.ltx25Mode || generation.ltx25Profile || generation.ltx25ModelProfile)
    || /\bltx\s*2[.,]5\b/.test(workflowName);
  if (isLtx25) return "ltx25";

  const isMinimaxH3 = workflowId.includes("minimaxh3")
    || /(?:^|:)h3(?:sparse|fast|seamless|temporal|director|ltx)/.test(workflowId)
    || /(?:^|:)(?:action|weaponcombat|seedhunter)h3/.test(workflowId)
    || videoStudioMode.includes("minimaxh3")
    || /(?:^|_)(?:minimax_?)?h3(?:_|$)/.test(modelFamily)
    || /\b(?:minimax\s*)?h3\b/.test(workflowName);
  return isMinimaxH3 ? "minimax-h3" : null;
}

export function shouldAutomaticallyCleanComfy(generation = {}) {
  return automaticComfyCleanupFamily(generation) !== null;
}
