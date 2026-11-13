/**
 * Guardas anti-abuso de la compra del invitado (change `compra-como-invitado`, S2a). SOLO servidor.
 *
 * Es lo que corre en `POST /api/pedidos` cuando NO hay sesión, antes de tocar la cotización o la
 * base. Un anónimo puede crear pedidos (reservan stock y disparan mails), así que se lo filtra en
 * este orden, de lo barato a lo caro:
 *
 *  1. flag `compra-invitado` apagado => 401 idéntico al de hoy (nada cambia con el flag apagado);
 *  2. falta configuración (Turnstile o el secreto del pedido) => la compra sin cuenta no se ofrece
 *     (falla cerrada: nunca se crea un pedido que después no se pueda autorizar);
 *  3. origen del mismo sitio (`Sec-Fetch-Site` / `Origin`) y `Content-Type: application/json` => 403;
 *  4. cuerpo JSON;
 *  5. honeypot lleno o llenado más rápido de lo que tarda una persona => "éxito" falso: 201 sin crear
 *     nada ni mandar mails (el bot no aprende que lo detectamos);
 *  6. tope por IP: 5 por minuto y 10 por día (contador compartido entre instancias);
 *  7. email válido y escrito dos veces igual (normalizado: trim + minúsculas);
 *  8. atajo del reintento idempotente (lo resuelve la ruta: `atajo`), ANTES de Turnstile porque su
 *     token es de un solo uso y un reintento de red no podría volver a pasarlo;
 *  9. Turnstile (falla cerrada);
 * 10. tope de pedidos pendientes de pago por email (3 en 24 h): no reserva stock.
 *
 * Los límites son constantes ajustables (hay IPs compartidas por CGNAT: se dejó holgura).
 * Nada se guarda de la IP más allá del contador; los logs no llevan email ni IP.
 */
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { CAMPO_TRAMPA, llenadoValido } from "./arrepentimiento";
import { compraInvitadoHabilitada } from "./compra-invitado-flag";
import { normalizarEmail } from "./email-normalizado";
import { ipDelRequest } from "./ip-cliente";
import { MENSAJES_INVITADO } from "./invitado-mensajes";
import { pedidoTokenConfigurado } from "./pedido-token";
import { contarPendientesInvitado, formatearNumero } from "./pedidos";
import { permitirAsync } from "./rate-limit";
import { turnstileConfigurado, verificarTurnstile } from "./turnstile";

export const MAX_PEDIDOS_INVITADO_POR_MINUTO_IP = 5;
export const MAX_PEDIDOS_INVITADO_POR_DIA_IP = 10;
export const MAX_PENDIENTES_POR_EMAIL = 3;
export const VENTANA_PENDIENTES_MS = 24 * 60 * 60_000;

const MINUTO_MS = 60_000;
const DIA_MS = 24 * 60 * 60_000;

export { normalizarEmail };

export type CuerpoInvitado = Record<string, unknown>;

export type ResultadoGuarda =
  | { ok: true; body: CuerpoInvitado; email: string; ip: string | null }
  | { ok: false; respuesta: NextResponse };

