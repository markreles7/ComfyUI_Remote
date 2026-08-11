# LTX Remote Studio

Web app responsive per generare immagini e video da PC o telefono, attraverso Tailscale, usando ComfyUI sul PC di casa.

## Funzioni incluse

- selezione tra i workflow API disponibili;
- scelta iniziale tra generazione Immagine e Video;
- Text to Image con famiglie Flux.1, Flux.2, Qwen Image 2512 e Z-Image e scelta dinamica del modello installato;
- Image to Image e Reference Image in base alle capacità del modello;
- workflow standalone di upscaling con Lanczos, modelli AI locali, SeedVR2 e NVIDIA RTX VSR;
- editor multi-LoRA per ogni workflow immagine e video, con forza indipendente;
- upload PNG, JPG e WebP;
- upload video MP4, WebM, MOV, MKV e AVI per `LTX 2.3 V2V Edit Anything`;
- prompt positivo e negativo;
- preset 360p, 480p e 720p, orizzontali o verticali;
- durata da 1 a 30 secondi e 24 FPS fissi;
- seed casuale o manuale;
- modalità Text-to-Video e Image-to-Video per LTX 2.3 1Work e Dev FP8;
- scelta tra LTX 2.3 Distilled 1.1 FP8 e DaSiWa DragonLeap v4 nei workflow compatibili;
- profili Anteprima/Massima per Dev FP8 e Director;
- storyboard Director con fino a 8 scene, immagini opzionali, prompt e durate indipendenti;
- prompt globale Director per mantenere personaggi, stile e ambiente tra le scene;
- coda, progresso, interruzione e cronologia persistente;
- anteprima e download del video tramite ComfyUI;
- pagina Genera separata dall'archivio Generazioni;
- comandi per cache, modelli, VRAM e RAM;
- layout responsive per telefono e desktop.

## Installazione sul PC di casa

Requisiti:

- ComfyUI avviato su `http://127.0.0.1:8188`;
- Tailscale connesso e indirizzo `100.77.122.74`;
- Node.js 20 o successivo.

Apri PowerShell nella cartella del progetto ed esegui:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup-home.ps1
.\start-home.ps1
```

Da un dispositivo connesso alla stessa rete Tailscale apri:

```text
http://100.77.122.74:3000
```

La web app si collega a ComfyUI internamente tramite `127.0.0.1`; la porta 8188 non deve essere esposta.

## Se Windows Firewall blocca la porta 3000

Apri PowerShell come amministratore sul PC di casa ed esegui una volta:

```powershell
New-NetFirewallRule `
  -DisplayName "LTX Remote Studio - Tailscale" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3000 `
  -InterfaceAlias "Tailscale"
