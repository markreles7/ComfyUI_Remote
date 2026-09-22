# Modelli per l'installazione Vast.ai

La webapp rileva i pesi realmente presenti e nasconde le funzioni mancanti. Non è necessario scaricare tutto: scegli una famiglia video, una famiglia immagine e gli upscaler che userai.

Nei comandi seguenti, `COMFYUI_ROOT` indica:

- Linux: `/workspace/ComfyUI`;
- Windows: `C:\VastAI\ComfyUI` (oppure il percorso scelto nell'installer).

## MiniMax H3 — set consigliato

Fonte pubblica: [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3). Accetta prima la licenza MiniMax se Hugging Face lo richiede.

| File | Percorso sotto `COMFYUI_ROOT/models` | Uso |
| --- | --- | --- |
| `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `diffusion_models/` | T2V, singola immagine, first/last |
| `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `diffusion_models/` | Multi Reference |
| `qwen3vl_32b_minimax_h3_int8_convrot.safetensors` | `text_encoders/` | encoder H3 condiviso |
| `minimax_h3_video_vae_fp16.safetensors` | `vae/` | video VAE |
| `minimax_h3_audio_vae_fp32.safetensors` | `vae/` | audio VAE |
| `minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors` | `loras/` | accelerazione H3 FL2VA |

Dopo l'installer, il comando `hf` è disponibile. Esempio Linux:

```bash
hf download Comfy-Org/MiniMax-H3 \
  diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors \
  diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors \
  text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors \
  vae/minimax_h3_video_vae_fp16.safetensors \
  vae/minimax_h3_audio_vae_fp32.safetensors \
  loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors \
  --local-dir /workspace/ComfyUI/models
```

### Minimax H3 Fast — dipendenze aggiuntive

Il profilo I2V Sigma-Split richiede inoltre:

| File | Percorso sotto `COMFYUI_ROOT/models` | Fonte |
| --- | --- | --- |
| `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors` | `diffusion_models/` | `smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models` |
| `minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors` | `loras/` | `Kijai/MiniMax-H3_comfy` |
| `minimax_h3_latent_upscaler_3d_fp16.safetensors` oppure variante BF16 | `latent_upscale_models/` | `LBH-123-AI/Minimax_h3_latent_Upscaler` |

```bash
hf download smhfacct/Minimax-H3-fl2va-ref2va-hybrid-models \
  minimax_h3_hybrid_fl2va_ref2va_b25-49-int8.safetensors \
  --local-dir /workspace/ComfyUI/models/diffusion_models

hf download Kijai/MiniMax-H3_comfy \
  loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy.safetensors \
  --local-dir /workspace/ComfyUI/models

hf download LBH-123-AI/Minimax_h3_latent_Upscaler \
  minimax_h3_latent_upscaler_3d_fp16.safetensors \
  --local-dir /workspace/ComfyUI/models/latent_upscale_models
```

Il nodo `MiniMaxH3DualClockSamplerT8` arriva da `T8mars/comfyui-minimax-h3-audio-T8`; l'installer esteso lo installa automaticamente. Aggiorna prima ComfyUI, perché il pacchetto T8 usa le API H3 recenti.

### PinkCherry H3 0.6 beta

- pagina: [PinkCherry MM H3 FL2VA](https://civitai.red/models/2838593/pinkcherry-mm-h3-fl2va?modelVersionId=3221782);
- file atteso: `pinkcherryMMH3Fl2va_06Beta.safetensors`;
- destinazione: `models/diffusion_models/`;
- profilo molto pesante, FL2VA soltanto; niente Multi Reference, Turbo o GalaxyAce.

### GalaxyAce LoRA

- pagina: [GalaxyAce LoRA](https://civitai.red/models/2200329/galaxyace-lora?modelVersionId=3201619);
- file ufficiale: `H3-GalaxyAce.safetensors`;
- rinominare in `STY_GalaxyAce.safetensors`;
- destinazione: `models/loras/H3/`;
- forza consigliata `1.0`, nessun trigger;
- compatibile con H3 base/pruned ed Eros Max, non con PinkCherry.

## LTX 2.5 — set consigliato

Fonte ufficiale: [Lightricks/LTX-2.5](https://huggingface.co/Lightricks/LTX-2.5). Il set completo consigliato è:

| File | Percorso sotto `COMFYUI_ROOT/models` |
| --- | --- |
| `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` | `diffusion_models/` |
| `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` | `text_encoders/` |
| `ltx-2.5-video-vae-bf16.safetensors` | `vae/` |
| `ltx-2.5-video-vae-conv-bf16.safetensors` | `vae/` |
| `ltx-2.5-audio-vae-bf16.safetensors` | `vae/` |
| `ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors` | `latent_upscale_models/` |
| `ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors` | `latent_upscale_models/` |
| `ltx-2.5-duration-head-bf16.safetensors` | `model_patches/` |

Download Linux:

```bash
hf download Lightricks/LTX-2.5 \
  diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors \
  text_encoders/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors \
  vae/ltx-2.5-video-vae-bf16.safetensors \
  vae/ltx-2.5-video-vae-conv-bf16.safetensors \
  vae/ltx-2.5-audio-vae-bf16.safetensors \
  latent_upscale_models/ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors \
  latent_upscale_models/ltx-2.5-latent-temporal-upscaler-x2-bf16-1.0.safetensors \
  model_patches/ltx-2.5-duration-head-bf16.safetensors \
  --local-dir /workspace/ComfyUI/models
```

### REDGraft LTX 2.5 Fast 2K

- pagina: [REDGraft LTX 2.5 Fast 2K](https://civitai.red/models/1295569/redgraft-ltx-25-fast-2k-or-sulphur2-ported?modelVersionId=3250230);
- file riconosciuto: `redgraftLTX25Fast2K_ltx25RedgraftNSFW.safetensors`;
- destinazione: `models/diffusion_models/`;
- usa gli stessi Gemma 4 e VAE del set ufficiale LTX 2.5.

## Immagini — alternative indipendenti

### Qwen Image 2512

- modello: [Comfy-Org/Qwen-Image_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI);
- `qwen_image_2512_fp8_e4m3fn.safetensors` → `models/diffusion_models/QWEN/`;
- `qwen_2.5_vl_7b_fp8_scaled.safetensors` → `models/text_encoders/`;
- `qwen_image_vae.safetensors` → `models/vae/`.

### Qwen Image Edit 2511

- modello: [Comfy-Org/Qwen-Image-Edit_ComfyUI](https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI);
- `qwen_image_edit_2511_int8_convrot.safetensors` o BF16 → `models/diffusion_models/QWEN/`;
- riusa text encoder e VAE Qwen elencati sopra.

### Flux.2 Klein 4B

- modello: [Comfy-Org/flux2-klein-4B](https://huggingface.co/Comfy-Org/flux2-klein-4B);
- `flux-2-klein-base-4b.safetensors` → `models/diffusion_models/FLUX2/`;
- `qwen_3_4b.safetensors` → `models/text_encoders/`;
- `flux2-vae.safetensors` → `models/vae/`.

I checkpoint personalizzati Krea 2, Flux.2, Qwen e SDXL acquistati o scaricati manualmente vanno nelle rispettive sottocartelle. La webapp non scarica né acquista automaticamente file Civitai.

## SeedVR2 — tre profili della webapp

| Profilo | Fonte | Destinazione |
| --- | --- | --- |
| Veloce: `seedvr2_ema_3b-Q4_K_M.gguf` | [AInVFX/SeedVR2_comfyUI](https://huggingface.co/AInVFX/SeedVR2_comfyUI) | `models/SEEDVR2/` |
| Bilanciato: `seedvr2_ema_3b_fp8_e4m3fn.safetensors` | [numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI) | `models/SEEDVR2/` |
| Massimo: `seedvr2_ema_7b_fp16.safetensors` | [numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI) | `models/SEEDVR2/` |
| VAE condiviso: `ema_vae_fp16.safetensors` | [numz/SeedVR2_comfyUI](https://huggingface.co/numz/SeedVR2_comfyUI) | `models/SEEDVR2/` |

Su GPU affittata conviene scegliere almeno 24 GB VRAM per H3/LTX e 32 GB o più per PinkCherry, LTX 2.5 e SeedVR2 massimo. Anche RAM e NVMe incidono: prevedere almeno 64 GB RAM per i profili più pesanti.

## Controllo finale

1. Riavvia ComfyUI dopo aver copiato i modelli.
2. Apri la webapp e attendi l'aggiornamento inventario.
3. Le opzioni disponibili indicano soltanto workflow i cui nodi e pesi sono stati rilevati.
4. Se un modello non compare, controlla nome esatto, cartella e log `.data/vastai-logs/comfyui.err.log`.
