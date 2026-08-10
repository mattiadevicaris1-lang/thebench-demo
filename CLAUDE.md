# CLAUDE.md — contesto progetto per Claude Code

Sistema di ordinazione da QR per **The Bench**, bar sport con ampio spazio esterno ad Agnano (Napoli). Locale nuovo con RT (registratore telematico) moderno.

---

## Il problema

Nelle sere di punta si forma una coda di 30–60 minuti al banco unico. La gente aspetta in piedi, al caldo, stretta. I clienti non tornano.

**L'obiettivo non è velocizzare la produzione** — un'app non aggiunge capacità al bar. L'obiettivo è **far aspettare il cliente seduto con i suoi amici**, guardando la partita, invece che in piedi in mezzo alla calca. Un'attesa di 40 minuti va benissimo se è dichiarata, visibile e onesta.

Tenere presente questo obiettivo in ogni scelta di design: se una feature riduce i minuti passati in piedi in coda, ha valore; se ottimizza altro, probabilmente no.

---

## Decisioni già prese (non riaprirle senza motivo)

### Autenticazione & onboarding
| Decisione | Perché |
|---|---|
| **QR unico** stampato ovunque, no QR per tavolo | Semplificazione operativa. Il cliente non è legato al tavolo — riceve un numero e ritira al banco. Una sola stampa, una sola grafica. |
| **PWA da QR code**, no app nativa | Zero attrito di installazione. Store review fuori scala. |
| **Guest checkout** (nome + email + cellulare) senza verifica bloccante | Ordine parte in 10 secondi. Il magic link tradizionale è troppo lento alle 23 in mezzo alla calca. |
| **OTP a 6 cifre via email al SECONDO accesso** | La CRM resta pulita ma il primo ordine non subisce attrito. Chi non conferma, al secondo ordine deve inserire il codice. |
| **Consenso marketing separato**, mai pre-spuntato | Obbligo GDPR + email di qualità. |

### Ordinazione & preparazione
| Decisione | Perché |
|---|---|
| **Nessuna conferma "ci sei ancora?"** — l'ordine parte al pagamento | Il flusso è più fluido, il cliente paga davvero solo se resta. Il rischio "cucino per un fantasma" è accettato in cambio di semplicità. |
| **Bibite abbinate al cibo** | Su ordine misto il cliente sceglie: bibite subito, o insieme al cibo. Nel secondo caso le righe bar restano `held` e la cucina le sblocca quando **mancano ~3 minuti**, non quando il cibo è pronto — altrimenti la pizza si fredda mentre lui aspetta la birra. |
| **Throttling per categoria** | Superata la capacità di coda, l'articolo va in sold-out automatico e l'ETA sale. Protegge la credibilità dell'ETA. |
| **ETA pessimista** | Meglio dichiarare 40 e consegnare a 30. Se sbagli per eccesso di ottimismo la gente si alza, va al banco, e la coda si riforma fatta di persone che hanno già ordinato. |
| **Aggiungi al mio ordine in corso** finché non è in `preparing` | Evita ricevute doppie e attese doppie per un ordine incrementato. |

### Sold-out durante preparazione
| Decisione | Perché |
|---|---|
| **Timer 60s + 3 opzioni** (sostituisci / rimuovi articolo / riapri menu) | Cliente in controllo, upsell possibile ("riapri menu"). |
| **Se non risponde: rimborso automatico SOLO dell'articolo esaurito** | Il resto dell'ordine prosegue normalmente. Mai annullare l'intero ordine per un solo articolo mancante. |

### Notifiche & display
| Decisione | Perché |
|---|---|
| **Display fisico come canale primario** | Su iOS le web push funzionano **solo** con PWA installata via "Aggiungi a Home". Nessuno lo farà alle 23. Basta una TV secondaria + Chromecast (~40€). |
| **Solo NUMERO sul display**, mai il nome | Privacy GDPR: mostrare "Ordine di Marco Rossi" è dato personale pubblico. |
| **Numero fullscreen nella webapp cliente + tab title dinamico** | Se il cliente resta con la app aperta, il numero è sempre a portata di sguardo. |
| **WhatsApp Business + Conduit** per notifiche opt-in | Costa ~0,005 €/msg dopo il free tier, funziona anche su iPhone bloccato. SMS solo se WhatsApp fallisce. |