/** ¿El POST viene de una página de este mismo sitio? Sin ninguna de las dos señales, no. */
export function origenDelMismoSitio(req: Request): boolean {
  const sitio = req.headers.get("sec-fetch-site");
  if (sitio) return sitio === "same-origin";
  const origen = req.headers.get("origin");
  if (!origen) return false;
  try {
    return new URL(origen).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

function esJson(req: Request): boolean {
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

const error = (mensaje: string, status: number, extra: Record<string, unknown> = {}, headers?: HeadersInit) =>
  NextResponse.json({ error: mensaje, ...extra }, { status, headers });

/** Respuesta para un bot: parece un pedido creado (misma forma, mismo status) y no crea nada. */
function exitoFalso(): NextResponse {
  return NextResponse.json(
    {
      id: randomUUID(),
      numero: formatearNumero(1_000 + Math.floor(Math.random() * 9_000)),
      repetido: false,
      cuotas: null,
      formaCobro: null,
      cuentaPago: null,
    },
    { status: 201 },
  );
}

export interface OpcionesGuarda {
  /**
   * Atajo del reintento idempotente: si devuelve una respuesta, se corta ahí (sin Turnstile ni tope).
   * Lo resuelve la ruta porque conoce la clave y la forma de la respuesta.
   */
  atajo?: (contexto: { body: CuerpoInvitado; email: string }) => Promise<NextResponse | null>;
}

export async function guardarCompraInvitado(req: Request, opciones: OpcionesGuarda = {}): Promise<ResultadoGuarda> {
  // 1. Flag apagado: el 401 de siempre.
  if (!(await compraInvitadoHabilitada())) {
    return { ok: false, respuesta: error("No autorizado", 401) };
  }

  // 2. Configuración: sin esto la compra sin cuenta no se ofrece (y no se crea nada).
  if (!turnstileConfigurado() || !pedidoTokenConfigurado()) {
    console.error("[/api/pedidos] compra de invitado sin configurar (falta TURNSTILE_SECRET_KEY o PEDIDO_LINK_SECRET)");
    return {
      ok: false,
      respuesta: error(MENSAJES_INVITADO.noDisponible, 503, { motivo: "invitado_no_disponible" }),
    };
  }

  // 3. Origen y tipo de contenido.
  if (!origenDelMismoSitio(req) || !esJson(req)) {
    return { ok: false, respuesta: error(MENSAJES_INVITADO.solicitudInvalida, 403) };
  }

  // 4. Cuerpo.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { ok: false, respuesta: error(MENSAJES_INVITADO.cuerpoInvalido, 400) };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, respuesta: error(MENSAJES_INVITADO.cuerpoInvalido, 400) };
  }
  const datos = body as CuerpoInvitado;

  // 5. Honeypot y tiempo de llenado: éxito aparente.
  const trampa = datos[CAMPO_TRAMPA];
  if (typeof trampa === "string" && trampa.trim() !== "") return { ok: false, respuesta: exitoFalso() };
  const iniciado = typeof datos.iniciado === "number" ? String(datos.iniciado) : datos.iniciado;
  if (!llenadoValido(typeof iniciado === "string" ? iniciado : null, Date.now())) {
    return { ok: false, respuesta: exitoFalso() };
  }

  // 6. Tope por IP.
  const ip = ipDelRequest(req);
  const claveIp = `pedidos-inv:ip:${ip ?? "desconocida"}`;
  if (
    !(await permitirAsync(`${claveIp}:min`, MAX_PEDIDOS_INVITADO_POR_MINUTO_IP, MINUTO_MS)) ||
    !(await permitirAsync(`${claveIp}:dia`, MAX_PEDIDOS_INVITADO_POR_DIA_IP, DIA_MS))
  ) {
    return {
      ok: false,
      respuesta: error(MENSAJES_INVITADO.demasiadosIntentos, 429, {}, { "Retry-After": "60" }),
    };
  }

  // 7. Email, escrito dos veces igual.
  const email = normalizarEmail(datos.email);
  if (!email) return { ok: false, respuesta: error(MENSAJES_INVITADO.emailInvalido, 400, { campo: "email" }) };
  if (normalizarEmail(datos.emailConfirmacion) !== email) {
    return { ok: false, respuesta: error(MENSAJES_INVITADO.emailsDistintos, 400, { campo: "emailConfirmacion" }) };
  }

  // 8. Reintento idempotente.
  if (opciones.atajo) {
    const repetido = await opciones.atajo({ body: datos, email });
    if (repetido) return { ok: false, respuesta: repetido };
  }

  // 9. Turnstile.
  const humano = await verificarTurnstile(datos.turnstile, ip);
  if (!humano.ok) {
    return {
      ok: false,
      respuesta: error(MENSAJES_INVITADO.verificacion, 400, { motivo: "verificacion_fallida" }),
    };
  }

  // 10. Tope de pendientes por email: no reserva stock.
  const pendientes = await contarPendientesInvitado(email, new Date(Date.now() - VENTANA_PENDIENTES_MS));
  if (pendientes >= MAX_PENDIENTES_POR_EMAIL) {
    return {
      ok: false,
      respuesta: error(MENSAJES_INVITADO.pendientesTope, 409, { motivo: "pendientes_tope" }),
    };
  }

  return { ok: true, body: datos, email, ip };
}
