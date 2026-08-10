# Interactive Cast

Interactive Cast e' una modalita' di Video Studio pensata per modificare un video esistente preservando il piu' possibile il materiale originale. Non e' un workflow ComfyUI unico: il backend Node orchestra analisi, pianificazione, segmentazione temporale, task AI per i soli intervalli necessari e ricomposizione finale.

## Architettura

Il flusso attuale e':

1. Upload video sorgente.
2. Analisi FFprobe: durata, fps, risoluzione, codec e stream audio.
3. Estrazione asset FFmpeg: frame iniziale, centrale, finale e traccia audio WAV temporanea.
4. Source separation fallback FFmpeg: stem `dialogueCandidate`, `ambienceCandidate`, `musicBedCandidate`.
5. Scene cut fallback via FFmpeg scene detection.
6. Actor tracking locale: OpenCV HOG multi-soggetto con associazione temporale, bounding box e reference crop volto/corpo; fallback manuale se il detector non trova soggetti. Non esegue riconoscimento dell'identita' reale.
7. Assegnazione manuale attori originali: l'utente puo' rinominare `original-1`, `original-2`, ecc. senza riconoscimento identita' reale.
8. Reference pack: selezione dei crop tracciati piu' nitidi per ogni attore, con fallback ai frame globali estratti.
9. Nuovo attore da Character Pack oppure reference temporanea immagine salvata solo nel progetto.
10. Pianificazione timeline da eventi utente o JSON LM Studio.
11. Creazione edit windows con priorita' conservativa: `original`, `audioOnly`, `lipSyncOnly`, `composite`, `generative`. Gli eventi sovrapposti vengono fusi e prevale la modalita' minima piu' forte necessaria a coprire tutte le modifiche.
12. Preparazione segmenti:
   - i segmenti `original` vengono tagliati dal video sorgente;
   - i segmenti `audioOnly` vengono tagliati dal video sorgente e non richiedono replacement video;
   - i segmenti `lipSyncOnly` mantengono una source clip originale gia' tagliata e generano un task lip-sync dedicato;
   - i segmenti `generative` generano task package con anchor frame, prompt, negative prompt, requisito di output e `actorReferences`;
   - se e' selezionato un Character Pack, il task include descrizione persistente, identity hints, wardrobe, lock e stato reference; se e' caricata una reference temporanea, include il path progetto dell'immagine.
   - il task dichiara quale workflow usare per lo still anchor: `Qwen Image Edit`, `Qwen/Krea/Klein` oppure `Krea Triple`;
   - il pulsante di generazione accoda automaticamente anchor Qwen, rifinitura opzionale selezionata e segmento LTX 2.3 Dev FP8 I2V. Qualita' e risoluzione restano selezionabili; l'upload manuale rimane come fallback.
13. Diarization fallback: crea speaker windows correggibili manualmente e assegnabili agli attori originali.
14. Preparazione audio dialogue tasks:
   - per ogni battuta viene creato uno slot audio;
   - per gli attori originali viene estratta una reference WAV dalla finestra speaker assegnata piu' lunga, con fallback all'intervallo evento;
   - la battuta sintetizzata o registrata puo' essere caricata nello slot evento;
   - il pulsante "Sintetizza voce" usa Chatterbox Multilingual V3 nell'ambiente Python isolato e registra `notConfigured` se il runtime non e' disponibile.
15. Remix audio fallback: l'audio originale resta come base e le battute caricate vengono sovrapposte al timestamp evento con FFmpeg.
16. Lip-sync locale: il pulsante "Applica lip-sync" usa MuseTalk 1.5 con maschera jaw regionale; se il runtime non e' disponibile registra `notConfigured` e lascia upload manuale.
17. Upload manuale del segmento AI/lip-sync finito nello slot corretto.
18. Identity check fallback sui segmenti replacement: confronta reference/source clip con campioni del video generato e segnala possibile drift.
19. Ricomposizione MP4 finale via FFmpeg concat e, se disponibile, mux della traccia `dialogueRemix`.

Ogni fase principale salva uno stato nel progetto (`analysis`, `tracking`, `audioExtraction`, `planning`, `segmentPreparation`, `audioRemix`, `finalEncode`) con valori come `completed`, `fallback`, `running`, `cached` o `failed`.

## Moduli principali