### Pagamenti & cassa
| Decisione | Perché |
|---|---|
| **Se paga in app → salta la cassa** | Va DIRETTO al banco ritiro. È il vero guadagno del pagamento in app: bypassa il banco unico che è il collo di bottiglia. |
| **Un solo incasso per ordine** | Al primo banco raggiunto, per l'intero importo. Il secondo banco consegna e basta. |
| **Pagamento al ritiro nella beta** | Incassare in app richiede l'emissione del documento commerciale via RT: fuori dalla beta iniziale. |
| **Split pagamento in Fase 2** (dopo Stripe) | Pattern "ognuno paga la sua" per primo. Poi "in parti uguali". "Personalizzato" per ultimo. |

### Supporto & controllo
| Decisione | Perché |
|---|---|
| **Pulsante "Serve aiuto?"** nell'ordine attivo | Tre opzioni: 📞 chiama locale, 🚶 vai al banco, ⚠️ segnala problema con questo ordine. |
| **Pulsante "SOSPENDI ORDINI"** in admin | Rollback in un tap: nuovi ordini bloccati, ordini in corso completati normalmente. |
| **Feedback post-consegna** (rating + testo) | Nell'email di riepilogo o inline nella webapp. |

### Architettura app
| Decisione | Perché |
|---|---|
| **3 app distinte su domini separati** | `ordina.thebench.it`, `staff.thebench.it`, `display.thebench.it/[venue]`. Il codice staff non finisce nel bundle cliente. |
| **KDS bar e cucina = stessa app staff** | La stazione si sceglie al primo avvio del tablet e resta memorizzata. Route `/kds/[station]`. La cassa è un terzo profilo. |
| **5 ruoli nel JWT `app_metadata`** | `cliente`, `operatore`, `cassa`, `manager`, `bridge`. Immutabili lato client. |

---

## Vincoli tecnici da non violare

