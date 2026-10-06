/**
 * Cuotas en el cobro, INDEPENDIENTE DEL PROCESADOR. Puro: lo usan la ruta de pago y el registro del
 * cobro, y se testea sin red ni DB.
 *
 * Qué es del procesador y qué no: acá no hay nada de Mercado Pago. El pedido congela la cantidad de
 * cuotas y su total (la lista de esa cantidad); el cobro tiene que ser EXACTAMENTE eso. Cada
 * procesador traduce su pago a `{ cuotas, totalPagado }` (ver `ResultadoCobro`) y arma su propio
 * payload/formulario (Brick, etc.) en su adaptador; sumar otro procesador no toca este módulo.
 */
import type { PagoMedio } from "./tipos";

export interface EntradaValidacionCuotas {
  /** Lo que mandó el navegador (cuotas del formulario de pago). No confiable. */
  cuotas: unknown;
  medio: PagoMedio;
  /**
   * Cuotas congeladas en el pedido (1 = un pago). null = pedido anterior al cambio o creado con el
   * flag `cuotas-cobro` apagado: rige el clamp de siempre.
   */
  cuotasPedido: number | null;
}

export type ResultadoValidacionCuotas =
  | { ok: true; cuotas: number }
  | { ok: false; motivo: "cuotas_distintas" };

/** Comportamiento previo al cambio: cualquier cosa fuera de 1..24 cobra en 1. */
function clampLegacy(cuotas: unknown): number {
  const n = Number(cuotas);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? Math.floor(n) : 1;
}

/**
 * IGUALDAD estricta contra lo congelado: ni más ni menos cuotas. Una cantidad de cuotas es una
 * lista de precios distinta, así que cobrar otra cantidad sería cobrar otro precio. Aplica aunque el
 * flag se haya apagado después de crear el pedido: lo congelado manda. Sin cuotas en el body sólo
 * vale para un pedido en un pago.
 */
export function validarCuotasPago(e: EntradaValidacionCuotas): ResultadoValidacionCuotas {
  if (e.cuotasPedido === null) return { ok: true, cuotas: clampLegacy(e.cuotas) };
  const pedidas = e.cuotas === undefined ? 1 : e.cuotas;
  if (typeof pedidas !== "number" || !Number.isInteger(pedidas) || pedidas !== e.cuotasPedido) {
    return { ok: false, motivo: "cuotas_distintas" };
  }
  return { ok: true, cuotas: pedidas };
}

/** Motivo por el que un operador revisa el cobro en cuotas (ver `orders.pago_revision`). */
export type RevisionDeCuotas = "cuotas_distintas" | "monto_distinto";

/** Tolerancia de redondeo entre lo congelado y lo informado: un centavo. */
const TOLERANCIA_MONTO = 0.0105;

/**
 * Reconciliación: lo que informó el procesador contra lo congelado en el pedido. Sólo se acusa lo
 * que el procesador informó; un pedido sin cuotas congeladas nunca se revisa por esto.
 */
export function revisionDeCuotas(
  pedido: { cuotas: number | null; total: number },
  cobro: { cuotas?: number; totalPagado?: number },
): RevisionDeCuotas | null {
  if (pedido.cuotas === null) return null;
  if (typeof cobro.cuotas === "number" && cobro.cuotas !== pedido.cuotas) return "cuotas_distintas";
  if (typeof cobro.totalPagado === "number" && Math.abs(cobro.totalPagado - pedido.total) > TOLERANCIA_MONTO) {
    return "monto_distinto";
  }
  return null;
}