- `src/interactive-cast/index.js`: export del sottosistema.
- `src/interactive-cast/orchestrator.js`: coordinamento progetto, analisi, planning, segmenti, replacement, audio remix e final encode.
- `src/interactive-cast/project-store.js`: persistenza progetti e asset sotto `.data/interactive-cast-assets`.
- `src/interactive-cast/video-analysis.js`: probe video, frame/audio extraction, scene detection.
- `src/interactive-cast/actor-tracking.js`: tracking OpenCV opzionale e fallback manuale.
- `src/interactive-cast/python-tools.js`: esecuzione sicura dei CLI Python isolati.
- `src/interactive-cast/audio-analysis.js`: fallback audio metadata.
- `src/interactive-cast/audio-remix.js`: task battute, reference audio, readiness e remix WAV fallback.
- `src/interactive-cast/pipeline-state.js`: stage status e cache key deterministiche.
- `src/interactive-cast/planner.js`: dialogue events ed edit windows.
- `src/interactive-cast/compositor.js`: segment manifest, task package, readiness e concat.
- `src/interactive-cast/ffmpeg.js`: helper sicuri per probe, tagli, remix WAV, concat e mux audio/video finale.
- `src/interactive-cast/voice-engine.js`: astrazione voice engine, contratto CLI `synthesize.py`, retry/failure esplicito e capability fallback.
- `src/interactive-cast/lipsync-engine.js`: astrazione lip-sync, contratto CLI `lipsync.py`, task source-clip + audio guida, readiness e capability fallback.
- `src/interactive-cast/identity-check.js`: verifica percettiva FFmpeg/PGM per segmenti replacement, fallback leggero senza face embedding.
- `src/interactive-cast/capabilities.js`: audit runtime/hardware e capability matrix.
- `src/gpu-resource-manager.js`: lock cooperativo per evitare uso simultaneo di stack GPU pesanti.

## Endpoint

- `GET /api/interactive-cast/capabilities`
- `GET /api/interactive-cast/projects`
- `GET /api/interactive-cast/projects/:id`
- `DELETE /api/interactive-cast/projects/:id`
- `GET /api/interactive-cast/projects/:id/assets/*path`
- `POST /api/interactive-cast/projects`
- `POST /api/interactive-cast/projects/:id/plan`
- `POST /api/interactive-cast/projects/:id/actors`
- `POST /api/interactive-cast/projects/:id/speakers`
- `POST /api/interactive-cast/projects/:id/assistant-plan`
- `POST /api/interactive-cast/projects/:id/prepare-segments`
- `POST /api/interactive-cast/projects/:id/segments/:segmentId/generate`
- `POST /api/interactive-cast/projects/:id/segments/:segmentId/replacement`
- `POST /api/interactive-cast/projects/:id/dialogue/:eventId/audio`
- `POST /api/interactive-cast/projects/:id/dialogue/:eventId/synthesize`
- `POST /api/interactive-cast/projects/:id/segments/:segmentId/lipsync`
- `POST /api/interactive-cast/projects/:id/segments/:segmentId/composite`
- `POST /api/interactive-cast/projects/:id/segments/:segmentId/identity-check`
- `POST /api/interactive-cast/projects/:id/audio-remix`
- `POST /api/interactive-cast/projects/:id/concat`

## Setup isolato

Lo script idempotente e':

```powershell
scripts\setup-interactive-cast.ps1
```

Prepara:

- `.tools/interactive-cast/.venv`
- `.tools/interactive-cast/requirements.txt`
- `.tools/interactive-cast/models-manifest.json`
- `.tools/interactive-cast/interactive-cast-capabilities.json`

Il capability report include GPU/VRAM, spazio disco della cartella `.tools`, runtime Node/npm/Python, FFmpeg/FFprobe, Python ComfyUI se rilevato e stato Torch/CUDA del runtime ComfyUI. Il probe non installa pacchetti e non modifica l'ambiente Python di ComfyUI.

I modelli e gli output temporanei non vanno committati.

## Capability Matrix Attuale

