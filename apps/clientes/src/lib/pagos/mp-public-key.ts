import { procesadorDeMedio } from "@/lib/medios-pago";
import { credencialesMercadoPago, type ContextoCredenciales } from "./credenciales";

/**
 * Public key de Mercado Pago para el Brick del pedido, para sumar a las respuestas de crear, retomar y
 * cambiar el medio de un pedido. Sale del servidor (resolver de credenciales) y no sólo de
 * `NEXT_PUBLIC_MP_PUBLIC_KEY`: con una cuenta de MP por sucursal, cada pedido usará la suya. `{}` si
 * el medio no es de Mercado Pago o no hay clave (el navegador cae al `NEXT_PUBLIC_*`).
 */
export function mpPublicKeyPara(pagoMetodo: string, ctx?: ContextoCredenciales): { mpPublicKey?: string } {
  if (procesadorDeMedio(pagoMetodo) !== "mercadopago") return {};
  const { publicKey } = credencialesMercadoPago(ctx);
  return publicKey ? { mpPublicKey: publicKey } : {};
}
