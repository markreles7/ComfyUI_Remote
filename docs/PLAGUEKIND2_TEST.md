# PlagueKind2Test

Variante sperimentale separata da PlagueKind H3 Sparse V9 (2026-09-30).
Il builder originale `src/minimax-h3-sparse-workflows.js` e il suo gestore
`src/plaguekind-separate-sequences.js` non sono modificati dalla variante.
Il nuovo builder li riutilizza per conservare sampling, modelli e reference.

## Utilizzo

In Video Studio selezionare **PlagueKind2Test**. I controlli sono condivisi con
PlagueKind: scegliere modello/modalita', caricare le reference e, per una catena,
attivare Sequenze continuative con 2–8 prompt separati da `---` su una riga.
H3 Latent Upscale e RCAS restano selezionabili e si applicano ai video finali.
Il workflow originale resta selezionabile come prima.

## Percorso della continuita'

Il risultato del sampler base viene decodificato prima della rifinitura.
Gli ultimi 5/22/39/56 frame sono salvati come PNG tramite SaveImage, senza
compressione con perdita (PNG RGB a 8 bit, non salvataggio dei latenti float).
Con upscale disattivato si riutilizza il decode base gia' presente.
Con upscale attivato e' necessario un decode base aggiuntivo.

Il video finale continua attraverso il normale ramo H3 Latent Upscale/RCAS.
Al completamento dell'intero job, il server conserva il manifesto ordinato dei
PNG in `continuityImages`, separato dai file pubblici della galleria. Li ricarica
senza trasformazioni e li unisce in un batch ordinato per MiniMaxH3AddGuide nella
sequenza seguente. Le reference originali sono conservate; in I2V valgono le
regole di compatibilita' modello della versione originale.

I frame devono avere le dimensioni della generazione base. Se mancano o sono
incoerenti, la continuazione si blocca: non ripiega sul video rifinito.
Il manifesto persistente permette il recupero dopo riavvio. La cancellazione
dei file di un progetto include anche i PNG di continuita' nell'output.

Output: `VideoStudio/PlagueKind2Test/PlagueKind2Test_*.mp4`.
Contesto: `VideoStudio/PlagueKind2Test/continuity/base_*.png`.

## Limiti e confronto

Resta la ricodifica VAE dei frame e l'eventuale deriva gia' presente nella base.
La variante non garantisce qualita' superiore: confrontare una scena neutra con
stessi prompt, reference, seed e impostazioni, cambiando solo il workflow.
Le reference non sono un vincolo assoluto sull'identita'. Non modifica la gestione
audio o l'overlap temporale della versione originale.
Il costo aggiuntivo e' il decode base (se upscale attivo), lo spazio dei PNG e il
loro trasferimento. La sequenza seguente attende anche il completamento del video
finale; la separazione e' del materiale di continuita', non una coda GPU parallela.

I pulsanti di finishing successivo dedicati a V9 non sono estesi a questa variante:
configurare H3 Latent Upscale e RCAS prima di avviare il test.
