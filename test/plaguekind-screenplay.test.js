import test from "node:test";
import assert from "node:assert/strict";
import { LmStudioClient } from "../src/lm-studio-client.js";
import { H3_FINAL_REFINEMENT_RULES, PRESETS } from "../src/generation-system-prompts.js";
import { hasIncompletePlaguekindSections, plaguekindSystemPrompt } from "../src/plaguekind-screenplay.js";
import { promptWithH3IntegratedTriggers } from "../public/lora-triggers.js";
import { inferPlaguekindSequences } from "../src/plaguekind-sequences.js";

const review = {
  evaluation: "La scena funziona in un solo shot. La strada inizia vuota, poi entra la stessa auto della foto.",
  screenplay: "EXT. STRADA – GIORNO\nLa strada è vuota. L'auto entra, accelera e scompare. Rimangono due scie di fuoco.",
  options: ["Effetto più spettacolare", "CCTV più realistico", "Versione compatta"],
};

function fixture(content, check = () => {}) {
  const calls = [];
  let chatIndex = 0;
  const client = new LmStudioClient({ model: "vision", fetchImpl: async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push(path);
    let payload;
    if (path.endsWith("/models")) payload = { models: [{ key: "vision", capabilities: { vision: true }, loaded_instances: [] }] };
    else if (path.endsWith("/load")) payload = { model_instance_id: "test" };
    else if (path.endsWith("/chat")) {
      check(JSON.parse(options.body), chatIndex);
      payload = { output: [{ type: "message", content: Array.isArray(content) ? content[Math.min(chatIndex, content.length - 1)] : content }] };
      chatIndex += 1;
    } else if (path.endsWith("/unload")) payload = {};
    else throw new Error(path);
    return { ok: true, json: async () => payload };
  } });
  return { client, calls };
}

test("PlagueKind review preserves Italian and vision, returns three options and no final prompt", async () => {
  const { client, calls } = fixture(JSON.stringify({ ...review, prompt: "Must not leak" }), (body) => {
    assert.match(body.system_prompt, /FASE 1/);
    assert.doesNotMatch(body.system_prompt, /MANDATORY OUTPUT LANGUAGE/);
    assert.match(body.system_prompt, /reference e opening frame/);
    assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
  });
  const result = await client.enhance({ text: "L'auto scompare dopo 8 secondi", target: "minimax_h3", promptPreset: "h3_general", duration: 8,
    plaguekindStage: "review", image: { mimetype: "image/png", buffer: Buffer.from("image") } });
  assert.deepEqual(result.review, review);
  assert.equal(result.prompt, undefined);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 1);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
});

test("invalid alternatives fail without a final prompt and unload the model", async () => {
  const { client, calls } = fixture(JSON.stringify({ ...review, options: ["Only one"] }));
  await assert.rejects(client.enhance({ text: "Scena", target: "minimax_h3", plaguekindStage: "review" }), /correzione automatica/);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
  assert.equal(client.active, null);
});

