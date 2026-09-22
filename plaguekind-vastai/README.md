# PlagueKind H3 V9 Reference Generation su Vast.ai

Questo pacchetto prepara un **template ComfyUI standard** per PlagueKind H3 Sparse V9 in modalità **Reference to Video (R2V)**. Scarica il checkpoint hybrid personalizzato b30-49, Qwen3-VL 32B, VAE video e audio, le LoRA PlagueKind, i pesi di anteprima/finitura e i custom node richiesti. Include un workflow per una singola clip e un workflow Director per **2-8 sequenze continuative**. Entrambi lavorano localmente e non richiedono la webapp.

## 1. Creare l'istanza Vast.ai, campo per campo

Questa procedura installa **soltanto ComfyUI + PlagueKind H3 V9**. Non clona e non avvia LTX Remote Studio, Node.js o la webapp.

### Prima di cercare la GPU

1. Crea un account Vast.ai, aggiungi credito e, in **Account → SSH Keys**, registra la tua chiave pubblica se vuoi usare SSH.
2. Crea un API token personale nelle impostazioni di Civitai: serve per scaricare `STY_Combat.safetensors` e `MOT_Weapon_Combat_H3_trigger-BUNNY.safetensors`.
3. In Vast.ai aggiungi il segreto `CIVITAI_API_TOKEN` nelle variabili d'ambiente dell'account/template. Non incollare il token dentro uno script pubblico o nel repository.

### Filtri consigliati in Search / Create

Apri **Search → GPU Instances** e imposta:

| Campo | Valore consigliato | Motivo |
| --- | --- | --- |
| GPU | RTX 4090/5090 per iniziare; 48 GB per il workflow UHD | 24 GB è la base pratica per Low VRAM; 48 GB dà più margine a refine e UHD |
| Num GPUs | `1` | Il workflow è configurato per una GPU |
| GPU RAM | almeno `24 GB` | Sotto questa soglia durata e risoluzione vanno ridotte molto |
| Disk | `200 GB` minimo, `250 GB` consigliato | Modelli, cache e output video occupano oltre il solo pacchetto |
| System RAM | almeno `64 GB`, meglio `96–128 GB` | Qwen e lo scaricamento CPU dei segmenti usano molta RAM |
| Reliability | `>= 0.95` | Riduce il rischio di interruzioni durante download e render lunghi |
| Internet download | `>= 500 Mbps` se disponibile | I modelli superano molte decine di GB |
| Rent type | **On-demand** per la prima installazione | Evita che un'istanza interruptible venga fermata durante il setup |

Ordina per prezzo dopo aver applicato i filtri. Controlla sempre costo GPU, costo disco e banda. Il runtime NVIDIA RTX VSR dipende anche da GPU e driver: se non è supportato, la generazione H3 e gli altri finish restano utilizzabili.

### Template da scegliere o creare

Nella pagina dell'offerta premi **Change Template** e cerca il template ufficiale **ComfyUI** di Vast.ai. Se devi compilarlo manualmente, usa questi valori:

| Campo Vast.ai | Cosa inserire |
| --- | --- |
| Template Name | `PlagueKind H3 V9 - ComfyUI only` |
| Docker Image | `vastai/comfy:@vastai-automatic-tag` |
| Version tag | lascia il tag automatico/consigliato dal template |
| Launch Mode | **Jupyter** (più semplice) e SSH abilitato |
| Disk Space | `200` GB minimo; `250` GB consigliato |
| Ports / Docker options | conserva le impostazioni del template ufficiale; non esporre manualmente ComfyUI senza autenticazione |
| Environment variable | `CIVITAI_API_TOKEN=IL_TUO_TOKEN` come segreto |
| Label | `plaguekind-h3-v9` (facoltativo) |

L'immagine ufficiale usa `/workspace` come volume persistente, installa ComfyUI in `/workspace/ComfyUI`, gestisce ComfyUI tramite Supervisor e pubblica l'app attraverso l'Instance Portal. Non sostituire il comando di avvio del template.

### Ultima sezione: download ZIP, estrazione e installazione

Nel campo **On-start Script / Provisioning Script** incolla esattamente:

```bash
bash -lc 'curl -fsSL https://raw.githubusercontent.com/markreles7/ComfyUI_Remote/main/plaguekind-vastai/bootstrap-vastai.sh | bash'
```

