# Architettura tecnica — sistema ordini The Bench

Risposte operative a: come si separano le tre app, come viaggiano gli ordini, come funzionano i flussi chiave, come si emette lo scontrino, come si gestiscono i pagamenti.

---

## 1. I 3 strati architetturali

Le decisioni si prendono a livelli distinti, non uno solo. È la parte che di solito viene confusa e crea buchi di sicurezza.

```
┌─────────────────────────────────────────────────────────────┐
│  1. APPLICAZIONI (che cosa scarichi)                         │
│     ordina.thebench.it       → PWA cliente pubblica         │
│     staff.thebench.it        → PWA staff (KDS + cassa)      │
│     display.thebench.it/[v]  → TV in sala (no login)        │
├─────────────────────────────────────────────────────────────┤
│  2. UTENTI (chi sei) — ruolo nel JWT app_metadata           │
│     cliente · operatore · cassa · manager · bridge          │
├─────────────────────────────────────────────────────────────┤
│  3. DISPOSITIVI (dove sei)                                   │
│     ogni tablet iscritto a una stazione fissa               │
│     bar / cucina / cassa / display                          │
└─────────────────────────────────────────────────────────────┘
```

Un operatore bar è **utente `operatore` con stazione `bar`**, non un "utente bar". Stessa persona può coprire la cucina senza secondo account.

---

## 2. Come le tre app si "vedono" mantenendosi separate

**Un solo backend Supabase, tre frontend, connessione via websocket.**

```
Cliente PWA          Staff PWA           Display TV
     │                    │                   │
     └────── Supabase Realtime ───────────────┘
              │
              ├── Postgres (source of truth)
              ├── Auth JWT (role in app_metadata, immutabile lato client)
              ├── RLS policies (chi vede cosa, decide il DB)
              └── Edge Functions (create_order, mark_ready, ...)
                    │
                    └── Bridge fiscale Raspberry ──→ RT (LAN)
```

Nessuna app "chiama" un'altra app. Si "annusano" tutte tramite Supabase Realtime. Quando un cliente ordina:

```
1. Cliente preme "Invia"                          [ordina.thebench.it]
      ↓ HTTPS POST
2. Edge Function create_order                     [supabase]
      ↓ ricalcola totale da DB, INSERT
3. Postgres logical replication → Realtime
      ↓ websocket push simultaneo a:
4. Tablet KDS bar     (se righe bar)              [staff.thebench.it]
   Tablet KDS cucina  (se righe cucina)           [staff.thebench.it]
   Telefono cliente   (stato ordine live)         [ordina.thebench.it]
   TV display         (quando passa a ready)      [display.thebench.it]
5. Tutti aggiornano la UI in <1 secondo
```

Lato tablet sono poche righe:

```js
supabase.channel('kds-bar')
  .on('postgres_changes',
      { event:'*', schema:'public', table:'order_items', filter:'station_id=eq.bar' },
      payload => aggiornaSchermo(payload))
  .subscribe()
```

**Le tre cose che fanno la differenza tra un KDS che funziona e uno che ti fa perdere ordini:**

- **Polling di sicurezza ogni 10 secondi**, in aggiunta al websocket. Su una rete Wi-Fi outdoor la connessione cade e a volte cade *in silenzio*: il tablet sembra vivo ma non riceve più nulla. È il guasto peggiore possibile, perché nessuno se ne accorge finché non arriva un cliente incazzato. Il polling lo copre.
- **Indicatore di connessione a schermo**, un pallino verde/rosso.
- **Suono all'arrivo di un ordine nuovo** e schermo sempre acceso (wake lock + alimentazione fissa).

---

## 3. Sicurezza a 3 livelli difensivi

In ordine di importanza reale:

1. **RLS Postgres** — l'unica linea che conta. Rifiuta le righe stesse.
2. **Edge Function** — valida token e ruolo prima di ogni query.
3. **Frontend** — nasconde pagine a chi non ha il ruolo (solo UX, non protegge).

Il punto centrale: **non è questione di URL diversi.** Mettere il KDS su `/kds` non protegge niente, chiunque può digitarlo. Anche se un cliente trovasse l'indirizzo, senza il ruolo giusto nel JWT vedrebbe una pagina vuota — perché è il database a rifiutare le righe.

