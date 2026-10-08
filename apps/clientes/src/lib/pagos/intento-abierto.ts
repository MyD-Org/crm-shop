/**
 * Qué hacer con un intento de cobro que sigue abierto cuando el comprador
 * quiere pagar de nuevo. SOLO servidor.
 *
 * El caso que motivó esto: el primer pago queda pendiente, el comprador
 * reintenta con otra tarjeta, y después se aprueba el primero. Con los dos
 * abiertos, los dos se pueden aprobar y paga dos veces. Por eso no se abre un
 * intento nuevo sin antes cerrar el anterior.
 *
 * Bloquear sin más tampoco sirve: un pago en revisión puede tardar días, y el
 * comprador quedaría trabado. Se intenta CANCELAR el anterior en el proveedor y
 * sólo si eso se confirma se libera el camino.
 */

import {
  descartarReserva,
  registrarCobro,
  type IntentoAbierto,
} from "@/lib/pedidos";
import type { EstadoPago, ProveedorPago } from "./tipos";

/**
 * Una reserva sin referencia más vieja que esto se da por abandonada: la ruta
 * espera al proveedor como mucho 15 s (TIMEOUT_MS de mercadopago.ts), así que
 * pasado este margen nadie la va a completar. Si igual existía un pago, el
 * webhook lo recupera por `external_reference`.
 */
export const RESERVA_ABANDONADA_MS = 2 * 60_000;

/**
 * Un intento con referencia que el proveedor NUNCA conoció (consulta sin resultado, ver
 * `EstadoPago.noEncontrado`) se da por "no llegó" pasado este margen: el request pudo no haberse
 * enviado (la referencia se anota antes de llamar). Mucho más que lo que tarda una operación
 * (~6 s) y que el timeout de la ruta (15 s).
 */
export const NO_LLEGO_MS = 10 * 60_000;

/**
 * Si el proveedor no conoce el pago y el intento ya es viejo, el estado real es "fallido: no llegó".
 * Un pendiente que el proveedor SÍ conoce (p. ej. en revisión) nunca se descarta por antigüedad.
 */
export function darPorPerdidoSiCorresponde(
  estado: EstadoPago,
  creadoEn: Date | undefined,
  ahora = Date.now(),
): EstadoPago {
  if (!estado.noEncontrado || !creadoEn || ahora - creadoEn.getTime() < NO_LLEGO_MS) return estado;
  return { ...estado, estado: "fallido", detalle: "no_llego", noEncontrado: false };
}

export type Resolucion =
  /** El intento anterior quedó cerrado: se puede abrir otro. */
  | "libre"
  /** El intento anterior se cobró: el pedido ya está pagado. */
  | "pagado"
  /** No se pudo cerrar: hay que esperar. */
  | "en_curso";

export async function resolverIntentoAbierto(
  pedidoId: string,
  abierto: IntentoAbierto,
  proveedor: ProveedorPago,
  ahora = Date.now(),
): Promise<Resolucion> {
  if (!abierto.referencia) {
    if (ahora - abierto.creadoEn.getTime() < RESERVA_ABANDONADA_MS) return "en_curso";
    await descartarReserva(abierto.id, "reserva_abandonada");
    return "libre";
  }

  let estado: EstadoPago;
  try {
    estado = await proveedor.cancelarPago(abierto.referencia);
  } catch (err) {
    // El proveedor no dejó cancelar: lo más probable es que el pago ya se haya
    // resuelto. Se consulta para saber cómo.
    console.warn(`[pagos] no se pudo cancelar ${abierto.referencia}:`, err);
    try {
      estado = await proveedor.consultarPago(abierto.referencia);
    } catch (err2) {
      console.error(`[pagos] no se pudo consultar ${abierto.referencia}:`, err2);
      return "en_curso";
    }
  }

  estado = darPorPerdidoSiCorresponde(estado, abierto.creadoEn, ahora);

  await registrarCobro(pedidoId, {
    proveedor: proveedor.id,
    referencia: abierto.referencia,
    estado: estado.estado,
    detalle: estado.detalle,
    reversion: estado.reversion,
    cuotas: estado.cuotasPagadas,
    totalPagado: estado.totalPagado,
    ...(estado.info ? { info: estado.info } : {}),
  }, { avisar: estado.estado !== "fallido" });

  if (estado.estado === "pagado") return "pagado";
  if (estado.estado === "fallido") return "libre";
  return "en_curso";
}