```

La regola è limitata all'interfaccia Tailscale.

## Configurazione

Il file `.env`, creato da `setup-home.ps1`, contiene:

```dotenv
HOST=100.77.122.74
PORT=3000
COMFY_URL=http://127.0.0.1:8188
COMFY_WS=ws://127.0.0.1:8188
OUTPUT_DIRECTORY=E:\ComfyUI\Data\Packages\ComfyUI LTX\output
MAX_UPLOAD_MB=30
MAX_VIDEO_UPLOAD_MB=512
AUTO_PURGE_IDLE=true
IDLE_PURGE_DELAY_SECONDS=15
```

Se cambia l'IP Tailscale, modifica `HOST`. Impostare `HOST=0.0.0.0` rende invece il servizio raggiungibile da tutte le interfacce di rete e non è l'impostazione consigliata.

## Preset effettivi

LTX richiede dimensioni divisibili per 32. Le etichette dell'interfaccia corrispondono a:

| Preset | Orizzontale | Verticale |
| --- | --- | --- |
| 360p | 640×352 | 352×640 |
| 480p | 832×480 | 480×832 |
| 720p | 1280×704 | 704×1280 |

## Storyboard Director

Selezionando `LTX 2.3 Director 2 UHD`, il normale campo immagine/prompt viene sostituito da uno storyboard.

Ogni scena contiene:

- una foto guida opzionale, inserita all'inizio dell'intervallo;
- un prompt locale;
- una durata da 1 a 30 secondi.

Le scene possono essere aggiunte, rimosse e riordinate. La web app calcola automaticamente gli intervalli a 24 FPS e compila `timeline_data`, `local_prompts`, `segment_lengths` e `guide_strength` nel formato previsto da LTX Director.

Il campo **Continuità globale** condiziona l'intero video ed è utile per mantenere identità, abbigliamento, stile, illuminazione e ambiente. Il limite dell'app è di 8 scene e 60 secondi totali, per evitare invii accidentali eccessivamente pesanti.

Per la risoluzione, l'adattatore Director sostituisce nella richiesta API il nodo locale `LHResolutionSetting` con due costanti intere indipendenti. Questo evita che l'uscita height del plugin collassi a zero nelle esecuzioni remote e garantisce che orientamento e dimensioni selezionati arrivino direttamente a `custom_width` e `custom_height`.

## V2V Edit Anything

Il workflow `LTX23_V2V_EDIT_ANYTHING_API.json` è disponibile come **LTX 2.3 V2V Edit Anything**. La schermata consente di:

- caricare il video sorgente;
- scrivere l'istruzione di modifica e il prompt negativo;
- scegliere durata massima, seed e lato lungo massimo;
- abilitare il prompt enhancer e il riuso dell'audio originale;
- regolare sampling steps, CFG, NAG e intensità della LoRA Edit Anything;
- abilitare opzionalmente la LoRA aggiuntiva inclusa nel workflow originale.

Il V2V mantiene il rapporto d'aspetto del video sorgente. La LoRA aggiuntiva specifica del template è disabilitata per impostazione predefinita, mentre la LoRA Edit Anything resta attiva a intensità `1`.
L'uscita finale usa i nodi core `CreateVideo` e `SaveVideo`: in questo modo ComfyUI considera sempre il salvataggio MP4 un output terminale e la webapp può mostrarlo e scaricarlo dalla cronologia.

## Generazione immagini

Selezionando **Immagine** nella home sono disponibili:

- **Text to Image** per tutti i modelli compatibili;
- **Image to Image** classico per le famiglie Flux.1 e Z-Image;
- **Image Edit / Reference** nativo per la famiglia Flux.2;
- **Image Edit** nativo con Qwen Image Edit 2511;
- **Reference Image** tramite Flux Redux per la famiglia Flux.1.

La scelta avviene su due livelli: prima la famiglia/workflow (**Flux.1**, **Flux.2**, **Qwen Text to Image**, **Qwen Image Edit 2511** o **Z-Image**), poi il modello installato. La lista è letta direttamente da ComfyUI e comprende automaticamente i file presenti rispettivamente sotto `FLUX1D\`, `FLUX2\`, `QWEN\` e `Z-IMG\`. I checkpoint Qwen possono anche essere collocati direttamente nella cartella diffusion models: vengono riconosciuti dal nome. I modelli aggiunti in futuro compaiono dopo il riavvio di ComfyUI e il ricaricamento della webapp, senza modificare il codice.

Qwen usa due workflow distinti perché i modelli hanno scopi diversi:

- **Qwen Text to Image** usa un checkpoint Qwen Image 2512 oppure, in compatibilità testo, BigLove Gwen 2;
- **Qwen Image Edit 2511** modifica una fotografia tramite istruzione, usa `TextEncodeQwenImageEditPlus`, `CFGNorm`, reference latent e denoise nativo `1`.

Per entrambi servono `qwen_2.5_vl_7b_fp8_scaled.safetensors` nei text encoder e `qwen_image_vae.safetensors` nei VAE. La webapp verifica separatamente checkpoint, text encoder e VAE e mostra il componente mancante senza tentare download automatici.

BigLove Gwen 2 viene rilevato come modello Edit 2511 dal marcatore interno `index_timestep_zero`. La variante **MXFP8** usa il loader nativo ed è il profilo predefinito; la variante **NF4** usa `RemoteUNETLoaderNF4`, incluso in `comfyui_nodes/ComfyUI_Remote_Model_Loaders`, e richiede `bitsandbytes >= 0.50.0`. Un vero checkpoint Qwen Image 2512, quando installato, resta selezionabile separatamente.

I formati disponibili vanno da 1024×1024 a 1344×768/768×1344, con batch da 1 a 4 immagini. Sono configurabili seed, step, guidance, denoise e intensità della reference.

### Miglioramento finale

Per tutte le varianti Flux.1, Flux.2, Qwen e Z-Image è disponibile una pipeline opzionale composta da:

- **Highres Fix** da 1,25× a 2×, con secondo passaggio diffusion, step e denoise configurabili;
- **RealESRGAN 2×**, rapido e processato un'immagine alla volta;
- **SeedVR2 3B FP8**, profilo bilanciato con VAE tiled, BlockSwap e offload CPU;
- **SeedVR2 Leggero 3B FP8** e **SeedVR2 Massimo 7B FP16**, gli unici due profili selezionabili;
- miglioramento volti, abilitato automaticamente nell'interfaccia quando ComfyUI espone un modello Face Enhance;
- salvataggio opzionale sia del risultato originale sia della versione migliorata.

Highres Fix e SeedVR2 richiedono batch `1` per limitare la memoria. Per l'editing fotografico è consigliato Highres Fix `1,5×`, denoise `0,20–0,30`, seguito da SeedVR2 a lato corto `2048`. Per immagini già corrette nella composizione può essere preferibile usare soltanto SeedVR2.

### Gestione automatica VRAM

Quando un workflow passa dal modello generativo a RealESRGAN o SeedVR2, il nodo `VRAM Debug` riceve l'immagine già decodificata, scarica Flux/Qwen/Z-Image e libera cache e garbage collection prima di caricare l'upscaler.

La webapp non esegue purge tra lavori ancora in coda: ComfyUI può quindi riutilizzare lo stesso modello per generazioni consecutive. Quando la coda ComfyUI risulta realmente vuota, la webapp attende 15 secondi e chiama `/free` con scaricamento modelli e memoria. Il comportamento può essere configurato con:

```dotenv
AUTO_PURGE_IDLE=true
IDLE_PURGE_DELAY_SECONDS=15
```

Il miglioramento volti risulta disabilitato se il package ComfyUI attivo non contiene un modello compatibile; gli altri miglioramenti restano disponibili.

## Workflow Upscaling

La modalità **Upscaling** è indipendente dalla generazione: carica una foto, seleziona il motore e scegli uno dei tre preset.

Motori disponibili:

- **Lanczos / Bicubic**, senza modelli AI;
- **AI Upscale Model**, che elenca dinamicamente tutti i modelli installati in ComfyUI, inclusi RealESRGAN, ClearReality, UltraSharp, Remacri, AnimeSharp e NMKD;
- **SeedVR2**, con profilo Leggero 3B FP8 o Massimo 7B FP16;
- **NVIDIA RTX VSR**, disponibile quando il nodo DaSiWa e una GPU GeForce RTX vengono rilevati.

I preset configurano automaticamente:

| Preset | Modelli locali | SeedVR2 | RTX |
| --- | --- | --- | --- |
| Velocità | FP16, tile grandi | 3B, lato corto 1536 | VSR Medium 2× |
| Qualità | FP16 bilanciato | 3B, lato corto 2048 | VSR High 2× con denoise |
| Qualità MAX | FP32, tile anti-OOM | 7B FP16, lato corto 2656 | High Bitrate Ultra 4×, denoise e deblur |

Prima dei motori AI viene eseguito opzionalmente un purge VRAM. SeedVR2 lavora con VAE tiled, offload CPU e BlockSwap; gli upscaler ESRGAN usano batch singolo e tiling. RTX limita automaticamente il fattore per non superare 8192 px sul lato lungo quando il browser riesce a rilevare le dimensioni sorgente.

I nodi cloud Magnific, Recraft e WaveSpeed non sono inclusi perché richiedono autenticazione e crediti esterni. Non vengono quindi avviate elaborazioni a pagamento accidentalmente.

La disponibilità dei modelli viene letta da ComfyUI. Un modello può essere selezionato soltanto nella famiglia della relativa cartella; anche il server verifica il file esatto prima di accodare la generazione. La webapp non scarica automaticamente modelli né accetta licenze al posto dell'utente.

## LoRA aggiuntive

Ogni workflow, sia immagine sia video, dispone di un editor **LoRA aggiuntive**. È possibile aggiungere un numero qualsiasi di righe, scegliere il file installato in ComfyUI e impostare una forza indipendente per ciascuna LoRA.

Le LoRA vengono applicate in sequenza al modello già preparato dal workflow, senza sostituire le LoRA native eventualmente presenti nel template. L'interfaccia filtra automaticamente i file compatibili con la famiglia selezionata:

- `LTX2.3\` per i workflow video;
- `FLUX\` per la famiglia Flux.1;
- `FLUX2\` per la famiglia Flux.2;
- `QWEN\` per Qwen Image 2512 e Qwen Image Edit 2511;
- `ZIMG\` per la famiglia Z-Image.

Il server verifica nuovamente nome e forza prima dell'invio a ComfyUI. Le LoRA applicate vengono inoltre salvate nella cronologia insieme alle altre impostazioni della generazione.

## Schermate

`/guided-create.html` ospita l'Assistente Creativo conversazionale. La home `/` contiene il form di generazione e i controlli di sistema. `/studio.html` ospita i progetti di editing guidato. L'archivio `/generations.html` è dedicato alla visualizzazione di tutte le generazioni eseguite, con filtri, stato, impostazioni, player e download. Le generazioni concluse possono essere archiviate singolarmente o tramite selezione multipla e successivamente ripristinate; questa operazione le nasconde dalla vista principale senza eliminare output o metadati.

### Crea guidata

La Crea guidata parte da obiettivi espressi con parole semplici e copre:

- foto da testo, reference singola e multi-reference;
- editing con aggiunta, sostituzione, rimozione, modifica, stile e luce;
- Image-to-Video, First/Last Frame e LTX Director;
- Text-to-Video, V2V, Actor Replacement con tracked inpaint/Union Control, Interactive Scene, Retake ed Extend;
- Storyboard, Character/Location Bible, upscale immagine, HDR e temporal upscale.

Il prompt può essere scritto in italiano e ottimizzato localmente per il modello scelto, inserito manualmente in inglese senza modifiche oppure composto rispondendo a domande semplici su azione, posizione, vincoli e look. Nel percorso Director, LM Studio restituisce separatamente continuità globale e da uno a tre prompt scena.

Immagini e video caricati vengono conservati temporaneamente nel browser e reinseriti nel form di destinazione tramite un handoff monouso. Il progetto finale viene soltanto preparato: la guida non avvia mai automaticamente una generazione.

## Image Studio

Image Studio comprende workflow di editing locale, inserimento soggetto, storyboard e finishing:

- Smartphone Photo Editor con maschera manuale o GroundingDINO + SAM;
- Smart Image Editor e Inpainting intelligente;
- Multi-Reference Composer con massimo quattro immagini complessive;
- Storyboard Director con 2–4 fotogrammi separati;
- LTX First / Last Frame, anche a partire da tutte le coppie adiacenti dello storyboard;
- Character & Location Bible;
- Camera, posa e composizione;
- Relighting e continuità cromatica;
- Editor Guidato con Subject Insertion per persone, animali e oggetti.

Le foto vengono elaborate a circa 1–2 megapixel mantenendo il rapporto d'aspetto. Nell'editing locale risultato e maschera vengono poi riportati alle dimensioni della fotografia caricata e ricomposti sull'originale, così l'esterno della maschera resta invariato.

Subject Insertion separa sorgente, identità/reference, posizione, maschera locale e preservazione. Qwen Image Edit 2511 e Flux.2 Klein mantengono i parametri nativi del workflow; depth, segmentazione e occlusioni vengono dichiarate soltanto quando i nodi locali sono realmente disponibili.

Le LoRA sono filtrate di nuovo per ogni stadio: Flux.2, Flux.1, Qwen, Z-Image e LTX ricevono soltanto file della propria famiglia. I workflow Qwen della schermata Genera non scaricano modelli automaticamente.

Per la maschera automatica questa installazione include `sam_vit_b`, GroundingDINO SwinT, `bert-base-uncased` e Florence 2 Base nelle rispettive cartelle sotto `ComfyUI\models`.

## Video Studio · sostituzione attore

Actor Replacement propone tre motori:

- **Actor Replacement · viso**: usa LTX 2.3 tracked inpaint con maschera propagata, reference identitaria e conservazione della performance del video sorgente;
- **Actor Replacement · corpo completo**: usa la LoRA `LTX23_ICLORA_UNION_CONTROL` per seguire posa, edge/motion e struttura del video guida mentre rigenera il personaggio dalla reference;
- **Edit Anything + Identity LoRA** resta fallback generativo globale quando Union Control o tracked inpaint non sono disponibili.

Il vecchio Face Swap diretto, KeyFrame e Control Studio non sono più esposti come strumenti separati. Il video maschera bianco/nero resta disponibile soltanto come opzione manuale avanzata per i workflow che lo supportano.

## Character Library / Virtual Actor

`/characters.html` sostituisce la vecchia sezione dedicata ai profili creator con una libreria locale di personaggi persistenti. Ogni Virtual Actor viene salvato in `.data/characters/<id>/` con `meta.json`, hero image, character sheet, reference viso, reference corpo, reference generiche e derivative workflow.

Funzioni principali:

- CRUD personaggi con descrizione persistente, wardrobe, identity hints e lock Face/Hair/Body/Outfit;
- upload multiplo di reference `hero`, `face`, `bust`, `full_body`, `profile`, `sheet` e `generic`;
- Character Pack con stati `Ready`, `Incomplete` e `Needs references`;
- selector `Personaggio` in Genera, Image Studio e Video Studio;
- adapter backend per applicare il Character Pack ai workflow che supportano reference e prompt fallback dichiarato per quelli non ancora compatibili;
- endpoint manuale `/api/characters/import-legacy` preparato per migrazioni copy-only dai vecchi dati locali, senza esecuzione automatica.

Limiti espliciti:

- face detection, segmentation, ArcFace/InsightFace, Qwen-VL e generazione automatica del character sheet sono marcati `not configured` finche' non vengono collegati nodi o modelli dedicati;
- nei workflow video il sistema prepara l'architettura per anchor frame, ma non automatizza ancora la generazione del keyframe identitario;
- i dati legacy `.data/virtual-influencers.json` e `.data/virtual-influencer-assets/` non vengono cancellati dalla webapp.

## Dati locali

La cronologia viene salvata in `.data/history.json`. I video restano nella cartella output di ComfyUI e vengono letti direttamente dal disco, con supporto allo streaming e al download. Se la cartella non è accessibile, la web app usa automaticamente l'API di ComfyUI come fallback. La web app non duplica i file.

I comandi di pulizia usano l'endpoint ufficiale di ComfyUI `/free`. Non cancellano workflow, input o video generati.

### Prompt Assistant locale con LM Studio

Accanto al prompt principale delle schermate **Genera**, **Image Studio** e **Video Studio** è disponibile **IA + Genera**. Il server:

1. libera i modelli ComfyUI soltanto se la coda è vuota;
2. avvia automaticamente il server locale LM Studio sulla porta 1234;
3. carica il modello vision configurato in `LM_STUDIO_MODEL`, oppure `LM_STUDIO_SULPHUR_MODEL` quando il workflow video usa Sulphur 2 Base;
4. trasforma la frase in un prompt specifico per Flux, Qwen, Z-Image, LTX 2.3 o Sulphur 2;
5. nei workflow basati su una sorgente invia anche l'immagine al modello vision;
6. scarica sempre l'istanza LM Studio e richiede nuovamente la pulizia VRAM;
7. inserisce il prompt nella casella e, con `LM_STUDIO_AUTO_GENERATE=true`, avvia la generazione soltanto dopo la pulizia.

Impostando `LM_STUDIO_AUTO_GENERATE=false`, il prompt generato resta nella casella per la revisione manuale e la generazione parte dal normale pulsante principale. Il server LM Studio resta vincolato a `127.0.0.1`: telefono e browser remoto comunicano soltanto con ComfyUI Remote.

In modalità immagine è disponibile anche **Reverse Prompt**: si carica una foto e si sceglie **Qwen** oppure **Klein**. LM Studio analizza la foto, inserisce nella casella principale una descrizione ottimizzata per il modello scelto, scarica il modello vision e libera la VRAM. Questa funzione non avvia mai automaticamente la generazione.

Le istruzioni personalizzate si trovano in `config/prompt-assistant-instructions.md`. Modello, endpoint, timeout, contesto e lunghezza massima sono configurabili tramite le variabili `LM_STUDIO_*` presenti in `.env.example`. `LM_STUDIO_SULPHUR_MODEL` è facoltativo: se valorizzato, viene usato solo quando selezioni Sulphur 2 Base; se resta vuoto, il Prompt Assistant usa `LM_STUDIO_MODEL` con istruzioni Sulphur dedicate. Per Qwen3.5 il reasoning viene forzato su `off`, evitando che il modello consumi tempo e token in analisi nascosta.

## Test

```powershell
npm test
npm run validate:studio
npm run validate:video-studio
npm run validate:all
npm run audit:media
npm run smoke:comfy
```

`validate:all` costruisce tutte le combinazioni abilitate (modelli, modalità, Studio, Video Studio, upscale e detailer) e controlla classi, input obbligatori, opzioni installate, collegamenti, tipi, cicli e pipeline SeedVR2 contro gli schemi dell'istanza ComfyUI attiva. Il report completo viene scritto in `.data/workflow-audit.json`.

`audit:media` legge gli header delle immagini già presenti in output e segnala dimensioni corrotte, inclusi i vecchi file larghi 3 px, in `.data/media-audit.json`. La webapp esegue lo stesso controllo alla conclusione di ogni generazione: conserva separatamente dimensione richiesta e reale e non marca come riuscito un file con lati inferiori a 8 px.

`smoke:comfy` esegue un workflow diagnostico locale 64×64 attraverso `RemoteImageTensorNormalize`, verifica il PNG risultante e rimuove subito il solo file temporaneo creato dal test.

Prima di ogni accodamento la webapp esegue inoltre un preflight con cache breve sulle definizioni `/object_info`: un nodo assente, un output inesistente, un modello non presente nelle opzioni o il vecchio `Restore Face (mtb)` incompatibile vengono bloccati prima che ComfyUI inizi il lavoro.
