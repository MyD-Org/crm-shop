/**
 * Comprobante de transferencia POR PEDIDO (change `pago-transferencia-comprobante`, rebanada C):
 * reglas puras de qué pedido admite que el comprador informe un pago y de dónde salen los datos
 * del comprador sin cuenta corriente. Sin base ni red: la lectura del pedido vive en
 * `lib/pedidos.ts` (`getPedidoParaComprobante`).
 */
import { SLUG_TRANSFERENCIA } from "../cuentas-bancarias";

/** Tope de comprobantes informados por pedido (anti-abuso; se cuenta en la base). */
export const MAX_COMPROBANTES_POR_PEDIDO = 5;

/**
 * Plazo que se le pide al comprador para informar la transferencia (pantalla "Pedido recibido",
 * Mi cuenta y mail). Es un pedido, no una regla: nada cancela el pedido si se pasa.
 */
export const TEXTO_PLAZO_COMPROBANTE =
  "Suba el comprobante de la transferencia ahora o, a más tardar, dentro de las próximas 24 h hábiles. También puede hacerlo desde Mis pedidos.";

/** Lo mínimo del pedido que necesita informar un pago, ya validado contra su dueño. */
export interface PedidoParaComprobante {
  id: string;
  /** "PED-00000042". */
  numero: string;
  /** Total con impuestos congelado en el pedido: precarga el monto del formulario. */
  total: number;
  pagoMetodo: string;
  pagoEstado: string;
  estado: string;
  // Snapshot del comprador, para el backoffice cuando no hay cuenta corriente vinculada.
  clienteRazonSocial: string | null;
  facturacionRazonSocial: string | null;
  contactoNombre: string;
  clienteCuit: string | null;
  facturacionNroDoc: string | null;
  clienteEmail: string | null;
}

export type MotivoNoInformable = "cancelado" | "no_transferencia" | "pagado" | "no_pendiente";

/**
 * Por qué NO se puede informar un pago sobre este pedido, o null si se puede: sólo una
 * transferencia, con el pago pendiente y sin cancelar.
 */
export function motivoNoInformable(
  pedido: Pick<PedidoParaComprobante, "pagoMetodo" | "pagoEstado" | "estado">,
): MotivoNoInformable | null {
  if (pedido.pagoMetodo !== SLUG_TRANSFERENCIA) return "no_transferencia";
  if (pedido.estado === "cancelado") return "cancelado";
  if (pedido.pagoEstado === "pagado") return "pagado";
  if (pedido.pagoEstado !== "pendiente") return "no_pendiente";
  return null;
}

/**
 * Snapshot del comprador para la fila del comprobante cuando NO hay cuenta corriente
 * (`razonsocial` es NOT NULL en la tabla): razón social del cliente, si no la de facturación,
 * si no el nombre de contacto del pedido.
 */
export function datosClienteDelPedido(pedido: PedidoParaComprobante): {
  razonsocial: string;
  cuit: string;
  email: string | null;
} {
  const limpio = (v: string | null) => v?.trim() ?? "";
  return {
    razonsocial:
      limpio(pedido.clienteRazonSocial) || limpio(pedido.facturacionRazonSocial) || limpio(pedido.contactoNombre),
    cuit: limpio(pedido.clienteCuit) || limpio(pedido.facturacionNroDoc),
    email: limpio(pedido.clienteEmail) || null,
  };
}

/**
 * El total del pedido como lo escribiría una persona en el campo Monto (coma decimal, sin
 * separador de miles): precarga el formulario y el comprador lo puede corregir.
 */
export function montoPrecargado(total: number): string {
  return total.toFixed(2).replace(".", ",");
}

/**
 * Si el detalle del pedido en Mi cuenta ofrece "Subir comprobante": la misma regla que valida el
 * servidor (`motivoNoInformable`), sobre la vista del pedido (`pagoMetodoSlug` puede faltar).
 */
export function puedeSubirComprobante(pedido: {
  pagoMetodoSlug?: string;
  pagoEstado: string;
  estado: string;
}): boolean {
  return (
    motivoNoInformable({
      pagoMetodo: pedido.pagoMetodoSlug ?? "",
      pagoEstado: pedido.pagoEstado,
      estado: pedido.estado,
    }) === null
  );
}
