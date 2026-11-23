/**
 * Textos de "sus precios de cliente" (lista online privada de la cuenta). Registro neutro (decisión de la usuaria, 2026-11-23): frases impersonales, sin usted ni vos.
 * A propósito no dicen "cuenta corriente" en ningún lado.
 */
export const TEXTOS_PRECIOS_CLIENTE = {
  /** Aviso fijo de la tienda. `razonSocial` ausente = sin el "· {razón social}". */
  aviso: (razonSocial?: string | null) => {
    const nombre = razonSocial?.trim();
    return `Precios de cliente${nombre ? ` para ${nombre}` : ""}`;
  },
  /** Etiqueta chica bajo el precio en cards y ficha. */
  etiqueta: "Precio de cliente",
  /** Accesible: lo que se tacha. */
  precioGeneral: "Precio general",
  /** Checkout, paso Pago, bajo el medio "Efectivo o cheque". */
  checkoutPago:
    "Pedido con precios de cliente. Queda a confirmar, sin cobro en la tienda.",
} as const;
