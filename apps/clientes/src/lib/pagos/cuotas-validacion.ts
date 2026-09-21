/**
 * Enforcement de cuotas en el cobro. Puro: lo usan la ruta de pago y la de
 * pedidos, y se testea sin red ni DB.
 *
 * v2: el tope es por proveedor (todas las tarjetas de crédito), así que sólo se
 * compara contra `cuotas_max` del pedido. Ya no hay topes por marca ni hace
 * falta `metodoPagoId` para validar.
 */
import { planPedido } from "../cuotas";
import type { OfertaCuotas, PlanPedido } from "./cuotas-tipos";
import type { PagoMedio } from "./tipos";

export interface EntradaValidacionCuotas {
  /** Lo que mandó el browser (Brick `installments`). No confiable. */
  cuotas: unknown;
  medio: PagoMedio;
  /** Congelado en el pedido. null = pedido legacy o sin oferta leíble. */
  cuotasMax: number | null;
  /** `cuotasHabilitadas()`. */
  habilitado: boolean;
}

export type ResultadoValidacionCuotas =
  | { ok: true; cuotas: number }
  | { ok: false; motivo: "cuotas_no_disponibles" };

/** Comportamiento previo al cambio: cualquier cosa fuera de 1..24 cobra en 1. */
function clampLegacy(cuotas: unknown): number {
  const n = Number(cuotas);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? Math.floor(n) : 1;
}

export function validarCuotasPago(e: EntradaValidacionCuotas): ResultadoValidacionCuotas {
  if (e.medio !== "tarjeta" || !e.habilitado || e.cuotasMax === null) {
    return { ok: true, cuotas: clampLegacy(e.cuotas) };
  }

  // Sin cuotas en el body se cobra en 1, que siempre está permitido.
  if (e.cuotas === undefined) return { ok: true, cuotas: 1 };

  const rechazo = { ok: false, motivo: "cuotas_no_disponibles" } as const;
  if (typeof e.cuotas !== "number" || !Number.isInteger(e.cuotas) || e.cuotas < 1) return rechazo;
  if (e.cuotas === 1) return { ok: true, cuotas: 1 };
  if (e.cuotas > e.cuotasMax) return rechazo;
  return { ok: true, cuotas: e.cuotas };
}

/**
 * Plan a congelar al crear un pedido. Sólo para Mercado Pago; con oferta
 * ilegible → null (cuotas_max null = legacy, no se bloquean ventas).
 */
export function planParaPedido(
  pagoMetodo: string,
  total: number,
  oferta: OfertaCuotas | null,
): PlanPedido | null {
  if (pagoMetodo !== "mercadopago") return null;
  return planPedido(total, oferta, "mercadopago");
}
