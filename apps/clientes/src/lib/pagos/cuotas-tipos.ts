/**
 * Tipos LEGADOS del plan de cuotas por proveedor (cuotas v2: escalones + planes de Mercado Pago).
 *
 * El motor, el contrato v2, la sync y el cron se retiraron con `listas-precio-online` (rebanada D):
 * las cuotas ahora son sin interés por lista (`src/lib/cuotas-sin-interes.ts`). Estos tipos quedan
 * SÓLO porque tipan columnas jsonb que siguen en la base y que los pedidos históricos conservan
 * (`orders.cuotas_plan`, `payment_plan_snapshots.planes`): se leen igual, nadie las escribe.
 */

/** Plan real del proveedor para una marca y una cantidad de cuotas (snapshot histórico). */
export interface PlanDeCuotas {
  proveedor: string;
  medio: string;
  cuotas: number;
  /** Recargo % sobre el precio contado. 0 = sin interés. */
  tasaPct: number;
  cftPct: number | null;
  teaPct: number | null;
  montoMin: number | null;
  montoMax: number | null;
}

/** Opción calculada del plan congelado en un pedido histórico. */
export interface OpcionPlanLegado {
  proveedor: string;
  proveedorNombre: string;
  cuotas: number;
  montoCuota: number;
  total: number;
  precioContado: number;
  cftPct: number | null;
  teaPct: number | null;
  sinInteres: boolean;
}

/** Plan congelado en el pedido (orders.cuotas_plan). Filas viejas pueden traer v1. */
export interface PlanPedido {
  version: "v2";
  proveedor: string;
  configVersion: string | null;
  planesFetchedAt: string | null;
  totalBase: number;
  cuotasMax: number;
  opciones: OpcionPlanLegado[];
}