**Tre identità principali** (più bridge e display):

| Chi | Come si autentica | Cosa può fare |
|---|---|---|
| Cliente | Guest checkout (nome+email+cellulare, no verifica bloccante), OTP email al 2° accesso | Crea ordini; legge solo i propri |
| Staff (bar, cucina, cassa) | Login email+password una volta, poi PIN 4 cifre per tablet | Legge e aggiorna ordini del venue, limitato alla stazione |
| Manager | Come staff + ruolo `manager` | Tutto: menu, prezzi, sold-out, report, log, SOSPENDI ORDINI |
| Bridge fiscale | Service account con token long-lived | Legge solo pagamenti da emettere, scrive fiscal_doc_ref |
| Display | Nessun login, URL con venue_id | Legge solo ordini in stato `ready` |

Policy RLS di esempio:

```sql
-- il cliente vede solo i suoi ordini
create policy cliente_legge on orders for select
  using (user_id = auth.uid());

-- il cliente crea ordini solo per sé
create policy cliente_crea on orders for insert
  with check (user_id = auth.uid());

-- lo staff vede tutto il proprio venue
create policy staff_legge on orders for select
  using (venue_id = (auth.jwt() -> 'app_metadata' ->> 'venue_id')::uuid
         and (auth.jwt() -> 'app_metadata' ->> 'role') in ('operatore','cassa','manager'));

-- solo cassa e manager cambiano pagamenti
create policy paga_solo_cassa on payments for update
  using ((auth.jwt() -> 'app_metadata' ->> 'role') in ('cassa','manager'));

-- il display vede solo ordini ready del suo venue (via token URL, non JWT)
create policy display_vede_ready on orders for select
  using (stato = 'aperto' and venue_id = current_setting('app.display_venue')::uuid);
```

Il ruolo va messo in `app_metadata` del JWT, **non** in `user_metadata`: il secondo è modificabile dall'utente, il primo no. È l'errore classico che apre il sistema a chiunque.

Due accorgimenti pratici sui tablet: PIN a 4 cifre per rientrare se lo schermo si blocca, modalità chiosco del browser così nessuno può navigare altrove.

---

## 4. I flussi chiave

### 4.1 Guest checkout + OTP lazy

Il primo ordine non deve subire attrito. La verifica avviene solo al secondo accesso.

```
PRIMO ORDINE (guest checkout, ~10 secondi)
────────────────────────────────────────────
1. Cliente inquadra QR → ordina.thebench.it
2. Menu subito visibile
3. Aggiunge al carrello
4. Checkout: nome + email + cellulare + ☐ marketing (opt-in)
5. Ordine parte, torna il numero + ETA
6. Email di conferma arriva col codice OTP a 6 cifre (facoltativo cliccare)

SECONDO ORDINE (verifica lazy)
────────────────────────────────────────────
1. Cliente inquadra QR → app riconosce email/cellulare
2. "Bentornato Mario!"
3. Se ha già confermato (cliccato o inserito OTP): dentro, ordina subito
4. Se NON ha confermato:
   → "Prima di continuare, inserisci il codice a 6 cifre che ti abbiamo mandato"
   → [ _ ][ _ ][ _ ][ _ ][ _ ][ _ ]   [Reinvia codice]
   → Inserito → email confermata → dentro per sempre
```

Il codice OTP ha validità 15 minuti. La CRM resta pulita entro 2 ordini per cliente.

### 4.2 Sold-out durante preparazione

Quando un articolo va esaurito mentre un ordine è in `preparing`:

```
1. Notifica al cliente in app + banner al display
2. Timer 60 secondi con tre opzioni:
   [🔄 Sostituisci con...]  ← suggerimenti automatici stessa categoria
   [❌ Rimuovi dall'ordine]  ← rimborso solo di quell'articolo
   [➕ Riapri menu e scegli altro]

3. Se non risponde in 60s:
   → Rimborso automatico SOLO dell'articolo esaurito
   → Il resto dell'ordine prosegue normalmente
   → Notifica: "Ti abbiamo rimborsato la Ichnusa (esaurita). Il resto è in preparazione."
```

