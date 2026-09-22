# Installazione completa su Vast.ai

Il repository include due installer equivalenti:

- `install-vastai-all-in-one.bat` per una macchina **Windows**;
- `install-vastai-all-in-one.sh` per le normali istanze **Linux/Ubuntu** di Vast.ai.

Il BAT richiesto non può essere eseguito in un container Linux. Per Vast.ai è quindi consigliato scegliere un template Linux con CUDA, almeno 100-150 GB di disco oltre allo spazio destinato ai modelli, e usare lo script `.sh`. I modelli H3 e LTX 2.5 insieme possono richiedere ben oltre 100 GB.

## Cosa viene installato

- ComfyUI aggiornato dal repository ufficiale;
- Python 3.12 in ambiente virtuale isolato;
- PyTorch CUDA, dipendenze ComfyUI e Hugging Face CLI;
- FFmpeg, Git, Node.js 20+ e dipendenze npm della webapp;
- custom node per MiniMax H3, LTX, LTX 2.5, SeedVR2, finishing e workflow Studio;
- `ComfyUI_Remote_Model_Loaders` incluso in questo repository;
- cartelle corrette per tutti i tipi di modello;
- `.env` locale e launcher per ComfyUI + webapp.

I pesi dei modelli non vengono scaricati automaticamente: sono molto grandi, alcuni richiedono l'accettazione di una licenza, un account o un acquisto. Consulta [VASTAI_MODELS.md](VASTAI_MODELS.md).

## Linux Vast.ai (consigliato)

Nel terminale dell'istanza:

```bash
git clone https://github.com/markreles7/ComfyUI_Remote.git /workspace/ComfyUI_Remote
cd /workspace/ComfyUI_Remote
chmod +x install-vastai-all-in-one.sh start-vastai.sh
./install-vastai-all-in-one.sh
```

Varianti:

```bash
# Installa soltanto il nucleo H3/LTX, senza moduli estesi
INSTALL_TIER=minimal ./install-vastai-all-in-one.sh

# Cambia disco/cartella
VASTAI_WORKSPACE=/workspace ./install-vastai-all-in-one.sh

# Ruote PyTorch CUDA 13.0, soltanto se compatibili con driver e immagine
CUDA_WHEEL=cu130 ./install-vastai-all-in-one.sh
```

Avvio:

```bash
./start-vastai.sh
```

Per una GPU con poca VRAM:

```bash
LOW_VRAM=true ./start-vastai.sh
```

## Windows Vast.ai

Scarica o clona il repository, quindi fai doppio clic su:

```text
install-vastai-all-in-one.bat
```

Il BAT usa PowerShell e, quando necessario, `winget` per installare Git, Python 3.12, Node.js e FFmpeg. Il percorso predefinito di ComfyUI è `C:\VastAI\ComfyUI`.

Parametri facoltativi da Prompt dei comandi:

```bat
install-vastai-all-in-one.bat -Workspace D:\VastAI
install-vastai-all-in-one.bat -Minimal
install-vastai-all-in-one.bat -CudaWheel cu130
install-vastai-all-in-one.bat -ValidateOnly
```

Avvio successivo:

```bat
start-vastai.bat
start-vastai.bat -LowVram
```

Per controllare il pacchetto Linux senza installare nulla:

```bash
./install-vastai-all-in-one.sh --check
```

## Accesso remoto sicuro

La webapp non ha ancora autenticazione integrata. Gli installer fanno ascoltare sia ComfyUI sia la webapp soltanto su `127.0.0.1`; non pubblicare direttamente le porte 3000 e 8188 in Internet.

Dal proprio PC aprire un tunnel SSH:

```bash
ssh -L 3000:127.0.0.1:3000 -L 8188:127.0.0.1:8188 root@HOST_VAST
```

Poi aprire:

- webapp: `http://127.0.0.1:3000`;
- ComfyUI: `http://127.0.0.1:8188`.

In alternativa si può installare Tailscale nell'istanza e mantenere le porte non pubbliche.

## File e log creati

- `.env`: collegamento fra webapp e ComfyUI;
- `.vastai-install.env`: percorsi usati dai launcher;
- `.data/vastai-logs/comfyui.*.log`;
- `.data/vastai-logs/webapp.*.log`.

Gli installer sono idempotenti: se rilanciati aggiornano i repository Git e reinstallano requirements senza cancellare modelli, input, output o configurazioni esistenti.
