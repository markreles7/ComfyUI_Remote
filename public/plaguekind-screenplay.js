import { enhanceMainPrompt } from "./prompt-assistant.js?v=20260929-screenplay";

export async function reviewPlaguekindScene(args, { panel, signature, onFinal }) {
  const initialSignature = signature();
  panel.replaceChildren();
  panel.hidden = true;
  const result = await enhanceMainPrompt({ ...args, fields: { ...args.fields, plaguekindStage: "review" } });
  if (!result?.review) return;
  if (signature() !== initialSignature) {
    args.status.textContent = "La richiesta o le impostazioni sono cambiate: ripeti la valutazione.";
    return;
  }
  panel.hidden = false;
  if (result.sequencePlan?.count > 1) {
    const plan = document.createElement("p");
    plan.className = "hint";
    plan.textContent = `Piano: ${result.sequencePlan.count} sequenze da ${result.sequencePlan.duration} secondi · ${result.sequencePlan.totalDuration} secondi totali. Dopo la scelta riceverai i prompt completi separati da ---.`;
    panel.append(plan);
  }
  for (const [heading, content] of [
    ["1. Valutazione rapida", result.review.evaluation],
    ["2. Sceneggiatura cinematografica arricchita", result.review.screenplay],
    ["3. Tre possibili migliorie opzionali", "La versione base include già dettagli e inquadrature della sceneggiatura. Mantienila oppure scegli una delle tre idee aggiuntive per creare il prompt H3."],
  ]) {
    const title = document.createElement("h4");
    title.textContent = heading;
    const body = document.createElement("p");
    body.style.whiteSpace = "pre-wrap";
    body.textContent = content;
    panel.append(title, body);
  }
  const choices = document.createElement("div");
  choices.className = "prompt-assistant-tools plaguekind-screenplay-choices";
  for (const [index, option] of result.review.options.entries()) {
    const description = document.createElement("p");
    description.textContent = `Opzione ${index + 1}: ${option}`;
    panel.append(description);
  }
  for (const [choice, label] of [["original", "Genera dalla scena arricchita"], ["0", "Scegli opzione 1"], ["1", "Scegli opzione 2"], ["2", "Scegli opzione 3"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-assistant-button";
    button.textContent = label;
    button.addEventListener("click", async () => {
      if (signature() !== initialSignature) {
        args.status.textContent = "La richiesta o le impostazioni sono cambiate: ripeti la valutazione prima di scegliere.";
        return;
      }
      try {
        // A detached output prevents an in-flight result from overwriting edits.
        const output = document.createElement("textarea");
        const final = await enhanceMainPrompt({ ...args, input: output, button, buttonScope: document,
          fields: { ...args.fields, plaguekindStage: "final", plaguekindChoice: choice, plaguekindReview: JSON.stringify(result.review) } });
        if (!final) return;
        if (signature() !== initialSignature) {
          args.status.textContent = "La richiesta è cambiata durante la generazione: ripeti la valutazione. Il testo è stato conservato.";
          return;
        }
        args.input.value = final.prompt;
        args.input.dispatchEvent(new Event("input", { bubbles: true }));
        choices.replaceChildren();
        args.status.textContent = "Prompt finale pronto, applicato alla richiesta selezionata.";
        onFinal(final);
      } catch { /* enhanceMainPrompt displays the error and keeps choices for retry. */ }
    });
    choices.append(button);
  }
  panel.append(choices);
  args.status.textContent = "Valutazione pronta. Leggi la sceneggiatura e scegli come generare il prompt finale.";
}
