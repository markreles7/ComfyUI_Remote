export const SERIES_PERFORMANCE_PRESETS = Object.freeze({
  fast: { label: "Anteprima", description: "Rapida · meno step e minore permanenza in VRAM" },
  balanced: { label: "Bilanciata", description: "Qualità consigliata per l’uso quotidiano" },
  quality: { label: "Massima", description: "Più lenta · adatta al render finale" },
  custom: { label: "Personalizzata", description: "Steps e guidance impostati manualmente" },
});

function profileForFamily(family, turbo) {
  if (family === "flux2") {
    return turbo
      ? { fast: [4, 1], balanced: [6, 1], quality: [8, 1] }
      : { fast: [10, 2], balanced: [18, 2.5], quality: [28, 3] };
  }
  if (family === "qwenedit") {
    return { fast: [8, 4], balanced: [16, 4], quality: [28, 4] };
  }
  return { fast: [12, 4], balanced: [20, 4], quality: [32, 4] };
}

export function resolveSeriesPerformance({ family, file = "", preset = "balanced", defaults = {} }) {
  if (preset === "custom") {
    return {
      steps: Number(defaults.steps) || 20,
      guidance: Number(defaults.guidance) || 4,
      warning: "Profilo manuale: tempi e memoria dipendono dai valori scelti.",
    };
  }
  const turbo = /turbo|4step|lightning/i.test(file);
  const [steps, guidance] = profileForFamily(family, turbo)[preset] || profileForFamily(family, turbo).balanced;
  const bf16 = /bf16/i.test(file);
  const warning = bf16 && family === "qwenedit"
    ? `Qwen Edit BF16 può usare CPU offload su GPU da 12 GB; ${steps} step nel preset ${SERIES_PERFORMANCE_PRESETS[preset].label}.`
    : bf16 && preset === "quality"
      ? "Checkpoint BF16 e preset Massima possono aumentare sensibilmente uso VRAM e tempi."
      : turbo
        ? `Checkpoint distillato/turbo: ${steps} step, guidance ${guidance}.`
        : `${steps} step, guidance ${guidance} · profilo ${SERIES_PERFORMANCE_PRESETS[preset].label}.`;
  return { steps, guidance, warning };
}
