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

/**
 * Qué hace el checkout después de guardar el formulario de facturación del paso Entrega (comprador
 * sin vincular). Con paso Pago, va a Pago (como siempre). A confirmar, el guardado es la única
 * acción del paso ("Guardar y confirmar pedido"): confirma con lo recién guardado, así nunca sale un
 * pedido sin los cambios del formulario. Si la cotización todavía no permite confirmar, se queda en
 * Entrega para revisar.
 */
export function trasGuardarFacturacion(a: {
  sinPasoPago: boolean;
  listoParaConfirmar: boolean;
}): "pago" | "confirmar" | "revisar" {
  if (!a.sinPasoPago) return "pago";
  return a.listoParaConfirmar ? "confirmar" : "revisar";
}
