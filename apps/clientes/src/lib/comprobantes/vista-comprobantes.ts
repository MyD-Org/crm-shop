/**
 * Reglas de pantalla de "Informar pago" y "Mis comprobantes". Módulo puro
 * (sin React ni acceso a base): lo usan los componentes de cliente y sus tests.
 */
import type { ComprobanteCliente } from "./repo";
import { METHOD_LABELS, type ReceiptMethod } from "./validacion";

export type EstadoComprobante = ComprobanteCliente["status"];

/** Lo que ve el cliente: "En revisión" hasta que el backoffice lo registra. */
export const LABEL_ESTADO_COMPROBANTE: Record<EstadoComprobante, string> = {
  pending: "En revisión",
  loaded: "Registrado",
};

export const TONO_ESTADO_COMPROBANTE: Record<EstadoComprobante, "warning" | "success"> = {
  pending: "warning",
  loaded: "success",
};

export const OPCIONES_MEDIO: readonly { value: ReceiptMethod; label: string }[] = (
  Object.keys(METHOD_LABELS) as ReceiptMethod[]
).map((value) => ({ value, label: METHOD_LABELS[value] }));

/** "Transferencia", "Otro (Mercado Pago)". */
export function medioDe(c: Pick<ComprobanteCliente, "method" | "methodOther">): string {
  if (c.method === "otro" && c.methodOther) return `Otro (${c.methodOther})`;
  return METHOD_LABELS[c.method as ReceiptMethod] ?? c.method;
}

/** "2026-09-10" (o un ISO completo) → "10/09/2026". */
export function fechaCorta(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : iso;
}

/** Monto decimal de la base ("150000.50") → número para `fmtPrecio`. */
export function montoDe(c: Pick<ComprobanteCliente, "amount">): number {
  return Number(c.amount);
}

/** Tipos que ofrece el selector de archivos (HEIC entra igual: se convierte). */
export const ACCEPT_COMPROBANTE = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
