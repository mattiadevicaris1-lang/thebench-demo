# Roadmap operativa — sistema ordini The Bench

Passi concreti, in ordine, con tempi e criteri di uscita. Ogni fase ha un **gate**: se non lo superi, non passare alla successiva.

---

## FASE 0 — Verifiche sul campo (2–3 giorni, prima di scrivere codice)

Questi tre giorni valgono più di una settimana di sviluppo, perché scoprono i vincoli che altrimenti ti bloccano al giorno 6.

**Passo 1 — Sopralluogo tecnico al locale** *(mezza giornata)*
Porta un telefono e cammina in tutta l'area esterna misurando il segnale Wi-Fi e 4G, tavolo per tavolo. Fotografa il banco, la zona ritiro, l'etichetta del registratore telematico (marca + modello) e il gestionale di cassa.
→ *Output:* mappa copertura, modello RT, modello gestionale, foto layout.

**Passo 2 — Telefonata al tecnico della cassa** *(30 minuti)*
Tre domande: il modello RT espone API di rete (HTTP/XML o cloud)? è già collegato alla LAN? il POS attuale è collegato all'RT come richiesto dalla normativa 2026?
→ *Output:* fattibilità dell'integrazione fiscale (decide Fase 3), sblocca pagamenti in app.

**Passo 3 — Misurazione del ciclo di servizio** *(20 minuti in ora di punta)*
Cronometra: quanti ordini escono in 20 minuti, quanto dura la fase ordine+incasso, quanto la produzione, composizione dello scontrino medio.
→ *Output:* i numeri con cui convinci il gestore e con cui tari gli ETA.

**Passo 4 — Parla con i ragazzi del banco** *(un caffè)*
Sono loro che devono proporre l'app ai clienti. Se la vivono come un controllo, la sabotano passivamente e l'adozione resta a zero. Chiedi cosa li rallenta davvero.

**Passo 5 — Confronto col commercialista del locale** *(una call)*
Porta la domanda giusta: "se incassiamo tramite app, come e quando emettiamo il documento commerciale?". La risposta determina se la Fase 3 è un'integrazione RT locale o un servizio cloud.

**Passo 6 — Verifica del gestionale in uso** *(30 minuti)*
Che gestionale usa il locale (Scloby, Cassa in Cloud, TCPOS, iCassa, Passepartout…)? Ha API? Chi ci mette mano e per cosa (report, magazzino, fatturazione)? Decide il pattern di integrazione (push realtime / CSV notturno / niente).

> **GATE 0** — Procedi solo se: copertura di rete accettabile, modello RT identificato con esito API, gestore d'accordo sul pilota.

---

## FASE 1 — Il pilota completo (~13 giorni)

### Come si separano le app

Un solo repository, **tre applicazioni distinte**, un pacchetto condiviso:

```
bench/
├── apps/
│   ├── cliente/   → ordina.thebench.it     PWA pubblica, no install
│   ├── staff/     → staff.thebench.it      PWA installata sui tablet
│   └── display/   → display.thebench.it    PWA TV, no login
├── packages/
│   └── core/      → tipi, client Supabase, query, logica ETA
└── supabase/      → migrazioni SQL, policy RLS, edge functions
```

Perché tre app e non tre sezioni della stessa: il codice dello staff non finisce nel bundle scaricato dai clienti, l'autenticazione è diversa (guest checkout vs account nominativo con PIN), il display non richiede login. Il pacchetto `core` evita di duplicare tipi e query.

**La separazione bar/cucina non è una quarta app.** È la stessa app staff: al primo avvio scegli su quel tablet la stazione, la scelta resta memorizzata sul dispositivo, e l'app apre `/kds/bar` o `/kds/cucina`. Ogni tablet è iscritto solo alle righe della propria stazione. La cassa è un terzo profilo della stessa app.

La separazione è imposta dal database con le policy RLS, non dal frontend. Chi non ha il ruolo giusto nel JWT non vede le righe, punto.

### I passi