test("PlagueKind develops the base action into timed shots before offering optional ideas", async () => {
  const enrichedReview = {
    evaluation: "Quattro azioni in 8 secondi: servono raccordi rapidi senza cambiare il finale.",
    screenplay: "INT. STANZA – GIORNO\nINQUADRATURA 1 (0–2 s), campo medio: la ragazza porta il peso sui piedi, si alza e la sedia arretra.\nINQUADRATURA 2 (2–4 s), tracking laterale: accelera verso la finestra, passi ravvicinati.\nINQUADRATURA 3 (4–6 s), tre quarti: salta attraverso il vetro, che si frantuma nella direzione del movimento.\nEXT. FINESTRA – GIORNO\nINQUADRATURA 4 (6–8 s): la stessa ragazza cade oltre la finestra ora rotta; le schegge proseguono accanto a lei.",
    options: ["Allungare la durata per leggere meglio il salto", "Usare un punto di vista interno più ravvicinato", "Accentuare il contrasto sonoro prima della frantumazione"],
  };
  const { client } = fixture(JSON.stringify(enrichedReview), (body) => {
    assert.match(body.system_prompt, /SVILUPPO CREATIVO OBBLIGATORIO DELLA VERSIONE BASE/u);
    assert.match(body.system_prompt, /2–4 inquadrature motivate con intervalli temporali/u);
    assert.match(body.system_prompt, /Rispetta camera fissa, piano sequenza o singolo shot/u);
    assert.match(body.system_prompt, /Non inventare personaggi, dialoghi, motivazioni/u);
    assert.match(body.system_prompt, /non aggiungere ferite, gore o un impatto finale/iu);
    assert.match(body.system_prompt, /esattamente tre alternative/u);
  });
  const result = await client.enhance({ text: "La ragazza si alza dalla sedia, corre verso la finestra, salta attraverso di essa frantumandola e cade.", target: "minimax_h3", plaguekindStage: "review", duration: 8 });
  assert.deepEqual(result.review, enrichedReview);
  assert.equal(result.prompt, undefined);
});

test("original choice retains enriched staging and optional choice preserves compatible base details", () => {
  const instructions = plaguekindSystemPrompt("final");
  assert.match(instructions, /base version is the enriched reviewed screenplay/u);
  assert.match(instructions, /preserve its compatible visual details, intermediate physical actions, sound cues/u);
  assert.match(instructions, /even when the choice is original/u);
  assert.match(instructions, /selected alternative, retain the base staging wherever compatible/u);
  assert.match(instructions, /respect explicit fixed-camera or single-shot constraints/u);
});

const finalPrompt = 'integrated_multimodal_description: [Shot 1] At 00:00.000 the CCTV camera shows an empty road. At 00:04.000 the reference car enters and vanishes in a flash. At 00:08.000 two burning tire tracks remain. A voice says <d>[Italian] Dove è andata?</d>\noverall_soundscape: Engine, crackling flames.\nnon_diegetic_music: N/A';

for (const [kind, request, requiredDetail] of [
  ['mani nude', 'Due avversari combattono a mani nude.', /trasferimento del peso/u],
  ['pistole', 'Due avversari si affrontano con pistole.', /rinculo e reazioni o impatti/u],
  ['spade', 'Due avversari duellano con spade e scudi.', /contatti tra armi, separazione e recupero/u],
  ['magie', 'Due avversari combattono usando le magie del fuoco richieste.', /origine, forma, traiettoria, risposta avversaria, impatto e residuo/u],
]) {
  test(`PlagueKind enriches ${kind} in the base review and carries choreography into H3`, async () => {
    const combatReview = { ...review, screenplay: `INT. ARENA – GIORNO\nINQUADRATURA 1 (0–4 s): ${request}\nINQUADRATURA 2 (4–8 s): l'avversario reagisce e recupera l'equilibrio.` };
    const prompt = 'integrated_multimodal_description: [Shot 1] At 00:00.000 the opponents begin the requested exchange. [Shot 2] At 00:04.000 the opponent reacts and regains balance. At 00:08.000 they hold their established positions.\noverall_soundscape: Footsteps and the sounds of the requested exchange.\nnon_diegetic_music: N/A';
    const { client, calls } = fixture([JSON.stringify(combatReview), prompt], (body, index) => {
      if (index === 0) {
        assert.match(body.system_prompt, /PRIORITÀ COMBATTIMENTO/u);
        assert.match(body.system_prompt, requiredDetail);
        assert.match(body.system_prompt, /Non riservare lo spettacolo alle tre opzioni/u);
      } else {
        assert.match(body.system_prompt, /ACTION SCENE DEVELOPMENT/u);
        assert.match(body.system_prompt, /contact or miss, visible reaction and recovery/u);
        assert.match(body.system_prompt, /do not introduce weapons or magic into an unarmed fight/u);
        assert.match(body.system_prompt, /Use only explicitly configured LoRA activation words/u);
        assert.ok(body.input.includes(combatReview.screenplay));
      }
    });
    const reviewed = await client.enhance({ text: request, target: 'minimax_h3', plaguekindStage: 'review', duration: 8 });
    assert.deepEqual(reviewed.review, combatReview);
    const final = await client.enhance({ text: `${request}\nSCENEGGIATURA ESAMINATA:\n${reviewed.review.screenplay}\nSCELTA ESPLICITA: Versione base arricchita; non applicare alternative.`, target: 'minimax_h3', plaguekindStage: 'final', duration: 8 });
    assert.equal(final.prompt, prompt);
    assert.equal(final.review, undefined);
    assert.equal(calls.filter((path) => path.endsWith('/chat')).length, 2);
  });
}

