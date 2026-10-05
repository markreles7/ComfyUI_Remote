import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../config/plaguekind-sceneggiatura.md", import.meta.url), "utf8");
// Keep the substantive guidance; the user's two-stage flow replaces the
// document's original output order and repeated ready-to-paste templates.
const guidance = source.slice(source.indexOf("## Regola generale"), source.indexOf("## Formato di output obbligatorio"))
  .replace("Subito sotto la sceneggiatura, scrivi il prompt pronto da copiare.", "Solo dopo la scelta esplicita dell'utente, scrivi il prompt pronto da copiare.")
  + source.slice(source.indexOf("## Preset LoRA Combat"));

export const PLAGUEKIND_REFERENCE_SECTIONS = ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];

export function plaguekindNeedsComplexFormat({ imageCount = 0, text = "" } = {}) {
  return imageCount > 1 || /(?:strict|strong|rigorous)\s+continuity|continuit[àa]\s+(?:rigorosa|stretta|forte)|preserv\w*\s+(?:exact|rigorous)\s+continuity|each next sequence inherits/iu.test(text);
}

export function hasIncompletePlaguekindSections(text, required = false) {
  return String(text).split(/^\s*---\s*$/mu).some((segment) => {
    const matches = [...segment.matchAll(/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music):[ \t]*/gmu)];
    const usesComplex = /^(?:subject_definitions|retention_analysis|detailed_description):/mu.test(segment);
    if (!required && !usesComplex) return false;
    return matches.length !== PLAGUEKIND_REFERENCE_SECTIONS.length
      || matches.some((match, index) => match[1] !== PLAGUEKIND_REFERENCE_SECTIONS[index]
        || !segment.slice(match.index + match[0].length, matches[index + 1]?.index ?? segment.length).trim())
      || /^integrated_multimodal_description:/mu.test(segment);
  });
}