| Capability | Stato | Note |
| --- | --- | --- |
| Video analysis | WORKING se FFprobe e' disponibile | Probe metadata e scene detection fallback. |
| Scene segmentation | FALLBACK | FFmpeg scene score, non segmentazione semantica AI. |
| Actor tracking | READY/FALLBACK | OpenCV HOG multi-track con crop reference per attore; assegnazione manuale se il detector non trova soggetti. |
| Audio extraction | WORKING se FFmpeg e' disponibile | Estrae WAV temporaneo dal video sorgente. |
| Source separation | FALLBACK se FFmpeg e' disponibile | Stem filtrati FFmpeg: dialogue candidate, ambience candidate, music/effects bed candidate. Non e' separazione neurale. |
| Voice reference extraction | WORKING/FALLBACK | Usa la finestra speaker assegnata piu' lunga; in assenza di mappatura usa l'intervallo evento. |
| Audio remix | FALLBACK | Sovrappone battute caricate all'audio sorgente con FFmpeg `amix`, ducking temporale del bed originale, micro fade e limiter/dynaudnorm anti-clipping. |
| Neural source separation | NOT CONFIGURED | Demucs o equivalente non ancora collegato. |
| Speaker diarization | FALLBACK | Segmento speaker manuale correggibile e assegnabile agli attori. Diarization neurale non configurata. |
| Voice cloning | READY | Chatterbox Multilingual V3 locale, reference-conditioned e multilingua; upload manuale resta fallback. |
| Lip-sync | READY | MuseTalk 1.5 locale con processing della regione jaw; upload manuale resta fallback. |
| Character insertion | READY VIA AUTOMATIC COMFYUI CHAIN | Character Pack/reference temporanea alimentano anchor Qwen e segmento LTX solo nella finestra generativa. |
| Anchor frame | READY | Qwen Image Edit base con rifinitura opzionale Qwen/Krea/Klein o Krea Triple. |
| Identity check | FALLBACK | Confronto percettivo FFmpeg/PGM tra source/anchor e replacement. Non e' face embedding avanzato. |
| Masked compositing | FALLBACK | Per segmenti `composite`, overlay MP4 + maschera immagine vengono fusi sulla source clip con FFmpeg, maschera grayscale e feather blur. |
| Temporal splice | WORKING se FFmpeg e' disponibile | Segment cut e concat finale. |
| Final encode | WORKING se FFmpeg e' disponibile | Output MP4 finale da segmenti pronti; se esiste `dialogueRemix`, viene muxato come traccia audio del file finale. |
| ComfyUI Python/Torch CUDA | READY/FALLBACK/NOT CONFIGURED | Rilevato nel report per diagnosi, senza installare o aggiornare pacchetti ComfyUI. |

## Generazione Automatica Segmenti

Interactive Cast accoda automaticamente i segmenti generativi dentro ComfyUI attraverso una catena controllata:

- anchor frame;
- prompt ottimizzato in inglese;
- negative prompt conservativo;
- durata richiesta;
- Qwen Image Edit per l'anchor base;
- rifinitura opzionale Qwen/Krea/Klein o Krea Triple;
- LTX 2.3 Dev FP8 I2V per la sola edit window;
- taglio FFmpeg esatto alla durata richiesta e inserimento automatico nello slot segmento.

Il seed, il profilo `Anteprima`/`Massima` e la risoluzione `Auto`/360p/480p/720p vengono salvati nel task. Gli upload manuali restano disponibili per sostituire un risultato o lavorare senza ComfyUI.

Per l'audio prepara task battuta con reference voce e usa Chatterbox Multilingual V3 quando disponibile. Se l'engine isolato non supera il probe runtime, non usa una voce generica: registra `voiceSynthesis: notConfigured` e mantiene l'upload manuale.

Il contratto locale per la sintesi e':

```text
python .tools/interactive-cast/scripts/synthesize.py --text "..." --language en --speaker "Original Actor 1" --reference reference.wav --output output.wav
```

Lo script deve stampare JSON su stdout, per esempio:

```json
{"path":"C:/.../output.wav","mimeType":"audio/wav","engine":"my-local-voice-engine"}
```

Se lo script manca, Interactive Cast non usa una voce generica: registra lo stage `voiceSynthesis: notConfigured` e la UI continua a mostrare upload manuale o retry.

Per i segmenti `lipSyncOnly`, il sistema crea una source clip preservata dal video originale e applica MuseTalk 1.5 alla regione jaw usando la battuta audio. Questo evita di rigenerare corpo, vestiti, sfondo e camera quando serve solo muovere la bocca.

La timeline permette di forzare il mode evento su `audioOnly`, `lipSyncOnly`, `composite` o `generative`; lasciando `Auto`, il planner sceglie la strada meno distruttiva. Usa `composite` per reazioni/regional edit con maschera e `generative` solo per inserire un nuovo attore o cambiare davvero corpo/scena.

Per i segmenti `composite`, la UI permette due strade:

