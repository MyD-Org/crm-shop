/**
 * Pasos del checkout y medio que viaja al pedido según el flujo que resolvió el servidor al cotizar
 * (venta sin stock por modalidad). Puro.
 *
 * Un pedido a confirmar (sin cuenta corriente) saltea el paso Pago y sale con "a_coordinar": no se
 * cobra, el pago se arregla en el contacto. Cuenta corriente: sin cambios, sigue con su medio.
 */
import { SLUG_A_COORDINAR } from "./medios-pago";
import type { FlujoPedido } from "./venta-sin-stock";

export type PasoCheckout = "datos" | "entrega" | "pago";

function sinPasoPago(a: { flujo: FlujoPedido; esCuentaCorriente: boolean }): boolean {
  return a.flujo === "a_confirmar" && !a.esCuentaCorriente;
}

export function pasosCheckout(a: { flujo: FlujoPedido; esCuentaCorriente: boolean }): PasoCheckout[] {
  return sinPasoPago(a) ? ["datos", "entrega"] : ["datos", "entrega", "pago"];
}

/** Slug del medio para `POST /api/pedidos`. Sin medio elegido (ninguno aplica), "a_coordinar", como siempre. */
export function pagoAEnviar(a: { flujo: FlujoPedido; esCuentaCorriente: boolean; medioSlug: string | null }): string {
  return sinPasoPago(a) ? SLUG_A_COORDINAR : (a.medioSlug ?? SLUG_A_COORDINAR);
}