Se il template mostra invece una sezione **Environment Variables**, puoi usare il meccanismo nativo di provisioning inserendo:

```text
PROVISIONING_SCRIPT=https://raw.githubusercontent.com/markreles7/ComfyUI_Remote/main/plaguekind-vastai/bootstrap-vastai.sh
```

Usa **una sola** delle due modalità, non entrambe. Il bootstrap esegue in ordine: download di `plaguekind-vastai.zip`, estrazione in `/workspace`, installazione dei custom node, download e verifica di modelli/LoRA, copia dei tre workflow e controllo finale. Il log completo resta in `/workspace/plaguekind-vastai-install.log`. È rieseguibile: modelli già presenti e validi vengono saltati.

Premi **Create/Rent**, attendi che lo stato diventi **Running**, poi apri **Jupyter → Terminal** e controlla:

```bash
tail -f /workspace/plaguekind-vastai-install.log
```

Il primo avvio può essere lungo perché scarica molti GB. Quando compare `Installazione PlagueKind completata`, interrompi `tail` con `Ctrl+C` e riavvia ComfyUI:

```bash
supervisorctl restart comfyui
supervisorctl status comfyui
```

Premi quindi **Open** sull'istanza e apri ComfyUI dall'Instance Portal. Se il pulsante non compare ancora, attendi il riavvio del servizio e aggiorna la pagina.

> **Persistenza e costi:** fermare l'istanza interrompe il costo GPU, ma il disco può continuare a essere fatturato. Distruggere l'istanza elimina il volume e quindi modelli e output. Scarica i risultati importanti prima di distruggerla.

### Installazione manuale alternativa

Se non vuoi usare lo script On-start, apri Jupyter Terminal e incolla:

```bash
cd /workspace
curl -fL --retry 5 -o plaguekind-vastai.zip \
  https://raw.githubusercontent.com/markreles7/ComfyUI_Remote/main/plaguekind-vastai.zip
python3 -m zipfile -e plaguekind-vastai.zip /workspace
export CIVITAI_API_TOKEN='INCOLLA_QUI_IL_TOKEN_CIVITAI'
chmod +x /workspace/plaguekind-vastai/install.sh
COMFYUI_ROOT=/workspace/ComfyUI /workspace/plaguekind-vastai/install.sh
COMFYUI_ROOT=/workspace/ComfyUI /workspace/plaguekind-vastai/install.sh --check
supervisorctl restart comfyui
```

In questo caso il token rimane nella cronologia della shell: per un uso normale è preferibile salvarlo come segreto nelle variabili d'ambiente Vast.ai.

### Se il template usa un percorso diverso

La procedura supporta anche un template esistente, purché ComfyUI sia già installato. Imposta `COMFYUI_ROOT` nelle variabili d'ambiente, per esempio `/opt/ComfyUI`. Se il suo Python è separato, imposta anche `COMFYUI_PYTHON=/percorso/venv/bin/python`.

La cartella estratta è autonoma e contiene anche il nodo locale `RemoteUnloadCLIP`. Per rilanciare manualmente l'installer:

```bash
cd /workspace/plaguekind-vastai
chmod +x install.sh
./install.sh
```

Le LoRA **Combat V2 BASE** e **Weapon Combat v1.0** provengono da Civitai. Prima di avviare l'installer puoi impostare il tuo token personale:

```bash
export CIVITAI_API_TOKEN='INCOLLA_QUI_IL_TOKEN_CIVITAI'
./install.sh
```

Se lanci `install.sh` da un terminale interattivo senza variabile, lo script chiede il token senza mostrarlo sullo schermo. Il token viene usato soltanto nell'header di download e non viene scritto nel pacchetto. Puoi generarlo nelle impostazioni del tuo account Civitai. I download vengono verificati con lo SHA-256 dei file locali originali; una versione differente o una pagina di login non viene accettata come peso valido.

Se il template usa un'altra posizione o un Python dedicato:

```bash
COMFYUI_ROOT=/percorso/ComfyUI COMFYUI_PYTHON=/percorso/venv/bin/python ./install.sh
```

