# LM Studio: tuning del prompt compiler MiniMax H3

Analisi e test locali del 5 ottobre 2026. Configurazione scelta fra le alternative effettivamente provate, con parametri espliciti nelle richieste API. Sono state conservate le modifiche già presenti nel workspace.

## MODEL

- Modello: HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive, variante instruction-tuned Gemma 4 E4B-IT modificata dall'autore.
- Identificatore API: gemma-4-e4b-uncensored-hauhaucs-aggressive.
- Architettura: gemma4, 42 layer; il metadata locale e LM Studio riportano 7,5B parametri. E4B è il nome della variante, non una misura di 4B pesi totali.
- File: D:/AIMODELS/HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf; quantizzazione Q4_K_M. Il proiettore multimodale è mmproj-Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-f16.gguf.
- Contesto supportato: 131.072 token, confermato dal metadata GGUF e dall'API.
- Runtime selezionato: llama.cpp-win-x86_64-nvidia-cuda12-avx2 2.51.0, upstream b11368, commit 1fb7ef3e3. LM Studio registrato localmente: 0.4.21 build 2. GPU: RTX 4070 SUPER, 12 GB.
- Chat template: Jinja nativo incluso nel GGUF, delimitatori Gemma 4 <|turn> e <turn|>. Il runtime segnala template datato e applica le proprie correzioni di compatibilità; il template non è stato sostituito.
- EOS GGUF: <eos>, ID 1; fine turno <turn|>, ID 106. Nessuna stop string personalizzata aggiunta. Il runtime esclude </s> (ID 212) dagli EOG perché qui è un token ordinario.

