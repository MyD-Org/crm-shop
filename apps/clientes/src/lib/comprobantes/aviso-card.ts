/**
 * Aviso del comprobante de transferencia en la card del pedido (Mi cuenta). Regla pura: no toca
 * base ni red; `comprobanteInformado` lo arma la lectura de pedidos (`lib/pedidos.ts`).
 */
import { puedeSubirComprobante } from "./pedido";

export type AvisoComprobante = "falta" | "en_revision";

export const TEXTO_AVISO_FALTA =
  "Falta el comprobante de la transferencia. Súbalo dentro de las 24 h hábiles para que podamos registrar su pago.";
export const TEXTO_AVISO_EN_REVISION = "Recibimos su comprobante. Le avisaremos cuando registremos el pago.";

/**
 * "falta": transferencia con el pago pendiente, sin cancelar y sin comprobantes informados.
 * "en_revision": lo mismo pero con al menos un comprobante informado (pending o loaded).
 * null: cualquier otro caso (otro medio de pago, pagado, cancelado, rechazado).
 */
export function avisoComprobante(pedido: {
  pagoMetodoSlug?: string;
  pagoEstado: string;
  estado: string;
  comprobanteInformado?: boolean;
}): AvisoComprobante | null {
  if (!puedeSubirComprobante(pedido)) return null;
  return pedido.comprobanteInformado ? "en_revision" : "falta";
}
