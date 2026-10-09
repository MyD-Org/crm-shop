import { procesadorDeMedio } from "@/lib/medios-pago";
import { cuentaDelPedido } from "@/lib/pedidos";
import { credencialesMercadoPago } from "./credenciales";
import { cuentaParaCobrar, type PedidoConCuenta } from "./cuentas-sucursales";

/** Lo que el Brick de Mercado Pago necesita del servidor para ESTE pedido. */
export interface ConfigMp {
  /** Public key de la cuenta con la que se cobra el pedido. */
  mpPublicKey?: string;
  /** Esa cuenta (slug de la sucursal): el navegador la devuelve en el POST de cobro. */
  mpCuenta?: string;
}

/**
 * Config del Brick para sumar a las respuestas de crear, retomar y cambiar el medio de un pedido: la
 * public key de la cuenta que cobra ESE pedido (la de su sucursal), nunca una del entorno del navegador.
 * `{}` si el medio no es de Mercado Pago o la cuenta no está configurada: el formulario no se monta (no
 * cobra con una cuenta supuesta). `pedido` es el id (se lee su sucursal) o sus datos de cuenta. Nunca
 * lanza: la respuesta del pedido no depende de esto.
 */
export async function configMpPara(pedido: string | PedidoConCuenta, pagoMetodo: string): Promise<ConfigMp> {
  if (procesadorDeMedio(pagoMetodo) !== "mercadopago") return {};
  try {
    const datos = typeof pedido === "string" ? await cuentaDelPedido(pedido) : pedido;
    if (!datos) return {};
    const elegida = await cuentaParaCobrar("mercadopago", datos);
    if (!elegida.ok) return {};
    const { publicKey } = credencialesMercadoPago(elegida.cuenta);
    return publicKey ? { mpPublicKey: publicKey, mpCuenta: elegida.cuenta } : {};
  } catch (err) {
    console.error("[mp-public-key] no se pudo resolver la cuenta del pedido:", err);
    return {};
  }
}
