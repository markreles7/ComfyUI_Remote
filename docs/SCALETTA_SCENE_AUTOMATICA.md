# Scaletta automatica da cartelle

Data: 2026-09-30
Stato: proposta salvata su richiesta dell'utente; implementazione rimandata.

## Obiettivo

Preparare immagini e prompt in cartelle SCENA 01, SCENA 02, ecc., avviare una sola volta e generare tutte le sequenze nell'ordine previsto, senza interventi tra le generazioni.

Caso iniziale: cinque cartelle, ciascuna con due reference sheet dei personaggi, una o due immagini della scena e un prompt TXT o MD composto da due blocchi separati da una riga `---`. Ogni blocco corrisponde a una sequenza da 10 secondi: 20 secondi nominali per scena, 100 secondi nominali complessivi. Per 60 secondi bastano tre scene con questa struttura.

## Soluzioni proposte, ancora da scegliere

1. Integrazione in Video Studio: importazione cartella o ZIP, anteprima della scaletta, impostazioni comuni e pulsante Avvia tutto. Soluzione consigliata.
2. Script con launcher BAT che legge cartelle e gestisce le generazioni.
3. Servizio che monitora una cartella; un file PRONTO segnala che il progetto e' completo e puo' essere elaborato.

## Convenzioni proposte

```text
PROGETTO/
  SCENA 01/
    ref_01_personaggio.png
    ref_02_personaggio.png
    ref_03_ambiente.png
    ref_04_dettaglio.png  (facoltativa)
    prompt.txt
  SCENA 02/
    ...
```

- Ordinamento numerico delle cartelle e delle reference.
- Associazione stabile ref_01 -> <Picture 1>, ecc.
- TXT o MD con blocchi separati da `---` su una riga autonoma.
- Durata configurata nel workflow, non dedotta dalla sola descrizione testuale.
- Ruolo esplicito delle immagini: reference, primo frame o ultimo frame, secondo le capacita' del workflow.
- Numero di sequenze ricavato dai blocchi e validato rispetto ai limiti del workflow.

## Esecuzione proposta

SCENA 01 / sequenza 1 -> sequenza 2 -> SCENA 02 / sequenza 1 -> sequenza 2 -> ...

Attendere il completamento effettivo e verificare l'output prima di inviare la sequenza seguente. Modalita' selezionabili:

- Continuita' interna alla scena: reference condivise e contesto video finale della sequenza precedente.
- Inquadrature indipendenti: reference condivise, con eventuale immagine iniziale propria.

Impostazione iniziale proposta: continuita' dentro ogni cartella e nuova scena al cambio cartella. La continuita' visiva non e' garantita dal solo concatenamento. Overlap e rimozione dei frame condivisi richiedono verifica della durata finale effettiva.

## Requisiti della prima versione

- Validazione preventiva di file, prompt, associazioni e compatibilita' del workflow.
- Scaletta ordinata e avvio unico.
- Stato persistente con ID ComfyUI; recupero dopo riavvio evitando duplicazioni dei lavori gia' completati o ancora attivi.
- Nomi output leggibili, per esempio SCENA_01_SEQ_01.mp4.
- Tentativi limitati sugli errori recuperabili e blocco delle sequenze dipendenti in caso di fallimento.
- Rigenerazione selettiva; definire come invalidare o rigenerare le sequenze successive dipendenti.
- Unione finale facoltativa in ordine cronologico.
- Esecuzione nel servizio backend, indipendente dalla permanenza del browser aperto.

## Basi gia' presenti nel repository

README.md descrive PlagueKind H3 Sparse V9, reference e prompt multipli separati da `---`.
src/server.js contiene advancePlaguekindSeparateSequence e uploadPlaguekindContinuityTail: avanzamento delle sequenze separate e recupero del contesto finale della clip precedente.
Riutilizzare queste basi previa verifica, aggiungendo importazione e coordinamento tra scene. Non considerare l'importazione da cartelle gia' implementata.

## Decisioni da prendere quando si riprende il lavoro

- Interfaccia di importazione e posizione dei file per esecuzione locale/remota.
- Workflow e checkpoint da usare.
- Convenzione definitiva per ruoli delle immagini e impostazioni per scena.
- Politica sugli errori, sui tagli tra inquadrature e sulla durata finale esatta.
- Formato di salvataggio del piano e modalita' di unione video/audio.

Non sono state apportate modifiche funzionali per questa proposta.
