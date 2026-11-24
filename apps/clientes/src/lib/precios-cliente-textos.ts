/**
 * Textos de "sus precios de cliente" (lista online privada de la cuenta). Registro neutro (decisión de la usuaria, 2026-11-23): frases impersonales, sin usted ni vos.
 * A propósito no dicen "cuenta corriente" en ningún lado.
 */
export const TEXTOS_PRECIOS_CLIENTE = {
  /** Chip del header (todas las páginas). */
  chip: "Precios de cliente",
  /** Texto completo del chip (tooltip y lectores de pantalla). */
  aviso: "Precios de cliente aplicados",
  /** Etiqueta chica bajo el precio en cards y ficha. */
  etiqueta: "Precio de cliente",
  /** Rótulo del precio tachado (ficha; en la card es sólo accesible). */
  precioGeneral: "Precio general",
  /** Ahorro respecto del general tachado. */
  ahorro: (pct: number) => `${pct}% menos`,
  /** Checkout, paso Pago, bajo el medio "Efectivo o cheque". */
  checkoutPago:
    "Pedido con precios de cliente. Queda a confirmar, sin cobro en la tienda.",
} as const;