- caricare direttamente il segmento MP4 finale come replacement;
- caricare un overlay MP4 e una maschera B/N. Il backend usa FFmpeg per scalare overlay/maschera alla source clip, applica blur alla maschera come feather e salva un replacement MP4 compositato. Questo preserva la clip originale nelle aree nere della maschera e usa l'overlay solo nelle aree bianche/morbide.

Il contratto locale per il lip-sync e':

```text
python .tools/interactive-cast/scripts/lipsync.py --video source.mp4 --audio line.wav --output output.mp4 --start 0 --end 2.4
```

Lo script deve stampare JSON su stdout, per esempio:

```json
{"path":"C:/.../output.mp4","mimeType":"video/mp4","engine":"my-local-lipsync-engine"}
```

Se lo script manca, Interactive Cast registra `lipSync: notConfigured`; il task resta nella UI con source clip, audio guida e upload manuale.

L'identity check fallback usa FFmpeg per ridurre reference e frame campione a PGM grayscale 96x96, poi calcola similarita' coseno. Serve come guardrail locale contro drift grossolani in volto/capelli/outfit/camera; non sostituisce un engine face embedding come InsightFace, che resta un possibile step futuro nell'ambiente isolato.

L'audio remix conserva il bed sorgente come base, abbassa temporaneamente il volume originale negli intervalli dove entrano le battute caricate/sintetizzate, applica micro fade alle nuove linee e usa limiter + normalizzazione dinamica leggera per ridurre clipping e salti di volume. Non cancella ambience/musica/room tone: li usa come strato principale.

Il final encode concatena i segmenti pronti e, quando `audio-remix` e' stato completato, crea l'MP4 finale con il video concatenato e la traccia `dialogue-remix.wav` convertita in AAC. Se il remix non esiste, mantiene il comportamento precedente e usa l'audio presente nei segmenti.

Questo preserva il video originale e mantiene trasparente la distinzione tra voice cloning/lip-sync realmente disponibili e diarizzazione, separazione neurale e identity embedding avanzato ancora in fallback.

## Cache e Retry

`prepare-segments` calcola una cache key da:

- hash SHA-256 del video sorgente;
- edit windows;
- dialogue events;
- attori aggiunti;
- workflow anchor;
- sommario Character Pack/reference.

Se la cache key coincide e i file dei segmenti/anchor esistono ancora, la fase viene marcata `cached` e non ritaglia di nuovo il video. La cache include video sorgente, edit windows, dialoghi, attori aggiunti, workflow anchor e sommario Character Pack/reference, cosi' un cambio identita' o anchor workflow rigenera i task. Le fasi `audioRemix` e `finalEncode` salvano `failed` con messaggio errore se qualcosa va storto, cosi' l'utente puo' correggere il file mancante e riprovare senza rifare analisi e planning.

## Tracking Attori

Il tracker locale leggero vive in:

```text
.tools/interactive-cast/scripts/track.py
```

Usa OpenCV HOG people detector quando `opencv-python-headless` e' presente nella venv `.tools/interactive-cast/.venv`. Non riconosce identita' reali: produce solo track interne (`original-1`, bounding box, timestamp, confidenza). Se OpenCV o lo script non sono disponibili, Interactive Cast resta utilizzabile con fallback manuale e la UI chiede di assegnare nomi agli attori.

## Limiti e possibili estensioni

1. La source separation neurale non e' installata: gli stem sono fallback FFmpeg conservativi.
2. La diarizzazione neurale non e' configurata: le finestre speaker sono manuali e correggibili.
3. L'identity check e' un confronto percettivo locale, non un face embedding avanzato.
4. Il tracker HOG e' adatto a clip leggibili; occlusioni pesanti e inquadrature strette possono richiedere correzione manuale.

## Troubleshooting

- Se la capability video analysis e' `NOT CONFIGURED`, verificare `ffprobe`.
- Se la ricomposizione finale fallisce, controllare che ogni segmento AI richiesto abbia un replacement MP4 caricato.
- Se il video finale non contiene le battute modificate, creare prima `audio-remix`: `finalEncode` incorpora `dialogueRemix` solo quando quell'output esiste.
- Se il segmento AI non combacia con il sorgente, rigenerarlo con stesso fps, stessa risoluzione e durata indicata dal task.
- Se la UI non mostra asset progetto, controllare che il file esista sotto `.data/interactive-cast-assets/<projectId>`.
