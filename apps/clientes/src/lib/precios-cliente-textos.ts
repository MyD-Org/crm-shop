/**
 * Textos de "sus precios de cliente" (lista online privada de la cuenta). Español formal de usted.
 * A propósito no dicen "cuenta corriente" en ningún lado.
 */
export const TEXTOS_PRECIOS_CLIENTE = {
  /** Aviso fijo de la tienda. `razonSocial` ausente = sin el "· {razón social}". */
  aviso: (razonSocial?: string | null) => {
    const nombre = razonSocial?.trim();
    return `Está viendo sus precios de cliente${nombre ? ` · ${nombre}` : ""}. Se abonan en efectivo o cheque.`;
  },
  /** Etiqueta chica bajo el precio en cards y ficha. */
  etiqueta: "Su precio de cliente",
  /** Accesible: lo que se tacha. */
  precioGeneral: "Precio general",
  /** Checkout, paso Pago, bajo el medio "Efectivo o cheque". */
  checkoutPago:
    "Los precios de este pedido son sus precios de cliente. El pedido queda a confirmar: lo contactaremos para coordinar el pago en efectivo o cheque. No se cobra nada en la tienda.",
} as const;
