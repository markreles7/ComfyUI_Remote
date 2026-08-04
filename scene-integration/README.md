# Scene Integration Engine

Il motore è opzionale e retrocompatibile. Si abilita con
`SCENE_INTEGRATION_ENABLED=true` e usa il Python indicato da
`SCENE_ANALYSIS_PYTHON` (in assenza viene cercato il venv dell'istanza
ComfyUI LTX).

## Runtime

- Analisi deterministica: OpenCV, NumPy, SciPy e scikit-image.
- Identità facciale: InsightFace `buffalo_sc`, eseguito su CPU e usato solo
  quando entrambe le immagini contengono almeno un volto.
- Depth e segmentazione di qualità: nodi ComfyUI già installati
  DepthAnythingV2 e Florence2.
- Tracking massimo: SAM3 per clip fino a 30 secondi; oltre tale durata viene
  usato il campionamento temporale Farneback per evitare OOM.

Il model pack `buffalo_sc` va estratto in:

`%USERPROFILE%\.insightface\models\buffalo_sc`

I pesi ufficiali sono pubblicati nel model zoo InsightFace e hanno licenza
separata dal codice dell'applicazione.

## Ordine della pipeline

1. analisi e Scene Profile versionato;
2. adapter Qwen, FLUX.2 Klein, LTX o generico;
3. generazione/compositing del workflow esistente;
4. armonizzazione selettiva colore e nitidezza;
5. film grain finale;
6. valutatore per categorie;
7. eventuale correzione selettiva, entro il limite del preset.

I controlli non supportati non vengono simulati: sono elencati nei fallback
della generazione.
