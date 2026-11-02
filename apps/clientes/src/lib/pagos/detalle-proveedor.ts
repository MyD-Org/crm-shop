/**
 * Saneo del error que devuelve un procesador de pago (Mercado Pago, Payway) antes de guardarlo en
 * `pago_intentos.error_proveedor` (migración 0041), donde lo lee el CRM para diagnosticar fallos.
 *
 * Es por LISTA BLANCA: sólo se extraen campos conocidos y nunca se serializa el cuerpo entero (puede traer
 * el email del comprador, el token de la tarjeta o datos de la cuenta). Sobre el texto resultante se
 * redactan los patrones sensibles y se trunca a `DETALLE_PROVEEDOR_MAX` (el CHECK de la columna es la red
 * de seguridad). Funciones puras.
 */

import { ErrorProveedor } from "./tipos";

export const DETALLE_PROVEEDOR_MAX = 500;

const MAX_ELEMENTOS = 5;

/** Un código de error legible ("cc_rejected_call_for_authorize") no es un token: sólo minúsculas y "_". */
const SOLO_CODIGO = /^[a-z_]+$/;

/**
 * Redacta lo sensible de un texto suelto y lo trunca. El orden importa: primero lo que contiene dígitos o
 * símbolos propios (emails, Bearer, prefijos de credencial, querystrings) y después los patrones genéricos.
 */
export function sanearTexto(texto: string): string {
  const limpio = texto
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\bBearer\s+\S+/gi, "[credencial]")
    .replace(/\b(?:APP_USR|TEST)-[\w-]*/g, "[credencial]")
    .replace(/\?[^\s]*/g, "?[redactado]")
    .replace(/[A-Za-z0-9_-]{24,}/g, (m) => (SOLO_CODIGO.test(m) ? m : "[token]"))
    .replace(/\d(?:[ -]?\d){7,}/g, "[numero]")
    .trim();
  return limpio.slice(0, DETALLE_PROVEEDOR_MAX);
}

/** Valor escalar (texto o número) listo para mostrar, o null. */
function escalar(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function lista(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_ELEMENTOS)
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null && !Array.isArray(e));
}

/**
 * Texto diagnóstico (saneado, <= 500) a partir del cuerpo de error del procesador, o null si no hay nada
 * útil (cuerpo vacío, HTML, no objeto).
 *
 * Mercado Pago: `message`, `error`, `status`, `status_detail`, `cause[].code` + `cause[].description`.
 * Payway: `error_type`, `message`, `validation_errors[].code` + `validation_errors[].param`.
 */
export function sanearDetalleProveedor(cuerpo: unknown): string | null {
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) return null;
  const c = cuerpo as Record<string, unknown>;

  const partes: string[] = [];
  for (const campo of ["error_type", "message", "error", "status", "status_detail"] as const) {
    const valor = escalar(c[campo]);
    if (valor) partes.push(`${campo}: ${valor}`);
  }
  for (const e of lista(c.cause)) {
    const par = [escalar(e.code), escalar(e.description)].filter(Boolean).join(" ");
    if (par) partes.push(`cause: ${par}`);
  }
  for (const e of lista(c.validation_errors)) {
    const par = [escalar(e.code), escalar(e.param)].filter(Boolean).join(" ");
    if (par) partes.push(`validation: ${par}`);
  }

  if (partes.length === 0) return null;
  return sanearTexto(partes.join("; ")) || null;
}

/** Diagnóstico listo para `registrarErrorIntento`. */
export interface ErrorDeIntento {
  detalle: string;
  status: number | null;
}

/**
 * Qué se guarda en el intento cuando el cobro lanza `err` (el catch de `cobrarPedido`):
 *  - `ErrorProveedor`: su detalle saneado (o su mensaje saneado si el cuerpo no traía nada) y su HTTP;
 *  - timeout/abortado: texto fijo y sin HTTP;
 *  - cualquier otro error: sólo su nombre (`error_interno: TypeError`), nunca su mensaje, que puede traer
 *    SQL, URLs o datos del pedido.
 */
export function errorDeCatch(err: unknown): ErrorDeIntento {
  if (err instanceof ErrorProveedor) {
    return { detalle: err.detalle ?? (sanearTexto(err.message) || `respondio ${err.status}`), status: err.status };
  }
  const nombre = typeof err === "object" && err !== null && "name" in err ? String((err as { name: unknown }).name) : "";
  if (nombre === "TimeoutError" || nombre === "AbortError") {
    return { detalle: "tiempo de espera agotado", status: null };
  }
  return { detalle: `error_interno: ${sanearTexto(nombre || typeof err)}`, status: null };
}