L'installer usa l'ambiente Python del template, aggiunge i nodi in `custom_nodes`, scarica i file in `models` e copia il workflow in `user/default/workflows`. Per **NVIDIA RTX Video Super Resolution** clona `Nvidia_RTX_Nodes_ComfyUI`, installa esplicitamente `nvidia-vfx` dall'indice NVIDIA e verifica che il modulo `nvvfx` sia realmente importabile: la sola presenza della cartella custom node non viene più considerata sufficiente. Se un download si interrompe, riesegui `./install.sh`: i file già presenti vengono saltati. Alcuni repository Hugging Face possono richiedere accesso o accettazione della licenza; in quel caso esegui `hf auth login` nel terminale e ripeti. Lo script mostra l'errore esatto del file che non è stato scaricato.

### LoRA Combat e Weapon

Tutti e tre i workflow contengono già le due nuove voci nello **LoRA Loader Stack**, inizialmente disattivate:

- `H3/STY_Combat.safetensors`, forza iniziale `0,80`: attivala per combattimento corpo a corpo. Usa `prfight2` nel prompt; aggiungi `prfin1` per un finisher.
- `H3/MOT_Weapon_Combat_H3_trigger-BUNNY.safetensors`, forza iniziale `0,80`: attivala per spade o armi da fuoco e usa `BUNNY` nel prompt.

Per il primo test attivane una sola. Se vuoi combinare coreografia fisica e armi, prova entrambe a `0,60–0,75` e controlla mani, geometria delle armi e continuità. La LoRA Parasyte Turbo rimane attiva come nel workflow originale.

Il scheduler corretto è `beta57`, fornito da RES4LYF e installato automaticamente dal pacchetto. Il vecchio valore `beta_57` con underscore non è valido. Dopo l'installazione riavvia completamente ComfyUI affinché il scheduler compaia nel menu. Come ripiego temporaneo puoi scegliere `beta`, con una curva leggermente diversa.

Se `beta57` non compare in un'istanza già preparata, installa manualmente RES4LYF con la procedura verificata:

```bash
cd /workspace/ComfyUI/custom_nodes
git clone https://github.com/ClownsharkBatwing/RES4LYF.git
cd RES4LYF
python -m pip install -r requirements.txt
```

Se il template usa un ambiente virtuale e il comando `python` punta a un interprete diverso da quello di ComfyUI, sostituiscilo con il percorso mostrato all'inizio di `install.sh`, per esempio `/workspace/ComfyUI/venv/bin/python`. Riavvia completamente ComfyUI dopo l'installazione, riapri il workflow e verifica che il menu Scheduler mostri `beta57`.

Verifica i pesi:

```bash
./install.sh --check
```

Poi **avvia o riavvia ComfyUI** dal template Vast.ai. Controlla il log di avvio se un custom node non viene caricato. Non usare contemporaneamente un altro installatore che cambi l'ambiente Python.

## 2. Aprire il workflow

Nell'interfaccia ComfyUI apri `PlagueKind_H3_V9_Reference_ComfyUI.json` con **Workflow → Open** oppure trascina il JSON nell'area di lavoro. Il file si trova anche in `/workspace/ComfyUI/user/default/workflows/` se hai usato il percorso predefinito.

I due nodi `LoadImage` principali mostrano `reference_1.png` e `reference_2.png` come segnaposto. Carica le tue immagini con il pulsante del nodo: ComfyUI le copierà nella propria cartella `input`. Sono **reference di soggetto/ambiente**, non primi frame obbligati del video.

Per usare le altre reference, apri **Extra References Set Inside →**. Troverai i nodi per `Picture 3`–`Picture 9`, `Video 1`–`Video 3` e `Audio 1`–`Audio 3`, già collegati. Carica il file nel nodo corrispondente e imposta `enabled = true` sul nodo `Optional Reference` con lo stesso nome, nello stesso gruppo. Anche `Picture 1` e `Picture 2` hanno un interruttore, inizialmente su `true`: puoi disattivarle quando non servono. Lascia `false` per tutti gli altri media non usati: il nodo carica soltanto i rami abilitati. Ogni video ha anche un interruttore `Video N audio`, da attivare solo se vuoi usare la sua traccia audio. Non usare il bypass generico di ComfyUI sui nodi `LoadImage`/`LoadVideo`/`LoadAudio`: usa questi interruttori.