| # | Passo | Giorni | Output |
|---|---|---|---|
| 1 | Setup monorepo, progetto Supabase, 3 deploy Vercel, domini | 1 | Tre URL che rispondono |
| 2 | Schema DB + policy RLS + 5 ruoli + tabelle devices/shifts | 1,5 | Test: un cliente non legge ordini altrui |
| 3 | App cliente: QR landing, **guest checkout**, menu, carrello, invio | 2 | Ordine che arriva nel DB in 10 secondi |
| 4 | App staff: KDS bar/cucina realtime, setup tablet stazione + PIN | 2 | Ordine visibile in <1s sul tablet, tablet accedono con PIN |
| 5 | Timing bibite (held → sblocco "manca poco") e doppio banco | 1 | Flusso misto cibo+bevande completo |
| 6 | Cassa: distinzione pagato-in-app / da-incassare, consegna, display TV | 1 | Ciclo chiuso end-to-end |
| 7 | Backoffice: menu, prezzi, esaurito, log serata, **SOSPENDI ORDINI** | 1,5 | Il gestore lavora da solo, rollback in un tap |
| 8 | Flow speciali: sold-out timer 60s, "Serve aiuto?", aggiungi al mio ordine, OTP 2° accesso | 1,5 | I flow "gentili" che fanno la differenza |
| 9 | Robustezza: idempotenza, riconnessione, polling, annulli, **stress test 200 ordini** | 1,5 | Sopravvive a Wi-Fi che cade e a serata di punta |

**Il log della serata** (passo 7) va progettato bene fin da subito, perché non è ricostruibile a posteriori. Registra ogni evento con **cosa, chi, quando, da quale dispositivo**: cambio prezzo con valore prima/dopo, articolo messo in esaurito, prodotto aggiunto o eliminato, cambio parametri di coda, sospensione ordini attivata, e tutto il ciclo di vita di ogni ordine. Deve essere in **sola scrittura**: nessuno può cancellare una riga, nemmeno il gestore. Export CSV a fine serata.

**Il pulsante SOSPENDI ORDINI** (passo 7) è il paracadute: in un tap i nuovi ordini via app vengono bloccati (il cliente che apre il QR vede "ordini via app temporaneamente sospesi, ordina al banco"), mentre gli ordini in corso vengono completati normalmente. Va tracciato nel log con chi ha premuto e per quanto.