export function plaguekindSystemPrompt(stage, { complexRequired = false } = {}) {
  // The final pass must never receive the document's review/output templates.
  // Its format comes from the existing mode-specific MiniMax H3 preset.
  if (stage === "final") return `FINAL PROMPT ONLY — the user has already reviewed the scene and explicitly selected a version.
Return only the production-ready MiniMax H3 prompt in English, using the native output schema above. No evaluation, critique, screenplay, suggestions, options, explanations, headings or markdown fences, including inside native fields.
The reviewed screenplay is source material, not an output template. Convert the selected scene into camera-visible action rather than copying the review.
If the selected choice is the original request, apply none of the optional alternatives. Otherwise apply only the selected alternative. Preserve the original request's events and ending over conflicting suggestions in the screenplay.
The base version is the enriched reviewed screenplay: preserve its compatible visual details, intermediate physical actions, sound cues, chronological shot plan and motivated camera changes even when the choice is original. Original means no optional alternative, not a bare paraphrase of the initial request. For a selected alternative, retain the base staging wherever compatible with that choice. Fit all staging within the configured duration and sequence count, respect explicit fixed-camera or single-shot constraints, and never invent dialogue or change the requested ending.
ACTION SCENE DEVELOPMENT — apply only when combat or action is requested:
Carry the enriched combat choreography into the H3 prompt rather than reducing it to "they fight". For a generic fight request, develop varied, spectacular but readable exchanges; for explicit choreography, preserve every specified event in order. Name attacker, opponent, movement, contact or miss, visible reaction and recovery. Build anticipation, escalation and a visually strong peak without inventing a winner or finisher. Use concrete camera-visible beats instead of repetitive "epic" adjectives.
For unarmed combat, show weight transfer, feints, evasions, blocks, counters, body reactions and balance recovery consistent with the requested style. For firearms, describe cinematic movement, stable ownership and hand placement, consistent barrel direction, brief muzzle flash, recoil and causally linked visible impacts; keep this visual staging, not operational weapon instruction. For swords, other melee weapons and shields, show readable trajectories, interception, contact, separation and recovery, with stable weapon geometry and appropriate material effects. For requested magic, show visible preparation, effect origin, trajectory, response, impact and residue, with consistent color/behavior, interactive light and environmental sound; do not invent additional powers.
Retain motivated timed shots, readable spatial geography, screen direction, physical consequences and audio cues. Use a clear wider view for choreography and selective impact/reaction details; respect fixed-camera and single-shot requests. Do not add slow motion unless requested or selected. Increase useful action detail within the existing duration and sequence count, not uncontrolled simultaneous attacks. Preserve requested events, identities, weapons, powers and ending; do not introduce weapons or magic into an unarmed fight, new combatants, unrequested gore or disproportionate destruction. Keep this development in the base version as well as any selected compatible alternative.
Keep only literal dialogue and quoted on-screen text in their requested language. Preserve reference identities and roles: identity references are not automatically first/last frames.
MANDATORY H3 COMPOSITION RULES (override any conflicting earlier retention guidance):
Whenever multiple references are present OR strict continuity of characters, environments, objects or style is needed, use the complex format with exactly these six populated sections in this order, each heading on its own line followed by a colon:
${PLAGUEKIND_REFERENCE_SECTIONS.join("\n")}
${complexRequired ? "The current request REQUIRES this six-section format for every complete prompt. Do not use integrated_multimodal_description." : "Use the simplified format only if neither multiple references nor strict continuity requires the complex format."}
In subject_definitions, assign each speaking character a stable speaker ID (S1), (S2), (S3), linked to its subject identity. Keep that mapping across all shots and separate sequences. Do not assign an ID to a different character later.
Write every spoken line with the speaker ID and exact native syntax, for example: (S1) <d>[Italian] Testo esatto della battuta.</d>
Do not put spoken dialogue in quotation marks. Preserve the user's exact words, punctuation and language; never translate, paraphrase or improve dialogue unless explicitly requested. Do not add dialogue where none was requested.
In retention_analysis, scope each retention level to specific attributes, not the whole source frame:
- attribute_transfer: transfer precise visual identity cues, atmosphere, environment features, pose inspiration, lighting, design or cinematic language, while leaving composition and camera free. This does NOT require transferring properties to a different subject.
- weak_reference: a light, non-binding source of inspiration.
- fully_preserved: ONLY genuinely invariant elements, such as character identity, outfit, proportions, accessories or narratively persistent props; name exactly which elements remain unchanged. Preserve narrative changes across shots instead of resetting to the source image.
A single reference may use fully_preserved for identity and attribute_transfer or weak_reference for other attributes. Never infer that preserving identity also locks pose, framing, camera angle or composition.
References must support creative staging, multiple shots and changes of viewpoint when useful or requested. Do not force copying the reference framing or pose. Respect explicit fixed-camera, exact opening-frame or first/last-frame requirements when actually requested; do not change the selected generation mode.
Put chronological shots and camera changes inside detailed_description using [Shot 1], [Shot 2], etc. A new shot is not a new generation: reserve --- for separate requested sequences. Keep overall_soundscape and non_diegetic_music separate; use N/A when appropriate.
Use only explicitly configured LoRA activation words; never infer combat or weapon triggers from unrelated actions.
For multiple requested sequences, output one complete H3 prompt per sequence separated by a standalone --- line, with causal continuity. Cover the full requested duration of each sequence.`;
  return `Sei il consulente di sceneggiatura cinematografica per PlagueKind / MiniMax H3.
Applica queste linee guida editoriali alla richiesta e alle immagini disponibili:
${guidance}

CONTRATTO OPERATIVO PRIORITARIO (sostituisce qualsiasi ordine di output descritto sopra):
Rispetta tutti gli eventi, la durata, lo stile e il finale richiesti. Non applicare miglioramenti opzionali senza scelta.
SVILUPPO CREATIVO OBBLIGATORIO DELLA VERSIONE BASE: riempi la scena prima delle tre opzioni, con dettagli visivi e sonori pertinenti, passaggi fisici intermedi e normalmente 2–4 inquadrature motivate con intervalli temporali nella durata disponibile. Non limitarti a ripetere le azioni dell'utente. Rispetta camera fissa, piano sequenza o singolo shot espliciti; non cambiare eventi, ordine, finale o numero di sequenze e non aggiungere dialoghi. Le aggiunte di messa in scena coerenti sono già autorizzate nella base; le alternative narrative o stilistiche ulteriori restano opzionali. Questa regola prevale sui precedenti suggerimenti di riservare i cambi di inquadratura alle sole opzioni.
PRIORITÀ COMBATTIMENTO: per mani nude, pistole, altre armi, spade e magie richieste, applica lo sviluppo prioritario delle scene di combattimento già alla sceneggiatura base. Una richiesta generica di scontro autorizza scambi coreografici coerenti e più spettacolari; conserva invece la coreografia esplicita. Rendi visibili attacco, difesa/reazione e recupero, con ritmo, impatti, conseguenze ambientali, suoni e inquadrature raccordate entro la durata disponibile. Non riservare lo spettacolo alle tre opzioni, non inventare vincitori, nuove armi o nuovi poteri e non attivare LoRA automaticamente.
Non inventare dettagli di immagini, video o audio che non puoi osservare. Se la reference serve per identità/ambiente ma l'utente vuole un'apertura diversa, distingui reference e opening frame: non forzare la posa iniziale. Segnala se I2V/FL2VA vincola il primo frame e occorre prepararlo o usare Ref2VA.
I trigger LoRA non caricano modelli: non dichiarare di aver attivato LoRA e rispetta gli eventuali trigger già configurati.
FASE 1: non scrivere MAI il prompt finale, nemmeno nelle alternative.
Rispondi in italiano con SOLO JSON valido, senza markdown esterno, in questo schema:
{"evaluation":"valutazione rapida di 2–6 righe: cosa hai capito, fattibilità, shot, durata, dialoghi e limiti","screenplay":"sceneggiatura cinematografica arricchita con INT./EXT., inquadrature numerate e intervalli temporali, camera, dettagli visivi/sonori e passaggi intermedi; azioni al presente, solo visibile/udibile e nomi MAIUSCOLI sopra le sole battute richieste","options":["prima miglioria concreta facoltativa oltre alla base arricchita","seconda alternativa o nuova idea distinta","terza alternativa o nuova idea distinta"]}
Fornisci esattamente tre alternative, senza applicarle alla sceneggiatura di base arricchita. Fermati e attendi la scelta.`;
}

