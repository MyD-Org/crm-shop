/**
 * Tipos neutrales de cuotas (v2: config por proveedor).
 *
 * Ningún campo es propio de un proveedor: los adaptadores (Mercado Pago hoy)
 * normalizan a `PlanDeCuotas` y el CRM publica `ProveedorConfigurado` según el
 * contrato v2 (espejo en MyD-Org/platform/contracts/cuotas/v2).
 *
 * Sin imports de server ni de proveedor: lo usan el motor puro
 * (src/lib/cuotas.ts) y componentes de cliente.
 */

/**
 * Plan real del proveedor para una marca y una cantidad de cuotas. El snapshot
 * se guarda por marca (visa, master), pero la oferta es por proveedor: el motor
 * junta las marcas quedándose con la tasa más alta.
 */
export interface PlanDeCuotas {
  proveedor: string;
  medio: string;
  cuotas: number;
  /** Recargo % sobre el precio contado. 0 = sin interés (lo define el proveedor). */
  tasaPct: number;
  cftPct: number | null;
  teaPct: number | null;
  montoMin: number | null;
  montoMax: number | null;
}

/** Escalón configurado en el CRM: desde `montoMinimo` (con IVA) se ofrece hasta `cuotasMax`. */
export interface EscalonCuotas {
  id: string;
  /** 1..24. */
  cuotasMax: number;
  /** ≥ 0, ARS con IVA. */
  montoMinimo: number;
}

/** Proveedor de pagos configurado en el CRM. Aplica a todas las tarjetas de crédito. */
export interface ProveedorConfigurado {
  id: string;
  /** Id del proveedor: 'mercadopago'. Coincide con `ProveedorCuotas.id`. */
  proveedor: string;
  nombre: string;
  activo: boolean;
  orden: number;
  /** Ordenados por `montoMinimo` ascendente. */
  escalones: EscalonCuotas[];
}

/** Payload de GET {CRM}/api/internal/shop/cuotas?tenant=… */
export interface ContratoCuotasV2 {
  version: "v2";
  tenant: string;
  /** ISO 8601. */
  actualizadoEn: string;
  proveedores: ProveedorConfigurado[];
}

/** Cantidad de cuotas del snapshot del proveedor (ya juntadas las marcas). */
export interface OpcionOfertada {
  cuotas: number;
  /** Tasa 0 del proveedor. */
  sinInteres: boolean;
  tasaPct: number;
  cftPct: number | null;
  teaPct: number | null;
  montoMin: number | null;
  montoMax: number | null;
}

/** Oferta compacta y serializable: viaja como prop al cliente. */
export interface OfertaCuotas {
  proveedores: {
    proveedor: string;
    nombre: string;
    orden: number;
    /** Válidos, ordenados por monto mínimo ascendente. */
    escalones: { cuotasMax: number; montoMinimo: number }[];
    /** Cantidades de 2 a 24 del snapshot, ascendentes. "1 pago" siempre existe. */
    opciones: OpcionOfertada[];
  }[];
  planesFetchedAt: string | null;
  configVersion: string | null;
}

/** Opción calculada para un monto base concreto. */
export interface OpcionCuotas {
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

/** Próximo escalón ("Le faltan $X para hasta N cuotas"). */
export interface Escalon {
  /** Cantidad efectiva que se habilita (la mayor del snapshot ≤ cuotasMax). */
  cuotas: number;
  montoMinimo: number;
  /** montoMinimo − base, redondeado hacia arriba al centavo. */
  faltante: number;
}

/** Plan congelado en el pedido (orders.cuotas_plan). Filas viejas pueden traer v1. */
export interface PlanPedido {
  version: "v2";
  proveedor: string;
  configVersion: string | null;
  planesFetchedAt: string | null;
  totalBase: number;
  cuotasMax: number;
  opciones: OpcionCuotas[];
}
