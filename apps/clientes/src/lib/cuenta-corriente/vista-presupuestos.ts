/**
 * Reglas de pantalla de Pagos y Presupuestos. Módulo puro (sin React ni
 * `server-only`): lo usan los componentes de cliente y sus tests.
 *
 * Portado de apps/admin/src/components/portal/DashboardClient.tsx
 * (PagosTable, PresupuestosTable, PresupuestoBadge), para que el Shop y el
 * portal digan lo mismo del mismo cliente.
 */
import type { EstadoFiltroPresupuesto } from "./filtros";
import type { Pago, PresupuestoEstado } from "./tipos";
import type { RangoEmision } from "./vista-facturas";

/** Filtro de la lista de presupuestos: los dos estados que Alegra sabe filtrar, o todos. */
export type FiltroPresupuestos = "todos" | EstadoFiltroPresupuesto;

export const OPCIONES_PRESUPUESTO: readonly { value: FiltroPresupuestos; label: string }[] = [
  { value: "todos", label: "Todos" },
  { value: "aceptado", label: "Aceptados" },
  { value: "sin_aceptar", label: "Sin aceptar" },
];

export function esFiltroPresupuestos(v: unknown): v is FiltroPresupuestos {
  return OPCIONES_PRESUPUESTO.some((o) => o.value === v);
}

export const LABEL_ESTADO_PRESUPUESTO: Record<PresupuestoEstado, string> = {
  vigente: "Vigente",
  vencido: "Vencido",
  aceptado: "Aceptado",
};

/**
 * Tono del `Badge`, como el `PresupuestoBadge` del portal: vencido en rojo,
 * aceptado en verde. Vigente va en `info`: el portal lo pinta con el primario
 * suave y el `Badge` del DS no tiene tono primario.
 */
export const TONO_ESTADO_PRESUPUESTO: Record<PresupuestoEstado, "success" | "info" | "danger"> = {
  aceptado: "success",
  vigente: "info",
  vencido: "danger",
};

/** Query de `GET /api/mi-cuenta/presupuestos` para un filtro y una página. */
export function queryPresupuestos(filtro: FiltroPresupuestos, rango: RangoEmision, start = 0): string {
  const params = new URLSearchParams();
  if (start > 0) params.set("start", String(start));
  if (filtro !== "todos") params.set("estado", filtro);
  if (rango.start) params.set("desde", rango.start);
  if (rango.end) params.set("hasta", rango.end);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/**
 * Facturas del pago para la columna de la lista: la primera y cuántas más
 * ("A-0001 +2"), como en el portal. Sin imputaciones, "—".
 */
export function resumenImputaciones(pago: Pick<Pago, "facturas">): { primera: string; mas: number } {
  const [primera, ...resto] = pago.facturas;
  return { primera: primera?.factura ?? "—", mas: resto.length };
}
