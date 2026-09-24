/**
 * Tabla única de Pagos: los recibos de Alegra y, arriba, los pagos que informó
 * el cliente y el backoffice todavía no registró. Módulo puro (sin React ni
 * `server-only`): lo usan los componentes de cliente y sus tests.
 *
 * Un comprobante ya registrado no se lista: aparece como su recibo, así el
 * mismo pago no se ve dos veces.
 */
import type { ComprobanteCliente } from "../comprobantes/repo";
import { fechaCorta, medioDe, montoDe } from "../comprobantes/vista-comprobantes";
import type { Pago } from "./tipos";

export type FilaPago =
  | { tipo: "recibo"; clave: string; pago: Pago }
  | { tipo: "informado"; clave: string; comprobante: ComprobanteCliente };

/** Lo que muestra la columna "Pago" para un pago informado (también va en el WhatsApp). */
export const PAGO_INFORMADO = "Pago informado (en revisión)";

/** Informados en revisión primero (ya vienen del más reciente al más viejo), después los recibos. */
export function filasPagos(comprobantes: ComprobanteCliente[], pagos: Pago[]): FilaPago[] {
  return [
    ...comprobantes
      .filter((c) => c.status === "pending")
      .map((c): FilaPago => ({ tipo: "informado", clave: `informado:${c.id}`, comprobante: c })),
    ...pagos.map((p): FilaPago => ({ tipo: "recibo", clave: `recibo:${p.alegraId}`, pago: p })),
  ];
}

/** Datos comunes de una fila, para la tabla, el total y el mensaje de WhatsApp. */
export function datosFila(f: FilaPago): { id: string; fecha: string; medio: string; monto: number } {
  if (f.tipo === "recibo") {
    const { id, fecha, medio, monto } = f.pago;
    return { id, fecha, medio, monto };
  }
  const c = f.comprobante;
  return { id: PAGO_INFORMADO, fecha: fechaCorta(c.paidOn), medio: medioDe(c), monto: montoDe(c) };
}