Il pulsante "sold-out ora" sul KDS mostra il numero di ordini pendenti su quell'articolo prima di confermare, così il barista sa la portata.

### 4.3 Sospensione ordini (rollback in un tap)

Nel backoffice `/admin/operazioni`:

```
[⏸ SOSPENDI ORDINI DA APP]

Quando premuto:
- venues.ordini_sospesi = true
- Chi apre il QR vede: "Ordini via app temporaneamente sospesi.
  Ordina al banco, ci scusiamo."
- Ordini in corso: completati normalmente
- KDS, cassa, display: continuano a funzionare

[▶ RIATTIVA ORDINI]  ← un tap per tornare online
```

Log automatico con chi ha premuto quando e per quanto è durata la pausa.

### 4.4 Se paga in app, salta la cassa

```
                    ┌─── pagato in app ──→  va DIRETTO al banco ritiro
Cliente ordina ─────┤
                    └─── non pagato    ──→  passa PRIMA in cassa, poi al banco
```

Sui KDS ritiro (bar/cucina) l'ordine mostra chiaramente lo stato pagamento:
- 💳 **PAGATO** (badge verde) → operatore vede "Consegna" grande
- 💶 Da incassare → operatore vede "Incassa X€ e consegna"

Un solo incasso per ordine, al primo banco raggiunto.

---

## 5. Notifiche cliente — canali complementari

**Nessun singolo canale copre tutti i clienti.** Servono in combinazione.

| Canale | Costo | Copertura | Uso |
|---|---|---|---|
| **Display TV in sala** | ~40€ una tantum | Tutti, sempre | Primario, mostra solo il numero (no nome, GDPR) |
| **Numero fullscreen webapp** | 0 | Chi tiene la app aperta | Rinforzo visivo diretto |
| **Tab title dinamico** | 0 | Idem sopra | `🔔 #043 PRONTO` visibile in altre tab |
| **WhatsApp opt-in via Conduit** | ~0,005 €/msg (utility) | Chi opt-in | Notifica istantanea anche a iPhone bloccato |
| **Email riepilogo post-consegna** | ~0€ (Resend) | Tutti | Cortesia + link scontrino digitale |
| **SMS via Skebby** | ~0,04 €/msg | Chi non ha WhatsApp | Solo come fallback |

Stima costi WhatsApp con 200 ordini/sera, 30% opt-in, 2 msg/ordine: **~78 €/mese all'apice** (dopo il free tier di 1000 messaggi Meta).

Setup Conduit: template approvati per "ordine ricevuto", "ordine pronto", "ordine consegnato". Il template attivato al passaggio di stato via edge function.

---

## 6. Report giornaliero

È una query, non un modulo da costruire. Serve però una precauzione: **la giornata contabile non finisce a mezzanotte.** Un locale che chiude alle 2:30 avrebbe gli ordini spalmati su due date. Si risolve scrivendo una colonna `business_date` al momento dell'inserimento, con cambio giornata alle 5:00.

La pagina `/admin/report` mostra:

- Incasso totale, e **suddiviso per metodo** (contanti / carta POS / online / app) — è il numero che il gestore confronta con la cassa a fine serata
- Numero ordini, scontrino medio, articoli venduti per categoria
- Tempo medio ordine→pronto e ordine→ritiro, **per stazione** (dice dove è il collo di bottiglia)
- Ordini annullati, non ritirati, sospensioni della serata
- Picchi orari (a che ora serve più personale)
- Export CSV per il commercialista

In più una **Edge Function schedulata alle 5:00** che genera il PDF e lo manda via email al gestore. Il report che arriva da solo viene letto; quello da andare a cercare, no.

Il report resta un dato gestionale: **non sostituisce la chiusura fiscale**, che la fa il registratore telematico con il suo invio giornaliero all'Agenzia delle Entrate.

---

## 7. Scontrino digitale — attenzione a non confondere due cose

Sono due oggetti diversi e vanno tenuti separati, altrimenti si crea un problema fiscale:

**a) Email di cortesia (facile, subito).** Riepilogo dell'ordine inviato dopo il ritiro: articoli, totale, orario. Serve al cliente e a te (è il momento naturale per chiedere una recensione). Si fa con Resend, mezza giornata di lavoro. **Non ha valore fiscale** e sull'email va scritto chiaramente.

**b) Documento commerciale digitale (fiscale).** Lo emette il registratore telematico. Molti RT moderni generano una copia digitale con QR code consultabile dal cliente. Il tuo bridge riceve `fiscal_doc_ref` (URL/QR) in risposta e lo salva in `payments`. Nell'email di cortesia aggiungi *"Documento commerciale ufficiale → [link]"*.

La regola da non violare: l'email di cortesia non deve *sembrare* uno scontrino. Niente "SCONTRINO FISCALE" in cima, niente partita IVA in evidenza, sì a "Riepilogo del tuo ordine".

---

## 8. Pagamenti

**In beta (settimana 1):** contanti + carta con POS mobile al banco ritiro. Zero integrazioni. Attenzione a un punto normativo: dal 2026 è in vigore l'obbligo di collegamento tecnico tra POS e registratore telematico.

**In Fase 2, cosa integrare davvero:**

| Metodo | Copertura reale | Costo | Sforzo |
|---|---|---|---|
| **Stripe** (carta + Apple Pay + Google Pay) | ~90% di chi paga digitale | ~1,5% + 0,25 € | 2–3 gg |
| Contanti al ritiro | resta necessario | 0 | già fatto |
| PayPal | pochi punti % in un locale | ~2,9% + 0,35 € | +2 gg (rimanda a data-driven) |
| **Split pagamento** (parti uguali / personalizzato) | pattern comune al bar | come Stripe | 3 gg |

Tre note contro-intuitive:

**Stripe copre già Apple Pay e Google Pay.** Al bar sono ciò che la gente usa davvero: due tap, niente carta, niente PIN.

**PayPal lo rimanderei.** Il costo non è l'integrazione, è tutto il resto: riconciliazione separata, rimborsi con flusso diverso, dispute con regole proprie. Aggiungilo quando i dati dicono che serve.

**I link di pagamento Stripe non vanno bene qui.** Servono per importi statici. La strada giusta è che il backend crei una Checkout Session per ordine.

Struttura dati unica:

```sql
payments (id, order_id, metodo, provider, importo_cent,
          stato, provider_ref, fiscal_doc_ref, created_at, operatore_id)
-- metodo: contanti | carta_pos | carta_online | applepay | googlepay | paypal
```

Con un'interfaccia `PaymentProvider` astratta lato codice: aggiungere PayPal poi diventa un file nuovo, non una riscrittura.

---

## 9. Il pezzo che nessuno prevede: il bridge locale per l'RT

Il registratore telematico sta sulla LAN del locale e **non è raggiungibile da internet**. Il tuo backend è nel cloud. Non possono parlarsi direttamente.

Serve un piccolo agente che gira **dentro** il locale — Raspberry Pi o mini PC sempre acceso — che si collega al backend Supabase, riceve i documenti da emettere e li invia alla stampante in HTTP/XML sulla rete locale.

```
Backend cloud  ──websocket──▶  Bridge locale (Raspberry Pi)
                                      │ HTTP/XML in LAN
                                      ▼
                          Registratore Telematico
```

Il bridge deve gestire: coda persistente (se la stampante è offline il documento non si perde), retry, allarme al gestore se qualcosa si blocca. È **1–2 settimane di lavoro**, ed è la ragione principale per cui il pagamento in app non entra nei primi giorni.

**Alternative** che eliminano il bridge:
- **Strada B**: servizio cloud di scontrino elettronico via API (Fiscal API, Custom Cloud, Epson Cloud)
- **Strada C**: sostituire l'RT con uno cloud-native (RCH Cloud, Epson FP-90III cloud)

Va valutato col commercialista dell'esercente, non scelto per comodità tecnica.

---

## 10. QR e link operativi

**Un solo QR fisico da stampare**: `https://ordina.thebench.it` — stampato in 30-40 copie plastificate (~30€ totali), messo su tavoli, banco, ingresso, menù. Il cliente non è legato al tavolo, riceve un numero e ritira al banco.