**Sicurezza = Row Level Security, non routing.** Mettere il KDS su `/kds` non protegge niente. Le policy Postgres decidono chi vede cosa. Il ruolo va in `app_metadata` del JWT, **mai** in `user_metadata` (modificabile dall'utente).

**Mai fidarsi dei prezzi dal client.** Il carrello invia solo `item_id` + quantità. Il server ricalcola tutto leggendo dal DB.

**Prezzi congelati sull'ordine.** Se il gestore cambia un prezzo mentre un ordine è in coda, quell'ordine mantiene il prezzo di quando è stato creato.

**Idempotency key obbligatoria.** Il client genera un UUID per ordine. Su Wi-Fi outdoor che cade, il retry non deve creare un secondo ordine.

**Websocket + polling di sicurezza ogni 10s.** Il websocket cade *in silenzio*: il tablet sembra vivo e non riceve più nulla. È il guasto peggiore perché nessuno se ne accorge. Serve anche indicatore di connessione a schermo e suono all'arrivo.

**Stato per singola riga d'ordine**, non solo per ordine. Un ordine con 2 birre e 1 pizza deve avere le birre pronte prima.

**Log in sola scrittura.** Nessuno può cancellare una riga, nemmeno il gestore.

**Giornata contabile alle 5:00**, non a mezzanotte. Colonna `business_date` scritta all'inserimento.

**Notifiche opt-in esplicito**. WhatsApp/SMS richiedono consenso specifico al numero, separato dal marketing.

---

## I 3 strati architetturali

Le decisioni si prendono a livelli distinti:

```
┌─────────────────────────────────────────────────────────────┐
│  1. APPLICAZIONI (che cosa scarichi)                         │
│     ordina.thebench.it  → PWA cliente pubblica              │
│     staff.thebench.it   → PWA staff (bar, cucina, cassa,    │
│                            manager, tutti dentro qui)        │
│     display.thebench.it/[venue] → TV in sala (no login)     │
├─────────────────────────────────────────────────────────────┤
│  2. UTENTI (chi sei) — ruolo nel JWT app_metadata           │
│     cliente · operatore · cassa · manager · bridge          │
├─────────────────────────────────────────────────────────────┤
│  3. DISPOSITIVI (dove sei)                                   │
│     ogni tablet iscritto a una stazione fissa               │
│     bar / cucina / cassa / display                          │
└─────────────────────────────────────────────────────────────┘
```

Un operatore bar è **utente `operatore` con stazione `bar`**, non un "utente bar". Stessa persona può coprire cucina senza secondo account.

**Sicurezza a 3 livelli difensivi (in ordine di importanza)**:
1. **RLS Postgres** — rifiuta le righe stesse, unica linea di difesa reale
2. **Edge Function** — valida token e ruolo prima di ogni query
3. **Frontend** — nasconde pagine a chi non ha il ruolo (solo UX)

---

## Modello dati

```sql
venues        (id, nome, aperto, ordini_sospesi, config_jsonb)
stations      (id, venue_id, nome, tipo)         -- 'bar' | 'cucina' | 'frigo'
categories    (id, venue_id, nome, station_id, ordine, prep_time_sec, max_queue)
items         (id, category_id, nome, descrizione, prezzo_cent, disponibile, allergeni[])
modifiers     (id, item_id, nome, delta_prezzo_cent)

profiles      (id, email, telefono, nome, role, stations[], venue_id, email_verified, wa_opt_in)
              -- role: cliente | operatore | cassa | manager | bridge

devices       (id, venue_id, tipo, station, nome, pin_hash, service_token, last_seen_at, active)
              -- tipo: kds | cassa | display | bridge

shifts        (id, operatore_id, device_id, opened_at, closed_at)

orders        (id, venue_id, numero_progressivo, business_date, user_id,
               stato, mode, totale_cent, idempotency_key,
               created_at, ready_at, collected_at, eta_sec)
               -- mode: 'subito' | 'insieme'
               -- stato: aperto | closed | cancelled

order_items   (id, order_id, item_id, qty, prezzo_unit_cent, modifiers_jsonb,
               station_id, stato)
               -- stato: held | preparing | ready | collected | refunded

payments      (id, order_id, metodo, provider, importo_cent, stato,
               provider_ref, fiscal_doc_ref, operatore_id, created_at)
               -- metodo: contanti | carta_pos | carta_online | applepay | googlepay | paypal

queue_state   (station_id, ordini_aperti, capacita_max, eta_corrente_sec)
audit_log     (id, venue_id, business_date, attore_id, device_id, tipo,
               entita, valore_prima, valore_dopo, testo, at)
support_tickets (id, order_id, tipo, testo, stato, created_at, resolved_at)
              -- tipo: problema_ordine | feedback | altro
```

**Note**:
- `numero_progressivo`: 3 cifre, per venue, resettato ogni giornata contabile (5:00). È il numero che il cliente legge sul display a 10 metri.
- Rimosso `table_id` da orders — non serve, il cliente non è legato al tavolo.
- Rimossi `asked_at`, `confirmed_at` — non c'è più conferma preventiva.
- `ordini_sospesi` in `venues`: flag per la pausa manuale del manager.

---

## Struttura repo

```
bench/
├── apps/
│   ├── cliente/   → ordina.thebench.it    PWA pubblica
│   ├── staff/     → staff.thebench.it     PWA sui tablet (kiosk mode)
│   └── display/   → display.thebench.it   PWA TV, no login
├── packages/
│   └── core/      → tipi, client Supabase, query, logica ETA e throttling
└── supabase/      → migrazioni, policy RLS, edge functions, seeds
```

**Stack:** Next.js 15 (App Router) + Tailwind su Vercel · Supabase (Postgres, Auth, Realtime, Edge Functions) · Resend per email transazionali · WhatsApp Business Cloud API + Conduit per notifiche · Stripe in Fase 2.

---

## Come si "vedono" le app (Realtime + RLS)

Un solo backend, tre frontend, connessione via websocket:

```
Cliente PWA          Staff PWA           Display TV
     │                    │                   │
     └────── Supabase Realtime ───────────────┘
              │
              ├── Postgres (source of truth)
              ├── Auth JWT (con role in app_metadata)
              ├── RLS policies (chi vede cosa)
              └── Edge Functions (create_order, mark_ready, ...)
                    │
                    └── Bridge fiscale Raspberry ──→ RT (LAN)
```

Ogni tablet apre un websocket con filtro: *"mandami modifiche solo per la MIA stazione"*. RLS Postgres rifiuta comunque le righe non di competenza — la separazione è imposta dal DB, non dall'URL.

---

## Stato attuale

Nessun codice reale scritto. Esiste `prototipo-demo.html`: **prototipo navigabile con tour guidato** che il proprietario può usare in dimostrazione. Contiene: landing QR animata, guest checkout, KDS bar/cucina, cassa (con distinzione "pagato in app" vs "da incassare"), display TV animato, backoffice con menu + log serata + sospensione ordini.

Il file precedente `prototipo-ordini.html` resta come riferimento originale.

I colori sono quelli del locale: navy `#152441`, giallo `#ffc42e`, fascia a scacchi giallo/nero (è sull'insegna).

---

## Prossimi passi, in ordine

**Fase 0 — Verifiche sul campo (2–3 giorni prima di scrivere codice)**
1. Sopralluogo tecnico: mappa Wi-Fi/4G + foto etichetta RT
2. Telefonata al tecnico della cassa: modello RT + API + POS collegato all'RT (normativa 2026)
3. Cronometraggio ciclo di servizio in ora di punta
4. Caffè con i ragazzi del banco (fondamentale per l'adozione)
5. Call col commercialista sull'emissione documento commerciale via app

**Fase 1 — Sviluppo pilota (~13 giorni)**
1. Setup monorepo, Supabase, 3 deploy Vercel — *1 gg*
2. Schema DB + RLS + ruoli (5 profili, devices, shifts) — *1,5 gg* — **test: cliente non legge ordini altrui**
3. App cliente: QR landing, guest checkout, menu, carrello, invio — *2 gg*
4. App staff: KDS bar/cucina realtime + setup tablet + PIN — *2 gg*
5. Timing bibite (held → sblocco) e doppio banco — *1 gg*
6. Cassa: distinzione pagato-in-app / da-incassare, consegna, display TV — *1 gg*
7. Backoffice: menu, prezzi, esaurito, log serata, **SOSPENDI ORDINI** — *1,5 gg*
8. Flow speciali: sold-out timer, "Serve aiuto?", aggiungi al mio ordine — *1,5 gg*
9. Robustezza: idempotenza, riconnessione, polling, annulli, stress test — *1,5 gg*

**Poi**: pilota su tutto il locale, menu ridotto, cocktail esclusi la prima sera, rollback SOSPENDI in un tap.

**Gate prima del pilota:** 5 persone ordinano insieme e stacchi il Wi-Fi per 30 secondi. Nessun ordine perso, nessuno duplicato. Test di carico con 200 ordini simultanei simulati.

**Fase 2 — Pagamenti in app (~2 settimane)**
- Stripe Checkout (carta + Apple Pay + Google Pay)
- Riconciliazione fine serata
- Split pagamento
- Integrazione RT/scontrino elettronico (dipende da strada scelta in Fase 0)

**Fase 3 — Fidelity + integrazione gestionale**
- Sconto benvenuto, fidelity 10 ordini = 1 gratis
- Integrazione col gestionale di cassa (API push / CSV notturno a seconda di cosa ha il locale)

---

## Questioni aperte (bloccanti per Fase 2)

- **Modello e marca del RT del locale** + se espone API cloud → decide strada scontrino (A bridge locale, B servizio cloud, C sostituzione RT)
- **Gestionale di cassa in uso** + se ha API → decide pattern integrazione (push realtime, CSV notturno, sostituzione)
- Copertura Wi-Fi/4G reale nell'area esterna → se non regge, il progetto non parte
- Conferma del commercialista sull'emissione del documento commerciale con incasso da app
- Titolarità del database clienti (il titolare del trattamento è il locale, serve nomina ex art. 28)
- POS collegato all'RT come da normativa 2026

---

## Documenti

- `prototipo-demo.html` — **prototipo navigabile con tour guidato** (specifica visiva del prodotto)
- `prototipo-ordini.html` — prototipo originale, tenuto come riferimento
- `docs/roadmap-operativa.md` — passi, tempi, gate, tre strade per lo scontrino
- `docs/architettura-tecnica.md` — realtime, RLS con esempi di policy, report, pagamenti, bridge fiscale
- `docs/MVP-ordini-the-bench-piano-7-giorni.md` — analisi iniziale (parzialmente superata dalla roadmap)