Identità e variante instruct riscontrate anche nella [model card dell'autore](https://huggingface.co/HauhauCS/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive). Gli altri dati sopra provengono dai file locali e dalle risposte del server.

## FINAL SETTINGS

| Parametro | Valore e applicazione |
| --- | --- |
| temperature | 0.15 |
| top_p | 1 |
| top_k | 40 |
| min_p | 0 |
| repeat_penalty | 1.05 |
| presence_penalty | Non inviato: default LM Studio disattivato/0, senza override salvati rilevati |
| frequency_penalty | Non inviato: default LM Studio disattivato/0, senza override salvati rilevati |
| seed | Non inviato; seed fisso non documentato su /api/v1/chat; nessun seed salvato rilevato |
| context length | 16.384 per H3 ordinario; 32.768 con oltre quattro immagini, multisequenza, input oltre 6.000 caratteri o finalizzazione PlagueKind |
| max output tokens | 2.048 ordinario; 4.096 per ciascun prompt finale PlagueKind; la revisione della sceneggiatura conserva il budget separato |
| reasoning | off, verificato: zero reasoning output tokens |
| stream / store | false / false |
| flash_attention | true al caricamento |

Temperature, top-p, top-k, min-p e repeat penalty sono documentati nell'[API nativa LM Studio](https://lmstudio.ai/docs/developer/rest/chat) e sono stati effettivamente accettati nelle generazioni finali. top_k=0 è stato provato e rifiutato con HTTP 400: il parser nativo richiede almeno 1. Non si è quindi assunto che la convenzione di disattivazione di llama.cpp fosse valida anche per questa API.

Presence/frequency penalty e seed sono disponibili nel backend/SDK, ma non esposti dallo schema documentato di questa rotta REST: non vengono inviati come campi potenzialmente ignorati. I default sono riscontrabili nello [schema ufficiale del SDK](https://github.com/lmstudio-ai/lmstudio-js/blob/main/packages/lms-kv-config/src/schema.ts). L'API pubblica non restituisce la configurazione completa risolta dei sampler: i default originari ereditati rimangono inferenze basate su schema e assenza di override; i cinque valori finali sono invece espliciti e testati.

## CONTROL LOCATION

- Profilo del progetto: config/lm-studio-h3-inference.json, vincolato a identificatore e quantizzazione del modello testato.
- Applicazione: src/lm-studio-client.js applica i cinque sampler a /api/v1/chat; l'API client controlla quindi la generazione H3, incluse le riparazioni e i clip finali.
- /api/v1/models/load controlla il contesto e flash attention. Le istanze con contesto noto insufficiente vengono ricaricate.
- .env rimane il controllo generico degli altri task: 8192 context, 2048 output, temperature 0.35. Già prima dei test H3 limitava effettivamente la temperatura a 0.15 e richiedeva almeno 16K; leggere solo .env era fuorviante.
- Il profilo LM Studio salvato per il GGUF contiene contextLength 65536, GPU offload completo, quattro thread CPU e una sessione parallela; nessun override di inference. Il globalPredictionConfig ha fields vuoti. Nessun file globale LM Studio è stato modificato.
- Il modello è caricato su richiesta e scaricato dopo il prompt. Non rimane un contesto attivo in memoria a riposo; durante i test il server ha confermato context_length=16384.

## Prompting e sampling

La baseline ometteva trigger e inventava Picture N anche senza immagini. I test a prompt invariato con temperature 0.05, 0.15 e 0.25 non hanno eliminato questi difetti. È stato quindi aggiunto un contratto sintetico nella richiesta, mantenendo il system prompt dettagliato originale: reference reali, azioni e finale vincolanti, continuità I2V, timeline locale e sezioni non vuote. La regola della prima riga è stata collocata alla fine del contratto dopo aver verificato che le formulazioni precedenti peggioravano i trigger. È una correzione di prompting, distinta dai confronti dei sampler.

Successivamente: confronto top_p 1/0.9; confronto min_p ereditato/0; prova top_k 0 (rifiutata), confronto 40/80; repeat_penalty ereditata/1; nuova validazione con tutti i valori espliciti; confronto con repeat_penalty 1.05 e ricontrollo di top_p 0.9 sul profilo risultante. Un solo parametro è variato per passo; i risultati equivalenti entro 0.1 punti favoriscono la configurazione più semplice, o la minore penalizzazione dei termini tecnici. Il seed variabile evita di selezionare solo una risposta fortunata; ogni configurazione completa ha due generazioni per scenario. Le risposte salvate sono state tutte rivalutate con lo stesso scorer finale, correggendo i falsi positivi lessicali individuati durante la lettura.

## TEST RESULTS

288 generazioni registrate complessivamente. Otto scenari, due ripetizioni ciascuno per configurazione completa. Punteggi automatici 0–10; pesi 3 per instruction adherence, action preservation, hallucination avoidance e trigger correctness, peso 1 per le altre quattro metriche.

| Metrica | Baseline | Finale |
| --- | ---: | ---: |
| Instruction adherence | 8.44 | 9.69 |
| User-action preservation | 9.84 | 9.69 |
| Reference continuity | 10.00 | 10.00 |
| Timeline coherence | 5.63 | 8.75 |
| Hallucination avoidance | 6.88 | 10.00 |
| Trigger correctness | 5.00 | 10.00 |
| Output completeness | 10.00 | 10.00 |
| Unnecessary creativity (10 = nessuna aggiunta rilevata) | 9.38 | 10.00 |
| Media ponderata | 7.842 | 9.805 |

| Scenario | Baseline | Finale | Trigger corretti |
| --- | ---: | ---: | --- |
| fight | 6.48 | 9.77 | 0/2 → 2/2 |
| finisher | 4.84 | 10.00 | 0/2 → 2/2 |
| i2v | 9.69 | 10.00 | 2/2 → 2/2 |
| lexical | 5.47 | 9.45 | 0/2 → 2/2 |
| magic | 10.00 | 10.00 | 2/2 → 2/2 |
| normal | 9.38 | 9.53 | 2/2 → 2/2 |
| timeline | 9.22 | 9.69 | 2/2 → 2/2 |
| weapon | 7.66 | 10.00 | 0/2 → 2/2 |

| Configurazione | Generazioni | Punteggio | Tempo medio senza caricamento | Max output osservato |
| --- | ---: | ---: | ---: | ---: |
| baseline | 16 | 7.842 | 7.42 s | 802 |
| contract005 | 16 | 9.219 | 6.82 s | 750 |
| contract015 | 16 | 9.043 | 6.74 s | 891 |
| contract2-005 | 16 | 8.506 | 7.31 s | 729 |
| contract2-015 | 16 | 8.584 | 7.55 s | 775 |
| contract3-005 | 16 | 9.688 | 8.00 s | 873 |
| contract3-015 | 16 | 9.834 | 8.04 s | 933 |
| final | 16 | 9.766 | 8.11 s | 919 |
| final-nucleus09 | 16 | 9.785 | 7.85 s | 862 |
| minp-neutral | 16 | 9.795 | 8.50 s | 1032 |
| nucleus09 | 16 | 9.844 | 7.98 s | 1107 |
| nucleus1 | 16 | 9.668 | 8.00 s | 896 |
| repeat-low | 16 | 9.805 | 8.05 s | 943 |
| repeat-neutral | 16 | 9.639 | 7.81 s | 999 |
| temp005 | 16 | 7.939 | 7.05 s | 751 |
| temp025 | 16 | 7.607 | 7.06 s | 778 |
| topk40 | 16 | 9.834 | 8.02 s | 924 |
| topk80 | 16 | 9.648 | 7.78 s | 897 |

Input massimo nella validazione finale: 11508 token; output massimo: 943 token; nessuna risposta ha raggiunto il limite di 2048. Il contesto ordinario lascia quindi 2828 token oltre input misurato e intero budget di output. Il profilo complesso usa 32K senza impostare il massimo di 131K.

## Limiti della valutazione

I punteggi sono proxy riproducibili: presenza delle azioni nella detailed_description, prima riga del trigger, riferimenti inventati, attacchi sostitutivi riconoscibili, ordine e limite dei timestamp, contenuto delle sezioni e mancato raggiungimento del cap. Non sono una valutazione semantica indipendente e non provano assenza assoluta di allucinazioni. Reference continuity usa una posa descritta, senza immagini reali negli otto casi principali; gli altri casi ricevono valore neutro. La lettura delle risposte ha mostrato che un modello può usare la parola throw ma descrivere uno sbilanciamento, o avere timestamp ordinati con meccanica/audio incoerenti: questi limiti non vanno nascosti dietro un punteggio alto. Le aggiunte minori per lo staging sono ammesse dalla richiesta; sostituzioni di mosse e nuovi eventi no.

Il risultato è la migliore configurazione fra le prove effettuate, non una garanzia universale. Il baseline e il finale differiscono sia nel contratto di prompting sia nei sampler; le righe intermedie isolano i contributi. Le differenze piccole su 16 risposte non hanno significatività statistica dimostrata. I tempi dipendono da cache del prompt e carico GPU.

## CHANGES MADE e riproducibilità

- src/lm-studio-client.js: contratto H3, applicazione del profilo, controllo del contesto esistente e budget per clip finale.
- config/lm-studio-h3-inference.json e src/lm-studio-inference-profile.js: profilo del modello testato, validazione dei valori e vincolo alla quantizzazione.
- test/lm-studio-client.test.js: verifica contratto, profilo API e budget multisequenza.
- scripts/tune-h3-lm-studio.mjs: suite con richieste reali del client, capture del primo draft prima delle riparazioni, score e resume.
- scripts/search-h3-lm-studio.mjs e scripts/refine-h3-lm-studio.mjs: ricerca progressiva, decisioni e validazione finale.
- scripts/report-h3-lm-studio.mjs: questo report e riepilogo JSON.
- scripts/smoke-h3-lm-studio.mjs e scripts/smoke-h3-complex.mjs: integrazione webapp isolata e verifica reale del budget complesso.

Backup dei file preesistenti: tmp/lm-studio-tuning/backups. Richieste, risposte, stats, pose descritte, metadata e decisioni: tmp/lm-studio-tuning. Riepilogo versionabile: docs/LM_STUDIO_H3_TUNING_RESULTS.json. Nessuna modifica ai settings globali LM Studio.

La suite accetta H3_TUNING_OUTPUT per scrivere una nuova esecuzione in una cartella separata. Eseguire node scripts/tune-h3-lm-studio.mjs final con una cartella nuova per verificare il profilo installato; senza una cartella nuova riprende i record già completati.

## Verifiche di integrazione e attivazione

599/599 test unitari superati con node --test 'test/*.test.js', inclusi 50 controlli del client LM Studio. Il comando generale node --test ha inoltre individuato uno script di integrazione preesistente che richiede ComfyUI su 127.0.0.1:8188: quel controllo non è eseguibile mentre ComfyUI è offline.

Il nuovo codice è stato avviato su un'istanza webapp isolata, porta 3001: una richiesta HTTP reale al Prompt Assistant ha restituito 200, trigger BUNNY e cleanup del modello riuscito. I log LM Studio confermano temperature 0.15, top_p 1, top_k 40, min_p 0, repeat_penalty 1.05 e max_output_tokens 2048. L'istanza di test si è chiusa al termine; la webapp esistente non è stata interrotta.

Una richiesta finale PlagueKind ha verificato realmente il caricamento a 32768 token e il budget di 4096: completata in un solo draft da 521 token, sei sezioni presenti e nessun errore di unload. Evidenze: tmp/lm-studio-tuning/webapp-smoke.json e complex-smoke.json; queste due richieste aggiuntive non sono incluse nelle 288 generazioni della suite A/B.

Il controllo automatico ha rifiutato il riavvio del processo webapp principale con la sola motivazione 'blocked by policy'. I file sono aggiornati e il codice nuovo è verificato, ma il processo già aperto sulla porta 3000 conserva il codice precedente fino al riavvio. Per attivarlo, chiudere quel processo e avviare npm start dalla cartella del progetto. Nessun cambiamento manuale nel pannello LM Studio è necessario.
