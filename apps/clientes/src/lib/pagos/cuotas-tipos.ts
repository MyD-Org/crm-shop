/**
 * Tipos neutrales del cambio cuotas-configurables (modelo Tiendanube).
 *
 * Ningún campo es propio de un proveedor: los adaptadores (Mercado Pago hoy)
 * normalizan a `PlanDeCuotas` y el CRM publica `MedioDePago` / `OpcionConfigurada`
 * según el contrato v1 (espejo en MyD-Org/platform/contracts/cuotas/v1).
 *
 * Sin imports de server ni de proveedor: lo usan el motor puro
 * (src/lib/cuotas.ts) y componentes de cliente.
 */

/** Plan real del proveedor para un medio y una cantidad de cuotas. */
export interface PlanDeCuotas {
  proveedor: string;
  medio: string;
  cuotas: number;
  /** Recargo % sobre el precio contado (0 = sin interés en la cuenta). */
  tasaPct: number;
  cftPct: number | null;
  teaPct: number | null;
  montoMin: number | null;
  montoMax: number | null;
}

/** Medio de pago configurado en el CRM. */
export interface MedioDePago {
  id: string;
  proveedor: string;
  /** Código del medio en el proveedor: 'visa', 'master'. */
  codigo: string;
  nombre: string;
  activo: boolean;
  orden: number;
}

/** Opción de cuotas que el admin eligió ofrecer. Aplica a todos los productos. */
export interface OpcionConfigurada {
  id: string;
  medioId: string;
  /** 2..24. "1 pago" no se configura: siempre está disponible. */
  cuotas: number;
  /** Marcada sin interés en el CRM. Efectivo sólo si además la tasa es 0. */
  sinInteres: boolean;
  /** Monto base mínimo, con IVA. */
  montoMinimo: number;
  /** YYYY-MM-DD inclusive, hora Argentina. null = sin límite. */
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  activo: boolean;
}

/** Opción ya filtrada (activa, vigente, con plan) y cruzada con la tasa real. */
export interface OpcionOfertada {
  cuotas: number;
  /** Sin interés EFECTIVO (doble llave: marcada y tasa 0). */
  sinInteres: boolean;
  montoMinimo: number;
  tasaPct: number;
  cftPct: number | null;
  teaPct: number | null;
  montoMin: number | null;
  montoMax: number | null;
}

/** Oferta compacta y serializable: viaja como prop al cliente. */
export interface OfertaCuotas {
  medios: {
    codigo: string;
    nombre: string;
    orden: number;
    opciones: OpcionOfertada[];
  }[];
  /** Fecha de referencia (YYYY-MM-DD, hora AR) con la que se evaluó la vigencia. */
  hoy: string;
  planesFetchedAt: string | null;
  configVersion: string | null;
}

/** Opción calculada para un monto base concreto. */
export interface OpcionCuotas {
  medio: string;
  medioNombre: string;
  cuotas: number;
  montoCuota: number;
  total: number;
  precioContado: number;
  cftPct: number | null;
  teaPct: number | null;
  sinInteres: boolean;
}

/** Próximo escalón de cuotas ("Te faltan $X para N cuotas sin interés"). */
export interface Escalon {
  cuotas: number;
  sinInteres: boolean;
  montoMinimo: number;
  /** montoMinimo − base, redondeado hacia arriba al centavo. */
  faltante: number;
}

/** Plan congelado en el pedido (orders.cuotas_plan). */
export interface PlanPedido {
  version: "v1";
  configVersion: string | null;
  planesFetchedAt: string | null;
  hoy: string;
  totalBase: number;
  cuotasMax: number;
  maxPorMedio: Record<string, number>;
  opciones: OpcionCuotas[];
}

/** Payload de GET {CRM}/api/internal/shop/cuotas?tenant=… */
export interface ContratoCuotasV1 {
  version: "v1";
  tenant: string;
  /** ISO 8601. */
  actualizadoEn: string;
  medios: MedioDePago[];
  opciones: OpcionConfigurada[];
}
