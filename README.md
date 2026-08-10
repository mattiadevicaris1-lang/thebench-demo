# The Bench — Demo interattiva del sistema ordini

Prototipo navigabile per **The Bench**, bar sport ad Agnano (Napoli). Sistema di ordinazione da QR pensato per eliminare la coda al banco unico nelle serate di punta.

## 🚀 Provalo subito

**Demo live**: [https://mattiadevicaris1-lang.github.io/thebench-demo/](https://mattiadevicaris1-lang.github.io/thebench-demo/)

Apri il link, il tour guidato parte da solo in 7 tappe (5 minuti). Poi puoi esplorare libero cambiando ruolo dalla barra in alto.

## Cosa vedi

Un'unica webapp che simula **tutti i ruoli** del sistema:

| Ruolo | Cosa fa |
|---|---|
| 📱 **Cliente** | Inquadra QR, ordina, riceve il numero, aspetta seduto |
| 🍹 **KDS Bar** | Vede solo le bibite, con suono all'arrivo di nuovi ordini |
| 🍕 **KDS Cucina** | Vede solo il cibo, sblocca le bibite quando "manca poco" |
| 💶 **Cassa / Ritiro** | Distingue chi ha pagato in app da chi paga adesso |
| 📺 **Display** | Il monitor in sala con numeri ordini pronti |
| ⚙️ **Gestore** | Backoffice: menu, log serata, report, sospendi ordini (PIN `1234`) |

## Feature chiave da provare

- **Tour guidato** in alto (parte da solo, o "🎬 Tour guidato" nell'hint bar)
- **Guest checkout** senza attesa (10 secondi al primo ordine)
- **"🔄 Simula 2° accesso"** dal QR landing → OTP a 6 cifre
- **"➕ Aggiungi al mio ordine"** senza doppia ricevuta (dall'ordine attivo)
- **"🆘 Serve aiuto?"** dall'ordine attivo → chiama / vai al banco / segnala
- **"⚠️ Un articolo è esaurito"** dal KDS → cliente riceve modal con countdown 60s e 3 opzioni
- **"⏸ SOSPENDI ORDINI"** dal backoffice → rollback in un tap
- **📊 Report serata** dal backoffice → KPI, top articoli, picchi orari
- **🔧 Reset device** dal backoffice → mostra il flusso di setup tablet (scelta stazione + PIN)

## Documenti

- [CLAUDE.md](CLAUDE.md) — contesto completo del progetto (decisioni, vincoli, schema DB, prossimi passi)
- [docs/roadmap-operativa.md](docs/roadmap-operativa.md) — piano operativo in 4 fasi
- [docs/architettura-tecnica.md](docs/architettura-tecnica.md) — realtime, RLS, pagamenti, bridge fiscale

## Stack previsto per la produzione

Il prototipo è un file HTML singolo per la demo. La produzione userà:

- **Next.js 15** su Vercel (3 app: cliente, staff, display)
- **Supabase** — Postgres + Auth + Realtime + Edge Functions + Row Level Security
- **Stripe** per pagamenti online (Apple Pay + Google Pay inclusi)
- **WhatsApp Business Cloud API** + Conduit per notifiche
- **Resend** per email transazionali
- **Bridge Raspberry Pi** per registratore telematico

## Sviluppato per

The Bench — bar sport ad Agnano (Napoli).
Prototipo di design, non ancora in produzione.

---

*I colori sono quelli del locale: navy `#152441` + giallo `#ffc42e` + fascia scacchi (l'insegna).*
