/**
 * Resumen de una búsqueda entendida, de `/buscar` a la página del catálogo,
 * para el evento `busqueda_enviada` (lib/tracking). Viaja en una cookie de
 * vida corta (60 s) que la página lee UNA vez y borra: el route handler no
 * puede disparar eventos del navegador. Sin la consulta ni datos personales:
 * intención, fuente, cantidades y milisegundos de Jev. Módulo puro.
 */
import { INTENCIONES, type Intencion } from "./plan";
import type { ResumenBusqueda } from "./buscar";

export const COOKIE_RESUMEN = "busqueda_resumen";

/** Valor para `cookies.set` (Next lo codifica al escribir el encabezado). */
export function valorCookieResumen(r: ResumenBusqueda): string {
  return JSON.stringify(r);
}

const FUENTES = ["deterministico", "jev", "cache"] as const;
const entero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** Valor de la cookie tal como lo ve `document.cookie` (codificado) → resumen válido, o `null`. */
export function leerCookieResumen(valor: string | undefined): ResumenBusqueda | null {
  if (!valor) return null;
  try {
    const o = JSON.parse(decodeURIComponent(valor)) as Record<string, unknown>;
    if (!INTENCIONES.includes(o.intencion as Intencion) || !FUENTES.includes(o.fuente as (typeof FUENTES)[number])) return null;
    return {
      intencion: o.intencion as Intencion,
      fuente: o.fuente as ResumenBusqueda["fuente"],
      duros: entero(o.duros) ?? 0,
      blandos: entero(o.blandos) ?? 0,
      ms_jev: entero(o.ms_jev),
    };
  } catch {
    return null;
  }
}
