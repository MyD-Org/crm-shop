// Cuenta de Alegra del cliente de un pedido del Shop (change `shop-contactos-alegra-mdp`, D8).
//
// `orders.cliente_codigo` es el id del contacto en la cuenta de Alegra del DESPLIEGUE donde se
// hizo el pedido (`orders.cliente_cuenta`, 0048 del Shop: 'principal' o el slug de la cuenta
// secundaria). Ese id sólo vale en esa cuenta: en otra puede no existir o, peor, ser OTRO cliente
// con el mismo número. Regla única para factura, remito y vincular documentos: se reusa el código
// sólo si la cuenta que factura ES la cuenta del pedido; si no, se busca por documento o se crea.

/** Valor de `cliente_cuenta` / `alegra_account` de la cuenta principal del tenant. */
export const CUENTA_CLAVE_PRINCIPAL = "principal"

/** Clave de una cuenta de `alegra_cuentas` tal como la guardan el espejo y el Shop. */
export function claveCuenta(c: { principal: boolean; slug: string }): string {
  return c.principal ? CUENTA_CLAVE_PRINCIPAL : c.slug
}

/**
 * `cliente_codigo` del pedido si pertenece a la cuenta `clave`; si no (o si el pedido no tiene
 * código), null.
 */
export function codigoClienteEnCuenta(
  p: { clienteCodigo: string | null; clienteCuenta: string },
  clave: string,
): string | null {
  return p.clienteCodigo && p.clienteCuenta === clave ? p.clienteCodigo : null
}
