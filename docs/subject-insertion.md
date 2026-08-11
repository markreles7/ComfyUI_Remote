# Subject Insertion

Editor Guidato usa una pipeline backend frame-first condivisibile con futuri flussi video:

`source -> scene understanding -> reference understanding -> placement -> edit region -> insertion -> local integration -> identity/detail refine -> local harmonization -> final`

## Contratto

Il piano separa sempre:

- sorgente e Scene Profile;
- identita (`subjectId`, `subjectName`, `characterId`) e reference con ruolo `identity`, `pose`, `appearance`;
- bbox di posizionamento, che non e una maschera;
- edit mask, subject mask e occlusion mask;
- strategia modello e policy dei parametri nativi;
- fallback realmente applicati.

Il risultato registra sorgente, finale, reference, modello, strategia, placement, maschere, scena, identita, correzioni, preservazione e artefatti debug disponibili.

## Nodi locali

La pipeline usa solo nodi rilevati tramite `/object_info`:

- `ImageCompositeMasked`, `ImageCropByMaskAndResize`, `ImageUncropByMask` per editing locale protetto;
- `LayerMask: SegmentAnythingUltra V2` con GroundingDINO, oppure nodi SAM2/SAM3 compatibili, per segmentazione reale;
- `Florence2Run` come grounding semantico alternativo;
- `DepthAnythingV2Preprocessor` per depth quando il modello e il workflow la supportano;
- `ModelPatchLoader` e `TextEncodeQwenImageEditPlus` per structure guide Qwen verificate.

Se un nodo o modello manca, il report segna la capability come non disponibile. Non vengono generate depth, occlusioni o relighting fittizi.

## Policy modelli

- Qwen Image Edit 2511: source e multi-reference, maschera/compositing locale esterno, structure guide solo se verificata.
- Flux.2 Klein: source e multi-reference, compositing locale esterno; nessun ControlNet depth viene dichiarato senza supporto verificato.
- Step, guidance, denoise e reference strength restano quelli del workflow nativo.
- Color match, blur, grain e ombre generiche non vengono applicati globalmente alle fotografie.
- Per le persone non viene aggiunta una drop shadow generica.

## Test manuale consigliato

1. Aprire Image Studio e scegliere Editor Guidato > Persona.
2. Caricare una foto con due uomini al bancone e una reference del terzo uomo.
3. Disegnare una bbox tra i due uomini; dipingere una maschera locale solo se serve una regione precisa.
4. Indicare interazione, piano di profondita e gli elementi da preservare.
5. Generare prima con Qwen e poi, a parita di input, con Klein.
6. Verificare nel report strategia, policy `preserve-native`, maschere reali e fallback.
7. Controllare che persone originali, bancone, sfondo, prospettiva e luce fuori ROI non cambino.

Gli artefatti debug restano tecnici e non fanno parte dell'archivio principale delle generazioni.
