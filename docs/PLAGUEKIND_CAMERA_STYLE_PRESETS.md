# PlagueKind: Handheld e CinemaGrade

## Ricontrollo della cartella H3

Inventario completo: [h3-lora-inventory.json](h3-lora-inventory.json).
Sono presenti 60 file. Tutti i riferimenti dei preset esistenti si risolvono;
37 file hanno metadati nel catalogo verificato. I restanti 23 sono disponibili
per selezione manuale: non vengono inventati trigger o pesi dai nomi dei file.
Fra questi sono compresi CINEMA1/2/3 e VBVR base, già coperti da preset
sperimentali basati sui metadati locali.

Il riconoscimento tollera cambi di prefisso STY, MOT, CAM, AUD, CHAR, SFW,
NSFW e POV. Mantiene invariati versioni, epoche e suffissi FL2VA/Ref2VA.
I nomi esatti hanno priorità; una corrispondenza ambigua non viene applicata.
Non vengono rinominati o spostati i pesi sul disco.
Se manca una LoRA necessaria, il preset PlagueKind lascia intatta la selezione
attuale invece di applicare una combinazione incompleta.

Sono stati recuperati i metadati dei due file rinominati
`NSFW_H3_Mis_Insrt_v07.safetensors` e `NSFW_Vagina_minimax-h3_epoch20.safetensors`:
hash locali corrispondenti alle versioni Civitai 3210503 e 3252213.

Nuovi preset singoli:

- **Stile · GalaxyAce smartphone**, peso 1,00, nessun trigger.
  [Versione H3 3201619](https://civitai.com/models/2200329?modelVersionId=3201619).
  L'autore suggerisce 0,70 se il parlato perde sincronizzazione.
- **Movimento · Continuity Repair**, peso 0,60, trigger `bunny_crisp_motion`.
  [Versione 3268186](https://civitai.com/models/2890788?modelVersionId=3268186).
  Impiega il range 0,50–0,70 della prima passata senza aggiungerne una seconda.

Anche questi due file sono stati verificati via SHA-256 contro l'API Civitai.
Nessun rendering di validazione eseguito su Hybrid PlagueKind.

Per aggiornare l'inventario dopo altre rinomine:

```powershell
node scripts/audit-h3-loras.mjs "E:\ComfyUI\Data\Models\Lora\H3" docs/h3-lora-inventory.json
```

## Preset camera e color grading

Verifica del 29 settembre 2026 tramite API Civitai dei modelli e delle versioni,
elenco LoRA di ComfyUI e SHA-256 dei file locali.

| Preset | File | Peso | Trigger |
| --- | --- | --- | --- |
| Camera · Shaky Handheld H3 | `H3/STY_handheld_h3_100.safetensors` | 1,00, punto iniziale sperimentale | Nessuno dichiarato per H3 |
| Stile · CinemaGrade ep50 | `H3/STY_cinemagrade_style_h3_ep50.safetensors` | 1,00, consigliato dall'autore | `cinemagradestyle` |
| Camera + stile · Handheld / CinemaGrade | Entrambi | 0,60 + 0,80, combinazione sperimentale | `cinemagradestyle` |

I preset sono nel selettore **PlagueKind → Preset scena · LoRA e trigger**.
Applicarli sostituisce le LoRA gestite dai preset scena, conservando altre LoRA
manuali e senza cambiare prompt narrativo, modalità, durata, sampling o Parasyte.
Le intensità della combinazione sono scelte conservative dell'app, non consigli
dei creatori. Nessuno di questi preset è stato validato con un render.

## Fonti e distinzione fra versioni

- [Shaky, handheld camera — H3 v1.0, 3343481](https://civitai.com/models/2592748?modelVersionId=3343481):
  la versione H3 rafforza il tremolio e supporta punti di vista fermi o in movimento.
  L'API della versione non dichiara trained words. La descrizione del modello
  comprende anche Wan 2.2: non applicare automaticamente a H3 le istruzioni
  high-noise-only, il peso 1,7 o il trigger Wan `shaky, handheld`.
- [CinemaGrade — ep50, 3312531](https://civitai.com/models/2927223?modelVersionId=3312531):
  stile/color grading, trigger `cinemagradestyle`, peso iniziale 1,0.
  ep50 è la variante più forte; ep35 è quella più morbida, non sostituita
  automaticamente. Addestrata per H3 FL2VA, sperimentale; compatibilità visiva
  con Hybrid PlagueKind da verificare. La pagina suggerisce storyboard disegnati
  e reference di personaggi; una foto iniziale tende a conservare il look esistente.

I file installati corrispondono agli hash pubblicati:

- Handheld: `D56360BC9DE18ABEC4298518ED630167EE4A3F64A7DBBC8BC0C2259D33F74069`
- CinemaGrade ep50: `3B35FE7C10F462E555D2CE10979C1EBCEE4B1B712A47FA4A36B0C2BF0E1445C1`

Per una camera CCTV fissa usare CinemaGrade da sola: il peso Handheld può
introdurre tremolio anche se il testo richiede una camera immobile.
Il trigger CinemaGrade viene inserito una sola volta all'inizio del contenuto
visivo H3 (`detailed_description` oppure `integrated_multimodal_description`),
in ciascuna sequenza indipendente, mantenendo lo schema nativo dell'app.
