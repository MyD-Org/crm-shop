// Comprobantes de compradores de la tienda SIN cuenta corriente (`codigocliente` NULL desde la
// migración 0056). Alegra necesita un contacto para crear el pago: sin cliente no se carga ahí y
// la gestión es manual (el backoffice marca el comprobante como cargado a mano).

export const SIN_CUENTA_CORRIENTE_MENSAJE =
  "Este comprobante no pertenece a un cliente con cuenta corriente. Regístrelo como pago del pedido."

/** 409 en usted para las rutas que dependen de un cliente de Alegra. */
export function sinCuentaCorrienteResponse(): Response {
  return Response.json(
    { error: SIN_CUENTA_CORRIENTE_MENSAJE, code: "sin_cuenta_corriente" },
    { status: 409, headers: { "Cache-Control": "private, no-store" } },
  )
}
