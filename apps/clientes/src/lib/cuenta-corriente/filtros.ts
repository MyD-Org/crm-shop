/**
 * Parámetros de las API de listados de cuenta corriente (`start`, `estado`,
 * `desde`, `hasta`). Módulo puro: lo usan las rutas y sus tests.
 *
 * El id del contacto NO es un parámetro: sale siempre de la identidad.
 */
import type { AlegraEstimateFilters, AlegraInvoiceFilters } from "./alegra-cc";
import type { FacturaEstado } from "./tipos";

export const RANGO_INVALIDO = "Revise el rango de fechas.";

/**
 * Estados de la lista de facturas contra los de Alegra. Igual que el portal del
 * CRM (apps/admin/src/app/api/portal/facturas/route.ts): "pendiente" y
 * "vencida" son las dos caras de `open` y Alegra no filtra por vencimiento. La
 * pantalla resuelve esas dos con las abiertas COMPLETAS (`getCuenta`), sin
 * llamar a esta ruta; si alguien la llama igual, recibe las abiertas.
 */
const ESTADO_A_STATUS: Record<FacturaEstado, NonNullable<AlegraInvoiceFilters["status"]>> = {
  pendiente: "open",
  vencida: "open",
  pagada: "closed",
  anulada: "void",
};

export function esEstadoFactura(v: unknown): v is FacturaEstado {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(ESTADO_A_STATUS, v);
}

/** `start` entero ≥ 0; cualquier otra cosa (negativo, texto, decimal) es 0. */
export function startSeguro(raw: string | null): number {
  if (raw === null || !/^\d{1,9}$/.test(raw)) return 0;
  return Number(raw);
}

/** "YYYY-MM-DD" de un día que existe (2026-02-30 no). */
export function esFechaIso(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Rango de emisión: vacío = sin límite; fecha inválida o desde > hasta ⇒ error. */
export function rangoFechas(
  params: URLSearchParams,
): { desde?: string; hasta?: string; error?: undefined } | { error: string } {
  const desde = params.get("desde") || undefined;
  const hasta = params.get("hasta") || undefined;
  if ((desde && !esFechaIso(desde)) || (hasta && !esFechaIso(hasta))) return { error: RANGO_INVALIDO };
  if (desde && hasta && desde > hasta) return { error: RANGO_INVALIDO };
  return { desde, hasta };
}

export type ParamsFacturas =
  | { start: number; filtros: AlegraInvoiceFilters; error?: undefined }
  | { error: string };

/** Parámetros de `GET /api/mi-cuenta/facturas`. Estado desconocido ⇒ todas. */
export function paramsFacturas(params: URLSearchParams): ParamsFacturas {
  const rango = rangoFechas(params);
  if (rango.error !== undefined) return { error: rango.error };
  const estado = params.get("estado");
  return {
    start: startSeguro(params.get("start")),
    filtros: {
      ...(esEstadoFactura(estado) ? { status: ESTADO_A_STATUS[estado] } : {}),
      ...(rango.desde ? { dateFrom: rango.desde } : {}),
      ...(rango.hasta ? { dateTo: rango.hasta } : {}),
    },
  };
}

/**
 * Parámetros de `GET /api/mi-cuenta/pagos`: sólo `start`. Alegra IGNORA los
 * filtros de fecha en pagos (probado en el portal): ofrecerlos recortaría sólo
 * lo cargado, así que no existen.
 */
export function paramsPagos(params: URLSearchParams): { start: number } {
  return { start: startSeguro(params.get("start")) };
}

/**
 * Filtros de presupuestos contra los de Alegra (igual que el portal del CRM,
 * apps/admin/src/app/api/portal/presupuestos/route.ts): aceptado = facturado
 * (`billed`). "Vigente" y "vencido" no se filtran por separado: los dos son
 * `unbilled` y los separa el vencimiento, que Alegra no filtra.
 */
const FILTRO_PRESUPUESTO_A_STATUS = {
  aceptado: "billed",
  sin_aceptar: "unbilled",
} as const satisfies Record<string, NonNullable<AlegraEstimateFilters["status"]>>;

export type EstadoFiltroPresupuesto = keyof typeof FILTRO_PRESUPUESTO_A_STATUS;

export function esEstadoFiltroPresupuesto(v: unknown): v is EstadoFiltroPresupuesto {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(FILTRO_PRESUPUESTO_A_STATUS, v);
}

export type ParamsPresupuestos =
  | { start: number; filtros: AlegraEstimateFilters; error?: undefined }
  | { error: string };

/** Parámetros de `GET /api/mi-cuenta/presupuestos`. Estado desconocido ⇒ todos. */
export function paramsPresupuestos(params: URLSearchParams): ParamsPresupuestos {
  const rango = rangoFechas(params);
  if (rango.error !== undefined) return { error: rango.error };
  const estado = params.get("estado");
  return {
    start: startSeguro(params.get("start")),
    filtros: {
      ...(esEstadoFiltroPresupuesto(estado) ? { status: FILTRO_PRESUPUESTO_A_STATUS[estado] } : {}),
      ...(rango.desde ? { dateFrom: rango.desde } : {}),
      ...(rango.hasta ? { dateTo: rango.hasta } : {}),
    },
  };
}
