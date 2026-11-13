/**
 * Modo invitado del checkout, resuelto en el SERVIDOR (change `compra-como-invitado`, S2b).
 * Sólo se importa desde `app/checkout/page.tsx` (el cliente importa únicamente el tipo).
 */
import { verificarToken } from "./pedido-token";
import { datosDelContactoInvitado } from "./facturacion-invitado";
import { paraElCliente, type DatosDelContactoPublico } from "./datos-del-contacto";

/** Lo que la página le pasa a `CheckoutClient` cuando el comprador es un invitado. */
export interface InvitadoCheckout {
  activo: true;
  /** Clave pública del desafío (vacía = sin desafío y por lo tanto sin compra: falla cerrada). */
  turnstileSiteKey: string;
  /** Retorno de Mercado Pago con un token de compra válido para ese pedido (nunca se muestra). */
  tokenRetorno?: string;
  /** Volvió a `/checkout?pedido=` sin un token válido: no se muestra nada del pedido. */
  sinToken?: boolean;
}

/**
 * Retorno a `/checkout?pedido=<id>&t=<token>`: el token vale si es de compra, está vigente y es de
 * ESE pedido. Sin `pedido` no hay retorno que resolver.
 */
export function resolverRetornoInvitado(
  pedido: string | null,
  t: string | null,
  ahora: number = Date.now(),
): { tokenRetorno?: string; sinToken?: boolean } {
  if (!pedido) return {};
  if (!t) return { sinToken: true };
  const r = verificarToken(t, "compra", ahora);
  if (!r.ok || r.orderId !== pedido) return { sinToken: true };
  return { tokenRetorno: t };
}

/** Facturación "vacía" que ve el formulario del invitado: nada viene de Alegra ni de un perfil. */
export function facturacionVaciaInvitado(): DatosDelContactoPublico {
  return paraElCliente(datosDelContactoInvitado({ pais: "AR" }));
}
