/**
 * Precio final con IVA para exhibir (Ley 27.743 / Res. 4/2025: precio final y
 * "precio sin impuestos nacionales").
 *
 * Módulo puro: lo usan el catálogo (servidor) y los componentes (cliente).
 *
 * El redondeo copia a `cotizarItem` (src/lib/cotizacion.ts) —neto al centavo,
 * IVA al centavo sobre ese neto, y la suma—, para que el precio final de la card
 * sea exactamente lo que después se cobra por una unidad. Redondear
 * `price * 1.21` de una puede diferir en un centavo.
 */

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * `undefined` si no hay IVA persistido (producto sin backfill) o el precio no
 * es positivo: quien renderiza cae al precio de siempre, sin neto.
 */
export function precioFinal(
  precioNeto: number,
  ivaPorcentaje: number | null | undefined,
): number | undefined {
  if (ivaPorcentaje == null || !Number.isFinite(ivaPorcentaje)) return undefined;
  if (!Number.isFinite(precioNeto) || precioNeto <= 0) return undefined;
  const neto = redondear(precioNeto);
  const iva = redondear(neto * (ivaPorcentaje / 100));
  return redondear(neto + iva);
}