**Il flow sold-out** (passo 8) copre il caso di articolo che finisce durante la preparazione: notifica al cliente + timer 60s con tre opzioni (sostituisci con alternativa / rimuovi solo l'articolo / riapri menu per scegliere altro). Se non risponde in 60s → rimborso automatico solo dell'articolo mancante, il resto dell'ordine prosegue.

> **GATE 1** — Prima del pilota: 5 persone ordinano insieme con lo staff vero al banco, e stacchi il Wi-Fi per 30 secondi in mezzo. Se nessun ordine si perde e nessuno si duplica, sei pronto. In più stress test simulato con 200 ordini nell'ora.

**Pilota:** menu ridotto, cocktail esclusi la prima sera, una persona dedicata a presidiare, rollback SOSPENDI in un tap se qualcosa esplode.

---

## FASE 2 — Pagamenti in app (~2 settimane, dopo il pilota)

### Cosa integrare, in ordine

**Step 1 — Stripe Checkout** *(3 giorni)*
Il backend crea una sessione per ogni ordine con il totale calcolato lato server, il cliente paga, un webhook conferma. Stripe porta dentro anche **Apple Pay e Google Pay**, che al bar sono ciò che la gente usa davvero: due tap, niente carta in mano. Copre da solo la quasi totalità del pagamento digitale.
Include: gestione rimborso, pagamento fallito, timeout.

**Step 2 — Split del pagamento** *(3 giorni)*
Tre modalità in ordine di priorità:
1. **Ognuno paga la sua** — ogni persona ha il suo carrello, ordine unico che parte quando tutti hanno saldato
2. **In parti uguali** — totale/N, N link condivisibili
3. **A quote personalizzate** — ognuno dice quanto paga

Timeout 5 minuti: se non tutti pagano, il primo pagante decide se saldare la differenza o annullare.

**Step 3 — Notifiche WhatsApp con Conduit** *(2 giorni)*
Setup WhatsApp Business Cloud API + Conduit per automazione. Template approvati per: ordine ricevuto, ordine pronto, ordine consegnato. Il cliente attiva il canale in checkout con checkbox opzionale.

**Step 4 — Riconciliazione** *(2 giorni)*
La parte noiosa che nessuno preventiva: a fine serata i totali dell'app devono quadrare con Stripe, con il POS e con la cassa. Serve una pagina che mostri le differenze e permetta di annotarle. Senza questo, il gestore smette di fidarsi entro due settimane.

**Contanti restano sempre**, e vanno registrati in app dalla cassa per far quadrare il report.

Struttura dati unica per tutti i metodi:

```sql
payments (id, order_id, metodo, provider, importo_cent,
          stato, provider_ref, fiscal_doc_ref, created_at, operatore_id)
-- metodo: contanti | carta_pos | carta_online | applepay | googlepay | paypal
```

---

## FASE 3 — Scontrino fiscale: tre strade, scegline una

Questa è la decisione che vale settimane. Non sceglierla per gusto tecnico ma in base a cosa ti ha detto il tecnico della cassa nella Fase 0.

### Strada A — Bridge locale verso il registratore esistente
Un mini PC o Raspberry sempre acceso nel locale fa da ponte tra il tuo backend cloud e l'RT sulla LAN (che da internet non è raggiungibile). Deve avere coda persistente, retry se la stampante è offline, e allarme al gestore se si blocca.
**Tempo: 2–3 settimane.** **Costo: ~80 € hardware.**
*Quando ha senso:* l'RT del locale espone API di rete e resta quello che c'è.

### Strada B — Servizio cloud di scontrino elettronico via API
Alcuni fornitori (Fiscal API, Custom Cloud, Epson Cloud) offrono emissione del documento commerciale via API senza bridge né hardware aggiuntivo.
**Tempo: 3–5 giorni di integrazione.**
*Attenzione:* cambia il setup fiscale dell'esercente, va valutata col commercialista **prima** di scriverci codice sopra.

### Strada C — Cambiare l'RT con uno cloud-native
RCH Cloud o Epson FP-90III con moduli cloud partono da ~500€, si ammortizzano rapidamente e sbloccano lo scontrino digitale via API in modo pulito.
**Tempo: 1 settimana + costo RT.**
*Quando ha senso:* il locale è disposto a investire per semplificare tutto.

### Strada D — Restare al pagamento al ritiro (beta)
Nessuna integrazione fiscale: il documento lo emette la cassa come oggi, quando il cliente ritira e paga.
**Tempo: zero.**
*Quando ha senso:* se il pilota mostra che ordini via app + display risolvono già la coda, il pagamento in app diventa un miglioramento di comodità, non una necessità immediata.

### Una domanda onesta da porsi qui

Ordini e KDS sono la parte dove costruisci qualcosa di specifico per questo locale. **Pagamento e scontrino sono la parte commodity**. Prima di spendere tre settimane sul bridge fiscale, vale la pena valutare se il gestionale esistente non copra già quel pezzo. Costruire ha senso quando ti differenzia; qui non ti differenzia.

---

## FASE 4 — Fidelity + integrazione gestionale (opzionale)

- **Sconto benvenuto**: -1€ o prodotto omaggio sul primo ordine (per adozione)
- **Fidelity**: "10 birre = 1 gratis" attivabile dopo 3 mesi di dati
- **Integrazione gestionale di cassa**: dipende da cosa ha il locale
  - CSV notturno se il gestionale è passivo (contabilità/commercialista)
  - Push via API se il gestionale è attivo (magazzino/reportistica realtime)
  - Sostituzione con gestionale integrato se il locale è pronto

---

## Riepilogo tempi

| Fase | Durata | Cumulativo |
|---|---|---|
| 0 — Verifiche sul campo | 2–3 gg | settimana 1 |
| 1 — Pilota completo (3 app + robustezza) | 13 gg | settimana 4 |
| 1b — Correzioni post-pilota | 3–5 gg | settimana 5 |
| 2 — Pagamenti in app + WhatsApp + riconciliazione | 10 gg | settimana 7 |
| 3 — Scontrino (strada A) | 15 gg | settimana 10 |
| 3 — Scontrino (strada B/C) | 4–7 gg | settimana 8 |
| 4 — Fidelity + gestionale | 5–8 gg | settimana 9–11 |

**Dal via al pilota in campo: circa 4 settimane.** Dal via a un sistema completo con pagamento in app e scontrino: **7–10 settimane** a seconda della strada fiscale.

I "7 giorni" iniziali restano validi solo per una demo. Per qualcosa che regge un venerdì sera di agosto e non fa passare il gestore per pagliaccio, il numero onesto è quattro settimane.

---

## Le tre cose da fare domani

1. Vai al locale in ora di punta con un cronometro e fai il Passo 3. Venti minuti.
2. Fotografa l'etichetta del registratore di cassa **e del gestionale in uso**, poi chiama il tecnico.
3. Offri un caffè ai ragazzi del banco e chiedi cosa li rallenta.

Nessuna delle tre richiede codice, e tutte e tre cambiano il progetto.
