# MVP Ordinazioni — The Bench (Agnano)
## Piano tecnico e specifiche a 7 giorni

---

## 0. Prima di tutto: il problema non è (solo) la fila

L'assunto implicito del progetto è "c'è la fila → togliamo la fila con l'app". Ma un'app non aggiunge capacità produttiva: se il bar riesce a fare 60 drink/ora, ne farà 60 anche con l'app. Se il collo di bottiglia è la *produzione*, l'ordina-in-app trasforma una fila fisica in una fila invisibile — e un cliente che aspetta 50 minuti guardando un timer sul telefono può incazzarsi **di più** di uno in fila, perché ha pagato in anticipo e non vede progressi.

Dove l'app crea valore reale è invece qui:

| Attività del banco | Tempo tipico | L'app la elimina? |
|---|---|---|
| Prendere l'ordine a voce, ripeterlo, correggerlo | 40–90 s/ordine | **Sì, del tutto** |
| Incasso, resto, POS, scontrino | 30–60 s/ordine | **Sì** (se paga in app) |
| Produzione drink / food | 60–300 s | No |
| Consegna e chiamata cliente | 20 s | Parzialmente |

In un locale outdoor affollato, **order-taking + incasso valgono spesso il 40–50% del tempo del personale al banco**. Rimuoverli può realisticamente aumentare la capacità del 30–60% *senza assumere nessuno*. Questo è il vero pitch da fare al gestore, non "l'app è comoda".

**Azione zero, da fare questo weekend, prima di scrivere una riga di codice:** vai al The Bench nell'ora di punta con un cronometro e conta per 20 minuti:
1. Quanti ordini escono dal banco (throughput reale).
2. Tempo medio dal "dimmi" al "pagato" (fase ordine+cassa).
3. Tempo medio di preparazione (fase produzione).
4. Composizione dello scontrino medio (% birre spina / bottiglia / cocktail / food).

Se il punto 2 vale >35% del ciclo, l'MVP è validato con numeri. Se vale <20%, il problema è la produzione e va risolto con un secondo punto di servizio, non con il software. **Sono 20 minuti che valgono l'intera settimana di sviluppo.**

---

## 1. Decisione di scope: cosa costruire davvero

Hai scelto "tutto, cocktail inclusi". È la scelta a impatto massimo ma anche quella che può far esplodere il pilota. La mediazione corretta non è tagliare prodotti dal menu, ma **differenziare la promessa per categoria**:

| Categoria | Flusso | Promessa al cliente |
|---|---|---|
| Food (pizza, fritti) | Ordina → notifica quando pronto → ritiro | "Ti avvisiamo, ~20 min" |
| Bevande no-prep (birra bottiglia, bibite, acqua, vino) | Ordina → **pronto quasi subito** → ritiro a sportello dedicato | "Pronto in 3 min, sportello B" |
| Birra alla spina | Ordina → coda bar → ritiro | "~8 min" |
| Cocktail | Ordina → coda bar con **capacità limitata** | "~15 min" (o *sold out temporaneo*) |

Il meccanismo chiave che salva il pilota è il **throttling**: ogni categoria ha un tetto di ordini in coda. Superato il tetto, l'articolo si mette automaticamente in "momentaneamente non disponibile" o l'ETA sale visibilmente. **Non si accettano ordini che non si è in grado di evadere.** È la singola feature che distingue un MVP che funziona da uno che genera 200 clienti arrabbiati con un ordine pagato.

L'apertura "sportello bevande fredde" è quasi un hack fisico più che software: un frigo, una persona, e il 40% degli ordini esce dalla coda principale in 30 secondi. Vale la pena proporlo al gestore *insieme* all'app.

---

## 2. Il nodo fiscale — va risolto per primo, non per ultimo

Questo è il punto che può bloccare tutto e nessuno se ne accorge fino al giorno 6.