Nel gruppo **Conditioning - Sampler** controlla che il Boolean del ramo Reference sia `true`; i due switch CONDITIONING e LATENT devono selezionare `on_true`. Il prompt precompilato è un esempio generico: sostituiscilo con la tua scena. Usa `<Picture 1>`–`<Picture 9>`, `<Video 1>`–`<Video 3>` e `<Audio 1>`–`<Audio 3>` per indicare i media abilitati. Abilita gli slot in ordine, senza lasciare buchi, perché il nodo R2V numera i riferimenti effettivamente presenti. Secondo la [documentazione del nodo MiniMax H3 R2V](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/MiniMaxH3ReferenceToVideo/en.md), le etichette delle reference sono numerate a partire da 1 per tipo.

### Workflow per più sequenze continuative

Apri `PlagueKind_H3_V9_Continuous_R2V_ComfyUI.json`. Il nodo grande **PlagueKind H3 V9 · Director R2V continuativo** integra timeline, reference condivise, generazione e rapporto di continuità.

1. Apri **Shared params** nel Director e carica fino a `Picture 1-9`, `Video 1-3` e `Audio 1-3`. Queste reference vengono condivise fra tutte le sequenze.
2. Ogni **Asset group** è una sequenza. Imposta la durata digitando un numero nel campo **Seconds** dell'Asset; il bordo verde della timeline seleziona il gruppo ma non è il controllo affidabile della durata. Usa `8`, `10` o `12` (oppure il punto, ad esempio `11.5`), non la virgola decimale.
3. Il testo comune precedente ai separatori `---` della webapp va in **Shared params → Prompt**. Metti il primo blocco temporale nel prompt di Asset group 1, il secondo in Asset group 2 e così via. Non copiare `---`: il Director concatena automaticamente il prompt Shared con quello del singolo gruppo.
4. Aggiungi una sequenza con **Add asset group**. Le immagini Shared compaiono come `read-only` in tutti gli Asset e non vanno ricaricate; usa gli slot di gruppo da Picture 5 soltanto per reference aggiuntive specifiche di quella sequenza.
5. Aggiungi o duplica segmenti fino a un massimo pratico consigliato di otto.
6. Mantieni **Continuity** attivo con overlap `22` frame.
7. Dal secondo segmento in poi mantieni attivo **From prev**. Il Director usa la coda del segmento precedente per raccordare movimento, posizione, ambiente e audio.
8. Mantieni `Reference to Video`, `8` step, sampler `er_sde`, scheduler `beta57`, video shift `12`, audio shift `3` e `Clear VRAM between segments = true`. Il workflow imposta inoltre `keepModelWarmBetweenSegments = false`: dopo ogni sequenza, qualunque sia la durata (per esempio 8, 10 o 12 secondi), il Director conserva su CPU soltanto l'handoff di continuità, scarica i modelli, rilascia i pin RAM dinamici, esegue il garbage collector e svuota la cache CUDA prima di iniziare la successiva.
9. Premi **Queue Prompt**. Il Director genera i segmenti in ordine e SaveVideo scrive un unico file in `ComfyUI/output/video/PlagueKindH3SparseV9_Continuous`.

Usa gli stessi identificatori in ogni prompt (`<Picture 1>`, `<Video 1>`, `<Audio 1>`). Dal secondo segmento descrivi l'azione come prosecuzione, evitando una nuova disposizione incompatibile di personaggi e camera. Ogni segmento resta una nuova inferenza: controlla il rapporto Director e riduci durata o risoluzione se la scena devia o termina la memoria.

Esempio di prompt:

```text
[reference generation]
<Picture 1> defines the adult main character's face, hair and clothing.
<Picture 2> defines the location, lighting and color palette.
Create a new coherent 5-second scene. Preserve identity and outfit while the
character walks toward the camera, stops, turns and speaks one short line.
The camera moves smoothly. Hands and facial features remain stable.
overall_soundscape: Footsteps, room ambience and synchronized dialogue.
```

## 3. Impostazioni corrispondenti alla generazione attuale

L'export parte dal PlagueKind V9 già usato dal progetto: **hybrid b30-49 INT8**, sparse attention **0,70**, LoRA **H3-PK-Parasyte-Turbo 1,5**, Fast6 presente ma disattivata, **8 step**, scheduler `beta57`, sampler **ER-SDE / ODE**, correzione AdaLN `strip`, attenzione a bassa VRAM e scaricamento di Qwen dopo il conditioning. La risoluzione iniziale è circa **0,98 MP in 4:3**, a **24 fps**. Controlla la durata nel gruppo Sampler: il nodo R2V usa un numero di frame valido nel formato `5 + 17 × n`; **124 frame ≈ 5 s**, **192 frame ≈ 8 s**. La webapp può impostare 8 s, mentre l'export grafico parte con 124 frame: porta il valore a 192 se vuoi una clip da circa 8 s. Il costo in VRAM e tempo aumenta con durata e risoluzione.

