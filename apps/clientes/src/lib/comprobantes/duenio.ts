/**
 * Dueño de un comprobante: quién puede leerlo, confirmarlo y contarlo contra su tope.
 *
 * - `string` = código de contacto de Alegra (`payment_receipts.codigocliente`): el cliente con
 *   cuenta corriente, como siempre.
 * - `{ clerkUserId }` = comprador de la tienda SIN cuenta corriente (0056 del CRM): el
 *   comprobante lo identifica `clerk_user_id` y `codigocliente` es NULL.
 *
 * Con las dos llaves disponibles gana el código de cliente (el comprobante de un vinculado lo
 * conserva además de `clerk_user_id`). Sin ninguna no hay dueño: nunca se arma un filtro vacío.
 *
 * Fuera del despliegue de la cuenta de Alegra principal el código de cliente NO es llave:
 * `payment_receipts.codigocliente` no guarda la cuenta y el mismo id en otra cuenta es otra persona.
 * Ahí el dueño es siempre `{ clerkUserId }` (comprobantes por pedido; change
 * `shop-contactos-alegra-mdp`, D4).
 */
import { esCuentaPrincipal } from "../cuenta-alegra";

export type Duenio = string | { clerkUserId: string };

export function duenioDe(identidad: {
  clerkUserId: string | null;
  cliente: { codigocliente: string } | null;
}): Duenio | null {
  if (identidad.cliente?.codigocliente && esCuentaPrincipal()) return identidad.cliente.codigocliente;
  if (identidad.clerkUserId) return { clerkUserId: identidad.clerkUserId };
  return null;
}
