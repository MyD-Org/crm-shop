import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

const GATE_COOKIE = "site_gate";
const GATE_PATH = "/__gate";

function gateToken(user: string, pass: string) {
  return createHash("sha256").update(`${user}:${pass}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function proxy(request: NextRequest) {
  const user = process.env.SITE_AUTH_USER;
  const pass = process.env.SITE_AUTH_PASSWORD;

  // Sin credenciales configuradas, no se bloquea el acceso.
  if (!user || !pass) {
    return NextResponse.next();
  }

  const token = gateToken(user, pass);
  const cookie = request.cookies.get(GATE_COOKIE)?.value;

  if (cookie && safeEqual(cookie, token)) {
    return NextResponse.next();
  }

  if (request.method === "POST" && request.nextUrl.pathname === GATE_PATH) {
    const form = await request.formData();
    const reqUser = String(form.get("user") ?? "");
    const reqPass = String(form.get("pass") ?? "");

    if (safeEqual(reqUser, user) && safeEqual(reqPass, pass)) {
      const res = NextResponse.redirect(new URL("/", request.url), 303);
      res.cookies.set(GATE_COOKIE, token, {
        httpOnly: true,
        secure: request.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }

    return new NextResponse(gateHtml({ error: true }), {
      status: 401,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new NextResponse(gateHtml({ error: false }), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function gateHtml({ error }: { error: boolean }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="facebook-domain-verification" content="rlakqld8a1l4usoqjwmgo4yr1vsoln" />
<title>Central LED — Próximamente</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    height: 100%;
    margin: 0;
    background: radial-gradient(circle at 20% 20%, #16244d 0%, #0b1230 55%, #05081a 100%);
    color: #eef2ff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap {
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
  }
  .card { max-width: 460px; width: 100%; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(96, 165, 250, 0.12);
    border: 1px solid rgba(96, 165, 250, 0.35);
    color: #93c5fd;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    margin-bottom: 28px;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #60a5fa;
    box-shadow: 0 0 0 0 rgba(96,165,250,.6);
    animation: pulse 1.8s infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(96,165,250,.5); }
    70% { box-shadow: 0 0 0 10px rgba(96,165,250,0); }
    100% { box-shadow: 0 0 0 0 rgba(96,165,250,0); }
  }
  .logo {
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: #93c5fd;
    text-transform: uppercase;
    margin-bottom: 18px;
  }
  h1 {
    font-size: clamp(26px, 5vw, 38px);
    line-height: 1.15;
    margin: 0 0 16px;
    font-weight: 800;
    background: linear-gradient(90deg, #ffffff, #bfdbfe);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  p.lead {
    font-size: 16px;
    line-height: 1.6;
    color: #c7d2fe;
    margin: 0 auto;
    max-width: 400px;
  }

  .gate-trigger {
    position: fixed;
    bottom: 18px;
    right: 20px;
    border: none;
    background: none;
    color: #93c5fd;
    opacity: 0.25;
    font-size: 12px;
    letter-spacing: 0.05em;
    cursor: pointer;
    padding: 6px 8px;
    transition: opacity 0.15s ease;
  }
  .gate-trigger:hover { opacity: 0.7; }

  .gate-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(4, 7, 22, 0.72);
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 10;
  }
  .gate-overlay.open { display: flex; }

  .gate-modal {
    width: 100%;
    max-width: 340px;
    background: #0d1533;
    border: 1px solid rgba(148, 163, 253, 0.2);
    border-radius: 16px;
    padding: 28px;
    text-align: left;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: #93c5fd;
    text-transform: uppercase;
  }
  input {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid rgba(148, 163, 253, 0.25);
    background: rgba(15, 23, 65, 0.6);
    color: #eef2ff;
    font-size: 15px;
    outline: none;
  }
  input:focus {
    border-color: #60a5fa;
    box-shadow: 0 0 0 3px rgba(96,165,250,0.2);
  }
  button[type="submit"] {
    margin-top: 8px;
    padding: 13px 18px;
    border: none;
    border-radius: 10px;
    background: linear-gradient(90deg, #3b82f6, #60a5fa);
    color: white;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
  }
  button[type="submit"]:hover { filter: brightness(1.08); }
  .error {
    color: #fca5a5;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.35);
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
    margin-bottom: 4px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="logo">Central LED</div>
      <div class="badge"><span class="dot"></span>Próximamente</div>
      <h1>Estamos preparando algo nuevo</h1>
      <p class="lead">Nuestra tienda online está en construcción. Muy pronto vas a poder comprar acá.</p>
    </div>
  </div>

  <button type="button" class="gate-trigger" id="gate-trigger" aria-label="Acceso equipo">···</button>

  <div class="gate-overlay${error ? " open" : ""}" id="gate-overlay">
    <div class="gate-modal">
      <form method="POST" action="${GATE_PATH}">
        ${error ? '<div class="error">Usuario o contraseña incorrectos.</div>' : ""}
        <label for="user">Usuario</label>
        <input type="text" id="user" name="user" autocomplete="username" required />
        <label for="pass">Contraseña</label>
        <input type="password" id="pass" name="pass" autocomplete="current-password" required />
        <button type="submit">Ingresar</button>
      </form>
    </div>
  </div>

  <script>
    var overlay = document.getElementById("gate-overlay");
    document.getElementById("gate-trigger").addEventListener("click", function () {
      overlay.classList.add("open");
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  </script>
</body>
</html>`;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|api/cron).*)",
};