In Italia il corrispettivo va certificato con **documento commerciale**, emesso tramite Registratore Telematico (RT) o tramite la procedura web gratuita "Documento Commerciale Online" dell'Agenzia delle Entrate. L'obbligo di memorizzazione e trasmissione telematica **si applica anche ai pagamenti tramite piattaforme e app** — non è un'area grigia. In più, dal 2026 è in vigore il regime di collegamento tecnico tra POS e RT, che rende ancora meno praticabile un incasso "fuori" dal registratore.

Tradotto: **non puoi incassare in app e "poi sistemiamo lo scontrino"**. Le opzioni realistiche, in ordine di fattibilità a 7 giorni:

**Opzione A — Pagamento in cassa con numero ordine (RACCOMANDATA per il pilota).**
Il cliente ordina dal QR, riceve un numero, si presenta in cassa, paga, l'operatore batte lo scontrino sul RT esistente selezionando l'ordine già composto. Zero problemi fiscali, zero integrazioni. Recupera comunque **tutto il tempo di order-taking** (la parte più lenta) e riduce la cassa a un gesto da 20 secondi. È il 70% del beneficio con il 10% del rischio.

**Opzione B — Pagamento in app + RT collegato via API.**
Serve un RT con API (Epson FP-81 II / Custom con protocollo di rete, RCH, ecc.) raggiungibile in LAN, a cui il backend invia il comando di stampa/emissione a pagamento confermato. Tecnicamente fattibile ma dipende **interamente** da quale registratore ha il locale e se è già in rete. Da verificare il giorno 1: se il modello non espone API, l'opzione muore.

**Opzione C — Documento Commerciale Online (AdE).**
Gratuito, ma la procedura va eseguita direttamente dall'esercente (non delegabile a intermediario) e non ha API pubbliche: è pensata per uso manuale a basso volume. **Non regge un venerdì sera.** Da escludere.

**Raccomandazione:** parti in Opzione A al pilota, con il codice già predisposto per l'Opzione B (interfaccia `PaymentProvider` astratta, stato `paid` disaccoppiato dal canale). Aggiungi il pagamento in app come fase 2, dopo che il flusso operativo è validato sul campo. E in ogni caso: **questa è una decisione da confermare con il commercialista del locale**, io non sono un consulente fiscale e la responsabilità dell'emissione resta dell'esercente.

---

## 3. Il nodo notifiche — la vibrazione che immagini non esiste (su iPhone)

Attenzione a un vincolo che rompe l'idea "il telefono vibra quando è pronto": su iOS le **web push funzionano solo se la PWA è stata installata via Safari → Condividi → Aggiungi a Home**. Un semplice tab aperto in Safari non ha accesso alla PushManager, e tutti i browser su iOS usano WebKit quindi la limitazione è identica ovunque. Chiedere a un cliente ubriaco alle 23:00 di installare una PWA è un attrito che nessuno supererà.

**Design corretto per l'MVP — notifica a tre livelli, in ordine di affidabilità:**

1. **Schermo di stato live (primario).** Dopo l'ordine il cliente resta su una pagina che si aggiorna in realtime (Supabase Realtime / websocket) con numero ordine, stato e ETA. Su Android e desktop, se accetta i permessi, aggiungi anche vibrazione + suono via Notification API quando la pagina è in foreground o il service worker è attivo.
2. **Display fisico alla zona ritiro (fondamentale).** Un monitor/TV con i numeri "IN PREPARAZIONE" e "PRONTO" in caratteri enormi. Costa 200€ e funziona per il 100% dei clienti, indipendentemente dal telefono. **Non è un ripiego: è il canale principale.** È il modello McDonald's e funziona da vent'anni.
3. **SMS/WhatsApp come fallback opzionale.** Solo per il food con attese >15 min, dove il cliente si allontana davvero. Costo ~0,04 €/SMS. Da valutare solo se il pilota mostra che serve.

Non progettare l'esperienza attorno alla push. Progettala attorno allo **schermo di stato + display fisico**, e tratta la push come un bonus per chi ce l'ha.