test("chosen PlagueKind final restores native H3 instructions and preserves requested Italian dialogue", async () => {
  const prompt = finalPrompt;
  const { client, calls } = fixture(prompt, (body) => {
    assert.ok(body.system_prompt.startsWith(PRESETS.h3_general.systemPrompt.replace(H3_FINAL_REFINEMENT_RULES, "").trim()));
    assert.ok(body.system_prompt.endsWith(H3_FINAL_REFINEMENT_RULES));
    assert.equal(body.system_prompt.split(H3_FINAL_REFINEMENT_RULES).length, 2);
    assert.match(body.system_prompt, /FINAL PROMPT ONLY/);
    assert.match(body.system_prompt, /apply none of the optional alternatives/);
    assert.doesNotMatch(body.system_prompt, /FASE 1|## Regola generale|### 1\) Valutazione/);
    assert.match(body.input, /SCELTA ESPLICITA/);
  });
  const result = await client.enhance({ text: "Auto scompare. SCELTA ESPLICITA: originale", target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, prompt);
  assert.equal(result.review, undefined);
  assert.equal(result.stage, "final");
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 1);
});

test("wrapped review is regenerated from the selected request and references, not copied into H3", async () => {
  const contaminated = 'integrated_multimodal_description: [Shot 1] ### 1) Valutazione critica iniziale\nLa scena funziona.\n### 2) Sceneggiatura narrativa\nEXT. STRADA\n### 3) Prompt finale\n```text\nA car vanishes.\n```\n### 4) Proposte di miglioramento\nOpzione 1: luce più forte.\noverall_soundscape: N/A';
  const { client, calls } = fixture([contaminated, finalPrompt], (body, index) => {
    assert.match(body.input[0].content, /SCELTA ESPLICITA: CCTV realistico/);
    assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
    if (index === 1) {
      assert.match(body.input[0].content, /FINAL OUTPUT REPAIR/);
      assert.doesNotMatch(body.input[0].content, /luce più forte/);
    }
  });
  const result = await client.enhance({ text: "Auto scompare. SCELTA ESPLICITA: CCTV realistico", target: "minimax_h3", plaguekindStage: "final", duration: 8,
    mode: "references", image: { mimetype: "image/png", buffer: Buffer.from("image") } });
  assert.equal(result.prompt, finalPrompt);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
});

test("repeated review is rejected and the model unloaded", async () => {
  const { client, calls } = fixture('integrated_multimodal_description: [Shot 1] Quick evaluation: good scene.\nOption 1: stronger light.');
  await assert.rejects(client.enhance({ text: "Auto scompare", target: "minimax_h3", plaguekindStage: "final", duration: 8 }), /solo prompt finale/);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
  assert.equal(client.active, null);
});

test("PlagueKind final again repairs Italian production prose", async () => {
  const { client } = fixture(['Una donna cammina mentre la fotocamera segue la ragazza.', finalPrompt], (body, index) => {
    if (index === 1) assert.match(body.system_prompt, /LANGUAGE REPAIR TASK/);
  });
  const result = await client.enhance({ text: "Scena richiesta", target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, finalPrompt);
});

test("PlagueKind final again repairs incomplete H3 timing", async () => {
  const { client } = fixture(['integrated_multimodal_description: [Shot 1] At 00:02.000 the car vanishes.', finalPrompt], (body, index) => {
    if (index === 1) assert.match(body.system_prompt, /TIMELINE COMPLETION REPAIR/);
  });
  const result = await client.enhance({ text: "Auto scompare in 8 secondi", target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, finalPrompt);
  assert.equal(result.timelineRepairApplied, true);
});

const complexPrompt = `subject_definitions: <Subject 1>, the driver from <Picture 1>, speaks as (S1). <Picture 2> provides road lighting and atmosphere.
summary: [reference generation] The driver watches a car vanish from the road.
retention_analysis: <Picture 1>: fully_preserved identity and outfit only; framing and pose remain free. <Picture 2>: attribute_transfer of lighting; weak_reference for atmosphere. Camera angles may change.
detailed_description: [Shot 1] At 00:00.000 the driver watches the road. [Shot 2] At 00:04.000 the car vanishes; (S1) <d>[Italian] Dove è andata?</d> At 00:08.000 the driver looks at the burning tire tracks.
overall_soundscape: Engine, crackling flames and the exact spoken line.
non_diegetic_music: N/A`;

test("multiple images force six sections, repair simplified output and preserve references", async () => {
  const { client, calls } = fixture([finalPrompt, complexPrompt], (body, index) => {
    assert.match(body.system_prompt, /current request REQUIRES this six-section format/);
    assert.equal(body.input.length, 3);
    if (index === 1) assert.match(body.input[0].content, /FINAL OUTPUT REPAIR/);
  });
  const result = await client.enhance({ text: "Due reference per la scena", target: "minimax_h3", plaguekindStage: "final", duration: 8,
    mode: "references", images: [1, 2].map(() => ({ mimetype: "image/png", buffer: Buffer.from("image") })) });
  assert.equal(result.prompt, complexPrompt);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
  const applied = promptWithH3IntegratedTriggers(result.prompt, []);
  assert.equal(hasIncompletePlaguekindSections(applied, true), false);
  assert.match(applied, /\(S1\) <d>\[Italian\] Dove è andata\?<\/d>/u);
  assert.match(applied, /attribute_transfer/);
  assert.match(applied, /weak_reference/);
});

test("strict continuity requires six sections even without uploaded images", async () => {
  const { client } = fixture(complexPrompt, (body) => {
    assert.match(body.system_prompt, /current request REQUIRES this six-section format/);
  });
  const result = await client.enhance({ text: "Mantieni continuità rigorosa di personaggio e ambiente", target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, complexPrompt);
});

test("an incomplete complex format is rejected after correction and unloads LM Studio", async () => {
  const { client, calls } = fixture(complexPrompt.replace(/^retention_analysis:.*\n/mu, ""));
  await assert.rejects(client.enhance({ text: "Strict continuity", target: "minimax_h3", plaguekindStage: "final", duration: 8 }), /sei sezioni H3/);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
});

test("every sequence must have six ordered non-empty sections when required", () => {
  assert.equal(hasIncompletePlaguekindSections(`${complexPrompt}\n---\n${complexPrompt}`, true), false);
  assert.equal(hasIncompletePlaguekindSections(`${complexPrompt}\n---\n${finalPrompt}`, true), true);
  assert.equal(hasIncompletePlaguekindSections(complexPrompt.replace(/summary:.*\n/u, "summary:\n"), true), true);
  assert.equal(hasIncompletePlaguekindSections(finalPrompt), false);
});

test("PlagueKind composition rules define precise dialogue and attribute-level retention without changing review", () => {
  const rules = plaguekindSystemPrompt("final");
  assert.match(rules, /\(S1\) <d>\[Italian\] Testo esatto della battuta\.<\/d>/u);
  assert.match(rules, /never translate, paraphrase or improve dialogue unless explicitly requested/);
  assert.match(rules, /Do not put spoken dialogue in quotation marks/);
  assert.match(rules, /does NOT require transferring properties to a different subject/);
  assert.match(rules, /Never infer that preserving identity also locks pose, framing, camera angle or composition/);
  assert.doesNotMatch(plaguekindSystemPrompt("review"), /MANDATORY H3 COMPOSITION RULES/);
});

test("malformed review JSON is regenerated once with the original request and image", async () => {
  const broken = '{"evaluation":"Scena chiara","screenplay":"EXT. STRADA","options":["Una luce" "Una camera","Una durata"]}';
  const { client, calls } = fixture([broken, JSON.stringify(review)], (body, index) => {
    assert.ok(body.max_output_tokens >= 4096);
    if (index === 1) {
      assert.match(body.input[0].content, /JSON REPAIR/);
      assert.match(body.input[0].content, /Auto in strada/);
      assert.match(body.input[1].data_url, /^data:image\/png;base64,/);
    }
  });
  const result = await client.enhance({ text: "Auto in strada", target: "minimax_h3", plaguekindStage: "review",
    image: { mimetype: "image/png", buffer: Buffer.from("reference") } });
  assert.deepEqual(result.review, review);
  assert.equal(result.prompt, undefined);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
});

test("truncated JSON fails gracefully after one retry and clears the model lock", async () => {
  const { client, calls } = fixture('{"evaluation":"Scena","screenplay":"EXT. STRADA","options":["Prima');
  await assert.rejects(client.enhance({ text: "Auto in strada", target: "minimax_h3", plaguekindStage: "review" }), (error) => {
    assert.match(error.message, /richiesta originale è conservata/);
    assert.doesNotMatch(error.message, /JSON at position|Expected/);
    return true;
  });
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
  assert.equal(client.active, null);
});

test("natural sequence requests override the UI duration without reading wrapper or unselected options", () => {
  for (const text of ["Scena di 24 secondi divisa in 2 sequenza da 12 secondi. La scena inizia...", "Video di 24 secondi diviso in due sequenze", "Due sequenze da 12 secondi ciascuna"]) {
    assert.deepEqual(inferPlaguekindSequences(text, 8), { count: 2, duration: 12, totalDuration: 24 });
  }
  assert.equal(inferPlaguekindSequences("Create 2-8 sequences. User request: Una strada.\nAspect ratio: 16:9\nSCENEGGIATURA ESAMINATA: 3 sequenze", 8).count, 1);
  assert.equal(inferPlaguekindSequences("Due shot in una clip", 8).count, 1);
  assert.equal(inferPlaguekindSequences("Prima scena\n---\nSeconda scena", 8).count, 2);
  assert.throws(() => inferPlaguekindSequences("9 sequenze da 12 secondi"), /1 a 8/);
  assert.throws(() => inferPlaguekindSequences("Scena di 24 secondi in 2 sequenze da 10 secondi"), /non corrisponde/);
});

const sequenceRequest = "Scena di 24 secondi divisa in 2 sequenza da 12 secondi. L'auto scompare; poi il conducente guarda le scie.";
const clip12 = complexPrompt.replaceAll("00:08.000", "00:12.000");
const twoClips = `${clip12}\n\n---\n\n${clip12.replace("At 00:00.000 the driver watches the road.", "At 00:00.000 the same driver continues watching the burning tire tracks left by the vanished car; identity, outfit and position are unchanged.")}`;

test("multi-sequence review stays one review, carries the plan and never outputs final prompts", async () => {
  const { client } = fixture(JSON.stringify(review), (body) => {
    assert.match(body.system_prompt, /2 separate generations, 12 seconds EACH, 24 seconds total/);
    assert.match(body.system_prompt, /Do not write final prompts yet/);
  });
  const result = await client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "review", duration: 8 });
  assert.deepEqual(result.sequencePlan, { count: 2, duration: 12, totalDuration: 24 });
  assert.equal(result.prompt, undefined);
});

test("final multi-sequence output generates and validates clips sequentially", async () => {
  const [first, second] = twoClips.split(/\n\n---\n\n/u);
  const { client, calls } = fixture([first, second], (body, index) => {
    assert.ok(body.system_prompt.endsWith(H3_FINAL_REFINEMENT_RULES));
    assert.equal(body.system_prompt.split(H3_FINAL_REFINEMENT_RULES).length, 2);
    assert.match(body.system_prompt, /SEQUENTIAL CLIP MODE/);
    assert.match(body.system_prompt, /exactly ONE complete six-section English H3 prompt/);
    assert.match(body.input, /Target duration: 12 seconds/);
    if (index) assert.match(body.input, /PREVIOUS ACCEPTED CLIP/);
  });
  const result = await client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, twoClips);
  assert.equal(result.sequencePlan.duration, 12);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
});

test("every clip must cover its own duration, including clips before the last one", async () => {
  const [first, second] = twoClips.split(/\n\n---\n\n/u);
  const incompleteFirst = first.replaceAll("00:12.000", "00:05.000");
  const { client } = fixture([incompleteFirst, first, second], (body, index) => {
    if (index === 1) assert.match(body.system_prompt, /TIMELINE COMPLETION REPAIR/);
  });
  const result = await client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, twoClips);
  assert.equal(result.timelineRepairApplied, true);
});

