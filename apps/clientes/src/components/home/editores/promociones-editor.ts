import type { EstrellaPromo, PromocionesContent } from "@/data/home-defaults";

/**
 * Helpers puros del editor de promociones (spec 2026-10-26-promociones-home §3 y §7): el contador
 * de unidades necesita el stock del momento en que se cargaron (`stockBase`).
 */

/** Fija (o quita) las unidades de promo de la estrella junto con el stock de ese momento. */
export function aplicarUnidades(
  c: PromocionesContent,
  { unidades, stock }: { unidades: number | undefined; stock: number | null },
): PromocionesContent {
  if (!c.estrella) return c;
  const resto: EstrellaPromo = { ...c.estrella };
  delete resto.unidadesPromo;
  delete resto.stockBase;
  if (!unidades) return { ...c, estrella: resto };
  return { ...c, estrella: { ...resto, unidadesPromo: unidades, stockBase: stock ?? 0 } };
}

/** ¿Hay que volver a tomar el stock? Sí al cambiar estrella, sucursal o unidades, o si falta. */
export function necesitaStockBase(antes: EstrellaPromo | undefined, despues: EstrellaPromo | undefined): boolean {
  if (!despues?.unidadesPromo) return false;
  if (despues.stockBase === undefined) return true;
  if (!antes) return false;
  return antes.sku !== despues.sku || antes.sucursal !== despues.sucursal || antes.unidadesPromo !== despues.unidadesPromo;
}