**Link runtime** (nessuna stampa):

| Link | A cosa serve | Chi lo apre |
|---|---|---|
| `ordina.thebench.it` | Ordinare | Cliente da QR o Instagram bio |
| `ordina.thebench.it/o/N043` | Aprire stato ordine | Cliente dall'email di riepilogo |
| `ordina.thebench.it/auth?token=XYZ` | Ritorno cliente riconosciuto | Cliente dalla mail conferma |
| `staff.thebench.it/setup?device=UUID` | Setup primo avvio tablet | Manager una volta per tablet |
| `staff.thebench.it/kds` | Uso quotidiano staff | Operatore dopo PIN |
| `display.thebench.it/venue/[id]` | Pagina TV | Manager una volta, resta aperta |

---

## 11. Stack completo e tempi

| Componente | Sistema | Costo |
|---|---|---|
| Frontend (3 app) | Next.js su Vercel | 0 → 20 €/mese |
| DB, Auth, Realtime, Functions | Supabase | 0 → 25 €/mese |
| Email transazionali | Resend | 0 → 20 €/mese |
| WhatsApp Business Cloud API | Meta + Conduit | ~78 €/mese all'apice |
| SMS fallback (opzionale) | Skebby (IT) | ~0,04 €/SMS |
| Pagamenti online | Stripe | 1,5% + 0,25 € |
| Bridge fiscale | Raspberry Pi 4 | ~80 € una tantum |
| QR stampati | Tipografia locale | ~30 € una tantum |

**Tempi realistici (1 sviluppatore full-time):**

| Blocco | Giorni |
|---|---|
| Schema DB + Auth + RLS + 5 ruoli + devices/shifts | 2,5 |
| App cliente (QR landing, guest checkout, menu, carrello, invio) | 2 |
| App staff (KDS realtime + setup tablet + PIN) | 2 |
| App display TV (con animazioni) | 0,5 |
| Cassa (distinzione pagato in app / da incassare) | 1 |
| Timing bibite + doppio banco | 1 |
| Backoffice (menu, log, SOSPENDI, report base) | 1,5 |
| Flow speciali (sold-out timer, "Serve aiuto?", aggiungi ordine, OTP 2°) | 1,5 |
| Robustezza (offline, idempotenza, annulli, stress test) | 1,5 |
| **→ PILOTA in campo** | **~13 gg** |
| Report giornaliero completo + email automatica | 1,5 |
| Email di cortesia + lista marketing | 1 |
| Stripe Checkout + Apple Pay + Google Pay + rimborsi | 3 |
| Split pagamento (3 modalità) | 3 |
| WhatsApp Business + Conduit + template | 2 |
| Bridge RT + emissione + casi limite (Strada A) | 8–10 |
| Riconciliazione, test fiscali, collaudo | 3–5 |
| **→ SISTEMA COMPLETO** | **~7–10 settimane** |

I "7 giorni" annunciati sono raggiungibili solo per una demo. Per qualcosa che regge un venerdì sera di agosto: **13 giorni per un pilota vero**, non 7 per un beta che si rompe al primo test di carico.

---

## Riassunto in sette righe

Una sola sorgente di verità (Supabase Postgres) alimenta tre PWA distinte tramite websocket Realtime, con separazione imposta dalle RLS e polling di sicurezza perché il Wi-Fi outdoor cade in silenzio. Il cliente entra con guest checkout in 10 secondi, la verifica email arriva lazy al secondo accesso via OTP a 6 cifre. Chi paga in app salta la cassa e va dritto al banco ritiro. Le notifiche sono display fisico (primario) + numero fullscreen in webapp + WhatsApp opt-in via Conduit (~78€/mese all'apice). Sold-out durante preparazione: timer 60s con opzioni sostituisci/rimuovi/riapri menu, rimborso automatico solo dell'articolo mancante. Il gestore ha SOSPENDI ORDINI in un tap come paracadute. Lo scontrino digitale via email è cortesia, quello fiscale lo emette il RT tramite bridge locale o servizio cloud.
