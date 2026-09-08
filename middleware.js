// Vercel Edge Middleware — password gate per la demo The Bench
// Piano Hobby-compatible. Protezione SERVER-SIDE via Edge Runtime.
//
// Rotazione password:
//   1. Scegli nuova password (es. "NuovaPasswordSegreta")
//   2. Calcola SHA-256: echo -n "NuovaPasswordSegreta" | sha256sum
//   3. Sostituisci la costante H sotto
//   4. git commit && git push (Vercel redeploya)

export const config = {
  // Il middleware gira su tutto TRANNE: file statici, path Vercel interni.
  // /__gate deve girare qui (è l'endpoint di login).
  matcher: '/((?!_next|_vercel|.*\\.(?:png|jpg|jpeg|svg|ico|css|woff2?|json|xml|txt)$).*)',
};

// SHA-256 hex della password. Password attuale: "TheBench2026"
const H = '4a117b54e2f16d167ef2ec4576639f0a5275130e98238f1dfb336897beb6305a';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  });
  return out;
}

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function verify(pass) {
  if (!pass) return false;
  try { return (await sha256Hex(pass)) === H; } catch (e) { return false; }
}

function gatePage(err) {
  const errMsg = err ? '<div class="err">⚠ ' + err + '</div>' : '';
  return `<!DOCTYPE html>
<html lang="it"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>The Bench · Accesso riservato</title>
<style>
:root{--bg:#152441;--panel:#1c3055;--acc:#ffc42e;--txt:#f2f6fc;--dim:#93a8c9;--line:#33507f;--bad:#ff5d5d}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 800px at 20% 20%,rgba(255,196,46,.08),transparent 60%),linear-gradient(180deg,#0a1428 0%,var(--bg) 100%);color:var(--txt);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
.check{position:absolute;top:0;left:0;right:0;height:12px;background:repeating-conic-gradient(var(--acc) 0% 25%,#152441 0% 50%) 0/24px 24px;border-bottom:2px solid #0e1a30}
.box{max-width:400px;width:100%;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:32px 28px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
.logo{width:88px;height:88px;border-radius:50%;background:var(--acc);margin:0 auto 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 10px 30px rgba(0,0,0,.5)}
.logo b{display:block;font-weight:900;letter-spacing:1px;color:#152441;line-height:1;transform:skewY(-8deg)}
.logo b.big{font-size:20px;letter-spacing:-.5px;margin-top:3px}
h1{font-size:20px;text-align:center;margin:0 0 6px}
.sub{color:var(--dim);font-size:13px;text-align:center;margin-bottom:22px;line-height:1.5}
.field{margin-bottom:14px}
label{display:block;font-size:11.5px;color:var(--dim);margin-bottom:6px;letter-spacing:.3px;text-transform:uppercase}
input[type=password]{width:100%;padding:14px;border-radius:12px;background:#243c68;border:1px solid var(--line);color:var(--txt);font:inherit;font-size:15px;letter-spacing:2px}
input[type=password]:focus{outline:none;border-color:var(--acc);box-shadow:0 0 0 3px rgba(255,196,46,.2)}
button{width:100%;padding:14px;border-radius:12px;background:var(--acc);color:#152441;font-weight:800;font-size:14.5px;letter-spacing:.4px;border:none;cursor:pointer}
button:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(255,196,46,.35)}
.err{background:rgba(255,93,93,.1);border:1px solid rgba(255,93,93,.4);color:#ff9d9d;padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px}
.foot{font-size:11px;color:var(--dim);text-align:center;margin-top:20px;line-height:1.5}
.foot b{color:var(--acc)}
</style>
</head><body>
<div class="check"></div>
<form class="box" method="POST" action="/__gate">
<div class="logo"><b>THE</b><b class="big">BENCH</b></div>
<h1>Accesso riservato</h1>
<div class="sub">Contenuto in anteprima privata.<br>Inserisci la password ricevuta.</div>
${errMsg}
<div class="field"><label for="p">Password</label>
<input type="password" name="p" id="p" autofocus autocomplete="off" required></div>
<button type="submit">Entra</button>
<div class="foot">Contatta <b>Mattia De Vicaris</b> o <b>Salvatore Cuomo</b>.<br>Materiale coperto da NDA.</div>
</form>
</body></html>`;
}

export default async function middleware(req) {
  try {
    const url = new URL(req.url);
    const cookies = parseCookies(req.headers.get('cookie') || '');

    // Endpoint di login: POST /__gate
    if (url.pathname === '/__gate') {
      if (req.method === 'GET') {
        return new Response(gatePage(''), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
      if (req.method === 'POST') {
        const raw = await req.text();
        const pass = new URLSearchParams(raw).get('p') || '';
        if (await verify(pass)) {
          const headers = new Headers({ 'Location': '/' });
          headers.append(
            'Set-Cookie',
            'g=' + encodeURIComponent(pass) + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=86400'
          );
          return new Response(null, { status: 302, headers });
        }
        return new Response(gatePage('Password errata. Riprova.'), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
        });
      }
    }

    // Verifica cookie sessione
    const raw = cookies['g'] || '';
    const pass = raw ? decodeURIComponent(raw) : '';
    if (await verify(pass)) return; // autenticato → passa al file statico

    // Non autenticato → mostra il gate
    return new Response(gatePage(''), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  } catch (e) {
    // Fallback in caso di errore inatteso — mostra la pagina di gate
    return new Response(gatePage('Errore imprevisto: ' + (e && e.message ? e.message : String(e))), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