test("a 30-second clip is repaired locally and the second clip starts only after acceptance", async () => {
  const [first, second] = twoClips.split(/\n\n---\n\n/u);
  const wrong = first.replaceAll("00:12.000", "00:30.000");
  const { client, calls } = fixture([wrong, first, second], (body, index) => {
    if (index === 1) assert.match(body.input, /Previous invalid draft/);
    if (index === 2) assert.match(body.input, /PREVIOUS ACCEPTED CLIP/);
  });
  const result = await client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, twoClips);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 3);
});

test("missing zero markers are inserted without regenerating otherwise valid clips", async () => {
  const [first, second] = twoClips.split(/\n\n---\n\n/u);
  const missingFirstZero = first.replace("At 00:00.000", "At 00:02.500");
  const missingSecondZero = second.replace("At 00:00.000", "At 00:03.000");
  const { client, calls } = fixture([missingFirstZero, missingSecondZero]);
  const result = await client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  const clips = result.prompt.split(/\n\n---\n\n/u);
  assert.equal(clips.length, 2);
  assert.match(clips[0], /detailed_description: \[Shot 1\] At 00:00\.000, begin in the established opening state; At 00:02\.500/u);
  assert.match(clips[1], /detailed_description: \[Shot 1\] At 00:00\.000, begin in the established opening state; At 00:03\.000/u);
  assert.equal(result.timelineRepairApplied, true);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
});

test("total-scene durations outside detailed_description do not become clip timestamps", async () => {
  const [first, second] = twoClips.split(/\n\n---\n\n/u);
  const withTotal = first.replace("summary: [reference generation]", "summary: Across the complete 24-second film, [reference generation]");
  const { client, calls } = fixture([withTotal, second]);
  const result = await client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "final", duration: 8 });
  assert.equal(result.prompt, `${withTotal}\n\n---\n\n${second}`);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 2);
});

test("no partial multi-sequence prompt is returned when the second clip fails", async () => {
  const [first] = twoClips.split(/\n\n---\n\n/u);
  const { client, calls } = fixture([first, "A broken second clip"]);
  await assert.rejects(client.enhance({ text: sequenceRequest, target: "minimax_h3", plaguekindStage: "final", duration: 8 }), /sequenza 2\/2/u);
  assert.equal(calls.filter((path) => path.endsWith("/chat")).length, 4);
  assert.equal(calls.at(-1), "/api/v1/models/unload");
});