export function hasPlaguekindReviewContent(text) {
  return /\b(?:valutazione\s+(?:critica|rapida|iniziale)|sceneggiatura\s+(?:narrativa|cinematografica)|proposte\s+di\s+miglioramento|(?:quick|critical|initial)\s+(?:evaluation|assessment)|(?:narrative|cinematic)\s+screenplay|optional\s+(?:improvements|alternatives))\b/iu.test(text)
    || /(?:^|\n)\s*(?:#{1,6}\s*|\*{1,2})?(?:\d+[.)]\s*)?(?:opzione|option)\s*[123]\s*[:.)—-]/imu.test(text)
    || /"(?:evaluation|screenplay|options)"\s*:/u.test(text)
    || /```/u.test(text);
}

export function validatePlaguekindReview(value) {
  if (!value || typeof value.evaluation !== "string" || !value.evaluation.trim()
    || typeof value.screenplay !== "string" || !value.screenplay.trim()
    || !Array.isArray(value.options) || value.options.length !== 3
    || value.options.some((option) => typeof option !== "string" || !option.trim())) {
    throw new Error("LM Studio non ha restituito valutazione, sceneggiatura e tre alternative valide. Riprova: la richiesta originale è conservata.");
  }
  return { evaluation: value.evaluation, screenplay: value.screenplay, options: value.options };
}
