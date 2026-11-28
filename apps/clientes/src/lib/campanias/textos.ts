/** Aviso de la línea del carrito que no llega al mínimo de un descuento por cantidad (usted). */
export function textoFaltanPorCantidad(p: { pct: number; faltan: number }): string {
  const unidades = p.faltan === 1 ? "1 unidad más" : `${p.faltan} unidades más`;
  return `Agregue ${unidades} y obtenga ${p.pct} % de descuento en todas.`;
}