Avvia **Queue Prompt**. Troverai il file in `ComfyUI/output/video/` con H.264, CRF 10. Per il primo tentativo lascia in bypass gli enhancement. Una volta verificato il video di base, puoi attivare i gruppi di latent upscale, FILM e RTX VSR; i loro pesi sono inclusi, ma il consumo di memoria aumenta. Se la generazione termina per esaurimento di memoria, disattiva gli enhancement, accorcia la clip e riduci i megapixel nel nodo **Video Target Dimension**.

## 4. Variante Director UHD

Apri `PlagueKind_H3_V9_Continuous_R2V_UHD_ComfyUI.json` per la versione destinata a GPU Vast.ai performanti. Il preset contiene due Asset da 12 secondi e produce un unico master continuativo con questa catena:

```text
prima generazione 1344×768
→ H3 learned latent upscale + refine a 1920×1088
→ RTX Video Super Resolution a 3840×2160, HIGH
→ RCAS sharpening 0,20
→ SaveVideo UHD a 24 fps con audio
```

Il nodo **Director H3 latent upscale + refine** usa una seconda campionatura Euler da 3 step con denoise `0,20`, temporal chunking e due tile spaziali. Il ramo refine usa il modello H3 corretto ma senza la LoRA Turbo, per recuperare dettaglio senza rinforzare l'aspetto da generazione rapida. `images_pre_refine` rimane disponibile per il confronto con la prima passata.

Nel preset distribuito **Confirm first pass / 先确认一采 è disattivato**: un solo **Queue Prompt** esegue prima passata, refine, RTX VSR, RCAS e `SaveVideo`. Se nel report compare `先确认一采` oppure il messaggio che invita a fare una seconda Queue, è ancora aperta una copia precedente del workflow (o la casella è stata riattivata): ricarica il JSON del pacchetto aggiornato e verifica che il nodo riporti `AUTO` nel titolo.

La risoluzione UHD è reale nel file, mentre i dettagli sono ricostruiti a partire dal master H3. Per una bozza veloce usa il workflow continuo standard. Per il master finale usa quello UHD; lascia FILM disattivato per mantenere il movimento cinematografico a 24 fps.

RTX VSR su Vast.ai richiede una GPU NVIDIA RTX supportata, Linux **x86_64** e un driver compatibile. Se il nodo `RTXVideoSuperResolution` non si carica, esegui `./install.sh --check`, controlla `nvidia-smi` e usa il percorso Python stampato dall'installer per verificare `python -c "import nvvfx"`. Il passaggio H3 a 1920×1088 resta comunque il miglioramento principale. Il runtime NVIDIA VFX su Linux può dipendere dalla combinazione esatta di GPU e driver; un nodo correttamente installato non garantisce che ogni driver produca un output valido.

## File e fonti

- `install.sh`: installer da terminale e controllo locale con `--check`.
- `models.py`: manifest dei dodici pesi, download autenticato delle due LoRA Civitai e verifica SHA-256.
- `nodes.txt`: repository dei custom node.
- `PlagueKind_H3_V9_Reference_ComfyUI.json`: workflow grafico R2V.
- `PlagueKind_H3_V9_Continuous_R2V_ComfyUI.json`: workflow Director R2V con reference condivise e continuità fra segmenti.
- `PlagueKind_H3_V9_Continuous_R2V_UHD_ComfyUI.json`: variante con H3 latent refine a circa 2 MP, RTX VSR UHD e RCAS.
- `PlagueKind_Reference_Memory/`: nodi locali per scaricare Qwen e attivare le reference facoltative senza caricare i file non usati.

I nodi PlagueKind sono descritti nel [repository ufficiale](https://github.com/PlagueKind/Comfyui-PlagueKind-Nodes). Il nodo R2V e FILM sono parte del [ComfyUI attuale](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py). I pesi sono scaricati dai repository Hugging Face dei rispettivi autori, indicati in `models.py`.
