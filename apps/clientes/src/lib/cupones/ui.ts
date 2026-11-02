// Textos del cupón en la tienda (carrito, checkout, aviso del link). Puro y en usted.

/** Aviso al llegar con `?cupon=` (link del bot o de una historia). */
export function avisoCuponGuardado(cupon: string): string {
  return `Cupón ${cupon.trim().toUpperCase()} guardado: se aplica en el checkout.`;
}