---

## 4. Architettura

Stack scelto per una sola ragione: massima velocità di consegna a 7 giorni con un team piccolo.

```
┌─────────────────────────────────────────────────────────┐
│  PWA CLIENTE (Next.js, no login)                        │
│  QR tavolo → menu → carrello → ordine → stato live      │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS + Supabase Realtime
┌────────────────────▼────────────────────────────────────┐
│  SUPABASE                                               │
│  Postgres • Realtime • RLS • Edge Functions • Storage   │
└──┬──────────────────┬──────────────────┬────────────────┘
   │                  │                  │
┌──▼──────────┐ ┌─────▼────────┐ ┌───────▼──────────────┐
│ KDS CUCINA  │ │ KDS BAR      │ │ DISPLAY RITIRO (TV)  │
│ tablet      │ │ tablet       │ │ numeri pronti        │
└─────────────┘ └──────────────┘ └──────────────────────┘
   │
┌──▼────────────────────────────────────────┐
│ CASSA / ADMIN (web)                        │
│ conferma pagamento • 86 articoli • ETA     │
└────────────────────────────────────────────┘
```

- **Frontend:** Next.js 15 (App Router) + Tailwind, deploy su Vercel. PWA con manifest e service worker, ma senza dipendere dalla push.
- **Backend/DB:** Supabase (già disponibile nel tuo setup). Postgres + Realtime per il live update degli stati, Row Level Security per isolare i dati, Edge Functions per la logica di creazione ordine e throttling.
- **Pagamenti (fase 2):** Stripe o Nexi/SumUp, dietro un'interfaccia astratta.
- **QR:** un QR per tavolo che porta a `/t/{codice_tavolo}` (per l'MVP il tavolo serve solo da contesto/analytics — la consegna resta a ritiro, che è più robusta del servizio al tavolo con un solo runner).

**Perché no app nativa:** store review + installazione = attrito e tempi fuori scala. Confermata la PWA.

---

## 5. Schema dati (essenziale)

```sql
venues        (id, nome, aperto, config_jsonb)
stations      (id, venue_id, nome, tipo)          -- 'bar' | 'cucina' | 'frigo'
categories    (id, venue_id, nome, station_id, ordine, prep_time_sec, max_queue)
items         (id, category_id, nome, descrizione, prezzo_cent,
               disponibile, sold_out_auto, allergeni[])
modifiers     (id, item_id, nome, delta_prezzo_cent)  -- es. "senza ghiaccio"

tables        (id, venue_id, codice, etichetta)

orders        (id, venue_id, numero_progressivo, table_id,
               stato, canale_pagamento, totale_cent,
               created_at, accepted_at, ready_at, collected_at,
               eta_sec, telefono_opz)
               -- stato: draft|placed|paid|accepted|preparing|ready|collected|cancelled

order_items   (id, order_id, item_id, qty, prezzo_unit_cent,
               modifiers_jsonb, station_id, stato)
               -- stato per riga: serve per ordini misti bar+cucina

queue_state   (station_id, ordini_aperti, capacita_max, eta_corrente_sec)
events        (id, order_id, tipo, payload, at)   -- audit + analytics
```

Due scelte non ovvie ma importanti:

- **Stato per singola riga d'ordine**, non solo per ordine. Un ordine con 2 birre + 1 pizza deve poter avere le birre pronte subito e la pizza dopo. Senza questo, o consegni tutto in ritardo (birra calda) o costruisci logiche di split a posteriori.
- **`numero_progressivo` per venue e per giornata**, a 3 cifre, resettato ogni notte. È il numero che il cliente urla al banco e che compare sul display. Deve essere corto e leggibile a 10 metri.

---

## 6. Flusso ordine (MVP, Opzione A)

```
1. Cliente scansiona QR → apre PWA (nessun login, nessun download)
2. Menu con ETA live per categoria + articoli in sold-out grigi
3. Aggiunge al carrello → "Ordina"
4. Chiede solo: nome/nickname (per il display) → crea ordine stato=placed
5. Schermata numero ordine grande + "Vai in cassa a pagare — coda: 2 persone"
6. Cassa: operatore cerca il numero, incassa, batte scontrino su RT → stato=paid
7. paid → l'ordine appare sui KDS di competenza (bar e/o cucina)
8. Ogni stazione segna "pronto" sulla propria riga
9. Tutte le righe pronte → stato=ready → display TV + notifica se disponibile
10. Ritiro → operatore segna collected (o auto-collected dopo 10 min)
```

Il **throttling** agisce al punto 3: se `queue_state.ordini_aperti >= capacita_max` per la stazione bar, i cocktail passano in sold-out automatico e l'ETA delle altre categorie sale. Il cliente vede la verità prima di ordinare, non dopo.

---

## 7. Piano giorno per giorno

Presuppone **2 persone** (1 full-stack + 1 che segue prodotto, contenuti menu e rapporto col locale). Con 1 persona sola, taglia il KDS separato bar/cucina e il display TV, e sposta il pilota a 10 giorni.

**Giorno 1 — Fondamenta e sblocco dei rischi**
- Sopralluogo al locale: modello di RT, copertura Wi-Fi/4G nell'area esterna, layout della zona ritiro, chi sta al banco.
- Decisione fiscale confermata (con il commercialista del locale).
- Setup repo, progetto Supabase, deploy pipeline Vercel, schema DB completo.
- **Gate:** se il Wi-Fi outdoor non regge, l'intero progetto è a rischio — verificare *oggi*. Un ordine che non parte perché non c'è campo è peggio della fila.

**Giorno 2 — Menu e PWA cliente (parte 1)**
- Caricamento menu reale con prezzi, categorie, stazioni, tempi di preparazione.
- Pagine: `/t/{codice}` → menu → dettaglio articolo → carrello. Stato locale, ancora senza backend.

**Giorno 3 — Ordini end-to-end**
- Edge Function `create_order` con validazione prezzi lato server (mai fidarsi del client), numerazione progressiva, calcolo ETA.
- Pagina stato ordine con Realtime.
- Logica throttling e sold-out automatico.

**Giorno 4 — KDS e cassa**
- Vista KDS per stazione: card grandi, tap per avanzare stato, ordinamento per anzianità, alert visivo oltre l'ETA.
- Vista cassa: ricerca per numero, conferma incasso, annullo ordine.
- Display TV: pagina fullscreen auto-refresh con "IN PREPARAZIONE" / "PRONTO".

**Giorno 5 — Robustezza (il giorno che tutti saltano e poi rimpiangono)**
- Gestione offline/riconnessione: se salta la rete a metà ordine, l'ordine non deve duplicarsi (idempotency key).
- Annullo, rimborso manuale, articolo esaurito a ordine già accettato.
- Rate limiting anti-ordine-scherzo (nessun login = nessuna barriera: limita per IP/device+tempo).
- Modalità degradata: pulsante "sospendi ordini" per il gestore, che chiude tutto in un tap.

**Giorno 6 — Test in condizioni reali**
- Simulazione con 5–10 persone che ordinano insieme, con il personale vero al banco.
- Formazione staff: 20 minuti, con una scheda plastificata a fianco dei tablet.
- Stampa QR (plastificati, resistenti a birra e umidità), cartelli "ORDINA DAL TELEFONO" ben visibili, segnaletica zona ritiro.

**Giorno 7 — Pilota controllato**
- **Non** aprire a tutto il locale. Attiva l'app su **una zona sola** (es. i tavoli esterni del lato X, 15–20 tavoli), con una persona dedicata che presidia il flusso e raccoglie feedback.
- Menu ridotto: food + bevande no-prep + birra spina. Cocktail **fuori dal pilota per la prima serata** — aggiungili la seconda, quando conosci i tempi reali.
- Rollback pronto: se qualcosa non va, si spegne e si torna al banco. Deve essere un tap.

---

## 8. Cosa NON costruire questa settimana

Elenco altrettanto importante di quello sopra. Ogni voce qui è una settimana risparmiata:

- Login/account cliente — il QR è l'identità
- Programma fedeltà, punti, promo
- Mance, split del conto, servizio al tavolo
- Integrazione con il gestionale/POS esistente
- Multi-lingua (aggiungi EN solo se il locale ha turisti veri)
- App nativa
- Pagamento in app (fase 2, dopo validazione fiscale)
- Dashboard analytics elaborata — bastano 4 numeri in una query

---

## 9. Metriche del pilota

Da misurare la prima sera, confrontate con la baseline raccolta al punto 0:

| Metrica | Come | Target pilota |
|---|---|---|
| Tempo ordine→pronto (mediana) | timestamp DB | < 12 min |
| Tempo ordine→ritiro | timestamp DB | < 15 min |
| Throughput ordini/ora | conteggio | ≥ baseline +25% |
| % clienti zona pilota che usano l'app | ordini app / coperti zona | > 40% |
| Ordini abbandonati al carrello | eventi | < 25% |
| Ordini mai ritirati | stato | < 3% |
| Reclami / interventi staff | tacca su foglio | < 5/sera |

Se l'adozione è sotto il 25%, il problema è la **comunicazione fisica** (cartelli, QR poco visibili, staff che non lo propone), non il software. È l'errore più comune in questi pilot.

---

## 10. Rischi principali

| Rischio | Impatto | Mitigazione |
|---|---|---|
| RT non integrabile / vincolo fiscale | Blocca il pagamento in app | Opzione A per il pilota; verifica al giorno 1 |
| Wi-Fi outdoor insufficiente | Blocca tutto | Verifica giorno 1; eventuale ripetitore |
| Push iOS non disponibile | Cliente non sa quando è pronto | Display fisico come canale primario |
| Bar in overload, coda invisibile | Clienti più arrabbiati di prima | Throttling + sold-out automatico + cocktail fuori dal primo pilota |
| Staff non collabora | Adozione a zero | Coinvolgere i ragazzi del banco **prima** di costruire: sono loro che devono proporlo |
| Ordini scherzo (no login) | Sprechi | Rate limit; con pagamento anticipato (fase 2) il problema sparisce |

Il rischio "staff" è quello che sottovaluti di più: un barista che vede l'app come un controllo sul suo lavoro la sabota passivamente in una sera. Vai a parlarci prima del giorno 1.

---

## 11. Costi indicativi (pilota)

| Voce | Costo |
|---|---|
| Supabase | 0 € (free tier sufficiente per il pilota) |
| Vercel | 0 € (hobby) → 20 €/mese pro |
| Dominio | ~12 €/anno |
| 2 tablet KDS (anche usati) | 200–400 € |
| TV/monitor zona ritiro | 150–250 € |
| QR plastificati + cartelli | ~80 € |
| **Totale hardware** | **~500–700 €** |

Il software a regime resta sotto i 50 €/mese fino a volumi molto alti. Con il pagamento in app si aggiunge ~1,5% + 0,25 € per transazione.

---

## Sintesi in tre righe

Costruisci una PWA da QR code, **senza login e senza pagamento in app**, che elimina la fase di order-taking (il vero collo di bottiglia) e sposta la comunicazione "è pronto" su un display fisico invece che su una push che su iPhone non arriverà. Metti il throttling per categoria dal giorno uno, altrimenti trasformi una fila fisica in una fila invisibile e peggiori il problema. Verifica il registratore telematico e il Wi-Fi outdoor il **primo giorno**: sono i due rischi che possono uccidere il progetto al giorno sei.

---

*Documento tecnico. Le indicazioni fiscali sono un orientamento basato su fonti pubbliche e vanno confermate con il commercialista dell'esercente, che resta il responsabile dell'emissione dei corrispettivi.*
