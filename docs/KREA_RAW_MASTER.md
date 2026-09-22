# Krea 2 RAW Master

Workflow Image Studio ricostruito dal prompt API incorporato nell'output
`famegrid_v2_00002_.png`. La modalita RAW Master replica la ricetta originale;
sono cambiati soltanto i percorsi locali dei pesi rinominati.

## Componenti

| Componente | Destinazione locale | Stato |
| --- | --- | --- |
| `krea2_raw_bf16.safetensors` | `E:\ComfyUI\Data\Models\DiffusionModels\FluxKrea2\` | Download ufficiale Hugging Face · SHA-256 `f99bb0ff8e362b77342bc4994e0c50906fe7ef7074864b181b7d48d2fa6d03d7` |
| `STY_Krea2_Turbo_Rank64_BF16.safetensors` | `E:\ComfyUI\Data\Models\Lora\FLUX\` | Installato · peso workflow `0.6` |
| `STY_Krea2_Filter_Bypass_v3.safetensors` | `E:\ComfyUI\Data\Models\Lora\FLUX\` | Installato e SHA-256 verificato |
| `STY_FameGrid_Krea2_Spice_FIX_trigger-famegrid.safetensors` | `E:\ComfyUI\Data\Models\Lora\FLUX\` | Installato · peso workflow `1.0` |
| `qwen3vl_4b_bf16.safetensors` | cartella text encoder condivisa | Già installato |
| `wan_2.1_vae.safetensors` | `E:\ComfyUI\Data\Models\VAE\` | Già installato; mapping locale del VAE usato dall'originale |
| `ComfyUI-FameGridColorFinish` | `E:\ComfyUI\Data\Packages\ComfyUI LTX\custom_nodes\` | Installato da GitHub |
| `RES4LYF` | `E:\ComfyUI\Data\Packages\ComfyUI LTX\custom_nodes\` | Già installato |

## Fonti

- Modello, Turbo LoRA, encoder e VAE: <https://huggingface.co/Comfy-Org/Krea-2>
- Filter Bypass: <https://huggingface.co/uzumix/krea2filterbypass3.safetensors>
- FameGrid Spice FIX: <https://civitai.com/models/2088956?modelVersionId=3278885>
- Color Finish: <https://github.com/Elevenheights/ComfyUI-FameGridColorFinish>
- Workflow di riferimento: <https://pastebin.com/GKMm2Njs>

## Ricetta bloccata originale

- `ResolutionSelector` collegato direttamente al latent, con rapporto e megapixel selezionabili; default `9:16`, `1.2 MP`, multiplo `8`;
- Turbo LoRA `0.6` → Filter Bypass `1.0` → FameGrid Spicy `1.0`;
- negativo fotografico originale sempre presente;
- CFG condiviso `1.0`;
- sampler 1: `multistep/res_2m`, `beta57`, 6 step, denoise `1.0`;
- sampler 2: `multistep/deis_3m`, `bong_tangent`, 2 step, denoise `0.2`;
- `FameGridColorFinish`: colore `1.0`, sharpen `0.2`;
- upscale finale manuale.

Il trigger `famegrid` viene inserito automaticamente. Un negativo scritto
dall'utente viene aggiunto in coda al negativo originale, senza sostituirlo.

## Verifica dei pesi

Il checkpoint generativo resta Krea 2 RAW BF16; la parola Turbo nella ricetta
indica la LoRA ufficiale rank 64, non un secondo checkpoint.
