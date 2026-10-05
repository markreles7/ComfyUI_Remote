export function inferPlaguekindSequences(text, fallbackDuration = 8) {
  // Only the original request determines the count, not wrapper instructions,
  // the reviewed screenplay or the three unselected alternatives.
  const request = String(text).split(/User request:\s*/iu).at(-1)
    .split(/\n(?:Aspect ratio:|SCENEGGIATURA ESAMINATA:|Selected LoRA visual direction)/u)[0];
  const words = { due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const match = request.match(/\b(\d+|due|tre|quattro|cinque|sei|sette|otto|two|three|four|five|six|seven|eight)\s+(?:sequenz[ae]|sequences?|segment[oi]|segments?|clip)\b/iu);
  const blocks = request.split(/^\s*---\s*$/mu).filter((part) => part.trim()).length;
  const count = match ? Number(match[1]) || words[match[1].toLowerCase()] : Math.max(1, blocks);
  if (count < 1 || count > 8) throw new Error("PlagueKind supporta da 1 a 8 sequenze per richiesta.");
  const per = request.match(/(?:sequenz[ae]|sequences?|segment[oi]|segments?|clip)\s+(?:da|di|of|lasting)\s*(\d+(?:[.,]\d+)?)\s*(?:s\b|second[oi]|seconds?)/iu)
    || request.match(/(\d+(?:[.,]\d+)?)\s*(?:s\b|second[oi]|seconds?)\s*(?:ciascun[ao]|ognun[ao]|each|per\s+(?:sequenza|segmento|clip))/iu);
  const total = request.match(/(?:scena|video|filmato|scene)\s+(?:di|da|of|lasting)\s*(\d+(?:[.,]\d+)?)\s*(?:s\b|second[oi]|seconds?)/iu);
  const duration = per ? Number(per[1].replace(",", ".")) : count > 1 && total ? Number(total[1].replace(",", ".")) / count : Number(fallbackDuration) || 8;
  if (count > 1 && ![4, 5, 6, 8, 10, 12, 15].includes(duration)) {
    throw new Error("Per ciascuna sequenza PlagueKind scegli 4, 5, 6, 8, 10, 12 o 15 secondi.");
  }
  if (count > 1 && per && total && Number(total[1].replace(",", ".")) !== count * duration) {
    throw new Error("La durata totale non corrisponde al numero di sequenze e alla durata di ciascuna. Correggi la richiesta e riprova.");
  }
  return { count, duration, totalDuration: count * duration };
}

export function plaguekindSequenceContract(plan, stage = "final") {
  if (plan.count < 2) return "";
  return `MANDATORY SEQUENCE PLAN: ${plan.count} separate generations, ${plan.duration} seconds EACH, ${plan.totalDuration} seconds total.
${stage === "review" ? `Give one overall evaluation and one screenplay clearly divided into ${plan.count} chronological sequences, with exactly three optional alternatives in the required JSON schema. Do not write final prompts yet.` : `Write exactly ${plan.count} COMPLETE standalone English H3 prompts, separated by a line containing exactly --- . No Prompt 1/Prompt 2 headings. Use all six native sections in EACH prompt.`}
Each clip has its own local timeline from 00:00.000 to ${plan.duration} seconds; do not carry global timestamps into the next clip.
Distribute the requested events across the clips without repeating them. End each clip with a concrete physical handoff state. Start the next clip at that exact state: same identities, stable speaker IDs, wardrobe, props and ownership, environment, accumulated changes, positions, momentum and ongoing sounds. Restate that state explicitly rather than saying only 'continue'.
Camera angles may change when requested or useful without resetting the physical scene. Only the first clip starts from the user's opening reference; later clips continue from the preceding generated ending. Apply only the explicitly selected alternative; keep the requested sequence count and per-clip duration.`;
}
