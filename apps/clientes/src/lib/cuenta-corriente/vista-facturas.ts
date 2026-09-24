/**
 * Reglas de pantalla de "Facturas y saldo". Módulo puro (sin React ni
 * `server-only`): lo usan los componentes de cliente y sus tests.
 *
 * Portado de la lógica de apps/admin/src/components/portal/DashboardClient.tsx
 * (FacturasTable, SummaryCard, saldoDe, esPagoParcial), para que el Shop y el
 * portal digan lo mismo del mismo cliente.
 */
import type { DocumentKind } from "./alegra-cc";
import type { Factura, FacturaEstado } from "./tipos";

/** Filtro de estado de la lista: "todas" o un estado. */
export type FiltroEstado = "todas" | FacturaEstado;

export const OPCIONES_ESTADO: readonly { value: FiltroEstado; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "pendiente", label: "Pendientes" },
  { value: "vencida", label: "Vencidas" },
  { value: "pagada", label: "Pagadas" },
  { value: "anulada", label: "Anuladas" },
];

export const LABEL_ESTADO: Record<FacturaEstado, string> = {
  pendiente: "Pendiente",
  vencida: "Vencida",
  pagada: "Pagada",
  anulada: "Anulada",
};

/** Tono del `Badge`. Anulada en neutral: es un documento sin efecto, no un problema del cliente. */
export const TONO_ESTADO: Record<FacturaEstado, "warning" | "danger" | "success" | "neutral"> = {
  pendiente: "warning",
  vencida: "danger",
  pagada: "success",
  anulada: "neutral",
};

export function esFiltroEstado(v: unknown): v is FiltroEstado {
  return OPCIONES_ESTADO.some((o) => o.value === v);
}

/**
 * Pendientes y Vencidas son las dos caras de `open` y Alegra no filtra por
 * vencimiento: salen del set de abiertas COMPLETO, sin pedir nada (igual que el
 * portal). El resto se pide paginado a la API.
 */
export function esFiltroDeAbiertas(estado: FiltroEstado): estado is "pendiente" | "vencida" {
  return estado === "pendiente" || estado === "vencida";
}

/** Saldo pendiente de una factura (anulada = 0). */
export function saldoDe(f: Pick<Factura, "estado" | "importe" | "pagado">): number {
  return f.estado === "anulada" ? 0 : f.importe - (f.pagado ?? 0);
}

/** Pagada en parte: algo pagado, pero no todo. */
export function esPagoParcial(f: Pick<Factura, "importe" | "pagado">): boolean {
  return f.pagado !== undefined && f.pagado > 0 && f.pagado < f.importe;
}

/** "DD/MM/YYYY" → "YYYY-MM-DD" (comparable como texto). "" si no es una fecha. */
export function dmyAIso(dmy: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

export interface RangoEmision {
  /** "YYYY-MM-DD" o vacío = sin límite. */
  start?: string;
  end?: string;
}

/**
 * Filas de Pendientes/Vencidas: del set completo, con el rango de EMISIÓN
 * aplicado acá (el mismo campo que filtra Alegra en el resto de los estados).
 */
export function filtrarAbiertas(abiertas: readonly Factura[], estado: "pendiente" | "vencida", rango: RangoEmision): Factura[] {
  return abiertas.filter((f) => {
    if (f.estado !== estado) return false;
    const emision = dmyAIso(f.emision);
    if (!emision) return true;
    return (!rango.start || emision >= rango.start) && (!rango.end || emision <= rango.end);
  });
}

/**
 * Las facturas de una tarjeta de saldo, las más urgentes primero: el
 * vencimiento más viejo arriba (las vencidas más antiguas / las próximas a
 * vencer). Sin vencimiento, al final.
 */
export function porVencimiento(abiertas: readonly Factura[], estado: "pendiente" | "vencida"): Factura[] {
  const clave = (f: Factura) => dmyAIso(f.vencimiento) || "9999-99-99";
  return abiertas.filter((f) => f.estado === estado).sort((a, b) => clave(a).localeCompare(clave(b)));
}

/** Query de la API de facturas para un filtro. Pendiente/Vencida no la usan. */
export function queryFacturas(estado: FiltroEstado, rango: RangoEmision, start = 0): string {
  const params = new URLSearchParams();
  if (start > 0) params.set("start", String(start));
  if (estado !== "todas") params.set("estado", estado);
  if (rango.start) params.set("desde", rango.start);
  if (rango.end) params.set("hasta", rango.end);
  const q = params.toString();
  return q ? `?${q}` : "";
}

/** Ruta del PDF proxeado (ver `app/api/mi-cuenta/documentos`). */
export function urlDocumento(kind: DocumentKind, alegraId: string, descarga = false): string {
  return `/api/mi-cuenta/documentos/${kind}/${encodeURIComponent(alegraId)}${descarga ? "?download=1" : ""}`;
}

/** Documento abierto en el visor. */
export interface DocumentoAbierto {
  kind: DocumentKind;
  alegraId: string;
  /** Título del visor, p. ej. "Factura FV-1-000128". */
  titulo: string;
}

/** Deep link `?factura=<n>&alegra=<id>` ya validado por el servidor. */
export type DeepLinkFactura = { abrir: DocumentoAbierto } | { noEncontrada: true } | null;
