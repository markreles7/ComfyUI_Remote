const ORDINAL_EVENT = /(?:nella\s+)?(?:prima|seconda|terza|quarta|quinta|sesta|settima|ottava|nona|decima)\s+(?:(?:sequenza|scena|segmento|clip)\s*)?[:,.-]?\s*(.+)$/iu;

export function parseDirectorNaturalSegments(value) {
  const text = String(value || "").trim();
  const explicit = text.split(/^\s*---+\s*$/mu).map((item) => item.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;
  const ordinal = text.split(/[;\n]+/u).map((clause) => {
    const match = clause.trim().match(ORDINAL_EVENT);
    return match?.[1]?.trim() || "";
  }).filter(Boolean);
  if (ordinal.length > 1) return ordinal;
  const numbered = [...text.matchAll(/^\s*\d{1,2}[.)\-:]\s*(.+?)(?=^\s*\d{1,2}[.)\-:]|$)/gmsu)]
    .map((match) => match[1].trim()).filter(Boolean);
  return numbered.length > 1 ? numbered : [];
}
