// Browser-managed speech recognition: no audio is stored by this application.
export function setupPromptDictation({ input, button, status, preview, root = document, host = window }) {
  const Recognition = host.SpeechRecognition || host.webkitSpeechRecognition;
  let session = null;
  let stopTimer = null;
  let restoreButtons = [];
  const hint = "Detta in italiano, poi controlla il testo e premi H3 Prompt.";
  const show = (message) => { status.textContent = message; };
  const clearPreview = () => { preview.textContent = ""; preview.hidden = true; };
  const reset = () => {
    clearTimeout(stopTimer);
    stopTimer = null;
    session = null;
    button.textContent = "🎙 Detta la richiesta";
    button.setAttribute("aria-pressed", "false");
    button.disabled = false;
    for (const [control, disabled] of restoreButtons) control.disabled = disabled;
    restoreButtons = [];
    clearPreview();
  };
  const finish = (message) => {
    const current = session;
    reset();
    if (current) {
      try { current.recognition.abort(); } catch { /* Already ended. */ }
    }
    show(message);
  };
  const stop = () => {
    if (!session || session.stopping) return;
    session.stopping = true;
    button.textContent = "Trascrizione…";
    button.disabled = true;
    show("Concludo la dettatura…");
    stopTimer = setTimeout(() => {
      if (session) finish("Dettatura terminata. Controlla il testo già trascritto prima di continuare.");
    }, 8000);
    try { session.recognition.stop(); }
    catch { finish("Dettatura terminata. Il testo già trascritto è conservato."); }
  };

  if (!Recognition || host.isSecureContext === false) {
    button.disabled = true;
    show(host.isSecureContext === false
      ? "Per il microfono nell’app apri Video Studio tramite HTTPS (oppure localhost sul PC). Puoi già dettare con il microfono della tastiera del telefono."
      : "Questo browser non offre la dettatura nell’app. Usa il microfono della tastiera del telefono per scrivere la richiesta.");
    return { get active() { return false; }, stop() {} };
  }
  show(hint);
  button.addEventListener("click", () => {
    if (session) return stop();
    if (host.__promptAssistantBusy) {
      show("Attendi che H3 Prompt finisca prima di iniziare la dettatura.");
      return;
    }
    let recognition;
    try { recognition = new Recognition(); }
    catch { show("Riconoscimento vocale non disponibile. Usa il microfono della tastiera."); return; }
    const current = { recognition, committed: new Set(), words: 0, stopping: false };
    session = current;
    recognition.lang = "it-IT";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    restoreButtons = [...root.querySelectorAll(".prompt-assistant-button")].map((control) => [control, control.disabled]);
    for (const [control] of restoreButtons) control.disabled = true;
    button.textContent = "■ Ferma dettatura";
    button.setAttribute("aria-pressed", "true");
    show("Attendo il microfono: autorizza l’accesso se richiesto dal browser.");
    recognition.onstart = () => {
      if (session === current && !current.stopping) show("In ascolto… Parla in italiano. Il testo viene aggiunto alla richiesta.");
    };
    recognition.onresult = (event) => {
      if (session !== current) return;
      const pending = [];
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = String(result[0]?.transcript || "").trim();
        if (!text) continue;
        if (result.isFinal) {
          if (current.committed.has(index)) continue;
          current.committed.add(index);
          // Append to the current value, preserving concurrent manual edits.
          input.value += `${input.value && !/\s$/u.test(input.value) ? " " : ""}${text}`;
          current.words += 1;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else pending.push(text);
      }
      preview.textContent = pending.join(" ");
      preview.hidden = !preview.textContent;
    };
    recognition.onerror = (event) => {
      if (session !== current) return;
      const messages = {
        "not-allowed": "Microfono non autorizzato. Consenti l’accesso nelle impostazioni del browser e riprova.",
        "service-not-allowed": "Il servizio vocale è bloccato dal browser. Usa il microfono della tastiera.",
        "audio-capture": "Microfono non disponibile: controlla che sia collegato e libero.",
        "no-speech": "Non ho rilevato parole. Premi il microfono per riprovare.",
        network: "Servizio vocale non raggiungibile. Controlla la connessione e riprova.",
        "language-not-supported": "Il browser non supporta la dettatura in italiano. Usa il microfono della tastiera.",
        aborted: "Dettatura interrotta.",
      };
      finish(`${messages[event.error] || "Dettatura non riuscita. Riprova o usa il microfono della tastiera."} Il testo già scritto è conservato.`);
    };
    recognition.onend = () => {
      if (session !== current) return;
      reset();
      show(current.words ? "Dettatura completata. Controlla il testo, poi premi H3 Prompt." : "Nessun testo trascritto. Premi il microfono per riprovare.");
    };
    try { recognition.start(); }
    catch { finish("Impossibile avviare il microfono. Controlla i permessi e riprova."); }
  });
  root.addEventListener("visibilitychange", () => {
    if (root.hidden && session) finish("Dettatura interrotta lasciando la pagina. Il testo già scritto è conservato.");
  });
  host.addEventListener("pagehide", () => {
    if (session) finish("Dettatura terminata.");
  });
  return { get active() { return Boolean(session); }, stop };
}
